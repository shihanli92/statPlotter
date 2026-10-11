import { absolutes, differences, shifted } from '../arrays.ts'
import { median } from '../descriptive/quantile.ts'
import { signedRankExactP } from '../dist/rankExact.ts'
import { hodgesLehmannOneSample } from '../gpl/wilcoxConfInt.ts'
import { type Alternative, zPValue } from './common.ts'
import { doubledRanks, midranks } from './ranks.ts'

/**
 * 'auto' uses the exact distribution when the number of non-zero differences is ≤ this.
 * Provisional cut-off.
 */
const WILCOXON_EXACT_MAX_N = 100

export interface WilcoxonOptions {
  /**
   * 'wilcoxon' (default) drops zero differences before ranking; 'pratt' ranks all |d|
   * including zeros, then drops the zeros.
   */
  zeroMethod?: 'wilcoxon' | 'pratt'
  exact?: 'auto' | boolean
  /** Continuity correction for the normal approximation (default true, as R). */
  correct?: boolean
  alternative?: Alternative
  confLevel?: number
}

export interface WilcoxonResult {
  /** Sum of ranks of the positive differences (R's V). */
  wPlus: number
  wMinus: number
  /** Sum of signed ranks wPlus − wMinus (W). */
  W: number
  n: number
  nNonZero: number
  nZero: number
  p: number
  method: 'exact' | 'normal'
  /** Ties among the non-zero |differences|. */
  ties: boolean
  /** Median of the differences (b − a, or x − mu), zeros included. */
  medianDiff: number
  /** Hodges–Lehmann pseudo-median and CI, as R's wilcox.test (zeros dropped, see gpl/). */
  hlEstimate: number
  hlLo: number
  hlHi: number
}

/** |d[i]| at the indices `at`. */
function absAt(d: ArrayLike<number>, at: readonly number[]): Float64Array {
  const out = new Float64Array(at.length)
  for (let k = 0; k < at.length; k++) out[k] = Math.abs(d[at[k]!]!)
  return out
}

function signedRank(
  d: Float64Array,
  hlX: ArrayLike<number>,
  mu: number,
  opts: WilcoxonOptions,
): WilcoxonResult {
  const zeroMethod = opts.zeroMethod ?? 'wilcoxon'
  const alternative = opts.alternative ?? 'two-sided'
  const correct = opts.correct ?? true
  const confLevel = opts.confLevel ?? 0.95
  const n = d.length
  const nz: number[] = []
  for (let i = 0; i < n; i++) if (d[i] !== 0) nz.push(i)
  const nNonZero = nz.length
  const nZero = n - nNonZero

  // Ranks of |d| for the non-zero differences, under the chosen zero method.
  let r: Float64Array
  let ties: boolean
  let tieSum: number
  if (zeroMethod === 'pratt') {
    const all = midranks(absolutes(d))
    r = new Float64Array(nNonZero)
    for (let k = 0; k < nNonZero; k++) r[k] = all.ranks[nz[k]!]!
    const nonzero = midranks(absAt(d, nz))
    ties = nonzero.tieSum > 0
    tieSum = nonzero.tieSum
  } else {
    const nonzero = midranks(absAt(d, nz))
    r = nonzero.ranks
    ties = nonzero.tieSum > 0
    tieSum = nonzero.tieSum
  }
  let wPlus = 0
  let wMinus = 0
  const positive = nz.map((i) => d[i]! > 0)
  for (let k = 0; k < nNonZero; k++) {
    if (positive[k]) wPlus += r[k]!
    else wMinus += r[k]!
  }
  const exact =
    opts.exact === 'auto' || opts.exact === undefined
      ? nNonZero <= WILCOXON_EXACT_MAX_N
      : opts.exact

  let p: number
  if (nNonZero === 0) {
    p = Number.NaN
  } else if (exact) {
    p = signedRankExactP(doubledRanks(r), positive, alternative)
  } else {
    // Mean Σr/2 and variance Σr²/4 of W+ under random signs. For the 'wilcoxon' ranks this is
    // R's n(n+1)/4 and n(n+1)(2n+1)/24 − Σ(t³−t)/48, written R's way.
    let z: number
    let sigma: number
    if (zeroMethod === 'wilcoxon') {
      const m = nNonZero
      z = wPlus - (m * (m + 1)) / 4
      sigma = Math.sqrt((m * (m + 1) * (2 * m + 1)) / 24 - tieSum / 48)
    } else {
      let s1 = 0
      let s2 = 0
      for (let k = 0; k < nNonZero; k++) {
        s1 += r[k]!
        s2 += r[k]! * r[k]!
      }
      z = wPlus - s1 / 2
      sigma = Math.sqrt(s2 / 4)
    }
    let corr = 0
    if (correct)
      corr =
        alternative === 'two-sided' ? Math.sign(z) * 0.5 : alternative === 'greater' ? 0.5 : -0.5
    p = zPValue((z - corr) / sigma, alternative)
  }

  const hl = hodgesLehmannOneSample(hlX, mu, {
    exact: exact && !ties && nZero === 0,
    correct,
    alternative,
    confLevel,
  })
  return {
    wPlus,
    wMinus,
    W: wPlus - wMinus,
    n,
    nNonZero,
    nZero,
    p,
    method: exact ? 'exact' : 'normal',
    ties,
    medianDiff: median(d),
    hlEstimate: hl.estimate,
    hlLo: hl.lo,
    hlHi: hl.hi,
  }
}

/**
 * Wilcoxon matched-pairs signed-rank test on the differences B − A; 'greater' means B − A
 * tends to be positive.
 *
 * Exact P: the sign-flip permutation distribution of W+ over the non-zero differences with
 * their (mid-)ranks, so exact with ties and zeros too (as coin::wilcoxsign_test(distribution =
 * "exact")). Normal approximation: as wilcox.test(exact = FALSE) for 'wilcoxon'; for 'pratt'
 * the same statistic with the Pratt ranks (coin's asymptotic test when correct = false).
 */
export function wilcoxonSignedRank(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  opts: WilcoxonOptions = {},
): WilcoxonResult {
  if (a.length !== b.length) throw new RangeError('paired data must have equal lengths')
  const d = differences(a, b)
  return signedRank(d, d, 0, opts)
}

/** One-sample Wilcoxon signed-rank test of x against location mu (differences x − mu). */
export function wilcoxonSignedRankOneSample(
  x: ArrayLike<number>,
  mu = 0,
  opts: WilcoxonOptions = {},
): WilcoxonResult {
  const d = shifted(x, mu)
  return signedRank(d, x, mu, opts)
}
