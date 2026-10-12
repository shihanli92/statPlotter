import { DENDROGRAM_THEME, nodeBounds, type Scene, type SceneNode, unionBoxes } from '@ps/graph'
import type { GraphNode, LayerOf } from '@ps/model'

// Roadmap 49c: a heat map's tree resized on the canvas — its outer edge (away from the map)
// dragged changes its depth (a row tree's width, a column tree's height), one undo step, as the
// plot's handles resize the plot. A dendrogram alone fills the plot: the plot's handles size it.

/** Where a tree stands beside the map: its outer edge moves out along this side. */
export type TreeSide = 'left' | 'right' | 'top' | 'bottom'

/** A tree's handle: the middle of its outer edge, in scene points. */
export interface TreeHandle {
  layer: string
  side: TreeSide
  x: number
  y: number
}

/** Smallest and largest depths a drag gives (the field's range). */
export const MIN_TREE = 4
export const MAX_TREE = 400

/** A graph's dendrogram layer beside a heat map (drawn tiles), by id. */
export function besideTree(graph: GraphNode, id: string): LayerOf<'dendrogram'> | undefined {
  const tiles = graph.layers.some((l) => l.geom === 'tile' && l.visible !== false)
  const l = graph.layers.find((x) => x.id === id)
  return tiles && l?.geom === 'dendrogram' && l.visible !== false ? l : undefined
}

/** The side a tree stands on: a row tree's left or right, a column tree's top or bottom. */
export const treeSide = (l: LayerOf<'dendrogram'>): TreeSide =>
  l.stat.of === 'rows'
    ? l.style?.side === 'left'
      ? 'left'
      : 'right'
    : l.style?.side === 'bottom'
      ? 'bottom'
      : 'top'

/** A tree's depth (its own, else the default). */
export const treeDepth = (l: LayerOf<'dendrogram'>): number =>
  l.style?.depth ?? DENDROGRAM_THEME.depth

/** The scene's drawn marks of a tree layer (its lines, not its cluster strip). */
function treeMarks(scene: Scene, id: string): SceneNode[] {
  const out: SceneNode[] = []
  const walk = (n: SceneNode, layer: string | undefined) => {
    const own = n.layer ?? layer
    if (own === id && n.id.startsWith('dendrogram/') && !n.id.includes('/strip/') && n.prim)
      out.push(n)
    for (const c of n.children ?? []) walk(c, own)
  }
  walk(scene.root, undefined)
  return out
}

/**
 * The layer a selection of a graph's parts names when it is one whole layer alone (a tree's
 * handle shows then: on the graph view and, roadmap 49c, on a graph placed on a page).
 */
export function layerAlone(paths: readonly (readonly unknown[])[]): string | null {
  const p = paths.length === 1 ? paths[0]! : null
  return p?.[0] === 'layers' && p.length === 2 ? String(p[1]) : null
}

/**
 * Roadmap 49c: a tree's handle on a graph placed on a page — in page points, the graph item at
 * (x, y) drawn at `scale` (a drag's page move divided by it is the move in graph points).
 */
export function pageTreeHandle(
  handle: TreeHandle,
  item: { x: number; y: number; scale: number },
): TreeHandle {
  return { ...handle, x: item.x + handle.x * item.scale, y: item.y + handle.y * item.scale }
}

/** The handle of a tree beside a heat map, if the scene draws it. */
export function treeHandle(scene: Scene, graph: GraphNode, id: string): TreeHandle | null {
  const l = besideTree(graph, id)
  if (!l) return null
  const box = unionBoxes(treeMarks(scene, id).map(nodeBounds))
  if (!box) return null
  const side = treeSide(l)
  const midX = box.x + box.w / 2
  const midY = box.y + box.h / 2
  switch (side) {
    case 'right':
      return { layer: id, side, x: box.x + box.w, y: midY }
    case 'left':
      return { layer: id, side, x: box.x, y: midY }
    case 'top':
      return { layer: id, side, x: midX, y: box.y }
    case 'bottom':
      return { layer: id, side, x: midX, y: box.y + box.h }
  }
}

/**
 * A tree's depth after its outer edge moved by (dx, dy) points: out from the map deeper, in
 * shallower, within 4–400 pt, to half a point (Alt: unrounded).
 */
export function draggedDepth(
  l: LayerOf<'dendrogram'>,
  dx: number,
  dy: number,
  free = false,
): number {
  const side = treeSide(l)
  const out = side === 'right' ? dx : side === 'left' ? -dx : side === 'bottom' ? dy : -dy
  const d = treeDepth(l) + out
  const v = free ? d : Math.round(d * 2) / 2
  return Math.max(MIN_TREE, Math.min(MAX_TREE, v))
}
