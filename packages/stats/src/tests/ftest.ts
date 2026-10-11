import { variance } from '../descriptive/basic.ts'
import { fCdf, fSf } from '../dist/f.ts'

export interface FTestResult {
  /** Larger variance / smaller variance (≥ 1). */
  F: number
  /** Numerator df: n − 1 of the group with the larger variance. */
  dfn: number
  dfd: number
  /** Two-sided P, 2·min(P(F' ≤ F), P(F' ≥ F)) — identical to R's var.test either way round. */
  p: number
  varA: number
  varB: number
}

/** F test comparing the variances of two samples. */
export function fTestVariances(a: ArrayLike<number>, b: ArrayLike<number>): FTestResult {
  const varA = variance(a)
  const varB = variance(b)
  const aLarger = varA >= varB
  const F = aLarger ? varA / varB : varB / varA
  const dfn = (aLarger ? a.length : b.length) - 1
  const dfd = (aLarger ? b.length : a.length) - 1
  const p = 2 * Math.min(fCdf(F, dfn, dfd), fSf(F, dfn, dfd))
  return { F, dfn, dfd, p, varA, varB }
}
