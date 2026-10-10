import { layerTitle, type SceneNode, type StylePath } from '@ps/graph'
import type { GraphNode, LayoutItem, LayoutItemId, NodeId } from '@ps/model'
import { layerSeriesOf } from '../graph/format/route.ts'
import { withGroups } from '../layout/items.ts'
import { elementOrder } from './graphSelection.ts'
import { enteredItems, itemKey, pageElementKey, pageElementsOf } from './pageSelection.ts'
import { legendEntryPath } from './sceneKeys.ts'
import {
  EMPTY_SELECTION,
  elementKey,
  primaryKey,
  primaryPath,
  type Selection,
  type SelKey,
  selectionOf,
} from './selection.ts'

// Select ▸ Same kind (roadmap 45, Illustrator's Select › Same): every element of the kind of the
// primary selection — all titles (the graph's and the axes'), all tick-label groups, all data
// sets of its layer or of every layer, all annotations of its type (brackets, text boxes…) — on
// the graph canvas; on a layout page the same across the graphs worked in (or every graph on the
// page), and page items of the primary item's type. Only what is drawn, in reading order; the
// primary stays primary.

type AnnotationType = GraphNode['annotations'][number]['type']

/** The kind of a selected element of a graph. */
export type ElementKind =
  /** The graph title and the axes' titles. */
  | { kind: 'title' }
  | { kind: 'tickLabels' }
  /** An axis (its line, ticks and labels). */
  | { kind: 'axis' }
  /** A layer's marks of a data set (`layer`: its layer). */
  | { kind: 'dataSet'; layer: string }
  /** A whole layer. */
  | { kind: 'layer' }
  /** A data set itself (its marks in every layer). */
  | { kind: 'identity' }
  | { kind: 'legend' }
  /** Roadmap 47b: an entry of the legend. */
  | { kind: 'legendEntry' }
  | { kind: 'annotation'; type: AnnotationType }

/**
 * How far Same kind reaches: `kind` (a data set: its layer's), `everyLayer` (data sets of every
 * layer), `everyGraph` (on a page: the kind in every graph on it, not only those worked in).
 */
export type SameScope = 'kind' | 'everyLayer' | 'everyGraph'

/** The kind of the element a selection key names (null: points and the rest have none). */
export function kindOf(graph: Pick<GraphNode, 'annotations'>, path: StylePath): ElementKind | null {
  const [head, second, third] = path
  if (head === 'title' && path.length === 1) return { kind: 'title' }
  if (head === 'legend' && path.length === 1) return { kind: 'legend' }
  if (head === 'legend' && second === 'entries' && path.length === 3) return { kind: 'legendEntry' }
  if (head === 'axes' && second !== undefined) {
    if (path.length === 2) return { kind: 'axis' }
    if (path.length === 3 && third === 'title') return { kind: 'title' }
    if (path.length === 3 && third === 'tickLabels') return { kind: 'tickLabels' }
    return null
  }
  const marks = layerSeriesOf(path)
  if (marks && path.length === 4) return { kind: 'dataSet', layer: marks.layer }
  if (head === 'layers' && path.length === 2) return { kind: 'layer' }
  if (head === 'seriesOverrides' && path.length === 2) return { kind: 'identity' }
  if (head === 'annotations' && path.length === 2) {
    const a = graph.annotations[Number(second)]
    return a ? { kind: 'annotation', type: a.type } : null
  }
  return null
}

const ANNOTATIONS: Record<AnnotationType, string> = {
  text: 'text boxes',
  line: 'lines and arrows',
  bracket: 'brackets',
  table: 'results tables',
}

/**
 * What Same kind selects, for menus: "titles", "tick labels", "data sets in “Points”", "data sets
 * in every layer", "brackets"… Null when the scope adds nothing to the kind (every layer of what
 * isn't a data set).
 */
export function kindName(
  graph: Pick<GraphNode, 'layers' | 'frame'>,
  k: ElementKind,
  scope: SameScope = 'kind',
): string | null {
  if (scope === 'everyLayer' && k.kind !== 'dataSet') return null
  switch (k.kind) {
    case 'title':
      return 'titles'
    case 'tickLabels':
      return 'tick labels'
    case 'axis':
      return 'axes'
    case 'dataSet': {
      if (scope === 'everyLayer') return 'data sets in every layer'
      const l = graph.layers.find((x) => x.id === k.layer)
      return l ? `data sets in “${layerTitle(l, graph.frame)}”` : 'data sets of this layer'
    }
    case 'layer':
      return 'layers'
    case 'identity':
      return 'data sets'
    case 'legend':
      return 'legends'
    case 'legendEntry':
      return 'legend entries'
    case 'annotation':
      return ANNOTATIONS[k.type]
  }
}

/** The layers drawn, front first. */
function drawnLayers(graph: Pick<GraphNode, 'layers'>, all: readonly SceneNode[]): StylePath[] {
  const drawn = new Set<string>()
  for (const n of all) if (n.prim && n.target?.[0] === 'layers') drawn.add(String(n.target[1]))
  return [...graph.layers]
    .reverse()
    .filter((l) => drawn.has(l.id))
    .map((l) => ['layers', l.id])
}

/**
 * The elements of kind `k` a graph draws, in reading order (⌘A's, `elementOrder`); `all` is its
 * scene's nodes with their targets (`targetedNodes`). Data sets: of layer `k.layer` (by id, so in
 * another graph its layer of that id), or of every layer.
 */
export function pathsOfKind(
  graph: Pick<GraphNode, 'layers' | 'annotations'>,
  all: readonly SceneNode[],
  k: ElementKind,
  scope: SameScope = 'kind',
): StylePath[] {
  if (k.kind === 'layer') return drawnLayers(graph, all)
  // Roadmap 47b: the legend's entries, in its order.
  if (k.kind === 'legendEntry')
    return all.flatMap((n) => (n.legendEntry ? [legendEntryPath(n.legendEntry.key)] : []))
  const order = elementOrder(graph, all)
  if (k.kind === 'identity') {
    const keys = [...new Set(order.flatMap((p) => layerSeriesOf(p)?.key ?? []))]
    return keys.map((key) => ['seriesOverrides', key])
  }
  return order.filter((p) => {
    const pk = kindOf(graph, p)
    if (!pk || pk.kind !== k.kind) return false
    if (pk.kind === 'dataSet' && k.kind === 'dataSet')
      return scope === 'everyLayer' || pk.layer === k.layer
    if (pk.kind === 'annotation' && k.kind === 'annotation') return pk.type === k.type
    return true
  })
}

/**
 * The graph canvas' Same kind: every element of the primary's kind in this graph (`scope`
 * `everyLayer`: a data set's in every layer), the primary still primary. Null when the primary
 * has no kind (a point, nothing selected) or the scope doesn't apply to it.
 */
export function selectSameKind(
  sel: Selection,
  graph: GraphNode,
  all: readonly SceneNode[],
  scope: SameScope = 'kind',
): Selection | null {
  const p = primaryPath(sel)
  const k = p && kindOf(graph, p)
  if (!p || !k || !kindName(graph, k, scope)) return null
  const keys = pathsOfKind(graph, all, k, scope).map((x) => elementKey(graph.id, x))
  return keys.length ? selectionOf(keys, elementKey(graph.id, p)) : null
}

/** A graph item of a page with its graph and the nodes of the scene the page draws of it. */
export interface PageGraph {
  item: LayoutItemId
  graph: GraphNode
  all: readonly SceneNode[]
}

/**
 * A page's Same kind for parts of graphs: the primary part's kind in each graph worked in (the
 * graphs holding selected parts; `everyGraph`: every graph on the page), the primary still
 * primary. `graphs`: the page's unlocked graph items in page order. Null as `selectSameKind`.
 */
export function selectSameKindOnPage(
  sel: Selection,
  layout: NodeId,
  graphs: readonly PageGraph[],
  scope: SameScope = 'kind',
): Selection | null {
  const p = primaryKey(sel)
  if (p?.kind !== 'pageElement') return null
  const own = graphs.find((g) => g.item === p.item)
  const k = own && kindOf(own.graph, p.path)
  if (!own || !k || !kindName(own.graph, k, scope === 'everyGraph' ? 'kind' : scope)) return null
  const worked = enteredItems(sel)
  const keys: SelKey[] = graphs
    .filter((g) => scope === 'everyGraph' || worked.has(g.item))
    .flatMap((g) =>
      pathsOfKind(g.graph, g.all, k, scope === 'everyLayer' ? 'everyLayer' : 'kind').map((x) =>
        pageElementKey(layout, g.item, x),
      ),
    )
  return keys.length ? selectionOf(keys, p) : null
}

const ITEM_KINDS: Record<LayoutItem['type'], string> = {
  graph: 'graphs',
  text: 'text boxes',
  line: 'lines and arrows',
  shape: 'shapes',
  image: 'images',
  table: 'tables',
}

/** What Same kind selects of page items: "graphs", "text boxes"… */
export const itemKindName = (it: LayoutItem): string => ITEM_KINDS[it.type]

/**
 * A page's Same kind for items: every item of the primary item's type that isn't locked, with
 * the members of their groups (as the marquee picks them, decision 191), the primary still
 * primary. Null with no item primary.
 */
export function selectSameItems(
  sel: Selection,
  layout: NodeId,
  items: readonly LayoutItem[],
): Selection | null {
  const p = primaryKey(sel)
  if (p?.kind !== 'item') return null
  const it = items.find((x) => x.id === p.item)
  if (!it) return null
  const same = items.flatMap((x, i) => (x.type === it.type && !x.locked ? [i] : []))
  const ids = withGroups(items, same).map((i) => items[i]!.id)
  return ids.length
    ? selectionOf(
        ids.map((id) => itemKey(layout, id)),
        p,
      )
    : EMPTY_SELECTION
}

/** The name Same kind gives what it would select from this page selection (null: nothing). */
export function pageKindName(
  sel: Selection,
  items: readonly LayoutItem[],
  graphOf: (item: LayoutItemId) => GraphNode | undefined,
  scope: SameScope = 'kind',
): string | null {
  const p = primaryKey(sel)
  if (p?.kind === 'item') {
    const it = items.find((x) => x.id === p.item)
    return scope === 'kind' && it ? itemKindName(it) : null
  }
  if (p?.kind !== 'pageElement') return null
  const g = graphOf(p.item)
  const k = g && kindOf(g, p.path)
  if (!g || !k) return null
  if (scope === 'everyGraph') {
    const name = kindName(g, k, 'kind')
    return name && `${name} in every graph on the page`
  }
  const name = kindName(g, k, scope)
  const graphs = new Set(pageElementsOf(sel).map((x) => x.item)).size
  return name && graphs > 1 ? `${name} in ${graphs} graphs` : name
}
