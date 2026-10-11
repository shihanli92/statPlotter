import { chiSqSf } from '../dist/chisq.ts'
import { binomialTest } from './proportion.ts'
import { check2x2, checkCount, checkTable, colSums, rowSums } from './validate.ts'

export interface ChiSquareResult {
  chiSq: number
  df: number
  p: number
  /** Expected counts under independence, r_i·c_j / N. */
  expected: number[][]
}

/**
 * Pearson's chi-square test of independence for an r × c table (R's chisq.test).
 *
 * `yates` applies Yates' continuity correction to 2 × 2 tables only (ignored otherwise):
 * Σ(|O − E| − ½)² / E even when |O − E| < ½, where the correction then increases
 * chi-square (the correction is applied even in this case).
 * R's chisq.test instead caps the correction at |O − E|; the two agree whenever
 * |O − E| ≥ ½.
 *
 * A zero row or column total makes some expected counts 0 and the statistic NaN (as R).
 * Throws for a table smaller than 2 × 2, ragged rows, or cells that are not non-negative
 * integers.
 */
export function chiSquareTest(
  table: readonly (readonly number[])[],
  opts: { yates?: boolean } = {},
): ChiSquareResult {
  const t = checkTable(table, 'chiSquareTest')
  const rs = rowSums(t)
  const cs = colSums(t)
  const N = rs.reduce((s, x) => s + x, 0)
  const expected = rs.map((r) => cs.map((c) => (r * c) / N))
  const yates = (opts.yates ?? false) && t.length === 2 && cs.length === 2
  let chiSq = 0
  for (let i = 0; i < t.length; i++) {
    for (let j = 0; j < cs.length; j++) {
      const e = expected[i]![j]!
      const d = yates ? Math.abs(t[i]![j]! - e) - 0.5 : t[i]![j]! - e
      chiSq += (d * d) / e
    }
  }
  const df = (t.length - 1) * (cs.length - 1)
  return { chiSq, df, p: chiSqSf(chiSq, df), expected }
}

/**
 * Chi-square test for trend (Cochran-Armitage) in a k × 2 table whose rows are ordered and
 * equally spaced; scores 1..k, "success" = the first column (Altman 1991,
 * pp. 261–265; identical to R's prop.trend.test):
 *   χ² = (Σ xᵢsᵢ − R s̄)² / (p(1 − p) Σ nᵢ(sᵢ − s̄)²),  s̄ = Σ nᵢsᵢ / N, p = R / N,
 * with xᵢ the first-column count and nᵢ the row total. Empty rows contribute nothing.
 * NaN when every subject is in one column (p = 0 or 1) or only one row is non-empty.
 */
export function chiSquareTrend(table: readonly (readonly number[])[]): {
  chiSq: number
  df: 1
  p: number
} {
  const t = checkTable(table, 'chiSquareTrend')
  if (t[0]!.length !== 2) {
    throw new Error(`chiSquareTrend: the table must have 2 columns, got ${t[0]!.length}`)
  }
  const n = rowSums(t)
  const N = n.reduce((s, x) => s + x, 0)
  const R = t.reduce((s, row) => s + row[0]!, 0)
  let sn = 0
  for (let i = 0; i < t.length; i++) sn += n[i]! * (i + 1)
  const sBar = sn / N
  let num = 0
  let ss = 0
  for (let i = 0; i < t.length; i++) {
    const d = i + 1 - sBar
    num += t[i]![0]! * d
    ss += n[i]! * d * d
  }
  const p = R / N
  const chiSq = (num * num) / (p * (1 - p) * ss)
  return { chiSq, df: 1, p: chiSqSf(chiSq, 1) }
}

/**
 * Chi-square goodness of fit of observed counts to expected counts or proportions (either
 * is accepted: expected values are rescaled to sum to the observed total). df = k − 1.
 * No Yates correction. A category with expected 0 gives an infinite (observed > 0)
 * or NaN (observed 0) statistic, as R's chisq.test(p =).
 * Throws for fewer than 2 categories, mismatched lengths, invalid observed counts, or
 * expected values that are negative, non-finite or all zero.
 */
export function chiSquareGoodnessOfFit(
  observed: readonly number[],
  expected: readonly number[],
): { chiSq: number; df: number; p: number } {
  if (observed.length < 2) throw new Error('chiSquareGoodnessOfFit: need at least 2 categories')
  if (expected.length !== observed.length) {
    throw new Error('chiSquareGoodnessOfFit: observed and expected differ in length')
  }
  for (const o of observed) checkCount(o, 'chiSquareGoodnessOfFit: observed')
  for (const e of expected) {
    if (!(Number.isFinite(e) && e >= 0)) {
      throw new Error(`chiSquareGoodnessOfFit: expected values must be ≥ 0, got ${e}`)
    }
  }
  const sumE = expected.reduce((s, x) => s + x, 0)
  if (!(sumE > 0)) throw new Error('chiSquareGoodnessOfFit: expected values sum to 0')
  const N = observed.reduce((s, x) => s + x, 0)
  let chiSq = 0
  for (let i = 0; i < observed.length; i++) {
    const e = (N * expected[i]!) / sumE
    const d = observed[i]! - e
    chiSq += (d * d) / e
  }
  const df = observed.length - 1
  return { chiSq, df, p: chiSqSf(chiSq, df) }
}

/**
 * McNemar's test for a paired 2 × 2 table [[a, b], [c, d]] (discordant pairs b and c).
 * chiSq = (|b − c| − 1)² / (b + c), df 1, with the continuity correction as in R's
 * mcnemar.test (which, like this, drops the correction when b = c, giving 0). pExact is the
 * exact two-sided binomial test of b out of b + c at ½ (the recommended analysis); 1 when
 * there are no discordant pairs, where chiSq and p are NaN.
 */
export function mcNemar(table: readonly (readonly number[])[]): {
  chiSq: number
  p: number
  pExact: number
} {
  const t = check2x2(table, 'mcNemar')
  const b = t[0]![1]!
  const c = t[1]![0]!
  const corr = b === c ? 0 : 1
  const d = Math.abs(b - c) - corr
  const chiSq = (d * d) / (b + c)
  return { chiSq, p: chiSqSf(chiSq, 1), pExact: binomialTest(b, b + c, 0.5).p }
}
