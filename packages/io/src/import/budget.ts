import { MAX_TOTAL_BYTES } from '../zip.ts'
import { ImportError } from './errors.ts'

/** Most cells the sheets of one import (a workbook, or a .zip of files) may hold, padded. */
export const MAX_IMPORT_CELLS = 20_000_000

/**
 * What one import may still use (audit 2 X6): cells of the sheets' padded grids, counted before
 * a grid is made, and bytes to inflate, shared by an archive and the workbooks inside it.
 */
export interface ImportBudget {
  cells: number
  bytes: number
}

export const importBudget = (): ImportBudget => ({
  cells: MAX_IMPORT_CELLS,
  bytes: MAX_TOTAL_BYTES,
})

/**
 * A delimited file on its own (no budget: a large one may well pass 20 million cells) may pad to
 * at most this many times the cells its text holds once past `MAX_IMPORT_CELLS`: one very long
 * line over many short ones pads to billions of empty cells from a few megabytes (audit 2,
 * decision 720). Real tables are near rectangular (ragged ones pad to about twice their cells).
 */
export const MAX_PADDING = 4

/**
 * Refuses a sheet whose padded grid (`rows` × `cols`) is past `MAX_IMPORT_CELLS` and more than
 * `MAX_PADDING` times the `cells` it holds, before the grid is made.
 */
export function checkPadding(name: string, rows: number, cols: number, cells: number) {
  const padded = rows * cols
  if (padded <= MAX_IMPORT_CELLS || padded <= MAX_PADDING * cells) return
  throw new ImportError(
    `Sheet "${name}" is too large to import (${rows} rows × ${cols} columns, almost all of them empty: one line is far longer than the others).`,
  )
}

/** Takes a sheet's padded grid from the budget, or refuses it (nothing is taken). */
export function takeCells(budget: ImportBudget, name: string, rows: number, cols: number) {
  const cells = rows * cols
  if (cells <= budget.cells) {
    budget.cells -= cells
    return
  }
  const others =
    cells <= MAX_IMPORT_CELLS
      ? `; with the sheets before it, more than ${MAX_IMPORT_CELLS.toLocaleString('en-US')} cells`
      : ''
  throw new ImportError(
    `Sheet "${name}" is too large to import (${rows} rows × ${cols} columns${others}).`,
  )
}
