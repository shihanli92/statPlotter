import { type ClipboardCell, cellOf } from '@ps/io'
import { type DataTable, type GridColumn, tidyNumber } from '@ps/model'
import { type PasteResult, pasteCommands, type Rect, selectionRows } from './gridModel.ts'

// Fill down / right and Fill series (roadmap 29). Fills go through the paste commands, so they
// follow the same rules as pasting the cells there: numbers stay numbers (text into a number
// column is refused), text variables take text, calculated variables refuse values, rows past
// the end grow the table. Exclusion is not copied.

const asFill = (r: PasteResult): PasteResult =>
  r.ok ? r : { ok: false, error: r.error.replace(/^Can't paste/, "Can't fill") }

/** The cells of one row of the selection as values (numbers, text, null). */
const rowValues = (t: DataTable, cols: GridColumn[], r: number, c0: number, c1: number) =>
  selectionRows(t, cols, { r0: r, r1: r, c0, c1 })[0]!.map((c) => cellOf(c).v as ClipboardCell)

/** Fill down: the selection's top cells copied into the rows below them. */
export function fillDownCommands(t: DataTable, cols: GridColumn[], sel: Rect): PasteResult {
  if (sel.r1 <= sel.r0) return { ok: true, commands: [] }
  const top = rowValues(t, cols, sel.r0, sel.c0, sel.c1)
  const grid = Array.from({ length: sel.r1 - sel.r0 }, () => top)
  return asFill(pasteCommands(t, cols, { r: sel.r0 + 1, c: sel.c0 }, grid, undefined, false))
}

/** Fill right: the selection's left cells copied into the columns right of them. */
export function fillRightCommands(t: DataTable, cols: GridColumn[], sel: Rect): PasteResult {
  if (sel.c1 <= sel.c0) return { ok: true, commands: [] }
  const grid: ClipboardCell[][] = []
  for (let r = sel.r0; r <= sel.r1; r++) {
    const [left] = rowValues(t, cols, r, sel.c0, sel.c0)
    grid.push(Array.from({ length: sel.c1 - sel.c0 }, () => left ?? null))
  }
  return asFill(pasteCommands(t, cols, { r: sel.r0, c: sel.c0 + 1 }, grid, undefined, false))
}

/**
 * A series: `linear` start, start + step, …; `multiply` start, start × factor, … (×10, ×½ for
 * dilutions); `log` from start to end evenly spaced on a log scale (both > 0).
 */
export type SeriesSpec =
  | { kind: 'linear'; start: number; step: number }
  | { kind: 'multiply'; start: number; factor: number }
  | { kind: 'log'; start: number; end: number }

/** `n` values of a series (15 significant digits, so 0.1 + 0.2 fills as 0.3); or an error. */
export function seriesValues(spec: SeriesSpec, n: number): number[] | string {
  if (!Number.isFinite(spec.start)) return 'Enter a start value.'
  const at = (i: number): number => {
    switch (spec.kind) {
      case 'linear':
        return spec.start + i * spec.step
      case 'multiply':
        return spec.start * spec.factor ** i
      case 'log':
        return n === 1
          ? spec.start
          : 10 ** (Math.log10(spec.start) + (i / (n - 1)) * Math.log10(spec.end / spec.start))
    }
  }
  if (spec.kind === 'linear' && !Number.isFinite(spec.step)) return 'Enter a step.'
  if (spec.kind === 'multiply' && !(Number.isFinite(spec.factor) && spec.factor !== 0))
    return 'Enter a factor other than zero.'
  if (spec.kind === 'log' && !(spec.start > 0 && spec.end > 0 && Number.isFinite(spec.end)))
    return 'A log series needs a start and an end above zero.'
  const values = Array.from({ length: n }, (_, i) => tidyNumber(at(i)))
  if (values.some((v) => !Number.isFinite(v))) return 'The series grows too large for a number.'
  // The ends of a log series are exactly the values entered.
  if (spec.kind === 'log' && n > 1) values[n - 1] = spec.end
  return values
}

/**
 * Fill series: every column of the selection gets the series down its rows, from the
 * selection's top row over its rows, or over `count` rows when given.
 */
export function fillSeriesCommands(
  t: DataTable,
  cols: GridColumn[],
  sel: Rect,
  spec: SeriesSpec,
  count?: number,
): PasteResult {
  const n = count ?? sel.r1 - sel.r0 + 1
  if (!(Number.isInteger(n) && n >= 1)) return { ok: false, error: 'Fill at least one row.' }
  const values = seriesValues(spec, n)
  if (typeof values === 'string') return { ok: false, error: values }
  const grid = values.map((v) => Array.from({ length: sel.c1 - sel.c0 + 1 }, () => v))
  return asFill(pasteCommands(t, cols, { r: sel.r0, c: sel.c0 }, grid, undefined, false))
}
