import {
  type AnalysisResult,
  type CellColumn,
  type ColumnId,
  type DataSetColumn,
  type DataTable,
  type Diagnostic,
  ID_PATTERN,
  type NodeId,
  type NormalizedDataSet,
  type ResultBlock,
  type RunContext,
  type TableKind,
  type YFormat,
} from '@ps/model'
import { result } from './common.ts'

// ---------------------------------------------------------------------------------------------
// Tables produced by data-processing analyses (Phase 13, `AnalysisResult.table`).
//
// Data set ids must be stable across runs: a data set that comes from one input data set keeps
// that data set's key as its id (so a graph of the transformed table keeps its references when
// the params change); a data set made from several inputs, or from a row, gets a hash of what
// defines it (`stableId`). The table's node id is a placeholder (the engine addresses the table
// by the analysis node's id).
// ---------------------------------------------------------------------------------------------

/** FNV-1a (32-bit) of a string from a given offset basis. */
function fnv1a(s: string, basis: number): number {
  let h = basis >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * A deterministic data set id from the parts that define it. One part that is already a valid
 * id (a column id of the source) is kept as is; anything else is hashed to 12 characters of
 * [0-9a-z].
 */
export function stableId(...parts: readonly string[]): ColumnId {
  if (parts.length === 1 && ID_PATTERN.test(parts[0]!) && parts[0]!.length <= 32)
    return parts[0] as ColumnId
  const s = parts.join('\u0000')
  const a = fnv1a(s, 0x811c9dc5).toString(36).padStart(7, '0').slice(-6)
  const b = fnv1a(s, 0x050c5d1f).toString(36).padStart(7, '0').slice(-6)
  return `${a}${b}` as ColumnId
}

/** NaN / ±Infinity → null (the document stores only finite numbers). */
function toCells(values: ArrayLike<number>, rowCount: number): CellColumn {
  const out: (number | null)[] = new Array(rowCount)
  for (let i = 0; i < rowCount; i++) {
    const v = i < values.length ? values[i]! : Number.NaN
    out[i] = Number.isFinite(v) ? v : null
  }
  return { type: 'number', values: out }
}

export interface OutDataSet {
  id: string
  title: string
  /** One array per subcolumn (replicates), or the roles of `yFormat` for summary tables. */
  subcolumns: readonly ArrayLike<number>[]
  /** Multiple-variables tables: a text variable's values by row (its subcolumns stay empty). */
  text?: readonly (string | null)[]
}

interface OutTable {
  name: string
  tableKind: TableKind
  rowCount: number
  rowTitles: readonly (string | null)[] | null
  x: { title: string; values: ArrayLike<number> } | null
  dataSets: readonly OutDataSet[]
  /** Default: replicates, as many as the widest data set. */
  yFormat?: YFormat
  notes?: string
}

export function buildTable(input: readonly NormalizedDataSet[], t: OutTable): DataTable {
  const reps = Math.max(1, ...t.dataSets.map((d) => d.subcolumns.length))
  const yFormat: YFormat = t.yFormat ?? { type: 'replicates', count: reps }
  const width = yFormat.type === 'replicates' ? yFormat.count : t.dataSets[0]?.subcolumns.length
  const dataSets: DataSetColumn[] = t.dataSets.map((d) => ({
    id: d.id as ColumnId,
    title: d.title,
    subcolumns: Array.from({ length: width ?? 1 }, (_, j) =>
      toCells(d.subcolumns[j] ?? [], t.rowCount),
    ),
    ...(d.text ? { text: Array.from({ length: t.rowCount }, (_, r) => d.text![r] ?? null) } : {}),
  }))
  return {
    kind: 'table',
    id: (input[0]?.ref.node ?? 'result') as NodeId,
    name: t.name,
    tableKind: t.tableKind,
    yFormat,
    rowCount: t.rowCount,
    rowTitles: t.rowTitles
      ? Array.from({ length: t.rowCount }, (_, r) => t.rowTitles![r] ?? null)
      : null,
    x: t.x
      ? { title: t.x.title, xFormat: 'numbers', subcolumns: [toCells(t.x.values, t.rowCount)] }
      : null,
    dataSets,
    notes: t.notes ?? '',
  }
}

/** Kind of the source: from the run context, else guessed from the data. */
export function sourceKind(
  input: readonly NormalizedDataSet[],
  context: RunContext | undefined,
): TableKind {
  if (context) return context.tableKind
  if (input.some((d) => d.x)) return 'xy'
  if (input.some((d) => d.data.shape === 'replicates' && d.data.reps.length > 1)) return 'grouped'
  return 'column'
}

/** The source's X column (XY tables), for tables that keep the source's rows. */
export function sourceX(
  input: readonly NormalizedDataSet[],
  context: RunContext | undefined,
): { title: string; values: Float64Array } | null {
  const x = input.find((d) => d.x)?.x
  return x ? { title: context?.xTitle ?? 'X', values: x } : null
}

/** Row label for result sheets: row title, else X, else the row number. */
export function rowLabel(input: readonly NormalizedDataSet[], r: number): string {
  const t = input[0]?.rowTitles?.[r]
  if (t) return t
  const x = input.find((d) => d.x)?.x?.[r]
  if (x !== undefined && Number.isFinite(x)) return `X = ${x}`
  return `Row ${r + 1}`
}

/** A summary data set's columns. */
export interface SummaryCols {
  mean: ArrayLike<number>
  sd: ArrayLike<number>
  sem: ArrayLike<number>
  n: ArrayLike<number>
}

/**
 * Summary data as a table: mean, SD, N (`meanSdN`), or mean, SEM, N when no SD is known (SEM
 * entered without N).
 */
function summaryFormat(cols: readonly SummaryCols[]): {
  yFormat: YFormat
  pick: (c: SummaryCols) => ArrayLike<number>[]
} {
  const anySd = cols.some((c) => Array.from(c.sd).some(Number.isFinite))
  const anySem = cols.some((c) => Array.from(c.sem).some(Number.isFinite))
  if (!anySd && anySem)
    return { yFormat: { type: 'summary', preset: 'meanSemN' }, pick: (c) => [c.mean, c.sem, c.n] }
  return { yFormat: { type: 'summary', preset: 'meanSdN' }, pick: (c) => [c.mean, c.sd, c.n] }
}

/** Gives data set i of `out` the summary columns `cols[i]`; returns the table's format. */
export function applySummaryFormat(out: OutDataSet[], cols: readonly SummaryCols[]): YFormat {
  const sf = summaryFormat(cols)
  out.forEach((o, i) => {
    o.subcolumns = sf.pick(cols[i]!)
  })
  return sf.yFormat
}

/** A data-processing result: one summary sheet (`title`) and the table the analysis makes. */
export function tableResult(
  title: string,
  blocks: ResultBlock[],
  diagnostics: Diagnostic[],
  input: readonly NormalizedDataSet[],
  table: OutTable,
  values?: AnalysisResult['values'],
): AnalysisResult {
  return result({
    sheets: [{ key: 'summary', title, blocks }],
    diagnostics,
    values,
    table: buildTable(input, table),
  })
}
