import { registry } from '@ps/analyses'
import { type AnalysisJob, throttleProgress } from '@ps/engine'
import { errorMessage } from '../util.ts'

// Minimal worker scope typing (the DOM and WebWorker libs can't share one program).
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; job: AnalysisJob }>) => void) | null
  postMessage: (msg: unknown) => void
}

// Runs analyses off the main thread so typing in the grid never waits on statistics.
scope.onmessage = (e) => {
  const { id, job } = e.data
  try {
    const def = registry.get(job.analysisId)
    if (!def) throw new Error(`Unknown analysis "${job.analysisId}".`)
    // Roadmap 42: how far it has got, at most every PROGRESS_INTERVAL_MS.
    const progress = throttleProgress((p) => scope.postMessage({ id, progress: p }))
    scope.postMessage({ id, result: def.run(job.input, job.params, job.context, progress) })
  } catch (err) {
    scope.postMessage({ id, error: errorMessage(err) })
  }
}
