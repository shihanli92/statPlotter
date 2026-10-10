import {
  type AnalysisNode,
  createProject,
  createTable,
  type DataTable,
  type GraphNode,
  type LayoutNode,
  type NodeId,
  newLayoutItemId,
  newNodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { CommandError, DocumentStore, duplicateNode } from '../src/index.ts'
import { POINTS } from './graphs.ts'

function project() {
  const store = new DocumentStore(createProject('T', new Date('2026-01-01T00:00:00Z')))
  const table = createTable({ tableKind: 'column', rows: 3, columns: 2 })
  table.name = 'Data 1'
  const analysis: AnalysisNode = {
    kind: 'analysis',
    id: newNodeId(),
    name: 'a',
    analysisId: 'descriptive',
    pluginVersion: 1,
    input: { source: table.id, dataSets: [] },
    params: {},
  }
  const graph: GraphNode = {
    kind: 'graph',
    id: newNodeId(),
    name: 'Graph',
    frame: 'category',
    look: 'column.scatter',
    layers: [POINTS],
    seriesSource: { table: table.id, include: 'all' },
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
  }
  const layout: LayoutNode = {
    kind: 'layout',
    id: newNodeId(),
    name: 'Layout',
    page: { width: 612, height: 792 },
    items: [{ type: 'graph', id: newLayoutItemId(), graph: graph.id, x: 0, y: 0, scale: 1 }],
    panelLabels: { show: true, style: 'A', size: 14 },
  }
  store.dispatch([table, analysis, graph, layout].map((node) => ({ type: 'node.add', node })))
  return { store, table, analysis, graph, layout }
}

describe('duplicateNode', () => {
  it('copies a table’s data only, right after it, in one undo step', () => {
    const { store, table } = project()
    const col = table.dataSets[0]!.id
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ row: 0, col, sub: 0, value: 4 }],
    })
    const cmd = duplicateNode(store.getState(), table.id)
    store.dispatch(cmd, 'Duplicate')
    const doc = store.getState()
    const copy = doc.nodes[cmd.node.id] as DataTable
    expect(doc.order.indexOf(copy.id)).toBe(doc.order.indexOf(table.id) + 1)
    expect(copy.name).toBe('Data 1 (copy)')
    expect(copy.dataSets).toEqual((doc.nodes[table.id] as DataTable).dataSets)
    // Its analyses stay with the original.
    const analyses = Object.values(doc.nodes).filter((n) => n.kind === 'analysis')
    expect(analyses).toHaveLength(1)
    // Independent data: editing the copy leaves the original alone.
    store.dispatch({
      type: 'table.setCells',
      table: copy.id,
      edits: [{ row: 0, col, sub: 0, value: 9 }],
    })
    const cell = (id: NodeId) =>
      (store.getState().nodes[id] as DataTable).dataSets[0]!.subcolumns[0]!.values[0]
    expect(cell(copy.id)).toBe(9)
    expect(cell(table.id)).toBe(4)
    store.undo()
    store.undo()
    expect(store.getState().nodes[copy.id]).toBeUndefined()
    expect(store.getState().order).toHaveLength(4)
  })

  it('points a graph copy at the same data and a layout copy at the same graphs', () => {
    const { store, table, graph, layout } = project()
    const g = duplicateNode(store.getState(), graph.id)
    store.dispatch(g)
    expect((g.node as GraphNode).seriesSource.table).toBe(table.id)
    expect(g.node.name).toBe('Graph (copy)')
    const l = duplicateNode(store.getState(), layout.id)
    store.dispatch(l)
    expect((l.node as LayoutNode).items[0]).toMatchObject({ type: 'graph', graph: graph.id })
    // A second copy gets a name of its own.
    expect(duplicateNode(store.getState(), graph.id).node.name).toBe('Graph (copy 2)')
  })

  it('copies an analysis alone, with the same input and parameters', () => {
    const { store, analysis, table } = project()
    const cmd = duplicateNode(store.getState(), analysis.id)
    store.dispatch(cmd)
    const copy = cmd.node as AnalysisNode
    expect(copy).toMatchObject({ name: 'a (copy)', input: { source: table.id }, params: {} })
    expect(copy.id).not.toBe(analysis.id)
    expect(Object.values(store.getState().nodes)).toHaveLength(5)
  })

  it('refuses unknown nodes', () => {
    const { store } = project()
    expect(() => duplicateNode(store.getState(), newNodeId())).toThrow(CommandError)
  })
})
