import { type FormulaValues, tableFormulas } from './formula.ts'
import type { LimitFlag } from './limits.ts'
import {
  type DataSetColumn,
  type DataTable,
  type SubcolumnRole,
  subcolumnCount,
  subcolumnRoles,
} from './table.ts'

// A table as the grid shows it: its columns (row titles, X, each data set's subcolumns), the
// header labels and each cell. Shared by the grid editor (ui) and the exporters (io), so an
// exported table has the grid's columns and titles.

/** One visual column of the grid (the row-number gutter is not a column). */
export type GridColumn =
  | { kind: 'rowTitle' }
  | { kind: 'x'; sub: number }
  | { kind: 'data'; ds: DataSetColumn; dsIndex: number; sub: number; role: SubcolumnRole }

export function gridColumns(t: DataTable): GridColumn[] {
  const cols: GridColumn[] = []
  if (t.rowTitles) cols.push({ kind: 'rowTitle' })
  for (let sub = 0; sub < (t.x?.subcolumns.length ?? 0); sub++) cols.push({ kind: 'x', sub })
  const roles = subcolumnRoles(t.yFormat)
  t.dataSets.forEach((ds, dsIndex) => {
    roles.forEach((role, sub) => {
      cols.push({ kind: 'data', ds, dsIndex, sub, role })
    })
  })
  return cols
}

const ROLE_LABELS: Record<SubcolumnRole, string> = {
  value: '',
  mean: 'Mean',
  sd: 'SD',
  sem: 'SEM',
  cv: 'CV',
  n: 'N',
  upper: 'Upper',
  lower: 'Lower',
  plusErr: '+Error',
  minusErr: '−Error',
}

/**
 * Second header row label, e.g. 'Mean', 'Y2'; empty when a data set has a single subcolumn.
 * Nested tables name their subjects there (default "Subject 1"…), and subcolumns titled in any
 * table show their titles.
 */
export function subLabel(t: DataTable, col: GridColumn): string {
  if (col.kind !== 'data') return ''
  if (col.role !== 'value') return ROLE_LABELS[col.role]
  const title = col.ds.subcolumnTitles?.[col.sub]
  if (title) return title
  if (t.tableKind === 'nested') return defaultSubjectTitle(col.sub)
  return subcolumnCount(t.yFormat) > 1 ? `Y${col.sub + 1}` : ''
}

export const defaultSubjectTitle = (sub: number) => `Subject ${sub + 1}`

/**
 * The key a grid column's width is stored under (`DataTable.columnWidths`): a data set's id (all
 * its subcolumns), 'x' (all X subcolumns) or 'rowTitle'.
 */
export const columnWidthKey = (col: GridColumn): string =>
  col.kind === 'data' ? col.ds.id : col.kind

/** Whether the grid shows the second header row (subcolumn labels). */
export function hasSubHeader(t: DataTable, cols: readonly GridColumn[]): boolean {
  return t.tableKind === 'nested' || cols.some((c) => subLabel(t, c) !== '')
}

export interface CellView {
  value: number | null
  excluded: boolean
  /** A text variable's cell (multiple-variables tables): its text; `value` is null. */
  text?: string | null
  /**
   * A calculated variable's cell: the value its formula gives (read-only); `invalid` when its
   * inputs are there but the result isn't a finite number (e.g. ln of a negative number).
   */
  calculated?: { invalid: boolean }
  /** Roadmap 39: imported at a detection limit (the value is its substitute). */
  limit?: LimitFlag
}

/** What a variable of a multiple-variables table holds. */
export type VariableKind = 'number' | 'text' | 'calculated'
export const variableKind = (ds: DataSetColumn): VariableKind =>
  ds.text ? 'text' : ds.formula !== undefined ? 'calculated' : 'number'

const invalidSets = new WeakMap<FormulaValues, Set<number>>()
const invalidRows = (f: FormulaValues) => {
  let set = invalidSets.get(f)
  if (!set) {
    set = new Set(f.invalidRows)
    invalidSets.set(f, set)
  }
  return set
}

export function cellAt(
  t: DataTable,
  col: GridColumn,
  row: number,
): CellView | { title: string | null } {
  if (col.kind === 'rowTitle') return { title: t.rowTitles?.[row] ?? null }
  if (col.kind === 'data' && col.ds.text)
    return { value: null, excluded: false, text: col.ds.text[row] ?? null }
  if (col.kind === 'data' && col.ds.formula !== undefined) {
    const f = tableFormulas(t).get(col.ds.id)
    // A formula giving text (roadmap 38) shows its text.
    if (f?.text)
      return {
        value: null,
        excluded: false,
        text: f.text[row] ?? null,
        calculated: { invalid: false },
      }
    const v = f?.values[row]
    return {
      value: v === undefined || Number.isNaN(v) ? null : v,
      excluded: false,
      calculated: { invalid: !!f && invalidRows(f).has(row) },
    }
  }
  const c = col.kind === 'x' ? t.x!.subcolumns[col.sub]! : col.ds.subcolumns[col.sub]!
  const limit = c.limit?.[row]
  return {
    value: c.values[row] ?? null,
    excluded: !!c.excluded?.[row],
    ...(limit ? { limit } : {}),
  }
}
