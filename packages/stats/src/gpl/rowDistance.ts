// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The distance kernels of R's dist() and cor(use = "pairwise.complete.obs") between two rows,
 * for the clustered heat maps' row distances (`multivariate/cluster.ts`).
 *
 * Translated from R 4.4.3: src/library/stats/src/distance.c (R_euclidean) and
 * src/library/stats/src/cov.c (COV_PAIRWISE_BODY with cor = TRUE).
 * Copyright (C) The R Core Team and the original authors of those files.
 * Licensed under the GNU General Public License, version 2 or later (GPL-2+).
 *
 * Moved here from `multivariate/cluster.ts` (audit 2, decision 684); the kernels later read
 * the rows from one matrix instead of through a closure (decision 131; audit 2, S11), as R's C
 * reads its matrix: results are bit-identical. Checked against R in oracle suite `cluster`.
 *
 * Both kernels compare rows a and b of `x`, a row-major matrix of p columns (NaN = missing):
 * row r's column j at x[r · p + j].
 */

/** distance.c R_euclidean. */
export function euclidean(x: Float64Array, p: number, a: number, b: number): number {
  let count = 0
  let dist = 0
  const ia = a * p
  const ib = b * p
  for (let j = 0; j < p; j++) {
    const dev = x[ia + j]! - x[ib + j]!
    if (!Number.isNaN(dev)) {
      dist += dev * dev
      count++
    }
  }
  if (count === 0) return Number.NaN
  if (count !== p) dist /= count / p
  return Math.sqrt(dist)
}

/** cov.c COV_PAIRWISE_BODY (cor = TRUE), as 1 − r. */
export function pearson(m: Float64Array, p: number, a: number, b: number): number {
  let nobs = 0
  let xmean = 0
  let ymean = 0
  const ia = a * p
  const ib = b * p
  for (let j = 0; j < p; j++) {
    const x = m[ia + j]!
    const y = m[ib + j]!
    if (!(Number.isNaN(x) || Number.isNaN(y))) {
      nobs++
      xmean += x
      ymean += y
    }
  }
  if (nobs < 2) return Number.NaN
  xmean /= nobs
  ymean /= nobs
  let sum = 0
  let xsd = 0
  let ysd = 0
  for (let j = 0; j < p; j++) {
    const x = m[ia + j]!
    const y = m[ib + j]!
    if (!(Number.isNaN(x) || Number.isNaN(y))) {
      const xm = x - xmean
      const ym = y - ymean
      sum += xm * ym
      xsd += xm * xm
      ysd += ym * ym
    }
  }
  if (xsd === 0 || ysd === 0) return Number.NaN
  const n1 = nobs - 1
  xsd /= n1
  ysd /= n1
  sum /= n1
  sum /= Math.sqrt(xsd) * Math.sqrt(ysd)
  const r = sum >= 1 ? 1 : sum <= -1 ? -1 : sum
  return 1 - r
}
