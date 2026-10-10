import { type DataTable, type GraphNode, type PointStyle, pointKey } from '@ps/model'

// Values at a detection limit on graphs (roadmap 39, decision 577): a table's flagged cells
// (`CellColumn.limit`) drawn as open symbols through the graph's single-point formats
// (`pointOverrides`, `r<row>s<sub>`: each raw value), so no drawing code knows about limits. The
// formats follow their rows like any point format (sorts, inserts and deletes remap them).

const OPEN: PointStyle['fill'] = { type: 'none' }

/** Each flagged cell of the table's data sets: data set key and point key. */
function flaggedPoints(table: DataTable): { key: string; point: string }[] {
  const out: { key: string; point: string }[] = []
  for (const d of table.dataSets)
    d.subcolumns.forEach((c, sub) => {
      c.limit?.forEach((f, row) => {
        if (f) out.push({ key: d.id, point: pointKey(row, sub) })
      })
    })
  return out
}

/** Whether every flagged cell of `table` is drawn open on this graph of it. */
export function showsLimitPoints(graph: GraphNode, table: DataTable): boolean {
  if (graph.seriesSource.table !== table.id) return false
  const pts = flaggedPoints(table)
  return (
    pts.length > 0 &&
    pts.every(({ key, point }) => graph.pointOverrides?.[key]?.[point]?.fill?.type === 'none')
  )
}

/**
 * The graph's point formats with the table's flagged cells drawn as open symbols (`open`), or
 * with those open fills removed (other formats of the points kept). Undefined when none is left.
 */
export function limitPointOverrides(
  graph: GraphNode,
  table: DataTable,
  open: boolean,
): GraphNode['pointOverrides'] {
  const out: NonNullable<GraphNode['pointOverrides']> = {}
  for (const [k, pts] of Object.entries(graph.pointOverrides ?? {})) out[k] = { ...pts }
  for (const { key, point } of flaggedPoints(table)) {
    const own = out[key]?.[point]
    if (open) {
      out[key] ??= {}
      out[key]![point] = { ...own, fill: OPEN }
    } else if (own?.fill?.type === 'none') {
      const { fill: _, ...rest } = own
      if (Object.keys(rest).length) out[key]![point] = rest
      else delete out[key]![point]
    }
  }
  for (const k of Object.keys(out)) if (!Object.keys(out[k]!).length) delete out[k]
  return Object.keys(out).length ? out : undefined
}

/** The graph with its table's flagged cells drawn open (a new graph's default). */
export function withLimitPoints(graph: GraphNode, table: DataTable): GraphNode {
  const pointOverrides = limitPointOverrides(graph, table, true)
  if (!pointOverrides) return graph
  return { ...graph, pointOverrides }
}
