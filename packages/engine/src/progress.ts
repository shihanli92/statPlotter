import type { Progress } from '@ps/model'

// Roadmap 42: a long analysis reports how far it has got. The plugin calls its `Progress` every
// so many iterations; this throttle passes on at most one report per interval, so the worker
// posts at most about ten messages a second however often the analysis calls.

/** How far a running job has got. */
export interface JobProgress {
  /** Done, 0–1. */
  fraction: number
  /** How long the job had computed when it reported (ms), for estimating the time left. */
  elapsed: number
}

/** The least time between two reports passed on (ms). */
export const PROGRESS_INTERVAL_MS = 100

/**
 * A `Progress` for a plugin's run that passes `report` the fraction done at most once every
 * `interval` ms (the first call at once), and only when it grew: reports in between, ones that
 * aren't a fraction (no total, NaN) and ones that go back are dropped. Elapsed time counts from
 * the throttle's creation (the run's start). No timers: a running analysis holds its thread, so
 * nothing could fire before it ends.
 */
export function throttleProgress(
  report: (p: JobProgress) => void,
  interval = PROGRESS_INTERVAL_MS,
  now: () => number = Date.now,
): Progress {
  const start = now()
  let last = Number.NEGATIVE_INFINITY
  let shown = -1
  return (done, total) => {
    const fraction = done / total
    if (!(fraction >= 0) || !(total > 0)) return
    const f = fraction > 1 ? 1 : fraction
    if (f <= shown) return
    const t = now()
    if (t - last < interval) return
    last = t
    shown = f
    report({ fraction: f, elapsed: t - start })
  }
}
