import { type ChebTable, chebEval, chebTable } from '../numint/chebTable.ts'
import { chiMixture } from '../numint/chiMixture.ts'
import { integrate, supportBreaks } from '../numint/quadrature.ts'
import { solveMonotone } from '../numint/roots.ts'
import { logNormalCdf, normalBand } from './normalBand.ts'
import { cdfFast as normalCdf, phiFast as normalPdf, sfFast as normalSf } from './normalFast.ts'
import { tQuantile, tSf } from './t.ts'

/**
 * Maxima of equicorrelated-by-product t statistics: Dunnett's many-to-one comparisons and the
 * studentized maximum modulus.
 *
 * With k treatments compared against one control, T_i = (Ȳ_i − Ȳ_0) / (S √(1/n_i + 1/n_0)) has
 * correlation ρ_ij = λ_i λ_j, λ_i = √(n_i / (n_i + n_0)). Writing Z_i = λ_i Z_0 +
 * √(1 − λ_i²) E_i with independent standard normals Z_0, E_i makes the Z_i conditionally
 * independent given Z_0, so the k-variate normal probability reduces to one integral
 * (Dunnett 1955, JASA 50, 1096–1121, §2; Dunnett & Sobel 1955; also Genz & Bretz 2009,
 * Computation of Multivariate Normal and t Probabilities, §2.2.1 "product correlation"):
 *   P(max_i |Z_i| ≤ c) = ∫ φ(z) Π_i [Φ((c − λ_i z)/τ_i) − Φ((−c − λ_i z)/τ_i)] dz,  τ_i = √(1 − λ_i²)
 * (one-sided: Π_i Φ((c − λ_i z)/τ_i)), and the studentized version is E over S = χ_ν/√ν
 * (chiMixture). The upper tail is integrated directly as ∫ φ(z) (1 − Π_i P_i) dz with
 * 1 − Π P_i = −expm1(Σ ln P_i), so small P values keep their relative accuracy.
 *
 * λ = 0 (independent numerators sharing one S) is the studentized maximum modulus
 * distribution, used by Dunnett's T3; it needs no inner integral.
 *
 * As for the studentized range, the known-variance upper tail ln P(max > c) is tabulated once
 * per design (set of λ's) by piecewise Chebyshev interpolation before the outer integral; lower
 * tails (only needed for confidence levels below ½) are integrated directly.
 */

interface Lam {
  lambda: number
  tau: number
  mult: number
}

function lambdas(nControl: number, nTreatments: readonly number[]): Lam[] {
  const groups = new Map<number, number>()
  for (const n of nTreatments) groups.set(n, (groups.get(n) ?? 0) + 1)
  return [...groups.entries()].map(([n, mult]) => {
    const lambda = Math.sqrt(n / (n + nControl))
    return { lambda, tau: Math.sqrt(nControl / (n + nControl)), mult }
  })
}

/** ln P(−c < λz + τE < c) (two-sided) or ln P(λz + τE < c), accurate in both tails. */
function logInside(c: number, z: number, l: Lam, twoSided: boolean): number {
  const hi = (c - l.lambda * z) / l.tau
  if (!twoSided) return logNormalCdf(hi)
  const lo = (-c - l.lambda * z) / l.tau
  const out = normalSf(hi) + normalCdf(lo)
  return out < 0.5 ? Math.log1p(-out) : Math.log(normalBand(lo, hi))
}

/** P(max ≤ c) (lower) or P(max > c) for known variance. */
function maxInf(
  c: number,
  lams: readonly Lam[],
  twoSided: boolean,
  lowerTail: boolean,
  relTol = 1e-13,
): number {
  if (twoSided && !(c > 0)) return lowerTail ? 0 : 1
  if (c === Number.POSITIVE_INFINITY) return lowerTail ? 1 : 0
  if (c === Number.NEGATIVE_INFINITY) return lowerTail ? 0 : 1
  const logIn = (z: number): number => {
    let s = 0
    for (const l of lams) s += l.mult * logInside(c, z, l, twoSided)
    return s
  }
  if (lams.every((l) => l.lambda === 0)) {
    const s = logIn(0)
    return lowerTail ? Math.exp(s) : -Math.expm1(s)
  }
  const h = lowerTail
    ? (z: number) => {
        const p = normalPdf(z)
        return p === 0 ? 0 : p * Math.exp(logIn(z))
      }
    : (z: number) => {
        const p = normalPdf(z)
        return p === 0 ? 0 : p * -Math.expm1(logIn(z))
      }
  const tauMin = Math.min(...lams.map((l) => l.tau / Math.max(l.lambda, 1e-3)))
  const step = Math.max(0.125, Math.min(1, 2 * tauMin))
  // The upper-tail integrand peaks near z = λc (the mode of φ(z)·Q((c − λz)/τ)). Two-sided
  // integrands are even in z, so only z ≥ 0 is integrated and doubled.
  const lmax = Math.max(...lams.map((l) => l.lambda))
  const center = lowerTail ? 0 : Math.min(40, Math.max(0, c) * lmax)
  const breaks = supportBreaks(h, center, step, twoSided ? 0 : -40, 40)
  const v = integrate(h, breaks, { relTol })
  return Math.min(1, twoSided ? 2 * v : v)
}

/** P(max > c) = 0 to double precision beyond this (≤ k·2Q(37) < 1e−290). */
const C_MAX = 37
const TABLES = new Map<string, ChebTable>()

/** P(max > c) for known variance, from a table of its logarithm per design. */
function upperTab(c: number, lams: readonly Lam[], twoSided: boolean): number {
  const lo = twoSided ? 0 : -C_MAX
  if (c >= C_MAX) return 0
  if (c <= lo) return 1
  const key = `${twoSided}:${lams.map((l) => `${l.lambda},${l.mult}`).join(';')}`
  let t = TABLES.get(key)
  if (!t) {
    if (TABLES.size > 64) TABLES.clear()
    t = chebTable((x) => Math.log(maxInf(x, lams, twoSided, false, 5e-14)), lo, C_MAX, 3e-14, 3e-14)
    TABLES.set(key, t)
  }
  return Math.min(1, Math.exp(chebEval(t, c)))
}

function maxT(
  t: number,
  df: number,
  lams: readonly Lam[],
  twoSided: boolean,
  lowerTail: boolean,
): number {
  if (df === Number.POSITIVE_INFINITY) return maxInf(t, lams, twoSided, lowerTail)
  if (twoSided && !(t > 0)) return lowerTail ? 0 : 1
  // For a one-sided statistic below 0, P(max ≤ t) = E[P(max ≤ tS)] is decreasing in S.
  const increasing = lowerTail === t >= 0
  const direct = lowerTail || lams.every((l) => l.lambda === 0)
  const inner = direct
    ? (s: number) => maxInf(t * s, lams, twoSided, lowerTail)
    : (s: number) => upperTab(t * s, lams, twoSided)
  return Math.min(1, chiMixture(inner, df, increasing))
}

function validN(nControl: number, nTreatments: readonly number[]): boolean {
  return nControl > 0 && nTreatments.length > 0 && nTreatments.every((n) => n > 0)
}

/**
 * Dunnett's many-to-one distribution: P(max_i |T_i| ≥ t) (two-sided, the default) or
 * P(max_i T_i ≥ t) for k = nTreatments.length treatments against one control with residual
 * df `df` (Infinity allowed). This is the multiplicity-adjusted P value of Dunnett's (1955)
 * single-step test for a comparison with statistic t. With one treatment it is the t test's P.
 */
export function dunnettP(
  t: number,
  df: number,
  nControl: number,
  nTreatments: readonly number[],
  twoSided = true,
): number {
  if (Number.isNaN(t) || !(df > 0) || !validN(nControl, nTreatments)) return Number.NaN
  const x = twoSided ? Math.abs(t) : t
  if (nTreatments.length === 1) {
    const one = df === Number.POSITIVE_INFINITY ? normalSf(x) : tSf(x, df)
    return twoSided ? 2 * one : one
  }
  return maxT(x, df, lambdas(nControl, nTreatments), twoSided, false)
}

/**
 * Critical value c of Dunnett's test: P(max_i |T_i| ≤ c) = confLevel (two-sided) or
 * P(max_i T_i ≤ c) = confLevel. Simultaneous intervals are diff ± c·SE (one-sided: diff − c·SE).
 */
export function dunnettQuantile(
  confLevel: number,
  df: number,
  nControl: number,
  nTreatments: readonly number[],
  twoSided = true,
): number {
  if (!(confLevel > 0 && confLevel < 1) || !(df > 0) || !validN(nControl, nTreatments)) {
    return Number.NaN
  }
  const k = nTreatments.length
  const alpha = 1 - confLevel
  if (k === 1) {
    const a = twoSided ? alpha / 2 : alpha
    return tQuantile(a, df, false)
  }
  return maxTQuantile(confLevel, df, lambdas(nControl, nTreatments), twoSided, k)
}

function maxTQuantile(
  confLevel: number,
  df: number,
  lams: readonly Lam[],
  twoSided: boolean,
  k: number,
): number {
  const alpha = 1 - confLevel
  const upper = confLevel >= 0.5
  const target = Math.log(upper ? alpha : confLevel)
  const bonf = tQuantile((twoSided ? alpha / 2 : alpha) / k, df, false)
  const start = bonf > 0 ? bonf : 1
  const F = (x: number): number => {
    const v = maxT(Math.exp(x), df, lams, twoSided, !upper)
    return upper ? target - Math.log(v) : Math.log(v) - target
  }
  return Math.exp(solveMonotone(F, Math.log(start), 0.02, 1e-14))
}

/**
 * Studentized maximum modulus: P(max_{i≤k} |Z_i| / S ≥ m) for k independent standard normals and
 * S = χ_ν/√ν (Tukey 1953; tables in Stoline & Ury 1979, Technometrics 21, 87–93). Used for
 * Dunnett's T3 with k = the number of comparisons.
 */
export function smmP(m: number, k: number, df: number): number {
  if (Number.isNaN(m) || !(k >= 1) || !(df > 0)) return Number.NaN
  return maxT(Math.abs(m), df, [{ lambda: 0, tau: 1, mult: k }], true, false)
}

/** Quantile of the studentized maximum modulus: P(max |Z_i| / S ≤ m) = confLevel. */
export function smmQuantile(confLevel: number, k: number, df: number): number {
  if (!(confLevel > 0 && confLevel < 1) || !(k >= 1) || !(df > 0)) return Number.NaN
  return maxTQuantile(confLevel, df, [{ lambda: 0, tau: 1, mult: k }], true, k)
}
