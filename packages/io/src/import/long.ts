import { type DataTable, defaultColumnTitle, newColumnId } from '@ps/model'
import { accountFor, CellUse } from './account.ts'
import { asNumber, filled } from './cells.ts'
import { ImportError } from './errors.ts'
import { finishTable } from './finish.ts'
import type { Sheet, SheetCell, SheetImportResult } from './sheet.ts'

/**
 * Long ("tidy") data: one value per row, with columns saying which group, condition or subject
 * it belongs to, as R and pandas write them. `detectLong` recognises it; `longToTable` turns the
 * chosen columns into a column table (one factor) or a grouped table (two).
 */
export interface LongColumn {
  index: number
  title: string
  /** Every non-empty value is a number. */
  numeric: boolean
  /** Distinct non-empty values. */
  levels: number
}

export interface LongInfo {
  columns: LongColumn[]
  /** Suggested settings. */
  guess: { value: number; group: number; row: number | null; subject: number | null }
}

export interface LongImportOptions {
  name: string
  /** Column holding the values. */
  value: number
  /** Column whose levels become data sets. */
  group: number
  /** Column whose levels become rows (a grouped table), or none (a column table). */
  row?: number | null
  /** Column identifying subjects: values of one subject share a row (matched / paired data). */
  subject?: number | null
  /** Keep only rows whose column equals the value (compared as text). */
  filters?: { col: number; value: string }[]
}

const asText = (v: SheetCell | undefined) => (filled(v) ? String(v).trim() : '')

const SUBJECT =
  /(donor|subject|patient|mouse|mice|animal|person|participant|individual|sample|^id$|_id$)/i

/** R's unnamed row-number column: header "" and values 1..n. */
function isRowNames(sheet: Sheet, c: number): boolean {
  const rows = sheet.rows
  if (filled(rows[0]![c])) return false
  for (let r = 1; r < rows.length; r++) {
    const v = asNumber(rows[r]![c])
    if (filled(rows[r]![c]) && v !== r && v !== r - 1) return false
  }
  return rows.length > 2
}

/**
 * Whether a sheet is long-format data: a header row of names over rows of records, with at least
 * one numeric column and a text column whose values repeat (the grouping).
 */
export function detectLong(sheet: Sheet): LongInfo | null {
  const rows = sheet.rows
  if (rows.length < 4) return null
  const width = rows[0]!.length
  const header = rows[0]!
  const body = rows.slice(1).filter((r) => r.some(filled))
  if (body.length < 3) return null
  if (header.some((v) => typeof v === 'number')) return null
  const columns: LongColumn[] = []
  for (let c = 0; c < width; c++) {
    if (isRowNames(sheet, c)) continue
    const vals = body.map((r) => r[c]).filter(filled)
    if (!vals.length) continue
    // Records under one header row: every column holding data is named.
    if (!filled(header[c])) return null
    const numeric = vals.every((v) => asNumber(v) !== null)
    columns.push({
      index: c,
      title: asText(header[c]) || defaultColumnTitle(c),
      numeric,
      levels: new Set(vals.map(asText)).size,
    })
  }
  const grouping = columns.filter((c) => !c.numeric && c.levels > 1 && c.levels < body.length / 1.5)
  const values = columns.filter((c) => c.numeric && c.levels > Math.min(3, body.length / 2))
  if (!grouping.length || !values.length) return null
  const subject = grouping.find((c) => SUBJECT.test(c.title)) ?? null
  const groups = grouping.filter((c) => c !== subject).sort((a, b) => a.levels - b.levels)
  const group = groups[0] ?? grouping[0]!
  return {
    columns,
    guess: {
      value: values[values.length - 1]!.index,
      group: group.index,
      row: null,
      subject: subject && subject !== group ? subject.index : null,
    },
  }
}

/** Builds a column table (group only) or grouped table (group × row) from long data. */
export function longToTable(sheet: Sheet, opts: LongImportOptions): SheetImportResult {
  const rows = sheet.rows
  const warnings: string[] = []
  const use = new CellUse(sheet)
  const width = rows[0]?.length ?? 0
  for (let c = 0; c < width; c++) {
    use.label(0, c)
    if (isRowNames(sheet, c)) for (let r = 1; r < rows.length; r++) use.label(r, c)
  }
  const factors = [opts.group, opts.row, opts.subject, ...(opts.filters ?? []).map((f) => f.col)]
  const index = new Map(rows.map((r, i) => [r, i]))
  const records = rows
    .slice(1)
    .filter((r) => r.some(filled))
    .filter((r) => (opts.filters ?? []).every((f) => asText(r[f.col]) === f.value))
  for (const r of records) {
    const i = index.get(r)!
    for (const c of factors) if (c != null) use.label(i, c)
  }
  if (!records.length) throw new ImportError('No rows are left after the filter.')
  /** A column's distinct non-empty values in order of appearance, each mapped to its index. */
  const levels = (c: number) => {
    const at = new Map<string, number>()
    for (const r of records) {
      const t = asText(r[c])
      if (t && !at.has(t)) at.set(t, at.size)
    }
    return at
  }
  const groupAt = levels(opts.group)
  const rowAt = opts.row != null ? levels(opts.row) : null
  const subjectAt = opts.subject != null ? levels(opts.subject) : null
  const groups = [...groupAt.keys()]
  const rowLevels = rowAt && [...rowAt.keys()]
  const subjects = subjectAt && [...subjectAt.keys()]
  let nonNumeric = 0
  let duplicates = 0
  // cells[group][row] = values, placed by subject when there is one.
  const nRows = rowLevels?.length ?? 1
  const cells = groups.map(() => Array.from({ length: nRows }, () => [] as (number | null)[]))
  for (const r of records) {
    const g = groupAt.get(asText(r[opts.group]))
    if (g === undefined) continue
    const row = rowAt ? rowAt.get(asText(r[opts.row!])) : 0
    if (row === undefined) continue
    let v = asNumber(r[opts.value])
    if (v === null && filled(r[opts.value])) nonNumeric++
    if (v !== null && !Number.isFinite(v)) v = null
    const cell = cells[g]![row]!
    if (subjectAt) {
      const k = subjectAt.get(asText(r[opts.subject!]))
      if (k === undefined) continue
      use.value(index.get(r)!, opts.value)
      if (cell[k] !== undefined && cell[k] !== null) duplicates++
      while (cell.length <= k) cell.push(null)
      cell[k] = v
    } else {
      use.value(index.get(r)!, opts.value)
      cell.push(v)
    }
  }
  if (nonNumeric) warnings.push(`${nonNumeric} non-numeric values were imported as empty.`)
  if (duplicates)
    warnings.push(`${duplicates} values shared a subject and cell with another; the last was kept.`)

  const title = (c: number) => asText(rows[0]![c]) || defaultColumnTitle(c)
  let table: DataTable
  if (rowLevels) {
    const reps = cells.reduce(
      (m, group) => group.reduce((k, c) => Math.max(k, c.length), m),
      Math.max(1, subjects?.length ?? 0),
    )
    table = finishTable({
      name: opts.name,
      tableKind: 'grouped',
      yFormat: { type: 'replicates', count: reps },
      rowCount: rowLevels.length,
      rowTitles: rowLevels,
      x: null,
      dataSets: groups.map((g, i) => ({
        id: newColumnId(),
        title: g,
        subcolumns: Array.from({ length: reps }, (_, k) => ({
          type: 'number' as const,
          values: rowLevels.map((_, r) => cells[i]![r]![k] ?? null),
        })),
      })),
      notes: `Long-format import: ${title(opts.value)} by ${title(opts.group)} and ${title(opts.row!)}.`,
    })
  } else {
    const n = cells.reduce((m, c) => Math.max(m, c[0]!.length), subjects?.length ?? 0)
    table = finishTable({
      name: opts.name,
      tableKind: 'column',
      yFormat: { type: 'replicates', count: 1 },
      rowCount: n,
      rowTitles: subjects ? subjects.slice(0, n) : null,
      x: null,
      dataSets: groups.map((g, i) => ({
        id: newColumnId(),
        title: g,
        subcolumns: [
          {
            type: 'number' as const,
            values: Array.from({ length: n }, (_, k) => cells[i]![0]![k] ?? null),
          },
        ],
      })),
      notes: `Long-format import: ${title(opts.value)} by ${title(opts.group)}.`,
    })
  }
  const account = accountFor(sheet, { r0: 0, c0: 0, r1: rows.length - 1, c1: width - 1 }, use)
  return { table, warnings, account }
}
