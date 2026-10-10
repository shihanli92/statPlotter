import type { GraphNode, LayoutItem, LayoutNode, NodeId, Project } from '@ps/model'

// Pasting a copied graph onto a layout page (roadmap 23): it is placed like Insert › Graph on
// page (linked to the graph, which keeps following its data), where the pointer is.

/** The scale a graph of this size (points) gets on the page: 1, or less to fit within 36 pt. */
export function fitScale(
  page: LayoutNode['page'],
  size: { width: number; height: number },
): number {
  return Math.min(1, (page.width - 72) / size.width, (page.height - 72) / size.height)
}

/** Steps off an item already at the spot (pasting twice), as Graph on page does. */
const STEP = 12

/**
 * Where a pasted graph of `size` (points, unscaled) goes: centred on `at` (the pointer on the
 * page, in points) or on the page's centre, scaled to fit, kept on the page, and moved down and
 * right in 12 pt steps while an item already has its top-left corner there.
 */
export function pastePlacement(
  page: LayoutNode['page'],
  size: { width: number; height: number },
  at: { x: number; y: number } | null,
  items: readonly { x: number; y: number }[],
): { x: number; y: number; scale: number } {
  const scale = fitScale(page, size)
  const w = size.width * scale
  const h = size.height * scale
  const c = at ?? { x: page.width / 2, y: page.height / 2 }
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, Math.max(0, max)))
  let x = clamp(c.x - w / 2, page.width - w)
  let y = clamp(c.y - h / 2, page.height - h)
  for (let i = 0; i < 20; i++) {
    if (!items.some((it) => Math.abs(it.x - x) < 0.5 && Math.abs(it.y - y) < 0.5)) break
    x = clamp(x + STEP, page.width - w)
    y = clamp(y + STEP, page.height - h)
  }
  return { x: round(x), y: round(y), scale: +scale.toFixed(4) }
}

const round = (v: number) => Math.round(v * 10) / 10

/** The graph a paste would place, if it is one of this project's graphs. */
export function pasteableGraph(project: Project, id: NodeId | null): GraphNode | null {
  const n = id ? project.nodes[id] : undefined
  return n?.kind === 'graph' ? n : null
}

/** The graph selected alone on the page (Copy graph), if any. */
export function selectedGraphOf(
  project: Project,
  layout: LayoutNode,
  sel: readonly number[],
): GraphNode | null {
  if (sel.length !== 1) return null
  const it: LayoutItem | undefined = layout.items[sel[0]!]
  return it?.type === 'graph' ? pasteableGraph(project, it.graph) : null
}
