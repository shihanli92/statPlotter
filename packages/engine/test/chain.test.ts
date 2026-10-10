import {
  type AnalysisDef,
  type AnalysisNode,
  type AnalysisResult,
  type ColumnId,
  createProject,
  createTable,
  type DataTable,
  type NodeId,
  newNodeId,
  type Project,
  type RunContext,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type AnalysisJob,
  type AnalysisRegistry,
  analysisOrder,
  ComputeEngine,
  DocumentStore,
  inlineRunner,
  type JobRunner,
} from '../src/index.ts'
import { startedEngine } from './helpers.ts'

// Chaining: analyses and graphs of the table another analysis produces (Transform, Normalize…).

const empty = (): AnalysisResult => ({
  status: 'ok',
  diagnostics: [],
  sheets: [],
  values: {},
  comparisons: [],
  outputs: {},
})

/**
 * Test-only plugin that produces a table: each input data set's first subcolumn times `factor`,
 * as a column table whose data set ids are the input keys (stable across runs). `label` doesn't
 * change the table.
 */
const scaleDef: AnalysisDef<{ factor: number; label: string }> = {
  id: 'test.scale',
  version: 1,
  title: 'Scale (test)',
  category: 'Test',
  description: 'Multiplies values.',
  form: [],
  accepts: ['column'],
  inputs: { min: 1, max: 10 },
  params: z.object({ factor: z.number().default(2), label: z.string().default('') }),
  producesTable: true,
  run(input, params) {
    const rowCount = Math.max(0, ...input.map((d) => d.rowCount))
    const table: DataTable = {
      kind: 'table',
      id: 'ignored' as NodeId,
      name: 'Scaled',
      tableKind: 'column',
      yFormat: { type: 'replicates', count: 1 },
      rowCount,
      rowTitles: null,
      x: null,
      dataSets: input.map((ds) => {
        const rep = ds.data.shape === 'replicates' ? ds.data.reps[0]! : ds.data.mean
        return {
          id: ds.ref.key as ColumnId,
          title: `${ds.title} × ${params.factor}`,
          subcolumns: [
            {
              type: 'number' as const,
              values: Array.from({ length: rowCount }, (_, r) => {
                const v = rep[r]
                return v === undefined || Number.isNaN(v) ? null : v * params.factor
              }),
            },
          ],
        }
      }),
      notes: '',
    }
    return { ...empty(), table }
  },
}

/** Sums the first replicate of each input; records the context it ran with. */
const contexts: RunContext[] = []
const sumDef: AnalysisDef<Record<string, never>> = {
  id: 'test.sum',
  version: 1,
  title: 'Sum',
  category: 'Test',
  description: 'Sums values.',
  form: [],
  accepts: ['column'],
  inputs: { min: 1, max: 10 },
  params: z.object({}),
  run(input, _params, context) {
    if (context) contexts.push(context)
    let total = 0
    for (const ds of input) {
      if (ds.data.shape !== 'replicates') continue
      for (const v of ds.data.reps[0]!) if (!Number.isNaN(v)) total += v
    }
    return {
      ...empty(),
      values: {
        total: { kind: 'number', v: total },
        source: { kind: 'text', v: input.map((d) => d.ref.node).join(',') },
      },
    }
  },
}

const DEFS = [scaleDef, sumDef] as unknown as AnalysisDef<unknown>[]
const registry: AnalysisRegistry = {
  engineVersion: 'test',
  get: (id) => DEFS.find((d) => d.id === id),
}

const total = (r: AnalysisResult | undefined) => (r?.values.total as { v: number } | undefined)?.v

function analysisNode(analysisId: string, source: NodeId, dataSets: string[]): AnalysisNode {
  return {
    kind: 'analysis',
    id: newNodeId(),
    name: analysisId,
    analysisId,
    pluginVersion: 1,
    input: { source, dataSets },
    params: {},
  }
}

/** Data (2 columns) → scale → sum. The sum is added first, to check ordering. */
function chain() {
  const table = createTable({ rows: 3, columns: 2 })
  const [a, b] = table.dataSets.map((d) => d.id)
  table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
  table.dataSets[1]!.subcolumns[0]!.values = [10, null, null]
  const scale = analysisNode('test.scale', table.id, [a!])
  const sum = analysisNode('test.sum', scale.id, [a!])
  const project: Project = createProject()
  // Downstream before upstream in both the node record and the order.
  for (const n of [table, sum, scale]) {
    project.nodes[n.id] = n
    project.order.push(n.id)
  }
  const store = new DocumentStore(project)
  const set = (col: ColumnId, row: number, value: number | null) =>
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col, sub: 0, row, value }],
    })
  return { store, table, a: a!, b: b!, scale, sum, set }
}

function counting(inner: JobRunner = inlineRunner(registry)) {
  const calls: AnalysisJob[] = []
  const runner: JobRunner = (job) => {
    calls.push(job)
    return inner(job)
  }
  return { calls, runner, of: (id: string) => calls.filter((c) => c.analysisId === id).length }
}

describe('analysis order', () => {
  it('puts analyses after the analyses whose results they read', () => {
    const { store, scale, sum } = chain()
    const { order, cyclic } = analysisOrder(store.getState())
    expect(order.map((n) => n.id)).toEqual([scale.id, sum.id])
    expect(cyclic.size).toBe(0)
  })

  it('finds cycles (and what depends on them)', () => {
    const p = createProject()
    const a = analysisNode('test.sum', 'x' as NodeId, [])
    const b = analysisNode('test.sum', a.id, [])
    const c = analysisNode('test.sum', b.id, [])
    a.input.source = b.id
    for (const n of [a, b, c]) p.nodes[n.id] = n
    const { cyclic } = analysisOrder(p)
    expect([...cyclic].sort()).toEqual([a.id, b.id, c.id].sort())
  })
})

describe('chained analyses', () => {
  it('computes upstream first and analyzes its result table', async () => {
    const { store, scale, sum } = chain()
    const engine = await startedEngine(store, registry)
    expect(engine.latest(scale.id)!.table!.dataSets[0]!.subcolumns[0]!.values).toEqual([2, 4, 6])
    expect(engine.get(sum.id)?.status).toBe('ready')
    expect(total(engine.latest(sum.id))).toBe(12)
    // The result table is addressed by the analysis node's id, not the plugin's.
    expect(engine.latest(sum.id)?.values.source).toEqual({ kind: 'text', v: scale.id })
  })

  it('passes the result table’s kind and X title as the run context', async () => {
    contexts.length = 0
    const { store } = chain()
    await startedEngine(store, registry)
    expect(contexts).toEqual([{ tableKind: 'column', xTitle: null }])
  })

  it('recomputes downstream when the upstream result changes', async () => {
    const { calls, runner, of } = counting()
    const { store, a, sum, set } = chain()
    const engine = await startedEngine(store, registry, runner)
    expect(calls).toHaveLength(2)

    set(a, 0, 100)
    await engine.idle()
    expect(total(engine.latest(sum.id))).toBe(2 * (100 + 2 + 3))
    expect(of('test.scale')).toBe(2)
    expect(of('test.sum')).toBe(2)
  })

  it('does not rerun downstream when the upstream table comes out the same', async () => {
    const { runner, of } = counting()
    const { store, b, scale, set } = chain()
    const engine = await startedEngine(store, registry, runner)

    // A parameter that doesn't change the table reruns only the upstream analysis.
    store.dispatch({
      type: 'analysis.setParams',
      id: scale.id,
      params: { factor: 2, label: 'renamed' },
    })
    await engine.idle()
    expect(of('test.scale')).toBe(2)
    expect(of('test.sum')).toBe(1)

    // Data the upstream analysis doesn't read reruns nothing.
    set(b, 1, 5)
    await engine.idle()
    expect(of('test.scale')).toBe(2)
    expect(of('test.sum')).toBe(1)
  })

  it('waits while the upstream result is computing, keeping the previous result', async () => {
    const pending: { job: AnalysisJob; resolve: (r: AnalysisResult) => void }[] = []
    const held: JobRunner = (job) => new Promise((resolve) => pending.push({ job, resolve }))
    const inner = inlineRunner(registry)
    const release = async () => {
      const p = pending.shift()!
      p.resolve(await inner(p.job))
      await Promise.resolve()
      await Promise.resolve()
    }
    const { store, a, scale, sum, set } = chain()
    const engine = new ComputeEngine(store, registry, held)
    engine.start()
    expect(engine.get(sum.id)).toMatchObject({
      status: 'pending',
      message: `The analyzed result “${scale.name}” is still computing.`,
    })
    expect(pending.map((p) => p.job.analysisId)).toEqual(['test.scale'])

    await release() // scale done → sum starts
    expect(engine.get(scale.id)?.status).toBe('ready')
    expect(pending.map((p) => p.job.analysisId)).toEqual(['test.sum'])
    await release()
    expect(total(engine.latest(sum.id))).toBe(12)

    set(a, 0, 0)
    expect(engine.get(sum.id)?.status).toBe('pending')
    expect(total(engine.latest(sum.id))).toBe(12) // previous result shown meanwhile
    await release()
    await release()
    await engine.idle()
    expect(total(engine.latest(sum.id))).toBe(10)
  })

  it('reports an upstream result without a table', async () => {
    const { store, table, a } = chain()
    const sum1 = analysisNode('test.sum', table.id, [a])
    const sum2 = analysisNode('test.sum', sum1.id, [a])
    store.dispatch([
      { type: 'node.add', node: sum1 },
      { type: 'node.add', node: sum2 },
    ])
    const engine = await startedEngine(store, registry)
    expect(engine.get(sum2.id)).toMatchObject({
      status: 'error',
      message: 'The analyzed result “test.sum” has no data table.',
    })
  })

  it('reports an upstream failure, and recovers when it is fixed', async () => {
    const { store, scale, sum } = chain()
    const engine = await startedEngine(store, registry)
    store.dispatch({ type: 'analysis.setParams', id: scale.id, params: { factor: 'x' } })
    await engine.idle()
    expect(engine.get(sum.id)).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/“test\.scale” could not be computed: Invalid parameters/),
    })
    store.undo()
    await engine.idle()
    expect(engine.get(sum.id)?.status).toBe('ready')
    expect(total(engine.latest(sum.id))).toBe(12)
  })

  it('reports data sets missing from the result table', async () => {
    const { store, sum } = chain()
    store.dispatch({ type: 'analysis.setInput', id: sum.id, dataSets: ['nosuchcolumn'] })
    const engine = await startedEngine(store, registry)
    expect(engine.get(sum.id)).toMatchObject({ status: 'error', message: /no longer exists/ })
  })

  it('guards against cycles in a hand-made document', async () => {
    const p = createProject()
    const a = analysisNode('test.scale', 'x' as NodeId, [])
    const b = analysisNode('test.scale', a.id, [])
    a.input.source = b.id
    for (const n of [a, b]) {
      p.nodes[n.id] = n
      p.order.push(n.id)
    }
    const engine = await startedEngine(p, registry)
    expect(engine.get(a.id)).toMatchObject({ status: 'error', message: /cycle/ })
    expect(engine.get(b.id)).toMatchObject({ status: 'error', message: /cycle/ })
  })

  it('removing the upstream analysis removes what was computed from it', async () => {
    const { store, scale, sum } = chain()
    const engine = await startedEngine(store, registry)
    store.dispatch({ type: 'node.remove', id: scale.id })
    expect(store.getState().nodes[sum.id]).toBeUndefined()
    expect(engine.get(sum.id)).toBeUndefined()
  })

  it('reopens a saved chain from its cached results without running anything', async () => {
    const first = chain()
    const e1 = await startedEngine(first.store, registry)
    const saved = [...e1.snapshot().values()]
    expect(saved).toHaveLength(2)

    const { calls, runner } = counting()
    const e2 = new ComputeEngine(new DocumentStore(first.store.getState()), registry, runner)
    // Round-trip through JSON, as a saved file does.
    e2.seed(JSON.parse(JSON.stringify(saved)))
    e2.start()
    await e2.idle()
    expect(calls).toHaveLength(0)
    expect(total(e2.latest(first.sum.id))).toBe(12)
  })

  // Audit 2 X8: a file's results are recomputed after opening, upstream first.
  it('a forged upstream result is replaced, and the analysis of its table runs on the real one', async () => {
    const first = chain()
    const e1 = await startedEngine(first.store, registry)
    const saved: { inputKey: string; result: AnalysisResult }[] = JSON.parse(
      JSON.stringify([...e1.snapshot().values()]),
    )
    // The upstream table's numbers doubled (the sum of it, keyed by its data, is then computed).
    const scaleEntry = saved.find((e) => e.result.table)!
    for (const d of scaleEntry.result.table!.dataSets)
      d.subcolumns[0]!.values = d.subcolumns[0]!.values.map((v) => (v === null ? v : v * 2))

    const e2 = new ComputeEngine(
      new DocumentStore(first.store.getState()),
      registry,
      counting().runner,
    )
    e2.seed(saved, { fromFile: true })
    e2.start()
    await e2.idle()
    expect(total(e2.latest(first.sum.id))).toBe(24)
    // The table recomputed; the sum of the real table is the file's (checked too).
    expect(await e2.verifySeeded()).toEqual({ checked: 2, differed: 1 })
    expect(total(e2.latest(first.sum.id))).toBe(12)
    expect(e2.latest(first.scale.id)).toEqual(e1.latest(first.scale.id))
  })
})
