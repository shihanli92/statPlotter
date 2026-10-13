import type { SketchPanel } from '@ps/model'
import { equationMeta } from '../explain/equations.ts'
import { resolveEquation } from '../nonlinear.ts'
import { pointsTable } from './xy.ts'

// Roadmap 51e (design §9.1, U10): a model's thumbnail in the curve-fit picker — its curve at
// typical values (the equation's metadata), the plateaus and the midpoint as dashed lines with
// their names (Top, Bottom, EC50), no axis numbers: the shape of the model, drawn by @ps/graph
// like the live sketch (`sketchGraph`), never a fit and never a value.

/** The thumbnail's plot size, in points. */
export const THUMBNAIL_PLOT = { width: 112, height: 56 } as const

/** Points across a typical X range (by ratio for a log range). */
function xsOf(lo: number, hi: number, log: boolean, n = 48): number[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    return log ? lo * (hi / lo) ** t : lo + (hi - lo) * t
  })
}

/** The midpoint's name for a label ("EC50" for LogEC50). */
const plainName = (n: string) => n.replace(/^Log/i, '')

/** A built-in model's thumbnail, or null (a user-defined equation, or no finite curve). */
export function modelThumbnail(id: string): SketchPanel | null {
  const meta = equationMeta(id)
  const r = resolveEquation({ equation: id, userEquation: '', initialValues: {} })
  if (!meta || !r.ok) return null
  const { x, spacing, p } = meta.typical
  const log = spacing === 'log'
  const model = r.model
  const points = xsOf(x[0], x[1], log)
    .map((v) => ({ x: v, y: model.f(v, p) }))
    .filter((q) => Number.isFinite(q.y))
  if (points.length < 2) return null
  const lines: { at: number; axis: 'x' | 'y'; dashed: true }[] = []
  const labels: { x: number; y: number; text: string }[] = []
  const at = (k: string) => p[model.params.indexOf(k)]
  const first = points[0]!
  const last = points[points.length - 1]!
  const rises = last.y >= first.y
  // A label a little in from an end of X (by ratio on a log axis).
  const inset = (fraction: number) =>
    log ? x[0] * (x[1] / x[0]) ** fraction : x[0] + (x[1] - x[0]) * fraction
  for (const name of [meta.top, meta.bottom]) {
    if (!name) continue
    const v = at(name)
    if (v === undefined || !Number.isFinite(v)) continue
    lines.push({ at: v, axis: 'y', dashed: true })
    const high = name === meta.top
    // A text's anchor is its top left: the lower plateau's name goes above its line.
    const lift = high
      ? 0
      : 0.18 * (Math.max(...points.map((q) => q.y)) - Math.min(...points.map((q) => q.y)))
    labels.push({ x: inset(high === rises ? 0.04 : 0.62), y: v + lift, text: name })
  }
  if (meta.midpoint) {
    const v = at(meta.midpoint)
    if (v !== undefined && Number.isFinite(v) && v > x[0] && v < x[1]) {
      lines.push({ at: v, axis: 'x', dashed: true })
      labels.push({ x: v, y: model.f(v, p), text: plainName(meta.midpoint) })
    }
  }
  return {
    id: `thumb-${id}`,
    table: pointsTable(`thumb${id}`, [{ key: 'shape', title: model.name, points }], 'X'),
    preset: 'each',
    lineSets: ['shape'],
    ...(lines.length ? { lines } : {}),
    ...(labels.length ? { labels } : {}),
    axes: { bare: true, ...(log ? { xLog: true } : {}) },
  }
}
