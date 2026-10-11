import type { ColorMapName, ColorScale, HeatmapStyle, NumberDisplay, TextStyle } from '@ps/model'
import { colorAlong } from '../../aesthetics.ts'
import { COLOR_MAPS, textOn } from '../../color.ts'
import { tableRow } from '../../data.ts'
import type { FontRegistry } from '../../fonts/registry.ts'
import { tickFormatter } from '../../format.ts'
import { type GraphContext, layoutBasics } from '../../layout/common.ts'
import { labelText } from '../../layout/labels.ts'
import { placeText } from '../../layout/text.ts'
import { niceLinearDomain, niceStep } from '../../scale.ts'
import type { Box, SceneNode, Stroke } from '../../scene.ts'
import { graphText } from '../../theme.ts'
import { cytoTicks, type Transform } from '../../transform.ts'
import type { HeatmapData } from '../stats/cell.ts'

// Heat-map tiles (roadmap 30): one cell per value coloured on a colour map, values printed in
// the cells and the colour scale (a gradient bar drawn as thin rectangles, so every renderer
// draws it alike). The trees beside the map are layers of their own (roadmap 49c,
// `dendrogram.ts`).

/** Space between the map (or a tree beside it) and the colour scale. */
export const BAR_GAP = 12
/** Colour bar: thickness, longest length, number of bands drawn and tick length. */
const BAR_WIDTH = 10
const BAR_LENGTH = 160
const BAR_STEPS = 64
const BAR_TICK = 3
/** Colour of missing cells. */
export const MISSING_COLOR = '#e0e0e0'
export const LINE: Stroke = { color: '#000000', width: 0.75, dash: 'solid' }

/**
 * A heat map's options as its graph holds them: the colours are the graph's colour scale's, a
 * colour map's name or two colours (`ColorScale`).
 */
export type HeatOptions = Omit<HeatmapStyle, 'colors'> & { colors?: ColorScale['colors'] }

/**
 * The colour scale of a heat map over `values`: its ends (fixed, else the data's), for diverging
 * maps the middle, and each value's colour (the missing colour for NaN) on its colour map
 * (absent: viridis) or between its two colours (`colorAlong`, as colours mapped from a number
 * variable). Diverging maps are symmetric about the middle, so equal distances from it get
 * equally strong colours.
 */
export function heatScale(
  h: HeatOptions,
  values: readonly number[],
  fallback: ColorMapName = 'viridis',
) {
  const colors = h.colors ?? fallback
  const map = typeof colors === 'string' ? COLOR_MAPS[colors] : null
  let [lo, hi] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const v of values)
    if (Number.isFinite(v)) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  if (!(lo <= hi)) [lo, hi] = [0, 1]
  lo = h.min ?? lo
  hi = h.max ?? hi
  if (!(lo < hi)) [lo, hi] = lo === hi ? [lo - 0.5, hi + 0.5] : [hi, lo]
  const mid = map?.diverging ? (h.midpoint ?? (lo < 0 && hi > 0 ? 0 : (lo + hi) / 2)) : Number.NaN
  const half = Math.max(hi - mid, mid - lo) || 1
  const t = (v: number) => (map?.diverging ? 0.5 + (0.5 * (v - mid)) / half : (v - lo) / (hi - lo))
  const missing = h.missing ?? MISSING_COLOR
  return {
    lo,
    hi,
    mid,
    /** Position along the colours (0–1, clamped when drawn). */
    t,
    color: (v: number) => (Number.isFinite(v) ? colorAlong(colors, t(v), h.reverse) : missing),
  }
}

/** The cells of a heat map (in display order) and the values printed in them. */
export function tileMarks(o: {
  fonts: FontRegistry
  palette: readonly string[]
  data: HeatmapData
  values: number[][]
  rowOrder: readonly number[]
  colOrder: readonly number[]
  cw: number
  ch: number
  scale: ReturnType<typeof heatScale>
  border: Stroke | null
  target: (string | number)[]
  labels: NonNullable<HeatOptions['labels']>
  labelStyle: TextStyle
}): { cells: SceneNode[]; texts: SceneNode[] } {
  const { fonts, palette, values, rowOrder, colOrder, cw, ch, scale, border, target } = o
  const { series, rows } = o.data
  const { labels, labelStyle } = o
  // The rows drawn (on screen perhaps a sample of them, decision 450).
  const nr = rowOrder.length
  const nc = series.length
  const cells: SceneNode[] = []
  const texts: SceneNode[] = []
  rowOrder.forEach((i, ri) => {
    colOrder.forEach((j, ci) => {
      const s = series[j]!
      const v = values[i]![j]!
      const color = scale.color(v)
      const box: Box = { x: ci * cw, y: ri * ch, w: cw, h: ch }
      const row = tableRow(s, rows[i]!)
      // Cells overlap their right and lower neighbours a little, so no seam shows between them.
      const over = (last: boolean) => (last || border ? 0 : Math.min(0.5, cw / 4))
      cells.push({
        id: `series/${s.key}/cell/${row}`,
        target,
        prim: {
          type: 'rect',
          x: box.x,
          y: box.y,
          w: cw + over(ci === nc - 1),
          h: ch + over(ri === nr - 1),
          stroke: border,
          fill: { color, opacity: 1 },
        },
        bbox: box,
      })
      if (!labels.show || !Number.isFinite(v)) return
      const content = labelText({ stat: 'value', format: labels.format ?? { mode: 'auto' } }, v)
      const style = labels.text?.color
        ? labelStyle
        : { ...labelStyle, color: { rgb: textOn(color) } }
      const t = placeText(
        fonts,
        `series/${s.key}/cellLabel/${row}`,
        content,
        style,
        palette,
        box.x + cw / 2,
        box.y + ch / 2,
        'middle',
        'middle',
        { target },
      )
      // Only where the value fits in its cell.
      if (t.bbox.w <= cw - 1 && t.bbox.h <= ch + 0.5) texts.push(t.node)
    })
  })
  return { cells, texts }
}

/**
 * Ticks of a colour bar on a transformed scale (roadmap 34g) over [lo, hi]: a log scale's
 * decades (with 2 and 5 times them when fewer than two decades fit), a cytometry scale's 0 and
 * ±10ⁿ.
 */
function transformedTicks(tr: Transform, lo: number, hi: number): number[] {
  const inside = (v: number) => v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)
  if (tr.cyto) return cytoTicks(tr, lo, hi).ticks
  const base = tr.kind === 'log2' ? 2 : 10
  if (!(lo > 0) || !(hi > lo)) return [lo, hi].filter((v) => v > 0)
  const e0 = Math.floor(Math.log(lo) / Math.log(base) - 1e-9)
  const e1 = Math.ceil(Math.log(hi) / Math.log(base) + 1e-9)
  const decades: number[] = []
  for (let e = e0; e <= e1; e++) if (inside(base ** e)) decades.push(base ** e)
  if (decades.length >= 2 || base !== 10) return decades
  const more: number[] = []
  for (let e = e0; e <= e1; e++)
    for (const m of [1, 2, 5]) if (inside(m * 10 ** e)) more.push(m * 10 ** e)
  return more
}

export const boundsOf = (n: SceneNode): Box | null => {
  const p = n.prim
  if (p?.type !== 'polyline') return null
  const xs = p.points.map((q) => q[0])
  const ys = p.points.map((q) => q[1])
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  }
}

/**
 * The colour scale: a gradient bar of thin bands from the scale's low to its high end, outlined,
 * with ticks at round values and an optional title — upright right of the map (high at the
 * top), or level below it (high on the right).
 */
export function colorBar(
  ctx: GraphContext,
  palette: readonly string[],
  scale: Pick<ReturnType<typeof heatScale>, 'lo' | 'hi' | 'color'>,
  o: {
    position: 'right' | 'bottom'
    title: string
    at: { x: number; y: number }
    W: number
    H: number
    target: (string | number)[]
    /** About this many ticks (absent: as many as fit). */
    ticks?: number
    /** The tick labels' number format (absent: automatic). */
    format?: NumberDisplay
    /** Whole-number ticks only (counts, roadmap 34b). */
    integer?: boolean
    /** Scene id prefix of its nodes (absent: `colorScale`). */
    id?: string
    /**
     * Roadmap 34g: the values run along a transformed scale (log counts, arcsinh, logicle): the
     * bands and ticks placed by it, ticked as such an axis (absent: linear).
     */
    transform?: Transform
  },
): SceneNode[] {
  const pre = o.id ?? 'colorScale'
  const { fonts, graph } = ctx
  const theme = layoutBasics(ctx).theme
  const upright = o.position === 'right'
  const length = Math.max(60, Math.min(upright ? o.H : o.W, BAR_LENGTH))
  const { x, y } = upright ? o.at : { x: o.at.x + (o.W - length) / 2, y: o.at.y }
  const { lo, hi } = scale
  const tr = o.transform && o.transform.kind !== 'linear' ? o.transform : undefined
  const [t0, t1] = tr ? [tr.forward(lo), tr.forward(hi)] : [lo, hi]
  /**
   * A value's place along the bar (0 at the low end, 1 at the high end); a scale of one value
   * (every average or value equal) has its one tick half way (audit 2, G18: 0 / 0 placed it at NaN).
   */
  const along = (v: number) => (t1 > t0 ? ((tr ? tr.forward(v) : v) - t0) / (t1 - t0) : 0.5)
  const out: SceneNode[] = []
  const step = length / BAR_STEPS
  for (let k = 0; k < BAR_STEPS; k++) {
    // Band k from the low end; each overlaps the next a little so no seam shows.
    const tk = t0 + ((k + 0.5) / BAR_STEPS) * (t1 - t0)
    const v = tr ? tr.inverse(tk) : tk
    const a = k * step
    const len = step + (k < BAR_STEPS - 1 ? 0.5 : 0)
    const box = upright
      ? { x, y: y + length - a - len, w: BAR_WIDTH, h: len }
      : { x: x + a, y, w: len, h: BAR_WIDTH }
    out.push({
      id: `${pre}/band/${k}`,
      target: o.target,
      prim: { type: 'rect', ...box, stroke: null, fill: { color: scale.color(v), opacity: 1 } },
    })
  }
  const frame = upright ? { x, y, w: BAR_WIDTH, h: length } : { x, y, w: length, h: BAR_WIDTH }
  out.push({
    id: `${pre}/frame`,
    target: o.target,
    prim: { type: 'rect', ...frame, stroke: { ...LINE, width: 0.5 }, fill: null },
    bbox: frame,
  })
  const style = graphText(theme.tickLabel, graph)
  // Fewer ticks along a level bar, whose labels sit side by side.
  const target = o.ticks ?? Math.max(2, Math.min(6, Math.floor(length / (upright ? 24 : 45))))
  const whole = o.integer && niceStep(hi - lo, target) < 1
  const ticks = tr
    ? transformedTicks(tr, lo, hi)
    : niceLinearDomain(lo, hi, {
        target,
        ...(whole ? { interval: 1, start: Math.ceil(lo) } : {}),
      }).ticks.filter((v) => v >= lo - 1e-9 * (hi - lo) && v <= hi + 1e-9 * (hi - lo))
  const fmt = tickFormatter(o.format ?? { mode: 'auto' }, ticks, tr?.kind)
  ticks.forEach((v, k) => {
    const at = along(v) * length
    const [x1, y1, x2, y2] = upright
      ? [x + BAR_WIDTH, y + length - at, x + BAR_WIDTH + BAR_TICK, y + length - at]
      : [x + at, y + BAR_WIDTH, x + at, y + BAR_WIDTH + BAR_TICK]
    out.push({
      id: `${pre}/tick/${k}`,
      target: o.target,
      prim: { type: 'line', x1, y1, x2, y2, stroke: { ...LINE, width: 0.5 } },
    })
    const t = upright
      ? placeText(
          fonts,
          `${pre}/label/${k}`,
          fmt(v),
          style,
          palette,
          x2 + 2,
          y2,
          'start',
          'middle',
          {
            target: o.target,
          },
        )
      : placeText(fonts, `${pre}/label/${k}`, fmt(v), style, palette, x2, y2 + 2, 'middle', 'top', {
          target: o.target,
        })
    out.push(t.node)
  })
  if (o.title) {
    const titleStyle = graphText(theme.tickLabel, graph)
    const t = upright
      ? placeText(
          fonts,
          `${pre}/title`,
          [{ text: o.title }],
          titleStyle,
          palette,
          x,
          y - 4,
          'start',
          'bottom',
          {
            target: o.target,
          },
        )
      : placeText(
          fonts,
          `${pre}/title`,
          [{ text: o.title }],
          titleStyle,
          palette,
          x - 6,
          y + BAR_WIDTH / 2,
          'end',
          'middle',
          { target: o.target },
        )
    out.push(t.node)
  }
  return out
}
