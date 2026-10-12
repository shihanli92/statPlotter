import { adjustP } from '../anova/padjust.ts'
import { chiSqSf } from '../dist/chisq.ts'
import { normalSf } from '../dist/normal.ts'
import { factorial } from '../special/functions.ts'
import { doubledRanks, midranks } from './ranks.ts'

/**
 * The exact P value is computed when (k!)^n ≤ this, k treatments and n subjects (above it, the
 * approximate method).
 */
const FRIEDMAN_EXACT_MAX_PERMUTATIONS = 1e9

export interface FriedmanResult {
  /** Friedman chi-square, corrected for ties within rows (as R's friedman.test). */
  stat: number
  df: number
  /** Chi-square approximation to P (always computed; NaN when every row is all ties). */
  p: number
  /**
   * Exact permutation P, P(stat ≥ observed) over all (k!)^n within-row rearrangements (ties
   * included), when (k!)^n ≤ 1e9; null otherwise. The P reported is `pExact ?? p`.
   */
  pExact: number | null
  /** Column rank sums R_j (mid-ranks within each row). */
  rankSums: number[]
  meanRanks: number[]
  n: number
  k: number
}

export interface FriedmanOptions {
  /** 'auto' (default) follows the (k!)^n ≤ 1e9 rule. */
  exact?: 'auto' | boolean
}

/**
 * Friedman test for a randomized block design. `rows` are subjects (blocks), columns are
 * treatments; rows must be complete (the caller drops incomplete rows) and of equal length,
 * otherwise a RangeError is thrown.
 *
 * Each row is ranked separately (mid-ranks for ties); with R_j the column rank sums,
 *   Q = 12 Σ (R_j − n(k+1)/2)² / (n k (k+1) − Σ(t³ − t)/(k − 1)),
 * the tie sum running over the tie groups of every row (Hollander & Wolfe; R's friedman.test),
 * with P from χ²(k − 1). The exact P enumerates the within-row permutations (see pExact).
 * n = 0 or k < 2 gives NaN; a design where every row is tied throughout has Q = NaN, P = NaN
 * and exact P = 1 (every rearrangement gives the observed rank sums).
 */
export function friedmanTest(
  rows: readonly (readonly number[])[],
  opts: FriedmanOptions = {},
): FriedmanResult {
  const n = rows.length
  const k = n > 0 ? rows[0]!.length : 0
  for (const r of rows) {
    if (r.length !== k) throw new RangeError('Friedman test: all rows must have the same length')
  }
  const rankSums = new Array<number>(k).fill(0)
  const scores: Int32Array[] = [] // doubled mid-ranks per row (integers)
  let tieSum = 0
  for (const r of rows) {
    const { ranks, tieSum: t } = midranks(r)
    tieSum += t
    for (let j = 0; j < k; j++) rankSums[j] = rankSums[j]! + ranks[j]!
    scores.push(doubledRanks(ranks))
  }
  const meanRanks = rankSums.map((s) => s / n)
  if (n === 0 || k < 2) {
    return {
      stat: Number.NaN,
      df: k - 1,
      p: Number.NaN,
      pExact: null,
      rankSums,
      meanRanks,
      n,
      k,
    }
  }
  const e = (n * (k + 1)) / 2
  let num = 0
  for (const R of rankSums) num += (R - e) ** 2
  const den = n * k * (k + 1) - tieSum / (k - 1)
  const stat = den > 0 ? (12 * num) / den : Number.NaN
  const df = k - 1
  const exact =
    opts.exact === undefined || opts.exact === 'auto'
      ? factorial(k) ** n <= FRIEDMAN_EXACT_MAX_PERMUTATIONS
      : opts.exact
  return {
    stat,
    df,
    p: chiSqSf(stat, df),
    pExact: exact ? friedmanExactP(scores, k) : null,
    rankSums,
    meanRanks,
    n,
    k,
  }
}

/** Distinct permutations of a multiset (integer scores), lexicographic. */
function distinctPermutations(v: Int32Array): Int32Array[] {
  const a = Int32Array.from(v).sort()
  const out: Int32Array[] = [Int32Array.from(a)]
  const k = a.length
  for (;;) {
    let i = k - 2
    while (i >= 0 && a[i]! >= a[i + 1]!) i--
    if (i < 0) return out
    let j = k - 1
    while (a[j]! <= a[i]!) j--
    const t = a[i]!
    a[i] = a[j]!
    a[j] = t
    a.subarray(i + 1).reverse()
    out.push(Int32Array.from(a))
  }
}

/**
 * Exact P(Σ R_j² ≥ observed) over independent uniform rearrangements of each row's (doubled)
 * mid-ranks. Given the tie pattern the tie-corrected Q is increasing in Σ R_j², so this is
 * P(Q ≥ q). The state is the vector of partial column sums, kept sorted: each row's set of
 * rearrangements is closed under permuting columns, so the multiset of column sums carries the
 * whole distribution. Distinct rearrangements of a row with ties are equally likely, so they are
 * enumerated once each. All sums and counts are integers held exactly in doubles. The first row
 * only fixes the starting multiset (every rearrangement of it sorts to the same state), so it is
 * not enumerated.
 */
function friedmanExactP(scores: readonly Int32Array[], k: number): number {
  const n = scores.length
  const obsSums = new Array<number>(k).fill(0)
  for (const r of scores) for (let j = 0; j < k; j++) obsSums[j] = obsSums[j]! + r[j]!
  let obs = 0
  for (const s of obsSums) obs += s * s
  const base = 2 * k * n + 1
  let states = new Map<number, { sums: number[]; w: number }>()
  states.set(0, { sums: Array.from(scores[0]!).sort((x, y) => x - y), w: 1 })
  let total = 1
  const next = new Array<number>(k)
  for (let row = 1; row < n; row++) {
    const r = scores[row]!
    const perms = distinctPermutations(r)
    total *= perms.length
    const nextStates = new Map<number, { sums: number[]; w: number }>()
    for (const { sums, w } of states.values()) {
      for (const p of perms) {
        for (let j = 0; j < k; j++) next[j] = sums[j]! + p[j]!
        next.sort((x, y) => x - y)
        let key = 0
        for (let j = 0; j < k; j++) key = key * base + next[j]!
        const e = nextStates.get(key)
        if (e) e.w += w
        else nextStates.set(key, { sums: next.slice(), w })
      }
    }
    states = nextStates
  }
  let hit = 0
  for (const { sums, w } of states.values()) {
    let q = 0
    for (const s of sums) q += s * s
    if (q >= obs) hit += w
  }
  return Math.min(1, hit / total)
}

export interface DunnFriedmanOptions {
  method: 'none' | 'bonferroni' | 'sidak' | 'holm'
  /** Comparisons in the family (default and minimum: pairs.length). */
  family?: number
}

export interface DunnFriedmanRow {
  i: number
  j: number
  /** R_i − R_j (column rank sums). */
  rankSumDiff: number
  /** R̄_i − R̄_j (mean ranks, as the results table shows). */
  meanRankDiff: number
  z: number
  /** Two-sided unadjusted P. */
  p: number
  /** Multiplicity-adjusted P (= p for 'none'). */
  pAdj: number
}

/**
 * Dunn's multiple comparisons after the Friedman test: z = (R̄_i − R̄_j) /
 * √(k(k+1)/(6n)) on the mean ranks, equivalently (R_i − R_j)/√(n k(k+1)/6) on the rank sums, with
 * no tie correction; two-sided P = 2(1 − Φ(|z|)), multiplied by the number of comparisons
 * (Bonferroni, "Dunn's test"), Šidák- or (roadmap 51c) Holm-adjusted, or left uncorrected. This is the test of
 * Siegel & Castellan (1988, §7.2.2) and PMCMRplus::frdAllPairsSiegelTest.
 */
export function dunnFriedmanComparisons(
  res: FriedmanResult,
  pairs: readonly (readonly [number, number])[],
  opts: DunnFriedmanOptions,
): DunnFriedmanRow[] {
  const { n, k } = res
  const m = Math.max(opts.family ?? pairs.length, pairs.length)
  const se = Math.sqrt((n * k * (k + 1)) / 6)
  const raw = pairs.map(([i, j]) => {
    const d = res.rankSums[i]! - res.rankSums[j]!
    const z = d / se
    return { i, j, d, z, p: Number.isNaN(z) ? Number.NaN : 2 * normalSf(Math.abs(z)) }
  })
  const pAdj =
    opts.method === 'none'
      ? raw.map((r) => r.p)
      : adjustP(
          raw.map((r) => r.p),
          opts.method,
          m,
        )
  return raw.map((r, idx) => ({
    i: r.i,
    j: r.j,
    rankSumDiff: r.d,
    meanRankDiff: r.d / n,
    z: r.z,
    p: r.p,
    pAdj: pAdj[idx]!,
  }))
}
