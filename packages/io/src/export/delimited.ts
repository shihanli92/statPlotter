import { type Cell, cellOf, exportText, type Row, widthOf } from './cells.ts'

export type Delimiter = ',' | '\t'

const BOM = String.fromCharCode(0xfeff)
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/**
 * Text a spreadsheet would run as a formula when it opens the file (CSV injection): it starts
 * with = + - @ or a tab or carriage return and is not simply a number.
 */
export const formulaLike = (s: string) => /^[=+\-@\t\r]/.test(s) && !PLAIN_NUMBER.test(s)

/**
 * A cell as a spreadsheet should take it: formula-like text gets a leading apostrophe, which
 * Excel reads as "this is text". Numbers (their display text too) are never guarded: they can't
 * be formulas.
 */
export const guardedText = (c: Cell): string => {
  const s = exportText(c)
  return typeof cellOf(c).v !== 'number' && formulaLike(s) ? `'${s}` : s
}

/**
 * Rows as delimited text (RFC 4180): a field holding the delimiter, a quote or a line break is
 * quoted, its quotes doubled; rows are padded to the widest so every line has as many fields.
 * `guard`: formula-like text gets a leading apostrophe (`guardedText`).
 */
export function toDelimited(
  rows: readonly Row[],
  sep: Delimiter,
  opts: { eol?: string; guard?: boolean } = {},
): string {
  const width = widthOf(rows)
  const field = (c: Cell) => {
    const t = opts.guard ? guardedText(c) : exportText(c)
    return t.includes(sep) || /["\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  return rows
    .map((r) => Array.from({ length: width }, (_, j) => field(r[j] ?? null)).join(sep))
    .join(opts.eol ?? '\n')
}

/**
 * A CSV or TSV file as Excel opens it correctly: a UTF-8 byte-order mark (without one Excel reads
 * the file in the system's legacy encoding), CRLF line ends (RFC 4180), one after the last row,
 * and formula-like text guarded.
 */
export const delimitedFile = (rows: readonly Row[], sep: Delimiter): string =>
  `${BOM}${toDelimited(rows, sep, { eol: '\r\n', guard: true })}\r\n`
