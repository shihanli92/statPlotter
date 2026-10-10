import { hitTest, type PageScene, type SceneNode } from '@ps/graph'
import type { GraphNode, LayoutNode, NodeId, Project } from '@ps/model'
import {
  axisPlace,
  describeTarget,
  type FormatTarget,
  formatTargetFor,
  graphPlace,
  LEGEND_PLACE,
} from '../graph/format/route.ts'
import { selectionKey } from '../graph/SceneSvg.tsx'
import { inLegend } from '../selection/sceneKeys.ts'

/** A graph placed on a layout page, and which of its Format dialogs a point on it opens. */
interface PageFormat {
  graphId: NodeId
  target: FormatTarget
  /** What was under the point ("data set", "Y axis"…), for menus. */
  what: string
}

/**
 * The Format dialog for a point on a graph placed on a layout page (page coordinates, points):
 * the element under the point opens its dialog and tab exactly as on the graph's own canvas
 * (data → that data set's place, an axis → that axis'…); elsewhere on the graph, the graph's. Null when the item isn't a live graph.
 */
export function formatOnPage(
  project: Project,
  layout: LayoutNode,
  page: PageScene,
  index: number,
  pt: { x: number; y: number },
): PageFormat | null {
  const item = layout.items[index]
  if (item?.type !== 'graph') return null
  const graph = project.nodes[item.graph]
  if (graph?.kind !== 'graph') return null
  const node = page.root.children?.find((n: SceneNode) => n.id === `item/${item.id}`)
  // Only the graph's own subtree: panel letters and other items don't count.
  const hit = node ? hitTest({ id: 'page', children: [node] }, pt.x, pt.y) : null
  // Roadmap 47b: any part of the legend formats the legend (an entry is chosen on the page).
  const key = hit?.target?.length ? selectionKey(hit.target) : null
  const onLegend = !!hit && inLegend(hit.node.id)
  const target = onLegend ? LEGEND_PLACE : key ? formatTargetFor(key, graph) : graphPlace()
  return { graphId: graph.id, target, what: describeTarget(target, graph) }
}

/** The right-click menu entries for a graph on a page: its element, then graph and axes. */
export function pageFormatChoices(f: PageFormat): { label: string; target: FormatTarget }[] {
  const out = [{ label: `Format ${f.what}…`, target: f.target }]
  if (f.target.place !== 'graph') out.push({ label: 'Format graph…', target: graphPlace() })
  if (f.target.place !== 'axis') out.push({ label: 'Format axes…', target: axisPlace('y') })
  return out
}

/**
 * The scene node under a page point on a graph placed on the page (roadmap 34d: its hover card),
 * with its graph; null off the graph's elements or for other items.
 */
export function markOnPage(
  project: Project,
  layout: LayoutNode,
  page: PageScene,
  index: number,
  pt: { x: number; y: number },
): { graph: GraphNode; node: SceneNode } | null {
  const item = layout.items[index]
  if (item?.type !== 'graph') return null
  const graph = project.nodes[item.graph]
  if (graph?.kind !== 'graph') return null
  const sub = page.root.children?.find((n: SceneNode) => n.id === `item/${item.id}`)
  const hit = sub ? hitTest({ id: 'page', children: [sub] }, pt.x, pt.y) : null
  return hit
    ? { graph, node: hit.node.target ? hit.node : { ...hit.node, target: hit.target } }
    : null
}
