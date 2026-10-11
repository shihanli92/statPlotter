import { normalCdf, normalSf } from '../dist/normal.ts'
import { sum } from '../summation.ts'
import { NAN_TEST, type NormalityTest, sortedDeviations } from './common.ts'

export interface AndersonDarlingResult extends NormalityTest {
  /** A²* = A²(1 + 0.75/n + 2.25/n²), the statistic reported ("A2*"). Same as `stat`. */
  stat: number
  /** The unadjusted A² (nortest::ad.test's statistic). */
  a2: number
}

const ANDERSON_DARLING_MIN_N = 8

/** ln Φ(z), accurate in both tails. */
function logCdf(z: number): number {
  return z <= 0 ? Math.log(normalCdf(z)) : Math.log1p(-normalSf(z))
}

/**
 * Anderson–Darling test for normality with mean and SD estimated from the data (case 3 of
 * Stephens 1974), as nortest::ad.test:
 *
 *   z_i = (x_(i) − x̄)/s,  A² = −n − (1/n) Σ (2i − 1)[ln Φ(z_i) + ln(1 − Φ(z_{n+1−i}))],
 *   A²* = A²(1 + 0.75/n + 2.25/n²),
 *
 * and P from the piecewise exponential approximations of D'Agostino & Stephens (1986),
 * Goodness-of-Fit Techniques, Table 4.9:
 *   A²* < 0.2:  1 − exp(−13.436 + 101.14A²* − 223.73A²*²)
 *   A²* < 0.34: 1 − exp(−8.318 + 42.796A²* − 59.938A²*²)
 *   A²* < 0.6:  exp(0.9177 − 4.279A²* − 1.38A²*²)
 *   A²* < 10:   exp(1.2937 − 5.709A²* + 0.0186A²*²)
 *   otherwise   3.7e−24.
 * A²* is reported and n ≥ 8 is required; below that, or with zero spread, the result is NaN.
 */
export function andersonDarling(x: ArrayLike<number>): AndersonDarlingResult {
  const n = x.length
  if (n < ANDERSON_DARLING_MIN_N) return { ...NAN_TEST, a2: Number.NaN }
  const { d, ss } = sortedDeviations(x)
  const s = Math.sqrt(ss / (n - 1))
  if (!(s > 0)) return { ...NAN_TEST, a2: Number.NaN }
  // A² is a small difference of terms of size ~n²: sum them with compensation.
  const h = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    h[i] = (2 * i + 1) * (logCdf(d[i]! / s) + logCdf(-d[n - 1 - i]! / s))
  }
  const a2 = -n - sum(h) / n
  const aa = (1 + 0.75 / n + 2.25 / (n * n)) * a2
  let p: number
  if (aa < 0.2) p = 1 - Math.exp(-13.436 + 101.14 * aa - 223.73 * aa * aa)
  else if (aa < 0.34) p = 1 - Math.exp(-8.318 + 42.796 * aa - 59.938 * aa * aa)
  else if (aa < 0.6) p = Math.exp(0.9177 - 4.279 * aa - 1.38 * aa * aa)
  else if (aa < 10) p = Math.exp(1.2937 - 5.709 * aa + 0.0186 * aa * aa)
  else p = 3.7e-24
  return { stat: aa, p, a2 }
}
