import type { Command } from '@ps/engine'
import { mappingAxes } from '@ps/graph'
import type { DataTable, GraphNode } from '@ps/model'

/**
 * Roadmap 38: a graph of variables with its X and Y variables swapped, as commands for one undo
 * step; null for a graph that maps no variables. An XY graph of variables (its points' `aes`,
 * decision 300) swaps every layer's X and Y (and vectors' ends), a number × number or text ×
 * text `mapping` its two variables; both swap their axes' formats (ranges, scales, titles) and
 * shared-axis groups. A number by a text variable turns instead (vertical ↔ horizontal), as
 * Format graph's Orientation does (decision 553).
 */
export function swapMappedXY(graph: GraphNode, table: DataTable): Command[] | null {
  const set = (path: string[], value: unknown): Command => ({
    type: 'node.set',
    id: graph.id,
    path,
    value,
  })
  const axesAndLinks = (): Command[] => {
    const out = [set(['axes'], { ...graph.axes, x: graph.axes.y, y: graph.axes.x })]
    if (graph.links && (graph.links.x || graph.links.y)) {
      const { x, y } = graph.links
      out.push(set(['links'], { ...(y ? { x: y } : {}), ...(x ? { y: x } : {}) }))
    }
    return out
  }
  const m = graph.mapping
  if (!m) {
    // XY graphs of variables: X and Y on the layers' own `aes`.
    if (!graph.layers.some((l) => l.aes?.x !== undefined && l.aes?.y !== undefined)) return null
    const layers = graph.layers.map((l) => {
      const a = l.aes
      if (!a || (a.x === undefined && a.y === undefined)) return l
      const { x, y, xend, yend, ...rest } = a
      return {
        ...l,
        aes: {
          ...rest,
          ...(y !== undefined ? { x: y } : {}),
          ...(x !== undefined ? { y: x } : {}),
          ...(yend !== undefined ? { xend: yend } : {}),
          ...(xend !== undefined ? { yend: xend } : {}),
        },
      }
    })
    return [set(['layers'], layers), ...axesAndLinks()]
  }
  const axes = mappingAxes(table, m)
  if (!axes) return null
  const out: Command[] = [set(['mapping'], { ...m, x: m.y, y: m.x })]
  if (axes === 'tn' || axes === 'nt') {
    // After the swap the text variable is Y (down the left) when it was X.
    out.push(set(['style', 'orientation'], axes === 'tn' ? 'horizontal' : undefined))
    return out
  }
  return [...out, ...axesAndLinks()]
}

/** Whether a graph maps variables that Swap X and Y can swap. */
export const swappable = (graph: GraphNode): boolean =>
  !!graph.mapping || graph.layers.some((l) => l.aes?.x !== undefined && l.aes?.y !== undefined)
