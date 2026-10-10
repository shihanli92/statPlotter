import { type GraphNode, type Layer, type LayerOf, pointKey } from '@ps/model'
import { centerOf, tableRow, type XYRow } from '../../data.ts'
import { pointOverride } from '../../layout/points.ts'
import type { Box } from '../../scene.ts'
import { type ResolvedSeriesStyle, resolveColor, resolveFill, resolveStroke } from '../../theme.ts'
import type { CategorySlot } from '../frames/category.ts'
import type { GroupedCell } from '../frames/grouped.ts'
import type { XYSlot } from '../frames/xy.ts'
import type { LayerKit } from '../kit.ts'
import { ownField } from '../theme.ts'
import { xyCenter } from './xyMarks.ts'

// Bars from a baseline to a summary (or stacked segments, or XY bins).

/** A bar's top and base (plot-local y), for labels inside it. */
export interface BarEnds {
  top: number
  base: number
}

/**
 * Width of a bar or box as a fraction of its category: its own width (the layer's or the data
 * set's), then the graph's category gap (gap = categoryGap × bar width), then the theme.
 */
export function barFraction(
  graph: GraphNode,
  layer: Layer,
  key: string,
  style: ResolvedSeriesStyle,
): number {
  const explicit = ownField(layer, key, 'width') as number | undefined
  if (explicit !== undefined) return explicit
  const gap = graph.style.categoryGap
  return gap === undefined ? style.bar.width : 1 / (1 + gap)
}

/** A data set's bar in its category (category frame). */
export function categoryBar(c: CategorySlot, layer: LayerOf<'bar'>): BarEnds | undefined {
  const { kit, key, x0, band, target, color, stats } = c
  const { palette } = kit
  const { ok: inPlot, end: yEnd, baselineAt } = c.Y
  const style = kit.style(layer, key)
  const center = centerOf(stats, style.center.stat)
  if (!inPlot(center)) return undefined
  const w = barFraction(kit.graph, layer, key, style) * band
  const yTop = yEnd(center)
  const yBase = yEnd(baselineAt(style.bar.baseline))
  const box: Box = { x: x0 - w / 2, y: Math.min(yTop, yBase), w, h: Math.abs(yBase - yTop) }
  kit.add(layer, key, {
    id: `series/${key}/${kit.part(layer, key, 'bar')}`,
    target: [...target, 'bar'],
    prim: {
      type: 'rect',
      ...box,
      stroke: resolveStroke(style.bar.border, palette, color),
      fill: resolveFill(style.bar.fill, palette, color),
    },
    bbox: box,
  })
  c.touch(box.y)
  return { top: yTop, base: yBase }
}

/**
 * A cell's bar in its slot (grouped frame), in the cell's own fill and border; stacked: its
 * segment, from the data sets below it, the gap left between segments.
 */
export function groupedBar(g: GroupedCell, layer: LayerOf<'bar'>): BarEnds | undefined {
  const { kit, key, own, color, tRow, r } = g
  const { palette } = kit
  const { ok, end: yEnd, baselineAt } = g.axis
  const style = kit.style(layer, key)
  const center = centerOf(g.c, style.center.stat)
  const stacked = layer.position?.kind === 'stack'
  const stackGap = layer.position?.kind === 'stack' ? (layer.position.gap ?? 0) : 0
  const seg = g.stacks(layer)?.[g.si]?.[r] ?? null
  if (g.hidden || !(seg || (!stacked && ok(center)))) return undefined
  const { sub, cx } = g.slots(layer)
  const x0 = cx(g.gi, g.si)
  const w = style.bar.width * sub
  let [yTop, yBase] = seg
    ? [yEnd(seg.end), yEnd(seg.start)]
    : [yEnd(center), yEnd(baselineAt(style.bar.baseline))]
  if (seg && stackGap > 0) {
    const dir = Math.sign(yTop - yBase)
    const room = Math.max(0, Math.abs(yTop - yBase) - 0.1)
    const cut = (joined: boolean) => (joined ? Math.min(stackGap / 2, room / 2) : 0)
    yBase += dir * cut(seg.joined[0])
    yTop -= dir * cut(seg.joined[1])
  }
  const box: Box = { x: x0 - w / 2, y: Math.min(yTop, yBase), w, h: Math.abs(yBase - yTop) }
  kit.add(
    layer,
    key,
    g.mark({
      id: `series/${key}/${kit.part(layer, key, 'bar')}/${tRow(r)}`,
      target: [...g.target, 'bar'],
      prim: {
        type: 'rect',
        ...box,
        stroke: resolveStroke(own?.bar?.border ?? style.bar.border, palette, color),
        fill: resolveFill(own?.bar?.fill ?? style.bar.fill, palette, color),
      },
      bbox: box,
    }),
  )
  g.top = Math.min(g.top, box.y)
  return { top: yTop, base: yBase }
}

/**
 * The bin width of XY bars (histograms), in X units: the data set's own `binWidth`, else a
 * histogram's bins (`bin` stat), else the smallest spacing between distinct X values of the data
 * sets the layer draws (1 when there are fewer than two), so bins of a frequency distribution
 * touch.
 */
export function xyBinWidth(
  kit: LayerKit,
  layer: Layer,
  series: readonly { s: { key: string }; rows: readonly XYRow[]; binWidth?: number }[],
  style: ResolvedSeriesStyle,
): number {
  if (style.bar.binWidth !== undefined) return style.bar.binWidth
  // A histogram's bars are its bins.
  const bins = layer.stat.kind === 'bin' ? series[0]?.binWidth : undefined
  if (bins !== undefined && Number.isFinite(bins)) return bins
  // The spacing is the layer's over all its data sets: found once per layout's series and layer
  // (audit 2, G15: each data set's bars and extent sorted every data set's X values).
  let byLayer = spacings.get(series)
  if (!byLayer) {
    byLayer = new Map()
    spacings.set(series, byLayer)
  }
  let gap = byLayer.get(layer.id)
  if (gap === undefined) {
    gap = smallestSpacing(kit, layer, series)
    byLayer.set(layer.id, gap)
  }
  return gap
}

/** The smallest spacings of a layout's XY series, per series list (weakly) and layer id. */
const spacings = new WeakMap<object, Map<string, number>>()

/** The smallest spacing between distinct X values of the data sets a layer draws (else 1). */
function smallestSpacing(
  kit: LayerKit,
  layer: Layer,
  series: readonly { s: { key: string }; rows: readonly XYRow[] }[],
): number {
  const xs = [
    ...new Set(
      series.filter((q) => kit.shows(layer, q.s.key)).flatMap((q) => q.rows.map((r) => r.x)),
    ),
  ]
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  let gap = Number.POSITIVE_INFINITY
  for (let i = 1; i < xs.length; i++) gap = Math.min(gap, xs[i]! - xs[i - 1]!)
  return Number.isFinite(gap) && gap > 0 ? gap : 1
}

/** A data set's bars from the baseline to each row's centre, a bin wide (xy frame). */
export function xyBars(c: XYSlot, layer: LayerOf<'bar'>): void {
  const { kit, key, p, x, W, xLog, target } = c
  const { palette, graph } = kit
  const { ok, end: yEnd, baselineAt } = c.axis
  const style = kit.style(layer, key)
  const mid = (r: XYRow) => xyCenter(r.stats, style)
  const half = (xyBinWidth(kit, layer, c.series, style) * style.bar.width) / 2
  const clampX = (v: number) => Math.max(0, Math.min(W, v))
  const part = kit.part(layer, key, 'bar')
  for (const r of p.rows) {
    const v = mid(r)
    if (!ok(r.x, v)) continue
    const row = tableRow(p.s, r.row)
    const cell = pointKey(row)
    const own = pointOverride(graph, key, cell)
    if (own?.hide) continue
    // Bins in an arcsinh or logicle axis' units (roadmap 34g): their edges, narrowed by the bars'
    // width about their middle on the axis.
    const edgePx = r.edges ? r.edges.map((v) => x(v)) : null
    const midPx = edgePx ? (edgePx[0]! + edgePx[1]!) / 2 : 0
    const halfPx = edgePx ? (Math.abs(edgePx[1]! - edgePx[0]!) * style.bar.width) / 2 : 0
    const ends = (edgePx ? [midPx - halfPx, midPx + halfPx] : [x(r.x - half), x(r.x + half)]).map(
      (px) => (Number.isFinite(px) ? clampX(px) : xLog ? 0 : Number.NaN),
    )
    if (!ends.every(Number.isFinite) || ends[0] === ends[1]) continue
    const [x0, x1] = [Math.min(ends[0]!, ends[1]!), Math.max(ends[0]!, ends[1]!)]
    // A stacked histogram's bar stands on those below it (roadmap 34f).
    const [yTop, yBase] = [yEnd(v), yEnd(r.base ? r.base : baselineAt(style.bar.baseline))]
    const box = { x: x0, y: Math.min(yTop, yBase), w: x1 - x0, h: Math.abs(yBase - yTop) }
    const color = own?.color ? resolveColor(own.color, palette, p.color) : p.color
    kit.add(layer, key, {
      id: `series/${key}/${part}/${row}`,
      target: [...target, 'bar'],
      point: cell,
      prim: {
        type: 'rect',
        ...box,
        stroke: resolveStroke(own?.bar?.border ?? style.bar.border, palette, color),
        fill: resolveFill(own?.bar?.fill ?? style.bar.fill, palette, color),
      },
      bbox: box,
    })
    c.touch(r.row, box.y)
    c.barTops.set(r.row, { top: yTop, base: yBase })
  }
}
