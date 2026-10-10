import type { Box } from '@ps/graph'
import type { LayoutItem } from '@ps/model'
import { moveItem } from './items.ts'

// Arranging page items of any kind (roadmap 32): align, distribute and drawing order. A group
// counts as one unit: it lines up and spaces out by its bounds and moves up and down as a whole.

/** A unit being arranged: an ungrouped item, or a group's items, with its bounds on the page. */
interface ArrangeUnit {
  indices: number[]
  box: Box
}

/** The union of boxes (null for none). */
export function unionOf(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  const x2 = Math.max(...boxes.map((b) => b.x + b.w))
  const y2 = Math.max(...boxes.map((b) => b.y + b.h))
  return { x, y, w: x2 - x, h: y2 - y }
}

/** The selection as units (groups together), each with its bounds from `boxOf`. */
export function arrangeUnits(
  items: readonly LayoutItem[],
  indices: readonly number[],
  boxOf: (index: number) => Box | undefined,
): ArrangeUnit[] {
  const byGroup = new Map<string, number[]>()
  const units: number[][] = []
  for (const i of [...indices].sort((a, b) => a - b)) {
    const g = items[i]?.group
    if (!g) units.push([i])
    else if (byGroup.has(g)) byGroup.get(g)!.push(i)
    else {
      const list = [i]
      byGroup.set(g, list)
      units.push(list)
    }
  }
  return units.flatMap((ix) => {
    const box = unionOf(ix.flatMap((i) => boxOf(i) ?? []))
    return box ? [{ indices: ix, box }] : []
  })
}

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

/** The align commands' edges and labels, in menu order. */
export const ALIGN_EDGES: readonly [AlignEdge, string][] = [
  ['left', 'Left'],
  ['center', 'Centres'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['middle', 'Middles'],
  ['bottom', 'Bottom'],
]

/**
 * Moves that line the units up along one edge or centre line of `ref` (the selection's bounds,
 * or the page when one unit is selected): per item index, its (dx, dy).
 */
export function alignMoves(
  units: readonly ArrangeUnit[],
  edge: AlignEdge,
  ref: Box,
): Map<number, { dx: number; dy: number }> {
  const out = new Map<number, { dx: number; dy: number }>()
  for (const u of units) {
    const b = u.box
    let dx = 0
    let dy = 0
    if (edge === 'left') dx = ref.x - b.x
    else if (edge === 'center') dx = ref.x + ref.w / 2 - (b.x + b.w / 2)
    else if (edge === 'right') dx = ref.x + ref.w - (b.x + b.w)
    else if (edge === 'top') dy = ref.y - b.y
    else if (edge === 'middle') dy = ref.y + ref.h / 2 - (b.y + b.h / 2)
    else dy = ref.y + ref.h - (b.y + b.h)
    for (const i of u.indices) out.set(i, { dx, dy })
  }
  return out
}

/**
 * Moves that space the units out evenly along one axis: the first and last (by position) stay,
 * the gaps between neighbours become equal. Fewer than three units don't move.
 */
export function distributeMoves(
  units: readonly ArrangeUnit[],
  axis: 'x' | 'y',
): Map<number, { dx: number; dy: number }> {
  const out = new Map<number, { dx: number; dy: number }>()
  if (units.length < 3) return out
  const pos = (b: Box) => (axis === 'x' ? b.x : b.y)
  const size = (b: Box) => (axis === 'x' ? b.w : b.h)
  const sorted = [...units].sort((a, b) => pos(a.box) - pos(b.box) || size(a.box) - size(b.box))
  const first = sorted[0]!.box
  const last = sorted[sorted.length - 1]!.box
  const span = pos(last) + size(last) - pos(first)
  const gap = (span - sorted.reduce((s, u) => s + size(u.box), 0)) / (sorted.length - 1)
  let at = pos(first)
  for (const u of sorted) {
    const d = at - pos(u.box)
    for (const i of u.indices) out.set(i, axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d })
    at += size(u.box) + gap
  }
  return out
}

/** The items with these moves applied. */
export const applyMoves = (
  items: readonly LayoutItem[],
  moves: ReadonlyMap<number, { dx: number; dy: number }>,
): LayoutItem[] =>
  items.map((it, i) => {
    const m = moves.get(i)
    return m ? moveItem(it, m.dx, m.dy) : it
  })

export type ZOrder = 'front' | 'back' | 'forward' | 'backward'

/**
 * The items in a new drawing order: the selected ones (with their groups) to the front or back,
 * or one step forward or backward past the next unit (an item, or a whole group). Returns the
 * items and where the selected ones are now.
 */
export function reorderItems(
  items: readonly LayoutItem[],
  selected: readonly number[],
  op: ZOrder,
): { items: LayoutItem[]; selection: number[] } {
  // Consecutive items of one group form a unit (groups are kept together when made).
  const units: { items: LayoutItem[]; picked: boolean }[] = []
  const chosen = new Set(selected)
  const groups = new Set(selected.flatMap((i) => items[i]?.group ?? []))
  items.forEach((it, i) => {
    const picked = chosen.has(i) || (!!it.group && groups.has(it.group))
    const last = units[units.length - 1]
    if (last && it.group && last.items[0]!.group === it.group) {
      last.items.push(it)
      last.picked ||= picked
    } else units.push({ items: [it], picked })
  })
  let order = units
  if (op === 'front') order = [...units.filter((u) => !u.picked), ...units.filter((u) => u.picked)]
  else if (op === 'back')
    order = [...units.filter((u) => u.picked), ...units.filter((u) => !u.picked)]
  else if (op === 'forward') {
    order = [...units]
    for (let i = order.length - 2; i >= 0; i--)
      if (order[i]!.picked && !order[i + 1]!.picked)
        [order[i], order[i + 1]] = [order[i + 1]!, order[i]!]
  } else {
    order = [...units]
    for (let i = 1; i < order.length; i++)
      if (order[i]!.picked && !order[i - 1]!.picked)
        [order[i], order[i - 1]] = [order[i - 1]!, order[i]!]
  }
  const out: LayoutItem[] = []
  const selection: number[] = []
  for (const u of order)
    for (const it of u.items) {
      if (u.picked) selection.push(out.length)
      out.push(it)
    }
  return { items: out, selection }
}
