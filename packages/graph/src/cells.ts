import { type DataTable, type GraphNode, isCellsTable, type Layer } from '@ps/model'
import { cellsAllowed, rowMarkLayer } from './layers/matrix.ts'
import {
  newStyleLayer,
  plotStyle,
  styleAllowed,
  styleContext,
  withStyleLayer,
} from './plotStyles.ts'
import { ownDataSets } from './preview.ts'

// Graphs of cells tables (roadmap 34f, decision 431): a graph made before its table became a cells
// table (or before 34f) may draw a mark per row within categories — a swarm of 16,000 points,
// before–after lines. It keeps drawing (nothing is deleted); Format › Layers says why it is slow
// and offers the summary in its place.

/** A layer of a cells table's graph drawing a mark per row, why that's a problem, and a fix. */
export interface RowMarkNotice {
  layer: Layer
  /** "16,171 rows: too many points for a swarm. Use a violin or box." */
  reason: string
  /** The fix's button text and the graph's layers after it (one undo step). */
  fix: { label: string; layers: Layer[] }
}

/** The layers of a graph of a cells table that draw a mark per row (none on other tables). */
export function rowMarkNotices(
  graph: Pick<GraphNode, 'frame' | 'layers' | 'mapping'>,
  table: DataTable,
): RowMarkNotice[] {
  if (!isCellsTable(table)) return []
  const c = styleContext(table, graph.frame, graph.layers, graph.mapping)
  const cells = { rows: table.rowCount }
  return graph.layers.flatMap((l): RowMarkNotice[] => {
    if (l.visible === false || (l.data && l.data.from !== 'table')) return []
    const r = rowMarkLayer(c.kind, graph.frame, l.geom, l.stat.kind)
    if (!r) return []
    const reason = cellsAllowed(c.kind, graph.frame, l.geom, l.stat.kind, cells).reason ?? r.too
    const rest = graph.layers.filter((x) => x !== l && x.on !== l.id)
    const hide = {
      label: 'Hide it',
      layers: graph.layers.map((x) => (x === l ? ({ ...x, visible: false } as Layer) : x)),
    }
    // The points over a box or violin: those stay.
    if (
      r.summary === 'violin' &&
      rest.some((x) => (x.geom === 'box' || x.geom === 'violin') && x.visible !== false)
    )
      return [{ layer: l, reason, fix: { label: 'Remove the points', layers: rest } }]
    const style = r.summary ? plotStyle(r.summary) : undefined
    const others = { ...c, layers: rest }
    if (!style || !styleAllowed(style, others).allowed) return [{ layer: l, reason, fix: hide }]
    const added = newStyleLayer(style, others, l.position)
    const label = r.summary === 'violin' ? 'Use a violin instead' : 'Join the means instead'
    return [{ layer: l, reason, fix: { label, layers: withStyleLayer(others, added) } }]
  })
}

/** Most number variables a cells table's variables as columns summarise to start with. */
export const CELLS_COLUMNS = 20

/**
 * The data sets a new graph of a cells table's variables as columns (decision 453) starts with:
 * its first `CELLS_COLUMNS` number variables when it has more, so "Columns" summarises 20 boxes
 * rather than 69 (the others ticked by hand under Data sets); null otherwise (every one).
 */
export function cellsColumns(
  graph: Pick<GraphNode, 'frame' | 'layers' | 'mapping'>,
  table: DataTable,
): string[] | null {
  if (!isCellsTable(table) || graph.frame !== 'category') return null
  const own = ownDataSets({ ...graph, seriesSource: { table: table.id, include: 'all' } }, table)
  return own && own.length > CELLS_COLUMNS ? own.slice(0, CELLS_COLUMNS) : null
}

/** The builder's note while a cells table's columns summarise some of its number variables. */
export function cellsColumnsNote(shown: number, of: number): string {
  return `Summarising ${shown} of ${of} number variables: tick others under Data sets.`
}
