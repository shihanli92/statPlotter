import { lgamma } from '../special/gamma.ts'
import { doubledRanks, pooledRanks } from './ranks.ts'

/**
 * Roadmap 51c (S11): the exact P value of the Kruskal–Wallis test, from the permutation
 * distribution of the ranks: every way of dealing the N observed (mid-)ranks into groups of the
 * observed sizes is equally likely under the null hypothesis, and P is the share of those
 * arrangements whose statistic is at least the observed one. With ties the observed mid-ranks
 * are permuted (the distribution conditional on the tie pattern, as the exact tests of coin
 * and StatXact use).
 *
 * The statistic is Σ R_j²/n_j (R_j the rank sum of group j), which orders the arrangements as the
 * tie-corrected H does (N, the ties and the group sizes are fixed). It is evaluated exactly in
 * integers: doubled mid-ranks (whole numbers) and the weights L/n_j, L the least common multiple
 * of the sizes, so arrangements equal to the observed one are counted without rounding doubt.
 *
 * Every arrangement is enumerated (the last group's rank sum follows from the others), so the
 * work grows with the multinomial coefficient N!/∏ n_j!; above `limit` arrangements the exact P
 * isn't computed (null) and the chi-square approximation is the caller's. Empty groups are left
 * out, as the test leaves them out.
 */

/** About this many arrangements are enumerated in well under a second (timing guard). */
export const KW_EXACT_LIMIT = 2e7

/** N!/∏ n_j! (in floating point; rounded). */
export function arrangements(sizes: readonly number[]): number {
  const N = sizes.reduce((a, b) => a + b, 0)
  let l = lgamma(N + 1)
  for (const n of sizes) l -= lgamma(n + 1)
  return Math.round(Math.exp(l))
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

export interface KruskalExact {
  /** P(statistic ≥ observed) over all arrangements. */
  p: number
  /** The number of arrangements enumerated. */
  arrangements: number
}

export function kruskalWallisExact(
  groups: readonly ArrayLike<number>[],
  limit = KW_EXACT_LIMIT,
): KruskalExact | null {
  const used = groups.filter((g) => g.length > 0)
  const k = used.length
  if (k < 2) return null
  const sizes = used.map((g) => g.length)
  const total = arrangements(sizes)
  if (!(total <= limit)) return null
  const { ranks } = pooledRanks(used)
  const r = doubledRanks(ranks)
  const N = r.length
  const L = sizes.reduce((a, b) => (a * b) / gcd(a, b), 1)
  const w = sizes.map((n) => L / n)
  // The observed statistic.
  let tObs = 0
  let o = 0
  sizes.forEach((n, j) => {
    let s = 0
    for (let i = 0; i < n; i++) s += r[o++]!
    tObs += w[j]! * s * s
  })
  let rTotal = 0
  for (let i = 0; i < N; i++) rTotal += r[i]!

  let hits = 0
  let leaves = 0
  // Pools of the ranks still to deal, one per depth (group).
  const pools = sizes.map(() => new Int32Array(N))
  pools[0]!.set(r)
  const idxs = sizes.map((n) => new Int32Array(n))
  const chosen = new Uint8Array(N)

  /** Deals group g from pools[g] (length m, sum `left`), the earlier groups adding `acc`. */
  const deal = (g: number, m: number, left: number, acc: number): void => {
    const pool = pools[g]!
    const n = sizes[g]!
    const last = g === k - 2
    const wg = w[g]!
    const wl = w[k - 1]!
    const idx = idxs[g]!
    // Combinations of n of the m pool positions, in lexicographic order, with running sums.
    for (let i = 0; i < n; i++) idx[i] = i
    let s = 0
    for (let i = 0; i < n; i++) s += pool[i]!
    for (;;) {
      if (last) {
        const rest = left - s
        if (acc + wg * s * s + wl * rest * rest >= tObs) hits++
        leaves++
      } else {
        // The complement of the chosen positions is the next group's pool.
        chosen.fill(0, 0, m)
        for (let i = 0; i < n; i++) chosen[idx[i]!] = 1
        const next = pools[g + 1]!
        let q = 0
        for (let i = 0; i < m; i++) if (!chosen[i]) next[q++] = pool[i]!
        deal(g + 1, q, left - s, acc + wg * s * s)
      }
      // Next combination: the rightmost index that can move.
      let i = n - 1
      while (i >= 0 && idx[i] === m - n + i) i--
      if (i < 0) break
      s -= pool[idx[i]!]!
      idx[i]!++
      s += pool[idx[i]!]!
      for (let j = i + 1; j < n; j++) {
        s -= pool[idx[j]!]!
        idx[j] = idx[j - 1]! + 1
        s += pool[idx[j]!]!
      }
    }
  }
  deal(0, N, rTotal, 0)
  return { p: hits / leaves, arrangements: leaves }
}
