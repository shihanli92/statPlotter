import { tQuantile, tSf } from '../dist/t.ts'
import { refinedMean, sum } from '../summation.ts'

/**
 * Deming (model II) regression: a straight line when both X and Y are measured with error, the
 * ratio of the error variances being known. With λ = SD_X² / SD_Y² (Prism's λ: "enter the square
 * root of λ as the SD of the X values and 1.0 as the SD of the Y error") and δ = 1/λ, the
 * maximum-likelihood slope (Deming 1943; Linnet 1990) is
 *
 *   b = [S_yy − δS_xx + √((S_yy − δS_xx)² + 4δS_xy²)] / (2S_xy),
 *
 * with centred sums of squares and products; the intercept is ȳ − b·x̄. λ = 1 is orthogonal
 * regression (perpendicular distances). The root is computed without cancellation: when
 * D = S_yy − δS_xx < 0, b = 2δS_xy / (√(D² + 4δS_xy²) − D).
 *
 * Standard errors follow GraphPad's FAQ 1690 ("How Prism computes the SE and CI of the slope and
 * intercept in Deming regression"), with r = S_xy² / (S_xx S_yy):
 *   SE(slope) = √(b²(1 − r) / (r(n − 2))),  SE(intercept) = SE(slope)·√(Σxᵢ² / n),
 * CIs ± t(n − 2)·SE (1 − r is formed as the ordinary-regression residual SS over S_yy, which
 * is exact algebra and keeps its digits as r → 1). The SE of Y at X = x₀ is that of the intercept after shifting X by x₀
 * (FAQ 2230, Prism ≥ 9.4.1): SE(slope)·√(Σ(xᵢ − x₀)² / n). The test of slope = 0 is
 * t = b / SE(slope) on n − 2 df (algebraically the t test of the correlation).
 */
export interface DemingOptions {
  /** λ = SD_X² / SD_Y² (default 1: equal errors, orthogonal regression). */
  lambda?: number
  /** Default 0.95. */
  confLevel?: number
  /** X at which Y is reported with its SE and CI (default 0: the intercept). */
  xForY?: number
}

export interface DemingFit {
  n: number
  df: number
  lambda: number
  slope: number
  intercept: number
  slopeSE: number
  interceptSE: number
  slopeLo: number
  slopeHi: number
  interceptLo: number
  interceptHi: number
  /** −intercept / slope. */
  xIntercept: number
  inverseSlope: number
  /** t = slope / SE(slope) for H₀: slope = 0, df n − 2; F = t². */
  t: number
  F: number
  p: number
  /** Y of the line at `xForY`, its SE and CI. */
  yAtX: { x: number; y: number; se: number; lo: number; hi: number }
  confLevel: number
}

const NaN_ = Number.NaN

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const t = new Float64Array(a.length)
  for (let i = 0; i < a.length; i++) t[i] = a[i]! * b[i]!
  return sum(t)
}

export function demingRegression(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: DemingOptions = {},
): DemingFit {
  const n = x.length
  if (y.length !== n) throw new RangeError('demingRegression: x and y differ in length')
  const lambda = opts.lambda ?? 1
  if (!(lambda > 0 && Number.isFinite(lambda)))
    throw new RangeError(`demingRegression: λ must be positive, got ${lambda}`)
  const confLevel = opts.confLevel ?? 0.95
  const x0 = opts.xForY ?? 0
  const mx = refinedMean(x)
  const my = refinedMean(y)
  const dx = new Float64Array(n)
  const dy = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    dx[i] = x[i]! - mx
    dy[i] = y[i]! - my
  }
  const sxx = dot(dx, dx)
  const syy = dot(dy, dy)
  const sxy = dot(dx, dy)
  const delta = 1 / lambda
  const D = syy - delta * sxx
  const Q = Math.sqrt(D * D + 4 * delta * sxy * sxy)
  const slope = D >= 0 ? (D + Q) / (2 * sxy) : (2 * delta * sxy) / (Q - D)
  const intercept = my - slope * mx
  const df = n - 2
  const r = (sxy * sxy) / (sxx * syy)
  // 1 − r = SS_res(ordinary regression) / S_yy, formed from residuals (no cancellation as r → 1).
  const bOls = sxy / sxx
  const res = new Float64Array(n)
  for (let i = 0; i < n; i++) res[i] = dy[i]! - bOls * dx[i]!
  const oneMinusR = dot(res, res) / syy
  const slopeSE = df > 0 ? Math.sqrt((slope * slope * oneMinusR) / (r * df)) : NaN_
  // Σ(xᵢ − c)² = S_xx + n(x̄ − c)².
  const seAt = (c: number) => slopeSE * Math.sqrt((sxx + n * (mx - c) * (mx - c)) / n)
  const interceptSE = seAt(0)
  const tc = df > 0 ? tQuantile(1 - (1 - confLevel) / 2, df) : NaN_
  const t = slope / slopeSE
  const yx = intercept + slope * x0
  const seY = seAt(x0)
  return {
    n,
    df,
    lambda,
    slope,
    intercept,
    slopeSE,
    interceptSE,
    slopeLo: slope - tc * slopeSE,
    slopeHi: slope + tc * slopeSE,
    interceptLo: intercept - tc * interceptSE,
    interceptHi: intercept + tc * interceptSE,
    xIntercept: -intercept / slope,
    inverseSlope: 1 / slope,
    t,
    F: t * t,
    p: df > 0 ? 2 * tSf(Math.abs(t), df) : NaN_,
    yAtX: { x: x0, y: yx, se: seY, lo: yx - tc * seY, hi: yx + tc * seY },
    confLevel,
  }
}
