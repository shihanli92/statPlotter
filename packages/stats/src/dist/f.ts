import { ibeta } from '../special/beta.ts'

/**
 * Both tails of the F(d1, d2) distribution at x: I_z(d1/2, d2/2) with z = d1x/(d1x + d2)
 * (A&S 26.6.2); z and 1 − z are formed as ratios, never by subtraction.
 */
function fTails(x: number, d1: number, d2: number): [number, number] {
  if (Number.isNaN(x) || !(d1 > 0) || !(d2 > 0)) return [Number.NaN, Number.NaN]
  if (x <= 0) return [0, 1]
  if (x === Number.POSITIVE_INFINITY) return [1, 0]
  const u = d1 * x
  let z: number
  let w: number
  if (u <= d2) {
    const r = u / d2
    z = r / (1 + r)
    w = 1 / (1 + r)
  } else {
    const r = d2 / u
    z = 1 / (1 + r)
    w = r / (1 + r)
  }
  return ibeta(z, w, d1 / 2, d2 / 2)
}

/** F distribution CDF P(F ≤ x) with d1 (numerator) and d2 (denominator) degrees of freedom. */
export function fCdf(x: number, d1: number, d2: number): number {
  return fTails(x, d1, d2)[0]
}

/** F distribution survival function P(F > x), computed directly. */
export function fSf(x: number, d1: number, d2: number): number {
  return fTails(x, d1, d2)[1]
}
