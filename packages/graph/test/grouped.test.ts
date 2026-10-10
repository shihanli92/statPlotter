import { type AnalysisResult, createTable, type Layer, type NodeId, newNodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { bracketsFromAnalysis, createGraphFor, layoutGraph, sceneToSvg } from '../src/index.ts'
import { addLayers, graphOf } from './graphs.ts'
import { byId, fonts, nodes, prim, projectOf } from './helpers.ts'

/** Grouped table: rows WT/KO/Het, data sets Vehicle/Drug, triplicates. */
function setup() {
  const table = createTable({
    tableKind: 'grouped',
    yFormat: { type: 'replicates', count: 3 },
    columns: 2,
    rows: 3,
  })
  table.rowTitles = ['WT', 'KO', 'Het']
  const base = [
    [10, 20, 15],
    [12, 30, 18],
  ]
  base.forEach((means, c) => {
    table.dataSets[c]!.subcolumns.forEach((sub, j) => {
      sub.values = means.map((m) => m + j - 1)
    })
  })
  table.dataSets[0]!.title = 'Vehicle'
  table.dataSets[1]!.title = 'Drug'
  const graph = createGraphFor(table)
  const project = projectOf(table, graph)
  return { project, table, graph }
}

describe('grouped layout', () => {
  it('interleaves one bar per data set within each row group, with a legend', () => {
    const { project, graph, table } = setup()
    expect(graph.look).toBe('grouped.bar')
    const scene = layoutGraph({ project, graph, fonts })
    const [v, d] = table.dataSets.map((ds) => ds.id)
    expect(nodes(scene, `series/${v}/bar/`)).toHaveLength(3)
    const bar = (key: string, row: number) => prim(byId(scene, `series/${key}/bar/${row}`), 'rect')
    // Within a group, Vehicle is left of Drug; groups are in row order.
    expect(bar(v!, 0).x).toBeLessThan(bar(d!, 0).x)
    expect(bar(d!, 0).x).toBeLessThan(bar(v!, 1).x)
    // Bar heights follow the means (KO/Drug = 30 is the tallest).
    expect(bar(d!, 1).y).toBeLessThan(bar(v!, 1).y)
    const labels = nodes(scene, 'axis/x/tickLabel/').map(
      (n) => prim(n, 'text').layout.runs[0]!.text,
    )
    expect(labels).toEqual(['WT', 'KO', 'Het'])
    expect(nodes(scene, 'legend/').filter((n) => n.id.endsWith('/label'))).toHaveLength(2)
    expect(sceneToSvg(scene)).not.toContain('NaN')
  })

  it('draws brackets between cells within a row and across rows', () => {
    const { project, graph, table } = setup()
    const [v, d] = table.dataSets.map((ds) => ds.id)
    const ref = (key: string) => ({ node: table.id, key })
    const analysisId = newNodeId()
    const result: AnalysisResult = {
      status: 'ok',
      diagnostics: [],
      sheets: [],
      values: {},
      comparisons: [
        { key: 'r1', a: ref(v!), b: ref(d!), rowA: 1, rowB: 1, p: 0.0004 },
        { key: 'c', a: ref(d!), b: ref(d!), rowA: 0, rowB: 1, p: 0.02 },
        { key: 'r0', a: ref(v!), b: ref(d!), rowA: 0, rowB: 0, p: 0.4 },
        { key: 'main', a: ref(v!), b: ref(d!), p: 0.001 },
      ],
      outputs: {},
    }
    // Whole-data-set comparisons don't belong on a grouped graph; ns ones are dropped on request.
    const all = bracketsFromAnalysis(graph, analysisId, result)
    expect(
      all.map((a) => a.type === 'bracket' && a.label.source === 'analysis' && a.label.comparison),
    ).toEqual(['r1', 'c', 'r0'])
    const sig = bracketsFromAnalysis(graph, analysisId, result, 'stars', 0.05)
    expect(sig).toHaveLength(2)

    const g = { ...graph, annotations: sig }
    const scene = layoutGraph({
      project,
      graph: g,
      fonts,
      result: (id: NodeId) => (id === analysisId ? result : undefined),
    })
    const labels = nodes(scene, 'annotation/')
      .filter((n) => n.id.endsWith('/label'))
      .map((n) => prim(n, 'text').layout.runs[0]!.text)
    expect(labels.sort()).toEqual(['*', '***'])
    const line = (i: number) => prim(byId(scene, `annotation/${sig[i]!.id}/line`), 'polyline')
    // The within-row bracket spans the two KO bars.
    const barX = (key: string, row: number) => {
      const r = prim(byId(scene, `series/${key}/bar/${row}`), 'rect')
      return r.x + r.w / 2
    }
    expect(line(0).points[1]![0]).toBeCloseTo(barX(v!, 1), 9)
    expect(line(0).points[2]![0]).toBeCloseTo(barX(d!, 1), 9)
    // The wider across-row bracket overlaps it and stacks above.
    expect(line(1).points[1]![1]).toBeLessThan(line(0).points[1]![1])
  })

  it('dot-plot variant draws points, mean lines and error bars', () => {
    const { project, table } = setup()
    const g = graphOf(table, 'points')
    const scene = layoutGraph({ project, graph: g, fonts })
    const v = table.dataSets[0]!.id
    expect(nodes(scene, `series/${v}/point/0/`)).toHaveLength(3)
    expect(byId(scene, `series/${v}/center/0`)).toBeDefined()
    expect(nodes(scene, `series/${v}/bar/`)).toHaveLength(0)
  })

  it('floating bars span min to max with a line at the mean; boxes span the quartiles', () => {
    const { project, table } = setup()
    const v = table.dataSets[0]!.id
    const floating = graphOf(table, 'floating')
    const scene = layoutGraph({ project, graph: floating, fonts })
    const y = scene.axes!.y!.toPx
    // Row 0 of Vehicle holds 9, 10, 11.
    const r = prim(byId(scene, `series/${v}/box/0`), 'rect')
    expect(r.y).toBeCloseTo(y(11), 6)
    expect(r.y + r.h).toBeCloseTo(y(9), 6)
    expect(prim(byId(scene, `series/${v}/center/0`), 'line').y1).toBeCloseTo(y(10), 6)
    expect(nodes(scene, `series/${v}/box/0/whisker`)).toHaveLength(0)
    expect(nodes(scene, `series/${v}/point/0/`)).toHaveLength(3)
    expect(nodes(scene, `series/${v}/error/`)).toHaveLength(0)

    // Box and whiskers: line at the median. With three values the quartiles are the extremes,
    // so there are no whiskers to draw.
    const box = layoutGraph({ project, graph: graphOf(table, 'box'), fonts })
    expect(prim(byId(box, `series/${v}/center/0`), 'line').y1).toBeCloseTo(box.axes!.y!.toPx(10), 6)
    expect(nodes(box, `series/${v}/box/0/whisker`)).toHaveLength(0)
    expect(sceneToSvg(box)).not.toContain('NaN')
  })

  it('aligned data sets share each row’s x: mean symbols, and bare P values above them', () => {
    const { project, table } = setup()
    const [v, d] = table.dataSets.map((ds) => ds.id)
    const ref = (key: string) => ({ node: table.id, key })
    const analysisId = newNodeId()
    const result: AnalysisResult = {
      status: 'ok',
      diagnostics: [],
      sheets: [],
      values: {},
      comparisons: [{ key: 'r1', a: ref(v!), b: ref(d!), rowA: 1, rowB: 1, p: 0.01704 }],
      outputs: {},
    }
    // Means joined, every data set at the row's centre.
    const g = graphOf(table, 'connected')
    g.annotations = bracketsFromAnalysis(g, analysisId, result, 'number')
    const scene = layoutGraph({
      project,
      graph: g,
      fonts,
      result: (id: NodeId) => (id === analysisId ? result : undefined),
    })
    const mean = (key: string, row: number) =>
      prim(byId(scene, `series/${key}/mean/${row}`), 'symbol')
    expect(mean(v!, 1).cx).toBeCloseTo(mean(d!, 1).cx, 9)
    expect(mean(d!, 1).cy).toBeCloseTo(scene.axes!.y!.toPx(30), 6)
    // One symbol per cell instead of every replicate, and no centre line.
    expect(nodes(scene, `series/${v}/point/`)).toHaveLength(0)
    expect(byId(scene, `series/${v}/center/1`)).toBeUndefined()
    // The comparison at one x is its number alone, above both data sets.
    const id = g.annotations[0]!.id
    expect(byId(scene, `annotation/${id}/line`)).toBeUndefined()
    const label = prim(byId(scene, `annotation/${id}/label`), 'text')
    expect(label.layout.runs.map((r) => r.text).join('')).toBe('0.0170')
    const tops = nodes(scene, 'series/')
      .filter((n) => n.id.includes('/1') && n.bbox)
      .map((n) => n.bbox!.y)
    expect(byId(scene, `annotation/${id}/label`)!.bbox!.y + 1).toBeLessThan(Math.min(...tops))
  })

  it('joins the means of each data set across rows', () => {
    const { project, table } = setup()
    const joined: Layer = {
      id: 'line',
      geom: 'line',
      stat: { kind: 'summary', center: 'mean' },
      position: { kind: 'dodge' },
    }
    const g = addLayers(graphOf(table, 'points'), [joined], 0)
    const scene = layoutGraph({ project, graph: g, fonts })
    const d = table.dataSets[1]!.id
    const line = prim(byId(scene, `series/${d}/line/0`), 'polyline')
    const y = scene.axes!.y!.toPx
    expect(line.points.map((p) => p[1])).toEqual([12, 30, 18].map((m) => expect.closeTo(y(m), 6)))
  })
})
