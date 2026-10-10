import { registry } from '@ps/analyses'
import { DocumentStore } from '@ps/engine'
import { layoutGraph, presetGraph, type Scene } from '@ps/graph'
import {
  type AnalysisNode,
  type ColumnId,
  createProject,
  createTable,
  type DataTable,
  type GraphNode,
  type NodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { startedEngine } from '../../engine/test/helpers.ts'
import { flatten, fonts } from '../../graph/test/helpers.ts'
import {
  groupBracketCommands,
  perDataSetRef,
  resultAnalyses,
  sheetValues,
  showOnGraphsCommands,
  templatesFor,
  xBracketCommands,
  xValuesOf,
} from '../src/graph/results/resultActions.ts'

// Results on graphs (roadmap 35) with the real analyses: a correlation's "r and P" shown on the
// table's graphs from the analysis dialog, live after a data edit, undone and redone; brackets at
// one X and from a group to one with their analyses; picking any value of the results.

const textOf = (s: Scene, prefix: string) =>
  flatten(s.root)
    .filter((n) => n.id.startsWith(prefix) && n.prim?.type === 'text')
    .map((n) => (n.prim?.type === 'text' ? n.prim.layout.runs.map((r) => r.text).join('') : ''))

function xyTable(): DataTable {
  const t = createTable({
    tableKind: 'xy',
    columns: 2,
    rows: 8,
    yFormat: { type: 'replicates', count: 2 },
  })
  t.id = 't1' as NodeId
  t.name = 'Time course'
  t.x!.subcolumns[0]!.values = [0, 6, 12, 24, 36, 48, 60, 72]
  t.dataSets.forEach((d, i) => {
    d.id = String.fromCharCode(97 + i) as ColumnId
    d.title = ['NT', 'KO'][i]!
  })
  const ys = (k: number, j: number) =>
    [0, 6, 12, 24, 36, 48, 60, 72].map((x, r) => 10 + x * (k + 1) * 0.1 + ((r * 3 + j * 5 + k) % 4))
  for (const [k, d] of t.dataSets.entries())
    d.subcolumns.forEach((s, j) => {
      s.values = ys(k, j)
    })
  return t
}

async function setup(table: DataTable, preset: string) {
  const store = new DocumentStore(createProject('P', new Date('2026-01-01T00:00:00Z')))
  store.dispatch({ type: 'node.add', node: table })
  const graph = { ...presetGraph(table, preset), id: 'g1' as NodeId }
  store.dispatch({ type: 'node.add', node: graph })
  const engine = await startedEngine(store, registry)
  const scene = () =>
    layoutGraph({
      project: store.getState(),
      graph: store.getState().nodes[graph.id] as GraphNode,
      fonts,
      result: (id) => engine.latest(id),
    })
  return { store, engine, graph, scene }
}

const analysisOf = (table: DataTable, analysisId: string, params: object = {}): AnalysisNode => ({
  kind: 'analysis',
  id: `an${analysisId}`.toLowerCase().replace(/[^0-9a-z]/g, '') as NodeId,
  name: analysisId,
  analysisId,
  pluginVersion: registry.get(analysisId)!.version,
  input: { source: table.id, dataSets: table.dataSets.map((d) => d.id) },
  params: registry.get(analysisId)!.params.parse(params),
})

describe('a correlation’s r and P on its table’s graphs', () => {
  it('shown from the analysis dialog, live after an edit, undone and redone', async () => {
    const table = xyTable()
    const { store, engine, scene } = await setup(table, 'meanSd')
    const corr = analysisOf(table, 'correlation')
    const offered = templatesFor(store.getState(), corr, null).filter((t) => t.offer)
    expect(offered.map((t) => t.offer)).toEqual(['Show r and P on the graph'])
    store.dispatch(
      [
        { type: 'node.add', node: corr },
        ...showOnGraphsCommands(store.getState(), corr, offered, (id) => engine.latest(id)),
      ],
      'New Correlation',
    )
    await engine.idle()
    const before = textOf(scene(), 'result/')
    expect(before).toHaveLength(2)
    expect(before[0]).toMatch(/^r = 0\.\d\d, P [<=] /)
    // An edit of the data: the label follows.
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col: 'a' as ColumnId, sub: 0, row: 7, value: 2 }],
    })
    await engine.idle()
    const after = textOf(scene(), 'result/')
    expect(after[0]).not.toBe(before[0])
    // Undo the edit, then the label: gone; redo: back.
    store.undo()
    await engine.idle()
    expect(textOf(scene(), 'result/')).toEqual(before)
    store.undo()
    expect(textOf(scene(), 'result/')).toEqual([])
    store.redo()
    await engine.idle()
    expect(textOf(scene(), 'result/')).toEqual(before)
    // The analysis removed: its label goes with it.
    store.dispatch({ type: 'node.remove', id: corr.id })
    expect(textOf(scene(), 'result/')).toEqual([])
    expect(
      resultAnalyses(store.getState(), store.getState().nodes['g1' as NodeId] as GraphNode),
    ).toEqual([])
  })
})

describe('brackets with their analyses', () => {
  it('at one X: a t test of the values there, labelling the bracket live', async () => {
    const table = xyTable()
    const { store, engine, graph, scene } = await setup(table, 'meanSd')
    expect(xValuesOf(table)).toEqual([0, 6, 12, 24, 36, 48, 60, 72])
    const { analysis, commands } = xBracketCommands(graph, table, {
      x: 72,
      a: 'a',
      b: 'b',
      test: 'ttest',
      show: 'p',
    })
    store.dispatch(commands, 'Add bracket at one X')
    await engine.idle()
    const r = engine.latest(analysis.id)!
    expect(r.status).toBe('ok')
    expect(analysis.input.atX).toBe(72)
    expect(textOf(scene(), 'annotation/')[0]).toMatch(/^P [<=] /)
    // One undo step removes both.
    store.undo()
    expect(store.getState().nodes[analysis.id]).toBeUndefined()
  })

  it('from a group to one: the group pooled against the one', async () => {
    const t = createTable({ tableKind: 'column', columns: 4, rows: 3 })
    t.id = 't2' as NodeId
    const values = [
      [10, 12, 11],
      [11, 13, 12],
      [9, 12, 10],
      [18, 21, 20],
    ]
    t.dataSets.forEach((d, i) => {
      d.id = String.fromCharCode(97 + i) as ColumnId
      d.title = ['HC1', 'HC2', 'HC3', 'P1'][i]!
      d.subcolumns[0]!.values = values[i]!
    })
    const { store, engine, graph, scene } = await setup(t, 'bars')
    const r = groupBracketCommands(graph, t, {
      group: ['a', 'b', 'c'],
      one: 'd',
      test: 'ttest',
      show: 'p',
    })
    if ('error' in r) throw new Error(r.error)
    store.dispatch(r.commands, 'Add bracket')
    await engine.idle()
    const res = engine.latest(r.analysis.id)!
    expect(res.status).toBe('ok')
    // Nine pooled values against three.
    expect(res.comparisons[0]?.key).toBe('a|d')
    expect(textOf(scene(), 'annotation/')[0]).toMatch(/^P [<=] /)
    expect(
      groupBracketCommands(graph, t, { group: ['a'], one: 'd', test: 'ttest', show: 'p' }),
    ).toEqual({
      error: 'Choose two or more data sets for the group.',
    })
  })
})

describe('a bracket from a group to one on a grouped graph', () => {
  it('pools the group’s cells of the row (multiple t tests per row), the bracket in that row', async () => {
    const t = createTable({
      tableKind: 'grouped',
      columns: 4,
      rows: 2,
      yFormat: { type: 'replicates', count: 3 },
    })
    t.id = 't3' as NodeId
    t.dataSets.forEach((d, i) => {
      d.id = String.fromCharCode(97 + i) as ColumnId
      d.title = ['HC1', 'HC2', 'HC3', 'P1'][i]!
      d.subcolumns.forEach((s, j) => {
        s.values = [i === 3 ? 20 + j : 10 + i + j, i === 3 ? 30 + j : 15 + j]
      })
    })
    t.rowTitles = ['LPS', 'LPS + nigericin']
    const { store, engine, graph, scene } = await setup(t, 'bars')
    const r = groupBracketCommands(graph, t, {
      group: ['a', 'b', 'c'],
      one: 'd',
      row: 1,
      test: 'ttest',
      show: 'p',
    })
    if ('error' in r) throw new Error(r.error)
    store.dispatch(r.commands, 'Add bracket')
    await engine.idle()
    const res = engine.latest(r.analysis.id)!
    expect(res.status).not.toBe('error')
    expect(res.comparisons.map((c) => c.key)).toContain('row1:a|d')
    expect(textOf(scene(), 'annotation/')[0]).toMatch(/^P [<=] /)
  })
})

describe('picking a value of the results', () => {
  it('lists every cell by its keys; per data set, a title becomes {dataSet}', async () => {
    const table = xyTable()
    const { store, engine } = await setup(table, 'meanSd')
    const lin = analysisOf(table, 'linearRegression')
    store.dispatch({ type: 'node.add', node: lin })
    await engine.idle()
    const sheets = sheetValues(engine.latest(lin.id)!, store.getState().settings)
    const best = sheets[0]!.blocks.find((b) => b.title === 'Best-fit values')!
    const slope = best.rows[0]![1]!
    expect(slope.ref).toEqual({
      from: 'cell',
      sheet: 'results',
      block: 'Best-fit values',
      row: 'Slope',
      column: 'KO',
    })
    expect(slope.where).toBe('Table of results › Best-fit values › Slope › KO')
    expect(perDataSetRef(slope.ref, ['NT', 'KO'])).toMatchObject({ column: '{dataSet}' })
  })
})
