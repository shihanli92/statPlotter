import type { PageScene } from '@ps/graph'
import type { LayoutItem, LayoutNode } from '@ps/model'
import { handleSides, type ResizeHandle } from '../graph/resize.ts'
import { unionOf } from './arrange.ts'
import { groupScale, imageAspect, resizeItem, scaleItem } from './items.ts'
import { type Guide, pageSnapLines, snapValue } from './snap.ts'
import { constrain45, type DrawTool, drawnItem } from './tools.ts'

// Drags on a layout page (roadmap 32) and what they make of the page's items while the pointer
// is down: the layout view draws `liveItems` and commits them on release.

export interface PageDrag {
  /**
   * move: the selection; scale: one graph from its corner handle; marquee: box-select; resize:
   * one item from a handle; group: several items scaled as one from a corner; end: a line's end;
   * create: an object drawn with a tool.
   */
  mode: 'move' | 'scale' | 'marquee' | 'resize' | 'group' | 'end' | 'create'
  /** The item grabbed (move / scale / resize / end). */
  index: number
  handle?: ResizeHandle
  end?: 'from' | 'to'
  tool?: DrawTool
  /** Pointer start on the page, in points. */
  startX: number
  startY: number
  /** Raw pointer movement, in points. */
  dx: number
  dy: number
  /** Snapping off (Alt/Option held); for images, their proportions freed too. */
  free: boolean
  /** Shift: proportions kept, lines at 45° steps. */
  shift: boolean
}

/**
 * The items as a resize, a group's scaling, a line end's move or a drawing makes them, snapped
 * (within `threshold` points; negative: not) to the other items' edges and centres and the page's
 * margins and centre, as `base` (the page when the drag began) has them; with the guides to draw.
 * Null for other drags. `pixels` gives an image's size (to keep its proportions).
 */
export function liveItems(
  drag: PageDrag,
  base: PageScene,
  layout: LayoutNode,
  sel: readonly number[],
  threshold: number,
  sizes: { textSize: number; tableSize: number },
  pixels: (asset: string) => { width: number; height: number } | undefined,
): { items: LayoutItem[]; guides: Guide[] } | null {
  if (!['resize', 'group', 'end', 'create'].includes(drag.mode)) return null
  const moving = drag.mode === 'group' ? sel : [drag.index]
  const lines = pageSnapLines(
    base.items.filter((b) => !moving.includes(b.index)),
    layout.page,
  )
  const guides: Guide[] = []
  /** A point snapped on both axes. */
  const snapPoint = (p: { x: number; y: number }) => {
    const x = snapValue(p.x, 'x', lines.x, threshold, p.y, p.y)
    const y = snapValue(p.y, 'y', lines.y, threshold, p.x, p.x)
    for (const g of [x.guide, y.guide]) if (g) guides.push(g)
    return { x: x.v, y: y.v }
  }
  const items = [...layout.items]
  if (drag.mode === 'create' && drag.tool) {
    const from = { x: drag.startX, y: drag.startY }
    let to = { x: drag.startX + drag.dx, y: drag.startY + drag.dy }
    const line = drag.tool === 'line' || drag.tool === 'arrow'
    if (!(line && drag.shift)) to = snapPoint(to)
    items.push(drawnItem(drag.tool, from, to, drag.shift))
    return { items, guides }
  }
  if (drag.mode === 'end' && drag.end) {
    const it = layout.items[drag.index]
    if (it?.type !== 'line') return null
    const other = drag.end === 'from' ? it.to : it.from
    const raw = { x: it[drag.end].x + drag.dx, y: it[drag.end].y + drag.dy }
    const p = drag.shift ? constrain45(other, raw) : snapPoint(raw)
    items[drag.index] = { ...it, [drag.end]: p }
    return { items, guides }
  }
  const box =
    drag.mode === 'group'
      ? unionOf(base.items.filter((b) => sel.includes(b.index)))
      : base.items.find((b) => b.index === drag.index)
  if (!box || !drag.handle) return null
  // The moving edges snap (a group's: its side only, as it scales uniformly).
  const s = handleSides(drag.handle)
  let { dx, dy } = drag
  if (s.x) {
    const v0 = s.x === 1 ? box.x + box.w : box.x
    const r = snapValue(v0 + dx, 'x', lines.x, threshold, box.y, box.y + box.h)
    dx = r.v - v0
    if (r.guide) guides.push(r.guide)
  }
  if (s.y && drag.mode === 'resize') {
    const v0 = s.y === 1 ? box.y + box.h : box.y
    const r = snapValue(v0 + dy, 'y', lines.y, threshold, box.x, box.x + box.w)
    dy = r.v - v0
    if (r.guide) guides.push(r.guide)
  }
  if (drag.mode === 'group') {
    const f = groupScale(box, drag.handle, dx, dy)
    const ox = s.x === 1 ? box.x : box.x + box.w
    const oy = s.y === 1 ? box.y : box.y + box.h
    for (const i of sel) items[i] = scaleItem(items[i]!, f, ox, oy, sizes)
    return { items, guides }
  }
  const it = layout.items[drag.index]
  if (!it) return null
  const aspect = it.type === 'image' ? imageAspect(it, pixels(it.asset)) : null
  const keys = { shift: drag.shift, alt: drag.free }
  items[drag.index] = resizeItem(it, box, drag.handle, dx, dy, keys, aspect)
  return { items, guides }
}
