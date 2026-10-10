import type { Box } from '../scene.ts'

// Placing point labels apart (roadmap 22, as ggrepel does): each label starts beside its point
// and, when that spot is taken, moves to the nearest free one — a deterministic candidate search
// in rings around the point (right, left, above, below and the diagonals first, then further
// out), avoiding the labels already placed, every drawn point and the plot's edges. Points and
// labels sit in spatial grids, so ~100 labels among ~20 000 points take milliseconds. Pure
// geometry in points, plot-local (origin at the plot's top-left).

export interface RepelLabel {
  /** The labelled point's centre and radius (half its symbol size). */
  x: number
  y: number
  r: number
  /** The label's size. */
  w: number
  h: number
  /** A fixed centre (a label dragged into place): kept there, and avoided by the others. */
  at?: { x: number; y: number }
  /** Overrides `RepelOptions.repel` for this label. */
  repel?: boolean
  /**
   * Roadmap 34e: centred on its point when that spot is free (a group's name at its centre),
   * else moved out to the nearest free spot as other labels are.
   */
  centre?: boolean
}

/** A drawn point labels should not cover. */
export interface RepelObstacle {
  x: number
  y: number
  r: number
}

export interface RepelOptions {
  /** The plot area: labels stay inside [0, width] × [0, height]. */
  width: number
  height: number
  /**
   * Move labels apart (default); false: each beside its point (on the right, else the left),
   * placed before the others, which keep off it.
   */
  repel?: boolean
}

export interface RepelPlacement {
  /** The label's box (top-left, size). */
  box: Box
  /** The label ended up away from its point: draw a leader line back to it. */
  away: boolean
}

/** Space between a point and its label beside it. */
export const LABEL_POINT_GAP = 3
/** Space kept between two labels. */
const LABEL_PAD = 1
/**
 * The search around a point: rings out to the plot's diagonal (at most this many), at most this
 * many spots in all, before settling for the least overlap.
 */
const MAX_RINGS = 60
const MAX_CANDIDATES = 4000
/** Grid cell size (points) for points and labels. */
const CELL = 10

/** Directions (degrees, y down) tried at the first ring: beside, above, below, the diagonals. */
const NEAR = [0, 180, -90, 90, -45, 45, -135, 135]
/** The next rings, every 22.5°: the same, then those between. */
const MID = [...NEAR, -22.5, 22.5, -157.5, 157.5, -67.5, 67.5, -112.5, 112.5]
const unit = (deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180
  // Exact zeros keep the axis-aligned spots exact.
  const c = Math.abs(Math.cos(a)) < 1e-12 ? 0 : Math.cos(a)
  const s = Math.abs(Math.sin(a)) < 1e-12 ? 0 : Math.sin(a)
  return [c, s]
}
const NEAR_DIRS = NEAR.map(unit)
const MID_DIRS = MID.map(unit)

/**
 * Directions tried on a ring at distance d: the fixed ones near the point, then about a label's
 * height apart around the ring (up to 96), nearest box centres first.
 */
function ringDirections(ring: number, d: number, l: RepelLabel): [number, number][] {
  if (ring === 0) return NEAR_DIRS
  if (ring <= 3) return MID_DIRS
  const n = Math.min(96, Math.max(16, Math.ceil((2 * Math.PI * d) / (l.h * 1.5))))
  const dirs = Array.from({ length: n }, (_, k) => unit((360 * k) / n))
  const reach = ([c, s]: [number, number]) => {
    const b = candidate(l, c, s, d)
    return Math.hypot(b.x + b.w / 2 - l.x, b.y + b.h / 2 - l.y)
  }
  const keyed = dirs.map((u, k) => ({ u, k, r: reach(u) }))
  keyed.sort((a, b) => a.r - b.r || a.k - b.k)
  return keyed.map((e) => e.u)
}

/**
 * A label's box in direction (c, s) at distance d from the point's centre: its nearest side (or
 * corner, diagonally) faces the point, so the box's closest point is about d away.
 */
function candidate(l: RepelLabel, c: number, s: number, d: number): Box {
  const m = Math.max(Math.abs(c), Math.abs(s))
  const cx = l.x + c * d + (l.w / 2) * (c / m)
  const cy = l.y + s * d + (l.h / 2) * (s / m)
  return { x: cx - l.w / 2, y: cy - l.h / 2, w: l.w, h: l.h }
}

/** Distance from (x, y) to the nearest point of a box (0 inside). */
export function boxDistance(b: Box, x: number, y: number): number {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w))
  const dy = Math.max(b.y - y, 0, y - (b.y + b.h))
  return Math.hypot(dx, dy)
}

/** Whether a label box is far enough from its point to need a leader line. */
function isAway(b: Box, l: RepelLabel): boolean {
  return boxDistance(b, l.x, l.y) > l.r + LABEL_POINT_GAP + 2
}

/** Boxes (or circles, as their bounds) in a uniform grid, for overlap queries. */
class Grid {
  private readonly cells = new Map<number, number[]>()
  private readonly stamp: number[] = []
  private query = 0
  constructor(private readonly size: number) {}
  private range(b: Box): [number, number, number, number] {
    const s = this.size
    return [
      Math.floor(b.x / s),
      Math.floor(b.y / s),
      Math.floor((b.x + b.w) / s),
      Math.floor((b.y + b.h) / s),
    ]
  }
  add(i: number, b: Box): void {
    const [x0, y0, x1, y1] = this.range(b)
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++) {
        const k = ix * 1_000_003 + iy
        const list = this.cells.get(k)
        if (list) list.push(i)
        else this.cells.set(k, [i])
      }
  }
  /** Calls `f` once for each item whose cells meet the box's, until it returns true. */
  each(b: Box, f: (i: number) => boolean | undefined): void {
    const q = ++this.query
    const [x0, y0, x1, y1] = this.range(b)
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++) {
        const list = this.cells.get(ix * 1_000_003 + iy)
        if (!list) continue
        for (const i of list) {
          if (this.stamp[i] === q) continue
          this.stamp[i] = q
          if (f(i)) return
        }
      }
  }
}

const overlapArea = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

/**
 * Places labels in the given order (most important first: they get the spots nearest their
 * points). Fixed labels (`at`) stay where they are and are placed first, then labels not
 * repelled (beside their points, on the right unless that leaves the plot). Each other label takes
 * the first spot, ring by ring outwards, that is inside the plot and overlaps no label and no
 * point; when there is none within the search, the spot with the least overlap (labels count
 * more than points, and nearer is better). Deterministic: the same input gives the same result.
 */
export function placeLabels(
  labels: readonly RepelLabel[],
  obstacles: readonly RepelObstacle[],
  opts: RepelOptions,
): RepelPlacement[] {
  const W = opts.width
  const H = opts.height
  const repelOf = (l: RepelLabel) => l.repel ?? opts.repel !== false
  const out: RepelPlacement[] = new Array(labels.length)

  const points = new Grid(CELL)
  obstacles.forEach((o, i) => {
    points.add(i, { x: o.x - o.r, y: o.y - o.r, w: 2 * o.r, h: 2 * o.r })
  })
  const boxes: Box[] = []
  const placed = new Grid(CELL)
  const keep = (b: Box) => {
    placed.add(boxes.length, b)
    boxes.push(b)
  }
  /** A box moved inside the plot (as far as it fits). */
  const clampIn = (b: Box): Box => ({
    ...b,
    x: Math.max(0, Math.min(W - b.w, b.x)),
    y: Math.max(0, Math.min(H - b.h, b.y)),
  })
  const inside = (b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H

  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]!
    if (!l.at) continue
    const box = { x: l.at.x - l.w / 2, y: l.at.y - l.h / 2, w: l.w, h: l.h }
    out[i] = { box, away: isAway(box, l) }
    keep(box)
  }

  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]!
    if (l.at || repelOf(l)) continue
    const d0 = l.r + LABEL_POINT_GAP
    const right = candidate(l, 1, 0, d0)
    const box = clampIn(inside(right) ? right : candidate(l, -1, 0, d0))
    out[i] = { box, away: isAway(box, l) }
    keep(box)
  }

  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]!
    if (l.at || !repelOf(l)) continue
    const d0 = l.r + LABEL_POINT_GAP
    const step = Math.max(3, l.h * 0.8)
    const far = Math.hypot(W, H)
    let best: Box | null = null
    let bestCost = Number.POSITIVE_INFINITY
    let tried = 0
    if (l.centre) {
      const b = { x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h }
      if (inside(b)) {
        const cost = overlapCost(b, boxes, placed, obstacles, points, bestCost)
        if (cost === 0) {
          out[i] = { box: b, away: false }
          keep(b)
          continue
        }
        best = b
        bestCost = cost
      }
    }
    search: for (let ring = 0; ring <= MAX_RINGS; ring++) {
      const d = d0 + ring * step
      if (d > far || tried > MAX_CANDIDATES) break
      for (const [c, s] of ringDirections(ring, d, l)) {
        tried++
        const b = candidate(l, c, s, d)
        if (!inside(b)) continue
        const cost = overlapCost(b, boxes, placed, obstacles, points, bestCost)
        if (cost === 0) {
          best = b
          break search
        }
        const total = cost + d * 0.01
        if (total < bestCost) {
          bestCost = total
          best = b
        }
      }
    }
    const box = best ?? clampIn(candidate(l, 1, 0, d0))
    out[i] = { box, away: isAway(box, l) }
    keep(box)
  }
  return out
}

/**
 * How much a label box collides: any overlap with a placed label (padded) outweighs covering
 * points, so a label covers points before it covers another label. 0 = free. Counting stops
 * once the cost reaches `limit` (the best spot's so far).
 */
function overlapCost(
  b: Box,
  boxes: readonly Box[],
  placed: Grid,
  obstacles: readonly RepelObstacle[],
  points: Grid,
  limit: number,
): number {
  let cost = 0
  const padded = {
    x: b.x - LABEL_PAD,
    y: b.y - LABEL_PAD,
    w: b.w + 2 * LABEL_PAD,
    h: b.h + 2 * LABEL_PAD,
  }
  placed.each(padded, (j) => {
    const area = overlapArea(padded, boxes[j]!)
    if (area > 0) cost += 10_000 + area * 10
    return cost >= limit
  })
  if (cost >= limit) return cost
  points.each(b, (j) => {
    const o = obstacles[j]!
    if (boxDistance(b, o.x, o.y) < o.r + 0.5) cost += 4 + o.r
    return cost >= limit
  })
  return cost
}

/**
 * A leader line from the edge of a point (centre, radius) to the nearest point of its label's
 * box, stopping just short of the box; null when the label touches the point.
 */
export function leaderLine(
  x: number,
  y: number,
  r: number,
  box: Box,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const tx = Math.max(box.x, Math.min(box.x + box.w, x))
  const ty = Math.max(box.y, Math.min(box.y + box.h, y))
  const len = Math.hypot(tx - x, ty - y)
  const gap = 1
  if (len <= r + gap + 0.5) return null
  const [ux, uy] = [(tx - x) / len, (ty - y) / len]
  return { x1: x + ux * r, y1: y + uy * r, x2: tx - ux * gap, y2: ty - uy * gap }
}
