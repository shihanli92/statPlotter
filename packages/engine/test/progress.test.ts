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
  ComputeEngine,
  DocumentStore,
  inlineRunner,
  type JobProgress,
  type JobRunner,
  PROGRESS_INTERVAL_MS,
  throttleProgress,
} from '../src/index.ts'

// Roadmap 42: a running analysis reports how far it has got; the throttle passes on a few reports
// a second, and the engine keeps the latest of each job it still waits for, on a side channel.

describe('the progress throttle', () => {
  it('passes on the first report, then at most one per interval, and only when it grew', () => {
    let t = 1000
    const got: JobProgress[] = []
    const progress = throttleProgress(
      (p) => got.push(p),
      100,
      () => t,
    )
    t = 1010
    progress(1, 10)
    // Within the interval: dropped, however many.
    for (let k = 2; k <= 9; k++) {
      t += 10
      progress(k, 100)
    }
    expect(got).toEqual([{ fraction: 0.1, elapsed: 10 }])
    t = 1110
    progress(30, 100)
    expect(got.at(-1)).toEqual({ fraction: 0.3, elapsed: 110 })
    // Not grown (the same, or back): dropped, and the interval doesn't restart.
    t = 1300
    progress(30, 100)
    progress(1, 10)
    expect(got).toHaveLength(2)
    progress(31, 100)
    expect(got.at(-1)).toEqual({ fraction: 0.31, elapsed: 300 })
    expect(got).toHaveLength(3)
  })

  it('drops reports that aren’t a fraction, and caps one beyond the total', () => {
    let t = 0
    const got: number[] = []
    const progress = throttleProgress(
      (p) => got.push(p.fraction),
      100,
      () => t,
    )
    for (const [done, total] of [
      [0, 0],
      [1, 0],
      [Number.NaN, 5],
      [-1, 5],
      [1, -5],
    ] as const) {
      t += 200
      progress(done, total)
    }
    expect(got).toEqual([])
    t += 200
    progress(12, 10)
    expect(got).toEqual([1])
  })

  it('uses the interval the worker posts at by default', () => {
    expect(PROGRESS_INTERVAL_MS).toBe(100)
    const got: number[] = []
    const progress = throttleProgress((p) => got.push(p.fraction))
    progress(1, 4)
    progress(2, 4)
    expect(got).toEqual([0.25])
  })
})

// ---- The engine --------------------------------------------------------------------------------

const ok = (v: number): AnalysisResult => ({
  status: 'ok',
  diagnostics: [],
  sheets: [],
  values: { total: { kind: 'number', v } },
  comparisons: [],
  outputs: {},
})

/** Reports `steps` steps, then answers with how many reports got through. */
const stepsDef: AnalysisDef<{ steps: number }> = {
  id: 'steps',
  version: 1,
  title: 'Steps',
  category: 'Test',
  description: 'Reports progress.',
  form: [],
  accepts: ['column'],
  inputs: { min: 1, max: 1 },
  params: z.object({ steps: z.number().default(3) }),
  run(_input, params, _context, progress) {
    for (let k = 0; k <= params.steps; k++) progress?.(k, params.steps)
    return ok(params.steps)
  },
}
const registry: AnalysisRegistry = {
  engineVersion: 'test',
  get: (id) => (id === 'steps' ? (stepsDef as AnalysisDef<unknown>) : undefined),
}

function setup() {
  const table = createTable({ rows: 3, columns: 1 })
  const store = new DocumentStore(createProject())
  store.dispatch({ type: 'node.add', node: table })
  const analysis: AnalysisNode = {
    kind: 'analysis',
    id: newNodeId(),
    name: 'Steps',
    analysisId: 'steps',
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

/** A runner whose jobs the test reports on and answers. */
function heldRunner() {
  const jobs: {
    job: AnalysisJob
    progress?: (p: JobProgress) => void
    resolve: (r: AnalysisResult) => void
  }[] = []
  const runner: JobRunner = (job, _wanted, progress) =>
    new Promise((resolve) => {
      jobs.push({ job, ...(progress && { progress }), resolve })
    })
  return { jobs, runner }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('the engine’s progress of running jobs', () => {
  it('keeps the latest report of a computing analysis, without a results change', async () => {
    const { store, analysis } = setup()
    const { jobs, runner } = heldRunner()
    const engine = new ComputeEngine(store, registry, runner)
    engine.start()
    await tick()
    expect(engine.progressOf(analysis.id)).toBeUndefined()
    let heard = 0
    const off = engine.subscribeProgress(() => heard++)
    const version = engine.version
    jobs[0]!.progress!({ fraction: 0.25, elapsed: 2000 })
    const p = engine.progressOf(analysis.id)
    expect(p).toMatchObject({ fraction: 0.25, elapsed: 2000 })
    expect(p!.at).toBeGreaterThan(0)
    // The same object until the next report (a store snapshot for useSyncExternalStore).
    expect(engine.progressOf(analysis.id)).toBe(p)
    jobs[0]!.progress!({ fraction: 0.5, elapsed: 4000 })
    expect(engine.progressOf(analysis.id)?.fraction).toBe(0.5)
    expect(heard).toBe(2)
    // Progress isn't a results change: nothing re-renders the results for it.
    expect(engine.version).toBe(version)
    // Answered: no progress, and a late report is ignored.
    jobs[0]!.resolve(ok(1))
    await engine.idle()
    expect(engine.get(analysis.id)?.status).toBe('ready')
    expect(engine.progressOf(analysis.id)).toBeUndefined()
    jobs[0]!.progress!({ fraction: 0.75, elapsed: 6000 })
    expect(engine.progressOf(analysis.id)).toBeUndefined()
    expect(heard).toBe(3)
    off()
  })

  it('ignores a superseded job’s reports, and shows the new job’s', async () => {
    const { store, analysis, set } = setup()
    const { jobs, runner } = heldRunner()
    const engine = new ComputeEngine(store, registry, runner)
    engine.start()
    await tick()
    jobs[0]!.progress!({ fraction: 0.5, elapsed: 2000 })
    set(5)
    await tick()
    expect(jobs).toHaveLength(2)
    // The new job has reported nothing yet; the old one's report is not its.
    expect(engine.progressOf(analysis.id)).toBeUndefined()
    jobs[0]!.progress!({ fraction: 0.6, elapsed: 2400 })
    expect(engine.progressOf(analysis.id)).toBeUndefined()
    jobs[1]!.progress!({ fraction: 0.1, elapsed: 300 })
    expect(engine.progressOf(analysis.id)?.fraction).toBe(0.1)
    // The old job's answer changes nothing.
    jobs[0]!.resolve(ok(0))
    await tick()
    expect(engine.progressOf(analysis.id)?.fraction).toBe(0.1)
    jobs[1]!.resolve(ok(5))
    await engine.idle()
    expect(engine.progressOf(analysis.id)).toBeUndefined()
  })

  it('forgets a cancelled job’s progress and ignores its late reports; Run again starts afresh', async () => {
    const { store, analysis } = setup()
    const { jobs, runner } = heldRunner()
    const engine = new ComputeEngine(store, registry, runner)
    engine.start()
    await tick()
    jobs[0]!.progress!({ fraction: 0.4, elapsed: 2000 })
    engine.cancel(analysis.id)
    expect(engine.progressOf(analysis.id)).toBeUndefined()
    jobs[0]!.progress!({ fraction: 0.5, elapsed: 2500 })
    expect(engine.progressOf(analysis.id)).toBeUndefined()
    // Run again before the runner dropped it: the job running is wanted again, and its next
    // report counts (it is the computation the analysis now waits for).
    engine.rerun(analysis.id)
    expect(engine.get(analysis.id)?.status).toBe('pending')
    expect(engine.progressOf(analysis.id)).toBeUndefined()
    jobs[0]!.progress!({ fraction: 0.6, elapsed: 3000 })
    expect(engine.progressOf(analysis.id)?.fraction).toBe(0.6)
    jobs[0]!.resolve(ok(1))
    await engine.idle()
    expect(engine.get(analysis.id)?.status).toBe('ready')
  })

  it('passes the inline runner’s plugin a throttled progress', async () => {
    const { store, analysis } = setup()
    const got: JobProgress[] = []
    const inline = inlineRunner(registry)
    const runner: JobRunner = (job, wanted) => inline(job, wanted, (p) => got.push(p))
    const engine = new ComputeEngine(store, registry, runner)
    engine.start()
    await engine.idle()
    expect(engine.get(analysis.id)?.status).toBe('ready')
    // Four reports in well under the interval: the first passes.
    expect(got.map((p) => p.fraction)).toEqual([0])
  })
})
