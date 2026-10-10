import { z } from 'zod'
import { ColumnId, NodeId } from './ids.ts'
import { LimitFlag, LimitRule } from './limits.ts'
import { NumberDisplay, RichText } from './style.ts'

export const TableKind = z.enum([
  'column',
  'xy',
  'grouped',
  'contingency',
  'survival',
  'partsOfWhole',
  'multipleVariables',
  'nested',
])
export type TableKind = z.infer<typeof TableKind>

export const SummaryRole = z.enum([
  'mean',
  'sd',
  'sem',
  'cv',
  'n',
  'upper',
  'lower',
  'plusErr',
  'minusErr',
])
export type SummaryRole = z.infer<typeof SummaryRole>

/** The only allowed layouts for pre-computed summary data. Roles are in subcolumn order. */
export const SUMMARY_PRESETS = {
  meanSdN: ['mean', 'sd', 'n'],
  meanSemN: ['mean', 'sem', 'n'],
  meanCvN: ['mean', 'cv', 'n'],
  meanSd: ['mean', 'sd'],
  meanSem: ['mean', 'sem'],
  meanPlusMinus: ['mean', 'plusErr', 'minusErr'],
  meanUpperLower: ['mean', 'upper', 'lower'],
} as const satisfies Record<string, readonly SummaryRole[]>

export const SummaryPreset = z.enum([
  'meanSdN',
  'meanSemN',
  'meanCvN',
  'meanSd',
  'meanSem',
  'meanPlusMinus',
  'meanUpperLower',
])
export type SummaryPreset = z.infer<typeof SummaryPreset>

export const MAX_REPLICATES = 256

/** Grid column widths (CSS pixels) a table stores. */
export const MIN_COLUMN_WIDTH = 24
export const MAX_COLUMN_WIDTH = 1200

export const YFormat = z.discriminatedUnion('type', [
  z.object({ type: z.literal('replicates'), count: z.number().int().min(1).max(MAX_REPLICATES) }),
  z.object({ type: z.literal('summary'), preset: SummaryPreset }),
])
export type YFormat = z.infer<typeof YFormat>

export type SubcolumnRole = SummaryRole | 'value'

export function subcolumnRoles(format: YFormat): readonly SubcolumnRole[] {
  return format.type === 'replicates'
    ? Array.from({ length: format.count }, () => 'value' as const)
    : SUMMARY_PRESETS[format.preset]
}

export function subcolumnCount(format: YFormat): number {
  return format.type === 'replicates' ? format.count : SUMMARY_PRESETS[format.preset].length
}

/** A cell: a finite number, or null for empty. zod rejects NaN and ±Infinity. */
export const CellValue = z.number().nullable()
export type CellValue = z.infer<typeof CellValue>

/** The kinds of per-row arrays, by what their elements may be. */
export type RowArrayKind = 'cells' | 'text' | 'flags' | 'limits'

/** Arrays known to hold only what their kind may (`withKnownRowArrays`), while it runs. */
let knownRows: ReadonlyMap<unknown, RowArrayKind> | null = null

/**
 * Runs `f` (a parse of the schema) skipping the element checks of the per-row arrays in `known`
 * where they stand as an array of the kind they are listed with (audit 2, M2): arrays the store
 * checked when it stored them, which nothing writes in place (decision 674), are not checked
 * again on every edit of their table. Anywhere else (another kind's place) they are checked.
 */
export function withKnownRowArrays<T>(known: ReadonlyMap<unknown, RowArrayKind>, f: () => T): T {
  const outer = knownRows
  knownRows = known
  try {
    return f()
  } finally {
    knownRows = outer
  }
}

/**
 * A per-row array (cells, flags, text), checked in one loop and kept as it is (roadmap 34e): zod's
 * own array schema copies the array element by element, seconds for a table of a million rows.
 * The first wrong element is reported at its index, as zod's array would.
 */
function rowArray<T>(kind: RowArrayKind, ok: (v: unknown) => v is T, expected: string) {
  return z.custom<T[]>().superRefine((v, ctx) => {
    if (!Array.isArray(v)) {
      ctx.addIssue({ code: 'custom', message: 'Invalid input: expected array' })
      return
    }
    if (knownRows?.get(v) === kind) return
    for (let i = 0; i < v.length; i++) {
      if (!ok(v[i])) {
        ctx.addIssue({ code: 'custom', path: [i], message: `Invalid input: expected ${expected}` })
        return
      }
    }
  })
}

const isCell = (v: unknown): v is CellValue =>
  v === null || (typeof v === 'number' && Number.isFinite(v))
const isText = (v: unknown): v is string | null => v === null || typeof v === 'string'
const isFlag = (v: unknown): v is boolean => typeof v === 'boolean'
const isLimitFlag = (v: unknown): v is LimitFlag | null =>
  v === null || LimitFlag.safeParse(v).success

/** Cells by row: finite numbers, null for empty. */
export const CellValues = rowArray('cells', isCell, 'a finite number or null')
/** Text by row (text variables, row titles): null for empty. */
export const TextValues = rowArray('text', isText, 'text or null')

export const CellColumn = z.object({
  // Reserved so text columns (Multiple variables tables) can be added without a format change.
  type: z.literal('number').default('number'),
  values: CellValues,
  excluded: rowArray('flags', isFlag, 'true or false').optional(),
  /**
   * Roadmap 39: cells imported at a detection limit ("<0.5", "BLQ"), by row: the side and the
   * original text; the value is the substitute the table's `limits` rule gave (null: none).
   * Absent when no cell is flagged.
   */
  limit: rowArray('limits', isLimitFlag, 'a limit flag or null').optional(),
})
export type CellColumn = z.infer<typeof CellColumn>

/**
 * Formatted titles (roadmap 28): a title's rich form sits beside its plain text (`titleRich`,
 * `subcolumnTitlesRich`, `rowTitlesRich`), only when formatted and always spelling the plain
 * title, which everything else (analyses, results, exports, the clipboard) keeps using.
 */
export const DataSetColumn = z.object({
  id: ColumnId,
  title: z.string(),
  /** The title with formatting (superscripts, italics…); absent when plain. */
  titleRich: RichText.optional(),
  subcolumns: z.array(CellColumn),
  /**
   * Titles of the subcolumns, by index (nested tables: the subjects, e.g. "Mouse 1"; elsewhere
   * optional labels for replicates). Missing or null = untitled.
   */
  subcolumnTitles: z.array(z.string().nullable()).optional(),
  /** Formatted subcolumn titles by index (null or missing = plain). */
  subcolumnTitlesRich: z.array(RichText.nullable()).optional(),
  /**
   * Multiple-variables tables: a text (categorical) variable's values by row (null = empty). Its
   * numeric subcolumn stays empty; analyses see the values as `NormalizedDataSet.text`.
   */
  text: TextValues.optional(),
  /**
   * Multiple-variables tables: a calculated variable's formula (e.g. "=Weight/Height^2"). Its
   * values are derived when the table is read (normalization), never stored: the numeric
   * subcolumn stays empty.
   */
  formula: z.string().optional(),
  /** How the grid shows the numbers (roadmap 29): display only; values are kept in full. */
  display: NumberDisplay.optional(),
})
export type DataSetColumn = z.infer<typeof DataSetColumn>

export const XFormat = z.enum(['numbers', 'numbersWithError', 'dates', 'elapsed'])
export type XFormat = z.infer<typeof XFormat>

export const XColumn = z.object({
  title: z.string(),
  titleRich: RichText.optional(),
  xFormat: XFormat,
  subcolumns: z.array(CellColumn),
  /** How the grid shows X values (roadmap 29); absent = in full. */
  display: NumberDisplay.optional(),
})
export type XColumn = z.infer<typeof XColumn>

export interface Issue {
  path: (string | number)[]
  message: string
}

const TABLE_KINDS_WITH_X: readonly TableKind[] = ['xy', 'survival']

/** Y formats each table kind accepts. */
export function isYFormatAllowed(kind: TableKind, format: YFormat): boolean {
  switch (kind) {
    case 'column':
      // Column tables stack replicates down the rows, so side-by-side replicates make no sense.
      return format.type === 'summary' || format.count === 1
    case 'xy':
    case 'grouped':
      return true
    case 'nested':
      // Subcolumns are subjects and rows their replicate measurements: raw values only.
      return format.type === 'replicates'
    case 'contingency':
    case 'survival':
    case 'partsOfWhole':
    case 'multipleVariables':
      return format.type === 'replicates' && format.count === 1
  }
}

const X_SUBCOLUMNS: Record<XFormat, number> = {
  numbers: 1,
  numbersWithError: 2,
  dates: 1,
  elapsed: 1,
}

function checkCellColumn(col: CellColumn, rowCount: number, path: Issue['path'], out: Issue[]) {
  if (col.values.length !== rowCount) {
    out.push({
      path: [...path, 'values'],
      message: `expected ${rowCount} values, got ${col.values.length}`,
    })
  }
  if (col.excluded && col.excluded.length !== rowCount) {
    out.push({
      path: [...path, 'excluded'],
      message: `expected ${rowCount} exclusion flags, got ${col.excluded.length}`,
    })
  }
  if (col.limit && col.limit.length !== rowCount) {
    out.push({
      path: [...path, 'limit'],
      message: `expected ${rowCount} limit flags, got ${col.limit.length}`,
    })
  }
}

/** Structural invariants of a table. Used by the schema and by command tests. */
export function tableIssues(t: DataTableShape): Issue[] {
  const out: Issue[] = []

  if (!isYFormatAllowed(t.tableKind, t.yFormat)) {
    out.push({ path: ['yFormat'], message: `format not allowed for ${t.tableKind} tables` })
  }
  if (t.tableKind === 'column' && t.yFormat.type === 'summary' && t.rowCount !== 1) {
    out.push({
      path: ['rowCount'],
      message: 'column tables with summary data have exactly one row',
    })
  }
  if (t.rowTitles && t.rowTitles.length !== t.rowCount) {
    out.push({
      path: ['rowTitles'],
      message: `expected ${t.rowCount} row titles, got ${t.rowTitles.length}`,
    })
  }
  if (t.rowTitlesRich && (!t.rowTitles || t.rowTitlesRich.length !== t.rowCount)) {
    out.push({
      path: ['rowTitlesRich'],
      message: `expected ${t.rowCount} formatted row titles beside the row titles`,
    })
  }

  const needsX = TABLE_KINDS_WITH_X.includes(t.tableKind)
  if (needsX && !t.x)
    out.push({ path: ['x'], message: `${t.tableKind} tables require an X column` })
  if (!needsX && t.x) out.push({ path: ['x'], message: `${t.tableKind} tables have no X column` })
  if (t.x) {
    const expected = X_SUBCOLUMNS[t.x.xFormat]
    if (t.x.subcolumns.length !== expected) {
      out.push({ path: ['x', 'subcolumns'], message: `expected ${expected} X subcolumns` })
    }
    t.x.subcolumns.forEach((c, i) => {
      checkCellColumn(c, t.rowCount, ['x', 'subcolumns', i], out)
    })
  }

  const nSub = subcolumnCount(t.yFormat)
  const seen = new Set<string>()
  t.dataSets.forEach((ds, i) => {
    if (seen.has(ds.id))
      out.push({ path: ['dataSets', i, 'id'], message: `duplicate column id ${ds.id}` })
    seen.add(ds.id)
    if (ds.subcolumns.length !== nSub) {
      out.push({
        path: ['dataSets', i, 'subcolumns'],
        message: `expected ${nSub} subcolumns, got ${ds.subcolumns.length}`,
      })
    }
    ds.subcolumns.forEach((c, j) => {
      checkCellColumn(c, t.rowCount, ['dataSets', i, 'subcolumns', j], out)
    })
    if (ds.text !== undefined || ds.formula !== undefined) {
      if (t.tableKind !== 'multipleVariables')
        out.push({
          path: ['dataSets', i],
          message: 'text and calculated variables belong to multiple-variables tables',
        })
      if (ds.text !== undefined && ds.formula !== undefined)
        out.push({ path: ['dataSets', i], message: 'a variable is text or calculated, not both' })
      if (ds.text !== undefined && ds.text.length !== t.rowCount)
        out.push({
          path: ['dataSets', i, 'text'],
          message: `expected ${t.rowCount} text values, got ${ds.text.length}`,
        })
    }
  })

  return out
}

/** A table's per-row arrays (cells, exclusions, limit flags, text, row titles) by kind. */
export function rowArraysOf(t: DataTableShape, out = new Map<unknown, RowArrayKind>()) {
  const column = (c: CellColumn) => {
    out.set(c.values, 'cells')
    if (c.excluded) out.set(c.excluded, 'flags')
    if (c.limit) out.set(c.limit, 'limits')
  }
  for (const c of t.x?.subcolumns ?? []) column(c)
  for (const ds of t.dataSets) {
    for (const c of ds.subcolumns) column(c)
    if (ds.text) out.set(ds.text, 'text')
  }
  if (t.rowTitles) out.set(t.rowTitles, 'text')
  return out
}

const DataTableObject = z.object({
  kind: z.literal('table'),
  id: NodeId,
  name: z.string(),
  // Fixed at creation; changing kind is an explicit conversion command.
  tableKind: TableKind,
  // Shared by every data set column in the table.
  yFormat: YFormat,
  rowCount: z.number().int().min(0),
  rowTitles: TextValues.nullable(),
  /** Formatted row titles by row (null = plain), spliced with the rows; absent when none. */
  rowTitlesRich: z.array(RichText.nullable()).optional(),
  x: XColumn.nullable(),
  dataSets: z.array(DataSetColumn),
  notes: z.string().default(''),
  /**
   * Grid column widths in CSS pixels (roadmap 29), keyed by `columnWidthKey`: a data set's id
   * (each of its subcolumns), 'x' or 'rowTitle'. Absent = sized to the content.
   */
  columnWidths: z
    .record(z.string(), z.number().min(MIN_COLUMN_WIDTH).max(MAX_COLUMN_WIDTH))
    .optional(),
  /**
   * Roadmap 34f: a multiple-variables table of cells (single-cell or cytometry data), whose graphs
   * offer only what scales with its rows (no mark per row within categories). Absent: automatic,
   * on above `CELLS_TABLE_ROWS` rows (`isCellsTable`); true or false: the user's choice.
   */
  cellsTable: z.boolean().optional(),
  /**
   * Roadmap 39: how cells flagged at a detection limit (`CellColumn.limit`) are substituted (the
   * rule they were imported with, or changed since in Table › Limits…). Absent: none flagged.
   */
  limits: LimitRule.optional(),
})
type DataTableShape = z.infer<typeof DataTableObject>

export const DataTable = DataTableObject.superRefine((t, ctx) => {
  for (const issue of tableIssues(t)) ctx.addIssue({ code: 'custom', ...issue })
})
export type DataTable = z.infer<typeof DataTable>

/**
 * Roadmap 34f: rows above which a multiple-variables table is a cells table unless the user says
 * otherwise (decision 430): a swarm or a before–after graph of more rows takes seconds to lay out
 * and draws an unreadable mass.
 */
export const CELLS_TABLE_ROWS = 20_000

/**
 * Whether a table is a cells table (roadmap 34f): a multiple-variables table set to be one, or of
 * more than `CELLS_TABLE_ROWS` rows when not set either way.
 */
export const isCellsTable = (
  t: Pick<DataTable, 'tableKind' | 'rowCount'> & { cellsTable?: boolean },
): boolean => t.tableKind === 'multipleVariables' && (t.cellsTable ?? t.rowCount > CELLS_TABLE_ROWS)
