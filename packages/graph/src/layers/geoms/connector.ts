import type { GraphSeries, PlotPoint, PlotStats } from '../../data.ts'
import { tableRow } from '../../data.ts'
import { clipPolyline, type ValueAxis } from '../../layout/common.ts'
import type { SceneNode, Stroke } from '../../scene.ts'

// Connectors (before-after): each table row's values joined across the data sets; on grouped
// graphs (roadmap 34c, pair lines) each subject's values — one replicate of a row — joined across
// the data sets within the row.

/** Before-after lines: each table row's points joined across the data sets (plot-local). */
export function pairLines(
  series: readonly { s: GraphSeries; stats: PlotStats }[],
  /** Where data set `i`'s point of subject `row` sits across its category (plot-local). */
  x: (i: number, row: number | string) => number,
  Y: ValueAxis,
  W: number,
  H: number,
  stroke: Stroke,
  /** The id part of the lines (`pairs`, with `@<layer>` if repeated). */
  part = 'pairs',
  /** A point's subject (absent: its table row; grouped graphs: the row and replicate). */
  subjectOf?: (s: GraphSeries, pt: PlotPoint) => string,
  /** The subjects joined (absent: all); on screen, those whose points are drawn (decision 450). */
  keep?: (subject: number | string) => boolean,
): SceneNode[] {
  const connectors: SceneNode[] = []
  const byRow = new Map<number | string, [number, number][]>()
  series.forEach((p, i) => {
    for (const pt of p.stats.points) {
      if (!Y.ok(pt.value)) continue
      // Keyed by table row: in a row slice, `pt.row` is the position in the slice.
      const row = subjectOf ? subjectOf(p.s, pt) : tableRow(p.s, pt.row)
      const list = byRow.get(row) ?? []
      list.push([x(i, row), Y.scale(pt.value)])
      byRow.set(row, list)
    }
  })
  const inside = ([px, py]: [number, number]) => px >= 0 && px <= W && py >= 0 && py <= H
  for (const [row, points] of byRow) {
    if (points.length < 2 || (keep && !keep(row))) continue
    if (points.every(inside)) {
      connectors.push({
        id: `${part}/${row}`,
        target: ['style'],
        prim: { type: 'polyline', points, stroke },
      })
    } else {
      clipPolyline(points, W, H).forEach((run, k) => {
        connectors.push({
          id: `${part}/${row}/${k}`,
          target: ['style'],
          prim: { type: 'polyline', points: run, stroke },
        })
      })
    }
  }
  return connectors
}

/** A grouped point's subject: its table row and replicate (pair lines join them, 34c). */
export const subjectOf = (pt: PlotPoint, tableRowOf: number, own: boolean): string =>
  own ? `${pt.row}` : `${tableRowOf}-${pt.sub ?? 0}`
