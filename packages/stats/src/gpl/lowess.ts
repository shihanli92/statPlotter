// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * LOWESS smoother (Cleveland 1979; Chambers, Cleveland, Kleiner & Tukey, Graphical Methods for
 * Data Analysis, 1983, §4.11 — the usual reference for LOWESS curves) exactly as
 * R's lowess() runs it.
 *
 * Translated from R 4.4.3: src/library/stats/src/lowess.c (clowess and lowest, a C translation of
 * Cleveland's Fortran) and lowess() in src/library/stats/R/lowess.R.
 * Copyright (C) The R Core Team, Ross Ihaka and the original authors of those files.
 * Licensed under the GNU General Public License, version 2 or later (GPL-2+).
 *
 * Local linear fits with tricube weights over the ns = max(2, min(n, ⌊f·n + 1e−7⌋)) nearest
 * points, then `iter` robustness steps with bisquare weights on the residuals (6 × median
 * |residual|); points closer than `delta` to the last fitted one are linearly interpolated.
 */

const cube = (v: number) => v * v * v
const square = (v: number) => v * v

export interface LowessOptions {
  /** Smoother span: the share of the points used for each local fit. Default 2/3. */
  f?: number
  /** Robustness iterations. Default 3. */
  iter?: number
  /** Default 1% of the range of x. */
  delta?: number
}

/**
 * LOWESS of (x, y): the fitted values at the x values sorted ascending (ties keep their input
 * order, as R's order()), as R's lowess() returns them.
 */
export function lowess(
  xIn: ArrayLike<number>,
  yIn: ArrayLike<number>,
  opts: LowessOptions = {},
): { x: number[]; y: number[] } {
  const n0 = xIn.length
  if (yIn.length !== n0) throw new RangeError('lowess: x and y differ in length')
  const idx = Array.from({ length: n0 }, (_, i) => i).sort((a, b) => xIn[a]! - xIn[b]! || a - b)
  const xs = idx.map((i) => xIn[i]!)
  const ysIn = idx.map((i) => yIn[i]!)
  const f = opts.f ?? 2 / 3
  const nsteps = opts.iter ?? 3
  const delta = opts.delta ?? 0.01 * (n0 > 0 ? xs[n0 - 1]! - xs[0]! : 0)
  const out = new Array<number>(n0).fill(Number.NaN)
  if (n0 === 0) return { x: xs, y: out }
  if (n0 < 2) {
    out[0] = ysIn[0]!
    return { x: xs, y: out }
  }
  const n = n0
  // 1-based arrays, as the C code.
  const x = [Number.NaN, ...xs]
  const y = [Number.NaN, ...ysIn]
  const ys = new Array<number>(n + 1).fill(0)
  const rw = new Array<number>(n + 1).fill(0) // rw[1..n]
  const res = new Array<number>(n + 1).fill(0) // res[1..n]: weights workspace, then residuals

  const lowest = (xsv: number, nleft: number, nright: number, userw: boolean): number | null => {
    const range = x[n]! - x[1]!
    const h = Math.max(xsv - x[nleft]!, x[nright]! - xsv)
    const h9 = 0.999 * h
    const h1 = 0.001 * h
    let a = 0
    let j = nleft
    while (j <= n) {
      res[j] = 0
      const r = Math.abs(x[j]! - xsv)
      if (r <= h9) {
        if (r <= h1) res[j] = 1
        else res[j] = cube(1 - cube(r / h))
        if (userw) res[j] = res[j]! * rw[j]!
        a += res[j]!
      } else if (x[j]! > xsv) break
      j++
    }
    const nrt = j - 1
    if (a <= 0) return null
    for (j = nleft; j <= nrt; j++) res[j] = res[j]! / a
    if (h > 0) {
      a = 0
      for (j = nleft; j <= nrt; j++) a += res[j]! * x[j]!
      let b = xsv - a
      let c = 0
      for (j = nleft; j <= nrt; j++) c += res[j]! * (x[j]! - a) * (x[j]! - a)
      if (Math.sqrt(c) > 0.001 * range) {
        b /= c
        for (j = nleft; j <= nrt; j++) res[j] = res[j]! * (b * (x[j]! - a) + 1)
      }
    }
    let yv = 0
    for (j = nleft; j <= nrt; j++) yv += res[j]! * y[j]!
    return yv
  }

  const ns = Math.max(2, Math.min(n, Math.trunc(f * n + 1e-7)))
  let iter = 1
  while (iter <= nsteps + 1) {
    let nleft = 1
    let nright = ns
    let last = 0
    let i = 1
    for (;;) {
      if (nright < n) {
        const d1 = x[i]! - x[nleft]!
        const d2 = x[nright + 1]! - x[i]!
        if (d1 > d2) {
          nleft++
          nright++
          continue
        }
      }
      const fit = lowest(x[i]!, nleft, nright, iter > 1)
      ys[i] = fit === null ? y[i]! : fit
      if (last < i - 1) {
        const denom = x[i]! - x[last]!
        for (let j = last + 1; j < i; j++) {
          const alpha = (x[j]! - x[last]!) / denom
          ys[j] = alpha * ys[i]! + (1 - alpha) * ys[last]!
        }
      }
      last = i
      const cut = x[last]! + delta
      for (i = last + 1; i <= n; i++) {
        if (x[i]! > cut) break
        if (x[i] === x[last]) {
          ys[i] = ys[last]!
          last = i
        }
      }
      i = Math.max(last + 1, i - 1)
      if (last >= n) break
    }
    for (let k = 1; k <= n; k++) res[k] = y[k]! - ys[k]!
    let sc = 0
    for (let k = 1; k <= n; k++) sc += Math.abs(res[k]!)
    sc /= n
    if (iter > nsteps) break
    for (let k = 1; k <= n; k++) rw[k] = Math.abs(res[k]!)
    // cmad = 6 · median(|res|) (rPsort picks the m-th smallest, 0-based).
    const sorted = rw.slice(1).sort((p, q) => p - q)
    const m1 = Math.trunc(n / 2)
    const cmad = n % 2 === 0 ? 3 * (sorted[m1]! + sorted[n - m1 - 1]!) : 6 * sorted[m1]!
    if (cmad < 1e-7 * sc) break
    const c9 = 0.999 * cmad
    const c1 = 0.001 * cmad
    for (let k = 1; k <= n; k++) {
      const r = Math.abs(res[k]!)
      if (r <= c1) rw[k] = 1
      else if (r <= c9) rw[k] = square(1 - square(r / cmad))
      else rw[k] = 0
    }
    iter++
  }
  for (let k = 0; k < n; k++) out[k] = ys[k + 1]!
  return { x: xs, y: out }
}
