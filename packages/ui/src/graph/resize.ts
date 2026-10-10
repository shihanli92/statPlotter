import { type Box, graphFamily, type Scene } from '@ps/graph'
import { GRAPH_SCALE, type GraphNode, type NodeId, type Project } from '@ps/model'

// Resizing a graph's plot area by dragging handles on its edges and corners (roadmaps 22, 23):
// where the handles are, the new plot size for a drag (snapped to round sizes and to other
// graphs' plot sizes), the scale that text and marks follow it with, and which point of the plot
// stays put.

/**
 * A handle on the plot rectangle, by compass direction: an edge's middle (n, e, s, w) changes
 * one side, a corner both; the opposite edge or corner stays put.
 */
export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

/** Handles in drawing order: corners, then edges (drawn last, on top where they meet). */
export const RESIZE_HANDLES: readonly ResizeHandle[] = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w']

/**
 * Which edges a handle moves: x 1 = the right edge, −1 = the left, 0 = neither; y 1 = the
 * bottom, −1 = the top, 0 = neither.
 */
export function handleSides(h: ResizeHandle): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  return {
    x: h.includes('e') ? 1 : h.includes('w') ? -1 : 0,
    y: h.includes('s') ? 1 : h.includes('n') ? -1 : 0,
  }
}

const isCorner = (h: ResizeHandle) => h.length === 2

/** Smallest plot side, in points (half an inch). */
export const MIN_PLOT = 36
/** Plot sizes snap to multiples of 0.1 in. */
export const SIZE_STEP = 7.2
/** Largest plot side, in points (40 in). */
const MAX_PLOT = 2880

interface HandleSpot {
  handle: ResizeHandle
  /** Centre, in scene points. */
  x: number
  y: number
}

/**
 * The resize handles of a graph scene: the plot rectangle's four corners and the middles of its
 * four edges (an edge's handle only when that side is long enough, `4 × size` points, for it
 * not to touch the corners' handles of `size` points).
 */
export function resizeHandles(scene: Scene, size: number): HandleSpot[] {
  const p = scene.plot
  return RESIZE_HANDLES.flatMap((handle) => {
    const s = handleSides(handle)
    if (!isCorner(handle) && (s.x ? p.h : p.w) < 4 * size) return []
    return [{ handle, x: p.x + (p.w * (s.x + 1)) / 2, y: p.y + (p.h * (s.y + 1)) / 2 }]
  })
}

/**
 * The point of the plot that stays put while `handle` is dragged, as fractions of the plot box
 * from its top-left: the opposite edge or corner. Along a side the handle doesn't move (an
 * edge's handle with Shift changes both), the bottom and the left stay, as for element moves.
 */
export function resizeAnchor(handle: ResizeHandle | null): { x: 0 | 1; y: 0 | 1 } {
  const s = handle ? handleSides(handle) : { x: 0, y: 0 }
  return { x: s.x === -1 ? 1 : 0, y: s.y === 1 ? 0 : 1 }
}

/** Where `resizeAnchor` is in a plot box, in its coordinates. */
export const anchorPoint = (plot: Box, handle: ResizeHandle | null) => {
  const a = resizeAnchor(handle)
  return { x: plot.x + plot.w * a.x, y: plot.y + plot.h * a.y }
}

/** Another graph's plot size to snap to. */
export interface SizeTarget {
  w: number
  h: number
  /** The graph's name, for the readout. */
  name: string
}

interface ResizeOptions {
  /** Keep the plot's proportions (Shift). */
  keepAspect: boolean
  /** No snapping (Alt). */
  free: boolean
  /** Snap distance to other graphs' sizes, in points. */
  threshold: number
  others: readonly SizeTarget[]
  /** The graph's scale when the drag began (absent = 1). */
  scale?: number
  /** Leave the scale as it is: resize without scaling text and marks (⌘ / Ctrl). */
  keepScale?: boolean
}

interface ResizeResult {
  w: number
  h: number
  /** The graph's scale after the drag (text, symbols, line widths… follow the plot's size). */
  scale: number
  /** The other graph a side was snapped to. */
  matched: { w?: string; h?: string }
}

const clampSide = (v: number) => Math.min(MAX_PLOT, Math.max(MIN_PLOT, v))
const round = (v: number) => Math.round(v * 1000) / 1000

/**
 * The scale after resizing a plot from `from` to `to`: the scale times the square root of the
 * plot area's ratio (the geometric mean of the two sides' ratios). Proportional resizing scales
 * by exactly the sides' ratio, as a picture does; one side alone by the square root of its ratio.
 * The scale is then a function of the area alone, so any drags back to a size give back its
 * scale. To 0.01 %, within `GRAPH_SCALE`.
 */
export function scaleForResize(
  scale: number,
  from: { w: number; h: number },
  to: { w: number; h: number },
): number {
  if (!(from.w > 0 && from.h > 0)) return scale
  const s = scale * Math.sqrt((to.w * to.h) / (from.w * from.h))
  return Math.round(Math.min(GRAPH_SCALE.max, Math.max(GRAPH_SCALE.min, s)) * 1e4) / 1e4
}

/**
 * The plot size after dragging `handle` by (dx, dy) points from a plot of `start` size (the
 * opposite edge or corner stays put: dragging the right edge right widens, the top edge up
 * heightens, the left edge left widens). Unless `free`, the sides that change snap to another
 * graph's plot size within the threshold, else to 0.1 in. Keeping the aspect, the side that leads
 * (the width for a corner and the left and right edges, the height for the top and bottom
 * edges) snaps and the other follows. At least MIN_PLOT each side. Unless `keepScale`, the scale
 * follows the size (`scaleForResize`).
 */
export function resizePlot(
  start: { w: number; h: number },
  handle: ResizeHandle,
  dx: number,
  dy: number,
  opts: ResizeOptions,
): ResizeResult {
  const { w: w0, h: h0 } = start
  const sides = handleSides(handle)
  let w = w0 + sides.x * dx
  let h = h0 + sides.y * dy
  const matched: ResizeResult['matched'] = {}
  const snapSide = (v: number, side: 'w' | 'h'): number => {
    if (opts.free) return v
    let bestV: number | null = null
    for (const o of opts.others) {
      const t = o[side]
      if (
        Math.abs(t - v) <= opts.threshold &&
        (bestV === null || Math.abs(t - v) < Math.abs(bestV - v))
      ) {
        bestV = t
        matched[side] = o.name
      }
    }
    return bestV ?? Math.round(v / SIZE_STEP) * SIZE_STEP
  }
  const done = (w: number, h: number): ResizeResult => {
    const size = { w: round(clampSide(w)), h: round(clampSide(h)) }
    const scale0 = opts.scale ?? 1
    const scale = opts.keepScale ? scale0 : scaleForResize(scale0, start, size)
    return { ...size, scale, matched }
  }
  if (opts.keepAspect && w0 > 0 && h0 > 0) {
    const ratio = h0 / w0
    // The scale whose corner is nearest the pointer.
    if (isCorner(handle)) w = (w0 * (w * w0 + h * h0)) / (w0 * w0 + h0 * h0)
    if (sides.x) {
      // The smaller side stays at least MIN_PLOT.
      w = snapSide(Math.max(w, MIN_PLOT, MIN_PLOT / ratio), 'w')
      h = w * ratio
    } else {
      h = snapSide(Math.max(h, MIN_PLOT, MIN_PLOT * ratio), 'h')
      w = h / ratio
    }
    return done(w, h)
  }
  if (sides.x) w = snapSide(clampSide(w), 'w')
  if (sides.y) h = snapSide(clampSide(h), 'h')
  return done(w, h)
}

/** A plot size in inches, e.g. "2.40 × 1.80 in". */
const inches = (w: number, h: number) => `${(w / 72).toFixed(2)} × ${(h / 72).toFixed(2)} in`

/** A scale as a percentage, e.g. "120%". */
export const percent = (scale: number) => `${+(scale * 100).toFixed(1)}%`

/** What the readout beside a resize handle says. */
export function resizeReadout(r: ResizeResult, keepScale = false): string {
  const { w, h } = r.matched
  const note =
    w && w === h
      ? `as “${w}”`
      : [w && `width as “${w}”`, h && `height as “${h}”`].filter(Boolean).join(', ')
  const text = `text ${percent(r.scale)}${keepScale ? ' (kept)' : ''}`
  return `Plot ${inches(r.w, r.h)}${note ? ` (${note})` : ''} · ${text}`
}

/**
 * The plot sizes of the project's other graphs of the same kind (the part of the graph type
 * before the dot: column, xy, grouped…), to snap to: matching panels line up.
 */
export function sizeTargets(
  project: Project,
  graph: GraphNode,
  among?: readonly NodeId[],
): SizeTarget[] {
  const family = graphFamily(graph)
  const ids = among ?? project.order
  const seen = new Set<string>()
  return ids.flatMap((id) => {
    const g = project.nodes[id]
    if (g?.kind !== 'graph' || g.id === graph.id || seen.has(g.id)) return []
    seen.add(g.id)
    if (!among && graphFamily(g) !== family) return []
    return [{ w: g.size.plotWidth, h: g.size.plotHeight, name: g.name }]
  })
}
