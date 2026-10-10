import type { CellEdit, Command, TextEdit } from '@ps/engine'
import { type ClipboardCell, cellOf, gridToTsv, parseNumber, type Row } from '@ps/io'
import {
  type CellView,
  type ColumnId,
  cellAt,
  type DataSetColumn,
  type DataTable,
  defaultSubjectTitle,
  type GridColumn,
  newColumnId,
  subcolumnCount,
  subcolumnRoles,
  textFromNumber,
} from '@ps/model'

// The grid's view of a table (columns, header labels, cells) lives in the model (`grid.ts`),
// shared with the exporters; this adds editing: typing, clearing, pasting, copying.
export {
  type CellView,
  cellAt,
  defaultSubjectTitle,
  type GridColumn,
  gridColumns,
  hasSubHeader,
  subLabel,
  type VariableKind,
  variableKind,
} from '@ps/model'

/**
 * Subcolumns that can be added or removed in the editor, with what they are called: nested
 * subjects, or replicates of XY and grouped tables. Null for tables with fixed subcolumns.
 */
export function subcolumnNoun(t: DataTable): { one: string; many: string } | null {
  if (t.yFormat.type !== 'replicates') return null
  if (t.tableKind === 'nested') return { one: 'subject', many: 'subjects' }
  if (t.tableKind === 'xy' || t.tableKind === 'grouped')
    return { one: 'replicate', many: 'replicates' }
  return null
}

/** Command renaming a subcolumn (a nested subject); an empty or default title clears it. */
export function subTitleCommand(
  t: DataTable,
  col: Extract<GridColumn, { kind: 'data' }>,
  text: string,
): Command | null {
  const title = text.trim()
  const isDefault = t.tableKind === 'nested' && title === defaultSubjectTitle(col.sub)
  const next = title === '' || isDefault ? null : title
  if ((col.ds.subcolumnTitles?.[col.sub] ?? null) === next) return null
  return { type: 'table.setSubcolumnTitle', table: t.id, id: col.ds.id, sub: col.sub, title: next }
}

export const isSummaryColumnTable = (t: DataTable) =>
  t.tableKind === 'column' && t.yFormat.type === 'summary'

/** Full-precision text shown in a cell (what the user typed, as a number). */
export const cellText = (v: number | null): string => (v === null ? '' : String(v))

/** Shown in a calculated cell whose inputs are there but whose result isn't a number. */
export const INVALID_CELL = '#NUM'

/** What a cell shows: text as typed, numbers in full (computed ones rounded for display). */
export function cellDisplay(cell: CellView, computed: boolean): string {
  if (cell.text !== undefined) return cell.text ?? ''
  if (cell.calculated) return cell.calculated.invalid ? INVALID_CELL : computedCellText(cell.value)
  return computed ? computedCellText(cell.value) : cellText(cell.value)
}

/**
 * A computed value (result tables) as shown in the grid: 6 significant digits (never fewer than
 * the digits before the point), so a log or a ratio doesn't show floating-point noise. Copying
 * keeps full precision.
 */
export function computedCellText(v: number | null): string {
  if (v === null) return ''
  if (!Number.isFinite(v) || v === 0) return String(v)
  const whole = Math.floor(Math.log10(Math.abs(v))) + 1
  return String(Number(v.toPrecision(Math.min(21, Math.max(6, whole)))))
}

export interface Rect {
  r0: number
  c0: number
  r1: number
  c1: number
}

export const normRect = (a: { r: number; c: number }, b: { r: number; c: number }): Rect => ({
  r0: Math.min(a.r, b.r),
  c0: Math.min(a.c, b.c),
  r1: Math.max(a.r, b.r),
  c1: Math.max(a.c, b.c),
})

/** The selected cells: values in full, text as text, excluded values marked (for HTML). */
export function selectionRows(t: DataTable, cols: GridColumn[], sel: Rect): Row[] {
  const rows: Row[] = []
  for (let r = sel.r0; r <= sel.r1; r++) {
    const row: Row = []
    for (let c = sel.c0; c <= sel.c1; c++) {
      const col = cols[c]
      if (!col || r >= t.rowCount) {
        row.push(null)
        continue
      }
      const cell = cellAt(t, col, r)
      if ('title' in cell) row.push(cell.title)
      else if (cell.text !== undefined) row.push(cell.text)
      else
        row.push(
          cell.excluded && cell.value !== null ? { v: cell.value, excluded: true } : cell.value,
        )
    }
    rows.push(row)
  }
  return rows
}

/**
 * The selected cells as tab-separated text (excluded values as plain numbers). `guard`: for other
 * applications, formula-like text gets a leading apostrophe (audit 2 X13).
 */
export const copyText = (t: DataTable, cols: GridColumn[], sel: Rect, guard = false): string =>
  gridToTsv(
    selectionRows(t, cols, sel).map((r) => r.map((c) => cellOf(c).v)),
    { guard },
  )

/** Commands that clear the selected cells (values and row titles). */
export function clearCommands(t: DataTable, cols: GridColumn[], sel: Rect): Command[] {
  const edits: CellEdit[] = []
  const texts: TextEdit[] = []
  const cmds: Command[] = []
  for (let c = sel.c0; c <= sel.c1; c++) {
    const col = cols[c]
    if (!col) continue
    for (let r = sel.r0; r <= Math.min(sel.r1, t.rowCount - 1); r++) {
      if (col.kind === 'rowTitle') {
        if (t.rowTitles?.[r] != null)
          cmds.push({ type: 'table.setRowTitle', table: t.id, row: r, title: null })
      } else {
        const cell = cellAt(t, col, r) as CellView
        // Calculated values come from their formula: nothing to clear.
        if (cell.calculated) continue
        if (col.kind === 'data' && cell.text != null)
          texts.push({ col: col.ds.id, row: r, value: null })
        else if (cell.value !== null) edits.push({ ...addr(col), row: r, value: null })
      }
    }
  }
  if (edits.length) cmds.push({ type: 'table.setCells', table: t.id, edits })
  if (texts.length) cmds.push({ type: 'table.setText', table: t.id, edits: texts })
  return cmds
}

type EditResult =
  | { ok: true; commands: Command[] }
  | {
      ok: false
      error: string
      /** Text typed into a numeric variable: the commands that make it a text variable instead. */
      makeText?: { question: string; commands: Command[] }
    }

/**
 * Commands for typing `input` into a value cell (not a row title): a number, text in a text
 * variable, or nothing. Calculated cells can't be typed into; text typed into a numeric variable
 * of a multiple-variables table offers to make the variable text.
 */
export function editCommands(
  t: DataTable,
  col: Extract<GridColumn, { kind: 'x' | 'data' }>,
  row: number,
  input: string,
): EditResult {
  const text = input.trim()
  const current = row < t.rowCount ? (cellAt(t, col, row) as CellView) : null
  if (col.kind === 'data' && col.ds.formula !== undefined)
    return {
      ok: false,
      error: `“${col.ds.title}” is calculated from its formula (${col.ds.formula}). Edit the formula above the grid, or convert the variable to values.`,
    }
  if (col.kind === 'data' && col.ds.text) {
    const value = text === '' ? null : text
    if (value === (current?.text ?? null)) return { ok: true, commands: [] }
    return {
      ok: true,
      commands: [{ type: 'table.setText', table: t.id, edits: [{ col: col.ds.id, row, value }] }],
    }
  }
  const value = text === '' ? null : parseNumber(text)
  if (text !== '' && value === null) {
    const error = `"${text}" is not a number.`
    if (col.kind !== 'data' || t.tableKind !== 'multipleVariables') return { ok: false, error }
    return {
      ok: false,
      error,
      makeText: {
        question: `"${text}" is not a number. Make “${col.ds.title}” a text (categorical) variable? Its numbers become text.`,
        commands: [
          { type: 'table.setVariableType', table: t.id, ids: [col.ds.id], to: 'text' },
          { type: 'table.setText', table: t.id, edits: [{ col: col.ds.id, row, value: text }] },
        ],
      },
    }
  }
  if (value === (current?.value ?? null)) return { ok: true, commands: [] }
  return {
    ok: true,
    commands: [{ type: 'table.setCells', table: t.id, edits: [{ ...addr(col), row, value }] }],
  }
}

export const addr = (col: Extract<GridColumn, { kind: 'x' | 'data' }>) =>
  col.kind === 'x' ? { col: 'x' as const, sub: col.sub } : { col: col.ds.id, sub: col.sub }

export type PasteResult = { ok: true; commands: Command[] } | { ok: false; error: string }

/**
 * Whether pasted text holds several cells (tabs or line breaks, ignoring the line break
 * spreadsheets add at the end): pasted into a cell being edited, it goes into the grid instead.
 */
export function isMultiCellPaste(text: string): boolean {
  return /[\t\n\r]/.test(text.replace(/[\r\n]+$/, ''))
}

/**
 * Turns a pasted grid into commands. A first row of text pasted into row 0 becomes column
 * titles (unless `headers` is false: fills). Pasting past the last column adds data sets; past
 * the last row grows the table.
 */
export function pasteCommands(
  t: DataTable,
  cols: GridColumn[],
  at: { r: number; c: number },
  grid: ClipboardCell[][],
  newId: () => ColumnId = newColumnId,
  headers = true,
): PasteResult {
  if (grid.length === 0) return { ok: true, commands: [] }
  // A reduce, not a spread: a paste can have more rows than a call takes arguments.
  const width = grid.reduce((w, r) => Math.max(w, r.length), 0)
  let rows = grid
  let titles: ClipboardCell[] | null = null
  // Nested tables: a row of subject names (under the group titles, or alone) names subjects.
  let subjectTitles: ClipboardCell[] | null = null
  const variables = t.tableKind === 'multipleVariables'
  if (
    headers &&
    at.r === 0 &&
    grid.length > 1 &&
    grid[0]!.some((v) => typeof v === 'string') &&
    (!variables || isHeaderRow(grid))
  ) {
    titles = grid[0]!
    rows = grid.slice(1)
    const textRow = (r: ClipboardCell[] | undefined) =>
      !!r?.some((v) => typeof v === 'string') && r.every((v) => v === null || typeof v === 'string')
    if (t.tableKind === 'nested') {
      if (textRow(rows[0])) {
        subjectTitles = rows[0]!
        rows = rows.slice(1)
      } else if (titles.some((v, j) => typeof v === 'string' && subOf(cols, at.c + j, t) > 0)) {
        // One header row with names over subcolumns other than the first: subjects, not groups.
        subjectTitles = titles
        titles = null
      }
    }
  }
  if (isSummaryColumnTable(t) && at.r + rows.length > 1) {
    return { ok: false, error: 'This table holds one row of summary data per column.' }
  }

  const commands: Command[] = []
  // Extend with new data sets if the paste runs past the last column.
  const nSub = subcolumnCount(t.yFormat)
  const extraVisual = at.c + width - cols.length
  const allCols = [...cols]
  if (extraVisual > 0) {
    const extraSets = Math.ceil(extraVisual / nSub)
    const roles = subcolumnRoles(t.yFormat)
    for (let k = 0; k < extraSets; k++) {
      const id = newId()
      commands.push({ type: 'table.addDataSet', table: t.id, id })
      const ds: DataSetColumn = { id, title: '', subcolumns: [] }
      roles.forEach((role, sub) => {
        allCols.push({ kind: 'data', ds, dsIndex: t.dataSets.length + k, sub, role })
      })
    }
  }

  const edits: CellEdit[] = []
  const texts: TextEdit[] = []
  for (let j = 0; j < width; j++) {
    const col = allCols[at.c + j]!
    const title = titles?.[j]
    if (title != null && col.kind === 'data' && col.sub === 0) {
      commands.push({
        type: 'table.renameDataSet',
        table: t.id,
        id: col.ds.id,
        title: String(title),
      })
    }
    const subject = subjectTitles?.[j]
    if (subject != null && col.kind === 'data') {
      commands.push({
        type: 'table.setSubcolumnTitle',
        table: t.id,
        id: col.ds.id,
        sub: col.sub,
        title: String(subject),
      })
    }
    const cells = rows.map((row) => row[j] ?? null)
    if (col.kind === 'data' && variables) {
      // Multiple-variables tables: text goes into text variables, and a numeric variable given
      // text (other than a missing-value mark) becomes a text variable.
      const ds = col.ds
      if (ds.formula !== undefined) {
        if (cells.some((v) => v !== null))
          return {
            ok: false,
            error: `Can't paste into “${ds.title}”: it is calculated from its formula.`,
          }
        continue
      }
      const words = cells.some((v) => typeof v === 'string' && !isMissingMark(v))
      if (ds.text || words) {
        if (!ds.text)
          commands.push({ type: 'table.setVariableType', table: t.id, ids: [ds.id], to: 'text' })
        cells.forEach((v, i) => {
          texts.push({
            col: ds.id,
            row: at.r + i,
            value: v === null ? null : typeof v === 'number' ? textFromNumber(v) : v,
          })
        })
        continue
      }
      cells.forEach((v, i) => {
        edits.push({ ...addr(col), row: at.r + i, value: typeof v === 'number' ? v : null })
      })
      continue
    }
    cells.forEach((v, i) => {
      const r = at.r + i
      if (col.kind === 'rowTitle') {
        commands.push({
          type: 'table.setRowTitle',
          table: t.id,
          row: r,
          title: v === null ? null : String(v),
        })
      } else if (typeof v === 'string') {
        edits.push({ ...addr(col), row: r, value: Number.NaN }) // marker, rejected below
      } else {
        edits.push({ ...addr(col), row: r, value: v })
      }
    })
  }
  const bad = edits.find((e) => Number.isNaN(e.value))
  if (bad) {
    const i = bad.row - at.r
    const text = rows[i]?.find((v) => typeof v === 'string')
    return { ok: false, error: `Can't paste text into a data cell: "${String(text)}".` }
  }

  // Row titles must exist before titles are set on grown rows; setCells grows rows first.
  const maxRow = at.r + rows.length - 1
  if (edits.length) commands.push({ type: 'table.setCells', table: t.id, edits })
  if (texts.length) commands.push({ type: 'table.setText', table: t.id, edits: texts })
  if (!edits.length && !texts.length && maxRow >= t.rowCount && !isSummaryColumnTable(t)) {
    commands.unshift({
      type: 'table.insertRows',
      table: t.id,
      at: t.rowCount,
      count: maxRow + 1 - t.rowCount,
    })
  }
  // Order: add columns → make text variables → set cells and text (grow rows) → titles/row titles.
  commands.sort((a, b) => rank(a) - rank(b))
  return { ok: true, commands }
}

/** Subcolumn index at visual column `c`, counting past the last column as new data sets. */
function subOf(cols: readonly GridColumn[], c: number, t: DataTable): number {
  const col = cols[c]
  if (col) return col.kind === 'data' ? col.sub : 0
  const dataStart = cols.findIndex((x) => x.kind === 'data')
  const n = subcolumnCount(t.yFormat)
  return (((c - (dataStart < 0 ? cols.length : dataStart)) % n) + n) % n
}

/** Marks exported data use for "no value" (R, Excel, SAS…): empty cells, not text. */
const MISSING_MARKS = new Set(['na', 'n/a', '#n/a', 'nan', 'null', '.'])
const isMissingMark = (s: string) => MISSING_MARKS.has(s.trim().toLowerCase())

/**
 * Multiple-variables tables hold text too, so a first row of text is a header only when it looks
 * like one: a column has a number under it, or none of its cells appears again below (categories
 * repeat, variable names don't).
 */
function isHeaderRow(grid: readonly ClipboardCell[][]): boolean {
  const head = grid[0]!
  if (head.some((v) => typeof v === 'number' || (typeof v === 'string' && isMissingMark(v))))
    return false
  const below = grid.slice(1)
  if (head.some((_, j) => below.some((r) => typeof r[j] === 'number'))) return true
  return head.every(
    (v, j) => v === null || !below.some((r) => String(r[j] ?? '').trim() === String(v).trim()),
  )
}

function rank(c: Command): number {
  switch (c.type) {
    case 'table.addDataSet':
      return 0
    case 'table.setVariableType':
      return 0.5
    case 'table.insertRows':
    case 'table.setCells':
    case 'table.setText':
      return 1
    default:
      return 2
  }
}
