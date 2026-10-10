// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Brent's root finder exactly as R's uniroot() runs it.
 *
 * Translated from R 4.4.3: src/library/stats/src/zeroin.c (R_zeroin2, itself a C translation
 * of Brent's netlib zeroin), the fcn2 wrapper in src/library/stats/src/optimize.c, and the
 * argument checks of uniroot() in src/library/stats/R/nlm.R.
 * Copyright (C) The R Core Team and the original authors of those files.
 * Licensed under the GNU General Public License, version 2 or later (GPL-2+).
 *
 * Needed so Hodges–Lehmann intervals match wilcox.test() bit for bit: the function being
 * solved there is a step function and R stops at tol = 1e−4, so the answer depends on the
 * exact sequence of iterates.
 */

const DBL_MAX = Number.MAX_VALUE
const EPSILON = Number.EPSILON

/** optimize.c fcn2: non-finite values become ±DBL_MAX (NaN → +DBL_MAX). */
function finite(v: number): number {
  if (Number.isFinite(v)) return v
  return v === Number.NEGATIVE_INFINITY ? -DBL_MAX : DBL_MAX
}

/** zeroin.c R_zeroin2. */
function zeroin2(
  ax: number,
  bx: number,
  faIn: number,
  fbIn: number,
  f: (x: number) => number,
  tol: number,
  maxIter: number,
): number {
  let a = ax
  let b = bx
  let fa = faIn
  let fb = fbIn
  let c = a
  let fc = fa
  let maxit = maxIter + 1
  if (fa === 0) return a
  if (fb === 0) return b
  while (maxit--) {
    const prevStep = b - a
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b
      b = c
      c = a
      fa = fb
      fb = fc
      fc = fa
    }
    const tolAct = 2 * EPSILON * Math.abs(b) + tol / 2
    let newStep = (c - b) / 2
    if (Math.abs(newStep) <= tolAct || fb === 0) return b
    if (Math.abs(prevStep) >= tolAct && Math.abs(fa) > Math.abs(fb)) {
      let p: number
      let q: number
      const cb = c - b
      if (a === c) {
        const t1 = fb / fa
        p = cb * t1
        q = 1 - t1
      } else {
        q = fa / fc
        const t1 = fb / fc
        const t2 = fb / fa
        p = t2 * (cb * q * (q - t1) - (b - a) * (t1 - 1))
        q = (q - 1) * (t1 - 1) * (t2 - 1)
      }
      if (p > 0) q = -q
      else p = -p
      if (p < 0.75 * cb * q - Math.abs(tolAct * q) / 2 && p < Math.abs((prevStep * q) / 2)) {
        newStep = p / q
      }
    }
    if (Math.abs(newStep) < tolAct) newStep = newStep > 0 ? tolAct : -tolAct
    a = b
    fa = fb
    b += newStep
    fb = finite(f(b))
    if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) {
      c = a
      fc = fa
    }
  }
  return b
}

/**
 * uniroot(f, lower, upper, f.lower, f.upper, tol, maxiter = 1000)$root, without interval
 * extension. Returns NaN where R would stop with an error (lower ≥ upper, NA end values, or
 * end values of the same sign).
 */
export function uniroot(
  f: (x: number) => number,
  lower: number,
  upper: number,
  tol: number,
  fLower: number = f(lower),
  fUpper: number = f(upper),
  maxIter = 1000,
): number {
  if (!(lower < upper)) return Number.NaN
  if (Number.isNaN(fLower) || Number.isNaN(fUpper)) return Number.NaN
  const fl = Math.max(Math.min(fLower, DBL_MAX), -DBL_MAX)
  const fu = Math.max(Math.min(fUpper, DBL_MAX), -DBL_MAX)
  if (!(Math.sign(fLower) * Math.sign(fUpper) <= 0)) return Number.NaN
  return zeroin2(lower, upper, fl, fu, f, tol, maxIter)
}
