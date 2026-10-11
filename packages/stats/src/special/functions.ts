import { normalSf } from '../dist/normal.ts'
import { integrate } from '../numint/quadrature.ts'
import { lgamma } from './gamma.ts'

/**
 * Special functions of the user-equation language: the gamma
 * function over the whole real line, digamma / trigamma, erf / erfc, Bessel functions of integer
 * order and the confluent / Gauss hypergeometric functions. Implemented from the published
 * formulas cited at each function (no translated code); the R oracle (suite `specialfn`) checks
 * them against R's gamma, digamma, trigamma, besselJ/Y/I/K and numerical integrals.
 */

const SQRT_PI = Math.sqrt(Math.PI)

// ---- gamma ------------------------------------------------------------------------------------

/**
 * Γ(x) for every real x: exp(lnΓ) for x > 0 (exact factorials for integers up to 170), and the
 * reflection formula Γ(x) = π / (sin(πx) Γ(1 − x)) below ½ (NaN at 0, −1, −2, …).
 */
export function gammaFn(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  if (Number.isInteger(x)) {
    if (x <= 0) return Number.NaN
    if (x <= 171) return factorial(x - 1)
    return Number.POSITIVE_INFINITY
  }
  if (x < 0.5) {
    const s = sinPi(x)
    return Math.PI / (s * gammaFn(1 - x))
  }
  if (x > 171.7) return Number.POSITIVE_INFINITY
  return Math.exp(lgamma(x))
}

/** ln|Γ(x)| for every real x that isn't 0, −1, −2, … (+∞ there). */
export function lnGammaAbs(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  if (x > 0) return lgamma(x)
  if (Number.isInteger(x)) return Number.POSITIVE_INFINITY
  // ln|Γ(x)| = ln π − ln|sin(πx)| − lnΓ(1 − x)
  return Math.log(Math.PI) - Math.log(Math.abs(sinPi(x))) - lgamma(1 - x)
}

/** sin(πx) with the argument reduced exactly (no loss for large |x|). */
function sinPi(x: number): number {
  const r = x - 2 * Math.round(x / 2) // in [−1, 1], exact
  if (r === 0 || Math.abs(r) === 1) return 0
  return Math.sin(Math.PI * r)
}

const FACTORIALS: number[] = (() => {
  const f = [1]
  for (let k = 1; k <= 170; k++) f.push(f[k - 1]! * k)
  return f
})()

/** n! for integers 0 … 170 (exact products; +∞ above, NaN for negatives or fractions). */
export function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) return Number.NaN
  return n <= 170 ? FACTORIALS[n]! : Number.POSITIVE_INFINITY
}

/** Β(a, b) = Γ(a)Γ(b)/Γ(a + b), through logs for positive arguments. */
export function betaFn(a: number, b: number): number {
  if (a > 0 && b > 0) return Math.exp(lgamma(a) + lgamma(b) - lgamma(a + b))
  return (gammaFn(a) * gammaFn(b)) / gammaFn(a + b)
}

// ---- digamma, trigamma -----------------------------------------------------------------------

/** Bernoulli numbers B_2k, k = 1…8, for the asymptotic series. */
const B2K = [1 / 6, -1 / 30, 1 / 42, -1 / 30, 5 / 66, -691 / 2730, 7 / 6, -3617 / 510]

/**
 * ψ(x) = d lnΓ/dx (A&S 6.3.18 asymptotic series for x ≥ 10 after the upward recurrence
 * ψ(x) = ψ(x + 1) − 1/x, the reflection ψ(1 − x) − ψ(x) = π cot(πx) for x < 0).
 */
export function digamma(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  if (x <= 0 && Number.isInteger(x)) return Number.NaN
  if (x < 0) return digamma(1 - x) - Math.PI / Math.tan(Math.PI * (x - Math.round(x)))
  let acc = 0
  while (x < 10) {
    acc -= 1 / x
    x += 1
  }
  const x2 = 1 / (x * x)
  let s = 0
  for (let k = B2K.length; k >= 1; k--) s = s * x2 + B2K[k - 1]! / (2 * k)
  return acc + Math.log(x) - 0.5 / x - s * x2
}

/** ψ′(x) (A&S 6.4.12 asymptotic series after recurrence; reflection for x < 0). */
export function trigamma(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  if (x <= 0 && Number.isInteger(x)) return Number.NaN
  if (x < 0) {
    // ψ′(1 − x) + ψ′(x) = π² / sin²(πx)
    const s = sinPi(x)
    return (Math.PI * Math.PI) / (s * s) - trigamma(1 - x)
  }
  let acc = 0
  while (x < 10) {
    acc += 1 / (x * x)
    x += 1
  }
  const x2 = 1 / (x * x)
  // ψ′(x) ~ 1/x + 1/(2x²) + Σ B_2k / x^(2k+1)
  let s = 0
  for (let k = B2K.length; k >= 1; k--) s = s * x2 + B2K[k - 1]!
  return acc + 1 / x + 0.5 * x2 + (s * x2) / x
}

// ---- error function ---------------------------------------------------------------------------

/** erf(x): Maclaurin series for |x| < ½ (full relative accuracy near 0), else 1 − erfc. */
export function erf(x: number): number {
  if (Number.isNaN(x)) return x
  const ax = Math.abs(x)
  if (ax < 0.5) {
    // erf x = 2/√π Σ (−1)^n x^(2n+1) / (n! (2n+1))
    const x2 = x * x
    let term = x
    let s = x
    for (let n = 1; n < 30; n++) {
      term *= -x2 / n
      const t = term / (2 * n + 1)
      s += t
      if (Math.abs(t) < 1e-17 * Math.abs(s)) break
    }
    return (2 / SQRT_PI) * s
  }
  const c = erfc(ax)
  return x > 0 ? 1 - c : c - 1
}

/** erfc(x) = 2·P(Z > x√2) (the normal upper tail keeps relative accuracy far out). */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return x
  if (Math.abs(x) < 0.5) return 1 - erf(x)
  return 2 * normalSf(x * Math.SQRT2)
}

// ---- Bessel functions of integer order ------------------------------------------------------------

/** Trapezoid points for J_n(x) on its period: aliasing J_{N−n} is below 1e−20 (see besselJ). */
function trapezoidPoints(n: number, x: number): number {
  return Math.ceil(n + x + 15 * Math.cbrt(x) + 40)
}

/**
 * J_n(x) for n ≤ x by Bessel's integral J_n(x) = (1/2π)∫_{−π}^{π} cos(nτ − x sin τ) dτ with the
 * N-point trapezoid rule, exact up to the aliased terms J_{kN±n}(x) (Trefethen & Weideman,
 * SIAM Review 56, 2014, §3), which are negligible once N − n exceeds x by 15·x^⅓ + 40 (the
 * Airy-type decay of J_ν(x) for ν > x). Absolute accuracy ~1e−16.
 */
function besselJTrapezoid(n: number, x: number): number {
  const N = trapezoidPoints(n, x)
  let s = 0
  for (let k = 0; k < N; k++) {
    const t = -Math.PI + (2 * Math.PI * (k + 0.5)) / N
    s += Math.cos(n * t - x * Math.sin(t))
  }
  return s / N
}

/**
 * J_n(x) for n > x by Miller's backward recurrence J_{k−1} = (2k/x)J_k − J_{k+1} from a start
 * well above n, normalized by 1 = J₀ + 2ΣJ_{2k} (Press et al., Numerical Recipes §6.5; the
 * recessive solution keeps full relative accuracy).
 */
function besselJMiller(n: number, x: number): number {
  const top = Math.max(n, x)
  let m = Math.ceil(top + Math.sqrt(400 * top) + 30)
  if (m % 2 === 1) m++
  let jp = 0
  let j = 1e-300
  let sum = 0
  let ans = 0
  for (let k = m; k > 0; k--) {
    const jm = ((2 * k) / x) * j - jp
    jp = j
    j = jm
    if (Math.abs(j) > 1e250) {
      j *= 1e-250
      jp *= 1e-250
      ans *= 1e-250
      sum *= 1e-250
    }
    if (k - 1 === n) ans = j
    if ((k - 1) % 2 === 0 && k - 1 > 0) sum += j
  }
  // After the loop j = J_0 (unnormalized).
  sum = 2 * sum + j
  return ans / sum
}

/** J_n(x), integer n (n and x of any sign). */
export function besselJ(n: number, x: number): number {
  if (!Number.isInteger(n) || Number.isNaN(x)) return Number.NaN
  let sign = 1
  if (n < 0) {
    n = -n
    if (n % 2 === 1) sign = -sign
  }
  if (x < 0) {
    x = -x
    if (n % 2 === 1) sign = -sign
  }
  if (x === 0) return n === 0 ? 1 : 0
  if (!Number.isFinite(x)) return 0
  return sign * (n <= x ? besselJTrapezoid(n, x) : besselJMiller(n, x))
}

/**
 * Y₀ and Y₁ from Schläfli's integral (DLMF 10.9.7):
 *   Y_n(x) = (1/π)∫₀^π sin(x sin θ − nθ) dθ − (1/π)∫₀^∞ (e^{nt} + (−1)^n e^{−nt}) e^{−x sinh t} dt,
 * both by adaptive Gauss–Kronrod quadrature; then the upward recurrence
 * Y_{k+1} = (2k/x)Y_k − Y_{k−1}, stable because Y grows with the order.
 */
function besselY01(n: 0 | 1, x: number): number {
  const panels = Math.max(2, Math.ceil(x / 4))
  const b1 = Array.from({ length: panels + 1 }, (_, i) => (Math.PI * i) / panels)
  const i1 = integrate((t) => Math.sin(x * Math.sin(t) - n * t), b1, { relTol: 1e-15 })
  const T = Math.asinh(760 / x)
  const tp = Math.max(4, Math.ceil(T / 0.5))
  const b2 = Array.from({ length: tp + 1 }, (_, i) => (T * i) / tp)
  const g =
    n === 0
      ? (t: number) => 2 * Math.exp(-x * Math.sinh(t))
      : (t: number) => 2 * Math.sinh(t) * Math.exp(-x * Math.sinh(t))
  const i2 = integrate(g, b2, { relTol: 1e-15 })
  return (i1 - i2) / Math.PI
}

/** Y_n(x), integer n, x > 0 (NaN for x ≤ 0; Y_{−n} = (−1)^n Y_n). */
export function besselY(n: number, x: number): number {
  if (!Number.isInteger(n) || Number.isNaN(x) || x <= 0) return Number.NaN
  let sign = 1
  if (n < 0) {
    n = -n
    if (n % 2 === 1) sign = -1
  }
  if (!Number.isFinite(x)) return 0
  const y0 = besselY01(0, x)
  if (n === 0) return sign * y0
  let y1 = besselY01(1, x)
  let ym = y0
  for (let k = 1; k < n; k++) {
    const yp = ((2 * k) / x) * y1 - ym
    ym = y1
    y1 = yp
    if (!Number.isFinite(y1)) break
  }
  return sign * y1
}

/**
 * I_n(x), integer n: the power series Σ (x/2)^{2k+n} / (k!(k+n)!) (DLMF 10.25.2), all terms
 * positive, the first formed through logarithms (no overflow of (x/2)^n or n!).
 */
export function besselI(n: number, x: number): number {
  if (!Number.isInteger(n) || Number.isNaN(x)) return Number.NaN
  n = Math.abs(n)
  const sign = x < 0 && n % 2 === 1 ? -1 : 1
  x = Math.abs(x)
  if (x === 0) return n === 0 ? 1 : 0
  if (x > 713) return sign * Number.POSITIVE_INFINITY
  const h = x / 2
  const h2 = h * h
  let term = Math.exp(n * Math.log(h) - lgamma(n + 1))
  let s = term
  for (let k = 1; k < 100000; k++) {
    term *= h2 / (k * (k + n))
    s += term
    if (term < 1e-17 * s) break
  }
  return sign * s
}

/**
 * K_n(x), integer n, x > 0: K_n(x) = ½∫_{−∞}^{∞} e^{−x cosh t} cosh(nt) dt (DLMF 10.32.9) by the
 * trapezoid rule with step 0.1, which converges geometrically for this analytic integrand
 * (error ~ e^{−π²/h}; Trefethen & Weideman §5), truncated where the integrand is < 1e−18 of
 * its peak.
 */
export function besselK(n: number, x: number): number {
  if (!Number.isInteger(n) || Number.isNaN(x) || x <= 0) return Number.NaN
  if (!Number.isFinite(x)) return 0
  n = Math.abs(n)
  const h = 0.1
  // log of the integrand: −x cosh t + ln cosh(nt); its peak is at t* ≥ 0.
  const lf = (t: number) => -x * Math.cosh(t) + (n === 0 ? 0 : lnCosh(n * t))
  let tPeak = 0
  if (n > 0) {
    // n tanh(nt) = x sinh t: bisection on [0, asinh(n/x) + 1].
    let lo = 0
    let hi = Math.asinh(n / x) + 1
    for (let it = 0; it < 100; it++) {
      const mid = (lo + hi) / 2
      if (n * Math.tanh(n * mid) > x * Math.sinh(mid)) lo = mid
      else hi = mid
    }
    tPeak = (lo + hi) / 2
  }
  const peak = lf(tPeak)
  let s = 0.5 * Math.exp(lf(0) - peak)
  for (let k = 1; ; k++) {
    const v = lf(k * h) - peak
    s += Math.exp(v)
    if (v < -42 && k * h > tPeak) break
  }
  return 2 * h * s * Math.exp(peak) * 0.5
}

function lnCosh(u: number): number {
  const a = Math.abs(u)
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2
}

// ---- hypergeometric functions --------------------------------------------------------------------

/**
 * Kummer's confluent hypergeometric function M(a, b, x) = ₁F₁(a; b; x) (DLMF 13.2.2), by its
 * series; for x < 0 through Kummer's transformation M(a, b, x) = eˣ M(b − a, b, −x) (DLMF
 * 13.2.39), so the summed terms keep one sign when b − a > 0.
 */
export function hypergeometricM(a: number, b: number, x: number): number {
  if (Number.isNaN(a + b + x)) return Number.NaN
  if (b <= 0 && Number.isInteger(b)) return Number.NaN
  if (x < 0 && !(a <= 0 && Number.isInteger(a))) return Math.exp(x) * seriesM(b - a, b, -x)
  return seriesM(a, b, x)
}

function seriesM(a: number, b: number, x: number): number {
  let term = 1
  let s = 1
  for (let k = 0; k < 100000; k++) {
    term *= ((a + k) / (b + k)) * (x / (k + 1))
    s += term
    if (term === 0 || (Math.abs(term) < 1e-17 * Math.abs(s) && k > Math.abs(x))) break
    if (!Number.isFinite(s)) break
  }
  return s
}

/**
 * Tricomi's confluent hypergeometric function U(a, b, x), x > 0: the integral
 * U = (1/Γ(a))∫₀^∞ e^{−xt} t^{a−1}(1 + t)^{b−a−1} dt for a > 0 (DLMF 13.4.4), else through
 * Kummer's transformation U(a, b, x) = x^{1−b} U(a − b + 1, 2 − b, x) (DLMF 13.2.40) when that
 * makes a positive; NaN otherwise. With t = eˢ the integrand decays on both sides and the
 * trapezoid rule (step 0.05) converges geometrically.
 */
export function hypergeometricU(a: number, b: number, x: number): number {
  if (Number.isNaN(a + b + x) || !(x > 0)) return Number.NaN
  if (!(a > 0)) {
    const a2 = a - b + 1
    if (a2 > 0) return x ** (1 - b) * hypergeometricU(a2, 2 - b, x)
    if (a <= 0 && Number.isInteger(a)) {
      // A polynomial: U(−m, b, x) = (−1)^m (b)_m M(−m, b, x) for b not a non-positive integer.
      const m = -a
      let poch = 1
      for (let k = 0; k < m; k++) poch *= b + k
      return (m % 2 === 0 ? 1 : -1) * poch * hypergeometricM(a, b, x)
    }
    return Number.NaN
  }
  // log integrand in s: −x eˢ + a s + (b − a − 1) ln(1 + eˢ)
  const lf = (s: number) => -x * Math.exp(s) + a * s + (b - a - 1) * log1pExp(s)
  // Peak: the log integrand is concave in s for these terms when b − a − 1 ≤ 0; in general
  // scan for it on a coarse grid.
  let sPeak = 0
  let best = Number.NEGATIVE_INFINITY
  for (let s = -60; s <= 60; s += 0.25) {
    const v = lf(s)
    if (v > best) {
      best = v
      sPeak = s
    }
  }
  const h = 0.05
  let sum = 0
  for (let dir = -1; dir <= 1; dir += 2) {
    for (let k = dir === -1 ? 0 : 1; k < 400000; k++) {
      const v = lf(sPeak + dir * k * h) - best
      sum += Math.exp(v)
      if (v < -45) break
    }
  }
  return Math.exp(best - lgamma(a) + Math.log(h * sum))
}

function log1pExp(s: number): number {
  return s > 0 ? s + Math.log1p(Math.exp(-s)) : Math.log1p(Math.exp(s))
}

/**
 * Gauss's hypergeometric function F(a, b; c; x) = ₂F₁ (DLMF 15.2.1) for x < 1: the series for
 * 0 ≤ x < 1, Pfaff's transformation F = (1 − x)^{−a} F(a, c − b; c; x/(x − 1)) (DLMF 15.8.1)
 * for x < 0; at x = 1 Gauss's sum Γ(c)Γ(c − a − b)/(Γ(c − a)Γ(c − b)) when c − a − b > 0. NaN for
 * x > 1.
 */
export function hypergeometricF(a: number, b: number, c: number, x: number): number {
  if (Number.isNaN(a + b + c + x) || x > 1) return Number.NaN
  if (c <= 0 && Number.isInteger(c)) return Number.NaN
  if (x === 1) {
    if (!(c - a - b > 0)) return Number.POSITIVE_INFINITY
    return (
      Math.exp(lnGammaAbs(c) + lnGammaAbs(c - a - b) - lnGammaAbs(c - a) - lnGammaAbs(c - b)) *
      gammaSign(c, c - a - b, c - a, c - b)
    )
  }
  if (x < 0) return (1 - x) ** -a * seriesF(a, c - b, c, x / (x - 1))
  return seriesF(a, b, c, x)
}

function gammaSign(p: number, q: number, r: number, s: number): number {
  const sg = (v: number) => (v > 0 || Math.floor(v) % 2 === 0 ? 1 : -1)
  return sg(p) * sg(q) * sg(r) * sg(s)
}

function seriesF(a: number, b: number, c: number, x: number): number {
  let term = 1
  let s = 1
  for (let k = 0; k < 1000000; k++) {
    term *= (((a + k) * (b + k)) / ((c + k) * (k + 1))) * x
    s += term
    if (term === 0 || (Math.abs(term) < 1e-17 * Math.abs(s) && k > 5)) break
    if (!Number.isFinite(s)) break
  }
  return s
}
