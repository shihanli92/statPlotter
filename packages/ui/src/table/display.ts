import { formatNumber } from '@ps/graph'
import type { CellView, DataTable, GridColumn, NumberDisplay, RichText } from '@ps/model'
import { cellDisplay } from './gridModel.ts'

// Column number formats in the grid (roadmap 29): a data set's `display` (and the X column's)
// changes only what the grid shows. Values, copies (⌘C), exports, graphs and analyses keep the
// full-precision numbers.

/** The display format of a grid column's numbers, if any. */
export function columnDisplay(t: DataTable, col: GridColumn): NumberDisplay | undefined {
  if (col.kind === 'data') return col.ds.display
  if (col.kind === 'x') return t.x?.display
  return undefined
}

/**
 * What a value cell shows: text as typed; numbers in full, or in the column's format (as rich
 * text: ×10ⁿ has a superscript); computed values rounded (result tables, calculated variables).
 */
export function cellShown(
  cell: CellView,
  display: NumberDisplay | undefined,
  computed: boolean,
): string | RichText {
  if (!display || cell.text !== undefined || cell.value === null || cell.calculated?.invalid)
    return cellDisplay(cell, computed)
  // 'auto' is the value as entered, only grouped in thousands.
  if (display.mode === 'auto') {
    const s = cellDisplay(cell, computed)
    return display.thousands && !/e/i.test(s) ? groupThousands(s) : s
  }
  return formatNumber(cell.value, display)
}

/** "1234567.25" → "1,234,567.25". */
export function groupThousands(s: string): string {
  const [int, frac] = s.split('.') as [string, string | undefined]
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac === undefined ? grouped : `${grouped}.${frac}`
}

/** Plain text of what a cell shows (superscripts as ^, for measuring and matching). */
export const shownText = (s: string | RichText): string =>
  typeof s === 'string' ? s : s.map((r) => (r.sup ? `^${r.text}` : r.text)).join('')

/** The choices of Format column…: `null` is full precision, as entered. */
export type DisplayMode = 'entered' | 'fixed' | 'scientific' | 'power10' | 'percent'

export interface DisplayChoice {
  mode: DisplayMode
  digits: number
  thousands: boolean
}

/** The dialog's choice for a stored format. */
export function choiceOf(d: NumberDisplay | undefined): DisplayChoice {
  if (!d) return { mode: 'entered', digits: 2, thousands: false }
  const mode = d.mode === 'auto' ? 'entered' : d.mode
  const digits = d.digits ?? (d.mode === 'scientific' ? 1 : 2)
  return { mode, digits, thousands: !!d.thousands }
}

/** The format stored for a choice (null: none, numbers in full). */
export function displayOf(c: DisplayChoice): NumberDisplay | null {
  const thousands =
    c.thousands && (c.mode === 'entered' || c.mode === 'fixed' || c.mode === 'percent')
  if (c.mode === 'entered') return thousands ? { mode: 'auto', thousands: true } : null
  return { mode: c.mode, digits: c.digits, ...(thousands ? { thousands: true } : {}) }
}
