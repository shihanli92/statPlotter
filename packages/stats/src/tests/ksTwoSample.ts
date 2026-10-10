import { kolmogorovSf } from '../dist/kolmogorov.ts'

/**
 * Prism uses the exact permutation P when the number of ways of choosing n1 values out of
 * n1 + n2 is below this (Prism Statistics Guide, "Interpreting results: Kolmogorov-Smirnov
 * test": exact "when the number of permutations of n1 values from n1+n2 values is less than
 * 60,000").
 */
const KS_EXACT_MAX_COMBINATIONS = 60000

export interface KsTwoSampleOptions {
  /** 'auto' (default) follows Prism's C(n1 + n2, n1) < 60000 rule. */
  exact?: 'auto' | boolean
}

export interface KsTwoSampleResult {
  /** Largest distance between the two empirical CDFs. */
  d: number
  /** Two-sided P (the KS test has no one-sided form in Prism). */
  p: number
  exact: boolean
  nA: number
  nB: number
}

function choose(n: number, k: number): number {
  let c = 1
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i
  return Math.round(c)
}

/**
 * Two-sample Kolmogorov–Smirnov test (compare cumulative distributions), as Prism computes it:
 *
 * - D = max_x |F_A(x) − F_B(x)|, evaluated after each distinct value (ties handled).
 * - Exact P (small samples, see KS_EXACT_MAX_COMBINATIONS): the fraction of the C(N, nA)
 *   reassignments of the pooled data to the two groups whose D is ≥ the observed D (Prism:
 *   "systematically shuffles the actual data between two groups … The P value it reports is the
 *   fraction of these reshuffled data sets where the D computed … is greater than or equal
 *   than the D computed from the actual data"). With ties this is the conditional distribution
 *   given the tie pattern, as R's psmirnov(exact = TRUE, z = pooled data) (R ≥ 4.3). Computed by
 *   counting monotone lattice paths that stay strictly inside the band |i·nB − j·nA| < D·nA·nB
 *   at every point where the pooled sorted data change value; all arithmetic is in integers.
 * - Otherwise the asymptotic P of Numerical Recipes (3rd ed., §14.3.3, which Prism cites):
 *   Q_KS((√Ne + 0.12 + 0.11/√Ne)·D), Ne = nA nB/(nA + nB) (Stephens' 1970 small-sample
 *   correction). R's ks.test(exact = FALSE) uses Q_KS(√Ne·D) without the correction.
 *
 * An empty group gives NaN.
 */
export function kolmogorovSmirnovTwoSample(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  opts: KsTwoSampleOptions = {},
): KsTwoSampleResult {
  const nA = a.length
  const nB = b.length
  if (nA === 0 || nB === 0) return { d: Number.NaN, p: Number.NaN, exact: false, nA, nB }
  const N = nA + nB
  // Pooled values with group labels, sorted; `last[k]` marks the last of a run of equal values.
  const idx = Array.from({ length: N }, (_, i) => i)
  const val = (i: number) => (i < nA ? a[i]! : b[i - nA]!)
  idx.sort((i, j) => val(i) - val(j))
  const inA = idx.map((i) => i < nA)
  const last = idx.map((i, k) => k === N - 1 || val(idx[k + 1]!) !== val(i))
  // Observed D in integer units of 1/(nA nB).
  let i = 0
  let j = 0
  let dInt = 0
  for (let k = 0; k < N; k++) {
    if (inA[k]) i++
    else j++
    if (last[k]) dInt = Math.max(dInt, Math.abs(i * nB - j * nA))
  }
  const d = dInt / (nA * nB)
  const exact =
    opts.exact === undefined || opts.exact === 'auto'
      ? choose(N, Math.min(nA, nB)) < KS_EXACT_MAX_COMBINATIONS
      : opts.exact
  let p: number
  if (exact) {
    p = exactP(nA, nB, last, dInt)
  } else {
    const en = Math.sqrt((nA * nB) / N)
    p = kolmogorovSf((en + 0.12 + 0.11 / en) * d)
  }
  return { d, p, exact, nA, nB }
}

/**
 * P(D ≥ dInt/(m n)) under random assignment: 1 − (paths inside the band)/C(m + n, m). Counts
 * are exact integers while C(m + n, m)·(m + n) < 2^53; above that they are carried as probabilities
 * (each count divided by C(i + j, i)), accurate to rounding.
 */
function exactP(m: number, n: number, last: readonly boolean[], dInt: number): number {
  if (dInt === 0) return 1
  // choose() is exact while every intermediate product stays below 2^53.
  const useCounts = choose(m + n, m) * (m + n) < 2 ** 53
  // u[j] holds the count (or probability) for the current i and each j.
  const u = new Float64Array(n + 1)
  const inside = (i: number, j: number) =>
    i + j === 0 || !last[i + j - 1] || Math.abs(i * n - j * m) < dInt
  for (let j = 0; j <= n; j++) u[j] = j === 0 || (inside(0, j) && u[j - 1]! > 0) ? 1 : 0
  for (let i = 1; i <= m; i++) {
    u[0] = inside(i, 0) ? u[0]! : 0
    for (let j = 1; j <= n; j++) {
      if (!inside(i, j)) u[j] = 0
      else if (useCounts) u[j] = u[j]! + u[j - 1]!
      else u[j] = (u[j]! * i) / (i + j) + (u[j - 1]! * j) / (i + j)
    }
  }
  if (useCounts) {
    const total = choose(m + n, m)
    return (total - u[n]!) / total
  }
  return Math.max(0, 1 - u[n]!)
}
