import {
  type AnalysisNode,
  createProject,
  createTable,
  type DataTable,
  type GraphNode,
  graphRefs,
  newColumnId,
  newNodeId,
  sourceTable,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { CommandError, DocumentStore, swapXYProblem } from '../src/index.ts'
import { testGraph } from './graphs.ts'

// Roadmap 38: Swap X and Y on XY tables (one command, undoable, references following), and
// calculated text variables converted to values.

function xyStore() {
  const table = createTable({ tableKind: 'xy', rows: 3, columns: 2 })
  table.x!.title = 'Dose'
  table.x!.subcolumns[0]!.values = [1, 2, 3]
  table.x!.subcolumns[0]!.excluded = [false, true, false]
  table.dataSets[0]!.title = 'Response'
  table.dataSets[0]!.subcolumns[0]!.values = [10, 20, 30]
  table.dataSets[1]!.title = 'Other'
  table.dataSets[1]!.subcolumns[0]!.values = [5, 6, 7]
  table.columnWidths = { x: 80, [table.dataSets[0]!.id]: 120 }
  const store = new DocumentStore(createProject())
  store.dispatch({ type: 'node.add', node: table })
  const graph: GraphNode = testGraph(table.id, {
    seriesSource: { table: table.id, include: [table.dataSets[0]!.id] },
  })
  const analysis: AnalysisNode = {
    kind: 'analysis',
    id: newNodeId(),
    name: 'a',
    analysisId: 'linearRegression',
    pluginVersion: 1,
    input: { source: table.id, dataSets: [table.dataSets[0]!.id, table.dataSets[1]!.id] },
    params: { some: table.dataSets[0]!.id },
  }
  store.dispatch([
    { type: 'node.add', node: graph },
    { type: 'node.add', node: analysis },
  ])
  const t = () => store.getState().nodes[table.id] as DataTable
  return { store, table, graph, analysis, t }
}

describe('Swap X and Y', () => {
  it('makes a data set X and the old X a data set in its place, in one undo step', () => {
    const { store, table, graph, analysis, t } = xyStore()
    const before = store.getState()
    const resp = table.dataSets[0]!.id
    const id = newColumnId()
    store.dispatch({ type: 'table.swapXY', table: table.id, dataSet: resp, id })
    expect(t().x!.title).toBe('Response')
    expect(t().x!.subcolumns[0]!.values).toEqual([10, 20, 30])
    const old = t().dataSets[0]!
    expect(old.id).toBe(id)
    expect(old.title).toBe('Dose')
    expect(old.subcolumns[0]!.values).toEqual([1, 2, 3])
    // Exclusions move with their values.
    expect(old.subcolumns[0]!.excluded).toEqual([false, true, false])
    expect(t().dataSets[1]!.title).toBe('Other')
    expect(t().columnWidths).toEqual({ x: 120, [id]: 80 })
    // The graph and the analysis now name the old X.
    const g = store.getState().nodes[graph.id] as GraphNode
    expect(g.seriesSource.include).toEqual([id])
    expect(graphRefs(g).some((r) => r.kind === 'key' && r.key === resp)).toBe(false)
    const a = store.getState().nodes[analysis.id] as AnalysisNode
    expect(a.input.dataSets).toEqual([id, table.dataSets[1]!.id])
    expect(a.params).toEqual({ some: id })
    expect(store.undoLabel).toBe('Swap X and Y')
    store.undo()
    expect(store.getState()).toEqual(before)
    // Swapping back gives the original values again.
    store.redo()
    store.dispatch({ type: 'table.swapXY', table: table.id, dataSet: id, id: newColumnId() })
    expect(t().x!.title).toBe('Dose')
    expect(t().x!.subcolumns[0]!.values).toEqual([1, 2, 3])
    expect(t().dataSets[0]!.subcolumns[0]!.values).toEqual([10, 20, 30])
  })

  it('refuses tables with replicates, summary data or X errors, with a reason', () => {
    const reps = createTable({
      tableKind: 'xy',
      rows: 2,
      columns: 1,
      yFormat: { type: 'replicates', count: 3 },
    })
    expect(swapXYProblem(reps, reps.dataSets[0]!.id)).toContain('replicates')
    const sum = createTable({
      tableKind: 'xy',
      rows: 2,
      columns: 1,
      yFormat: { type: 'summary', preset: 'meanSd' },
    })
    expect(swapXYProblem(sum, sum.dataSets[0]!.id)).toContain('summary')
    const col = createTable({ tableKind: 'column', rows: 2, columns: 1 })
    expect(swapXYProblem(col, col.dataSets[0]!.id)).toContain('XY tables')
    const store = new DocumentStore(createProject())
    store.dispatch({ type: 'node.add', node: reps })
    expect(() =>
      store.dispatch({
        type: 'table.swapXY',
        table: reps.id,
        dataSet: reps.dataSets[0]!.id,
        id: newColumnId(),
      }),
    ).toThrow(CommandError)
  })
})

describe('calculated text variables', () => {
  it('convert to text values, and are text variables to graphs (sourceTable)', () => {
    const table = createTable({ tableKind: 'multipleVariables', rows: 3, columns: 2 })
    table.dataSets[0]!.title = 'type'
    table.dataSets[0]!.text = ['CD4 T', 'CD8 T', 'B']
    table.dataSets[1]!.title = 'lineage'
    table.dataSets[1]!.formula = '=recode(type, "CD4 T", "T", "CD8 T", "T")'
    const store = new DocumentStore(createProject())
    store.dispatch({ type: 'node.add', node: table })
    const resolved = sourceTable(store.getState(), table.id)!
    expect(resolved.dataSets[1]!.text).toEqual(['T', 'T', 'B'])
    store.dispatch({
      type: 'table.setFormula',
      table: table.id,
      id: table.dataSets[1]!.id,
      formula: null,
    })
    const t = store.getState().nodes[table.id] as DataTable
    expect(t.dataSets[1]!.text).toEqual(['T', 'T', 'B'])
    expect(t.dataSets[1]!.formula).toBeUndefined()
    // Edits of the source follow live before converting: undo brings the formula back.
    store.undo()
    store.dispatch({
      type: 'table.setText',
      table: table.id,
      edits: [{ col: table.dataSets[0]!.id, row: 2, value: 'CD8 T' }],
    })
    expect(sourceTable(store.getState(), table.id)!.dataSets[1]!.text).toEqual(['T', 'T', 'T'])
  })
})
