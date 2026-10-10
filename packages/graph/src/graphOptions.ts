import type { DataTable, GraphNode, Layer, Project, ResultLookup } from '@ps/model'
import {
  aesRows,
  type BubbleData,
  type BubbleVariables,
  pickVariables,
} from './layers/stats/aes.ts'

// Chart options as the formatting panels show them, with their defaults, read from the layers
// holding them (roadmap 33c): a pie's from its polar style and its labels layer, a bubble plot's
// variables from its points layer's mapping.

/** The labels layer of a graph's slices (or 100% bars), if any. */
export const sliceLabels = (graph: Pick<GraphNode, 'layers'>): Layer | undefined =>
  graph.layers.find(
    (l) =>
      l.geom === 'label' &&
      l.stat.kind === 'fraction' &&
      graph.layers.some((h) => h.id === l.on && (h.geom === 'wedge' || h.geom === 'bar')),
  )

/** The points layer mapping variables (a bubble plot's), if any. */
export const bubbleLayer = (graph: Pick<GraphNode, 'layers'>): Layer | undefined =>
  graph.layers.find((l) => l.geom === 'points' && !!l.aes)

/**
 * The variables a bubble graph plots: those its mapping names that the table has, else X = the
 * first variable and Y = the second (no size or colour variable).
 */
export function bubbleVariables(graph: GraphNode, table: DataTable): BubbleVariables {
  return pickVariables(bubbleLayer(graph)?.aes ?? {}, table)
}

/** A bubble graph's rows (X, Y, size and colour of each). */
export function bubbleData(project: Project, graph: GraphNode, result?: ResultLookup): BubbleData {
  return aesRows(project, graph, result, (table) => bubbleVariables(graph, table))
}
