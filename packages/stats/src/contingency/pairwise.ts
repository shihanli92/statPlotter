import { correctFamily, type FamilyMethod } from '../anova/family.ts'
import { chiSquareTest } from './chiSquare.ts'
import { fisherExact } from './fisher.ts'
import { check2x2, checkTable, colSums, rowSums } from './validate.ts'

/**
 * Phi coefficient of a 2 × 2 table [[a, b], [c, d]]: |ad − bc| / √(r₁r₂c₁c₂) = √(χ²/N) with the
 * uncorrected Pearson χ². It is reported unsigned (from 0 to 1) and computed from
 * the cell counts whichever test is chosen. NaN when a row or column total is 0.
 */
export function phiCoefficient(table: readonly (readonly number[])[]): number {
  const t = check2x2(table, 'phiCoefficient')
  const [[a, b], [c, d]] = t as [[number, number], [number, number]]
  const den = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d))
  return Math.abs(a * d - b * c) / den
}

/**
 * Cramér's V of an r × c table: √(χ² / (N·(min(r, c) − 1))), χ² the uncorrected Pearson
 * statistic (equals phi for 2 × 2 tables). NaN when a row or column total is 0.
 */
export function cramersV(table: readonly (readonly number[])[]): number {
  const t = checkTable(table, 'cramersV')
  const N = rowSums(t).reduce((s, x) => s + x, 0)
  const k = Math.min(t.length, t[0]!.length)
  return Math.sqrt(chiSquareTest(t).chiSq / (N * (k - 1)))
}

export interface PairwiseOptions {
  /** Test for each pair of rows. Default 'fisher'. */
  test?: 'fisher' | 'chiSquare'
  /** Yates' correction for pairs that are 2 × 2 (chi-square only). Default false. */
  yates?: boolean
  /** Every pair of rows, or each row against the control row. Default 'all'. */
  compare?: 'all' | 'control'
  /** Index of the control row (compare = 'control'). Default 0. */
  control?: number
  /** Multiplicity correction over the family of pairs. Default 'bonferroni'. */
  method?: FamilyMethod
  /** α for significance methods. Default 0.05. */
  alpha?: number
  /** FDR level Q as a fraction (FDR methods). Default 0.05. */
  q?: number
}

export interface PairwiseRow {
  rowA: number
  rowB: number
  /** The test actually used ('chiSquare' when Fisher's test was too big for this pair). */
  test: 'fisher' | 'chiSquare'
  /** Chi-square and df of the pair's table (also computed when Fisher's test is used). */
  chiSq: number
  df: number
  /** Columns left in the pair's table (outcomes neither row has are dropped). */
  columns: number
  p: number
  /** Multiplicity-adjusted P (significance methods), q value (FDR) or P itself ('none'). */
  adjusted: number
  /** Significant after correction (adjusted P < α), or a discovery (FDR at Q). */
  flagged: boolean
}

/**
 * Comparisons of pairs of rows (groups) of an r × c contingency table: each pair's 2 × c
 * sub-table is tested on its own (Fisher's exact or Pearson chi-square), and the P values are
 * corrected as one family (`correctFamily`: Bonferroni, Šídák, Holm-Šídák, or FDR).
 *
 * Outcome columns that both rows of a pair leave empty are dropped from that pair's table
 * (they carry no information and would make chi-square 0/0). When fewer than two columns
 * remain, both rows put everyone in the same outcome: P = 1, χ² = 0, df = 0. A pair with an
 * empty row gets P = NaN (not tested, not counted in the family). Fisher's test falls back to
 * chi-square for a pair whose exact test is too large.
 */
export function contingencyPairwise(
  table: readonly (readonly number[])[],
  opts: PairwiseOptions = {},
): PairwiseRow[] {
  const t = checkTable(table, 'contingencyPairwise')
  const test = opts.test ?? 'fisher'
  const compare = opts.compare ?? 'all'
  const control = opts.control ?? 0
  if (!(Number.isInteger(control) && control >= 0 && control < t.length)) {
    throw new Error(`contingencyPairwise: control row ${control} is not a row of the table`)
  }
  const pairs: [number, number][] = []
  if (compare === 'control') {
    for (let i = 0; i < t.length; i++) if (i !== control) pairs.push([control, i])
  } else {
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) pairs.push([i, j])
  }
  const rows = pairs.map(([a, b]) => pairTest(t[a]!, t[b]!, a, b, test, opts.yates ?? false))
  const fam = correctFamily(
    rows.map((r) => r.p),
    { method: opts.method ?? 'bonferroni', alpha: opts.alpha ?? 0.05, q: opts.q ?? 0.05 },
  )
  return rows.map((r, i) => ({ ...r, adjusted: fam.adjusted[i]!, flagged: fam.flagged[i]! }))
}

function pairTest(
  ra: readonly number[],
  rb: readonly number[],
  rowA: number,
  rowB: number,
  test: 'fisher' | 'chiSquare',
  yates: boolean,
): Omit<PairwiseRow, 'adjusted' | 'flagged'> {
  const sub = [ra, rb]
  const keep = colSums(sub)
    .map((s, j) => (s > 0 ? j : -1))
    .filter((j) => j >= 0)
  const na = ra.reduce((s, x) => s + x, 0)
  const nb = rb.reduce((s, x) => s + x, 0)
  const base = { rowA, rowB, columns: keep.length }
  if (na === 0 || nb === 0) {
    return { ...base, test, chiSq: Number.NaN, df: Number.NaN, p: Number.NaN }
  }
  if (keep.length < 2) return { ...base, test, chiSq: 0, df: 0, p: 1 }
  const pt = sub.map((row) => keep.map((j) => row[j]!))
  const chi = chiSquareTest(pt, { yates })
  if (test === 'fisher') {
    try {
      return { ...base, test, chiSq: chi.chiSq, df: chi.df, p: fisherExact(pt).p }
    } catch {
      // Too large for the exact test: fall through to chi-square.
    }
  }
  return { ...base, test: 'chiSquare', chiSq: chi.chiSq, df: chi.df, p: chi.p }
}
