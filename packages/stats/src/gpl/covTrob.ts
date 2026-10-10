// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * MASS::cov.trob (the multivariate t estimate of centre and scatter) for two variables, as the
 * graphs' t ellipses use it (`multivariate/ellipse.ts`, ggplot2's stat_ellipse(type = "t")).
 *
 * Translated from MASS 7.3-64 (W. N. Venables and B. D. Ripley, Modern Applied Statistics with
 * S, 4th ed., Springer 2002): R/cov.trob.R, function cov.trob.
 * Copyright (C) W. N. Venables and B. D. Ripley.
 * Licensed under the GNU General Public License, version 2 or 3 (GPL-2 | GPL-3).
 *
 * Moved here from `multivariate/ellipse.ts` (audit 2, decision 684), its weighted sums later
 * taken without closures (decision 131; audit 2, S11): results are bit-identical. Checked against
 * R in oracle suite `ellipse`.
 */

import { sum } from '../summation.ts'

export interface CovTrobOptions {
  /** Degrees of freedom of the t distribution (default 5). */
  nu?: number
  maxit?: number
  tol?: number
}

/**
 * `MASS::cov.trob` for two variables with unit weights: the multivariate t maximum-likelihood
 * estimate of centre and scatter by its fixed-point iteration, step for step as MASS does
 * (initial weights 1 + p/ν; each step the squared Mahalanobis distances Q under the weighted
 * scatter, weights (ν + p)/(ν + Q), the centre re-weighted; stop when no weight moved by `tol`;
 * the scatter from the last step's deviations, divided by n).
 */
export function covTrob(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: CovTrobOptions = {},
): { center: [number, number]; cov: [number, number, number]; iter: number; converged: boolean } {
  const nu = opts.nu ?? 5
  const maxit = opts.maxit ?? 25
  const tol = opts.tol ?? 0.01
  const n = x.length
  const p = 2
  let lx = sum(x) / n
  let ly = sum(y) / n
  let w = new Float64Array(n).fill(1 + p / nu)
  const Q = new Float64Array(n)
  const X = new Float64Array(n)
  const Y = new Float64Array(n)
  const tmp = new Float64Array(n)
  let endit = 0
  for (let iter = 1; iter <= maxit; iter++) {
    const w0 = w
    for (let i = 0; i < n; i++) {
      X[i] = x[i]! - lx
      Y[i] = y[i]! - ly
    }
    // The weighted scatter Σ (wᵢ / Σw) dᵢ dᵢᵀ.
    const sw = sum(w0)
    const a = weightedCross(w0, sw, X, X, tmp)
    const b = weightedCross(w0, sw, X, Y, tmp)
    const c = weightedCross(w0, sw, Y, Y, tmp)
    const det = a * c - b * b
    const next = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      Q[i] = (c * X[i]! * X[i]! - 2 * b * X[i]! * Y[i]! + a * Y[i]! * Y[i]!) / det
      next[i] = (nu + p) / (nu + Q[i]!)
    }
    w = next
    const swn = sum(w)
    for (let i = 0; i < n; i++) tmp[i] = w[i]! * x[i]!
    lx = sum(tmp) / swn
    for (let i = 0; i < n; i++) tmp[i] = w[i]! * y[i]!
    ly = sum(tmp) / swn
    let settled = true
    for (let i = 0; i < n; i++) if (!(Math.abs(w[i]! - w0[i]!) < tol)) settled = false
    if (settled) break
    endit = iter
  }
  let mw = 0
  let mwq = 0
  for (let i = 0; i < n; i++) {
    mw += w[i]!
    mwq += w[i]! * Q[i]!
  }
  const converged =
    endit !== maxit && Math.abs(mw / n - 1) <= tol && Math.abs(mwq / n / p - 1) <= tol
  return {
    center: [lx, ly],
    cov: [
      weightedCross(w, 1, X, X, tmp) / n,
      weightedCross(w, 1, X, Y, tmp) / n,
      weightedCross(w, 1, Y, Y, tmp) / n,
    ],
    iter: endit,
    converged,
  }
}

/** Σ (wᵢ / s) uᵢ vᵢ, summed with compensation (`tmp` holds the terms). */
function weightedCross(
  w: Float64Array,
  s: number,
  u: Float64Array,
  v: Float64Array,
  tmp: Float64Array,
): number {
  for (let i = 0; i < w.length; i++) tmp[i] = (w[i]! / s) * (u[i]! * v[i]!)
  return sum(tmp)
}
