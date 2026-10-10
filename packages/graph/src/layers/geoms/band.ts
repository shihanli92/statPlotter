import type { LayerOf } from '@ps/model'
import { centerOf, errorBounds } from '../../data.ts'
import type { ValueAxis } from '../../layout/common.ts'
import type { SceneNode, StylePath } from '../../scene.ts'
import type { XYCurve, XYCurveCtx } from '../curves.ts'
import type { GroupedSeries } from '../frames/grouped.ts'
import type { XYSlot } from '../frames/xy.ts'
import type { LayerKit } from '../kit.ts'
import { envelopeNodes } from './xyMarks.ts'

// Bands: a fill between lo and hi — a data set's error as an envelope along its line (plane
// `areas`), an output's confidence band (plane `bands`), a survival curve's CI.

/** A data set's error as a shaded band along its line (xy frame). */
export function xyEnvelope(c: XYSlot, layer: LayerOf<'band'>): void {
  const { kit, key, p } = c
  const style = kit.style(layer, key)
  kit.addList(
    layer,
    key,
    envelopeNodes(c.frame, { ...p, style }, c.target, kit.part(layer, key, 'envelope')),
  )
}

/**
 * A data set's error as a band across the rows (grouped frame: a time course kept as a grouped
 * table), through its cells' slots, broken at rows without one. Returns each point's top.
 */
export function groupedBand(
  g: {
    kit: LayerKit
    key: string
    si: number
    p: GroupedSeries
    rows: readonly number[]
    axis: ValueAxis
    target: StylePath
    x: (gi: number, si: number) => number
  },
  layer: LayerOf<'band'>,
): { x: number; top: number }[] {
  const { kit, key, si, p, rows } = g
  const { ok, point: yPoint } = g.axis
  const style = kit.style(layer, key)
  const runs: { x: number; lo: number; hi: number }[][] = [[]]
  rows.forEach((r, gi) => {
    const c = p.cells[r]!
    const center = centerOf(c, style.center.stat)
    const e = errorBounds(c, style.error.stat, center)
    const [lo, hi] = e?.every(ok) ? e.map(yPoint) : [Number.NaN, Number.NaN]
    if (Number.isFinite(lo) && Number.isFinite(hi)) runs.at(-1)!.push({ x: g.x(gi, si), lo, hi })
    else if (runs.at(-1)!.length) runs.push([])
  })
  const part = kit.part(layer, key, 'envelope')
  const tops: { x: number; top: number }[] = []
  runs
    .filter((run) => run.length > 1)
    .forEach((run, k) => {
      kit.add(layer, key, {
        id: `series/${key}/${part}/${k}`,
        target: [...g.target, 'envelope'],
        prim: {
          type: 'polygon',
          points: [
            ...run.map((q): [number, number] => [q.x, Math.min(q.lo, q.hi)]),
            ...[...run].reverse().map((q): [number, number] => [q.x, Math.max(q.lo, q.hi)]),
          ],
          fill: { color: p.color, opacity: style.envelope.opacity },
          stroke: null,
        },
      })
      for (const q of run) tops.push({ x: q.x, top: Math.min(q.lo, q.hi) })
    })
  return tops
}

/** An output's lo–hi band (a confidence or prediction band). */
export function xyCurveBand(o: XYCurveCtx, c: XYCurve, layer: LayerOf<'band'>): void {
  const { kit, x, W } = o
  const { data } = c
  if (!data.lo || !data.hi) return
  const style = kit.style(layer, c.id)
  const { end: yEnd, ok } = c.right ? o.right : o.left
  const upper: [number, number][] = []
  const lower: [number, number][] = []
  for (let i = 0; i < data.x.length; i++) {
    const [vx, lo, hi] = [data.x[i]!, data.lo[i]!, data.hi[i]!]
    if (!ok(vx, lo) || !ok(vx, hi)) continue
    const px = x(vx)
    if (!(px >= 0 && px <= W)) continue
    upper.push([px, yEnd(hi)])
    lower.push([px, yEnd(lo)])
  }
  if (upper.length <= 1) return
  const node: SceneNode = {
    id: `curve/${c.index}/${kit.part(layer, c.id, 'band')}`,
    target: ['extraSeries', c.index, 'band'],
    prim: {
      type: 'polygon',
      points: [...upper, ...lower.reverse()],
      fill: { color: c.color, opacity: style.band.opacity },
      stroke: null,
    },
  }
  kit.add(layer, c.id, node)
}
