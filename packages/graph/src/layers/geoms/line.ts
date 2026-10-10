import type { LayerOf } from '@ps/model'
import { centerOf, type PlotStats, type XYRow } from '../../data.ts'
import { clipPolyline, type ValueAxis } from '../../layout/common.ts'
import type { StylePath } from '../../scene.ts'
import { resolveStroke } from '../../theme.ts'
import type { XYCurve, XYCurveCtx } from '../curves.ts'
import type { GroupedSeries } from '../frames/grouped.ts'
import type { XYSlot } from '../frames/xy.ts'
import type { LayerKit } from '../kit.ts'
import { linePoints, spaghettiNodes, xyCenter } from './xyMarks.ts'

// Lines: a data set's summaries joined (across rows, or along X), or each replicate joined.

/** A data set's means (or medians) joined across the rows (grouped frame), broken at gaps. */
export function groupedLine(
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
  layer: LayerOf<'line'>,
): void {
  const { kit, key, si, p, rows, target } = g
  const { ok, point: yPoint } = g.axis
  const style = kit.style(layer, key)
  const stroke = resolveStroke(style.line.stroke, kit.palette, p.color)
  let run: [number, number][] = []
  const runs: [number, number][][] = []
  rows.forEach((r, gi) => {
    const v = centerOf(p.cells[r]!, style.center.stat)
    const py = ok(v) ? yPoint(v) : Number.NaN
    if (Number.isFinite(py)) run.push([g.x(gi, si), py])
    else if (run.length) {
      runs.push(run)
      run = []
    }
  })
  if (run.length) runs.push(run)
  const part = kit.part(layer, key, 'line')
  runs.forEach((points, k) => {
    if (points.length > 1)
      kit.add(layer, key, {
        id: `series/${key}/${part}/${k}`,
        target: [...target, 'line'],
        prim: { type: 'polyline', points, stroke },
      })
  })
}

/**
 * A line through the data sets' centres across the categories (category frame): one line for the
 * graph, black unless styled, joined over a data set without a centre unless the layer breaks at
 * gaps. Its marks are the first data set's (so planes order them by layer) but target the layer.
 */
export function categoryLine(
  kit: LayerKit,
  layer: LayerOf<'line'>,
  slots: readonly { key: string; stats: PlotStats; x: number; touch: (py: number) => void }[],
  axis: ValueAxis,
): void {
  const shown = slots.filter((s) => kit.shows(layer, s.key))
  const first = shown[0]
  if (!first) return
  const style = kit.style(layer, first.key)
  const stroke = resolveStroke(style.line.stroke, kit.palette, '#000000')
  const runs: [number, number][][] = [[]]
  for (const s of shown) {
    const v = centerOf(s.stats, kit.style(layer, s.key).center.stat)
    const py = axis.ok(v) ? axis.point(v) : Number.NaN
    if (Number.isFinite(py)) {
      runs.at(-1)!.push([s.x, py])
      s.touch(py)
    } else if (style.line.gaps && runs.at(-1)!.length) runs.push([])
  }
  const part = kit.part(layer, '', 'means')
  runs
    .filter((r) => r.length > 1)
    .forEach((points, k) => {
      kit.add(layer, first.key, {
        id: `${part}/${k}`,
        target: ['layers', layer.id],
        prim: { type: 'polyline', points, stroke },
      })
    })
}

/** A data set's line through its rows' centres in X order (xy frame), broken at gaps. */
export function xyLine(c: XYSlot, layer: LayerOf<'line'>): void {
  const { kit, key, p, W, H, target } = c
  const style = kit.style(layer, key)
  const mid = (r: XYRow) => xyCenter(r.stats, style)
  const pts = linePoints(c.frame, p.s, p.rows, mid, style.line.gaps)
  const stroke = resolveStroke(style.line.stroke, kit.palette, p.color)
  const part = kit.part(layer, key, 'line')
  clipPolyline(pts, W, H).forEach((run, k) => {
    kit.add(layer, key, {
      id: `series/${key}/${part}/${k}`,
      target: [...target, 'line'],
      prim: { type: 'polyline', points: run, stroke },
    })
  })
}

/**
 * A staircase through a data set's rows' centres in X order (xy frame): level from each point to
 * the next X, then up or down to it (R's `type = 's'`), broken at gaps.
 */
export function xyStep(c: XYSlot, layer: LayerOf<'step'>): void {
  const { kit, key, p, W, H, target } = c
  const style = kit.style(layer, key)
  const mid = (r: XYRow) => xyCenter(r.stats, style)
  const pts = linePoints(c.frame, p.s, p.rows, mid, style.line.gaps)
  const stairs: [number, number][] = []
  pts.forEach((q, i) => {
    const prev = pts[i - 1]
    if (prev && [...prev, ...q].every(Number.isFinite)) stairs.push([q[0], prev[1]])
    stairs.push(q)
  })
  const stroke = resolveStroke(style.line.stroke, kit.palette, p.color)
  const part = kit.part(layer, key, 'step')
  clipPolyline(stairs, W, H).forEach((run, k) => {
    kit.add(layer, key, {
      id: `series/${key}/${part}/${k}`,
      target: [...target, 'line'],
      prim: { type: 'polyline', points: run, stroke },
    })
  })
}

/** A line through each replicate across X, faded towards white (xy frame). */
export function xySpaghetti(c: XYSlot, layer: LayerOf<'line'>): void {
  const { kit, key, p } = c
  const style = kit.style(layer, key)
  kit.addList(
    layer,
    key,
    spaghettiNodes(
      c.frame,
      { ...p, style },
      kit.palette,
      c.target,
      kit.part(layer, key, 'subject'),
    ),
  )
}

/** An analysis output's curve (xy frame, plane `curves`). */
export function xyCurve(o: XYCurveCtx, c: XYCurve, layer: LayerOf<'line'>): void {
  const { kit, x, W, H } = o
  const { data } = c
  const { scale: y, ok } = c.right ? o.right : o.left
  const pts: [number, number][] = data.x.map((vx, i) => {
    const vy = data.y[i]!
    return ok(vx, vy) ? [x(vx), y(vy)] : [Number.NaN, Number.NaN]
  })
  const stroke = resolveStroke(kit.style(layer, c.id).line.stroke, kit.palette, c.color)
  const part = kit.part(layer, c.id, '')
  clipPolyline(pts, W, H).forEach((run, k) => {
    kit.add(layer, c.id, {
      id: `curve/${c.index}/${part ? `${part}/` : ''}${k}`,
      target: ['extraSeries', c.index, 'line'],
      prim: { type: 'polyline', points: run, stroke },
    })
  })
}

/** A function over its X range (xy frame, plane `curves`). */
export function xyFunction(o: XYCurveCtx, f: XYCurve, layer: LayerOf<'line'>): void {
  const { kit, x, W, H } = o
  const { scale: y, ok } = f.right ? o.right : o.left
  const pts: [number, number][] = f.data.x.map((vx, i) => {
    const vy = f.data.y[i]!
    return ok(vx, vy) ? [x(vx), y(vy)] : [Number.NaN, Number.NaN]
  })
  const stroke = resolveStroke(kit.style(layer, f.id).line.stroke, kit.palette, f.color)
  const part = kit.part(layer, f.id, '')
  clipPolyline(pts, W, H).forEach((run, k) => {
    kit.add(layer, f.id, {
      id: `function/${f.index}/${part ? `${part}/` : ''}${k}`,
      target: ['functions', f.index, 'line'],
      prim: { type: 'polyline', points: run, stroke },
    })
  })
}
