import { type GraphSeries, resolveSeries } from '@ps/graph'
import type { DataTable, GraphNode, Project } from '@ps/model'

// Roadmap 43: a graph of a table with no values yet (a new empty table's graph) draws its frame
// with nothing in it; the graph view says why under its toolbar, with the way to the table.

const anyValue = (a: Float64Array): boolean => a.some((v) => !Number.isNaN(v))

/** Whether a series has a value to draw (or values entered but excluded). */
function hasValues(s: GraphSeries): boolean {
  if (s.cells) return s.cells.some((c) => c.length > 0)
  if (s.ds.counts.excluded > 0) return true
  const d = s.ds.data
  return d.shape === 'replicates' ? d.reps.some(anyValue) : anyValue(d.mean)
}

/**
 * The data table a graph waits for values of: when the graph draws a data table's series and
 * none of them has a value yet. Undefined when one has, when it draws an analysis' result table
 * (that is the analysis' to explain) or nothing at all (every data set left out), and when it
 * plots a function (its curve needs no data).
 */
export function emptyGraphTable(project: Project, graph: GraphNode): DataTable | undefined {
  const node = project.nodes[graph.seriesSource.table]
  if (node?.kind !== 'table') return undefined
  if (graph.layers.some((l) => l.data?.from === 'functions')) return undefined
  const series = resolveSeries(project, graph)
  if (!series.length || series.some(hasValues)) return undefined
  return node
}
