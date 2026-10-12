/**
 * Zoom levels of the graph view (1 = actual size: 1 pt on screen is 1/72 in). The ends are the
 * zoom's limits: the wheel and pinch zoom between levels (roadmap 50), within them.
 */
export const GRAPH_ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8] as const

/** Zoom levels of the layout view (a whole page). */
export const LAYOUT_ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const

/**
 * The next zoom level in or out from `current` (which may be between levels), or `current` at
 * the end of the list.
 */
export function stepZoom(zooms: readonly number[], current: number, dir: 1 | -1): number {
  const next =
    dir > 0 ? zooms.find((z) => z > current + 1e-9) : zooms.findLast((z) => z < current - 1e-9)
  return next ?? current
}

/** `zoom` within the list's ends. */
export function clampZoom(zooms: readonly number[], zoom: number): number {
  const lo = zooms[0] ?? zoom
  const hi = zooms[zooms.length - 1] ?? zoom
  return Math.min(hi, Math.max(lo, zoom))
}

/**
 * The zoom select's choices: the levels, and `current` among them in its place when it is
 * between levels (after the wheel), so the select shows it.
 */
export function zoomChoices(zooms: readonly number[], current: number): number[] {
  if (zooms.some((z) => Math.abs(z - current) < 1e-9)) return [...zooms]
  return [...zooms, current].sort((a, b) => a - b)
}

// Roadmap 50: zooming with the wheel (Alt or Ctrl held) and with a trackpad's pinch (which
// browsers send as wheel events with Ctrl).

/** One notch of a mouse wheel, in CSS pixels (Chromium's and WebKit's delta for a notch). */
export const WHEEL_NOTCH_PX = 100
/** A line of `deltaMode` 1 (Firefox's mouse wheel: three lines a notch). */
const LINE_PX = WHEEL_NOTCH_PX / 3
/** A page of `deltaMode` 2 (one notch's worth: pages scroll a page at a time). */
const PAGE_PX = WHEEL_NOTCH_PX
/** The zoom's factor for a notch of the wheel. */
export const WHEEL_NOTCH_FACTOR = 1.1
/** A trackpad's pinch: zoom ×e per 100 px of delta (Chromium's own page zoom by pinching). */
const PINCH_RATE = 0.01

/** What a wheel event carries that its zoom depends on. */
export interface WheelInput {
  deltaX: number
  deltaY: number
  /** 0 pixels, 1 lines, 2 pages (`WheelEvent.deltaMode`). */
  deltaMode: number
  ctrlKey: boolean
}

/**
 * A wheel event's delta in CSS pixels, down (zooming out) positive: its vertical delta, else its
 * horizontal one (Shift or a sideways trackpad swipe moves the wheel's delta across). Lines and
 * pages are made pixels; one event counts for two notches at most (a page, a fast flick).
 */
export function wheelPixels(e: WheelInput): number {
  const d = e.deltaY !== 0 ? e.deltaY : e.deltaX
  const px = d * (e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1)
  const max = 2 * WHEEL_NOTCH_PX
  return Math.max(-max, Math.min(max, px))
}

/**
 * The factor a wheel event zooms by (above 1 in, below 1 out): ×1.1 a notch (anything that is not
 * a pinch); a pinch (Ctrl, small pixel deltas) at the rate browsers zoom pages by pinching.
 */
export function wheelZoomFactor(e: WheelInput): number {
  const px = wheelPixels(e)
  const pinch = e.ctrlKey && e.deltaMode === 0 && Math.abs(px) < WHEEL_NOTCH_PX / 2
  return pinch ? Math.exp(-px * PINCH_RATE) : WHEEL_NOTCH_FACTOR ** (-px / WHEEL_NOTCH_PX)
}

/**
 * A wheel event that zooms the canvas: Alt (Option on macOS) or Ctrl held (a pinch on a trackpad
 * comes with Ctrl). Plain and Shift scrolling stay the browser's.
 */
export function isZoomWheel(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return (e.altKey || e.ctrlKey) && !e.metaKey
}

/** A point in the window (client coordinates, CSS pixels). */
export interface ClientPoint {
  x: number
  y: number
}

/**
 * The scroll position that keeps the content under the pointer put across a zoom: the content's
 * point under `pointer` (measured from `before`, the content's top left at zoom `from`) is again
 * under it at zoom `to`, once the content's top left (laid out at `to`, the scroll unchanged) is
 * `after`. Centring and padding need no special case: they are in `before` and `after`. The
 * browser clamps the result to what can be scrolled.
 */
export function anchoredScroll(
  scroll: { left: number; top: number },
  pointer: ClientPoint,
  before: ClientPoint,
  after: ClientPoint,
  from: number,
  to: number,
): { left: number; top: number } {
  const r = to / from
  // Where the point is now, minus where the pointer is.
  const dx = after.x + (pointer.x - before.x) * r - pointer.x
  const dy = after.y + (pointer.y - before.y) * r - pointer.y
  return { left: scroll.left + dx, top: scroll.top + dy }
}
