// Smooth drags (roadmap 45, UX review P2 / O21). A drag on the graph canvas or a layout page
// lays the graph out again for its live preview; it used to do so on every pointer move, however
// many came in a frame. Here the pointer's latest position is shown once an animation frame at
// most (`frameThrottle`, `followPointer`). What a drag commits is computed from the last pointer
// event, as before, never from what was last shown.

/** Animation frames: the browser's, or a test's. */
export interface FrameClock {
  request(cb: () => void): number
  cancel(id: number): void
}

export const animationFrames: FrameClock = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
}

export interface FrameThrottle<T> {
  /** The latest value, applied at the next frame (replacing one still waiting). */
  push(value: T): void
  /** Applies the value waiting, now; whether there was one. */
  flush(): boolean
  /** Drops the value waiting. */
  cancel(): void
}

/** `apply` run once an animation frame at most, with the latest value pushed. */
export function frameThrottle<T>(
  apply: (value: T) => void,
  clock: FrameClock = animationFrames,
): FrameThrottle<T> {
  let waiting: { value: T } | null = null
  let id: number | null = null
  const run = () => {
    id = null
    const w = waiting
    waiting = null
    if (w) apply(w.value)
  }
  return {
    push(value) {
      waiting = { value }
      if (id === null) id = clock.request(run)
    },
    flush() {
      if (id !== null) clock.cancel(id)
      const had = waiting !== null
      run()
      return had
    },
    cancel() {
      if (id !== null) clock.cancel(id)
      id = null
      waiting = null
    },
  }
}

/** What `followPointer` reads of a pointer event. */
export interface PointerSample {
  clientX: number
  clientY: number
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}

/** Where the pointer events come from (the window; a test's emitter). */
export interface PointerSource {
  addEventListener(type: string, fn: (e: PointerSample) => void): void
  removeEventListener(type: string, fn: (e: PointerSample) => void): void
}

/** The distance a press must move before it is a drag, in screen pixels (decision 120). */
export const DRAG_START_PX = 3

/**
 * Follows the pointer from a press at (x0, y0) until it is released. Once it has moved
 * `DRAG_START_PX`, every move makes the drag (`at`: cheap, no layout) and `show` draws the latest
 * once a frame at most; `onStart` runs at the first. The release (and `pointercancel` when
 * `cancellable`) calls `end` with the drag of the last move, null when it never started: what it
 * commits is the same whatever was shown. Returns a function that stops following.
 */
export function followPointer<D>(
  x0: number,
  y0: number,
  opts: {
    at: (e: PointerSample) => D
    show: (drag: D) => void
    end: (drag: D | null, released: boolean) => void
    onStart?: () => void
    cancellable?: boolean
  },
  source: PointerSource = window as unknown as PointerSource,
  clock: FrameClock = animationFrames,
): () => void {
  let current: D | null = null
  const frames = frameThrottle(opts.show, clock)
  const move = (e: PointerSample) => {
    if (current === null && Math.hypot(e.clientX - x0, e.clientY - y0) < DRAG_START_PX) return
    if (current === null) opts.onStart?.()
    current = opts.at(e)
    frames.push(current)
  }
  const stop = () => {
    frames.cancel()
    source.removeEventListener('pointermove', move)
    source.removeEventListener('pointerup', up)
    source.removeEventListener('pointercancel', cancel)
  }
  const finish = (released: boolean) => () => {
    stop()
    opts.end(current, released)
  }
  const up = finish(true)
  const cancel = finish(false)
  source.addEventListener('pointermove', move)
  source.addEventListener('pointerup', up)
  if (opts.cancellable) source.addEventListener('pointercancel', cancel)
  return stop
}
