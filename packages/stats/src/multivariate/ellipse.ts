import { covTrob } from '../gpl/covTrob.ts'
import { sum } from '../summation.ts'

/**
 * Bivariate confidence ellipses and convex hulls of a group of points (roadmap 34c: the graph
 * layers' ellipses and hulls). Every number is checked against R (suite `ellipse`,
 * tools/oracle/r/ellipse.R).
 *
 * Ellipse types, each a centre, a shape (2 × 2 covariance) and a radius; the outline is
 * centre + radius · (cos θ, sin θ) · chol(shape) for θ = 2πk / segments, k = 0…segments, the
 * construction of ggplot2's `stat_ellipse` (`calculate_ellipse`) and `car::ellipse`:
 *
 * - `norm`: the normal-theory data ellipse — centre the mean, shape the sample covariance
 *   (divisor n − 1), radius √(2 F(level; 2, n − 1)): ggplot2 `stat_ellipse(type = "norm")`,
 *   `car::dataEllipse(x, y, levels = level)`.
 * - `t`: the same with the multivariate t robust estimate of centre and scatter
 *   (`MASS::cov.trob`, ν = 5, at most 25 iterations, tolerance 0.01 on the weights, its
 *   defaults): ggplot2's default `stat_ellipse(type = "t")`.
 * - `mean`: the confidence region of the mean (Hotelling's T²): centre the mean, shape the
 *   covariance / n, radius √(2(n − 1)/(n − 2) · F(level; 2, n − 2)) — the points μ with
 *   n (x̄ − μ)ᵀ S⁻¹ (x̄ − μ) ≤ 2(n − 1)/(n − 2) F(level; 2, n − 2) (Johnson & Wichern,
 *   Applied Multivariate Statistical Analysis, 6th ed., eq. 5-18). In R:
 *   `car::ellipse(colMeans(X), cov(X) / n, sqrt(2 * (n - 1) / (n - 2) * qf(level, 2, n - 2)))`.
 *
 * Fewer than three points, or points with no spread in some direction (all on a line, or one
 * value repeated), have no ellipse: the result says why instead.
 */

export type EllipseType = 'norm' | 'mean' | 't'

export interface EllipseFit {
  center: [number, number]
  /** The shape matrix [sxx, sxy, syy] (`t`: cov.trob's scatter; `mean`: covariance / n). */
  shape: [number, number, number]
  radius: number
  n: number
  /** `t`: cov.trob's iterations (`iter`) and whether its weights settled. */
  iterations?: number
  converged?: boolean
}

export type EllipseResult = { ok: true; fit: EllipseFit } | { ok: false; reason: string }

/** Default number of segments of an ellipse's outline (ggplot2's 51; graphs draw more). */
const ELLIPSE_SEGMENTS = 51

/**
 * The F(2, d) quantile in closed form: P(F ≤ x) = 1 − (1 + 2x/d)^(−d/2), so
 * x = d/2 · ((1 − p)^(−2/d) − 1) (what R's `qf(p, 2, d)` returns).
 */
export function fQuantile2(p: number, d: number): number {
  if (!(p >= 0 && p < 1) || !(d > 0)) return p === 1 ? Number.POSITIVE_INFINITY : Number.NaN
  return (d / 2) * Math.expm1((-2 / d) * Math.log1p(-p))
}

/** Means and the sample covariance (n − 1) of paired values. */
function moments(x: ArrayLike<number>, y: ArrayLike<number>) {
  const n = x.length
  const mx = sum(x) / n
  const my = sum(y) / n
  const dx = new Float64Array(n)
  const dy = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    dx[i] = x[i]! - mx
    dy[i] = y[i]! - my
  }
  // Refined means (a second pass of the residuals), then the cross-products.
  const cx = mx + sum(dx) / n
  const cy = my + sum(dy) / n
  const xx = new Float64Array(n)
  const xy = new Float64Array(n)
  const yy = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = x[i]! - cx
    const b = y[i]! - cy
    xx[i] = a * a
    xy[i] = a * b
    yy[i] = b * b
  }
  const d = n - 1
  return {
    center: [cx, cy] as [number, number],
    shape: [sum(xx) / d, sum(xy) / d, sum(yy) / d] as [number, number, number],
  }
}

/** Why a shape has no ellipse (no spread in some direction), or null. */
function flat(s: readonly [number, number, number]): string | null {
  const [a, b, c] = s
  if (![a, b, c].every(Number.isFinite)) return 'the points have no finite spread'
  if (!(a > 0) || !(c > 0)) return 'every point has the same X or the same Y value'
  // Relative determinant: 1 − r² (r the correlation) too small to invert.
  if (a * c - b * b <= 1e-12 * a * c) return 'the points lie on a line'
  return null
}

// `covTrob` is translated from MASS's R code: in gpl/ (audit 2); re-exported here.
export { type CovTrobOptions, covTrob } from '../gpl/covTrob.ts'

/**
 * The ellipse of a group of points at a level (0–1). Values must be finite (the caller leaves out
 * incomplete rows).
 */
export function confidenceEllipse(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  type: EllipseType,
  level = 0.95,
): EllipseResult {
  const n = Math.min(x.length, y.length)
  if (n < 3)
    return { ok: false, reason: `${n === 1 ? 'one point' : `${n} points`}: needs 3 or more` }
  if (!(level > 0 && level < 1)) return { ok: false, reason: 'the level must be between 0 and 1' }
  const m = moments(x, y)
  const why = flat(m.shape)
  if (why) return { ok: false, reason: why }
  if (type === 'norm')
    return {
      ok: true,
      fit: { center: m.center, shape: m.shape, radius: Math.sqrt(2 * fQuantile2(level, n - 1)), n },
    }
  if (type === 'mean') {
    const [a, b, c] = m.shape
    return {
      ok: true,
      fit: {
        center: m.center,
        shape: [a / n, b / n, c / n],
        radius: Math.sqrt(((2 * (n - 1)) / (n - 2)) * fQuantile2(level, n - 2)),
        n,
      },
    }
  }
  const t = covTrob(x, y)
  const tw = flat(t.cov)
  if (tw || !t.center.every(Number.isFinite)) return { ok: false, reason: tw ?? 'no robust fit' }
  return {
    ok: true,
    fit: {
      center: t.center,
      shape: t.cov,
      radius: Math.sqrt(2 * fQuantile2(level, n - 1)),
      n,
      iterations: t.iter,
      converged: t.converged,
    },
  }
}

/**
 * An ellipse's outline: segments + 1 points (the last equal to the first), centre + radius ·
 * (cos θ, sin θ) · R with R the upper Cholesky factor of the shape (ggplot2's construction).
 */
export function ellipseOutline(
  fit: Pick<EllipseFit, 'center' | 'shape' | 'radius'>,
  segments = ELLIPSE_SEGMENTS,
): [number, number][] {
  const [s11, s12, s22] = fit.shape
  const r11 = Math.sqrt(s11)
  const r12 = s12 / r11
  const r22 = Math.sqrt(s22 - r12 * r12)
  const [cx, cy] = fit.center
  const out: [number, number][] = []
  for (let k = 0; k <= segments; k++) {
    const a = (k * 2 * Math.PI) / segments
    const [cos, sin] = [Math.cos(a), Math.sin(a)]
    out.push([cx + fit.radius * cos * r11, cy + fit.radius * (cos * r12 + sin * r22)])
  }
  return out
}

/**
 * The convex hull's vertices as indices into the points, clockwise (y up), as R's
 * `grDevices::chull`: only the hull's corners (points along an edge are left out), the first of
 * repeated points. R does not document which corner comes first: this starts at the
 * right-most (then lowest) corner; R's order is the same cycle. Points with a missing coordinate
 * are skipped. Collinear points give the two ends; one point, itself.
 */
export function convexHull(x: ArrayLike<number>, y: ArrayLike<number>): number[] {
  const idx: number[] = []
  for (let i = 0; i < Math.min(x.length, y.length); i++)
    if (Number.isFinite(x[i]!) && Number.isFinite(y[i]!)) idx.push(i)
  // Repeated points: the first only.
  idx.sort((a, b) => x[a]! - x[b]! || y[a]! - y[b]! || a - b)
  const pts = idx.filter((v, k) => k === 0 || x[v] !== x[idx[k - 1]!] || y[v] !== y[idx[k - 1]!])
  if (pts.length < 3) return pts.length === 2 ? [pts[1]!, pts[0]!] : pts
  // Andrew's monotone chain, counter-clockwise, corners only.
  const lower: number[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(x, y, lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: number[] = []
  for (let k = pts.length - 1; k >= 0; k--) {
    const p = pts[k]!
    while (upper.length >= 2 && cross(x, y, upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop()
    upper.push(p)
  }
  const ccw = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  if (ccw.length < 3) return [pts.at(-1)!, pts[0]!]
  // Clockwise from the right-most (then lowest) corner.
  const cw = ccw.reverse()
  let start = 0
  for (let k = 0; k < cw.length; k++) {
    const v = cw[k]!
    const s = cw[start]!
    if (x[v]! > x[s]! || (x[v] === x[s] && y[v]! < y[s]!)) start = k
  }
  return [...cw.slice(start), ...cw.slice(0, start)]
}

/** The cross product (a − o) × (b − o) of points o, a, b (indices): > 0 turning left. */
function cross(x: ArrayLike<number>, y: ArrayLike<number>, o: number, a: number, b: number) {
  return (x[a]! - x[o]!) * (y[b]! - y[o]!) - (y[a]! - y[o]!) * (x[b]! - x[o]!)
}
