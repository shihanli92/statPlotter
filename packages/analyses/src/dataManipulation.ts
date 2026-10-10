import {
  type AnalysisDef,
  type Diagnostic,
  evaluateFormula,
  type FormulaColumn,
  type NormalizedDataSet,
  type ResultValue,
  type TableKind,
  type YFormat,
} from '@ps/model'
import { max, mean, meanAcross, median, min, sd, sem, sum } from '@ps/stats'
import { z } from 'zod'
import { exclusionNotes, failure, int, kv, num, rowCountOf, table, text, yCols } from './common.ts'
import {
  applySummaryFormat,
  type OutDataSet,
  rowLabel,
  sourceKind,
  sourceX,
  stableId,
  tableResult,
} from './resultTable.ts'

// ---------------------------------------------------------------------------------------------
// Roadmap 38, data manipulation: tables derived from a table that follow it live (analyses
// producing a table, decision 67): Filter rows, Aggregate by group, Percentages of a contingency
// or parts-of-whole table, and Convert time units of a survival table. Each is read-only, chains
// like any result table, and can be frozen into an editable data table.
// ---------------------------------------------------------------------------------------------

/** A numeric data set's value at a row: its first replicate's (one value per row), else the mean. */
function rowValue(ds: NormalizedDataSet): Float64Array {
  if (ds.data.shape === 'summary') return ds.data.mean
  const reps = ds.data.reps
  return reps.length === 1 ? reps[0]! : meanAcross(reps, ds.rowCount)
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// ---------------------------------------------------------------------------------------------
// Filter rows
// ---------------------------------------------------------------------------------------------

const FilterParams = z.object({
  /**
   * The condition rows must meet, in the formula language: `sample = "S1" and nCount > 500`.
   * Names are the analyzed variables' (data sets') titles; on tables with X values also `X`,
   * with row titles `Row_title`, and always `Row` (1, 2, …), unless a data set has that title.
   */
  condition: z.string().default(''),
})
type FilterParams = z.infer<typeof FilterParams>

/** The columns a condition reads: every data set, then X, the row title and the row number. */
export function filterColumns(
  input: readonly NormalizedDataSet[],
  rowCount: number,
): FormulaColumn[] {
  const cols: FormulaColumn[] = input.map((ds) => ({
    id: ds.ref.key,
    title: ds.title,
    ...(ds.text ? { text: ds.text } : { values: rowValue(ds) }),
  }))
  const taken = new Set(input.map((d) => d.title.trim().toLowerCase()))
  const add = (c: FormulaColumn) => {
    if (!taken.has(c.title.toLowerCase())) cols.push(c)
  }
  const x = input.find((d) => d.x)?.x
  if (x) add({ id: '#x', title: 'X', values: x })
  const titles = input[0]?.rowTitles
  if (titles) add({ id: '#title', title: 'Row title', text: titles })
  add({
    id: '#row',
    title: 'Row',
    values: Float64Array.from({ length: rowCount }, (_, r) => r + 1),
  })
  return cols
}

/** The rows meeting the condition (a value that isn't 0), or the formula's error. */
export function matchingRows(
  condition: string,
  input: readonly NormalizedDataSet[],
): { rows: number[]; error: string | null; blank: number } {
  const R = rowCountOf(input)
  const r = evaluateFormula(condition, filterColumns(input, R), R)
  if (r.error) return { rows: [], error: r.error, blank: 0 }
  if (r.text) return { rows: [], error: 'the condition gives text, not true or false', blank: 0 }
  const rows: number[] = []
  let blank = 0
  for (let i = 0; i < R; i++) {
    const v = r.values[i]!
    if (Number.isNaN(v)) blank++
    else if (v !== 0) rows.push(i)
  }
  return { rows, error: null, blank }
}

function pickRows(a: ArrayLike<number>, rows: readonly number[]): Float64Array {
  const out = new Float64Array(rows.length)
  for (let i = 0; i < rows.length; i++) out[i] = a[rows[i]!]!
  return out
}

/**
 * Summary data sets' kept rows (audit 2, decision 681), as what they draw: error bounds of the
 * asymmetric presets (± error, upper / lower) as mean, upper and lower (the bounds as the source
 * gives them); SEM entered as mean, SEM and N; otherwise mean, SD and N, or mean, SEM and N when
 * no SD is known (`applySummaryFormat`).
 */
function filteredSummary(
  input: readonly NormalizedDataSet[],
  out: OutDataSet[],
  rows: readonly number[],
): YFormat {
  const numeric = input.flatMap((ds, i) =>
    ds.data.shape === 'summary' && !ds.text ? [{ data: ds.data, o: out[i]! }] : [],
  )
  const pick = (a: ArrayLike<number>) => pickRows(a, rows)
  if (numeric.some(({ data }) => data.lo && data.hi)) {
    for (const { data, o } of numeric) {
      const nan = new Float64Array(rows.length).fill(Number.NaN)
      o.subcolumns = [pick(data.mean), data.hi ? pick(data.hi) : nan, data.lo ? pick(data.lo) : nan]
    }
    return { type: 'summary', preset: 'meanUpperLower' }
  }
  // SEM entered (meanSemN, meanSem): kept as SEM, not derived back from the SD.
  if (numeric.length && numeric.every(({ data }) => data.preset?.startsWith('meanSem'))) {
    for (const { data, o } of numeric) o.subcolumns = [data.mean, data.sem, data.n].map(pick)
    return { type: 'summary', preset: 'meanSemN' }
  }
  return applySummaryFormat(
    numeric.map(({ o }) => o),
    numeric.map(({ data }) => ({
      mean: pick(data.mean),
      sd: pick(data.sd),
      sem: pick(data.sem),
      n: pick(data.n),
    })),
  )
}

export const filterRowsDef: AnalysisDef<FilterParams> = {
  id: 'filterRows',
  version: 1,
  title: 'Filter rows',
  category: 'Data processing',
  description:
    'A table of the rows that meet a condition (e.g. sample = "S1" and nCount > 500), following the source as it changes.',
  accepts: [
    'multipleVariables',
    'xy',
    'column',
    'grouped',
    'contingency',
    'survival',
    'partsOfWhole',
    'nested',
  ],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: FilterParams,
  producesTable: true,
  form: [
    {
      path: ['condition'],
      label: 'Keep the rows where',
      kind: 'custom',
      component: 'filter.condition',
    },
  ],
  run(input, params, context) {
    const diagnostics = exclusionNotes(input)
    if (!params.condition.trim())
      return failure('Choose a condition for the rows to keep.', diagnostics)
    const kind: TableKind = sourceKind(input, context)
    const R = rowCountOf(input)
    const { rows, error, blank } = matchingRows(params.condition, input)
    if (error) return failure(`The condition can’t be used: ${error}.`, diagnostics)
    if (blank)
      diagnostics.push({
        level: 'info',
        message: `${plural(blank, 'row')} with a value the condition needs missing ${blank === 1 ? 'was' : 'were'} left out.`,
      })
    if (!rows.length) diagnostics.push({ level: 'warning', message: 'No row meets the condition.' })
    const out: OutDataSet[] = input.map((ds) => {
      if (ds.text)
        return {
          id: stableId(ds.ref.key),
          title: ds.title,
          subcolumns: [],
          text: rows.map((r) => ds.text![r] ?? null),
        }
      return {
        id: stableId(ds.ref.key),
        title: ds.title,
        subcolumns:
          ds.data.shape === 'replicates' ? ds.data.reps.map((c) => pickRows(c, rows)) : [],
      }
    })
    const summary = input.some((d) => d.data.shape === 'summary')
    if (summary && input.some((d) => d.data.shape !== 'summary'))
      return failure('The data sets mix raw and summary data.', diagnostics)
    const yFormat = summary ? filteredSummary(input, out, rows) : undefined
    const x = sourceX(input, context)
    const titles = input[0]?.rowTitles
    return tableResult(
      'Filter rows',
      [
        kv('Filter rows', [
          ['Condition', text(params.condition.replace(/^\s*=/, ''))],
          ['Rows in the source', int(R)],
          ['Rows kept', int(rows.length)],
          ['Rows left out', int(R - rows.length)],
        ]),
      ],
      diagnostics,
      input,
      {
        name: 'Filtered rows',
        tableKind: kind,
        rowCount: rows.length,
        rowTitles: titles ? rows.map((r) => titles[r] ?? null) : null,
        x: x ? { title: x.title, values: pickRows(x.values, rows) } : null,
        dataSets: out,
        ...(yFormat ? { yFormat } : {}),
      },
      { kept: int(rows.length), source: int(R) },
    )
  },
}

// ---------------------------------------------------------------------------------------------
// Aggregate by group
// ---------------------------------------------------------------------------------------------

export const AGGREGATE_STATS = [
  'mean',
  'median',
  'sd',
  'sem',
  'n',
  'min',
  'max',
  'sum',
  'pctAbove',
  'pctNonzero',
] as const
export type AggregateStat = (typeof AGGREGATE_STATS)[number]

const STAT_LABEL: Record<AggregateStat, string> = {
  mean: 'mean',
  median: 'median',
  sd: 'SD',
  sem: 'SEM',
  n: 'n',
  min: 'min',
  max: 'max',
  sum: 'sum',
  pctAbove: '% above',
  pctNonzero: '% non-zero',
}

const AggregateParams = z.object({
  /** The statistics of each number variable, in this order. */
  stats: z.array(z.enum(AGGREGATE_STATS)).default(['mean', 'sd', 'n']),
  /** `pctAbove`: the % of values greater than this. */
  threshold: z.number().default(0),
})
type AggregateParams = z.infer<typeof AggregateParams>

/** A statistic of a group's values (missing values left out), from `@ps/stats`. */
export function groupStatistic(stat: AggregateStat, v: Float64Array, threshold: number): number {
  const n = v.length
  switch (stat) {
    case 'n':
      return n
    case 'sum':
      return sum(v)
    case 'mean':
      return n ? mean(v) : Number.NaN
    case 'median':
      return n ? median(v) : Number.NaN
    case 'sd':
      return n > 1 ? sd(v) : Number.NaN
    case 'sem':
      return n > 1 ? sem(v) : Number.NaN
    case 'min':
      return n ? min(v) : Number.NaN
    case 'max':
      return n ? max(v) : Number.NaN
    case 'pctAbove':
    case 'pctNonzero': {
      if (!n) return Number.NaN
      let k = 0
      for (let i = 0; i < n; i++) if (stat === 'pctAbove' ? v[i]! > threshold : v[i] !== 0) k++
      return (100 * k) / n
    }
  }
}

const statTitle = (title: string, stat: AggregateStat, threshold: number) =>
  stat === 'pctAbove' ? `${title} % > ${threshold}` : `${title} ${STAT_LABEL[stat]}`

/**
 * Rows grouped by the values of the group (text) variables, trimmed, in the order the
 * combinations first appear; rows with a blank group value are in none.
 */
export function groupRows(
  groups: readonly NormalizedDataSet[],
  rowCount: number,
): { members: number[][]; labels: string[][]; blank: number } {
  const index = new Map<string, number>()
  const members: number[][] = []
  const labels: string[][] = []
  let blank = 0
  for (let r = 0; r < rowCount; r++) {
    const parts: string[] = []
    for (const g of groups) {
      const t = g.text?.[r]?.trim()
      if (!t) break
      parts.push(t)
    }
    if (parts.length < groups.length) {
      blank++
      continue
    }
    // A control character between the parts keeps ("a b", "c") apart from ("a", "b c").
    const key = parts.join('\u0001')
    let i = index.get(key)
    if (i === undefined) {
      i = members.length
      index.set(key, i)
      members.push([])
      labels.push(parts)
    }
    members[i]!.push(r)
  }
  return { members, labels, blank }
}

/** Rows of a results sheet's table at most (the derived table has them all). */
const SHEET_ROWS = 1000

export const aggregateDef: AnalysisDef<AggregateParams> = {
  id: 'aggregate',
  version: 1,
  title: 'Aggregate by group',
  category: 'Data processing',
  description:
    'Summarise number variables by the text variables chosen: a table with one row per group (mean, median, SD, SEM, n, min, max, sum, % above a threshold, % non-zero), following the source.',
  accepts: ['multipleVariables'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: AggregateParams,
  producesTable: true,
  form: [
    {
      path: ['stats'],
      label: 'Statistics of each number variable',
      kind: 'custom',
      component: 'aggregate.stats',
    },
    {
      path: ['threshold'],
      label: '% above: values greater than',
      kind: 'number',
    },
  ],
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    const groups = input.filter((d) => d.text)
    const values = input.filter((d) => !d.text)
    if (!groups.length)
      return failure('Choose one or more text variables to group the rows by.', diagnostics)
    if (!params.stats.length) return failure('Choose one or more statistics.', diagnostics)
    const R = rowCountOf(input)
    const { members, labels, blank } = groupRows(groups, R)
    if (blank)
      diagnostics.push({
        level: 'info',
        message: `${plural(blank, 'row')} without a value of every group variable ${blank === 1 ? 'was' : 'were'} left out.`,
      })
    if (!members.length) diagnostics.push({ level: 'warning', message: 'No row has a group.' })
    const G = members.length
    const out: OutDataSet[] = groups.map((g, k) => ({
      id: stableId(g.ref.key),
      title: g.title,
      subcolumns: [],
      text: labels.map((l) => l[k]!),
    }))
    const sheetRows: ResultValue[][] = labels.map((l) => l.map((p) => text(p)))
    const columns = groups.map((g) => g.title)
    for (const v of values) {
      const col = rowValue(v)
      const byGroup = members.map((m) => {
        const vals: number[] = []
        for (const r of m) {
          const x = col[r]!
          if (!Number.isNaN(x)) vals.push(x)
        }
        return Float64Array.from(vals)
      })
      for (const stat of params.stats) {
        const s = byGroup.map((vals) => groupStatistic(stat, vals, params.threshold))
        const title = statTitle(v.title, stat, params.threshold)
        out.push({ id: stableId(v.ref.key, stat), title, subcolumns: [s] })
        columns.push(title)
        s.forEach((x, i) => {
          sheetRows[i]!.push(stat === 'n' ? int(x) : num(x))
        })
      }
    }
    if (!values.length)
      diagnostics.push({
        level: 'info',
        message: 'No number variable was chosen: the table lists the groups only.',
      })
    if (G > SHEET_ROWS)
      diagnostics.push({
        level: 'info',
        message: `The results sheet shows the first ${SHEET_ROWS} of the ${G} groups; the table made has every group.`,
      })
    return tableResult(
      'Aggregate',
      [
        kv('Aggregate by group', [
          ['Grouped by', text(groups.map((g) => g.title).join(', '))],
          ['Groups', int(G)],
          ['Rows summarised', int(R - blank)],
        ]),
        table('Statistics by group', columns, sheetRows.slice(0, SHEET_ROWS)),
      ],
      diagnostics,
      input,
      {
        name: 'Aggregated',
        tableKind: 'multipleVariables',
        rowCount: G,
        rowTitles: null,
        x: null,
        dataSets: out,
      },
      { groups: int(G) },
    )
  },
}

// ---------------------------------------------------------------------------------------------
// Row, column and total percentages (contingency and parts-of-whole tables)
// ---------------------------------------------------------------------------------------------

const PercentParams = z.object({
  of: z.enum(['row', 'column', 'total']).default('row'),
})
type PercentParams = z.infer<typeof PercentParams>

export const percentagesDef: AnalysisDef<PercentParams> = {
  id: 'percentages',
  version: 1,
  title: 'Row, column or total percentages',
  category: 'Data processing',
  description:
    'Each count as a percentage of its row total, its column total or the grand total; the result is a table of the same kind.',
  accepts: ['contingency', 'partsOfWhole'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: PercentParams,
  producesTable: true,
  form: [
    {
      path: ['of'],
      label: 'Percentage of',
      kind: 'radio',
      options: [
        { value: 'row', label: 'Its row total (row %)' },
        { value: 'column', label: 'Its column total (column %)' },
        { value: 'total', label: 'The grand total (total %)' },
      ],
    },
  ],
  run(input, params, context) {
    const diagnostics = exclusionNotes(input)
    const R = rowCountOf(input)
    const cols = input.map((ds) => yCols(ds)[0] ?? new Float64Array(R).fill(Number.NaN))
    const add = (s: number, v: number) => (Number.isNaN(v) ? s : s + v)
    const rowTotals = Array.from({ length: R }, (_, r) => cols.reduce((s, c) => add(s, c[r]!), 0))
    const colTotals = cols.map((c) => Array.from(c).reduce(add, 0))
    const grand = colTotals.reduce((s, v) => s + v, 0)
    if (!cols.some((c) => c.some((v) => !Number.isNaN(v))))
      return failure('There are no values.', diagnostics)
    if (cols.some((c) => c.some((v) => v < 0)))
      diagnostics.push({
        level: 'warning',
        message: 'Some values are negative; percentages of a total are hard to interpret.',
      })
    const out: OutDataSet[] = input.map((ds, c) => ({
      id: stableId(ds.ref.key),
      title: ds.title,
      subcolumns: [
        Float64Array.from(cols[c]!, (v, r) => {
          const t =
            params.of === 'row' ? rowTotals[r]! : params.of === 'column' ? colTotals[c]! : grand
          return Number.isNaN(v) || t === 0 ? Number.NaN : (100 * v) / t
        }),
      ],
    }))
    const label = params.of === 'row' ? 'Row %' : params.of === 'column' ? 'Column %' : 'Total %'
    return tableResult(
      label,
      [
        table(
          label,
          ['Row', ...input.map((d) => d.title)],
          Array.from({ length: R }, (_, r) => [
            text(rowLabel(input, r)),
            ...out.map((o) => num((o.subcolumns[0] as Float64Array)[r]!)),
          ]),
        ),
        kv('Totals', [['Grand total', num(grand)]]),
      ],
      diagnostics,
      input,
      {
        name: label,
        tableKind: sourceKind(input, context),
        rowCount: R,
        rowTitles: input[0]?.rowTitles ?? null,
        x: null,
        dataSets: out,
      },
    )
  },
}

// ---------------------------------------------------------------------------------------------
// Survival tables: time units
// ---------------------------------------------------------------------------------------------

/** Days in each unit: a week is 7 days, a year 365.25 days, a month a twelfth of a year. */
export const TIME_UNITS = { days: 1, weeks: 7, months: 365.25 / 12, years: 365.25 } as const
type TimeUnit = keyof typeof TIME_UNITS
const UNIT_IDS = Object.keys(TIME_UNITS) as [TimeUnit, ...TimeUnit[]]
const capital = (u: string) => u[0]!.toUpperCase() + u.slice(1)

const TimeParams = z.object({
  from: z.enum(UNIT_IDS).default('days'),
  to: z.enum(UNIT_IDS).default('months'),
})
type TimeParams = z.infer<typeof TimeParams>

export const survivalTimeDef: AnalysisDef<TimeParams> = {
  id: 'survivalTime',
  version: 1,
  title: 'Convert time units',
  category: 'Data processing',
  description:
    'A survival table with its times in other units (days, weeks, months, years: 7 days a week, 365.25 days a year).',
  accepts: ['survival'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: TimeParams,
  producesTable: true,
  form: [
    {
      path: ['from'],
      label: 'The times are in',
      kind: 'select',
      options: UNIT_IDS.map((u) => ({ value: u, label: capital(u) })),
    },
    {
      path: ['to'],
      label: 'Convert them to',
      kind: 'select',
      options: UNIT_IDS.map((u) => ({ value: u, label: capital(u) })),
    },
  ],
  run(input, params, context) {
    const diagnostics: Diagnostic[] = exclusionNotes(input)
    const x = sourceX(input, context)
    if (!x) return failure('A survival table’s times are its X values.', diagnostics)
    const f = TIME_UNITS[params.from] / TIME_UNITS[params.to]
    const R = rowCountOf(input)
    const out: OutDataSet[] = input.map((ds) => ({
      id: stableId(ds.ref.key),
      title: ds.title,
      subcolumns: yCols(ds),
    }))
    return tableResult(
      'Convert time units',
      [
        kv('Time units', [
          ['From', text(capital(params.from))],
          ['To', text(capital(params.to))],
          ['Factor', num(f)],
        ]),
      ],
      diagnostics,
      input,
      {
        name: `${capital(params.to)} elapsed`,
        tableKind: 'survival',
        rowCount: R,
        rowTitles: input[0]?.rowTitles ?? null,
        x: {
          title:
            /elapsed/i.test(x.title) || x.title === 'X' ? `${capital(params.to)} elapsed` : x.title,
          values: Float64Array.from(
            x.values,
            (v) => (v * TIME_UNITS[params.from]) / TIME_UNITS[params.to],
          ),
        },
        dataSets: out,
      },
    )
  },
}
