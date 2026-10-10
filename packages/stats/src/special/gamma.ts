/**
 * Log-gamma and the building blocks for accurate densities / incomplete-function prefactors.
 *
 * The prefactors x^a (1−x)^b / B(a,b) and x^a e^−x / Γ(a) are evaluated in Loader's
 * saddle-point form (C. Loader, "Fast and accurate computation of binomial probabilities",
 * 2000): a Stirling remainder δ plus a deviance term bd0. Written that way, no two large
 * log-gamma values are subtracted, so tail probabilities keep their relative accuracy even for
 * large degrees of freedom.
 */

/** ½·ln(2π) */
const LN_SQRT_2PI = 0.9189385332046728
/** Euler–Mascheroni constant γ. */
const EULER = 0.5772156649015329

/**
 * ζ(k) − 1 for k = 0..K (entries 0, 1 unused), for the Taylor series of lnΓ around 1 and 2.
 * Computed once by direct summation of n^−k for n = 2..N−1 plus the Euler–Maclaurin tail
 * Σ_{n≥N} n^−k ≈ N^{1−k}/(k−1) + N^−k/2 + k N^{−k−1}/12 − k(k+1)(k+2) N^{−k−3}/720
 *   + k(k+1)(k+2)(k+3)(k+4) N^{−k−5}/30240,
 * whose first omitted term is below 1e−17 relative for N = 40 and every k ≥ 2.
 */
const ZETA_TERMS = 30
const ZETA_M1: Float64Array = (() => {
  const out = new Float64Array(ZETA_TERMS + 1)
  const N = 40
  for (let k = 2; k <= ZETA_TERMS; k++) {
    let tail =
      N ** (1 - k) / (k - 1) +
      N ** -k / 2 +
      (k * N ** (-k - 1)) / 12 -
      (k * (k + 1) * (k + 2) * N ** (-k - 3)) / 720 +
      (k * (k + 1) * (k + 2) * (k + 3) * (k + 4) * N ** (-k - 5)) / 30240
    // Smallest terms first.
    for (let n = N - 1; n >= 2; n--) tail += n ** -k
    out[k] = tail
  }
  return out
})()

/** Σ_{k=2}^{K} (−1)^k (ζ(k)−1) z^k / k, for |z| ≤ ½ (terms fall like (z/2)^k). */
function zetaSeries(z: number): number {
  let s = 0
  for (let k = ZETA_TERMS; k >= 2; k--) {
    const c = ((k % 2 === 0 ? 1 : -1) * ZETA_M1[k]!) / k
    s = (s + c) * z
  }
  return s * z
}

/**
 * Stirling-series coefficients B_{2k} / (2k(2k−1)) for δ(x) = Σ c_k x^{1−2k}; at x ≥ 10 the
 * eight terms leave an error below 1e−17.
 */
const STIRLING = [
  1 / 12,
  -1 / 360,
  1 / 1260,
  -1 / 1680,
  1 / 1188,
  -691 / 360360,
  1 / 156,
  -3617 / 122400,
]

function stirlingSeries(x: number): number {
  const x2 = 1 / (x * x)
  let s = 0
  for (let k = STIRLING.length - 1; k >= 0; k--) s = s * x2 + STIRLING[k]!
  return s / x
}

/**
 * ln Γ(x) for x > 0 (NaN for x ≤ 0 except +∞ at 0).
 *
 * - x ∈ [½, 2½): Taylor series of lnΓ about 1 or 2 using ζ(k) − 1
 *   (Abramowitz & Stegun 6.1.33), so the zeros at x = 1 and 2 keep full relative accuracy:
 *     lnΓ(1+z) = −ln(1+z) + z(1−γ) + Σ (−1)^k (ζ(k)−1) z^k/k
 *     lnΓ(2+z) =             z(1−γ) + Σ (−1)^k (ζ(k)−1) z^k/k
 * - x < ½: lnΓ(x) = lnΓ(x+1) − ln x.
 * - x ∈ [2½, 10): downward recurrence into [1½, 2½).
 * - x ≥ 10: Stirling's series.
 */
export function lgamma(x: number): number {
  if (Number.isNaN(x) || x < 0) return Number.NaN
  if (x === 0) return Number.POSITIVE_INFINITY
  if (x === Number.POSITIVE_INFINITY) return x
  if (x < 0.5) {
    return -Math.log1p(x) + x * (1 - EULER) + zetaSeries(x) - Math.log(x)
  }
  if (x < 1.5) {
    const z = x - 1
    return -Math.log1p(z) + z * (1 - EULER) + zetaSeries(z)
  }
  if (x < 2.5) {
    const z = x - 2
    return z * (1 - EULER) + zetaSeries(z)
  }
  if (x < 10) {
    let y = x
    let prod = 1
    while (y >= 2.5) {
      y -= 1
      prod *= y
    }
    return lgamma(y) + Math.log(prod)
  }
  return (x - 0.5) * Math.log(x) - x + LN_SQRT_2PI + stirlingSeries(x)
}

/**
 * Stirling remainder δ(x) = lnΓ(x) − [(x − ½) ln x − x + ½ ln 2π], x > 0.
 * Series for x ≥ 10; below that the direct difference, whose absolute error (~1e−15) is what
 * matters where δ is used (inside exponents).
 */
export function stirlerr(x: number): number {
  if (x >= 10) return stirlingSeries(x)
  return lgamma(x) - ((x - 0.5) * Math.log(x) - x + LN_SQRT_2PI)
}

/**
 * Deviance term bd0(x, M) = x ln(x/M) + M − x ≥ 0, computed without cancellation when
 * x ≈ M by Loader's series: with v = (x−M)/(x+M),
 *   bd0 = (x−M) v + 2x Σ_{j≥1} v^{2j+1}/(2j+1).
 */
export function bd0(x: number, M: number): number {
  if (x === 0) return M
  if (Math.abs(x - M) < 0.1 * (x + M)) {
    const v = (x - M) / (x + M)
    let s = (x - M) * v
    if (Math.abs(s) < Number.MIN_VALUE) return s
    let ej = 2 * x * v
    const v2 = v * v
    for (let j = 1; j < 1000; j++) {
      ej *= v2
      const s1 = s + ej / (2 * j + 1)
      if (s1 === s) return s1
      s = s1
    }
    return s
  }
  const r = x / M
  const lr = Number.isFinite(r) && r > 0 ? Math.log(r) : Math.log(x) - Math.log(M)
  return x * lr + M - x
}

/**
 * ln B(a, b). For max(a,b) ≥ 10 the Stirling form avoids subtracting large log-gammas:
 * with a ≥ b,
 *   ln B = ½ln2π + (b−½) ln b − b ln(a+b) − (a−½) ln(1 + b/a) + δ(a) + δ(b) − δ(a+b).
 */
export function lbeta(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0) return Number.NaN
  const p = Math.min(a, b)
  const q = Math.max(a, b)
  if (p === 0) return Number.POSITIVE_INFINITY
  if (q === Number.POSITIVE_INFINITY) return Number.NEGATIVE_INFINITY
  if (q < 10) return lgamma(p) + lgamma(q) - lgamma(p + q)
  return (
    LN_SQRT_2PI +
    (p - 0.5) * Math.log(p) -
    p * Math.log(p + q) -
    (q - 0.5) * Math.log1p(p / q) +
    stirlerr(p) +
    stirlerr(q) -
    stirlerr(p + q)
  )
}

/**
 * Poisson-type density x^a e^−x / Γ(a+1) (a > 0, x ≥ 0) in Loader's form
 * exp(−δ(a) − bd0(a, x)) / √(2πa).
 */
export function dpoisRaw(a: number, x: number): number {
  if (x === 0) return 0
  if (!Number.isFinite(x)) return 0
  return Math.exp(-stirlerr(a) - bd0(a, x)) / Math.sqrt(2 * Math.PI * a)
}

/**
 * x^a y^b / B(a, b) where y = 1 − x is supplied separately (so it keeps full precision near
 * x = 1). Loader's form: with n = a + b,
 *   √(ab / (2πn)) · exp(−bd0(a, n x) − bd0(b, n y) − δ(a) − δ(b) + δ(n)).
 */
export function betaPowerTerm(x: number, y: number, a: number, b: number): number {
  if (x === 0 || y === 0) return 0
  const n = a + b
  const e = -bd0(a, n * x) - bd0(b, n * y) - stirlerr(a) - stirlerr(b) + stirlerr(n)
  return Math.sqrt((a * b) / (2 * Math.PI * n)) * Math.exp(e)
}
