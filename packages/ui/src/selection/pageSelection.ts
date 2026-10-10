import type { StylePath } from '@ps/graph'
import type { GraphNode, LayoutItem, LayoutItemId, NodeId } from '@ps/model'
import { layerSeriesOf } from '../graph/format/route.ts'
import { clickSelect, elementName, type SeriesTitle, stepOut } from './graphSelection.ts'
import {
  EMPTY_SELECTION,
  elementKey,
  isEmpty,
  keyId,
  primaryKey,
  type Selection,
  type SelKey,
  sameKey,
  selectionOf,
  single,
} from './selection.ts'

// A layout page's selection on the one selection model (roadmap 44 stage 2, decisions 870–872):
// `item` keys for page items (held by id, decision 691), `pageElement` keys for parts of graphs
// placed on the page. A click on a part of a graph that is selected alone selects that part (as
// in PowerPoint's and Excel's charts); the canvas' rules (decision 851) then act within that
// graph item, and Shift-click adds parts of the same or another graph on the page.

type PageElementKey = Extract<SelKey, { kind: 'pageElement' }>

/** A page item's key. */
export const itemKey = (layout: NodeId, item: LayoutItemId): SelKey => ({
  kind: 'item',
  layout,
  item,
})

/** A part of a graph item on a page. */
export const pageElementKey = (layout: NodeId, item: LayoutItemId, path: StylePath): SelKey => ({
  kind: 'pageElement',
  layout,
  item,
  path,
})

/** The items selected (their ids, in the order selected). */
export const itemIdsOf = (s: Selection): LayoutItemId[] =>
  s.keys.flatMap((k) => (k.kind === 'item' ? [k.item] : []))

/** These items selected (the last one primary). */
export const itemsSelection = (layout: NodeId, ids: readonly LayoutItemId[]): Selection =>
  selectionOf(ids.map((i) => itemKey(layout, i)))

/** The selected parts of graphs on the page, in the order selected (of one item when given). */
export function pageElementsOf(s: Selection, item?: LayoutItemId): PageElementKey[] {
  return s.keys.filter(
    (k): k is PageElementKey => k.kind === 'pageElement' && (item === undefined || k.item === item),
  )
}

/** The primary key when it is a part of a graph on the page. */
export function primaryPageElement(s: Selection): PageElementKey | null {
  const p = primaryKey(s)
  return p?.kind === 'pageElement' ? p : null
}

/**
 * The graph items a plain click goes into (selects a part of): the item selected alone, or the
 * items holding selected parts.
 */
export function enteredItems(s: Selection): Set<LayoutItemId> {
  const els = pageElementsOf(s)
  if (els.length) return new Set(els.map((k) => k.item))
  const only = s.keys.length === 1 ? s.keys[0] : undefined
  return new Set(only?.kind === 'item' ? [only.item] : [])
}

// The canvas' rules work on `element` keys of one graph: an item's parts are handed to them as
// element keys "of" the item (its id in the graph's place) and brought back.
const asGraph = (item: LayoutItemId) => item as unknown as NodeId

/** One item's parts as a canvas selection (the drill kept when its primary is among them). */
function canvasOf(s: Selection, item: LayoutItemId): Selection {
  const mine = pageElementsOf(s, item)
  const p = primaryPageElement(s)
  const keys = mine.map((k) => elementKey(asGraph(item), k.path))
  const primary = p?.item === item ? elementKey(asGraph(item), p.path) : undefined
  return selectionOf(keys, primary, primary ? s.drill : undefined)
}

/** A canvas selection of one item's parts as page keys. */
function pageOf(c: Selection, layout: NodeId, item: LayoutItemId): SelKey[] {
  return c.keys.flatMap((k) => (k.kind === 'element' ? [pageElementKey(layout, item, k.path)] : []))
}

/** What a click hit on a graph item: the selection key, the point, the full target. */
export interface PageHit {
  key: StylePath
  point: string | undefined
  target: StylePath | undefined
}

/**
 * What a click on graph item `item` does to the page's selection, or null when it is an item
 * click (the item selected, or toggled with Shift, as before).
 *
 * - Plain click on a graph that is entered (`enteredItems`): on a part, the canvas' rules within
 *   that graph (a part alone; a layer's marks of a data set, then one of its points; a member of
 *   several alone), the parts of other graphs dropped; off its parts, the graph item alone.
 * - Shift / ⌘ / Ctrl-click while parts are selected: toggles the part (by the canvas' rules: a
 *   point of a data set toggles the data set…), in this or another graph on the page; off any part
 *   it changes nothing. With items selected it is an item click.
 */
export function pageElementClick(
  sel: Selection,
  layout: NodeId,
  item: LayoutItemId,
  hit: PageHit | null,
  clicks: number,
  mods: { alt: boolean; additive: boolean },
): Selection | null {
  const g = asGraph(item)
  if (mods.additive) {
    if (!pageElementsOf(sel).length) return null
    if (!hit) return sel
    const next = clickSelect(canvasOf(sel, item), g, hit.key, hit.point, hit.target, clicks, mods)
    const mine = pageOf(next, layout, item)
    const kept = new Set(mine.map(keyId))
    const remaining = sel.keys.filter(
      (k) => k.kind === 'pageElement' && (k.item !== item || kept.has(keyId(k))),
    )
    const added = mine.filter((k) => !sel.keys.some((b) => sameKey(b, k)))
    const np = primaryKey(next)
    const primary =
      added.length && np?.kind === 'element'
        ? pageElementKey(layout, item, np.path)
        : (primaryKey(sel) ?? undefined)
    return selectionOf([...remaining, ...added], primary)
  }
  if (!enteredItems(sel).has(item)) return null
  if (!hit) return single(itemKey(layout, item))
  // A member of several selected parts (of any graph on the page): that one alone.
  const marks = layerSeriesOf(hit.key)
  const plain = pageElementKey(layout, item, marks && mods.alt ? ['layers', marks.layer] : hit.key)
  if (pageElementsOf(sel).length > 1 && sel.keys.some((k) => sameKey(k, plain)))
    return single(plain)
  const next = clickSelect(canvasOf(sel, item), g, hit.key, hit.point, hit.target, clicks, mods)
  const keys = pageOf(next, layout, item)
  if (!keys.length) return single(itemKey(layout, item))
  const np = primaryKey(next)
  return selectionOf(
    keys,
    np?.kind === 'element' ? pageElementKey(layout, item, np.path) : undefined,
    next.drill,
  )
}

/**
 * Escape on a page: parts of a graph step out as on the canvas (points to their data set, tick
 * labels to their axis), then to the graph item of the primary part; items to nothing.
 */
export function pageStepOut(sel: Selection, layout: NodeId): Selection {
  const p = primaryPageElement(sel)
  if (!p) return EMPTY_SELECTION
  if (pageElementsOf(sel).every((k) => k.item === p.item)) {
    const out = stepOut(canvasOf(sel, p.item), asGraph(p.item))
    if (!isEmpty(out)) return selectionOf(pageOf(out, layout, p.item))
  }
  return single(itemKey(layout, p.item))
}

/** A drag of a part selects it alone unless it is one of the selected parts (then all move). */
export function dragSelection(
  sel: Selection,
  layout: NodeId,
  item: LayoutItemId,
  path: StylePath,
): Selection {
  const key = pageElementKey(layout, item, path)
  return sel.keys.some((k) => sameKey(k, key)) ? sel : single(key)
}

/** Whether a page key still names something: its item on the page, a part drawn in its graph. */
export function pageKeyResolves(
  k: SelKey,
  items: readonly LayoutItem[],
  drawn: (item: LayoutItemId, path: StylePath) => boolean,
): boolean {
  if (k.kind === 'item') return items.some((it) => it.id === k.item)
  if (k.kind !== 'pageElement') return false
  const it = items.find((x) => x.id === k.item)
  return it?.type === 'graph' && !it.locked && drawn(k.item, k.path)
}

/** A part of a graph on a page, named for the hint: "Y axis title of “Dose response”". */
export function pageElementName(
  graph: Pick<GraphNode, 'name' | 'layers' | 'annotations' | 'frame'>,
  path: StylePath,
  title?: SeriesTitle,
): string {
  return `${elementName(graph, path, title)} of “${graph.name}”`
}

/**
 * What the page's live region and inspector heading say about its parts: the part's name alone
 * ("Y axis title of “Dose response”"), else "3 elements in 2 graphs" / "2 elements of “B”".
 */
export function pageElementsText(
  sel: Selection,
  graphOf: (item: LayoutItemId) => GraphNode | undefined,
  title?: (graph: GraphNode) => SeriesTitle,
): string {
  const els = pageElementsOf(sel)
  if (!els.length) return ''
  const p = primaryPageElement(sel) ?? els[els.length - 1]!
  const g = graphOf(p.item)
  if (els.length === 1) return g ? pageElementName(g, p.path, title?.(g)) : 'Graph element'
  const graphs = new Set(els.map((k) => graphOf(k.item)?.id ?? k.item))
  return graphs.size === 1 && g
    ? `${els.length} elements of “${g.name}”`
    : `${els.length} elements in ${graphs.size} graphs`
}
