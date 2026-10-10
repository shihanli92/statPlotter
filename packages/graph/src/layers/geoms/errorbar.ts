import type { LayerOf } from '@ps/model'
import { centerOf, errorBounds, tableRow } from '../../data.ts'
import type { SceneNode } from '../../scene.ts'
import { type ResolvedSeriesStyle, resolveStroke } from '../../theme.ts'
import type { CategorySlot } from '../frames/category.ts'
import type { GroupedCell } from '../frames/grouped.ts'
import type { XYSlot } from '../frames/xy.ts'
import type { LayerKit } from '../kit.ts'
import { xErrorNodes, xyCenter } from './xyMarks.ts'

// Error bars: a summary's error around its centre, attached to a host (bars point them away from
// their baseline; stacked bars put them on the segment's end).

/**
 * The direction of a bar's error bar: 'above' and 'below' point away from the bar's base (zero,
 * a chosen baseline (roadmap 30), or the axis' start when that is off the axis; a stacked
 * segment's start), so a bar below its base gets its error bar downwards. `base` undefined: no
 * bar, the direction as set.
 */
export function barErrorDirection(
  direction: ResolvedSeriesStyle['error']['direction'],
  value: number,
  base: number | undefined,
): ResolvedSeriesStyle['error']['direction'] {
  if (base === undefined || !(value < base) || direction === 'both') return direction
  return direction === 'above' ? 'below' : 'above'
}

/** The bar layer an attached layer sits on, when it draws this data set. */
export function hostBars(kit: LayerKit, layer: { on?: string }, key: string) {
  const host = kit.byId(layer.on)
  return host?.geom === 'bar' && kit.shows(host, key) ? host : undefined
}

/** A data set's error bar in its category (category frame). */
export function categoryError(c: CategorySlot, layer: LayerOf<'errorbar'>): void {
  const { kit, key, x0, target, color, stats } = c
  const { palette } = kit
  const { ok: inPlot, end: yEnd } = c.Y
  const style = kit.style(layer, key)
  const center = centerOf(stats, style.center.stat)
  if (!inPlot(center)) return
  const e = errorBounds(stats, style.error.stat, center)
  if (!e) return
  const host = hostBars(kit, layer, key)
  const stroke = resolveStroke(style.error.line, palette, color)
  const cap = style.error.capWidth
  const base = host ? c.Y.baselineAt(kit.style(host, key).bar.baseline) : undefined
  const dir = barErrorDirection(style.error.direction, center, base)
  const top = dir === 'below' ? center : e[1]
  const bottom = dir === 'above' ? center : e[0]
  const [yTop, yBottom] = [yEnd(top), yEnd(bottom)].sort((a, b) => a - b) as [number, number]
  const lines: [number, number, number, number][] = [[x0, yTop, x0, yBottom]]
  const [capTop, capBottom] = c.ySpec.reverse ? ['above', 'below'] : ['below', 'above']
  if (dir !== capTop && cap > 0) lines.push([x0 - cap / 2, yTop, x0 + cap / 2, yTop])
  if (dir !== capBottom && cap > 0) lines.push([x0 - cap / 2, yBottom, x0 + cap / 2, yBottom])
  const id = `series/${key}/${kit.part(layer, key, 'error')}`
  const node: SceneNode = {
    id,
    target: [...target, 'error'],
    children: lines.map(([x1, y1, x2, y2], k) => ({
      id: `${id}/${k}`,
      target: [...target, 'error'],
      prim: { type: 'line', x1, y1, x2, y2, stroke },
    })),
    bbox: { x: x0 - cap / 2, y: yTop, w: cap, h: yBottom - yTop },
  }
  kit.add(layer, key, node)
  c.touch(yTop)
}

/** A cell's error bar in its slot (grouped frame); on a stacked bar, at its segment's end. */
export function groupedError(g: GroupedCell, layer: LayerOf<'errorbar'>): void {
  const { kit, key, c, color, tRow, r, hidden } = g
  const { ok, end: yEnd } = g.axis
  const style = kit.style(layer, key)
  const center = centerOf(c, style.center.stat)
  const host = hostBars(kit, layer, key)
  const stacked = host?.position?.kind === 'stack'
  const seg = host ? (g.stacks(host)?.[g.si]?.[r] ?? null) : null
  const bounds =
    ok(center) && !hidden && (!stacked || seg) ? errorBounds(c, style.error.stat, center) : null
  // Stacked: the error bar sits on the segment's end (scaled with a percent stack).
  const [mid, e] =
    seg && bounds
      ? [seg.end, bounds.map((v) => seg.end + (v - center) * seg.k) as [number, number]]
      : [center, bounds]
  if (!e) return
  const { sub, cx } = g.slots(layer)
  const x0 = cx(g.gi, g.si)
  const stroke = resolveStroke(style.error.line, kit.palette, color)
  const cap = Math.min(style.error.capWidth, sub * 0.8)
  // Away from the bar's base: a stacked segment's start, else the bar's baseline.
  const base = seg
    ? seg.start
    : host
      ? g.axis.baselineAt(kit.style(host, key).bar.baseline)
      : undefined
  const dir = barErrorDirection(style.error.direction, mid, base)
  const [yTop, yBottom] = [yEnd(dir === 'below' ? mid : e[1]), yEnd(dir === 'above' ? mid : e[0])]
  const lines: [number, number, number, number][] = [[x0, yTop, x0, yBottom]]
  if (dir !== 'below' && cap > 0) lines.push([x0 - cap / 2, yTop, x0 + cap / 2, yTop])
  if (dir !== 'above' && cap > 0) lines.push([x0 - cap / 2, yBottom, x0 + cap / 2, yBottom])
  const part = kit.part(layer, key, 'error')
  lines.forEach(([x1, y1, x2, y2], k) => {
    kit.add(
      layer,
      key,
      g.mark({
        id: `series/${key}/${part}/${tRow(r)}/${k}`,
        target: [...g.target, 'error'],
        prim: { type: 'line', x1, y1, x2, y2, stroke },
      }),
    )
  })
  g.top = Math.min(g.top, yTop, yBottom)
}

/** A data set's error bars at each X (xy frame): X errors from the table, then Y. */
export function xyError(c: XYSlot, layer: LayerOf<'errorbar'>): void {
  const { kit, key, p, x, W, target } = c
  const { ok, end: yEnd } = c.axis
  const style = kit.style(layer, key)
  kit.addList(
    layer,
    key,
    xErrorNodes(c.frame, { ...p, style }, kit.palette, target, kit.part(layer, key, 'xError')),
  )
  const stroke = resolveStroke(style.error.line, kit.palette, p.color)
  const cap = style.error.capWidth
  const host = hostBars(kit, layer, key)
  const base = host ? c.axis.baselineAt(kit.style(host, key).bar.baseline) : undefined
  const part = kit.part(layer, key, 'error')
  for (const r of p.rows) {
    const cy = xyCenter(r.stats, style)
    const e = errorBounds(r.stats, style.error.stat, cy)
    if (!e || !ok(r.x, cy)) continue
    const dir = barErrorDirection(style.error.direction, cy, base)
    const px = x(r.x)
    if (!(px >= 0 && px <= W)) continue
    const yTop = yEnd(dir === 'below' ? cy : e[1])
    const yBottom = yEnd(dir === 'above' ? cy : e[0])
    const lines: [number, number, number, number][] = [[px, yTop, px, yBottom]]
    if (dir !== 'below' && cap > 0) lines.push([px - cap / 2, yTop, px + cap / 2, yTop])
    if (dir !== 'above' && cap > 0) lines.push([px - cap / 2, yBottom, px + cap / 2, yBottom])
    c.touch(r.row, Math.min(yTop, yBottom))
    lines.forEach(([x1, y1, x2, y2], k) => {
      kit.add(layer, key, {
        id: `series/${key}/${part}/${tableRow(p.s, r.row)}/${k}`,
        target: [...target, 'error'],
        prim: { type: 'line', x1, y1, x2, y2, stroke },
      })
    })
  }
}
