// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Lilliefors (Kolmogorov–Smirnov) normality test.
 *
 * The large-P branch (P > 0.10) uses the quartic fits to Stephens' modified statistic from
 * nortest::lillie.test (nortest 1.0-4, R/lillie.test.R), Copyright (C) Juergen Gross and Uwe
 * Ligges, licensed under the GNU General Public License, version 2 or later (GPL-2+); hence
 * this file lives in gpl/. The small-P branch is the published Dallal & Wilkinson (1986) formula.
 */
import { normalCdf } from '../dist/normal.ts'
import { NAN_TEST, type NormalityTest, sortedDeviations } from '../normality/common.ts'

export interface LillieforsResult extends NormalityTest {
  /** KS distance D = max|F_n(x) − Φ((x − x̄)/s)|. Same as `stat`. */
  stat: number
  /**
   * True when p > 0.10: the Dallal–Wilkinson approximation is only accurate for small P, and
   * Prism then reports just "P > 0.10". `p` still holds the value of the (cruder) large-P
   * approximation below.
   */
  pAbove010: boolean
}

const LILLIEFORS_MIN_N = 5

/**
 * Kolmogorov–Smirnov normality test with mean and SD estimated from the data (Lilliefors), P by
 * the Dallal & Wilkinson (1986, Am. Stat. 40, 294–296) approximation, as Prism ("Prism uses the
 * Dallal and Wilkinson approximation to Lilliefors' method") and nortest::lillie.test:
 *
 *   D = max(D⁺, D⁻), D⁺ = max(i/n − Φ(z_i)), D⁻ = max(Φ(z_i) − (i − 1)/n), z_i = (x_(i) − x̄)/s.
 *   For n > 100, D is rescaled D(n/100)^0.49 and n set to 100 (Dallal & Wilkinson).
 *   P = exp(−7.01256 D²(n + 2.78019) + 2.99587 D √(n + 2.78019) − 0.122119 + 0.974598/√n
 *       + 1.67997/n).
 *   If that exceeds 0.1, P is instead taken from Stephens' (1974) modified statistic
 *   D* = (√n − 0.01 + 0.85/√n) D (D'Agostino & Stephens 1986, Table 4.7) by nortest's quartic
 *   fits: 1 (D* ≤ 0.302), then quartics on (0.302, 0.5], (0.5, 0.9], (0.9, 1.31], 0 above.
 *
 * n < 5 (Prism's minimum) or zero spread gives NaN.
 */
export function kolmogorovSmirnovNormality(x: ArrayLike<number>): LillieforsResult {
  const n = x.length
  if (n < LILLIEFORS_MIN_N) return { ...NAN_TEST, pAbove010: false }
  const { d, ss } = sortedDeviations(x)
  const s = Math.sqrt(ss / (n - 1))
  if (!(s > 0)) return { ...NAN_TEST, pAbove010: false }
  let dPlus = Number.NEGATIVE_INFINITY
  let dMinus = Number.NEGATIVE_INFINITY
  for (let i = 0; i < n; i++) {
    const p = normalCdf(d[i]! / s)
    dPlus = Math.max(dPlus, (i + 1) / n - p)
    dMinus = Math.max(dMinus, p - i / n)
  }
  const K = Math.max(dPlus, dMinus)
  const Kd = n <= 100 ? K : K * (n / 100) ** 0.49
  const nd = n <= 100 ? n : 100
  let p = Math.exp(
    -7.01256 * Kd * Kd * (nd + 2.78019) +
      2.99587 * Kd * Math.sqrt(nd + 2.78019) -
      0.122119 +
      0.974598 / Math.sqrt(nd) +
      1.67997 / nd,
  )
  const pAbove010 = p > 0.1
  if (pAbove010) {
    const kk = (Math.sqrt(n) - 0.01 + 0.85 / Math.sqrt(n)) * K
    if (kk <= 0.302) p = 1
    else if (kk <= 0.5)
      p = 2.76773 - 19.828315 * kk + 80.709644 * kk ** 2 - 138.55152 * kk ** 3 + 81.218052 * kk ** 4
    else if (kk <= 0.9)
      p =
        -4.901232 + 40.662806 * kk - 97.490286 * kk ** 2 + 94.029866 * kk ** 3 - 32.355711 * kk ** 4
    else if (kk <= 1.31)
      p = 6.198765 - 19.558097 * kk + 23.186922 * kk ** 2 - 12.234627 * kk ** 3 + 2.423045 * kk ** 4
    else p = 0
  }
  return { stat: K, p, pAbove010 }
}
