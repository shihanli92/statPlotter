import { type AnalysisJob, JobDropped, type JobProgress, type JobRunner } from '@ps/engine'
import type { AnalysisResult } from '@ps/model'

/** The worker's messages: a job's result or error, or how far it has got (roadmap 42). */
export type Reply =
  | { id: number; result: AnalysisResult }
  | { id: number; error: string }
  | { id: number; progress: JobProgress }

/** The part of a Worker used here (tests pass a fake). */
export interface AnalysisWorkerLike {
  onmessage: ((e: { data: Reply }) => void) | null
  onerror: ((e: { message?: string; preventDefault?(): void }) => void) | null
  postMessage(msg: { id: number; job: AnalysisJob }): void
  terminate(): void
}

const startWorker = (): AnalysisWorkerLike =>
  new Worker(new URL('./analysis.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as AnalysisWorkerLike

/** How often the running job is checked for still being wanted (ms). */
export const STALE_CHECK_MS = 100

interface Queued {
  id: number
  job: AnalysisJob
  wanted: () => boolean
  progress: ((p: JobProgress) => void) | undefined
  resolve: (r: AnalysisResult) => void
  reject: (e: Error) => void
}

/**
 * A JobRunner backed by a dedicated worker; null where workers are unavailable (the engine then
 * runs jobs inline).
 *
 * The worker starts with the first job, not with the page: a page opened and left at once (a
 * link followed, a reload, a project opened from the URL) then has no worker script loading,
 * whose load cut short browsers report as an error (WebKit a page error, Firefox
 * NS_BINDING_ABORTED).
 *
 * Jobs go to the worker one at a time (audit 2, U5); the rest wait here, so a queued job the
 * engine no longer waits for (its input changed again) is dropped rather than sent. A worker that
 * fails (a crash, a script that can't load) is terminated: the job it was running fails, so the
 * analysis settles with the error instead of waiting for ever, and the next job starts a new
 * worker.
 *
 * The running job is checked every `STALE_CHECK_MS` (audit 2, P4): once the engine no longer
 * waits for it (its input changed, its analysis was removed or cancelled) the worker is
 * terminated, the job dropped, and the next job starts a new worker, instead of waiting behind a
 * computation nobody wants (a parallel analysis of 100,000 rows ran for minutes). A job that
 * ends within a check is never stopped, so a quick edit doesn't cost a new worker.
 *
 * The worker also posts how far the running job has got (roadmap 42; throttled there to about ten
 * messages a second); the reports go to the job's `progress`. A report of a job no longer running
 * (answered, stopped, its worker gone) is ignored.
 */
export function createWorkerRunner(
  createWorker: (() => AnalysisWorkerLike) | null = typeof Worker === 'undefined'
    ? null
    : startWorker,
): JobRunner | null {
  if (!createWorker) return null
  let worker: AnalysisWorkerLike | null = null
  const queue: Queued[] = []
  let running: Queued | null = null
  let next = 0
  let check: ReturnType<typeof setInterval> | null = null

  /** The running job is over (answered, failed or stopped): no more checks. */
  const finished = (): Queued | null => {
    const job = running
    running = null
    if (check !== null) clearInterval(check)
    check = null
    return job
  }

  /** Stops the worker running a job no longer wanted; the next job starts a new one. */
  const checkRunning = () => {
    if (!running || running.wanted()) return
    worker?.terminate()
    worker = null
    finished()?.reject(new JobDropped())
    pump()
  }

  const started = (): AnalysisWorkerLike => {
    if (worker) return worker
    const w = createWorker()
    w.onmessage = (e) => {
      if (w !== worker || !running || e.data.id !== running.id) return
      if ('progress' in e.data) {
        running.progress?.(e.data.progress)
        return
      }
      const job = finished()!
      if ('error' in e.data) job.reject(new Error(e.data.error))
      else job.resolve(e.data.result)
      pump()
    }
    w.onerror = (e) => {
      // Handled here: not also an uncaught error of the page.
      e.preventDefault?.()
      if (w !== worker) return
      w.terminate()
      worker = null
      finished()?.reject(new Error(e.message || 'The analysis worker stopped unexpectedly.'))
      pump()
    }
    worker = w
    return w
  }

  const pump = () => {
    while (!running) {
      const job = queue.shift()
      if (!job) return
      if (!job.wanted()) {
        job.reject(new JobDropped())
        continue
      }
      running = job
      try {
        started().postMessage({ id: job.id, job: job.job })
        check = setInterval(checkRunning, STALE_CHECK_MS)
      } catch (e) {
        // No worker could be made, or the job couldn't be sent to it.
        finished()
        job.reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
  }

  return (job, wanted = () => true, progress) =>
    new Promise((resolve, reject) => {
      queue.push({ id: next++, job, wanted, progress, resolve, reject })
      pump()
    })
}
