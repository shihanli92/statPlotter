import { type Box, TEXT_BOX_PAD } from '@ps/graph'
import {
  type GroupId,
  type LayoutItem,
  type LayoutItemId,
  type LayoutItemOf,
  newGroupId,
  newLayoutItemId,
  type RichText,
} from '@ps/model'

import { handleSides, type ResizeHandle } from '../graph/resize.ts'

// Page items (roadmap 32) as pure data edits: moving, resizing and scaling them, copies with new
// ids, groups and locks. The layout view composes these into its commands.

/** Items with a box of their own (resized from eight handles). */
type BoxItem = LayoutItemOf<'shape'> | LayoutItemOf<'image'>

/** The smallest side a shape or image is resized to, in points. */
const MIN_SIDE = 2

/** An item moved by (dx, dy) points. */
export function moveItem<T extends LayoutItem>(it: T, dx: number, dy: number): T {
  if (!dx && !dy) return it
  if (it.type === 'line')
    return {
      ...it,
      from: { x: it.from.x + dx, y: it.from.y + dy },
      to: { x: it.to.x + dx, y: it.to.y + dy },
    }
  const p = it as Extract<LayoutItem, { x: number }>
  return { ...p, x: p.x + dx, y: p.y + dy } as T
}

/** A box item given a new box. */
const withBox = <T extends BoxItem>(it: T, b: Box): T => ({
  ...it,
  x: b.x,
  y: b.y,
  w: Math.max(MIN_SIDE, b.w),
  h: Math.max(MIN_SIDE, b.h),
})

const scaleRuns = (rt: RichText, s: number): RichText =>
  rt.map((r) => (r.size === undefined ? r : { ...r, size: round(r.size * s) }))

const round = (v: number) => Math.round(v * 100) / 100

/**
 * An item scaled by `s` about (ox, oy), as when its group is resized: positions and sizes, a
 * graph's size on the page, text and table font sizes (`textSize`, `tableSize`: their sizes when
 * they set none); line widths stay.
 */
export function scaleItem(
  it: LayoutItem,
  s: number,
  ox: number,
  oy: number,
  base: { textSize: number; tableSize: number },
): LayoutItem {
  const X = (x: number) => ox + (x - ox) * s
  const Y = (y: number) => oy + (y - oy) * s
  switch (it.type) {
    case 'graph':
      return { ...it, x: X(it.x), y: Y(it.y), scale: +(it.scale * s).toFixed(4) }
    case 'line':
      return {
        ...it,
        from: { x: X(it.from.x), y: Y(it.from.y) },
        to: { x: X(it.to.x), y: Y(it.to.y) },
      }
    case 'shape':
    case 'image':
      return {
        ...it,
        x: X(it.x),
        y: Y(it.y),
        w: it.w * s,
        h: it.h * s,
        ...(it.type === 'shape' && it.radius !== undefined ? { radius: it.radius * s } : {}),
      }
    case 'text': {
      const size = round((it.content.style?.size ?? base.textSize) * s)
      return {
        ...it,
        x: X(it.x),
        y: Y(it.y),
        content: {
          ...it.content,
          style: { ...it.content.style, size },
          content: scaleRuns(it.content.content, s),
        },
        ...(it.width !== undefined ? { width: it.width * s } : {}),
        ...(it.padding !== undefined ? { padding: it.padding * s } : {}),
      }
    }
    case 'table':
      return {
        ...it,
        x: X(it.x),
        y: Y(it.y),
        text: { ...it.text, size: round((it.text?.size ?? base.tableSize) * s) },
      }
  }
}

/**
 * Copies of items with new ids, moved by (dx, dy); items grouped together stay grouped together,
 * under a new group id.
 */
export function copyItems(items: readonly LayoutItem[], dx = 0, dy = 0): LayoutItem[] {
  const groups = new Map<GroupId, GroupId>()
  return items.map((it) => {
    const copy = moveItem({ ...structuredClone(it), id: newLayoutItemId() }, dx, dy)
    if (it.group) {
      const g = groups.get(it.group) ?? newGroupId()
      groups.set(it.group, g)
      copy.group = g
    }
    return copy
  })
}

/**
 * A page selection is held by item id (audit 2, U1): an undo, a reorder or a removal changes the
 * indices, never which items are selected. These map it to and from the indices the page
 * commands take: the ids of the items at `indices`, and the indices of the `ids` still on the
 * page (in the selection's order; ids that are gone drop out).
 */
export const idsAt = (items: readonly LayoutItem[], indices: readonly number[]): LayoutItemId[] =>
  indices.flatMap((i) => items[i]?.id ?? [])

export function indicesOf(items: readonly LayoutItem[], ids: readonly LayoutItemId[]): number[] {
  const at = new Map(items.map((it, i) => [it.id, i]))
  return ids.flatMap((id) => at.get(id) ?? [])
}

/** The indices with every member of their items' groups added, in page order. */
export function withGroups(items: readonly LayoutItem[], indices: readonly number[]): number[] {
  const groups = new Set(indices.flatMap((i) => items[i]?.group ?? []))
  const out = new Set(indices)
  items.forEach((it, i) => {
    if (it.group && groups.has(it.group)) out.add(i)
  })
  return [...out].filter((i) => i >= 0 && i < items.length).sort((a, b) => a - b)
}

/**
 * The items with these grouped: one new group (any groups among them are merged into it), drawn
 * together where the topmost of them was. Returns the items and the group's indices.
 */
export function groupItems(
  items: readonly LayoutItem[],
  indices: readonly number[],
): { items: LayoutItem[]; selection: number[] } {
  const picked = withGroups(items, indices)
  if (picked.length < 2) return { items: [...items], selection: picked }
  const group = newGroupId()
  const members = picked.map((i) => ({ ...items[i]!, group }))
  const top = picked[picked.length - 1]!
  const out: LayoutItem[] = []
  items.forEach((it, i) => {
    if (i === top) out.push(...members)
    else if (!picked.includes(i)) out.push(it)
  })
  const at = out.indexOf(members[0]!)
  return { items: out, selection: members.map((_, k) => at + k) }
}

/** The items with the groups of these ungrouped. */
export function ungroupItems(
  items: readonly LayoutItem[],
  indices: readonly number[],
): LayoutItem[] {
  const picked = new Set(withGroups(items, indices))
  return items.map((it, i) => {
    if (!picked.has(i) || !it.group) return it
    const { group: _, ...rest } = it
    return rest as LayoutItem
  })
}

/** The items at these indices locked or unlocked (`locked` absent when unlocked). */
export function setLocked(
  items: readonly LayoutItem[],
  indices: readonly number[],
  locked: boolean,
): LayoutItem[] {
  const picked = new Set(indices)
  return items.map((it, i) => {
    if (!picked.has(i) || !!it.locked === locked) return it
    if (locked) return { ...it, locked: true }
    const { locked: _, ...rest } = it
    return rest as LayoutItem
  })
}

/**
 * A box resized by dragging handle `h` by (dx, dy): the opposite side or corner stays put, no
 * side gets shorter than `min`. `aspect` (width ÷ height) keeps the proportions: from a corner
 * by the side that changed more, from an edge with the other side centred.
 */
export function resizeBox(
  b: Box,
  h: ResizeHandle,
  dx: number,
  dy: number,
  opts: { aspect?: number | null; min?: number } = {},
): Box {
  const min = opts.min ?? 2
  const s = handleSides(h)
  let [x1, x2, y1, y2] = [b.x, b.x + b.w, b.y, b.y + b.h]
  if (s.x === 1) x2 = Math.max(x1 + min, x2 + dx)
  if (s.x === -1) x1 = Math.min(x2 - min, x1 + dx)
  if (s.y === 1) y2 = Math.max(y1 + min, y2 + dy)
  if (s.y === -1) y1 = Math.min(y2 - min, y1 + dy)
  const ratio = opts.aspect
  if (ratio && ratio > 0) {
    let w = x2 - x1
    let hh = y2 - y1
    if (s.x && s.y) {
      if (w / b.w >= hh / b.h) hh = w / ratio
      else w = hh * ratio
      if (s.x === 1) x2 = x1 + w
      else x1 = x2 - w
      if (s.y === 1) y2 = y1 + hh
      else y1 = y2 - hh
    } else if (s.x) {
      hh = w / ratio
      const cy = b.y + b.h / 2
      ;[y1, y2] = [cy - hh / 2, cy + hh / 2]
    } else {
      w = hh * ratio
      const cx = b.x + b.w / 2
      ;[x1, x2] = [cx - w / 2, cx + w / 2]
    }
  }
  const r = (v: number) => Math.round(v * 100) / 100
  return { x: r(x1), y: r(y1), w: r(x2 - x1), h: r(y2 - y1) }
}

/** The uniform scale a group gets from dragging corner `h` by (dx, dy): by the width it makes. */
export function groupScale(b: Box, h: ResizeHandle, dx: number, dy: number): number {
  const r = resizeBox(b, h, dx, dy, { aspect: b.w / (b.h || 1), min: 4 })
  return b.w ? r.w / b.w : 1
}

/**
 * An item resized from a handle of `base` (its box on the page when the drag began) by (dx, dy):
 * shapes freely (Shift keeps the proportions), images keeping theirs unless `freeAspect` or Alt
 * frees them, text boxes to a new wrap width (side handles).
 */
export function resizeItem(
  it: LayoutItem,
  base: Box,
  h: ResizeHandle,
  dx: number,
  dy: number,
  keys: { shift: boolean; alt: boolean },
  imageAspectRatio: number | null,
): LayoutItem {
  if (it.type === 'shape')
    return withBox(it, resizeBox(base, h, dx, dy, { aspect: keys.shift ? base.w / base.h : null }))
  if (it.type === 'image') {
    const free = it.freeAspect || keys.alt
    const ratio = imageAspectRatio ?? base.w / base.h
    return withBox(it, resizeBox(base, h, dx, dy, { aspect: free && !keys.shift ? null : ratio }))
  }
  if (it.type === 'text') {
    const s = handleSides(h)
    if (!s.x) return it
    const framed = !!it.border || it.background?.type === 'solid'
    const pad = framed ? (it.padding ?? TEXT_BOX_PAD) : 0
    const b = resizeBox(base, s.x === 1 ? 'e' : 'w', dx, 0, { min: 2 * pad + 12 })
    return { ...it, x: b.x + pad, width: Math.round((b.w - 2 * pad) * 100) / 100 }
  }
  return it
}

/** The whole image. */
const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 } as const

/** Crop edges in percent of the image (left, right, top, bottom) from a crop rect and back. */
export function cropEdges(c: { x: number; y: number; w: number; h: number } = FULL_CROP) {
  const pct = (v: number) => Math.round(v * 10000) / 100
  return {
    left: pct(c.x),
    right: pct(1 - c.x - c.w),
    top: pct(c.y),
    bottom: pct(1 - c.y - c.h),
  }
}

/**
 * An image cropped to show another part of it at the same scale: the box grows or shrinks by
 * what is cropped and moves with the left and top edges, so the picture itself stays put.
 */
export function cropImage(
  it: LayoutItemOf<'image'>,
  edges: { left: number; right: number; top: number; bottom: number },
): LayoutItemOf<'image'> {
  const c = it.crop ?? FULL_CROP
  const clamp = (v: number) => Math.max(0, Math.min(99, v)) / 100
  let [l, r, t, b] = [clamp(edges.left), clamp(edges.right), clamp(edges.top), clamp(edges.bottom)]
  // At least 1% of the image stays in each direction.
  if (l + r > 0.99) r = 0.99 - l
  if (t + b > 0.99) b = 0.99 - t
  const next = { x: l, y: t, w: 1 - l - r, h: 1 - t - b }
  const sx = it.w / c.w
  const sy = it.h / c.h
  const round = (v: number) => Math.round(v * 1e6) / 1e6
  const full = !l && !r && !t && !b
  const { crop: _, ...rest } = it
  return {
    ...rest,
    x: it.x + sx * (next.x - c.x),
    y: it.y + sy * (next.y - c.y),
    w: sx * next.w,
    h: sy * next.h,
    ...(full
      ? {}
      : { crop: { x: round(next.x), y: round(next.y), w: round(next.w), h: round(next.h) } }),
  }
}

/** Width ÷ height of what an image shows (its crop of the picture). */
export const imageAspect = (
  it: LayoutItemOf<'image'>,
  px: { width: number; height: number } | undefined,
): number | null => {
  if (!px) return it.h ? it.w / it.h : null
  const c = it.crop ?? FULL_CROP
  return (px.width * c.w) / (px.height * c.h)
}

/** A short name for an item's kind, for inspector headings, lists and undo labels. */
export function itemKindName(it: LayoutItem): string {
  switch (it.type) {
    case 'graph':
      return 'Graph'
    case 'text':
      return it.border || it.background ? 'Text box' : 'Text'
    case 'line':
      return it.heads?.end || it.heads?.start ? 'Arrow' : 'Line'
    case 'shape':
      return it.shape === 'ellipse' ? 'Ellipse' : 'Rectangle'
    case 'image':
      return 'Image'
    case 'table':
      return 'Table'
  }
}
