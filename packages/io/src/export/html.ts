import { cellOf, exportText, type Row, widthOf } from './cells.ts'
import { guardedText } from './delimited.ts'

// HTML tables for the clipboard's rich text: Word, PowerPoint, Pages and Outlook paste them as
// real tables. Styles are inline (pasting keeps no style sheet).

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

const CELL = 'border:1px solid #bfbfbf;padding:1px 6px'
const TITLE = `${CELL};font-weight:bold;text-align:left`
const HEADER = `${CELL};font-weight:bold;text-align:center`
const EXCLUDED = ';color:#808080;font-style:italic'

/**
 * Rows as one HTML table. A row holding only a title (a block's) spans the table's width; titles
 * and column titles are header cells; numbers are right-aligned, excluded values grey italic.
 * `guard`: formula-like text gets a leading apostrophe (`guardedText`), as the clipboard's text
 * does (audit 2 X13).
 */
export function toHtmlTable(rows: readonly Row[], opts: { guard?: boolean } = {}): string {
  const shown = (c: Row[number]) => (opts.guard ? guardedText(c) : exportText(c))
  const width = widthOf(rows)
  const body = rows.map((row) => {
    const first = row[0] === undefined ? null : cellOf(row[0])
    if (first?.style === 'title' && row.slice(1).every((c) => exportText(c) === '')) {
      return `<tr><th colspan="${width}" style="${TITLE}">${escapeHtml(shown(row[0]!))}</th></tr>`
    }
    const cells = Array.from({ length: width }, (_, j) => {
      const c = cellOf(row[j] ?? null)
      const text = escapeHtml(shown(c)).replace(/\r?\n|\r/g, '<br>')
      if (c.style) return `<th style="${c.style === 'title' ? TITLE : HEADER}">${text}</th>`
      const align = typeof c.v === 'number' ? ';text-align:right' : ''
      return `<td style="${CELL}${align}${c.excluded ? EXCLUDED : ''}">${text}</td>`
    })
    return `<tr>${cells.join('')}</tr>`
  })
  return `<table style="border-collapse:collapse">${body.join('')}</table>`
}

/** The attribute of this app's HTML copies that holds the cells' exact tab-separated text. */
export const EXACT_TSV_ATTR = 'data-ps-tsv'

/**
 * HTML of a copy wrapped in an element holding the cells' exact (unguarded) tab-separated text,
 * which this app's paste takes (`exactTsvOf`) in place of the guarded plain text.
 */
export const withExactTsv = (html: string, exact: string) =>
  `<div ${EXACT_TSV_ATTR}="${escapeHtml(exact).replace(/[\t\n\r]/g, (ch) => `&#${ch.charCodeAt(0)};`)}">${html}</div>`

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
}

/**
 * The exact tab-separated text this app's HTML copy holds (`withExactTsv`), however the
 * clipboard re-serialised it (attribute values are always double-quoted); null for other HTML.
 */
export function exactTsvOf(html: string): string | null {
  const m = new RegExp(`<[a-z]+\\s[^>]*?\\b${EXACT_TSV_ATTR}="([^"]*)"`, 'i').exec(html)
  if (!m) return null
  return m[1]!.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#')
      return String.fromCodePoint(
        e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)),
      )
    return ENTITIES[e.toLowerCase()] ?? all
  })
}

/** A fragment as a document with its encoding declared (Word on Windows needs it for "µ"). */
export const htmlDocument = (body: string) =>
  `<html><head><meta charset="utf-8"></head><body>${body}</body></html>`
