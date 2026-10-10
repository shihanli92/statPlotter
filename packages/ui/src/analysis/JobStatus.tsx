import type { ReportedProgress, ResultState } from '@ps/engine'
import type { NodeId } from '@ps/model'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useServices } from '../context.tsx'

// Audit 2, P4: an analysis computing for more than a moment shows that it is, for how long, and
// a Cancel; a cancelled one says so and can be run again. Roadmap 42: an analysis that reports
// how far it has got (simulations, data sets…) shows a determinate bar, the percentage and an
// estimate of the time left; one that doesn't keeps the indeterminate bar and the time taken.

/** A job shows its progress once it has run this long (ms): a quick one never flashes it. */
export const PROGRESS_AFTER_MS = 1000

/** When each job (by input key) was first seen computing, kept across views of it. */
const since = new Map<string, number>()
const KEPT = 50

function startOf(key: string): number {
  let t = since.get(key)
  if (t === undefined) {
    t = Date.now()
    since.set(key, t)
    if (since.size > KEPT) since.delete(since.keys().next().value!)
  }
  return t
}

/**
 * The time a job has left (ms) at `now`, extrapolated from its last report at the rate it has
 * gone so far; null until it has computed a second (an estimate from the first moments, set-up
 * included, misleads) or while it reports nothing done.
 */
export function timeLeft(p: ReportedProgress, now: number): number | null {
  if (!(p.fraction > 0) || p.elapsed < 1000) return null
  const left = (p.elapsed * (1 - p.fraction)) / p.fraction - (now - p.at)
  return left > 0 ? left : 0
}

/** "about 40 s left", "about 3 min left"; "a few seconds left" under 10 s. */
export function formatTimeLeft(ms: number): string {
  const s = ms / 1000
  if (s < 10) return 'a few seconds left'
  if (s < 55) return `about ${Math.round(s / 5) * 5} s left`
  const min = s / 60
  if (min < 90) return `about ${Math.round(min)} min left`
  return `about ${Math.round(min / 60)} h left`
}

/**
 * "Computing… 12 s" with Cancel (and, when the analysis reports it, "37%, about 2 min left"), or
 * "Cancelled" with Run again; nothing otherwise.
 */
export function JobStatus({ id, state }: { id: NodeId; state: ResultState | undefined }) {
  const { engine } = useServices()
  // Computing a job of its own (not waiting for an analysis it reads).
  const key = state?.status === 'pending' && state.message === undefined ? state.inputKey : null
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!key) return
    startOf(key)
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [key])
  const subscribe = useCallback((fn: () => void) => engine.subscribeProgress(fn), [engine])
  const progress = useSyncExternalStore(subscribe, () => engine.progressOf(id))

  if (state?.status === 'error' && state.cancelled) {
    return (
      <div className="banner info job-status">
        <span role="status">Cancelled: these results weren’t computed.</span>
        <button type="button" onClick={() => engine.rerun(id)}>
          Run again
        </button>
      </div>
    )
  }
  if (!key) return null
  const elapsed = now - startOf(key)
  if (elapsed < PROGRESS_AFTER_MS) return null
  const left = progress ? timeLeft(progress, now) : null
  return (
    <div className="banner info job-status">
      {progress ? (
        <progress aria-label="Computing" value={progress.fraction} max={1} />
      ) : (
        <progress aria-label="Computing" />
      )}
      <span>
        Computing… <span className="elapsed">{Math.floor(elapsed / 1000)} s</span>
      </span>
      {progress && (
        <span className="remaining">
          {Math.floor(progress.fraction * 100)}%{left !== null && `, ${formatTimeLeft(left)}`}
        </span>
      )}
      <button
        type="button"
        onClick={() => engine.cancel(id)}
        title="Stop computing this analysis (Run again computes it)"
      >
        Cancel
      </button>
    </div>
  )
}
