import {
  type AnalysisResult,
  type AxisSpec,
  createTable,
  type DataTable,
  type GraphNode,
  type NodeId,
  newAnnotationId,
  newNodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  arrangeAligned,
  axisExtent,
  createGraphFor,
  equalizePlotSizes,
  GRAPH_PRESETS,
  layoutGraph,
  linkGroups,
  presetsFor,
  resolveSeries,
  type Scene,
  sliceGraphs,
  withOutputSeries,
} from '../src/index.ts'
import { layerOf, withLayer } from './graphs.ts'
import { byId, fonts, nodes, prim, projectOf } from './helpers.ts'

const labels = (s: Scene, axis: 'x' | 'y') =>
  nodes(s, `axis/${axis}/tickLabel/`).map((n) =>
    prim(n, 'text')
      .layout.runs.map((r) => r.text)
      .join(''),
  )
/** Axis domain [value at the plot's start, value at its end] (Y: bottom, top). */
const domain = (s: Scene, axis: 'x' | 'y'): [number, number] =>
  axis === 'x'
    ? [s.axes!.x.fromPx(s.plot.x), s.axes!.x.fromPx(s.plot.x + s.plot.w)]
    : [s.axes!.y.fromPx(s.plot.y + s.plot.h), s.axes!.y.fromPx(s.plot.y)]

/** Grouped table: rows WT/KO/Het, data sets Vehicle/Drug, triplicates around the means. */
function grouped() {
  const table = createTable({
    tableKind: 'grouped',
    yFormat: { type: 'replicates', count: 3 },
    columns: 2,
    rows: 3,
  })
  table.name = 'Expression'
  table.rowTitles = ['WT', 'KO', 'Het']
  const means = [
    [10, 20, 15],
    [12, 30, 18],
  ]
  means.forEach((m, c) => {
    table.dataSets[c]!.subcolumns.forEach((sub, j) => {
      sub.values = m.map((v) => v + j - 1)
    })
  })
  table.dataSets[0]!.title = 'Vehicle'
  table.dataSets[1]!.title = 'Drug'
  const graph = createGraphFor(table)
  return { table, graph, project: projectOf(table, graph) }
}

/** Column table: groups A, B, C with rows 0–4. */
function column() {
  const table = createTable({ columns: 3, rows: 5 })
  table.name = 'Weights'
  table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3, 4, 50]
  table.dataSets[1]!.subcolumns[0]!.values = [5, 6, 7, 8, 9]
  table.dataSets[2]!.subcolumns[0]!.values = [10, 11, 12, 13, 14]
  table.dataSets.forEach((d, i) => {
    d.title = 'ABC'[i]!
  })
  const graph = createGraphFor(table)
  return { table, graph, project: projectOf(table, graph) }
}

/** XY table: X = 1..5, two data sets with duplicates. */
function xy() {
  const table = createTable({
    tableKind: 'xy',
    yFormat: { type: 'replicates', count: 2 },
    columns: 2,
    rows: 5,
  })
  table.name = 'Dose'
  table.x!.subcolumns[0]!.values = [1, 2, 3, 4, 5]
  table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3, 4, 5]
  table.dataSets[0]!.subcolumns[1]!.values = [1.2, 2.2, 3.2, 4.2, 5.2]
  table.dataSets[1]!.subcolumns[0]!.values = [10, 20, 30, 40, 50]
  table.dataSets[1]!.subcolumns[1]!.values = [11, 21, 31, 41, 51]
  const graph = createGraphFor(table)
  return { table, graph, project: projectOf(table, graph) }
}

const continuousY = (g: GraphNode) => g.axes.y as Extract<AxisSpec, { type: 'continuous' }>

const withRows = (g: GraphNode, rows: number[]): GraphNode => ({
  ...g,
  seriesSource: { ...g.seriesSource, rows },
})

describe('row slices', () => {
  it('grouped graphs show only the chosen rows, in slice order, with their labels', () => {
    const { table, graph, project } = grouped()
    const [v, d] = table.dataSets.map((ds) => ds.id as string)
    const g = withRows(graph, [2, 0, 7]) // 7 is out of range: ignored
    project.nodes[g.id] = g as never
    const scene = layoutGraph({ project, graph: g, fonts })
    expect(labels(scene, 'x')).toEqual(['Het', 'WT'])
    // Ids keep table rows; Het (row 2) comes first.
    expect(nodes(scene, `series/${v}/bar/`).map((n) => n.id)).toEqual([
      `series/${v}/bar/2`,
      `series/${v}/bar/0`,
    ])
    const bar = (key: string, r: number) => prim(byId(scene, `series/${key}/bar/${r}`), 'rect')
    expect(bar(v!, 2).x).toBeLessThan(bar(v!, 0).x)
    expect(byId(scene, `series/${d}/bar/1`)).toBeUndefined()
    // Error bars only for the shown rows.
    expect(nodes(scene, `series/${v}/error/1/`)).toHaveLength(0)
    expect(nodes(scene, `series/${v}/error/2/`).length).toBeGreaterThan(0)
    // Legend unaffected.
    expect(byId(scene, `legend/${v}`)).toBeDefined()
    expect(byId(scene, `legend/${d}`)).toBeDefined()
  })

  it('draws brackets between shown cells and skips those outside the slice', () => {
    const { table, graph, project } = grouped()
    const [v, d] = table.dataSets.map((ds) => ds.id as string)
    const bracket = (rowA: number, rowB: number) => ({
      type: 'bracket' as const,
      id: newAnnotationId(),
      a: v!,
      b: d!,
      rowA,
      rowB,
      label: { source: 'manual' as const, text: '*' },
      level: 'auto' as const,
    })
    const inside = bracket(0, 0)
    const outside = bracket(1, 1)
    const g = { ...withRows(graph, [2, 0]), annotations: [inside, outside] }
    const scene = layoutGraph({ project, graph: g, fonts })
    expect(byId(scene, `annotation/${outside.id}`)).toBeUndefined()
    const line = prim(byId(scene, `annotation/${inside.id}/line`), 'polyline')
    const xs = line.points.map((q) => q[0])
    // Spans the WT (row 0) bars, now in the second group.
    const bv = prim(byId(scene, `series/${v}/bar/0`), 'rect')
    const bd = prim(byId(scene, `series/${d}/bar/0`), 'rect')
    expect(Math.min(...xs)).toBeCloseTo(bv.x + bv.w / 2, 6)
    expect(Math.max(...xs)).toBeCloseTo(bd.x + bd.w / 2, 6)
  })

  it('column graphs use only the chosen rows (replicates)', () => {
    const { table, graph, project } = column()
    const a = table.dataSets[0]!.id
    const g = withRows(graph, [4, 0])
    const scene = layoutGraph({ project, graph: g, fonts })
    expect(nodes(scene, `series/${a}/point/`).map((n) => n.id)).toEqual(
      expect.arrayContaining([`series/${a}/point/4`, `series/${a}/point/0`]),
    )
    expect(nodes(scene, `series/${a}/point/`)).toHaveLength(2)
    // The mean of A is (1 + 50) / 2 = 25.5.
    const s = resolveSeries(project, g)[0]!
    expect(s.ds.rowCount).toBe(2)
    expect(s.rows).toEqual([4, 0])
    const center = prim(byId(scene, `series/${a}/center`), 'line')
    expect(scene.axes!.y.fromPx(center.y1)).toBeCloseTo(25.5, 9)
  })

  it('keeps the normalized view unchanged (and cached) for unsliced graphs', () => {
    const { graph, project } = column()
    const a = resolveSeries(project, graph)
    const b = resolveSeries(project, graph)
    expect(a[0]!.ds).toBe(b[0]!.ds)
    expect(a[0]!.rows).toBeUndefined()
    const sliced = withRows(graph, [1, 2])
    expect(resolveSeries(project, sliced)[0]!.ds).toBe(resolveSeries(project, sliced)[0]!.ds)
  })

  it('XY graphs show only the chosen X rows; curves are unaffected', () => {
    const { table, graph, project } = xy()
    const key = table.dataSets[0]!.id
    const analysisId = newNodeId()
    const result: AnalysisResult = {
      status: 'ok',
      diagnostics: [],
      sheets: [],
      values: {},
      comparisons: [],
      outputs: { curve: { title: 'Fit', x: [0, 5], y: [0, 5] } },
    }
    const g = withOutputSeries(withRows(graph, [1, 3]), analysisId, [{ key: 'curve' }]).graph
    const scene = layoutGraph({
      project,
      graph: g,
      fonts,
      result: (id: NodeId) => (id === analysisId ? result : undefined),
    })
    expect(nodes(scene, `series/${key}/point/`).map((n) => n.id)).toEqual([
      `series/${key}/point/1`,
      `series/${key}/point/3`,
    ])
    expect(nodes(scene, `series/${key}/error/1/`).length).toBeGreaterThan(0)
    expect(nodes(scene, `series/${key}/error/0/`)).toHaveLength(0)
    const curve = prim(byId(scene, 'curve/0/0'), 'polyline')
    expect(curve.points).toHaveLength(2)
    // The X axis still reaches the curve's 0–5.
    const [x0, x1] = domain(scene, 'x')
    expect(x0).toBeLessThanOrEqual(0)
    expect(x1).toBeGreaterThanOrEqual(5)
  })

  it('survival graphs use only the chosen subjects', () => {
    const table = createTable({ tableKind: 'survival', columns: 1, rows: 4 })
    table.x!.subcolumns[0]!.values = [2, 4, 6, 8]
    table.dataSets[0]!.subcolumns[0]!.values = [1, 1, 1, 1]
    const graph = createGraphFor(table)
    const project = projectOf(table, graph)
    const key = table.dataSets[0]!.id
    const full = layoutGraph({ project, graph, fonts })
    const sliced = layoutGraph({ project, graph: withRows(graph, [0, 1]), fonts })
    const steps = (s: Scene) => prim(byId(s, `series/${key}/line/0`), 'polyline').points.length
    expect(steps(sliced)).toBeLessThan(steps(full))
    // With subjects at 2 and 4 only, the last step is at time 4.
    const pts = prim(byId(sliced, `series/${key}/line/0`), 'polyline').points
    expect(sliced.axes!.x.fromPx(pts[pts.length - 1]![0])).toBeCloseTo(4, 9)
  })

  it('contingency graphs show only the chosen rows', () => {
    const table = createTable({ tableKind: 'contingency', columns: 2, rows: 3 })
    table.rowTitles = ['Smokers', 'Former', 'Never']
    table.dataSets[0]!.subcolumns[0]!.values = [10, 20, 30]
    table.dataSets[1]!.subcolumns[0]!.values = [5, 6, 7]
    const graph = createGraphFor(table)
    const project = projectOf(table, graph)
    const scene = layoutGraph({ project, graph: withRows(graph, [1]), fonts })
    expect(labels(scene, 'x')).toEqual(['Former'])
    expect(nodes(scene, `series/${table.dataSets[0]!.id}/bar/`)).toHaveLength(1)
  })
})

describe('linked axes', () => {
  /** Two column graphs of different tables, the second with a much larger range. */
  function pair() {
    const small = column()
    const bigTable = createTable({ columns: 1, rows: 3 })
    bigTable.dataSets[0]!.subcolumns[0]!.values = [100, 200, 300]
    const big = createGraphFor(bigTable)
    const p = small.project
    p.nodes[bigTable.id] = bigTable as never
    p.nodes[big.id] = big as never
    p.order.push(bigTable.id, big.id)
    return { p, small: small.graph, big }
  }
  const link = (g: GraphNode, y: string, x?: string): GraphNode => ({
    ...g,
    links: { y, ...(x ? { x } : {}) },
  })

  it('plans each member from the union of automatic extents', () => {
    const { p, small, big } = pair()
    const [a, b] = [link(small, 'g1'), link(big, 'g1')]
    p.nodes[a.id] = a as never
    p.nodes[b.id] = b as never
    const sa = layoutGraph({ project: p, graph: a, fonts })
    const sb = layoutGraph({ project: p, graph: b, fonts })
    expect(domain(sa, 'y')).toEqual(domain(sb, 'y'))
    expect(domain(sa, 'y')[1]).toBeGreaterThanOrEqual(300)
    expect(labels(sa, 'y')).toEqual(labels(sb, 'y'))
    // Unlinked, the small graph has its own range.
    expect(domain(layoutGraph({ project: p, graph: small, fonts }), 'y')[1]).toBeLessThan(100)
    expect(linkGroups(p).get('g1')).toEqual([a.id, b.id])
    expect(linkGroups(p, 'x').size).toBe(0)
  })

  it('a lone member keeps its own automatic range', () => {
    const { p, small } = pair()
    const a = link(small, 'solo')
    p.nodes[a.id] = a as never
    expect(domain(layoutGraph({ project: p, graph: a, fonts }), 'y')).toEqual(
      domain(layoutGraph({ project: p, graph: small, fonts }), 'y'),
    )
  })

  it('manual-range members neither contribute nor change', () => {
    const { p, small, big } = pair()
    const a = link(small, 'g')
    const manual = link(
      { ...big, axes: { ...big.axes, y: { ...continuousY(big), range: { min: 0, max: 1000 } } } },
      'g',
    )
    p.nodes[a.id] = a as never
    p.nodes[manual.id] = manual as never
    expect(domain(layoutGraph({ project: p, graph: a, fonts }), 'y')).toEqual(
      domain(layoutGraph({ project: p, graph: small, fonts }), 'y'),
    )
    expect(domain(layoutGraph({ project: p, graph: manual, fonts }), 'y')).toEqual([0, 1000])
  })

  it('categorical axes ignore links; XY X axes link', () => {
    const one = xy()
    const other = xy()
    const t2 = other.table
    t2.x!.subcolumns[0]!.values = [10, 20, 30, 40, 50]
    const p = one.project
    p.nodes[t2.id] = t2 as never
    const g1 = link(one.graph, 'y', 'x')
    const g2 = link(other.graph, 'y', 'x')
    p.nodes[g1.id] = g1 as never
    p.nodes[g2.id] = g2 as never
    const s1 = layoutGraph({ project: p, graph: g1, fonts })
    expect(domain(s1, 'x')[1]).toBeGreaterThanOrEqual(50)
    expect(domain(s1, 'x')).toEqual(domain(layoutGraph({ project: p, graph: g2, fonts }), 'x'))
    // A column graph linked on X: nothing happens (and nothing breaks).
    const c = column()
    const cg = { ...c.graph, links: { x: 'x' } }
    expect(axisExtent(c.project, cg, 'x')).toBeNull()
    expect(() => layoutGraph({ project: c.project, graph: cg, fonts })).not.toThrow()
  })

  it('log axes use the union of positive extents', () => {
    const { p, small, big } = pair()
    const logY = (g: GraphNode): GraphNode => ({
      ...g,
      axes: { ...g.axes, y: { ...continuousY(g), scale: 'log10' } },
    })
    // The small table gets a negative value, which a log axis can't show.
    const t = p.nodes[small.seriesSource.table] as DataTable
    t.dataSets[0]!.subcolumns[0]!.values = [-5, 2, 3, 4, 50]
    const a = link(logY(small), 'lg')
    const b = link(big, 'lg') // linear member: contributes its positive extent
    p.nodes[a.id] = a as never
    p.nodes[b.id] = b as never
    const e = axisExtent(p, b, 'y', undefined, { log: true })!
    expect(e.lo).toBeGreaterThan(0)
    const [lo, hi] = domain(layoutGraph({ project: p, graph: a, fonts }), 'y')
    expect(lo).toBeGreaterThan(0)
    expect(lo).toBeLessThanOrEqual(2)
    expect(hi).toBeGreaterThanOrEqual(300)
  })

  it('is safe with mutual and self-referencing groups (no recursion)', () => {
    const { p, small, big } = pair()
    const a = { ...small, links: { x: 'q', y: 'q' } }
    const b = { ...big, links: { x: 'q', y: 'q' } }
    p.nodes[a.id] = a as never
    p.nodes[b.id] = b as never
    expect(() => layoutGraph({ project: p, graph: a, fonts })).not.toThrow()
    expect(linkGroups(p).get('q')).toEqual([a.id, b.id])
  })

  it('axisExtent includes error bars and caches per graph object', () => {
    const { graph, project } = column()
    const e1 = axisExtent(project, graph, 'y')!
    // Scatter: points 1..50 and mean ± SD of A (mean 12, SD ≈ 21.3) → lo below 0.
    expect(e1.lo).toBeLessThan(0)
    expect(e1.hi).toBe(50)
    expect(axisExtent(project, graph, 'y')).toBe(e1)
  })
})

describe('style presets', () => {
  it('lists presets per table kind', () => {
    expect(GRAPH_PRESETS.map((p) => p.id)).toEqual(
      expect.arrayContaining(['bars', 'barsPoints', 'barsSem', 'points', 'pointsMedian', 'box']),
    )
    expect(presetsFor('column').map((p) => p.id)).toContain('box')
    expect(presetsFor('grouped').map((p) => p.id)).toEqual(
      expect.arrayContaining(['box', 'floating', 'connected']),
    )
    expect(presetsFor('column').map((p) => p.id)).not.toContain('connected')
    // Contingency tables graph as bars of the counts (side by side or stacked), or a heat map.
    expect(presetsFor('contingency').map((p) => p.id)).toEqual([
      'bars',
      'stacked',
      'stackedPercent',
      'heatmap',
    ])
    expect(presetsFor('xy').map((p) => p.id)).toEqual([
      'meanSd',
      'meanSem',
      'meanSdJoined',
      'each',
      'spaghetti',
      'envelope',
      'histogram',
    ])
    expect(presetsFor('survival').map((p) => p.id)).toEqual(['survival'])
    const box = GRAPH_PRESETS.find((p) => p.id === 'box')!
    expect(box.tableKinds).toContain('column')
    expect(box.tableKinds).toContain('grouped')
    expect(box.tableKinds).not.toContain('contingency')
  })

  it('sets the look and layers, keeping colours, data and the formats of layers that stay', () => {
    const { table, graph, project } = column()
    const key = table.dataSets[0]!.id
    const g: GraphNode = {
      ...withLayer(graph, 'points', { style: { size: 9 } }),
      seriesOverrides: { [key]: { color: { rgb: '#ff0000' } } },
    }
    const bp = applyPreset(g, 'barsPoints', table)
    expect(bp.look).toBe('column.bar')
    expect(layerOf(bp, 'points').style).toMatchObject({ size: 9 })
    expect(bp.seriesOverrides).toBe(g.seriesOverrides)
    expect(bp.seriesSource).toBe(g.seriesSource)
    const scene = layoutGraph({ project, graph: bp, fonts })
    expect(byId(scene, `series/${key}/bar`)).toBeDefined()
    expect(nodes(scene, `series/${key}/point/`)).toHaveLength(5)

    const ids = (x: GraphNode) => x.layers.map((l) => l.id)
    const bars = applyPreset(bp, 'bars', table)
    expect(ids(bars)).not.toContain('points')
    const sem = applyPreset(bars, 'barsSem', table)
    expect(layerOf<'errorbar'>(sem, 'error').stat.error).toBe('SEM')
    const med = applyPreset(sem, 'pointsMedian', table)
    expect(med.look).toBe('column.scatter')
    expect(layerOf<'center'>(med, 'center').stat.center).toBe('median')
    expect(layerOf<'errorbar'>(med, 'error').stat.error).toBe('IQR')
    expect(applyPreset(med, 'box', table).look).toBe('column.box')
    const meanSd = applyPreset(med, 'meanSd', table)
    expect(ids(meanSd)).not.toContain('points')
    expect(nodes(layoutGraph({ project, graph: meanSd, fonts }), `series/${key}/point/`)).toEqual(
      [],
    )
  })

  it('points only, and points with a mean line, on column and grouped graphs', () => {
    const { table, graph, project } = column()
    const key = table.dataSets[0]!.id
    const only = applyPreset(applyPreset(graph, 'barsSem', table), 'pointsOnly', table)
    expect(only.look).toBe('column.scatter')
    const s1 = layoutGraph({ project, graph: only, fonts })
    expect(nodes(s1, `series/${key}/point/`)).toHaveLength(5)
    expect(nodes(s1, `series/${key}/center`)).toEqual([])
    expect(nodes(s1, `series/${key}/error`)).toEqual([])
    const mean = applyPreset(only, 'pointsMean', table)
    const s2 = layoutGraph({ project, graph: mean, fonts })
    expect(nodes(s2, `series/${key}/point/`)).toHaveLength(5)
    expect(nodes(s2, `series/${key}/center`).length).toBeGreaterThan(0)
    expect(nodes(s2, `series/${key}/error`)).toEqual([])
    // Grouped: every replicate, even after a preset that plots row means.
    const g = grouped()
    const joined = applyPreset(g.graph, 'connected', g.table)
    const gOnly = applyPreset(joined, 'pointsOnly', g.table)
    expect(gOnly.look).toBe('grouped.scatter')
    expect(gOnly.layers.map((l) => [l.id, l.stat.kind])).toEqual([['points', 'identity']])
    const gk = g.table.dataSets[0]!.id
    const s3 = layoutGraph({ project: g.project, graph: gOnly, fonts })
    expect(nodes(s3, `series/${gk}/point/`).length).toBeGreaterThan(g.table.rowCount)
    expect(nodes(s3, `series/${gk}/error`)).toEqual([])
    expect(presetsFor('contingency').map((p) => p.id)).not.toContain('pointsOnly')
  })

  it('maps presets onto grouped and XY graphs, and ignores ones that do not apply', () => {
    const { table, graph } = grouped()
    expect(applyPreset(graph, 'points', table).look).toBe('grouped.scatter')
    expect(applyPreset(graph, 'box', table).look).toBe('grouped.box')
    const joined = applyPreset(graph, 'connected', table)
    expect(layerOf(joined, 'line').position).toEqual({ kind: 'aligned' })
    expect(joined.layers.every((l) => l.position?.kind === 'aligned')).toBe(true)
    expect(layerOf(joined, 'points').stat).toEqual({ kind: 'summary', center: 'mean' })
    const back = applyPreset(joined, 'points', table)
    expect(back.layers.every((l) => l.position?.kind === 'dodge')).toBe(true)
    expect(layerOf(back, 'points').stat).toEqual({ kind: 'identity' })
    // Other presets drop the joining lines; floating bars are boxes of the range.
    const floating = applyPreset(joined, 'floating', table)
    expect(floating.layers.map((l) => l.id)).not.toContain('line')
    expect(layerOf(floating, 'box').stat.kind).toBe('range')
    expect(layerOf(applyPreset(floating, 'box', table), 'box').stat.kind).toBe('boxplot')
    expect(applyPreset(graph, 'nope', table)).toBe(graph)
    const x = xy()
    const m = applyPreset(x.graph, 'meanSem', x.table)
    expect(m.look).toBe('xy.scatter')
    expect(layerOf(m, 'points').stat).toEqual({ kind: 'summary', center: 'mean' })
    expect(layerOf(applyPreset(x.graph, 'each', x.table), 'points').stat).toEqual({
      kind: 'identity',
    })
    expect(applyPreset(x.graph, 'bars', x.table)).toBe(x.graph)
    expect(applyPreset(x.graph, 'connected', x.table)).toBe(x.graph)
  })
})

describe('small multiples', () => {
  it('slices a grouped graph by row: one graph per row, linked on Y', () => {
    const { table, graph, project } = grouped()
    const [v, d] = table.dataSets.map((ds) => ds.id as string)
    const bracket = (row: number) => ({
      type: 'bracket' as const,
      id: newAnnotationId(),
      a: v!,
      b: d!,
      rowA: row,
      rowB: row,
      label: { source: 'manual' as const, text: '*' },
      level: 'auto' as const,
    })
    const base = { ...graph, annotations: [bracket(0), bracket(1)] }
    const out = sliceGraphs(table, 'row', base)
    expect(out).toHaveLength(3)
    expect(out.map((g) => g.title?.content[0]?.text)).toEqual(['WT', 'KO', 'Het'])
    expect(out[0]!.name).toBe('Expression – WT')
    expect(out.map((g) => g.seriesSource.rows)).toEqual([[0], [1], [2]])
    expect(new Set(out.map((g) => g.id)).size).toBe(3)
    expect(out.every((g) => g.id !== graph.id)).toBe(true)
    const group = out[0]!.links?.y
    expect(group).toBeTruthy()
    expect(out.every((g) => g.links?.y === group && g.links?.x === undefined)).toBe(true)
    // Only the row's own bracket is kept.
    expect(out[0]!.annotations).toHaveLength(1)
    expect(out[2]!.annotations).toHaveLength(0)
    expect(out[0]!.size).toEqual(graph.size)

    for (const g of out) project.nodes[g.id] = g as never
    const scenes = out.map((g) => layoutGraph({ project, graph: g, fonts }))
    expect(labels(scenes[1]!, 'x')).toEqual(['KO'])
    expect(domain(scenes[0]!, 'y')).toEqual(domain(scenes[1]!, 'y'))
    expect(domain(scenes[0]!, 'y')[1]).toBeGreaterThanOrEqual(31)
    expect(linkGroups(project).get(group!)).toEqual(out.map((g) => g.id))
  })

  it('intersects the base graph restrictions and skips empty slices', () => {
    const { table, graph } = grouped()
    table.rowCount = 4
    table.rowTitles = [...table.rowTitles!, 'Empty']
    for (const ds of table.dataSets) for (const s of ds.subcolumns) s.values.push(null)
    const base = withRows(graph, [2, 1, 3])
    const out = sliceGraphs(table, 'row', base)
    expect(out.map((g) => g.title?.content[0]?.text)).toEqual(['Het', 'KO'])
    const byDs = sliceGraphs(table, 'dataSet', {
      ...base,
      seriesSource: { ...base.seriesSource, include: [table.dataSets[1]!.id] },
    })
    expect(byDs).toHaveLength(1)
    expect(byDs[0]!.seriesSource).toMatchObject({
      include: [table.dataSets[1]!.id],
      rows: [2, 1, 3],
    })
  })

  it('slices by data set: column and XY tables, colours kept, data restricted', () => {
    const { table, graph, project } = column()
    const out = sliceGraphs(table, 'dataSet', graph)
    expect(out.map((g) => g.title?.content[0]?.text)).toEqual(['A', 'B', 'C'])
    expect(out.map((g) => g.seriesSource.include)).toEqual(table.dataSets.map((d) => [d.id]))
    expect(out[1]!.seriesOverrides[table.dataSets[1]!.id]?.color).toEqual({ palette: 1 })
    for (const g of out) project.nodes[g.id] = g as never
    const s = layoutGraph({ project, graph: out[1]!, fonts })
    expect(labels(s, 'x')).toEqual(['B'])
    // Linked on Y: every slice reaches A's 50.
    expect(domain(s, 'y')[1]).toBeGreaterThanOrEqual(50)
    expect(sliceGraphs(table, 'row', graph)).toEqual([])

    const x = xy()
    const xs = sliceGraphs(x.table, 'dataSet', x.graph, { linkX: true, linkY: false })
    expect(xs).toHaveLength(2)
    expect(xs[0]!.links?.x).toBeTruthy()
    expect(xs[0]!.links?.y).toBeUndefined()
    expect(xs[0]!.name).toBe(`Dose – ${x.table.dataSets[0]!.title}`)
  })
})

describe('aligned pages', () => {
  const page = { width: 612, height: 792 }

  it('lines up plot areas within grid rows and columns and fits the page', () => {
    const { table, graph, project } = column()
    const graphs: GraphNode[] = [
      graph,
      // A wide Y title pushes this plot right; a two-line title pushes it down.
      {
        ...graph,
        id: newNodeId(),
        axes: {
          ...graph.axes,
          y: { ...graph.axes.y, title: { content: [{ text: 'Body weight (grams)' }] } },
        },
      },
      { ...graph, id: newNodeId(), title: null, size: { plotWidth: 300, plotHeight: 240 } },
      { ...applyPreset(graph, 'bars', table), id: newNodeId() },
      { ...graph, id: newNodeId(), title: { content: [{ text: 'A much longer title' }] } },
    ]
    const scenes = graphs.map((g) => ({ scene: layoutGraph({ project, graph: g, fonts }) }))
    const at = arrangeAligned(scenes, page, { columns: 2 })
    const plotLeft = (i: number) => at[i]!.x + scenes[i]!.scene.plot.x * at[i]!.scale
    const plotTop = (i: number) => at[i]!.y + scenes[i]!.scene.plot.y * at[i]!.scale
    // Columns: 0, 2, 4 and 1, 3.
    expect(plotLeft(2)).toBeCloseTo(plotLeft(0), 9)
    expect(plotLeft(4)).toBeCloseTo(plotLeft(0), 9)
    expect(plotLeft(3)).toBeCloseTo(plotLeft(1), 9)
    // Rows: 0–1, 2–3, 4.
    expect(plotTop(1)).toBeCloseTo(plotTop(0), 9)
    expect(plotTop(3)).toBeCloseTo(plotTop(2), 9)
    const scale = at[0]!.scale
    expect(at.every((a) => a.scale === scale)).toBe(true)
    expect(scale).toBeLessThanOrEqual(1)
    // Inside the margins, without overlaps.
    at.forEach((a, i) => {
      const s = scenes[i]!.scene
      expect(a.x).toBeGreaterThanOrEqual(36 - 1e-9)
      expect(a.y).toBeGreaterThanOrEqual(36 - 1e-9)
      expect(a.x + s.width * a.scale).toBeLessThanOrEqual(page.width - 36 + 1e-9)
      expect(a.y + s.height * a.scale).toBeLessThanOrEqual(page.height - 36 + 1e-9)
    })
    expect(at[1]!.x).toBeGreaterThanOrEqual(at[0]!.x + scenes[0]!.scene.width * scale)
    expect(at[2]!.y).toBeGreaterThanOrEqual(at[0]!.y + scenes[0]!.scene.height * scale)
  })

  it('scales down to fit a small page', () => {
    const { graph, project } = column()
    const scenes = [0, 1, 2, 3].map(() => ({ scene: layoutGraph({ project, graph, fonts }) }))
    const small = { width: 300, height: 300 }
    const at = arrangeAligned(scenes, small, { columns: 2, margin: 10, gap: 5 })
    const s = scenes[0]!.scene
    expect(at[0]!.scale).toBeLessThan(1)
    expect(at[3]!.x + s.width * at[3]!.scale).toBeLessThanOrEqual(290 + 1e-9)
    expect(at[3]!.y + s.height * at[3]!.scale).toBeLessThanOrEqual(290 + 1e-9)
  })

  it('equalizes plot sizes to the largest, and aligns every edge when asked', () => {
    const { graph, project } = column()
    const graphs = equalizePlotSizes([
      graph,
      { ...graph, id: newNodeId(), size: { plotWidth: 250, plotHeight: 100 } },
      {
        ...graph,
        id: newNodeId(),
        axes: {
          ...graph.axes,
          y: { ...graph.axes.y, title: { content: [{ text: 'A long Y title' }] } },
        },
      },
    ])
    const w = Math.max(250, graph.size.plotWidth)
    const h = Math.max(100, graph.size.plotHeight)
    expect(graphs.every((g) => g.size.plotWidth === w && g.size.plotHeight === h)).toBe(true)
    expect(equalizePlotSizes(graphs)[0]).toBe(graphs[0])
    const scenes = graphs.map((g) => ({ scene: layoutGraph({ project, graph: g, fonts }) }))
    const at = arrangeAligned(scenes, page, { columns: 3, equalPlotSize: true })
    const plotLeft = (i: number) => at[i]!.x + scenes[i]!.scene.plot.x * at[i]!.scale
    // Evenly spaced plot areas.
    expect(plotLeft(1) - plotLeft(0)).toBeCloseTo(plotLeft(2) - plotLeft(1), 9)
  })
})
