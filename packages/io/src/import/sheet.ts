import {
  type CellColumn,
  columnLetters,
  type DataSetColumn,
  type DataTable,
  defaultColumnTitle,
  newColumnId,
  type XColumn,
} from '@ps/model'
import { type Area, accountFor, CellUse, type ImportAccount } from './account.ts'
import { cellTitle, readNumberCell } from './cells.ts'
import { ImportError } from './errors.ts'
import { finishTable, nonNumericWarning } from './finish.ts'
import type { BlockLayout } from './layout.ts'
import { rowKey, type StackedPart } from './stacked.ts'
import { variablesToTable } from './variables.ts'

export type SheetCell = number | string | boolean | null

/** A rectangular grid of cells read from a spreadsheet or delimited text file. */
export interface Sheet {
  name: string
  /** Every row has the same length (padded with null). */
  rows: SheetCell[][]
  /**
   * Number of date-formatted cells; their values are kept as spreadsheet serial numbers. Callers
   * show this themselves (`sheetToTable` doesn't repeat it as a warning).
   */
  dateCells?: number
  /**
   * Date cells whose format shows them as a plain number ("27.9" for 27 September under "d.m",
   * usually a number Excel turned into a date); they read as the number shown.
   */
  datesAsNumbers?: number
}

export type ImportTableKind =
  | 'column'
  | 'xy'
  | 'grouped'
  | 'contingency'
  | 'survival'
  | 'multipleVariables'

export interface SheetImportOptions {
  name: string
  tableKind: ImportTableKind
  /** The first row holds data set titles. */
  headerRow: boolean
  /** 'x' is required for XY and survival tables and not allowed otherwise. */
  firstColumn: 'data' | 'x' | 'rowTitles'
  /** XY and grouped tables: consecutive columns per data set (default 1). */
  replicates?: number
  /** Inclusive, 0-based. Defaults to the whole sheet minus trailing empty rows and columns. */
  range?: { r0: number; c0: number; r1: number; c1: number }
  /**
   * Grouped tables only: one sub-table per data set (row titles in the first column, values to
   * the right), rows matched by title. Replaces `range`, `headerRow` and `firstColumn`.
   */
  parts?: StackedPart[]
  /**
   * The structure detected for the block (`findBlocks`). Used when `tableKind` is the kind it
   * suggests; any other settings import the plain `range`.
   */
  layout?: BlockLayout
  /**
   * The part of the sheet the table comes from (`SheetBlock.area`); numbers in it that the table
   * doesn't use are listed in `account`. Defaults to the range read.
   */
  area?: Area
  /**
   * Multiple-variables tables (roadmap 34e): per sheet column, false leaves it out (a column of
   * cell ids). Absent: every column.
   */
  include?: readonly boolean[]
}

export interface SheetImportResult {
  table: DataTable
  warnings: string[]
  /** Where the numbers of the source went (see `accountFor`). */
  account?: ImportAccount
}

export function padRows(rows: SheetCell[][]): SheetCell[][] {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  for (const r of rows) while (r.length < width) r.push(null)
  return rows
}

/** Many data sets holding one value each usually means replicates were read the wrong way. */
function singleValueWarning(dataSets: DataSetColumn[]): string | null {
  if (dataSets.length < 8) return null
  const count = (d: DataSetColumn) =>
    d.subcolumns.reduce(
      (n, c) => n + (c.type === 'number' ? c.values.filter((v) => v !== null).length : 0),
      0,
    )
  const single = dataSets.filter((d) => count(d) <= 1).length
  return single >= dataSets.length * 0.8
    ? `${single} of ${dataSets.length} data sets hold a single value: the replicates may be laid out differently (check the table type and replicate columns).`
    : null
}

const isEmptyRow = (row: readonly SheetCell[], c0: number, c1: number) => {
  for (let c = c0; c <= c1; c++) if (row[c] !== null && row[c] !== undefined) return false
  return true
}

/**
 * Turns a block of a sheet into a data table of the given kind. Data cells that aren't numbers
 * become empty cells, reported (with a count and the first offending cell) in `warnings`.
 * Throws ImportError when the options don't fit the table kind or the block holds no data.
 */
export function sheetToTable(sheet: Sheet, opts: SheetImportOptions): SheetImportResult {
  if (opts.tableKind === 'multipleVariables') return variablesToTable(sheet, opts)
  if (opts.parts?.length && opts.tableKind === 'grouped') return stackedToTable(sheet, opts)
  if (opts.layout && opts.layout.kind === opts.tableKind) return layoutToTable(sheet, opts)
  const warnings: string[] = []
  const { tableKind } = opts
  const needsX = tableKind === 'xy' || tableKind === 'survival'
  if (needsX && opts.firstColumn !== 'x') {
    throw new ImportError(`${kindLabel(tableKind)} tables need the first column as X.`)
  }
  if (!needsX && opts.firstColumn === 'x') {
    throw new ImportError(`${kindLabel(tableKind)} tables have no X column.`)
  }
  const replicates = opts.replicates ?? 1
  if (!Number.isInteger(replicates) || replicates < 1) {
    throw new ImportError('Replicates must be a whole number of at least 1.')
  }
  if (replicates > 1 && tableKind !== 'xy' && tableKind !== 'grouped') {
    throw new ImportError('Side-by-side replicates are only available for XY and grouped tables.')
  }

  // Resolve the block.
  const height = sheet.rows.length
  const width = sheet.rows[0]?.length ?? 0
  let { r0, c0, r1, c1 } = opts.range ?? { r0: 0, c0: 0, r1: height - 1, c1: width - 1 }
  r0 = Math.max(0, r0)
  c0 = Math.max(0, c0)
  r1 = Math.min(height - 1, r1)
  c1 = Math.min(width - 1, c1)
  if (!opts.range) {
    while (r1 >= r0 && isEmptyRow(sheet.rows[r1]!, c0, c1)) r1--
    while (c1 >= c0 && sheet.rows.slice(r0, r1 + 1).every((r) => r[c1] === null)) c1--
  }
  if (r1 < r0 || c1 < c0) throw new ImportError('The selected range is empty.')

  const use = new CellUse(sheet)
  const header = opts.headerRow ? sheet.rows[r0]! : null
  if (header) for (let c = c0; c <= c1; c++) use.label(r0, c)
  const dataR0 = opts.headerRow ? r0 + 1 : r0
  // Trailing empty rows below the header carry no data.
  let dataR1 = r1
  while (dataR1 >= dataR0 && isEmptyRow(sheet.rows[dataR1]!, c0, c1)) dataR1--
  const rowCount = Math.max(0, dataR1 - dataR0 + 1)

  const dataC0 = opts.firstColumn === 'data' ? c0 : c0 + 1
  const dataColumns = c1 - dataC0 + 1
  if (dataColumns < 1) throw new ImportError('The selected range has no data columns.')

  let nonNumeric = 0
  let firstBad = ''
  const numberColumn = (c: number): CellColumn => {
    const values: (number | null)[] = []
    for (let r = dataR0; r < dataR0 + rowCount; r++) {
      const cell = sheet.rows[r]![c] ?? null
      use.value(r, c)
      values.push(
        readNumberCell(cell, () => {
          nonNumeric++
          const shown =
            typeof cell === 'string'
              ? `"${cell.length > 20 ? `${cell.slice(0, 20)}…` : cell}"`
              : cell
                ? 'TRUE'
                : 'FALSE'
          firstBad ||= `${shown} in ${columnLetters(c)}${r + 1}`
        }),
      )
    }
    return { type: 'number', values }
  }

  let x: XColumn | null = null
  let rowTitles: (string | null)[] | null = null
  if (opts.firstColumn === 'x') {
    x = {
      title: cellTitle(header?.[c0]) ?? (tableKind === 'survival' ? 'Days elapsed' : 'X'),
      xFormat: 'numbers',
      subcolumns: [numberColumn(c0)],
    }
  } else if (opts.firstColumn === 'rowTitles') {
    rowTitles = []
    for (let r = dataR0; r < dataR0 + rowCount; r++) {
      rowTitles.push(cellTitle(sheet.rows[r]![c0]))
      use.label(r, c0)
    }
  }

  // Data sets are `replicates` columns wide. When a header's titles don't sit on those
  // boundaries but each title starts a data set of at most `replicates` columns (the blank header
  // cells after it being its other replicates), the titles place the data sets instead; narrower
  // ones get empty replicates.
  let firsts: number[] = []
  if (header && replicates > 1) {
    const titled = (c: number) => cellTitle(header[c]) !== null
    let aligned = true
    for (let c = dataC0; c <= c1; c += replicates) if (!titled(c)) aligned = false
    if (!aligned) {
      for (let c = dataC0; c <= c1; c++) if (titled(c)) firsts.push(c)
      const fits =
        firsts[0] === dataC0 && firsts.every((c, i) => (firsts[i + 1] ?? c1 + 1) - c <= replicates)
      if (!fits) firsts = []
    }
  }
  if (!firsts.length) {
    for (let c = dataC0; c <= c1; c += replicates) firsts.push(c)
    // A titled last data set that is narrower is expected (trailing empty columns are trimmed).
    const titledLast = header && cellTitle(header[firsts[firsts.length - 1]!]) !== null
    if (dataColumns % replicates !== 0 && !titledLast) {
      warnings.push(
        `${dataColumns} data columns don't divide into data sets of ${replicates} replicates; ` +
          'the last data set has empty replicate columns.',
      )
    }
  }
  const dataSets: DataSetColumn[] = []
  for (let s = 0; s < firsts.length; s++) {
    const first = firsts[s]!
    const end = (firsts[s + 1] ?? c1 + 1) - 1
    const subcolumns: CellColumn[] = []
    for (let k = 0; k < replicates; k++) {
      const c = first + k
      subcolumns.push(
        c <= end
          ? numberColumn(c)
          : { type: 'number', values: Array.from({ length: rowCount }, () => null) },
      )
    }
    dataSets.push({
      id: newColumnId(),
      title: cellTitle(header?.[first]) ?? defaultColumnTitle(s),
      subcolumns,
    })
  }

  if (nonNumeric > 0) warnings.push(nonNumericWarning(nonNumeric, firstBad))
  const single = singleValueWarning(dataSets)
  if (single) warnings.push(single)
  const table = finishTable({
    name: opts.name,
    tableKind,
    yFormat: { type: 'replicates', count: replicates },
    rowCount,
    rowTitles,
    x,
    dataSets,
  })
  const account = accountFor(sheet, opts.area ?? { r0, c0, r1, c1 }, use)
  return { table, warnings, account }
}

const KIND_LABELS: Record<ImportTableKind, string> = {
  column: 'Column',
  xy: 'XY',
  grouped: 'Grouped',
  contingency: 'Contingency',
  survival: 'Survival',
  multipleVariables: 'Multiple variables',
}
const kindLabel = (kind: ImportTableKind) => KIND_LABELS[kind]

/** A grouped table from per-data-set sub-tables (`SheetImportOptions.parts`). */
function stackedToTable(sheet: Sheet, opts: SheetImportOptions): SheetImportResult {
  const parts = opts.parts!
  const warnings: string[] = []
  const use = new CellUse(sheet)
  const replicates = Math.max(1, opts.replicates ?? 1, ...parts.map((p) => p.range.c1 - p.range.c0))
  // Rows in first-seen order, matched across parts by title without case or spaces.
  const rowTitles: string[] = []
  const rowOf = new Map<string, number>()
  for (const p of parts)
    for (let r = p.range.r0; r <= p.range.r1; r++) {
      const title = String(sheet.rows[r]![p.range.c0]).trim()
      if (!rowOf.has(rowKey(title))) {
        rowOf.set(rowKey(title), rowTitles.length)
        rowTitles.push(title)
      }
    }
  let nonNumeric = 0
  const dataSets: DataSetColumn[] = parts.map((p, s) => {
    const subcolumns: CellColumn[] = Array.from({ length: replicates }, () => ({
      type: 'number' as const,
      values: rowTitles.map(() => null as number | null),
    }))
    for (let r = p.range.r0; r <= p.range.r1; r++) {
      const row = rowOf.get(rowKey(String(sheet.rows[r]![p.range.c0]).trim()))!
      use.label(r, p.range.c0)
      for (let k = 0; k < replicates; k++) {
        const cell = sheet.rows[r]![p.range.c0 + 1 + k] ?? null
        if (p.range.c0 + 1 + k <= p.range.c1) use.value(r, p.range.c0 + 1 + k)
        const v = readNumberCell(cell, () => nonNumeric++)
        const col = subcolumns[k]!
        if (col.type === 'number' && v !== null) col.values[row] = v
      }
    }
    return { id: newColumnId(), title: p.title ?? defaultColumnTitle(s), subcolumns }
  })
  if (nonNumeric > 0) warnings.push(nonNumericWarning(nonNumeric))
  const table = finishTable({
    name: opts.name,
    tableKind: 'grouped',
    yFormat: { type: 'replicates', count: replicates },
    rowCount: rowTitles.length,
    rowTitles,
    x: null,
    dataSets,
  })
  const span = parts.reduce(
    (a, p) => ({
      r0: Math.min(a.r0, p.range.r0),
      c0: Math.min(a.c0, p.range.c0),
      r1: Math.max(a.r1, p.range.r1),
      c1: Math.max(a.c1, p.range.c1),
    }),
    { ...parts[0]!.range },
  )
  return { table, warnings, account: accountFor(sheet, opts.area ?? span, use) }
}

/** Distinct data set titles: a repeated title gets " (2)", " (3)"… */
function uniqueTitles(titles: string[]): string[] {
  const seen = new Map<string, number>()
  return titles.map((t) => {
    const n = (seen.get(t) ?? 0) + 1
    seen.set(t, n)
    return n === 1 ? t : `${t} (${n})`
  })
}

/** A table from a detected block layout (`SheetImportOptions.layout`). */
function layoutToTable(sheet: Sheet, opts: SheetImportOptions): SheetImportResult {
  const L = opts.layout!
  const R = sheet.rows
  const warnings: string[] = []
  const use = new CellUse(sheet)
  // Everything above the values is title and header lines.
  const top = opts.area?.r0 ?? L.rows[0]!
  const width = R[0]?.length ?? 0
  for (let r = top; r < L.rows[0]!; r++) for (let c = 0; c < width; c++) use.label(r, c)
  let nonNumeric = 0
  const at = (r: number, c: number) => {
    use.value(r, c)
    return num(R[r]![c])
  }
  // Blank text is an empty cell here, not a non-numeric one.
  const num = (cell: SheetCell | undefined): number | null =>
    typeof cell === 'string' && cell.trim() === '' ? null : readNumberCell(cell, () => nonNumeric++)
  const titles = uniqueTitles(L.sets.map((st, i) => cellTitle(st.title) ?? defaultColumnTitle(i)))
  let kind = L.kind
  let rowCount: number
  let rowTitles: (string | null)[] | null = null
  let x: XColumn | null = null
  let replicates = 1
  let columns: (number | null)[][][] // [set][replicate][row]

  if (L.orient === 'flat' || L.orient === 'rows') {
    const vals = L.sets.map((st) => {
      const r = L.orient === 'rows' ? st.row! : L.rows[0]!
      return st.cols.map((c) => at(r, c)).filter((v): v is number => v !== null)
    })
    rowCount = Math.max(1, ...vals.map((v) => v.length))
    columns = vals.map((v) => [Array.from({ length: rowCount }, (_, i) => v[i] ?? null)])
    kind = 'column'
  } else if (L.orient === 'pairs') {
    const xs: (number | null)[] = []
    const owner: number[] = []
    const codes: (number | null)[] = []
    L.sets.forEach((st, i) => {
      for (const r of L.rows) {
        const t = at(r, st.xCol!)
        if (t === null) continue
        xs.push(t)
        owner.push(i)
        codes.push(at(r, st.cols[0]!))
      }
    })
    rowCount = xs.length
    x = {
      title: cellTitle(L.xTitle) ?? 'Days elapsed',
      xFormat: 'numbers',
      subcolumns: [{ type: 'number', values: xs }],
    }
    columns = L.sets.map((_, i) => [codes.map((c, k) => (owner[k] === i ? c : null))])
  } else {
    rowCount = L.rows.length
    const widest = Math.max(1, ...L.sets.map((st) => st.cols.length))
    if (kind === 'column' && widest > 1) kind = 'grouped'
    replicates = kind === 'grouped' || kind === 'xy' ? widest : 1
    if (L.labelCol !== null) {
      const lc = L.labelCol
      const labels = L.rows.map((r) => R[r]![lc])
      const asX = kind === 'xy' || kind === 'survival'
      for (const r of L.rows)
        if (asX) use.value(r, lc)
        else use.label(r, lc)
      if (asX) {
        x = {
          title: cellTitle(L.xTitle) ?? (kind === 'survival' ? 'Days elapsed' : 'X'),
          xFormat: 'numbers',
          subcolumns: [{ type: 'number', values: labels.map((v) => num(v)) }],
        }
      } else rowTitles = labels.map((v) => cellTitle(v))
    }
    columns = L.sets.map((st) =>
      Array.from({ length: replicates }, (_, k) => {
        const c = st.cols[k]
        return L.rows.map((r) => (c === undefined ? null : at(r, c)))
      }),
    )
  }
  if (nonNumeric > 0) warnings.push(nonNumericWarning(nonNumeric))
  const dataSets: DataSetColumn[] = columns.map((subs, i) => ({
    id: newColumnId(),
    title: titles[i]!,
    subcolumns: subs.map((values) => ({ type: 'number' as const, values })),
  }))
  const table = finishTable({
    name: opts.name,
    tableKind: kind,
    yFormat: { type: 'replicates', count: replicates },
    rowCount,
    rowTitles,
    x,
    dataSets,
  })
  const cols = L.sets.flatMap((st) => [...st.cols, ...(st.xCol === undefined ? [] : [st.xCol])])
  if (L.labelCol !== null) cols.push(L.labelCol)
  // Reduces, not spreads: a sheet can have more rows than a call takes arguments.
  const span = {
    r0: top,
    c0: cols.reduce((m, c) => Math.min(m, c), Number.POSITIVE_INFINITY),
    r1: L.sets.reduce(
      (m, st) => Math.max(m, st.row ?? 0),
      L.rows.reduce((m, r) => Math.max(m, r), Number.NEGATIVE_INFINITY),
    ),
    c1: cols.reduce((m, c) => Math.max(m, c), Number.NEGATIVE_INFINITY),
  }
  return { table, warnings, account: accountFor(sheet, opts.area ?? span, use) }
}
