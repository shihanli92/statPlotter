import { graphScale, type Scene, type StylePath } from '@ps/graph'
import type { GraphNode } from '@ps/model'
import type { Guide } from '../layout/snap.ts'
import { constrain45 } from '../layout/tools.ts'
import { boxBetween } from '../selection/pickInBox.ts'
import { sceneIndex } from '../selection/sceneKeys.ts'
import { applyDrag, commitOf, type DragTarget, lineEndPoint, moveAxes } from './canvasEdit.ts'
import { snapElementMove } from './canvasSnap.ts'
import {
  type EntryInsertion,
  entryDropped,
  entryInsertion,
  groupOfEntry,
  orderWithGroup,
} from './legendEdits.ts'
import { type ResizeHandle, resizePlot, resizeReadout, type SizeTarget } from './resize.ts'
import { moveEdits, moveLabel } from './selectionEdits.ts'

// A drag on a graph (roadmap 22) — an element moved or the plot resized from a handle — and what
// it does, shared by the graph view and graphs placed on layout pages.

/**
 * A drag in progress; (dx, dy) is the raw pointer move in graph points. A resize keeps the
 * proportions with `aspect` (Shift), snaps nothing when `free` (Alt) and leaves text and marks
 * their size with `keepScale` (⌘ / Ctrl).
 */
export type CanvasDrag =
  | {
      kind: 'move'
      target: DragTarget
      dx: number
      dy: number
      free: boolean
      /** A line's end: along 45° steps from its other end (Shift). */
      constrain?: boolean
      /**
       * Roadmap 44: the other selected movable elements, moved with `target` by the same amount
       * (`target` alone snaps; one edit for all).
       */
      others?: readonly DragTarget[]
    }
  | {
      kind: 'resize'
      handle: ResizeHandle
      dx: number
      dy: number
      free: boolean
      aspect: boolean
      keepScale?: boolean
    }
  | EntryDrag
  | MarqueeDrag

/**
 * Roadmap 47b: a selected legend entry dragged to another place in its group of entries (the
 * legend's order; nothing else moves). (x, y): the press, in scene points; (dx, dy) the move.
 */
export interface EntryDrag {
  kind: 'entry'
  key: string
  x: number
  y: number
  dx: number
  dy: number
  free: boolean
}

/**
 * Roadmap 44 (O3): a box drawn from a press on empty canvas or a background, picking what it
 * covers (`pickInBox`). It changes nothing in the graph, so nothing is laid out while it runs.
 * (x, y): where it started, in scene points; (dx, dy) the pointer's move since, in points.
 */
export interface MarqueeDrag {
  kind: 'marquee'
  x: number
  y: number
  dx: number
  dy: number
  /** Shift / ⌘ / Ctrl at the press: the picks are added to the selection. */
  additive: boolean
  /**
   * Points of these data sets are picked (Alt at the press, or a data set selected; empty: of
   * every data set); null: elements.
   */
  points: readonly string[] | null
}

/** A drag that moves or resizes something (what `dragOutcome` takes). */
export type ElementDrag = Exclude<CanvasDrag, MarqueeDrag>

/** A marquee's box in scene points. */
export const marqueeBox = (d: MarqueeDrag) =>
  boxBetween({ x: d.x, y: d.y }, { x: d.x + d.dx, y: d.y + d.dy })

interface DragOutcome {
  /** The graph with the drag applied (the live preview). */
  graph: GraphNode
  /** What the drag snapped to, in the coordinates of the scene it started on. */
  guides: Guide[]
  /** The plot size while resizing. */
  readout: string | null
  /** The edit committing it (one undo step); a move of several elements: the first one's. */
  commit: { path: StylePath; value: unknown; label: string }
  /** Every edit committing it, as one undo step labelled `label` ("Move 3 elements"). */
  commits: { path: StylePath; value: unknown; label: string }[]
  label: string
  /**
   * A move: how far the others moved (graph points; the dragged element's snapped move along the
   * axes it moves on), for selected elements of other graphs on a page to follow (roadmap 44).
   */
  move?: { dx: number; dy: number }
  /** Roadmap 47b: a legend entry's drag: the line where it would go (none: where it is). */
  insertion?: EntryInsertion['line']
}

/**
 * Roadmap 47b: where a dragged legend entry goes among its group's entries as `scene` draws them
 * (in a grid of any shape): the insertion, and the group's new sequence (null: it stays).
 */
export function entryDragAt(
  scene: Scene,
  d: Pick<EntryDrag, 'key' | 'x' | 'y' | 'dx' | 'dy'>,
): { insertion: EntryInsertion; seq: string[] } | null {
  const items = scene.legend ?? []
  const group = groupOfEntry(items, d.key)
  if (group === undefined) return null
  const boxes = sceneIndex(scene.root).nodes.entries.flatMap((n) =>
    n.legendEntry?.group === group && n.bbox ? [{ key: n.legendEntry.key, box: n.bbox }] : [],
  )
  const insertion = entryInsertion(boxes, d.key, { x: d.x + d.dx, y: d.y + d.dy })
  const seq = insertion && entryDropped(items, d.key, insertion.target, insertion.after)
  return insertion && seq ? { insertion, seq } : null
}

/**
 * What a drag does to `graph`, laid out as `scene` when it began: a resize snaps the plot size
 * (to 0.1 in and to `sizes` within `threshold` points) and scales text and marks with it (one
 * edit of `size`), a move snaps the element; Alt (`free`) turns snapping off.
 */
export function dragOutcome(
  graph: GraphNode,
  scene: Scene,
  d: ElementDrag,
  opts: { threshold: number; sizes: readonly SizeTarget[] },
): DragOutcome {
  if (d.kind === 'entry') {
    // The graph as it is while dragging (the line shows where the entry goes); one edit at the end.
    const at = entryDragAt(scene, d)
    const commits = at
      ? [
          {
            path: ['legend', 'order'],
            value: orderWithGroup(graph.legend, at.seq),
            label: 'Move legend entry',
          },
        ]
      : []
    return {
      graph,
      guides: [],
      readout: null,
      commit: commits[0] ?? { path: ['legend'], value: graph.legend, label: 'Move legend entry' },
      commits,
      label: 'Move legend entry',
      ...(at ? { insertion: at.insertion.line } : {}),
    }
  }
  if (d.kind === 'resize') {
    const r = resizePlot(
      { w: graph.size.plotWidth, h: graph.size.plotHeight },
      d.handle,
      d.dx,
      d.dy,
      {
        keepAspect: d.aspect,
        free: d.free,
        threshold: opts.threshold,
        others: opts.sizes,
        scale: graphScale(graph),
        keepScale: d.keepScale,
      },
    )
    const size = { plotWidth: r.w, plotHeight: r.h, ...(r.scale === 1 ? {} : { scale: r.scale }) }
    const commit = { path: ['size'], value: size, label: 'Resize graph' }
    return {
      graph: { ...graph, size },
      guides: [],
      readout: resizeReadout(r, d.keepScale),
      commit,
      commits: [commit],
      label: commit.label,
    }
  }
  const t = d.target
  const line = t.kind === 'lineEnd' ? graph.annotations[t.index] : undefined
  if (t.kind === 'lineEnd' && d.constrain && line?.type === 'line') {
    const at = lineEndPoint(scene, line, t.end)
    const other = lineEndPoint(scene, line, t.end === 'from' ? 'to' : 'from')
    if (at && other) {
      const p = constrain45(other, { x: at.x + d.dx, y: at.y + d.dy })
      const next = applyDrag(graph, scene, t, p.x - at.x, p.y - at.y)
      const commit = commitOf(next, t)
      return {
        graph: next,
        guides: [],
        readout: null,
        commit,
        commits: [commit],
        label: commit.label,
      }
    }
  }
  const s = snapElementMove(scene, graph, d.target, d.dx, d.dy, d.free ? -1 : opts.threshold)
  const own = applyDrag(graph, scene, d.target, s.dx, s.dy)
  // The others move as the pointer did, snapped along the axes the dragged element moves on.
  const along = moveAxes(d.target, graph)
  const others = d.others ?? []
  const move = { dx: along.x ? s.dx : d.dx, dy: along.y ? s.dy : d.dy }
  const moved = moveEdits(own, scene, others, move.dx, move.dy)
  const commits = [d.target, ...others].map((t) => commitOf(moved.graph, t))
  return {
    graph: moved.graph,
    guides: s.guides,
    readout: null,
    commit: commits[0]!,
    commits,
    label: moveLabel(commits),
    move,
  }
}
