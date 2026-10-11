import { DocumentStore } from '@ps/engine'
import {
  createGraphFor,
  DEFAULT_THEME,
  layoutGraph,
  type SceneNode,
  withOutputSeries,
} from '@ps/graph'
import {
  type AnalysisResult,
  createProject,
  createTable,
  type DataSetKey,
  type GraphNode,
  newNodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import { formatTargetFor, layerView, pointPlace, seriesTarget } from '../src/graph/format/route.ts'
import {
  filterRows,
  labelCommands,
  rowChoices,
  toggleRow,
} from '../src/graph/inspector/pointLabels.ts'
import { hoverIndex, hoverMarks, selectionKey, selectionMatcher } from '../src/graph/SceneSvg.tsx'

function setup() {
  const table = createTable({ tableKind: 'xy', columns: 2, rows: 4 })
  table.x!.subcolumns[0]!.values = [1, 2, 3, 4]
  table.dataSets[0]!.subcolumns[0]!.values = [1, 4, 9, 16]
  table.dataSets[1]!.subcolumns[0]!.values = [2, 3, 5, 7]
  table.rowTitles = ['Il6', 'Tnf', null, 'Gapdh']
  const graph = createGraphFor(table)
  const project = projectOf(table, graph)
  const keys = table.dataSets.map((d) => d.id as string)
  return { table, graph, project, keys }
}

describe('selecting a point label', () => {
  it('selects its point, whose marks include the label; Format opens the point', () => {
    const { graph, project, keys } = setup()
    const ds = keys[0]!
    const labelled: GraphNode = {
      ...graph,
      seriesOverrides: { [ds]: { pointLabels: { source: 'rowTitle', which: 'all' } } },
    }
    const scene = layoutGraph({ project, graph: labelled, fonts })
    const all: SceneNode[] = []
    const walk = (n: SceneNode, inherited?: SceneNode['target']) => {
      const withTarget = n.target ? n : { ...n, target: inherited }
      all.push(withTarget)
      for (const c of n.children ?? []) walk(c, withTarget.target)
    }
    walk(scene.root)
    const label = all.find((n) => n.target?.[0] === 'pointLabel' && n.point === 'r1')!
    expect(label.target).toEqual(['pointLabel', ds, 'r1'])
    const key = selectionKey(label.target!)
    expect(key).toEqual(['pointOverrides', ds, 'r1'])
    // The point's symbol and its label are both its marks.
    const match = selectionMatcher(key)
    const marks = all.filter((n) => n.prim && match(n.target, n))
    expect(marks.map((n) => n.prim!.type).sort()).toEqual(['symbol', 'text'])
    expect(
      hoverMarks(hoverIndex(all), key)
        .map((n) => n.prim!.type)
        .sort(),
    ).toEqual(['symbol', 'text'])
    expect(formatTargetFor(label.target, labelled)).toEqual(pointPlace(ds, 'r1'))
    // The point's symbol targets its layer and data set.
    expect(all.find((n) => n.point === 'r1' && n.prim?.type === 'symbol')?.target).toEqual([
      'layers',
      'points',
      'series',
      ds,
    ])
  })

  it('a label of an analysis output formats that output', () => {
    const { graph } = setup()
    const g = withOutputSeries(graph, newNodeId(), [{ key: 'volcano:flagged' as DataSetKey }]).graph
    const curves = g.layers.find((l) => l.id === 'curves')!
    const id = curves.data?.from === 'outputs' ? curves.data.series[0]!.id : ''
    const curve = seriesTarget(g, { output: id })
    expect(curve).toEqual(layerView('curves', { output: id }))
    expect(formatTargetFor(['pointLabel', id, 'r3'], g)).toEqual(curve)
    expect(formatTargetFor(['pointOverrides', id, 'r3'], g)).toEqual(curve)
    // Escape from its label (the output as a "data set") stays on the output.
    expect(formatTargetFor(['seriesOverrides', id], g)).toEqual(curve)
  })
})

describe('Label points fields', () => {
  it('write whole, valid label settings per data set, keeping each one’s other fields', () => {
    const { graph, table, keys } = setup()
    const [a, b] = keys as [string, string]
    const g: GraphNode = {
      ...graph,
      seriesOverrides: {
        [a as DataSetKey]: { pointLabels: { source: 'y', which: 'all', max: 5 } },
      },
    }
    // Every data set: B has none yet and starts from the defaults.
    const cmds = labelCommands(g, DEFAULT_THEME, { dataSets: [a, b] }, (l) => ({
      ...l,
      repel: undefined,
      which: 'rows',
      rows: [1],
    }))
    const store = new DocumentStore(createProject())
    store.dispatch([
      { type: 'node.add', node: table },
      { type: 'node.add', node: g },
    ])
    store.dispatch(cmds)
    const out = store.getState().nodes[graph.id] as GraphNode
    expect(out.seriesOverrides[a as DataSetKey]?.pointLabels).toEqual({
      source: 'y',
      which: 'rows',
      rows: [1],
      max: 5,
    })
    expect(out.seriesOverrides[b as DataSetKey]?.pointLabels).toEqual({
      source: 'rowTitle',
      which: 'rows',
      rows: [1],
    })
    // No undefined values are stored.
    expect('repel' in out.seriesOverrides[a as DataSetKey]!.pointLabels!).toBe(false)
  })

  it('write an output’s labels in its identity', () => {
    const { graph } = setup()
    expect(
      labelCommands(graph, DEFAULT_THEME, { output: 'v' }, (l) => ({ ...l, source: 'x' })),
    ).toEqual([
      {
        type: 'node.set',
        id: graph.id,
        path: ['seriesOverrides', 'v', 'pointLabels'],
        value: { source: 'x', which: 'all' },
      },
    ])
  })

  it('offer the shown rows by title (or number), searchable; outputs offer their rows', () => {
    const { graph, project } = setup()
    const choices = rowChoices(project, graph, { dataSets: [] })
    expect(choices.map((c) => c.label)).toEqual(['Il6', 'Tnf', 'Row 3', 'Gapdh'])
    const sliced: GraphNode = { ...graph, seriesSource: { ...graph.seriesSource, rows: [3, 1] } }
    expect(rowChoices(project, sliced, { dataSets: [] }).map((c) => c.row)).toEqual([3, 1])
    expect(filterRows(choices, 'T').map((c) => c.label)).toEqual(['Tnf'])
    expect(filterRows(choices, 'a', 1).map((c) => c.label)).toEqual(['Gapdh'])
    expect(toggleRow([3, 1], 2)).toEqual([1, 2, 3])
    expect(toggleRow([1, 2], 2)).toEqual([1])

    const analysis = newNodeId()
    const g = withOutputSeries(graph, analysis, [{ key: 'k' as DataSetKey }]).graph
    const curves = g.layers.find((l) => l.id === 'curves')!
    const id = curves.data?.from === 'outputs' ? curves.data.series[0]!.id : ''
    const result = {
      outputs: { k: { title: 'D', x: [1, 2], y: [3, 4], rows: [2, 0], rowTitles: [null, 'Il6'] } },
    } as unknown as AnalysisResult
    expect(rowChoices(project, g, { output: id }, () => result)).toEqual([
      { row: 2, label: 'Row 3' },
      { row: 0, label: 'Il6' },
    ])
  })
})
