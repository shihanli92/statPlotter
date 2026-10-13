import { newColumnId, newNodeId } from './ids.ts'
import { CURRENT_SCHEMA_VERSION, type Project, ProjectSettings } from './project.ts'
import {
  type CellColumn,
  type DataSetColumn,
  type DataTable,
  subcolumnCount,
  type TableKind,
  type YFormat,
} from './table.ts'

/** The app's version (roadmap versioning, CLAUDE.md): 0.<code audits>.<phases since the last audit>. */
export const APP_VERSION = '0.3.11'

export function createProject(title = 'Untitled', now = new Date()): Project {
  const iso = now.toISOString()
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { title, created: iso, modified: iso, appVersion: APP_VERSION },
    settings: ProjectSettings.parse({}),
    nodes: {},
    order: [],
  }
}

export const emptyCellColumn = (rows: number): CellColumn => ({
  type: 'number',
  values: Array.from({ length: rows }, () => null),
})

/** 0 → 'A', 25 → 'Z', 26 → 'AA' (spreadsheet column letters). */
export function columnLetters(index: number): string {
  let s = ''
  let i = index
  do {
    s = String.fromCharCode(65 + (i % 26)) + s
    i = Math.floor(i / 26) - 1
  } while (i >= 0)
  return s
}

/** 'Group A', 'Group B', … 'Group Z', 'Group AA', … */
export const defaultColumnTitle = (index: number): string => `Group ${columnLetters(index)}`

export function createDataSetColumn(format: YFormat, rows: number, title: string): DataSetColumn {
  return {
    id: newColumnId(),
    title,
    subcolumns: Array.from({ length: subcolumnCount(format) }, () => emptyCellColumn(rows)),
  }
}

export interface NewTableOptions {
  name?: string
  tableKind?: TableKind
  yFormat?: YFormat
  columns?: number
  rows?: number
}

/** Creates an empty table of any kind (survival and XY tables get an X column). */
export function createTable(opts: NewTableOptions = {}): DataTable {
  const tableKind = opts.tableKind ?? 'column'
  const yFormat = opts.yFormat ?? { type: 'replicates', count: 1 }
  const rows = tableKind === 'column' && yFormat.type === 'summary' ? 1 : (opts.rows ?? 10)
  const columns = opts.columns ?? 3
  const needsX = tableKind === 'xy' || tableKind === 'survival'
  return {
    kind: 'table',
    id: newNodeId(),
    name: opts.name ?? 'Data 1',
    tableKind,
    yFormat,
    rowCount: rows,
    // Grouped, contingency and parts-of-whole tables are organized by row (a category per row),
    // so they show row titles from the start.
    rowTitles:
      tableKind === 'grouped' || tableKind === 'contingency' || tableKind === 'partsOfWhole'
        ? Array.from({ length: rows }, (_, i) => `Row ${i + 1}`)
        : null,
    x: needsX
      ? {
          title: tableKind === 'survival' ? 'Days elapsed' : 'X',
          xFormat: 'numbers',
          subcolumns: [emptyCellColumn(rows)],
        }
      : null,
    dataSets: Array.from({ length: columns }, (_, i) =>
      createDataSetColumn(yFormat, rows, defaultColumnTitle(i)),
    ),
    notes: '',
  }
}
