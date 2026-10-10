/**
 * Mid-ranks (1-based; tied values share the average of their ranks), as R's rank() with
 * ties.method = "average", plus the tie term Σ(t³ − t) over groups of t tied values.
 */
export function midranks(x: ArrayLike<number>): { ranks: Float64Array; tieSum: number } {
  const n = x.length
  const idx = Array.from({ length: n }, (_, i) => i)
  idx.sort((i, j) => x[i]! - x[j]!)
  const ranks = new Float64Array(n)
  let tieSum = 0
  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && x[idx[j + 1]!]! === x[idx[i]!]!) j++
    const r = (i + j + 2) / 2
    for (let k = i; k <= j; k++) ranks[idx[k]!] = r
    const t = j - i + 1
    tieSum += t * t * t - t
    i = j + 1
  }
  return { ranks, tieSum }
}

/**
 * All groups ranked together (midranks): group sizes n, total N, the pooled ranks (groups in
 * order), the tie term, and each group's mean rank (NaN for an empty group).
 */
export function pooledRanks(groups: readonly ArrayLike<number>[]) {
  const n = groups.map((g) => g.length)
  const N = n.reduce((s, x) => s + x, 0)
  const pooled = new Float64Array(N)
  let o = 0
  for (const g of groups) for (let i = 0; i < g.length; i++) pooled[o++] = g[i]!
  const { ranks, tieSum } = midranks(pooled)
  const meanRanks: number[] = []
  o = 0
  for (const g of groups) {
    let s = 0
    for (let i = 0; i < g.length; i++) s += ranks[o++]!
    meanRanks.push(s / g.length)
  }
  return { n, N, ranks, tieSum, meanRanks }
}

/** Mid-ranks doubled, as the integer scores of the exact rank distributions. */
export function doubledRanks(ranks: ArrayLike<number>): Int32Array {
  const out = new Int32Array(ranks.length)
  for (let i = 0; i < ranks.length; i++) out[i] = Math.round(2 * ranks[i]!)
  return out
}
