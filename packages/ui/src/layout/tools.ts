import type { Box } from '@ps/graph'
import {
  type AssetId,
  type LayoutItem,
  type LayoutItemOf,
  newLayoutItemId,
  type PageTableSource,
  type StrokeStyle,
} from '@ps/model'

// Drawing tools on a layout page (roadmap 32): choose one, then click (a default size) or drag
// on the page. Shift keeps lines to 45° steps and shapes square or round; Escape puts the tool
// down. The geometry here is pure; the layout view feeds it pointer positions in points.

export type DrawTool = 'line' | 'arrow' | 'rect' | 'ellipse' | 'text'

export const DRAW_TOOLS: readonly { tool: DrawTool; label: string; icon: string; hint: string }[] =
  [
    { tool: 'line', label: 'Line', icon: 'minus', hint: 'Drag on the page to draw a line' },
    { tool: 'arrow', label: 'Arrow', icon: 'move-up-right', hint: 'Drag to draw an arrow' },
    { tool: 'rect', label: 'Rectangle', icon: 'square', hint: 'Drag to draw a rectangle' },
    { tool: 'ellipse', label: 'Ellipse', icon: 'circle', hint: 'Drag to draw an ellipse' },
    { tool: 'text', label: 'Text box', icon: 'type', hint: 'Click or drag to place a text box' },
  ]

/** A drag shorter than this (points) is a click: the object gets its default size. */
const CLICK_PT = 3

/** Default sizes (points): a click makes these. */
const DEFAULT_SIZE = { line: 72, shape: { w: 108, h: 72 }, textWidth: 144 }

export const DEFAULT_STROKE: StrokeStyle = { color: { rgb: '#000000' }, width: 1, dash: 'solid' }

/** A point moved from `from` so the segment lies on the nearest 45° direction. */
export function constrain45(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (!len) return to
  const step = Math.PI / 4
  const a = Math.round(Math.atan2(dy, dx) / step) * step
  // Along the diagonal keep the drag's projection, so the end stays under the pointer's reach.
  const proj = dx * Math.cos(a) + dy * Math.sin(a)
  const r = (v: number) => Math.round(v * 1000) / 1000
  return { x: r(from.x + proj * Math.cos(a)), y: r(from.y + proj * Math.sin(a)) }
}

/** The box dragged out from `from` to `to`; `square` makes it a square (Shift) toward the drag. */
export function dragBox(
  from: { x: number; y: number },
  to: { x: number; y: number },
  square: boolean,
): Box {
  let dx = to.x - from.x
  let dy = to.y - from.y
  if (square) {
    const s = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * s
    dy = Math.sign(dy || 1) * s
  }
  return {
    x: Math.min(from.x, from.x + dx),
    y: Math.min(from.y, from.y + dy),
    w: Math.abs(dx),
    h: Math.abs(dy),
  }
}

/**
 * The item a tool makes from a press at `from` and a release at `to` (points on the page): a
 * click (a move under `CLICK_PT`) makes the default size there.
 */
export function drawnItem(
  tool: DrawTool,
  from: { x: number; y: number },
  to: { x: number; y: number },
  shift: boolean,
): LayoutItem {
  const id = newLayoutItemId()
  const click = Math.hypot(to.x - from.x, to.y - from.y) < CLICK_PT
  if (tool === 'line' || tool === 'arrow') {
    const end = click
      ? { x: from.x + DEFAULT_SIZE.line, y: from.y }
      : shift
        ? constrain45(from, to)
        : to
    return {
      type: 'line',
      id,
      from: { ...from },
      to: end,
      stroke: DEFAULT_STROKE,
      ...(tool === 'arrow' ? { heads: { end: { shape: 'triangle' } } } : {}),
    }
  }
  if (tool === 'text') {
    const width = click ? undefined : Math.max(Math.abs(to.x - from.x), 24)
    return {
      type: 'text',
      id,
      x: click ? from.x : Math.min(from.x, to.x),
      y: click ? from.y : Math.min(from.y, to.y),
      content: { content: [{ text: 'Text' }] },
      ...(width !== undefined ? { width } : {}),
    }
  }
  const { w, h } = DEFAULT_SIZE.shape
  const b = click ? { x: from.x, y: from.y, w: shift ? h : w, h } : dragBox(from, to, shift)
  return {
    type: 'shape',
    id,
    shape: tool === 'ellipse' ? 'ellipse' : 'rect',
    ...b,
    stroke: DEFAULT_STROKE,
  }
}

/**
 * An image item showing a whole image of `width` × `height` pixels at `dpi` (96 when the file
 * doesn't say), scaled down to fit `room` (points), with its top-left at `at` or centred there.
 */
export function imageItemFor(
  asset: { id: AssetId; width: number; height: number; dpi?: number },
  room: { width: number; height: number },
  at: { x: number; y: number } | null,
): LayoutItemOf<'image'> {
  const dpi = asset.dpi && asset.dpi >= 30 ? asset.dpi : 96
  let w = (asset.width * 72) / dpi
  let h = (asset.height * 72) / dpi
  const fit = Math.min(1, room.width / w, room.height / h)
  w *= fit
  h *= fit
  const r = (v: number) => Math.round(v * 100) / 100
  const x = at ? at.x - w / 2 : (room.width - w) / 2 + 36
  const y = at ? at.y - h / 2 : (room.height - h) / 2 + 36
  return {
    type: 'image',
    id: newLayoutItemId(),
    asset: asset.id,
    x: r(Math.max(0, x)),
    y: r(Math.max(0, y)),
    w: r(w),
    h: r(h),
  }
}

/** A table item at (x, y). */
export const tableItemFor = (
  source: PageTableSource,
  at: { x: number; y: number },
): LayoutItemOf<'table'> => ({ type: 'table', id: newLayoutItemId(), x: at.x, y: at.y, source })
