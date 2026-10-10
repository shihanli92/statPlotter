import {
  type AnalysisDef,
  type AnalysisNode,
  type AnalysisResult,
  createProject,
  createTable,
  type DataTable,
  newNodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type AnalysisJob,
  type AnalysisRegistry,
  type CacheEntry,
  ComputeEngine,
  DocumentStore,
  estimateBytes,
  inlineRunner,
  type JobRunner,
  MAX_CACHE,
  MAX_CACHE_BYTES,
  sameResult,
} from '../src/index.ts'
import { startedEngine } from './helpers.ts'

/** Test analysis: sums the first replicate of each input data set. */
const sumDef: AnalysisDef<{ scale: number }> = {
  id: 'sum',
  version: 1,
  title: 'Sum',
  category: 'Test',
  description: 'Sums values.',
  form: [],
  accepts: ['column'],
  inputs: { min: 1, max: 2 },
  params: z.object({ scale: z.number().default(1) }),
  run(input, params) {
    let total = 0
    for (const ds of input) {
      if (ds.data.shape !== 'replicates') continue
      for (const v of ds.data.reps[0]!) if (!Number.isNaN(v)) total += v
    }
    return {
      status: 'ok',
      diagnostics: [],
      sheets: [],
      values: { total: { kind: 'number', v: total * params.scale } },
      comparisons: [],
      outputs: {},
    }
  },
}

const registry: AnalysisRegistry = {
  engineVersion: 'test',
  get: (id) => (id === 'sum' ? (sumDef as AnalysisDef<unknown>) : undefined),
}

const total = (r: AnalysisResult | undefined) => (r?.values.total as { v: number } | undefined)?.v

function setup() {
  const table = createTable({ rows: 3, columns: 3 })
  const store = new DocumentStore(createProject())
  store.dispatch({ type: 'node.add', node: table })
  const analysis: AnalysisNode = {
    kind: 'analysis',
    id: newNodeId(),
    name: 'Sum',
    analysisId: 'sum',
    pluginVersion: 1,
    input: { source: table.id, dataSets: [table.dataSets[0]!.id, table.dataSets[1]!.id] },
    params: {},
  }
  store.dispatch({ type: 'node.add', node: analysis })
  const col = (i: number) => (store.getState().nodes[table.id] as DataTable).dataSets[i]!.id
  const set = (i: number, row: number, value: number | null) =>
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col: col(i), sub: 0, row, value }],
    })
  return { store, table, analysis, set }
}

/** A runner that counts calls and can be held to test staleness. */
function countingRunner() {
  const calls: AnalysisJob[] = []
  const inner = inlineRunner(registry)
  const runner: JobRunner = (job) => {
    calls.push(job)
    return inner(job)
  }
  return { calls, runner }
}

describe('ComputeEngine', () => {
  it('computes results and updates them when referenced data changes', async () => {
    const { store, analysis, set } = setup()
    const engine = await startedEngine(store, registry)
    expect(total(engine.latest(analysis.id))).toBe(0)

    set(0, 0, 2)
    set(1, 2, 3)
    await engine.idle()
    expect(engine.get(analysis.id)?.status).toBe('ready')
    expect(total(engine.latest(analysis.id))).toBe(5)
  })

  it('does not rerun when an unreferenced column changes', async () => {
    const { calls, runner } = countingRunner()
    const { store, set } = setup()
    const engine = await startedEngine(store, registry, runner)
    expect(calls).toHaveLength(1)

    set(2, 0, 100) // column C is not an input
    await engine.idle()
    expect(calls).toHaveLength(1)
  })

  it('reuses cached results after undo', async () => {
    const { calls, runner } = countingRunner()
    const { store, analysis, set } = setup()
    const engine = new ComputeEngine(store, registry, runner)
    engine.start()
    set(0, 0, 4)
    await engine.idle()
    const n = calls.length
    store.undo()
    await engine.idle()
    store.redo()
    await engine.idle()
    expect(calls).toHaveLength(n)
    expect(total(engine.latest(analysis.id))).toBe(4)
  })

  it('reruns when params change', async () => {
    const { store, analysis, set } = setup()
    const engine = new ComputeEngine(store, registry, inlineRunner(registry))
    engine.start()
    set(0, 0, 2)
    store.dispatch({ type: 'analysis.setParams', id: analysis.id, params: { scale: 10 } })
    await engine.idle()
    expect(total(engine.latest(analysis.id))).toBe(20)
  })

  it('keeps the previous result while recomputing, and drops stale completions', async () => {
    const pending: { job: AnalysisJob; resolve: (r: AnalysisResult) => void }[] = []
    const held: JobRunner = (job) => new Promise((resolve) => pending.push({ job, resolve }))
    const { store, analysis, set } = setup()
    const engine = new ComputeEngine(store, registry, held)
    engine.start()
    const inner = inlineRunner(registry)
    const release = async (i: number) => pending[i]!.resolve(await inner(pending[i]!.job))

    await release(0)
    await Promise.resolve()
    expect(total(engine.latest(analysis.id))).toBe(0)

    set(0, 0, 1) // job 1
    set(0, 0, 2) // job 2 supersedes job 1
    expect(engine.get(analysis.id)?.status).toBe('pending')
    expect(total(engine.latest(analysis.id))).toBe(0) // previous result still shown

    await release(1) // stale: must not be applied
    await Promise.resolve()
    expect(engine.get(analysis.id)?.status).toBe('pending')

    await release(2)
    await engine.idle()
    expect(total(engine.latest(analysis.id))).toBe(2)
  })

  it('reports missing inputs and invalid params as errors', async () => {
    const { store, table, analysis } = setup()
    const engine = new ComputeEngine(store, registry, inlineRunner(registry))
    engine.start()
    store.dispatch({ type: 'analysis.setParams', id: analysis.id, params: { scale: 'x' } })
    expect(engine.get(analysis.id)).toMatchObject({
      status: 'error',
      message: /Invalid parameters/,
    })

    store.undo()
    // A data set the analysis reads gone without its reference (deleting columns drops it from
    // the analysis' input since audit 2, M15).
    const now = store.getState().nodes[table.id] as DataTable
    store.dispatch({
      type: 'node.replace',
      node: { ...now, dataSets: now.dataSets.filter((d) => d.id !== table.dataSets[0]!.id) },
    })
    expect(engine.get(analysis.id)).toMatchObject({ status: 'error', message: /no longer exists/ })
    store.undo()
    store.dispatch({ type: 'table.removeDataSets', table: table.id, ids: [table.dataSets[0]!.id] })
    expect((store.getState().nodes[analysis.id] as AnalysisNode).input.dataSets).toEqual([
      table.dataSets[1]!.id,
    ])
  })

  it('reports runner failures as errors', async () => {
    const failing: JobRunner = () => Promise.reject(new Error('boom'))
    const { store, analysis } = setup()
    const engine = await startedEngine(store, registry, failing)
    expect(engine.get(analysis.id)).toMatchObject({ status: 'error', message: 'boom' })
  })

  it('seeds results from a saved cache without running', async () => {
    const first = setup()
    const e1 = new ComputeEngine(first.store, registry, inlineRunner(registry))
    e1.start()
    first.set(0, 1, 9)
    await e1.idle()
    const saved = [...e1.snapshot().values()]

    const { calls, runner } = countingRunner()
    const store2 = new DocumentStore(first.store.getState())
    const e2 = new ComputeEngine(store2, registry, runner)
    e2.seed(saved)
    e2.start()
    await e2.idle()
    expect(calls).toHaveLength(0)
    expect(total(e2.latest(first.analysis.id))).toBe(9)
  })

  // Audit 2 X8: results read from a file are shown at once, then recomputed.
  describe('results from a file', () => {
    async function saved() {
      const first = setup()
      first.set(0, 1, 9)
      const e1 = await startedEngine(first.store, registry)
      // As a file holds them: through JSON.
      const entries: CacheEntry[] = JSON.parse(JSON.stringify([...e1.snapshot().values()]))
      return { first, entries }
    }
    const opened = (first: ReturnType<typeof setup>, entries: CacheEntry[]) => {
      const counted = countingRunner()
      const store = new DocumentStore(first.store.getState())
      const e = new ComputeEngine(store, registry, counted.runner)
      e.seed(entries, { fromFile: true })
      e.start()
      return { e, store, calls: counted.calls }
    }

    it('keep a result that recomputes the same, unchanged and without a notice', async () => {
      const { first, entries } = await saved()
      const { e, calls } = opened(first, entries)
      const shown = e.latest(first.analysis.id)
      expect(calls).toHaveLength(0)
      let emitted = 0
      e.subscribe(() => emitted++)
      expect(await e.verifySeeded()).toEqual({ checked: 1, differed: 0 })
      expect(calls).toHaveLength(1)
      expect(e.latest(first.analysis.id)).toBe(shown)
      expect(emitted).toBe(0)
      // Once checked, not again.
      expect(await e.verifySeeded()).toEqual({ checked: 0, differed: 0 })
    })

    it('replace a forged result with the computed one', async () => {
      const { first, entries } = await saved()
      ;(entries[0]!.result.values.total as { v: number }).v = 1e6
      entries[0]!.result.diagnostics.push({ level: 'info', message: 'forged' } as never)
      const { e } = opened(first, entries)
      expect(total(e.latest(first.analysis.id))).toBe(1e6)
      let emitted = 0
      e.subscribe(() => emitted++)
      expect(await e.verifySeeded()).toEqual({ checked: 1, differed: 1 })
      expect(total(e.latest(first.analysis.id))).toBe(9)
      expect(emitted).toBeGreaterThan(0)
    })

    it('a result that now fails replaces the file’s with the error', async () => {
      const { first, entries } = await saved()
      const e = new ComputeEngine(new DocumentStore(first.store.getState()), registry, () =>
        Promise.reject(new Error('boom')),
      )
      e.seed(entries, { fromFile: true })
      e.start()
      expect(await e.verifySeeded()).toEqual({ checked: 1, differed: 1 })
      expect(e.get(first.analysis.id)).toMatchObject({ status: 'error', message: 'boom' })
    })

    it('drops results of the file no analysis shows (recomputed when needed)', async () => {
      const { first, entries } = await saved()
      // The file also holds the result of an earlier state (9 in the cell), forged.
      const earlier: CacheEntry = JSON.parse(JSON.stringify(entries[0]))
      ;(earlier.result.values.total as { v: number }).v = -1
      first.set(0, 1, 5)
      const e1 = await startedEngine(first.store, registry)
      const now: CacheEntry[] = JSON.parse(JSON.stringify([...e1.snapshot().values()]))
      const { e, store, calls } = opened(first, [...now, earlier])
      expect(await e.verifySeeded()).toEqual({ checked: 1, differed: 0 })
      expect(calls).toHaveLength(1)
      // Back to 9: computed, not the file's.
      const col = (store.getState().nodes[first.table.id] as DataTable).dataSets[0]!.id
      store.dispatch({
        type: 'table.setCells',
        table: first.table.id,
        edits: [{ col, sub: 0, row: 1, value: 9 }],
      })
      await e.idle()
      expect(calls).toHaveLength(2)
      expect(total(e.latest(first.analysis.id))).toBe(9)
    })

    it('numbers alike after a file’s round trip are the same result', () => {
      const r = (v: number) =>
        ({
          status: 'ok',
          diagnostics: [],
          sheets: [],
          values: { a: { kind: 'number', v } },
          comparisons: [],
          outputs: {},
        }) as AnalysisResult
      expect(sameResult(r(Number.NaN), r(Number.NaN))).toBe(true)
      expect(sameResult(r(0), r(-0))).toBe(true)
      expect(sameResult(r(1), r(1 + 2 ** -52))).toBe(false)
      expect(sameResult(r(1), { ...r(1), extra: undefined } as never)).toBe(true)
    })
  })

  it('forgets results of deleted analyses', async () => {
    const { store, analysis } = setup()
    const engine = await startedEngine(store, registry)
    store.dispatch({ type: 'node.remove', id: analysis.id })
    expect(engine.get(analysis.id)).toBeUndefined()
  })
})

describe('the result cache (audit 2, M16)', () => {
  /** A runner whose results each hold 10,000 numbers more. */
  function paddedRunner() {
    const { calls, runner } = countingRunner()
    const padded: JobRunner = async (job, wanted) => ({
      ...(await runner(job, wanted)),
      sheets: [{ pad: new Array(10_000).fill(1.5) }] as never,
    })
    return { calls, runner: padded }
  }

  it('estimates sizes: numbers, strings, arrays, typed arrays, shared objects once', () => {
    expect(estimateBytes(1)).toBe(8)
    expect(estimateBytes('ab')).toBe(20)
    expect(estimateBytes([1, 2, 'ab'])).toBe(16 + 24 + 20)
    expect(estimateBytes(new Float64Array(10))).toBe(64 + 80)
    const shared = { a: 1 }
    expect(estimateBytes([shared, shared])).toBe(16 + 16 + 32 + 10 + 8)
    expect(MAX_CACHE).toBe(500)
    expect(MAX_CACHE_BYTES).toBe(256 * 2 ** 20)
  })

  it('drops the oldest results no analysis shows while they hold more than its bytes', async () => {
    const { calls, runner } = paddedRunner()
    const { store, analysis, set } = setup()
    const one = estimateBytes({ sheets: [{ pad: new Array(10_000).fill(1.5) }] })
    const engine = new ComputeEngine(store, registry, runner, { bytes: 2.5 * one })
    engine.start()
    await engine.idle()
    for (const v of [1, 2, 3]) {
      set(0, 0, v)
      await engine.idle()
    }
    expect(calls).toHaveLength(4)
    // 3 and 2 cached (3 shown); 1 and 0 dropped, oldest first.
    store.undo()
    await engine.idle()
    expect(calls).toHaveLength(4)
    expect(total(engine.latest(analysis.id))).toBe(2)
    store.undo()
    await engine.idle()
    expect(calls).toHaveLength(5)
    expect(total(engine.latest(analysis.id))).toBe(1)
  })

  it('keeps the newest result, and results shown, whatever their size', async () => {
    const { calls, runner } = paddedRunner()
    const { store, analysis, set } = setup()
    const engine = new ComputeEngine(store, registry, runner, { bytes: 1 })
    engine.start()
    await engine.idle()
    set(0, 0, 7)
    await engine.idle()
    expect(total(engine.latest(analysis.id))).toBe(7)
    expect(engine.snapshot().get(analysis.id)?.result.sheets).toHaveLength(1)
    // A newer result (another analysis') does not push out the one shown: an analysis like it
    // finds it cached.
    const like = (scale: number): AnalysisNode => ({
      ...(store.getState().nodes[analysis.id] as AnalysisNode),
      id: newNodeId(),
      params: { scale },
    })
    store.dispatch({ type: 'node.add', node: like(2) })
    await engine.idle()
    const n = calls.length
    const twin = like(1)
    store.dispatch({ type: 'node.add', node: twin })
    await engine.idle()
    expect(calls).toHaveLength(n)
    expect(total(engine.latest(twin.id))).toBe(7)
  })

  it('bounds the number of results', async () => {
    const { calls, runner } = countingRunner()
    const { store, set } = setup()
    const engine = new ComputeEngine(store, registry, runner, { results: 2 })
    engine.start()
    for (const v of [1, 2, 3]) {
      set(0, 0, v)
      await engine.idle()
    }
    const n = calls.length
    store.undo()
    await engine.idle()
    expect(calls).toHaveLength(n)
    store.undo()
    await engine.idle()
    expect(calls).toHaveLength(n + 1)
  })
})
