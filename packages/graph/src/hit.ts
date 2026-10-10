import { cloudHit, cloudPointNode } from './layout/cloud.ts'
import {
  type Box,
  nodeBounds,
  type Prim,
  pathPoints,
  type SceneNode,
  type StylePath,
} from './scene.ts'

// Hit-testing a scene without a DOM: which element is under a point, as a pointer on the SVG
// would find it (the last-drawn painted shape wins). Used where the scene isn't drawn as its own
// interactive SVG, e.g. graphs placed on a layout page.

export interface SceneHitResult {
  node: SceneNode
  /** The node's style target, or its nearest ancestor's. */
  target: StylePath | undefined
}

type P = [number, number]

function segmentDistance(px: number, py: number, a: P, b: P): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2)) : 0
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))
}

function insidePolygon(px: number, py: number, pts: readonly P[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!
    const [xj, yj] = pts[j]!
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Whether a primitive's painted area (fill, or stroke widened by `tol`) covers the point. */
function primHit(n: SceneNode, p: Prim, x: number, y: number, tol: number): boolean {
  const near = (pts: readonly P[], width: number, closed = false) => {
    for (let i = 1; i < pts.length; i++)
      if (segmentDistance(x, y, pts[i - 1]!, pts[i]!) <= tol + width / 2) return true
    return (
      closed && pts.length > 2 && segmentDistance(x, y, pts.at(-1)!, pts[0]!) <= tol + width / 2
    )
  }
  switch (p.type) {
    case 'line':
      return near(
        [
          [p.x1, p.y1],
          [p.x2, p.y2],
        ],
        p.stroke.width,
      )
    case 'polyline':
      return near(p.points, p.stroke.width)
    case 'polygon':
      return insidePolygon(x, y, p.points) || (!!p.stroke && near(p.points, p.stroke.width, true))
    case 'rect': {
      const inBox = x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h
      if (p.fill && p.fill.opacity > 0 && inBox) return true
      const corners: P[] = [
        [p.x, p.y],
        [p.x + p.w, p.y],
        [p.x + p.w, p.y + p.h],
        [p.x, p.y + p.h],
      ]
      return !!p.stroke && p.stroke.width > 0 && near(corners, p.stroke.width, true)
    }
    case 'image':
      return x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h
    case 'ellipse': {
      // Inside (filled), or near the outline (by the normalized radius, close enough for hits).
      const r = Math.hypot((x - p.cx) / (p.rx || 1e-9), (y - p.cy) / (p.ry || 1e-9))
      const w = (p.stroke?.width ?? 0) / 2 + tol
      const band = w / Math.max(Math.min(p.rx, p.ry), 1e-9)
      return (!!p.fill && p.fill.opacity > 0 && r <= 1) || (!!p.stroke && Math.abs(r - 1) <= band)
    }
    case 'path': {
      const pts = pathPoints(p.d)
      const closed = p.d.at(-1)?.[0] === 'Z'
      if (p.fill && closed && insidePolygon(x, y, pts)) return true
      return !!p.stroke && near(pts, p.stroke.width, closed)
    }
    case 'symbol':
      return Math.hypot(x - p.cx, y - p.cy) <= p.size / 2 + tol
    case 'points':
      // Point clouds are hit point by point (`hitTest`).
      return false
    case 'text': {
      const b = n.bbox
      return !!b && x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol
    }
  }
}

/**
 * The topmost scene element at (x, y) in the root's coordinates, following node transforms;
 * `tol` (points, in root coordinates) widens thin strokes and small marks. Null when the point is
 * on no painted element.
 */
export function hitTest(root: SceneNode, x: number, y: number, tol = 2): SceneHitResult | null {
  let hit: SceneHitResult | null = null
  const walk = (
    n: SceneNode,
    inherited: StylePath | undefined,
    px: number,
    py: number,
    t: number,
  ) => {
    let [lx, ly, lt] = [px, py, t]
    if (n.transform) {
      const s = n.transform.scale || 1
      lx = (px - n.transform.x) / s
      ly = (py - n.transform.y) / s
      lt = t / s
    }
    const target = n.target ?? inherited
    if (n.prim?.type === 'points') {
      // A point of a cloud (roadmap 34e): found in its grid, given a node of its own.
      const i = cloudHit(n.prim, lx, ly, lt)
      if (i >= 0) hit = { node: cloudPointNode({ ...n, ...(target ? { target } : {}) }, i), target }
    } else if (n.prim && primHit(n, n.prim, lx, ly, lt)) hit = { node: n, target }
    for (const c of n.children ?? []) walk(c, target, lx, ly, lt)
  }
  walk(root, undefined, x, y, tol)
  return hit
}

/**
 * Where a node of the scene is, in the root's coordinates (following node transforms): its
 * bounds, for a hover card beside a mark (roadmap 34d). Null when the node isn't in the tree or
 * has no bounds.
 */
export function boxInRoot(root: SceneNode, node: SceneNode): Box | null {
  let out: Box | null = null
  const walk = (n: SceneNode, ox: number, oy: number, s: number): boolean => {
    let [x, y, k] = [ox, oy, s]
    if (n.transform) {
      x = ox + n.transform.x * s
      y = oy + n.transform.y * s
      k = s * (n.transform.scale || 1)
    }
    const own = node.cloud && (n === node.cloud.node || n.prim === node.cloud.node.prim)
    if (own || n === node || (n.id === node.id && n.point === node.point && n.prim === node.prim)) {
      // A cloud's point: its own bounds, in the cloud's coordinates.
      const b = own ? node.bbox! : nodeBounds(n)
      if (b) out = { x: x + b.x * k, y: y + b.y * k, w: b.w * k, h: b.h * k }
      return true
    }
    for (const c of n.children ?? []) if (walk(c, x, y, k)) return true
    return false
  }
  walk(root, 0, 0, 1)
  return out
}
