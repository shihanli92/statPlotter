import { applyQt, norm2, qrFactor, solveR } from '../linalg/qr.ts'

/**
 * Box-constrained Levenberg–Marquardt for min ‖r(x)‖², lower ≤ x ≤ upper.
 *
 * - Damping: Marquardt (1963) with Moré's (1978) scaling, "The Levenberg–Marquardt algorithm:
 *   implementation and theory", Lecture Notes in Math. 630: the damping term is λ‖Dh‖² with
 *   D = diag of the running maximum of the Jacobian column norms, which makes the iteration
 *   invariant to the scale of each parameter.
 * - λ update: Nielsen (1999), "Damping parameter in Marquardt's method", IMM-REP-1999-05 (also
 *   Madsen, Nielsen & Tingleff 2004, Alg. 3.16): on success λ ← λ·max(⅓, 1 − (2ρ − 1)³), ν ← 2;
 *   on failure λ ← λν, ν ← 2ν, where ρ is the ratio of actual to predicted reduction. λ starts
 *   at 1e-3 (relative to the scaled problem, i.e. Marquardt's classic start).
 * - Step: the damped subproblem min ‖J̃h̃ + r‖² + λ‖h̃‖² (J̃ = JD⁻¹, h = D⁻¹h̃) is solved as a
 *   stacked least-squares problem by Householder QR, never through JᵀJ, so conditioning is not
 *   squared.
 * - Bounds: gradient projection with an active set (Bertsekas 1982, "Projected Newton methods
 *   for optimization problems with simple constraints", SIAM J. Control Optim. 20). A parameter
 *   sitting on a bound whose descent direction points outward is held fixed for the step; the
 *   trial point is projected onto the box, and the predicted reduction uses the projected step.
 *
 * Convergence (Prism-like): the relative change in SS is below 1e-8 on 5 consecutive trials,
 * where a trial counts if it was accepted with a relative decrease < 1e-8, or rejected when the
 * model itself predicted a relative decrease < 1e-8 (at the minimum, rounding makes the
 * remaining tiny steps fail). A rejected trial with a large predicted decrease resets the count.
 * SS = 0, or no free parameter able to move, also ends the fit. Every trial (function evaluation
 * after the initial one) counts as one iteration.
 *
 * Polishing: an SS criterion alone can leave the parameters ~1e-4 standard errors from the
 * minimum on slowly converging problems, and near the minimum SS differences drown in rounding
 * noise even though the Gauss–Newton step is still accurate. So once converged, up to 30
 * undamped Gauss–Newton steps are taken, each accepted while SS does not rise by more than
 * 1e-10 relative, until the predicted decrease falls below 1e-20·SS or stops shrinking. The
 * tolerance sits above SS's rounding noise, which on ill-conditioned problems reaches ~1e-11
 * relative (NIST Lanczos3): at 1e-12 an accurate step was rejected on x64 but not on arm64,
 * leaving 8 instead of 10.5 correct digits. The status is unaffected; the result is the minimum to working precision
 * (compare R's nls, whose relative-offset criterion is likewise gradient-based).
 */

export interface LsqProblem {
  /** Number of residuals. */
  m: number
  /** Number of parameters. */
  n: number
  /** r ← residuals at x. Returns false if any is not finite. */
  residuals(x: Float64Array, r: Float64Array): boolean
  /** J ← ∂r/∂x at x, column-major m×n; r holds the residuals at x. False if not finite. */
  jacobian(x: Float64Array, r: Float64Array, J: Float64Array): boolean
  lower: Float64Array
  upper: Float64Array
}

export interface LmOptions {
  maxIterations?: number
  /** Relative SS change regarded as no change (default 1e-8). */
  ssTol?: number
  /** Consecutive small changes required (default 5). */
  consecutive?: number
}

export type LmStatus = 'converged' | 'maxIterations' | 'invalid'

export interface LmResult {
  status: LmStatus
  message?: string
  iterations: number
  x: Float64Array
  r: Float64Array
  /** Jacobian at x (column-major m×n). */
  J: Float64Array
  ss: number
  /** 1 where the parameter sits on a bound and the gradient pushes it outward. */
  active: Uint8Array
}

function sumSquares(r: Float64Array): number {
  const v = norm2(r, 0, r.length)
  return v * v
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

const LAMBDA_MIN = 1e-20

export function levenbergMarquardt(
  prob: LsqProblem,
  x0: ArrayLike<number>,
  opts: LmOptions = {},
): LmResult {
  const { m, n, lower, upper } = prob
  const maxIterations = opts.maxIterations ?? 1000
  const ssTol = opts.ssTol ?? 1e-8
  const needed = opts.consecutive ?? 5
  const x = new Float64Array(n)
  for (let j = 0; j < n; j++) x[j] = clamp(x0[j]!, lower[j]!, upper[j]!)
  const r = new Float64Array(m)
  const J = new Float64Array(m * n)
  const act = new Uint8Array(n)
  const D = new Float64Array(n)
  const rn = new Float64Array(m)
  const xn = new Float64Array(n)
  const Jh = new Float64Array(m)
  let iterations = 0
  let ss = 0

  /** Active set: on a bound with the descent direction −Jᵀr pointing out of the box. */
  const updateActive = (): number => {
    let nFree = 0
    for (let j = 0; j < n; j++) {
      let g = 0
      for (let i = 0; i < m; i++) g += J[j * m + i]! * r[i]!
      const out = (x[j]! <= lower[j]! && g > 0) || (x[j]! >= upper[j]! && g < 0)
      act[j] = out ? 1 : 0
      if (!out) nFree++
    }
    return nFree
  }
  const updateScale = (): void => {
    for (let j = 0; j < n; j++) {
      const c = norm2(J, j * m, j * m + m)
      if (c > D[j]!) D[j] = c
    }
  }
  const done = (status: LmStatus, message?: string): LmResult => {
    updateActive()
    const res: LmResult = { status, iterations, x, r, J, ss, active: act.slice() }
    if (message) res.message = message
    return res
  }

  /**
   * Trial point xn for damping λ on the free parameters; returns the predicted reduction
   * ‖r‖² − ‖r + J(xn − x)‖², NaN if the step is not finite, or 0 if nothing moves.
   */
  const trial = (lambda: number): number => {
    const free: number[] = []
    for (let j = 0; j < n; j++) if (!act[j]) free.push(j)
    const nf = free.length
    const rows = m + nf
    const A = new Float64Array(rows * nf)
    const rhs = new Float64Array(rows)
    const sl = Math.sqrt(lambda)
    for (let c = 0; c < nf; c++) {
      const j = free[c]!
      const d = D[j]!
      for (let i = 0; i < m; i++) A[c * rows + i] = J[j * m + i]! / d
      A[c * rows + m + c] = sl
    }
    for (let i = 0; i < m; i++) rhs[i] = -r[i]!
    const f = qrFactor(A, rows, nf, false)
    applyQt(f, rhs)
    const z = solveR(f, rhs, nf)
    xn.set(x)
    for (let c = 0; c < nf; c++) {
      const j = free[c]!
      const v = z[c]! / D[j]!
      if (!Number.isFinite(v)) return Number.NaN
      xn[j] = clamp(x[j]! + v, lower[j]!, upper[j]!)
    }
    Jh.fill(0)
    let moved = false
    for (let j = 0; j < n; j++) {
      const hj = xn[j]! - x[j]!
      if (hj === 0) continue
      moved = true
      for (let i = 0; i < m; i++) Jh[i] = Jh[i]! + J[j * m + i]! * hj
    }
    if (!moved) return 0
    let pred = 0
    for (let i = 0; i < m; i++) pred -= Jh[i]! * (2 * r[i]! + Jh[i]!)
    return pred
  }
  /** Moves to xn (residuals in rn). False if the Jacobian there is not finite. */
  const accept = (ssn: number): boolean => {
    x.set(xn)
    r.set(rn)
    ss = ssn
    if (!prob.jacobian(x, r, J)) return false
    updateScale()
    return true
  }

  if (!prob.residuals(x, r))
    return done('invalid', 'The model is not finite at the initial values.')
  if (!prob.jacobian(x, r, J)) {
    return done('invalid', 'The model derivatives are not finite at the initial values.')
  }
  ss = sumSquares(r)
  if (n === 0) return done('converged')
  updateScale()
  for (let j = 0; j < n; j++) if (!(D[j]! > 0)) D[j] = 1

  let lambda = 1e-3
  let nu = 2
  let small = 0
  let converged = false
  while (!converged) {
    if (ss === 0 || updateActive() === 0) return done('converged')
    if (iterations >= maxIterations) {
      return done('maxIterations', `Not converged after ${maxIterations} iterations.`)
    }
    iterations++
    const pred = trial(lambda)
    if (pred === 0) break
    const ok = !Number.isNaN(pred) && prob.residuals(xn, rn)
    const ssn = ok ? sumSquares(rn) : Number.POSITIVE_INFINITY
    if (ok && ssn < ss && pred > 0) {
      const rho = (ss - ssn) / pred
      const rel = (ss - ssn) / ss
      if (!accept(ssn)) return done('invalid', 'The model derivatives are not finite.')
      lambda = Math.max(LAMBDA_MIN, lambda * Math.max(1 / 3, 1 - (2 * rho - 1) ** 3))
      nu = 2
      small = rel < ssTol ? small + 1 : 0
    } else {
      lambda *= nu
      nu *= 2
      if (!(pred / ss >= ssTol)) small++
      else small = 0
    }
    if (small >= needed || lambda > 1e300) converged = true
  }

  // Polish with Gauss–Newton steps.
  let prevPred = Number.POSITIVE_INFINITY
  for (let k = 0; k < 30 && iterations < maxIterations; k++) {
    if (ss === 0 || updateActive() === 0) break
    const pred = trial(LAMBDA_MIN)
    if (!(pred > 0)) break
    iterations++
    if (!prob.residuals(xn, rn)) break
    const ssn = sumSquares(rn)
    if (!(ssn <= ss * (1 + 1e-10))) break
    if (!accept(ssn)) return done('invalid', 'The model derivatives are not finite.')
    if (pred <= 1e-20 * ss || pred > 0.9 * prevPred) break
    prevPred = pred
  }
  return done('converged')
}
