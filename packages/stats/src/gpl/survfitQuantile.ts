// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The median (and its confidence limits) of a Kaplan–Meier curve exactly as R's
 * quantile.survfit finds them.
 *
 * Translated from the R package survival 3.8-3 (T. Therneau): R/quantile.survfit.R, the
 * internal function findq. Copyright (C) Terry M Therneau and contributors. Licensed under the
 * GNU Lesser General Public License, version 2 or later (LGPL-2+).
 */

/** R's quantile.survfit tolerance, √ε. */
const TOL = Math.sqrt(Number.EPSILON)

/**
 * Time at which a cumulative curve y (1 − S, or 1 − a CI limit; NaN where undefined) first
 * reaches p, as R's survival:::findq: duplicated levels are dropped (keeping the first time a
 * level is reached); the answer is the first time with y ≥ p − tol, averaged with the first
 * time with y ≥ p + tol (so a curve that sits exactly at p between two times gives their
 * midpoint, and one that ends there gives the midpoint with the last time). NaN if the curve
 * never reaches p.
 */
export function findQuantile(time: readonly number[], y: readonly number[], p: number): number {
  let max = Number.NEGATIVE_INFINITY
  for (const v of y) if (v > max) max = v
  if (!(max >= p)) return Number.NaN
  const xmax = time[time.length - 1]!
  const xs: number[] = []
  const ys: number[] = []
  const seen = new Set<number>() // SameValueZero: NaN is a duplicate of NaN, as in R
  for (let k = 0; k < y.length; k++) {
    const v = y[k]!
    if (seen.has(v)) continue
    seen.add(v)
    xs.push(time[k]!)
    ys.push(v)
  }
  // approx(y ± tol, index, p, method = "constant", f = 1) on the non-NaN points, which it
  // sorts by y: the index of the smallest y ± tol that is ≥ p (NaN if p is outside the range).
  const idx = (shift: number): number => {
    let best = -1
    let min = Number.POSITIVE_INFINITY
    let lo = Number.POSITIVE_INFINITY
    for (let k = 0; k < ys.length; k++) {
      const v = ys[k]! + shift
      if (Number.isNaN(v)) continue
      if (v < lo) lo = v
      if (v >= p && v < min) {
        min = v
        best = k
      }
    }
    return p < lo ? -1 : best
  }
  const i1 = idx(TOL)
  const i2 = idx(-TOL)
  let q = i1 >= 0 && i2 >= 0 ? (xs[i1]! + xs[i2]!) / 2 : Number.NaN
  const last = ys[ys.length - 1]!
  if (!Number.isNaN(last) && Math.abs(p - last) < TOL) {
    q = i1 >= 0 ? (xs[i1]! + xmax) / 2 : Number.NaN
  }
  return q
}
