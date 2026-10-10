import { betaPowerTerm } from './gamma.ts'

const EPS = 1e-16
const TINY = 1e-300
const MAX_ITER = 100_000

/**
 * Continued fraction for I_x(a,b) (Abramowitz & Stegun 26.5.8; Numerical Recipes §6.4),
 * evaluated with the modified Lentz method (Thompson & Barnett 1986):
 *   I_x(a,b) = [x^a y^b / (a B(a,b))] · 1/(1+ d1/(1+ d2/(1+ …)))
 *   d_{2m+1} = −(a+m)(a+b+m) x / ((a+2m)(a+2m+1)),  d_{2m} = m(b−m) x / ((a+2m−1)(a+2m)).
 * Converges quickly for x < (a+1)/(a+b+2); iterations grow like √max(a,b) near that point.
 */
function betaCf(x: number, a: number, b: number): number {
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < TINY) d = TINY
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/**
 * Regularized incomplete beta, both tails: [I_x(a,b), 1 − I_x(a,b)], with y = 1 − x passed
 * separately so callers that know 1 − x more accurately than by subtraction (t and F tails)
 * keep that precision.
 *
 * The continued fraction is run in whichever variable it converges for (x < (a+1)/(a+b+2),
 * else via I_x(a,b) = 1 − I_y(b,a)), and that tail is computed directly; the other tail is its
 * complement, which near the switch point is not small.
 *
 * One refinement: when that variable is close to 1 with a large (a ≳ 1e3), the fraction is
 * ill-conditioned — its value moves by ~a·ε for a one-ulp change in x, and rounding inside the
 * recurrence behaves the same way (e.g. 7e−12 relative for a t tail at df = 1e5, t = 2).
 * The other fraction, run in the small, accurately known variable y = 1 − x, is then
 * well conditioned provided b ≤ 1 (the t distribution has b = ½) and y is within 2× of its own
 * switch point (b+1)/(a+b+2); its complement is used when that complement is ≥ 1e−3, so the
 * subtraction costs ≲ 1e−13. Measured against 60-digit mpmath: further out, or for larger b,
 * that fraction converges to wrong values (errors up to 1e−8), so it is not used there.
 * The remaining error of the plain fraction grows like a·1e−16: ≲ 2e−12 at a = 5e4,
 * ~2e−11 at a = 5e5.
 */
export function ibeta(x: number, y: number, a: number, b: number): [number, number] {
  if (Number.isNaN(x) || Number.isNaN(y) || !(a > 0) || !(b > 0)) return [Number.NaN, Number.NaN]
  if (x <= 0) return [0, 1]
  if (y <= 0) return [1, 0]
  if (x < (a + 1) / (a + b + 2)) {
    if (a >= LARGE && b <= 1 && y < (2 * (b + 1)) / (a + b + 2)) {
      const upper = cfTail(y, x, b, a)
      if (upper >= 0 && upper <= 1 - SWITCH) return [1 - upper, upper]
    }
    const lower = cfTail(x, y, a, b)
    return [lower, 1 - lower]
  }
  if (b >= LARGE && a <= 1 && x < (2 * (a + 1)) / (a + b + 2)) {
    const lower = cfTail(x, y, a, b)
    if (lower >= 0 && lower <= 1 - SWITCH) return [lower, 1 - lower]
  }
  const upper = cfTail(y, x, b, a)
  return [1 - upper, upper]
}

/** Parameter size above which the fraction near x = 1 is ill-conditioned (see ibeta). */
const LARGE = 1000
/** Smallest complement accepted from the well-conditioned fraction (see ibeta). */
const SWITCH = 1e-3

/** I_x(a, b) by the continued fraction, y = 1 − x. */
function cfTail(x: number, y: number, a: number, b: number): number {
  return (betaPowerTerm(x, y, a, b) * betaCf(x, a, b)) / a
}

/** Regularized incomplete beta function I_x(a, b) (the Beta(a, b) CDF at x). */
export function betaInc(x: number, a: number, b: number): number {
  if (x >= 1) return Number.isNaN(a + b) ? Number.NaN : 1
  return ibeta(x, 1 - x, a, b)[0]
}

/** 1 − I_x(a, b), computed directly (no cancellation when I_x(a, b) is close to 1). */
export function betaIncComplement(x: number, a: number, b: number): number {
  if (x >= 1) return Number.isNaN(a + b) ? Number.NaN : 0
  return ibeta(x, 1 - x, a, b)[1]
}
