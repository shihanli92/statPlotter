import { poly } from '../linalg/forms.ts'
import { gammaUpperCF } from '../special/gammaInc.ts'

const INV_SQRT_2PI = 0.3989422804014327

/**
 * Standard normal density. exp(−z²/2) is evaluated as exp(−zs²/2)·exp(−(z−zs)(z+zs)/2) with
 * zs = z rounded to 1/16, so the rounding error of z² (which would be amplified by up to ~700
 * in the exponent) does not cost relative accuracy in the far tails (Cody 1993, TOMS 715).
 */
export function normalPdf(z: number): number {
  const a = Math.abs(z)
  if (a > 40) return 0
  const zs = Math.trunc(a * 16) / 16
  return INV_SQRT_2PI * Math.exp(-0.5 * zs * zs) * Math.exp(-0.5 * (a - zs) * (a + zs))
}

/** Upper tail Q(z) = P(Z > z) for z ≥ 0. */
function upperTail(z: number): number {
  if (z < 2) {
    // Φ(z) − ½ = φ(z) Σ_{k≥0} z^{2k+1} / (1·3·5···(2k+1))  (Marsaglia 2004, J. Stat. Softw.
    // 11(4)). All terms positive; Q ≥ 0.023 here, so ½ − (…) loses under two digits.
    const z2 = z * z
    let term = z
    let sum = z
    for (let k = 1; k < 200; k++) {
      term *= z2 / (2 * k + 1)
      sum += term
      if (term < sum * 1e-17) break
    }
    return 0.5 - normalPdf(z) * sum
  }
  if (z > 40) return 0
  // Q(z) = ½ Q_Γ(½, z²/2) = ½ · z φ(z) · CF, with Legendre's continued fraction for the
  // upper incomplete gamma function.
  return 0.5 * z * normalPdf(z) * gammaUpperCF(0.5, 0.5 * z * z, 9_999)
}

/** Standard normal CDF Φ(z), with full relative accuracy in the lower tail. */
export function normalCdf(z: number): number {
  if (Number.isNaN(z)) return z
  return z <= 0 ? upperTail(-z) : 1 - upperTail(z)
}

/** Standard normal survival function 1 − Φ(z), computed directly (never as 1 − Φ). */
export function normalSf(z: number): number {
  if (Number.isNaN(z)) return z
  return z >= 0 ? upperTail(z) : 1 - upperTail(-z)
}

// Wichura (1988), Algorithm AS 241 PPND16, Applied Statistics 37(3), 477–484: rational
// approximations accurate to about 1e−16.
const A = [
  3.3871328727963665, 133.14166789178438, 1971.5909503065513, 13731.69376550946, 45921.95393154987,
  67265.7709270087, 33430.57558358813, 2509.0809287301227,
]
const B = [
  1, 42.31333070160091, 687.1870074920579, 5394.196021424751, 21213.794301586597, 39307.89580009271,
  28729.085735721943, 5226.495278852854,
]
const C = [
  1.4234371107496835, 4.630337846156546, 5.769497221460691, 3.6478483247632045, 1.2704582524523684,
  0.2417807251774506, 0.022723844989269184, 0.0007745450142783414,
]
const D = [
  1, 2.053191626637759, 1.6763848301838038, 0.6897673349851, 0.14810397642748008,
  0.015198666563616457, 0.0005475938084995345, 1.0507500716444169e-9,
]
const E = [
  6.657904643501103, 5.463784911164114, 1.7848265399172913, 0.29656057182850487,
  0.026532189526576124, 0.0012426609473880784, 2.7115555687434876e-5, 2.0103343992922881e-7,
]
const F = [
  1, 0.599832206555888, 0.1369298809227358, 0.014875361290850615, 0.0007868691311456133,
  1.8463183175100548e-5, 1.421511758316446e-7, 2.0442631033899397e-15,
]

/**
 * Standard normal quantile (AS 241). `p` is a lower-tail probability, or an upper-tail one
 * when lowerTail is false; passing the small tail directly keeps precision for p near 1.
 */
export function normalQuantile(p: number, lowerTail = true): number {
  if (Number.isNaN(p) || p < 0 || p > 1) return Number.NaN
  // Work with the lower-tail probability pl and, for the tails, the smaller of pl and 1 − pl
  // taken from whichever of p / 1 − p is exact.
  const pl = lowerTail ? p : 1 - p
  const q = pl - 0.5
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q
    return (q * poly(A, r)) / poly(B, r)
  }
  // Smaller tail probability, taken from p directly (1 − p is exact for p ≥ ½).
  const tail = p < 0.5 ? p : 1 - p
  if (tail === 0) return q < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  let r = Math.sqrt(-Math.log(tail))
  let x: number
  if (r <= 5) {
    r -= 1.6
    x = poly(C, r) / poly(D, r)
  } else {
    r -= 5
    x = poly(E, r) / poly(F, r)
  }
  // x is the quantile for the upper tail `tail`; the sign follows which side pl is on.
  return q < 0 ? -x : x
}
