import {
  type AnalysisJob,
  type AnalysisRegistry,
  ComputeEngine,
  DocumentStore,
  JobDropped,
  type JobProgress,
} from '@ps/engine'
import {
  type AnalysisDef,
  type AnalysisNode,
  type AnalysisResult,
  createProject,
  createTable,
  type DataTable,
  newNodeId,
} from '@ps/model'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type AnalysisWorkerLike,
  createWorkerRunner,
  STALE_CHECK_MS,
} from '../src/worker/runner.ts'

// Audit 2, U5: the analysis worker recovers from a crash, and queued jobs the engine no longer
// waits for aren't sent.

const result = (v: number): AnalysisResult => ({
  status: 'ok',
  diagnostics: [],
  sheets: [],
  values: { total: { kind: 'number', v } },
  comparisons: [],
  outputs: {},
})

/** Fake workers: the jobs each was sent, answered (or crashed) by the test. */
function fakeWorkers() {
  const made: (AnalysisWorkerLike & {
    sent: { id: number; job: AnalysisJob }[]
    terminated: boolean
    answer(v: number): void
    report(fraction: number, id?: number): void
    crash(message: string): { prevented: boolean }
  })[] = []
  const create = () => {
    const w = {
      onmessage: null,
      onerror: null,
      sent: [],
      terminated: false,
      postMessage(msg) {
        w.sent.push(msg)
      },
      terminate() {
        w.terminated = true
      },
      answer(v) {
        const last = w.sent.at(-1)!
        w.onmessage?.({ data: { id: last.id, result: result(v) } })
      },
      report(fraction, id = w.sent.at(-1)!.id) {
        w.onmessage?.({ data: { id, progress: { fraction, elapsed: fraction * 1000 } } })
      },
      crash(message) {
        const e = { message, prevented: false, preventDefault: () => (e.prevented = true) }
        w.onerror?.(e)
        return e
      },
    } as (typeof made)[number]
    made.push(w)
    return w
  }
  return { made, create }
}

const job = (n: number): AnalysisJob => ({
  analysisId: 'sum',
  params: { n },
  input: [],
  context: { tableKind: 'column', xTitle: null },
})
const tick = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  vi.useRealTimers()
})

describe('the analysis worker runner', () => {
  it('fails the running job on a crash and starts a new worker for the next', async () => {
    const { made, create } = fakeWorkers()
    const run = createWorkerRunner(create)!
    const a = run(job(1))
    const b = run(job(2))
    expect(made).toHaveLength(1)
    // One job at a time: the second waits.
    expect(made[0]!.sent).toHaveLength(1)
    const err = made[0]!.crash('out of memory')
    expect(err.prevented).toBe(true)
    expect(made[0]!.terminated).toBe(true)
    await expect(a).rejects.toThrow('out of memory')
    // The queued job went to a new worker.
    expect(made).toHaveLength(2)
    expect(made[1]!.sent.map((m) => m.job)).toEqual([job(2)])
    made[1]!.answer(7)
    expect(await b).toEqual(result(7))
    // A late message from the dead worker is ignored.
    made[0]!.onmessage?.({ data: { id: 0, result: result(1) } })
  })

  it('drops a queued job no longer wanted instead of sending it', async () => {
    const { made, create } = fakeWorkers()
    const run = createWorkerRunner(create)!
    let wanted = true
    const a = run(job(1))
    const stale = run(job(2), () => wanted)
    const c = run(job(3))
    wanted = false
    made[0]!.answer(1)
    await expect(a).resolves.toEqual(result(1))
    await expect(stale).rejects.toBeInstanceOf(JobDropped)
    expect(made[0]!.sent.map((m) => m.job)).toEqual([job(1), job(3)])
    made[0]!.answer(3)
    await expect(c).resolves.toEqual(result(3))
  })

  it('is null where there are no workers', () => {
    expect(createWorkerRunner(null)).toBeNull()
  })

  // Audit 2 (U12): what the tests above left out.

  it('starts no worker before the first job, and one for all the jobs after', async () => {
    const { made, create } = fakeWorkers()
    const run = createWorkerRunner(create)!
    expect(made).toHaveLength(0)
    const a = run(job(1))
    made[0]!.answer(1)
    await a
    const b = run(job(2))
    made[0]!.answer(2)
    expect(await b).toEqual(result(2))
    expect(made).toHaveLength(1)
  })

  it('fails a job the worker answers with an error, and runs the next on the same worker', async () => {
    const { made, create } = fakeWorkers()
    const run = createWorkerRunner(create)!
    const a = run(job(1))
    const b = run(job(2))
    const w = made[0]!
    w.onmessage?.({ data: { id: w.sent[0]!.id, error: 'singular matrix' } })
    await expect(a).rejects.toThrow('singular matrix')
    expect(w.terminated).toBe(false)
    expect(w.sent.map((m) => m.job)).toEqual([job(1), job(2)])
    w.answer(2)
    expect(await b).toEqual(result(2))
  })

  it('ignores an answer to a job it isn’t running', async () => {
    const { made, create } = fakeWorkers()
    const run = createWorkerRunner(create)!
    let settled = false
    const a = run(job(1)).then(() => (settled = true))
    const w = made[0]!
    w.onmessage?.({ data: { id: w.sent[0]!.id + 1, result: result(9) } })
    await tick()
    expect(settled).toBe(false)
    w.answer(1)
    await a
    expect(settled).toBe(true)
  })

  it('says the worker stopped when its error has no message', async () => {
    const { made, create } = fakeWorkers()
    const run = createWorkerRunner(create)!
    const a = run(job(1))
    made[0]!.crash('')
    await expect(a).rejects.toThrow('The analysis worker stopped unexpectedly.')
    // The next job, on a new worker; its crash, with no job waiting, starts none.
    const b = run(job(2))
    made[1]!.crash('gone')
    await expect(b).rejects.toThrow('gone')
    expect(made).toHaveLength(2)
  })

  it('fails the job, and goes on, when no worker can be made or the job can’t be sent', async () => {
    let fail = true
    const { made, create } = fakeWorkers()
    const run = createWorkerRunner(() => {
      if (fail) throw new Error('blocked by the policy')
      return create()
    })!
    const a = run(job(1))
    await expect(a).rejects.toThrow('blocked by the policy')
    fail = false
    const b = run(job(2))
    made[0]!.answer(2)
    expect(await b).toEqual(result(2))
    // A job the worker can't take (not cloneable): failed, and the next one runs.
    made[0]!.postMessage = () => {
      throw new DOMException('could not be cloned', 'DataCloneError')
    }
    await expect(run(job(3))).rejects.toThrow('could not be cloned')
  })
})

// Audit 2, P4: a running job no longer wanted is stopped with its worker.

describe('the runner stopping jobs no longer wanted', () => {
  it('terminates the worker running a job no longer wanted; the next job gets a new one', async () => {
    vi.useFakeTimers()
    const { made, create } = fakeWorkers()
    const run = createWorkerRunner(create)!
    let wanted = true
    const a = run(job(1), () => wanted)
    const b = run(job(2))
    // Still wanted: it runs on, however long.
    vi.advanceTimersByTime(STALE_CHECK_MS * 50)
    expect(made[0]!.terminated).toBe(false)
    wanted = false
    vi.advanceTimersByTime(STALE_CHECK_MS)
    expect(made[0]!.terminated).toBe(true)
    await expect(a).rejects.toBeInstanceOf(JobDropped)
    expect(made).toHaveLength(2)
    expect(made[1]!.sent.map((m) => m.job)).toEqual([job(2)])
    made[1]!.answer(2)
    expect(await b).toEqual(result(2))
    // A late answer from the stopped worker is ignored, and no check is left running.
    made[0]!.answer(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never stops a job that ends before the next check', async () => {
    vi.useFakeTimers()
    const { made, create } = fakeWorkers()
    const run = createWorkerRunner(create)!
    let wanted = true
    const a = run(job(1), () => wanted)
    wanted = false
    vi.advanceTimersByTime(STALE_CHECK_MS - 1)
    made[0]!.answer(1)
    expect(await a).toEqual(result(1))
    vi.advanceTimersByTime(STALE_CHECK_MS * 5)
    expect(made[0]!.terminated).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})

// Roadmap 42: the worker posts how far the running job has got.

describe('the runner passing on progress', () => {
  it('gives the running job its worker’s reports, and ignores the rest', async () => {
    const { made, create } = fakeWorkers()
    const run = createWorkerRunner(create)!
    const got: [string, number][] = []
    const a = run(job(1), undefined, (p: JobProgress) => got.push(['a', p.fraction]))
    const b = run(job(2), undefined, (p: JobProgress) => got.push(['b', p.fraction]))
    const w = made[0]!
    w.report(0.25)
    w.report(0.5)
    // Not the job running (b is queued): ignored.
    w.report(0.9, w.sent[0]!.id + 1)
    expect(got).toEqual([
      ['a', 0.25],
      ['a', 0.5],
    ])
    // A report doesn't settle the job.
    let settled = false
    a.then(() => (settled = true))
    await tick()
    expect(settled).toBe(false)
    w.answer(1)
    await a
    // a's late report is ignored; b's go to b.
    w.report(0.75, w.sent[0]!.id)
    w.report(0.1)
    expect(got.at(-1)).toEqual(['b', 0.1])
    expect(got).toHaveLength(3)
    w.answer(2)
    await b
  })

  it('ignores the reports of a stopped job’s worker', async () => {
    vi.useFakeTimers()
    const { made, create } = fakeWorkers()
    const run = createWorkerRunner(create)!
    let wanted = true
    const got: number[] = []
    const a = run(
      job(1),
      () => wanted,
      (p: JobProgress) => got.push(p.fraction),
    )
    made[0]!.report(0.2)
    wanted = false
    vi.advanceTimersByTime(STALE_CHECK_MS)
    await expect(a).rejects.toBeInstanceOf(JobDropped)
    made[0]!.report(0.4)
    expect(got).toEqual([0.2])
  })

  it('reaches the engine: a computing analysis shows its progress until answered', async () => {
    const { made, create } = fakeWorkers()
    const { store, analysis, set } = setup()
    const engine = new ComputeEngine(store, registry, createWorkerRunner(create)!)
    engine.start()
    await tick()
    made[0]!.report(0.3)
    expect(engine.progressOf(analysis.id)?.fraction).toBe(0.3)
    // An input typed over: the old job's reports (until its worker is stopped) aren't the new
    // job's.
    set(2)
    made[0]!.report(0.6)
    expect(engine.progressOf(analysis.id)).toBeUndefined()
    answerJob(made[0]!)
    await tick()
    made[0]!.report(0.5)
    expect(engine.progressOf(analysis.id)?.fraction).toBe(0.5)
    answerJob(made[0]!)
    await engine.idle()
    expect(engine.progressOf(analysis.id)).toBeUndefined()
    expect(totalOf(engine, analysis.id)).toBe(2)
  })
})

// The engine with the runner: input changing while a job runs, and a crash.

const sumDef: AnalysisDef<Record<string, never>> = {
  id: 'sum',
  version: 1,
  title: 'Sum',
  category: 'Test',
  description: 'Sums values.',
  form: [],
  accepts: ['column'],
  inputs: { min: 1, max: 1 },
  // The engine only parses params (zod isn't a dependency of the UI).
  params: { safeParse: (v: unknown) => ({ success: true, data: v }) } as never,
  run: () => result(0),
}
const registry: AnalysisRegistry = {
  engineVersion: 'test',
  get: (id) => (id === 'sum' ? (sumDef as AnalysisDef<unknown>) : undefined),
}

function setup() {
  const table = createTable({ rows: 3, columns: 1 })
  const store = new DocumentStore(createProject())
  store.dispatch({ type: 'node.add', node: table })
  const analysis: AnalysisNode = {
    kind: 'analysis',
    id: newNodeId(),
    name: 'Sum',
    analysisId: 'sum',
    pluginVersion: 1,
    input: { source: table.id, dataSets: [table.dataSets[0]!.id] },
    params: {},
  }
  store.dispatch({ type: 'node.add', node: analysis })
  const col = (store.getState().nodes[table.id] as DataTable).dataSets[0]!.id
  const set = (value: number) =>
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col, sub: 0, row: 0, value }],
    })
  return { store, analysis, set }
}

/** The sum the job asks for (the fake worker answers with it). */
const sumOf = (j: AnalysisJob) => {
  const d = j.input[0]!.data
  return d.shape === 'replicates'
    ? d.reps[0]!.reduce((s, v) => s + (Number.isNaN(v) ? 0 : v), 0)
    : 0
}
const answerJob = (w: { sent: { job: AnalysisJob }[]; answer(v: number): void }) =>
  w.answer(sumOf(w.sent.at(-1)!.job))
const totalOf = (engine: ComputeEngine, id: AnalysisNode['id']) =>
  (engine.latest(id)?.values.total as { v: number } | undefined)?.v

describe('the engine with the worker runner', () => {
  it('skips the inputs typed over while a job ran', async () => {
    const { made, create } = fakeWorkers()
    const { store, analysis, set } = setup()
    const engine = new ComputeEngine(store, registry, createWorkerRunner(create)!)
    engine.start()
    set(1)
    set(2)
    set(3)
    await tick()
    // The first job, then only the last input (the ones between were dropped, never sent).
    answerJob(made[0]!)
    await tick()
    answerJob(made[0]!)
    await engine.idle()
    expect(made[0]!.sent).toHaveLength(2)
    expect(engine.get(analysis.id)?.status).toBe('ready')
    expect(totalOf(engine, analysis.id)).toBe(3)
  })

  it('settles a job lost with a crashed worker, and runs the next input on a new worker', async () => {
    const { made, create } = fakeWorkers()
    const { store, analysis, set } = setup()
    const engine = new ComputeEngine(store, registry, createWorkerRunner(create)!)
    engine.start()
    await tick()
    made[0]!.crash('crashed')
    await engine.idle()
    expect(engine.get(analysis.id)).toMatchObject({ status: 'error', message: 'crashed' })
    set(5)
    await tick()
    expect(made).toHaveLength(2)
    answerJob(made[1]!)
    await engine.idle()
    expect(totalOf(engine, analysis.id)).toBe(5)
  })

  it('runs a dropped job after all when it is wanted again', async () => {
    const { store, analysis } = setup()
    let calls = 0
    // Dropped as the engine wanted it again (the race between the check and the rejection).
    const runner = async (j: AnalysisJob) => {
      calls++
      if (calls === 1) throw new JobDropped()
      return result(sumOf(j) + 1)
    }
    const engine = new ComputeEngine(store, registry, runner)
    engine.start()
    await engine.idle()
    expect(calls).toBe(2)
    expect(engine.get(analysis.id)?.status).toBe('ready')
    expect(totalOf(engine, analysis.id)).toBe(1)
  })

  // Audit 2, P4.

  it('stops the job of an input typed over, and computes the new one at once', async () => {
    vi.useFakeTimers()
    const { made, create } = fakeWorkers()
    const { store, analysis, set } = setup()
    const engine = new ComputeEngine(store, registry, createWorkerRunner(create)!)
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(made[0]!.sent).toHaveLength(1)
    set(5)
    await vi.advanceTimersByTimeAsync(STALE_CHECK_MS)
    // The first worker stopped; the new input on a new one.
    expect(made[0]!.terminated).toBe(true)
    expect(made).toHaveLength(2)
    answerJob(made[1]!)
    await engine.idle()
    expect(engine.get(analysis.id)?.status).toBe('ready')
    expect(totalOf(engine, analysis.id)).toBe(5)
  })

  it('cancels a job: the worker stops, the analysis shows it cancelled until run again', async () => {
    vi.useFakeTimers()
    const { made, create } = fakeWorkers()
    const { store, analysis, set } = setup()
    const engine = new ComputeEngine(store, registry, createWorkerRunner(create)!)
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    const version = engine.version
    engine.cancel(analysis.id)
    expect(engine.version).toBeGreaterThan(version)
    expect(engine.get(analysis.id)).toMatchObject({ status: 'error', cancelled: true })
    await vi.advanceTimersByTimeAsync(STALE_CHECK_MS)
    expect(made[0]!.terminated).toBe(true)
    await engine.idle()
    // Cancelled it stays (no new worker), the same input or not.
    store.dispatch({ type: 'project.setSettings', settings: { defaultConfidenceLevel: 0.9 } })
    await vi.advanceTimersByTimeAsync(STALE_CHECK_MS * 3)
    expect(made).toHaveLength(1)
    expect(engine.get(analysis.id)).toMatchObject({ status: 'error', cancelled: true })
    // Cancelling what isn't computing does nothing.
    engine.cancel(analysis.id)
    expect(engine.get(analysis.id)).toMatchObject({ status: 'error', cancelled: true })

    engine.rerun(analysis.id)
    expect(engine.get(analysis.id)?.status).toBe('pending')
    await vi.advanceTimersByTimeAsync(0)
    expect(made).toHaveLength(2)
    answerJob(made[1]!)
    await engine.idle()
    expect(engine.get(analysis.id)?.status).toBe('ready')
    // Rerun only reruns a cancelled analysis; an input change computes a cancelled one too.
    engine.rerun(analysis.id)
    expect(engine.get(analysis.id)?.status).toBe('ready')
    set(4)
    await vi.advanceTimersByTimeAsync(0)
    engine.cancel(analysis.id)
    set(6)
    await vi.advanceTimersByTimeAsync(STALE_CHECK_MS)
    answerJob(made.at(-1)!)
    await engine.idle()
    expect(totalOf(engine, analysis.id)).toBe(6)
  })

  it('drops a cancelled job still queued without sending it', async () => {
    vi.useFakeTimers()
    const { made, create } = fakeWorkers()
    const first = setup()
    const run = createWorkerRunner(create)!
    const busy = run(job(1))
    const engine = new ComputeEngine(first.store, registry, run)
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(made[0]!.sent).toHaveLength(1)
    engine.cancel(first.analysis.id)
    made[0]!.answer(1)
    await busy
    await engine.idle()
    expect(made[0]!.sent).toHaveLength(1)
    expect(made[0]!.terminated).toBe(false)
    expect(engine.get(first.analysis.id)).toMatchObject({ status: 'error', cancelled: true })
  })
})
