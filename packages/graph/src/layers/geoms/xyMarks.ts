import { mixColor } from '../../color.ts'
import {
  type BoxStats,
  boxStats,
  errorBounds,
  type GraphSeries,
  type PlotStats,
  tableRow,
  type XYRow,
} from '../../data.ts'
import { clipPolyline } from '../../layout/common.ts'
import type { SceneNode } from '../../scene.ts'
import { type ResolvedSeriesStyle, resolveStroke } from '../../theme.ts'

// XY time-course marks (roadmap 30): lines broken at missing values, a line through each
// replicate ("spaghetti"), the error as a shaded envelope, the area under the line, X error bars
// and a box of the replicates at each X. Plot-local coordinates, as in `layoutXYGraph`.

type Pt = [number, number]

/** What the marks need of an XY layout: the X and Y mappings and what can be shown. */
export interface XYFrame {
  W: number
  H: number
  x: (v: number) => number
  y: (v: number) => number
  /** A value's end of a band or bar, clipped to the plot. */
  yEnd: (v: number) => number
  /** Whether (x, y) can be drawn (finite, positive on log axes). */
  ok: (vx: number, vy: number) => boolean
}

/**
 * The value an XY row is plotted at: the mean, or the geometric mean with geometric error bars
 * or a geometric-mean centre (raw data only).
 */
export function xyCenter(s: PlotStats, style: Pick<ResolvedSeriesStyle, 'center' | 'error'>) {
  const geo =
    style.center.stat === 'geomean' || style.error.stat === 'geoSD' || style.error.stat === 'geoCI'
  return geo && s.raw ? s.gmean : s.mean
}

/**
 * Table rows of a data set with an X, in X order, with each row's value (NaN when it has none).
 * Ties keep row order.
 */
function byX(s: GraphSeries, value: (row: number) => number): { x: number; v: number }[] {
  const xs = s.ds.x
  if (!xs) return []
  const out: { x: number; v: number; row: number }[] = []
  for (let row = 0; row < s.ds.rowCount; row++)
    if (Number.isFinite(xs[row]!)) out.push({ x: xs[row]!, v: value(row), row })
  return out.sort((a, b) => a.x - b.x || a.row - b.row)
}

/**
 * Plot points along a data set's line in X order. Joined across missing values (rows without
 * one are left out), or with `gaps` broken there (a NaN point, which `clipPolyline` splits at).
 */
export function linePoints(
  f: XYFrame,
  s: GraphSeries,
  rows: readonly XYRow[],
  value: (r: XYRow) => number,
  gaps: boolean,
): Pt[] {
  if (!gaps)
    return [...rows]
      .filter((r) => f.ok(r.x, value(r)))
      .sort((a, b) => a.x - b.x)
      .map((r): Pt => [f.x(r.x), f.y(value(r))])
  const at = new Map(rows.map((r) => [r.row, r]))
  return byX(s, (row) => {
    const r = at.get(row)
    return r ? value(r) : Number.NaN
  }).map(({ x, v }): Pt => (f.ok(x, v) ? [f.x(x), f.y(v)] : [Number.NaN, Number.NaN]))
}

/** Runs of finite points (split where a point is NaN). */
function runs(points: readonly Pt[]): Pt[][] {
  const out: Pt[][] = [[]]
  for (const p of points) {
    if (Number.isFinite(p[0]) && Number.isFinite(p[1])) out.at(-1)!.push(p)
    else if (out.at(-1)!.length) out.push([])
  }
  return out.filter((r) => r.length > 1)
}

const clampTo = (v: number, hi: number) => Math.max(0, Math.min(hi, v))

/** A line through each replicate subcolumn across X, faded towards white. */
export function spaghettiNodes(
  f: XYFrame,
  p: { s: GraphSeries; style: ResolvedSeriesStyle; color: string },
  palette: readonly string[],
  target: (string | number)[],
  part = 'subject',
): SceneNode[] {
  const { data } = p.s.ds
  if (data.shape !== 'replicates') return []
  const sp = p.style.spaghetti
  // "The data set's colour" is the faded one.
  const stroke = resolveStroke(sp.stroke, palette, mixColor(p.color, '#ffffff', sp.fade))
  const out: SceneNode[] = []
  data.reps.forEach((rep, sub) => {
    const pts = byX(p.s, (row) => rep[row]!)
      .filter((q) => p.style.line.gaps || Number.isFinite(q.v))
      .map(({ x, v }): Pt => (f.ok(x, v) ? [f.x(x), f.y(v)] : [Number.NaN, Number.NaN]))
    clipPolyline(pts, f.W, f.H).forEach((run, k) => {
      out.push({
        id: `series/${p.s.key}/${part}/${sub}/${k}`,
        target: [...target, 'spaghetti'],
        prim: { type: 'polyline', points: run, stroke },
      })
    })
  })
  return out
}

/** The error bars as a band along the line (from the rows' error bounds, in X order). */
export function envelopeNodes(
  f: XYFrame,
  p: { s: GraphSeries; style: ResolvedSeriesStyle; color: string; rows: readonly XYRow[] },
  target: (string | number)[],
  part = 'envelope',
): SceneNode[] {
  const bounds = (r: XYRow) => {
    const c = xyCenter(r.stats, p.style)
    const e = f.ok(r.x, c) ? errorBounds(r.stats, p.style.error.stat, c) : null
    return e && f.ok(r.x, e[0]) && f.ok(r.x, e[1]) ? e : null
  }
  const lo = (r: XYRow) => bounds(r)?.[0] ?? Number.NaN
  const hi = (r: XYRow) => bounds(r)?.[1] ?? Number.NaN
  const gaps = p.style.line.gaps
  const upper = linePoints({ ...f, y: f.yEnd }, p.s, p.rows, hi, gaps)
  const lower = linePoints({ ...f, y: f.yEnd }, p.s, p.rows, lo, gaps)
  // Joined: rows with bounds only; broken: a row without them breaks the band too.
  const pairs = upper.map((u, i) => [u, lower[i]!] as const)
  const out: SceneNode[] = []
  const inX = (q: Pt) => q[0] >= 0 && q[0] <= f.W
  let run: (readonly [Pt, Pt])[] = []
  const flush = () => {
    if (run.length > 1)
      out.push({
        id: `series/${p.s.key}/${part}/${out.length}`,
        target: [...target, 'envelope'],
        prim: {
          type: 'polygon',
          points: [...run.map((q) => q[0]), ...run.map((q) => q[1]).reverse()],
          fill: { color: p.color, opacity: p.style.envelope.opacity },
          stroke: null,
        },
      })
    run = []
  }
  for (const [u, l] of pairs) {
    const good = [u[0], u[1], l[1]].every(Number.isFinite) && inX(u)
    if (good) run.push([u, l])
    else if (gaps) flush()
  }
  flush()
  return out
}

/** The area between the line and the baseline (value `base` clipped to the plot). */
export function areaNodes(
  f: XYFrame,
  p: { s: GraphSeries; style: ResolvedSeriesStyle; color: string; rows: readonly XYRow[] },
  base: number,
  target: (string | number)[],
  part = 'area',
): SceneNode[] {
  const pts = linePoints(
    { ...f, y: f.yEnd },
    p.s,
    p.rows,
    (r) => xyCenter(r.stats, p.style),
    p.style.line.gaps,
  ).map(([px, py]): Pt => [clampTo(px, f.W), py])
  const yb = f.yEnd(base)
  return runs(pts).map((run, k) => ({
    id: `series/${p.s.key}/${part}/${k}`,
    target: [...target, 'area'],
    prim: {
      type: 'polygon',
      points: [...run, [run.at(-1)![0], yb], [run[0]![0], yb]],
      fill: { color: p.color, opacity: p.style.area.opacity },
      stroke: null,
    },
  }))
}

/** Error bars along X from the table's X errors (±), with upright caps. */
export function xErrorNodes(
  f: XYFrame,
  p: { s: GraphSeries; style: ResolvedSeriesStyle; color: string; rows: readonly XYRow[] },
  palette: readonly string[],
  target: (string | number)[],
  part = 'xError',
): SceneNode[] {
  const xErr = p.s.xErr
  if (!xErr || p.style.error.x === false) return []
  const stroke = resolveStroke(p.style.error.line, palette, p.color)
  const cap = p.style.error.capWidth
  const out: SceneNode[] = []
  for (const r of p.rows) {
    const e = xErr[r.row]!
    const c = xyCenter(r.stats, p.style)
    if (!(e > 0) || !f.ok(r.x, c)) continue
    const py = f.y(c)
    const ends = [r.x - e, r.x + e].map((v) => {
      const px = f.x(v)
      return Number.isFinite(px) ? clampTo(px, f.W) : 0
    }) as [number, number]
    if (!(py >= 0 && py <= f.H)) continue
    const lines: [number, number, number, number][] = [[ends[0], py, ends[1], py]]
    if (cap > 0) for (const px of ends) lines.push([px, py - cap / 2, px, py + cap / 2])
    lines.forEach(([x1, y1, x2, y2], k) => {
      out.push({
        id: `series/${p.s.key}/${part}/${tableRow(p.s, r.row)}/${k}`,
        target: [...target, 'error'],
        prim: { type: 'line', x1, y1, x2, y2, stroke },
      })
    })
  }
  return out
}

/** Width of the boxes at each X: 0.6 of the closest X spacing, 4–24 pt. */
export function xyBoxWidth(f: Pick<XYFrame, 'x'>, rows: readonly XYRow[]): number {
  const px = [...new Set(rows.map((r) => f.x(r.x)))].filter(Number.isFinite).sort((a, b) => a - b)
  let gap = Number.POSITIVE_INFINITY
  for (let i = 1; i < px.length; i++) gap = Math.min(gap, px[i]! - px[i - 1]!)
  return Number.isFinite(gap) ? Math.max(4, Math.min(24, gap * 0.6)) : 16
}

/** The box and whiskers of each row's replicates (raw data), by row. */
export function xyBoxes(p: {
  style: ResolvedSeriesStyle
  rows: readonly XYRow[]
}): { r: XYRow; b: BoxStats }[] {
  if (!p.style.box.show) return []
  return p.rows.flatMap((r) => {
    const b = boxStats(r.stats, p.style.box.whiskers)
    return b ? [{ r, b }] : []
  })
}
