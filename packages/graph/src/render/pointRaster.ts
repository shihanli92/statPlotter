import type { AssetId, ImageAsset } from '@ps/model'
import { hexToRgb } from '../color.ts'
import {
  type Box,
  type PointPaint,
  type PointsPrim,
  pointsPrimBounds,
  type Scene,
  type SceneNode,
} from '../scene.ts'
import { pngWriter } from './raster.ts'

// Point clouds drawn into an image (roadmap 34e): our own rasteriser, not a browser canvas, so
// the image is the same in every browser, in a worker and in tests. Each point is a stamp of its
// symbol — the shapes `symbolPath` draws, fill then stroke (mitred corners, butt ends) — with
// anti-aliased edges from 4 × 4 samples per pixel, cached per paint, size (to a quarter pixel) and
// position within its pixel (to a quarter pixel), and blended over the points drawn before it.
// Dashes are not drawn (symbols' outlines are solid in practice).

/** Samples per pixel along each axis. */
const SS = 4
/** Sizes and sub-pixel positions are rounded to this fraction of a pixel. */
const Q = 4

interface Stamp {
  /** Offset of the stamp's first pixel from the centre's pixel. */
  o: number
  /** Width and height in pixels. */
  n: number
  fill: Float32Array | null
  stroke: Float32Array | null
  /** The part with any coverage (rows and columns, inclusive). */
  r0: number
  r1: number
  c0: number
  c1: number
}

/** How far a symbol reaches from its centre, in diameters (`symbolPath`'s shapes). */
const EXTENT: Record<PointPaint['shape'], number> = {
  circle: 0.5,
  square: 0.443,
  diamond: 0.6,
  triangle: 0.67,
  plus: 0.5,
  cross: 0.4,
}

/** The outward edge planes (unit normal, offset) of a closed symbol, or a circle's radius. */
type Shape =
  | { kind: 'circle'; r: number }
  | { kind: 'convex'; planes: [number, number, number][] }
  | { kind: 'open'; segments: [number, number, number, number][] }

/** A convex polygon (vertices around it) as outward planes n·p ≤ d. */
function convex(vs: [number, number][]): Shape {
  const planes: [number, number, number][] = []
  for (let k = 0; k < vs.length; k++) {
    const [px, py] = vs[k]!
    const [qx, qy] = vs[(k + 1) % vs.length]!
    let [nx, ny] = [qy - py, -(qx - px)]
    const len = Math.hypot(nx, ny)
    nx /= len
    ny /= len
    let d = nx * px + ny * py
    // Outward: the centre (0, 0) is inside, n·0 = 0 < d.
    if (d < 0) [nx, ny, d] = [-nx, -ny, -d]
    planes.push([nx, ny, d])
  }
  return { kind: 'convex', planes }
}

/** The geometry `symbolPath` draws, centred on (0, 0), for a diameter (pixels). */
function shapeOf(shape: PointPaint['shape'], size: number): Shape {
  const r = size / 2
  switch (shape) {
    case 'circle':
      return { kind: 'circle', r }
    case 'square': {
      const s = r * 0.886
      return convex([
        [-s, -s],
        [s, -s],
        [s, s],
        [-s, s],
      ])
    }
    case 'diamond': {
      const s = r * 1.2
      return convex([
        [0, -s],
        [s, 0],
        [0, s],
        [-s, 0],
      ])
    }
    case 'triangle': {
      const s = r * 1.15
      const h = s * Math.sqrt(3)
      return convex([
        [0, (-2 / 3) * h],
        [s, h / 3],
        [-s, h / 3],
      ])
    }
    case 'plus':
      return {
        kind: 'open',
        segments: [
          [-r, 0, r, 0],
          [0, -r, 0, r],
        ],
      }
    case 'cross': {
      const s = r * 0.8
      return {
        kind: 'open',
        segments: [
          [-s, -s, s, s],
          [s, -s, -s, s],
        ],
      }
    }
  }
}

/** Signed distance from a closed shape's outline (negative inside). */
function signedDistance(s: Shape, x: number, y: number): number {
  if (s.kind === 'circle') return Math.hypot(x, y) - s.r
  if (s.kind === 'convex') {
    let d = Number.NEGATIVE_INFINITY
    for (const [nx, ny, o] of s.planes) d = Math.max(d, nx * x + ny * y - o)
    return d
  }
  return Number.POSITIVE_INFINITY
}

/** Whether (x, y) is on a stroked segment of width w (butt ends). */
function onSegment(seg: readonly number[], x: number, y: number, w: number): boolean {
  const [ax, ay, bx, by] = seg as [number, number, number, number]
  const [dx, dy] = [bx - ax, by - ay]
  const len = Math.hypot(dx, dy)
  if (len === 0) return false
  const t = ((x - ax) * dx + (y - ay) * dy) / len
  const across = Math.abs((x - ax) * dy - (y - ay) * dx) / len
  return t >= 0 && t <= len && across <= w / 2
}

function makeStamp(paint: PointPaint, size: number, sw: number, fx: number, fy: number): Stamp {
  const shape = shapeOf(paint.shape, size)
  const reach = size * EXTENT[paint.shape] + (paint.stroke ? sw / 2 : 0) + 1
  const o = -Math.ceil(reach)
  const n = 2 * Math.ceil(reach) + 2
  const closed = shape.kind !== 'open'
  const fill = paint.fill && closed && paint.fill.opacity > 0 ? new Float32Array(n * n) : null
  const stroke = paint.stroke && sw > 0 ? new Float32Array(n * n) : null
  const k = 1 / (SS * SS)
  for (let py = 0; py < n; py++)
    for (let px = 0; px < n; px++) {
      let f = 0
      let s = 0
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const x = o + px + (sx + 0.5) / SS - fx
          const y = o + py + (sy + 0.5) / SS - fy
          if (closed) {
            const d = signedDistance(shape, x, y)
            if (fill && d <= 0) f++
            if (stroke && Math.abs(d) <= sw / 2) s++
          } else if (stroke && shape.kind === 'open') {
            if (shape.segments.some((g) => onSegment(g, x, y, sw))) s++
          }
        }
      if (fill) fill[py * n + px] = f * k
      if (stroke) stroke[py * n + px] = s * k
    }
  let [r0, r1, c0, c1] = [n, -1, n, -1]
  for (let py = 0; py < n; py++)
    for (let px = 0; px < n; px++)
      if ((fill?.[py * n + px] ?? 0) > 0 || (stroke?.[py * n + px] ?? 0) > 0) {
        if (py < r0) r0 = py
        if (py > r1) r1 = py
        if (px < c0) c0 = px
        if (px > c1) c1 = px
      }
  return { o, n, fill, stroke, r0, r1, c0, c1 }
}

const rgb01 = (hex: string): [number, number, number] => {
  const [r, g, b] = hexToRgb(hex)
  return [r / 255, g / 255, b / 255]
}

/**
 * Blends a stamp over the image (premultiplied RGBA, 0–1): its fill, then its stroke, each a
 * colour through its coverage mask, over what is drawn.
 */
function blend(
  acc: Float32Array,
  W: number,
  H: number,
  st: Stamp,
  x0: number,
  y0: number,
  fill: readonly [number, number, number] | null,
  fillAlpha: number,
  stroke: readonly [number, number, number] | null,
) {
  const n = st.n
  const fm = fill ? st.fill : null
  const sm = stroke ? st.stroke : null
  const ya = Math.max(st.r0, -y0)
  const yb = Math.min(st.r1, H - 1 - y0)
  const xa = Math.max(st.c0, -x0)
  const xb = Math.min(st.c1, W - 1 - x0)
  for (let py = ya; py <= yb; py++) {
    const row = (y0 + py) * W + x0
    for (let px = xa; px <= xb; px++) {
      const at = (row + px) * 4
      if (fm) {
        const a = fm[py * n + px]! * fillAlpha
        if (a > 0) {
          const keep = 1 - a
          acc[at] = fill![0] * a + acc[at]! * keep
          acc[at + 1] = fill![1] * a + acc[at + 1]! * keep
          acc[at + 2] = fill![2] * a + acc[at + 2]! * keep
          acc[at + 3] = a + acc[at + 3]! * keep
        }
      }
      if (sm) {
        const a = sm[py * n + px]!
        if (a > 0) {
          const keep = 1 - a
          acc[at] = stroke![0] * a + acc[at]! * keep
          acc[at + 1] = stroke![1] * a + acc[at + 1]! * keep
          acc[at + 2] = stroke![2] * a + acc[at + 2]! * keep
          acc[at + 3] = a + acc[at + 3]! * keep
        }
      }
    }
  }
}

export interface PointsImage {
  /** Where the image goes, in points (whole pixels at `scale`). */
  box: Box
  /** Pixels per point. */
  scale: number
  width: number
  height: number
  /** Premultiplied? No: plain RGBA, 8 bits, rows top to bottom. */
  rgba: Uint8Array
}

/** Largest image of points made, in pixels (a 6000 × 4000 figure at 600 dpi fits). */
export const MAX_POINTS_PIXELS = 50_000_000

/**
 * The cloud's points drawn at `scale` pixels per point over the box they cover (`clip`: only
 * that part), transparent elsewhere; null when nothing would show.
 */
export function rasterizePoints(p: PointsPrim, scale: number, clip?: Box): PointsImage | null {
  const bounds = pointsPrimBounds(p)
  if (!bounds) return null
  let maxStroke = 0
  for (const q of p.paints) if (q.stroke) maxStroke = Math.max(maxStroke, q.stroke.width)
  const pad = maxStroke / 2 + 1 / scale
  let [x0, y0, x1, y1] = [
    bounds.x - pad,
    bounds.y - pad,
    bounds.x + bounds.w + pad,
    bounds.y + bounds.h + pad,
  ]
  if (clip) {
    x0 = Math.max(x0, clip.x)
    y0 = Math.max(y0, clip.y)
    x1 = Math.min(x1, clip.x + clip.w)
    y1 = Math.min(y1, clip.y + clip.h)
  }
  if (!(x1 > x0 && y1 > y0)) return null
  // Whole pixels, aligned to the scene's pixel grid at this scale.
  const px0 = Math.floor(x0 * scale)
  const py0 = Math.floor(y0 * scale)
  let W = Math.ceil(x1 * scale) - px0
  let H = Math.ceil(y1 * scale) - py0
  if (W * H > MAX_POINTS_PIXELS) {
    const k = Math.sqrt(MAX_POINTS_PIXELS / (W * H))
    return rasterizePoints(p, scale * k, clip)
  }
  W = Math.max(W, 1)
  H = Math.max(H, 1)
  const acc = new Float32Array(W * H * 4)
  // Stamps by paint, size and position within the pixel (a number: no string per point).
  const stamps = new Map<number, Stamp>()
  const colours = p.paints.map((q) => ({
    fill: q.fill ? rgb01(q.fill.color) : null,
    stroke: q.stroke ? rgb01(q.stroke.color) : null,
    alpha: q.fill?.opacity ?? 0,
    sw: q.stroke ? Math.round(q.stroke.width * scale * Q) / Q : 0,
  }))
  for (let i = 0; i < p.n; i++) {
    const pi = p.paint[i]!
    const c = colours[pi]!
    const cx = p.x[i]! * scale - px0
    const cy = p.y[i]! * scale - py0
    let ix = Math.floor(cx)
    let iy = Math.floor(cy)
    let fx = Math.round((cx - ix) * Q)
    let fy = Math.round((cy - iy) * Q)
    if (fx === Q) {
      fx = 0
      ix++
    }
    if (fy === Q) {
      fy = 0
      iy++
    }
    const sizeQ = Math.round(p.size[i]! * scale * Q)
    const key = ((pi * 65536 + sizeQ) * Q + fx) * Q + fy
    let st = stamps.get(key)
    if (!st) {
      st = makeStamp(p.paints[pi]!, sizeQ / Q, c.sw, fx / Q, fy / Q)
      stamps.set(key, st)
    }
    blend(acc, W, H, st, ix + st.o, iy + st.o, c.fill, c.alpha, c.stroke)
  }
  const rgba = new Uint8Array(W * H * 4)
  for (let k = 0; k < W * H; k++) {
    const a = acc[k * 4 + 3]!
    if (a <= 0) continue
    rgba[k * 4] = Math.round((acc[k * 4]! / a) * 255)
    rgba[k * 4 + 1] = Math.round((acc[k * 4 + 1]! / a) * 255)
    rgba[k * 4 + 2] = Math.round((acc[k * 4 + 2]! / a) * 255)
    rgba[k * 4 + 3] = Math.round(Math.min(1, a) * 255)
  }
  return {
    box: { x: px0 / scale, y: py0 / scale, w: W / scale, h: H / scale },
    scale,
    width: W,
    height: H,
    rgba,
  }
}

const NO_ID = '0'.repeat(32) as AssetId

/** An image of points as a PNG asset (`level`: deflate effort, 1 for the screen). */
export function pointsPng(img: PointsImage, level = 6): ImageAsset {
  const w = pngWriter(img.width, img.height, { alpha: true, dpi: img.scale * 72, level })
  w.write(img.rgba)
  return { id: NO_ID, mime: 'image/png', width: img.width, height: img.height, bytes: w.finish() }
}

/** The cloud drawn as an image prim over the box it covers, at `scale` pixels per point. */
export function pointsImagePrim(
  p: PointsPrim,
  scale: number,
  opts: { clip?: Box; level?: number } = {},
) {
  const img = rasterizePoints(p, scale, opts.clip)
  if (!img) return null
  return { type: 'image' as const, ...img.box, asset: pointsPng(img, opts.level) }
}

/**
 * The scene with every point cloud drawn as an image at `pxPerPt` pixels per point (of the
 * scene; a page's graphs at their scale): "Points as image" exports (at the export's resolution)
 * and the golden of a raster layer. Everything else is the scene's own (still vector).
 */
export function pointsAsImages(scene: Scene, pxPerPt: number, level = 6): Scene {
  const walk = (n: SceneNode, k: number): SceneNode => {
    const kk = n.transform ? k * (n.transform.scale || 1) : k
    const children = n.children?.map((c) => walk(c, kk))
    if (n.prim?.type !== 'points') return children ? { ...n, children } : n
    const img = pointsImagePrim(n.prim, pxPerPt * kk, { level })
    const { prim: _, ...rest } = n
    return { ...rest, ...(img ? { prim: img } : {}), ...(children ? { children } : {}) }
  }
  return { ...scene, root: walk(scene.root, 1) }
}

/** Whether a scene draws any point cloud. */
export function hasPointClouds(n: SceneNode): boolean {
  return n.prim?.type === 'points' || !!n.children?.some(hasPointClouds)
}
