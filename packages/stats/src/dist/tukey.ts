import { type ChebTable, chebEval, chebTable } from '../numint/chebTable.ts'
import { chiMixture } from '../numint/chiMixture.ts'
import { integrate, supportBreaks } from '../numint/quadrature.ts'
import { solveMonotone } from '../numint/roots.ts'
import { betaInc } from '../special/beta.ts'
import { normalBand } from './normalBand.ts'
import { cdfFast, phiFast, sfFast } from './normalFast.ts'
import { tQuantile, tSf } from './t.ts'

/**
 * Studentized range distribution: Q = (max − min of k independent N(μ, σ²) means) / S, with
 * νS²/σ² ~ χ²_ν independent of the means.
 *
 * Known variance (Hartley 1942; Copenhaver & Holland 1988, J. Stat. Comput. Simul. 30, 1–15,
 * eq. 2.1):
 *   P(W ≤ w) = k ∫ φ(z) [Φ(z) − Φ(z − w)]^{k−1} dz,
 * and for finite ν, P(Q ≤ q) = E[P(W ≤ qS)] with S = χ_ν/√ν (Copenhaver & Holland eq. 2.2),
 * computed by chiMixture. Instead of Copenhaver & Holland's fixed 16-point Gauss–Legendre
 * panels (the basis of R's ptukey, good to ~1e−8), both integrals are adaptive (Gauss–Kronrod)
 * with relative tolerances near 1e−13.
 *
 * The upper tail is integrated directly rather than as 1 − P, using
 *   P(W > w) = k ∫ φ(z) (Φ(z)^{k−1} − [Φ(z) − Φ(z − w)]^{k−1}) dz
 * (the first term integrates to 1), with the bracket written as
 *   Φ(z)^{k−1} · (−expm1((k−1) ln(1 − Φ(z − w)/Φ(z)))),
 * so every integrand is positive and small tail probabilities keep their relative accuracy.
 *
 * Speed: for finite ν the inner (known-variance) probability is needed at hundreds of points
 * per call. It is tabulated once per k — ln P(W ≤ w) − (k−1) ln w on [0, 1] (analytic there,
 * since P(W ≤ w) ~ C w^{k−1}), ln P(W ≤ w) on [1, W_MAX] and ln P(W > w) on [0, W_MAX] — by
 * adaptive piecewise Chebyshev interpolation (chebTable) to ~1e−13, after which ptukey costs a
 * few hundred table look-ups. P(W > W_MAX) < 1e−290 is taken as 0.
 */

const W_MAX = 52

/**
 * k ∫ φ(z) [Φ(z) − Φ(z − w)]^{k−1} dz, the lower tail for known variance; divided by w^{k−1}
 * when `scaled` (the integrand then uses (Φ(z) − Φ(z − w))/w, so nothing underflows as w → 0).
 */
function rangeLowerInf(w: number, k: number, relTol = 1e-13, scaled = false): number {
  if (!(w > 0)) return 0
  if (w === Number.POSITIVE_INFINITY) return 1
  const m = k - 1
  const lw = scaled ? Math.log(w) : 0
  const h = (z: number): number => {
    const d = normalBand(z - w, z)
    return d === 0 ? 0 : k * phiFast(z) * Math.exp(m * (Math.log(d) - lw))
  }
  const breaks = supportBreaks(h, w / 2, k > 20 ? 1 : 2, -40, w + 40)
  const v = integrate(h, breaks, { relTol })
  return scaled ? v : Math.min(1, v)
}

/** k ∫ φ(z) (Φ(z)^{k−1} − [Φ(z) − Φ(z − w)]^{k−1}) dz, the upper tail for known variance. */
function rangeUpperInf(w: number, k: number, relTol = 1e-13): number {
  if (!(w > 0)) return 1
  if (w === Number.POSITIVE_INFINITY) return 0
  const m = k - 1
  const h = (z: number): number => {
    const phi = phiFast(z)
    if (phi === 0) return 0
    const pz = cdfFast(z)
    if (pz === 0) return 0
    const lc = z > 0 ? Math.log1p(-sfFast(z)) : Math.log(pz)
    const r = cdfFast(z - w) / pz
    // ln(1 − r) = ln(D / Φ(z))
    const l1 = r < 0.5 ? Math.log1p(-r) : Math.log(normalBand(z - w, z)) - lc
    return k * phi * Math.exp(m * lc) * -Math.expm1(m * l1)
  }
  const breaks = supportBreaks(h, w / 2, k > 20 ? 1 : 2, -40, w + 40)
  return Math.min(1, integrate(h, breaks, { relTol }))
}

interface RangeTables {
  lowerSmall?: ChebTable
  lowerBig?: ChebTable
  upper?: ChebTable
}

const TABLES = new Map<number, RangeTables>()
const TABLE_TOL = 3e-14
const BUILD_TOL = 5e-14

function tablesFor(k: number): RangeTables {
  let t = TABLES.get(k)
  if (!t) {
    if (TABLES.size > 64) TABLES.clear()
    t = {}
    TABLES.set(k, t)
  }
  return t
}

/** P(W ≤ w) for known variance, from the per-k table. */
function lowerTab(w: number, k: number): number {
  if (!(w > 0)) return 0
  if (w >= W_MAX) return 1
  const t = tablesFor(k)
  const m = k - 1
  if (w <= 1) {
    t.lowerSmall ??= chebTable(
      (x) => Math.log(rangeLowerInf(x, k, BUILD_TOL, true)),
      0,
      1,
      TABLE_TOL,
      TABLE_TOL,
    )
    return Math.exp(chebEval(t.lowerSmall, w) + m * Math.log(w))
  }
  t.lowerBig ??= chebTable(
    (x) => Math.log(rangeLowerInf(x, k, BUILD_TOL)),
    1,
    W_MAX,
    TABLE_TOL,
    TABLE_TOL,
  )
  return Math.min(1, Math.exp(chebEval(t.lowerBig, w)))
}

/** P(W > w) for known variance, from the per-k table. */
function upperTab(w: number, k: number): number {
  if (!(w > 0)) return 1
  if (w >= W_MAX) return 0
  const t = tablesFor(k)
  t.upper ??= chebTable(
    (x) => Math.log(rangeUpperInf(x, k, BUILD_TOL)),
    0,
    W_MAX,
    TABLE_TOL,
    TABLE_TOL,
  )
  return Math.min(1, Math.exp(chebEval(t.upper, w)))
}

function valid(q: number, k: number, df: number): boolean {
  return !Number.isNaN(q) && k >= 2 && Number.isFinite(k) && !Number.isNaN(df) && df > 0
}

/**
 * Studentized range CDF, as R's ptukey(q, nmeans, df, lower.tail): P(Q ≤ q), or P(Q > q) when
 * lowerTail is false (computed directly, not as 1 − P). df may be Infinity. nMeans may be
 * non-integer (the formula is analytic in k) but is normally a count ≥ 2.
 */
export function ptukey(q: number, nMeans: number, df: number, lowerTail = true): number {
  if (!valid(q, nMeans, df)) return Number.NaN
  if (q <= 0) return lowerTail ? 0 : 1
  if (q === Number.POSITIVE_INFINITY) return lowerTail ? 1 : 0
  const k = nMeans
  if (k === 2) {
    // Range of two means = √2·|Z|: Q/√2 is |T| with ν df.
    const x = q / Math.SQRT2
    if (!lowerTail) return df === Number.POSITIVE_INFINITY ? 2 * sfFast(x) : 2 * tSf(x, df)
    // P(|T| ≤ x) = I_{x²/(ν + x²)}(½, ν/2), without the cancellation of 1 − upper.
    if (df === Number.POSITIVE_INFINITY) return normalBand(-x, x)
    const r = (x * x) / df
    return r < 1 ? betaInc(r / (1 + r), 0.5, df / 2) : betaInc(1 / (1 + 1 / r), 0.5, df / 2)
  }
  if (df === Number.POSITIVE_INFINITY) {
    return lowerTail ? rangeLowerInf(q, k) : rangeUpperInf(q, k)
  }
  const inner = lowerTail ? (s: number) => lowerTab(q * s, k) : (s: number) => upperTab(q * s, k)
  return Math.min(1, chiMixture(inner, df, lowerTail))
}

/**
 * Studentized range quantile, as R's qtukey(p, nmeans, df): the q with P(Q ≤ q) = p. Found by
 * Illinois iteration on ln q against the log of whichever tail is smaller (for p ≥ ½ the upper
 * tail 1 − p, which is exact), starting from the Bonferroni bound √2·t_{α/(k(k−1))}.
 */
export function qtukey(p: number, nMeans: number, df: number): number {
  if (Number.isNaN(p) || !(p >= 0 && p <= 1) || !valid(1, nMeans, df)) return Number.NaN
  if (p === 0) return 0
  if (p === 1) return Number.POSITIVE_INFINITY
  const k = nMeans
  const upper = p >= 0.5
  if (k === 2) {
    const x = upper ? tQuantile((1 - p) / 2, df, false) : tQuantile(0.5 + p / 2, df)
    return Math.SQRT2 * x
  }
  const target = Math.log(upper ? 1 - p : p)
  const alpha = upper ? 1 - p : 0.5
  const start = Math.SQRT2 * tQuantile(alpha / (k * (k - 1)), df, false)
  const F = (x: number): number => {
    const v = ptukey(Math.exp(x), k, df, !upper)
    // Increasing in x for the lower tail; the upper tail is flipped so F increases too.
    return upper ? target - Math.log(v) : Math.log(v) - target
  }
  return Math.exp(solveMonotone(F, Math.log(start), 0.05, 1e-14))
}
