import {
  type AnalysisResult,
  type Comparison,
  type DataTable,
  type Diagnostic,
  finiteValues,
  formatNumber,
  type NormalizedDataSet,
  pinDefaults,
  type ResultBlock,
  type ResultSheet,
  type ResultValue,
  valueAt,
} from '@ps/model'
import { meanAcross } from '@ps/stats'
import { z } from 'zod'

export const ALPHA = 0.05

export const num = (v: number, digits?: number): ResultValue => ({
  kind: 'number',
  v,
  ...(digits ? { digits } : {}),
})
export const int = (v: number): ResultValue => ({ kind: 'integer', v })
export const pval = (v: number): ResultValue => ({ kind: 'pvalue', v })
export const psum = (v: number): ResultValue => ({ kind: 'pSummary', v })
export const text = (v: string): ResultValue => ({ kind: 'text', v })
export const yesNo = (v: boolean): ResultValue => ({ kind: 'bool', v })

/**
 * Roadmap 51c (S31): why entered summary data (mean, SD, N) can't be analyzed by a rank test or
 * a test of matched values, appended to their refusals.
 */
export const RANK_NEEDS_RAW =
  ' A rank test ranks the individual values, which mean, SD and N don’t hold.'
export const PAIRED_NEEDS_RAW =
  ' Matching pairs each subject’s values row by row, which mean, SD and N can’t show.'

/** Audit 3 (S6): what an undefined result reads (as `formatNumber` shows NaN). */
export const UNDEFINED = '—'
/** "Yes" / "No" for P below α; "—" when P is undefined (NaN). */
export const significant = (p: number): ResultValue =>
  Number.isNaN(p) ? text(UNDEFINED) : yesNo(p < ALPHA)
/** "Significant" / "Not significant" for P below α; "—" when P is undefined. */
export const significance = (p: number): ResultValue =>
  text(Number.isNaN(p) ? UNDEFINED : p < ALPHA ? 'Significant' : 'Not significant')
/** A yes / no decision about a P value (flagged, discovery); "—" when P is undefined. */
export const decided = (flag: boolean, p: number): ResultValue =>
  Number.isNaN(p) ? text(UNDEFINED) : yesNo(flag)
/**
 * A statistic inside result text, formatted as result numbers are (`formatNumber`: "—" when
 * undefined, "∞" when infinite) rather than `toPrecision` ("NaN", "Infinity").
 */
export const statText = (v: number, sig = 4) => formatNumber(v, sig)
/** A number inside result text with trailing zeros dropped; "—" or "∞" when not finite. */
export const shortText = (v: number, sig = 4) =>
  Number.isFinite(v) ? String(+v.toPrecision(sig)) : formatNumber(v)
/** Degrees of freedom inside result text: up to three decimals, "—" when undefined. */
export const dfText = (v: number) => (Number.isFinite(v) ? String(+v.toFixed(3)) : formatNumber(v))
export const interval = (lo: number, hi: number, level: number): ResultValue => ({
  kind: 'interval',
  lo,
  hi,
  level,
})

export const kv = (title: string, rows: [string, ResultValue][]): ResultBlock => ({
  type: 'keyValue',
  title,
  rows: rows.map(([label, value]) => ({ label, value })),
})

export const table = (title: string, columns: string[], rows: ResultValue[][]): ResultBlock => ({
  type: 'table',
  title,
  columns,
  rows,
})

/** A table whose first column holds each row's label (and has an empty heading). */
export const labelTable = (
  title: string,
  columns: readonly string[],
  rows: [string, ResultValue[]][],
): ResultBlock =>
  table(
    title,
    ['', ...columns],
    rows.map(([label, values]) => [text(label), ...values]),
  )

export const pct = (level: number) => `${+(level * 100).toFixed(2)}%`

export const tails = z.enum(['two', 'one']).default('two')
export const confidenceLevel = z.number().gt(0.5).lt(1).default(0.95)

/**
 * Roadmap 51c (S1, design §6.3; supersedes decision 18): the direction a one-tailed test
 * predicted, stated before the data were seen. `increase`: the analysis' effect is positive in its
 * sign convention (B − A, the mean above the hypothetical value, r > 0, a higher risk in the
 * exposed row); `decrease`: negative. `unset`: not stated (a one-tailed test then refuses to
 * run). `observed`: analyses saved before 0.3.9, whose one-tailed P followed the data's direction
 * (kept, with a warning); never offered in the form.
 */
export const predicted = z.enum(['unset', 'increase', 'decrease', 'observed']).default('unset')
export type Predicted = z.infer<typeof predicted>

export const TAILS_FIELD = {
  path: ['tails'],
  label: 'P value',
  kind: 'radio',
  options: [
    { value: 'two', label: 'Two-tailed (recommended)' },
    { value: 'one', label: 'One-tailed' },
  ],
} as const

/**
 * The predicted direction of a one-tailed test, in the analysis' words (`{A}` and `{B}`: the data
 * sets' titles, filled in by the form).
 */
export const predictedField = (increase: string, decrease: string) =>
  ({
    path: ['predicted'],
    label: 'Direction you predicted before the experiment',
    kind: 'radio',
    options: [
      { value: 'increase', label: increase },
      { value: 'decrease', label: decrease },
    ],
    showIf: { path: ['tails'], in: ['one'] },
  }) as const

/** Two groups, B − A: "B higher than A" / "B lower than A". */
export const PREDICTED_FIELD = predictedField('{B} higher than {A}', '{B} lower than {A}')

export const CONFIDENCE_FIELD = {
  path: ['confidenceLevel'],
  label: 'Confidence level',
  kind: 'select',
  options: [
    { value: 0.9, label: '90%' },
    { value: 0.95, label: '95%' },
    { value: 0.99, label: '99%' },
  ],
} as const

/**
 * The alternative hypothesis of a test: two-sided, or the predicted direction (S1). A one-tailed
 * analysis saved before 0.3.9 (`observed`) keeps its P: the direction of the observed `effect`.
 */
export function alternativeFor(
  tail: 'two' | 'one',
  direction: Predicted,
  effect = 0,
): 'two-sided' | 'less' | 'greater' {
  if (tail === 'two') return 'two-sided'
  if (direction === 'increase') return 'greater'
  if (direction === 'decrease') return 'less'
  return effect >= 0 ? 'greater' : 'less'
}

/** The message of a one-tailed test with no stated direction (a blocking check, and `run`'s). */
export const NO_DIRECTION =
  'Say which direction you predicted: a one-tailed P needs the direction stated before the experiment.'

/** A failure when a one-tailed test has no stated direction, else null. */
export function directionProblem(
  p: { tails: 'two' | 'one'; predicted: Predicted },
  diagnostics: Diagnostic[] = [],
): AnalysisResult | null {
  return p.tails === 'one' && p.predicted === 'unset' ? failure(NO_DIRECTION, diagnostics) : null
}

/**
 * The warnings of a one-tailed test (S1): the effect went the other way to the prediction (the
 * large P is reported), or the direction was never stated (saved before 0.3.9). `words`:
 * [increase, decrease] in the analysis' terms ("Treated higher than Control").
 */
export function oneTailedNotes(
  p: { tails: 'two' | 'one'; predicted: Predicted },
  effect: number,
  pValue: number,
  words: readonly [string, string],
  what = 'The difference',
): Diagnostic[] {
  if (p.tails !== 'one') return []
  if (p.predicted === 'observed')
    return [
      {
        level: 'warning',
        message:
          'Direction not stated (saved before 0.3.9): this one-tailed P assumes the observed direction was predicted. State the predicted direction in Edit… (Analysis parameters).',
      },
    ]
  const against =
    (p.predicted === 'increase' && effect < 0) || (p.predicted === 'decrease' && effect > 0)
  if (!against) return []
  return [
    {
      level: 'warning',
      message: `${what} went the opposite way to your prediction (${p.predicted === 'increase' ? words[0] : words[1]}); one-tailed P = ${formatNumber(pValue, 2)}.`,
    },
  ]
}

/**
 * Migrating params saved before 0.3.9 (S1): a one-tailed test's P followed the observed
 * direction; it keeps doing so (`observed`), with a warning asking for the direction.
 */
export const pinObservedDirection = (raw: unknown): unknown =>
  valueAt(raw, ['tails']) === 'one' ? pinDefaults(raw, [[['predicted'], 'observed']]) : raw

/**
 * Roadmap 51c (§7.4): the name of the test behind an analysis' P (`values.test`), which result
 * labels on graphs can show ("P = 0.0014, Welch's t test").
 */
export const testValue = (name: string): { test: ResultValue } => ({ test: text(name) })

/** The "Predicted direction" row of a one-tailed test (none when two-tailed). */
export function predictedRows(
  p: { tails: 'two' | 'one'; predicted: Predicted },
  words: readonly [string, string],
): [string, ResultValue][] {
  if (p.tails !== 'one') return []
  const said =
    p.predicted === 'increase'
      ? words[0]
      : p.predicted === 'decrease'
        ? words[1]
        : 'Not stated (the observed direction)'
  return [['Predicted direction', text(said)]]
}

/**
 * A P value and its summary, then, with `question` (e.g. 'Significantly different'), whether it
 * is below α: "question (P < 0.05)?".
 */
export function pSig(p: number, question?: string): [string, ResultValue][] {
  const rows: [string, ResultValue][] = [
    ['P value', pval(p)],
    ['P value summary', psum(p)],
  ]
  if (question !== undefined) rows.push([`${question} (P < ${ALPHA})?`, significant(p)])
  return rows
}

export function pRows(p: number, tail: 'two' | 'one', exact?: boolean): [string, ResultValue][] {
  const rows: [string, ResultValue][] = [
    ...pSig(p, 'Significantly different'),
    ['One- or two-tailed P value?', text(tail === 'two' ? 'Two-tailed' : 'One-tailed')],
  ]
  if (exact !== undefined)
    rows.splice(1, 0, ['Exact or approximate P value?', text(exact ? 'Exact' : 'Approximate')])
  return rows
}

/** Rows of all inputs (they share the source table's rows). */
export const rowCountOf = (input: readonly NormalizedDataSet[]) =>
  Math.max(0, ...input.map((d) => d.rowCount))

/** A data set's Y columns: its replicate subcolumns, or the means of summary data. */
export const yCols = (ds: NormalizedDataSet): Float64Array[] =>
  ds.data.shape === 'replicates' ? ds.data.reps : [ds.data.mean]

/** Row means of a data set (entered means for summary data), NaN where a row has no value. */
export function rowMeans(ds: NormalizedDataSet): Float64Array {
  if (ds.data.shape === 'summary') return Float64Array.from(ds.data.mean)
  return meanAcross(ds.data.reps, ds.rowCount, true)
}

/** A data set's first Y column (multiple-variables tables have one): values, or means. */
export const firstCol = (ds: NormalizedDataSet): Float64Array =>
  ds.data.shape === 'replicates' ? ds.data.reps[0]! : ds.data.mean

/** The logistic function 1 / (1 + e^−x), without overflow. */
export const expit = (x: number) =>
  x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x))

/** Indices of the data sets with these keys (unknown keys and `exclude` left out), each once. */
export function indicesOf(
  input: readonly NormalizedDataSet[],
  keys: readonly string[],
  exclude: readonly number[],
): number[] {
  return keys
    .map((k) => input.findIndex((d) => d.ref.key === k))
    .filter((i, j, all) => i >= 0 && !exclude.includes(i) && all.indexOf(i) === j)
}

/** All non-missing values of a raw data set, pooled across replicate subcolumns. */
export function rawValues(ds: NormalizedDataSet): Float64Array | null {
  if (ds.data.shape !== 'replicates') return null
  if (ds.data.reps.length === 1) return finiteValues(ds.data.reps[0]!)
  const out: number[] = []
  for (const r of ds.data.reps) for (const v of r) if (!Number.isNaN(v)) out.push(v)
  return Float64Array.from(out)
}

/** First-row summary (column tables with summary data have a single row). */
export function summaryOf(ds: NormalizedDataSet): { mean: number; sd: number; n: number } | null {
  if (ds.data.shape !== 'summary') return null
  return {
    mean: ds.data.mean[0] ?? Number.NaN,
    sd: ds.data.sd[0] ?? Number.NaN,
    n: ds.data.n[0] ?? Number.NaN,
  }
}

export function exclusionNotes(input: readonly NormalizedDataSet[]): Diagnostic[] {
  const excluded = input.reduce((s, d) => s + d.counts.excluded, 0)
  return excluded > 0
    ? [
        {
          level: 'info',
          message: `${excluded} excluded value${excluded > 1 ? 's were' : ' was'} not analyzed.`,
        },
      ]
    : []
}

/** 'error' if a diagnostic is an error, else 'warning' if one is a warning, else 'ok'. */
export function statusOf(diagnostics: readonly Diagnostic[]): AnalysisResult['status'] {
  if (diagnostics.some((d) => d.level === 'error')) return 'error'
  return diagnostics.some((d) => d.level === 'warning') ? 'warning' : 'ok'
}

/** The usual single sheet of an analysis. */
export const resultsSheet = (blocks: ResultBlock[], title = 'Table of results'): ResultSheet => ({
  key: 'results',
  title,
  blocks,
})

/**
 * An analysis result: `blocks` make the one results sheet (or give `sheets`); the status follows
 * the diagnostics unless given; the rest defaults to empty.
 */
export function result(r: {
  blocks?: ResultBlock[]
  sheets?: ResultSheet[]
  diagnostics?: Diagnostic[]
  values?: AnalysisResult['values']
  comparisons?: Comparison[]
  outputs?: AnalysisResult['outputs']
  table?: DataTable
  status?: AnalysisResult['status']
}): AnalysisResult {
  const diagnostics = r.diagnostics ?? []
  return {
    status: r.status ?? statusOf(diagnostics),
    diagnostics,
    sheets: r.sheets ?? (r.blocks ? [resultsSheet(r.blocks)] : []),
    values: r.values ?? {},
    comparisons: r.comparisons ?? [],
    outputs: r.outputs ?? {},
    ...(r.table ? { table: r.table } : {}),
  }
}

export function failure(message: string, diagnostics: Diagnostic[] = []): AnalysisResult {
  return result({ diagnostics: [...diagnostics, { level: 'error', message }] })
}

/**
 * A failure when fewer than `n` data sets were passed, else null. The engine and the Analyze
 * dialog enforce `inputs.min`; this keeps a direct call with too few from throwing.
 */
export function tooFewDataSets(
  input: readonly NormalizedDataSet[],
  n: number,
  message: string,
): AnalysisResult | null {
  return input.length < n ? failure(message) : null
}

export const comparisonKey = (a: NormalizedDataSet, b: NormalizedDataSet) =>
  `${a.ref.key}|${b.ref.key}`

/**
 * XY data as (x, y) points, each replicate its own point (the default for regression). Rows
 * without an X, and missing/excluded Y values, are skipped. Summary data contributes its means.
 */
export function xyPoints(ds: NormalizedDataSet): { x: Float64Array; y: Float64Array } {
  const xs: number[] = []
  const ys: number[] = []
  const xcol = ds.x
  if (!xcol) return { x: new Float64Array(0), y: new Float64Array(0) }
  const cols = yCols(ds)
  for (let row = 0; row < ds.rowCount; row++) {
    const x = xcol[row]!
    if (Number.isNaN(x)) continue
    for (const c of cols) {
      const y = c[row]!
      if (Number.isNaN(y)) continue
      xs.push(x)
      ys.push(y)
    }
  }
  return { x: Float64Array.from(xs), y: Float64Array.from(ys) }
}

/**
 * XY rows skipped because X is empty or excluded although a Y value is present (counted once per
 * row across the data sets).
 */
export function missingXNote(input: readonly NormalizedDataSet[]): Diagnostic[] {
  const rows = new Set<number>()
  for (const ds of input) {
    if (!ds.x) continue
    const cols = yCols(ds)
    for (let r = 0; r < ds.rowCount; r++)
      if (Number.isNaN(ds.x[r]!) && cols.some((c) => !Number.isNaN(c[r]!))) rows.add(r)
  }
  const n = rows.size
  return n > 0
    ? [
        {
          level: 'info',
          message: `${n} row${n > 1 ? 's' : ''} with Y values but no X ${n > 1 ? 'were' : 'was'} left out.`,
        },
      ]
    : []
}

/** Paired analyses: rows where only one of the two columns has a value are left out. */
export function unpairedRowsNote(a: Float64Array, b: Float64Array): Diagnostic[] {
  let n = 0
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const hasA = !Number.isNaN(a[i] ?? Number.NaN)
    const hasB = !Number.isNaN(b[i] ?? Number.NaN)
    if (hasA !== hasB) n++
  }
  return n > 0
    ? [
        {
          level: 'info',
          message: `${n} row${n > 1 ? 's' : ''} without a complete pair ${n > 1 ? 'were' : 'was'} ignored.`,
        },
      ]
    : []
}

/**
 * Entered summary data that can't be analyzed: N must be a whole number ≥ `minN` and SD or SEM
 * can't be negative. Returns a message naming the data set (and `where`, e.g. the row), or null.
 */
export function summaryProblem(
  ds: NormalizedDataSet,
  row = 0,
  minN = 1,
  where = '',
): string | null {
  if (ds.data.shape !== 'summary') return null
  const name = `“${ds.title}”${where ? ` (${where})` : ''}`
  const n = ds.data.n[row] ?? Number.NaN
  if (Number.isFinite(n) && (!Number.isInteger(n) || n < minN))
    return `N of ${name} must be a whole number, ${minN} or more.`
  if ((ds.data.sd[row] ?? 0) < 0 || (ds.data.sem[row] ?? 0) < 0)
    return `The SD or SEM of ${name} can’t be negative.`
  return null
}

/** X values for drawing a curve across [lo, hi]; geometric spacing for wide positive ranges. */
export function curveXs(lo: number, hi: number, n = 200): Float64Array {
  const out = new Float64Array(n)
  const geometric = lo > 0 && hi / lo >= 100
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    out[i] = geometric ? lo * (hi / lo) ** t : lo + (hi - lo) * t
  }
  return out
}

/**
 * Multiple-variables tables: the chosen variables (data sets) as columns, keeping only rows where
 * every one of them has a value (complete cases), as regression and PCA need.
 */
export function completeCases(vars: readonly NormalizedDataSet[]): {
  columns: number[][]
  rows: number[]
  dropped: number
} {
  const cols = vars.map(firstCol)
  const n = rowCountOf(vars)
  const rows: number[] = []
  let dropped = 0
  for (let r = 0; r < n; r++) {
    const vals = cols.map((c) => c[r] ?? Number.NaN)
    const filled = vals.filter((v) => !Number.isNaN(v)).length
    if (filled === vals.length) rows.push(r)
    else if (filled > 0) dropped++
  }
  return { columns: cols.map((c) => rows.map((r) => c[r]!)), rows, dropped }
}

export function droppedNote(dropped: number): Diagnostic[] {
  return dropped > 0
    ? [
        {
          level: 'info',
          message: `${dropped} row${dropped > 1 ? 's' : ''} with a missing value ${dropped > 1 ? 'were' : 'was'} left out.`,
        },
      ]
    : []
}

/**
 * The data set chosen in a picker field; '' or an unknown key means the `fallback`-th (the UI's
 * 'dataset.pick:<n>' components show the same default).
 */
export function pick(input: readonly NormalizedDataSet[], key: string, fallback = 0): number {
  const i = input.findIndex((d) => d.ref.key === key)
  return i >= 0 ? i : Math.min(fallback, input.length - 1)
}
