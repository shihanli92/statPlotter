import type { DataTable, GraphLook, GraphNode, Layer, LayerOf, NodeId } from '@ps/model'
import { presetGraph } from '../src/index.ts'

// Graphs for the graph tests (schema v2, roadmap 33d: the v1 creators are gone): a preset's graph
// of a table with a fixed id, and small edits of its layers.

/** The preset that makes what each v1 graph type made (its default style). */
export const PRESET_OF_LOOK: Readonly<Record<GraphLook, string>> = {
  'column.scatter': 'points',
  'column.bar': 'bars',
  'column.box': 'box',
  'column.beforeAfter': 'beforeAfter',
  'column.estimation': 'estimation',
  'grouped.scatter': 'points',
  'grouped.bar': 'bars',
  'grouped.box': 'box',
  'xy.scatter': 'meanSd',
  'survival.step': 'survival',
  'bubble.scatter': 'bubble',
  'whole.pie': 'pie',
  'whole.donut': 'donut',
  'whole.bar': 'wholeBars',
  'heatmap.cells': 'heatmap',
}

/** A new graph of a table in a preset, with id `g1` (or `id`) and the table's name. */
export function graphOf(
  table: DataTable,
  preset: string,
  patch: (g: GraphNode) => Partial<GraphNode> = () => ({}),
  id = 'g1',
): GraphNode {
  const g = { ...presetGraph(table, preset), id: id as NodeId }
  return { ...g, ...patch(g) }
}

/** A graph's layer by id (asserting it exists). */
export function layerOf<G extends Layer['geom'] = Layer['geom']>(
  graph: GraphNode,
  id: string,
): LayerOf<G> {
  const l = graph.layers.find((x) => x.id === id)
  if (!l) throw new Error(`no layer ${id} in ${graph.layers.map((x) => x.id).join(', ')}`)
  return l as LayerOf<G>
}

/** The graph with one layer changed (`patch` over it; a style is merged into the layer's). */
export function withLayer(
  graph: GraphNode,
  id: string,
  patch: Partial<Layer> & { style?: Record<string, unknown> },
): GraphNode {
  layerOf(graph, id)
  return {
    ...graph,
    layers: graph.layers.map((l) =>
      l.id === id
        ? ({
            ...l,
            ...patch,
            ...(patch.style ? { style: { ...(l.style as object), ...patch.style } } : {}),
          } as Layer)
        : l,
    ),
  }
}

/** A data set's own style in a layer (`layer.series[key].style`, merged). */
export function withSeriesStyle(
  graph: GraphNode,
  id: string,
  key: string,
  style: Record<string, unknown>,
): GraphNode {
  const l = layerOf(graph, id)
  const series = (l.series ?? {}) as Record<string, { style?: object }>
  return withLayer(graph, id, {
    series: {
      ...series,
      [key]: { ...series[key], style: { ...series[key]?.style, ...style } },
    } as never,
  })
}

/** The graph with layers added at the end of its list (in front), or `at`. */
export function addLayers(graph: GraphNode, layers: readonly Layer[], at?: number): GraphNode {
  const list = [...graph.layers]
  list.splice(at ?? list.length, 0, ...layers)
  return { ...graph, layers: list }
}

/** The graph without these layers. */
export const withoutLayers = (graph: GraphNode, ...ids: string[]): GraphNode => ({
  ...graph,
  layers: graph.layers.filter((l) => !ids.includes(l.id)),
})
