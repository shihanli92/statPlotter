import { mergeRuns, type PieStyle, type RichText } from '@ps/model'
import { decimalsFor, formatNumber } from '../../format.ts'
import type { Part } from '../stats/fraction.ts'

// Wedges (pie and donut slices) and the labels of parts of a whole.

/** Pie options as the drawing reads them, with defaults. */
export interface ResolvedPieStyle {
  hole: number
  startAngle: number
  clockwise: boolean
  labels: NonNullable<PieStyle['labels']>
  labelPosition: 'inside' | 'outside'
  digits: number
}

/** Degrees clockwise from 12 o'clock → a point at radius r from (cx, cy). */
export const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const t = (deg * Math.PI) / 180
  return [cx + r * Math.sin(t), cy - r * Math.cos(t)]
}

/**
 * A wedge (pie slice) or annular sector (donut slice) between two angles (degrees clockwise from
 * 12 o'clock, a0 < a1), its arcs sampled at most every 2°.
 */
export function wedgePoints(
  cx: number,
  cy: number,
  r: number,
  inner: number,
  a0: number,
  a1: number,
): [number, number][] {
  const steps = Math.max(1, Math.ceil((a1 - a0) / 2))
  const arc = (radius: number) =>
    Array.from({ length: steps + 1 }, (_, i) => polar(cx, cy, radius, a0 + ((a1 - a0) * i) / steps))
  const outer = arc(r)
  if (inner > 0) return [...outer, ...arc(inner).reverse()]
  return a1 - a0 >= 360 - 1e-9 ? outer : [[cx, cy], ...outer]
}

/** Black or white, whichever reads better on the colour. */
export function contrast(color: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16) / 255)
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  return lum > 0.55 ? '#000000' : '#ffffff'
}

/** The text of a part's label. */
export function partLabel(
  p: Part,
  pie: Pick<ResolvedPieStyle, 'labels' | 'digits'>,
): RichText | null {
  const pct = `${formatNumber(p.fraction * 100, { mode: 'fixed', digits: pie.digits })[0]!.text}%`
  const value = formatNumber(p.value, { mode: 'auto' }, { decimals: decimalsFor([p.value]) })[0]!
    .text
  switch (pie.labels) {
    case 'none':
      return null
    case 'percent':
      return [{ text: pct }]
    case 'value':
      return [{ text: value }]
    case 'category':
      return p.rich
    case 'categoryPercent':
      return mergeRuns([...p.rich, { text: ` (${pct})` }])
    case 'valuePercent':
      return [{ text: `${value} (${pct})` }]
  }
}
