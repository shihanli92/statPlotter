import type { Box } from '@ps/graph'
import type { AssetId, GroupId, LayoutItem, LayoutItemId, LayoutItemOf, NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  alignMoves,
  applyMoves,
  arrangeUnits,
  distributeMoves,
  reorderItems,
  unionOf,
} from '../src/layout/arrange.ts'
import {
  copyItems,
  cropEdges,
  cropImage,
  groupItems,
  groupScale,
  idsAt,
  imageAspect,
  indicesOf,
  moveItem,
  resizeBox,
  resizeItem,
  scaleItem,
  setLocked,
  ungroupItems,
  withGroups,
} from '../src/layout/items.ts'
import { constrain45, dragBox, drawnItem, imageItemFor } from '../src/layout/tools.ts'

// Roadmap 32: page items as data — moves, resizes, groups, locks, align / distribute / order,
// and drawing with the tools.

const id = (s: string) => s as LayoutItemId
const g = (s: string) => s as GroupId
const shape = (n: string, x: number, y: number, w = 20, h = 10, group?: string): LayoutItem => ({
  type: 'shape',
  id: id(n),
  shape: 'rect',
  x,
  y,
  w,
  h,
  ...(group ? { group: g(group) } : {}),
})
const boxOfShape = (it: LayoutItem): Box => {
  const s = it as LayoutItemOf<'shape'>
  return { x: s.x, y: s.y, w: s.w, h: s.h }
}
const line: LayoutItem = {
  type: 'line',
  id: id('l'),
  from: { x: 0, y: 0 },
  to: { x: 30, y: 40 },
  stroke: { color: { rgb: '#000000' }, width: 1, dash: 'solid' },
}
const base = { textSize: 12, tableSize: 9 }

describe('moving and scaling items', () => {
  it('moves boxes by their corner and lines by both ends', () => {
    expect(moveItem(shape('a', 1, 2), 3, 4)).toMatchObject({ x: 4, y: 6 })
    expect(moveItem(line, 5, -5)).toMatchObject({ from: { x: 5, y: -5 }, to: { x: 35, y: 35 } })
  })

  it('scales about a point: positions, sizes, graph scale, font sizes; not line widths', () => {
    const graph: LayoutItem = {
      type: 'graph',
      id: id('g'),
      graph: 'x' as NodeId,
      x: 10,
      y: 10,
      scale: 0.5,
    }
    expect(scaleItem(graph, 2, 0, 0, base)).toMatchObject({ x: 20, y: 20, scale: 1 })
    expect(scaleItem(line, 2, 10, 0, base)).toMatchObject({
      from: { x: -10, y: 0 },
      to: { x: 50, y: 80 },
      stroke: { width: 1 },
    })
    const text: LayoutItem = {
      type: 'text',
      id: id('t'),
      x: 10,
      y: 10,
      width: 100,
      content: { content: [{ text: 'a' }, { text: 'b', size: 20 }] },
    }
    const t = scaleItem(text, 1.5, 0, 0, base) as LayoutItemOf<'text'>
    expect(t).toMatchObject({ x: 15, width: 150, content: { style: { size: 18 } } })
    expect(t.content.content[1]!.size).toBe(30)
    const table: LayoutItem = {
      type: 'table',
      id: id('tb'),
      x: 0,
      y: 0,
      source: { kind: 'table', node: 'x' as NodeId },
    }
    expect(scaleItem(table, 2, 0, 0, base)).toMatchObject({ text: { size: 18 } })
  })
})

describe('resizing', () => {
  const b = { x: 10, y: 10, w: 100, h: 50 }
  it('moves the dragged sides; the opposite ones stay; never below the minimum', () => {
    expect(resizeBox(b, 'se', 20, 10)).toEqual({ x: 10, y: 10, w: 120, h: 60 })
    expect(resizeBox(b, 'nw', 20, 10)).toEqual({ x: 30, y: 20, w: 80, h: 40 })
    expect(resizeBox(b, 'e', 20, 99)).toEqual({ x: 10, y: 10, w: 120, h: 50 })
    expect(resizeBox(b, 'w', 500, 0)).toEqual({ x: 108, y: 10, w: 2, h: 50 })
  })

  it('keeps the proportions from corners (the larger change) and edges (centred)', () => {
    expect(resizeBox(b, 'se', 100, 0, { aspect: 2 })).toEqual({ x: 10, y: 10, w: 200, h: 100 })
    expect(resizeBox(b, 'nw', 0, -50, { aspect: 2 })).toEqual({ x: -90, y: -40, w: 200, h: 100 })
    expect(resizeBox(b, 's', 0, 50, { aspect: 2 })).toEqual({ x: -40, y: 10, w: 200, h: 100 })
    expect(groupScale(b, 'se', 100, 0)).toBe(2)
  })

  it('images keep their proportions unless freed; text boxes change their wrap width', () => {
    const img: LayoutItem = { type: 'image', id: id('i'), asset: 'a'.repeat(32) as AssetId, ...b }
    const keys = { shift: false, alt: false }
    expect(resizeItem(img, b, 'e', 100, 0, keys, 2)).toMatchObject({ w: 200, h: 100 })
    expect(resizeItem(img, b, 'e', 100, 0, { ...keys, alt: true }, 2)).toMatchObject({
      w: 200,
      h: 50,
    })
    expect(resizeItem({ ...img, freeAspect: true }, b, 'e', 100, 0, keys, 2)).toMatchObject({
      h: 50,
    })
    expect(resizeItem(shape('s', 10, 10, 100, 50), b, 'se', 100, 0, keys, null)).toMatchObject({
      w: 200,
      h: 50,
    })
    expect(
      resizeItem(shape('s', 10, 10, 100, 50), b, 'se', 100, 0, { ...keys, shift: true }, null),
    ).toMatchObject({ w: 200, h: 100 })
    const text: LayoutItem = {
      type: 'text',
      id: id('t'),
      x: 14,
      y: 14,
      content: { content: [] },
      border: line.type === 'line' ? line.stroke : undefined,
    }
    // A framed text box: its box is 4 pt outside the text.
    expect(resizeItem(text, { x: 10, y: 10, w: 60, h: 20 }, 'w', -20, 0, keys, null)).toMatchObject(
      { x: -6, width: 72 },
    )
  })

  it('crops an image keeping its scale, so the picture stays put', () => {
    const img: LayoutItemOf<'image'> = {
      type: 'image',
      id: id('i'),
      asset: 'a'.repeat(32) as AssetId,
      x: 100,
      y: 100,
      w: 200,
      h: 100,
    }
    const c = cropImage(img, { left: 25, right: 25, top: 0, bottom: 50 })
    expect(c).toMatchObject({
      x: 150,
      y: 100,
      w: 100,
      h: 50,
      crop: { x: 0.25, y: 0, w: 0.5, h: 0.5 },
    })
    expect(cropEdges(c.crop)).toEqual({ left: 25, right: 25, top: 0, bottom: 50 })
    const back = cropImage(c, { left: 0, right: 0, top: 0, bottom: 0 })
    expect(back).toEqual(img)
    // Proportions of what is shown: the crop of a 400 × 100 px picture.
    expect(imageAspect(c, { width: 400, height: 100 })).toBe(4)
    // Never cropped away entirely.
    expect(cropImage(img, { left: 80, right: 80, top: 0, bottom: 0 }).crop!.w).toBeCloseTo(0.01, 9)
  })
})

describe('groups and locks', () => {
  const items = [
    shape('a', 0, 0),
    shape('b', 50, 0, 20, 10, 'g1'),
    shape('c', 100, 0),
    shape('d', 150, 0, 20, 10, 'g1'),
  ]

  it('selecting one member selects its group', () => {
    expect(withGroups(items, [1])).toEqual([1, 3])
    expect(withGroups(items, [0])).toEqual([0])
  })

  it('groups items together where the topmost was, and ungroups them', () => {
    const r = groupItems(items, [0, 2])
    expect(r.items.map((it) => it.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(r.selection).toEqual([1, 2])
    expect(r.items[1]!.group).toBe(r.items[2]!.group)
    // Grouping with a member of a group merges that group in.
    const m = groupItems(items, [0, 1])
    expect(new Set(m.items.slice(1).map((it) => it.group)).size).toBe(1)
    expect(m.selection.length).toBe(3)
    expect(ungroupItems(items, [3]).every((it) => !it.group)).toBe(true)
  })

  it('copies get new ids and new groups, moved by the offset', () => {
    const copies = copyItems([items[1]!, items[3]!, items[0]!], 12, 12)
    expect(copies.map((c) => c.id)).not.toContain('b')
    expect(copies[0]!.group).toBe(copies[1]!.group)
    expect(copies[0]!.group).not.toBe('g1')
    expect(copies[2]!.group).toBeUndefined()
    expect(copies[2]).toMatchObject({ x: 12, y: 12 })
  })

  it('locks and unlocks', () => {
    const locked = setLocked(items, [0, 2], true)
    expect(locked.map((it) => !!it.locked)).toEqual([true, false, true, false])
    expect(setLocked(locked, [0, 1, 2, 3], false).some((it) => 'locked' in it)).toBe(false)
  })
})

describe('a selection held by id (audit 2, U1)', () => {
  const a = shape('a', 0, 0)
  const b = shape('b', 40, 0)
  const c = shape('c', 80, 0)
  it('follows its items through a reorder and its undo', () => {
    const ids = idsAt([a, b, c], [0])
    const front = reorderItems([a, b, c], [0], 'front')
    expect(indicesOf(front.items, ids)).toEqual(front.selection)
    // Undone: the page as it was, the same item selected (not whatever is now at index 2).
    expect(indicesOf([a, b, c], ids)).toEqual([0])
  })
  it('drops the ids that are gone and keeps the selection’s order', () => {
    expect(indicesOf([a, c], idsAt([a, b, c], [2, 1, 0]))).toEqual([1, 0])
    expect(idsAt([a], [0, 5])).toEqual([id('a')])
  })
})

describe('arranging', () => {
  const items = [
    shape('a', 0, 0, 20, 10),
    shape('b', 50, 30, 40, 20),
    shape('c', 200, 5, 10, 10, 'g'),
    shape('d', 230, 60, 10, 10, 'g'),
  ]
  const boxOf = (i: number) => boxOfShape(items[i]!)
  const units = arrangeUnits(items, [0, 1, 2, 3], boxOf)

  it('treats a group as one unit with its bounds', () => {
    expect(units.map((u) => u.indices)).toEqual([[0], [1], [2, 3]])
    expect(units[2]!.box).toEqual({ x: 200, y: 5, w: 40, h: 65 })
    expect(unionOf(units.map((u) => u.box))).toEqual({ x: 0, y: 0, w: 240, h: 70 })
  })

  it('aligns edges and centres within the selection’s bounds', () => {
    const ref = unionOf(units.map((u) => u.box))!
    const right = applyMoves(items, alignMoves(units, 'right', ref)).map(boxOfShape)
    // The group as a whole is already right-aligned.
    expect(right.map((b) => b.x + b.w)).toEqual([240, 240, 210, 240])
    const middle = applyMoves(items, alignMoves(units, 'middle', ref)).map(boxOfShape)
    expect(middle.slice(0, 2).map((b) => b.y + b.h / 2)).toEqual([35, 35])
    // The group keeps its shape: both members moved alike.
    expect(middle[3]!.y - middle[2]!.y).toBe(55)
    const page = { x: 0, y: 0, w: 612, h: 792 }
    const centred = applyMoves(items, alignMoves([units[0]!], 'center', page)).map(boxOfShape)
    expect(centred[0]!.x + 10).toBe(306)
  })

  it('distributes three or more units with equal gaps, the outer ones staying', () => {
    const d = applyMoves(items, distributeMoves(units, 'x')).map(boxOfShape)
    // Units: [0,20], [50,90]→?, group [200,240]; gap = (240 − 20 − 40 − 40) / 2 = 70.
    expect(d[0]!.x).toBe(0)
    expect(d[1]!.x).toBe(90)
    expect(d[2]!.x).toBe(200)
    expect(distributeMoves(units.slice(0, 2), 'x').size).toBe(0)
  })

  it('reorders one step or to the ends, groups as one', () => {
    const ids = (r: { items: LayoutItem[] }) => r.items.map((it) => it.id).join('')
    expect(ids(reorderItems(items, [0], 'forward'))).toBe('bacd')
    expect(ids(reorderItems(items, [1], 'forward'))).toBe('acdb')
    expect(ids(reorderItems(items, [2], 'backward'))).toBe('acdb')
    expect(ids(reorderItems(items, [3], 'back'))).toBe('cdab')
    const f = reorderItems(items, [0], 'front')
    expect(ids(f)).toBe('bcda')
    expect(f.selection).toEqual([3])
  })
})

describe('drawing tools', () => {
  it('constrains lines to 45° steps and shapes to squares', () => {
    expect(constrain45({ x: 0, y: 0 }, { x: 10, y: 1 })).toEqual({ x: 10, y: 0 })
    const d = constrain45({ x: 0, y: 0 }, { x: 10, y: 9 })
    expect(d.x).toBeCloseTo(d.y, 3)
    expect(dragBox({ x: 10, y: 10 }, { x: 0, y: 40 }, true)).toEqual({
      x: -20,
      y: 10,
      w: 30,
      h: 30,
    })
    expect(dragBox({ x: 10, y: 10 }, { x: 0, y: 40 }, false)).toEqual({ x: 0, y: 10, w: 10, h: 30 })
  })

  it('makes each object by dragging, or a default size by clicking', () => {
    expect(drawnItem('arrow', { x: 10, y: 10 }, { x: 60, y: 30 }, false)).toMatchObject({
      type: 'line',
      to: { x: 60, y: 30 },
      heads: { end: { shape: 'triangle' } },
    })
    expect(drawnItem('line', { x: 10, y: 10 }, { x: 11, y: 11 }, false)).toMatchObject({
      to: { x: 82, y: 10 },
    })
    expect(drawnItem('ellipse', { x: 10, y: 10 }, { x: 50, y: 30 }, true)).toMatchObject({
      shape: 'ellipse',
      w: 40,
      h: 40,
    })
    expect(drawnItem('rect', { x: 5, y: 5 }, { x: 5, y: 5 }, false)).toMatchObject({
      x: 5,
      y: 5,
      w: 108,
      h: 72,
    })
    expect(drawnItem('text', { x: 5, y: 5 }, { x: 105, y: 40 }, false)).toMatchObject({
      type: 'text',
      width: 100,
    })
    expect(drawnItem('text', { x: 5, y: 5 }, { x: 5, y: 5 }, false)).not.toHaveProperty('width')
  })

  it('places an image at its resolution, scaled down to fit', () => {
    const a = { id: 'a'.repeat(32) as AssetId, width: 300, height: 150, dpi: 150 }
    expect(imageItemFor(a, { width: 540, height: 720 }, { x: 100, y: 100 })).toMatchObject({
      x: 28,
      y: 64,
      w: 144,
      h: 72,
    })
    const huge = imageItemFor(
      { ...a, width: 6000, height: 3000, dpi: undefined },
      { width: 540, height: 720 },
      null,
    )
    expect([huge.w, huge.h]).toEqual([540, 270])
  })
})
