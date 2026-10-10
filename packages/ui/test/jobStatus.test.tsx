// @vitest-environment happy-dom
import type { ReportedProgress, ResultState } from '@ps/engine'
import type { NodeId } from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  formatTimeLeft,
  JobStatus,
  PROGRESS_AFTER_MS,
  timeLeft,
} from '../src/analysis/JobStatus.tsx'
import { ServicesContext } from '../src/context.tsx'
import type { AppServices } from '../src/services.ts'

// Audit 2, P4: a long analysis shows how long it has been computing and a Cancel; a cancelled
// one says so with Run again; quick jobs, analyses waiting for another and errors show nothing.

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
  reported = undefined
  vi.useRealTimers()
})

const id = 'a1' as NodeId
// A fake engine: its progress is the test's to set (`report`).
let reported: ReportedProgress | undefined
const listeners = new Set<() => void>()
const engine = {
  cancel: vi.fn(),
  rerun: vi.fn(),
  progressOf: () => reported,
  subscribeProgress: (fn: () => void) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
function report(p: ReportedProgress | undefined) {
  reported = p
  act(() => {
    for (const fn of listeners) fn()
  })
}
const services = { engine } as unknown as AppServices

function render(state: ResultState | undefined) {
  host ??= document.body.appendChild(document.createElement('div'))
  root ??= createRoot(host)
  act(() =>
    root!.render(
      <ServicesContext.Provider value={services}>
        <JobStatus id={id} state={state} />
      </ServicesContext.Provider>,
    ),
  )
  return host
}
const button = (name: string) =>
  [...host!.querySelectorAll('button')].find((b) => b.textContent === name)

describe('a job’s status', () => {
  it('shows a computing job’s time and Cancel once it has run a moment', () => {
    vi.useFakeTimers()
    const el = render({ status: 'pending', inputKey: 'k1' })
    expect(el.textContent).toBe('')
    act(() => vi.advanceTimersByTime(PROGRESS_AFTER_MS + 300))
    expect(el.querySelector('progress')?.getAttribute('aria-label')).toBe('Computing')
    expect(el.textContent).toContain('Computing… 1 s')
    act(() => vi.advanceTimersByTime(2000))
    expect(el.textContent).toContain('Computing… 3 s')
    act(() => button('Cancel')!.click())
    expect(engine.cancel).toHaveBeenCalledWith(id)
    // Another input: timed from when it started.
    render({ status: 'pending', inputKey: 'k2' })
    expect(el.textContent).toBe('')
  })

  it('shows nothing for an analysis waiting for another, ready or failed', () => {
    vi.useFakeTimers()
    const el = render({ status: 'pending', inputKey: 'k3', message: 'Waiting for “Fit”.' })
    act(() => vi.advanceTimersByTime(PROGRESS_AFTER_MS * 5))
    expect(el.textContent).toBe('')
    render({ status: 'error', inputKey: 'k3', message: 'Singular matrix.' })
    expect(el.textContent).toBe('')
    render(undefined)
    expect(el.textContent).toBe('')
  })

  it('says a cancelled analysis is, with Run again', () => {
    const el = render({ status: 'error', inputKey: 'k4', message: 'Cancelled.', cancelled: true })
    expect(el.querySelector('[role="status"]')?.textContent).toMatch(/^Cancelled/)
    act(() => button('Run again')!.click())
    expect(engine.rerun).toHaveBeenCalledWith(id)
  })
})

// Roadmap 42: an analysis that reports how far it has got shows a determinate bar and the time
// left; one that doesn't keeps the indeterminate bar.

describe('a job’s progress', () => {
  it('shows a determinate bar, the percentage and the time left once reported', () => {
    vi.useFakeTimers()
    const el = render({ status: 'pending', inputKey: 'p1' })
    act(() => vi.advanceTimersByTime(PROGRESS_AFTER_MS + 300))
    const bar = () => el.querySelector('progress')!
    // Nothing reported: indeterminate, the time taken only.
    expect(bar().hasAttribute('value')).toBe(false)
    expect(el.querySelector('.remaining')).toBeNull()
    // A quarter done after 10 s: 30 s to go.
    report({ fraction: 0.25, elapsed: 10_000, at: Date.now() })
    expect(bar().getAttribute('value')).toBe('0.25')
    expect(bar().getAttribute('aria-label')).toBe('Computing')
    expect(el.querySelector('.remaining')?.textContent).toBe('25%, about 30 s left')
    // The time taken stays as it was (the e2e test reads it).
    expect(el.textContent).toContain('Computing… 1 s')
    // Counted down between reports.
    act(() => vi.advanceTimersByTime(10_000))
    expect(el.querySelector('.remaining')?.textContent).toBe('25%, about 20 s left')
    report({ fraction: 0.9, elapsed: 100_000, at: Date.now() })
    expect(bar().getAttribute('value')).toBe('0.9')
    expect(el.querySelector('.remaining')?.textContent).toBe('90%, about 10 s left')
    // Answered: nothing shows.
    report(undefined)
    render({ status: 'ready', inputKey: 'p1', result: {} as never })
    expect(el.textContent).toBe('')
  })

  it('shows no estimate from the first second, nor before anything is done', () => {
    vi.useFakeTimers()
    const el = render({ status: 'pending', inputKey: 'p2' })
    act(() => vi.advanceTimersByTime(PROGRESS_AFTER_MS + 300))
    report({ fraction: 0.01, elapsed: 600, at: Date.now() })
    expect(el.querySelector('.remaining')?.textContent).toBe('1%')
    report({ fraction: 0, elapsed: 5000, at: Date.now() })
    expect(el.querySelector('.remaining')?.textContent).toBe('0%')
    expect(el.querySelector('progress')!.getAttribute('value')).toBe('0')
  })

  it('estimates the time left from the rate so far, counting down from the report', () => {
    const p = { fraction: 0.2, elapsed: 4000, at: 50_000 }
    expect(timeLeft(p, 50_000)).toBe(16_000)
    expect(timeLeft(p, 56_000)).toBe(10_000)
    // Overdue: none left (not negative).
    expect(timeLeft(p, 90_000)).toBe(0)
    expect(timeLeft({ ...p, elapsed: 999 }, 50_000)).toBeNull()
    expect(timeLeft({ ...p, fraction: 0 }, 50_000)).toBeNull()
    expect(formatTimeLeft(0)).toBe('a few seconds left')
    expect(formatTimeLeft(9_999)).toBe('a few seconds left')
    expect(formatTimeLeft(12_000)).toBe('about 10 s left')
    expect(formatTimeLeft(52_000)).toBe('about 50 s left')
    expect(formatTimeLeft(58_000)).toBe('about 1 min left')
    expect(formatTimeLeft(150_000)).toBe('about 3 min left')
    expect(formatTimeLeft(89 * 60_000)).toBe('about 89 min left')
    expect(formatTimeLeft(4 * 3_600_000)).toBe('about 4 h left')
  })
})
