import { permutationCorrelationP } from '../dist/permutationCorrelation.ts'
import { type Alternative, tPValue } from '../tests/common.ts'
import { doubledRanks, midranks } from '../tests/ranks.ts'
import {
  type CorrelationOptions,
  type CorrelationResult,
  correlationT,
  fisherInterval,
  pearsonR,
} from './pearson.ts'

/** Prism computes an exact P for Spearman's r_s with this many pairs or fewer. */
const SPEARMAN_EXACT_MAX_N = 17

/** Prism reports the CI of r_s only for n above this (Zar's condition for the approximation). */
const SPEARMAN_CI_MIN_N = 10

export interface SpearmanOptions extends CorrelationOptions {
  /** 'auto' (default): exact when n ≤ 17, as Prism. */
  exact?: 'auto' | boolean
}

export interface SpearmanResult extends CorrelationResult {
  exact: boolean
  /** n > 10: Prism shows the CI only then (the approximation is poor for small n). */
  ciValid: boolean
}

/**
 * Spearman rank correlation as the Prism Statistics Guide ("Interpreting results: Correlation")
 * describes it:
 *
 * - r_s = Pearson correlation of the mid-ranks (as R's cor.test(method = "spearman")).
 * - n ≤ 17: exact P over all n! pairings of the ranks, ties included ("Exact calculations
 *   handle ties with no problem"); see permutationCorrelationP. Without ties this equals R's
 *   exact distribution (pspearman / AS 89 for n ≤ 9).
 * - n ≥ 18: "it first computes a t ratio from r_s, and then computes P from that":
 *   t = r_s √((n − 2)/(1 − r_s²)) on n − 2 df, as cor.test(exact = FALSE).
 * - CI: Fisher's z with the Fieller, Hartley & Pearson (1957) variance 1.060/(n − 3), the
 *   approximation Zar (Biostatistical Analysis, §19.9) gives and says to use only for n > 10;
 *   Prism shows no CI for n ≤ 10 (`ciValid`). Computed for any n > 3 here.
 *
 * 'greater' means a positive correlation. n < 2 gives NaN; a constant x or y gives r = NaN,
 * P = NaN.
 */
export function spearmanCorrelation(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: SpearmanOptions = {},
): SpearmanResult {
  if (x.length !== y.length) throw new RangeError('correlation: x and y must have equal lengths')
  const alternative: Alternative = opts.alternative ?? 'two-sided'
  const confLevel = opts.confLevel ?? 0.95
  const n = x.length
  const rx = midranks(x).ranks
  const ry = midranks(y).ranks
  const r = n >= 2 ? pearsonR(rx, ry) : Number.NaN
  const df = n - 2
  const t = n >= 3 ? correlationT(r, df) : Number.NaN
  const exact =
    opts.exact === undefined || opts.exact === 'auto' ? n <= SPEARMAN_EXACT_MAX_N : opts.exact
  let p: number
  if (Number.isNaN(r)) p = Number.NaN
  else if (exact) {
    p = permutationCorrelationP(doubledRanks(rx), doubledRanks(ry), alternative)
  } else p = n >= 3 ? tPValue(t, df, alternative) : Number.NaN
  const [lower, upper] =
    n > 3 && !Number.isNaN(r)
      ? fisherInterval(r, Math.sqrt(1.06 / (n - 3)), alternative, confLevel)
      : [Number.NaN, Number.NaN]
  return {
    r,
    lower,
    upper,
    r2: r * r,
    p,
    n,
    t,
    df,
    exact,
    ciValid: n > SPEARMAN_CI_MIN_N,
  }
}
