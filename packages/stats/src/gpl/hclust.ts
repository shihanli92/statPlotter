// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Agglomerative hierarchical clustering exactly as R's hclust() runs it.
 *
 * Translated from R 4.4.3: src/library/stats/src/hclust.f (subroutines HCLUST, IOFFST and
 * HCASS2; F. Murtagh 1986 and 1991, modifications for R by Ross Ihaka, Fritz Leisch and
 * Martin Maechler, nearest-neighbour fix by JB) and the driver hclust() in
 * src/library/stats/R/hclust.R.
 * Copyright (C) The R Core Team and the original authors of those files.
 * Licensed under the GNU General Public License, version 2 or later (GPL-2+).
 *
 * Nearest-neighbour-list Lance–Williams updates. Ties are broken as in the Fortran: the first
 * pair (in row order of the lower triangle) with the least dissimilarity is merged, so merge
 * order, heights and the dendrogram order match R's exactly. Only the criteria we offer are
 * translated: complete (iOpt 3), average (4) and ward.D2 (8; the Fortran squares the
 * dissimilarities, runs Ward's update on them and reports the square roots as heights).
 */

/** R's iOpt codes. */
export type HclustMethod = 'complete' | 'average' | 'ward.D2'

const IOPT: Record<HclustMethod, number> = { complete: 3, average: 4, 'ward.D2': 8 }

/** hclust.f DATA INF/1.D+300/. */
const INF = 1e300

export interface HclustRaw {
  /** R's hc$merge rows. */
  merge: [number, number][]
  height: number[]
  /** R's hc$order (1-based). */
  order: number[]
}

/**
 * R's hclust(d, method) for a dist vector `d` of n objects (lower triangle by column, as
 * dist()). `d` is not modified. Needs n ≥ 2 and finite dissimilarities (R stops on NA/NaN/Inf).
 */
export function hclustR(d: ArrayLike<number>, n: number, method: HclustMethod): HclustRaw {
  const len = (n * (n - 1)) / 2
  if (n < 2) throw new RangeError('hclust needs at least 2 objects')
  if (d.length !== len) throw new RangeError('dissimilarities of improper length')
  const diss = Float64Array.from(d)
  for (let i = 0; i < len; i++) {
    if (!Number.isFinite(diss[i]!)) throw new RangeError('non-finite dissimilarity')
  }
  const ia = new Int32Array(n + 1)
  const ib = new Int32Array(n + 1)
  const crit = new Float64Array(n + 1)
  hclustFortran(n, IOPT[method], ia, ib, crit, diss)
  const { iia, iib, order } = hcass2(n, ia, ib)
  const merge: [number, number][] = []
  const height: number[] = []
  for (let i = 1; i < n; i++) {
    merge.push([iia[i]!, iib[i]!])
    height.push(crit[i]!)
  }
  return { merge, height, order: Array.from(order.subarray(1, n + 1)) }
}

/** IOFFST(N,I,J) (1-based I < J), minus 1 for the 0-based array. */
function ioffst(n: number, i: number, j: number): number {
  return j + (i - 1) * n - (i * (i + 1)) / 2 - 1
}

/** SUBROUTINE HCLUST, with MEMBR = rep(1, N). Arrays are 1-based (index 0 unused). */
function hclustFortran(
  n: number,
  iOpt: number,
  ia: Int32Array,
  ib: Int32Array,
  crit: Float64Array,
  diss: Float64Array,
): void {
  const membr = new Float64Array(n + 1).fill(1)
  const nn = new Int32Array(n + 1)
  const disnn = new Float64Array(n + 1)
  const flag = new Uint8Array(n + 1).fill(1)
  let im = 0
  let jj = 0
  let jm = 0
  let ncl = n
  const len = diss.length

  if (iOpt === 8) for (let i = 0; i < len; i++) diss[i] = diss[i]! * diss[i]!

  // List of nearest neighbours to the right of each I.
  for (let i = 1; i <= n - 1; i++) {
    let dmin = INF
    for (let j = i + 1; j <= n; j++) {
      const ind = ioffst(n, i, j)
      if (dmin > diss[ind]!) {
        dmin = diss[ind]!
        jm = j
      }
    }
    nn[i] = jm
    disnn[i] = dmin
  }

  const isWard = iOpt === 1 || iOpt === 8
  do {
    // Least dissimilarity in the list of NNs.
    let dmin = INF
    for (let i = 1; i <= n - 1; i++) {
      if (flag[i] && disnn[i]! < dmin) {
        dmin = disnn[i]!
        im = i
        jm = nn[i]!
      }
    }
    ncl--

    const i2 = Math.min(im, jm)
    const j2 = Math.max(im, jm)
    ia[n - ncl] = i2
    ib[n - ncl] = j2
    if (iOpt === 8) dmin = Math.sqrt(dmin)
    crit[n - ncl] = dmin
    flag[j2] = 0

    // Update dissimilarities from the new cluster.
    dmin = INF
    for (let k = 1; k <= n; k++) {
      if (flag[k] && k !== i2) {
        const ind1 = i2 < k ? ioffst(n, i2, k) : ioffst(n, k, i2)
        const ind2 = j2 < k ? ioffst(n, j2, k) : ioffst(n, k, j2)
        const d12 = diss[ioffst(n, i2, j2)]!
        if (isWard) {
          diss[ind1] =
            (membr[i2]! + membr[k]!) * diss[ind1]! +
            (membr[j2]! + membr[k]!) * diss[ind2]! -
            membr[k]! * d12
          diss[ind1] = diss[ind1]! / (membr[i2]! + membr[j2]! + membr[k]!)
        } else if (iOpt === 3) {
          diss[ind1] = Math.max(diss[ind1]!, diss[ind2]!)
        } else if (iOpt === 4) {
          diss[ind1] =
            (membr[i2]! * diss[ind1]! + membr[j2]! * diss[ind2]!) / (membr[i2]! + membr[j2]!)
        }
        if (i2 < k) {
          if (diss[ind1]! < dmin) {
            dmin = diss[ind1]!
            jj = k
          }
        } else if (diss[ind1]! < disnn[k]!) {
          // JB's fix: the nearest neighbour of k may now be i2.
          disnn[k] = diss[ind1]!
          nn[k] = i2
        }
      }
    }
    membr[i2] = membr[i2]! + membr[j2]!
    disnn[i2] = dmin
    nn[i2] = jj

    // Update the list of NNs insofar as required.
    for (let i = 1; i <= n - 1; i++) {
      if (flag[i] && (nn[i] === i2 || nn[i] === j2)) {
        let dm = INF
        for (let j = i + 1; j <= n; j++) {
          if (flag[j]) {
            const ind = ioffst(n, i, j)
            if (diss[ind]! < dm) {
              dm = diss[ind]!
              jj = j
            }
          }
        }
        nn[i] = jj
        disnn[i] = dm
      }
    }
  } while (ncl > 1)
}

/** SUBROUTINE HCASS2: R's merge coding and the dendrogram order. 1-based arrays. */
function hcass2(
  n: number,
  ia: Int32Array,
  ib: Int32Array,
): { iia: Int32Array; iib: Int32Array; order: Int32Array } {
  const iia = Int32Array.from(ia)
  const iib = Int32Array.from(ib)
  const iorder = new Int32Array(n + 2)
  // Clusters were coded by their lowest member; R codes singletons as negative numbers and
  // clusters by the step that formed them.
  for (let i = 1; i <= n - 2; i++) {
    const k = Math.min(ia[i]!, ib[i]!)
    for (let j = i + 1; j <= n - 1; j++) {
      if (ia[j] === k) iia[j] = -i
      if (ib[j] === k) iib[j] = -i
    }
  }
  for (let i = 1; i <= n - 1; i++) {
    iia[i] = -iia[i]!
    iib[i] = -iib[i]!
  }
  for (let i = 1; i <= n - 1; i++) {
    if (iia[i]! > 0 && iib[i]! < 0) {
      const k = iia[i]!
      iia[i] = iib[i]!
      iib[i] = k
    }
    if (iia[i]! > 0 && iib[i]! > 0) {
      const k1 = Math.min(iia[i]!, iib[i]!)
      const k2 = Math.max(iia[i]!, iib[i]!)
      iia[i] = k1
      iib[i] = k2
    }
  }

  // Order: expand the last merge, replacing each cluster by its two parts in place.
  iorder[1] = iia[n - 1]!
  iorder[2] = iib[n - 1]!
  let loc = 2
  for (let i = n - 2; i >= 1; i--) {
    for (let j = 1; j <= loc; j++) {
      if (iorder[j] === i) {
        iorder[j] = iia[i]!
        if (j === loc) {
          loc++
          iorder[loc] = iib[i]!
        } else {
          loc++
          for (let k = loc; k >= j + 2; k--) iorder[k] = iorder[k - 1]!
          iorder[j + 1] = iib[i]!
        }
        break
      }
    }
  }
  for (let i = 1; i <= n; i++) iorder[i] = -iorder[i]!
  return { iia, iib, order: iorder }
}
