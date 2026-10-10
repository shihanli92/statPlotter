import { parseNumber } from '../numbers.ts'
import type { SheetCell } from './sheet.ts'

/** A cell holding something: not empty and not only spaces. */
export const filled = (v: SheetCell | undefined) =>
  v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '')

/** Text that isn't only spaces. */
export const isText = (v: SheetCell | undefined): v is string =>
  typeof v === 'string' && v.trim() !== ''

/** Unicode spaces (non-breaking, thin…), tabs and line breaks as one plain space, trimmed. */
export const clean = (s: string) => s.replace(/[\s  -​ 　]+/g, ' ').trim()

/** A cell as a title: its text cleaned, null when that is empty. */
export const cellTitle = (cell: SheetCell | undefined): string | null =>
  cell === null || cell === undefined ? null : clean(String(cell)) || null

/** Tokens that mean "no value" in exported data (R, Excel, SAS…); imported as empty cells. */
export const MISSING = new Set(['na', 'n/a', '#n/a', 'nan', 'null', '.'])

/** A finite number or numeric text; anything else is null. */
export const asNumber = (v: SheetCell | undefined): number | null =>
  typeof v === 'number'
    ? Number.isFinite(v)
      ? v
      : null
    : typeof v === 'string'
      ? parseNumber(v)
      : null

/**
 * A data cell as a number (`asNumber`), calling `bad` when it holds something else that isn't a
 * missing-value mark (text, TRUE / FALSE): imports count those as non-numeric.
 */
export function readNumberCell(cell: SheetCell | undefined, bad: () => void): number | null {
  const v = asNumber(cell)
  if (
    v === null &&
    (typeof cell === 'boolean' ||
      (typeof cell === 'string' && !MISSING.has(cell.trim().toLowerCase())))
  )
    bad()
  return v
}
