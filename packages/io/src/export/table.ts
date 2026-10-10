import {
  cellAt,
  type DataTable,
  type GridColumn,
  gridColumns,
  hasSubHeader,
  subLabel,
} from '@ps/model'
import { type Cell, header, type Row } from './cells.ts'

export interface TableExportOptions {
  /** Excluded values: kept and marked (grey italic in Excel; the default), or left blank. */
  excluded?: 'mark' | 'blank'
  /** Only these data sets, in this order (a graph's). */
  dataSets?: readonly string[]
  /** Only these rows, in this order (a graph's row slice). */
  rows?: readonly number[]
}

/** The X column's subcolumn labels: the value, then its error bar (X with error). */
const X_LABELS = ['X', 'X error']

/**
 * A data table as rows, laid out as the grid shows it: the data set titles (and the X title) as
 * the first header row, subcolumn labels (Y1 Y2…, Mean / SD / N, subjects) as a second when the
 * grid has one, then the values: numbers in full, text variables as text, row titles in the first
 * column. Calculated variables give their values (none where the formula gives no number).
 */
export function tableRows(t: DataTable, opts: TableExportOptions = {}): Row[] {
  const table = opts.dataSets
    ? {
        ...t,
        dataSets: opts.dataSets.flatMap((k) => t.dataSets.find((d) => d.id === k) ?? []),
      }
    : t
  const cols = gridColumns(table)
  // A data set's title over its first subcolumn, the X title over X.
  const titles = cols.map((c) =>
    header(c.kind !== 'rowTitle' && c.sub === 0 ? (c.kind === 'x' ? t.x!.title : c.ds.title) : ''),
  )
  const out: Row[] = [titles]
  if (hasSubHeader(table, cols) || (t.x?.subcolumns.length ?? 0) > 1) {
    const xSubs = (t.x?.subcolumns.length ?? 0) > 1
    out.push(
      cols.map((c) =>
        header(c.kind === 'x' ? (xSubs ? X_LABELS[c.sub]! : '') : subLabel(table, c)),
      ),
    )
  }
  const rows = opts.rows ?? Array.from({ length: t.rowCount }, (_, r) => r)
  for (const r of rows) out.push(cols.map((c) => valueCell(table, c, r, opts.excluded ?? 'mark')))
  return out
}

function valueCell(t: DataTable, col: GridColumn, r: number, excluded: 'mark' | 'blank'): Cell {
  const cell = cellAt(t, col, r)
  if ('title' in cell) return cell.title
  if (cell.text !== undefined) return cell.text
  if (!cell.excluded || cell.value === null) return cell.value
  return excluded === 'blank' ? null : { v: cell.value, excluded: true }
}
