import type { Layer, LayerOf } from '@ps/model'
import { centerOf, tableRow, type XYRow } from '../../data.ts'
import type { ValueAxis } from '../../layout/common.ts'
import { barLabel } from '../../layout/labels.ts'
import type { ResolvedSeriesStyle } from '../../theme.ts'
import type { CategorySlot } from '../frames/category.ts'
import type { GroupedCell } from '../frames/grouped.ts'
import type { XYSlot } from '../frames/xy.ts'
import type { BarEnds } from './bar.ts'
import { xyCenter } from './xyMarks.ts'

// Labels at marks: a number above (or inside) a bar or column — its value, mean, n… — placed
// above the highest mark under it (the skyline); `barLabel` (layout/labels.ts) lays them out.

/** Above the highest mark drawn under a label; with none, at its value (plot-local y). */
const aboveOrAt = (top: number, value: number, axis: Pick<ValueAxis, 'ok' | 'point'>) =>
  Number.isFinite(top) ? top : axis.ok(value) ? axis.point(value) : top

/** A data set's label above its category's marks (category frame). Returns its top. */
export function categoryLabel(
  c: CategorySlot,
  layer: LayerOf<'label'>,
  top: number,
  bar: BarEnds | undefined,
): number | undefined {
  const { kit, key, x0, target, stats } = c
  const style = kit.style(layer, key)
  const center = centerOf(stats, style.center.stat)
  const lab = barLabel(kit.ctx, kit.theme, kit.palette, {
    id: `series/${key}/${kit.part(layer, key, 'label')}`,
    target,
    style,
    stats,
    center,
    x: x0,
    top: aboveOrAt(top, center, c.Y),
    bar,
    across: c.across,
  })
  if (!lab) return undefined
  kit.add(layer, key, lab.node)
  c.touch(lab.top)
  return lab.top
}

/**
 * A cell's label (grouped frame), above the cell's marks; on stacked bars, only inside its
 * segment (a segment too small for its label goes without). Returns its top.
 */
export function groupedLabel(
  g: GroupedCell,
  layer: LayerOf<'label'>,
  host: Layer | undefined,
  bar: BarEnds | undefined,
): number | undefined {
  const { kit, key, c, tRow, r } = g
  const stacked = host?.position?.kind === 'stack'
  const own = kit.style(layer, key)
  // A share of the row's total ("percent", as 100% stacked bars show it): the host's segment
  // as a percent, shown as a value with a percent sign.
  const percent = (own.label.stat as string) === 'percent'
  const seg = percent ? g.shares(host ?? layer)[g.si]?.[r] : undefined
  const label: ResolvedSeriesStyle['label'] = percent
    ? {
        ...own.label,
        stat: 'value',
        format:
          own.label.format.mode === 'auto' && own.label.format.suffix === undefined
            ? { ...own.label.format, suffix: '%' }
            : own.label.format,
      }
    : own.label
  // Stacked: labels only inside their segments.
  const style: ResolvedSeriesStyle = {
    ...own,
    label: stacked ? { ...label, position: 'inside' } : label,
  }
  const center = percent ? (seg ? seg.end - seg.start : Number.NaN) : centerOf(c, own.center.stat)
  const { cx } = g.slots(layer)
  const lab =
    g.hidden || (stacked && !bar)
      ? null
      : barLabel(kit.ctx, kit.theme, kit.palette, {
          id: `series/${key}/${kit.part(layer, key, 'label')}/${tRow(r)}`,
          target: g.target,
          style,
          stats: c,
          center,
          x: cx(g.gi, g.si),
          top: aboveOrAt(g.top, center, g.axis),
          bar,
          point: g.cell,
          across: g.across,
        })
  // (A segment too small for its label goes without.)
  if (!lab || (stacked && lab.top !== Number.POSITIVE_INFINITY)) return undefined
  kit.add(layer, key, lab.node)
  g.top = Math.min(g.top, lab.top)
  return lab.top
}

/** Labels above a data set's bars or points at each X (xy frame). Returns the highest top. */
export function xyLabels(c: XYSlot, layer: LayerOf<'label'>): number {
  const { kit, key, p, x, W, target } = c
  const { scale: y, ok } = c.axis
  const style = kit.style(layer, key)
  const mid = (r: XYRow) => xyCenter(r.stats, style)
  const part = kit.part(layer, key, 'label')
  let labelTop = 0
  for (const r of p.rows) {
    if (!ok(r.x, mid(r))) continue
    const px = x(r.x)
    if (!(px >= 0 && px <= W)) continue
    const lab = barLabel(kit.ctx, kit.theme, kit.palette, {
      id: `series/${key}/${part}/${tableRow(p.s, r.row)}`,
      target,
      style,
      stats: r.stats,
      center: mid(r),
      x: px,
      top: c.tops.get(r.row) ?? y(mid(r)),
      bar: c.barTops.get(r.row),
    })
    if (lab) {
      kit.add(layer, key, lab.node)
      labelTop = Math.min(labelTop, lab.top)
    }
  }
  return labelTop
}
