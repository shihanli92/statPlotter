import { cloudPointNode, layerTitle, type SceneNode, type StylePath } from '@ps/graph'
import type { GraphNode, NodeId } from '@ps/model'
import { tickLabelSelection } from '../graph/canvasEdit.ts'
import { clickSelection, layerSeriesOf, singleMarkName } from '../graph/format/route.ts'
import {
  inLegend,
  isLegendEntryPath,
  legendEntryPath,
  type MarkIndex,
  resolvesIn,
  selectionKey,
  type targetedNodes,
} from './sceneKeys.ts'
import {
  add,
  contains,
  EMPTY_SELECTION,
  elementKey,
  elementPaths,
  primaryPath,
  type Selection,
  type SelKey,
  selectionOf,
  single,
  toggle,
} from './selection.ts'

// The graph canvas' selection rules (roadmap 44, decisions 851–855): clicks with and without
// Shift / ⌘, Escape and Enter, Tab's order, ⌘A, and the names the hint and screen readers use.
// Every key is an `element` key of one graph; the rules of a single selection (decision 243:
// a click on a mark of the selected data set drills to the point) act on the primary key.

/** The modifiers of a click: Alt (Option), and Shift / ⌘ / Ctrl (`additive`). */
export interface ClickMods {
  alt: boolean
  additive: boolean
}

const samePath = (a: StylePath | null | undefined, b: StylePath | null | undefined) =>
  !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i])

/** A single point key (`['pointOverrides', dataSet, point]`). */
const isPoint = (p: StylePath | null | undefined): p is StylePath =>
  p?.[0] === 'pointOverrides' && p.length === 3

/** An axis' tick-label group (`['axes', a, 'tickLabels']`). */
const isTickLabels = (p: StylePath | null | undefined) =>
  p?.[0] === 'axes' && p[2] === 'tickLabels' && p.length === 3

/**
 * The selection after a plain click selects `key` (decision 243's drill, kept from before): a
 * point picked from the layer's marks of its data set remembers them; one picked while another
 * point of the same data set was selected keeps where that one came from.
 */
export function replaceSelection(sel: Selection, graph: NodeId, key: StylePath | null): Selection {
  if (!key) return EMPTY_SELECTION
  const prev = primaryPath(sel)
  let drill: StylePath | undefined
  if (isPoint(key)) {
    if (layerSeriesOf(prev)?.key === String(key[1])) drill = prev!
    else if (isPoint(prev) && prev[1] === key[1]) drill = sel.drill
  }
  return single(elementKey(graph, key), drill)
}

/**
 * What a click on the canvas does (decisions 243, 851).
 *
 * - Plain click: the rules of one selection on the primary key (a layer's marks of a data set,
 *   then one of its points; tick labels of the selected axis; the second click of a double-click
 *   never drills, so a double-click formats the data set). A click on a member of a
 *   multi-selection selects it alone. A click on nothing clears.
 * - Shift / ⌘ / Ctrl-click toggles and never drills: a point of a data set none of whose points
 *   is selected toggles that data set (the layer's marks; adding it drops its selected points: the
 *   data set wins); a point of a data set with a selected point toggles that point; tick labels
 *   toggle their axis unless a tick-label group is selected (then that group). With Alt it
 *   toggles the whole layer. The second click of a double-click changes nothing.
 *
 * `hit` is the selection key of the node clicked (`selectionKey`), `target` its full style target.
 */
export function clickSelect(
  sel: Selection,
  graph: NodeId,
  hit: StylePath | null,
  point: string | undefined,
  target: StylePath | undefined,
  clicks: number,
  mods: ClickMods,
): Selection {
  if (hit?.[0] === 'legend') return legendClick(sel, graph, hit, clicks, mods)
  const marks = layerSeriesOf(hit)
  if (mods.additive) {
    if (!hit || clicks > 1) return sel
    const paths = elementPaths(sel, graph)
    if (marks && mods.alt) return toggle(sel, elementKey(graph, ['layers', marks.layer]))
    if (marks && point !== undefined && paths.some((p) => isPoint(p) && p[1] === marks.key))
      return toggle(sel, elementKey(graph, ['pointOverrides', marks.key, point]))
    if (marks) {
      const key = elementKey(graph, hit)
      if (contains(sel, key)) return toggle(sel, key)
      // The data set wins over its own points.
      const kept = sel.keys.filter(
        (k) => !(k.kind === 'element' && isPoint(k.path) && k.path[1] === marks.key),
      )
      return add(selectionOf(kept), key)
    }
    if (target?.[0] === 'axes' && target[2] === 'tickLabels' && paths.some(isTickLabels))
      return toggle(sel, elementKey(graph, target.slice(0, 3)))
    return toggle(sel, elementKey(graph, hit))
  }
  if (!hit) return EMPTY_SELECTION
  // A member of several selected: that one alone.
  const plain = marks && mods.alt ? ['layers', marks.layer] : hit
  if (sel.keys.length > 1 && contains(sel, elementKey(graph, plain)))
    return single(elementKey(graph, plain))
  const prev = primaryPath(sel)
  const key = clickSelection(hit, point, prev, clicks, mods.alt)
  return replaceSelection(sel, graph, clicks > 1 ? key : tickLabelSelection(key, target, prev))
}

/** The legend itself (not one of its entries). */
const isLegend = (p: StylePath) => p[0] === 'legend' && p.length === 1

/**
 * Roadmap 47b: a click in the legend (`hit`: an entry's key, or the legend's on its other parts).
 * The first click selects the whole legend; once the legend or one of its entries is selected, a
 * click on an entry selects that entry (a drill, as a layer's marks then a point), elsewhere on
 * the legend the legend again. Shift / ⌘ / Ctrl-click toggles an entry once the legend is entered
 * (the legend itself giving way to its entries), else the legend. The second click of a
 * double-click changes nothing once the legend is entered.
 */
function legendClick(
  sel: Selection,
  graph: NodeId,
  hit: StylePath,
  clicks: number,
  mods: ClickMods,
): Selection {
  const entered = elementPaths(sel, graph).some((p) => p[0] === 'legend')
  const entry = isLegendEntryPath(hit) ? hit : null
  const legend = elementKey(graph, ['legend'])
  if (mods.additive) {
    if (clicks > 1) return sel
    if (!entry || !entered) return toggle(sel, legend)
    const kept = sel.keys.filter((k) => !(k.kind === 'element' && isLegend(k.path)))
    return toggle(selectionOf(kept), elementKey(graph, entry))
  }
  if (entered && clicks > 1) return sel
  return single(entry && entered ? elementKey(graph, entry) : legend)
}

/** What a click would select, for the hover halo (null: no halo). */
export function hoverSelect(
  sel: Selection,
  graph: NodeId,
  hit: StylePath,
  point: string | undefined,
  target: StylePath | undefined,
  mods: ClickMods,
): StylePath | null {
  if (mods.additive) {
    const next = clickSelect(sel, graph, hit, point, target, 1, mods)
    // Shown for what would be added (a removal shows the plain hover).
    const added = next.keys.find((k) => !contains(sel, k))
    return added?.kind === 'element' ? added.path : hit
  }
  return primaryPath(clickSelect(sel, graph, hit, point, target, 1, mods))
}

/**
 * Escape and Shift+Enter step back out one level: points (of one data set) → the layer's marks
 * they were picked from (else the data set), a tick-label group → its axis, legend entries → the
 * legend (roadmap 47b), anything else → nothing.
 */
export function stepOut(sel: Selection, graph: NodeId): Selection {
  const paths = elementPaths(sel, graph)
  if (!paths.length) return EMPTY_SELECTION
  // Roadmap 47b: legend entries → the legend.
  if (paths.every(isLegendEntryPath)) return single(elementKey(graph, ['legend']))
  const ds = paths[0]![1]
  if (paths.every((p) => isPoint(p) && p[1] === ds)) {
    const back = layerSeriesOf(sel.drill)
    return single(
      elementKey(
        graph,
        back && back.key === String(ds) ? sel.drill! : ['seriesOverrides', ds as string],
      ),
    )
  }
  if (paths.length === 1 && isTickLabels(paths[0]))
    return single(elementKey(graph, paths[0]!.slice(0, 2)))
  return EMPTY_SELECTION
}

/**
 * Enter goes into the primary element: a layer's marks of a data set → its first point (in
 * drawing order), an axis → its tick labels, the legend → its first entry (roadmap 47b). Null when there is nothing to go into (Enter then
 * formats).
 */
export function stepIn(
  sel: Selection,
  graph: NodeId,
  nodes: ReturnType<typeof targetedNodes>,
  index: MarkIndex,
): Selection | null {
  const p = primaryPath(sel)
  if (!p) return null
  const marks = layerSeriesOf(p)
  if (marks) {
    const point = firstPoint(nodes.all, p)
    return point === null
      ? null
      : single(elementKey(graph, ['pointOverrides', marks.key, point]), p)
  }
  if (p[0] === 'axes' && p.length === 2) {
    const ticks = [...p, 'tickLabels']
    return resolvesIn(index, ticks) ? single(elementKey(graph, ticks)) : null
  }
  // Roadmap 47b: the legend → its first entry.
  if (isLegend(p)) {
    const first = nodes.entries[0]?.legendEntry
    return first ? single(elementKey(graph, legendEntryPath(first.key))) : null
  }
  return null
}

/** The first single point drawn under a layer's marks of a data set (null: none). */
function firstPoint(all: readonly SceneNode[], key: StylePath): string | null {
  for (const n of all) {
    const t = n.target
    if (!t || !samePath(t.slice(0, 4), key) || !n.prim) continue
    if (n.prim.type === 'points') {
      if (n.prim.n > 0) return cloudPointNode(n, 0).point ?? null
    } else if (n.point !== undefined) return n.point
  }
  return null
}

/** The top-level element a node's target belongs to (⌘A, Tab), if any. */
function topLevel(t: StylePath | undefined): StylePath | null {
  if (!t?.length) return null
  switch (t[0]) {
    case 'title':
      return ['title']
    case 'legend':
      return ['legend']
    case 'annotations':
      return t[1] === undefined ? null : ['annotations', t[1]]
    case 'axes':
      if (t[1] === undefined) return null
      if (t[2] === 'title' || t[2] === 'tickLabels') return t.slice(0, 3)
      return ['axes', t[1]]
    // A layer's marks of a data set; audit 4 (A6): or the layer itself, when its marks target it
    // (a heat map's tiles, its dendrograms, a density…), as a click selects it.
    case 'layers':
      if (t[1] === undefined) return null
      return t[2] === 'series' ? (t[3] !== undefined ? selectionKey(t) : null) : ['layers', t[1]]
    default:
      return null
  }
}

/** Where a top-level element comes in reading order: [group, rank within it]. */
function rank(p: StylePath, layerFront: (id: string) => number): [number, number, number] {
  const axisPart = (a: string, part: unknown): [number, number, number] => {
    // The Y axes: title, labels, line (left to right); X: line, labels, title (top to bottom).
    const order =
      a === 'y'
        ? ['title', 'tickLabels', undefined]
        : a === 'y2'
          ? [undefined, 'tickLabels', 'title']
          : [undefined, 'tickLabels', 'title']
    return [a === 'y' ? 1 : a === 'y2' ? 3 : 4, order.indexOf(part as never), 0]
  }
  switch (p[0]) {
    case 'title':
      return [0, 0, 0]
    case 'axes':
      return axisPart(String(p[1]), p[2])
    case 'layers':
      return [2, layerFront(String(p[1])), 0]
    case 'legend':
      return [5, 0, 0]
    default:
      return [6, Number(p[1]), 0]
  }
}

/**
 * The graph's top-level elements in reading order (⌘A selects them; Tab steps through them): the
 * title, the Y axis (title, tick labels, line), each layer's data sets (front layer first, data
 * sets in drawing order; a layer whose marks target the layer itself, as a heat map's tiles and
 * dendrograms do, once: audit 4, A6), the right Y axis, the X axis (line, tick labels, title), the legend,
 * then the annotations. Only what the scene draws; `all` is the scene's nodes in drawing order.
 * Audit 3 (A1): the legend comes in whenever any part of it is drawn (its entries target their
 * data sets, and a legend without a box has no node targeting the legend itself).
 */
export function elementOrder(
  graph: Pick<GraphNode, 'layers'>,
  all: readonly SceneNode[],
): StylePath[] {
  const seen = new Map<string, { path: StylePath; at: number }>()
  for (const n of all) {
    if (!n.prim) continue
    const p = inLegend(n.id) ? ['legend'] : topLevel(n.target)
    if (!p) continue
    const id = JSON.stringify(p)
    if (!seen.has(id)) seen.set(id, { path: p, at: seen.size })
  }
  const front = (id: string) => {
    const i = graph.layers.findIndex((l) => l.id === id)
    return i < 0 ? 0 : graph.layers.length - i
  }
  return [...seen.values()]
    .sort((a, b) => {
      const ra = rank(a.path, front)
      const rb = rank(b.path, front)
      for (let i = 0; i < 3; i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!
      return a.at - b.at
    })
    .map((x) => x.path)
}

/** ⌘A: every top-level element, the first primary. */
export function selectAll(graph: NodeId, order: readonly StylePath[]): Selection {
  const keys = order.map((p) => elementKey(graph, p))
  return keys.length ? selectionOf(keys, keys[0]) : EMPTY_SELECTION
}

/**
 * Tab (`by` 1) and Shift-Tab (−1): the next or previous element in `order` after the primary
 * (a point counts as its data set, tick labels and titles as themselves); from nothing the first
 * or last. Null past either end: the focus leaves the canvas.
 */
export function tabStep(sel: Selection, graph: NodeId, order: readonly StylePath[], by: 1 | -1) {
  if (!order.length) return null
  const p = primaryPath(sel)
  const where = (q: StylePath | null | undefined) => order.findIndex((o) => samePath(o, q))
  let i = p ? where(p) : -1
  // Roadmap 47b: a legend entry counts as the legend.
  if (i < 0 && isLegendEntryPath(p)) i = where(['legend'])
  if (i < 0 && isPoint(p)) {
    i = where(sel.drill)
    if (i < 0) i = order.findIndex((o) => layerSeriesOf(o)?.key === String(p[1]))
  }
  const next = i < 0 && !p ? (by > 0 ? 0 : order.length - 1) : i < 0 ? 0 : i + by
  return next < 0 || next >= order.length ? null : single(elementKey(graph, order[next]!))
}

/**
 * Audit 3 (A1): ] and [ while the legend or one of its entries is the primary element — the next
 * or previous entry in the legend's order (from the legend itself the first or the last), round.
 * `entries`: the scene's entry nodes in the legend's order (`targetedNodes`). Null otherwise.
 */
export function entryStep(
  sel: Selection,
  graph: NodeId,
  entries: readonly Pick<SceneNode, 'legendEntry'>[],
  by: 1 | -1,
): Selection | null {
  const p = primaryPath(sel)
  if (p?.[0] !== 'legend') return null
  const keys = [...new Set(entries.flatMap((n) => (n.legendEntry ? [n.legendEntry.key] : [])))]
  if (!keys.length) return null
  const at = isLegendEntryPath(p) ? keys.indexOf(String(p[2])) : -1
  const i = at < 0 ? (by > 0 ? 0 : keys.length - 1) : (at + by + keys.length) % keys.length
  return single(elementKey(graph, legendEntryPath(keys[i]!)))
}

/** A data set's title by its key (for names), when known. */
export type SeriesTitle = (key: string) => string | undefined

const AXIS_NAMES: Record<string, string> = { x: 'X axis', y: 'Y axis', y2: 'Right Y axis' }

/**
 * What a selected element is called, for screen readers and the right-click menu's counts:
 * "Graph title", "Y axis title", "X axis tick labels", "“Control” in “Points”", "Data point of
 * “Control”", "Legend", "Text box"…
 */
export function elementName(
  graph: Pick<GraphNode, 'layers' | 'annotations' | 'frame'>,
  path: StylePath,
  title: SeriesTitle = () => undefined,
): string {
  const named = (k: unknown) => {
    const t = title(String(k))
    return t ? `“${t}”` : 'data set'
  }
  const [head, second, third] = path
  switch (head) {
    case 'title':
      return 'Graph title'
    case 'legend': {
      // Roadmap 47b: an entry, named by its label.
      if (second !== 'entries' || third === undefined) return 'Legend'
      const t = title(String(third))
      return t ? `Legend entry “${t}”` : 'Legend entry'
    }
    case 'axes': {
      const axis = AXIS_NAMES[String(second)] ?? 'Axis'
      if (third === 'title') return `${axis} title`
      if (third === 'tickLabels') return `${axis} tick labels`
      return axis
    }
    case 'layers': {
      const l = graph.layers.find((x) => x.id === String(second))
      const name = l ? `“${layerTitle(l, graph.frame)}”` : 'a layer'
      if (third === 'series' && path[3] !== undefined) return `${named(path[3])} in ${name}`
      return `Layer ${name}`
    }
    case 'seriesOverrides':
      return `Data set ${named(second)}`
    case 'pointOverrides': {
      const what = singleMarkName(graph, String(third))
      return `${what[0]!.toUpperCase()}${what.slice(1)} of ${named(second)}`
    }
    case 'annotations': {
      const a = graph.annotations[Number(second)]
      if (a?.type === 'text') return 'Text box'
      if (a?.type === 'line') return a.arrow === 'none' ? 'Line' : 'Arrow'
      if (a?.type === 'bracket') return 'Bracket'
      if (a?.type === 'table') return 'Results table'
      return 'Annotation'
    }
    case 'style':
      if (second === 'frame') return 'Frame'
      if (second === 'plotBackground') return 'Plot area'
      if (second === 'background') return 'Graph background'
      return 'Graph'
    default:
      return 'Graph element'
  }
}

/**
 * What the live region says about a selection (decision 853): the element's name alone, "3
 * elements selected", or "Graph" for nothing (the graph itself is then what Format acts on).
 */
export function selectionAnnouncement(
  graph: Pick<GraphNode, 'id' | 'layers' | 'annotations' | 'frame'>,
  sel: Selection,
  title?: SeriesTitle,
): string {
  const paths = elementPaths(sel, graph.id)
  if (!paths.length) return 'Graph'
  if (paths.length === 1) return elementName(graph, paths[0]!, title)
  return `${paths.length} elements selected`
}

/** The data set a selected data set's key names (a layer's marks of it, its identity). */
const dataSetOf = (p: StylePath): string | undefined =>
  layerSeriesOf(p)?.key ?? (p[0] === 'seriesOverrides' && p.length === 2 ? String(p[1]) : undefined)

/**
 * The data sets a marquee picks points of (decision 861): those the selection names (a layer's
 * marks of one, its identity, or one of its points), in selection order; empty when none is.
 */
export function selectedDataSets(sel: Selection, graph: NodeId): string[] {
  const out: string[] = []
  for (const p of elementPaths(sel, graph)) {
    const ds = dataSetOf(p) ?? (isPoint(p) ? String(p[1]) : undefined)
    if (ds !== undefined && !out.includes(ds)) out.push(ds)
  }
  return out
}

/**
 * The selection after a marquee picked `picked` (decision 862). Elements replace the selection,
 * or with Shift / ⌘ are added to it (a data set added drops its selected points, as a Shift-click
 * does). Points replace the selection, or are added to it in place of the keys of their own data
 * sets (the layer's marks or identity they were picked from); the primary point remembers the
 * selected layer's marks of its data set (decision 243). Nothing picked clears the selection,
 * unless adding.
 */
export function marqueeSelect(
  sel: Selection,
  graph: NodeId,
  picked: readonly StylePath[],
  opts: { additive: boolean; points: boolean },
): Selection {
  const keys = picked.map((p) => elementKey(graph, p))
  if (!opts.points) {
    if (!opts.additive) return keys.length ? selectionOf(keys) : EMPTY_SELECTION
    let next = sel
    for (const p of picked) {
      const marks = layerSeriesOf(p)
      if (marks) {
        const own = (k: SelKey) =>
          k.kind === 'element' && isPoint(k.path) && k.path[1] === marks.key
        if (next.keys.some(own)) next = selectionOf(next.keys.filter((k) => !own(k)))
      }
      next = add(next, elementKey(graph, p))
    }
    return next
  }
  if (!keys.length) return opts.additive ? sel : EMPTY_SELECTION
  const sets = new Set(picked.map((p) => String(p[1])))
  const last = picked[picked.length - 1]!
  const prev = primaryPath(sel)
  // Where the primary point came from: a selected layer's marks of its data set, if any.
  const from = [prev, ...elementPaths(sel, graph)].find(
    (p) => layerSeriesOf(p)?.key === String(last[1]),
  )
  const drill = from ?? (isPoint(prev) && prev[1] === last[1] ? sel.drill : undefined)
  const kept = opts.additive
    ? sel.keys.filter((k) => {
        if (k.kind !== 'element' || k.graph !== graph) return false
        const ds = dataSetOf(k.path)
        return ds === undefined || !sets.has(ds)
      })
    : []
  return selectionOf([...kept, ...keys], keys[keys.length - 1], drill ?? undefined)
}
