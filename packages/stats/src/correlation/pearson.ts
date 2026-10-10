import { shifted } from '../arrays.ts'
import { normalQuantile } from '../dist/normal.ts'
import { type Alternative, tPValue } from '../tests/common.ts'

export interface CorrelationOptions {
  confLevel?: number
  alternative?: Alternative
}

export interface CorrelationResult {
  r: number
  /** CI of r (Fisher z); NaN when n ≤ 3. One-sided alternatives give a one-sided interval. */
  lower: number
  upper: number
  r2: number
  p: number
  n: number
  /** t = r √((n − 2)/(1 − r²)) on df = n − 2. */
  t?: number
  df?: number
}

function centred(v: ArrayLike<number>): Float64Array {
  const n = v.length
  // Shift by a data value first (exact for clustered data such as 1e9 + noise).
  const c = n > 0 ? v[0]! : 0
  const d = shifted(v, c)
  let s = 0
  for (let i = 0; i < n; i++) s += d[i]!
  let m = s / n
  let r = 0
  for (let i = 0; i < n; i++) r += d[i]! - m
  m += r / n
  for (let i = 0; i < n; i++) d[i] = d[i]! - m
  return d
}

/**
 * Pearson correlation by centred cross-products, with the residual sums Σdx, Σdy (the rounding
 * error left in the means) corrected for, clamped to [−1, 1]. NaN when either SD is 0.
 */
export function pearsonR(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = x.length
  const dx = centred(x)
  const dy = centred(y)
  let sx = 0
  let sy = 0
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sx += dx[i]!
    sy += dy[i]!
    sxy += dx[i]! * dy[i]!
    sxx += dx[i]! * dx[i]!
    syy += dy[i]! * dy[i]!
  }
  sxy -= (sx * sy) / n
  sxx -= (sx * sx) / n
  syy -= (sy * sy) / n
  if (!(sxx > 0) || !(syy > 0)) return Number.NaN
  const prod = sxx * syy
  const safe = prod > 1e-300 && prod < 1e300
  const r = sxy / (safe ? Math.sqrt(prod) : Math.sqrt(sxx) * Math.sqrt(syy))
  return Math.max(-1, Math.min(1, r))
}

/**
 * Fisher-z interval tanh(atanh(r) ± z_{1−α/2}·se) (one-sided: tanh(atanh(r) − z_{1−α}·se) to 1
 * for 'greater', −1 to tanh(atanh(r) + z_{1−α}·se) for 'less'), as R's cor.test.
 */
export function fisherInterval(
  r: number,
  se: number,
  alternative: Alternative,
  confLevel: number,
): [number, number] {
  const z = Math.atanh(r)
  if (alternative === 'less') return [-1, Math.tanh(z + se * normalQuantile(confLevel))]
  if (alternative === 'greater') return [Math.tanh(z - se * normalQuantile(confLevel)), 1]
  const h = se * normalQuantile((1 + confLevel) / 2)
  return [Math.tanh(z - h), Math.tanh(z + h)]
}

/** t statistic of a correlation, ±∞ for r = ±1. */
export function correlationT(r: number, df: number): number {
  if (Math.abs(r) === 1) return r * Number.POSITIVE_INFINITY
  return (Math.sqrt(df) * r) / Math.sqrt(1 - r * r)
}

/**
 * Pearson correlation test, as R's cor.test(method = "pearson") (Prism computes the same): P
 * from t = r √((n−2)/(1−r²)) on n − 2 df; CI by Fisher's z with SE 1/√(n − 3) (n > 3 only).
 * 'greater' means a positive correlation. n < 3 gives NaN statistics (r is still computed for
 * n = 2); an SD of 0 gives NaN throughout; r = ±1 gives P = 0 and the CI [r, r].
 *
 * Note: R's one-sided CI runs to ±Inf on the z scale, i.e. to ±1 on the r scale, as here.
 */
export function pearsonCorrelation(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: CorrelationOptions = {},
): CorrelationResult {
  if (x.length !== y.length) throw new RangeError('correlation: x and y must have equal lengths')
  const alternative = opts.alternative ?? 'two-sided'
  const confLevel = opts.confLevel ?? 0.95
  const n = x.length
  const r = n >= 2 ? pearsonR(x, y) : Number.NaN
  const df = n - 2
  const t = n >= 3 ? correlationT(r, df) : Number.NaN
  const [lower, upper] =
    n > 3 && !Number.isNaN(r)
      ? fisherInterval(r, 1 / Math.sqrt(n - 3), alternative, confLevel)
      : [Number.NaN, Number.NaN]
  return {
    r,
    lower,
    upper,
    r2: r * r,
    p: n >= 3 ? tPValue(t, df, alternative) : Number.NaN,
    n,
    t,
    df,
  }
}
