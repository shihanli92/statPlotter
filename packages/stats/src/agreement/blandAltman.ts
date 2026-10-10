import { mean, sd } from '../descriptive/basic.ts'
import { normalQuantile } from '../dist/normal.ts'
import { tQuantile } from '../dist/t.ts'

/**
 * Bland–Altman method comparison, as GraphPad Prism
 * (https://www.graphpad.com/guides/prism/latest/statistics/stat_bland_altman.htm,
 * https://www.graphpad.com/guides/prism/latest/statistics/bland-altman_results.htm):
 *
 * - Per pair: x = (a + b) / 2 and y = a − b ("Difference (A − B)"), a / b ("Ratio (A / B)") or
 *   100·(a − b) / x ("%Difference"), or the B − A, B / A, 100·(b − a) / x variants.
 * - Bias = mean of y; "SD of bias" = SD of y (n − 1); 95% limits of agreement = bias ± 1.96·SD.
 *   Prism uses 1.96 literally (its sample output, bias 0.238095 and SD 6.96351, gives the
 *   limits −13.4104 to 13.8866, which z = 1.959964 would not); other confidence levels use the
 *   normal quantile z_{(1+level)/2}. Ratios and percents are analysed as they are (no logs).
 * - Prism reports no CIs for these; biasCI (bias ± t·SD/√n) and the limits' CIs
 *   (limit ± t·SD·√(3/n), t on n − 1 df) are Bland & Altman's (1986, Lancet i:307) approximate
 *   intervals, as BlandAltmanLeh's bland.altman.stats reports them.
 */

export interface BlandAltmanResult {
  measure: 'difference' | 'ratio' | 'percent'
  order: 'aMinusB' | 'bMinusA'
  /** Average of each pair. */
  x: number[]
  /** Difference, ratio or percent difference of each pair. */
  y: number[]
  bias: number
  /** SD of y ("SD of bias"). */
  sd: number
  /** Limits of agreement: bias ± z·SD. */
  lower: number
  upper: number
  z: number
  biasCI?: [number, number]
  lowerCI?: [number, number]
  upperCI?: [number, number]
  n: number
}

export interface BlandAltmanOptions {
  /** Default 'difference'. */
  measure?: 'difference' | 'ratio' | 'percent'
  /** Default 'aMinusB' (A − B, A / B). */
  order?: 'aMinusB' | 'bMinusA'
  /** Default 0.95 (z = 1.96 exactly). */
  confLevel?: number
}

/**
 * Throws when a and b differ in length or hold non-finite values. n < 2 gives NaN SD, limits
 * and CIs; a zero divisor gives a non-finite ratio / percent for that pair (and so NaN or ±∞
 * statistics), never an exception.
 */
export function blandAltman(
  a: readonly number[],
  b: readonly number[],
  opts: BlandAltmanOptions = {},
): BlandAltmanResult {
  if (a.length !== b.length) throw new RangeError('blandAltman: a and b must have equal lengths')
  for (const v of [...a, ...b]) {
    if (!Number.isFinite(v)) throw new RangeError('blandAltman: non-finite value')
  }
  const measure = opts.measure ?? 'difference'
  const order = opts.order ?? 'aMinusB'
  const confLevel = opts.confLevel ?? 0.95
  const n = a.length
  const x: number[] = []
  const y: number[] = []
  for (let i = 0; i < n; i++) {
    const [u, v] = order === 'aMinusB' ? [a[i]!, b[i]!] : [b[i]!, a[i]!]
    const avg = (u + v) / 2
    x.push(avg)
    y.push(measure === 'difference' ? u - v : measure === 'ratio' ? u / v : (100 * (u - v)) / avg)
  }
  const finite = y.every(Number.isFinite)
  const bias = n > 0 ? (finite ? mean(y) : y.reduce((s, v) => s + v, 0) / n) : Number.NaN
  const s = n >= 2 && finite ? sd(y) : Number.NaN
  const z = confLevel === 0.95 ? 1.96 : normalQuantile((1 + confLevel) / 2)
  const lower = bias - z * s
  const upper = bias + z * s
  const t = n >= 2 ? tQuantile((1 + confLevel) / 2, n - 1) : Number.NaN
  const hb = (t * s) / Math.sqrt(n)
  const hl = t * s * Math.sqrt(3 / n)
  return {
    measure,
    order,
    x,
    y,
    bias,
    sd: s,
    lower,
    upper,
    z,
    biasCI: [bias - hb, bias + hb],
    lowerCI: [lower - hl, lower + hl],
    upperCI: [upper - hl, upper + hl],
    n,
  }
}
