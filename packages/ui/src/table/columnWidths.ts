import {
  cellAt,
  columnWidthKey,
  type DataTable,
  type GridColumn,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  richPlain,
  titleRuns,
} from '@ps/model'
import { cellShown, columnDisplay, shownText } from './display.ts'
import { subLabel } from './gridModel.ts'

// Grid column widths (roadmap 29): dragged at a header's right edge, fitted to the content by a
// double-click there, stored per table (`DataTable.columnWidths`, CSS pixels) under
// `columnWidthKey` (a data set's subcolumns share its width).

/** Cell padding and borders around the text (see `.grid td` in styles.css), plus the * mark. */
const CELL_EXTRA = 20

/** Rows measured when fitting (a fit reads every row up to this many). */
const FIT_ROWS = 20_000

/** A width inside the stored range. */
export const clampWidth = (w: number) =>
  Math.round(Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, w)))

/** The stored width of a grid column, if any. */
export const storedWidth = (t: DataTable, col: GridColumn): number | undefined =>
  t.columnWidths?.[columnWidthKey(col)]

/**
 * The width fitting a column group's content: the widest cell of its subcolumns (as shown, with
 * the column's number format) and its titles, measured by `measure` (text, bold) in pixels.
 */
export function fitWidth(
  t: DataTable,
  cols: readonly GridColumn[],
  key: string,
  measure: (text: string, bold: boolean) => number,
): number {
  const group = cols.filter((c) => columnWidthKey(c) === key)
  let widest = 0
  const add = (text: string | null | undefined, bold = false, share = 1) => {
    if (text) widest = Math.max(widest, measure(text, bold) / share)
  }
  for (const col of group) {
    // A data set's title spans its subcolumns: each needs its share of it.
    if (col.kind === 'data' && col.sub === 0)
      add(richPlain(titleRuns(col.ds.title, col.ds.titleRich)), true, group.length)
    if (col.kind === 'x') add(t.x?.title, true)
    add(subLabel(t, col), true)
    const display = columnDisplay(t, col)
    for (let r = 0; r < Math.min(t.rowCount, FIT_ROWS); r++) {
      const cell = cellAt(t, col, r)
      add('title' in cell ? cell.title : shownText(cellShown(cell, display, false)))
    }
  }
  return clampWidth(widest + CELL_EXTRA)
}
