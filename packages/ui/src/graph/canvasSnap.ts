import {
  type Box,
  graphScale,
  isHorizontal,
  type Scene,
  type SceneNode,
  unionBoxes,
} from '@ps/graph'
import type { GraphNode } from '@ps/model'
import { boxLines, type Guide, type SnapLine, snapBox } from '../layout/snap.ts'
import { type DragTarget, findNode, lineEndPoint, moveAxes, nodeBox } from './canvasEdit.ts'

// Snapping an element dragged on a graph (roadmap 22): back onto its computed place, onto the
// plot's centre lines and edges, and level with other text (titles, legend, text boxes).

/** Snap distance on screen, in pixels (divided by the zoom to get points). */
export const ELEMENT_SNAP_PX = 4

const byId = (scene: Scene, id: string) => {
  const n = findNode(scene.root, (x) => x.id === id)
  return n ? nodeBox(n) : null
}

/** An element's bounds in the scene (null when it isn't drawn). */
export function elementBox(scene: Scene, graph: GraphNode, t: DragTarget): Box | null {
  switch (t.kind) {
    case 'title':
      return byId(scene, 'title')
    case 'axisTitle':
      return byId(scene, `axis/${t.axis}/title`)
    case 'tickLabels': {
      const out: Box[] = []
      const walk = (n: SceneNode) => {
        if (n.id.startsWith(`axis/${t.axis}/tickLabel/`)) {
          const b = nodeBox(n)
          if (b) out.push(b)
        }
        for (const c of n.children ?? []) walk(c)
      }
      walk(scene.root)
      return unionBoxes(out)
    }
    case 'bracket':
    case 'annotation': {
      const a = graph.annotations[t.index]
      return a ? byId(scene, `annotation/${a.id}`) : null
    }
    case 'legend':
      return byId(scene, 'legend')
    case 'lineEnd': {
      const a = graph.annotations[t.index]
      const p = a?.type === 'line' ? lineEndPoint(scene, a, t.end) : null
      return p && { x: p.x, y: p.y, w: 0, h: 0 }
    }
    case 'pointLabel': {
      const n = findNode(
        scene.root,
        (x) =>
          x.target?.[0] === 'pointLabel' &&
          x.target[1] === t.dataSet &&
          x.target[2] === t.point &&
          !x.id.endsWith('/leader') &&
          !!nodeBox(x),
      )
      return n ? nodeBox(n) : null
    }
  }
}

/**
 * Where an element sits with no offset (its computed place), from where it is drawn now: null
 * for elements without one (legend, text boxes, point labels placed apart).
 */
export function homeBox(scene: Scene, graph: GraphNode, t: DragTarget): Box | null {
  const b = elementBox(scene, graph, t)
  if (!b) return null
  // Offsets are in the graph's own points, drawn times its scale.
  const k = graphScale(graph)
  const back = (dx: number, dy: number): Box => ({ ...b, x: b.x - dx * k, y: b.y - dy * k })
  switch (t.kind) {
    case 'title':
      return back(graph.titleOffset?.dx ?? 0, graph.titleOffset?.dy ?? 0)
    case 'axisTitle': {
      const o = graph.axes[t.axis]?.titleOffset
      return back(o?.dx ?? 0, o?.dy ?? 0)
    }
    case 'tickLabels': {
      const d = graph.axes[t.axis]?.tickLabelOffset ?? 0
      // d away from the axis line: down for X, left for Y, right for the right Y axis (on
      // horizontal graphs: left for X, down for Y, up for the right Y axis).
      if (isHorizontal(graph))
        return t.axis === 'x' ? back(-d, 0) : back(0, t.axis === 'y' ? d : -d)
      return t.axis === 'x' ? back(0, d) : back(t.axis === 'y' ? -d : d, 0)
    }
    case 'bracket': {
      const a = graph.annotations[t.index]
      const d = a?.type === 'bracket' ? (a.offset ?? 0) : 0
      return isHorizontal(graph) ? back(-d, 0) : back(0, d)
    }
    default:
      return null
  }
}

/** Other text elements an element lines up with: titles, the legend, text boxes. */
function otherTexts(scene: Scene, graph: GraphNode, t: DragTarget): Box[] {
  const others: DragTarget[] = [
    { kind: 'title' },
    { kind: 'axisTitle', axis: 'x' },
    { kind: 'axisTitle', axis: 'y' },
    { kind: 'axisTitle', axis: 'y2' },
    { kind: 'legend' },
    ...graph.annotations.flatMap((a, index): DragTarget[] =>
      a.type === 'text' ? [{ kind: 'annotation', index }] : [],
    ),
  ]
  const same = (o: DragTarget) => JSON.stringify(o) === JSON.stringify(t)
  return others.flatMap((o) => {
    if (same(o)) return []
    const b = elementBox(scene, graph, o)
    return b ? [b] : []
  })
}

/**
 * Snaps a drag of element `t` by (dx, dy) scene points against `scene` (the graph as drawn when
 * the drag began): its computed place (snap back) first, then the plot's centre lines, other
 * text's edges and centres, the plot's edges. Moves only along the element's own axes (tick
 * labels across their axis, brackets up and down). A negative threshold snaps nothing.
 */
export function snapElementMove(
  scene: Scene,
  graph: GraphNode,
  t: DragTarget,
  dx: number,
  dy: number,
  threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
  const axes = moveAxes(t, graph)
  const box = elementBox(scene, graph, t)
  const along = { dx: axes.x ? dx : 0, dy: axes.y ? dy : 0 }
  if (!box || threshold < 0) return { ...along, guides: [] }
  const p = scene.plot
  const x: SnapLine[] = []
  const y: SnapLine[] = []
  const home = homeBox(scene, graph, t)
  if (home) {
    x.push(...boxLines(home, 'x', 3, true))
    y.push(...boxLines(home, 'y', 3, true))
  }
  // Plot centre lines (rank 2) and edges (rank 0).
  x.push(...boxLines(p, 'x', 0).map((l, i) => (i === 1 ? { ...l, rank: 2 } : l)))
  y.push(...boxLines(p, 'y', 0).map((l, i) => (i === 1 ? { ...l, rank: 2 } : l)))
  for (const o of otherTexts(scene, graph, t)) {
    x.push(...boxLines(o, 'x', 1))
    y.push(...boxLines(o, 'y', 1))
  }
  return snapBox(box, along.dx, along.dy, { x, y }, threshold, axes)
}
