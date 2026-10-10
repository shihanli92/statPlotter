import { type Layer, type LayerOf, pointKey } from '@ps/model'
import { centerOf, tableRow, type XYRow } from '../../data.ts'
import { CloudBuilder, drawOrder, drawsCloud } from '../../layout/cloud.ts'
import { subjectShade, subjectShape } from '../../layout/nested.ts'
import { pointNodes, symbolPaint } from '../../layout/points.ts'
import { swarmOffsets } from '../../layout/swarm.ts'
import type { ResolvedSeriesStyle } from '../../theme.ts'
import type { XYCurve, XYCurveCtx } from '../curves.ts'
import type { CategorySlot } from '../frames/category.ts'
import type { GroupedCell } from '../frames/grouped.ts'
import type { XYSlot } from '../frames/xy.ts'
import { ownField, pointsOption } from '../theme.ts'
import { subjectOf } from './connector.ts'
import { xyCenter } from './xyMarks.ts'

// Point symbols: every value (identity), or one per summary. Every symbol goes to the graph's
// point-label layer as it is drawn.

/**
 * A nested group's subjects as a layer draws them (category frame): side by side when the layer
 * dodges by subject, told apart by shape or shade (`style.subjects`).
 */
export function nesting(c: CategorySlot, layer: Layer, style: ResolvedSeriesStyle) {
  const { subjects, x0, band, color } = c
  const mark = (ownField(layer, c.key, 'subjects') as string | undefined) ?? 'none'
  const bySubject = layer.position?.kind === 'dodge' && layer.position.by === 'subject'
  const nest = subjects.length > 1 ? { sideBySide: bySubject, mark } : null
  const m = subjects.length
  const sideBySide = !!nest?.sideBySide
  const span = band * 0.85
  const slot = new Map(subjects.map((s, k) => [s.sub, k]))
  const subX = (k: number) => (sideBySide ? x0 - span / 2 + ((k + 0.5) * span) / m : x0)
  const subjectLook = (sub: number) => {
    const k = slot.get(sub) ?? 0
    return {
      k,
      color: nest?.mark === 'shade' ? subjectShade(color, k, m) : color,
      shape: nest?.mark === 'shape' ? subjectShape(style.points.shape, k) : undefined,
    }
  }
  return { nest, m, sideBySide, span, subX, subjectLook }
}

/** A data set's points in its category (category frame): a swarm, or per subject. */
export function categoryPoints(c: CategorySlot, layer: LayerOf<'points'>): void {
  const { kit, key, x0, band, target, color, stats, s } = c
  const { ok: inPlot, point: yPoint } = c.Y
  const style = kit.style(layer, key)
  if (kit.stat(layer, key).kind !== 'identity') {
    categoryMean(c, layer, style)
    return
  }
  const { nest, m, sideBySide, span, subX, subjectLook } = nesting(c, layer, style)
  const subjects = c.subjects
  // On screen, at most the screen's cap of them, evenly spread (decision 450), each standing for
  // `every` points.
  const sample = kit.screenSample(stats.points, kit.graph.mapping ? 'group' : 'column')
  const every = stats.points.length / Math.max(1, sample.length)
  const pts = sample
    .filter((pt) => inPlot(pt.value))
    .map((pt) => ({ pt, cy: yPoint(pt.value) }))
    .filter((q) => Number.isFinite(q.cy))
  // Sizes mapped to a variable (roadmap 34b): the swarm spreads its points by their mean size.
  const mapped = c.marksCtx.aes?.size
  const sized = mapped ? pts.map((q) => mapped(tableRow(s, q.pt.row)) ?? style.points.size) : []
  const size = sized.length ? sized.reduce((a, b) => a + b, 0) / sized.length : style.points.size
  const jitter = style.points.jitter
  // One swarm per group, or per subject when they stand side by side.
  const swarms = sideBySide
    ? subjects.map((sj, k) => ({
        x: subX(k),
        half: (span / m) * 0.45,
        pts: pts.filter((q) => (q.pt.sub ?? 0) === sj.sub),
      }))
    : [{ x: x0, half: band * 0.4, pts }]
  const part = kit.part(layer, key, 'point')
  for (const swarm of swarms) {
    const ys = swarm.pts.map((q) => q.cy)
    const offsets =
      jitter === 'none'
        ? ys.map(() => 0)
        : swarmOffsets(ys, size, jitter === 'auto' ? swarm.half : jitter, ys.length * every)
    swarm.pts.forEach(({ pt, cy }, k) => {
      const px = swarm.x + offsets[k]!
      const row = tableRow(s, pt.row)
      c.placed?.(row, px)
      const sub = pt.sub ?? 0
      const subject = nest ? subjectLook(sub) : null
      kit.addList(
        layer,
        key,
        pointNodes(c.marksCtx, {
          id: `series/${key}/${part}/${row}${sub ? `/${sub}` : ''}`,
          target: [...target, 'points'],
          series: key,
          key: pointKey(row, sub),
          style: subject?.shape ? { ...style.points, shape: subject.shape } : style.points,
          color: subject?.color ?? color,
          cx: px,
          cy,
          label: { row, title: s.ds.rowTitles?.[pt.row] ?? null, y: pt.value },
          aesRow: row,
        }),
      )
      c.touch(cy - (mapped?.(row) ?? size) / 2)
    })
  }
}

/**
 * One symbol at a data set's summary in its category (category frame): a mean symbol, e.g. over
 * a layer of every value (its ids then `point@<layer>`). It stands for no single value: no point
 * key, no automatic label.
 */
function categoryMean(c: CategorySlot, layer: LayerOf<'points'>, style: ResolvedSeriesStyle) {
  const { kit, key, x0, target, color, stats } = c
  const center = centerOf(stats, style.center.stat)
  if (!c.Y.ok(center)) return
  const cy = c.Y.point(center)
  if (!Number.isFinite(cy)) return
  const size = style.points.size
  const { stroke, fill } = symbolPaint(style.points, kit.palette, color)
  kit.add(layer, key, {
    id: `series/${key}/${kit.part(layer, key, 'point')}`,
    target: [...target, 'points'],
    prim: { type: 'symbol', shape: style.points.shape, cx: x0, cy, size, stroke, fill },
    bbox: { x: x0 - size / 2, y: cy - size / 2, w: size, h: size },
  })
  c.touch(cy - size / 2)
}

/**
 * A cell's points in its slot (grouped frame): every replicate in a swarm, or ("mean"
 * replicates, dot plots) one symbol at the cell's centre.
 */
export function groupedPoints(g: GroupedCell, layer: LayerOf<'points'>): void {
  const { kit, key, c, p, tRow, r, cell, rowTitles } = g
  const { ok, point: yPoint } = g.axis
  const style = kit.style(layer, key)
  const { sub, cx } = g.slots(layer)
  const x0 = cx(g.gi, g.si)
  if (kit.stat(layer, key).kind === 'summary') {
    const center = centerOf(c, style.center.stat)
    if (!ok(center)) return
    const cy = yPoint(center)
    const size = style.points.size
    if (!Number.isFinite(cy)) return
    kit.addList(
      layer,
      key,
      pointNodes(g.marksCtx, {
        id: `series/${key}/${kit.part(layer, key, 'mean')}/${tRow(r)}`,
        target: [...g.target, 'points'],
        series: key,
        key: cell,
        style: style.points,
        color: p.color,
        cx: x0,
        cy,
        label: { row: tRow(r), title: rowTitles?.[r] ?? null, y: center },
      }),
    )
    if (!g.hidden) g.top = Math.min(g.top, cy - size / 2)
    return
  }
  if (!c.points.length) return
  // On screen, at most the screen's cap of the cell's points, evenly spread (decision 450), each
  // standing for `every` points.
  const sample = kit.screenSample(c.points, 'group')
  const every = c.points.length / Math.max(1, sample.length)
  const shown = sample
    .filter((pt) => ok(pt.value))
    .map((pt) => ({ pt, y: yPoint(pt.value) }))
    .filter((q) => Number.isFinite(q.y))
  const ys = shown.map((q) => q.y)
  // A graph of variables' cells hold table rows: each point is its row's.
  const own = !!p.s.cells
  const rowOf = (pt: (typeof shown)[number]['pt']) => (own ? pt.row : tRow(r))
  // Sizes mapped to a variable (roadmap 34b): the swarm spreads its points by their mean size.
  const mapped = own ? g.marksCtx.aes?.size : undefined
  const sizes = shown.map(({ pt }) => mapped?.(rowOf(pt)) ?? style.points.size)
  const size =
    mapped && sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : style.points.size
  const jitter = style.points.jitter
  const offs =
    jitter === 'none'
      ? ys.map(() => 0)
      : swarmOffsets(ys, size, jitter === 'auto' ? sub * 0.35 : jitter, ys.length * every)
  const part = kit.part(layer, key, 'point')
  shown.forEach(({ pt }, k) => {
    const [px, py] = [x0 + offs[k]!, ys[k]!]
    const row = rowOf(pt)
    // Pair lines join each subject where its point is (roadmap 34c): the first points layer's.
    const subject = subjectOf(pt, tRow(r), own)
    if (g.placed && !g.placed.has(subject)) g.placed.set(subject, px)
    kit.addList(
      layer,
      key,
      pointNodes(g.marksCtx, {
        id: `series/${key}/${part}/${tRow(r)}/${k}`,
        target: [...g.target, 'points'],
        series: key,
        key: pointKey(row, own ? 0 : (pt.sub ?? 0)),
        style: style.points,
        color: p.color,
        cx: px,
        cy: py,
        label: {
          row,
          title: (own ? p.s.cellRowTitles?.[pt.row] : rowTitles?.[r]) ?? null,
          y: pt.value,
        },
        ...(own ? { aesRow: row } : {}),
      }),
    )
    g.top = Math.min(g.top, py - sizes[k]! / 2)
  })
}

/**
 * A data set's points at each X (xy frame): each row's centre, or every replicate; many of them
 * as one cloud (an image on screen, roadmap 34e), in table order or shuffled.
 */
export function xyPoints(c: XYSlot, layer: LayerOf<'points'>): void {
  const { kit, key, p, x, target } = c
  const { scale: y, ok } = c.axis
  const style = kit.style(layer, key)
  const each = kit.stat(layer, key).kind === 'identity'
  const mid = (r: XYRow) => xyCenter(r.stats, style)
  const titles = p.s.ds.rowTitles
  const part = kit.part(layer, key, 'point')
  // Builder previews: at most the preview's share of the rows, evenly spread (decision 452).
  const rows = kit.screenSample(p.rows, 'data set', true)
  let count = 0
  for (const r of rows) count += each && r.stats.raw ? r.stats.points.length : 1
  const cloud = drawsCloud(pointsOption(layer, key, 'render'), count)
    ? new CloudBuilder(`series/${key}/${part}`)
    : null
  const symbol = (
    id: string,
    point: string,
    vx: number,
    vy: number,
    dsRow: number,
    at: { sub?: number; k?: number },
  ) => {
    if (!ok(vx, vy)) return
    const [cx, cy] = [x(vx), y(vy)]
    if (!c.inside(cx, cy)) return
    c.touch(dsRow, cy - style.points.size / 2)
    const row = tableRow(p.s, dsRow)
    kit.addList(
      layer,
      key,
      pointNodes(c.marksCtx, {
        id,
        target: [...target, 'points'],
        series: key,
        key: point,
        style: style.points,
        color: p.color,
        cx,
        cy,
        label: { row, title: titles?.[dsRow] ?? null, x: vx, y: vy },
        ...(cloud ? { cloud: { into: cloud, row, ...at } } : {}),
      }),
    )
  }
  const draw = (r: XYRow) => {
    const row = tableRow(p.s, r.row)
    if (each && r.stats.raw) {
      r.stats.points.forEach((pt, k) => {
        symbol(
          `series/${key}/${part}/${row}/${k}`,
          pointKey(row, pt.sub ?? 0),
          r.x,
          pt.value,
          r.row,
          { sub: pt.sub ?? 0, k },
        )
      })
    } else symbol(`series/${key}/${part}/${row}`, pointKey(row), r.x, mid(r), r.row, {})
  }
  // Shuffled rows keep their replicates together (the order is the rows').
  const perm = drawOrder(
    rows.length,
    pointsOption(layer, key, 'order') === 'random' ? 'random' : 'table',
  )
  if (perm) for (const i of perm) draw(rows[i]!)
  else for (const r of rows) draw(r)
  if (cloud?.count)
    kit.add(layer, key, {
      id: `series/${key}/${part}`,
      target: [...target, 'points'],
      prim: cloud.build(),
    })
}

/**
 * An analysis output's points (xy frame, plane `curves`), labelled by the table rows they come
 * from (e.g. a volcano plot's genes).
 */
export function xyCurvePoints(o: XYCurveCtx, c: XYCurve, layer: LayerOf<'points'>): void {
  const { kit, x } = o
  const { data } = c
  const { scale: y, ok } = c.right ? o.right : o.left
  const style = kit.style(layer, c.id)
  const size = style.points.size
  const { stroke, fill } = symbolPaint(style.points, kit.palette, c.color)
  const part = kit.part(layer, c.id, 'point')
  data.x.forEach((vx, i) => {
    const vy = data.y[i]!
    if (!ok(vx, vy)) return
    const [cx, cy] = [x(vx), y(vy)]
    if (!o.inside(cx, cy)) return
    const row = data.rows?.[i]
    o.pointLabels.add({
      series: c.id,
      key: pointKey(row ?? i),
      cx,
      cy,
      size,
      color: c.color,
      ...(row !== undefined ? { row, title: data.rowTitles?.[i] ?? null } : {}),
      x: vx,
      y: vy,
    })
    kit.add(layer, c.id, {
      id: `curve/${c.index}/${part}/${i}`,
      target: ['extraSeries', c.index, 'points'],
      prim: { type: 'symbol', shape: style.points.shape, cx, cy, size, stroke, fill },
      bbox: { x: cx - size / 2, y: cy - size / 2, w: size, h: size },
    })
  })
}
