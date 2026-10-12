import type { ImageAsset, RichText, SymbolShape } from '@ps/model'
import type { SampledPoints } from './layout/screen.ts'
import { boxesUnion, minMax } from './minMax.ts'
import type { TextLayout } from './text/layout.ts'

/**
 * The scene graph: a renderer-independent description of a laid-out graph. All coordinates are
 * points from the top-left of the graph; colours are resolved to #rrggbb.
 */

export interface Stroke {
  color: string
  width: number
  dash: 'solid' | 'dash' | 'dot'
}

export interface Fill {
  color: string
  opacity: number
}

export type Prim =
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: Stroke }
  | { type: 'polyline'; points: [number, number][]; stroke: Stroke }
  /** Closed filled shape, e.g. a confidence band. */
  | { type: 'polygon'; points: [number, number][]; fill: Fill; stroke: Stroke | null }
  | {
      type: 'rect'
      x: number
      y: number
      w: number
      h: number
      stroke: Stroke | null
      fill: Fill | null
      /** Rounded corners' radius (at most half the shorter side); absent: square corners. */
      rx?: number
    }
  | {
      type: 'ellipse'
      cx: number
      cy: number
      rx: number
      ry: number
      stroke: Stroke | null
      fill: Fill | null
    }
  /** Straight segments and cubic Béziers (arrowheads, outlines). */
  | { type: 'path'; d: PathCmd[]; stroke: Stroke | null; fill: Fill | null }
  /**
   * A raster image (PNG or JPEG bytes) stretched over the box; `crop` is the part of the image
   * shown, as fractions of its size from its top-left.
   */
  | {
      type: 'image'
      x: number
      y: number
      w: number
      h: number
      asset: ImageAsset
      crop?: { x: number; y: number; w: number; h: number }
    }
  | {
      type: 'symbol'
      shape: SymbolShape
      cx: number
      cy: number
      /** Outer diameter in points. */
      size: number
      stroke: Stroke | null
      fill: Fill | null
    }
  | {
      type: 'text'
      /** Baseline start of the first run, after anchoring. */
      x: number
      y: number
      layout: TextLayout
      color: string
      /** Rotation in degrees about (x, y) as given before anchoring, i.e. `origin`. */
      rotate?: { angle: number; cx: number; cy: number }
      /** Roadmap 34e: a halo round the letters (a stroke drawn under the text). */
      halo?: { color: string; width: number }
    }
  | PointsPrim

/** How a point of a point cloud is painted (one of a few per cloud). */
export interface PointPaint {
  shape: SymbolShape
  stroke: Stroke | null
  fill: Fill | null
}

/**
 * Roadmap 34e: many symbols in one primitive (a points layer of many points): their centres,
 * sizes and paints in typed arrays, in drawing order. Drawn as the symbols each would be (vector
 * exports, byte for byte as separate symbol nodes) or as an image (on screen; exports asked for
 * points as an image). Hit-tested through a spatial grid (`cloud.ts`); a point's own node (id,
 * point key, symbol) is made when it is hovered or selected.
 */
export interface PointsPrim {
  type: 'points'
  /** Number of points. */
  n: number
  x: Float64Array
  y: Float64Array
  /** Outer diameters, points. */
  size: Float64Array
  /** Index into `paints`, per point. */
  paint: Uint32Array
  paints: readonly PointPaint[]
  /** Each point's table row (for finding a point by its key). */
  rows: Int32Array
  /** Point i's own node id and point key (as its symbol node would have them). */
  point(i: number): { id: string; key: string }
}

/** A path command: move, line, cubic Bézier (two control points, then the end), close. */
export type PathCmd =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Z']

/** The points of a path (ends and control points), e.g. for bounds. */
export function pathPoints(d: readonly PathCmd[]): [number, number][] {
  const out: [number, number][] = []
  for (const c of d) {
    if (c[0] === 'Z') continue
    for (let i = 1; i + 1 < c.length; i += 2) out.push([c[i] as number, c[i + 1] as number])
  }
  return out
}

/** SVG path data for path commands (to 0.001 pt). */
export function pathData(d: readonly PathCmd[]): string {
  const f = (v: number) => {
    const r = Math.round(v * 1000) / 1000
    return Object.is(r, -0) ? '0' : String(r)
  }
  return d.map(([op, ...v]) => op + v.map(f).join(',')).join('')
}

/** A rounded rectangle's outline as path commands (corner radius clamped to fit). */
export function roundedRectPath(x: number, y: number, w: number, h: number, r: number): PathCmd[] {
  const q = Math.max(0, Math.min(r, w / 2, h / 2))
  const k = q * (1 - 0.5522847498)
  return [
    ['M', x + q, y],
    ['L', x + w - q, y],
    ['C', x + w - k, y, x + w, y + k, x + w, y + q],
    ['L', x + w, y + h - q],
    ['C', x + w, y + h - k, x + w - k, y + h, x + w - q, y + h],
    ['L', x + q, y + h],
    ['C', x + k, y + h, x, y + h - k, x, y + h - q],
    ['L', x, y + q],
    ['C', x, y + k, x + k, y, x + q, y],
    ['Z'],
  ]
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Path into the GraphNode that edits this element (see DATA_MODEL §6.5). */
export type StylePath = (string | number)[]

export interface SceneNode {
  /** Semantic id, e.g. 'series/<key>/point/3', 'axis/y/tickLabel/2'. */
  id: string
  target?: StylePath
  prim?: Prim
  children?: SceneNode[]
  /** Bounds for hit-testing and selection outlines (in this node's own coordinates). */
  bbox?: Box
  /**
   * A single plotted point (a PointKey of the data set in `target`), so it can be selected and
   * formatted on its own (`pointOverrides`).
   */
  point?: string
  /**
   * A point label's position from its point (roadmap 22): the label box's centre minus the
   * point's centre, in points — what `PointStyle.labelOffset` holds for a dragged label. The
   * point is at the bbox centre minus this, so a drag of the label by (dx, dy) stores this plus
   * (dx, dy). Set on point label text nodes (target `['pointLabel', dataSet, pointKey]`).
   */
  labelOffset?: { dx: number; dy: number }
  /**
   * Places this subtree: its coordinates are scaled by `scale`, then shifted by (x, y). Used to
   * compose graphs onto layout pages.
   */
  transform?: { x: number; y: number; scale: number }
  /** The graph layer that drew this mark (roadmap 33), for selection and hover; not exported. */
  layer?: string
  /**
   * Roadmap 34e: a point of a point cloud, made for hovering or selecting it: the cloud's node
   * and the point's index in it.
   */
  cloud?: { node: SceneNode; index: number }
  /**
   * Roadmap 47b: a legend entry (its node, whose children are its sample and label): its key and
   * the group of entries it is ordered within (`legend.order`). Absent on headings, colour bars
   * and the legend's other parts.
   */
  legendEntry?: { key: string; group: string }
  /** Roadmap 49c: a dendrogram's branch or leaf, for its hover card (nothing drawn reads it). */
  tree?: TreeMark
  /**
   * Roadmap 49c: a part of a drawn node made for hovering it (a tree branch's leg down to a leaf,
   * `hitTest`): that node, `bbox` in its coordinates.
   */
  within?: SceneNode
}

/** Roadmap 49c: a leaf of a dendrogram — its row's or column's name, its cluster (cut). */
export interface TreeLeaf {
  name: string
  cluster?: number
}

/**
 * Roadmap 49c: what a dendrogram's mark stands for, for its hover card: a branch (a merge's ⊓ or
 * a part of it: R's merge height, the leaves under it, their cluster when one) or a leaf (a
 * cluster strip's band, or a branch's leg down to a leaf). The tree is of the rows or columns.
 */
export interface TreeMark {
  of: 'rows' | 'columns'
  merge?: { height: number; leaves: number; cluster?: number }
  leaf?: TreeLeaf
  /** A branch's legs down to leaves: its polyline's segment (point `seg` to the next) and leaf. */
  legs?: { seg: number; leaf: TreeLeaf }[]
}

/** Roadmap 47b: one of a legend's entries, shown or hidden (`Scene.legend`). */
export interface LegendItem {
  /** Its key (`legend.hidden`, `order`, `labels`). */
  key: string
  /** The group it is ordered within. */
  group: string
  /** Its own label (without a legend-only label). */
  label: string | RichText
  /** Left out of the legend (`legend.hidden`). */
  hidden: boolean
  /** A heading, colour bar or "… more" line: never moved, hidden or relabelled on its own. */
  fixed?: boolean
}

/** SVG transform attribute value for a node transform. */
export const transformAttr = (t: NonNullable<SceneNode['transform']>): string =>
  `translate(${t.x} ${t.y})${t.scale === 1 ? '' : ` scale(${t.scale})`}`

/**
 * One axis' mapping between values and scene coordinates (x for the X axis, y for the Y axis).
 * Continuous axes respect log scales, reversal and breaks (a value inside a break maps to the
 * break's edge); categorical axes map the category index (0 = first category's centre).
 */
export interface SceneAxis {
  categorical: boolean
  toPx(v: number): number
  fromPx(px: number): number
}

export interface Scene {
  width: number
  height: number
  root: SceneNode
  /** Plot area, for renderers that draw selection guides. */
  plot: Box
  /** Non-fatal problems to show beside the graph (e.g. "box plot needs raw data"). */
  warnings: string[]
  /** Axis mappings in scene coordinates (graphs only; absent on pages). */
  axes?: { x: SceneAxis; y: SceneAxis; y2?: SceneAxis }
  /**
   * Laid out for the screen with fewer per-row points than the data has (decision 450): the
   * largest data set's, for the view's note. Absent when every point is drawn.
   */
  sampled?: SampledPoints
  /**
   * Roadmap 47b: every entry of the graph's legend in its order (hidden ones too, and when the
   * legend is off), for its editors; absent when the graph has none.
   */
  legend?: LegendItem[]
}

/**
 * Where a scene point falls: as fractions of the plot area (0–1 from its top-left, the units of
 * 'plot'-anchored annotations and inside legends) and as axis values ('data' anchors).
 */
export function scenePoint(
  scene: Scene,
  x: number,
  y: number,
): { plot: { x: number; y: number }; data?: { x: number; y: number } } {
  const p = scene.plot
  const plot = { x: p.w ? (x - p.x) / p.w : 0, y: p.h ? (y - p.y) / p.h : 0 }
  return scene.axes
    ? { plot, data: { x: scene.axes.x.fromPx(x), y: scene.axes.y.fromPx(y) } }
    : { plot }
}

/** Bounds of points; null when there are none. */
export function pointsBounds(ps: readonly (readonly [number, number])[]): Box | null {
  if (!ps.length) return null
  // Loops, not spreads: a long polyline has more points than a call takes arguments.
  const [x, x1] = minMax(ps.map((q) => q[0]))
  const [y, y1] = minMax(ps.map((q) => q[1]))
  return { x, y, w: x1 - x, h: y1 - y }
}

/** Bounds of a primitive (null for text, whose node carries a bbox). Stroke width not included. */
export function primBounds(p: Prim): Box | null {
  switch (p.type) {
    case 'line':
      return pointsBounds([
        [p.x1, p.y1],
        [p.x2, p.y2],
      ])
    case 'polyline':
    case 'polygon':
      return pointsBounds(p.points)
    case 'rect':
    case 'image':
      return { x: p.x, y: p.y, w: p.w, h: p.h }
    case 'ellipse':
      return { x: p.cx - p.rx, y: p.cy - p.ry, w: 2 * p.rx, h: 2 * p.ry }
    case 'path':
      return pointsBounds(pathPoints(p.d))
    case 'symbol':
      return { x: p.cx - p.size / 2, y: p.cy - p.size / 2, w: p.size, h: p.size }
    case 'points':
      return pointsPrimBounds(p)
    case 'text':
      return null
  }
}

/** The box a point cloud's symbols cover (their outer diameters); null without points. */
export function pointsPrimBounds(p: PointsPrim): Box | null {
  if (!p.n) return null
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.n; i++) {
    const r = p.size[i]! / 2
    const [x, y] = [p.x[i]!, p.y[i]!]
    if (x - r < x0) x0 = x - r
    if (x + r > x1) x1 = x + r
    if (y - r < y0) y0 = y - r
    if (y + r > y1) y1 = y + r
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** A node's bounds: its bbox, else its primitive's, else the union of its children's. */
export function nodeBounds(node: SceneNode): Box | null {
  if (node.bbox) return node.bbox
  if (node.prim) return primBounds(node.prim)
  return boxesUnion((node.children ?? []).map(nodeBounds).filter((b): b is Box => !!b))
}

/** Dash pattern for a stroke, in proportion to its width (to 0.001 pt). */
export const dashArray = (s: Stroke): string | null => {
  const f = (k: number) => Math.round(s.width * k * 1000) / 1000
  return s.dash === 'dash' ? `${f(4)} ${f(3)}` : s.dash === 'dot' ? `${f(1)} ${f(2)}` : null
}

/** SVG path data for a data-point symbol centred on (cx, cy). */
export function symbolPath(shape: SymbolShape, cx: number, cy: number, size: number): string {
  const r = size / 2
  const f = (n: number) => +n.toFixed(3)
  switch (shape) {
    case 'circle':
      return `M${f(cx - r)},${f(cy)}a${f(r)},${f(r)} 0 1,0 ${f(size)},0a${f(r)},${f(r)} 0 1,0 ${f(-size)},0Z`
    case 'square': {
      const s = r * 0.886 // equal area to the circle
      return `M${f(cx - s)},${f(cy - s)}h${f(2 * s)}v${f(2 * s)}h${f(-2 * s)}Z`
    }
    case 'diamond': {
      const s = r * 1.2
      return `M${f(cx)},${f(cy - s)}L${f(cx + s)},${f(cy)}L${f(cx)},${f(cy + s)}L${f(cx - s)},${f(cy)}Z`
    }
    case 'triangle': {
      const s = r * 1.15
      const h = s * Math.sqrt(3)
      return `M${f(cx)},${f(cy - (2 / 3) * h)}L${f(cx + s)},${f(cy + h / 3)}L${f(cx - s)},${f(cy + h / 3)}Z`
    }
    case 'plus':
      return `M${f(cx - r)},${f(cy)}H${f(cx + r)}M${f(cx)},${f(cy - r)}V${f(cy + r)}`
    case 'cross': {
      const s = r * 0.8
      return `M${f(cx - s)},${f(cy - s)}L${f(cx + s)},${f(cy + s)}M${f(cx + s)},${f(cy - s)}L${f(cx - s)},${f(cy + s)}`
    }
  }
}

/** Shapes drawn as strokes only (fill is meaningless). */
export const OPEN_SHAPES: ReadonlySet<SymbolShape> = new Set(['plus', 'cross'])
