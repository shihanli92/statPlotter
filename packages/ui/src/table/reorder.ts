import type { Command } from '@ps/engine'
import {
  type CellView,
  type ColumnId,
  cellAt,
  type DataTable,
  type GridColumn,
  subLabel,
} from '@ps/model'

// Reordering a table (roadmap 29): sorting rows by up to three keys, moving rows and data sets.
// Each gives one engine command (`table.permuteRows`, `table.moveDataSets`), so graphs, point
// labels, brackets and analysis parameters naming rows follow, in one undo step.

/** A sort key: a grid column (row titles, X, a data set's subcolumn) and its direction. */
export interface SortKey {
  col: GridColumn
  descending: boolean
}

type SortValue = number | string | null

/** What a row sorts by in a column: its number, or its text (row titles, text variables). */
function sortValue(t: DataTable, col: GridColumn, r: number): SortValue {
  const cell = cellAt(t, col, r)
  if ('title' in cell) return cell.title?.trim() || null
  const v = cell as CellView
  if (v.text !== undefined) return v.text?.trim() || null
  return v.value
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * The order (`table.permuteRows`) sorting every row of the table by `keys`, the first deciding
 * first: numbers numerically, text case-insensitively with numbers inside it in numeric order
 * ("Mouse 2" before "Mouse 10"), blanks last in either direction, ties in their current order.
 */
export function sortOrder(t: DataTable, keys: readonly SortKey[]): number[] {
  const rows = Array.from({ length: t.rowCount }, (_, r) => r)
  const columns = keys.map((k) => {
    const values = rows.map((r) => sortValue(t, k.col, r))
    // Texts ranked once (roadmap 34e): a million rows compare numbers, not strings through the
    // collator; texts it holds equal share a rank, so ties stay ties.
    const distinct = [...new Set(values.filter((v): v is string => typeof v === 'string'))]
    distinct.sort((a, b) => collator.compare(a, b))
    const rank = new Map<string, number>()
    distinct.forEach((v, i) => {
      const prev = distinct[i - 1]
      rank.set(v, prev !== undefined && collator.compare(prev, v) === 0 ? rank.get(prev)! : i)
    })
    return {
      sign: k.descending ? -1 : 1,
      values: values.map((v) => (typeof v === 'string' ? { rank: rank.get(v)! } : v)),
    }
  })
  return rows.sort((a, b) => {
    for (const { sign, values } of columns) {
      const [va, vb] = [values[a]!, values[b]!]
      if (va === null || vb === null) {
        if (va !== vb) return va === null ? 1 : -1
        continue
      }
      // Numbers before texts; numbers numerically, texts by rank.
      const d =
        typeof va === 'number'
          ? typeof vb === 'number'
            ? va - vb
            : -1
          : typeof vb === 'number'
            ? 1
            : va.rank - vb.rank
      if (d !== 0) return sign * d
    }
    return a - b
  })
}

/** The sort command, or null when the rows are in that order already. */
export function sortCommand(t: DataTable, keys: readonly SortKey[]): Command | null {
  const order = sortOrder(t, keys)
  if (order.every((r, i) => r === i)) return null
  return { type: 'table.permuteRows', table: t.id, order }
}

/**
 * The order moving rows `r0`…`r1` (clipped to the table) so the first lands at `to`, a row
 * index among the other rows (0: top). Identity when nothing moves.
 */
export function moveRowsOrder(rowCount: number, r0: number, r1: number, to: number): number[] {
  const last = Math.min(r1, rowCount - 1)
  const all = Array.from({ length: rowCount }, (_, r) => r)
  if (r0 > last) return all
  const block = all.slice(r0, last + 1)
  const rest = all.slice(0, r0).concat(all.slice(last + 1))
  // concat, not spreading: a block of a million rows is more arguments than a call takes.
  const at = Math.max(0, Math.min(to, rest.length))
  return rest.slice(0, at).concat(block, rest.slice(at))
}

/** The command moving rows `r0`…`r1` to `to` (see `moveRowsOrder`); null when nothing moves. */
export function moveRowsCommand(t: DataTable, r0: number, r1: number, to: number): Command | null {
  const order = moveRowsOrder(t.rowCount, r0, r1, to)
  if (order.every((r, i) => r === i)) return null
  return { type: 'table.permuteRows', table: t.id, order }
}

/**
 * Where a dragged block of items `i0`…`i1` (rows, data sets) goes when dropped on item `d`:
 * before it when `d` is above or left of the block, after it when below or right, as an index
 * among the other items (`moveRowsOrder`, `table.moveDataSets`); null when dropped on itself.
 */
export function dropIndex(i0: number, i1: number, d: number): number | null {
  if (d >= i0 && d <= i1) return null
  return d < i0 ? d : d - (i1 - i0)
}

/** The data sets with a subcolumn among grid columns `c0`…`c1`, in table order. */
export function dataSetsIn(cols: readonly GridColumn[], c0: number, c1: number): ColumnId[] {
  const ids = new Set<ColumnId>()
  for (const col of cols.slice(c0, c1 + 1)) if (col.kind === 'data') ids.add(col.ds.id)
  return [...ids]
}

/**
 * The command moving data sets `ids` (a block) by `step` places among the others (−1: left), or
 * to index `to` among the others; null when nothing moves.
 */
export function moveDataSetsCommand(
  t: DataTable,
  ids: readonly ColumnId[],
  where: { step: number } | { to: number },
): Command | null {
  if (!ids.length) return null
  const moving = new Set<string>(ids)
  const first = t.dataSets.findIndex((d) => moving.has(d.id))
  const rest = t.dataSets.length - moving.size
  const to = Math.max(0, Math.min(rest, 'to' in where ? where.to : first + where.step))
  const next = t.dataSets.filter((d) => !moving.has(d.id))
  next.splice(to, 0, ...t.dataSets.filter((d) => moving.has(d.id)))
  if (next.every((d, i) => d === t.dataSets[i])) return null
  return { type: 'table.moveDataSets', table: t.id, ids: [...ids], to }
}

/** A grid column's name in lists (sort keys, Format column): "Group A", "Group A: Y2", "X". */
export function columnLabel(t: DataTable, col: GridColumn): string {
  if (col.kind === 'rowTitle') return 'Row titles'
  if (col.kind === 'x') {
    const title = t.x?.title || 'X'
    return col.sub === 0 ? title : `${title}: error`
  }
  const title = col.ds.title || `Data set ${col.dsIndex + 1}`
  const sub = subLabel(t, col)
  return sub ? `${title}: ${sub}` : title
}
