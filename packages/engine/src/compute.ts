import {
  type AnalysisDef,
  type AnalysisNode,
  AnalysisResult,
  type DataTable,
  hasModifiers,
  infoConstants,
  mayNameInfo,
  modifyInput,
  type NodeId,
  type NormalizedDataSet,
  nodeById,
  normalizeColumn,
  type Project,
  paramsOf,
  type RunContext,
  resultTableAs,
  tableIssues,
  withConstants,
} from '@ps/model'
import { hashDataSet, hashStrings } from './hash.ts'
import { type JobProgress, throttleProgress } from './progress.ts'
import type { DocumentStore } from './store.ts'

export interface AnalysisRegistry {
  get(id: string): AnalysisDef<unknown> | undefined
  /** Version of the analysis/stats code; part of every cache key. */
  engineVersion: string
}

/** Everything a runner needs; structured-cloneable so it can cross a worker boundary. */
export interface AnalysisJob {
  analysisId: string
  params: unknown
  input: NormalizedDataSet[]
  context: RunContext
}

/**
 * Runs a job. `wanted` says whether the engine still waits for the job's result: a runner that
 * queues jobs may skip one no longer wanted, or stop one running, rejecting with a `JobDropped`
 * error. `progress` hears how far the running job has got, when its analysis says (roadmap 42;
 * a few reports a second at most, never after the job settled).
 */
export type JobRunner = (
  job: AnalysisJob,
  wanted?: () => boolean,
  progress?: (p: JobProgress) => void,
) => Promise<AnalysisResult>

/** How far a computing analysis has got (`ComputeEngine.progressOf`). */
export interface ReportedProgress extends JobProgress {
  /** When it was reported (`Date.now()`). */
  at: number
}

/** A cancelled analysis' message (`ComputeEngine.cancel`). */
export const CANCELLED = 'Cancelled.'

/** A runner skipped a queued job its engine no longer waited for, or stopped it running. */
export class JobDropped extends Error {
  constructor() {
    super('The job was no longer wanted.')
    this.name = 'JobDropped'
  }
}

export type ResultState =
  /**
   * Computing, or waiting for the analysis whose result it analyzes (`message` says which).
   * `previous` is the last result, shown meanwhile.
   */
  | { status: 'pending'; inputKey: string; previous?: AnalysisResult; message?: string }
  | { status: 'ready'; inputKey: string; result: AnalysisResult }
  /**
   * Couldn't be computed: missing input, invalid params, unknown analysis, or a thrown error; or
   * `cancelled` by the user (`cancel`; `rerun` computes it again).
   */
  | { status: 'error'; inputKey: string; message: string; cancelled?: true }

export interface CacheEntry {
  inputKey: string
  result: AnalysisResult
}

/** Runs jobs in-process. Used by tests and as a fallback when workers are unavailable. */
export function inlineRunner(registry: AnalysisRegistry): JobRunner {
  return async (job, _wanted, progress) => {
    const def = registry.get(job.analysisId)
    if (!def) throw new Error(`unknown analysis ${job.analysisId}`)
    return def.run(job.input, job.params, job.context, progress && throttleProgress(progress))
  }
}

type Prepared =
  | { ok: true; inputKey: string; job: AnalysisJob }
  | { ok: false; inputKey: string; message: string }
  /** The analyzed result is still computing; the job is prepared once it settles. */
  | { ok: 'wait'; inputKey: string; message: string }

/** Current state of an analysis whose result table another analysis reads. */
export type UpstreamLookup = (analysisId: NodeId) => ResultState | undefined

type Source =
  | { ok: true; table: DataTable; from?: RunContext['source'] }
  | { ok: false; message: string }
  | { ok: 'wait'; message: string; key: string }

/**
 * The data table an analysis reads: a data table, or the result table of the analysis it
 * analyzes (chaining), addressed by that analysis node's id.
 */
function resolveSource(
  doc: Project,
  node: AnalysisNode,
  upstream: UpstreamLookup | undefined,
): Source {
  const source = nodeById(doc.nodes, node.input.source)
  if (!source) return { ok: false, message: 'The analyzed data table no longer exists.' }
  // Roadmap 40: formulas naming info fields read the project's info sheets.
  if (source.kind === 'table')
    return {
      ok: true,
      table: mayNameInfo(source) ? withConstants(source, infoConstants(doc)) : source,
    }
  if (source.kind !== 'analysis') {
    return { ok: false, message: 'Only data tables and results with a data table can be analyzed.' }
  }
  if (source.id === node.id) return { ok: false, message: 'An analysis cannot analyze itself.' }
  const name = `“${source.name}”`
  const up = upstream?.(source.id)
  if (!up) return { ok: false, message: `The analyzed result ${name} is not available.` }
  if (up.status === 'pending') {
    return {
      ok: 'wait',
      message: `The analyzed result ${name} is still computing.`,
      key: up.inputKey,
    }
  }
  if (up.status === 'error') {
    return {
      ok: false,
      message: `The analyzed result ${name} could not be computed: ${up.message}`,
    }
  }
  const table = up.result.table
  if (!table) return { ok: false, message: `The analyzed result ${name} has no data table.` }
  const issue = tableIssues(table)[0]
  if (issue) {
    return {
      ok: false,
      message: `The data table of ${name} is malformed (${issue.path.join('.')}: ${issue.message}).`,
    }
  }
  // Roadmap 51c (S13): what the producing analysis did to the values, said by its result.
  const note = up.result.values.sourceNote
  return {
    ok: true,
    table: resultTableAs(table, source.id),
    from: {
      analysisId: source.analysisId,
      name: source.name,
      ...(note?.kind === 'text' ? { note: note.v } : {}),
    },
  }
}

/**
 * Resolves an analysis node into a runnable job, or a reason it can't run. An analysis of
 * another analysis' result table needs `upstream` (that analysis' current state): it waits while
 * the upstream one computes, and its input key covers the upstream table's content (so it reruns
 * exactly when that content changes).
 */
export function prepareJob(
  doc: Project,
  node: AnalysisNode,
  registry: AnalysisRegistry,
  upstream?: UpstreamLookup,
): Prepared {
  const fail = (message: string): Prepared => ({
    ok: false,
    inputKey: hashStrings(['error', node.id, message]),
    message,
  })

  const def = registry.get(node.analysisId)
  if (!def) return fail(`Unknown analysis "${node.analysisId}".`)

  const src = resolveSource(doc, node, upstream)
  if (src.ok === false) return fail(src.message)
  if (src.ok === 'wait') {
    return { ok: 'wait', inputKey: hashStrings(['wait', node.id, src.key]), message: src.message }
  }
  const source = src.table

  let input: NormalizedDataSet[] = []
  for (const key of node.input.dataSets) {
    const ds = normalizeColumn(source, key)
    if (!ds) return fail('A data set chosen for this analysis no longer exists.')
    input.push(ds)
  }
  // Roadmap 35: the values at one X, data sets pooled (the input's modifiers).
  let tableKind = source.tableKind
  const modifiers = { atX: node.input.atX, pools: node.input.pools, byX: node.input.byX }
  if (hasModifiers(modifiers)) {
    const modified = modifyInput(input, modifiers, tableKind)
    if ('error' in modified) return fail(modified.error)
    input = modified.input
    tableKind = modified.tableKind
  }
  if (input.length < def.inputs.min || input.length > def.inputs.max) {
    const range =
      def.inputs.min === def.inputs.max
        ? `${def.inputs.min}`
        : `${def.inputs.min}–${def.inputs.max === Number.POSITIVE_INFINITY ? 'any' : def.inputs.max}`
    return fail(`${def.title} needs ${range} data sets; ${input.length} selected.`)
  }

  // Roadmap 51c: stored params through `paramsOf` (migrated from the node's version, parsed).
  const parsed = paramsOf(def, node)
  if (!parsed.ok) return fail(`Invalid parameters: ${parsed.message}`)

  const context: RunContext = {
    tableKind,
    xTitle: node.input.atX === undefined && !node.input.byX ? (source.x?.title ?? null) : null,
    ...(src.from ? { source: src.from } : {}),
    // Roadmap 51d (U19): a grouped table's factor names, for the results' words.
    ...(tableKind === 'grouped' && (source.factorNames?.rows || source.factorNames?.columns)
      ? { factorNames: source.factorNames }
      : {}),
  }
  const inputKey = hashStrings([
    node.analysisId,
    String(def.version),
    registry.engineVersion,
    JSON.stringify(parsed.params),
    JSON.stringify(context),
    ...(hasModifiers(modifiers) ? [JSON.stringify(modifiers)] : []),
    ...input.map(hashDataSet),
  ])
  return {
    ok: true,
    inputKey,
    job: { analysisId: node.analysisId, params: parsed.params, input, context },
  }
}

/** Roadmap 51c (S20): analyses whose result tables hold values normalized to a reference. */
const NORMALIZING = new Set(['normalize'])

/**
 * Roadmap 51c (S13, S20): notes every analysis of another analysis' result carries, whatever it
 * computes — the values that analysis removed or changed (its `sourceNote`: outliers removed
 * before the test), and a group normalized to itself (every value 100, or 1: no variation left
 * to compare). Added to the result the runner returns (the cache holds it with them).
 */
export function withSourceNotes(result: AnalysisResult, job: AnalysisJob): AnalysisResult {
  const src = job.context.source
  if (!src) return result
  const notes: AnalysisResult['diagnostics'] = []
  if (src.note)
    notes.push({
      level: 'warning',
      message: `${src.note} in “${src.name}” before this analysis. Remove values only for a known cause, and report the analysis with and without them.`,
    })
  if (NORMALIZING.has(src.analysisId)) {
    const flat = job.input.filter((ds) => {
      const v = ds.data.shape === 'replicates' ? ds.data.reps.flatMap((r) => [...r]) : []
      const f = v.filter((x) => !Number.isNaN(x))
      return f.length > 1 && (f.every((x) => x === 100) || f.every((x) => x === 1))
    })
    for (const ds of flat) {
      const at = ds.data.shape === 'replicates' && ds.data.reps[0]!.find((x) => !Number.isNaN(x))
      notes.push({
        level: 'warning',
        message: `“${ds.title}” was normalized to itself and has no variation (every value is ${at}): compare the other groups with ${at} by a one-sample t test, or test the raw values with the experiment as the matching factor (paired or repeated measures).`,
      })
    }
  }
  if (!notes.length) return result
  const diagnostics = [...result.diagnostics, ...notes]
  return {
    ...result,
    diagnostics,
    status: result.status === 'error' ? 'error' : 'warning',
  }
}

/**
 * Analyses in dependency order: an analysis of another analysis' result comes after it. Analyses
 * caught in a cycle (which the document refuses, but a hand-edited file could hold), and those
 * downstream of one, are also listed in `cyclic`.
 */
export function analysisOrder(doc: Project): { order: AnalysisNode[]; cyclic: Set<NodeId> } {
  const order: AnalysisNode[] = []
  const cyclic = new Set<NodeId>()
  const state = new Map<NodeId, 'visiting' | 'done'>()
  const stack: NodeId[] = []
  const visit = (node: AnalysisNode) => {
    const s = state.get(node.id)
    if (s === 'done') return
    if (s === 'visiting') {
      for (const id of stack.slice(stack.indexOf(node.id))) cyclic.add(id)
      return
    }
    state.set(node.id, 'visiting')
    stack.push(node.id)
    const up = nodeById(doc.nodes, node.input.source)
    if (up?.kind === 'analysis') visit(up)
    stack.pop()
    state.set(node.id, 'done')
    order.push(node)
  }
  for (const node of Object.values(doc.nodes)) if (node.kind === 'analysis') visit(node)
  // Upstream comes first in `order`, so one pass marks everything downstream of a cycle.
  for (const node of order) if (cyclic.has(node.input.source)) cyclic.add(node.id)
  return { order, cyclic }
}

/** At most this many results are cached… */
export const MAX_CACHE = 500
/**
 * …and results no analysis shows are dropped, oldest first, while the cache holds more than about
 * this many bytes (audit 2, M16: one result table of a million rows is tens of megabytes). The
 * newest result is always kept, and so are results shown (their memory is held by what shows them).
 */
export const MAX_CACHE_BYTES = 256 * 2 ** 20

/**
 * About how many bytes a value holds (a result): 8 per number and per array slot, 2 per string
 * character, typed arrays by their length, each object counted once. An estimate for bounding the
 * cache, not a measure of the heap.
 */
export function estimateBytes(value: unknown): number {
  let bytes = 0
  const seen = new Set<object>()
  const stack: unknown[] = [value]
  while (stack.length) {
    const v = stack.pop()
    switch (typeof v) {
      case 'number':
        bytes += 8
        continue
      case 'boolean':
        bytes += 4
        continue
      case 'string':
        bytes += 16 + 2 * v.length
        continue
      case 'object':
        break
      default:
        continue
    }
    if (v === null || seen.has(v as object)) continue
    seen.add(v as object)
    if (ArrayBuffer.isView(v)) bytes += 64 + v.byteLength
    else if (Array.isArray(v)) {
      bytes += 16 + 8 * v.length
      for (let i = 0; i < v.length; i++) {
        const x = v[i]
        if (x !== null && typeof x === 'object') stack.push(x)
        else if (typeof x === 'string') bytes += 16 + 2 * x.length
      }
    } else if (v instanceof Map) {
      bytes += 64
      for (const [k, x] of v) stack.push(k, x)
    } else if (v instanceof Set) {
      bytes += 64
      for (const x of v) stack.push(x)
    } else {
      bytes += 32
      for (const k in v as object) {
        bytes += 8 + 2 * k.length
        stack.push((v as Record<string, unknown>)[k])
      }
    }
  }
  return bytes
}

/** `estimateBytes` of results, kept per result (a result seeded again is not walked again). */
const resultSizes = new WeakMap<AnalysisResult, number>()
function resultBytes(result: AnalysisResult): number {
  let n = resultSizes.get(result)
  if (n === undefined) {
    n = estimateBytes(result)
    resultSizes.set(result, n)
  }
  return n
}

/**
 * Whether a recomputed result is the one a file held: the same after the file's round trip
 * (validated as a file's is; numbers equal, NaN equal to NaN, absent keys and undefined alike).
 */
export function sameResult(saved: AnalysisResult, fresh: AnalysisResult): boolean {
  const parsed = AnalysisResult.safeParse(fresh)
  return sameValue(saved, parsed.success ? parsed.data : fresh)
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return a === b || (Number.isNaN(a) && Number.isNaN(b))
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bs = b as unknown[]
    return a.length === bs.length && a.every((v, i) => sameValue(v, bs[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined)
  const ak = keys(ao)
  return ak.length === keys(bo).length && ak.every((k) => sameValue(ao[k], bo[k]))
}

/**
 * Keeps analysis results in step with the document. Results live here, never in the document:
 * they're derived, not undoable, and persisted only as a cache.
 */
export class ComputeEngine {
  private states = new Map<NodeId, ResultState>()
  private cache = new Map<string, AnalysisResult>()
  /** The cached results' estimated sizes (`estimateBytes`), by key, and their sum. */
  private sizes = new Map<string, number>()
  private cachedBytes = 0
  /** Cache keys of results read from a file and not yet recomputed (`verifySeeded`). */
  private fromFile = new Set<string>()
  private inflight = new Map<string, Promise<void>>()
  private listeners = new Set<() => void>()
  /** Roadmap 42: how far running jobs have got, by key; a side channel (no `version` change). */
  private progress = new Map<string, ReportedProgress>()
  private progressListeners = new Set<() => void>()
  private unsubscribe: (() => void) | null = null
  /** Increments on every result change; lets UIs subscribe cheaply. */
  version = 0

  constructor(
    private readonly store: DocumentStore,
    private readonly registry: AnalysisRegistry,
    private readonly runner: JobRunner,
    /** The cache's bounds (default `MAX_CACHE` results, `MAX_CACHE_BYTES`). */
    private readonly cacheLimits: { results?: number; bytes?: number } = {},
  ) {}

  start(): void {
    this.unsubscribe = this.store.subscribe(() => this.update())
    this.update()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  get(id: NodeId): ResultState | undefined {
    return this.states.get(id)
  }

  /** The latest usable result, including the previous one while recomputing. */
  latest(id: NodeId): AnalysisResult | undefined {
    const s = this.states.get(id)
    if (s?.status === 'ready') return s.result
    if (s?.status === 'pending') return s.previous
    return undefined
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /**
   * How far the job an analysis is computing has got, when its analysis reports progress
   * (roadmap 42); undefined otherwise, and when it isn't computing (ready, failed, cancelled,
   * waiting for the analysis it reads). The same object until the next report.
   */
  progressOf(id: NodeId): ReportedProgress | undefined {
    const s = this.states.get(id)
    if (s?.status !== 'pending' || s.message !== undefined) return undefined
    return this.progress.get(s.inputKey)
  }

  /** Called on every change of `progressOf` (results' changes go to `subscribe`). */
  subscribeProgress(fn: () => void): () => void {
    this.progressListeners.add(fn)
    return () => this.progressListeners.delete(fn)
  }

  /**
   * Pre-populates the cache (e.g. from a saved file); entries are used only if keys match.
   * `fromFile`: results read from a file, shown at once but recomputed by `verifySeeded`, since
   * a file's results could be anything under a key anyone can compute (audit 2 X8).
   */
  seed(entries: Iterable<CacheEntry>, opts: { fromFile?: boolean } = {}): void {
    for (const e of entries) {
      this.remember(e.inputKey, e.result)
      if (opts.fromFile) this.fromFile.add(e.inputKey)
      else this.fromFile.delete(e.inputKey)
    }
    this.update()
  }

  /**
   * Recomputes the results shown from a file (`seed` with `fromFile`), upstream analyses first so
   * an analysis of a result table runs on the recomputed table. A result that comes out the same
   * stays as it is (nothing changes on screen); one that differs, or now fails, replaces it.
   * Results from the file not shown are dropped from the cache (recomputed when needed). Resolves
   * to how many were recomputed and how many differed.
   */
  async verifySeeded(): Promise<{ checked: number; differed: number }> {
    let checked = 0
    let differed = 0
    for (;;) {
      const doc = this.store.getState()
      const { order, cyclic } = analysisOrder(doc)
      const node = order.find((n) => {
        const s = this.states.get(n.id)
        return !cyclic.has(n.id) && s?.status === 'ready' && this.fromFile.has(s.inputKey)
      })
      if (!node) break
      const key = (this.states.get(node.id) as { inputKey: string }).inputKey
      this.fromFile.delete(key)
      const prep = prepareJob(doc, node, this.registry, (id) => this.states.get(id))
      if (prep.ok !== true || prep.inputKey !== key) continue
      checked++
      let next: ResultState
      try {
        const fresh = withSourceNotes(await this.runner(prep.job), prep.job)
        const saved = this.cache.get(key)
        if (saved && sameResult(saved, fresh)) continue
        this.remember(key, fresh)
        next = { status: 'ready', inputKey: key, result: fresh }
      } catch (err) {
        this.forget(key)
        next = {
          status: 'error',
          inputKey: key,
          message: err instanceof Error ? err.message : String(err),
        }
      }
      differed++
      for (const [id, s] of this.states)
        if (s.status === 'ready' && s.inputKey === key) this.states.set(id, next)
      this.refresh()
      this.emit()
    }
    for (const key of this.fromFile) this.forget(key)
    this.fromFile.clear()
    return { checked, differed }
  }

  /** Current results for saving alongside the document. */
  snapshot(): Map<NodeId, CacheEntry> {
    const out = new Map<NodeId, CacheEntry>()
    for (const [id, s] of this.states) {
      if (s.status === 'ready') out.set(id, { inputKey: s.inputKey, result: s.result })
    }
    return out
  }

  /**
   * Stops computing an analysis (audit 2, P4): it and every analysis waiting for the same job are
   * marked cancelled, so the runner no longer wants the job (a worker running it is stopped).
   * They stay cancelled until `rerun` or a change of their input. Nothing happens unless the
   * analysis is computing (not waiting for an analysis it reads).
   */
  cancel(id: NodeId): void {
    const s = this.states.get(id)
    if (s?.status !== 'pending' || s.message !== undefined) return
    const key = s.inputKey
    for (const [n, t] of this.states)
      if (t.status === 'pending' && t.inputKey === key)
        this.states.set(n, { status: 'error', inputKey: key, message: CANCELLED, cancelled: true })
    this.clearProgress(key)
    this.refresh()
    this.emit()
  }

  /** Computes a cancelled analysis again. */
  rerun(id: NodeId): void {
    const s = this.states.get(id)
    if (s?.status !== 'error' || !s.cancelled) return
    this.states.delete(id)
    this.refresh()
    this.emit()
  }

  /** Resolves when no jobs are running (including jobs that finished jobs start downstream). */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.all(this.inflight.values())
  }

  private update() {
    if (this.refresh()) this.emit()
  }

  /**
   * Brings every analysis' state in line with the document, upstream analyses first, so an
   * analysis of a result table sees its upstream state from this same pass. Returns whether any
   * state changed.
   */
  private refresh(): boolean {
    const doc = this.store.getState()
    let changed = false

    for (const id of this.states.keys()) {
      if (doc.nodes[id]?.kind !== 'analysis') {
        this.states.delete(id)
        changed = true
      }
    }

    const { order, cyclic } = analysisOrder(doc)
    const upstream: UpstreamLookup = (id) => this.states.get(id)
    for (const node of order) {
      const prep: Prepared = cyclic.has(node.id)
        ? {
            ok: false,
            inputKey: hashStrings(['cycle', node.id]),
            message: 'This analysis depends on its own results (a cycle of analyses).',
          }
        : prepareJob(doc, node, this.registry, upstream)
      const current = this.states.get(node.id)
      if (current?.inputKey === prep.inputKey) continue
      changed = true

      if (prep.ok === false) {
        this.states.set(node.id, {
          status: 'error',
          inputKey: prep.inputKey,
          message: prep.message,
        })
        continue
      }
      if (prep.ok === 'wait') {
        this.states.set(node.id, {
          status: 'pending',
          inputKey: prep.inputKey,
          previous: this.latest(node.id),
          message: prep.message,
        })
        continue
      }
      const cached = this.cache.get(prep.inputKey)
      if (cached) {
        this.states.set(node.id, { status: 'ready', inputKey: prep.inputKey, result: cached })
        continue
      }
      this.states.set(node.id, {
        status: 'pending',
        inputKey: prep.inputKey,
        previous: this.latest(node.id),
      })
      this.launch(prep.inputKey, prep.job)
    }
    return changed
  }

  private launch(key: string, job: AnalysisJob) {
    if (this.inflight.has(key)) return
    // Progress is this run's while it runs and the engine waits for it: a report coming late
    // (after the run settled, or while its analyses are cancelled or changed) is ignored.
    let live = true
    const report = (p: JobProgress) => {
      if (!live || !this.waitsFor(key)) return
      this.progress.set(key, { fraction: p.fraction, elapsed: p.elapsed, at: Date.now() })
      for (const fn of this.progressListeners) fn()
    }
    this.clearProgress(key)
    // The key leaves `inflight` before settling, so the refresh a settle starts (or a later one)
    // can launch it again: a job lost with a crashed worker, or one dropped as unwanted.
    const run = this.runner(job, () => this.waitsFor(key), report).then(
      (raw) => {
        const result = withSourceNotes(raw, job)
        live = false
        this.inflight.delete(key)
        this.clearProgress(key)
        this.remember(key, result)
        this.settle(key, () => ({ status: 'ready', inputKey: key, result }))
      },
      (err: unknown) => {
        live = false
        this.inflight.delete(key)
        this.clearProgress(key)
        // Dropped while not wanted, but wanted again since: run it after all.
        if (err instanceof JobDropped) {
          if (this.waitsFor(key)) this.launch(key, job)
          return
        }
        const message = err instanceof Error ? err.message : String(err)
        this.settle(key, () => ({ status: 'error', inputKey: key, message }))
      },
    )
    this.inflight.set(key, run)
  }

  /** Forgets how far the job of this key had got. */
  private clearProgress(key: string) {
    if (this.progress.delete(key)) for (const fn of this.progressListeners) fn()
  }

  /** Whether a node is waiting for the job of this key. */
  private waitsFor(key: string): boolean {
    for (const s of this.states.values())
      if (s.status === 'pending' && s.inputKey === key) return true
    return false
  }

  /**
   * Applies a finished job to every node still waiting on that key (stale results are dropped),
   * then lets analyses of those results run.
   */
  private settle(key: string, make: () => ResultState) {
    let changed = false
    for (const [id, s] of this.states) {
      if (s.status === 'pending' && s.inputKey === key) {
        this.states.set(id, make())
        changed = true
      }
    }
    if (!changed) return
    this.refresh()
    this.emit()
  }

  /**
   * Caches a result as the newest, then drops the oldest beyond `MAX_CACHE` results, and the
   * oldest no analysis shows while they hold more than `MAX_CACHE_BYTES` (audit 2, M16).
   */
  private remember(key: string, result: AnalysisResult) {
    this.forget(key)
    const size = resultBytes(result)
    this.cache.set(key, result)
    this.sizes.set(key, size)
    this.cachedBytes += size
    if (this.cache.size > (this.cacheLimits.results ?? MAX_CACHE))
      this.forget(this.cache.keys().next().value!)
    const budget = this.cacheLimits.bytes ?? MAX_CACHE_BYTES
    if (this.cachedBytes <= budget) return
    const shown = new Set<string>()
    for (const s of this.states.values()) if (s.status === 'ready') shown.add(s.inputKey)
    for (const k of [...this.cache.keys()]) {
      if (this.cachedBytes <= budget) break
      if (k !== key && !shown.has(k)) this.forget(k)
    }
  }

  private forget(key: string) {
    if (!this.cache.delete(key)) return
    this.cachedBytes -= this.sizes.get(key) ?? 0
    this.sizes.delete(key)
  }

  private emit() {
    this.version += 1
    for (const fn of this.listeners) fn()
  }
}
