// @vitest-environment happy-dom
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { gestureText, POINTER_GESTURES, zoomHint } from '../src/commands/index.ts'
import { RASTER_SETTLE_MS, useMouseZoom } from '../src/graph/useMouseZoom.ts'
import { ZoomSelect } from '../src/graph/ViewChrome.tsx'
import {
  anchoredScroll,
  clampZoom,
  GRAPH_ZOOMS,
  isZoomWheel,
  LAYOUT_ZOOMS,
  stepZoom,
  WHEEL_NOTCH_FACTOR,
  wheelPixels,
  wheelZoomFactor,
  zoomChoices,
} from '../src/graph/zoom.ts'

// Roadmap 50: zoom and pan with the mouse. Alt / Ctrl + wheel and pinches zoom about the pointer
// (the point under it stays put), the middle button drags the view; the zoom box shows a zoom
// between its levels.

const wheel = (deltaY: number, deltaMode = 0, ctrlKey = false, deltaX = 0) => ({
  deltaX,
  deltaY,
  deltaMode,
  ctrlKey,
})

describe('the zoom’s math', () => {
  it('normalises the wheel’s deltas: pixels, Firefox’s lines, pages; two notches at most', () => {
    expect(wheelPixels(wheel(100))).toBe(100)
    expect(wheelPixels(wheel(3, 1))).toBeCloseTo(100, 10)
    expect(wheelPixels(wheel(-1, 2))).toBe(-100)
    expect(wheelPixels(wheel(1000))).toBe(200)
    // Shift (or a sideways swipe) moves the delta across.
    expect(wheelPixels(wheel(0, 0, false, -50))).toBe(-50)
  })

  it('zooms ×1.1 a notch, out downwards, a pinch at the browsers’ rate', () => {
    expect(wheelZoomFactor(wheel(-100))).toBeCloseTo(WHEEL_NOTCH_FACTOR, 12)
    expect(wheelZoomFactor(wheel(100))).toBeCloseTo(1 / WHEEL_NOTCH_FACTOR, 12)
    expect(wheelZoomFactor(wheel(-3, 1))).toBeCloseTo(1.1, 12)
    // Ctrl with a mouse wheel's notch: a notch; a pinch's small deltas: e^(0.01 a pixel).
    expect(wheelZoomFactor(wheel(-100, 0, true))).toBeCloseTo(1.1, 12)
    expect(wheelZoomFactor(wheel(-10, 0, true))).toBeCloseTo(Math.exp(0.1), 12)
    // Many small events make as much as one notch.
    let z = 1
    for (let i = 0; i < 10; i++) z *= wheelZoomFactor(wheel(-10))
    expect(z).toBeCloseTo(1.1, 12)
  })

  it('zooms with Alt or Ctrl, never plain, Shift or ⌘ scrolling', () => {
    const m = (altKey: boolean, ctrlKey: boolean, metaKey = false) => ({ altKey, ctrlKey, metaKey })
    expect(isZoomWheel(m(true, false))).toBe(true)
    expect(isZoomWheel(m(false, true))).toBe(true)
    expect(isZoomWheel(m(false, false))).toBe(false)
    expect(isZoomWheel(m(true, false, true))).toBe(false)
  })

  it('keeps the point under the pointer put, centred or scrolled', () => {
    // Content at (32, 32) in the window, the pointer at (232, 132): the point (200, 100) at zoom
    // 1, drawn at (440, 220) from the content's corner at zoom 2.2.
    const s = anchoredScroll(
      { left: 0, top: 0 },
      { x: 232, y: 132 },
      { x: 32, y: 32 },
      { x: 32, y: 32 },
      1,
      2.2,
    )
    expect(s.left).toBeCloseTo(240, 10)
    expect(s.top).toBeCloseTo(120, 10)
    // The content centred (it moved left as it grew): the scroll makes up only the rest.
    const c = anchoredScroll(
      { left: 0, top: 10 },
      { x: 300, y: 200 },
      { x: 250, y: 32 },
      { x: 200, y: 22 },
      1,
      2,
    )
    // The point (50, 168) → (100, 336) from the new corner (200 - 0, 22): at 300 and 358.
    expect(c.left).toBeCloseTo(0, 10)
    expect(c.top).toBeCloseTo(10 + 158, 10)
    // A zoom back out returns where it was.
    const back = anchoredScroll(
      s,
      { x: 232, y: 132 },
      { x: 32 - 240, y: 32 - 120 },
      {
        x: 32 - 240,
        y: 32 - 120,
      },
      2.2,
      1,
    )
    expect(back.left).toBeCloseTo(0, 10)
    expect(back.top).toBeCloseTo(0, 10)
  })

  it('clamps to the lists’ ends: graphs 25%–800%, pages 25%–400%', () => {
    expect(clampZoom(GRAPH_ZOOMS, 20)).toBe(8)
    expect(clampZoom(GRAPH_ZOOMS, 0.1)).toBe(0.25)
    expect(clampZoom(LAYOUT_ZOOMS, 5)).toBe(4)
    expect(clampZoom(LAYOUT_ZOOMS, 1.37)).toBe(1.37)
  })

  it('steps from between levels, and the select lists the zoom in its place', () => {
    expect(stepZoom(GRAPH_ZOOMS, 1.331, 1)).toBe(1.5)
    expect(stepZoom(GRAPH_ZOOMS, 1.331, -1)).toBe(1.25)
    expect(stepZoom(GRAPH_ZOOMS, 7.2, 1)).toBe(8)
    expect(stepZoom(LAYOUT_ZOOMS, 0.3, -1)).toBe(0.25)
    expect(zoomChoices(LAYOUT_ZOOMS, 1)).toEqual([...LAYOUT_ZOOMS])
    expect(zoomChoices([0.5, 1, 2], 1.331)).toEqual([0.5, 1, 1.331, 2])
  })

  it('are in the shortcut sheet and the zoom box’s tooltip, per platform', () => {
    expect(gestureText(POINTER_GESTURES.wheelZoom, true)).toEqual(['⌥ + scroll', '⌃ + scroll'])
    expect(gestureText(POINTER_GESTURES.wheelZoom, false)).toEqual([
      'Alt + scroll',
      'Ctrl + scroll',
    ])
    expect(Object.values(POINTER_GESTURES).map((g) => g.mac[0])).toEqual([
      '⌥ + scroll',
      'Pinch',
      'Middle-button drag',
      'Two-finger drag',
    ])
    expect(zoomHint(true)).toMatch(/^Zoom \(⌘= \/ ⌘-; ⌥ \+ scroll or ⌃ \+ scroll, or pinch/)
    expect(zoomHint(false)).toMatch(/Ctrl\+= \/ Ctrl\+-; Alt \+ scroll or Ctrl \+ scroll/)
    expect(zoomHint(false)).toMatch(/middle-button or two-finger drag/)
  })
})

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

/** The content's corner in the window: (32, 32) less the scroll (happy-dom lays nothing out). */
const PAD = 32

interface Probe {
  zoom: number
  raster: number
  child: number
}

function Canvas({ start, probe }: { start: number; probe: Probe }) {
  const [zoom, setZoom] = useState(start)
  const canvas = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const { rasterZoom } = useMouseZoom({
    canvas,
    content: () => content.current,
    zooms: GRAPH_ZOOMS,
    zoom,
    setZoom,
  })
  probe.zoom = zoom
  probe.raster = rasterZoom
  return (
    <div ref={canvas} className="canvas" data-testid="canvas">
      {/* A stand-in for the scene's marks. */}
      <div
        ref={content}
        data-testid="content"
        style={{ width: 400 * zoom, height: 300 * zoom }}
        onPointerDown={() => {
          probe.child++
        }}
      />
    </div>
  )
}

function mount(start = 1) {
  const probe: Probe = { zoom: 0, raster: 0, child: 0 }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(<Canvas start={start} probe={probe} />))
  const canvas = host.querySelector<HTMLDivElement>('[data-testid="canvas"]')!
  const content = host.querySelector<HTMLDivElement>('[data-testid="content"]')!
  content.getBoundingClientRect = () =>
    ({ left: PAD - canvas.scrollLeft, top: PAD - canvas.scrollTop }) as DOMRect
  return { probe, canvas, content }
}

const wheelOn = (
  el: Element,
  init: WheelEventInit & { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
) => {
  const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  // happy-dom's WheelEvent takes no modifiers nor place from its init: as browsers give them.
  for (const k of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const)
    Object.defineProperty(e, k, { value: !!init[k] })
  Object.defineProperty(e, 'clientX', { value: init.clientX ?? 0 })
  Object.defineProperty(e, 'clientY', { value: init.clientY ?? 0 })
  act(() => {
    el.dispatchEvent(e)
  })
  return e
}

describe('the canvas with the mouse (happy-dom)', () => {
  it('Alt + wheel zooms in about the pointer, scrolled to keep its point put', () => {
    const { probe, canvas, content } = mount(1)
    const e = wheelOn(content, { deltaY: -100, altKey: true, clientX: 232, clientY: 132 })
    expect(e.defaultPrevented).toBe(true)
    expect(probe.zoom).toBeCloseTo(1.1, 9)
    // The point (200, 100) under the pointer is at (220, 110) from the content's corner now.
    expect(canvas.scrollLeft).toBeCloseTo(20, 6)
    expect(canvas.scrollTop).toBeCloseTo(10, 6)
    // Zoomed back out: back where it was.
    wheelOn(content, { deltaY: 100, altKey: true, clientX: 232, clientY: 132 })
    expect(probe.zoom).toBeCloseTo(1, 6)
    expect(canvas.scrollLeft).toBeCloseTo(0, 4)
    expect(canvas.scrollTop).toBeCloseTo(0, 4)
  })

  it('Ctrl + wheel (a pinch) zooms and keeps the page’s own zoom out of it', () => {
    const { probe, content } = mount(2)
    const e = wheelOn(content, { deltaY: 10, ctrlKey: true, clientX: 100, clientY: 100 })
    expect(e.defaultPrevented).toBe(true)
    expect(probe.zoom).toBeCloseTo(2 * Math.exp(-0.1), 6)
  })

  it('leaves plain, Shift and ⌘ scrolling to the browser', () => {
    const { probe, content } = mount(1)
    for (const init of [
      { deltaY: 100 },
      { deltaX: 80, deltaY: 60 },
      { deltaY: 100, shiftKey: true },
      { deltaY: 100, metaKey: true },
    ]) {
      const e = wheelOn(content, init)
      expect(e.defaultPrevented).toBe(false)
    }
    expect(probe.zoom).toBe(1)
  })

  it('stops at the ends (the event still the canvas’)', () => {
    const { probe, content } = mount(8)
    const e = wheelOn(content, { deltaY: -100, altKey: true })
    expect(e.defaultPrevented).toBe(true)
    expect(probe.zoom).toBe(8)
    const low = mount(0.26)
    wheelOn(low.content, { deltaY: 200, altKey: true })
    expect(low.probe.zoom).toBe(0.25)
  })

  it('draws point clouds at the zoom once the wheel rests', () => {
    vi.useFakeTimers()
    const { probe, content } = mount(1)
    wheelOn(content, { deltaY: -100, altKey: true })
    wheelOn(content, { deltaY: -100, altKey: true })
    expect(probe.zoom).toBeCloseTo(1.21, 9)
    expect(probe.raster).toBe(1)
    act(() => {
      vi.advanceTimersByTime(RASTER_SETTLE_MS + 1)
    })
    expect(probe.raster).toBeCloseTo(1.21, 9)
  })

  it('the middle button drags the view, seen by nothing on the canvas', () => {
    const { probe, canvas, content } = mount(3)
    const pointer = (type: string, button: number, x: number, y: number) => {
      const e = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button,
        clientX: x,
        clientY: y,
        pointerId: 1,
      })
      act(() => {
        content.dispatchEvent(e)
      })
      return e
    }
    canvas.scrollLeft = 100
    canvas.scrollTop = 50
    pointer('pointerdown', 1, 300, 200)
    expect(canvas.dataset.panning).toBe('')
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 })
    content.dispatchEvent(md)
    // No autoscroll, no focus, no paste.
    expect(md.defaultPrevented).toBe(true)
    pointer('pointermove', -1, 260, 170)
    expect(canvas.scrollLeft).toBe(140)
    expect(canvas.scrollTop).toBe(80)
    pointer('pointerup', 1, 260, 170)
    expect(canvas.dataset.panning).toBeUndefined()
    // Moves after the release scroll nothing.
    pointer('pointermove', -1, 0, 0)
    expect(canvas.scrollLeft).toBe(140)
    // The marks never saw the middle button; the left one is theirs.
    expect(probe.child).toBe(0)
    pointer('pointerdown', 0, 10, 10)
    expect(probe.child).toBe(1)
    expect(canvas.dataset.panning).toBeUndefined()
    expect(probe.zoom).toBe(3)
  })
})

describe('the zoom box', () => {
  it('shows a zoom between its levels as it is', () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(<ZoomSelect zooms={GRAPH_ZOOMS} zoom={1.331} onChange={() => {}} />))
    const select = host.querySelector('select')!
    expect(select.selectedOptions[0]?.textContent).toBe('133%')
    expect([...select.options].map((o) => o.textContent)).toContain('150%')
    expect(select.options).toHaveLength(GRAPH_ZOOMS.length + 1)
    act(() => root!.render(<ZoomSelect zooms={GRAPH_ZOOMS} zoom={2} onChange={() => {}} />))
    expect(select.options).toHaveLength(GRAPH_ZOOMS.length)
    expect(select.selectedOptions[0]?.textContent).toBe('200%')
  })
})
