/**
 * Initial-value problems y′ = f(x, y) for differential-equation models (user equations with a
 * `dY/dX = …` line), solved on demand in both directions from x0 with dense output.
 *
 * - Dormand–Prince 5(4) (Dormand & Prince, J. Comput. Appl. Math. 6, 1980) with FSAL, local
 *   extrapolation, the standard step-size controller (safety 0.9, factor in [0.2, 5]) and the
 *   4th-order continuous extension of Hairer, Nørsett & Wanner (Solving ODEs I, §II.6, dense
 *   output of DOPRI5), so a value between steps is as accurate as the steps themselves.
 * - The error norm is the RMS over all components of err/(rtol·(|y| + ref)), with ref the
 *   largest |component| seen so far times its `scale` (Y's magnitude for Y, Y's magnitude /
 *   |θⱼ| for a sensitivity ∂Y/∂θⱼ). rtol = 1e−12 by default: the solution (and so a fit) is
 *   good to ~1e−11 relative, and its sensitivities to about the same.
 * - Stiffness: when Dormand–Prince needs more than `maxSteps` steps for one extension, or the
 *   step underflows, that direction continues with the Rosenbrock method ode23s of Shampine &
 *   Reichelt (SIAM J. Sci. Comput. 18, 1997), L-stable, order 2 with an order-3 error estimate,
 *   Jacobians by finite differences, dense output by cubic Hermite interpolation, at a looser
 *   rtol (1e−8). `stiff` reports whether that happened.
 */

export interface OdeSystem {
  dim: number
  rhs(x: number, y: Float64Array, dy: Float64Array): void
  /** Relative scale of component i against component 0 (default 1). */
  scale?(i: number): number
}

export interface OdeOptions {
  rtol?: number
  /** Steps per extension before switching to the stiff method (default 20000). */
  maxSteps?: number
}

export interface OdeSolution {
  /** Whether x lies inside the range solved so far. */
  covers(x: number): boolean
  /** Solves up to x (either side of x0). Afterwards `at(x)` is defined unless it failed. */
  extendTo(x: number): void
  /** The state at x (NaN if the solution couldn't reach x). */
  at(x: number, out: Float64Array): void
  /** A direction switched to the stiff solver. */
  readonly stiff: boolean
}

// Dormand–Prince 5(4) tableau.
const C2 = 1 / 5
const C3 = 3 / 10
const C4 = 4 / 5
const C5 = 8 / 9
const A21 = 1 / 5
const A31 = 3 / 40
const A32 = 9 / 40
const A41 = 44 / 45
const A42 = -56 / 15
const A43 = 32 / 9
const A51 = 19372 / 6561
const A52 = -25360 / 2187
const A53 = 64448 / 6561
const A54 = -212 / 729
const A61 = 9017 / 3168
const A62 = -355 / 33
const A63 = 46732 / 5247
const A64 = 49 / 176
const A65 = -5103 / 18656
const A71 = 35 / 384
const A73 = 500 / 1113
const A74 = 125 / 192
const A75 = -2187 / 6784
const A76 = 11 / 84
const E1 = 71 / 57600
const E3 = -71 / 16695
const E4 = 71 / 1920
const E5 = -17253 / 339200
const E6 = 22 / 525
const E7 = -1 / 40
// Dense output (DOPRI5's contd5).
const D1 = -12715105075 / 11282082432
const D3 = 87487479700 / 32700410799
const D4 = -10690763975 / 1880347072
const D5 = 701980252875 / 199316789632
const D6 = -1453857185 / 822651844
const D7 = 69997945 / 29380423

/** One accepted step: from x to x + h, with the interpolation coefficients. */
interface Step {
  x: number
  h: number
  /** 'dp': rcont1..5 (5·dim); 'h': y0, y1, f0, f1 (4·dim). */
  kind: 'dp' | 'h'
  c: Float64Array
}

class Branch {
  readonly steps: Step[] = []
  x: number
  y: Float64Array
  f: Float64Array
  h = 0
  stiff = false
  failed = false
  private readonly ref: Float64Array
  private readonly n: number
  private readonly sys: OdeSystem
  private readonly dir: 1 | -1
  private readonly rtol: number
  private readonly maxSteps: number
  // Work arrays.
  private readonly k: Float64Array[]
  private readonly tmp: Float64Array
  private readonly yn: Float64Array

  constructor(sys: OdeSystem, x0: number, y0: Float64Array, dir: 1 | -1, opts: OdeOptions) {
    this.sys = sys
    this.n = sys.dim
    this.dir = dir
    this.rtol = opts.rtol ?? 1e-12
    this.maxSteps = opts.maxSteps ?? 20000
    this.x = x0
    this.y = Float64Array.from(y0)
    this.f = new Float64Array(this.n)
    sys.rhs(x0, this.y, this.f)
    this.ref = new Float64Array(this.n)
    this.k = Array.from({ length: 7 }, () => new Float64Array(this.n))
    this.tmp = new Float64Array(this.n)
    this.yn = new Float64Array(this.n)
    this.updateRef(this.y)
  }

  private scaleOf(i: number): number {
    return i === 0 ? 1 : (this.sys.scale?.(i) ?? 1)
  }

  private updateRef(y: Float64Array): void {
    const y0 = Math.abs(y[0]!)
    for (let i = 0; i < this.n; i++) {
      const v = Math.max(Math.abs(y[i]!), y0 * this.scaleOf(i))
      if (v > this.ref[i]!) this.ref[i] = v
    }
  }

  private errNorm(e: Float64Array, y: Float64Array, yn: Float64Array, rtol: number): number {
    let s = 0
    for (let i = 0; i < this.n; i++) {
      const r = Math.max(this.ref[i]!, Math.abs(yn[i]!), Math.abs(yn[0]!) * this.scaleOf(i))
      const sc = rtol * (Math.max(Math.abs(y[i]!), Math.abs(yn[i]!)) + r) + 1e-300
      s += (e[i]! / sc) ** 2
    }
    return Math.sqrt(s / this.n)
  }

  /** Hairer's starting step (Solving ODEs I, §II.4). */
  private initialStep(target: number): number {
    const { n, y, f } = this
    let d0 = 0
    let d1 = 0
    for (let i = 0; i < n; i++) {
      const sc = this.rtol * (Math.abs(y[i]!) + this.ref[i]!) + 1e-300
      d0 += (y[i]! / sc) ** 2
      d1 += (f[i]! / sc) ** 2
    }
    d0 = Math.sqrt(d0 / n)
    d1 = Math.sqrt(d1 / n)
    let h0 = d0 < 1e-5 || d1 < 1e-5 ? 1e-6 : (0.01 * d0) / d1
    h0 = Math.min(h0, Math.abs(target - this.x))
    const y1 = this.tmp
    for (let i = 0; i < n; i++) y1[i] = y[i]! + this.dir * h0 * f[i]!
    const f1 = this.k[1]!
    this.sys.rhs(this.x + this.dir * h0, y1, f1)
    let d2 = 0
    for (let i = 0; i < n; i++) {
      const sc = this.rtol * (Math.abs(y[i]!) + this.ref[i]!) + 1e-300
      d2 += ((f1[i]! - f[i]!) / sc) ** 2
    }
    d2 = Math.sqrt(d2 / n) / h0
    const h1 =
      Math.max(d1, d2) <= 1e-15 ? Math.max(1e-6, h0 * 1e-3) : (0.01 / Math.max(d1, d2)) ** 0.2
    return Math.min(100 * h0, h1)
  }

  /** Integrates until this branch reaches `target` (beyond x0 in this branch's direction). */
  extendTo(target: number): void {
    if (this.failed || (target - this.x) * this.dir <= 0) return
    if (!this.stiff) {
      this.dopri(target)
      if (this.failed || (target - this.x) * this.dir <= 0) return
      this.stiff = true
      this.h = 0
    }
    this.rosenbrock(target)
  }

  private dopri(target: number): void {
    const { n, sys, k, dir } = this
    const [k1, k2, k3, k4, k5, k6, k7] = k as [
      Float64Array,
      Float64Array,
      Float64Array,
      Float64Array,
      Float64Array,
      Float64Array,
      Float64Array,
    ]
    const tmp = this.tmp
    const yn = this.yn
    const err = new Float64Array(n)
    let h = this.h > 0 ? this.h : this.initialStep(target)
    let rejectedLast = false
    for (let count = 0; count < this.maxSteps; count++) {
      const remaining = (target - this.x) * dir
      if (remaining <= 0) return
      let last = false
      if (h >= remaining) {
        h = remaining
        last = true
      }
      if (h <= Math.abs(this.x) * 1e-14 || h === 0) return // step underflow: go stiff
      const s = dir * h
      const x = this.x
      const y = this.y
      k1.set(this.f)
      for (let i = 0; i < n; i++) tmp[i] = y[i]! + s * A21 * k1[i]!
      sys.rhs(x + C2 * s, tmp, k2)
      for (let i = 0; i < n; i++) tmp[i] = y[i]! + s * (A31 * k1[i]! + A32 * k2[i]!)
      sys.rhs(x + C3 * s, tmp, k3)
      for (let i = 0; i < n; i++) tmp[i] = y[i]! + s * (A41 * k1[i]! + A42 * k2[i]! + A43 * k3[i]!)
      sys.rhs(x + C4 * s, tmp, k4)
      for (let i = 0; i < n; i++)
        tmp[i] = y[i]! + s * (A51 * k1[i]! + A52 * k2[i]! + A53 * k3[i]! + A54 * k4[i]!)
      sys.rhs(x + C5 * s, tmp, k5)
      for (let i = 0; i < n; i++)
        tmp[i] =
          y[i]! + s * (A61 * k1[i]! + A62 * k2[i]! + A63 * k3[i]! + A64 * k4[i]! + A65 * k5[i]!)
      const xn = last ? target : x + s
      sys.rhs(xn, tmp, k6)
      for (let i = 0; i < n; i++)
        yn[i] =
          y[i]! + s * (A71 * k1[i]! + A73 * k3[i]! + A74 * k4[i]! + A75 * k5[i]! + A76 * k6[i]!)
      sys.rhs(xn, yn, k7)
      for (let i = 0; i < n; i++)
        err[i] =
          s * (E1 * k1[i]! + E3 * k3[i]! + E4 * k4[i]! + E5 * k5[i]! + E6 * k6[i]! + E7 * k7[i]!)
      let e = this.errNorm(err, y, yn, this.rtol)
      if (!Number.isFinite(e)) e = 1e10
      if (e <= 1) {
        // Accept: store the dense-output coefficients.
        const c = new Float64Array(5 * n)
        for (let i = 0; i < n; i++) {
          const ydiff = yn[i]! - y[i]!
          const bspl = s * k1[i]! - ydiff
          c[i] = y[i]!
          c[n + i] = ydiff
          c[2 * n + i] = bspl
          c[3 * n + i] = ydiff - s * k7[i]! - bspl
          c[4 * n + i] =
            s * (D1 * k1[i]! + D3 * k3[i]! + D4 * k4[i]! + D5 * k5[i]! + D6 * k6[i]! + D7 * k7[i]!)
        }
        this.steps.push({ x, h: xn - x, kind: 'dp', c })
        this.x = xn
        this.y.set(yn)
        this.f.set(k7)
        this.updateRef(yn)
        const fac = Math.min(5, Math.max(0.2, 0.9 * e ** -0.2))
        h = rejectedLast ? Math.min(h, h * fac) : h * fac
        this.h = h
        rejectedLast = false
        if (last) return
      } else {
        h *= Math.max(0.2, 0.9 * e ** -0.2)
        rejectedLast = true
      }
    }
  }

  /** ode23s (Shampine & Reichelt 1997) with finite-difference Jacobians. */
  private rosenbrock(target: number): void {
    const { n, sys, dir } = this
    const rtol = Math.max(this.rtol, 1e-8)
    const d = 1 / (2 + Math.SQRT2)
    const e32 = 6 + Math.SQRT2
    const J = new Float64Array(n * n)
    const T = new Float64Array(n)
    const W = new Float64Array(n * n)
    const piv = new Int32Array(n)
    const F0 = new Float64Array(n)
    const F1 = new Float64Array(n)
    const F2 = new Float64Array(n)
    const k1 = new Float64Array(n)
    const k2 = new Float64Array(n)
    const k3 = new Float64Array(n)
    const tmp = new Float64Array(n)
    const yn = new Float64Array(n)
    const err = new Float64Array(n)
    const fp = new Float64Array(n)
    let h = this.h > 0 ? this.h : Math.max(Math.abs(target - this.x) * 1e-6, 1e-10)
    for (let count = 0; count < 1_000_000; count++) {
      const remaining = (target - this.x) * dir
      if (remaining <= 0) return
      let last = false
      if (h >= remaining) {
        h = remaining
        last = true
      }
      if (h <= Math.abs(this.x) * 1e-15 || h === 0) {
        this.failed = true
        return
      }
      const s = dir * h
      const x = this.x
      const y = this.y
      F0.set(this.f)
      // Jacobian and ∂f/∂x by forward differences.
      for (let j = 0; j < n; j++) {
        const dy = Math.sqrt(Number.EPSILON) * Math.max(Math.abs(y[j]!), 1e-8 + this.ref[j]!)
        tmp.set(y)
        tmp[j] = y[j]! + dy
        sys.rhs(x, tmp, fp)
        for (let i = 0; i < n; i++) J[i * n + j] = (fp[i]! - F0[i]!) / dy
      }
      const dx = Math.sqrt(Number.EPSILON) * Math.max(Math.abs(x), Math.abs(s))
      sys.rhs(x + dx, y, fp)
      for (let i = 0; i < n; i++) T[i] = (fp[i]! - F0[i]!) / dx
      for (let i = 0; i < n * n; i++) W[i] = -s * d * J[i]!
      for (let i = 0; i < n; i++) W[i * n + i] = W[i * n + i]! + 1
      if (!luFactor(W, n, piv)) {
        h /= 2
        continue
      }
      for (let i = 0; i < n; i++) k1[i] = F0[i]! + s * d * T[i]!
      luSolve(W, n, piv, k1)
      for (let i = 0; i < n; i++) tmp[i] = y[i]! + 0.5 * s * k1[i]!
      sys.rhs(x + 0.5 * s, tmp, F1)
      for (let i = 0; i < n; i++) k2[i] = F1[i]! - k1[i]!
      luSolve(W, n, piv, k2)
      for (let i = 0; i < n; i++) {
        k2[i] = k2[i]! + k1[i]!
        yn[i] = y[i]! + s * k2[i]!
      }
      const xn = last ? target : x + s
      sys.rhs(xn, yn, F2)
      for (let i = 0; i < n; i++)
        k3[i] = F2[i]! - e32 * (k2[i]! - F1[i]!) - 2 * (k1[i]! - F0[i]!) + s * d * T[i]!
      luSolve(W, n, piv, k3)
      for (let i = 0; i < n; i++) err[i] = (s / 6) * (k1[i]! - 2 * k2[i]! + k3[i]!)
      let e = this.errNorm(err, y, yn, rtol)
      if (!Number.isFinite(e)) e = 1e10
      if (e <= 1) {
        const c = new Float64Array(4 * n)
        c.set(y, 0)
        c.set(yn, n)
        c.set(F0, 2 * n)
        c.set(F2, 3 * n)
        this.steps.push({ x, h: xn - x, kind: 'h', c })
        this.x = xn
        this.y.set(yn)
        this.f.set(F2)
        this.updateRef(yn)
        h *= Math.min(5, Math.max(0.2, 0.8 * e ** (-1 / 3)))
        this.h = h
        if (last) return
      } else {
        h *= Math.max(0.1, 0.8 * e ** (-1 / 3))
      }
    }
  }
}

function luFactor(A: Float64Array, n: number, piv: Int32Array): boolean {
  for (let k = 0; k < n; k++) {
    let p = k
    for (let i = k + 1; i < n; i++) if (Math.abs(A[i * n + k]!) > Math.abs(A[p * n + k]!)) p = i
    piv[k] = p
    if (A[p * n + k] === 0 || !Number.isFinite(A[p * n + k]!)) return false
    if (p !== k)
      for (let j = 0; j < n; j++) {
        const t = A[k * n + j]!
        A[k * n + j] = A[p * n + j]!
        A[p * n + j] = t
      }
    for (let i = k + 1; i < n; i++) {
      const m = A[i * n + k]! / A[k * n + k]!
      A[i * n + k] = m
      for (let j = k + 1; j < n; j++) A[i * n + j] = A[i * n + j]! - m * A[k * n + j]!
    }
  }
  return true
}

function luSolve(A: Float64Array, n: number, piv: Int32Array, b: Float64Array): void {
  for (let k = 0; k < n; k++) {
    const p = piv[k]!
    if (p !== k) {
      const t = b[k]!
      b[k] = b[p]!
      b[p] = t
    }
    for (let i = k + 1; i < n; i++) b[i] = b[i]! - A[i * n + k]! * b[k]!
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!
    for (let j = i + 1; j < n; j++) s -= A[i * n + j]! * b[j]!
    b[i] = s / A[i * n + i]!
  }
}

function interpolate(st: Step, x: number, n: number, out: Float64Array): void {
  const th = (x - st.x) / st.h
  const c = st.c
  if (st.kind === 'dp') {
    const th1 = 1 - th
    for (let i = 0; i < n; i++)
      out[i] =
        c[i]! +
        th * (c[n + i]! + th1 * (c[2 * n + i]! + th * (c[3 * n + i]! + th1 * c[4 * n + i]!)))
    return
  }
  // Cubic Hermite on y0, y1, f0, f1.
  const h = st.h
  const h00 = (1 + 2 * th) * (1 - th) ** 2
  const h10 = th * (1 - th) ** 2
  const h01 = th * th * (3 - 2 * th)
  const h11 = th * th * (th - 1)
  for (let i = 0; i < n; i++)
    out[i] = h00 * c[i]! + h10 * h * c[2 * n + i]! + h01 * c[n + i]! + h11 * h * c[3 * n + i]!
}

/** Solves y′ = f(x, y), y(x0) = y0, lazily on both sides of x0. */
export function solveOde(
  sys: OdeSystem,
  x0: number,
  y0: ArrayLike<number>,
  opts: OdeOptions = {},
): OdeSolution {
  const n = sys.dim
  const start = Float64Array.from(y0)
  const valid = Number.isFinite(x0) && start.every(Number.isFinite)
  let fwd: Branch | null = null
  let bwd: Branch | null = null
  const branch = (dir: 1 | -1): Branch => {
    if (dir > 0) {
      fwd ??= new Branch(sys, x0, start, 1, opts)
      return fwd
    }
    bwd ??= new Branch(sys, x0, start, -1, opts)
    return bwd
  }
  return {
    get stiff() {
      return (fwd?.stiff ?? false) || (bwd?.stiff ?? false)
    },
    covers(x) {
      if (x === x0) return true
      const b = x > x0 ? fwd : bwd
      return b !== null && (x - b.x) * (x > x0 ? 1 : -1) <= 0
    },
    extendTo(x) {
      if (!valid || x === x0 || !Number.isFinite(x)) return
      branch(x > x0 ? 1 : -1).extendTo(x)
    },
    at(x, out) {
      if (!valid || !Number.isFinite(x)) {
        out.fill(Number.NaN)
        return
      }
      if (x === x0) {
        out.set(start)
        return
      }
      const dir = x > x0 ? 1 : -1
      const b = dir > 0 ? fwd : bwd
      if (!b || (x - b.x) * dir > 0) {
        out.fill(Number.NaN)
        return
      }
      // Binary search for the step containing x.
      const steps = b.steps
      let lo = 0
      let hi = steps.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const end = steps[mid]!.x + steps[mid]!.h
        if ((x - end) * dir > 0) lo = mid + 1
        else hi = mid
      }
      interpolate(steps[lo]!, x, n, out)
    },
  }
}
