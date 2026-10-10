import type { NodeId } from '@ps/model'
import type { NavItem } from './navModel.ts'

// Roadmap 47 (UX review S8): the navigator's selection of several sheets, beside the open one
// (the shell's `selected`). Plain data and pure functions, tested; the navigator holds it in
// React state, never in the document.
//
// A plain click selects one sheet and opens it; ⌘-click (Ctrl elsewhere) adds or removes one
// without opening it; Shift-click selects the rows from the anchor to it, in the order shown;
// Shift+↑/↓ extends; ⌘A selects every sheet shown; Escape goes back to the open sheet alone.
// Opening another sheet any other way (a plain click, Go to…, a new sheet) starts again from it.

export interface NavSelection {
  /** The selected sheets, in the order selected (never two equal). */
  ids: readonly NodeId[]
  /** Where Shift ranges start: the last sheet clicked without Shift. */
  anchor: NodeId | null
  /** The open sheet the selection was made with: when another opens, it starts again. */
  open: NodeId | null
}

/** The open sheet alone (or nothing), anchored there. */
export const onlyOpen = (open: NodeId | null): NavSelection => ({
  ids: open ? [open] : [],
  anchor: open,
  open,
})

/**
 * The selection as it stands with `open` the open sheet: the open sheet alone when another opened
 * since it was made, else without sheets gone from the project (deleted, undone).
 */
export function currentSelection(
  sel: NavSelection,
  open: NodeId | null,
  exists: (id: NodeId) => boolean,
): NavSelection {
  if (sel.open !== open) return onlyOpen(open)
  if (sel.ids.every(exists) && (sel.anchor === null || exists(sel.anchor))) return sel
  return {
    ids: sel.ids.filter(exists),
    anchor: sel.anchor && exists(sel.anchor) ? sel.anchor : open,
    open,
  }
}

/** What a click with these keys does: open one, toggle one, a range, or a range added. */
export type ClickKind = 'plain' | 'toggle' | 'range' | 'addRange'

/**
 * A click's kind: ⌘ or Ctrl toggles, Shift selects a range. Either key toggles on every platform,
 * as on the canvas (decision 851): ⌘ on macOS, Ctrl elsewhere, and macOS' Ctrl-click opens the
 * context menu before any click.
 */
export function clickKind(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): ClickKind {
  const toggle = e.metaKey || e.ctrlKey
  if (e.shiftKey) return toggle ? 'addRange' : 'range'
  return toggle ? 'toggle' : 'plain'
}

/** The sheets from `a` to `b` in `visible` order (`b` alone when `a` is not shown). */
function range(visible: readonly NodeId[], a: NodeId | null, b: NodeId): NodeId[] {
  const j = visible.indexOf(b)
  if (j < 0) return [b]
  const i = a === null ? -1 : visible.indexOf(a)
  if (i < 0) return [b]
  return i <= j ? visible.slice(i, j + 1) : visible.slice(j, i + 1).reverse()
}

const union = (a: readonly NodeId[], b: readonly NodeId[]): NodeId[] => [
  ...a,
  ...b.filter((id) => !a.includes(id)),
]

/**
 * The selection after a click on `id` (`visible`: the sheets shown, in order). A plain click
 * leaves the open sheet alone selected: the caller opens `id`, and the selection is `id` alone.
 */
export function afterClick(
  sel: NavSelection,
  id: NodeId,
  kind: ClickKind,
  visible: readonly NodeId[],
): NavSelection {
  switch (kind) {
    case 'plain':
      return onlyOpen(id)
    case 'toggle':
      return {
        ...sel,
        ids: sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id],
        anchor: id,
      }
    case 'range':
      return { ...sel, ids: range(visible, sel.anchor ?? sel.open, id) }
    case 'addRange':
      return { ...sel, ids: union(sel.ids, range(visible, sel.anchor ?? sel.open, id)) }
  }
}

/** Shift+↑/↓ onto `to`: the rows from the anchor to it. */
export const extendTo = (sel: NavSelection, to: NodeId, visible: readonly NodeId[]): NavSelection =>
  afterClick(sel, to, 'range', visible)

/** ⌘A: every sheet shown (the anchor kept). */
export const selectAllShown = (sel: NavSelection, visible: readonly NodeId[]): NavSelection => ({
  ...sel,
  ids: [...visible],
})

/** Escape: the open sheet alone. */
export const clearToOpen = (sel: NavSelection): NavSelection => onlyOpen(sel.open)

/** Several sheets, or one that isn't the open one: rows show the selection apart from it. */
export const showsSelection = (sel: NavSelection): boolean =>
  sel.ids.length > 1 || (sel.ids.length === 1 && sel.ids[0] !== sel.open)

/**
 * The sheets commands act on, in navigator order (`order`: the project's): the selected ones,
 * else the open sheet.
 */
export function actingOn(sel: NavSelection, order: readonly NodeId[]): NodeId[] {
  const ids = new Set(sel.ids.length ? sel.ids : sel.open ? [sel.open] : [])
  return order.filter((id) => ids.has(id))
}

/**
 * The sheets a navigator shows, in order (open folders and branches only; a graph shown again
 * under a page placing it and the heading of a set of split graphs are not rows of their own).
 */
export function visibleSheets(items: readonly NavItem[]): NodeId[] {
  const out: NodeId[] = []
  const seen = new Set<NodeId>()
  const walk = (list: readonly NavItem[]) => {
    for (const it of list) {
      if (it.type === 'sheet' && !it.link && !it.set && !seen.has(it.id)) {
        seen.add(it.id)
        out.push(it.id)
      }
      if (it.open) walk(it.items)
    }
  }
  walk(items)
  return out
}
