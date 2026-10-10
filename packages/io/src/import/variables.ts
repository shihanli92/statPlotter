import { type DataSetColumn, defaultColumnTitle, newColumnId } from '@ps/model'
import { accountFor, CellUse } from './account.ts'
import { asNumber, cellTitle, MISSING } from './cells.ts'
import { ImportError } from './errors.ts'
import { finishTable } from './finish.ts'
import type { Sheet, SheetCell, SheetImportOptions, SheetImportResult } from './sheet.ts'

/*
 * Multiple-variables tables from a sheet: each column a variable, each row an observation (the
 * layout of R / pandas data frames and most lab records). Columns of words stay text
 * (categorical) variables; numeric columns become numbers.
 */

const isMissing = (cell: SheetCell | undefined) =>
  cell === null ||
  cell === undefined ||
  (typeof cell === 'string' && (cell.trim() === '' || MISSING.has(cell.trim().toLowerCase())))

/**
 * Whether a column of cells is a text variable: most of its filled cells (missing-value marks
 * aside) are words, not numbers. A numeric column with a few stray words stays numeric (the words
 * are left out and counted).
 */
export function isTextColumn(cells: readonly SheetCell[]): boolean {
  let words = 0
  let filled = 0
  for (const c of cells) {
    if (isMissing(c)) continue
    filled++
    if (asNumber(c) === null) words++
  }
  return words > 0 && words * 2 >= filled
}

/** Text of a cell in a text variable (numbers as they read, TRUE / FALSE for booleans). */
const cellText = (cell: SheetCell | undefined): string | null =>
  isMissing(cell)
    ? null
    : typeof cell === 'boolean'
      ? cell
        ? 'TRUE'
        : 'FALSE'
      : typeof cell === 'number'
        ? String(cell)
        : cellTitle(cell)

/** `sheetToTable` for multiple-variables tables (plain range: header row, first column). */
export function variablesToTable(sheet: Sheet, opts: SheetImportOptions): SheetImportResult {
  if (opts.firstColumn === 'x') throw new ImportError('Multiple-variables tables have no X column.')
  if ((opts.replicates ?? 1) !== 1)
    throw new ImportError('Side-by-side replicates are only available for XY and grouped tables.')
  const R = sheet.rows
  const height = R.length
  const width = R[0]?.length ?? 0
  let { r0, c0, r1, c1 } = opts.range ?? { r0: 0, c0: 0, r1: height - 1, c1: width - 1 }
  r0 = Math.max(0, r0)
  c0 = Math.max(0, c0)
  r1 = Math.min(height - 1, r1)
  c1 = Math.min(width - 1, c1)
  const emptyRow = (r: number) => R[r]!.slice(c0, c1 + 1).every((v) => cellTitle(v) === null)
  while (r1 >= r0 && emptyRow(r1)) r1--
  if (!opts.range)
    while (c1 >= c0 && R.slice(r0, r1 + 1).every((row) => cellTitle(row[c1]) === null)) c1--
  if (r1 < r0 || c1 < c0) throw new ImportError('The selected range is empty.')

  const use = new CellUse(sheet)
  const header = opts.headerRow ? R[r0]! : null
  if (header) for (let c = c0; c <= c1; c++) use.label(r0, c)
  const dataR0 = opts.headerRow ? r0 + 1 : r0
  const rows: number[] = []
  for (let r = dataR0; r <= r1; r++) rows.push(r)
  const rowCount = rows.length

  let rowTitles: (string | null)[] | null = null
  const dataC0 = opts.firstColumn === 'rowTitles' ? c0 + 1 : c0
  if (opts.firstColumn === 'rowTitles') {
    rowTitles = rows.map((r) => {
      use.label(r, c0)
      return cellTitle(R[r]![c0])
    })
  }
  if (dataC0 > c1) throw new ImportError('The selected range has no data columns.')

  let dropped = 0
  let firstDropped = ''
  const dataSets: DataSetColumn[] = []
  for (let c = dataC0; c <= c1; c++) {
    if (opts.include && opts.include[c] === false) continue
    const cells = rows.map((r) => R[r]![c] ?? null)
    for (const r of rows) use.value(r, c)
    const title = cellTitle(header?.[c]) ?? defaultColumnTitle(c - dataC0)
    const ds: DataSetColumn = {
      id: newColumnId(),
      title,
      subcolumns: [{ type: 'number', values: rows.map(() => null) }],
    }
    if (isTextColumn(cells)) ds.text = cells.map(cellText)
    else
      ds.subcolumns[0]!.values = cells.map((cell) => {
        const v = asNumber(cell)
        if (v === null && !isMissing(cell)) {
          dropped++
          firstDropped ||= `“${String(cell).slice(0, 20)}” in ${title}`
        }
        return v
      })
    dataSets.push(ds)
  }
  if (!dataSets.length) throw new ImportError('No columns to import.')

  const warnings: string[] = []
  if (dropped)
    warnings.push(
      `${dropped} non-numeric ${dropped === 1 ? 'cell' : 'cells'} in numeric variables ${dropped === 1 ? 'was' : 'were'} imported as empty (first: ${firstDropped}).`,
    )
  const table = finishTable({
    name: opts.name,
    tableKind: 'multipleVariables',
    yFormat: { type: 'replicates', count: 1 },
    rowCount,
    rowTitles,
    x: null,
    dataSets,
  })
  return {
    table,
    warnings,
    account: accountFor(sheet, opts.area ?? { r0, c0, r1, c1 }, use),
  }
}

/**
 * Text columns with more distinct values than this are left out of an import by default (roadmap
 * 34e, decision 416): per-cell ids and barcodes, nearly unique, are no categories, and as one
 * they made graphs and lists of thousands of levels. The user can tick them to import them.
 */
export const MAX_IMPORT_LEVELS = 200

/** Distinct texts of a text column's cells (missing-value marks aside), counted up to `limit`. */
export function distinctTexts(cells: Iterable<SheetCell | undefined>, limit = Infinity): number {
  const seen = new Set<string>()
  for (const c of cells) {
    if (isMissing(c)) continue
    seen.add(cellText(c)!)
    if (seen.size > limit) break
  }
  return seen.size
}

/**
 * The text columns of a sheet's range (the header row aside) with more than `MAX_IMPORT_LEVELS`
 * distinct values, sheet column → the count (shown as the reason they are left out).
 */
export function manyLevelColumns(
  sheet: Sheet,
  opts: { headerRow: boolean; range?: { r0: number; c0: number; r1: number; c1: number } },
): Map<number, number> {
  const R = sheet.rows
  const width = R[0]?.length ?? 0
  const { r0, c0, r1, c1 } = opts.range ?? { r0: 0, c0: 0, r1: R.length - 1, c1: width - 1 }
  const out = new Map<number, number>()
  const first = opts.headerRow ? r0 + 1 : r0
  for (let c = c0; c <= c1; c++) {
    const cells: SheetCell[] = []
    for (let r = first; r <= r1; r++) cells.push(R[r]?.[c] ?? null)
    if (!isTextColumn(cells)) continue
    const n = distinctTexts(cells)
    if (n > MAX_IMPORT_LEVELS) out.set(c, n)
  }
  return out
}

/** Why a column is left out by default: "16,171 distinct values: left out (tick to import)". */
export const manyLevelsReason = (n: number, of?: number) =>
  `${n.toLocaleString('en-US')} distinct values${of ? ` in the first ${of.toLocaleString('en-US')} rows` : ''}: left out (tick to import)`
