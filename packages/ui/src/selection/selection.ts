import type { StylePath } from '@ps/graph'
import type { LayoutItemId, NodeId } from '@ps/model'

// One selection model (roadmap 44, decision 850): what is selected on the graph canvas, on a
// layout page and (stage 2) inside a graph placed on a page, as a list of keys. Pure data and
// functions; the views hold a `Selection` in their state, derive what they draw from it and
// replace it through these helpers (never by mutation).

/** One selected thing. */
export type SelKey =
  /** A part of a graph on its own canvas: a selection key as `selectionKey()` makes it. */
  | { kind: 'element'; graph: NodeId; path: StylePath }
  /** An item of a layout page. */
  | { kind: 'item'; layout: NodeId; item: LayoutItemId }
  /** A part of a graph placed on a page (the graph item, then the selection key in it). */
  | { kind: 'pageElement'; layout: NodeId; item: LayoutItemId; path: StylePath }

export interface Selection {
  /** In the order they were selected; never two equal keys (compared by value, `keyId`). */
  readonly keys: readonly SelKey[]
  /**
   * The last one selected (an index into `keys`, −1 when empty): what single-target code acts on
   * (the Format dialog, the hint's name, the hover card), the anchor of ranges and alignment.
   */
  readonly primary: number
  /**
   * Where the primary single point was picked from (decision 243): the layer's marks of its data
   * set, so Escape goes back to them and the point's Format dialog opens on that layer.
   */
  readonly drill?: StylePath
}

export const EMPTY_SELECTION: Selection = { keys: [], primary: -1 }

/** A string identifying a key by value (equal keys, equal ids). */
export function keyId(k: SelKey): string {
  switch (k.kind) {
    case 'element':
      return `e\u0000${k.graph}\u0000${JSON.stringify(k.path)}`
    case 'item':
      return `i\u0000${k.layout}\u0000${k.item}`
    case 'pageElement':
      return `p\u0000${k.layout}\u0000${k.item}\u0000${JSON.stringify(k.path)}`
  }
}

export const sameKey = (a: SelKey, b: SelKey): boolean => keyId(a) === keyId(b)

/** A graph element's key. */
export const elementKey = (graph: NodeId, path: StylePath): SelKey => ({
  kind: 'element',
  graph,
  path,
})

/** A selection of these keys (duplicates dropped), the last one primary unless given. */
export function selectionOf(
  keys: readonly SelKey[],
  primary?: SelKey,
  drill?: StylePath,
): Selection {
  const seen = new Set<string>()
  const out: SelKey[] = []
  for (const k of keys) {
    const id = keyId(k)
    if (!seen.has(id)) {
      seen.add(id)
      out.push(k)
    }
  }
  const p = primary ? out.findIndex((k) => sameKey(k, primary)) : out.length - 1
  return { keys: out, primary: p < 0 ? out.length - 1 : p, ...(drill && p >= 0 ? { drill } : {}) }
}

/** Just this key (or nothing). */
export const single = (key: SelKey | null, drill?: StylePath): Selection =>
  key ? selectionOf([key], key, drill) : EMPTY_SELECTION

export const isEmpty = (s: Selection): boolean => s.keys.length === 0

export const primaryKey = (s: Selection): SelKey | null => s.keys[s.primary] ?? null

/** The primary key's style path (an element or a page element), else null. */
export function primaryPath(s: Selection): StylePath | null {
  const k = primaryKey(s)
  return k && k.kind !== 'item' ? k.path : null
}

/** The style paths of the element keys of one graph, in selection order. */
export function elementPaths(s: Selection, graph: NodeId): StylePath[] {
  return s.keys.flatMap((k) => (k.kind === 'element' && k.graph === graph ? [k.path] : []))
}

export const contains = (s: Selection, key: SelKey): boolean => s.keys.some((k) => sameKey(k, key))

/**
 * Whether two keys can be selected together: the same kind on the same surface (one graph's
 * elements; one page's items; elements of graphs on one page, across its graphs).
 */
export function compatible(a: SelKey, b: SelKey): boolean {
  if (a.kind === 'element' && b.kind === 'element') return a.graph === b.graph
  if (a.kind === 'item' && b.kind === 'item') return a.layout === b.layout
  if (a.kind === 'pageElement' && b.kind === 'pageElement') return a.layout === b.layout
  return false
}

/** `key` added as the primary (moved to the end if it was there); incompatible keys go. */
export function add(s: Selection, key: SelKey): Selection {
  const kept = s.keys.filter((k) => compatible(k, key) && !sameKey(k, key))
  return selectionOf([...kept, key], key)
}

/** `key` taken out; the primary stays, or (if it was `key`) becomes the last one left. */
export function remove(s: Selection, key: SelKey): Selection {
  if (!contains(s, key)) return s
  const p = primaryKey(s)
  const keys = s.keys.filter((k) => !sameKey(k, key))
  const stays = p && !sameKey(p, key)
  return selectionOf(keys, stays ? p : undefined, stays ? s.drill : undefined)
}

/** Shift / ⌘-click: `key` taken out if selected, else added (as the primary). */
export const toggle = (s: Selection, key: SelKey): Selection =>
  contains(s, key) ? remove(s, key) : add(s, key)

/**
 * The selection with the keys that no longer resolve left out (after an undo, a removed layer, a
 * hidden data set): the same object when every key resolves, so views derive it each render
 * without re-rendering anything. The primary stays if it resolves (else the last key left); the
 * drill goes with the primary.
 */
export function resolveSelection(s: Selection, resolves: (k: SelKey) => boolean): Selection {
  const keys = s.keys.filter(resolves)
  if (keys.length === s.keys.length) return s
  const p = primaryKey(s)
  const stays = !!p && keys.includes(p)
  return selectionOf(keys, stays ? p : undefined, stays ? s.drill : undefined)
}

/** Whether two selections hold the same keys, primary and drill (audit 3 A4: a Tab run's start). */
export function sameSelection(a: Selection, b: Selection): boolean {
  if (a === b) return true
  if (a.keys.length !== b.keys.length || a.primary !== b.primary) return false
  if (JSON.stringify(a.drill ?? null) !== JSON.stringify(b.drill ?? null)) return false
  return a.keys.every((k, i) => sameKey(k, b.keys[i]!))
}
