import { DocumentStore } from '@ps/engine'
import { layoutGraph, presetGraph, resolveSeries } from '@ps/graph'
import { readProjectFile, writeProjectFile } from '@ps/io'
import {
  type ColumnId,
  createProject,
  type DataTable,
  type GraphNode,
  levelKey,
  type NodeId,
  parseProject,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, sampleVariables } from '../../graph/test/helpers.ts'

// Graphs of variables live (roadmap 34a): they follow table edits (new rows, changed and renamed
// levels, exclusions), undo and redo, and a save and reopen, with no stale caches.

function setup(levels?: GraphNode['levels']) {
  const table = sampleVariables()
  const graph: GraphNode = {
    ...presetGraph(table, 'groupBoxPoints', 'By group'),
    id: 'g1' as NodeId,
    ...(levels ? { levels } : {}),
  }
  const project = createProject()
  project.nodes[table.id] = table
  project.nodes[graph.id] = graph
  project.order.push(table.id, graph.id)
  const store = new DocumentStore(project)
  const g = () => store.getState().nodes[graph.id] as GraphNode
  const titles = () => resolveSeries(store.getState(), g()).map((s) => s.title)
  const scene = () => layoutGraph({ project: store.getState(), graph: g(), fonts })
  const group = 'a' as ColumnId
  const setText = (row: number, value: string | null) =>
    store.dispatch({
      type: 'table.setText',
      table: table.id,
      edits: [{ col: group, row, value }],
    })
  return { store, table, g, titles, scene, setText }
}

describe('graphs of variables follow the table', () => {
  it('a new level appears (at the end of an order of the graph’s own); undo and redo', () => {
    const { store, titles, setText } = setup({ a: ['Low', 'High', 'Mid'] })
    expect(titles()).toEqual(['Low', 'High', 'Mid'])
    setText(0, 'Extra')
    expect(titles()).toEqual(['Low', 'High', 'Mid', 'Extra'])
    store.undo()
    expect(titles()).toEqual(['Low', 'High', 'Mid'])
    store.redo()
    expect(titles()).toEqual(['Low', 'High', 'Mid', 'Extra'])
  })

  it('a renamed level is drawn by its new name; one emptied leaves its rows out', () => {
    const { titles, setText, scene } = setup()
    for (const r of [0, 3, 6, 9]) setText(r, 'Lowest')
    expect(titles()).toEqual(['Lowest', 'High', 'Mid'])
    setText(1, null)
    expect(scene().warnings).toContain('2 rows without a level of Group left out.')
  })

  it('new rows and exclusions count at once', () => {
    const { store, table, titles, scene, setText } = setup()
    store.dispatch({ type: 'table.insertRows', table: table.id, at: 14, count: 1 })
    setText(14, 'Late')
    // A level without a value: its row is left out, the level isn't drawn.
    expect(titles()).toEqual(['Low', 'High', 'Mid'])
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col: 'c' as ColumnId, sub: 0, row: 14, value: 40 }],
    })
    expect(titles()).toEqual(['Low', 'High', 'Mid', 'Late'])
    store.dispatch({
      type: 'table.setExcluded',
      table: table.id,
      cells: [{ col: 'c' as ColumnId, sub: 0, row: 14 }],
      excluded: true,
    })
    expect(titles()).toEqual(['Low', 'High', 'Mid'])
    expect(scene().warnings).toContain(
      '2 rows without a value of Score (empty or excluded) left out.',
    )
  })

  it('the order of levels is an undoable edit; a point’s format follows its row', () => {
    const { store, g, titles, table } = setup()
    store.dispatch({ type: 'node.set', id: g().id, path: ['levels', 'a'], value: ['Mid', 'Low'] })
    expect(titles()).toEqual(['Mid', 'Low', 'High'])
    store.undo()
    expect(titles()).toEqual(['Low', 'High', 'Mid'])
    // A point of row 3 (Low) formatted, then row 1 deleted: the format moves to row 2.
    const low = levelKey('Low')
    store.dispatch({
      type: 'node.set',
      id: g().id,
      path: ['pointOverrides', low, 'r3s0'],
      value: { size: 9 },
    })
    store.dispatch({ type: 'table.deleteRows', table: table.id, rows: [1] })
    expect(g().pointOverrides?.[low]).toEqual({ r2s0: { size: 9 } })
  })

  it('survives a save and reopen (and the schema)', () => {
    const { store, g } = setup({ a: ['Mid', 'Gone'] })
    const bytes = writeProjectFile(store.getState())
    const back = readProjectFile(bytes).project
    const graph = back.nodes['g1' as NodeId] as GraphNode
    expect(graph.mapping).toEqual(g().mapping)
    expect(graph.levels).toEqual({ a: ['Mid', 'Gone'] })
    expect(parseProject(JSON.parse(JSON.stringify(back)))).toBeTruthy()
    const table = back.nodes['t1' as NodeId] as DataTable
    expect(resolveSeries(back, graph).map((s) => s.title)).toEqual(['Mid', 'Low', 'High'])
    expect(table.dataSets[0]!.text?.[0]).toBe('Low')
  })
})
