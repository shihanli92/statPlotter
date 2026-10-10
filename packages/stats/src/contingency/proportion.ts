import { betaQuantile, chiSqQuantile } from '../dist/betaGammaQuantile.ts'
import { binomCdf, binomPmf, binomSf } from '../dist/binomial.ts'
import { normalQuantile } from '../dist/normal.ts'
import { checkCount } from './validate.ts'
import { wilsonLimits } from './wilson.ts'

/** A point estimate with a confidence interval. */
export interface Estimate {
  value: number
  lower: number
  upper: number
}

export type ProportionCiMethod = 'wilsonBrown' | 'clopperPearson' | 'wilson'

export interface ProportionCiOptions {
  /** Default 0.95. */
  confLevel?: number
  /** Default 'wilsonBrown' (Prism's recommended method). */
  method?: ProportionCiMethod
}

/**
 * Confidence interval of the proportion k / n.
 *
 * - 'wilson': Wilson's score interval (no continuity correction, as Prism).
 * - 'clopperPearson': the "exact" interval, Beta quantiles (R's binom.test).
 * - 'wilsonBrown': Prism's hybrid (Brown, Cai & DasGupta 2001, §4.1.1 "modified Wilson"):
 *   Wilson, except that the lower limit is the one-sided Poisson bound ½χ²_{2k, α} / n when
 *   k = 1 or 2, or k = 3 with n > 50, and symmetrically the upper limit is
 *   1 − ½χ²_{2(n−k), α} / n when n − k = 1, 2, or 3 with n > 50 (α = 1 − confLevel, not α/2,
 *   as in the paper). k = 0 gives lower = 0 and k = n gives upper = 1, with the other limit by
 *   Wilson (these take precedence over the Poisson rule, as Prism's guide describes).
 *
 * n = 0 gives NaN throughout. Throws for non-integer or negative counts or k > n.
 */
export function proportionCI(k: number, n: number, opts: ProportionCiOptions = {}): Estimate {
  checkCount(k, 'k')
  checkCount(n, 'n')
  if (k > n) throw new Error(`proportionCI: k (${k}) exceeds n (${n})`)
  const conf = opts.confLevel ?? 0.95
  const method = opts.method ?? 'wilsonBrown'
  if (n === 0) return { value: Number.NaN, lower: Number.NaN, upper: Number.NaN }
  const value = k / n
  const alpha = 1 - conf
  if (method === 'clopperPearson') {
    const lower = k === 0 ? 0 : betaQuantile(alpha / 2, k, n - k + 1)
    const upper = k === n ? 1 : betaQuantile(alpha / 2, k + 1, n - k, false)
    return { value, lower, upper }
  }
  let [lower, upper] = wilsonLimits(k, n, normalQuantile(1 - (1 - conf) / 2), false)
  if (method === 'wilsonBrown') {
    const xStar = (x: number) => x === 1 || x === 2 || (x === 3 && n > 50)
    if (k !== n && xStar(k)) lower = (0.5 * chiSqQuantile(alpha, 2 * k)) / n
    if (k !== 0 && xStar(n - k)) upper = 1 - (0.5 * chiSqQuantile(alpha, 2 * (n - k))) / n
  }
  return { value, lower, upper }
}

export interface BinomialTestResult {
  /** Two-sided: sum of the probabilities of outcomes no more likely than k (R's binom.test). */
  p: number
  /** P(X ≤ k). */
  pLess: number
  /** P(X ≥ k). */
  pGreater: number
}

/**
 * Exact binomial test of H0: success probability = p0, for k successes in n trials. The
 * two-sided P value is Prism's "method of small P values", identical to R's binom.test
 * (outcomes with probability ≤ P(X = k)·(1 + 1e−7) form the rejection region).
 * n = 0 gives P = 1. Throws for invalid counts or p0 outside [0, 1].
 */
export function binomialTest(k: number, n: number, p0: number): BinomialTestResult {
  checkCount(k, 'k')
  checkCount(n, 'n')
  if (k > n) throw new Error(`binomialTest: k (${k}) exceeds n (${n})`)
  if (!(p0 >= 0 && p0 <= 1)) throw new Error(`binomialTest: p0 must be in [0, 1], got ${p0}`)
  const pLess = binomCdf(k, n, p0)
  const pGreater = binomSf(k - 1, n, p0)
  const d = binomPmf(k, n, p0) * (1 + 1e-7)
  const m = n * p0
  let p: number
  if (k === m) p = 1
  else if (k < m) {
    // Count the upper-tail outcomes ≥ ceil(m) that are no more likely than k.
    let y = 0
    for (let i = Math.ceil(m); i <= n; i++) if (binomPmf(i, n, p0) <= d) y++
    p = pLess + binomSf(n - y, n, p0)
  } else {
    let y = 0
    for (let i = 0; i <= Math.floor(m); i++) if (binomPmf(i, n, p0) <= d) y++
    p = binomCdf(y - 1, n, p0) + pGreater
  }
  return { p: Math.min(1, p), pLess, pGreater }
}
