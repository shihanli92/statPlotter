import { pointKey, type SymbolShape } from '@ps/model'
import type { Fill, PointPaint, PointsPrim, SceneNode, Stroke } from '../scene.ts'

// Point clouds (roadmap 34e): a points layer of many points draws one `points` primitive instead
// of a node per point — centres, sizes and paints in typed arrays — which the screen shows as an
// image and exports draw as the symbols each would be. Hovering and selecting go through a
// uniform grid of the points built once per primitive; a point's own node is made on demand.

/** Points per layer above which 'auto' draws them as an image on screen. */
export const RASTER_THRESHOLD = 20_000
/** A vector export with more points than this gets a notice (large, slow to open). */
export const VECTOR_POINTS_NOTICE = 100_000

export type PointRender = 'auto' | 'vector' | 'image'
export type PointOrder = 'table' | 'value' | 'random'

/** Whether a layer's `count` points are drawn as a cloud (an image on screen). */
export const drawsCloud = (render: PointRender | undefined, count: number): boolean =>
  render === 'image' || ((render ?? 'auto') === 'auto' && count > RASTER_THRESHOLD)

const paintKey = (p: PointPaint) =>
  `${p.shape}|${p.stroke ? `${p.stroke.color},${p.stroke.width},${p.stroke.dash}` : '-'}|${
    p.fill ? `${p.fill.color},${p.fill.opacity}` : '-'
  }`

/** Collects a layer's points (in drawing order) into a `points` primitive. */
export class CloudBuilder {
  private n = 0
  private x = new Float64Array(1024)
  private y = new Float64Array(1024)
  private size = new Float64Array(1024)
  private paint = new Uint32Array(1024)
  private rows = new Int32Array(1024)
  private subs: Int32Array | null = null
  private ks: Int32Array | null = null
  private readonly paints: PointPaint[] = []
  private readonly paintIndex = new Map<string, number>()

  /**
   * @param prefix the id its points' nodes start with: point i's is `<prefix>/<row>` (with
   *   `/<k>`, its place in its row, when given), as its symbol node's; its point key is its
   *   row's (and replicate's)
   */
  constructor(private readonly prefix: string) {}

  /** The index of a paint (the same paint shared by every point painted so). */
  paintOf(shape: SymbolShape, stroke: Stroke | null, fill: Fill | null): number {
    const p = { shape, stroke, fill }
    const k = paintKey(p)
    let i = this.paintIndex.get(k)
    if (i === undefined) {
      i = this.paints.length
      this.paints.push(p)
      this.paintIndex.set(k, i)
    }
    return i
  }

  /** The style `quick` is of. */
  private quickStyle: object | null = null
  /** Shape → colour → paint index, for points of `quickStyle` without a format of their own. */
  private readonly quick = new Map<string, Map<string, number>>()

  /**
   * The index of the paint of a point drawn in `style` (its border and fill) with this shape and
   * colour: `make` makes it the first time (audit 3, P4: a paint and its key for each of a
   * million points was a sixth of a layout). The same index `paintOf` gives.
   */
  paintFor(
    style: object,
    shape: SymbolShape,
    color: string,
    make: () => { stroke: Stroke | null; fill: Fill | null },
  ): number {
    if (style !== this.quickStyle) {
      this.quickStyle = style
      this.quick.clear()
    }
    let byColor = this.quick.get(shape)
    if (!byColor) {
      byColor = new Map()
      this.quick.set(shape, byColor)
    }
    let i = byColor.get(color)
    if (i === undefined) {
      const { stroke, fill } = make()
      i = this.paintOf(shape, stroke, fill)
      byColor.set(color, i)
    }
    return i
  }

  add(cx: number, cy: number, size: number, paint: number, row: number, sub = -1, k = -1): void {
    if (this.n === this.x.length) this.grow()
    const i = this.n++
    this.x[i] = cx
    this.y[i] = cy
    this.size[i] = size
    this.paint[i] = paint
    this.rows[i] = row
    if (sub >= 0 && !this.subs) this.subs = new Int32Array(this.x.length).fill(-1)
    if (this.subs) this.subs[i] = sub
    if (k >= 0 && !this.ks) this.ks = new Int32Array(this.x.length).fill(-1)
    if (this.ks) this.ks[i] = k
  }

  get count(): number {
    return this.n
  }

  private grow() {
    const m = this.x.length * 2
    const more = <A extends Float64Array | Uint32Array | Int32Array>(a: A, fill = 0): A => {
      const b = new (a.constructor as new (n: number) => A)(m)
      b.set(a)
      if (fill) b.fill(fill, a.length)
      return b
    }
    this.x = more(this.x)
    this.y = more(this.y)
    this.size = more(this.size)
    this.paint = more(this.paint)
    this.rows = more(this.rows)
    if (this.subs) this.subs = more(this.subs, -1)
    if (this.ks) this.ks = more(this.ks, -1)
  }

  build(): PointsPrim {
    const n = this.n
    const rows = this.rows.slice(0, n)
    const subs = this.subs?.slice(0, n) ?? null
    const ks = this.ks?.slice(0, n) ?? null
    return {
      type: 'points',
      n,
      x: this.x.slice(0, n),
      y: this.y.slice(0, n),
      size: this.size.slice(0, n),
      paint: this.paint.slice(0, n),
      paints: this.paints,
      rows,
      point: cloudPoint(this.prefix, rows, subs, ks),
    }
  }
}

/**
 * A built cloud's `point`: its id and key from its row, replicate and place in its row. Made
 * here, of these arrays only (audit 3, P1): a closure made in a layout keeps every variable the
 * layout's closures read, the layout's rows and looks with them, for as long as the scene lives.
 */
function cloudPoint(
  prefix: string,
  rows: Int32Array,
  subs: Int32Array | null,
  ks: Int32Array | null,
): PointsPrim['point'] {
  return (i) => {
    const [row, sub, k] = [rows[i]!, subs ? subs[i]! : -1, ks ? ks[i]! : -1]
    return {
      id: `${prefix}/${row}${k >= 0 ? `/${k}` : ''}`,
      key: pointKey(row, sub >= 0 ? sub : undefined),
    }
  }
}

const sameArray = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Within this of one shift (points), points are taken as moved by it: far below a pixel. */
const SHIFT_TOLERANCE = 1e-6

/** The shift `d` with every `b[i]` within `SHIFT_TOLERANCE` of `a[i] + d`; null when none. */
function shiftOf(a: Float64Array, b: Float64Array): number | null {
  if (!a.length) return 0
  const d = b[0]! - a[0]!
  if (!Number.isFinite(d)) return null
  for (let i = 0; i < a.length; i++)
    if (!(Math.abs(b[i]! - a[i]! - d) <= SHIFT_TOLERANCE)) return null
  return d
}

/**
 * Whether cloud `b` draws cloud `a`'s points moved by (dx, dy), and by how much: the same sizes
 * and paints in the same order, every centre moved alike (within a millionth of a point), so
 * `a`'s image moved is `b`'s (audit 3, P4: a re-layout after a title moved leaves a cloud as it
 * was, or moves the plot). Null when they differ otherwise. Linear; ids and keys don't draw.
 */
export function pointsShift(a: PointsPrim, b: PointsPrim): [dx: number, dy: number] | null {
  if (a === b) return [0, 0]
  if (a.n !== b.n || JSON.stringify(a.paints) !== JSON.stringify(b.paints)) return null
  if (!sameArray(a.paint, b.paint) || !sameArray(a.size, b.size)) return null
  const dx = shiftOf(a.x, b.x)
  const dy = dx === null ? null : shiftOf(a.y, b.y)
  return dx === null || dy === null ? null : [dx, dy]
}

/** A symbol drawn as a node of its own (no children, not moved): a box's outlier, for one. */
export const isLoneSymbol = (n: SceneNode): boolean =>
  n.prim?.type === 'symbol' && !n.children?.length && !n.transform

/** A point standing for a row drawn as a node of its own: a symbol with its point key. */
export const isRowSymbol = (n: SceneNode): boolean => n.point !== undefined && isLoneSymbol(n)

/**
 * Symbol nodes (`isLoneSymbol`, in drawing order) as one cloud: the same symbols, ids and point
 * keys (decision 451; '' for a symbol without one, an outlier), so it exports as the nodes did,
 * byte for byte.
 */
export function nodesCloud(nodes: readonly SceneNode[]): PointsPrim {
  const n = nodes.length
  const [x, y, size] = [new Float64Array(n), new Float64Array(n), new Float64Array(n)]
  const paint = new Uint32Array(n)
  const rows = new Int32Array(n)
  const ids: string[] = new Array(n)
  const keys: string[] = new Array(n)
  const paints: PointPaint[] = []
  const index = new Map<string, number>()
  nodes.forEach((node, i) => {
    const p = node.prim as Extract<SceneNode['prim'], { type: 'symbol' }>
    const q = { shape: p.shape, stroke: p.stroke, fill: p.fill }
    const k = paintKey(q)
    let j = index.get(k)
    if (j === undefined) {
      j = paints.length
      paints.push(q)
      index.set(k, j)
    }
    ;[x[i], y[i], size[i], paint[i]] = [p.cx, p.cy, p.size, j]
    ids[i] = node.id
    keys[i] = node.point ?? ''
    const m = /^r(\d+)/.exec(keys[i])
    rows[i] = m ? Number(m[1]) : -1
  })
  return {
    type: 'points',
    n,
    x,
    y,
    size,
    paint,
    paints,
    rows,
    point: (i) => ({ id: ids[i]!, key: keys[i]! }),
  }
}

/**
 * A layer's marks of a data set with each run of row symbols (`isRowSymbol`, or what `isRow`
 * says: a box layer's outliers) made one cloud node in its place, so the marks keep their order
 * (decision 451). Unchanged when there are none.
 */
export function cloudsOfRuns(
  nodes: readonly SceneNode[],
  isRow: (n: SceneNode) => boolean = isRowSymbol,
): SceneNode[] {
  const out: SceneNode[] = []
  let run: SceneNode[] = []
  const flush = () => {
    if (!run.length) return
    const first = run[0]!
    out.push({
      id: `${first.id}/cloud`,
      ...(first.target ? { target: first.target } : {}),
      ...(first.layer ? { layer: first.layer } : {}),
      prim: nodesCloud(run),
    })
    run = []
  }
  for (const n of nodes) {
    if (isRow(n)) run.push(n)
    else {
      flush()
      out.push(n)
    }
  }
  flush()
  return out
}

/** A cloud's primitive with every point moved by `at` (sizes and strokes kept). */
export function movePoints(
  p: PointsPrim,
  at: (x: number, y: number) => [number, number],
): PointsPrim {
  const x = new Float64Array(p.n)
  const y = new Float64Array(p.n)
  for (let i = 0; i < p.n; i++) [x[i], y[i]] = at(p.x[i]!, p.y[i]!)
  return { ...p, x, y }
}

/** A cloud's primitive scaled by `s` (centres, sizes, stroke widths). */
export function scalePoints(p: PointsPrim, s: number): PointsPrim {
  const size = new Float64Array(p.n)
  for (let i = 0; i < p.n; i++) size[i] = p.size[i]! * s
  return {
    ...movePoints(p, (x, y) => [x * s, y * s]),
    size,
    paints: p.paints.map((q) => ({
      ...q,
      stroke: q.stroke ? { ...q.stroke, width: q.stroke.width * s } : null,
    })),
  }
}

// --- Draw order ------------------------------------------------------------------------------

/** The fixed seed of the random drawing order (the same order on every draw). */
const SHUFFLE_SEED = 34

/**
 * The order to draw `n` points in (indices into them), or null for as they come: 'value' by
 * `value(i)` ascending (missing values first, under the others; ties in their order), so the
 * highest is drawn last, on top; 'random' a shuffle with a fixed seed.
 */
export function drawOrder(
  n: number,
  order: PointOrder | undefined,
  value?: (i: number) => number,
): Int32Array | null {
  if (order === 'random') {
    const idx = Int32Array.from({ length: n }, (_, i) => i)
    let a = SHUFFLE_SEED >>> 0
    // mulberry32 (public domain), Fisher–Yates from the end.
    const u = () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(u() * (i + 1))
      const t = idx[i]!
      idx[i] = idx[j]!
      idx[j] = t
    }
    return idx
  }
  if (order === 'value' && value) {
    const v = Float64Array.from({ length: n }, (_, i) => value(i))
    const idx = Array.from({ length: n }, (_, i) => i)
    const key = (i: number) => (Number.isFinite(v[i]) ? v[i]! : Number.NEGATIVE_INFINITY)
    idx.sort((a, b) => key(a) - key(b) || a - b)
    return Int32Array.from(idx)
  }
  return null
}

// --- Hit-testing -----------------------------------------------------------------------------

/** A uniform grid of a cloud's points: cell → the points whose centre is in it. */
export interface CloudIndex {
  x0: number
  y0: number
  cell: number
  cols: number
  rows: number
  /** Points of cell c are `items[start[c]] … items[start[c + 1] − 1]`, in drawing order. */
  start: Int32Array
  items: Int32Array
  /** The largest radius. */
  rMax: number
}

const indexes = new WeakMap<PointsPrim, CloudIndex>()

/** The cloud's grid (built once per primitive, in linear time). */
export function cloudIndex(p: PointsPrim): CloudIndex {
  const hit = indexes.get(p)
  if (hit) return hit
  let [x0, y0, x1, y1, rMax] = [Infinity, Infinity, -Infinity, -Infinity, 0]
  for (let i = 0; i < p.n; i++) {
    const [x, y] = [p.x[i]!, p.y[i]!]
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
    if (p.size[i]! / 2 > rMax) rMax = p.size[i]! / 2
  }
  if (!p.n) [x0, y0, x1, y1] = [0, 0, 0, 0]
  // About two points per cell, never cells smaller than a symbol.
  const area = Math.max((x1 - x0) * (y1 - y0), 1)
  const cell = Math.max(2 * rMax, Math.sqrt((2 * area) / Math.max(p.n, 1)), 1)
  const cols = Math.min(4096, Math.floor((x1 - x0) / cell) + 1)
  const rows = Math.min(4096, Math.floor((y1 - y0) / cell) + 1)
  const cellOf = (i: number) =>
    Math.min(rows - 1, Math.floor((p.y[i]! - y0) / cell)) * cols +
    Math.min(cols - 1, Math.floor((p.x[i]! - x0) / cell))
  const start = new Int32Array(cols * rows + 1)
  for (let i = 0; i < p.n; i++) start[cellOf(i) + 1]!++
  for (let c = 0; c < cols * rows; c++) start[c + 1]! += start[c]!
  const fill = start.slice(0, cols * rows)
  const items = new Int32Array(p.n)
  for (let i = 0; i < p.n; i++) items[fill[cellOf(i)]!++] = i
  const out = { x0, y0, cell, cols, rows, start, items, rMax }
  indexes.set(p, out)
  return out
}

/**
 * The topmost point (last drawn) whose symbol covers (x, y), widened by `tol`; −1 when none.
 */
export function cloudHit(p: PointsPrim, x: number, y: number, tol = 2): number {
  if (!p.n) return -1
  const g = cloudIndex(p)
  const reach = g.rMax + tol
  const c0 = Math.max(0, Math.floor((x - reach - g.x0) / g.cell))
  const c1 = Math.min(g.cols - 1, Math.floor((x + reach - g.x0) / g.cell))
  const r0 = Math.max(0, Math.floor((y - reach - g.y0) / g.cell))
  const r1 = Math.min(g.rows - 1, Math.floor((y + reach - g.y0) / g.cell))
  let best = -1
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const cell = r * g.cols + c
      for (let k = g.start[cell]!; k < g.start[cell + 1]!; k++) {
        const i = g.items[k]!
        if (i <= best) continue
        const d = Math.hypot(x - p.x[i]!, y - p.y[i]!)
        if (d <= p.size[i]! / 2 + tol) best = i
      }
    }
  return best
}

/**
 * The cloud's point `i` as a node of its own: its id, point key (none for an outlier's), symbol
 * and the cloud's target.
 */
export function cloudPointNode(node: SceneNode, i: number): SceneNode {
  const p = node.prim as PointsPrim
  const { id, key } = p.point(i)
  const paint = p.paints[p.paint[i]!]!
  const [cx, cy, size] = [p.x[i]!, p.y[i]!, p.size[i]!]
  return {
    id,
    ...(node.target ? { target: node.target } : {}),
    ...(node.layer ? { layer: node.layer } : {}),
    ...(key ? { point: key } : {}),
    prim: {
      type: 'symbol',
      shape: paint.shape,
      cx,
      cy,
      size,
      stroke: paint.stroke,
      fill: paint.fill,
    },
    bbox: { x: cx - size / 2, y: cy - size / 2, w: size, h: size },
    cloud: { node, index: i },
  }
}

/** The index of the cloud's point with this key (−1: none). */
export function cloudPointIndex(p: PointsPrim, key: string): number {
  const m = /^r(\d+)/.exec(key)
  if (!m) return -1
  const row = Number(m[1])
  for (let i = 0; i < p.n; i++) if (p.rows[i] === row && p.point(i).key === key) return i
  return -1
}

/** Points a scene draws: symbol nodes and the points of its clouds. */
export function scenePointCount(root: SceneNode): number {
  let k = 0
  const walk = (n: SceneNode) => {
    if (n.prim?.type === 'symbol') k++
    else if (n.prim?.type === 'points') k += n.prim.n
    for (const c of n.children ?? []) walk(c)
  }
  walk(root)
  return k
}
