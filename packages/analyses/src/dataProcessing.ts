import type { AnalysisDef, NormalizedDataSet, ResultSheet, ResultValue } from '@ps/model'
import { maxOf, median, minOf, tQuantile } from '@ps/stats'
import { z } from 'zod'
import {
  CONFIDENCE_FIELD,
  confidenceLevel,
  exclusionNotes,
  failure,
  int,
  interval,
  num,
  pct,
  result,
  rowCountOf,
  table,
  text,
  yCols,
} from './common.ts'
import { rowLabel } from './resultTable.ts'

// ---------------------------------------------------------------------------------------------
// Row statistics: mean, SD, SEM, N, CI … of each row, for each data set (its replicates) or
// across all data sets (every value in the row), as Prism's "Row statistics".
// ---------------------------------------------------------------------------------------------

const RowParams = z.object({
  scope: z.enum(['perDataSet', 'allDataSets']).default('perDataSet'),
  sd: z.boolean().default(true),
  sem: z.boolean().default(true),
  n: z.boolean().default(true),
  ci: z.boolean().default(false),
  sum: z.boolean().default(false),
  minMax: z.boolean().default(false),
  median: z.boolean().default(false),
  confidenceLevel,
})
type RowParams = z.infer<typeof RowParams>

/**
 * Statistics of one row's values. From summary data (mean/SD/N per cell) several cells combine
 * exactly as the underlying values would: N = Σ n, mean = Σ n·m / N and SD from the within-cell
 * plus between-cell sums of squares; median, minimum and maximum need raw values (NaN).
 */
export interface RowSummary {
  n: number
  mean: number
  sd: number
  sem: number
  lo: number
  hi: number
  sum: number
  min: number
  max: number
  median: number
}

export function rowSummary(
  parts: readonly ({ values: number[] } | { mean: number; sd: number; n: number })[],
  level: number,
): RowSummary {
  const nan = Number.NaN
  const raw = parts.every((p) => 'values' in p)
  const groups = parts.map((p) => {
    if ('values' in p) {
      const v = p.values
      const n = v.length
      const c = v[0] ?? 0
      const m = n ? c + v.reduce((s, x) => s + (x - c), 0) / n : nan
      const ss = v.reduce((s, x) => s + (x - m) ** 2, 0)
      return { n, mean: m, ss }
    }
    return { n: p.n, mean: p.mean, ss: p.n > 1 ? (p.n - 1) * p.sd * p.sd : 0 }
  })
  const used = groups.filter((g) => g.n > 0)
  const N = used.reduce((s, g) => s + g.n, 0)
  if (N === 0)
    return {
      n: 0,
      mean: nan,
      sd: nan,
      sem: nan,
      lo: nan,
      hi: nan,
      sum: nan,
      min: nan,
      max: nan,
      median: nan,
    }
  const c = used[0]!.mean
  const mean = c + used.reduce((s, g) => s + g.n * (g.mean - c), 0) / N
  const ss = used.reduce((s, g) => s + g.ss + g.n * (g.mean - mean) ** 2, 0)
  const sd = N > 1 ? Math.sqrt(ss / (N - 1)) : nan
  const sem = sd / Math.sqrt(N)
  const h = N > 1 ? tQuantile(1 - (1 - level) / 2, N - 1) * sem : nan
  const all = raw ? parts.flatMap((p) => (p as { values: number[] }).values) : []
  return {
    n: N,
    mean,
    sd,
    sem,
    lo: mean - h,
    hi: mean + h,
    sum: raw ? all.reduce((s, x) => s + x, 0) : mean * N,
    min: raw ? minOf(all) : nan,
    max: raw ? maxOf(all) : nan,
    median: raw ? median(all) : nan,
  }
}

function cellPart(ds: NormalizedDataSet, r: number) {
  if (ds.data.shape === 'replicates') {
    return { values: ds.data.reps.map((rep) => rep[r]!).filter(Number.isFinite) }
  }
  const d = ds.data
  const n = d.n[r]!
  const m = d.mean[r]!
  if (!Number.isFinite(m)) return { values: [] }
  // A mean without N counts as one value (Prism plots entered means that way).
  if (!Number.isFinite(n)) return { values: [m] }
  return { mean: m, sd: Number.isFinite(d.sd[r]!) ? d.sd[r]! : 0, n }
}

export const rowStatsDef: AnalysisDef<RowParams> = {
  id: 'rowStats',
  version: 1,
  title: 'Row statistics',
  category: 'Data processing',
  description:
    'Mean, SD, SEM, N, confidence interval (and optionally sum, minimum, maximum, median) of each row, for each data set or across all data sets.',
  accepts: ['grouped', 'xy', 'column'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: RowParams,
  form: [
    {
      path: ['scope'],
      label: 'Calculate',
      kind: 'radio',
      options: [
        { value: 'perDataSet', label: 'Row statistics for each data set (its replicates)' },
        { value: 'allDataSets', label: 'Row statistics across all data sets' },
      ],
    },
    { path: ['sd'], label: 'SD', kind: 'checkbox' },
    { path: ['sem'], label: 'SEM', kind: 'checkbox' },
    { path: ['n'], label: 'N', kind: 'checkbox' },
    { path: ['ci'], label: 'Confidence interval of the mean', kind: 'checkbox' },
    { path: ['sum'], label: 'Sum', kind: 'checkbox' },
    { path: ['minMax'], label: 'Minimum and maximum', kind: 'checkbox' },
    { path: ['median'], label: 'Median', kind: 'checkbox' },
    { ...CONFIDENCE_FIELD, showIf: { path: ['ci'], in: [true] } },
  ],
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    const rowCount = rowCountOf(input)
    const level = params.confidenceLevel
    type Stat = [string, (s: RowSummary) => ResultValue]
    const all: [boolean, Stat][] = [
      [true, ['Mean', (s) => num(s.mean)]],
      [params.sd, ['SD', (s) => num(s.sd)]],
      [params.sem, ['SEM', (s) => num(s.sem)]],
      [params.n, ['N', (s) => int(s.n)]],
      [params.ci, [`${pct(level)} CI of mean`, (s) => interval(s.lo, s.hi, level)]],
      [params.sum, ['Sum', (s) => num(s.sum)]],
      [params.minMax, ['Minimum', (s) => num(s.min)]],
      [params.minMax, ['Maximum', (s) => num(s.max)]],
      [params.median, ['Median', (s) => num(s.median)]],
    ]
    const stats = all.filter(([on]) => on).map(([, s]) => s)
    const rows: number[] = []
    for (let r = 0; r < rowCount; r++)
      if (
        input.some((ds) => {
          const p = cellPart(ds, r)
          return 'n' in p || p.values.length > 0
        })
      )
        rows.push(r)
    if (!rows.length) return failure('There are no values.', diagnostics)
    const sheets: ResultSheet[] = []
    if (params.scope === 'allDataSets') {
      sheets.push({
        key: 'rows',
        title: 'Row statistics',
        blocks: [
          table(
            'Row statistics across all data sets',
            ['Row', ...stats.map(([l]) => l)],
            rows.map((r) => {
              const s = rowSummary(
                input.map((ds) => cellPart(ds, r)),
                level,
              )
              return [text(rowLabel(input, r)), ...stats.map(([, f]) => f(s))]
            }),
          ),
        ],
      })
    } else {
      sheets.push({
        key: 'rows',
        title: 'Row statistics',
        blocks: [
          table(
            'Row statistics for each data set',
            ['Row', ...input.flatMap((ds) => stats.map(([l]) => `${ds.title}: ${l}`))],
            rows.map((r) => [
              text(rowLabel(input, r)),
              ...input.flatMap((ds) => {
                const s = rowSummary([cellPart(ds, r)], level)
                return stats.map(([, f]) => f(s))
              }),
            ]),
          ),
        ],
      })
    }
    return result({ sheets, diagnostics, values: { rows: int(rows.length) } })
  },
}

// ---------------------------------------------------------------------------------------------
// Fraction of total: each value divided by its column total, its row total, or the grand total.
// ---------------------------------------------------------------------------------------------

const FracParams = z.object({
  divideBy: z.enum(['column', 'row', 'grand']).default('column'),
  display: z.enum(['fraction', 'percent']).default('fraction'),
})
type FracParams = z.infer<typeof FracParams>

/**
 * `grid[r][c]`: the table's values (NaN = empty/excluded), one column per subcolumn. Empty
 * cells stay empty and don't count in any total. Totals of 0 give NaN fractions.
 */
export function fractionOfTotal(
  grid: readonly (readonly number[])[],
  divideBy: 'column' | 'row' | 'grand',
): { fractions: number[][]; totals: number[] } {
  const R = grid.length
  const C = R ? grid[0]!.length : 0
  const add = (s: number, x: number) => (Number.isFinite(x) ? s + x : s)
  const colTotals = Array.from({ length: C }, (_, c) => grid.reduce((s, row) => add(s, row[c]!), 0))
  const rowTotals = grid.map((row) => row.reduce(add, 0))
  const grand = rowTotals.reduce((s, x) => s + x, 0)
  const fractions = grid.map((row, r) =>
    row.map((x, c) => {
      if (!Number.isFinite(x)) return Number.NaN
      const t = divideBy === 'column' ? colTotals[c]! : divideBy === 'row' ? rowTotals[r]! : grand
      return t === 0 ? Number.NaN : x / t
    }),
  )
  return {
    fractions,
    totals: divideBy === 'column' ? colTotals : divideBy === 'row' ? rowTotals : [grand],
  }
}

export const fractionOfTotalDef: AnalysisDef<FracParams> = {
  id: 'fractionOfTotal',
  version: 1,
  title: 'Fraction of total',
  category: 'Data processing',
  description:
    'Divide each value by its column total, its row total or the grand total, as a fraction or a percentage.',
  accepts: ['column', 'grouped', 'contingency', 'xy', 'partsOfWhole'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: FracParams,
  form: [
    {
      path: ['divideBy'],
      label: 'Divide each value by',
      kind: 'radio',
      options: [
        { value: 'column', label: 'Its column total' },
        { value: 'row', label: 'Its row total' },
        { value: 'grand', label: 'The grand total' },
      ],
    },
    {
      path: ['display'],
      label: 'Display results as',
      kind: 'radio',
      options: [
        { value: 'fraction', label: 'Fractions' },
        { value: 'percent', label: 'Percentages' },
      ],
    },
  ],
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    const rowCount = rowCountOf(input)
    // One column per subcolumn (entered means for summary data).
    const cols = input.flatMap((ds) => {
      const arrays = yCols(ds)
      return arrays.map((a, i) => ({
        title: arrays.length > 1 ? `${ds.title} (${i + 1})` : ds.title,
        values: a,
      }))
    })
    const grid = Array.from({ length: rowCount }, (_, r) =>
      cols.map((c) => c.values[r] ?? Number.NaN),
    )
    const rows = grid.map((_, r) => r).filter((r) => grid[r]!.some(Number.isFinite))
    if (!rows.length) return failure('There are no values.', diagnostics)
    if (grid.some((row) => row.some((x) => x < 0)))
      diagnostics.push({
        level: 'warning',
        message: 'Some values are negative; fractions of a total are hard to interpret.',
      })
    const { fractions, totals } = fractionOfTotal(grid, params.divideBy)
    const scale = params.display === 'percent' ? 100 : 1
    const cell = (x: number) => (Number.isFinite(x) ? num(scale * x) : text(''))
    const blocks = [
      table(
        `${params.display === 'percent' ? 'Percent' : 'Fraction'} of ${params.divideBy === 'column' ? 'column' : params.divideBy === 'row' ? 'row' : 'grand'} total`,
        ['Row', ...cols.map((c) => c.title), ...(params.divideBy === 'row' ? ['Row total'] : [])],
        rows.map((r) => [
          text(rowLabel(input, r)),
          ...fractions[r]!.map(cell),
          ...(params.divideBy === 'row' ? [num(totals[r]!)] : []),
        ]),
      ),
      params.divideBy === 'column'
        ? table(
            'Column totals',
            cols.map((c) => c.title),
            [totals.map((t) => num(t))],
          )
        : params.divideBy === 'grand'
          ? table('Grand total', ['Grand total'], [[num(totals[0]!)]])
          : null,
    ].filter((b) => b !== null)
    return result({
      sheets: [{ key: 'fractions', title: 'Fraction of total', blocks }],
      diagnostics,
    })
  },
}
