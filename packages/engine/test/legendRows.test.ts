import { createProject, createTable, type GraphNode, type NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { DocumentStore } from '../src/index.ts'
import { testGraph } from './graphs.ts'

// Audit 3 (G1): a pie's legend entries are its categories, keyed by table row
// (`category/<row>`): their legend-only labels, hidden entries and order follow the rows through
// inserts, deletes and sorts, as single slices' formats do.

function setup() {
  const p = createProject()
  const t = createTable({ tableKind: 'partsOfWhole', rows: 4, columns: 1 })
  t.dataSets[0]!.subcolumns[0]!.values = [4, 3, 2, 1]
  t.rowTitles = ['A', 'B', 'C', 'D']
  const g = testGraph(t.id, {
    id: 'pie' as NodeId,
    frame: 'polar',
    look: 'whole.pie',
    legend: {
      show: true,
      position: 'right',
      labels: { 'category/1': [{ text: 'Bee' }] },
      hidden: ['category/2'],
      order: ['category/3', 'category/1'],
    },
  })
  p.nodes[t.id] = t
  p.nodes[g.id] = g
  p.order.push(t.id, g.id)
  const store = new DocumentStore(p)
  const legend = () => (store.getState().nodes[g.id] as GraphNode).legend
  return { store, t, legend }
}

describe('a pie’s legend keys follow their rows', () => {
  it('through a delete, an insert and a sort, and back with undo', () => {
    const { store, t, legend } = setup()
    store.dispatch({ type: 'table.deleteRows', table: t.id, rows: [0] })
    expect(legend().labels).toEqual({ 'category/0': [{ text: 'Bee' }] })
    expect(legend().hidden).toEqual(['category/1'])
    expect(legend().order).toEqual(['category/2', 'category/0'])
    store.dispatch({ type: 'table.insertRows', table: t.id, at: 0, count: 2 })
    expect(legend().labels).toEqual({ 'category/2': [{ text: 'Bee' }] })
    expect(legend().hidden).toEqual(['category/3'])
    // A sort (the rows reversed): row 2 is now row 2 from the end.
    store.dispatch({ type: 'table.permuteRows', table: t.id, order: [4, 3, 2, 1, 0] })
    expect(legend().labels).toEqual({ 'category/2': [{ text: 'Bee' }] })
    expect(legend().hidden).toEqual(['category/1'])
    expect(legend().order).toEqual(['category/0', 'category/2'])
    store.undo()
    store.undo()
    store.undo()
    expect(legend().labels).toEqual({ 'category/1': [{ text: 'Bee' }] })
  })

  it('drops the keys of rows deleted', () => {
    const { store, t, legend } = setup()
    store.dispatch({ type: 'table.deleteRows', table: t.id, rows: [1, 2] })
    expect(legend().labels ?? {}).toEqual({})
    expect(legend().hidden).toEqual([])
    expect(legend().order).toEqual(['category/1'])
  })
})
