import { gauss10 } from '../numint/quadrature.ts'
import { cdfFast, phiFast, sfFast } from './normalFast.ts'

/**
 * P(a < Z < b) for a standard normal Z, a ≤ b, with full relative accuracy: for short intervals
 * (b − a < 1) the density is integrated directly with 10-point Gauss–Legendre (φ is entire, and
 * over a unit interval that rule is exact to rounding), which avoids the cancellation in
 * Φ(b) − Φ(a); otherwise the difference is taken in whichever tail keeps both terms small.
 */
export function normalBand(a: number, b: number): number {
  if (!(b > a)) return 0
  if (b - a < 1) {
    if (a > 38.5 || b < -38.5) return 0
    return gauss10(phiFast, a, b)
  }
  // max(0, ·): the piecewise approximations are monotone only to rounding.
  if (a >= 0) return Math.max(0, sfFast(a) - sfFast(b))
  if (b <= 0) return Math.max(0, cdfFast(b) - cdfFast(a))
  return 1 - cdfFast(a) - sfFast(b)
}

/** ln Φ(z), accurate in both tails. */
export function logNormalCdf(z: number): number {
  return z > 0 ? Math.log1p(-sfFast(z)) : Math.log(cdfFast(z))
}
