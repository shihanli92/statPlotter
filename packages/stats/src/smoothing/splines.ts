import { leastSquares } from '../linalg/leastSquares.ts'

/**
 * Curves through or near XY data without a model (Prism's "Fit spline/LOWESS", Curve Fitting
 * Guide, "Spline and Lowess curves"): point-to-point lines, the natural cubic spline through
 * every point, the Akima spline (Akima 1970), and a least-squares cubic spline with a chosen
 * number of knots (Prism's "smoothing spline": "you decide the degree of smoothness by specifying
 * the number of knots"). Each returns an evaluator; X values must be sorted, distinct and finite
 * for the interpolating splines (callers average replicates at the same X first).
 */

export type Curve = (x: number) => number

function checkSorted(x: ArrayLike<number>, what: string): void {
  for (let i = 1; i < x.length; i++)
    if (!(x[i]! > x[i - 1]!)) throw new RangeError(`${what}: X values must be increasing`)
}

/** Index i with x[i] ≤ v < x[i+1], clamped to [0, n − 2]. */
function interval(x: ArrayLike<number>, v: number): number {
  let lo = 0
  let hi = x.length - 1
  if (v <= x[0]!) return 0
  if (v >= x[hi]!) return hi - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (x[mid]! <= v) lo = mid
    else hi = mid
  }
  return lo
}

/** Straight lines between consecutive points (constant extrapolation of the end segments). */
export function pointToPoint(x: ArrayLike<number>, y: ArrayLike<number>): Curve {
  checkSorted(x, 'pointToPoint')
  if (x.length === 1) return () => y[0]!
  const n = x.length
  return (u) => {
    const v = Math.min(Math.max(u, x[0]!), x[n - 1]!)
    const i = interval(x, v)
    const t = (v - x[i]!) / (x[i + 1]! - x[i]!)
    return y[i]! + t * (y[i + 1]! - y[i]!)
  }
}

/** Cubic Hermite evaluation on [x0, x1] with values y0, y1 and slopes m0, m1. */
function hermite(
  v: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  m0: number,
  m1: number,
): number {
  const h = x1 - x0
  const t = (v - x0) / h
  const t2 = t * t
  const t3 = t2 * t
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * h * m0 +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * h * m1
  )
}

/**
 * Natural cubic interpolating spline (second derivative 0 at both ends; R's
 * splinefun(method = "natural"), which also extrapolates linearly beyond the data).
 */
export function naturalCubicSpline(x: ArrayLike<number>, y: ArrayLike<number>): Curve {
  checkSorted(x, 'naturalCubicSpline')
  const n = x.length
  if (n < 2) return () => y[0]!
  if (n === 2) return pointToPoint(x, y)
  // Second derivatives M by the tridiagonal system (M₀ = M_{n−1} = 0).
  const h = Array.from({ length: n - 1 }, (_, i) => x[i + 1]! - x[i]!)
  const d = Array.from({ length: n - 1 }, (_, i) => (y[i + 1]! - y[i]!) / h[i]!)
  const m = n - 2
  const diag = new Float64Array(m)
  const rhs = new Float64Array(m)
  for (let i = 0; i < m; i++) {
    diag[i] = 2 * (h[i]! + h[i + 1]!)
    rhs[i] = 6 * (d[i + 1]! - d[i]!)
  }
  // Thomas algorithm (diagonally dominant).
  for (let i = 1; i < m; i++) {
    const w = h[i]! / diag[i - 1]!
    diag[i] = diag[i]! - w * h[i]!
    rhs[i] = rhs[i]! - w * rhs[i - 1]!
  }
  const M = new Float64Array(n)
  for (let i = m - 1; i >= 0; i--)
    M[i + 1] = (rhs[i]! - (i + 1 < m ? h[i + 1]! * M[i + 2]! : 0)) / diag[i]!
  const slope = (i: number, left: boolean) =>
    left
      ? d[i]! - (h[i]! * (2 * M[i]! + M[i + 1]!)) / 6
      : d[i]! + (h[i]! * (M[i]! + 2 * M[i + 1]!)) / 6
  const s0 = slope(0, true)
  const sn = slope(n - 2, false)
  return (v) => {
    if (v < x[0]!) return y[0]! + s0 * (v - x[0]!)
    if (v > x[n - 1]!) return y[n - 1]! + sn * (v - x[n - 1]!)
    const i = interval(x, v)
    const a = x[i + 1]! - v
    const b = v - x[i]!
    const hi = h[i]!
    return (
      (M[i]! * a * a * a) / (6 * hi) +
      (M[i + 1]! * b * b * b) / (6 * hi) +
      (y[i]! / hi - (M[i]! * hi) / 6) * a +
      (y[i + 1]! / hi - (M[i + 1]! * hi) / 6) * b
    )
  }
}

/**
 * Akima spline (H. Akima, "A new method of interpolation and smooth curve fitting based on local
 * procedures", J. ACM 17: 589–602, 1970): a cubic Hermite curve through every point whose slope
 * at each point is the weighted mean of the neighbouring chord slopes,
 * tᵢ = (|m₊₁ − m₊₀|·m₋₁ + |m₋₁ − m₋₂|·m₊₀) / (|m₊₁ − m₊₀| + |m₋₁ − m₋₂|), the plain mean of m₋₁ and
 * m₊₀ when both weights are 0. At the ends two chord slopes are added on each side by Akima's
 * quadratic extrapolation (m₋₁ = 2m₀ − m₁, m₋₂ = 2m₋₁ − m₀). Two points give the straight line;
 * outside the data the end cubics are continued.
 */
export function akimaSpline(x: ArrayLike<number>, y: ArrayLike<number>): Curve {
  checkSorted(x, 'akimaSpline')
  const n = x.length
  if (n < 3) return n === 2 ? pointToPoint(x, y) : () => y[0]!
  // Chord slopes with two extra on each side: s[k + 2] = m_k, k = −2 … n.
  const s = new Float64Array(n + 3)
  for (let i = 0; i < n - 1; i++) s[i + 2] = (y[i + 1]! - y[i]!) / (x[i + 1]! - x[i]!)
  s[1] = 2 * s[2]! - s[3]!
  s[0] = 2 * s[1]! - s[2]!
  s[n + 1] = 2 * s[n]! - s[n - 1]!
  s[n + 2] = 2 * s[n + 1]! - s[n]!
  const t = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const m1 = s[i]!
    const m2 = s[i + 1]!
    const m3 = s[i + 2]!
    const m4 = s[i + 3]!
    const w1 = Math.abs(m4 - m3)
    const w2 = Math.abs(m2 - m1)
    t[i] = w1 + w2 === 0 ? (m2 + m3) / 2 : (w1 * m2 + w2 * m3) / (w1 + w2)
  }
  return (v) => {
    const i = interval(x, v)
    return hermite(v, x[i]!, x[i + 1]!, y[i]!, y[i + 1]!, t[i]!, t[i + 1]!)
  }
}

/**
 * Least-squares natural cubic spline with `knots` knots (≥ 2) equally spaced from the smallest to
 * the largest X, the two ends included (Prism's "smoothing spline" with that many knots; the knot
 * placement is our reading). The space of natural cubic splines on K knots has dimension K (a
 * straight line for K = 2), spanned here by the truncated-power basis of Hastie, Tibshirani &
 * Friedman (Elements of Statistical Learning, eq. 5.4–5.5) on X scaled to [0, 1], fitted by QR.
 * Every point counts (replicates too); beyond the data the fit is linear, as a natural spline.
 */
export function regressionSpline(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  knots: number,
): { curve: Curve; ss: number; df: number } {
  const n = x.length
  if (y.length !== n) throw new RangeError('regressionSpline: x and y differ in length')
  if (!(Number.isInteger(knots) && knots >= 2))
    throw new RangeError('regressionSpline: at least 2 knots')
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, x[i]!)
    hi = Math.max(hi, x[i]!)
  }
  const span = hi - lo
  const K = knots
  const xi = Array.from({ length: K }, (_, k) => k / (K - 1))
  const pos3 = (v: number) => (v > 0 ? v * v * v : 0)
  const dk = (u: number, k: number) =>
    (pos3(u - xi[k]!) - pos3(u - xi[K - 1]!)) / (xi[K - 1]! - xi[k]!)
  const basis = (v: number, out: Float64Array) => {
    const u = (v - lo) / span
    out[0] = 1
    out[1] = u
    for (let k = 0; k < K - 2; k++) out[k + 2] = dk(u, k) - dk(u, K - 2)
  }
  const X = new Float64Array(n * K)
  const row = new Float64Array(K)
  for (let i = 0; i < n; i++) {
    basis(x[i]!, row)
    X.set(row, i * K)
  }
  const fit = leastSquares(X, n, K, y)
  const coef = fit.coef
  const curve: Curve = (v) => {
    const b = new Float64Array(K)
    basis(v, b)
    let s = 0
    for (let k = 0; k < K; k++) s += b[k]! * coef[k]!
    return s
  }
  return { curve, ss: fit.rss, df: n - K }
}
