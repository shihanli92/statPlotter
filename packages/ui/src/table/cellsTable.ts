import type { Command } from '@ps/engine'
import { CELLS_TABLE_ROWS, type DataTable } from '@ps/model'

// Cells tables (roadmap 34f, decision 430): a multiple-variables table of single-cell or cytometry
// data, whose graphs offer only what scales with its rows. On by itself above `CELLS_TABLE_ROWS`
// rows; the table view's checkbox and View menu, and both import dialogs, set it.

export const CELLS_TABLE_LABEL = 'Cells table (single-cell / cytometry)'

export const CELLS_TABLE_HINT = `Graphs offer only what scales to many rows: scatters, violins, boxes, histograms, means and counts, no point per row within categories (on by itself above ${CELLS_TABLE_ROWS.toLocaleString('en-US')} rows)`

/** Whether an import of `rows` rows is a cells table unless the user says otherwise. */
export const cellsTableByDefault = (rows: number): boolean => rows > CELLS_TABLE_ROWS

/**
 * The setting of a table made cells table or not: absent (automatic) when that is what its rows
 * make it, so a table that grows past the threshold later still follows it.
 */
export const cellsTableSetting = (rows: number, on: boolean): boolean | undefined =>
  on === cellsTableByDefault(rows) ? undefined : on

/** The command making a table a cells table or not (`cellsTableSetting`). */
export function cellsTableCommand(table: Pick<DataTable, 'id' | 'rowCount'>, on: boolean): Command {
  return {
    type: 'table.setCellsTable',
    table: table.id,
    on: cellsTableSetting(table.rowCount, on) ?? null,
  }
}

// Asking on import (decision 456): a multiple-variables table of more than `CELLS_PROMPT_ROWS`
// rows is imported only once the user has said whether it is a cells table — a popup on Import
// (the large-CSV import: once the file is read and its rows are known), the cells table the
// default answer. Up to 5,000 rows the import dialog's checkbox decides (off by default: below
// 20,000 rows). The automatic rule (above `CELLS_TABLE_ROWS`, 20,000) still applies to tables
// never asked and to tables that grow later: the answer is stored as `table.setCellsTable`
// stores it, absent where it is what the rows give.

/** Rows above which importing a multiple-variables table asks whether it is a cells table. */
export const CELLS_PROMPT_ROWS = 5_000

/** Whether importing this table asks whether it is a cells table. */
export const needsCellsPrompt = (t: Pick<DataTable, 'tableKind' | 'rowCount'>): boolean =>
  t.tableKind === 'multipleVariables' && t.rowCount > CELLS_PROMPT_ROWS

/** The popup's answer: a cells table, an ordinary one, or nothing imported. */
export type CellsChoice = 'cells' | 'ordinary' | 'cancel'

/** The table an import creates for the popup's answer (`cellsTableSetting`); null on Cancel. */
export function withCellsChoice(table: DataTable, choice: CellsChoice): DataTable | null {
  if (choice === 'cancel') return null
  const setting = cellsTableSetting(table.rowCount, choice === 'cells')
  const { cellsTable: _, ...rest } = table
  return setting === undefined ? rest : { ...rest, cellsTable: setting }
}

/** The popup's title: "Large table: 16,171 rows × 51 variables". */
export function cellsPromptTitle(t: Pick<DataTable, 'rowCount' | 'dataSets'>): string {
  const n = (v: number) => v.toLocaleString('en-US')
  const vars = t.dataSets.length
  return `Large table: ${n(t.rowCount)} rows × ${n(vars)} variable${vars === 1 ? '' : 's'}`
}

/** The popup's answers, as its buttons say them and what each means. */
export const CELLS_PROMPT_CELLS = {
  label: 'Treat as a cells table',
  detail:
    '(recommended for single-cell / cytometry data): the graph builder offers only plots that scale, and previews use a sample.',
}
export const CELLS_PROMPT_ORDINARY = {
  label: 'Import as an ordinary table',
  detail: ': every plot is offered, including a point or line per row (slow with many rows).',
}
