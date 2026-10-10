import type { GraphNode, HeatmapStyle, Project, ResultLookup } from '@ps/model'
import { type ClusterLinkage, type HClust, hclust, rowDistances } from '@ps/stats'
import { cellStats, type GraphSeries, resolveSeries } from '../../data.ts'

// The `cell` stat (heat maps): a value per row × data set (the mean of a cell's replicates),
// optionally z-scored, with rows and columns ordered by hierarchical clustering (R's hclust,
// `@ps/stats`, oracle suite `cluster`).

/** Most rows (or columns) clustered; beyond, the table's order is kept (with a warning). */
export const MAX_CLUSTERED = 2000

/** A heat map's values: shown table rows × data sets (NaN = no value), with their labels. */
export interface HeatmapData {
  series: GraphSeries[]
  /** Rows (of the possibly sliced data sets) with any value, in table order. */
  rows: number[]
  /** values[i][j]: row rows[i] of data set j (the mean of its replicates). */
  values: number[][]
}

export function heatmapData(
  project: Project,
  graph: Pick<GraphNode, 'seriesSource'>,
  result?: ResultLookup,
): HeatmapData {
  const series = resolveSeries(project, graph, result)
  const count = series[0]?.ds.rowCount ?? 0
  const all = Array.from({ length: count }, (_, r) =>
    series.map((s) => {
      const c = cellStats(s.ds, r)
      return c.n > 0 || !c.raw ? c.mean : Number.NaN
    }),
  )
  const rows = all.flatMap((v, r) => (v.some(Number.isFinite) ? [r] : []))
  return { series, rows, values: rows.map((r) => all[r]!) }
}

/**
 * The order of a matrix's rows by hierarchical clustering (and the clustering), or null with a
 * warning when it can't be done (a distance undefined, too many rows).
 */
export function clusterOrder(
  rows: readonly (readonly number[])[],
  h: Pick<HeatmapStyle, 'distance' | 'linkage'>,
  what: 'rows' | 'columns',
  warnings: string[],
): HClust | null {
  if (rows.length < 2) return null
  if (rows.length > MAX_CLUSTERED) {
    warnings.push(`Only up to ${MAX_CLUSTERED} ${what} are clustered; they keep their order.`)
    return null
  }
  const d = rowDistances(rows, h.distance ?? 'euclidean')
  if (!d.every(Number.isFinite)) {
    warnings.push(
      `The ${what} can’t be clustered: some share too few values${h.distance === 'pearson' ? ' or have no variation' : ''}.`,
    )
    return null
  }
  return hclust(d, rows.length, (h.linkage ?? 'complete') as ClusterLinkage)
}
