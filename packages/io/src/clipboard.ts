import { guardedText } from './export/delimited.ts'
import { parseRecords } from './import/csv.ts'
import { type DecimalSeparator, detectDecimal, parseNumberWith } from './numbers.ts'

/**
 * Parses tab-separated text as copied from Excel, Prism, or another grid. Numbers become
 * numbers, blank cells null, anything else stays a string (the caller decides whether text is
 * acceptable — e.g. as a column title — or an error). Cells Excel quotes (text with line breaks,
 * tabs or quotes) are unquoted. Decimal-comma data ("0,5", "1,25") is recognised when no cell
 * uses a decimal point.
 */
export type ClipboardCell = number | string | null

export function parseClipboardGrid(text: string): ClipboardCell[][] {
  const rows = splitGrid(text)
  const decimal = detectDecimal(rows.flat()) === ',' ? ',' : '.'
  return rows.map((row) => row.map((cell) => parseCell(cell, decimal)))
}

function splitGrid(text: string): string[][] {
  // Quoted cells only come from a spreadsheet's own copy, which balances its quotes; a stray
  // quote in plain text must not swallow the rest of the paste.
  const quotes = text.match(/"/g)?.length ?? 0
  if (quotes > 0 && quotes % 2 === 0) {
    return parseRecords(text, '\t').map((r) => r.map((f) => f.text))
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  // Spreadsheets append a trailing newline.
  if (lines.at(-1) === '') lines.pop()
  return lines.map((line) => line.split('\t'))
}

export function parseCell(raw: string, decimal: DecimalSeparator = '.'): ClipboardCell {
  const s = raw.trim()
  if (s === '') return null
  const n = parseNumberWith(s, decimal)
  return n === null ? s : n
}

/**
 * Text cells with tabs, line breaks or quotes are quoted the way Excel does. `guard`: formula-like
 * text cells get a leading apostrophe (`guardedText`; numbers never), for other applications.
 */
export function gridToTsv(
  rows: readonly (readonly ClipboardCell[])[],
  opts: { guard?: boolean } = {},
): string {
  const cell = (c: ClipboardCell) => {
    const s = opts.guard ? guardedText(c) : c === null ? '' : String(c)
    return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(cell).join('\t')).join('\n')
}

/** Rows become columns and columns rows (for pasting a table the other way round). */
export function transposeGrid(grid: readonly (readonly ClipboardCell[])[]): ClipboardCell[][] {
  const width = grid.reduce((w, r) => Math.max(w, r.length), 0)
  return Array.from({ length: width }, (_, c) => grid.map((r) => r[c] ?? null))
}
