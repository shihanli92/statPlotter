import { cellAt, type DataTable, type GridColumn } from '@ps/model'

// Keyboard moves in the grid beyond the arrow keys (roadmap 29), as in spreadsheets: ⌘/Ctrl +
// arrow to the edge of the data, Home / End along the row, ⌘/Ctrl + Home / End to the table's
// corners, Page Up / Down by a screen. With Shift each extends the selection.

/** Whether a cell holds anything (a number, text, a row title). */
function isFilled(t: DataTable, col: GridColumn | undefined, r: number): boolean {
  if (!col || r < 0 || r >= t.rowCount) return false
  const cell = cellAt(t, col, r)
  if ('title' in cell) return !!cell.title
  return cell.text !== undefined ? !!cell.text : cell.value !== null
}

/**
 * ⌘/Ctrl + arrow along one axis, from `from` towards `dir`, within 0…`last`: from a filled cell
 * whose neighbour is filled, to the last filled cell of that run; otherwise to the next filled
 * cell, or the end.
 */
export function edgeIndex(
  from: number,
  dir: 1 | -1,
  last: number,
  filled: (i: number) => boolean,
): number {
  const inside = (i: number) => i >= 0 && i <= last
  if (!inside(from + dir)) return from
  let i = from + dir
  if (filled(from) && filled(i)) {
    while (inside(i + dir) && filled(i + dir)) i += dir
    return i
  }
  while (!filled(i) && inside(i + dir)) i += dir
  return i
}

interface GridPos {
  r: number
  c: number
}

/**
 * Where a navigation key moves the focus, or null when it isn't one. `mod`: ⌘ (macOS) or Ctrl
 * held; `page`: rows a Page Up / Down moves; `lastRow`: the last row the grid shows.
 */
export function navigate(
  t: DataTable,
  cols: readonly GridColumn[],
  focus: GridPos,
  key: string,
  mod: boolean,
  page: number,
  lastRow: number,
): GridPos | null {
  const lastCol = cols.length - 1
  // Data rows end at the table's last row; from below it, the grid's own last row.
  const dataEnd = Math.max(t.rowCount - 1, 0)
  const rowEnd = focus.r > dataEnd ? lastRow : dataEnd
  const vertical = (dir: 1 | -1) =>
    edgeIndex(focus.r, dir, rowEnd, (r) => isFilled(t, cols[focus.c], r))
  const horizontal = (dir: 1 | -1) =>
    edgeIndex(focus.c, dir, lastCol, (c) => isFilled(t, cols[c], focus.r))
  switch (key) {
    case 'ArrowUp':
      return mod ? { r: vertical(-1), c: focus.c } : null
    case 'ArrowDown':
      return mod ? { r: vertical(1), c: focus.c } : null
    case 'ArrowLeft':
      return mod ? { r: focus.r, c: horizontal(-1) } : null
    case 'ArrowRight':
      return mod ? { r: focus.r, c: horizontal(1) } : null
    case 'Home':
      return mod ? { r: 0, c: 0 } : { r: focus.r, c: 0 }
    case 'End':
      return mod ? { r: dataEnd, c: lastCol } : { r: focus.r, c: lastCol }
    case 'PageUp':
      return { r: Math.max(0, focus.r - page), c: focus.c }
    case 'PageDown':
      return { r: Math.min(lastRow, focus.r + page), c: focus.c }
  }
  return null
}
