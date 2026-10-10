import type { AxisScale, PieceLength } from '@ps/model'
import { type Transform, transformOf } from './transform.ts'

/**
 * Axis scales and tick generation. Domains are data values; ranges are points. Y ranges are
 * inverted by the caller (range = [bottom, top]). Positions are linear in the transformed value
 * (`transform.ts`: linear, log, or roadmap 34g's arcsinh and logicle).
 */

export interface Scale {
  kind: AxisScale
  /** Raw value ↔ the value positions are linear in. */
  transform: Transform
  domain: [number, number]
  range: [number, number]
  /** Position of a value; NaN for values hidden inside an axis break. */
  (v: number): number
  invert(p: number): number
  /**
   * Position for the end of a mark that spans values (a bar top, an error-bar end, a band edge):
   * like the scale, but values inside an axis break map to the break's lower edge.
   */
  edge(v: number): number
  /** Axis-break gaps as [start, end] positions, ascending; empty without breaks. */
  gaps: [number, number][]
  /** With breaks: the visible [lo, hi] data intervals, ascending. */
  pieces?: [number, number][]
}

/** A scale's transform: itself, or a kind's with default parameters. */
const asTransform = (kind: AxisScale | Transform): Transform =>
  typeof kind === 'string' ? transformOf(kind) : kind

export function makeScale(
  kind: AxisScale | Transform,
  domain: [number, number],
  range: [number, number],
): Scale {
  const tr = asTransform(kind)
  const t = tr.forward
  const tInv = tr.inverse
  const [d0, d1] = [t(domain[0]), t(domain[1])]
  const [r0, r1] = range
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0)
  const scale = ((v: number) => r0 + (t(v) - d0) * k) as Scale
  scale.kind = tr.kind
  scale.transform = tr
  scale.domain = domain
  scale.range = range
  scale.invert = (p: number) => tInv(d0 + (k === 0 ? 0 : (p - r0) / k))
  scale.edge = scale
  scale.gaps = []
  return scale
}

/** A break as given on an axis: the data interval [from, to] is removed, leaving `gap` points. */
export interface ScaleBreak {
  from: number
  to: number
  gap: number
}

/**
 * The points per transformed unit of each piece of a broken axis (roadmap 36): pieces with a set
 * length (a fraction of the axis' `full` length, or points) take it, the others share what is
 * left of `room` in proportion to their spans (as without lengths). Null: no lengths set, or
 * lengths that can't be met (more than the room, or nothing left for the other pieces): every
 * piece in proportion.
 */
export function pieceScales(
  spans: readonly number[],
  lengths: readonly (PieceLength | null | undefined)[] | undefined,
  room: number,
  full: number,
): number[] | null {
  if (!lengths?.some((l) => l)) return null
  const set = spans.map((_, i) => {
    const l = lengths[i]
    if (!l || !(l.value > 0)) return null
    return l.unit === 'fraction' ? l.value * full : l.value
  })
  const fixed = set.reduce<number>((sum, v) => sum + (v ?? 0), 0)
  const freeSpan = spans.reduce((sum, d, i) => sum + (set[i] === null ? d : 0), 0)
  const left = room - fixed
  if (freeSpan > 0 ? !(left > 0) : Math.abs(left) > 1e-9 * Math.max(1, room)) {
    // Every piece set but not adding up to the room: scaled to fit it.
    if (freeSpan > 0 || !(fixed > 0)) return null
    return spans.map((d, i) => (set[i]! * room) / fixed / d)
  }
  const k = freeSpan > 0 ? left / freeSpan : 0
  return spans.map((d, i) => (set[i] === null ? k : set[i]! / d))
}

/**
 * An axis scale: `range` is [start, end] of the plot extent (Y axes pass [bottom, top]).
 * `reverse` swaps the ends. `breaks` make a discontinuous (piecewise) scale: each [from, to]
 * inside the domain is removed and replaced by a `gap` of blank points; breaks outside the
 * domain, reversed, overlapping an earlier break, or leaving no room are ignored. The pieces
 * between breaks are in proportion to their spans unless `pieces` sets their lengths (roadmap
 * 36, `pieceScales`), from the low end up.
 */
export function makeAxisScale(
  kind: AxisScale | Transform,
  domain: [number, number],
  range: [number, number],
  opts: {
    reverse?: boolean
    breaks?: readonly ScaleBreak[]
    pieces?: readonly (PieceLength | null)[]
  } = {},
): Scale {
  const r: [number, number] = opts.reverse ? [range[1], range[0]] : range
  const tr = asTransform(kind)
  const base = makeScale(tr, domain, r)
  // Breaks cut linear and log axes (cytometry axes have none).
  if (!opts.breaks?.length || tr.cyto) return base
  const t = tr.forward
  const tInv = tr.inverse
  const [lo, hi] = [t(domain[0]), t(domain[1])]
  if (!(lo < hi)) return base
  const cuts: { a: number; b: number; gap: number }[] = []
  for (const br of [...opts.breaks].sort((p, q) => p.from - q.from)) {
    const [a, b] = [t(br.from), t(br.to)]
    const prev = cuts.at(-1)
    if (!(a < b) || !(a > lo) || !(b < hi) || !Number.isFinite(br.gap) || br.gap < 0) continue
    if (prev && a <= prev.b) continue
    cuts.push({ a, b, gap: br.gap })
  }
  if (!cuts.length) return base
  const [r0, r1] = r
  const dir = r1 >= r0 ? 1 : -1
  const gapTotal = cuts.reduce((sum, c) => sum + c.gap, 0)
  const visible = hi - lo - cuts.reduce((sum, c) => sum + (c.b - c.a), 0)
  const k = (Math.abs(r1 - r0) - gapTotal) / visible
  if (!(k > 0)) return base

  // Each piece's points per transformed unit: all `k` unless lengths are set (roadmap 36).
  const bounds = [lo, ...cuts.flatMap((c) => [c.a, c.b]), hi]
  const spans = cuts.map((_, i) => bounds[2 * i + 1]! - bounds[2 * i]!)
  spans.push(hi - bounds.at(-2)!)
  const ks = pieceScales(spans, opts.pieces, Math.abs(r1 - r0) - gapTotal, Math.abs(r1 - r0))
  // Visible segments in transformed units, with their start distance along the axis.
  const segs: { a: number; b: number; start: number; k: number }[] = []
  let a = lo
  let along = 0
  cuts.forEach((c, i) => {
    const sk = ks ? ks[i]! : k
    segs.push({ a, b: c.a, start: along, k: sk })
    along += (c.a - a) * sk + c.gap
    a = c.b
  })
  segs.push({ a, b: hi, start: along, k: ks ? ks.at(-1)! : k })
  const first = segs[0]!
  const last = segs.at(-1)!
  const at = (s: (typeof segs)[number], tv: number) => r0 + dir * (s.start + (tv - s.a) * s.k)
  const eps = (hi - lo) * 1e-12
  const place = (v: number, inBreak: (i: number) => number) => {
    const tv = t(v)
    if (Number.isNaN(tv)) return Number.NaN
    if (tv <= first.b + eps) return at(first, tv)
    if (tv >= last.a - eps) return at(last, tv)
    for (let i = 1; i < segs.length; i++) {
      const s = segs[i]!
      if (tv < s.a - eps) return inBreak(i)
      if (tv <= s.b + eps) return at(s, tv)
    }
    return Number.NaN
  }
  const scale = ((v: number) => place(v, () => Number.NaN)) as Scale
  scale.kind = tr.kind
  scale.transform = tr
  scale.domain = domain
  scale.range = r
  scale.edge = (v: number) => place(v, (i) => at(segs[i - 1]!, segs[i - 1]!.b))
  scale.invert = (p: number) => {
    const d = (p - r0) * dir
    if (d <= first.start + (first.b - first.a) * first.k)
      return tInv(first.a + (d - first.start) / first.k)
    for (let i = 1; i < segs.length; i++) {
      const s = segs[i]!
      if (d < s.start) return tInv(segs[i - 1]!.b) // inside a gap: the break's lower edge
      if (d <= s.start + (s.b - s.a) * s.k || i === segs.length - 1)
        return tInv(s.a + (d - s.start) / s.k)
    }
    return tInv(last.a + (d - last.start) / last.k)
  }
  scale.gaps = segs.slice(0, -1).map((s) => {
    const e0 = at(s, s.b)
    const e1 = e0 + dir * cuts[segs.indexOf(s)]!.gap
    return [Math.min(e0, e1), Math.max(e0, e1)]
  })
  scale.gaps.sort((p, q) => p[0] - q[0])
  scale.pieces = segs.map((s) => [tInv(s.a), tInv(s.b)])
  return scale
}

/** A "nice" step (1, 2, 2.5, 5 × 10ⁿ) giving about `target` intervals over the span. */
export function niceStep(span: number, target = 5): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1
  const raw = span / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const nice = norm < 1.5 ? 1 : norm < 2.25 ? 2 : norm < 3.5 ? 2.5 : norm < 7.5 ? 5 : 10
  return nice * mag
}

/**
 * The next nice step above `step` (1 → 2 → 2.5 → 5 → 10 × 10ⁿ): automatic ticks too crowded for
 * their labels take it.
 */
export function coarserStep(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 1
  const mag = 10 ** Math.floor(Math.log10(step) + 1e-9)
  const norm = step / mag
  const next = [2, 2.5, 5, 10].find((n) => n > norm * (1 + 1e-9)) ?? 20
  return next * mag
}

/** Rounds v to the step's precision so tick values print cleanly (0.30000000000000004 → 0.3). */
export function snap(v: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 2)
  if (decimals <= 15) return Number(v.toFixed(decimals))
  // Tiny steps: round to the same decimal place via significant digits (toFixed stops at 15).
  if (v === 0 || !Number.isFinite(v)) return v
  const digits = Math.floor(Math.log10(Math.abs(v))) + 1 + decimals
  return digits < 1 ? 0 : Number(v.toPrecision(Math.min(digits, 21)))
}

export interface LinearAxisDomain {
  min: number
  max: number
  ticks: number[]
  minorTicks: number[]
}

/**
 * Expands [lo, hi] to nice tick boundaries. Degenerate spans (single value) get a unit-ish range
 * around the value.
 */
export function niceLinearDomain(
  lo: number,
  hi: number,
  opts: { target?: number; interval?: number; step?: number; start?: number; minor?: number } = {},
): LinearAxisDomain {
  let a = lo
  let b = hi
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    a = 0
    b = 1
  }
  if (a === b) {
    const d = a === 0 ? 1 : Math.abs(a) * 0.1
    a -= d
    b += d
  }
  // `interval`: ticks every interval within [lo, hi], the range's ends kept as they are; `step`:
  // the range widened to it, as the automatic one (absent: a nice step for about `target`
  // intervals).
  const step = opts.interval ?? opts.step ?? niceStep(b - a, opts.target ?? 5)
  const min = opts.interval ? a : Math.floor(a / step + 1e-9) * step
  const max = opts.interval ? b : Math.ceil(b / step - 1e-9) * step
  const first = opts.start ?? Math.ceil(min / step - 1e-9) * step
  const ticks: number[] = []
  for (let v = first, i = 0; v <= max + step * 1e-9 && i < 1000; i++, v = first + i * step) {
    ticks.push(snap(v, step))
  }
  const minorTicks: number[] = []
  const minor = opts.minor ?? 0
  if (minor > 0) {
    const ms = step / (minor + 1)
    for (let v = first - step, i = 0; v <= max && i < 10000; i++, v = first - step + i * ms) {
      if (v >= min - 1e-12 && v <= max + 1e-12 && i % (minor + 1) !== 0)
        minorTicks.push(snap(v, ms))
    }
  }
  // Audit 2 (G3, decision 662): with an interval the ends are the range's own, unrounded —
  // snapping them to the step's precision cut off a point at the data's end.
  return opts.interval
    ? { min, max, ticks, minorTicks }
    : { min: snap(min, step), max: snap(max, step), ticks, minorTicks }
}

/** Decade ticks for log axes; domain expanded to whole powers of the base. */
export function niceLogDomain(lo: number, hi: number, base: 10 | 2): LinearAxisDomain {
  const log = base === 10 ? Math.log10 : Math.log2
  const a = lo > 0 && Number.isFinite(lo) ? lo : 1
  const b = hi > 0 && Number.isFinite(hi) ? hi : a * base
  let e0 = Math.floor(log(a) + 1e-9)
  let e1 = Math.ceil(log(b) - 1e-9)
  if (e0 === e1) {
    e0 -= 1
    e1 += 1
  }
  const ticks: number[] = []
  const minorTicks: number[] = []
  for (let e = e0; e <= e1; e++) {
    ticks.push(base ** e)
    if (base === 10 && e < e1) for (let m = 2; m <= 9; m++) minorTicks.push(m * 10 ** e)
  }
  return { min: base ** e0, max: base ** e1, ticks, minorTicks }
}
