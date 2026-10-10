import {
  type AnalysisNode,
  type AnalysisResult,
  createTable,
  type DataTable,
  type GraphNode,
  type NodeId,
  newNodeId,
  type Project,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  axisExtent,
  createGraphFor,
  layoutGraph,
  matchGraphFormat,
  NESTED_DEFAULTS,
  type NestedOptions,
  nestedOf,
  presetGraph,
  resolveSeries,
  type SceneNode,
  subjectShade,
  subjectShape,
} from '../src/index.ts'
import { layerOf } from './graphs.ts'
import { flatten, fonts, projectOf } from './helpers.ts'
import { resultLayer } from './resultCases.ts'

const VALUE = (key: string) => ({ ref: { from: 'value' as const, key } })

const result = (table?: DataTable): AnalysisResult => ({
  status: 'ok',
  diagnostics: [],
  sheets: [],
  values: {},
  comparisons: [],
  outputs: {},
  ...(table ? { table } : {}),
})

/** A data table, an analysis of it, and the column table that analysis "produced". */
function chained(): { project: Project; analysis: AnalysisNode; produced: DataTable } {
  const data = createTable({ columns: 1, rows: 3 })
  const analysis: AnalysisNode = {
    kind: 'analysis',
    id: newNodeId(),
    name: 'Normalize of Data 1',
    analysisId: 'test.copy',
    pluginVersion: 1,
    input: { source: data.id, dataSets: [data.dataSets[0]!.id] },
    params: {},
  }
  const produced = createTable({ columns: 2, rows: 3, name: 'plugin' })
  produced.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
  produced.dataSets[1]!.subcolumns[0]!.values = [10, 20, 30]
  const project = projectOf(data, analysis)
  return { project, analysis, produced }
}

describe('graphs of result tables', () => {
  it('draw the series of the table an analysis produced, under the analysis’ id', () => {
    const { project, analysis, produced } = chained()
    const lookup = (id: NodeId) => (id === analysis.id ? result(produced) : undefined)
    const table = { ...produced, id: analysis.id }
    const graph = createGraphFor(table, 'Normalized')
    expect(graph.seriesSource.table).toBe(analysis.id)

    const series = resolveSeries(project, graph, lookup)
    expect(series.map((s) => s.key)).toEqual(produced.dataSets.map((d) => d.id))
    expect(series[0]!.ds.ref.node).toBe(analysis.id)
    // Without the result (not computed yet) the graph is empty, not broken.
    expect(resolveSeries(project, graph)).toEqual([])

    const points = (p: Project, lk: typeof lookup) =>
      flatten(layoutGraph({ project: p, graph, fonts, result: lk }).root).filter((n) =>
        n.id.includes('/point/'),
      )
    expect(points(project, lookup)).toHaveLength(6)
    expect(points(project, () => undefined)).toHaveLength(0)
  })

  it('follow the result live: a new result redraws, and the axis extent follows', () => {
    const { project, analysis, produced } = chained()
    let current = result(produced)
    const lookup = (id: NodeId) => (id === analysis.id ? current : undefined)
    const graph = createGraphFor({ ...produced, id: analysis.id })
    expect(axisExtent(project, graph, 'y', lookup)).toEqual({ lo: 1, hi: 30 })

    const next = structuredClone(produced)
    next.dataSets[1]!.subcolumns[0]!.values = [10, 20, 300]
    current = result(next)
    expect(axisExtent(project, graph, 'y', lookup)?.hi).toBe(300)
  })

  it('a result layer’s analysis rerun: the extent (linked partners’ too) follows (audit 2, G17)', () => {
    const table = createTable({ columns: 1, rows: 3 })
    table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
    const base = presetGraph(table, 'points')
    const line = resultLayer('mean', 'refline', 'an1', { fields: { v: VALUE('v') }, at: 'v' })
    const graph = { ...base, layers: [...base.layers, line] } as GraphNode
    const project = projectOf(table, graph)
    const valued = (v: number): AnalysisResult => ({
      ...result(),
      values: { v: { kind: 'number', v } },
    })
    let current = valued(15)
    const lookup = (id: NodeId) => (id === ('an1' as NodeId) ? current : undefined)
    expect(axisExtent(project, graph, 'y', lookup)?.hi).toBe(15)
    // The same graph object, the analysis rerun: no stale cached extent.
    current = valued(500)
    expect(axisExtent(project, graph, 'y', lookup)?.hi).toBe(500)
  })

  it('match formats with graphs of result tables (graph type offered by the result’s kind)', () => {
    const { project, analysis, produced } = chained()
    const lookup = (id: NodeId) => (id === analysis.id ? result(produced) : undefined)
    const target = createGraphFor({ ...produced, id: analysis.id })
    const source = applyPreset(createGraphFor(produced), 'bars', produced)
    const matched = matchGraphFormat(project, target, source, undefined, lookup)
    expect(matched.look).toBe('column.bar')
    expect(matched.layers.map((l) => l.id)).toEqual(['bars', 'error'])
  })
})

/** Two groups; A has three subjects with two measurements each, B two subjects. */
function nestedProject() {
  const table = createTable({
    tableKind: 'nested',
    yFormat: { type: 'replicates', count: 3 },
    columns: 2,
    rows: 2,
  })
  const [a, b] = table.dataSets
  a!.subcolumns[0]!.values = [1, 2]
  a!.subcolumns[1]!.values = [5, 6]
  a!.subcolumns[2]!.values = [9, 10]
  b!.subcolumns[0]!.values = [3, 4]
  b!.subcolumns[1]!.values = [7, null]
  const project = projectOf(table)
  return { project, table }
}

describe('graphs of nested tables', () => {
  it('default to a scatter with subjects side by side, sized for them', () => {
    const { table } = nestedProject()
    const g = createGraphFor(table)
    expect(g.look).toBe('column.scatter')
    expect(nestedOf(g.layers)).toEqual(NESTED_DEFAULTS)
    expect(nestedOf(g.layers)).toEqual({ layout: 'subjects', mark: 'shade', subjectMeans: false })
    const wide = createTable({ tableKind: 'nested', yFormat: { type: 'replicates', count: 6 } })
    expect(createGraphFor(wide).size.plotWidth).toBeGreaterThan(
      createGraphFor(createTable()).size.plotWidth,
    )
  })

  /** The table's scatter with its subjects drawn as `nested` says (pooled, unmarked by default). */
  const nestedGraph = (table: DataTable, nested: Partial<NestedOptions>) =>
    presetGraph(table, 'points', undefined, {
      nested: { layout: 'pooled', mark: 'none', subjectMeans: false, ...nested },
    })
  const layout = (graph: GraphNode, project: Project) =>
    flatten(layoutGraph({ project, graph, fonts }).root)
  const pointsOf = (nodes: SceneNode[], key: string) =>
    nodes.filter((n) => n.id.startsWith(`series/${key}/point/`) && n.prim?.type === 'symbol')
  const cx = (n: SceneNode) => (n.prim as { cx: number }).cx

  it('places each subject’s values in its own column within the group', () => {
    const { project, table } = nestedProject()
    const graph = nestedGraph(table, { layout: 'subjects' })
    const pts = pointsOf(layout(graph, project), table.dataSets[0]!.id)
    expect(pts).toHaveLength(6)
    // Point ids name row and subcolumn: …/point/<row>[/<sub>].
    const bySub = (sub: number) => pts.filter((n) => (n.point ?? '').endsWith(`s${sub}`)).map(cx)
    const [s0, s1, s2] = [bySub(0), bySub(1), bySub(2)]
    expect(Math.max(...s0)).toBeLessThan(Math.min(...s1))
    expect(Math.max(...s1)).toBeLessThan(Math.min(...s2))
    // Group B's two subjects take the group's width between them (no gap for the empty one).
    const ptsB = pointsOf(layout(graph, project), table.dataSets[1]!.id)
    expect(ptsB).toHaveLength(3)
  })

  it('pools subjects in one column when asked, telling them apart by shape or shade', () => {
    const { project, table } = nestedProject()
    const pooled = nestedGraph(table, { layout: 'pooled', mark: 'shape' })
    const pts = pointsOf(layout(pooled, project), table.dataSets[0]!.id)
    const shapes = new Set(pts.map((n) => (n.prim as { shape: string }).shape))
    expect(shapes).toEqual(new Set(['circle', 'square', 'triangle']))

    const shaded = nestedGraph(table, { layout: 'pooled', mark: 'shade' })
    const fills = new Set(
      pointsOf(layout(shaded, project), table.dataSets[0]!.id).map(
        (n) => (n.prim as { fill: { color: string } | null }).fill?.color,
      ),
    )
    expect(fills.size).toBe(3)
  })

  it('draws a line at each subject’s mean when asked', () => {
    const { project, table } = nestedProject()
    const graph = nestedGraph(table, { ...NESTED_DEFAULTS, subjectMeans: true })
    const nodes = layout(graph, project)
    const means = nodes.filter((n) => n.id.includes('/subjectMean/'))
    expect(means).toHaveLength(5) // 3 subjects in A, 2 in B
    const a0 = means.find((n) => n.id === `series/${table.dataSets[0]!.id}/subjectMean/0`)!
    const a2 = means.find((n) => n.id === `series/${table.dataSets[0]!.id}/subjectMean/2`)!
    // Subject means sit at 1.5 and 9.5: the first lower on the plot (larger y) than the last.
    expect((a0.prim as { y1: number }).y1).toBeGreaterThan((a2.prim as { y1: number }).y1)
  })

  it('leaves ordinary column graphs as they were', () => {
    const table = createTable({ columns: 2, rows: 3 })
    table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
    const project = projectOf(table)
    const graph = createGraphFor(table)
    expect(layerOf(graph, 'points').position).toBeUndefined()
    expect(layerOf<'points'>(graph, 'points').style?.subjects).toBeUndefined()
    const nodes = layout(graph, project)
    expect(new Set(pointsOf(nodes, table.dataSets[0]!.id).map(cx)).size).toBe(1)
    expect(nodes.some((n) => n.id.includes('/subjectMean/'))).toBe(false)
  })
})

describe('subject marks', () => {
  it('shade from darker to lighter around the group colour', () => {
    expect(subjectShade('#0072b2', 1, 3)).toBe('#0072b2')
    const lum = (hex: string) =>
      [1, 3, 5].reduce((s, i) => s + Number.parseInt(hex.slice(i, i + 2), 16), 0)
    expect(lum(subjectShade('#0072b2', 0, 3))).toBeLessThan(lum('#0072b2'))
    expect(lum(subjectShade('#0072b2', 2, 3))).toBeGreaterThan(lum('#0072b2'))
    expect(subjectShade('#0072b2', 0, 1)).toBe('#0072b2')
    expect(subjectShade('red', 0, 3)).toBe('red')
  })

  it('cycle symbols starting from the data set’s own', () => {
    expect([0, 1, 2].map((k) => subjectShape('square', k))).toEqual([
      'square',
      'circle',
      'triangle',
    ])
    expect(subjectShape('circle', 6)).toBe('circle')
  })
})
