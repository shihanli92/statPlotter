import { dpoisRaw } from './gamma.ts'

const EPS = 1e-16
const TINY = 1e-300
const MAX_ITER = 100_000

/**
 * Regularized incomplete gamma, both tails: [P(a,x), Q(a,x)] (Numerical Recipes §6.2).
 * For x < a + 1 the series P = x^a e^−x/Γ(a+1) · Σ x^n / ((a+1)…(a+n)); otherwise Legendre's
 * continued fraction for Q, evaluated with modified Lentz. The prefactor uses Loader's
 * saddle-point form (dpoisRaw) so it keeps relative accuracy for large a.
 */
export function igamma(a: number, x: number): [number, number] {
  if (Number.isNaN(a) || Number.isNaN(x) || !(a > 0)) return [Number.NaN, Number.NaN]
  if (x <= 0) return [0, 1]
  if (x === Number.POSITIVE_INFINITY) return [1, 0]
  if (x < a + 1) {
    let term = 1
    let sum = 1
    for (let n = 1; n <= MAX_ITER; n++) {
      term *= x / (a + n)
      sum += term
      if (term < sum * EPS) break
    }
    const p = dpoisRaw(a, x) * sum
    return [p, 1 - p]
  }
  // x^a e^−x / Γ(a) = a · x^a e^−x / Γ(a+1)
  const q = a * dpoisRaw(a, x) * gammaUpperCF(a, x)
  return [1 - q, q]
}

/**
 * Legendre's continued fraction for the upper incomplete gamma function (NR §6.2), evaluated by
 * modified Lentz: Γ(a, x) = x^a e^−x · CF, for x ≥ a + 1 (at most maxIter terms).
 */
export function gammaUpperCF(a: number, x: number, maxIter = MAX_ITER): number {
  let b = x + 1 - a
  let c = 1 / TINY
  let d = 1 / b
  let h = d
  for (let i = 1; i <= maxIter; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < TINY) d = TINY
    c = b + an / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** Regularized lower incomplete gamma P(a, x). */
export function gammaIncLower(a: number, x: number): number {
  return igamma(a, x)[0]
}

/** Regularized upper incomplete gamma Q(a, x) = 1 − P(a, x), computed directly. */
export function gammaIncUpper(a: number, x: number): number {
  return igamma(a, x)[1]
}
