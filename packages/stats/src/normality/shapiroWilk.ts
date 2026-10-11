import { normalQuantile, normalSf } from '../dist/normal.ts'
import { poly } from '../linalg/forms.ts'
import { NAN_TEST, type NormalityTest, sortedDeviations } from './common.ts'

const SHAPIRO_WILK_MIN_N = 3
const SHAPIRO_WILK_MAX_N = 5000

// Royston (1992, Stat. Comput. 2, 117–119) polynomial approximations, as tabulated in Royston
// (1995), Algorithm AS R94, Appl. Statist. 44(4), 547–551.
const C1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056]
const C2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633]
const G = [-2.273, 0.459]
const C3 = [0.544, -0.39978, 0.025054, -6.714e-4]
const C4 = [1.3822, -0.77857, 0.062767, -0.0020322]
const C5 = [-1.5861, -0.31082, -0.083751, 0.0038915]
const C6 = [-0.4803, -0.082676, 0.0030302]

/**
 * Shapiro–Wilk W with Royston's approximations to the coefficients and to the null
 * distribution (Royston 1992, 1995 AS R94); matches R's shapiro.test.
 *
 * Coefficients: m_i = Φ⁻¹((i − 3/8)/(n + 1/4)); with u = 1/√n the two largest are
 * a_n = −m_1/‖m‖ + poly(C1, u) and (n > 5) a_{n−1} = −m_2/‖m‖ + poly(C2, u); the rest are m_i
 * rescaled so Σa² = 1. n = 3: a = (−√½, 0, √½).
 * W is the squared correlation of the ordered data with a; 1 − W is computed directly as the
 * residual sum of squares of the regression of x on a over Σ(x − x̄)², so log(1 − W) keeps
 * full accuracy when W is close to 1.
 * P: n = 3 exact, (6/π)(asin √W − π/3); 4 ≤ n ≤ 11: −ln(γ − ln(1 − W)) ~ N(μ, σ) with
 * γ = −2.273 + 0.459n (P = 0 when ln(1 − W) ≥ γ, where AS R94 returns "1e-99"); n ≥ 12:
 * ln(1 − W) ~ N(μ(ln n), σ(ln n)).
 *
 * NaN outside 3 ≤ n ≤ 5000 (the test's limits) and when all values are equal. The test is known
 * to behave poorly with many ties.
 */
export function shapiroWilk(x: ArrayLike<number>): NormalityTest {
  const n = x.length
  if (n < SHAPIRO_WILK_MIN_N || n > SHAPIRO_WILK_MAX_N) return { ...NAN_TEST }
  const { d, ss } = sortedDeviations(x)
  if (!(ss > 0)) return { ...NAN_TEST }
  const nn2 = n >> 1
  const a = new Float64Array(nn2) // a[i] pairs x_(n−i) − x_(i+1), 0-based i
  if (n === 3) {
    a[0] = Math.SQRT1_2
  } else {
    const m = new Float64Array(nn2)
    let summ2 = 0
    for (let i = 0; i < nn2; i++) {
      m[i] = normalQuantile((i + 1 - 0.375) / (n + 0.25))
      summ2 += m[i]! * m[i]!
    }
    summ2 *= 2
    const ssumm2 = Math.sqrt(summ2)
    const rsn = 1 / Math.sqrt(n)
    const a1 = poly(C1, rsn) - m[0]! / ssumm2
    let fac: number
    let i1: number
    if (n > 5) {
      i1 = 2
      const a2 = -m[1]! / ssumm2 + poly(C2, rsn)
      fac = Math.sqrt(
        (summ2 - 2 * m[0]! * m[0]! - 2 * m[1]! * m[1]!) / (1 - 2 * a1 * a1 - 2 * a2 * a2),
      )
      a[1] = a2
    } else {
      i1 = 1
      fac = Math.sqrt((summ2 - 2 * m[0]! * m[0]!) / (1 - 2 * a1 * a1))
    }
    a[0] = a1
    for (let i = i1; i < nn2; i++) a[i] = -m[i]! / fac
  }
  // Full antisymmetric coefficient vector c (Σc = 0, Σc² = 1 up to rounding) and
  // 1 − W = min_b Σ(d − b c)² / Σd² = (Σd² − (Σcd)²/Σc²) / Σd², the residual computed directly.
  let cc = 0
  let cd = 0
  for (let i = 0; i < nn2; i++) {
    cc += 2 * a[i]! * a[i]!
    cd += a[i]! * (d[n - 1 - i]! - d[i]!)
  }
  const b = cd / cc
  let rss = 0
  for (let i = 0; i < n; i++) {
    const c = i < nn2 ? -a[i]! : i >= n - nn2 ? a[n - 1 - i]! : 0
    const r = d[i]! - b * c
    rss += r * r
  }
  const w1 = Math.min(1, rss / ss)
  const w = 1 - w1

  let p: number
  if (n === 3) {
    p = Math.max(0, (6 / Math.PI) * (Math.asin(Math.sqrt(w)) - Math.PI / 3))
  } else {
    let y = Math.log(w1)
    let mu: number
    let s: number
    if (n <= 11) {
      const gamma = poly(G, n)
      if (y >= gamma) return { stat: w, p: 0 }
      y = -Math.log(gamma - y)
      mu = poly(C3, n)
      s = Math.exp(poly(C4, n))
    } else {
      const ln = Math.log(n)
      mu = poly(C5, ln)
      s = Math.exp(poly(C6, ln))
    }
    p = normalSf((y - mu) / s)
  }
  return { stat: w, p }
}
