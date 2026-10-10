import {
  type CellColumn,
  type DataTable,
  type GraphNode,
  mapGraphRefs,
  type NodeId,
  nodeById,
  type Project,
  type ResultLookup,
} from '@ps/model'
import { histogramLayer } from './binned.ts'
import type { ScreenSample } from './layout/screen.ts'
import { isMapped } from './mapped.ts'

// Previews of big tables (roadmap 34f, decision 433): the graph builder draws its preview from a
// deterministic sample of at most `PREVIEW_ROWS` rows of a big table — any kind, cells table or
// not — so a click on a plot style lays out a few thousand rows, never a million. The graph made
// draws every row. The sample is evenly spaced rows in table order (the first row among them), the
// same every time, and is kept per table object (documents are immutable), so the graph engine's
// caches keyed by table (mapped data, normalized columns) serve every click.

/** Most rows a builder preview draws (roadmap 34f). */
export const PREVIEW_ROWS = 5000

/** `count` rows of `n` spread evenly over them in order, the first row first (all when fewer). */
export function sampleRows(n: number, count: number): number[] {
  if (n <= count) return Array.from({ length: n }, (_, i) => i)
  return Array.from({ length: count }, (_, i) => Math.floor((i * n) / count))
}

const pick = <T>(a: readonly T[], rows: readonly number[]): T[] => rows.map((r) => a[r] as T)

const subcolumn = (c: CellColumn, rows: readonly number[]): CellColumn => ({
  ...c,
  values: pick(c.values, rows),
  ...(c.excluded ? { excluded: pick(c.excluded, rows) } : {}),
})

const samples = new WeakMap<DataTable, Map<number, DataTable>>()

/**
 * A table with only the rows `sampleRows` picks (every per-row array cut to them), or the table
 * itself when it has no more than `max` rows. The same object for the same table and `max`.
 */
export function sampleTable(table: DataTable, max: number = PREVIEW_ROWS): DataTable {
  if (table.rowCount <= max) return table
  let byMax = samples.get(table)
  const hit = byMax?.get(max)
  if (hit) return hit
  const rows = sampleRows(table.rowCount, max)
  const out: DataTable = {
    ...table,
    rowCount: rows.length,
    rowTitles: table.rowTitles ? pick(table.rowTitles, rows) : null,
    ...(table.rowTitlesRich ? { rowTitlesRich: pick(table.rowTitlesRich, rows) } : {}),
    x: table.x
      ? { ...table.x, subcolumns: table.x.subcolumns.map((c) => subcolumn(c, rows)) }
      : null,
    dataSets: table.dataSets.map((d) => ({
      ...d,
      subcolumns: d.subcolumns.map((c) => subcolumn(c, rows)),
      ...(d.text ? { text: pick(d.text, rows) } : {}),
    })),
  }
  if (!byMax) {
    byMax = new Map()
    samples.set(table, byMax)
  }
  byMax.set(max, out)
  return out
}

/** What a preview draws from: the project and results with the source table sampled. */
export interface PreviewSource {
  project: Project
  result: ResultLookup | undefined
  /** Rows the preview draws, and of how many (equal when the table is small). */
  shown: number
  of: number
}

/**
 * The project and result lookup a preview of a graph of `tableId` lays out with (roadmap 34f): the
 * data table, or an analysis' result table, replaced by its sample (`sampleTable`). Not for a
 * graph of chosen rows (`seriesSource.rows` name the whole table's rows).
 */
export function previewSource(
  project: Project,
  tableId: NodeId | string,
  result: ResultLookup | undefined,
  max: number = PREVIEW_ROWS,
): PreviewSource {
  const node = nodeById(project.nodes, tableId)
  if (node?.kind === 'table') {
    const t = sampleTable(node, max)
    if (t === node) return { project, result, shown: node.rowCount, of: node.rowCount }
    return {
      project: { ...project, nodes: { ...project.nodes, [node.id]: t } },
      result,
      shown: t.rowCount,
      of: node.rowCount,
    }
  }
  const r = node?.kind === 'analysis' ? result?.(node.id) : undefined
  if (!r?.table || !result || node?.kind !== 'analysis') return { project, result, shown: 0, of: 0 }
  const t = sampleTable(r.table, max)
  if (t === r.table) return { project, result, shown: t.rowCount, of: t.rowCount }
  const sampled = { ...r, table: t }
  return {
    project,
    result: (id) => (id === node.id ? sampled : result(id)),
    shown: t.rowCount,
    of: r.table.rowCount,
  }
}

// Navigator thumbnails (audit 3, P2): an XY graph draws every row on the canvas (decision 450),
// but its thumbnail, redrawn after each edit on the main thread, draws an even sample of a big
// table's rows, as a builder preview does: the same layout of a few thousand rows, never a
// million.

/** Most rows of its table an XY graph's (scatter's, bubble plot's) thumbnail draws. */
export const THUMBNAIL_XY_ROWS = 2000

/**
 * What a navigator thumbnail of `graph` lays out: an XY graph of more than `THUMBNAIL_XY_ROWS`
 * rows from the sample `previewSource` makes (the same rows every time, kept per table object),
 * its references to rows (single points' formats, labelled points) moved to the sample's rows or
 * dropped with rows not in it; any other graph, and one of chosen rows, as it is.
 */
export function thumbnailSource(
  project: Project,
  graph: GraphNode,
  result: ResultLookup | undefined,
  max: number = THUMBNAIL_XY_ROWS,
): { project: Project; graph: GraphNode; result: ResultLookup | undefined } {
  const whole = { project, graph, result }
  if (graph.frame !== 'xy' || graph.seriesSource.rows) return whole
  const src = previewSource(project, graph.seriesSource.table, result, max)
  if (src.shown >= src.of) return whole
  const at = new Map(sampleRows(src.of, max).map((r, i) => [r, i]))
  const g = mapGraphRefs(graph, {
    row: (r) => at.get(r) ?? null,
    rows: (rows, role) =>
      role === 'pointLabels' ? rows.flatMap((r) => (at.has(r) ? [at.get(r)!] : [])) : 'keep',
  })
  return {
    project: { ...src.project, nodes: { ...src.project.nodes, [g.id]: g } },
    graph: g,
    result: src.result,
  }
}

// The preview's total work (decision 452): its points standing for rows stay about
// `PREVIEW_MARKS` however many data sets share them, and a graph of very many variables (each a
// column) previews the first `PREVIEW_SETS` of them. The graph made draws them all.

/** About the most points standing for rows a builder preview draws, all data sets together. */
export const PREVIEW_MARKS = 5000
/** Most of a graph's own data sets (variables as columns, Y data sets) a builder preview draws. */
export const PREVIEW_SETS = 20

/**
 * The table's data sets a graph draws as data sets of its own (variables as columns, a table's Y
 * data sets), in its order; null when its data sets are something else (the levels of a text
 * variable, a histogram's groups, the rows of a scatter of variables).
 */
export function ownDataSets(
  graph: Pick<GraphNode, 'frame' | 'layers' | 'mapping' | 'seriesSource'>,
  table: DataTable,
): string[] | null {
  if (isMapped(graph) || histogramLayer(graph)) return null
  if (graph.frame === 'xy' && graph.layers.some((l) => l.geom === 'points' && !!l.aes)) return null
  const numbers = new Set(table.dataSets.filter((d) => !d.text).map((d) => d.id as string))
  const include = graph.seriesSource.include
  const keys = include === 'all' ? table.dataSets.map((d) => d.id as string) : include
  return keys.filter((k) => numbers.has(k))
}

/** Values of a graph's own data sets above which its preview shows only the first 20. */
const PREVIEW_SETS_VALUES = 20_000

/**
 * A preview's graph: on a big table (more than 20,000 values in its own data sets) its first
 * `PREVIEW_SETS` own data sets, and how many of how many.
 */
export function previewGraph<G extends Parameters<typeof ownDataSets>[0]>(
  graph: G,
  table: DataTable,
): { graph: G; sets: { shown: number; of: number } | null } {
  const own = ownDataSets(graph, table)
  if (!own) return { graph, sets: null }
  if (own.length <= PREVIEW_SETS || own.length * table.rowCount <= PREVIEW_SETS_VALUES)
    return { graph, sets: { shown: own.length, of: own.length } }
  return {
    graph: {
      ...graph,
      seriesSource: { ...graph.seriesSource, include: own.slice(0, PREVIEW_SETS) },
    },
    sets: { shown: PREVIEW_SETS, of: own.length },
  }
}

/**
 * The screen sample a preview of `sets` data sets of its own lays out with: their points standing
 * for rows share `PREVIEW_MARKS` (each at least one), XY graphs' too. A graph whose data sets
 * split the rows (levels, groups) draws at most the sample's rows anyway.
 */
export function previewScreen(sets: number | null): ScreenSample {
  return { points: Math.max(1, Math.floor(PREVIEW_MARKS / Math.max(1, sets ?? 1))), xy: true }
}

/**
 * The preview's note when it draws a sample: "Preview of 5,000 of 16,171 rows", or of some of a
 * graph's variables too: "Preview of 20 of 69 variables, 5,000 of 16,171 rows".
 */
export function previewNote(
  p: Pick<PreviewSource, 'shown' | 'of'> & {
    sets?: { shown: number; of: number } | null
    /** What the data sets are called (default "variables"). */
    setsName?: string
  },
): string | null {
  const n = (v: number) => v.toLocaleString('en-US')
  const rows = p.shown < p.of ? `${n(p.shown)} of ${n(p.of)} rows` : null
  const sets =
    p.sets && p.sets.shown < p.sets.of
      ? `${n(p.sets.shown)} of ${n(p.sets.of)} ${p.setsName ?? 'variables'}`
      : null
  if (!rows && !sets) return null
  return `Preview of ${[sets, rows].filter(Boolean).join(', ')}`
}
