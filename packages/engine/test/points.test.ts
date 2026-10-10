import {
  createProject,
  createTable,
  type DataSetKey,
  type GraphNode,
  GraphNode as GraphNodeSchema,
  type NodeId,
  newNodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { CommandError, DocumentStore } from '../src/index.ts'
import { curves, POINTS } from './graphs.ts'

function graphOf(table: NodeId, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    kind: 'graph',
    id: newNodeId(),
    name: 'g',
    frame: 'grouped',
    look: 'grouped.scatter',
    layers: [POINTS],
    seriesSource: { table, include: 'all' },
    seriesOverrides: {},
    size: { plotWidth: 100, plotHeight: 100 },
    axes: {
      x: { type: 'categorical', title: null, labels: 'dataSetTitles', rotation: 0 },
      y: {
        type: 'continuous',
        title: null,
        scale: 'linear',
        range: 'auto',
        ticks: 'auto',
        format: { mode: 'auto' },
        frame: 'plain',
        breaks: [],
      },
    },
    annotations: [],
    legend: { show: false, position: 'right' },
    title: null,
    style: {},
    ...extra,
  }
}

describe('single-point formats (pointOverrides)', () => {
  it('are plain data checked by the schema: point keys name a row, or a row and replicate', () => {
    const table = createTable({ tableKind: 'grouped', columns: 1, rows: 2 })
    const ds = table.dataSets[0]!.id as unknown as DataSetKey
    const ok = graphOf(table.id, { pointOverrides: { [ds]: { r1s0: { size: 9 }, r0: {} } } })
    expect(GraphNodeSchema.safeParse(ok).success).toBe(true)
    for (const bad of ['row1', 'r-1', 'r1s', '1', 'r1s0x'])
      expect(
        GraphNodeSchema.safeParse(graphOf(table.id, { pointOverrides: { [ds]: { [bad]: {} } } }))
          .success,
      ).toBe(false)
    expect(
      GraphNodeSchema.safeParse(
        graphOf(table.id, { pointOverrides: { [ds]: { r1: { size: -1 } } } }),
      ).success,
    ).toBe(false)
  })

  it('follow inserted rows, lose deleted rows’ formats, and undo with the row edit', () => {
    const table = createTable({ tableKind: 'grouped', columns: 2, rows: 4 })
    const ds = table.dataSets[0]!.id as unknown as DataSetKey
    const graph = graphOf(table.id, {
      pointOverrides: { [ds]: { r1s0: { size: 9 }, r3: { hide: true }, r0s2: { label: 'a' } } },
    })
    const store = new DocumentStore(createProject())
    store.dispatch([
      { type: 'node.add', node: table },
      { type: 'node.add', node: graph },
    ])
    const points = () => (store.getState().nodes[graph.id] as GraphNode).pointOverrides?.[ds]
    store.dispatch({ type: 'table.insertRows', table: table.id, at: 1, count: 2 })
    expect(points()).toEqual({ r3s0: { size: 9 }, r5: { hide: true }, r0s2: { label: 'a' } })
    store.dispatch({ type: 'table.deleteRows', table: table.id, rows: [3] })
    expect(points()).toEqual({ r4: { hide: true }, r0s2: { label: 'a' } })
    store.undo()
    store.undo()
    expect(points()).toEqual({ r1s0: { size: 9 }, r3: { hide: true }, r0s2: { label: 'a' } })
  })

  it('are set through node.set like any format; malformed keys are rejected', () => {
    const table = createTable({ tableKind: 'column', columns: 1, rows: 2 })
    const graph = graphOf(table.id, { frame: 'category', look: 'column.scatter' })
    const store = new DocumentStore(createProject())
    store.dispatch([
      { type: 'node.add', node: table },
      { type: 'node.add', node: graph },
    ])
    const ds = table.dataSets[0]!.id
    const set = (key: string) =>
      store.dispatch({
        type: 'node.set',
        id: graph.id,
        path: ['pointOverrides', ds, key, 'size'],
        value: 5,
      })
    expect(() => set('row1')).toThrow(CommandError)
    set('r1s0')
    expect((store.getState().nodes[graph.id] as GraphNode).pointOverrides).toEqual({
      [ds]: { r1s0: { size: 5 } },
    })
  })
})

describe('point labels of chosen rows (pointLabels.rows)', () => {
  it('follow inserted and deleted rows on data sets, all data sets and curves, and undo', () => {
    const table = createTable({ tableKind: 'xy', columns: 1, rows: 5 })
    const ds = table.dataSets[0]!.id as unknown as DataSetKey
    const labels = (rows: number[]) => ({
      source: 'rowTitle' as const,
      which: 'rows' as const,
      rows,
    })
    const graph = graphOf(table.id, {
      frame: 'xy',
      look: 'xy.scatter',
      seriesOverrides: {
        [ds]: { pointLabels: labels([0, 2, 4]) },
        volcano: { pointLabels: labels([1, 4]) },
      },
      style: { seriesDefaults: { pointLabels: labels([3]) } },
      layers: [
        POINTS,
        curves([{ id: 'volcano' as never, ref: { node: table.id, key: 'volcano:flagged' } }]),
      ],
    })
    const store = new DocumentStore(createProject())
    store.dispatch([
      { type: 'node.add', node: table },
      { type: 'node.add', node: graph },
    ])
    const g = () => store.getState().nodes[graph.id] as GraphNode
    const rows = () => [
      g().seriesOverrides[ds]!.pointLabels!.rows,
      g().style.seriesDefaults!.pointLabels!.rows,
      g().seriesOverrides.volcano!.pointLabels!.rows,
    ]
    store.dispatch({ type: 'table.insertRows', table: table.id, at: 1, count: 2 })
    expect(rows()).toEqual([[0, 4, 6], [5], [3, 6]])
    store.dispatch({ type: 'table.deleteRows', table: table.id, rows: [4, 5] })
    expect(rows()).toEqual([[0, 4], [], [3, 4]])
    expect(GraphNodeSchema.safeParse(g()).success).toBe(true)
    store.undo()
    store.undo()
    expect(rows()).toEqual([[0, 2, 4], [3], [1, 4]])
  })
})
