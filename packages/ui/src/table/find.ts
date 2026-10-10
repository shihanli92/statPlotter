import type { CellEdit, Command, TextEdit } from '@ps/engine'
import {
  type CellView,
  cellAt,
  type DataTable,
  type GridColumn,
  type RichText,
  tableFormulas,
  titleRuns,
} from '@ps/model'
import { typeText } from '../richText/model.ts'
import { cellText, computedCellText, editCommands } from './gridModel.ts'
import {
  renameDataSetCommand,
  renameXCommand,
  rowTitleCommand,
  rowTitleRuns,
  subTitleRichCommand,
} from './titles.tsx'

// Find and replace in a data table (roadmap 29), as pure functions over the table and its grid
// columns. What is searched: numbers by their entered value (the full-precision text F2 edits,
// whatever the column's display format), text cells, calculated values as shown, row titles,
// data set and X titles, and titled subcolumns. Titles keep their formatting: replaced text takes
// the format of the text it replaces.

export interface FindOptions {
  matchCase: boolean
  /** The whole cell (or title) must be the text sought. */
  wholeCell: boolean
}

/** A match: a cell (row titles included), a data set's or X title, or a subcolumn's title. */
export type FindTarget =
  | { kind: 'cell'; r: number; c: number }
  /** The title of the data set (or X column) whose first grid column is `c`. */
  | { kind: 'title'; c: number }
  /** The title of the subcolumn at grid column `c`. */
  | { kind: 'subTitle'; c: number }

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where `query` occurs in `text` as [start, end) ranges (whole cell: all of it or nothing). */
export function matchRanges(text: string, query: string, opts: FindOptions): [number, number][] {
  if (!query) return []
  const body = escapeRegExp(query)
  const re = new RegExp(opts.wholeCell ? `^${body}$` : body, opts.matchCase ? 'gu' : 'giu')
  return [...text.matchAll(re)].map((m) => [m.index, m.index + m[0].length])
}

/** `text` with every match of `query` replaced (see `matchRanges`). */
export function replaceText(text: string, query: string, repl: string, opts: FindOptions): string {
  let out = text
  for (const [a, b] of matchRanges(text, query, opts).reverse())
    out = out.slice(0, a) + repl + out.slice(b)
  return out
}

/** Formatted text with every match replaced, each replacement in the format of what it replaces. */
export function replaceRuns(
  runs: RichText,
  query: string,
  repl: string,
  opts: FindOptions,
): RichText {
  let out = runs
  const plain = runs.map((r) => r.text).join('')
  for (const [a, b] of matchRanges(plain, query, opts).reverse()) out = typeText(out, a, b, repl)
  return out
}

/** The text a target is matched on (null: nothing there). */
function targetText(t: DataTable, cols: readonly GridColumn[], m: FindTarget): string | null {
  const col = cols[m.c]
  if (!col) return null
  if (m.kind === 'title')
    return col.kind === 'data' ? col.ds.title : col.kind === 'x' ? (t.x?.title ?? '') : null
  if (m.kind === 'subTitle')
    return col.kind === 'data' ? (col.ds.subcolumnTitles?.[col.sub] ?? null) : null
  if (m.r >= t.rowCount) return null
  const cell = cellAt(t, col, m.r)
  if ('title' in cell) return cell.title
  if (cell.text !== undefined) return cell.text
  if (cell.value === null) return null
  return cell.calculated ? computedCellText(cell.value) : cellText(cell.value)
}

/** Every match in the table: titles left to right, subcolumn titles, then cells row by row. */
export function findMatches(
  t: DataTable,
  cols: readonly GridColumn[],
  query: string,
  opts: FindOptions,
): FindTarget[] {
  if (!query) return []
  const hit = (m: FindTarget) => {
    const text = targetText(t, cols, m)
    return text !== null && matchRanges(text, query, opts).length > 0
  }
  const out: FindTarget[] = []
  cols.forEach((col, c) => {
    const first = col.kind === 'x' ? col.sub === 0 : col.kind === 'data' && col.sub === 0
    if (first && hit({ kind: 'title', c })) out.push({ kind: 'title', c })
  })
  cols.forEach((col, c) => {
    if (col.kind === 'data' && hit({ kind: 'subTitle', c })) out.push({ kind: 'subTitle', c })
  })
  // Cells (roadmap 34e: a million rows): the pattern compiled once, each column's text read
  // straight from its array, and number columns skipped when the text sought can't be in a
  // number's text (a word: "CD4", "naive"). The same matches, in the same order.
  const body = escapeRegExp(query)
  const re = new RegExp(opts.wholeCell ? `^${body}$` : body, opts.matchCase ? 'u' : 'iu')
  const numeric = NUMBER_TEXT.test(query)
  const texts = cols.map((col): ((r: number) => string | null) | null => {
    if (col.kind === 'rowTitle') return (r) => t.rowTitles?.[r] ?? null
    if (col.kind === 'data' && col.ds.text) {
      const text = col.ds.text
      return (r) => text[r] ?? null
    }
    if (!numeric) return null
    if (col.kind === 'data' && col.ds.formula !== undefined) {
      const f = tableFormulas(t).get(col.ds.id)
      return (r) => {
        const v = f?.values[r]
        return v === undefined || Number.isNaN(v) ? null : computedCellText(v)
      }
    }
    const values = (col.kind === 'x' ? t.x!.subcolumns[col.sub]! : col.ds.subcolumns[col.sub]!)
      .values
    return (r) => {
      const v = values[r]
      return v === null || v === undefined ? null : cellText(v)
    }
  })
  for (let r = 0; r < t.rowCount; r++)
    for (let c = 0; c < texts.length; c++) {
      const text = texts[c]?.(r)
      if (text !== null && text !== undefined && re.test(text)) out.push({ kind: 'cell', r, c })
    }
  return out
}

/** Text a number's text can contain (digits, point, sign, exponent): else no number matches. */
const NUMBER_TEXT = /^[0-9.eE+-]+$/

type ReplaceResult =
  | { ok: true; commands: Command[]; replaced: number; skipped: number }
  | { ok: false; error: string }

/**
 * Commands replacing `query` with `repl` in the targets (Replace: one; Replace all: every match,
 * one undo step). Numbers must stay numbers: a replacement that leaves text in a number cell
 * fails the whole replace with the usual message. Calculated cells are skipped (their formula
 * gives them), as are targets that no longer match.
 */
export function replaceCommands(
  t: DataTable,
  cols: readonly GridColumn[],
  targets: readonly FindTarget[],
  query: string,
  repl: string,
  opts: FindOptions,
): ReplaceResult {
  const commands: Command[] = []
  let replaced = 0
  let skipped = 0
  for (const m of targets) {
    const text = targetText(t, cols, m)
    if (text === null || !matchRanges(text, query, opts).length) continue
    const col = cols[m.c]!
    let cmd: Command | Command[] | null = null
    if (m.kind === 'title' && col.kind === 'data') {
      const runs = titleRuns(col.ds.title, col.ds.titleRich)
      cmd = renameDataSetCommand(t, col.ds, replaceRuns(runs, query, repl, opts))
    } else if (m.kind === 'title' && col.kind === 'x' && t.x) {
      cmd = renameXCommand(t, replaceRuns(titleRuns(t.x.title, t.x.titleRich), query, repl, opts))
    } else if (m.kind === 'subTitle' && col.kind === 'data') {
      const runs = titleRuns(text, col.ds.subcolumnTitlesRich?.[col.sub])
      cmd = subTitleRichCommand(t, col, replaceRuns(runs, query, repl, opts))
    } else if (m.kind === 'cell' && col.kind === 'rowTitle') {
      cmd = rowTitleCommand(t, m.r, replaceRuns(rowTitleRuns(t, m.r), query, repl, opts))
    } else if (m.kind === 'cell' && col.kind !== 'rowTitle') {
      if ((cellAt(t, col, m.r) as CellView).calculated) {
        skipped++
        continue
      }
      const result = editCommands(t, col, m.r, replaceText(text, query, repl, opts))
      if (!result.ok) return { ok: false, error: result.error }
      cmd = result.commands
    }
    if (cmd === null) continue
    commands.push(...(Array.isArray(cmd) ? cmd : [cmd]))
    replaced++
  }
  return { ok: true, commands: mergeEdits(commands), replaced, skipped }
}

/** One setCells and one setText command for all the cell edits (row titles and titles as they are). */
function mergeEdits(commands: Command[]): Command[] {
  const cells: CellEdit[] = []
  const texts: TextEdit[] = []
  const rest: Command[] = []
  let table = ''
  for (const c of commands) {
    if (c.type === 'table.setCells') cells.push(...c.edits)
    else if (c.type === 'table.setText') texts.push(...c.edits)
    else rest.push(c)
    if ('table' in c) table = c.table
  }
  const out: Command[] = []
  if (cells.length) out.push({ type: 'table.setCells', table: table as never, edits: cells })
  if (texts.length) out.push({ type: 'table.setText', table: table as never, edits: texts })
  return [...out, ...rest]
}
