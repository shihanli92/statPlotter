import { chebFit } from '../numint/chebTable.ts'
import { normalPdf, normalSf } from './normal.ts'

/**
 * Fast standard normal density and tails for the inner loops of numerical integration
 * (studentized range, Dunnett), where Φ is evaluated millions of times.
 *
 * - φ(x) = exp(−x²/2)/√(2π) with x² split exactly as hi + lo (Dekker 1971, "A floating-point
 *   technique for extending the available precision", Numer. Math. 18: Veltkamp splitting), so
 *   exp(−hi/2) is taken of an exactly-halved exact square and exp(−lo/2) by its short Taylor
 *   series: one exp() instead of the two that normalPdf needs for the same relative accuracy.
 * - Q(x) = φ(x)·M(x) for x ≥ 0, with Mills' ratio M(x) = Q(x)/φ(x) approximated by Chebyshev
 *   interpolants on fixed panels (Trefethen, Approximation Theory and Approximation Practice,
 *   ch. 3–4). The interpolants are built once, at load time, from the accurate (continued-
 *   fraction / series) normalSf and normalPdf in normal.ts (Laplace's continued fraction for
 *   x > 8); M is analytic and slowly varying,
 *   so 24 nodes per panel reach rounding level (checked in the tests against normalSf).
 */

const INV_SQRT_2PI = 0.3989422804014327
const SPLIT = 134217729 // 2^27 + 1

/** exp(−x²/2) with relative error ~2 ulp for all x. */
function expHalfSq(x: number): number {
  const c = SPLIT * x
  const hi = c - (c - x)
  const lo = x - hi
  const h2 = hi * hi // exact: hi has at most 26 significant bits
  const a = 0.5 * (2 * hi * lo + lo * lo) // |a| ≲ 1e−8·x²
  const e = Math.exp(-0.5 * h2)
  return e * (1 - a * (1 - a * (0.5 - a * (1 / 6 - a / 24))))
}

export function phiFast(x: number): number {
  return INV_SQRT_2PI * expHalfSq(x)
}

const BREAKS = [0, 0.75, 1.5, 2.25, 3, 4, 5, 6.5, 8, 10, 13, 17, 23, 30, 40]
const NODES = 24 // chebFit's N

/**
 * Mills' ratio by Laplace's continued fraction M(x) = 1/(x + 1/(x + 2/(x + 3/(x + …)))),
 * evaluated backward from 300 terms; used for x > 8, where it converges to rounding and where
 * Q and φ themselves eventually underflow.
 */
function millsCF(x: number): number {
  let t = x
  for (let k = 300; k >= 1; k--) t = x + k / t
  return 1 / t
}

/** Chebyshev coefficients, NODES per panel, flattened (panel p at offset p·NODES). */
const COEFS: Float64Array = (() => {
  const out = new Float64Array((BREAKS.length - 1) * NODES)
  const mills = (x: number) => (x > 8 ? millsCF(x) : normalSf(x) / normalPdf(x))
  for (let p = 0; p + 1 < BREAKS.length; p++)
    out.set(chebFit(mills, BREAKS[p]!, BREAKS[p + 1]!), p * NODES)
  return out
})()
const BR = Float64Array.from(BREAKS)
const LAST = BREAKS.length - 2

/** Mills' ratio Q(x)/φ(x) for 0 ≤ x ≤ 40 (Clenshaw evaluation of the panel's series). */
function millsFast(x: number): number {
  let p = 0
  while (p < LAST && x > BR[p + 1]!) p++
  const a = BR[p]!
  const b = BR[p + 1]!
  const t = (2 * x - a - b) / (b - a)
  const t2 = 2 * t
  const o = p * NODES
  let b1 = 0
  let b2 = 0
  for (let j = o + NODES - 1; j > o; j--) {
    const tmp = t2 * b1 - b2 + COEFS[j]!
    b2 = b1
    b1 = tmp
  }
  return t * b1 - b2 + COEFS[o]!
}

/** Upper tail Q(x) = P(Z > x). */
export function sfFast(x: number): number {
  if (Number.isNaN(x)) return x
  if (x < 0) return 1 - sfFast(-x)
  if (x > 40) return 0
  return phiFast(x) * millsFast(x)
}

/** Φ(x) = P(Z ≤ x). */
export function cdfFast(x: number): number {
  if (Number.isNaN(x)) return x
  if (x > 0) return 1 - sfFast(x)
  if (x < -40) return 0
  return phiFast(x) * millsFast(-x)
}
