import { normalCdf, normalSf } from '../dist/normal.ts'
import { tCdf, tQuantile, tSf } from '../dist/t.ts'

/**
 * Alternative hypothesis, always about the reported effect: for two-sample tests that is
 * B − A (the second group minus the first, as differences are reported), for one-sample
 * tests x − μ. 'greater' means the effect is > 0.
 */
export type Alternative = 'two-sided' | 'less' | 'greater'

/** P value of a statistic with a t(df) null distribution (R's t.test convention). */
export function tPValue(t: number, df: number, alternative: Alternative): number {
  switch (alternative) {
    case 'less':
      return tCdf(t, df)
    case 'greater':
      return tSf(t, df)
    default:
      return 2 * tSf(Math.abs(t), df)
  }
}

/** P value of a standard-normal statistic; two-sided is 2·min(Φ(z), 1 − Φ(z)). */
export function zPValue(z: number, alternative: Alternative): number {
  switch (alternative) {
    case 'less':
      return normalCdf(z)
    case 'greater':
      return normalSf(z)
    default:
      return Number.isNaN(z) ? z : 2 * normalSf(Math.abs(z))
  }
}

/**
 * Confidence interval for an estimate with a t(df)-distributed pivot, as R's t.test forms it:
 * two-sided est ± t_{1−α/2}·se; one-sided intervals are open on the side of the alternative's
 * complement ('greater' → [est − t_{1−α}·se, ∞)).
 */
export function tInterval(
  est: number,
  se: number,
  df: number,
  alternative: Alternative,
  confLevel: number,
): [number, number] {
  const alpha = 1 - confLevel
  if (alternative === 'less') return [Number.NEGATIVE_INFINITY, est + tQuantile(confLevel, df) * se]
  if (alternative === 'greater') {
    return [est - tQuantile(confLevel, df) * se, Number.POSITIVE_INFINITY]
  }
  const h = tQuantile(1 - alpha / 2, df) * se
  return [est - h, est + h]
}

/** η² = t²/(t² + df), taking the limit 1 when |t| = ∞. */
export function tRSquared(t: number, df: number): number {
  if (Math.abs(t) === Number.POSITIVE_INFINITY) return 1
  return (t * t) / (t * t + df)
}

/** t test of an estimate `est` = 0 from n values with SD s: SE s/√n on n − 1 df. */
export function tOfEstimate(
  est: number,
  s: number,
  n: number,
  opts: { alternative?: Alternative; confLevel?: number },
) {
  const alternative = opts.alternative ?? 'two-sided'
  const se = s / Math.sqrt(n)
  const df = n - 1
  const t = est / se
  const [ciLo, ciHi] = tInterval(est, se, df, alternative, opts.confLevel ?? 0.95)
  return { t, df, p: tPValue(t, df, alternative), se, ciLo, ciHi, rSquared: tRSquared(t, df) }
}
