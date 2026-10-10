import { solveMonotone } from '../numint/roots.ts'
import { ibeta } from '../special/beta.ts'
import { igamma } from '../special/gammaInc.ts'

/**
 * Quantile of the Beta(a, b) distribution: x with I_x(a, b) = p (lowerTail) or
 * 1 − I_x(a, b) = p. Solved on u = ln x against the log of the requested tail, which is
 * computed directly (no complement), so small tail probabilities keep full relative accuracy;
 * 1 − x is formed as −expm1(u).
 */
export function betaQuantile(p: number, a: number, b: number, lowerTail = true): number {
  if (Number.isNaN(p) || !(a > 0) || !(b > 0) || p < 0 || p > 1) return Number.NaN
  if (p === 0) return lowerTail ? 0 : 1
  if (p === 1) return lowerTail ? 1 : 0
  const lp = Math.log(p)
  const tail = (u: number): number => {
    const r = ibeta(Math.exp(u), -Math.expm1(u), a, b)
    return Math.log(lowerTail ? r[0] : r[1])
  }
  // F increasing in u either way.
  const F = lowerTail ? (u: number) => tail(u) - lp : (u: number) => lp - tail(u)
  const u0 = Math.log(a / (a + b))
  const u = solveMonotone(F, u0, 0.5)
  return Math.min(1, Math.exp(u))
}

/**
 * Quantile of the Gamma(shape a, scale 1) distribution: x with P(a, x) = p (lowerTail) or
 * Q(a, x) = p, solved on ln x against the log of the requested tail (computed directly).
 */
export function gammaQuantile(p: number, a: number, lowerTail = true): number {
  if (Number.isNaN(p) || !(a > 0) || p < 0 || p > 1) return Number.NaN
  if (p === 0) return lowerTail ? 0 : Number.POSITIVE_INFINITY
  if (p === 1) return lowerTail ? Number.POSITIVE_INFINITY : 0
  if (a === 1) return lowerTail ? -Math.log1p(-p) : -Math.log(p)
  const lp = Math.log(p)
  const F = lowerTail
    ? (u: number): number => Math.log(igamma(a, Math.exp(u))[0]) - lp
    : (u: number): number => lp - Math.log(igamma(a, Math.exp(u))[1])
  return Math.exp(solveMonotone(F, Math.log(a), 0.5))
}

/** Quantile of the chi-square distribution with df degrees of freedom (lower tail). */
export function chiSqQuantile(p: number, df: number): number {
  return 2 * gammaQuantile(p, df / 2)
}
