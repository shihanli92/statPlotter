// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Cutting a hierarchical clustering's tree into groups exactly as R's cutree() does.
 *
 * Translated from R 4.4.3: src/library/stats/src/hclust-utils.c (cutree, the C routine) and the
 * driver cutree() in src/library/stats/R/hclust.R (k from h).
 * Copyright (C) The R Core Team and the original authors of those files.
 * Licensed under the GNU General Public License, version 2 or later (GPL-2+).
 *
 * Roadmap 49c (a dendrogram layer's cut). Checked against R in oracle suite `cutree`.
 */

/**
 * R's k for a cut at height h (cutree's `k <- n + 1 - which.max(c(height, Inf) > h)`): the
 * number of clusters left when every merge at or below h is made. `height` is the n − 1 merge
 * heights in merge order (R refuses unsorted heights; those of complete, average and Ward
 * linkage are non-decreasing).
 */
export function cutHeightK(height: readonly number[], h: number): number {
  const n = height.length + 1
  let i = 0
  while (i < height.length && !(height[i]! > h)) i++
  // which.max is 1-based: the first merge above h is i + 1; Inf above every h when none is.
  return n + 1 - (i + 1)
}

/**
 * hclust-utils.c cutree() for one k (1 ≤ k ≤ n): each of the n objects' cluster, numbered 1…k in
 * the order the objects come (object 1's cluster is 1, the next object of another cluster 2…).
 * `merge` is R's merge matrix by rows (−i: object i, +j: the cluster of step j).
 */
export function cutreeK(merge: readonly (readonly [number, number])[], k: number): number[] {
  const n = merge.length + 1
  if (!Number.isInteger(k) || k < 1 || k > n)
    throw new RangeError(`elements of 'k' must be between 1 and ${n}`)
  // 1-based, as the C code (index 0 unused).
  const sing = new Uint8Array(n + 1).fill(1)
  const mNr = new Int32Array(n + 1)
  const z = new Int32Array(n + 1)
  const ans = new Array<number>(n)
  if (k === n) {
    // which[] == n: "merging" nothing.
    for (let l = 1; l <= n; l++) ans[l - 1] = l
    return ans
  }
  for (let step = 1; step <= n - 1; step++) {
    let m1 = merge[step - 1]![0]
    const m2 = merge[step - 1]![1]
    if (m1 < 0 && m2 < 0) {
      mNr[-m1] = step
      mNr[-m2] = step
      sing[-m1] = 0
      sing[-m2] = 0
    } else if (m1 < 0 || m2 < 0) {
      let j: number
      if (m1 < 0) {
        j = -m1
        m1 = m2
      } else j = -m2
      for (let l = 1; l <= n; l++) if (mNr[l] === m1) mNr[l] = step
      mNr[j] = step
      sing[j] = 0
    } else {
      for (let l = 1; l <= n; l++) if (mNr[l] === m1 || mNr[l] === m2) mNr[l] = step
    }
    if (k === n - step) {
      z.fill(0)
      let nclust = 0
      for (let l = 1; l <= n; l++) {
        if (sing[l]) ans[l - 1] = ++nclust
        else {
          if (z[mNr[l]!] === 0) z[mNr[l]!] = ++nclust
          ans[l - 1] = z[mNr[l]!]!
        }
      }
      return ans
    }
  }
  return ans
}
