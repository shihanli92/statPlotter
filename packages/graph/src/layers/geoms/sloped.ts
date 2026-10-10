import type { ResultStat } from '@ps/model'
import { clipPolyline } from '../../layout/common.ts'
import type { Scale } from '../../scale.ts'

// Roadmap 46b: reference lines y = a·x + b (an identity line, y = x) across a plot of two
// continuous axes, edge to edge. A line is drawn where it is on both axes: over each visible piece
// of the X axis (axis breaks cut it), where its Y is inside a visible piece of the Y axis — so it
// stops at the plot's edges and at breaks, never reaching outside the plot, and a line missing the
// plot draws nothing. Straight where both axes are linear (or both log and b = 0: log y = log a +
// log x); sampled along X (evenly in the axis' transformed units) where the axes bend it.

type Pt = [number, number]

/** Points along a bent line per stretch between the plot's edges and breaks. */
export const SLOPED_SAMPLES = 64

/** A scale's visible data intervals, ascending (its pieces between breaks, else its domain). */
const visible = (s: Scale): [number, number][] =>
  s.pieces?.length
    ? s.pieces.map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number])
    : [[Math.min(...s.domain), Math.max(...s.domain)]]

/** Whether y = a·x + b is a straight line on these axes. */
const straight = (u: Scale, v: Scale, b: number) =>
  (u.transform.kind === 'linear' && v.transform.kind === 'linear') ||
  (u.transform.positive && v.transform.positive && b === 0)

/**
 * The X intervals over which y = a·x + b is inside the plot: each visible X piece cut to where
 * the line's Y is in a visible Y piece. Ascending; none for a line off the plot (or not finite).
 */
export function slopedSpans(u: Scale, v: Scale, a: number, b: number): [number, number][] {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return []
  const out: [number, number][] = []
  for (const [y0, y1] of visible(v)) {
    let lo: number
    let hi: number
    if (a === 0) {
      if (b < y0 || b > y1) continue
      lo = Number.NEGATIVE_INFINITY
      hi = Number.POSITIVE_INFINITY
    } else {
      const p = (y0 - b) / a
      const q = (y1 - b) / a
      lo = Math.min(p, q)
      hi = Math.max(p, q)
    }
    for (const [x0, x1] of visible(u)) {
      const s = Math.max(lo, x0)
      const e = Math.min(hi, x1)
      if (s < e) out.push([s, e])
    }
  }
  return out.sort((p, q) => p[0] - q[0])
}

/**
 * The polylines (plot-local points) of y = a·x + b on a plot `W` × `H` with these scales: one run
 * per stretch between the plot's edges and the axes' breaks, clipped to the plot.
 */
export function slopedRuns(
  u: Scale,
  v: Scale,
  a: number,
  b: number,
  W: number,
  H: number,
  samples = SLOPED_SAMPLES,
): Pt[][] {
  const flat = straight(u, v, b)
  const out: Pt[][] = []
  for (const [s, e] of slopedSpans(u, v, a, b)) {
    let xs: number[]
    if (flat) xs = [s, e]
    else {
      const [t0, t1] = [u.transform.forward(s), u.transform.forward(e)]
      xs = Array.from({ length: samples + 1 }, (_, k) =>
        k === 0 ? s : k === samples ? e : u.transform.inverse(t0 + ((t1 - t0) * k) / samples),
      )
    }
    const pts = xs.map((x): Pt => [u(x), v(a * x + b)])
    out.push(...clipPolyline(pts, W, H))
  }
  return out
}

/** A number as an equation shows it: up to 4 significant digits, a true minus. */
const num = (v: number) => String(Number(v.toPrecision(4))).replace('-', '−')

/** The equation of y = a·x + b as text: "y = x", "y = 2x + 1", "y = −0.5x − 3", "y = 4". */
export function lineEquation(a: number, b: number): string {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'y = a·x + b'
  const x = a === 0 ? '' : a === 1 ? 'x' : a === -1 ? '−x' : `${num(a)}x`
  if (!x) return `y = ${num(b)}`
  if (b === 0) return `y = ${x}`
  return `y = ${x} ${b < 0 ? '−' : '+'} ${num(Math.abs(b))}`
}

/** A sloped reference line's typed slope and intercept (null when a field isn't a number). */
export function slopedValues(stat: ResultStat): { a: number; b: number } | null {
  const typed = (name: string | undefined, absent: number | null) => {
    if (name === undefined) return absent
    const ref = stat.fields[name]?.ref
    return ref?.from === 'number' ? ref.v : null
  }
  const a = typed(stat.slope, null)
  const b = typed(stat.intercept, 0)
  return a === null || b === null ? null : { a, b }
}
