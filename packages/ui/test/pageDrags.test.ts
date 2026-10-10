import type { PageItemBox, PageScene } from '@ps/graph'
import type { AssetId, LayoutItem, LayoutItemId, LayoutItemOf, LayoutNode, NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { liveItems, type PageDrag } from '../src/layout/drags.ts'
import { SNAP_MARGIN } from '../src/layout/snap.ts'

// Audit 2 (U12): what a drag on a layout page makes of the items while the pointer is down
// (`liveItems`): drawing with a tool, a line's end, a resize, a group scaled from a corner, each
// snapped to the other items and the page (or not), with the guides drawn.

const id = (s: string) => s as LayoutItemId
const shape = (n: string, x: number, y: number, w: number, h: number): LayoutItem => ({
  type: 'shape',
  id: id(n),
  shape: 'rect',
  x,
  y,
  w,
  h,
})
const line = (n: string, x0: number, y0: number, x1: number, y1: number): LayoutItem => ({
  type: 'line',
  id: id(n),
  from: { x: x0, y: y0 },
  to: { x: x1, y: y1 },
  stroke: { color: { rgb: '#000000' }, width: 1, dash: 'solid' },
})
const layoutOf = (items: LayoutItem[]): LayoutNode => ({
  kind: 'layout',
  id: 'L' as NodeId,
  name: 'Page',
  page: { width: 612, height: 792 },
  items,
  panelLabels: { show: true, style: 'A', size: 14 },
})
/** The page as the drag began: each item's box (lines' boxes as their bounds). */
const sceneOf = (items: LayoutItem[]): PageScene => {
  const boxes: PageItemBox[] = items.map((it, index) => {
    if (it.type === 'line') {
      const x = Math.min(it.from.x, it.to.x)
      const y = Math.min(it.from.y, it.to.y)
      const w = Math.abs(it.to.x - it.from.x)
      const h = Math.abs(it.to.y - it.from.y)
      return { id: it.id, index, type: it.type, x, y, w, h }
    }
    const b = it as LayoutItemOf<'shape'>
    return { id: it.id, index, type: it.type, x: b.x, y: b.y, w: b.w, h: b.h }
  })
  // Only the items' boxes are read.
  return { items: boxes } as unknown as PageScene
}
const drag = (o: Partial<PageDrag> & Pick<PageDrag, 'mode'>): PageDrag => ({
  index: 0,
  startX: 0,
  startY: 0,
  dx: 0,
  dy: 0,
  free: false,
  shift: false,
  ...o,
})
const sizes = { textSize: 12, tableSize: 9 }
const noPixels = () => undefined
const live = (d: PageDrag, items: LayoutItem[], sel: number[] = [d.index], threshold = 4) =>
  liveItems(d, sceneOf(items), layoutOf(items), sel, threshold, sizes, noPixels)

describe('drags on a layout page', () => {
  it('leaves moves, a graph’s scaling and box-selecting to the view', () => {
    const items = [shape('a', 100, 100, 50, 50)]
    for (const mode of ['move', 'scale', 'marquee'] as const)
      expect(live(drag({ mode, dx: 10 }), items)).toBeNull()
  })

  it('draws with a tool from the press, its end snapped to another item’s edge', () => {
    // (A drawing grabs no item: the view passes index −1.)
    const items = [shape('a', 200, 200, 50, 50)]
    const r = live(
      drag({ mode: 'create', index: -1, tool: 'rect', startX: 100, startY: 100, dx: 98, dy: 30 }),
      items,
    )!
    expect(r.items).toHaveLength(2)
    // 198 snaps to the shape's left edge at 200 (within 4 points); the y stays.
    expect(r.items[1]).toMatchObject({ type: 'shape', shape: 'rect', x: 100, y: 100, w: 100 })
    expect(r.items[1]).toMatchObject({ h: 30 })
    expect(r.guides).toEqual([expect.objectContaining({ axis: 'x', at: 200 })])
    // Not snapped with a negative threshold.
    const free = live(
      drag({ mode: 'create', index: -1, tool: 'rect', startX: 100, startY: 100, dx: 98, dy: 30 }),
      items,
      [],
      -1,
    )!
    expect(free.items[1]).toMatchObject({ w: 98 })
    expect(free.guides).toEqual([])
  })

  it('draws a line at 45° steps with Shift, unsnapped', () => {
    const r = live(
      drag({
        mode: 'create',
        index: -1,
        tool: 'line',
        startX: 100,
        startY: 100,
        dx: 50,
        dy: 46,
        shift: true,
      }),
      [],
    )!
    const l = r.items[0] as LayoutItemOf<'line'>
    expect(l.from).toEqual({ x: 100, y: 100 })
    expect(l.to.x - l.from.x).toBeCloseTo(l.to.y - l.from.y, 3)
    expect(r.guides).toEqual([])
  })

  it('moves one end of a line, snapped to the page margin, or at 45° from the other end', () => {
    const items = [line('l', 100, 100, 200, 100)]
    const r = live(drag({ mode: 'end', end: 'to', dx: SNAP_MARGIN - 200 + 2, dy: 60 }), items)!
    expect((r.items[0] as LayoutItemOf<'line'>).to).toEqual({ x: SNAP_MARGIN, y: 160 })
    expect((r.items[0] as LayoutItemOf<'line'>).from).toEqual({ x: 100, y: 100 })
    expect(r.guides.map((g) => [g.axis, g.at])).toEqual([['x', SNAP_MARGIN]])
    // The start dragged to (150, 60): up and to the left of the other end (200, 100), at 45°.
    const shifted = live(drag({ mode: 'end', end: 'from', dx: 50, dy: -40, shift: true }), items)!
    const s = (shifted.items[0] as LayoutItemOf<'line'>).from
    expect(s.x).toBeLessThan(200)
    expect(s.x - 200).toBeCloseTo(s.y - 100, 3)
    expect((shifted.items[0] as LayoutItemOf<'line'>).to).toEqual({ x: 200, y: 100 })
    // Only a line has ends.
    expect(live(drag({ mode: 'end', end: 'to', dx: 5 }), [shape('a', 0, 0, 9, 9)])).toBeNull()
  })

  it('resizes an item from a handle, its moving edges snapped', () => {
    const items = [shape('a', 100, 100, 50, 50), shape('b', 300, 100, 50, 50)]
    // The east edge (150) dragged 148 → 298: snaps to b's left edge (300).
    const r = live(drag({ mode: 'resize', handle: 'e', dx: 148 }), items)!
    expect(r.items[0]).toMatchObject({ x: 100, y: 100, w: 200, h: 50 })
    expect(r.items[1]).toBe(items[1])
    expect(r.guides.map((g) => [g.axis, g.at])).toEqual([['x', 300]])
    // The south edge too, for a resize (150 + 2 = 152: b's bottom edge at 150).
    const se = live(drag({ mode: 'resize', handle: 'se', dx: 0, dy: 2 }), items)!
    expect(se.items[0]).toMatchObject({ h: 50 })
    // No handle, or an item gone: nothing.
    expect(live(drag({ mode: 'resize', dx: 5 }), items)).toBeNull()
    expect(live(drag({ mode: 'resize', handle: 'e', index: 5, dx: 5 }), items)).toBeNull()
  })

  it('scales a group from a corner about the opposite corner', () => {
    const items = [shape('a', 100, 100, 50, 50), shape('b', 150, 150, 50, 50)]
    // The group's bounds are (100, 100)–(200, 200); dragging the south-east corner by 100 doubles
    // it about (100, 100).
    const r = live(drag({ mode: 'group', handle: 'se', dx: 100, dy: 100 }), items, [0, 1], -1)!
    expect(r.items[0]).toMatchObject({ x: 100, y: 100, w: 100, h: 100 })
    expect(r.items[1]).toMatchObject({ x: 200, y: 200, w: 100, h: 100 })
  })

  it('keeps an image’s proportions unless freed', () => {
    const image: LayoutItem = {
      type: 'image',
      id: id('i'),
      asset: 'a1' as AssetId,
      x: 0,
      y: 0,
      w: 200,
      h: 100,
    }
    const pixels = () => ({ width: 400, height: 200 })
    const run = (free: boolean) =>
      liveItems(
        drag({ mode: 'resize', handle: 'se', dx: 100, dy: 0, free }),
        sceneOf([image]),
        layoutOf([image]),
        [0],
        -1,
        sizes,
        pixels,
      )!.items[0] as LayoutItemOf<'image'>
    const kept = run(false)
    expect(kept.w / kept.h).toBeCloseTo(2, 6)
    expect(run(true)).toMatchObject({ w: 300, h: 100 })
  })
})
