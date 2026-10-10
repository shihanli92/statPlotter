// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * R's "L'Ecuyer-CMRG" uniform generator (MRG32k3a) with its set.seed() seeding and its
 * "Inversion" normal generator, reproduced bit for bit, so that
 *
 *   set.seed(seed, kind = "L'Ecuyer-CMRG", normal.kind = "Inversion"); rnorm(k)
 *
 * in R and `new LecuyerRng(seed).normal()` called k times here give the same numbers (up to the
 * last-bit agreement of qnorm with normalQuantile, both AS 241). Used for Monte Carlo
 * procedures (PCA parallel analysis) that must be deterministic and checkable against R.
 *
 * Translated from R 4.4.3: src/main/RNG.c (RNG_Init's initial scrambling and the LECUYER_CMRG
 * seeding loop, unif_rand's LECUYER_CMRG case, fixup) and src/nmath/snorm.c (norm_rand,
 * INVERSION). Copyright (C) The R Core Team. Licensed under the GNU General Public License,
 * version 2 or later (GPL-2+). The generator itself is L'Ecuyer (1999), "Good parameters and
 * implementations for combined multiple recursive random number generators", Oper. Res. 47.
 *
 * R's FixupSeeds (which re-randomises an all-zero state from the clock) is not reproduced: the
 * seeding loop below never produces one.
 */

import { normalQuantile } from '../dist/normal.ts'

const M1 = 4294967087
const M2 = 4294944443
const INV_M1 = 1 / M1
const INV_M2 = 1 / M2
/** R's normc, 2.328306549295727688e-10 (the same double). */
const NORMC = 2.328306549295728e-10
const A12 = 1403580
const A13N = 810728
const A21 = 527612
const A23N = 1370589
/** 1 / (2³² − 1), R's i2_32m1. */
const I2_32M1 = 2.328306437080797e-10
/** 2²⁷, R's BIG in snorm.c. */
const BIG = 134217728

function lcg(s: number): number {
  return (Math.imul(69069, s) + 1) >>> 0
}

export class LecuyerRng {
  /** The six state words as unsigned 32-bit integers (R stores them as signed ints). */
  private readonly s = new Float64Array(6)

  /** Seeds as R's set.seed(seed) does for kind "L'Ecuyer-CMRG". */
  constructor(seed: number) {
    if (!Number.isInteger(seed)) throw new RangeError(`seed must be an integer, got ${seed}`)
    let x = seed >>> 0
    for (let j = 0; j < 50; j++) x = lcg(x)
    const s: number[] = []
    for (let j = 0; j < 6; j++) {
      x = lcg(x)
      while (x >= M2) x = lcg(x)
      s.push(x)
    }
    this.s.set(s)
  }

  /** The state as R's .Random.seed[2:7] (signed 32-bit integers). */
  state(): number[] {
    return Array.from(this.s, (v) => v | 0)
  }

  /** unif_rand(): a uniform on (0, 1). */
  uniform(): number {
    // Every product is below 2⁵³, so the arithmetic is exact in doubles. R reduces with fmod
    // and adds m when negative, i.e. p = x − m⌊x/m⌋ ∈ [0, m). Here ⌊x/m⌋ is estimated as
    // ⌊x·(1/m)⌋: |x/m| < 2²¹, so the estimate is off by at most one, x − m·k is still exact
    // (an integer below 2⁵³), and one correction step lands in [0, m). The same integers as
    // fmod, without its cost.
    const s = this.s
    const x1 = A12 * s[1]! - A13N * s[0]!
    let p1 = x1 - M1 * Math.floor(x1 * INV_M1)
    if (p1 < 0) p1 += M1
    else if (p1 >= M1) p1 -= M1
    s[0] = s[1]!
    s[1] = s[2]!
    s[2] = p1
    const x2 = A21 * s[5]! - A23N * s[3]!
    let p2 = x2 - M2 * Math.floor(x2 * INV_M2)
    if (p2 < 0) p2 += M2
    else if (p2 >= M2) p2 -= M2
    s[3] = s[4]!
    s[4] = s[5]!
    s[5] = p2
    const u = (p1 > p2 ? p1 - p2 : p1 - p2 + M1) * NORMC
    if (u <= 0) return 0.5 * I2_32M1
    if (1 - u <= 0) return 1 - 0.5 * I2_32M1
    return u
  }

  /** norm_rand() with normal.kind "Inversion": two uniforms per draw. */
  normal(): number {
    let u = this.uniform()
    u = Math.trunc(BIG * u) + this.uniform()
    return normalQuantile(u / BIG)
  }

  /**
   * Fills `out` with scale × normal() draws: the same stream as calling normal() out.length
   * times, with the generator state held in locals for the loop (uniform() inlined).
   */
  fillNormal(out: Float64Array, scale = 1): void {
    const st = this.s
    let s0 = st[0]!
    let s1 = st[1]!
    let s2 = st[2]!
    let s3 = st[3]!
    let s4 = st[4]!
    let s5 = st[5]!
    for (let i = 0; i < out.length; i++) {
      let u = 0
      for (let h = 0; h < 2; h++) {
        const x1 = A12 * s1 - A13N * s0
        let p1 = x1 - M1 * Math.floor(x1 * INV_M1)
        if (p1 < 0) p1 += M1
        else if (p1 >= M1) p1 -= M1
        s0 = s1
        s1 = s2
        s2 = p1
        const x2 = A21 * s5 - A23N * s3
        let p2 = x2 - M2 * Math.floor(x2 * INV_M2)
        if (p2 < 0) p2 += M2
        else if (p2 >= M2) p2 -= M2
        s3 = s4
        s4 = s5
        s5 = p2
        let v = (p1 > p2 ? p1 - p2 : p1 - p2 + M1) * NORMC
        if (v <= 0) v = 0.5 * I2_32M1
        else if (1 - v <= 0) v = 1 - 0.5 * I2_32M1
        u = h === 0 ? Math.trunc(BIG * v) : u + v
      }
      out[i] = scale * normalQuantile(u / BIG)
    }
    st[0] = s0
    st[1] = s1
    st[2] = s2
    st[3] = s3
    st[4] = s4
    st[5] = s5
  }
}
