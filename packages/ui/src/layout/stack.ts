import { arrangeAligned, type FontRegistry, layoutGraph } from '@ps/graph'
import { type GraphNode, newNodeId, type Project, richPlain } from '@ps/model'
import { withGraphs } from './figure.ts'

export type StackDirection = 'vertical' | 'horizontal'

const titleOf = (g: GraphNode) => richPlain(g.title?.content)

interface StackOptions {
  direction: StackDirection
  /** Put the graphs in one shared-range group on the axis they share a scale on (Y). */
  shareY: boolean
  /**
   * Hide the labels repeated between neighbours: X numbers/categories and title on all but the
   * bottom graph (vertical), Y numbers and title on all but the first (horizontal); stacked
   * vertically, a graph title identical to the top graph's is dropped below it.
   */
  hideInner: boolean
  /** Space between the graphs, in points. */
  gap?: number
}

/**
 * Prepares graphs to sit one above the other (or side by side) with their plot areas lined up:
 * equal plot widths (vertical) or heights (horizontal) so categories and scales coincide, an
 * optional shared Y range, and optional hidden inner labels. Returns the changed graphs and where
 * to place them on the page (their top-left corner, scale), aligned by plot area.
 */
export function stackGraphs(
  project: Project,
  graphs: readonly GraphNode[],
  fonts: FontRegistry,
  page: { width: number; height: number },
  opts: StackOptions,
): { graphs: GraphNode[]; placements: { x: number; y: number; scale: number }[] } {
  const vertical = opts.direction === 'vertical'
  const width = Math.max(...graphs.map((g) => g.size.plotWidth))
  const height = Math.max(...graphs.map((g) => g.size.plotHeight))
  const group = graphs.find((g) => g.links?.y)?.links?.y ?? (opts.shareY ? newNodeId() : undefined)
  const last = graphs.length - 1
  const next = graphs.map((g, i): GraphNode => {
    let out: GraphNode = {
      ...g,
      size: vertical ? { ...g.size, plotWidth: width } : { ...g.size, plotHeight: height },
    }
    if (opts.shareY && group && g.axes.y.type === 'continuous')
      out = { ...out, links: { ...out.links, y: group } }
    if (opts.hideInner) {
      const w = vertical ? 'x' : 'y'
      const inner = vertical ? i < last : i > 0
      const axis = out.axes[w]
      if (inner) {
        out = { ...out, axes: { ...out.axes, [w]: { ...axis, showLabels: false, title: null } } }
      } else if (axis.showLabels === false) {
        // The outer graph keeps (or regains) its labels.
        out = { ...out, axes: { ...out.axes, [w]: { ...axis, showLabels: undefined } } }
      }
      // Stacked views of one data set repeat the title: keep it on the top graph only.
      if (vertical && i > 0 && out.title && titleOf(out) === titleOf(graphs[0]!)) {
        out = { ...out, title: null }
      }
    }
    return out
  })
  // Lay them out together so the shared range is seen by every member.
  const withAll = withGraphs(project, next)
  const scenes = next.map((graph) => ({ scene: layoutGraph({ project: withAll, graph, fonts }) }))
  const placements = arrangeAligned(scenes, page, {
    columns: vertical ? 1 : next.length,
    gap: opts.gap ?? 6,
  })
  return { graphs: next, placements }
}
