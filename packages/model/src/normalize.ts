import { type FormulaValues, tableFormulas } from './formula.ts'
import type { ColumnId, DataSetRef } from './ids.ts'
import type { CellColumn, DataSetColumn, DataTable, SummaryPreset } from './table.ts'
import { SUMMARY_PRESETS } from './table.ts'

/**
 * The read-only view analyses and graph plotting consume. Built from a table column; never
 * stored. In every array, NaN means "no usable value" (empty, excluded, or not derivable).
 */
export interface NormalizedDataSet {
  ref: DataSetRef
  title: string
  rowCount: number
  rowTitles: readonly (string | null)[] | null
  x: Float64Array | null
  data: ReplicateData | SummaryData
  /** Cells that were empty or excluded (excluded counts only non-empty cells). */
  counts: { empty: number; excluded: number }
  /**
   * Multiple-variables tables: a text (categorical) variable's values by row (its numeric data are
   * all NaN). Absent for numeric variables.
   */
  text?: readonly (string | null)[]
  /** A calculated variable's formula (its numeric data are the evaluated values). */
  formula?: string
}

export interface ReplicateData {
  shape: 'replicates'
  /** One array per replicate subcolumn, each of length rowCount. */
  reps: Float64Array[]
}

/** All summary presets normalized to one shape. Values that can't be derived are NaN. */
export interface SummaryData {
  shape: 'summary'
  mean: Float64Array
  sd: Float64Array
  sem: Float64Array
  n: Float64Array
  /** Absolute error bounds, present only for asymmetric presets (±error, upper/lower). */
  lo?: Float64Array
  hi?: Float64Array
  /**
   * The preset the values were entered as (absent: unknown, e.g. data made by an analysis): which
   * of SD and SEM was entered and which derived (audit 2: Filter rows keeps the entered one).
   */
  preset?: SummaryPreset
}

interface Counts {
  empty: number
  excluded: number
}

function toFloat(col: CellColumn, counts: Counts): Float64Array {
  const out = new Float64Array(col.values.length)
  for (let i = 0; i < out.length; i++) {
    const v = col.values[i]
    if (v === null || v === undefined) {
      out[i] = Number.NaN
      counts.empty++
    } else if (col.excluded?.[i]) {
      out[i] = Number.NaN
      counts.excluded++
    } else {
      out[i] = v
    }
  }
  return out
}

function map(n: number, f: (i: number) => number): Float64Array {
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = f(i)
  return out
}

const nanArray = (n: number) => new Float64Array(n).fill(Number.NaN)

function summarize(table: DataTable, ds: DataSetColumn, counts: Counts): SummaryData {
  if (table.yFormat.type !== 'summary') throw new Error('unreachable')
  const roles = SUMMARY_PRESETS[table.yFormat.preset]
  const cols: Partial<Record<(typeof roles)[number], Float64Array>> = {}
  roles.forEach((role, i) => {
    cols[role] = toFloat(ds.subcolumns[i]!, counts)
  })

  const rows = table.rowCount
  const mean = cols.mean!
  const n = cols.n ?? nanArray(rows)
  let sd: Float64Array
  let sem: Float64Array

  if (cols.sd) {
    sd = cols.sd
    sem = map(rows, (i) => sd[i]! / Math.sqrt(n[i]!))
  } else if (cols.sem) {
    sem = cols.sem
    sd = map(rows, (i) => sem[i]! * Math.sqrt(n[i]!))
  } else if (cols.cv) {
    // CV is stored as a fraction (UI accepts percent).
    const cv = cols.cv
    sd = map(rows, (i) => Math.abs(cv[i]! * mean[i]!))
    sem = map(rows, (i) => sd[i]! / Math.sqrt(n[i]!))
  } else {
    sd = nanArray(rows)
    sem = nanArray(rows)
  }

  const out: SummaryData = { shape: 'summary', mean, sd, sem, n, preset: table.yFormat.preset }
  if (cols.plusErr && cols.minusErr) {
    const plus = cols.plusErr
    const minus = cols.minusErr
    out.lo = map(rows, (i) => mean[i]! - minus[i]!)
    out.hi = map(rows, (i) => mean[i]! + plus[i]!)
  } else if (cols.upper && cols.lower) {
    out.lo = cols.lower
    out.hi = cols.upper
  }
  return out
}

interface CacheEntry {
  table: Pick<DataTable, 'id' | 'yFormat' | 'x' | 'rowTitles' | 'rowCount'>
  /** A calculated variable's values the result was built from (they depend on other columns). */
  formula?: FormulaValues
  result: NormalizedDataSet
}

/**
 * Keyed by column object. Immer structural sharing keeps untouched columns identical across
 * edits, so this cache survives edits to other columns. Table-level inputs are identity-checked.
 */
const cache = new WeakMap<DataSetColumn, CacheEntry>()

export function normalizeDataSet(table: DataTable, ds: DataSetColumn): NormalizedDataSet {
  const hit = cache.get(ds)
  // A calculated variable's values come from the other variables (memoized while they are
  // unchanged, so the cached view survives unrelated edits).
  const formula = ds.formula !== undefined ? tableFormulas(table).get(ds.id) : undefined
  if (
    hit &&
    hit.formula === formula &&
    hit.table.id === table.id &&
    hit.table.yFormat === table.yFormat &&
    hit.table.x === table.x &&
    hit.table.rowTitles === table.rowTitles &&
    hit.table.rowCount === table.rowCount
  ) {
    return hit.result
  }

  const counts: Counts = { empty: 0, excluded: 0 }
  let data: ReplicateData | SummaryData =
    table.yFormat.type === 'replicates'
      ? { shape: 'replicates', reps: ds.subcolumns.map((c) => toFloat(c, counts)) }
      : summarize(table, ds, counts)
  // A calculated variable giving text (roadmap 38) is a text variable to analyses.
  const text = ds.text ?? formula?.text
  if (formula?.text) {
    data = { shape: 'replicates', reps: [formula.values] }
    counts.empty = formula.text.reduce((n, t) => n + (t === null ? 1 : 0), 0)
    counts.excluded = 0
  } else if (formula) {
    // The evaluated values; rows without one count as empty.
    data = { shape: 'replicates', reps: [formula.values] }
    counts.empty = formula.values.reduce((n, v) => n + (Number.isNaN(v) ? 1 : 0), 0)
    counts.excluded = 0
  } else if (ds.text) {
    counts.empty = ds.text.reduce((n, t) => n + (t === null || t.trim() === '' ? 1 : 0), 0)
    counts.excluded = 0
  }

  // X exclusions/empties don't count toward the data set's counts.
  const x = table.x?.subcolumns[0]
    ? toFloat(table.x.subcolumns[0], { empty: 0, excluded: 0 })
    : null

  const result: NormalizedDataSet = {
    ref: { node: table.id, key: ds.id },
    title: ds.title,
    rowCount: table.rowCount,
    rowTitles: table.rowTitles,
    x,
    data,
    counts,
    // Text variables pass their values through; calculated variables carry their formula (their
    // numeric data are its values, `tableFormulas`).
    ...(text ? { text } : {}),
    ...(ds.formula !== undefined ? { formula: ds.formula } : {}),
  }
  cache.set(ds, {
    ...(formula ? { formula } : {}),
    table: {
      id: table.id,
      yFormat: table.yFormat,
      x: table.x,
      rowTitles: table.rowTitles,
      rowCount: table.rowCount,
    },
    result,
  })
  return result
}

export function normalizeColumn(table: DataTable, id: ColumnId | string): NormalizedDataSet | null {
  const ds = table.dataSets.find((d) => d.id === id)
  return ds ? normalizeDataSet(table, ds) : null
}

export function normalizeTable(table: DataTable): NormalizedDataSet[] {
  return table.dataSets.map((ds) => normalizeDataSet(table, ds))
}

// ---------------------------------------------------------------------------------------------
// Helpers for analyses
// ---------------------------------------------------------------------------------------------

/** Drops NaN entries. */
export function finiteValues(arr: Float64Array): Float64Array {
  let n = 0
  for (let i = 0; i < arr.length; i++) if (!Number.isNaN(arr[i]!)) n++
  const out = new Float64Array(n)
  let j = 0
  for (let i = 0; i < arr.length; i++) if (!Number.isNaN(arr[i]!)) out[j++] = arr[i]!
  return out
}

/** Pairs values by row, dropping any row where either side is missing. */
export function pairedRows(
  a: Float64Array,
  b: Float64Array,
): { a: Float64Array; b: Float64Array; rows: number[] } {
  const rows: number[] = []
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) if (!Number.isNaN(a[i]!) && !Number.isNaN(b[i]!)) rows.push(i)
  return {
    a: Float64Array.from(rows, (i) => a[i]!),
    b: Float64Array.from(rows, (i) => b[i]!),
    rows,
  }
}

export interface SurvivalData {
  /** One entry per subject: time from X, event true for the event code, false for censored. */
  subjects: { time: number; event: boolean; row: number }[]
  /** Rows with a Y code but no usable time (empty, excluded, or negative X). */
  missingTime: number
  /** Rows whose Y value is neither the event nor the censored code. */
  invalidCode: number
}

/**
 * Survival tables: X is the elapsed time and each data set is a group; a subject is a row with a
 * code in that group's column (by default 1 = event, 0 = censored).
 */
export function survivalData(
  ds: NormalizedDataSet,
  codes: { event: number; censored: number } = { event: 1, censored: 0 },
): SurvivalData {
  const out: SurvivalData = { subjects: [], missingTime: 0, invalidCode: 0 }
  if (ds.data.shape !== 'replicates' || !ds.x) return out
  const y = ds.data.reps[0]!
  for (let row = 0; row < ds.rowCount; row++) {
    const code = y[row]!
    if (Number.isNaN(code)) continue
    const time = ds.x[row]!
    if (Number.isNaN(time) || time < 0) out.missingTime++
    else if (code === codes.event) out.subjects.push({ time, event: true, row })
    else if (code === codes.censored) out.subjects.push({ time, event: false, row })
    else out.invalidCode++
  }
  return out
}

/** A data set's one value per row: its first replicate, or the entered mean. */
export const primaryValues = (ds: NormalizedDataSet): Float64Array =>
  ds.data.shape === 'replicates' ? ds.data.reps[0]! : ds.data.mean

/**
 * Contingency tables: rows are groups, data sets are outcomes. Returns the counts of every row
 * that has at least one value (as a rows × data sets matrix), with those rows' indices and the
 * rows that are only partly filled in.
 */
export function contingencyCounts(input: readonly NormalizedDataSet[]): {
  counts: number[][]
  rows: number[]
  incompleteRows: number[]
} {
  const rowCount = Math.max(0, ...input.map((d) => d.rowCount))
  const counts: number[][] = []
  const rows: number[] = []
  const incompleteRows: number[] = []
  for (let r = 0; r < rowCount; r++) {
    const vals = input.map((d) => primaryValues(d)[r] ?? Number.NaN)
    const filled = vals.filter((v) => !Number.isNaN(v)).length
    if (filled === 0) continue
    if (filled < vals.length) incompleteRows.push(r)
    else {
      counts.push(vals)
      rows.push(r)
    }
  }
  return { counts, rows, incompleteRows }
}
