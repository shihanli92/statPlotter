import { layoutGraph } from '@ps/graph'
import type { GraphNode } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { graphOf } from '../../graph/test/graphs.ts'
import { fixedTable, fonts, growthRatio, projectOf } from '../../graph/test/helpers.ts'
import { dragOutcome, type ElementDrag } from '../src/graph/canvasDrag.ts'
import {
  DRAG_START_PX,
  type FrameClock,
  followPointer,
  frameThrottle,
  type PointerSample,
  type PointerSource,
} from '../src/graph/dragFrames.ts'

// Roadmap 45 (UX review P2 / O21): a drag shows the pointer's latest position once an animation
// frame at most, and commits what the last pointer move made. Counted here: layouts per pointer
// moves, with several moves coming in each frame.

/** Animation frames run by hand (`tick`). */
function testClock() {
  let next = 1
  const waiting = new Map<number, () => void>()
  const clock: FrameClock = {
    request: (cb) => {
      const id = next++
      waiting.set(id, cb)
      return id
    },
    cancel: (id) => {
      waiting.delete(id)
    },
  }
  const tick = () => {
    const cbs = [...waiting.values()]
    waiting.clear()
    for (const cb of cbs) cb()
  }
  return { clock, tick, waiting: () => waiting.size }
}

/** Pointer events sent by hand. */
function testSource() {
  const fns = new Map<string, Set<(e: PointerSample) => void>>()
  const source: PointerSource = {
    addEventListener: (t, fn) => {
      const set = fns.get(t) ?? new Set()
      set.add(fn)
      fns.set(t, set)
    },
    removeEventListener: (t, fn) => {
      fns.get(t)?.delete(fn)
    },
  }
  const send = (type: string, x = 0, y = 0, mods: Partial<PointerSample> = {}) => {
    const e = {
      clientX: x,
      clientY: y,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      ...mods,
    }
    for (const fn of [...(fns.get(type) ?? [])]) fn(e)
  }
  const listening = () => [...fns.values()].reduce((n, s) => n + s.size, 0)
  return { source, send, listening }
}

describe('frameThrottle', () => {
  it('applies the latest value once a frame', () => {
    const { clock, tick } = testClock()
    const seen: number[] = []
    const t = frameThrottle<number>((v) => seen.push(v), clock)
    t.push(1)
    t.push(2)
    t.push(3)
    expect(seen).toEqual([])
    tick()
    expect(seen).toEqual([3])
    tick()
    expect(seen).toEqual([3])
    t.push(4)
    tick()
    expect(seen).toEqual([3, 4])
  })

  it('flushes what waits now, and cancels it', () => {
    const { clock, tick, waiting } = testClock()
    const seen: number[] = []
    const t = frameThrottle<number>((v) => seen.push(v), clock)
    t.push(1)
    expect(t.flush()).toBe(true)
    expect(seen).toEqual([1])
    expect(waiting()).toBe(0)
    expect(t.flush()).toBe(false)
    t.push(2)
    t.cancel()
    tick()
    expect(seen).toEqual([1])
  })
})

describe('followPointer', () => {
  it('starts past 3 px, shows the latest move each frame, ends with the last move', () => {
    const { clock, tick } = testClock()
    const { source, send, listening } = testSource()
    const shown: number[] = []
    const ended: (number | null)[] = []
    let starts = 0
    followPointer<number>(
      0,
      0,
      {
        at: (e) => e.clientX,
        show: (d) => shown.push(d),
        end: (d) => ended.push(d),
        onStart: () => starts++,
      },
      source,
      clock,
    )
    send('pointermove', DRAG_START_PX - 1, 0)
    tick()
    expect(shown).toEqual([])
    send('pointermove', 5, 0)
    send('pointermove', 6, 0)
    tick()
    send('pointermove', 7, 0)
    send('pointermove', 8, 0)
    // Released before the frame showed 8: the drag ends with it all the same.
    send('pointerup')
    tick()
    expect(starts).toBe(1)
    expect(shown).toEqual([6])
    expect(ended).toEqual([8])
    expect(listening()).toBe(0)
  })

  it('a press released without moving 3 px ends with no drag; pointercancel when asked', () => {
    const { clock } = testClock()
    const a = testSource()
    const ends: [number | null, boolean][] = []
    const opts = { at: (e: PointerSample) => e.clientX, show: () => {} }
    followPointer(0, 0, { ...opts, end: (d, r) => ends.push([d, r]) }, a.source, clock)
    a.send('pointermove', 1, 1)
    a.send('pointerup')
    const b = testSource()
    followPointer(
      0,
      0,
      { ...opts, end: (d, r) => ends.push([d, r]), cancellable: true },
      b.source,
      clock,
    )
    b.send('pointermove', 10, 0)
    b.send('pointercancel')
    expect(ends).toEqual([
      [null, true],
      [10, false],
    ])
    expect(a.listening() + b.listening()).toBe(0)
  })
})

/** A swarm of 180 points (three data sets of 60, evenly spread values) with a title. */
function swarm(): { project: ReturnType<typeof projectOf>; graph: GraphNode } {
  const values = (n: number, s: number) =>
    Array.from({ length: n }, (_, i) => 100 + ((i * 37 + s) % 61))
  const table = fixedTable('column', { type: 'replicates', count: 1 }, [
    [values(60, 1)],
    [values(60, 7)],
    [values(60, 13)],
  ])
  const graph = { ...graphOf(table, 'points'), title: { content: [{ text: 'Cell area' }] } }
  return { project: projectOf(table, graph), graph }
}

describe('layouts per pointer move (roadmap 45)', () => {
  /**
   * A drag of the graph title along a path of `moves` pointer moves, `perFrame` of them in each
   * animation frame: the layouts its preview made and the edit it committed. `throttled`: as the
   * graph canvas follows it now (`followPointer`); else as it did before, a preview per move.
   */
  function dragTitle(moves: number, perFrame: number, throttled: boolean) {
    const { project, graph } = swarm()
    const ctx = { project, fonts, result: () => undefined }
    const base = layoutGraph({ ...ctx, graph })
    const { clock, tick } = testClock()
    const { source, send } = testSource()
    const k = 1.5
    let layouts = 0
    let committed: unknown = null
    const outcomeOf = (d: ElementDrag) => dragOutcome(graph, base, d, { threshold: 4, sizes: [] })
    const at = (e: PointerSample): ElementDrag => ({
      kind: 'move',
      target: { kind: 'title' },
      dx: e.clientX / k,
      dy: e.clientY / k,
      free: e.altKey,
    })
    const show = (d: ElementDrag) => {
      layoutGraph({ ...ctx, graph: outcomeOf(d).graph })
      layouts++
    }
    const end = (d: ElementDrag | null) => {
      committed = d && outcomeOf(d).commits
    }
    if (throttled) followPointer<ElementDrag>(0, 0, { at, show, end }, source, clock)
    else {
      // Before roadmap 45: each move past 3 px laid the preview out.
      let current: ElementDrag | null = null
      source.addEventListener('pointermove', (e) => {
        if (!current && Math.hypot(e.clientX, e.clientY) < DRAG_START_PX) return
        current = at(e)
        show(current)
      })
      source.addEventListener('pointerup', () => end(current))
    }
    for (let i = 1; i <= moves; i++) {
      // A zigzag across the plot and back over the snapping guides.
      send('pointermove', 3 + i * 0.75, 5 + Math.abs((i % 40) - 20) * 1.5)
      if (i % perFrame === 0) tick()
    }
    send('pointerup')
    return { layouts, committed }
  }

  it('lays the graph out once a frame, not once a move; commits the same edit', () => {
    const before = dragTitle(120, 4, false)
    const after = dragTitle(120, 4, true)
    // Before: every pointer move laid the graph out (120); after: once a frame (30).
    expect(before.layouts).toBe(120)
    expect(after.layouts).toBe(30)
    expect(after.committed).not.toBeNull()
    expect(JSON.stringify(after.committed)).toBe(JSON.stringify(before.committed))
    // One move a frame: a layout each, as before.
    expect(dragTitle(40, 1, true).layouts).toBe(40)
  })

  it('following the pointer costs the same per move however long the drag', () => {
    const run = (n: number) => {
      const { clock, tick } = testClock()
      const { source, send } = testSource()
      let shown = 0
      followPointer<number>(
        0,
        0,
        { at: (e) => e.clientX, show: () => shown++, end: () => {} },
        source,
        clock,
      )
      for (let i = 1; i <= n; i++) {
        send('pointermove', 3 + i, i)
        if (i % 4 === 0) tick()
      }
      send('pointerup')
    }
    expect(growthRatio(run, 20_000)).toBeLessThan(8)
  })
})
