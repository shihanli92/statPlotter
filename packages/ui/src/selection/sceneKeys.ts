import { cloudPointIndex, type SceneNode, type StylePath } from '@ps/graph'

// Selection keys in a graph's scene (decisions 61, 79, 243): what a click on a node selects, which
// nodes a key covers (halos), and an index of the scene's marks by key (hover halos, resolving a
// selection after an edit, and stage 2's marquee). Roadmap 47b: a legend entry's key is
// `['legend', 'entries', <entry key>]` (its node's `legendEntry`), what a click within the legend
// selects once the legend is (`hitKey`).

/** Roadmap 47b: a legend entry's selection key. */
export const legendEntryPath = (key: string): StylePath => ['legend', 'entries', key]

/** Roadmap 47b: whether a selection key is a legend entry's. */
export const isLegendEntryPath = (p: StylePath | null | undefined): boolean =>
  p?.[0] === 'legend' && p[1] === 'entries' && p.length === 3

/** Roadmap 47b: the entry key of a legend entry's selection key (null for any other key). */
export const entryKeyOf = (p: StylePath | null | undefined): string | null =>
  p && isLegendEntryPath(p) ? String(p[2]) : null

/** Roadmap 47b: whether a scene node is part of the legend (its box, headings, entries…). */
export const inLegend = (id: string): boolean => id === 'legend' || id.startsWith('legend/')

/** Roadmap 47b: the legend entry a node is part of (the entry's node or one of its children). */
export interface EntryRef {
  key: string
  group: string
}

/**
 * The part of a node's target that identifies what gets selected: a layer's marks of a data set
 * (`['layers', id, 'series', key]`), a whole layer, a data set's identity, an axis, an axis title,
 * an annotation, or the graph title. A point label selects its point.
 */
export function selectionKey(target: StylePath): StylePath {
  if (target[0] === 'axes' && target[2] === 'title') return target.slice(0, 3)
  if (target[0] === 'pointLabel' && target.length >= 3)
    return ['pointOverrides', target[1]!, target[2]!]
  if (target[0] === 'layers' && target[2] === 'series') return target.slice(0, 4)
  return target.slice(0, 2)
}

/**
 * What a click on a node selects, before the rules of the selection (`clickSelect`): a legend
 * entry's key on an entry (roadmap 47b), the legend on its other parts, else the node's
 * `selectionKey`. `entryOf`: the scene's index of entries (`targetedNodes`).
 */
export function hitKey(
  node: Pick<SceneNode, 'id'>,
  target: StylePath | undefined,
  entryOf: ReadonlyMap<string, EntryRef>,
): StylePath | null {
  const entry = entryOf.get(node.id)
  if (entry) return legendEntryPath(entry.key)
  if (inLegend(node.id)) return ['legend']
  return target?.length ? selectionKey(target) : null
}

const startsWith = (path: StylePath, prefix: StylePath) =>
  prefix.length > 0 && prefix.every((p, i) => path[i] === p)

/**
 * The series a mark of a point belongs to (its symbol, bar… in a layer, or its label), if it is
 * one.
 */
export function pointSeries(t: StylePath | undefined): string | undefined {
  if (t?.[0] === 'layers' && t[2] === 'series') return t[3] === undefined ? undefined : String(t[3])
  if (t?.[0] === 'seriesOverrides' || t?.[0] === 'pointLabel')
    return t[1] === undefined ? undefined : String(t[1])
  return undefined
}

export type NodeMatch = (target: StylePath | undefined, node: SceneNode) => boolean

/**
 * Which scene nodes a selection key covers: everything under its style path (a layer's marks of a
 * data set, a whole layer, an axis' line, ticks and labels…); a data set's identity covers its
 * marks in every layer (and its legend entry); a single point (`['pointOverrides', dataSet,
 * pointKey]`) that point's marks.
 */
export function selectionMatcher(
  selected: StylePath,
  entryOf?: ReadonlyMap<string, EntryRef>,
): NodeMatch {
  // Roadmap 47b: a legend entry covers its sample and label.
  const entry = entryKeyOf(selected)
  if (entry !== null) return (_, n) => entryOf?.get(n.id)?.key === entry
  if (selected[0] === 'pointOverrides') {
    const [, ds, key] = selected
    return (t, n) => n.point === key && pointSeries(t) === ds
  }
  if (selected[0] === 'seriesOverrides' && selected.length === 2) {
    const ds = selected[1]
    return (t) =>
      !!t && (startsWith(t, selected) || (t[0] === 'layers' && t[2] === 'series' && t[3] === ds))
  }
  return (t) => !!t && startsWith(t, selected)
}

/** The nodes any of these keys covers (null for none). */
export function keysMatcher(
  keys: readonly StylePath[],
  entryOf?: ReadonlyMap<string, EntryRef>,
): NodeMatch | null {
  if (!keys.length) return null
  const ms = keys.map((k) => selectionMatcher(k, entryOf))
  return ms.length === 1 ? ms[0]! : (t, n) => ms.some((m) => m(t, n))
}

const keyOf = (path: StylePath) => JSON.stringify(path)

/** A scene's marks by selection key; see `hoverIndex`. */
export interface MarkIndex {
  byKey: Map<string, SceneNode[]>
  byPoint: Map<string, SceneNode[]>
  /** Point clouds (roadmap 34e) by series key: their points have no nodes of their own. */
  clouds: Map<string, SceneNode[]>
}

/**
 * The scene's marks grouped by what selecting them selects (their selection key), and the marks
 * of single points by data set and point key: hover halos look their marks up here instead of
 * walking the scene on every pointer move. Graph scenes carry no transforms, so marks draw as is.
 * `all`: every node with the target it (or its nearest ancestor) carries.
 */
export function hoverIndex(
  all: readonly SceneNode[],
  entryOf: ReadonlyMap<string, EntryRef> = new Map(),
): MarkIndex {
  const byKey = new Map<string, SceneNode[]>()
  const byPoint = new Map<string, SceneNode[]>()
  const clouds = new Map<string, SceneNode[]>()
  const push = (m: Map<string, SceneNode[]>, k: string, n: SceneNode) => {
    const list = m.get(k)
    if (list) list.push(n)
    else m.set(k, [n])
  }
  for (const n of all) {
    if (!n.prim || !n.target?.length) continue
    // Every prefix of the target: an axis selection covers its title's parts too, a whole layer
    // its marks of every data set.
    for (let i = 1; i <= n.target.length; i++) push(byKey, keyOf(n.target.slice(0, i)), n)
    const series = pointSeries(n.target)
    // A data set's identity covers its marks in every layer.
    if (n.target[0] === 'layers' && series !== undefined)
      push(byKey, keyOf(['seriesOverrides', series]), n)
    // Roadmap 47b: a legend entry's key covers its sample and label, and the legend's its
    // entries (a legend without a box or heading is drawn, and selectable, all the same).
    const entry = entryOf.get(n.id)
    if (entry) {
      push(byKey, keyOf(legendEntryPath(entry.key)), n)
      if (n.target[0] !== 'legend') push(byKey, keyOf(['legend']), n)
    }
    if (n.point !== undefined && series !== undefined) push(byPoint, keyOf([series, n.point]), n)
    if (n.prim.type === 'points' && series !== undefined) push(clouds, series, n)
  }
  return { byKey, byPoint, clouds }
}

/** The marks a selection key covers, from the hover index. */
export function hoverMarks(index: MarkIndex, key: StylePath): SceneNode[] {
  if (key[0] === 'pointOverrides') return index.byPoint.get(keyOf([key[1]!, key[2]!])) ?? []
  return index.byKey.get(keyOf(key)) ?? []
}

/**
 * Whether a selection key still names something drawn: marks under it, or (a single point) the
 * point's marks or a cloud of its data set holding it. Keys of a removed layer, a hidden data set
 * or an undone title don't.
 */
export function resolvesIn(index: MarkIndex, key: StylePath): boolean {
  if (hoverMarks(index, key).length > 0) return true
  if (key[0] !== 'pointOverrides') return false
  return (index.clouds.get(String(key[1])) ?? []).some(
    (n) => n.prim?.type === 'points' && cloudPointIndex(n.prim, String(key[2])) >= 0,
  )
}

/**
 * Roadmap 47: whether a key of a graph's selection still names something — drawn (`resolvesIn`),
 * or a whole layer the graph has: chosen in the list of layers, a layer may be hidden or draw
 * nothing yet and stays selected; removed (or undone), it drops out.
 */
export const keyResolves = (
  index: MarkIndex,
  graph: { layers: readonly { id: string }[] },
  key: StylePath,
): boolean =>
  resolvesIn(index, key) ||
  (key[0] === 'layers' && key.length === 2 && graph.layers.some((l) => l.id === String(key[1])))

/**
 * Every node of a scene with the target it (or its nearest ancestor) carries; roadmap 47b: the
 * legend entry each node is part of (`entryOf`, by node id) and the entries' own nodes in the
 * legend's order (`entries`).
 */
export function targetedNodes(root: SceneNode): {
  map: Map<string, SceneNode>
  all: SceneNode[]
  entryOf: Map<string, EntryRef>
  entries: SceneNode[]
} {
  const map = new Map<string, SceneNode>()
  const all: SceneNode[] = []
  const entryOf = new Map<string, EntryRef>()
  const entries: SceneNode[] = []
  const walk = (n: SceneNode, inherited?: StylePath, entry?: EntryRef) => {
    const withTarget = n.target ? n : { ...n, target: inherited }
    map.set(n.id, withTarget)
    all.push(withTarget)
    const own = n.legendEntry ?? entry
    if (n.legendEntry) entries.push(withTarget)
    if (own) entryOf.set(n.id, own)
    for (const c of n.children ?? []) walk(c, withTarget.target, own)
  }
  walk(root)
  return { map, all, entryOf, entries }
}

/** Roadmap 47b: a legend entry's scene target (what formatting it formats), by its key. */
export const entryTargetIn =
  (nodes: Pick<ReturnType<typeof targetedNodes>, 'entries'>) =>
  (key: string): StylePath | undefined =>
    nodes.entries.find((n) => n.legendEntry?.key === key)?.target

const indexes = new WeakMap<
  SceneNode,
  { nodes: ReturnType<typeof targetedNodes>; marks: MarkIndex }
>()

/**
 * A scene's nodes and mark index, made once per scene (scenes never change once made): the
 * canvas, its halos and the view's selection share them.
 */
export function sceneIndex(root: SceneNode): {
  nodes: ReturnType<typeof targetedNodes>
  marks: MarkIndex
} {
  let hit = indexes.get(root)
  if (!hit) {
    const nodes = targetedNodes(root)
    hit = { nodes, marks: hoverIndex(nodes.all, nodes.entryOf) }
    indexes.set(root, hit)
  }
  return hit
}
