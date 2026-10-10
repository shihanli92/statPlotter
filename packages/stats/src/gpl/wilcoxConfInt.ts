// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Hodges–Lehmann estimates and confidence intervals exactly as R's wilcox.test(conf.int = TRUE)
 * computes them.
 *
 * Translated from R 4.4.3: src/library/stats/R/wilcox.test.R (wilcox.test.default: the
 * `conf.int` branches of the one-sample / paired and two-sample tests), and the quantile
 * searches of qwilcox() in src/nmath/wilcox.c, qsignrank() in src/nmath/signrank.c and
 * choose() in src/nmath/choose.c.
 * Copyright (C) The R Core Team and the original authors of those files.
 * Licensed under the GNU General Public License, version 2 or later (GPL-2+).
 *
 * Two methods, chosen as R chooses them:
 * - exact (requested exact, no ties, and for one-sample no zeros): order statistics of the
 *   pairwise differences (two-sample) or Walsh averages (one-sample), with the index from the
 *   exact null distribution (Bauer 1972); estimate = their median.
 * - otherwise: the normal approximation to the (tie-corrected) rank statistic as a function of
 *   the shift d, inverted with uniroot(tol = 1e−4). Note the estimate is then that root (at
 *   zq = 0, no continuity correction), not the median of the differences, and is only
 *   accurate to ~1e−4 — this is R's behaviour, reproduced exactly.
 */

import { normalQuantile } from '../dist/normal.ts'
import { signedRankCounts, wilcoxonCounts } from '../dist/rankExact.ts'
import { lbeta } from '../special/gamma.ts'
import type { Alternative } from '../tests/common.ts'
import { midranks } from '../tests/ranks.ts'
import { uniroot } from './zeroin.ts'

export interface HodgesLehmann {
  estimate: number
  lo: number
  hi: number
}

export interface ConfIntOptions {
  /** Use the exact method (callers pass R's condition: exact requested and no ties/zeros). */
  exact: boolean
  correct: boolean
  alternative: Alternative
  confLevel: number
}

const TOL_ROOT = 1e-4
const DBL_EPSILON = Number.EPSILON

/** R's median() of a numeric vector (sorts a copy). */
function rMedian(v: ArrayLike<number>): number {
  const s = Float64Array.from(v).sort()
  const n = s.length
  if (n === 0) return Number.NaN
  const half = (n + 1) >> 1
  if (n % 2 === 1) return s[half - 1]!
  return (s[half - 1]! + s[half]!) / 2
}

/** nmath choose(n, k) for integer n ≥ 0, including its rounding for k ≥ 30. */
function rChoose(n: number, k0: number): number {
  let k = k0
  if (k < 30) {
    if (n - k < k) k = n - k
    if (k < 0) return 0
    if (k === 0) return 1
    let r = n
    for (let j = 2; j <= k; j++) r *= (n - j + 1) / j
    return Math.round(r)
  }
  if (n < k) return 0
  if (n - k < 30) return rChoose(n, n - k)
  // lfastchoose(n, k) = −log(n + 1) − lbeta(n − k + 1, k + 1)
  return Math.round(Math.exp(-Math.log(n + 1) - lbeta(n - k + 1, k + 1)))
}

/** Quantile search shared by qwilcox / qsignrank (lower tail, non-log). */
function discreteQuantile(p: number, prob: (q: number) => number, top: number): number {
  let cum = 0
  let q = 0
  if (p <= 0.5) {
    const x = p - 10 * DBL_EPSILON
    for (; q < top; q++) {
      cum += prob(q)
      if (cum >= x) return q
    }
    return top
  }
  const x = 1 - p + 10 * DBL_EPSILON
  for (; q < top; q++) {
    cum += prob(q)
    if (cum > x) return top - q
  }
  return 0
}

/** qwilcox(p, m, n) */
function qwilcox(p: number, m: number, n: number): number {
  const counts = wilcoxonCounts(m, n)
  const c = rChoose(m + n, n)
  return discreteQuantile(p, (q) => counts[q]! / c, m * n)
}

/** qsignrank(p, n) */
function qsignrank(p: number, n: number): number {
  const counts = signedRankCounts(n)
  const f = Math.exp(-n * Math.LN2)
  return discreteQuantile(p, (q) => counts[q]! * f, (n * (n + 1)) / 2)
}

function continuity(z: number, correct: boolean, alternative: Alternative): number {
  if (!correct) return 0
  if (alternative === 'greater') return 0.5
  if (alternative === 'less') return -0.5
  return Math.sign(z) * 0.5
}

/**
 * Two-sample: estimate and CI of the location shift of x relative to y (x − y), i.e.
 * wilcox.test(x, y, conf.int = TRUE).
 */
export function hodgesLehmannTwoSample(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: ConfIntOptions,
): HodgesLehmann {
  const nx = x.length
  const ny = y.length
  const { alternative, confLevel } = opts
  const alpha = 1 - confLevel
  if (nx === 0 || ny === 0) return { estimate: Number.NaN, lo: Number.NaN, hi: Number.NaN }
  if (opts.exact) {
    const diffs = new Float64Array(nx * ny)
    // outer(x, y, "-") in column-major order; order is irrelevant once sorted.
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) diffs[j * nx + i] = x[i]! - y[j]!
    diffs.sort()
    let lo = Number.NEGATIVE_INFINITY
    let hi = Number.POSITIVE_INFINITY
    let qu = qwilcox(alternative === 'two-sided' ? alpha / 2 : alpha, nx, ny)
    if (qu === 0) qu = 1
    const ql = nx * ny - qu
    if (alternative !== 'less') lo = diffs[qu - 1]!
    if (alternative !== 'greater') hi = diffs[ql]!
    return { estimate: rMedian(diffs), lo, hi }
  }

  let xMin = Number.POSITIVE_INFINITY
  let xMax = Number.NEGATIVE_INFINITY
  let yMin = Number.POSITIVE_INFINITY
  let yMax = Number.NEGATIVE_INFINITY
  for (let i = 0; i < nx; i++) {
    xMin = Math.min(xMin, x[i]!)
    xMax = Math.max(xMax, x[i]!)
  }
  for (let j = 0; j < ny; j++) {
    yMin = Math.min(yMin, y[j]!)
    yMax = Math.max(yMax, y[j]!)
  }
  const mumin = xMin - yMax
  const mumax = xMax - yMin
  const dr = new Float64Array(nx + ny)
  const W = (d: number, correct: boolean): number => {
    for (let i = 0; i < nx; i++) dr[i] = x[i]! - d
    for (let j = 0; j < ny; j++) dr[nx + j] = y[j]!
    // R's rank(ties = "average") and Σ(t³ − t) over tied groups (table() of the ranks).
    const { ranks: r, tieSum: ties } = midranks(dr)
    let sx = 0
    for (let i = 0; i < nx; i++) sx += r[i]!
    const dz = sx - (nx * (nx + 1)) / 2 - (nx * ny) / 2
    const corr = continuity(dz, correct, alternative)
    const sigma = Math.sqrt(((nx * ny) / 12) * (nx + ny + 1 - ties / ((nx + ny) * (nx + ny - 1))))
    return (dz - corr) / sigma
  }
  const Wmumin = W(mumin, opts.correct)
  const Wmumax = W(mumax, opts.correct)
  const root = (zq: number): number => {
    const fLower = Wmumin - zq
    if (fLower <= 0) return mumin
    const fUpper = Wmumax - zq
    if (fUpper >= 0) return mumax
    return uniroot((d) => W(d, opts.correct) - zq, mumin, mumax, TOL_ROOT, fLower, fUpper)
  }
  let lo = Number.NEGATIVE_INFINITY
  let hi = Number.POSITIVE_INFINITY
  if (alternative === 'two-sided') {
    lo = root(normalQuantile(alpha / 2, false))
    hi = root(normalQuantile(alpha / 2))
  } else if (alternative === 'greater') {
    lo = root(normalQuantile(alpha, false))
  } else {
    hi = root(normalQuantile(alpha))
  }
  const estimate = uniroot((d) => W(d, false), mumin, mumax, TOL_ROOT)
  return { estimate, lo, hi }
}

/**
 * One-sample / paired: estimate and CI of the location (pseudo-median) of x − mu, i.e.
 * wilcox.test(x, mu = mu, conf.int = TRUE); for paired data pass the differences with mu = 0.
 * As in R, zero values of x − mu are dropped before anything else (also from the Walsh
 * averages).
 */
export function hodgesLehmannOneSample(
  x0: ArrayLike<number>,
  mu: number,
  opts: ConfIntOptions,
): HodgesLehmann {
  const { alternative, confLevel } = opts
  // x <- x - mu; x <- x[x != 0]; later x <- x + mu
  const shifted: number[] = []
  for (let i = 0; i < x0.length; i++) {
    const v = x0[i]! - mu
    if (v !== 0) shifted.push(v)
  }
  const n = shifted.length
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = shifted[i]! + mu
  let alpha = 1 - confLevel

  if (opts.exact && n > 0) {
    const m = (n * (n + 1)) / 2
    const walsh = new Float64Array(m)
    let k = 0
    for (let j = 0; j < n; j++) for (let i = 0; i <= j; i++) walsh[k++] = x[i]! + x[j]!
    walsh.sort()
    for (let i = 0; i < m; i++) walsh[i] = walsh[i]! / 2
    let lo = Number.NEGATIVE_INFINITY
    let hi = Number.POSITIVE_INFINITY
    let qu = qsignrank(alternative === 'two-sided' ? alpha / 2 : alpha, n)
    if (qu === 0) qu = 1
    const ql = m - qu
    if (alternative !== 'less') lo = walsh[qu - 1]!
    if (alternative !== 'greater') hi = walsh[ql]!
    return { estimate: rMedian(walsh), lo, hi }
  }

  let mumin = Number.NaN
  let mumax = Number.NaN
  let Wmumin = Number.NaN
  let Wmumax = Number.NaN
  const W = (d: number, correct: boolean): number => {
    const xd: number[] = []
    for (let i = 0; i < n; i++) {
      const v = x[i]! - d
      if (v !== 0) xd.push(v)
    }
    const nx = xd.length
    const { ranks: r, tieSum: ties } = midranks(xd.map(Math.abs))
    let sp = 0
    for (let i = 0; i < nx; i++) if (xd[i]! > 0) sp += r[i]!
    const zd = sp - (nx * (nx + 1)) / 4
    const sigma = Math.sqrt((nx * (nx + 1) * (2 * nx + 1)) / 24 - ties / 48)
    const corr = continuity(zd, correct, alternative)
    return (zd - corr) / sigma
  }
  if (n > 0) {
    mumin = Number.POSITIVE_INFINITY
    mumax = Number.NEGATIVE_INFINITY
    for (let i = 0; i < n; i++) {
      mumin = Math.min(mumin, x[i]!)
      mumax = Math.max(mumax, x[i]!)
    }
    Wmumin = W(mumin, opts.correct)
    Wmumax = Number.isFinite(Wmumin) ? W(mumax, opts.correct) : Number.NaN
  }
  if (n === 0 || !Number.isFinite(Wmumax)) {
    return {
      estimate: n > 0 ? (mumin + mumax) / 2 : Number.NaN,
      lo: alternative === 'less' ? Number.NEGATIVE_INFINITY : Number.NaN,
      hi: alternative === 'greater' ? Number.POSITIVE_INFINITY : Number.NaN,
    }
  }
  const root = (zq: number): number =>
    uniroot((d) => W(d, opts.correct) - zq, mumin, mumax, TOL_ROOT, Wmumin - zq, Wmumax - zq)
  let lo = Number.NEGATIVE_INFINITY
  let hi = Number.POSITIVE_INFINITY
  if (alternative === 'two-sided') {
    for (;;) {
      const mindiff = Wmumin - normalQuantile(alpha / 2, false)
      const maxdiff = Wmumax - normalQuantile(alpha / 2)
      if (mindiff < 0 || maxdiff > 0) alpha *= 2
      else break
    }
    if (alpha < 1) {
      lo = root(normalQuantile(alpha / 2, false))
      hi = root(normalQuantile(alpha / 2))
    } else {
      lo = hi = rMedian(x)
    }
  } else if (alternative === 'greater') {
    while (Wmumin - normalQuantile(alpha, false) < 0) alpha *= 2
    lo = alpha < 1 ? root(normalQuantile(alpha, false)) : rMedian(x)
  } else {
    // R tests qnorm(alpha / 2) here but solves at qnorm(alpha); reproduced as is.
    while (Wmumax - normalQuantile(alpha / 2) > 0) alpha *= 2
    hi = alpha < 1 ? root(normalQuantile(alpha)) : rMedian(x)
  }
  const estimate = uniroot((d) => W(d, false), mumin, mumax, TOL_ROOT)
  return { estimate, lo, hi }
}
