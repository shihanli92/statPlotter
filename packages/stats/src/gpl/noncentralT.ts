// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Noncentral t distribution function, exactly as R's pt(q, df, ncp) computes it.
 *
 * Translated from R 4.4.3: src/nmath/pnt.c (AS 243, R. V. Lenth, "Cumulative distribution
 * function of the non-central t distribution", Applied Statistics 38: 185–189, 1989, with R's
 * modifications: twin series of Guenther 1978, errmax 1e−12, 1000 iterations, the
 * Abramowitz & Stegun 26.7.10 normal approximation for df > 4e5 or ncp² > 2·ln 2·1021).
 * Copyright (C) 1998–2019 The R Core Team; Ross Ihaka and the original authors.
 * Licensed under the GNU General Public License, version 2 or later (GPL-2+).
 *
 * Needed so power calculations match R's power.t.test to machine precision.
 */
import { normalCdf } from '../dist/normal.ts'
import { betaInc } from '../special/beta.ts'
import { lgamma } from '../special/gamma.ts'

const ERRMAX = 1e-12
const ITRMAX = 1000
const M_SQRT_2dPI = 0.7978845608028654 // √(2/π)
const M_LN_SQRT_PI = 0.5723649429247001 // ln √π
const DBL_MIN_EXP = -1021

/** P(T ≤ t) (lowerTail) or P(T > t) for T ~ t(df, ncp). */
export function noncentralTCdf(t: number, df: number, ncp: number, lowerTail = true): number {
  if (!(df > 0)) return Number.NaN
  if (!Number.isFinite(t)) return t < 0 === lowerTail ? 0 : 1
  let negdel: boolean
  let tt: number
  let del: number
  if (t >= 0) {
    negdel = false
    tt = t
    del = ncp
  } else {
    if (ncp > 40 && !lowerTail) return 0
    negdel = true
    tt = -t
    del = -ncp
  }
  const lower = lowerTail !== negdel
  if (df > 4e5 || del * del > 2 * Math.LN2 * -DBL_MIN_EXP) {
    const s = 1 / (4 * df)
    const z = (tt * (1 - s) - del) / Math.sqrt(1 + tt * tt * 2 * s)
    return lower ? normalCdf(z) : normalCdf(-z)
  }
  let x = t * t
  let rxb = df / (x + df)
  x = x / (x + df)
  let tnc: number
  if (x > 0) {
    const lambda = del * del
    let p = 0.5 * Math.exp(-0.5 * lambda)
    if (p === 0) return lower ? 0 : 1
    let q = M_SQRT_2dPI * p * del
    let s = 0.5 - p
    if (s < 1e-7) s = -0.5 * Math.expm1(-0.5 * lambda)
    let a = 0.5
    const b = 0.5 * df
    rxb = rxb ** b
    const albeta = M_LN_SQRT_PI + lgamma(b) - lgamma(0.5 + b)
    let xodd = betaInc(x, a, b)
    let godd = 2 * rxb * Math.exp(a * Math.log(x) - albeta)
    tnc = b * x
    let xeven = tnc < Number.EPSILON ? tnc : 1 - rxb
    let geven = tnc * rxb
    tnc = p * xodd + q * xeven
    for (let it = 1; it <= ITRMAX; it++) {
      a += 1
      xodd -= godd
      xeven -= geven
      godd *= (x * (a + b - 1)) / a
      geven *= (x * (a + b - 0.5)) / (a + 0.5)
      p *= lambda / (2 * it)
      q *= lambda / (2 * it + 1)
      tnc += p * xodd + q * xeven
      s -= p
      if (s < -1e-10) break
      if (s <= 0 && it > 1) break
      const errbd = 2 * s * (xodd - godd)
      if (Math.abs(errbd) < ERRMAX) break
    }
  } else {
    tnc = 0
  }
  tnc += normalCdf(-del)
  const v = Math.min(tnc, 1)
  return lower ? v : 1 - v
}
