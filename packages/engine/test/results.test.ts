import {
  type AnalysisDef,
  type AnalysisNode,
  type AnalysisResult,
  type Annotation,
  createProject,
  createTable,
  type DataTable,
  type GraphNode,
  type Layer,
  type NodeId,
  newAnnotationId,
  newNodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { type AnalysisRegistry, DocumentStore, prepareJob, remapNode } from '../src/index.ts'
import { POINTS, testGraph, XY } from './graphs.ts'
import { startedEngine } from './helpers.ts'

// Results on graphs (roadmap 35) in the engine: analyses of the values at one X and of pooled
// data sets; result layers and tables removed with their analysis, following its copies.

/** Sums every value of each data set: `sum:<key>` per data set, `kind` the run's table kind. */
const sumDef: AnalysisDef<Record<string, never>> = {
  id: 'sum',
  version: 1,
  title: 'Sum',
  category: 'Test',
  description: 'Sums values.',
  form: [],
  accepts: ['column', 'xy', 'grouped'],
  inputs: { min: 1, max: 8 },
  params: z.object({}),
  run(input, _params, context) {
    const values: AnalysisResult['values'] = {
      kind: { kind: 'text', v: context?.tableKind ?? '' },
    }
    for (const ds of input) {
      let total = 0
      if (ds.data.shape === 'replicates')
        for (const rep of ds.data.reps) for (const v of rep) if (!Number.isNaN(v)) total += v
      values[`sum:${ds.ref.key}`] = { kind: 'number', v: total }
      values[`title:${ds.ref.key}`] = { kind: 'text', v: ds.title }
    }
    return { status: 'ok', diagnostics: [], sheets: [], values, comparisons: [], outputs: {} }
  },
}
const registry: AnalysisRegistry = {
  engineVersion: 'test',
  get: (id) => (id === 'sum' ? (sumDef as AnalysisDef<unknown>) : undefined),
}

/** An XY table: X 0, 24, 72; two data sets of two replicates. */
function xyTable(): DataTable {
  const t = createTable({
    tableKind: 'xy',
    rows: 3,
    columns: 2,
    yFormat: { type: 'replicates', count: 2 },
  })
  t.x!.subcolumns[0]!.values = [0, 24, 72]
  t.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
  t.dataSets[0]!.subcolumns[1]!.values = [1, 2, 4]
  t.dataSets[1]!.subcolumns[0]!.values = [5, 6, 7]
  t.dataSets[1]!.subcolumns[1]!.values = [5, 6, 8]
  return t
}

const analysisOf = (
  table: DataTable,
  input: Partial<AnalysisNode['input']> = {},
): AnalysisNode => ({
  kind: 'analysis',
  id: newNodeId(),
  name: 'Sum',
  analysisId: 'sum',
  pluginVersion: 1,
  input: { source: table.id, dataSets: table.dataSets.map((d) => d.id), ...input },
  params: {},
})

const num = (r: AnalysisResult | undefined, k: string) => (r?.values[k] as { v: unknown })?.v

describe('the values at one X and pooled data sets', () => {
  it('analyzes each data set’s replicates at that X as a column table’s data sets', async () => {
    const table = xyTable()
    const analysis = analysisOf(table, { atX: 72 })
    const store = new DocumentStore(createProject())
    store.dispatch([
      { type: 'node.add', node: table },
      { type: 'node.add', node: analysis },
    ])
    const engine = await startedEngine(store, registry)
    const [a, b] = table.dataSets.map((d) => d.id)
    const r = engine.latest(analysis.id)
    expect(num(r, `sum:${a}`)).toBe(7)
    expect(num(r, `sum:${b}`)).toBe(15)
    expect(num(r, 'kind')).toBe('column')
    // Values at another X don't change its input: it doesn't rerun.
    const before = prepareJob(store.getState(), analysis, registry)
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col: a!, sub: 0, row: 0, value: 100 }],
    })
    const after = prepareJob(store.getState(), analysis, registry)
    expect(after.inputKey).toBe(before.inputKey)
    // At 72 it does (live).
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col: a!, sub: 0, row: 2, value: 10 }],
    })
    await engine.idle()
    expect(num(engine.latest(analysis.id), `sum:${a}`)).toBe(14)
  })

  it('pools data sets into one under the first one’s key', async () => {
    const table = createTable({ tableKind: 'column', rows: 2, columns: 3 })
    table.dataSets.forEach((d, i) => {
      d.subcolumns[0]!.values = [i + 1, 10 * (i + 1)]
    })
    const [a, b, c] = table.dataSets.map((d) => d.id)
    const analysis = analysisOf(table, { pools: [[a!, c!]] })
    const store = new DocumentStore(createProject())
    store.dispatch([
      { type: 'node.add', node: table },
      { type: 'node.add', node: analysis },
    ])
    const engine = await startedEngine(store, registry)
    const r = engine.latest(analysis.id)
    expect(num(r, `sum:${a}`)).toBe(44)
    expect(num(r, `sum:${b}`)).toBe(22)
    expect(num(r, `sum:${c}`)).toBeUndefined()
    expect(num(r, `title:${a}`)).toBe('Group A + Group C')
  })

  it('says why it can’t: no X values, pooled means', () => {
    const column = createTable({ tableKind: 'column', rows: 2, columns: 2 })
    const doc = createProject()
    doc.nodes[column.id] = column
    const prepared = prepareJob(doc, analysisOf(column, { atX: 1 }), registry)
    expect(prepared).toMatchObject({
      ok: false,
      message: 'Values at one X need a table with X values.',
    })
  })
})

const resultLayer = (analysis: NodeId, key: string): Layer => ({
  id: 'result',
  geom: 'label',
  stat: {
    kind: 'result',
    fields: { s: { ref: { from: 'value', key } } },
    template: 'Sum = {s}',
  },
  data: { from: 'analysis', analysis },
})

describe('result layers and tables', () => {
  function setup() {
    const table = xyTable()
    const analysis = analysisOf(table)
    const [a] = table.dataSets.map((d) => d.id)
    const table2: Annotation = {
      type: 'table',
      id: newAnnotationId(),
      analysis: analysis.id,
      sheet: 'results',
    }
    const graph: GraphNode = testGraph(table.id, {
      ...XY,
      layers: [POINTS, resultLayer(analysis.id, `sum:${a}`)],
      annotations: [table2],
    })
    const store = new DocumentStore(createProject())
    store.dispatch([
      { type: 'node.add', node: table },
      { type: 'node.add', node: analysis },
      { type: 'node.add', node: graph },
    ])
    return { store, table, analysis, graph, a: a! }
  }

  it('go with their analysis (decision 35), and come back with undo', () => {
    const { store, analysis, graph } = setup()
    store.dispatch({ type: 'node.remove', id: analysis.id })
    const g = store.getState().nodes[graph.id] as GraphNode
    expect(g.layers.map((l) => l.id)).toEqual(['points'])
    expect(g.annotations).toEqual([])
    store.undo()
    const back = store.getState().nodes[graph.id] as GraphNode
    expect(back.layers.map((l) => l.id)).toEqual(['points', 'result'])
    expect(back.annotations).toHaveLength(1)
  })

  it('follow their analysis’ copy, the keys they read following the data sets', () => {
    const { graph, analysis, a } = setup()
    const copy = newNodeId()
    const moved = remapNode(graph, {
      nodes: new Map([[analysis.id, copy]]),
      keys: new Map([[a, 'zz']]),
    })
    expect(moved.layers[1]!.data).toEqual({ from: 'analysis', analysis: copy })
    expect(moved.layers[1]!.stat).toMatchObject({
      fields: { s: { ref: { from: 'value', key: 'sum:zz' } } },
    })
    expect(moved.annotations[0]).toMatchObject({ type: 'table', analysis: copy })
  })

  it('make the graph depend on the analysis', () => {
    const { store, graph, analysis } = setup()
    const doc = store.getState()
    expect(doc.nodes[graph.id]).toBeDefined()
    // A graph naming an analysis that isn't there is refused (the project's references).
    expect(() =>
      store.dispatch({
        type: 'node.set',
        id: graph.id,
        path: ['layers', { id: 'result' }, 'data', 'analysis'],
        value: 'nowhere',
      }),
    ).toThrow()
    expect((store.getState().nodes[graph.id] as GraphNode).layers[1]!.data).toEqual({
      from: 'analysis',
      analysis: analysis.id,
    })
  })
})
