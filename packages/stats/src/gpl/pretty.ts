// SPDX-License-Identifier: GPL-3.0-or-later
// R's `pretty()` (base R's `pretty.default` and `R_pretty`, src/appl/pretty.c, R 4.4; GPL ≥ 2,
// Copyright (C) 1995–2023 The R Core Team), translated for roadmap 34g: ggplot2's default contour
// levels are `pretty(range(z), 10)` (`contour_breaks`). Checked against R in oracle suite
// `pretty` (12 ranges), and as the contour levels of suite `density2d`.

import { seqLength } from '../arrays.ts'

const DBL_EPSILON = Number.EPSILON
const DBL_MIN = 2.2250738585072014e-308
const DBL_MAX = Number.MAX_VALUE
const MAX_F = 1.25
const ROUNDING_EPS = 1e-10

/** `R_pretty` with `return_bounds`: the bounds l, u and the number of intervals n. */
function rPretty(
  lo: number,
  up: number,
  ndiv: number,
  minN: number,
  shrinkSml: number,
  highUFact: readonly [number, number, number],
  epsCorrection: number,
): { l: number; u: number; n: number } {
  const [h, h5, fMin] = highUFact
  const lo0 = lo
  const up0 = up
  const dx = up0 - lo0
  let cell: number
  let iSmall: boolean
  if (dx === 0 && up0 === 0) {
    cell = 1
    iSmall = true
  } else {
    cell = Math.max(Math.abs(lo0), Math.abs(up0))
    let U = 1 + (h5 >= 1.5 * h + 0.5 ? 1 / (1 + h) : 1.5 / (1 + h5))
    U *= Math.max(1, ndiv) * DBL_EPSILON
    iSmall = dx < cell * U * 3
  }
  if (iSmall) {
    if (cell > 10) cell = 9 + cell / 10
    cell *= shrinkSml
    if (minN > 1) cell /= minN
  } else {
    cell = dx
    if (ndiv > 1) cell /= ndiv
  }
  let subsmall = fMin * DBL_MIN
  if (subsmall === 0) subsmall = DBL_MIN
  if (cell < subsmall) cell = subsmall
  else if (cell > DBL_MAX / MAX_F) cell = DBL_MAX / MAX_F
  const base = 10 ** Math.floor(Math.log10(cell))
  let unit = base
  let ns = 2 * base
  if (ns - cell < h * (cell - unit)) {
    unit = ns
    ns = 5 * base
    if (ns - cell < h5 * (cell - unit)) {
      unit = ns
      ns = 10 * base
      if (ns - cell < h * (cell - unit)) unit = ns
    }
  }
  ns = Math.floor(lo0 / unit + ROUNDING_EPS)
  let nu = Math.ceil(up0 / unit - ROUNDING_EPS)
  if (epsCorrection && (epsCorrection > 1 || !iSmall)) {
    lo = lo0 !== 0 ? lo * (1 - DBL_EPSILON) : -DBL_MIN
    up = up0 !== 0 ? up * (1 + DBL_EPSILON) : DBL_MIN
  }
  while (ns * unit > lo + ROUNDING_EPS * unit) ns--
  while (nu * unit < up - ROUNDING_EPS * unit) nu++
  let k = Math.trunc(0.5 + nu - ns)
  if (k < minN) {
    k = minN - k
    if (ns >= 0) {
      nu += Math.trunc(k / 2)
      ns -= Math.trunc(k / 2) + (k % 2)
    } else {
      ns -= Math.trunc(k / 2)
      nu += Math.trunc(k / 2) + (k % 2)
    }
    ndiv = minN
  } else ndiv = k
  if (ns * unit < lo) lo = ns * unit
  if (nu * unit > up) up = nu * unit
  return { l: lo, u: up, n: ndiv }
}

/**
 * R's `pretty(x, n)` of a range [lo, hi] with its defaults (min.n = n %/% 3, shrink.sml 0.75,
 * high.u.bias 1.5, u5.bias 2.75, eps.correct 0, f.min 2⁻²⁰, bounds TRUE): about n + 1 round
 * values covering the range. Empty for a range that isn't finite.
 */
export function pretty(lo: number, hi: number, n = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return []
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo]
  const highU = 1.5
  const z = rPretty(a, b, n, Math.floor(n / 3), 0.75, [highU, 0.5 + 1.5 * highU, 2 ** -20], 0)
  // R's seq.int(l, u, length.out = n + 1).
  const s = seqLength(z.l, z.u, z.n + 1)
  if (z.n) {
    const delta = (Math.max(z.l, z.u) - Math.min(z.l, z.u)) / z.n
    for (let i = 0; i < s.length; i++) if (Math.abs(s[i]!) < 1e-14 * delta) s[i] = 0
  }
  return Array.from(s)
}
