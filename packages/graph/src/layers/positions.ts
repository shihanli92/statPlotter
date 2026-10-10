import type { Position } from '@ps/model'
import { centerOf, type PlotStats } from '../data.ts'
import type { ResolvedSeriesStyle } from '../theme.ts'

// Positions within a slot: dodge (side by side), aligned (at the slot's centre) and stack.

/** Fraction of each row's slot a cluster of data sets fills (without a graph categoryGap). */
export const GROUP_FILL = 0.8

/** A grouped frame's slots for one position: x of (row, data set) and the width each gets. */
export function groupedSlots(
  position: Position | undefined,
  rows: number,
  series: number,
  W: number,
  categoryGap: number | undefined,
) {
  const groupW = W / Math.max(rows, 1)
  const fill = categoryGap === undefined ? GROUP_FILL : 1 / (1 + categoryGap)
  // Aligned: every data set at the row's centre (rows as time points), each using the full width.
  const aligned = position?.kind === 'aligned' || position?.kind === 'stack'
  const sub = aligned ? groupW * fill : (groupW * fill) / Math.max(series, 1)
  const groupCenter = (gi: number) => (gi + 0.5) * groupW
  const cx = (gi: number, si: number) =>
    aligned ? groupCenter(gi) : groupCenter(gi) - (groupW * fill) / 2 + (si + 0.5) * sub
  return { sub, cx }
}

/**
 * One cell's segment of a stacked bar: from `start` to `end` (values, or percents of the row's
 * total), `k` the factor its values were scaled by (100 / total for percents, else 1), and
 * whether its start and end touch another segment (where a gap between segments goes).
 */
export interface StackSegment {
  start: number
  end: number
  k: number
  joined: [boolean, boolean]
}

/**
 * Stacked XY areas (roadmap 33d): at every X any data set has, each data set's value piled on
 * those before it (data set order; a data set without a value there adds nothing). `at[d][i]`:
 * the top of data set d at `xs[i]`, its base the previous data set's top (the first's: `base`).
 */
export function stackAreas(
  series: readonly { rows: readonly { x: number; value: number }[] }[],
  base: number,
): { xs: number[]; at: number[][] } {
  const xs = [
    ...new Set(
      series.flatMap((p) => p.rows.filter((r) => Number.isFinite(r.value)).map((r) => r.x)),
    ),
  ]
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  let below = xs.map(() => base)
  const at = series.map((p) => {
    const own = new Map<number, number>()
    for (const r of p.rows) if (Number.isFinite(r.value) && !own.has(r.x)) own.set(r.x, r.value)
    below = xs.map((x, i) => below[i]! + (own.get(x) ?? 0))
    return below
  })
  return { xs, at }
}

/**
 * Stacked grouped bars (roadmap 30): each row's cells piled up in data set order, positive
 * centres upwards from 0 and negative ones downwards; with `percent`, as percents of the row's
 * total (the sum of the centres' sizes). Per data set, a segment per row (null: no centre).
 */
export function stackCells(
  d: { series: readonly { cells: PlotStats[]; style: Pick<ResolvedSeriesStyle, 'center'> }[] },
  percent: boolean,
): (StackSegment | null)[][] {
  const out = d.series.map((p) => p.cells.map((): StackSegment | null => null))
  const rows = d.series[0]?.cells.length ?? 0
  for (let r = 0; r < rows; r++) {
    const centers = d.series.map((p) => centerOf(p.cells[r]!, p.style.center.stat))
    const total = centers.reduce((a, c) => a + (Number.isFinite(c) ? Math.abs(c) : 0), 0)
    const k = percent ? (total > 0 ? 100 / total : Number.NaN) : 1
    const drawn = centers.map((c) => Number.isFinite(c * k) && c !== 0)
    for (const sign of [1, -1]) {
      const members = centers.flatMap((c, i) => (drawn[i] && Math.sign(c) === sign ? [i] : []))
      let at = 0
      members.forEach((i, m) => {
        const end = at + centers[i]! * k
        out[i]![r] = { start: at, end, k, joined: [m > 0, m < members.length - 1] }
        at = end
      })
    }
  }
  return out
}
