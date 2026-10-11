import {
  type Comparison,
  type Diagnostic,
  formatNumber,
  type NormalizedDataSet,
  type ResultBlock,
} from '@ps/model'
import type { DunnRow, GroupData, McRow } from '@ps/stats'
import { z } from 'zod'
import {
  comparisonKey,
  decided,
  dfText,
  int,
  interval,
  num,
  pct,
  psum,
  pval,
  rawValues,
  significant,
  statText,
  summaryOf,
  table,
  text,
} from './common.ts'
import { rowTitleOf } from './grouped.ts'

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

export const ALL_PAIRS_METHODS = [
  { value: 'tukey', label: 'Tukey (recommended)' },
  { value: 'sidak', label: 'Šidák' },
  { value: 'bonferroni', label: 'Bonferroni' },
  { value: 'holm-sidak', label: 'Holm-Šidák (step-down)' },
  { value: 'fisher', label: 'Fisher’s LSD (no correction)' },
  { value: 'bky', label: 'False discovery rate (two-stage Benjamini, Krieger & Yekutieli)' },
  { value: 'newman-keuls', label: 'Newman-Keuls (not recommended; no P values or CIs)' },
] as const
export const CONTROL_METHODS = [
  { value: 'dunnett', label: 'Dunnett (recommended)' },
  { value: 'sidak', label: 'Šidák' },
  { value: 'bonferroni', label: 'Bonferroni' },
  { value: 'holm-sidak', label: 'Holm-Šidák (step-down)' },
  { value: 'fisher', label: 'Fisher’s LSD (no correction)' },
  { value: 'bky', label: 'False discovery rate (two-stage Benjamini, Krieger & Yekutieli)' },
] as const

/** Comparisons after a Welch or Brown-Forsythe ANOVA (unequal SDs). */
export const welchMethod = z.enum(['dunnett-t3', 'games-howell', 'tamhane-t2'])
export const WELCH_METHODS = [
  { value: 'dunnett-t3', label: 'Dunnett T3 (recommended when n < 50 per group)' },
  { value: 'games-howell', label: 'Games-Howell (recommended for larger samples)' },
  { value: 'tamhane-t2', label: 'Tamhane T2' },
] as const

export const equalSD = z.enum(['yes', 'welch', 'brownForsythe'])
export const EQUAL_SD_FIELD = {
  path: ['equalSD'],
  label: 'Assume equal SDs?',
  kind: 'radio',
  options: [
    { value: 'yes', label: 'Yes — ordinary ANOVA' },
    { value: 'welch', label: 'No — Welch ANOVA' },
    { value: 'brownForsythe', label: 'No — Brown-Forsythe ANOVA' },
  ],
} as const

/** The one-way comparison choices: every pair of columns, or each with a control column. */
export const COMPARE_COLUMNS = [
  { value: 'allPairs', label: 'Compare the mean of each column with every other mean' },
  { value: 'vsControl', label: 'Compare each column with a control column' },
] as const
export const NO_COMPARISONS = { value: 'none', label: 'No multiple comparisons' } as const
export const CONTROL_FIELD = {
  path: ['control'],
  label: 'Control column',
  kind: 'custom',
  component: 'dataset.control',
  showIf: { path: ['comparisons'], in: ['vsControl'] },
} as const

export const METHOD_TITLE: Record<string, string> = {
  tukey: 'Tukey’s multiple comparisons test',
  'newman-keuls': 'Newman-Keuls multiple comparisons test',
  dunnett: 'Dunnett’s multiple comparisons test',
  sidak: 'Šidák’s multiple comparisons test',
  bonferroni: 'Bonferroni’s multiple comparisons test',
  'holm-sidak': 'Holm-Šidák’s multiple comparisons test',
  fisher: 'Uncorrected Fisher’s LSD',
  bky: 'Two-stage step-up method of Benjamini, Krieger and Yekutieli',
  'games-howell': 'Games-Howell’s multiple comparisons test',
  'dunnett-t3': 'Dunnett’s T3 multiple comparisons test',
  'tamhane-t2': 'Tamhane’s T2 multiple comparisons test',
  dunn: 'Dunn’s multiple comparisons test',
}

export const allPairsMethod = z.enum([
  'tukey',
  'sidak',
  'bonferroni',
  'holm-sidak',
  'fisher',
  'bky',
  'newman-keuls',
])
export const controlMethod = z.enum([
  'dunnett',
  'sidak',
  'bonferroni',
  'holm-sidak',
  'fisher',
  'bky',
])

/**
 * The pairs of data sets (indices into `input`) a one-way analysis compares: every pair, or each
 * data set with the control (the one keyed `controlKey`, else the first); none otherwise.
 */
export function oneWayPairs(
  input: readonly NormalizedDataSet[],
  mode: string,
  controlKey: string,
): { control: number; pairs: [number, number][] } {
  const control = Math.max(
    0,
    input.findIndex((d) => d.ref.key === controlKey),
  )
  const pairs: [number, number][] = []
  if (mode === 'allPairs') {
    for (let i = 0; i < input.length; i++)
      for (let j = i + 1; j < input.length; j++) pairs.push([i, j])
  } else if (mode === 'vsControl') {
    for (let j = 0; j < input.length; j++) if (j !== control) pairs.push([control, j])
  }
  return { control, pairs }
}

/**
 * Comparison records (for graph brackets) of `pairs` with their adjusted P values; `row` keys
 * them by the grouped table's row (`row{r}:a|b`), else `a|b`.
 */
export function pairComparisons(
  input: readonly NormalizedDataSet[],
  pairs: readonly (readonly [number, number])[],
  ps: readonly number[],
  row?: number,
): Comparison[] {
  return pairs.map(([i, j], k) => ({
    key: `${row === undefined ? '' : `row${row}:`}${comparisonKey(input[i]!, input[j]!)}`,
    a: input[i]!.ref,
    b: input[j]!.ref,
    ...(row === undefined ? {} : { rowA: row, rowB: row }),
    p: ps[k]!,
    pAdjusted: ps[k]!,
  }))
}

// ---- factorial ANOVA tables (two-way, three-way, multifactor) --------------------------------

/**
 * Audit 3 (S4): a warning when the groups' (or cells') spread — their SDs and the differences of
 * their means — is below 1e-150 or above 1e150, where squares and sums of squares underflow or
 * overflow in double precision.
 */
export function magnitudeWarning(
  groups: readonly { n: number; mean: number; sd: number }[],
): Diagnostic[] {
  const used = groups.filter((g) => g.n > 0 && Number.isFinite(g.mean))
  if (!used.length) return []
  const m0 = used[0]!.mean
  let big = 0
  for (const g of used) big = Math.max(big, Math.abs(g.mean - m0), Number.isFinite(g.sd) ? g.sd : 0)
  if (big === 0 || (big >= 1e-150 && big <= 1e150)) return []
  return [
    {
      level: 'warning',
      message: `The values vary by about ${formatNumber(big, 2)}, too ${big < 1 ? 'small' : 'large'} to square in double precision: sums of squares, F and P values may be wrong. Rescale the data (change their units) first.`,
    },
  ]
}

/**
 * Audit 3 (S2): a warning when an ordinary ANOVA's residual variation is zero or negligible (at
 * most 1e-12 of the total): its F tests are then degenerate (an effect that isn't zero has
 * F = ∞, P = 0; one zero within rounding has 0 / 0, shown "—"), as R's "essentially perfect fit".
 */
export function noResidualWarning(
  ssResidual: number,
  ssTotal: number,
  where: 'groups' | 'cells',
): Diagnostic[] {
  if (!(ssTotal > 0) || !(ssResidual <= 1e-12 * ssTotal)) return []
  return [
    {
      level: 'warning',
      message: `There is ${ssResidual === 0 ? 'no' : 'almost no'} variation within the ${where} (the residual sum of squares is ${ssResidual === 0 ? 'zero' : 'negligible'}), so the F tests are degenerate: an effect that isn’t zero has F = ∞ and P = 0, and one that is has no F or P (“—”). Check that the values were entered as intended.`,
    },
  ]
}

/** Each effect's share of the total variation and its P value. */
export const anovaSummaryTable = (
  title: string,
  effects: readonly { name: string; pctOfTotal: number; p: number }[],
): ResultBlock =>
  table(
    title,
    ['Source of Variation', '% of total variation', 'P value', 'P value summary', 'Significant?'],
    effects.map((s) => [text(s.name), num(s.pctOfTotal), pval(s.p), psum(s.p), significant(s.p)]),
  )

/**
 * The ANOVA table: each effect's F test (against `dfd` residual degrees of freedom), then the
 * residual and, if given, the total.
 */
export function anovaTable(
  effects: readonly { name: string; ss: number; df: number; ms: number; F: number; p: number }[],
  residual: { ss: number; df: number; ms: number },
  dfd: number,
  opts: { ssLabel?: string; total?: { ss: number; df: number } } = {},
): ResultBlock {
  const blank = text('')
  return table(
    'ANOVA table',
    ['Source of Variation', opts.ssLabel ?? 'SS', 'DF', 'MS', 'F (DFn, DFd)', 'P value'],
    [
      ...effects.map((s) => [
        text(s.name),
        num(s.ss),
        int(s.df),
        num(s.ms),
        text(`F (${dfText(s.df)}, ${dfText(dfd)}) = ${statText(s.F)}`),
        pval(s.p),
      ]),
      [text('Residual'), num(residual.ss), int(residual.df), num(residual.ms), blank, blank],
      ...(opts.total
        ? [[text('Total'), num(opts.total.ss), int(opts.total.df), blank, blank, blank]]
        : []),
    ],
  )
}

/** Effect sizes of each effect (partial omega squared unless `omega` is false). */
export function effectSizeTable(
  rows: readonly [
    name: string,
    e: {
      etaSquared: number
      partialEtaSquared: number
      partialOmegaSquared?: number
      cohensF: number
    },
  ][],
  omega = true,
): ResultBlock {
  return table(
    'Effect sizes',
    [
      'Source of Variation',
      'Eta squared',
      'Partial eta squared',
      ...(omega ? ['Partial omega squared'] : []),
      'Cohen’s f',
    ],
    rows.map(([name, e]) => [
      text(name),
      num(e.etaSquared),
      num(e.partialEtaSquared),
      ...(omega ? [num(e.partialOmegaSquared!)] : []),
      num(e.cohensF),
    ]),
  )
}

/** Title suffix of each family of two-way ANOVA comparisons. */
export const TWO_WAY_FAMILY_SUFFIX: Record<string, string> = {
  withinRows: ' — within each row, compare columns',
  withinColumns: ' — within each column, compare rows',
  allCells: ' — all cell means',
  mainColumns: ' — main column effect',
  mainRows: ' — main row effect',
}

/**
 * Label and comparison record (for graph brackets) of one two-way ANOVA comparison, by family:
 * within a row (`row{r}:a|b`), within a column (`col{key}:ra|rb`), of column means (`main:a|b`);
 * comparisons of row means have no record. `rowA`/`rowB` index `rows` (the analyzed table
 * rows) and `colA`/`colB` index `input`; each family reads only the ones it compares.
 */
export function twoWayComparison(
  input: readonly NormalizedDataSet[],
  rows: readonly number[],
  family: string,
  c: { rowA?: number; rowB?: number; colA?: number; colB?: number },
  p: number,
): { label: string; comparison?: Comparison } {
  const [a, b] = [input[c.colA!]!, input[c.colB!]!]
  const [ra, rb] = [rows[c.rowA!]!, rows[c.rowB!]!]
  const title = (r: number) => rowTitleOf(input, r)
  const record = (key: string, rowA?: number, rowB?: number): Comparison => ({
    key,
    a: a.ref,
    b: (family === 'withinColumns' ? a : b).ref,
    ...(rowA === undefined ? {} : { rowA, rowB }),
    p,
    pAdjusted: p,
  })
  if (family === 'withinRows')
    return {
      label: `${title(ra)}: ${a.title} vs. ${b.title}`,
      comparison: record(`row${ra}:${comparisonKey(a, b)}`, ra, ra),
    }
  if (family === 'withinColumns')
    return {
      label: `${a.title}: ${title(ra)} vs. ${title(rb)}`,
      comparison: record(`col${a.ref.key}:${ra}|${rb}`, ra, rb),
    }
  if (family === 'mainColumns')
    return { label: `${a.title} vs. ${b.title}`, comparison: record(`main:${comparisonKey(a, b)}`) }
  return { label: `${title(ra)} vs. ${title(rb)}` }
}

/** Total sum of squares of the finite values about their mean. */
export function totalSS(y: readonly number[]): number {
  const v = y.filter(Number.isFinite)
  const m = v.reduce((s, x) => s + x, 0) / v.length
  return v.reduce((s, x) => s + (x - m) ** 2, 0)
}

/** Dunn's comparisons of mean ranks (after a Kruskal-Wallis test), labelled by `labels`. */
export const dunnTable = (
  title: string,
  labels: readonly string[],
  rows: readonly Pick<DunnRow, 'meanRankDiff' | 'significant' | 'p'>[],
): ResultBlock =>
  table(
    title,
    ['Comparison', 'Mean rank diff.', 'Significant?', 'Summary', 'Adjusted P Value'],
    rows.map((r, k) => [
      text(labels[k]!),
      num(r.meanRankDiff),
      decided(r.significant, r.p),
      psum(r.p),
      pval(r.p),
    ]),
  )

export function groupData(ds: NormalizedDataSet): GroupData | null {
  const raw = rawValues(ds)
  if (raw) return { values: raw }
  const s = summaryOf(ds)
  return s && Number.isFinite(s.sd) && Number.isFinite(s.n) ? s : null
}

/**
 * The comparisons table. FDR methods report q values and no CIs; Newman-Keuls reports q
 * and its step-down P value (the test itself defines neither P nor CI).
 */
export function comparisonTable(
  title: string,
  labels: string[],
  rows: McRow[],
  level: number,
  method: string,
): ResultBlock {
  const fdr = method === 'bky' || method === 'bh'
  const nk = method === 'newman-keuls'
  const hasCI = rows.some((r) => Number.isFinite(r.lo))
  return table(
    title,
    [
      'Comparison',
      'Mean Diff.',
      ...(hasCI ? [`${pct(level)} CI of diff.`] : []),
      ...(nk ? ['q'] : []),
      fdr ? 'Discovery?' : 'Significant?',
      'Summary',
      fdr ? 'q value' : nk ? 'Step-down P value' : 'Adjusted P Value',
    ],
    rows.map((r, k) => [
      text(labels[k]!),
      num(r.diff),
      ...(hasCI ? [interval(r.lo, r.hi, level)] : []),
      ...(nk ? [num(r.stat)] : []),
      decided(r.significant, r.p),
      psum(r.p),
      pval(r.p),
    ]),
  )
}
