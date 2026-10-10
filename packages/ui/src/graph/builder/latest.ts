import { type DependencyList, useEffect, useMemo, useRef, useState } from 'react'

// The builder's preview on big tables (roadmap 34f, decision 433): only the last of a burst of
// changes (clicks across plot styles, arrows across presets) is laid out, a moment after it;
// requests made stale by a newer one never start, so quick clicking stays responsive whatever
// the table's size.

/** How long the preview of a big table waits for the next change before laying out (ms). */
export const PREVIEW_DELAY = 120

interface Timers {
  set: (run: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

const REAL_TIMERS: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/** Runs only the last of a burst of requests, `delay` ms after it; earlier ones never run. */
export class LatestOnly {
  private handle: unknown
  private pending = false

  constructor(
    private readonly delay: number = PREVIEW_DELAY,
    private readonly timers: Timers = REAL_TIMERS,
  ) {}

  /** Replaces any request waiting with `run`. */
  request(run: () => void): void {
    this.cancel()
    this.pending = true
    this.handle = this.timers.set(() => {
      this.pending = false
      run()
    }, this.delay)
  }

  /** Drops the request waiting, if any. */
  cancel(): void {
    if (this.pending) this.timers.clear(this.handle)
    this.pending = false
  }

  /** A request is waiting. */
  get waiting(): boolean {
    return this.pending
  }
}

/**
 * `compute()` for the current `deps`: at once (as `useMemo`) unless `later`, else only for the
 * last of quick changes (`LatestOnly`), the previous value shown meanwhile (null before the
 * first). `stale` is true while a newer value is waiting.
 */
export function useLatest<T>(
  compute: () => T,
  deps: DependencyList,
  later: boolean,
): { value: T | null; stale: boolean } {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's dependencies
  const now = useMemo(() => (later ? null : compute()), [later, ...deps])
  const [late, setLate] = useState<{ value: T; deps: DependencyList } | null>(null)
  const latest = useRef<LatestOnly | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's dependencies
  useEffect(() => {
    if (!later) return
    latest.current ??= new LatestOnly()
    latest.current.request(() => setLate({ value: compute(), deps }))
    return () => latest.current?.cancel()
  }, [later, ...deps])
  if (!later) return { value: now, stale: false }
  const fresh =
    !!late && late.deps.length === deps.length && late.deps.every((d, i) => d === deps[i])
  return { value: late?.value ?? null, stale: !fresh }
}
