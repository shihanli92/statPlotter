import type { GraphNode, PointLabels, PointStyle } from '@ps/model'
import type { FontRegistry } from '../fonts/registry.ts'
import type { GraphLooks, RowLook } from '../layers/looks.ts'
import { type Fill, OPEN_SHAPES, type SceneNode, type Stroke, type StylePath } from '../scene.ts'
import {
  type ResolvedSeriesStyle,
  resolveColor,
  resolveFill,
  resolveStroke,
  type Theme,
} from '../theme.ts'
import type { CloudBuilder } from './cloud.ts'
import { type LabelPoint, PointLabelLayer } from './pointLabels.ts'

/** A point's own format (`graph.pointOverrides`), if any. */
export function pointOverride(
  graph: GraphNode,
  series: string,
  key: string,
): PointStyle | undefined {
  return graph.pointOverrides?.[series as never]?.[key]
}

/**
 * Stroke and fill of a point symbol in a colour (open shapes have no fill). Roadmap 49d: `fill`,
 * the fill colour where the fill is by data set (absent: `color`).
 */
export function symbolPaint(
  points: Pick<ResolvedSeriesStyle['points'], 'shape' | 'border' | 'fill'>,
  palette: readonly string[],
  color: string,
  fill: string = color,
): { stroke: Stroke; fill: Fill | null } {
  return {
    stroke: resolveStroke(points.border, palette, color),
    fill: OPEN_SHAPES.has(points.shape) ? null : resolveFill(points.fill, palette, fill),
  }
}

/**
 * The graph's point-label layer (automatic labels of data set `key` from `labelsOf`) and the
 * context marks draw points with, feeding it.
 */
export function pointLayer(
  ctx: { graph: GraphNode; fonts: FontRegistry },
  theme: Theme,
  palette: readonly string[],
  labelsOf: (key: string) => PointLabels | undefined,
  /** Where points end up in the plot when the marks are turned afterwards (horizontal graphs). */
  map?: (x: number, y: number) => [number, number],
  /**
   * Variables mapped to appearance (roadmap 34b): each row's point look, the automatic labels a
   * label variable gives every data set without labels of its own, and the label variable's text.
   */
  looks?: Pick<GraphLooks, 'row' | 'labels' | 'labelText'>,
): { labels: PointLabelLayer; marksCtx: PointMarkContext } {
  const { graph, fonts } = ctx
  const labels = new PointLabelLayer(
    { graph, fonts, theme, palette },
    looks ? (k) => looks.labels(labelsOf(k)) : labelsOf,
    map,
    looks?.labelText,
  )
  return {
    labels,
    marksCtx: { graph, fonts, theme, palette, labels, ...(looks?.row ? { aes: looks.row } : {}) },
  }
}

export interface PointMarkContext {
  graph: GraphNode
  fonts: FontRegistry
  theme: Theme
  palette: readonly string[]
  /** Collects drawn points for their labels (own and automatic), drawn over the data. */
  labels?: PointLabelLayer
  /** Each table row's look by mapped variables (roadmap 34b), for points standing for a row. */
  aes?: RowLook
}

/**
 * The scene nodes of one plotted point: its symbol in the data set's style with the point's own
 * format applied (nothing when hidden), carrying the point key so a click selects the point.
 * The point goes to the graph's label layer (`ctx.labels`) with what its label may say.
 */
export function pointNodes(
  ctx: PointMarkContext,
  p: {
    id: string
    target: StylePath
    series: string
    key: string
    style: ResolvedSeriesStyle['points']
    /** The data set's colour. */
    color: string
    /**
     * Roadmap 49d: the data set's fill colour where it differs from its colour (a graph of
     * variables' points take theirs from `ctx.aes` instead).
     */
    fill?: string
    cx: number
    cy: number
    /** The point's table row, row title and values, for automatic labels. */
    label?: Pick<LabelPoint, 'row' | 'title' | 'x' | 'y'>
    /**
     * The table row the point stands for alone (not a summary): variables mapped to appearance
     * give it its colour, symbol and size (`ctx.aes`, roadmap 34b), under its own format.
     */
    aesRow?: number
    /**
     * Roadmap 34e: the point goes into this cloud (its table row and replicate) instead of a
     * node of its own; it is labelled only when it may get a label.
     */
    cloud?: { into: CloudBuilder; row: number; sub?: number; k?: number }
  },
): SceneNode[] {
  const o = pointOverride(ctx.graph, p.series, p.key)
  if (o?.hide) return []
  const aes = p.aesRow === undefined ? undefined : ctx.aes
  const row = p.aesRow ?? 0
  const base = aes?.color ? aes.color(row) : p.color
  const color = o?.color ? resolveColor(o.color, ctx.palette, base) : base
  // Roadmap 49d: the row's fill colour (its fill variable's, its level's), else the data set's
  // (a point's own colour colours both).
  const fillColor = o?.color
    ? color
    : (aes?.fill?.(row) ?? (aes?.color ? color : (p.fill ?? color)))
  const shape = o?.shape ?? aes?.shape?.(row) ?? p.style.shape
  const size = o?.size ?? aes?.size?.(row) ?? p.style.size
  const paint = () =>
    symbolPaint(
      { shape, border: o?.border ?? p.style.border, fill: o?.fill ?? p.style.fill },
      ctx.palette,
      color,
      fillColor,
    )
  if (p.cloud) {
    const { into, row: r, sub, k } = p.cloud
    // A point without a format of its own is painted as every one of its shape and colour.
    const index = o
      ? (() => {
          const { stroke, fill } = paint()
          return into.paintOf(shape, stroke, fill)
        })()
      : into.paintFor(p.style, shape, fillColor === color ? color : `${color}${fillColor}`, paint)
    into.add(p.cx, p.cy, size, index, r, sub, k)
    if (ctx.labels?.wants(p.series, p.key))
      ctx.labels.add({ ...p.label, series: p.series, key: p.key, cx: p.cx, cy: p.cy, size, color })
    return []
  }
  const { stroke, fill } = paint()
  const nodes: SceneNode[] = [
    {
      id: p.id,
      target: p.target,
      point: p.key,
      prim: { type: 'symbol', shape, cx: p.cx, cy: p.cy, size, stroke, fill },
      bbox: { x: p.cx - size / 2, y: p.cy - size / 2, w: size, h: size },
    },
  ]
  ctx.labels?.add({ ...p.label, series: p.series, key: p.key, cx: p.cx, cy: p.cy, size, color })
  return nodes
}
