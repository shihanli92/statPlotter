import type { ContinuousAxisSpec, GraphNode } from '@ps/model'
import { defaultContinuousAxis } from './layout/common.ts'

// The right Y axis (`graph.axes.y2`): which graphs can have one, and which data sets and curves
// are plotted against it. A data set (or an analysis output, or a function) chooses its axis in
// its identity (`seriesOverrides[key].yAxis`); it plots on the right only while the graph has a
// right axis. An output follows its own choice, else the data set it is drawn with (`colorOf`),
// so a fit sits on the axis of its data.

type AxisGraph = Pick<GraphNode, 'frame' | 'layers' | 'axes' | 'seriesOverrides' | 'style'>

/**
 * Whether a graph's data sets can be plotted on a right Y axis: grouped graphs and XY graphs of
 * the table's values (not survival curves or bubble plots).
 */
export function rightAxisAllowed(graph: Pick<GraphNode, 'frame' | 'layers'>): boolean {
  if (graph.frame === 'grouped') return true
  return graph.frame === 'xy' && !graph.layers.some((l) => l.stat.kind === 'km' || !!l.aes)
}

/**
 * The graph's right Y axis, when it has one it can draw: its data sets' second axis, or an
 * estimation plot's difference axis (formatted through `axes.y2`, no data sets on it).
 */
export function rightAxisOf(graph: Pick<AxisGraph, 'frame' | 'layers' | 'axes'>) {
  return rightAxisAllowed(graph) || graph.layers.some((l) => l.geom === 'difference')
    ? graph.axes.y2
    : undefined
}

/** Whether the graph draws a right Y axis. */
export const hasRightAxis = (graph: Pick<AxisGraph, 'frame' | 'layers' | 'axes'>): boolean =>
  rightAxisOf(graph) !== undefined

/** The axis a series' identity chooses (before checking the graph has a right axis). */
function chosenAxis(graph: AxisGraph, key: string): 'left' | 'right' {
  return graph.seriesOverrides[key]?.yAxis ?? graph.style.seriesDefaults?.yAxis ?? 'left'
}

/** True when a data set is plotted against the right Y axis. */
export function seriesOnRight(graph: AxisGraph, key: string): boolean {
  return rightAxisAllowed(graph) && hasRightAxis(graph) && chosenAxis(graph, key) === 'right'
}

/** True when an analysis output (by its series id) is plotted against the right Y axis. */
export function curveOnRight(graph: AxisGraph, id: string): boolean {
  if (!rightAxisAllowed(graph) || !hasRightAxis(graph)) return false
  const own = graph.seriesOverrides[id]?.yAxis
  if (own) return own === 'right'
  const out = graph.layers
    .flatMap((l) => (l.data?.from === 'outputs' ? l.data.series : []))
    .find((e) => e.id === id)
  return out?.colorOf !== undefined && chosenAxis(graph, out.colorOf) === 'right'
}

/** A right Y axis with default settings (automatic range, plain numbers). */
export const DEFAULT_RIGHT_AXIS: ContinuousAxisSpec = defaultContinuousAxis()
