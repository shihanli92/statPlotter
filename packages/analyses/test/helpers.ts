import {
  type AnalysisDef,
  type AnalysisResult,
  createTable,
  DataTable,
  normalizeTable,
  type ResultBlock,
  type ResultValue,
  type RunContext,
  type SummaryPreset,
  type TableKind,
  type YFormat,
} from '@ps/model'
import { expect } from 'vitest'
import { expectClose } from '../../stats/test/oracle.ts'

/** Runs a plugin on a table with params parsed from `params` (defaults for the rest). */
export function runDef<P>(
  def: AnalysisDef<P>,
  t: DataTable,
  params: unknown = {},
  ctx?: RunContext,
): AnalysisResult {
  return def.run(normalizeTable(t), def.params.parse(params), ctx)
}

/** runDef with the context the engine passes: the table's kind and X title. */
export function runWithContext<P>(def: AnalysisDef<P>, t: DataTable, params: unknown = {}) {
  return runDef(def, t, params, { tableKind: t.tableKind, xTitle: t.x?.title ?? null })
}

/** Grouped table: cells[row][col] = replicate values (null = empty). */
export function groupedTable(cells: (number | null)[][][], rowTitles?: string[]): DataTable {
  const reps = Math.max(...cells.flat().map((c) => c.length))
  const t = createTable({
    tableKind: 'grouped',
    yFormat: { type: 'replicates', count: reps },
    columns: cells[0]!.length,
    rows: cells.length,
  })
  cells.forEach((row, r) => {
    row.forEach((vals, c) => {
      t.dataSets[c]!.subcolumns.forEach((sub, j) => {
        sub.values[r] = vals[j] ?? null
      })
    })
  })
  if (rowTitles) t.rowTitles = rowTitles
  return t
}

/**
 * Column (or multiple-variables) table from columns of values (null = empty); `excluded` lists
 * the [column, row] cells to mark excluded.
 */
export function columnTable(
  cols: (number | null)[][],
  opts: { kind?: 'column' | 'multipleVariables'; excluded?: [col: number, row: number][] } = {},
): DataTable {
  const rows = Math.max(...cols.map((c) => c.length))
  const t = createTable({ tableKind: opts.kind ?? 'column', columns: cols.length, rows })
  cols.forEach((vals, i) => {
    t.dataSets[i]!.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) => vals[r] ?? null)
  })
  for (const [c, r] of opts.excluded ?? []) {
    const col = t.dataSets[c]!.subcolumns[0]!
    col.excluded ??= Array.from({ length: rows }, () => false)
    col.excluded[r] = true
  }
  return t
}

/** Column table of summary data: cols[i] holds the preset's values (e.g. mean, SD, N). */
export function summaryTable(preset: SummaryPreset, cols: number[][]): DataTable {
  const t = createTable({ columns: cols.length, yFormat: { type: 'summary', preset } })
  cols.forEach((vals, i) => {
    vals.forEach((x, j) => {
      t.dataSets[i]!.subcolumns[j]!.values = [x]
    })
  })
  return t
}

export function block(r: AnalysisResult, sheet: string, index = 0): ResultBlock {
  const s = r.sheets.find((x) => x.key === sheet)
  if (!s) throw new Error(`no sheet ${sheet}: ${r.diagnostics.map((d) => d.message).join('; ')}`)
  return s.blocks[index]!
}

export function tableBlock(r: AnalysisResult, sheet: string, index = 0) {
  const b = block(r, sheet, index)
  if (b.type !== 'table') throw new Error('not a table')
  return b
}

/** The value in column `col` of a table block's row `row`. */
export function cellOf(
  b: { columns: string[]; rows: ResultValue[][] },
  row: number,
  col: string,
): ResultValue {
  const j = b.columns.indexOf(col)
  if (j < 0) throw new Error(`no column ${col} in ${b.columns.join(', ')}`)
  return b.rows[row]![j]!
}

function titled(b: ResultBlock, title: string | RegExp | undefined): boolean {
  if (title === undefined) return true
  const t = 'title' in b ? b.title : undefined
  return typeof title === 'string' ? t === title : title.test(t ?? '')
}

/** The value of row `label` in the first keyValue block (titled `title`, if given) that has one. */
export function kvOf(r: AnalysisResult, label: string, title?: string): ResultValue {
  for (const s of r.sheets)
    for (const b of s.blocks)
      if (b.type === 'keyValue' && titled(b, title)) {
        const row = b.rows.find((x) => x.label === label)
        if (row) return row.value
      }
  throw new Error(title === undefined ? `no ${label}` : `no ${title} / ${label}`)
}

/**
 * The cells after the label of row `label` in the first table block that has one; with `title`,
 * only blocks with that title (a RegExp: a matching title).
 */
export function rowOf(r: AnalysisResult, label: string, title?: string | RegExp): ResultValue[] {
  for (const s of r.sheets)
    for (const b of s.blocks)
      if (b.type === 'table' && titled(b, title)) {
        const row = b.rows.find((x) => (x[0] as { v: unknown }).v === label)
        if (row) return row.slice(1)
      }
  throw new Error(title === undefined ? `no row ${label}` : `no ${title} / ${label}`)
}

/**
 * A value by label: a keyValue row's value, or the cells after the label of a table row, from
 * the first block (titled `title`, if given) that has it.
 */
export function find(r: AnalysisResult, label: string, title?: string | RegExp): ResultValue[] {
  for (const s of r.sheets)
    for (const b of s.blocks) {
      if (!titled(b, title)) continue
      if (b.type === 'keyValue') {
        const row = b.rows.find((x) => x.label === label)
        if (row) return [row.value]
      }
      if (b.type === 'table') {
        const row = b.rows.find((x) => (x[0] as { v: unknown }).v === label)
        if (row) return row.slice(1)
      }
    }
  throw new Error(title === undefined ? `no row "${label}"` : `no ${title} / ${label}`)
}

export const v = (x: ResultValue | undefined) => (x as { v: number }).v

/** A table of counts: rows[r][c] (null = empty), with row titles. */
export function countsTable(
  kind: TableKind,
  rows: (number | null)[][],
  rowTitles?: string[],
): DataTable {
  const t = createTable({ tableKind: kind, columns: rows[0]!.length, rows: rows.length })
  rows.forEach((row, r) => {
    row.forEach((x, c) => {
      t.dataSets[c]!.subcolumns[0]!.values[r] = x
    })
  })
  if (rowTitles) t.rowTitles = rowTitles
  return t
}

/** XY table: one X column and data sets of single Y values (null = empty). */
export function xyTable(
  x: (number | null)[],
  ys: (number | null)[][],
  titles?: string[],
): DataTable {
  const t = createTable({ tableKind: 'xy', columns: ys.length, rows: x.length })
  t.x!.subcolumns[0]!.values = x
  ys.forEach((vals, i) => {
    t.dataSets[i]!.subcolumns[0]!.values = Array.from(
      { length: x.length },
      (_, r) => vals[r] ?? null,
    )
    if (titles?.[i]) t.dataSets[i]!.title = titles[i]!
  })
  return t
}

/** XY table with replicate subcolumns: ys[set][replicate][row] (null = empty). */
export function xyReplicatesTable(
  xs: (number | null)[],
  ys: (number | null)[][][],
  titles?: string[],
): DataTable {
  const t = createTable({
    tableKind: 'xy',
    yFormat: { type: 'replicates', count: ys[0]!.length },
    columns: ys.length,
    rows: xs.length,
  })
  t.x!.subcolumns[0]!.values = xs
  ys.forEach((set, i) => {
    set.forEach((rep, j) => {
      t.dataSets[i]!.subcolumns[j]!.values = rep
    })
    if (titles) t.dataSets[i]!.title = titles[i]!
  })
  return t
}

/** A multiple-variables table from named columns (null = missing). */
export function mvTable(cols: Record<string, (number | null)[]>): DataTable {
  const names = Object.keys(cols)
  const rows = Math.max(...names.map((n) => cols[n]!.length))
  const t = createTable({ tableKind: 'multipleVariables', columns: names.length, rows })
  names.forEach((n, i) => {
    t.dataSets[i]!.title = n
    t.dataSets[i]!.subcolumns[0]!.values = Array.from(
      { length: rows },
      (_, r) => cols[n]![r] ?? null,
    )
  })
  return t
}

// ---- tables of any kind, and result tables --------------------------------------------------

/** A cell as the oracle writes it: a number, or a string / null for a missing value. */
export type Cell = number | string | null
export const num = (x: Cell | undefined): number => (typeof x === 'number' ? x : Number.NaN)

/** A table of one kind from data sets given as rows × replicates (null = empty). */
export function makeTable(
  kind: TableKind,
  dataSets: Cell[][][],
  x?: Cell[] | null,
  yFormat?: YFormat,
): DataTable {
  const rows = Math.max(...dataSets.map((d) => d.length))
  const reps = Math.max(...dataSets.flatMap((d) => d.map((r) => r.length)))
  const t = createTable({
    tableKind: kind,
    yFormat: yFormat ?? { type: 'replicates', count: reps },
    columns: dataSets.length,
    rows,
  })
  dataSets.forEach((d, i) => {
    t.dataSets[i]!.subcolumns.forEach((sub, j) => {
      sub.values = Array.from({ length: rows }, (_, r) => {
        const c = d[r]?.[j]
        return typeof c === 'number' ? c : null
      })
    })
  })
  if (x && t.x) t.x.subcolumns[0]!.values = x.map((c) => (typeof c === 'number' ? c : null))
  return t
}

/** The result table, validated against the document schema. */
export function outTable(r: AnalysisResult): DataTable {
  if (!r.table) throw new Error(r.diagnostics.map((d) => d.message).join('; ') || 'no table')
  const parsed = DataTable.safeParse(r.table)
  expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true)
  return r.table
}

/** Data set i of a result table as rows × subcolumns (NaN = empty). */
export const matrixOf = (t: DataTable, i: number) =>
  Array.from({ length: t.rowCount }, (_, r) =>
    t.dataSets[i]!.subcolumns.map((c) => c.values[r] ?? Number.NaN),
  )

export function expectMatrix(
  got: number[][],
  want: Cell[][],
  tol: object | undefined,
  label: string,
) {
  expect(got.length, `${label} rows`).toBe(want.length)
  want.forEach((row, r) => {
    row.forEach((w, c) => {
      expectClose(got[r]![c]!, num(w), tol, `${label}[${r}][${c}]`)
    })
  })
}

// ---------------------------------------------------------------------------------------------
