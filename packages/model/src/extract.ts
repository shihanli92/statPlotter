import { tidyNumber } from './formula.ts'
import { newColumnId, newNodeId } from './ids.ts'
import { normalizeDataSet, primaryValues } from './normalize.ts'
import { type DataSetColumn, type DataTable, MAX_REPLICATES } from './table.ts'

/*
 * "Extract and rearrange" for multiple-variables tables: numeric variables laid out as a column
 * table (one data set per variable, or per category of a text variable) or a grouped table
 * (categories of a second text variable as rows), ready for t tests, ANOVA and column / grouped
 * graphs. A pure transform: the result is a new table, not linked to the source.
 */

export interface ExtractOptions {
  /** Numeric (or calculated) variables whose values are extracted, by data set id. */
  values: string[]
  /**
   * A text variable whose categories become the data sets (one value variable only). Without it,
   * each value variable is a data set and rows stay aligned (row k = observation k).
   */
  groupBy?: string
  /** A second text variable whose categories become rows: a grouped table (needs `groupBy`). */
  rowsBy?: string
  name?: string
}

export interface ExtractResult {
  table: DataTable
  /** Values left out because their row has no category in a grouping variable. */
  leftOut: number
}

/** Categories of a text variable in order of first appearance (trimmed; empty cells skipped). */
export function textCategories(ds: DataSetColumn): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of ds.text ?? []) {
    const k = t?.trim()
    if (k && !seen.has(k)) {
      seen.add(k)
      out.push(k)
    }
  }
  return out
}

/** Rearranges variables of a multiple-variables table into a column or grouped table. */
export function extractVariables(source: DataTable, opts: ExtractOptions): ExtractResult {
  const find = (id: string | undefined) => source.dataSets.find((d) => d.id === id)
  const values = opts.values.map((id) => {
    const ds = find(id)
    if (!ds) throw new Error(`no variable ${id}`)
    if (ds.text) throw new Error(`“${ds.title}” is a text variable`)
    const v = primaryValues(normalizeDataSet(source, ds))
    // Calculated values become data: without floating-point noise.
    return { ds, v: ds.formula !== undefined ? v.map(tidyNumber) : v }
  })
  if (!values.length) throw new Error('choose a variable to extract')
  const group = find(opts.groupBy)
  const rowsBy = find(opts.rowsBy)
  if (opts.groupBy && !group?.text) throw new Error('the data sets come from a text variable')
  if (opts.rowsBy && !rowsBy?.text) throw new Error('the rows come from a text variable')
  if (rowsBy && !group) throw new Error('rows by category need data sets by category too')
  if (group && values.length > 1) throw new Error('extract one variable when grouping by category')
  const name = opts.name ?? `${source.name} (extracted)`
  const base = { kind: 'table' as const, id: newNodeId(), name, x: null, notes: '' }
  const cat = (ds: DataSetColumn, r: number) => ds.text?.[r]?.trim() || null
  let leftOut = 0

  // Each variable a data set, rows aligned (paired data stay paired).
  if (!group) {
    const rows = source.rowCount
    const dataSets = values.map(({ ds, v }) => ({
      id: newColumnId(),
      title: ds.title,
      subcolumns: [
        {
          type: 'number' as const,
          values: Array.from({ length: rows }, (_, r) => (Number.isNaN(v[r]!) ? null : v[r]!)),
        },
      ],
    }))
    return {
      table: {
        ...base,
        tableKind: 'column',
        yFormat: { type: 'replicates', count: 1 },
        rowCount: rows,
        rowTitles: source.rowTitles ? [...source.rowTitles] : null,
        dataSets,
      },
      leftOut,
    }
  }

  const { v } = values[0]!
  const columns = textCategories(group)
  const rowCats = rowsBy ? textCategories(rowsBy) : ['']
  // cells[row category][column category] = values
  const cells = rowCats.map(() => columns.map(() => [] as number[]))
  for (let r = 0; r < source.rowCount; r++) {
    const c = cat(group, r)
    const k = rowsBy ? cat(rowsBy, r) : ''
    const x = v[r]!
    if (Number.isNaN(x)) continue
    if (c === null || k === null) {
      leftOut++
      continue
    }
    cells[rowCats.indexOf(k)]![columns.indexOf(c)]!.push(x)
  }
  const widest = Math.max(1, ...cells.flat().map((xs) => xs.length))
  if (rowsBy && widest > MAX_REPLICATES)
    throw new Error(`a cell would hold ${widest} values; grouped tables hold ${MAX_REPLICATES}`)

  if (!rowsBy) {
    const dataSets = columns.map((title, j) => ({
      id: newColumnId(),
      title,
      subcolumns: [
        {
          type: 'number' as const,
          values: Array.from({ length: widest }, (_, i) => cells[0]![j]![i] ?? null),
        },
      ],
    }))
    return {
      table: {
        ...base,
        tableKind: 'column',
        yFormat: { type: 'replicates', count: 1 },
        rowCount: widest,
        rowTitles: null,
        dataSets,
      },
      leftOut,
    }
  }

  // Grouped: a row per category of `rowsBy`, replicates side by side.
  const dataSets = columns.map((title, j) => ({
    id: newColumnId(),
    title,
    subcolumns: Array.from({ length: widest }, (_, k) => ({
      type: 'number' as const,
      values: rowCats.map((_, i) => cells[i]![j]![k] ?? null),
    })),
  }))
  return {
    table: {
      ...base,
      tableKind: 'grouped',
      yFormat: { type: 'replicates', count: widest },
      rowCount: rowCats.length,
      rowTitles: [...rowCats],
      dataSets,
    },
    leftOut,
  }
}
