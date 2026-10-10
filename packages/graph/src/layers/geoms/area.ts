import type { LayerOf } from '@ps/model'
import type { XYSeries, XYSlot } from '../frames/xy.ts'
import type { LayerKit } from '../kit.ts'
import { stackAreas } from '../positions.ts'
import { areaNodes, type XYFrame, xyCenter } from './xyMarks.ts'

// Areas: the fill between a data set's line and a baseline (xy frame, plane `areas`), or stacked
// on the data sets before it.

/** The area under a data set's line, to its baseline (clipped to the plot). */
export function xyArea(c: XYSlot, layer: LayerOf<'area'>): void {
  const { kit, key, p } = c
  const style = kit.style(layer, key)
  const nodes = areaNodes(
    c.frame,
    { ...p, style },
    c.axis.baselineAt(style.area.baseline),
    c.target,
    kit.part(layer, key, 'area'),
  )
  kit.addList(layer, key, nodes)
}

/**
 * A stacked area layer's data sets (those it draws, in order) and their tops at every X: each
 * data set's centre piled on the ones before it, from the first data set's baseline.
 */
export function areaStack(kit: LayerKit, layer: LayerOf<'area'>, series: readonly XYSeries[]) {
  const shown = series.filter((p) => kit.shows(layer, p.s.key))
  const base = (shown[0] && kit.style(layer, shown[0].s.key).area.baseline) ?? 0
  const stack = stackAreas(
    shown.map((p) => {
      const style = kit.style(layer, p.s.key)
      return { rows: p.rows.map((r) => ({ x: r.x, value: xyCenter(r.stats, style) })) }
    }),
    base,
  )
  return { shown, base, ...stack }
}

/** Stacked areas (xy frame, on the left Y axis): each data set's band of the stack. */
export function xyStackedAreas(
  f: XYFrame,
  kit: LayerKit,
  layer: LayerOf<'area'>,
  series: readonly XYSeries[],
): void {
  const { shown, base, xs, at } = areaStack(kit, layer, series)
  const px = xs.map((x) => (f.ok(x, base) ? Math.max(0, Math.min(f.W, f.x(x))) : Number.NaN))
  shown.forEach((p, d) => {
    const key = p.s.key
    const lower = d === 0 ? xs.map(() => base) : at[d - 1]!
    const upper = at[d]!
    const keep = xs.flatMap((_, i) =>
      Number.isFinite(px[i]!) && f.ok(xs[i]!, upper[i]!) && f.ok(xs[i]!, lower[i]!) ? [i] : [],
    )
    if (keep.length < 2) return
    const style = kit.style(layer, key)
    kit.add(layer, key, {
      id: `series/${key}/${kit.part(layer, key, 'area')}/0`,
      target: ['seriesOverrides', key, 'area'],
      prim: {
        type: 'polygon',
        points: [
          ...keep.map((i): [number, number] => [px[i]!, f.yEnd(upper[i]!)]),
          ...[...keep].reverse().map((i): [number, number] => [px[i]!, f.yEnd(lower[i]!)]),
        ],
        fill: { color: p.color, opacity: style.area.opacity },
        stroke: null,
      },
    })
  })
}
