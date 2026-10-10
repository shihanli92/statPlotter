import {
  type AnalysisResult,
  formatResultValue,
  type ProjectSettings,
  type ResultBlock,
  type ResultSheet,
  type ResultValue,
} from '@ps/model'
import { type Cell, header, type Row, stackSections, title } from './cells.ts'
import { escapeHtml, toHtmlTable } from './html.ts'

/**
 * How results' numbers are written: as the results view shows them (rounded, P values as
 * "<0.0001", intervals as "lo to hi"), or in full (raw numbers; an interval as two numbers).
 * Either way Excel stores a number in full: "as displayed" gives it a number format showing the
 * digits the view shows, and only what Excel can't show that way (e.g. "<0.0001") becomes text.
 */
export type NumberMode = 'displayed' | 'full'

export interface ResultsExportOptions {
  mode?: NumberMode
  settings: Pick<ProjectSettings, 'pValueStyle' | 'pValueDigits'>
}

/**
 * The Excel number format showing a number as `text` shows it ("0.0123" → 0.0000, ".012" →
 * #.000, "1.235e-5" → 0.000E+00); null when no format does ("<0.0001", "—").
 */
export function displayFormat(text: string): string | null {
  const zeros = (d: string | undefined) => (d ? `.${'0'.repeat(d.length)}` : '')
  let m = /^-?\d+(?:\.(\d+))?$/.exec(text)
  if (m) return `0${zeros(m[1])}`
  m = /^-?\.(\d+)$/.exec(text)
  if (m) return `#${zeros(m[1])}`
  m = /^-?\d(?:\.(\d+))?e[+-]\d+$/.exec(text)
  if (m) return `0${zeros(m[1])}E+00`
  return null
}

/** A number in full: empty for NaN (no value), text for an infinite one. */
const fullNumber = (v: number): Cell =>
  Number.isFinite(v) ? v : Number.isNaN(v) ? null : v > 0 ? '∞' : '-∞'

/** A result value's cells: one, or two for an interval in full precision (lower, upper). */
export function resultCells(value: ResultValue, opts: ResultsExportOptions): Cell[] {
  const text = formatResultValue(value, opts.settings)
  switch (value.kind) {
    case 'number':
    case 'integer':
    case 'pvalue': {
      if (opts.mode === 'full') return [fullNumber(value.v)]
      const format = Number.isFinite(value.v) ? displayFormat(text) : null
      return [format ? { v: value.v, text, format } : text]
    }
    case 'interval':
      return opts.mode === 'full' ? [fullNumber(value.lo), fullNumber(value.hi)] : [text]
    default:
      return [text]
  }
}

/**
 * A block of results as rows, laid out as the results view shows it: its title, then label and
 * value (key-value blocks) or the column titles and rows (tables); a note is one line. In full
 * precision a table column holding intervals becomes two ("95% CI (lower)", "95% CI (upper)").
 */
export function blockRows(block: ResultBlock, opts: ResultsExportOptions): Row[] {
  const head: Row[] = block.type !== 'note' && block.title ? [[title(block.title)]] : []
  switch (block.type) {
    case 'note':
      return [[block.text]]
    case 'keyValue':
      return [...head, ...block.rows.map((r) => [r.label, ...resultCells(r.value, opts)])]
    case 'table': {
      const split = block.columns.map(
        (_, j) => opts.mode === 'full' && block.rows.some((r) => r[j]?.kind === 'interval'),
      )
      const columns = block.columns.flatMap((c, j) =>
        split[j] ? [header(`${c} (lower)`), header(`${c} (upper)`)] : [header(c)],
      )
      const rows = block.rows.map((r) =>
        r.flatMap((v, j) => {
          const cells = resultCells(v, opts)
          return split[j] && cells.length === 1 ? [cells[0]!, null] : cells
        }),
      )
      return [...head, columns, ...rows]
    }
  }
}

/** A results sheet's blocks, one under another with a blank row between. */
export const resultSheetRows = (sheet: ResultSheet, opts: ResultsExportOptions): Row[] =>
  stackSections(sheet.blocks.map((b) => ({ rows: blockRows(b, opts) })))

/**
 * A results sheet for a file: a heading (the analysis and sheet), the analysis' messages (e.g.
 * "2 values excluded"), then the blocks.
 */
export function resultSheetFileRows(
  heading: string,
  result: AnalysisResult,
  sheet: ResultSheet,
  opts: ResultsExportOptions,
): Row[] {
  const notes = result.diagnostics.map((d) => [d.message])
  return stackSections([{ title: heading, rows: notes }, { rows: resultSheetRows(sheet, opts) }])
}

/**
 * A results sheet as HTML, as displayed: a table per block, a paragraph per note. `guard`: as
 * `toHtmlTable`'s.
 */
export function resultSheetHtml(
  blocks: readonly ResultBlock[],
  opts: ResultsExportOptions,
  html: { guard?: boolean } = {},
): string {
  const displayed = { ...opts, mode: 'displayed' as const }
  return blocks
    .map((b) =>
      b.type === 'note'
        ? `<p>${escapeHtml(b.text)}</p>`
        : toHtmlTable(blockRows(b, displayed), html),
    )
    .join('<br>')
}
