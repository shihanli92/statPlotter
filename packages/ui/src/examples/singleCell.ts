import { presetGraph } from '@ps/graph'
import type { DataTable, GraphNode, Layer } from '@ps/model'
import { splitSet } from '../graph/split.ts'
import { addLayer, axis, type ExampleBuilder, title, withLayer } from './synthetic/builder.ts'

// The graphs of a single-cell table (roadmap 34e), shared by the synthetic example and the one
// built from the user's local export: a UMAP coloured by cluster with each cluster's name at its
// centre, a feature plot (a gene, highest values on top), the UMAP by sample, a gene's violins by
// cluster, the UMAP split one graph per sample on a linked page, and a figure page. The UMAPs draw
// their points as an image on screen (`render: 'image'`); exports draw vectors. Their levels are
// in natural order (roadmap 34f: clusters 0, 1, 2 … 10, samples S1 … S6), as new graphs' are; the
// UMAPs' axes are corner arrows (roadmap 36).

/** The variables the graphs use (data set keys), and the gene's name. */
interface CellVariables {
  umap1: string
  umap2: string
  cluster: string
  sample: string
  /** A cell type variable (the split UMAP's colours; else the clusters). */
  type?: string
  gene: string
  geneTitle: string
}

/** A UMAP of the cells (square, small points as an image) with these variables mapped. */
function umap(
  t: DataTable,
  v: CellVariables,
  name: string,
  heading: string,
  aes: NonNullable<Layer['aes']>,
  points: object = {},
): GraphNode {
  let g = presetGraph(t, 'bubble', name)
  g = withLayer(g, 'bubbles', (l) => ({
    ...l,
    aes: { x: v.umap1, y: v.umap2, ...aes },
    style: { ...l.style, render: 'image', ...points },
  }))
  return {
    ...g,
    levelOrder: 'natural',
    title: title(heading),
    size: { ...g.size, plotWidth: 200, plotHeight: 200 },
    // Roadmap 36: UMAP-style corner arrows in place of the axes.
    style: { ...g.style, frame: 'arrows' },
    axes: {
      ...g.axes,
      x: axis(g.axes.x, { title: title('UMAP 1') }),
      y: axis(g.axes.y, { title: title('UMAP 2') }),
    },
    legend: { ...g.legend, show: true },
  }
}

/** Adds the single-cell graphs and pages of table `t` to the example. */
export function singleCellGraphs(b: ExampleBuilder, t: DataTable, v: CellVariables): void {
  // Clusters, named at their centres (a halo round each name); the names make the legend
  // unnecessary.
  const clusters = umap(t, v, 'UMAP by cluster', 'Clusters', { color: v.cluster })
  const byCluster = b.add(
    addLayer(
      { ...clusters, legend: { ...clusters.legend, show: false } },
      { id: 'names', geom: 'label', stat: { kind: 'centroid' } },
    ),
  )
  // A feature plot: the gene on viridis, the cells expressing most drawn last (on top).
  const feature = b.add({
    ...umap(t, v, `UMAP: ${v.geneTitle}`, v.geneTitle, { color: v.gene }, { order: 'value' }),
    scales: { color: { colors: 'viridis', bar: { show: true } } },
  })
  const bySample = b.add(umap(t, v, 'UMAP by sample', 'Samples', { color: v.sample }))
  // The gene's distribution in each cluster.
  const violins = b.add({
    ...presetGraph(t, 'violinBox', `${v.geneTitle} by cluster`, {
      mapping: { x: v.cluster, y: v.gene },
    }),
    title: title(`${v.geneTitle} by cluster`),
    levelOrder: 'natural',
  })
  b.layout('Figure: clusters, a gene and the samples', [byCluster, feature, bySample, violins], {
    columns: 2,
  })

  // One graph per sample (roadmap 34d), coloured by cell type, on a linked page.
  const base = b.add(
    umap(t, v, v.type ? 'UMAP by cell type' : 'UMAP by cluster (per sample)', 'Cell types', {
      color: v.type ?? v.cluster,
    }),
  )
  const set = splitSet(b.project, b.fonts, t, base, {
    by: 'level',
    variable: v.sample,
    pageSize: 'letter',
  })
  if (set) {
    for (const g of set.graphs) b.add(g)
    b.add(set.layout)
  }
}
