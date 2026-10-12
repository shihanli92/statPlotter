import {
  type ArrowHead,
  type Dash,
  isBySeries,
  type LayerOf,
  type SeriesStroke,
  type StrokeStyle,
} from '@ps/model'
import { confidenceEllipse, convexHull, ellipseOutline } from '@ps/stats'
import { arrowHead, lineWithHeads } from '../../layout/arrows.ts'
import { clipPolyline, type Extent, runsAround } from '../../layout/common.ts'
import type { Scale } from '../../scale.ts'
import type { Fill, SceneNode, Stroke, StylePath } from '../../scene.ts'
import {
  DEFAULT_DASHES,
  DEFAULT_THEME,
  graphDashes,
  resolveFill,
  resolveStroke,
  type Theme,
} from '../../theme.ts'
import type { LayerKit } from '../kit.ts'

// Group overlays, paths and vectors on XY graphs (roadmap 34c): a closed shape per group — its
// confidence ellipse or convex hull (`polygon` with stat `ellipse` / `hull`; the numbers from
// `@ps/stats`) — each group's points joined in table row order with arrowheads (`path`), and an
// arrow per row (`segment`). The frames say what a group is (an XY table's data set; a graph of
// variables' colour or shape level) and give its points; these draw them.

/** A group's points (data coordinates, table row order) and how its marks are named. */
export interface OverlayGroup {
  /** The series key its marks are recorded under. */
  key: string
  /** Its marks' id prefix (`series/<key>/<part>`, a group index after it on graphs of variables). */
  id: (part: string) => string
  target: StylePath
  /** Its colour (fills and lines of `{ series: true }`). */
  color: string
  /**
   * Roadmap 49d: its fill colour where it differs from its colour (an XY data set's fill colour,
   * a level's of the variable it is a group of; absent: `color`).
   */
  fill?: string
  /**
   * Roadmap 49d: its place among the groups (an XY data set's colour index, a level's in its
   * variable's order), at which a line pattern by group takes the graph's line styles' entry
   * (absent: 0).
   */
  index?: number
  /** For warnings ("“Low”"). */
  label: string
  xs: readonly number[]
  ys: readonly number[]
  rows: readonly number[]
}

/** Where marks go: the plot's scales and size. */
export interface OverlayAxes {
  x: (v: number) => number
  y: (v: number) => number
  ok: (vx: number, vy: number) => boolean
  W: number
  H: number
  /**
   * Audit 2 (G2): a filled shape's corners, where a value inside an axis break goes to the
   * break's edge (the scales' `edge`; absent: `x` / `y`), and the plot's pieces between breaks
   * the fill is cut to (absent: the whole plot).
   */
  xEdge?: (v: number) => number
  yEdge?: (v: number) => number
  pieces?: PlotPieces
}

/**
 * The overlay axes of a plot's X and Y scales. With axis breaks, filled shapes place their corners
 * at the breaks' edges and are cut to the pieces between them (audit 2, G2).
 */
export function overlayAxes(
  x: Scale,
  y: Scale,
  ok: OverlayAxes['ok'],
  W: number,
  H: number,
): OverlayAxes {
  const axes: OverlayAxes = { x, y, ok, W, H }
  if (!x.gaps.length && !y.gaps.length) return axes
  return { ...axes, ...plotPieces(x, y, W, H) }
}

/** The edges and pieces of scales with axis breaks (see `OverlayAxes`). */
export const plotPieces = (x: Scale, y: Scale, W: number, H: number) => ({
  xEdge: x.edge,
  yEdge: y.edge,
  pieces: { x: runsAround(W, x.gaps), y: runsAround(H, y.gaps) },
})

/** The plot's pieces between axis breaks: plot-local runs along X and along Y. */
export interface PlotPieces {
  x: readonly [number, number][]
  y: readonly [number, number][]
}

/** Segments of an ellipse's outline as drawn. */
const SEGMENTS = 72

type Style<G extends 'polygon' | 'path' | 'segment'> = Required<NonNullable<LayerOf<G>['style']>>

/**
 * A layer's style for a key: the theme's defaults (a style's, audit 2 G9; absent: the app's), the
 * layer's, the data set's own.
 */
export function overlayStyle<G extends 'polygon' | 'path' | 'segment'>(
  layer: LayerOf<G>,
  key: string,
  theme: Pick<Theme, 'overlay'> = DEFAULT_THEME,
): Style<G> {
  const l = layer as LayerOf<'polygon' | 'path' | 'segment'>
  return {
    ...theme.overlay[l.geom],
    ...l.style,
    ...l.series?.[key]?.style,
  } as unknown as Style<G>
}

/**
 * Roadmap 49d: an overlay's line with a pattern by group (`{ series: true }`) resolved — the
 * graph's line styles' entry at the group's place (wrapping, as data sets' do; decision 1214 left
 * these fixed); any other line as it is.
 */
export function groupStroke(
  stroke: SeriesStroke,
  dashes: readonly Dash[] = DEFAULT_DASHES,
  index = 0,
): StrokeStyle {
  if (!isBySeries(stroke.dash)) return stroke as StrokeStyle
  return { ...stroke, dash: dashes[Math.max(0, index) % dashes.length]! }
}

/** A group's ellipse or hull in data coordinates, or why there is none. */
export function overlayShape(
  layer: LayerOf<'polygon'>,
  xs: readonly number[],
  ys: readonly number[],
): { points: [number, number][] } | { reason: string } {
  if (layer.stat.kind === 'hull') {
    const hull = convexHull(xs, ys)
    if (hull.length < 3)
      return { reason: hull.length < 2 ? 'fewer than three points' : 'the points lie on a line' }
    return { points: hull.map((i): [number, number] => [xs[i]!, ys[i]!]) }
  }
  const r = confidenceEllipse(xs, ys, layer.stat.type, layer.stat.level)
  return r.ok ? { points: ellipseOutline(r.fit, SEGMENTS) } : { reason: r.reason }
}

/**
 * Shapes per layout (its kit), layer and group: the extents and the drawing share them, and they
 * go with the layout (a table edit lays out again).
 */
const shapes = new WeakMap<LayerKit, Map<string, ReturnType<typeof overlayShape>>>()

function shapeOf(kit: LayerKit, layer: LayerOf<'polygon'>, g: OverlayGroup) {
  let byGroup = shapes.get(kit)
  if (!byGroup) {
    byGroup = new Map()
    shapes.set(kit, byGroup)
  }
  const k = `${layer.id}\u0000${g.key}\u0000${g.label}`
  let s = byGroup.get(k)
  if (!s) {
    s = overlayShape(layer, g.xs, g.ys)
    byGroup.set(k, s)
  }
  return s
}

/** Widens an extent by the groups' ellipses and hulls drawn by these layers. */
export function overlayExtent(
  kit: LayerKit,
  layers: readonly LayerOf<'polygon'>[],
  groups: readonly OverlayGroup[],
  axis: 'x' | 'y',
  e: Extent,
): void {
  for (const l of layers)
    for (const g of groups) {
      if (!kit.shows(l, g.key)) continue
      const s = shapeOf(kit, l, g)
      if ('points' in s) for (const p of s.points) e.add(axis === 'x' ? p[0] : p[1])
    }
}

const WHAT = { ellipse: 'Ellipse', hull: 'Hull' } as const

/** A warning once per graph. */
const warn = (kit: LayerKit, text: string) => {
  if (!kit.warnings.includes(text)) kit.warnings.push(text)
}

/** Sutherland–Hodgman clip of a polygon to the plot rectangle [0, W] × [0, H]. */
export function clipPolygon(points: readonly [number, number][], W: number, H: number) {
  return clipToRect(points, 0, W, 0, H)
}

/** Sutherland–Hodgman clip of a polygon to the rectangle [x0, x1] × [y0, y1]. */
function clipToRect(
  points: readonly [number, number][],
  x0: number,
  x1: number,
  y0: number,
  y1: number,
) {
  let out = [...points]
  const edges: [
    (p: [number, number]) => boolean,
    (a: [number, number], b: [number, number]) => [number, number],
  ][] = [
    [(p) => p[0] >= x0, (a, b) => at(a, b, (a[0] - x0) / (a[0] - b[0]))],
    [(p) => p[0] <= x1, (a, b) => at(a, b, (a[0] - x1) / (a[0] - b[0]))],
    [(p) => p[1] >= y0, (a, b) => at(a, b, (a[1] - y0) / (a[1] - b[1]))],
    [(p) => p[1] <= y1, (a, b) => at(a, b, (a[1] - y1) / (a[1] - b[1]))],
  ]
  for (const [inside, cross] of edges) {
    const input = out
    out = []
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!
      const prev = input[(i + input.length - 1) % input.length]!
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur))
        out.push(cur)
      } else if (inside(prev)) out.push(cross(prev, cur))
    }
    if (!out.length) break
  }
  return out
}
const at = (a: [number, number], b: [number, number], t: number): [number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
]

const finitePoint = (p: readonly [number, number]) => Number.isFinite(p[0]) && Number.isFinite(p[1])

/**
 * Audit 2 (G2): a filled polygon cut to the plot, piece by piece between axis breaks (its corners
 * placed with the scales' `edge`, so none is NaN inside a break): the parts with an area. Corners
 * still not finite (a value no scale can place) are left out. Without breaks, `clipPolygon`'s one
 * part.
 */
export function clipPolygonToPieces(
  points: readonly [number, number][],
  W: number,
  H: number,
  pieces: PlotPieces | undefined,
): [number, number][][] {
  const ring = points.every(finitePoint) ? points : points.filter(finitePoint)
  const xs = pieces?.x.length ? pieces.x : [[0, W] as const]
  const ys = pieces?.y.length ? pieces.y : [[0, H] as const]
  const out: [number, number][][] = []
  for (const [x0, x1] of xs)
    for (const [y0, y1] of ys) {
      const part = clipToRect(ring, x0, x1, y0, y1)
      if (part.length > 2) out.push(part)
    }
  return out
}

/** Draws a group's ellipse or hull (fill, outline or both), or warns why it can't. */
export function drawPolygon(
  kit: LayerKit,
  layer: LayerOf<'polygon'>,
  g: OverlayGroup,
  axes: OverlayAxes,
): void {
  const what = WHAT[layer.stat.kind]
  const s = shapeOf(kit, layer, g)
  if ('reason' in s) {
    warn(kit, `${what} of ${g.label} not drawn: ${s.reason}.`)
    return
  }
  if (!s.points.every(([x, y]) => axes.ok(x, y))) {
    warn(kit, `${what} of ${g.label} not drawn: it reaches values a log axis can’t show.`)
    return
  }
  const style = overlayStyle(layer, g.key, kit.theme)
  const px = s.points.map(([x, y]): [number, number] => [axes.x(x), axes.y(y)])
  // An ellipse's outline repeats its first point; a hull's closes back to its first corner.
  const ring = layer.stat.kind === 'ellipse' ? px.slice(0, -1) : px
  const part = kit.part(layer, g.key, layer.stat.kind)
  const target = [...g.target, 'polygon']
  const fill =
    style.draw !== 'outline' ? resolveFill(style.fill, kit.palette, g.fill ?? g.color) : null
  if (fill) {
    // Corners inside an axis break go to its edge, and the fill is cut at the breaks (G2).
    const [ex, ey] = [axes.xEdge ?? axes.x, axes.yEdge ?? axes.y]
    const edged = axes.pieces ? s.points.map(([x, y]): [number, number] => [ex(x), ey(y)]) : px
    const parts = clipPolygonToPieces(
      layer.stat.kind === 'ellipse' ? edged.slice(0, -1) : edged,
      axes.W,
      axes.H,
      axes.pieces,
    )
    parts.forEach((points, k) => {
      kit.add(layer, g.key, {
        id: g.id(k ? `${part}/fill/${k}` : `${part}/fill`),
        target,
        prim: { type: 'polygon', points, fill, stroke: null },
      })
    })
  }
  if (style.draw !== 'fill' && style.border.width > 0) {
    const border = groupStroke(style.border, graphDashes(kit.graph, kit.theme), g.index)
    const stroke = resolveStroke(border, kit.palette, g.color)
    clipPolyline([...ring, ring[0]!], axes.W, axes.H).forEach((run, k) => {
      kit.add(layer, g.key, {
        id: g.id(`${part}/${k}`),
        target,
        prim: { type: 'polyline', points: run, stroke },
      })
    })
  }
}

const inside = ([x, y]: [number, number], W: number, H: number) =>
  x >= -0.5 && x <= W + 0.5 && y >= -0.5 && y <= H + 0.5

/** Heads' shapes at a tip pointing along the line from `from`, when the tip is in the plot. */
function headAt(
  tip: [number, number],
  from: [number, number],
  head: ArrowHead,
  stroke: Stroke,
  W: number,
  H: number,
) {
  const len = Math.hypot(tip[0] - from[0], tip[1] - from[1])
  if (!(len > 0) || !inside(tip, W, H)) return []
  return arrowHead(head, tip[0], tip[1], (tip[0] - from[0]) / len, (tip[1] - from[1]) / len, stroke)
    .prims
}

/**
 * A group's points joined in table row order (a trajectory), broken where a point can't be
 * drawn; an arrowhead at the end of each run, or at the middle of every step ('along').
 */
export function drawPath(
  kit: LayerKit,
  layer: LayerOf<'path'>,
  g: OverlayGroup,
  axes: OverlayAxes,
  touch?: (row: number, py: number) => void,
): void {
  const style = overlayStyle(layer, g.key, kit.theme)
  const line = groupStroke(style.stroke, graphDashes(kit.graph, kit.theme), g.index)
  const stroke = resolveStroke(line, kit.palette, g.color)
  const runs: [number, number][][] = [[]]
  g.xs.forEach((x, i) => {
    const y = g.ys[i]!
    const p: [number, number] = axes.ok(x, y) ? [axes.x(x), axes.y(y)] : [Number.NaN, 0]
    // A point inside an axis break has no place: the path breaks there too.
    if (finitePoint(p)) {
      runs.at(-1)!.push(p)
      touch?.(g.rows[i]!, p[1])
    } else if (runs.at(-1)!.length) runs.push([])
  })
  const part = kit.part(layer, g.key, 'path')
  const target = [...g.target, 'path']
  const heads: SceneNode[] = []
  let k = 0
  for (const run of runs) {
    if (run.length < 2) continue
    let pts = run
    if (style.arrow === 'end') {
      // The line stops where the head covers its end.
      const a = run.at(-2)!
      const b = run.at(-1)!
      if (inside(b, axes.W, axes.H)) {
        const h = lineWithHeads(a[0], a[1], b[0], b[1], stroke, { end: style.head })
        pts = [...run.slice(0, -1), [h.line.x2, h.line.y2]]
        heads.push(
          ...h.heads.map((prim, j) => ({ id: g.id(`${part}/head/${k}/${j}`), target, prim })),
        )
      }
    } else if (style.arrow === 'along')
      for (let i = 1; i < run.length; i++) {
        const a = run[i - 1]!
        const b = run[i]!
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        headAt(mid, a, style.head, stroke, axes.W, axes.H).forEach((prim, j) => {
          heads.push({ id: g.id(`${part}/head/${k}/${i}/${j}`), target, prim })
        })
      }
    for (const piece of clipPolyline(pts, axes.W, axes.H)) {
      kit.add(layer, g.key, {
        id: g.id(`${part}/${k}`),
        target,
        prim: { type: 'polyline', points: piece, stroke },
      })
      k++
    }
  }
  kit.addList(layer, g.key, heads)
}

/** One row's vector from (x, y) to (xEnd, yEnd), with its heads. */
export function drawSegment(
  kit: LayerKit,
  layer: LayerOf<'segment'>,
  o: {
    key: string
    id: string
    target: StylePath
    color: string
    /** Roadmap 49d: the row's group's place (a line pattern by group; absent: 0). */
    index?: number
    from: [number, number]
    to: [number, number]
  },
  axes: OverlayAxes,
): void {
  const style = overlayStyle(layer, o.key, kit.theme)
  const [x1, y1] = o.from
  const [x2, y2] = o.to
  if (!axes.ok(x1, y1) || !axes.ok(x2, y2)) return
  const line = groupStroke(style.stroke, graphDashes(kit.graph, kit.theme), o.index)
  const stroke = resolveStroke(line, kit.palette, o.color)
  const [a, b]: [number, number][] = [
    [axes.x(x1), axes.y(y1)],
    [axes.x(x2), axes.y(y2)],
  ]
  // A vector of no length has no direction, nor one with an end inside an axis break.
  if ((a[0] === b[0] && a[1] === b[1]) || !finitePoint(a) || !finitePoint(b)) return
  const ends =
    style.arrow === 'none'
      ? {}
      : style.arrow === 'both'
        ? { start: style.head, end: style.head }
        : { end: style.head }
  // Heads only where their tip is in the plot.
  const h = lineWithHeads(a[0], a[1], b[0], b[1], stroke, {
    ...(ends.end && inside(b, axes.W, axes.H) ? { end: ends.end } : {}),
    ...(ends.start && inside(a, axes.W, axes.H) ? { start: ends.start } : {}),
  })
  const target = [...o.target, 'segment']
  const runs = clipPolyline(
    [
      [h.line.x1, h.line.y1],
      [h.line.x2, h.line.y2],
    ],
    axes.W,
    axes.H,
  )
  kit.add(
    layer,
    o.key,
    ...runs.map(
      (points, k): SceneNode => ({
        id: `${o.id}/${k}`,
        target,
        prim: { type: 'polyline', points, stroke },
      }),
    ),
    ...h.heads.map((prim, j): SceneNode => ({ id: `${o.id}/head/${j}`, target, prim })),
  )
}

/**
 * The fill and outline a polygon layer's legend swatch draws (null: none). Roadmap 49d: the
 * group's fill colour and place (its outline's pattern by group) when given.
 */
export function polygonSwatch(
  layer: LayerOf<'polygon'>,
  key: string,
  palette: readonly string[],
  color: string,
  theme: Pick<Theme, 'overlay'> = DEFAULT_THEME,
  group: { fill?: string; dashes?: readonly Dash[]; index?: number } = {},
): { fill: Fill | null; stroke: Stroke | null } {
  const style = overlayStyle(layer, key, theme)
  return {
    fill: style.draw !== 'outline' ? resolveFill(style.fill, palette, group.fill ?? color) : null,
    stroke:
      style.draw !== 'fill' && style.border.width > 0
        ? resolveStroke(groupStroke(style.border, group.dashes, group.index), palette, color)
        : null,
  }
}

/**
 * A path or vector layer's line, for legend samples (roadmap 49d: its pattern by group at the
 * group's place, `index`, of the graph's line styles, `dashes`).
 */
export function lineStyleOf(
  layer: LayerOf<'path'> | LayerOf<'segment'>,
  key: string,
  theme: Pick<Theme, 'overlay'> = DEFAULT_THEME,
  dashes?: readonly Dash[],
  index?: number,
): { stroke: StrokeStyle; head: ArrowHead | null } {
  const style = overlayStyle(layer, key, theme) as Style<'path'> | Style<'segment'>
  return {
    stroke: groupStroke(style.stroke, dashes, index),
    head: style.arrow === 'none' ? null : style.head,
  }
}
