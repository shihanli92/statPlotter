import { fSf } from '../dist/f.ts'
import { tQuantile } from '../dist/t.ts'
import { sum } from '../summation.ts'

/**
 * Simple linear regression Y = intercept + slope·X, optionally through the origin or weighted.
 *
 * Numerics: weighted means refined by a second pass, then centred sums of squares and
 * cross-products (the "corrected two-pass" scheme, Chan, Golub & LeVeque 1983) with compensated
 * summation. Residuals are formed from centred values, (y − ȳ) − b(x − x̄), so data with a large
 * offset keep their precision. This reproduces the NIST StRD Norris / NoInt certified values to
 * ≥ 12 digits.
 *
 * Inputs are finite values only (callers drop missing / excluded points).
 */

export interface LinearRegressionOptions {
  /** Force the line through (0, 0). */
  throughOrigin?: boolean
  /**
   * Force the line through (x, y) (Prism: "force the line to go through a specified point"):
   * the slope is fitted to (X − x, Y − y) through the origin; the intercept is then y − slope·x,
   * with no SE (it is fixed by the constraint). Takes precedence over throughOrigin.
   */
  throughPoint?: { x: number; y: number }
  /** Per-point weights (≥ 0), e.g. 1/SD². SS and R² are weighted, as R's lm(weights =). */
  weights?: ArrayLike<number>
  /** Default 0.95. */
  confLevel?: number
}

export interface LinearFit {
  n: number
  df: number
  slope: number
  /** 0 through the origin; y₀ − slope·x₀ through a point (x₀, y₀). */
  intercept: number
  slopeSE: number
  /** NaN when throughOrigin. */
  interceptSE: number
  slopeLo: number
  slopeHi: number
  interceptLo: number
  interceptHi: number
  /** −intercept/slope. */
  xIntercept: number
  /**
   * Fieller confidence limits of the X intercept (Draper & Smith, Applied Regression Analysis,
   * 3rd ed., §3.2). NaN when the slope is not significantly non-zero at confLevel (the Fieller
   * set is then unbounded) and when throughOrigin.
   */
  xInterceptLo: number
  xInterceptHi: number
  /** 1/slope. */
  inverseSlope: number
  /**
   * 1 − SSres/SStot with SStot about the (weighted) mean of Y — also through the origin, where it
   * can be negative (Prism's convention; R reports the uncentred Σy² version there).
   */
  r2: number
  /** √(SSres/df). */
  syx: number
  ssResidual: number
  /** F = (slope/SE)² for H₀: slope = 0, on (1, df) degrees of freedom. */
  F: number
  dfn: number
  dfd: number
  p: number
  /** [var(slope), cov(slope, intercept), var(intercept)]; the last two are 0 through the origin. */
  cov: [number, number, number]
  confLevel: number
  /** Weighted mean of X (x₀ through a point): the band's variance is smallest here. */
  meanX: number
  /** Variance of the fitted value at meanX, s²/Σw (0 through the origin). */
  varAtMeanX: number
  runsP?: never
}

const NaN_ = Number.NaN

/** Weighted mean Σwv/Σw with a refining second pass. */
function wmean(v: ArrayLike<number>, w: ArrayLike<number> | undefined, sw: number): number {
  const n = v.length
  const t = new Float64Array(n)
  for (let i = 0; i < n; i++) t[i] = w ? w[i]! * v[i]! : v[i]!
  const m = sum(t) / sw
  for (let i = 0; i < n; i++) t[i] = w ? w[i]! * (v[i]! - m) : v[i]! - m
  return m + sum(t) / sw
}

/** Σ w·a·b (w optional), compensated. */
function wdot(a: ArrayLike<number>, b: ArrayLike<number>, w?: ArrayLike<number>): number {
  const t = new Float64Array(a.length)
  for (let i = 0; i < a.length; i++) t[i] = (w ? w[i]! : 1) * a[i]! * b[i]!
  return sum(t)
}

/**
 * Fieller interval for x₀ = −a/b: the set of x with (a + bx)² ≤ t²·var(a + bx), i.e. between the
 * roots of (b² − t²V_bb)x² + 2(ab − t²V_ab)x + (a² − t²V_aa) = 0 when b² > t²V_bb.
 */
function fiellerXIntercept(
  a: number,
  b: number,
  vaa: number,
  vab: number,
  vbb: number,
  t: number,
): [number, number] {
  const t2 = t * t
  const A = b * b - t2 * vbb
  if (!(A > 0)) return [NaN_, NaN_]
  const B = a * b - t2 * vab
  const C = a * a - t2 * vaa
  const disc = B * B - A * C
  if (!(disc >= 0)) return [NaN_, NaN_]
  const sq = Math.sqrt(disc)
  // Stable roots of A x² + 2B x + C (avoid cancellation in −B ± √disc).
  const q = B >= 0 ? -(B + sq) : -(B - sq)
  const r1 = q / A
  const r2 = q !== 0 ? C / q : r1
  return r1 < r2 ? [r1, r2] : [r2, r1]
}

export function linearRegression(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: LinearRegressionOptions = {},
): LinearFit {
  const n = x.length
  if (y.length !== n) throw new RangeError('linearRegression: x and y differ in length')
  const w = opts.weights
  if (w && w.length !== n) throw new RangeError('linearRegression: weights differ in length')
  const confLevel = opts.confLevel ?? 0.95
  const point = opts.throughPoint ?? (opts.throughOrigin ? { x: 0, y: 0 } : null)
  const origin = point !== null
  const x0 = point?.x ?? 0
  const y0 = point?.y ?? 0
  const sw = w ? sum(w) : n

  let slope: number
  let intercept: number
  let sxx: number
  let meanX = 0
  let meanY: number
  const res = new Float64Array(n)
  meanY = wmean(y, w, sw)
  if (origin) {
    const sx = new Float64Array(n)
    const sy = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      sx[i] = x[i]! - x0
      sy[i] = y[i]! - y0
    }
    sxx = wdot(sx, sx, w)
    slope = wdot(sx, sy, w) / sxx
    intercept = y0 - slope * x0
    meanX = x0
    for (let i = 0; i < n; i++) res[i] = sy[i]! - slope * sx[i]!
  } else {
    meanX = wmean(x, w, sw)
    const dx = new Float64Array(n)
    const dy = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      dx[i] = x[i]! - meanX
      dy[i] = y[i]! - meanY
    }
    sxx = wdot(dx, dx, w)
    slope = wdot(dx, dy, w) / sxx
    intercept = meanY - slope * meanX
    for (let i = 0; i < n; i++) res[i] = dy[i]! - slope * dx[i]!
  }
  const ssResidual = wdot(res, res, w)
  const dy = new Float64Array(n)
  for (let i = 0; i < n; i++) dy[i] = y[i]! - meanY
  const ssTotal = wdot(dy, dy, w)
  const df = n - (origin ? 1 : 2)
  const s2 = df > 0 ? ssResidual / df : NaN_
  const varSlope = s2 / sxx
  const varAtMeanX = origin ? 0 : s2 / sw
  const covSI = origin ? 0 : -meanX * varSlope
  const varInt = origin ? 0 : varAtMeanX + meanX * meanX * varSlope
  const slopeSE = Math.sqrt(varSlope)
  const interceptSE = origin ? NaN_ : Math.sqrt(varInt)
  const t = df > 0 ? tQuantile(1 - (1 - confLevel) / 2, df) : NaN_
  const F = (slope * slope) / varSlope
  const xInt = origin ? x0 - y0 / slope : -intercept / slope
  const [xLo, xHi] = origin
    ? [NaN_, NaN_]
    : fiellerXIntercept(intercept, slope, varInt, covSI, varSlope, t)
  return {
    n,
    df,
    slope,
    intercept,
    slopeSE,
    interceptSE,
    slopeLo: slope - t * slopeSE,
    slopeHi: slope + t * slopeSE,
    interceptLo: origin ? NaN_ : intercept - t * interceptSE,
    interceptHi: origin ? NaN_ : intercept + t * interceptSE,
    xIntercept: xInt,
    xInterceptLo: xLo,
    xInterceptHi: xHi,
    inverseSlope: 1 / slope,
    r2: 1 - ssResidual / ssTotal,
    syx: Math.sqrt(s2),
    ssResidual,
    F,
    dfn: 1,
    dfd: df,
    p: df > 0 ? fSf(F, 1, df) : NaN_,
    cov: [varSlope, covSI, varInt],
    confLevel,
    meanX,
    varAtMeanX,
  }
}

export interface BandOptions {
  confLevel?: number
  /** 'confidence' (of the line, default) or 'prediction' (of a new observation). */
  kind?: 'confidence' | 'prediction'
}

export interface Band {
  y: Float64Array
  lo: Float64Array
  hi: Float64Array
}

/**
 * Confidence or prediction band of a linear fit at xs: ŷ ± t(df)·√v with
 * v = s²/Σw + (x − x̄)²·var(slope) (+ s² for prediction). For weighted fits the new observation is
 * given unit weight (as R's predict.lm does by default).
 */
export function linearBand(fit: LinearFit, xs: ArrayLike<number>, opts: BandOptions = {}): Band {
  const level = opts.confLevel ?? fit.confLevel ?? 0.95
  const t = fit.df > 0 ? tQuantile(1 - (1 - level) / 2, fit.df) : NaN_
  const s2 = fit.syx * fit.syx
  const m = xs.length
  const out = { y: new Float64Array(m), lo: new Float64Array(m), hi: new Float64Array(m) }
  for (let i = 0; i < m; i++) {
    const x = xs[i]!
    const yhat = fit.intercept + fit.slope * x
    const d = x - fit.meanX
    let v = fit.varAtMeanX + d * d * fit.cov[0]
    if (opts.kind === 'prediction') v += s2
    const h = t * Math.sqrt(v)
    out.y[i] = yhat
    out.lo[i] = yhat - h
    out.hi[i] = yhat + h
  }
  return out
}

export interface ModelFTest {
  F: number
  dfn: number
  dfd: number
  p: number
}

export interface LinearComparison {
  /** H₀: all slopes are equal. */
  slopes: ModelFTest
  /** H₀: all intercepts are equal given a common slope; null when the slopes differ (P < 0.05). */
  intercepts: ModelFTest | null
  /** Common slope of the parallel-lines model, ΣSxy/ΣSxx. */
  pooledSlope: number
}

function fTest(ssReduced: number, dfReduced: number, ssFull: number, dfFull: number): ModelFTest {
  const dfn = dfReduced - dfFull
  const F = (ssReduced - ssFull) / dfn / (ssFull / dfFull)
  return { F, dfn, dfd: dfFull, p: fSf(F, dfn, dfFull) }
}

/**
 * Compares linear regressions (analysis of covariance, Zar, Biostatistical Analysis, 5th ed.,
 * §18.1–18.4, as Prism does): first separate lines vs parallel lines (common slope, separate
 * intercepts); if the slopes don't differ (P ≥ 0.05), parallel lines vs one line through all
 * the data.
 */
export function compareLinear(
  datasets: readonly { x: ArrayLike<number>; y: ArrayLike<number> }[],
): LinearComparison {
  const K = datasets.length
  if (K < 2) throw new RangeError('compareLinear: need at least two data sets')
  let N = 0
  let ssSeparate = 0
  const centred: { dx: Float64Array; dy: Float64Array }[] = []
  const sxys: number[] = []
  const sxxs: number[] = []
  for (const d of datasets) {
    const n = d.x.length
    N += n
    const mx = wmean(d.x, undefined, n)
    const my = wmean(d.y, undefined, n)
    const dx = new Float64Array(n)
    const dy = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      dx[i] = d.x[i]! - mx
      dy[i] = d.y[i]! - my
    }
    centred.push({ dx, dy })
    const sxx = wdot(dx, dx)
    const sxy = wdot(dx, dy)
    sxxs.push(sxx)
    sxys.push(sxy)
    const b = sxy / sxx
    const r = new Float64Array(n)
    for (let i = 0; i < n; i++) r[i] = dy[i]! - b * dx[i]!
    ssSeparate += wdot(r, r)
  }
  const pooledSlope = sum(sxys) / sum(sxxs)
  let ssParallel = 0
  for (const { dx, dy } of centred) {
    const r = new Float64Array(dx.length)
    for (let i = 0; i < dx.length; i++) r[i] = dy[i]! - pooledSlope * dx[i]!
    ssParallel += wdot(r, r)
  }
  const slopes = fTest(ssParallel, N - K - 1, ssSeparate, N - 2 * K)
  let intercepts: ModelFTest | null = null
  if (!(slopes.p < 0.05)) {
    const xs = new Float64Array(N)
    const ys = new Float64Array(N)
    let o = 0
    for (const d of datasets) {
      for (let i = 0; i < d.x.length; i++, o++) {
        xs[o] = d.x[i]!
        ys[o] = d.y[i]!
      }
    }
    const one = linearRegression(xs, ys)
    intercepts = fTest(one.ssResidual, N - 2, ssParallel, N - K - 1)
  }
  return { slopes, intercepts, pooledSlope }
}
