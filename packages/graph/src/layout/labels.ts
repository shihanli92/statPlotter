import type { NumberDisplay, RichText } from '@ps/model'
import type { PlotStats } from '../data.ts'
import { decimalsFor, formatNumber } from '../format.ts'
import type { SceneNode, StylePath } from '../scene.ts'
import { graphText, type ResolvedSeriesStyle, type Theme } from '../theme.ts'
import type { GraphContext } from './common.ts'
import { placeText } from './text.ts'

// Bar labels (`SeriesStyle.label`): a number above each bar or column (its height, mean, median,
// n, SD or SEM), or inside the top of a bar.

/** Space between a label and the mark under it. */
export const LABEL_GAP = 3

type Label = ResolvedSeriesStyle['label']

/** The number a label shows: 'value' is the bar height / centre drawn. NaN when unknown. */
export function labelValue(label: Pick<Label, 'stat'>, stats: PlotStats, center: number): number {
  switch (label.stat) {
    case 'value':
      return center
    case 'mean':
      return stats.mean
    case 'median':
      return stats.raw ? stats.median : Number.NaN
    case 'n':
      return stats.n
    case 'sd':
      return stats.sd
    case 'sem':
      return stats.sem
  }
}

/**
 * The label's text. 'auto' shows the value with at most three significant digits (fewer when
 * they are zeros; whole numbers for n) and "n = " before a count unless the format has its own
 * prefix.
 */
export function labelText(label: Pick<Label, 'stat' | 'format'>, v: number): RichText {
  const f: NumberDisplay = label.format
  if (f.mode !== 'auto') return formatNumber(v, f)
  const count = label.stat === 'n'
  const decimals = count
    ? 0
    : v === 0 || !Number.isFinite(v)
      ? 0
      : Math.min(
          decimalsFor([v]),
          Math.max(0, Math.min(6, 2 - Math.floor(Math.log10(Math.abs(v))))),
        )
  const prefix = f.prefix ?? (count ? 'n = ' : undefined)
  return formatNumber(v, { ...f, ...(prefix !== undefined ? { prefix } : {}) }, { decimals })
}

/**
 * A bar label centred on x: above `top` (the highest mark of the bar or column, plot-local), or
 * inside the bar's top edge `barTop` when chosen and the bar is tall enough (else above). Null
 * when the label is off or its number unknown. `top` in the result is the label's top edge.
 */
export function barLabel(
  ctx: GraphContext,
  theme: Theme,
  palette: readonly string[],
  o: {
    id: string
    target: StylePath
    style: ResolvedSeriesStyle
    stats: PlotStats
    center: number
    x: number
    top: number
    /** The bar's top and base (plot-local y), for labels inside a bar. */
    bar?: { top: number; base: number }
    point?: string
    /**
     * Horizontal graphs: the value axis' length. `x`, `top` and `bar` stay in the vertical frame
     * (see `flipNode`); the label is placed right of the bar (or inside its end), level.
     */
    across?: number
  },
): { node: SceneNode; top: number } | null {
  const label = o.style.label
  if (!label.show || !Number.isFinite(o.top)) return null
  const v = labelValue(label, o.stats, o.center)
  if (!Number.isFinite(v)) return null
  const style = graphText(theme.tickLabel, ctx.graph, label.text)
  const content = labelText(label, v)
  const target = [...o.target, 'label']
  const inside = label.position === 'inside' && o.bar
  const place = (x: number, y: number, h: 'start' | 'middle' | 'end', va: 'top' | 'middle') => {
    const t = placeText(ctx.fonts, o.id, content, style, palette, x, y, h, va, { target })
    return { ...t, node: o.point ? { ...t.node, point: o.point } : t.node }
  }
  const L = o.across
  if (L !== undefined) {
    // The bar runs from L − base to L − top along X; the category is at y = o.x.
    if (inside) {
      const [end, base] = [L - o.bar!.top, L - o.bar!.base]
      const probe = place(0, o.x, 'start', 'middle')
      if (Math.abs(end - base) >= probe.layout.width + 2 * LABEL_GAP) {
        const rightward = end >= base
        const t = place(
          end + (rightward ? -LABEL_GAP : LABEL_GAP),
          o.x,
          rightward ? 'end' : 'start',
          'middle',
        )
        return { node: t.node, top: Number.POSITIVE_INFINITY }
      }
    }
    const t = place(L - o.top + LABEL_GAP, o.x, 'start', 'middle')
    return { node: t.node, top: L - (t.bbox.x + t.bbox.w) }
  }
  if (inside) {
    const t = placeText(ctx.fonts, o.id, content, style, palette, o.x, 0, 'middle', 'top', {
      target,
    })
    const height = t.layout.ascent + t.layout.descent
    const upward = o.bar!.base >= o.bar!.top
    if (Math.abs(o.bar!.base - o.bar!.top) >= height + 2 * LABEL_GAP) {
      const y = upward ? o.bar!.top + LABEL_GAP : o.bar!.top - LABEL_GAP - height
      const placed = placeText(ctx.fonts, o.id, content, style, palette, o.x, y, 'middle', 'top', {
        target,
      })
      const node = o.point ? { ...placed.node, point: o.point } : placed.node
      return { node, top: Number.POSITIVE_INFINITY }
    }
  }
  const placed = placeText(
    ctx.fonts,
    o.id,
    content,
    style,
    palette,
    o.x,
    o.top - LABEL_GAP,
    'middle',
    'bottom',
    { target },
  )
  const node = o.point ? { ...placed.node, point: o.point } : placed.node
  return { node, top: placed.bbox.y }
}
