import { igamma } from '../special/gammaInc.ts'

/** Chi-square CDF: P(k/2, x/2) (regularized lower incomplete gamma). */
export function chiSqCdf(x: number, k: number): number {
  if (Number.isNaN(x) || !(k > 0)) return Number.NaN
  return igamma(k / 2, x / 2)[0]
}

/** Chi-square survival function Q(k/2, x/2), computed directly. */
export function chiSqSf(x: number, k: number): number {
  if (Number.isNaN(x) || !(k > 0)) return Number.NaN
  return igamma(k / 2, x / 2)[1]
}
