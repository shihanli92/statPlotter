import {
  type AnalysisResult,
  createTable,
  type GraphNode,
  type NodeId,
  newNodeId,
  type OutputDecl,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { createGraphFor, layoutGraph, outputGraphsFor, withOutputSeries } from '../src/index.ts'
import { layerOf } from './graphs.ts'
import { flatten, fonts, projectOf } from './helpers.ts'

/** The outputs a graph's output layers draw, by key. */
const outputKeys = (graph: GraphNode) => {
  const data = layerOf(graph, 'curves').data
  return data?.from === 'outputs' ? data.series : []
}

describe('graphs of analysis outputs', () => {
  const table = createTable({ columns: 2, rows: 3 })
  const analysisId = newNodeId()
  const g = { id: 'ba', name: 'Bland-Altman plot', xTitle: 'Average', yTitle: 'Difference' }
  const decls: OutputDecl[] = [
    { key: 'pairs', graph: g, mark: 'points' },
    { key: 'bias', graph: g },
    { key: 'curve' },
    { key: 'roc', graph: { id: 'roc', name: 'ROC curve', xRange: [0, 100], square: true } },
  ]

  it('makes one graph per graph id, showing only those outputs', () => {
    const graphs = outputGraphsFor(table, analysisId, decls)
    expect(graphs.map((x) => x.name)).toEqual(['Bland-Altman plot', 'ROC curve'])
    const [ba, roc] = graphs as [GraphNode, GraphNode]
    expect(ba.seriesSource).toEqual({ table: table.id, include: [] })
    const [pairs] = outputKeys(ba)
    expect(outputKeys(ba).map((e) => e.ref.key)).toEqual(['pairs', 'bias'])
    // The pairs are drawn as points only: shown in the points layer, left out of the lines.
    expect(layerOf(ba, 'curvePoints').series?.[pairs!.id]?.hide).toBe(false)
    expect(layerOf(ba, 'curves').series?.[pairs!.id]?.hide).toBe(true)
    expect(ba.axes.x.title?.content[0]?.text).toBe('Average')
    expect(roc.size.plotWidth).toBe(roc.size.plotHeight)
    expect(roc.axes.x.type === 'continuous' && roc.axes.x.range).toEqual({ min: 0, max: 100 })
    // Outputs with their own graph aren't linked into graphs of the table.
    const { graph } = withOutputSeries(createGraphFor(table), analysisId, decls)
    expect(outputKeys(graph).map((e) => e.ref.key)).toEqual(['curve'])
  })

  it('makes output graphs XY graphs, whatever the table', () => {
    const [ba] = outputGraphsFor(table, analysisId, decls)
    expect([ba!.frame, ba!.look]).toEqual(['xy', 'xy.scatter'])
    expect(createGraphFor(table).frame).toBe('category')
  })

  it('draws point outputs as symbols and line outputs as lines', () => {
    const project = projectOf(table)
    const [ba] = outputGraphsFor(table, analysisId, decls)
    const result: AnalysisResult = {
      status: 'ok',
      diagnostics: [],
      sheets: [],
      values: {},
      comparisons: [],
      outputs: {
        pairs: { title: 'Difference', x: [1, 2, 3], y: [0.1, -0.2, 0.3] },
        bias: { title: 'Bias', x: [1, 3], y: [0.07, 0.07] },
      },
    }
    const scene = layoutGraph({
      project,
      graph: ba!,
      fonts,
      result: (id: NodeId) => (id === analysisId ? result : undefined),
    })
    const all = flatten(scene.root)
    expect(all.filter((n) => n.id.startsWith('curve/0/point/'))).toHaveLength(3)
    expect(
      all.filter((n) => n.id.startsWith('curve/0/') && n.prim?.type === 'polyline'),
    ).toHaveLength(0)
    expect(
      all.filter((n) => n.id.startsWith('curve/1/') && n.prim?.type === 'polyline'),
    ).toHaveLength(1)
  })
})
