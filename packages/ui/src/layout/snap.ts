import type { Box } from '@ps/graph'

// Snapping while dragging: page items on a layout page (`snapMove`, `snapScale`) and elements
// moved on a graph (`snapBox`), with the guide lines to draw.

/** A page item as snapping sees it: its outer box and, for graphs, its plot area. */
interface SnapItem {
  box: Box
  plot?: Box
}

/** A guide line to draw while snapped: vertical (axis 'x', at x) or horizontal. */
export interface Guide {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}

/** Page margin that items also snap to, and the spacing snapped between neighbours. */
export const SNAP_MARGIN = 36
export const SNAP_GAP = 6

interface Line {
  /** Position along the axis. */
  v: number
  /** Extent across the axis, for drawing the guide. */
  a: number
  b: number
  /** Plot-area lines win ties over outer edges. */
  plot: boolean
}

const shift = (b: Box, dx: number, dy: number): Box => ({ ...b, x: b.x + dx, y: b.y + dy })

/** Edges and centre of a box along one axis. */
function lines(b: Box, axis: 'x' | 'y', plot: boolean): Line[] {
  const [p, len, q, qlen] = axis === 'x' ? [b.x, b.w, b.y, b.h] : [b.y, b.h, b.x, b.w]
  return [p, p + len / 2, p + len].map((v) => ({ v, a: q, b: q + qlen, plot }))
}

function itemLines(it: SnapItem, axis: 'x' | 'y'): Line[] {
  const outer = lines(it.box, axis, false)
  return it.plot ? [...lines(it.plot, axis, true), outer[0]!, outer[2]!] : outer
}

interface Hit {
  delta: number
  guide: Guide
  /** Tie-break: a stacking gap (2) beats plot-edge alignment (1) beats outer edges (0). */
  rank: number
}

function best(a: Hit | null, b: Hit | null): Hit | null {
  if (!a) return b
  if (!b) return a
  const da = Math.abs(a.delta)
  const db = Math.abs(b.delta)
  if (Math.abs(da - db) > 1e-9) return da < db ? a : b
  return a.rank >= b.rank ? a : b
}

/** The smallest correction along one axis that lines a moving line up with a target line. */
function snapAxis(
  moving: SnapItem,
  others: readonly SnapItem[],
  page: { width: number; height: number },
  axis: 'x' | 'y',
  threshold: number,
): Hit | null {
  const mine = itemLines(moving, axis)
  const size = axis === 'x' ? page.width : page.height
  const across = axis === 'x' ? page.height : page.width
  const targets: Line[] = [
    ...others.flatMap((o) => itemLines(o, axis)),
    ...[SNAP_MARGIN, size / 2, size - SNAP_MARGIN].map((v) => ({
      v,
      a: 0,
      b: across,
      plot: false,
    })),
  ]
  let hit: Hit | null = null
  for (const m of mine) {
    for (const t of targets) {
      const delta = t.v - m.v
      if (Math.abs(delta) > threshold) continue
      const guide: Guide = { axis, at: t.v, from: Math.min(m.a, t.a), to: Math.max(m.b, t.b) }
      hit = best(hit, { delta, guide, rank: m.plot && t.plot ? 1 : 0 })
    }
  }
  // Even spacing next to a neighbour (stacking by dragging): my near edge a gap from its far edge.
  const [p, len] = axis === 'x' ? ['x', 'w'] : ['y', 'h']
  for (const o of others) {
    const ob = o.box as unknown as Record<string, number>
    const mb = moving.box as unknown as Record<string, number>
    const overlapAcross =
      axis === 'x'
        ? moving.box.y < o.box.y + o.box.h && o.box.y < moving.box.y + moving.box.h
        : moving.box.x < o.box.x + o.box.w && o.box.x < moving.box.x + moving.box.w
    if (!overlapAcross) continue
    const after = ob[p]! + ob[len]! + SNAP_GAP - mb[p]!
    const before = ob[p]! - SNAP_GAP - (mb[p]! + mb[len]!)
    for (const delta of [after, before]) {
      if (Math.abs(delta) > threshold) continue
      const at = delta === after ? ob[p]! + ob[len]! + SNAP_GAP / 2 : ob[p]! - SNAP_GAP / 2
      const [qa, qb] =
        axis === 'x'
          ? [
              Math.min(o.box.y, moving.box.y),
              Math.max(o.box.y + o.box.h, moving.box.y + moving.box.h),
            ]
          : [
              Math.min(o.box.x, moving.box.x),
              Math.max(o.box.x + o.box.w, moving.box.x + moving.box.w),
            ]
      hit = best(hit, { delta, guide: { axis, at, from: qa, to: qb }, rank: 2 })
    }
  }
  return hit
}

/**
 * Snaps a move of `moving` by (dx, dy): its plot edges / centre (then outer edges) to the other
 * items' plot edges, the page margins and centre, or an even gap beside a neighbour, when within
 * `threshold` points. Returns the corrected move and the guides to draw.
 */
export function snapMove(
  moving: SnapItem,
  others: readonly SnapItem[],
  page: { width: number; height: number },
  dx: number,
  dy: number,
  threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
  const moved: SnapItem = {
    box: shift(moving.box, dx, dy),
    plot: moving.plot && shift(moving.plot, dx, dy),
  }
  const hx = snapAxis(moved, others, page, 'x', threshold)
  const hy = snapAxis(moved, others, page, 'y', threshold)
  return {
    dx: dx + (hx?.delta ?? 0),
    dy: dy + (hy?.delta ?? 0),
    guides: [hx?.guide, hy?.guide].filter((g): g is Guide => !!g),
  }
}

/**
 * Snaps a proportional resize (top-left fixed) to a scale where the plot width equals another
 * graph's plot width, or the plot's right / bottom edge lines up with another plot's edge.
 * `unit` is the item at scale 1 relative to its top-left corner.
 */
export function snapScale(
  item: { x: number; y: number; unit: SnapItem },
  others: readonly SnapItem[],
  scale: number,
  threshold: number,
): { scale: number; guides: Guide[] } {
  const up = item.unit.plot
  if (!up) return { scale, guides: [] }
  let bestHit: { scale: number; err: number; guide: Guide } | null = null
  const consider = (s: number, err: number, guide: Guide) => {
    if (!(s > 0) || err > threshold) return
    if (!bestHit || err < bestHit.err) bestHit = { scale: s, err, guide }
  }
  const right = (s: number) => item.x + (up.x + up.w) * s
  const bottom = (s: number) => item.y + (up.y + up.h) * s
  for (const o of others) {
    if (!o.plot) continue
    // Same plot width (and height, proportionally).
    const sw = o.plot.w / up.w
    consider(sw, Math.abs(right(sw) - right(scale)), {
      axis: 'x',
      at: right(sw),
      from: Math.min(item.y + up.y * sw, o.plot.y),
      to: Math.max(bottom(sw), o.plot.y + o.plot.h),
    })
    for (const X of [o.plot.x, o.plot.x + o.plot.w]) {
      const s = (X - item.x) / (up.x + up.w)
      consider(s, Math.abs(right(s) - right(scale)), {
        axis: 'x',
        at: X,
        from: Math.min(item.y, o.plot.y),
        to: Math.max(bottom(s), o.plot.y + o.plot.h),
      })
    }
    for (const Y of [o.plot.y, o.plot.y + o.plot.h]) {
      const s = (Y - item.y) / (up.y + up.h)
      consider(s, Math.abs(bottom(s) - bottom(scale)), {
        axis: 'y',
        at: Y,
        from: Math.min(item.x, o.plot.x),
        to: Math.max(right(s), o.plot.x + o.plot.w),
      })
    }
  }
  const hit = bestHit as { scale: number; err: number; guide: Guide } | null
  return hit ? { scale: hit.scale, guides: [hit.guide] } : { scale, guides: [] }
}

/**
 * A line something can snap to: at `v` along its axis, drawn from `a` to `b` across it (for the
 * guide). `kind` restricts it to the moving box's line of the same kind (0 start edge, 1 centre,
 * 2 end edge), e.g. to snap an element back onto its own computed place; `rank` breaks ties.
 */
export interface SnapLine {
  v: number
  a: number
  b: number
  kind?: 0 | 1 | 2
  rank?: number
}

/** The start edge, centre and end edge of a box along one axis, as snap lines. */
export function boxLines(b: Box, axis: 'x' | 'y', rank = 0, same = false): SnapLine[] {
  return lines(b, axis, false).map((l, i) => ({
    v: l.v,
    a: l.a,
    b: l.b,
    rank,
    ...(same ? { kind: i as 0 | 1 | 2 } : {}),
  }))
}

/**
 * What a resized edge, a line's end or a drawn corner snaps to on a page (roadmap 32): the other
 * items' edges and centres, the page margins and centre.
 */
export function pageSnapLines(
  boxes: readonly Box[],
  page: { width: number; height: number },
): { x: SnapLine[]; y: SnapLine[] } {
  const pageLines = (size: number, across: number): SnapLine[] =>
    [SNAP_MARGIN, size / 2, size - SNAP_MARGIN].map((v) => ({ v, a: 0, b: across }))
  return {
    x: [...boxes.flatMap((b) => boxLines(b, 'x')), ...pageLines(page.width, page.height)],
    y: [...boxes.flatMap((b) => boxLines(b, 'y')), ...pageLines(page.height, page.width)],
  }
}

/**
 * A coordinate snapped to the nearest line within `threshold` (a negative threshold: none), with
 * the guide to draw across `from`–`to` (the moving thing's extent across the axis).
 */
export function snapValue(
  v: number,
  axis: 'x' | 'y',
  lines: readonly SnapLine[],
  threshold: number,
  from: number,
  to: number,
): { v: number; guide: Guide | null } {
  let best: SnapLine | null = null
  for (const l of lines)
    if (Math.abs(l.v - v) <= threshold && (!best || Math.abs(l.v - v) < Math.abs(best.v - v)))
      best = l
  if (!best) return { v, guide: null }
  return {
    v: best.v,
    guide: { axis, at: best.v, from: Math.min(from, best.a), to: Math.max(to, best.b) },
  }
}

/**
 * Snaps a box moved by (dx, dy) — an element dragged on a graph: along each axis allowed, the
 * smallest correction (within `threshold`) that puts one of its edges or its centre on a target
 * line; `kind`-restricted targets only take the same line of the box. Returns the corrected move
 * and the guides to draw. A negative threshold turns snapping off.
 */
export function snapBox(
  box: Box,
  dx: number,
  dy: number,
  targets: { x: readonly SnapLine[]; y: readonly SnapLine[] },
  threshold: number,
  axes: { x: boolean; y: boolean } = { x: true, y: true },
): { dx: number; dy: number; guides: Guide[] } {
  const moved = shift(box, dx, dy)
  const along = (axis: 'x' | 'y'): Hit | null => {
    let hit: Hit | null = null
    const mine = lines(moved, axis, false)
    for (const t of targets[axis]) {
      // Centres first: of equally close lines (a box snapping back onto itself) the guide shows
      // the centre.
      for (const kind of [1, 0, 2]) {
        if (t.kind !== undefined && t.kind !== kind) continue
        const m = mine[kind]!
        const delta = t.v - m.v
        if (Math.abs(delta) > threshold) continue
        const guide: Guide = { axis, at: t.v, from: Math.min(m.a, t.a), to: Math.max(m.b, t.b) }
        hit = best(hit, { delta, guide, rank: t.rank ?? 0 })
      }
    }
    return hit
  }
  const hx = axes.x ? along('x') : null
  const hy = axes.y ? along('y') : null
  return {
    dx: dx + (hx?.delta ?? 0),
    dy: dy + (hy?.delta ?? 0),
    guides: [hx?.guide, hy?.guide].filter((g): g is Guide => !!g),
  }
}
