import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  anchoredScroll,
  type ClientPoint,
  clampZoom,
  isZoomWheel,
  wheelZoomFactor,
} from './zoom.ts'

// Roadmap 50: zoom and pan with the mouse, on the graph view's canvas and a layout page's. Alt
// (Option) or Ctrl with the wheel, and a trackpad's pinch, zoom about the pointer: the point under
// it stays put (the canvas scrolls to keep it, as far as it can scroll). The middle button dragged
// scrolls the canvas; on a trackpad, two fingers scroll it (the wheel without a modifier, left to
// the browser: never intercepted). Both are the view's own state, as the zoom select's: no undo
// step, nothing in the document. The canvas' listeners are native (a wheel listener that can
// cancel the page's own zoom must not be passive, and the middle button is taken before anything
// on the canvas).

/** How long after the wheel's last zoom point clouds are drawn again at the new resolution. */
export const RASTER_SETTLE_MS = 200

interface Anchor {
  pointer: ClientPoint
  /** The content's top left when the zoom was `from`. */
  before: ClientPoint
  from: number
  to: number
}

interface Pan {
  id: number
  x: number
  y: number
  left: number
  top: number
}

/** WebKit's pinch on a trackpad (Safari, the macOS desktop app): not a wheel event. */
interface GestureLike extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

/**
 * Zooms the canvas with the wheel and pinches, and pans it with the middle button. `content` is
 * the element the zoom scales (its top left is the scene's origin). Returns the zoom point clouds
 * are rasterised at: the zoom, held while the wheel zooms and caught up once it rests (one image
 * per gesture, not one per notch); and (audit 4, P5) `viewKey`, which changes once a scroll, a
 * zoom or a resize of the canvas has rested: large clouds then draw the part in view sharp.
 */
export function useMouseZoom(opts: {
  canvas: RefObject<HTMLElement | null>
  content: () => Element | null
  zooms: readonly number[]
  zoom: number
  setZoom: (zoom: number) => void
}): { rasterZoom: number; viewKey: number } {
  const { canvas, zoom } = opts
  const live = useRef(opts)
  live.current = opts
  const s = useRef({
    rendered: zoom,
    target: zoom,
    anchor: null as Anchor | null,
    gesture: null as number | null,
    pan: null as Pan | null,
    settle: undefined as ReturnType<typeof setTimeout> | undefined,
  })
  const [held, setHeld] = useState<number | null>(null)
  const [viewKey, setViewKey] = useState(0)

  // After a zoom from the wheel is drawn: the scroll that keeps the anchor under the pointer.
  useLayoutEffect(() => {
    const st = s.current
    const a = st.anchor
    st.anchor = null
    st.rendered = zoom
    st.target = zoom
    const el = canvas.current
    const box = live.current.content()?.getBoundingClientRect()
    if (!a || a.to !== zoom || !el || !box) return
    const next = anchoredScroll(
      { left: el.scrollLeft, top: el.scrollTop },
      a.pointer,
      a.before,
      { x: box.left, y: box.top },
      a.from,
      zoom,
    )
    el.scrollLeft = next.left
    el.scrollTop = next.top
  }, [zoom, canvas])

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const st = s.current
    const zoomTo = (z: number, pointer: ClientPoint) => {
      const { zooms, setZoom, content } = live.current
      const next = Math.round(clampZoom(zooms, z) * 1e6) / 1e6
      if (Math.abs(next - st.target) < 1e-9) return
      const box = content()?.getBoundingClientRect()
      if (!box) return
      st.anchor = { pointer, before: { x: box.left, y: box.top }, from: st.rendered, to: next }
      st.target = next
      // Point clouds keep their image till the zoom rests.
      setHeld((h) => h ?? st.rendered)
      clearTimeout(st.settle)
      st.settle = setTimeout(() => {
        setHeld(null)
        setViewKey((k) => k + 1)
      }, RASTER_SETTLE_MS)
      setZoom(next)
    }
    const onWheel = (e: WheelEvent) => {
      if (!isZoomWheel(e)) return
      // Not the page's zoom (Ctrl, a pinch), nor Firefox's history (Alt).
      e.preventDefault()
      // WebKit pinches with gesture events (below).
      if (st.gesture !== null) return
      zoomTo(st.target * wheelZoomFactor(e), { x: e.clientX, y: e.clientY })
    }
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      st.gesture = st.target
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as GestureLike
      if (st.gesture !== null) zoomTo(st.gesture * g.scale, { x: g.clientX, y: g.clientY })
    }
    const onGestureEnd = (e: Event) => {
      e.preventDefault()
      st.gesture = null
    }
    // The middle button: taken before anything on the canvas sees it (no selection, no drag,
    // no edit).
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 1 || st.pan) return
      e.stopPropagation()
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // Released already (a quick click): nothing to hold.
      }
      st.pan = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: el.scrollLeft,
        top: el.scrollTop,
      }
      el.dataset.panning = ''
    }
    const onPointerMove = (e: PointerEvent) => {
      const p = st.pan
      if (!p || e.pointerId !== p.id) return
      e.stopPropagation()
      el.scrollLeft = p.left - (e.clientX - p.x)
      el.scrollTop = p.top - (e.clientY - p.y)
    }
    const endPan = (e: PointerEvent) => {
      const p = st.pan
      if (!p || e.pointerId !== p.id) return
      e.stopPropagation()
      st.pan = null
      delete el.dataset.panning
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
    }
    // The middle button's own default: the browser's autoscroll (Windows, Linux), a paste
    // (Linux), focus; and its click (auxclick).
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      e.stopPropagation()
    }
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    }
    const listeners: [string, EventListener, AddEventListenerOptions][] = [
      ['wheel', onWheel as EventListener, { passive: false }],
      ['gesturestart', onGestureStart, {}],
      ['gesturechange', onGestureChange, {}],
      ['gestureend', onGestureEnd, {}],
      ['pointerdown', onPointerDown as EventListener, { capture: true }],
      ['pointermove', onPointerMove as EventListener, { capture: true }],
      ['pointerup', endPan as EventListener, { capture: true }],
      ['pointercancel', endPan as EventListener, { capture: true }],
      ['lostpointercapture', endPan as EventListener, { capture: true }],
      ['mousedown', onMouseDown as EventListener, { capture: true }],
      ['auxclick', onAuxClick as EventListener, { capture: true }],
    ]
    for (const [type, f, o] of listeners) el.addEventListener(type, f, o)
    // Audit 4 (P5): the view rests a while after the last scroll (a pan) or resize.
    let viewRest: ReturnType<typeof setTimeout> | undefined
    const moved = () => {
      clearTimeout(viewRest)
      viewRest = setTimeout(() => setViewKey((k) => k + 1), RASTER_SETTLE_MS)
    }
    el.addEventListener('scroll', moved, { passive: true })
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(moved)
    resized?.observe(el)
    return () => {
      for (const [type, f, o] of listeners) el.removeEventListener(type, f, o)
      el.removeEventListener('scroll', moved)
      resized?.disconnect()
      clearTimeout(viewRest)
      clearTimeout(st.settle)
      st.pan = null
      delete el.dataset.panning
    }
  }, [canvas])

  return { rasterZoom: held ?? zoom, viewKey }
}
