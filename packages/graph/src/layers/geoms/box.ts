import type { LayerOf } from '@ps/model'
import { type BoxStats, boxOf, tableRow } from '../../data.ts'
import { symbolPaint } from '../../layout/points.ts'
import type { SampleUnit } from '../../layout/screen.ts'
import type { Box, Fill, SceneNode, Stroke } from '../../scene.ts'
import { type ResolvedSeriesStyle, resolveFill, resolveStroke } from '../../theme.ts'
import type { CategorySlot } from '../frames/category.ts'
import type { GroupedCell } from '../frames/grouped.ts'
import type { XYSlot } from '../frames/xy.ts'
import type { LayerKit } from '../kit.ts'
import { barFraction } from './bar.ts'
import { cellBox } from './violin.ts'
import { xyBoxes, xyBoxWidth } from './xyMarks.ts'

// Boxes and whiskers (`boxplot`) and floating bars (`range`), with their centre lines and
// outliers; the marks are `boxMarks`.

/**
 * A box with its outliers as the screen draws them (audit 2, G6): at most the screen's cap of
 * them, evenly spread, as points are (decision 450); all of them in exports.
 */
function sampled(kit: LayerKit, b: BoxStats | null, per: SampleUnit, xy = false): BoxStats | null {
  if (!b) return b
  const outliers = kit.screenSample(b.outliers, per, xy)
  return outliers === b.outliers ? b : { ...b, outliers: [...outliers] }
}

/** What a category graph's points are counted per in the screen's note (as `categoryPoints`). */
const unitOf = (kit: LayerKit): SampleUnit => (kit.graph.mapping ? 'group' : 'column')

/** A data set's box (or floating bar) in its category (category frame). */
export function categoryBox(c: CategorySlot, layer: LayerOf<'box'>): void {
  const { kit, key, x0, band, target, color, stats, s } = c
  const { palette } = kit
  const style = kit.style(layer, key)
  const b = sampled(kit, boxOf(stats, style.box, style.center.stat), unitOf(kit))
  if (!b) return
  const part = kit.part(layer, key, 'box')
  const m = boxMarks({
    b,
    x0,
    w: barFraction(kit.graph, layer, key, style) * band,
    target,
    style,
    palette,
    color,
    cap: style.error.capWidth,
    ids: {
      box: `series/${key}/${part}`,
      center: `series/${key}/${kit.part(layer, key, 'center')}`,
      outlier: (row) => `series/${key}/${kit.part(layer, key, 'outlier')}/${tableRow(s, row)}`,
    },
    yEnd: c.Y.end,
    yPoint: c.Y.point,
    point: symbolPaint(style.points, palette, color),
  })
  kit.addList(layer, key, m.nodes)
  c.touch(m.top)
}

/** A cell's box (or floating bar) in its slot (grouped frame); outliers are single values. */
export function groupedBox(g: GroupedCell, layer: LayerOf<'box'>): void {
  if (g.hidden) return
  const { kit, key, tRow, r, color } = g
  const { style, sub, opts, ids } = cellBox(g, layer)
  const b = sampled(kit, boxOf(g.c, style.box, style.center.stat), 'group')
  if (!b) return
  const outlier = `series/${key}/${kit.part(layer, key, 'outlier')}/`
  const m = boxMarks({
    b,
    ...opts,
    cap: Math.min(style.error.capWidth, sub * 0.8),
    ids: { ...ids, outlier: (k) => `${outlier}${tRow(r)}/${k}` },
    point: symbolPaint(style.points, kit.palette, color),
  })
  // Outliers are single values, not the cell's box.
  kit.addList(
    layer,
    key,
    m.nodes.map((n) => (n.id.startsWith(outlier) ? n : g.mark(n))),
  )
  g.top = Math.min(g.top, m.top)
}

/** A box and whiskers of the replicates at each X (xy frame). */
export function xyBox(c: XYSlot, layer: LayerOf<'box'>): void {
  const { kit, key, p, x, W, target } = c
  const style = kit.style(layer, key)
  const boxes = xyBoxes({ style, rows: p.rows })
  if (!boxes.length) return
  const w = xyBoxWidth(c.frame, p.rows)
  const [box, median, outlier] = ['box', 'median', 'outlier'].map((part) =>
    kit.part(layer, key, part),
  )
  for (const { r, b: whole } of boxes) {
    const b = sampled(kit, whole, 'data set', true)!
    const x0 = x(r.x)
    if (!(x0 >= 0 && x0 <= W)) continue
    const row = tableRow(p.s, r.row)
    const m = boxMarks({
      b,
      x0,
      w,
      cap: Math.min(style.error.capWidth, w),
      ids: {
        box: `series/${key}/${box}/${row}`,
        center: `series/${key}/${median}/${row}`,
        outlier: (k) => `series/${key}/${outlier}/${row}/${k}`,
      },
      target,
      style,
      palette: kit.palette,
      color: p.color,
      yEnd: c.axis.end,
      yPoint: c.axis.point,
      point: symbolPaint(style.points, kit.palette, p.color),
    })
    kit.addList(layer, key, m.nodes)
    c.touch(r.row, m.top)
  }
}

export interface BoxMarkOptions {
  b: BoxStats
  /** Centre and width of the box. */
  x0: number
  w: number
  /** Whisker cap width. */
  cap: number
  ids: { box: string; center: string; outlier: (row: number) => string }
  target: (string | number)[]
  style: ResolvedSeriesStyle
  palette: readonly string[]
  color: string
  /** Pixel y of a value clipped to the plot (box ends), or NaN when hidden (centre, outliers). */
  yEnd: (v: number) => number
  yPoint: (v: number) => number
  point: { stroke: Stroke | null; fill: Fill | null }
}

/**
 * A box and whiskers, or a floating bar (whiskers of no length are left out), with its centre
 * line and outliers. `top` is the highest pixel drawn, for placing brackets.
 */
export function boxMarks(o: BoxMarkOptions): { nodes: SceneNode[]; top: number } {
  const { b, x0, w, cap, ids, target, style, yEnd, yPoint } = o
  const stroke = resolveStroke(style.box.border, o.palette, o.color)
  const [yq1, yq3] = [yEnd(b.q1), yEnd(b.q3)]
  const box: Box = { x: x0 - w / 2, y: Math.min(yq1, yq3), w, h: Math.abs(yq1 - yq3) }
  const nodes: SceneNode[] = []
  const whisker = (id: string, from: number, to: number) => {
    if (from === to) return
    nodes.push({
      id: `${ids.box}/${id}`,
      target: [...target, 'box'],
      prim: { type: 'line', x1: x0, y1: yEnd(from), x2: x0, y2: yEnd(to), stroke },
    })
    // A cap of no width is left out rather than drawn as a zero-length line.
    if (cap > 0) {
      nodes.push({
        id: `${ids.box}/${id}Cap`,
        target: [...target, 'box'],
        prim: {
          type: 'line',
          x1: x0 - cap / 2,
          y1: yEnd(to),
          x2: x0 + cap / 2,
          y2: yEnd(to),
          stroke,
        },
      })
    }
  }
  whisker('whiskerLo', b.q1, b.whiskerLo)
  whisker('whiskerHi', b.q3, b.whiskerHi)
  nodes.push({
    id: ids.box,
    target: [...target, 'box'],
    prim: { type: 'rect', ...box, stroke, fill: resolveFill(style.box.fill, o.palette, o.color) },
    bbox: box,
  })
  const ym = yPoint(b.median)
  if (Number.isFinite(ym)) {
    nodes.push({
      id: ids.center,
      target: [...target, 'center'],
      prim: {
        type: 'line',
        x1: x0 - w / 2,
        y1: ym,
        x2: x0 + w / 2,
        y2: ym,
        stroke: resolveStroke(style.center.line, o.palette, o.color),
      },
    })
  }
  let top = Math.min(yEnd(b.whiskerHi), box.y)
  for (const out of b.outliers) {
    const oy = yPoint(out.value)
    if (!Number.isFinite(oy)) continue
    nodes.push({
      id: ids.outlier(out.row),
      target: [...target, 'points'],
      prim: {
        type: 'symbol',
        shape: style.points.shape,
        cx: x0,
        cy: oy,
        size: style.points.size,
        stroke: o.point.stroke,
        fill: o.point.fill,
      },
    })
    top = Math.min(top, oy - style.points.size / 2)
  }
  return { nodes, top }
}
