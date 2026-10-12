import {
  type DataTable,
  formatNumber as formatSig,
  type GraphNode,
  type LayerOf,
  type NodeId,
  normalizeDataSet,
  type Project,
  parsePointKey,
  primaryValues,
  type ResultLookup,
  seriesShown,
  sourceTable,
  statOf,
} from '@ps/model'
import {
  boxStats,
  centerOf,
  type GraphSeries,
  MAD_TO_SD,
  type PlotStats,
  plotStats,
  resolveSeries,
  seriesCellStats,
} from './data.ts'
import { binRows, histogramTransform } from './layers/stats/bin.ts'
import { isMapped, mappedVariables } from './mapped.ts'
import type { SceneNode } from './scene.ts'

// Hovering a mark (roadmap 34d, decision 386): what a hover card says about it. A single value
// (a point, a value label, a heat map's cell) shows its whole table row — every variable of a
// multiple-variables table, else the row's title, X, the value and its replicate; a summary
// (a bar, a mean's line or symbol, an error bar, a box, a violin) shows the statistics the
// graph draws (its centre, its error and n). `goTo` is where "Go to row" opens the table.

/** One line of a hover card. */
export interface HoverLine {
  label: string
  value: string
}

/** What a hover card shows about a mark. */
export interface MarkInfo {
  /** The card's heading: the row (a single value) or the data set and category (a summary). */
  title: string
  lines: HoverLine[]
  /** The table row the mark is (or, for a cell's summary, starts at), and its cell. */
  goTo?: {
    table: NodeId
    row: number
    /** Tables other than multiple variables: the data set and replicate of the value. */
    column?: string
    sub?: number
  }
}

/** The layer and data set (series key) of a mark of a laid-out graph, from its target. */
export function markSeries(node: Pick<SceneNode, 'target'>): { layer: string; key: string } | null {
  const t = node.target
  if (t?.[0] === 'layers' && t[2] === 'series' && t.length >= 4)
    return { layer: String(t[1]), key: String(t[3]) }
  if (t?.[0] === 'pointLabel' && t.length >= 3) return { layer: '', key: String(t[1]) }
  return null
}

/** A value as the table shows it: entered numbers in full. */
const shown = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : String(v)
const sig = (v: number): string => formatSig(v, 4)

/** A row's title: its title in the table, else "Row n". */
const rowName = (table: Pick<DataTable, 'rowTitles'>, row: number) =>
  table.rowTitles?.[row] || `Row ${row + 1}`

/** Every variable of a multiple-variables table's row (calculated ones computed). */
function rowOfVariables(table: DataTable, row: number): HoverLine[] {
  return table.dataSets.map((d) => {
    const label = d.title || '(untitled)'
    const excluded = d.subcolumns[0]?.excluded?.[row] ? ' (excluded)' : ''
    if (d.text) return { label, value: `${d.text[row]?.trim() || '—'}${excluded}` }
    const value =
      d.formula !== undefined
        ? (() => {
            const v = primaryValues(normalizeDataSet(table, d))[row]
            return v === undefined || !Number.isFinite(v) ? '—' : String(Number(v.toPrecision(6)))
          })()
        : shown(d.subcolumns[0]?.values[row])
    return { label, value: `${value}${excluded}` }
  })
}

/** Lines of the statistics a summary mark draws, by its layer's stat. */
function summaryLines(stats: PlotStats, stat: ReturnType<typeof statOf>): HoverLine[] {
  const n = { label: 'n', value: String(stats.n) }
  switch (stat.kind) {
    case 'summary': {
      const center = centerOf(stats, stat.center)
      const name = { mean: 'Mean', median: 'Median', geomean: 'Geometric mean' }[stat.center]
      const out: HoverLine[] = [{ label: name, value: sig(center) }]
      const spread: Partial<Record<string, [string, number]>> = {
        SD: ['SD', stats.sd],
        SEM: ['SEM', stats.sem],
        CI: ['95% CI', Number.NaN],
        MAD: ['MAD', stats.mad],
        MADn: ['MADn', stats.mad * MAD_TO_SD],
        IQR: ['IQR', stats.q3 - stats.q1],
      }
      if (stat.error === 'geoCI' && Number.isFinite(stats.gciLo))
        out.push({ label: '95% CI', value: `${sig(stats.gciLo)} to ${sig(stats.gciHi)}` })
      else if (stat.error === 'geoSD' && Number.isFinite(stats.gsdf))
        out.push({ label: 'Geometric SD factor', value: sig(stats.gsdf) })
      else if (stat.error === 'CI' && Number.isFinite(stats.ciLo))
        out.push({ label: '95% CI', value: `${sig(stats.ciLo)} to ${sig(stats.ciHi)}` })
      else if (stat.error === 'range' && Number.isFinite(stats.min))
        out.push({ label: 'Range', value: `${sig(stats.min)} to ${sig(stats.max)}` })
      else if (stat.error && spread[stat.error] && Number.isFinite(spread[stat.error]![1]))
        out.push({ label: spread[stat.error]![0], value: sig(spread[stat.error]![1]) })
      return [...out, n]
    }
    case 'boxplot': {
      const b = boxStats(stats, stat.whiskers)
      if (!b) return [n]
      return [
        { label: 'Median', value: sig(b.median) },
        { label: 'Quartiles', value: `${sig(b.q1)} to ${sig(b.q3)}` },
        { label: 'Whiskers', value: `${sig(b.whiskerLo)} to ${sig(b.whiskerHi)}` },
        n,
      ]
    }
    case 'range':
      return [
        { label: 'Minimum', value: sig(stats.min) },
        { label: 'Maximum', value: sig(stats.max) },
        n,
      ]
    case 'density':
      return [
        { label: 'Median', value: sig(stats.median) },
        { label: 'Mean', value: sig(stats.mean) },
        n,
      ]
    default:
      return [{ label: 'Mean', value: sig(stats.mean) }, n]
  }
}

/**
 * What a hover card says about a mark of `graph`'s scene (see the module comment); null for marks
 * of no data set's value (axes, text, curves of analyses, functions).
 */
export function markInfo(
  project: Project,
  graph: GraphNode,
  node: Pick<SceneNode, 'target' | 'point' | 'tree'>,
  result?: ResultLookup,
): MarkInfo | null {
  if (node.tree) return treeInfo(graph, node)
  const mark = markSeries(node)
  if (!mark) return null
  const table = sourceTable(project, graph.seriesSource.table, result)
  if (!table) return null
  const series = resolveSeries(project, graph, result).find((s) => s.key === mark.key)
  if (!series) return null
  const layer =
    graph.layers.find((l) => l.id === mark.layer) ??
    // A point label: the layer of the values it labels.
    graph.layers.find((l) => l.geom === 'points')
  if (!layer || (layer.data && layer.data.from !== 'table' && layer.data.from !== 'layer'))
    return null
  const point = node.point === undefined ? null : parsePointKey(node.point)
  const editable = nodeIsTable(project, graph.seriesSource.table)
  const at = (row: number, more: Partial<NonNullable<MarkInfo['goTo']>> = {}) =>
    editable ? { goTo: { table: table.id, row, ...more } } : {}
  const own = statOf(layer, mark.key)
  // A group's name at its centre (roadmap 34e) stands for no value of its own; nor do 34g's
  // hexagons, density contours and images, and a dot plot's dots and tiles (no card yet).
  if (['centroid', 'hexbin', 'density2d', 'dotplot'].includes(own.kind)) return null
  // A histogram's bar (roadmap 34f): its bin and what it measures.
  if (own.kind === 'bin' && layer.geom === 'bar')
    return binInfo(project, graph, layer, series, point?.row, result)
  // A bar's error bars are a layer of their own: the card shows the error the graph draws.
  const error =
    own.kind === 'summary' && !own.error
      ? graph.layers
          .map((l) => statOf(l, mark.key))
          .find((s) => s.kind === 'summary' && s.error && s.error !== 'none')
      : undefined
  const stat =
    error?.kind === 'summary' && own.kind === 'summary' ? { ...own, error: error.error } : own

  // Counts of a text × text graph (bars, labels, a heat map's cells): the count, not a row.
  const counted =
    isMapped(graph) && !!graph.mapping && mappedVariables(table, graph.mapping)?.axes === 'tt'
  if (counted) return countInfo(series, point?.row, graph)

  if (point && (stat.kind === 'identity' || layer.geom === 'tile' || layer.geom === 'label')) {
    const row = point.row
    if (table.tableKind === 'multipleVariables')
      return { title: rowName(table, row), lines: rowOfVariables(table, row), ...at(row) }
    return valueInfo(table, series, row, point.sub ?? 0, at)
  }

  // A summary: of a cell (grouped and XY graphs: the mark names its row), else of the data set.
  const dsRow = point ? (series.rows ? series.rows.indexOf(point.row) : point.row) : -1
  const stats = dsRow >= 0 ? seriesCellStats(series, dsRow) : plotStats(series.ds)
  const cat = dsRow >= 0 ? series.ds.rowTitles?.[dsRow] : null
  const title = [series.title || '(untitled)', cat].filter(Boolean).join(' · ')
  const x = dsRow >= 0 ? series.ds.x?.[dsRow] : undefined
  const lines = [
    ...(x !== undefined && Number.isFinite(x)
      ? [{ label: table.x?.title || 'X', value: shown(x) }]
      : []),
    ...summaryLines(stats, stat),
  ]
  return { title, lines, ...(point && dsRow >= 0 ? at(point.row) : {}) }
}

const nodeIsTable = (project: Project, id: NodeId) => project.nodes[id]?.kind === 'table'

/** Whether a mark has a hover card: a data set's mark, or a dendrogram's (roadmap 49c). */
export const hasHoverCard = (node: Pick<SceneNode, 'target' | 'tree'>): boolean =>
  !!node.tree || markSeries(node) !== null

/**
 * Roadmap 49c: a dendrogram's card, headed by its tree ("Row dendrogram", or the layer's name): a
 * branch's merge height (R's), the leaves under it and, cut, their cluster when they are all in
 * one; a leaf's row or column and, cut, its cluster.
 */
function treeInfo(graph: GraphNode, node: Pick<SceneNode, 'target' | 'tree'>): MarkInfo | null {
  const t = node.tree!
  const id = node.target?.[0] === 'layers' ? String(node.target[1]) : undefined
  const layer = graph.layers.find((l) => l.id === id)
  const title = layer?.name || (t.of === 'rows' ? 'Row dendrogram' : 'Column dendrogram')
  const cluster = (c: number | undefined) => (c ? [{ label: 'Cluster', value: String(c) }] : [])
  if (t.leaf)
    return {
      title,
      lines: [
        { label: t.of === 'rows' ? 'Row' : 'Column', value: t.leaf.name },
        ...cluster(t.leaf.cluster),
      ],
    }
  if (!t.merge) return null
  return {
    title,
    lines: [
      { label: 'Height', value: sig(t.merge.height) },
      { label: 'Leaves', value: String(t.merge.leaves) },
      ...cluster(t.merge.cluster),
    ],
  }
}

/**
 * A histogram bar's card (roadmap 34f): the data set (a level of a graph of variables' colour
 * variable), the bin's edges and its count, percent or fraction of the data set's values (not a
 * stack's running total).
 */
function binInfo(
  project: Project,
  graph: GraphNode,
  layer: LayerOf<'bar'>,
  series: GraphSeries,
  bin: number | undefined,
  result?: ResultLookup,
): MarkInfo | null {
  if (bin === undefined || layer.stat.kind !== 'bin') return null
  const sets = resolveSeries(project, graph, result).filter((s) => seriesShown(layer, s.key))
  const bins = binRows(
    layer,
    sets.map((s) => s.ds),
    histogramTransform(graph),
  )
  const i = sets.findIndex((s) => s.key === series.key)
  const center = bins.centers[bin]
  const value = bins.values[i]?.[bin]
  if (center === undefined || value === undefined) return null
  const half = bins.width / 2
  // Bins in an arcsinh or logicle axis' units (roadmap 34g): their raw edges.
  const [lo, hi] = bins.edges?.[bin] ?? [center - half, center + half]
  const measure = layer.stat.measure ?? 'count'
  const label = { count: 'Count', percent: 'Percent', fraction: 'Fraction' }[measure]
  return {
    title: series.title || '(untitled)',
    lines: [
      { label: 'Bin', value: `${sig(lo)} to ${sig(hi)}` },
      { label, value: measure === 'count' ? String(value) : sig(value) },
    ],
  }
}

/** A single value of a table other than multiple variables: its row, X, value and replicate. */
function valueInfo(
  table: DataTable,
  series: GraphSeries,
  row: number,
  sub: number,
  at: (row: number, more?: Partial<NonNullable<MarkInfo['goTo']>>) => Partial<MarkInfo>,
): MarkInfo {
  const ds = table.dataSets.find((d) => d.id === series.key)
  const lines: HoverLine[] = []
  const x = table.x?.subcolumns[0]?.values[row]
  if (table.x) lines.push({ label: table.x.title || 'X', value: shown(x) })
  const value = ds?.subcolumns[sub]?.values[row]
  lines.push({ label: series.title || ds?.title || 'Value', value: shown(value) })
  if (ds && ds.subcolumns.length > 1) {
    const name = ds.subcolumnTitles?.[sub] || `Replicate ${sub + 1}`
    lines.push({ label: 'Replicate', value: name })
  }
  if (ds?.subcolumns[sub]?.excluded?.[row]) lines.push({ label: 'Excluded', value: 'yes' })
  return {
    title: rowName(table, row),
    lines,
    ...at(row, ds ? { column: ds.id, sub } : {}),
  }
}

/** A count (or percent) of a text × text graph's cell. */
function countInfo(series: GraphSeries, tableRow: number | undefined, graph: GraphNode): MarkInfo {
  const i = tableRow === undefined ? -1 : series.rows ? series.rows.indexOf(tableRow) : tableRow
  const v =
    i >= 0
      ? series.ds.data.shape === 'replicates'
        ? series.ds.data.reps[0]?.[i]
        : undefined
      : undefined
  const measure = graph.mapping?.measure ?? 'count'
  const label = measure === 'count' ? 'Count' : 'Percent'
  const cat = i >= 0 ? series.ds.rowTitles?.[i] : null
  return {
    title: [series.title, cat].filter(Boolean).join(' · '),
    lines:
      v === undefined ? [] : [{ label, value: measure === 'count' ? String(v) : `${sig(v)}%` }],
  }
}
