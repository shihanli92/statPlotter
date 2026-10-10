import type { Command } from '@ps/engine'
import { graphRows, identityStyle, type Theme } from '@ps/graph'
import {
  type GraphNode,
  type LabelThreshold,
  type PointLabels,
  type Project,
  type ResultLookup,
  sourceTable,
} from '@ps/model'

// Format graph › Appearance › Label points (roadmap 22): the pure part — what is being labelled,
// how a change is written, which rows can be chosen. Automatic labels are part of a series'
// identity (`seriesOverrides[key].pointLabels`), for data sets and analysis outputs alike.

/** What a new "Label points" starts as: every point's row title. */
export const DEFAULT_POINT_LABELS: PointLabels = { source: 'rowTitle', which: 'all' }

/**
 * Thresholds offered when switching to "points past thresholds": a volcano plot's cut-offs
 * (|X| ≥ 1, e.g. a 2-fold change, and Y ≥ 1.3, i.e. P ≤ 0.05 on −log10) where there is an X,
 * else Y ≥ 0.
 */
export const defaultThresholds = (hasX: boolean): LabelThreshold[] =>
  hasX
    ? [
        { value: 'x', test: 'abs', limit: 1 },
        { value: 'y', test: 'above', limit: 1.3 },
      ]
    : [{ value: 'y', test: 'above', limit: 0 }]

/** What the section formats: data sets (by key) or one analysis output (by its series id). */
export type LabelItems = { dataSets: readonly string[] } | { output: string }

/** The current automatic labels of each item (undefined: none yet). */
export function currentLabels(
  graph: GraphNode,
  theme: Theme,
  items: LabelItems,
): (PointLabels | undefined)[] {
  if ('output' in items) return [identityStyle(theme, graph, items.output, true).pointLabels]
  return items.dataSets.map((k) => identityStyle(theme, graph, k).pointLabels)
}

/**
 * Commands applying `update` to each item's labels (a whole valid object each time, starting
 * from the defaults when an item has none): per data set (with several, each keeps its other
 * fields), or on the output.
 */
export function labelCommands(
  graph: GraphNode,
  theme: Theme,
  items: LabelItems,
  change: (current: PointLabels) => PointLabels | undefined,
): Command[] {
  const current = currentLabels(graph, theme, items)
  // Fields set back to their default are left out (the document holds no undefined values).
  const update = (l: PointLabels) => {
    const next = change(l)
    return (
      next &&
      (Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as PointLabels)
    )
  }
  const keys = 'output' in items ? [items.output] : items.dataSets
  return keys.map((k, i) => ({
    type: 'node.set',
    id: graph.id,
    path: ['seriesOverrides', k, 'pointLabels'],
    value: update(current[i] ?? DEFAULT_POINT_LABELS),
  }))
}

interface RowChoice {
  /** Table row. */
  row: number
  /** Its title, or "Row n" when it has none. */
  label: string
}

/**
 * The rows the labels can be chosen from: the table rows the graph shows (a row slice, else
 * all), or, for an analysis output, the rows its points come from.
 */
export function rowChoices(
  project: Project,
  graph: GraphNode,
  items: LabelItems,
  lookup?: ResultLookup,
): RowChoice[] {
  const name = (row: number, title: string | null | undefined) =>
    title?.trim() ? title : `Row ${row + 1}`
  if ('output' in items) {
    const e = graph.layers
      .flatMap((l) => (l.data?.from === 'outputs' ? l.data.series : []))
      .find((s) => s.id === items.output)
    const out = e ? lookup?.(e.ref.node)?.outputs[e.ref.key] : undefined
    if (!out?.rows) return []
    const seen = new Set<number>()
    return out.rows.flatMap((row, i) => {
      if (seen.has(row)) return []
      seen.add(row)
      return [{ row, label: name(row, out.rowTitles?.[i]) }]
    })
  }
  const table = sourceTable(project, graph.seriesSource.table, lookup)
  if (!table) return []
  const rows = graphRows(graph, table) ?? Array.from({ length: table.rowCount }, (_, r) => r)
  return rows.map((row) => ({ row, label: name(row, table.rowTitles?.[row]) }))
}

/** Rows whose label contains the query (any case), at most `limit`. */
export function filterRows(choices: readonly RowChoice[], query: string, limit = 200): RowChoice[] {
  const q = query.trim().toLowerCase()
  const out: RowChoice[] = []
  for (const c of choices) {
    if (q && !c.label.toLowerCase().includes(q)) continue
    out.push(c)
    if (out.length >= limit) break
  }
  return out
}

/** Chosen rows with one toggled, in table order. */
export function toggleRow(rows: readonly number[] | undefined, row: number): number[] {
  const set = new Set(rows ?? [])
  if (set.has(row)) set.delete(row)
  else set.add(row)
  return [...set].sort((a, b) => a - b)
}
