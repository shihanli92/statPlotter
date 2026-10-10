import { median } from '../descriptive/quantile.ts'
import { rankSumExactP } from '../dist/rankExact.ts'
import { hodgesLehmannTwoSample } from '../gpl/wilcoxConfInt.ts'
import { type Alternative, zPValue } from './common.ts'
import { doubledRanks, midranks } from './ranks.ts'

/**
 * 'auto' uses the exact distribution when nA + nB ≤ this. Provisional: to be checked against
 * the cut-off Prism uses.
 */
const MANN_WHITNEY_EXACT_MAX_N = 100

export interface MannWhitneyOptions {
  /** Exact permutation P (also with ties), normal approximation, or 'auto' (the default). */
  exact?: 'auto' | boolean
  /** Continuity correction for the normal approximation (default true, as R). */
  correct?: boolean
  alternative?: Alternative
  confLevel?: number
}

export interface MannWhitneyResult {
  /** min(uA, uB), the U Prism reports. */
  U: number
  /** U of group A: sumRanksA − nA(nA+1)/2. uA + uB = nA·nB. */
  uA: number
  /** U of group B (R's W for wilcox.test(b, a)). */
  uB: number
  sumRanksA: number
  sumRanksB: number
  nA: number
  nB: number
  medianA: number
  medianB: number
  p: number
  method: 'exact' | 'normal'
  ties: boolean
  /** Hodges–Lehmann estimate of the location shift B − A, and its CI (R's wilcox.test). */
  hlEstimate: number
  hlLo: number
  hlHi: number
}

/**
 * Mann–Whitney U (Wilcoxon rank-sum) test of A vs B; 'greater' means B tends to be larger.
 *
 * Exact P: the permutation distribution of B's mid-rank sum, so it is exact with ties too
 * (as coin::wilcox_test(distribution = "exact")); two-sided P = P(|S − E S| ≥ |s − E S|).
 * Normal approximation: as wilcox.test(exact = FALSE), with the tie-corrected variance
 * nA nB/12 · (N + 1 − Σ(t³−t)/(N(N−1))) and optional continuity correction.
 */
export function mannWhitney(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  opts: MannWhitneyOptions = {},
): MannWhitneyResult {
  const alternative = opts.alternative ?? 'two-sided'
  const correct = opts.correct ?? true
  const confLevel = opts.confLevel ?? 0.95
  const nA = a.length
  const nB = b.length
  const N = nA + nB
  const all = new Float64Array(N)
  all.set(Array.from(a), 0)
  all.set(Array.from(b), nA)
  const { ranks, tieSum } = midranks(all)
  let sumRanksA = 0
  let sumRanksB = 0
  for (let i = 0; i < nA; i++) sumRanksA += ranks[i]!
  for (let i = nA; i < N; i++) sumRanksB += ranks[i]!
  const uA = sumRanksA - (nA * (nA + 1)) / 2
  const uB = sumRanksB - (nB * (nB + 1)) / 2
  const ties = tieSum > 0
  const exact =
    opts.exact === 'auto' || opts.exact === undefined ? N <= MANN_WHITNEY_EXACT_MAX_N : opts.exact

  let p: number
  if (nA === 0 || nB === 0) {
    p = Number.NaN
  } else if (exact) {
    const scores = doubledRanks(ranks)
    const inB = Array.from({ length: N }, (_, i) => i >= nA)
    p = rankSumExactP(scores, inB, alternative)
  } else {
    let z = uB - (nA * nB) / 2
    const sigma = Math.sqrt(((nA * nB) / 12) * (N + 1 - tieSum / (N * (N - 1))))
    let corr = 0
    if (correct)
      corr =
        alternative === 'two-sided' ? Math.sign(z) * 0.5 : alternative === 'greater' ? 0.5 : -0.5
    z = (z - corr) / sigma
    p = zPValue(z, alternative)
  }

  const hl = hodgesLehmannTwoSample(b, a, {
    exact: exact && !ties,
    correct,
    alternative,
    confLevel,
  })
  return {
    U: Math.min(uA, uB),
    uA,
    uB,
    sumRanksA,
    sumRanksB,
    nA,
    nB,
    medianA: median(a),
    medianB: median(b),
    p,
    method: exact ? 'exact' : 'normal',
    ties,
    hlEstimate: hl.estimate,
    hlLo: hl.lo,
    hlHi: hl.hi,
  }
}
