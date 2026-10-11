import { registry } from '@ps/analyses'
import {
  bracketsFromAnalysis,
  defaultPresetFor,
  equalizePlotSizes,
  type FontRegistry,
  layoutGraph,
  outputGraphsFor,
  presetGraph,
  withOutputSeries,
} from '@ps/graph'
import {
  type AnalysisNode,
  type AnalysisResult,
  type AxisSpec,
  createProject,
  createTable,
  type DataTable,
  type DocNode,
  type GraphNode,
  graphOutputs,
  type Layer,
  type LayerStyle,
  type LayoutItem,
  type LayoutNode,
  type NodeId,
  newLayoutItemId,
  newNodeId,
  normalizeColumn,
  type PanelLabelStyle,
  type Project,
  type RichText,
  resultTableAs,
  type StrokeStyle,
  type TableKind,
  type TextSpec,
} from '@ps/model'
import { newLayout, pageSpec, placeGraphs } from '../../layout/figure.ts'

/*
 * Helpers for building the synthetic example projects: seeded random numbers, tables from plain
 * arrays, and a builder that adds tables, analyses (run at once, so brackets and graphs of result
 * tables can be made from their results), graphs and layout pages to a project.
 *
 * Example graphs draw by data set (`drawOrder: 'series'`), as they did before roadmap 33b, so the
 * examples look as they did: a test checks that each draws exactly as its v1 document migrated.
 * New graphs elsewhere draw layer by layer. Graphs are made from presets and changed layer by
 * layer (`withLayer`, `addLayer`…), as the builder and the Layers section change them.
 */

/** A graph with one layer changed (nothing when it has no layer of that id). */
export function withLayer(g: GraphNode, id: string, f: (l: Layer) => object): GraphNode {
  return { ...g, layers: g.layers.map((l) => (l.id === id ? (f(l) as Layer) : l)) }
}

/** A graph with style fields set on a layer (every data set). */
export const layerStyle = (g: GraphNode, id: string, style: LayerStyle): GraphNode =>
  withLayer(g, id, (l) => ({ ...l, style: { ...l.style, ...style } }) as Layer)

/** A graph with a layer added at `at` (default: in front). */
export function addLayer(g: GraphNode, layer: Layer, at = g.layers.length): GraphNode {
  const layers = [...g.layers]
  layers.splice(at, 0, layer)
  return { ...g, layers }
}

/** A graph without a layer. */
export const removeLayer = (g: GraphNode, id: string): GraphNode => ({
  ...g,
  layers: g.layers.filter((l) => l.id !== id),
})

// ---------------------------------------------------------------------------------------------
// Random numbers (deterministic)
// ---------------------------------------------------------------------------------------------

interface Rng {
  /** Uniform on [0, 1). */
  uniform: () => number
  /** Normal with the given mean and SD. */
  normal: (mean?: number, sd?: number) => number
  /** Lognormal: exp of a normal with this mean and SD on the log scale. */
  lognormal: (logMean: number, logSd: number) => number
  /** Exponential with this mean. */
  exponential: (mean: number) => number
}

/** Mulberry32 with Box-Muller normals: the same numbers for a seed on every platform. */
export function rng(seed: number): Rng {
  let a = seed >>> 0
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const normal = (mean = 0, sd = 1) => {
    const u = 1 - uniform()
    const v = uniform()
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  return {
    uniform,
    normal,
    lognormal: (m, s) => Math.exp(normal(m, s)),
    exponential: (mean) => -mean * Math.log(1 - uniform()),
  }
}

/** Rounds to `digits` decimals (tables show what a lab would record). */
export const round = (v: number, digits = 1): number => {
  const s = 10 ** digits
  return Math.round(v * s) / s
}

/** `n` draws of `f`, rounded. */
export const draws = (n: number, f: () => number, digits = 1): number[] =>
  Array.from({ length: n }, () => round(f(), digits))

// ---------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------

type Cells = (number | null)[]

/** A column table: one data set per title, values stacked in rows. */
export function columnTable(name: string, cols: Record<string, Cells>, notes = ''): DataTable {
  const titles = Object.keys(cols)
  const rows = Math.max(...titles.map((t) => cols[t]!.length))
  const table = createTable({ name, columns: titles.length, rows })
  titles.forEach((t, i) => {
    const ds = table.dataSets[i]!
    ds.title = t
    ds.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) => cols[t]![r] ?? null)
  })
  table.notes = notes
  return table
}

/**
 * A grouped (or nested) table: `cells[data set][row]` lists the replicates of each cell (for
 * nested tables, `cells[group][subject]` lists a subject's measurements; see `nestedTable`).
 */
export function groupedTable(
  name: string,
  rowTitles: string[],
  dataSets: Record<string, Cells[]>,
  notes = '',
): DataTable {
  const titles = Object.keys(dataSets)
  const reps = Math.max(1, ...titles.flatMap((t) => dataSets[t]!.map((c) => c.length)))
  const table = createTable({
    name,
    tableKind: 'grouped',
    yFormat: { type: 'replicates', count: reps },
    columns: titles.length,
    rows: rowTitles.length,
  })
  table.rowTitles = [...rowTitles]
  titles.forEach((t, c) => {
    const ds = table.dataSets[c]!
    ds.title = t
    ds.subcolumns.forEach((sub, j) => {
      sub.values = rowTitles.map((_, r) => dataSets[t]![r]?.[j] ?? null)
    })
  })
  table.notes = notes
  return table
}

/**
 * An XY table: X values by row and, per data set, `ys[row]` = the replicates at that X. Rows
 * past the end of `x` (unknowns to interpolate) have no X.
 */
export function xyTable(
  name: string,
  xTitle: string,
  x: Cells,
  dataSets: Record<string, Cells[]>,
  notes = '',
): DataTable {
  const titles = Object.keys(dataSets)
  const rows = Math.max(x.length, ...titles.map((t) => dataSets[t]!.length))
  const reps = Math.max(1, ...titles.flatMap((t) => dataSets[t]!.map((c) => c.length)))
  const table = createTable({
    name,
    tableKind: 'xy',
    yFormat: { type: 'replicates', count: reps },
    columns: titles.length,
    rows,
  })
  table.x!.title = xTitle
  table.x!.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) => x[r] ?? null)
  titles.forEach((t, c) => {
    const ds = table.dataSets[c]!
    ds.title = t
    ds.subcolumns.forEach((sub, j) => {
      sub.values = Array.from({ length: rows }, (_, r) => dataSets[t]![r]?.[j] ?? null)
    })
  })
  table.notes = notes
  return table
}

/**
 * A nested table: per group, per subject (named), that subject's measurements (rows).
 */
export function nestedTable(
  name: string,
  groups: Record<string, Record<string, number[]>>,
  notes = '',
): DataTable {
  const titles = Object.keys(groups)
  const subjects = Math.max(...titles.map((t) => Object.keys(groups[t]!).length))
  const rows = Math.max(...titles.flatMap((t) => Object.values(groups[t]!).map((v) => v.length)))
  const table = createTable({
    name,
    tableKind: 'nested',
    yFormat: { type: 'replicates', count: subjects },
    columns: titles.length,
    rows,
  })
  titles.forEach((t, c) => {
    const ds = table.dataSets[c]!
    ds.title = t
    const names = Object.keys(groups[t]!)
    ds.subcolumnTitles = Array.from({ length: subjects }, (_, j) => names[j] ?? null)
    ds.subcolumns.forEach((sub, j) => {
      const v = names[j] ? groups[t]![names[j]!]! : []
      sub.values = Array.from({ length: rows }, (_, r) => v[r] ?? null)
    })
  })
  table.notes = notes
  return table
}

/**
 * A table of one value per cell (contingency, multiple variables, parts of whole):
 * `cols[title][row]`.
 */
export function flatTable(
  name: string,
  tableKind: Extract<TableKind, 'contingency' | 'multipleVariables' | 'partsOfWhole'>,
  cols: Record<string, Cells>,
  rowTitles: string[] | null = null,
  notes = '',
): DataTable {
  const titles = Object.keys(cols)
  const rows = Math.max(...titles.map((t) => cols[t]!.length))
  const table = createTable({ name, tableKind, columns: titles.length, rows })
  table.rowTitles = rowTitles ? [...rowTitles] : null
  titles.forEach((t, i) => {
    const ds = table.dataSets[i]!
    ds.title = t
    ds.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) => cols[t]![r] ?? null)
  })
  table.notes = notes
  return table
}

/**
 * A survival table in the usual layout: one subject per row, the time in X and the subject's code
 * (1 = event, 0 = censored) in its group's column.
 */
export function survivalTable(
  name: string,
  xTitle: string,
  groups: Record<string, { time: number; event: boolean }[]>,
  notes = '',
): DataTable {
  const titles = Object.keys(groups)
  const rows = titles.reduce((n, t) => n + groups[t]!.length, 0)
  const table = createTable({ name, tableKind: 'survival', columns: titles.length, rows })
  table.x!.title = xTitle
  const x: Cells = []
  titles.forEach((t, c) => {
    const values: Cells = Array.from({ length: rows }, () => null)
    for (const s of groups[t]!) {
      values[x.length] = s.event ? 1 : 0
      x.push(s.time)
    }
    const ds = table.dataSets[c]!
    ds.title = t
    ds.subcolumns[0]!.values = values
  })
  table.x!.subcolumns[0]!.values = x
  table.notes = notes
  return table
}

// ---------------------------------------------------------------------------------------------
// Text and axes
// ---------------------------------------------------------------------------------------------

/** Plain text, with `^{…}` for superscripts and `_{…}` for subscripts. */
function rich(s: string): RichText {
  const out: RichText = []
  const re = /([\^_])\{([^}]*)\}/g
  let at = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) })
    out.push(m[1] === '^' ? { text: m[2]!, sup: true } : { text: m[2]!, sub: true })
    at = m.index + m[0].length
  }
  if (at < s.length) out.push({ text: s.slice(at) })
  return out
}

export const title = (s: string, style?: TextSpec['style']): TextSpec => ({
  content: rich(s),
  ...(style ? { style } : {}),
})

/** A solid line of this colour and width. */
export const stroke = (rgb: string, width = 1): StrokeStyle => ({
  color: { rgb },
  width,
  dash: 'solid',
})

/** The axis with changes (continuous axes only; a categorical axis gets its title only). */
export function axis(a: AxisSpec, changes: Partial<Extract<AxisSpec, { type: 'continuous' }>>) {
  if (a.type === 'continuous') return { ...a, ...changes }
  return 'title' in changes ? { ...a, title: changes.title ?? null } : a
}

// ---------------------------------------------------------------------------------------------
// Project builder
// ---------------------------------------------------------------------------------------------

interface GraphOptions {
  name?: string
  /** A preset (see GRAPH_PRESETS). */
  preset?: string
  /** Graph title (default: the table's name); null for none. */
  title?: string | null
  xTitle?: string | null
  yTitle?: string | null
  /** Plot-area size in points. */
  size?: { plotWidth?: number; plotHeight?: number }
  /** Any other changes (layers, axes, legend…). */
  edit?: (g: GraphNode) => GraphNode
}

interface AnalyzeOptions {
  /** Data set keys (default: every data set, up to the analysis' maximum). */
  keys?: string[]
  name?: string
  /** Link curves into existing graphs of the source (default true). */
  link?: boolean
}

/** Example graphs draw by data set, as v1 graphs did (see the module comment). */
const bySeries = <T extends DocNode>(node: T): T =>
  node.kind === 'graph' && node.drawOrder === undefined ? { ...node, drawOrder: 'series' } : node

export class ExampleBuilder {
  readonly project: Project
  readonly results = new Map<NodeId, AnalysisResult>()

  constructor(
    title: string,
    readonly fonts: FontRegistry,
  ) {
    this.project = createProject(title)
  }

  add<T extends DocNode>(node: T): T {
    const n = bySeries(node)
    this.project.nodes[n.id] = n
    this.project.order.push(n.id)
    return n
  }

  /** Replaces a node (same id) with a changed copy. */
  set<T extends DocNode>(node: T): T {
    const n = bySeries(node)
    this.project.nodes[n.id] = n
    return n
  }

  table(t: DataTable): DataTable {
    return this.add(t)
  }

  /** The table a node provides: a data table, or an analysis' result table. */
  source(id: NodeId): DataTable {
    const node = this.project.nodes[id]
    if (node?.kind === 'table') return node
    if (node?.kind === 'analysis') {
      const table = this.results.get(id)?.table
      if (table) return resultTableAs(table, id, node.name)
    }
    throw new Error(`No table for ${id}`)
  }

  result(id: NodeId): AnalysisResult {
    const r = this.results.get(id)
    if (!r) throw new Error(`No result for ${id}`)
    return r
  }

  /** A data set key by its title. */
  key(source: DataTable | AnalysisNode, dataSetTitle: string): string {
    const t = this.source(source.id)
    const ds = t.dataSets.find((d) => d.title === dataSetTitle)
    if (!ds) throw new Error(`No data set “${dataSetTitle}” in ${t.name}`)
    return ds.id
  }

  /**
   * An analysis of a table (or of an analysis' result table), run at once. Its curves are linked
   * into the source's graphs made so far, and outputs that want a graph of their own get one.
   */
  analyze(
    source: DataTable | AnalysisNode,
    analysisId: string,
    params: object = {},
    opts: AnalyzeOptions = {},
  ): AnalysisNode {
    const def = registry.get(analysisId)
    if (!def) throw new Error(`Unknown analysis ${analysisId}`)
    const table = this.source(source.id)
    const keys = opts.keys ?? table.dataSets.slice(0, def.inputs.max).map((d) => d.id as string)
    const parsed = def.params.parse(params)
    const node: AnalysisNode = this.add({
      kind: 'analysis',
      id: newNodeId(),
      name: opts.name ?? `${def.title} of ${table.name}`,
      analysisId,
      pluginVersion: def.version,
      input: { source: source.id, dataSets: keys },
      params: parsed,
    })
    const input = keys.map((k) => {
      const ds = normalizeColumn(table, k)
      if (!ds) throw new Error(`No data set ${k} in ${table.name}`)
      return ds
    })
    const result = def.run(input, parsed, {
      tableKind: table.tableKind,
      xTitle: table.x?.title ?? null,
    })
    if (result.status === 'error')
      throw new Error(`${node.name}: ${result.diagnostics.map((d) => d.message).join(' ')}`)
    this.results.set(node.id, result)

    const decls = def.outputs?.(keys, parsed) ?? []
    if (opts.link !== false) {
      for (const n of Object.values(this.project.nodes)) {
        if (n.kind === 'graph' && n.seriesSource.table === source.id)
          this.set(withOutputSeries(n, node.id, decls).graph)
      }
    }
    for (const g of outputGraphsFor(table, node.id, decls)) this.add(g)
    return node
  }

  /** Graphs an analysis made for its own outputs (volcano plot, ROC curve…). */
  outputGraphs(analysis: AnalysisNode): GraphNode[] {
    return Object.values(this.project.nodes).filter(
      (n): n is GraphNode =>
        n.kind === 'graph' &&
        n.seriesSource.include !== 'all' &&
        n.seriesSource.include.length === 0 &&
        graphOutputs(n).length > 0 &&
        graphOutputs(n).every((o) => o.series.ref.node === analysis.id),
    )
  }

  /** Changes a graph in place (by replacing its node). */
  edit(graph: GraphNode, f: (g: GraphNode) => GraphNode): GraphNode {
    const current = this.project.nodes[graph.id] as GraphNode
    return this.set(f(current))
  }

  /** A graph of a table or of an analysis' result table. */
  graph(source: DataTable | AnalysisNode, opts: GraphOptions = {}): GraphNode {
    const table = this.source(source.id)
    const name = opts.name ?? table.name
    // The theme's looks (audit 3: not `newLayerLooks`): the examples look as their v1 documents.
    const looks = { looks: 'theme' as const }
    let g = presetGraph(table, opts.preset ?? defaultPresetFor(table), name, looks)
    if (opts.title !== undefined)
      g = { ...g, title: opts.title === null ? null : title(opts.title) }
    if (opts.xTitle !== undefined)
      g = {
        ...g,
        axes: { ...g.axes, x: axis(g.axes.x, { title: opts.xTitle ? title(opts.xTitle) : null }) },
      }
    if (opts.yTitle !== undefined)
      g = {
        ...g,
        axes: { ...g.axes, y: axis(g.axes.y, { title: opts.yTitle ? title(opts.yTitle) : null }) },
      }
    if (opts.size) g = { ...g, size: { ...g.size, ...opts.size } }
    if (opts.edit) g = opts.edit(g)
    return this.add(g)
  }

  /**
   * Adds live brackets for an analysis' comparisons to a graph: those below `maxP` (default:
   * all for a single comparison, significant ones otherwise), optionally filtered.
   */
  brackets(
    graph: GraphNode,
    analysis: AnalysisNode,
    opts: {
      show?: 'stars' | 'p' | 'both' | 'number'
      maxP?: number
      keep?: (comparisonKey: string) => boolean
    } = {},
  ): GraphNode {
    const result = this.result(analysis.id)
    const maxP = opts.maxP ?? (result.comparisons.length <= 1 ? Number.POSITIVE_INFINITY : 0.05)
    const current = this.project.nodes[graph.id] as GraphNode
    return this.edit(graph, (g) => {
      const added = bracketsFromAnalysis(current, analysis.id, result, opts.show ?? 'stars', maxP)
      const kept = opts.keep
        ? added.filter(
            (a) =>
              a.type !== 'bracket' ||
              a.label.source !== 'analysis' ||
              opts.keep!(a.label.comparison),
          )
        : added
      return { ...g, annotations: [...g.annotations, ...kept] }
    })
  }

  /**
   * A layout page with the graphs in a grid, plot areas aligned (and, by default, all made the
   * same plot size), lettered panels, and optional free text items.
   */
  layout(
    name: string,
    graphs: GraphNode[],
    opts: {
      columns: number
      landscape?: boolean
      equalize?: boolean
      labels?: PanelLabelStyle
      /** Text items (e.g. a figure title), placed as given. */
      text?: { x: number; y: number; content: TextSpec }[]
      /** Top margin (room for a title). */
      top?: number
    },
  ): LayoutNode {
    const page = pageSpec('letter', opts.landscape ? 'landscape' : 'portrait')
    let current = graphs.map((g) => this.project.nodes[g.id] as GraphNode)
    if (opts.equalize !== false) current = equalizePlotSizes(current).map((g) => this.set(g))
    const lookup = (id: NodeId) => this.results.get(id)
    const scene = (graph: GraphNode) =>
      layoutGraph({ project: this.project, graph, fonts: this.fonts, result: lookup })
    const top = opts.top ?? 0
    const placed = placeGraphs(
      current,
      scene,
      { width: page.width, height: page.height - top },
      { columns: opts.columns, equalPlotSize: opts.equalize !== false, gap: 18 },
    )
    const items: LayoutItem[] = [
      ...(opts.text ?? []).map((t) => ({ type: 'text' as const, id: newLayoutItemId(), ...t })),
      ...placed.map((it) => ({ ...it, y: it.y + top })),
    ]
    return this.add(newLayout(name, page, items, { style: opts.labels }))
  }
}
