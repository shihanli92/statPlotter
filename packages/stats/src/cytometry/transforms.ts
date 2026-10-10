// Cytometry display transforms (roadmap 34g): arcsinh with a cofactor (CyTOF, flow) and the
// logicle (biexponential) scale.
//
// Logicle: D. R. Parks, M. Roederer and W. A. Moore, "A new 'Logicle' display method avoids
// deceptive effects of logarithmic scaling for low signals and compensated data", Cytometry A 69A
// (2006) 541–551; the operational algorithm of W. A. Moore and D. R. Parks, "Update for the logicle
// data scale including operational code implementations", Cytometry A 81A (2012) 273–277, as
// flowCore's `logicleTransform()` uses it, with its parameters T (top of scale data value), W
// (decades of linearisation), M (decades of the full display) and A (extra negative decades) and its
// output in [0, M] (the scale's 0–1 times M). It follows the steps of Moore and Parks' reference
// implementation, published with that paper and distributed in Bioconductor's flowCore (its C++
// `Logicle` class) under the Artistic License 2.0 (not the GPL, so this file is not in `gpl/`;
// the About box credits it): the biexponential
// S(x) = a·e^{bx} − c·e^{−dx} + f with the logicle condition, d solved from
// 2(ln d − ln b) + w(b + d) = 0 by safeguarded Newton (bisection when Newton leaves the bracket,
// "RTSAFE"), a Taylor series of 16 terms near data zero, and the data → scale direction solved by
// Halley's method to full double precision. Checked against flowCore in oracle suite `cytometry`.

/** Logicle parameters as flowCore names them (`logicleTransform(w, t, m, a)`). */
export interface LogicleParams {
  /** Top of scale data value (flowCore t; default 262144). */
  T: number
  /** Decades of linearisation near zero (flowCore w; default 0.5). */
  W: number
  /** Decades of the full display (flowCore m; default 4.5). */
  M: number
  /** Extra negative decades (flowCore a; default 0). */
  A: number
}

/** flowCore's defaults. */
export const LOGICLE_DEFAULTS: Readonly<LogicleParams> = { T: 262144, W: 0.5, M: 4.5, A: 0 }

const LN_10 = Math.log(10)
const EPS = Number.EPSILON
const TAYLOR_LENGTH = 16

/** Why parameters can't make a logicle scale; null when they can. */
export function logicleProblem(p: LogicleParams): string | null {
  const { T, W, M, A } = p
  if (!(T > 0) || !Number.isFinite(T)) return 'T must be positive'
  if (!(W >= 0) || !Number.isFinite(W)) return 'W must not be negative'
  if (!(M > 0) || !Number.isFinite(M)) return 'M must be positive'
  if (2 * W > M) return 'W must be at most M / 2'
  if (-A > W || A + W > M - W || !Number.isFinite(A)) return 'A must be between −W and M − 2W'
  return null
}

/** The logicle scale of a set of parameters: data → display (0–M) and back. */
export interface Logicle {
  params: LogicleParams
  /** A data value's place on the display, in [0, M] for data in the scale's range. */
  scale(value: number): number
  /** The data value at a place on the display (the biexponential). */
  inverse(scale: number): number
  /** The display place of data zero (W / (M + A) · M). */
  zero: number
}

/**
 * Solves 2(ln d − ln b) + w(b + d) = 0 for d in (0, b] (w = 0: d = b, the arcsinh case), by
 * Newton's method kept inside the bracket (bisection otherwise), to the precision of b.
 */
function solveD(b: number, w: number): number {
  if (w === 0) return b
  const tolerance = 2 * b * EPS
  let lo = 0
  let hi = b
  let d = (lo + hi) / 2
  let delta: number
  const fb = -2 * Math.log(b) + w * b
  let f = 2 * Math.log(d) + w * d + fb
  let lastF = Number.NaN
  let lastDelta = hi - lo
  for (let i = 1; i < 20; i++) {
    const df = 2 / d + w
    if (
      ((d - hi) * df - f) * ((d - lo) * df - f) >= 0 ||
      Math.abs(1.9 * f) > Math.abs(lastDelta * df)
    ) {
      // Bisection: Newton would leave the bracket, or isn't converging fast enough.
      delta = (hi - lo) / 2
      d = lo + delta
      if (d === lo) return d
    } else {
      delta = f / df
      const t = d
      d -= delta
      if (d === t) return d
    }
    if (Math.abs(delta) < tolerance) return d
    lastDelta = delta
    f = 2 * Math.log(d) + w * d + fb
    if (f === 0 || f === lastF) return d
    lastF = f
    if (f < 0) lo = d
    else hi = d
  }
  throw new Error('logicle: the parameters did not converge')
}

/** A logicle scale (see the module comment); throws for parameters that make none. */
export function logicle(params: LogicleParams): Logicle {
  const problem = logicleProblem(params)
  if (problem) throw new Error(`logicle: ${problem}`)
  const { T, W, M, A } = params
  const w = W / (M + A)
  const x2 = A / (M + A)
  const x1 = x2 + w
  const x0 = x2 + 2 * w
  const b = (M + A) * LN_10
  const d = solveD(b, w)
  const cA = Math.exp(x0 * (b + d))
  const mfA = Math.exp(b * x1) - cA / Math.exp(d * x1)
  const a = T / (Math.exp(b) - mfA - cA / Math.exp(d))
  const c = cA * a
  const f = -mfA * a
  // A Taylor series near x1 (data zero) avoids the round-off of the formal definition there.
  const xTaylor = x1 + w / 4
  let posCoef = a * Math.exp(b * x1)
  let negCoef = -c / Math.exp(d * x1)
  const taylor = new Float64Array(TAYLOR_LENGTH)
  for (let i = 0; i < TAYLOR_LENGTH; i++) {
    posCoef *= b / (i + 1)
    negCoef *= -d / (i + 1)
    taylor[i] = posCoef + negCoef
  }
  taylor[1] = 0 // exactly, by the logicle condition
  const series = (s: number) => {
    const x = s - x1
    let sum = taylor[TAYLOR_LENGTH - 1]! * x
    for (let i = TAYLOR_LENGTH - 2; i >= 2; i--) sum = (sum + taylor[i]!) * x
    return (sum * x + taylor[0]!) * x
  }
  /** Data value → place on the 0–1 scale. */
  const scale01 = (value: number): number => {
    if (Number.isNaN(value)) return Number.NaN
    if (value === 0) return x1
    const negative = value < 0
    const v = negative ? -value : value
    if (v === Number.POSITIVE_INFINITY) return negative ? Number.NEGATIVE_INFINITY : value
    // Initial guess: linear in the quasi-linear region, else the ordinary logarithm.
    let x = v < f ? x1 + v / taylor[0]! : Math.log(v / a) / b
    const tolerance = x > 1 ? 3 * x * EPS : 3 * EPS
    for (let i = 0; i < 10; i++) {
      const ae2bx = a * Math.exp(b * x)
      const ce2mdx = c / Math.exp(d * x)
      const y = x < xTaylor ? series(x) - v : ae2bx + f - (ce2mdx + v)
      const abe2bx = b * ae2bx
      const cde2mdx = d * ce2mdx
      const dy = abe2bx + cde2mdx
      const ddy = b * abe2bx - d * cde2mdx
      // Halley's method (cubic convergence).
      const delta = y / (dy * (1 - (y * ddy) / (2 * dy * dy)))
      x -= delta
      if (Math.abs(delta) < tolerance) break
    }
    // Ten steps without reaching the tolerance (W = 0 and |value| near 1e-12, where flowCore
    // throws): the last estimate, correct to far better than a display needs.
    return negative ? 2 * x1 - x : x
  }
  const inverse01 = (s: number): number => {
    if (Number.isNaN(s)) return Number.NaN
    const negative = s < x1
    const t = negative ? 2 * x1 - s : s
    const v = t < xTaylor ? series(t) : a * Math.exp(b * t) + f - c / Math.exp(d * t)
    return negative ? -v : v
  }
  return {
    params: { T, W, M, A },
    scale: (value) => scale01(value) * M,
    inverse: (s) => inverse01(s / M),
    zero: x1 * M,
  }
}

/** The arcsinh transform of cytometry tools: asinh(x / cofactor). */
export const arcsinh = (x: number, cofactor: number): number => Math.asinh(x / cofactor)

/** Its inverse: cofactor · sinh(y). */
export const arcsinhInverse = (y: number, cofactor: number): number => cofactor * Math.sinh(y)
