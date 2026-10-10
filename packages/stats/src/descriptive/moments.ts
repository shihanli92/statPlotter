import { mean } from './basic.ts'

/**
 * Central moment sums about the mean, corrected for the rounding error left in the computed
 * mean: with d = x − m̂ and c = Σd/n (the mean of the residuals, ~1 ulp of m̂), the moments
 * about the exact mean m̂ + c follow from the binomial expansion. This matters when the
 * spread is tiny relative to the mean (e.g. 1e9 + 1e−3 noise), where an uncorrected c shifts
 * the third moment by 3c·m2.
 */
function centralMoments(x: ArrayLike<number>): { n: number; m2: number; m3: number; m4: number } {
  const n = x.length
  const m = mean(x)
  let s1 = 0
  let s2 = 0
  let s3 = 0
  let s4 = 0
  for (let i = 0; i < n; i++) {
    const d = x[i]! - m
    const d2 = d * d
    s1 += d
    s2 += d2
    s3 += d2 * d
    s4 += d2 * d2
  }
  const c = s1 / n
  const a2 = s2 / n
  const a3 = s3 / n
  const a4 = s4 / n
  const c2 = c * c
  return {
    n,
    m2: a2 - c2,
    m3: a3 - 3 * c * a2 + 2 * c2 * c,
    m4: a4 - 4 * c * a3 + 6 * c2 * a2 - 3 * c2 * c2,
  }
}

/**
 * Sample skewness, adjusted Fisher–Pearson G1 = g1 √(n(n−1)) / (n−2) with g1 = m3 / m2^{3/2}
 * (Joanes & Gill 1998 "G1"; Excel SKEW, SAS, e1071 type 2). NaN for n < 3 or zero spread.
 */
export function skewness(x: ArrayLike<number>): number {
  const { n, m2, m3 } = centralMoments(x)
  if (n < 3) return Number.NaN
  const g1 = m3 / (m2 * Math.sqrt(m2))
  return (g1 * Math.sqrt(n * (n - 1))) / (n - 2)
}

/**
 * Sample excess kurtosis G2 = ((n+1) g2 + 6)(n−1) / ((n−2)(n−3)), g2 = m4/m2² − 3
 * (Joanes & Gill 1998 "G2"; Excel KURT, SAS, e1071 type 2). NaN for n < 4 or zero spread.
 */
export function kurtosis(x: ArrayLike<number>): number {
  const { n, m2, m4 } = centralMoments(x)
  if (n < 4) return Number.NaN
  const g2 = m4 / (m2 * m2) - 3
  return (((n + 1) * g2 + 6) * (n - 1)) / ((n - 2) * (n - 3))
}
