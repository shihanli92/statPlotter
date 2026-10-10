import { type FontRegistry, presetGraph } from '@ps/graph'
import { createTable, type Project } from '@ps/model'
import { singleCellGraphs } from '../singleCell.ts'
import { axis, ExampleBuilder, rng, round, title, withLayer } from './builder.ts'

// A synthetic single-cell experiment (roadmap 34e): 30,000 T and NK cells from four donors, as a
// CSV export of Seurat would hold them — the donor, a cluster id (text, as Seurat writes it) and
// its cell type, a clustered UMAP, counts and ten marker genes, mostly zeros (dropouts) and
// log-normal where expressed. Simulated with a fixed seed.

const CELLS = 30_000

/** Clusters: their cell type, share of the cells, place and spread on the UMAP. */
const CLUSTERS = [
  { type: 'CD4 naive', share: 0.2, at: [-6, 2], sd: 1.4 },
  { type: 'CD4 memory', share: 0.16, at: [-3, 6], sd: 1.3 },
  { type: 'CD8 naive', share: 0.12, at: [4, 5], sd: 1.1 },
  { type: 'CD8 effector', share: 0.13, at: [7, 0], sd: 1.5 },
  { type: 'Treg', share: 0.06, at: [-8, 7], sd: 0.8 },
  { type: 'NK', share: 0.1, at: [8, -6], sd: 1.2 },
  { type: 'MAIT', share: 0.05, at: [2, -2], sd: 0.7 },
  { type: 'gamma-delta T', share: 0.05, at: [4, -8], sd: 0.8 },
  { type: 'Proliferating', share: 0.03, at: [-1, -7], sd: 0.9 },
  { type: 'CD4 memory', share: 0.1, at: [-5, -3], sd: 1.2 },
] as const

/** Marker genes: the clusters (by index) expressing each, and how much. */
const GENES: { name: string; on: number[] }[] = [
  { name: 'CD3E', on: [0, 1, 2, 3, 4, 6, 7, 8, 9] },
  { name: 'CD4', on: [0, 1, 4, 9] },
  { name: 'CD8A', on: [2, 3, 6] },
  { name: 'CCR7', on: [0, 2] },
  { name: 'IL7R', on: [0, 1, 6, 9] },
  { name: 'FOXP3', on: [4] },
  { name: 'GZMB', on: [3, 5, 7] },
  { name: 'GNLY', on: [5, 3, 7] },
  { name: 'NKG7', on: [3, 5, 6, 7] },
  { name: 'MKI67', on: [8] },
]

/** Donors and how their cells shift between clusters (the stimulated ones more effectors). */
const DONORS = ['Donor 1 ctrl', 'Donor 2 ctrl', 'Donor 3 stim', 'Donor 4 stim']

export function createSingleCellExample(fonts: FontRegistry): Project {
  const b = new ExampleBuilder('Single-cell T cells (synthetic)', fonts)
  const r = rng(3434)
  const cum: number[] = []
  let acc = 0
  for (const c of CLUSTERS) {
    acc += c.share
    cum.push(acc)
  }
  const cols: Record<string, (number | null)[] | (string | null)[]> = {
    sample: [],
    seurat_clusters: [],
    cell_type: [],
    UMAP_1: [],
    UMAP_2: [],
    nCount_RNA: [],
    'percent.mt': [],
    ...Object.fromEntries(GENES.map((g) => [g.name, []])),
  }
  const push = (k: string, v: number | string | null) =>
    (cols[k] as (number | string | null)[]).push(v)
  for (let i = 0; i < CELLS; i++) {
    const d = Math.floor(r.uniform() * DONORS.length)
    // Stimulated donors: a third of their naive cells became effectors.
    const u = r.uniform() * acc
    let c = Math.max(
      0,
      cum.findIndex((x) => u < x),
    )
    if (d >= 2 && (c === 0 || c === 2) && r.uniform() < 0.33) c = 3
    const k = CLUSTERS[c]!
    push('sample', DONORS[d]!)
    push('seurat_clusters', String(c))
    push('cell_type', k.type)
    push('UMAP_1', round(k.at[0] + r.normal(0, k.sd), 3))
    push('UMAP_2', round(k.at[1] + r.normal(0, k.sd), 3))
    const count = Math.round(r.lognormal(8, 0.4))
    push('nCount_RNA', count)
    push('percent.mt', r.uniform() < 0.005 ? null : round(Math.abs(r.normal(4, 1.5)), 2))
    for (const g of GENES) {
      const on = g.on.includes(c)
      const p = on ? 0.75 : 0.04
      push(g.name, r.uniform() < p ? round(r.lognormal(on ? 0.9 : -0.5, 0.45), 2) : 0)
    }
  }
  const titles = Object.keys(cols)
  const table = createTable({
    name: 'T cells',
    tableKind: 'multipleVariables',
    columns: titles.length,
    rows: CELLS,
  })
  titles.forEach((title, i) => {
    const ds = table.dataSets[i]!
    ds.title = title
    const values = cols[title]!
    if (typeof values[0] === 'string') ds.text = values as (string | null)[]
    else ds.subcolumns[0]!.values = values as (number | null)[]
  })
  table.notes = [
    `${CELLS.toLocaleString('en-US')} simulated T and NK cells from four donors, laid out as a CSV export of Seurat would hold them: the donor (sample), a cluster id (seurat_clusters, text: an id, not a quantity) and its cell type, a clustered UMAP embedding, counts, the mitochondrial fraction and ten marker genes (mostly zeros, log-normal where expressed).`,
    'The UMAPs draw their points as an image on screen (Format › Layers › Many points); exports draw them as vectors unless Export… is asked for points as an image. The feature plot draws the cells expressing most last, on top; the cluster names sit at each cluster’s median position.',
    'One graph per sample: the cell types of each donor on a page of linked graphs. Stimulated donors have more CD8 effector cells.',
    'The dot plot shows the marker genes by cluster: each dot sized by the percent of the cells expressing the gene, coloured by its average scaled across the clusters (as Seurat’s DotPlot); the hexbin plot counts the cells over the UMAP.',
  ].join(' ')
  b.table(table)
  const k = (title: string) => b.key(table, title)
  singleCellGraphs(b, table, {
    umap1: k('UMAP_1'),
    umap2: k('UMAP_2'),
    cluster: k('seurat_clusters'),
    sample: k('sample'),
    type: k('cell_type'),
    gene: k('GNLY'),
    geneTitle: 'GNLY',
  })
  // Roadmap 34g: the marker genes by cluster as a dot plot, and the cells' density on the UMAP.
  // (The preset groups by the clusters: the variable named like them.)
  const dots = presetGraph(table, 'dotPlot', 'Marker genes by cluster')
  b.add({
    ...dots,
    title: title('Marker genes'),
    levelOrder: 'natural',
    seriesSource: { ...dots.seriesSource, include: GENES.map((g) => k(g.name)) },
  })
  const hex = presetGraph(table, 'density', 'UMAP: density of cells')
  b.add({
    ...withLayer(hex, 'points', (l) => ({ ...l, aes: { x: k('UMAP_1'), y: k('UMAP_2') } })),
    title: title('Density of cells'),
    size: { ...hex.size, plotWidth: 200, plotHeight: 200 },
    axes: {
      ...hex.axes,
      x: axis(hex.axes.x, { title: title('UMAP 1') }),
      y: axis(hex.axes.y, { title: title('UMAP 2') }),
    },
    legend: { ...hex.legend, show: true },
  })
  return b.project
}
