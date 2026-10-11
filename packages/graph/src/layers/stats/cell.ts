import type { GraphNode, HeatmapStyle, LayerOf, Project, ResultLookup, RichText } from '@ps/model'
import { type ClusterLinkage, type HClust, hclust, rowDistances, zScores } from '@ps/stats'
import { cellStats, type GraphSeries, resolveSeries, rowTitleOf, tableRow } from '../../data.ts'

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

/** The values of a matrix's columns (each a data set's values down the rows). */
export const columnsOf = (values: readonly (readonly number[])[], nc: number): number[][] =>
  Array.from({ length: nc }, (_, j) => values.map((v) => v[j]!))

/** The name of a matrix's row (its row title, else "Row n"), by its index into `data.rows`. */
export const rowName = (data: HeatmapData, i: number): string | RichText => {
  const s = data.series[0]!
  return rowTitleOf(s, data.rows[i]!) ?? `Row ${tableRow(s, data.rows[i]!) + 1}`
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

/**
 * Roadmap 49c: the tree a dendrogram layer draws, as the matrix frame clusters it — the heat map's
 * clustering of its axis (on the values shown: z-scores when the tiles standardize) when its tiles
 * cluster that axis, else the layer's own of the values as entered — or null when the axis can't
 * be clustered. For the Format view (the heights a cut is at, the clusters' count).
 */
export function treeOfLayer(
  project: Project,
  graph: GraphNode,
  layer: LayerOf<'dendrogram'>,
  result?: ResultLookup,
): HClust | null {
  const data = heatmapData(project, graph, result)
  const tile = graph.layers.find(
    (l): l is LayerOf<'tile'> => l.geom === 'tile' && l.visible !== false,
  )
  const by = tile?.stat.kind === 'cell' ? (tile.stat.standardize ?? 'none') : 'none'
  const values = by === 'none' ? data.values : zScores(data.values, by)
  const of = layer.stat.of
  const items = of === 'rows' ? values : columnsOf(values, data.series.length)
  const cluster = tile?.style?.cluster
  return clusterOrder(items, cluster?.[of] ? cluster : layer.stat, of, [])
}
