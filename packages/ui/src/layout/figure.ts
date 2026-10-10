import {
  type AlignOptions,
  arrangeAligned,
  type FontRegistry,
  layoutGraph,
  type Scene,
} from '@ps/graph'
import {
  type GraphNode,
  type LayoutItem,
  type LayoutItemOf,
  type LayoutNode,
  newLayoutItemId,
  newNodeId,
  PAGE_SIZES,
  type PanelLabelStyle,
  type Project,
} from '@ps/model'
import { currentPreferences } from '../styles/styleStore.ts'
import { graphsOf } from '../util.ts'

// Pages of graphs, as the layout view, the graph builder (new graphs placed on a page, Duplicate
// as…) and the examples make them.

export type PageSize = keyof typeof PAGE_SIZES
export type Orientation = 'portrait' | 'landscape'

/** A page of this size in points, turned for landscape. */
export function pageSpec(size: PageSize, orientation: Orientation): LayoutNode['page'] {
  const p = PAGE_SIZES[size]
  return orientation === 'portrait' ? { ...p } : { width: p.height, height: p.width }
}

/** The page size chosen in Preferences (Letter unless another is chosen). */
const preferredPageSize = (): PageSize => currentPreferences().pageSize ?? 'letter'

/**
 * A new page for what the user is placing (audit 2, U9): the size chosen in Preferences unless
 * `size` is given (the examples give theirs, to come out the same everywhere), turned for
 * landscape.
 */
export const newPageSpec = (
  orientation: Orientation = 'portrait',
  size: PageSize = preferredPageSize(),
): LayoutNode['page'] => pageSpec(size, orientation)

/** The project with these graphs in it, new or changed (to lay out graphs that link together). */
export const withGraphs = (project: Project, graphs: readonly GraphNode[]): Project => ({
  ...project,
  nodes: { ...project.nodes, ...Object.fromEntries(graphs.map((g) => [g.id, g])) },
})

/** Page items for these graphs at these places, in order. */
export const graphItems = (
  graphs: readonly GraphNode[],
  placements: readonly { x: number; y: number; scale: number }[],
): LayoutItemOf<'graph'>[] =>
  placements.map((p, i) => ({ type: 'graph', id: newLayoutItemId(), graph: graphs[i]!.id, ...p }))

/** Page items for graphs on a grid on the page, their plot areas lined up by row and column. */
export function placeGraphs(
  graphs: readonly GraphNode[],
  scene: (graph: GraphNode) => Scene,
  page: LayoutNode['page'],
  opts: AlignOptions,
): LayoutItemOf<'graph'>[] {
  const scenes = graphs.map((g) => ({ scene: scene(g) }))
  return graphItems(graphs, arrangeAligned(scenes, page, opts))
}

/**
 * The page's graphs on a grid (Arrange in a grid), in place (audit 2, U3): each graph item keeps
 * its id, group and place in the stack, only its x, y and scale change; locked graphs stay where
 * they are and out of the grid, and the other items stay as they are. The grid takes the graphs
 * in their stacking order (back to front).
 */
export function arrangeGraphItems(
  items: readonly LayoutItem[],
  graphOf: (item: LayoutItemOf<'graph'>) => GraphNode | undefined,
  scene: (graph: GraphNode) => Scene,
  page: LayoutNode['page'],
  opts: AlignOptions,
): LayoutItem[] {
  const placed = items.flatMap((it, i) => {
    if (it.type !== 'graph' || it.locked) return []
    const graph = graphOf(it)
    return graph ? [{ i, graph }] : []
  })
  const at = arrangeAligned(
    placed.map((p) => ({ scene: scene(p.graph) })),
    page,
    opts,
  )
  const out = [...items]
  placed.forEach((p, k) => {
    const to = at[k]
    if (to)
      out[p.i] = { ...(items[p.i] as LayoutItemOf<'graph'>), x: to.x, y: to.y, scale: to.scale }
  })
  return out
}

/** A new layout page holding these items, with panel labels (shown, 'A', unless given). */
export const newLayout = (
  name: string,
  page: LayoutNode['page'],
  items: LayoutItem[],
  labels: { show?: boolean; style?: PanelLabelStyle } = {},
): LayoutNode => ({
  kind: 'layout',
  id: newNodeId(),
  name,
  page,
  items,
  panelLabels: { show: labels.show ?? true, style: labels.style ?? 'A', size: 14 },
})

/**
 * A new layout page for what the user places (audit 2, U9 and U24: New layout, Add to page, Split
 * into a set, Duplicate and stack, dropped images): a page of the preferred size (`newPageSpec`)
 * unless `size` is given, with the items `place` puts on it and panel labels (shown unless
 * `labels` says otherwise).
 */
export function newPageOf(
  name: string,
  place: (page: LayoutNode['page']) => LayoutItem[],
  opts: {
    orientation?: Orientation
    size?: PageSize
    labels?: Parameters<typeof newLayout>[3]
  } = {},
): LayoutNode {
  const page = newPageSpec(opts.orientation, opts.size)
  return newLayout(name, page, place(page), opts.labels)
}

/**
 * A new page (Letter, or the size chosen in Preferences) with every graph of the project on a
 * two-column grid.
 */
export function createLayoutFor(
  project: Project,
  fonts: FontRegistry,
  name: string,
  size: PageSize = 'letter',
): LayoutNode {
  const graphs = graphsOf(project)
  const scene = (graph: GraphNode) => layoutGraph({ project, graph, fonts })
  return newPageOf(name, (page) => placeGraphs(graphs, scene, page, { columns: 2 }), { size })
}
