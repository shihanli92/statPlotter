import { mean, sd } from '../descriptive/basic.ts'
import { cutHeightK, cutreeK } from '../gpl/cutree.ts'
import { type HclustMethod, hclustR } from '../gpl/hclust.ts'
// The distance kernels are translated from R's C code: in gpl/ (audit 2).
import { euclidean, pearson } from '../gpl/rowDistance.ts'

/**
 * Hierarchical clustering of the rows of a matrix, for clustered heat maps: row distances as
 * R's dist() / 1 − cor(), agglomeration as R's hclust(), and row or column z-scores.
 * Missing values are NaN throughout.
 */

/** 'pearson' is 1 − Pearson r between the rows (pairwise-complete observations). */
export type ClusterDistance = 'euclidean' | 'pearson'
/** 'ward' is R's method "ward.D2" (Ward's criterion on squared Euclidean distances). */
export type ClusterLinkage = 'complete' | 'average' | 'ward'

/**
 * Distances between the rows of a matrix (rows[i][j], NaN = missing), in R's dist() order: the
 * lower triangle by column, d(2,1), d(3,1), …, d(n,1), d(3,2), ….
 *
 * - euclidean: R's dist(). The sum of squared differences over the columns both rows have is
 *   scaled by (columns / columns used) before the square root; NaN if no column is shared.
 * - pearson: R's 1 − cor(t(x), use = "pairwise.complete.obs"), same arithmetic (two-pass
 *   means, r clamped to [−1, 1]); NaN with fewer than 2 shared columns or zero variance.
 *
 * Rows shorter than the longest are taken as missing beyond their end.
 */
export function rowDistances(
  rows: readonly ArrayLike<number>[],
  distance: ClusterDistance,
): Float64Array {
  const n = rows.length
  let p = 0
  for (const r of rows) p = Math.max(p, r.length)
  // The rows as one row-major matrix, NaN beyond a row's end.
  const m = new Float64Array(n * p).fill(Number.NaN)
  for (let i = 0; i < n; i++) {
    const r = rows[i]!
    for (let j = 0; j < r.length; j++) m[i * p + j] = r[j]!
  }
  const out = new Float64Array((n * (n - 1)) / 2)
  const dist = distance === 'euclidean' ? euclidean : pearson
  let k = 0
  for (let j = 0; j < n; j++) for (let i = j + 1; i < n; i++) out[k++] = dist(m, p, i, j)
  return out
}

export interface HClust {
  /**
   * R's merge matrix, row by row: negative = singleton (−(i+1) for row i), positive = the
   * cluster formed at that (1-based) step.
   */
  merge: [number, number][]
  /** Height of each merge (non-decreasing for these linkages). */
  height: number[]
  /** Leaf order for drawing (0-based row indices), as R's hc$order − 1. */
  order: number[]
}

const METHOD: Record<ClusterLinkage, HclustMethod> = {
  complete: 'complete',
  average: 'average',
  ward: 'ward.D2',
}

/**
 * R's hclust(d, method) of n objects from their dist vector (as rowDistances): identical merge
 * order, heights, tie-breaking and leaf order. n = 0 and 1 give no merges (order [] / [0]).
 * Throws a RangeError on NaN or infinite distances, or a length other than n(n − 1)/2.
 */
export function hclust(d: ArrayLike<number>, n: number, linkage: ClusterLinkage): HClust {
  if (n < 2) {
    if (d.length !== 0) throw new RangeError('dissimilarities of improper length')
    return { merge: [], height: [], order: n === 1 ? [0] : [] }
  }
  const r = hclustR(d, n, METHOD[linkage])
  return { merge: r.merge, height: r.height, order: r.order.map((i) => i - 1) }
}

/** Roadmap 49c: a tree cut into `k` clusters, or at a height `h`. */
export type TreeCut = { k: number } | { h: number }

/**
 * Roadmap 49c: R's `cutree(hc, k = k)` or `cutree(hc, h = h)` — each object's cluster (by its
 * 0-based index), numbered 1… in the order the objects come, as R numbers them. A cut at a height
 * keeps together every merge at or below it (R's k from h). Throws a RangeError for a k outside
 * 1…n, as R stops.
 */
export function cutree(hc: HClust, cut: TreeCut): number[] {
  const n = hc.order.length
  if (n === 0) return []
  const k = 'k' in cut ? cut.k : cutHeightK(hc.height, cut.h)
  return cutreeK(hc.merge, k)
}

/** Roadmap 49c: the number of clusters a cut leaves (R's k from h; k itself). */
export const cutCount = (hc: HClust, cut: TreeCut): number =>
  'k' in cut ? cut.k : hc.order.length ? cutHeightK(hc.height, cut.h) : 0

/**
 * Z-scores (x − mean) / SD by row or by column (SD with n − 1, over the non-missing values).
 * Missing values (NaN) stay NaN; a row or column whose SD is 0 or undefined (fewer than 2
 * values) is all NaN. Rows shorter than the longest are padded with NaN.
 */
export function zScores(rows: readonly ArrayLike<number>[], by: 'row' | 'column'): number[][] {
  let p = 0
  for (const r of rows) p = Math.max(p, r.length)
  const m = rows.map((r) => Array.from({ length: p }, (_, j) => (j < r.length ? r[j]! : NaN)))
  if (by === 'row') return m.map(standardize)
  return transpose(transpose(m, p).map(standardize), rows.length)
}

function standardize(line: number[]): number[] {
  const vals = line.filter((v) => !Number.isNaN(v))
  const m = mean(vals)
  const s = vals.length < 2 ? Number.NaN : sd(vals)
  return line.map((v) => (s > 0 ? (v - m) / s : Number.NaN))
}

function transpose(m: number[][], cols: number): number[][] {
  return Array.from({ length: cols }, (_, j) => m.map((r) => r[j]!))
}
