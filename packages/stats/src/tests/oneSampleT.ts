import { shifted } from '../arrays.ts'
import { mean, sd } from '../descriptive/basic.ts'
import { type Alternative, tInterval, tOfEstimate } from './common.ts'
import type { OneSampleT } from './ttest.ts'

export interface OneSampleTOptions {
  alternative?: Alternative
  confLevel?: number
}

export interface OneSampleTResult extends OneSampleT {
  /** Hypothetical (theoretical) mean. */
  mu: number
  /** Prism's "discrepancy": mean − mu. */
  diff: number
  /** CI of the discrepancy (ciLo/ciHi − mu, computed without the offset). */
  diffLo: number
  diffHi: number
}

/**
 * One-sample t test of mean(x) = mu, as R's t.test(x, mu = mu). `mean`, `ciLo`, `ciHi` are the
 * actual mean and its CI (R's conf.int); `diff`, `diffLo`, `diffHi` the discrepancy mean − mu
 * and its CI, which is what Prism's one-sample t test reports. 'greater' means mean > mu.
 *
 * The discrepancy is computed as the mean of x − mu, which stays accurate for data like 1e9 + tiny
 * noise tested against a nearby mu. n < 2 gives NaN statistics; SD = 0 gives t = ±∞, P = 0 (NaN
 * when mean = mu), as the other t tests.
 */
export function tTestOneSample(
  x: ArrayLike<number>,
  mu: number,
  opts: OneSampleTOptions = {},
): OneSampleTResult {
  const n = x.length
  const m = mean(x)
  const diff = mean(shifted(x, mu))
  const s = sd(x)
  const { t, df, p, se, ciLo: diffLo, ciHi: diffHi, rSquared } = tOfEstimate(diff, s, n, opts)
  const alt = opts.alternative ?? 'two-sided'
  const [ciLo, ciHi] = tInterval(m, se, df, alt, opts.confLevel ?? 0.95)
  return { t, df, p, mean: m, sd: s, se, ciLo, ciHi, n, rSquared, mu, diff, diffLo, diffHi }
}
