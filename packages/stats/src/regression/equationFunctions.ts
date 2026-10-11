import { betaQuantile, gammaQuantile } from '../dist/betaGammaQuantile.ts'
import { binomSf } from '../dist/binomial.ts'
import { chiSqSf } from '../dist/chisq.ts'
import { fSf } from '../dist/f.ts'
import { normalPdf, normalQuantile, normalSf } from '../dist/normal.ts'
import { tPdf, tQuantile, tSf } from '../dist/t.ts'
import { betaInc } from '../special/beta.ts'
import {
  besselI,
  besselJ,
  besselK,
  besselY,
  betaFn,
  digamma,
  erf,
  erfc,
  factorial,
  gammaFn,
  hypergeometricF,
  hypergeometricM,
  hypergeometricU,
  lnGammaAbs,
  trigamma,
} from '../special/functions.ts'
import { lbeta, lgamma } from '../special/gamma.ts'
import { igamma } from '../special/gammaInc.ts'

/**
 * The special and distribution functions for user-defined equations. Each has a value and,
 * where it is cheap,
 * analytic partial derivatives for the automatic differentiation of the equation; a missing
 * partial is taken by central differences (only ever for arguments that depend on parameters,
 * e.g. the shape arguments of the incomplete gamma or hypergeometric functions).
 *
 * Tails. tdist, fdist and chidist are upper-tail P values, chisqc is the lower tail, tinv the
 * inverse of a two-tailed P and finv / chiinv inverses of upper tails. zdist is the standard
 * normal CDF (Excel's NORMSDIST, the cumulative probability, so zdist(1.96) = 0.975, which the
 * cumulative-Gaussian equations rely on), zinv its inverse, normdist the normal CDF and norminv
 * its quantile. An optional tail argument is accepted in quotes: "left", "right" or "two"
 * (zdist, zinv, normdist, norminv, tdist).
 */

export const TAIL_CODES: Record<string, number> = {
  left: 0,
  lower: 0,
  right: 1,
  upper: 1,
  two: 2,
  both: 2,
}
const LEFT = 0
const RIGHT = 1
const TWO = 2

export interface SpecialFn {
  /** Number of numeric arguments [min, max] (a quoted tail comes on top when `tail` is set). */
  arity: [number, number]
  /** Accepts a quoted tail as its last argument, with this default. */
  tail?: number
  f(a: readonly number[]): number
  /**
   * ∂f/∂a[i] at the arguments (v = f(a)); undefined → central differences. Integer-valued
   * arguments (Bessel orders, binomial counts) return 0.
   */
  d?(a: readonly number[], i: number, v: number): number | undefined
}

const SQRT_PI = Math.sqrt(Math.PI)
const nan = Number.NaN

/** Probability of the given tail for a symmetric distribution with upper tail `sf`. */
function symTail(sf: (z: number) => number, z: number, tail: number): number {
  if (tail === LEFT) return sf(-z)
  if (tail === TWO) return Math.min(1, 2 * sf(Math.abs(z)))
  return sf(z)
}

/** d(tail)/dz for a symmetric distribution with density pdf. */
function symTailD(pdf: number, z: number, tail: number): number {
  if (tail === LEFT) return pdf
  if (tail === TWO) return -2 * Math.sign(z) * pdf
  return -pdf
}

/** Standard normal quantile for a probability of the given tail. */
function zQuantile(p: number, tail: number): number {
  if (tail === LEFT) return normalQuantile(p)
  if (tail === TWO) return normalQuantile(p / 2, false)
  return normalQuantile(p, false)
}

/** F density (R's df), through logs. */
function fDensity(x: number, d1: number, d2: number): number {
  if (Number.isNaN(x) || !(d1 > 0) || !(d2 > 0)) return nan
  if (x < 0) return 0
  if (x === 0) return d1 < 2 ? Number.POSITIVE_INFINITY : d1 === 2 ? 1 : 0
  const l =
    (d1 / 2) * Math.log(d1 * x) +
    (d2 / 2) * Math.log(d2) -
    ((d1 + d2) / 2) * Math.log(d1 * x + d2) -
    Math.log(x) -
    lbeta(d1 / 2, d2 / 2)
  return Math.exp(l)
}

function chiDensity(x: number, v: number): number {
  if (!(x > 0)) return x === 0 ? (v < 2 ? Number.POSITIVE_INFINITY : v === 2 ? 0.5 : 0) : 0
  const k = v / 2
  return Math.exp((k - 1) * Math.log(x / 2) - x / 2 - lgamma(k)) / 2
}

const intArg = (v: number) => Number.isInteger(v)

export const SPECIAL_FUNCTIONS: Record<string, SpecialFn> = {
  gamma: {
    arity: [1, 1],
    f: (a) => gammaFn(a[0]!),
    d: (a, _i, v) => v * digamma(a[0]!),
  },
  gammaln: { arity: [1, 1], f: (a) => lnGammaAbs(a[0]!), d: (a) => digamma(a[0]!) },
  beta: {
    arity: [2, 2],
    f: (a) => betaFn(a[0]!, a[1]!),
    d: (a, i, v) => v * (digamma(a[i]!) - digamma(a[0]! + a[1]!)),
  },
  ibeta: {
    // ibeta(a, b, x): the regularized incomplete beta I_x(a, b).
    arity: [3, 3],
    f: (a) => {
      const [p, q, x] = [a[0]!, a[1]!, a[2]!]
      if (Number.isNaN(x) || !(p > 0) || !(q > 0)) return nan
      return x <= 0 ? 0 : x >= 1 ? 1 : betaInc(x, p, q)
    },
    d: (a, i) => {
      if (i !== 2) return undefined
      const [p, q, x] = [a[0]!, a[1]!, a[2]!]
      if (!(x > 0 && x < 1)) return 0
      return Math.exp((p - 1) * Math.log(x) + (q - 1) * Math.log1p(-x) - lbeta(p, q))
    },
  },
  igamma: {
    // igamma(a, x) = P(a, x), the regularized lower incomplete gamma (Excel GAMMADIST(x, a, 1, TRUE)).
    arity: [2, 2],
    f: (a) => igamma(a[0]!, a[1]!)[0],
    d: (a, i) => (i === 1 ? gammaDensity(a[0]!, a[1]!) : undefined),
  },
  igammac: {
    arity: [2, 2],
    f: (a) => igamma(a[0]!, a[1]!)[1],
    d: (a, i) => (i === 1 ? -gammaDensity(a[0]!, a[1]!) : undefined),
  },
  erf: { arity: [1, 1], f: (a) => erf(a[0]!), d: (a) => (2 / SQRT_PI) * Math.exp(-(a[0]! ** 2)) },
  erfc: {
    arity: [1, 1],
    f: (a) => erfc(a[0]!),
    d: (a) => (-2 / SQRT_PI) * Math.exp(-(a[0]! ** 2)),
  },
  psi: { arity: [1, 1], f: (a) => digamma(a[0]!), d: (a) => trigamma(a[0]!) },
  besselj: {
    arity: [2, 2],
    f: (a) => besselJ(a[0]!, a[1]!),
    d: (a, i) => (i === 0 ? 0 : (besselJ(a[0]! - 1, a[1]!) - besselJ(a[0]! + 1, a[1]!)) / 2),
  },
  bessely: {
    arity: [2, 2],
    f: (a) => besselY(a[0]!, a[1]!),
    d: (a, i) => (i === 0 ? 0 : (besselY(a[0]! - 1, a[1]!) - besselY(a[0]! + 1, a[1]!)) / 2),
  },
  besseli: {
    arity: [2, 2],
    f: (a) => besselI(a[0]!, a[1]!),
    d: (a, i) => (i === 0 ? 0 : (besselI(a[0]! - 1, a[1]!) + besselI(a[0]! + 1, a[1]!)) / 2),
  },
  besselk: {
    arity: [2, 2],
    f: (a) => besselK(a[0]!, a[1]!),
    d: (a, i) => (i === 0 ? 0 : -(besselK(a[0]! - 1, a[1]!) + besselK(a[0]! + 1, a[1]!)) / 2),
  },
  hypgeometricm: {
    arity: [3, 3],
    f: (a) => hypergeometricM(a[0]!, a[1]!, a[2]!),
    d: (a, i) =>
      i === 2 ? (a[0]! / a[1]!) * hypergeometricM(a[0]! + 1, a[1]! + 1, a[2]!) : undefined,
  },
  hypgeometricu: {
    arity: [3, 3],
    f: (a) => hypergeometricU(a[0]!, a[1]!, a[2]!),
    d: (a, i) => (i === 2 ? -a[0]! * hypergeometricU(a[0]! + 1, a[1]! + 1, a[2]!) : undefined),
  },
  hypgeometricf: {
    arity: [4, 4],
    f: (a) => hypergeometricF(a[0]!, a[1]!, a[2]!, a[3]!),
    d: (a, i) =>
      i === 3
        ? ((a[0]! * a[1]!) / a[2]!) * hypergeometricF(a[0]! + 1, a[1]! + 1, a[2]! + 1, a[3]!)
        : undefined,
  },
  // ---- distributions ----------------------------------------------------------------------
  zdist: {
    arity: [1, 1],
    tail: LEFT,
    f: (a) => symTail(normalSf, a[0]!, a[1]!),
    d: (a, i) => (i === 0 ? symTailD(normalPdf(a[0]!), a[0]!, a[1]!) : 0),
  },
  zinv: {
    arity: [1, 1],
    tail: LEFT,
    f: (a) => zQuantile(a[0]!, a[1]!),
    d: (a, i, v) => (i === 0 ? 1 / symTailD(normalPdf(v), v, a[1]!) : 0),
  },
  zpdf: { arity: [1, 1], f: (a) => normalPdf(a[0]!), d: (a, _i, v) => -a[0]! * v },
  normdist: {
    arity: [3, 3],
    tail: LEFT,
    f: (a) => {
      const sd = a[2]!
      if (!(sd > 0)) return nan
      return symTail(normalSf, (a[0]! - a[1]!) / sd, a[3]!)
    },
    d: (a, i) => {
      const sd = a[2]!
      const z = (a[0]! - a[1]!) / sd
      const dz = symTailD(normalPdf(z), z, a[3]!)
      if (i === 0) return dz / sd
      if (i === 1) return -dz / sd
      if (i === 2) return (-dz * z) / sd
      return 0
    },
  },
  norminv: {
    arity: [3, 3],
    tail: LEFT,
    f: (a) => {
      const sd = a[2]!
      if (!(sd > 0)) return nan
      return a[1]! + sd * zQuantile(a[0]!, a[3]!)
    },
    d: (a, i, v) => {
      const sd = a[2]!
      const z = (v - a[1]!) / sd
      if (i === 0) return sd / symTailD(normalPdf(z), z, a[3]!)
      if (i === 1) return 1
      if (i === 2) return z
      return 0
    },
  },
  normpdf: {
    arity: [3, 3],
    f: (a) => {
      const sd = a[2]!
      if (!(sd > 0)) return nan
      return normalPdf((a[0]! - a[1]!) / sd) / sd
    },
    d: (a, i, v) => {
      const sd = a[2]!
      const z = (a[0]! - a[1]!) / sd
      if (i === 0) return (-v * z) / sd
      if (i === 1) return (v * z) / sd
      return (v * (z * z - 1)) / sd
    },
  },
  tdist: {
    arity: [2, 2],
    tail: RIGHT,
    f: (a) => symTail((t) => tSf(t, a[1]!), a[0]!, a[2]!),
    d: (a, i) => (i === 0 ? symTailD(tPdf(a[0]!, a[1]!), a[0]!, a[2]!) : undefined),
  },
  tinv: {
    // Two-tailed: t with P(|T| > t) = p.
    arity: [2, 2],
    f: (a) => tQuantile(a[0]! / 2, a[1]!, false),
    d: (a, i, v) => (i === 0 ? -1 / (2 * tPdf(v, a[1]!)) : undefined),
  },
  tpdf: { arity: [2, 2], f: (a) => tPdf(a[0]!, a[1]!) },
  fdist: {
    arity: [3, 3],
    f: (a) => fSf(a[0]!, a[1]!, a[2]!),
    d: (a, i) => (i === 0 ? -fDensity(a[0]!, a[1]!, a[2]!) : undefined),
  },
  finv: {
    // Upper tail: F with P(F > f) = p; through the beta quantile, both tails computed directly.
    arity: [3, 3],
    f: (a) => {
      const [p, d1, d2] = [a[0]!, a[1]!, a[2]!]
      if (Number.isNaN(p) || !(d1 > 0) || !(d2 > 0) || p < 0 || p > 1) return nan
      if (p === 0) return Number.POSITIVE_INFINITY
      if (p === 1) return 0
      const z = betaQuantile(p, d1 / 2, d2 / 2, false)
      const w = betaQuantile(p, d2 / 2, d1 / 2, true)
      return (d2 * z) / (d1 * w)
    },
    d: (a, i, v) => (i === 0 ? -1 / fDensity(v, a[1]!, a[2]!) : undefined),
  },
  fpdf: { arity: [3, 3], f: (a) => fDensity(a[0]!, a[1]!, a[2]!) },
  chidist: {
    arity: [2, 2],
    f: (a) => chiSqSf(a[0]!, a[1]!),
    d: (a, i) => (i === 0 ? -chiDensity(a[0]!, a[1]!) : undefined),
  },
  chiinv: {
    arity: [2, 2],
    f: (a) => 2 * gammaQuantile(a[0]!, a[1]! / 2, false),
    d: (a, i, v) => (i === 0 ? -1 / chiDensity(v, a[1]!) : undefined),
  },
  chisqc: {
    arity: [2, 2],
    f: (a) => {
      if (Number.isNaN(a[0]!) || !(a[1]! > 0)) return nan
      return igamma(a[1]! / 2, a[0]! / 2)[0]
    },
    d: (a, i) => (i === 0 ? chiDensity(a[0]!, a[1]!) : undefined),
  },
  binomial: {
    // P(X ≥ k) for X ~ Bin(n, p).
    arity: [3, 3],
    f: (a) => {
      const [k, n, p] = [a[0]!, a[1]!, a[2]!]
      if (!intArg(k) || !intArg(n) || n < 0 || !(p >= 0 && p <= 1)) return nan
      return binomSf(k - 1, n, p)
    },
    d: (a, i) => {
      if (i !== 2) return 0
      // d/dp P(X ≥ k) = n·C(n−1, k−1) p^(k−1) (1−p)^(n−k)
      const [k, n, p] = [a[0]!, a[1]!, a[2]!]
      if (k <= 0 || k > n) return 0
      return Math.exp(
        Math.log(n) +
          lgamma(n) -
          lgamma(k) -
          lgamma(n - k + 1) +
          (k - 1) * Math.log(p) +
          (n - k) * Math.log1p(-p),
      )
    },
  },
  fact: { arity: [1, 1], f: (a) => factorial(a[0]!), d: () => 0 },
  perc: { arity: [1, 1], f: (a) => a[0]! / 100, d: () => 0.01 },
  logit: {
    arity: [1, 1],
    f: (a) => Math.log(a[0]! / (1 - a[0]!)),
    d: (a) => 1 / (a[0]! * (1 - a[0]!)),
  },
  probit: {
    arity: [1, 1],
    f: (a) => 5 + normalQuantile(a[0]!),
    d: (_a, _i, v) => 1 / normalPdf(v - 5),
  },
  is_defined: { arity: [1, 1], f: (a) => (Number.isNaN(a[0]!) ? 0 : 1), d: () => 0 },
}

/** Aliases (the task's and common spellings). */
SPECIAL_FUNCTIONS.lngamma = SPECIAL_FUNCTIONS.gammaln!
SPECIAL_FUNCTIONS.digamma = SPECIAL_FUNCTIONS.psi!
SPECIAL_FUNCTIONS.normsdist = SPECIAL_FUNCTIONS.zdist!

/** x^(a−1) e^(−x) / Γ(a), the derivative of P(a, x) in x. */
function gammaDensity(a: number, x: number): number {
  if (!(x > 0) || !(a > 0)) return 0
  return Math.exp((a - 1) * Math.log(x) - x - lgamma(a))
}
