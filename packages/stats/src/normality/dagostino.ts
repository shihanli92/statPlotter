import { chiSqSf } from '../dist/chisq.ts'
import { NAN_TEST, type NormalityTest, sortedDeviations } from './common.ts'

export interface DagostinoResult extends NormalityTest {
  /** Sample skewness √b1 = m3 / m2^{3/2} (moment ratio, n denominators), as the test uses. */
  skewness: number
  /** Sample excess kurtosis b2 − 3 = m4 / m2² − 3 (moment ratio, n denominators). */
  kurtosis: number
  /** D'Agostino (1970) normal score of √b1. */
  zSkewness: number
  /** Anscombe & Glynn (1983) normal score of b2. */
  zKurtosis: number
}

/** The minimum n accepted for the D'Agostino–Pearson test. */
const DAGOSTINO_MIN_N = 8

/**
 * D'Agostino–Pearson omnibus K² test (D'Agostino, Belanger & D'Agostino 1990, "A suggestion for
 * using powerful and informative tests of normality", Am. Stat. 44, 316–321), the normality
 * test usually recommended ("omnibus K2"):
 *
 *   Z(√b1): D'Agostino (1970) — Y = √b1 √((n+1)(n+3) / (6(n−2))),
 *     β₂(√b1) = 3(n² + 27n − 70)(n+1)(n+3) / ((n−2)(n+5)(n+7)(n+9)), W² = √(2(β₂ − 1)) − 1,
 *     δ = 1/√(ln W), α = √(2/(W² − 1)), Z = δ asinh(Y/α).
 *   Z(b2): Anscombe & Glynn (1983) — x = (b2 − E b2)/√Var b2 with E b2 = 3(n−1)/(n+1),
 *     Var b2 = 24n(n−2)(n−3)/((n+1)²(n+3)(n+5)); √β₁(b2) = 6(n² − 5n + 2)/((n+7)(n+9)) ·
 *     √(6(n+3)(n+5)/(n(n−2)(n−3))), A = 6 + 8/√β₁ (2/√β₁ + √(1 + 4/β₁)),
 *     Z = ((1 − 2/(9A)) − ∛((1 − 2/A)/(1 + x√(2/(A−4))))) / √(2/(9A)).
 *   K² = Z(√b1)² + Z(b2)², P from χ²(2).
 *
 * The cube root is the real (sign-preserving) one: for strongly platykurtic small samples the
 * base is negative, where moments::anscombe.test gives NaN. n < 8 (the minimum) or zero
 * spread gives NaN throughout.
 */
export function dagostinoPearson(x: ArrayLike<number>): DagostinoResult {
  const n = x.length
  const nan = { skewness: Number.NaN, kurtosis: Number.NaN, zSkewness: Number.NaN }
  if (n < DAGOSTINO_MIN_N) return { ...NAN_TEST, ...nan, zKurtosis: Number.NaN }
  const { d, ss } = sortedDeviations(x)
  let s3 = 0
  let s4 = 0
  for (let i = 0; i < n; i++) {
    const v2 = d[i]! * d[i]!
    s3 += v2 * d[i]!
    s4 += v2 * v2
  }
  const m2 = ss / n
  const sqb1 = s3 / n / (m2 * Math.sqrt(m2))
  const b2 = s4 / n / (m2 * m2)
  if (!(m2 > 0) || !Number.isFinite(sqb1)) return { ...NAN_TEST, ...nan, zKurtosis: Number.NaN }

  // Skewness
  const y = sqb1 * Math.sqrt(((n + 1) * (n + 3)) / (6 * (n - 2)))
  const beta2 =
    (3 * (n * n + 27 * n - 70) * (n + 1) * (n + 3)) / ((n - 2) * (n + 5) * (n + 7) * (n + 9))
  const w2 = -1 + Math.sqrt(2 * (beta2 - 1))
  const delta = 1 / Math.sqrt(0.5 * Math.log(w2))
  const alpha = Math.sqrt(2 / (w2 - 1))
  const z1 = delta * Math.asinh(y / alpha)

  // Kurtosis
  const eb2 = (3 * (n - 1)) / (n + 1)
  const vb2 = (24 * n * (n - 2) * (n - 3)) / ((n + 1) * (n + 1) * (n + 3) * (n + 5))
  const xk = (b2 - eb2) / Math.sqrt(vb2)
  const sb1 =
    ((6 * (n * n - 5 * n + 2)) / ((n + 7) * (n + 9))) *
    Math.sqrt((6 * (n + 3) * (n + 5)) / (n * (n - 2) * (n - 3)))
  const A = 6 + (8 / sb1) * (2 / sb1 + Math.sqrt(1 + 4 / (sb1 * sb1)))
  const z2 =
    (1 - 2 / (9 * A) - Math.cbrt((1 - 2 / A) / (1 + xk * Math.sqrt(2 / (A - 4))))) /
    Math.sqrt(2 / (9 * A))

  const k2 = z1 * z1 + z2 * z2
  return {
    stat: k2,
    p: chiSqSf(k2, 2),
    skewness: sqb1,
    kurtosis: b2 - 3,
    zSkewness: z1,
    zKurtosis: z2,
  }
}
