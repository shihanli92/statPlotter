import { type AnalysisResult, createTable, type GraphNode, type NodeId, newNodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { clipPolyline, layoutGraph, sceneToSvg, withOutputSeries } from '../src/index.ts'
import { graphOf, withLayer } from './graphs.ts'
import { byId, fonts, nodes, prim, projectOf } from './helpers.ts'

/** XY table: X = 0..4, two data sets with 3 replicates. */
function setup() {
  const table = createTable({
    tableKind: 'xy',
    yFormat: { type: 'replicates', count: 3 },
    columns: 2,
    rows: 5,
  })
  table.x!.subcolumns[0]!.values = [0, 1, 2, 3, 4]
  table.x!.title = 'Time (h)'
  const reps = [
    [1, 2, 3, 4, 5],
    [1.2, 2.2, 3.2, 4.2, 5.2],
    [0.8, 1.8, 2.8, 3.8, null],
  ]
  reps.forEach((vals, j) => {
    table.dataSets[0]!.subcolumns[j]!.values = vals
    table.dataSets[1]!.subcolumns[j]!.values = vals.map((v) => (v === null ? null : v * 2))
  })
  const graph = graphOf(table, 'meanSd')
  const project = projectOf(table, graph)
  return { project, table, graph }
}

describe('XY layout', () => {
  it('plots means with error bars, a legend, and an X title from the table', () => {
    const { project, graph, table } = setup()
    const scene = layoutGraph({ project, graph, fonts })
    const key = table.dataSets[0]!.id
    expect(nodes(scene, `series/${key}/point/`)).toHaveLength(5)
    // Row 4 has two replicates → still an error bar; every row has stem + 2 caps.
    expect(nodes(scene, `series/${key}/error/`)).toHaveLength(15)
    expect(nodes(scene, 'legend/').filter((n) => n.id.endsWith('/label'))).toHaveLength(2)
    expect(prim(byId(scene, 'axis/x/title'), 'text').layout.runs[0]!.text).toBe('Time (h)')
    expect(scene.warnings).toEqual([])
  })

  it('maps X values linearly onto the plot width', () => {
    const { project, graph, table } = setup()
    const scene = layoutGraph({ project, graph, fonts })
    const key = table.dataSets[0]!.id
    const cx = (row: number) => prim(byId(scene, `series/${key}/point/${row}`), 'symbol').cx
    expect(cx(2) - cx(1)).toBeCloseTo(cx(1) - cx(0), 9)
    expect(cx(0)).toBeCloseTo(scene.plot.x, 9) // X axis starts at 0
  })

  it('can plot every replicate instead of the mean', () => {
    const { project, graph, table } = setup()
    const key = table.dataSets[0]!.id
    // This data set's points show every replicate, without error bars.
    let g = withLayer(graph, 'points', { series: { [key]: { stat: { kind: 'identity' } } } })
    g = withLayer(g, 'error', { series: { [key]: { hide: true } } })
    const scene = layoutGraph({ project, graph: g, fonts })
    expect(nodes(scene, `series/${key}/point/`)).toHaveLength(14)
    expect(nodes(scene, `series/${key}/error/`)).toHaveLength(0)
  })

  it('draws fitted curves and bands from analysis outputs, in the data set colour', () => {
    const { project, graph, table } = setup()
    const key = table.dataSets[0]!.id
    const analysisId = newNodeId()
    const xs = Array.from({ length: 41 }, (_, i) => i / 10)
    const result: AnalysisResult = {
      status: 'ok',
      diagnostics: [],
      sheets: [],
      values: {},
      comparisons: [],
      outputs: {
        [`curve:${key}`]: {
          title: 'Fit',
          x: xs,
          y: xs.map((v) => v + 1),
          lo: xs.map((v) => v + 0.5),
          hi: xs.map((v) => v + 1.5),
        },
      },
    }
    const { graph: g } = withOutputSeries(graph, analysisId, [
      { key: `curve:${key}`, forDataSet: key },
    ])
    // An output already on the graph isn't added again.
    expect(withOutputSeries(g, analysisId, [{ key: `curve:${key}` }]).edits).toHaveLength(0)

    const scene = layoutGraph({
      project,
      graph: g,
      fonts,
      result: (id: NodeId) => (id === analysisId ? result : undefined),
    })
    const curve = prim(byId(scene, 'curve/0/0'), 'polyline')
    const point = prim(byId(scene, `series/${key}/point/0`), 'symbol')
    expect(curve.stroke.color).toBe(point.stroke!.color)
    expect(curve.points).toHaveLength(41)
    expect(prim(byId(scene, 'curve/0/band'), 'polygon').fill.opacity).toBeGreaterThan(0)
    // Matched curves don't get their own legend entry.
    expect(nodes(scene, 'legend/curve')).toHaveLength(0)

    // Before the analysis has a result, the graph simply has no curve.
    expect(byId(layoutGraph({ project, graph: g, fonts }), 'curve/0/0')).toBeUndefined()
  })

  it('log X axes place decades evenly and drop non-positive X', () => {
    const { project, graph, table } = setup()
    table.x!.subcolumns[0]!.values = [0, 1, 10, 100, 1000]
    const g: GraphNode = {
      ...graph,
      axes: { ...graph.axes, x: { ...graph.axes.x, scale: 'log10' } as GraphNode['axes']['x'] },
    }
    const scene = layoutGraph({ project, graph: g, fonts })
    const key = table.dataSets[0]!.id
    expect(byId(scene, `series/${key}/point/0`)).toBeUndefined()
    const cx = (row: number) => prim(byId(scene, `series/${key}/point/${row}`), 'symbol').cx
    expect(cx(3) - cx(2)).toBeCloseTo(cx(2) - cx(1), 9)
  })

  it('renders to SVG without NaN', () => {
    const { project, graph } = setup()
    expect(sceneToSvg(layoutGraph({ project, graph, fonts }))).not.toContain('NaN')
  })
})

describe('clipPolyline', () => {
  it('splits a line where it leaves the plot and clips at the edge', () => {
    const runs = clipPolyline(
      [
        [0, 5],
        [5, 5],
        [10, -5],
        [15, 5],
        [20, 5],
      ],
      20,
      10,
    )
    expect(runs).toHaveLength(2)
    expect(runs[0]!.at(-1)).toEqual([7.5, 0])
    expect(runs[1]![0]).toEqual([12.5, 0])
  })

  it('breaks at non-finite points', () => {
    expect(
      clipPolyline(
        [
          [0, 1],
          [1, 1],
          [Number.NaN, 1],
          [3, 1],
          [4, 1],
        ],
        10,
        10,
      ),
    ).toHaveLength(2)
  })
})
