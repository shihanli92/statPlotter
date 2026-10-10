/**
 * Exact permutation distributions of rank statistics, valid with ties.
 *
 * Scores are integers (callers pass doubled mid-ranks, so ties with .5 ranks stay integral).
 * The distributions are built by dynamic programming over the observations — the counting
 * behind the Streitberg & Röhmel (1986) shift algorithm, which coin uses. Counts are doubles:
 * exact up to 2^53, and beyond that carry ~1e−16 relative rounding per addition, which is far
 * below what matters for a P value.
 *
 * Cost: rank sum O(N · k · S) time and O(k · S) memory with k = min group size and S the total
 * score (≈ N²), which is fast for N ≤ a few hundred; signed rank O(n · S).
 */

import type { Alternative } from '../tests/common.ts'

/** Greatest common divisor of integers (Euclid). */
export function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}

/** Divides integer scores by their common divisor (smaller DP tables; e.g. 2 when untied). */
function reduce(scores: ArrayLike<number>): { s: Int32Array; g: number } {
  let g = 0
  for (let i = 0; i < scores.length; i++) g = gcd(g, scores[i]!)
  if (g === 0) g = 1
  const s = new Int32Array(scores.length)
  for (let i = 0; i < scores.length; i++) s[i] = scores[i]! / g
  return { s, g }
}

/**
 * Number of size-k subsets of `scores` with each total s (index = s). Scores must be
 * non-negative integers.
 */
function subsetSumCounts(scores: ArrayLike<number>, k: number): Float64Array {
  let total = 0
  for (let i = 0; i < scores.length; i++) total += scores[i]!
  const rows: Float64Array[] = []
  const reach: number[] = []
  for (let j = 0; j <= k; j++) {
    rows.push(new Float64Array(total + 1))
    reach.push(-1)
  }
  rows[0]![0] = 1
  reach[0] = 0
  for (let i = 0; i < scores.length; i++) {
    const w = scores[i]!
    for (let j = Math.min(i + 1, k); j >= 1; j--) {
      const prev = rows[j - 1]!
      const r = reach[j - 1]!
      if (r < 0) continue
      const cur = rows[j]!
      for (let s = r; s >= 0; s--) {
        const c = prev[s]!
        if (c !== 0) cur[s + w] += c
      }
      if (r + w > reach[j]!) reach[j] = r + w
    }
  }
  return rows[k]!
}

/** Number of subsets (of any size) of `scores` with each total s. */
function anySubsetSumCounts(scores: ArrayLike<number>): Float64Array {
  let total = 0
  for (let i = 0; i < scores.length; i++) total += scores[i]!
  const c = new Float64Array(total + 1)
  c[0] = 1
  let reach = 0
  for (let i = 0; i < scores.length; i++) {
    const w = scores[i]!
    for (let s = reach; s >= 0; s--) if (c[s] !== 0) c[s + w] += c[s]!
    reach += w
  }
  return c
}

/**
 * Tail probability of a statistic S with null counts `counts` (index = value, total `n`):
 * 'greater' P(S ≥ obs), 'less' P(S ≤ obs), two-sided P(|S − E| ≥ |obs − E|) (as coin, which
 * also handles the asymmetric null distributions that ties produce). E is given as
 * num/den so the comparison stays in exact integer arithmetic: |den·S − num| ≥ |den·obs − num|.
 * Sums run from the extreme inwards so tiny tails keep relative accuracy.
 */
function tailP(
  counts: Float64Array,
  obs: number,
  num: number,
  den: number,
  alternative: Alternative,
): number {
  let total = 0
  for (let s = 0; s < counts.length; s++) total += counts[s]!
  let acc = 0
  if (alternative === 'greater') {
    for (let s = counts.length - 1; s >= obs; s--) acc += counts[s]!
  } else if (alternative === 'less') {
    for (let s = 0; s <= obs; s++) acc += counts[s]!
  } else {
    const d = Math.abs(den * obs - num)
    if (d === 0) return 1
    for (let s = 0; s < counts.length && den * s <= num; s++) {
      if (Math.abs(den * s - num) >= d) acc += counts[s]!
    }
    for (let s = counts.length - 1; s >= 0 && den * s > num; s--) {
      if (Math.abs(den * s - num) >= d) acc += counts[s]!
    }
  }
  return Math.min(1, acc / total)
}

/**
 * Exact P value of a two-sample rank-sum statistic. `scores` holds the (integer, e.g. doubled
 * mid-rank) scores of all N = nA + nB observations; `inB[i]` marks group B. 'greater' is the
 * alternative that B's scores are larger.
 */
export function rankSumExactP(
  scores: ArrayLike<number>,
  inB: ArrayLike<boolean>,
  alternative: Alternative,
): number {
  const N = scores.length
  const { s } = reduce(scores)
  let nB = 0
  let sumB = 0
  let tot = 0
  for (let i = 0; i < N; i++) {
    tot += s[i]!
    if (inB[i]) {
      nB++
      sumB += s[i]!
    }
  }
  // Enumerate the smaller group; S_A = tot − S_B.
  const useB = nB <= N - nB
  const k = useB ? nB : N - nB
  const obs = useB ? sumB : tot - sumB
  const counts = subsetSumCounts(s, k)
  let alt = alternative
  if (!useB && alternative !== 'two-sided') alt = alternative === 'greater' ? 'less' : 'greater'
  // E[S_k] = k · tot / N
  return tailP(counts, obs, k * tot, N, alt)
}

/**
 * Exact P value of the signed-rank statistic: `scores` are the (integer) scores of the
 * non-zero differences, `positive[i]` whether difference i is > 0. Under H0 each sign is ±
 * with probability ½ independently. 'greater' is the alternative of a positive location.
 */
export function signedRankExactP(
  scores: ArrayLike<number>,
  positive: ArrayLike<boolean>,
  alternative: Alternative,
): number {
  const { s } = reduce(scores)
  let obs = 0
  let tot = 0
  for (let i = 0; i < s.length; i++) {
    tot += s[i]!
    if (positive[i]) obs += s[i]!
  }
  const counts = anySubsetSumCounts(s)
  // E[S] = tot / 2
  return tailP(counts, obs, tot, 2, alternative)
}

/** Counts of the Mann–Whitney U statistic (0..mn) for untied samples of sizes m and n. */
export function wilcoxonCounts(m: number, n: number): Float64Array {
  const ranks = new Int32Array(m + n)
  for (let i = 0; i < m + n; i++) ranks[i] = i + 1
  const k = Math.min(m, n)
  const c = subsetSumCounts(ranks, k)
  const offset = (k * (k + 1)) / 2
  return c.slice(offset, offset + m * n + 1)
}

/** Counts of the signed-rank statistic V (0..n(n+1)/2) for n untied non-zero differences. */
export function signedRankCounts(n: number): Float64Array {
  const ranks = new Int32Array(n)
  for (let i = 0; i < n; i++) ranks[i] = i + 1
  return anySubsetSumCounts(ranks)
}
