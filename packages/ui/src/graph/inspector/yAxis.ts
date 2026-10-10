import type { Command } from '@ps/engine'
import { DEFAULT_RIGHT_AXIS, rightAxisAllowed } from '@ps/graph'
import type { ContinuousAxisSpec, GraphNode } from '@ps/model'

/** A new right Y axis: the defaults with the left axis' fonts and line (not its range or title). */
function newRightAxis(graph: GraphNode): ContinuousAxisSpec {
  const left = graph.axes.y
  const out: ContinuousAxisSpec = { ...DEFAULT_RIGHT_AXIS }
  if (left.line) out.line = left.line
  if (left.tickLabels) out.tickLabels = left.tickLabels
  if (left.tickStyle) out.tickStyle = left.tickStyle
  return out
}

/** Adds a right Y axis (no data set moves to it). Nothing when there is one or can't be one. */
export function addRightAxisCommands(graph: GraphNode): Command[] {
  if (graph.axes.y2 || !rightAxisAllowed(graph)) return []
  return [{ type: 'node.set', id: graph.id, path: ['axes', 'y2'], value: newRightAxis(graph) }]
}

/** Removes the right Y axis; every data set, output and function on it goes back to the left. */
export function removeRightAxisCommands(graph: GraphNode): Command[] {
  const set = (path: (string | number)[]): Command => ({
    type: 'node.set',
    id: graph.id,
    path,
    value: undefined,
  })
  return [
    set(['axes', 'y2']),
    ...Object.entries(graph.seriesOverrides)
      .filter(([, o]) => o.yAxis !== undefined)
      .map(([k]) => set(['seriesOverrides', k, 'yAxis'])),
    ...(graph.style.seriesDefaults?.yAxis !== undefined
      ? [set(['style', 'seriesDefaults', 'yAxis'])]
      : []),
  ]
}

/**
 * Plots a series (a data set, an analysis output or a function, by key) against the left or
 * right Y axis. Moving one to the right adds a right axis when the graph has none. 'left' is
 * stored as no choice for data sets (the default, unless every data set defaults to the right)
 * and explicitly for outputs (which otherwise follow their data set).
 */
export function setAxisCommands(
  graph: GraphNode,
  key: string,
  side: 'left' | 'right',
  output = false,
): Command[] {
  if (side === 'right' && !rightAxisAllowed(graph)) return []
  const explicit = output || graph.style.seriesDefaults?.yAxis === 'right'
  const value = side === 'right' || explicit ? side : undefined
  return [
    ...(side === 'right' ? addRightAxisCommands(graph) : []),
    { type: 'node.set', id: graph.id, path: ['seriesOverrides', key, 'yAxis'], value },
  ]
}
