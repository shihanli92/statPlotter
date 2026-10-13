import type { Command } from '@ps/engine'
import { layerTitle, pointOverride, type Scene, type StylePath } from '@ps/graph'
import { type GraphNode, type Layer, plural, seriesShown } from '@ps/model'
import { isLegendEntryPath } from '../selection/sceneKeys.ts'
import {
  applyDrag,
  commitOf,
  type DragTarget,
  resetPositionOf,
  selectedDragTarget,
} from './canvasEdit.ts'
import { elementBox } from './canvasSnap.ts'
import { singleMarkName } from './format/route.ts'
import { layerPath, removeLayersCommands } from './inspector/layers.ts'
import { entriesShownCommand, shownLabel } from './legendEdits.ts'
import { hidePointsCommands, type PointRef } from './pointEdits.ts'

// Edits of several selected elements of a graph at once (roadmap 44, decision 852): moving and
// nudging, Reset position and Delete (roadmap 47: whole layers removed, points hidden), each one
// undo step (`store.dispatch(commands, label)`). Pure: commands for the store. Writes use layer
// paths (CLAUDE.md).

/** One edit of a graph's node (`node.set` on the graph). */
export interface GraphEdit {
  path: StylePath
  value: unknown
  label: string
}

/** The graph's commands for edits, in order. */
export const graphCommands = (graph: GraphNode, edits: readonly GraphEdit[]): Command[] =>
  edits.map((e) => ({ type: 'node.set', id: graph.id, path: e.path, value: e.value }))

/**
 * What arrow keys and a drag move for these selection keys: each movable one's drag target
 * (a selected point: its label, when drawn), once each, in selection order. Data sets, axes and
 * the frame aren't movable and are left out.
 */
export function movableTargets(
  graph: GraphNode,
  scene: Scene,
  paths: readonly StylePath[],
): DragTarget[] {
  const seen = new Set<string>()
  const out: DragTarget[] = []
  for (const p of paths) {
    const t = selectedDragTarget(p, graph)
    if (!t || !elementBox(scene, graph, t)) continue
    const id = JSON.stringify(t)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(t)
  }
  return out
}

/**
 * The graph with `targets` moved by (dx, dy) scene points each (the first by `first` when given,
 * e.g. its snapped move), and the edits committing it.
 */
export function moveEdits(
  graph: GraphNode,
  scene: Scene,
  targets: readonly DragTarget[],
  dx: number,
  dy: number,
): { graph: GraphNode; edits: GraphEdit[] } {
  const next = targets.reduce((g, t) => applyDrag(g, scene, t, dx, dy), graph)
  return { graph: next, edits: targets.map((t) => commitOf(next, t)) }
}

/** The undo label of a move of `n` elements (one: its own, "Move axis title"). */
export const moveLabel = (edits: readonly GraphEdit[]): string =>
  edits.length === 1 ? edits[0]!.label : `Move ${edits.length} elements`

/** Reset position for several keys: every offset any of them clears, once each. */
export function resetPaths(graph: GraphNode, paths: readonly StylePath[]): StylePath[] {
  const seen = new Set<string>()
  return paths
    .flatMap((p) => resetPositionOf(graph, p))
    .filter((p) => {
      const id = JSON.stringify(p)
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
}

/**
 * Whether Delete acts on a key: an annotation (removed), a layer's data set (hidden in it), a
 * whole layer (removed: roadmap 47, of any kind), a single point (hidden on the graph) or a legend
 * entry (roadmap 47b: hidden from the legend).
 */
export function deletable(graph: GraphNode, p: StylePath): boolean {
  if (isLegendEntryPath(p)) return !(graph.legend.hidden ?? []).includes(String(p[2]))
  if (p[0] === 'annotations') return !!graph.annotations[Number(p[1])]
  if (p[0] === 'layers' && p.length === 2) return graph.layers.some((l) => l.id === String(p[1]))
  if (p[0] === 'layers' && p[2] === 'series' && p[3] !== undefined) {
    const l = graph.layers.find((x) => x.id === String(p[1]))
    return !!l && seriesShown(l, String(p[3]))
  }
  if (p[0] === 'pointOverrides' && p.length === 3)
    return !pointOverride(graph, String(p[1]), String(p[2]))?.hide
  return false
}

const annotationLabel = (a: GraphNode['annotations'][number]) =>
  a.type === 'bracket'
    ? 'Delete bracket'
    : a.type === 'text'
      ? 'Delete text'
      : a.type === 'table'
        ? 'Delete results table'
        : 'Delete line'

/** How many things of each kind a Delete acts on (roadmap 47). */
export interface DeleteTally {
  /** Removed. */
  annotations: number
  layers: number
  /** Hidden. */
  dataSets: number
  points: number
  /** What the points are ("point", "bar", "slice"…). */
  point: string
  /** Roadmap 47b: legend entries hidden from the legend. */
  entries?: number
}

/**
 * The undo label of a Delete of several things: what is deleted, then what is hidden — "Delete 2
 * layers", "Hide 2 data sets", "Delete 2 layers, hide 3 points", "Hide 2 data sets and 3
 * points", "Delete 3 elements" (annotations and layers). `deletedOne`: the one deleted thing's own
 * label ("Delete text"), when one is.
 */
export function deleteLabel(t: DeleteTally, deletedOne?: string): string {
  const deletes = t.annotations + t.layers
  const deleted =
    deletes === 1 && deletedOne
      ? deletedOne
      : !deletes
        ? ''
        : t.annotations
          ? `Delete ${plural(deletes, 'element')}`
          : `Delete ${plural(t.layers, 'layer')}`
  const hidden = [
    ...(t.dataSets ? [plural(t.dataSets, 'data set')] : []),
    ...(t.points ? [plural(t.points, t.point)] : []),
    ...(t.entries ? [plural(t.entries, 'legend entry', 'legend entries')] : []),
  ]
  if (!hidden.length) return deleted
  return deleted ? `${deleted}, hide ${hidden.join(' and ')}` : `Hide ${hidden.join(' and ')}`
}

/**
 * The menu item of a Delete of several things: one kind, its name and count ("Delete layers
 * (2)", "Hide data sets (2)", "Hide points (3)", "Delete (3)" for annotations); else the label.
 */
export function deleteMenuLabel(t: DeleteTally, label: string): string {
  const entries = t.entries ?? 0
  const n = t.annotations + t.layers + t.dataSets + t.points + entries
  const kinds = [t.annotations, t.layers, t.dataSets, t.points, entries].filter((k) => k > 0).length
  if (n === 1 || kinds > 1) return label
  if (t.layers) return `Delete layers (${n})`
  if (t.dataSets) return `Hide data sets (${n})`
  if (t.points) return `Hide ${t.point}s (${n})`
  if (entries) return `Hide from legend (${n})`
  return `Delete (${n})`
}

/** What Delete does to a selection, as `deleteEdits` gives it. */
export interface DeleteEdits {
  commands: Command[]
  /** "Delete text", "Hide 2 data sets", "Delete 2 layers, hide 3 points". */
  label: string
  /** The menu item for it: "Delete layers (2)", "Hide points (3)", else the label. */
  menuLabel: string
  /** How many selected things it acts on. */
  count: number
  /** How many of each kind. */
  tally: DeleteTally
  /** Layers removed with the selected ones without being selected (asked about first). */
  along: Layer[]
  /** The selected layers it removes (to ask about by name). */
  layers: string[]
}

/**
 * Delete on a selection (decisions 852, 934; roadmap 47): annotations are removed; a layer's
 * marks of a data set are hidden in that layer (`series[key].hide`, the layer's "Show … for this
 * data set"); a whole layer of any kind is removed (`graph.removeLayer`, its attached layers and
 * those drawing its data with it: `along`, which the views ask about first); a single point is
 * hidden on the graph (`pointOverrides[key][point].hide`, PointPanel's "Hide this point", the
 * table untouched). One undo step, labelled by what it does: "Delete text", "Delete line" (a
 * typed line or band), "Delete layer", "Hide Control in Points", "Hide data point", "Hide 2 data
 * sets", "Delete 2 layers, hide 3 points". Null when nothing selected can be deleted. `title`: a
 * data set's name by key.
 */
export function deleteEdits(
  graph: GraphNode,
  paths: readonly StylePath[],
  title: (key: string) => string | undefined = () => undefined,
): DeleteEdits | null {
  const doomed = new Set<number>()
  const hidden: { layer: GraphNode['layers'][number]; key: string }[] = []
  const removed = new Set<string>()
  const points: PointRef[] = []
  const entries: string[] = []
  for (const p of paths) {
    if (!deletable(graph, p)) continue
    if (isLegendEntryPath(p)) {
      if (!entries.includes(String(p[2]))) entries.push(String(p[2]))
    } else if (p[0] === 'annotations') doomed.add(Number(p[1]))
    else if (p[0] === 'pointOverrides') {
      const ref: PointRef = [String(p[1]), String(p[2])]
      if (!points.some(([d, k]) => d === ref[0] && k === ref[1])) points.push(ref)
    } else if (p.length === 2) removed.add(String(p[1]))
    else {
      const layer = graph.layers.find((x) => x.id === String(p[1]))!
      const key = String(p[3])
      if (!hidden.some((h) => h.layer.id === layer.id && h.key === key)) hidden.push({ layer, key })
    }
  }
  const removal = removeLayersCommands(graph, [...removed])
  // A data set hidden in a layer that goes anyway: nothing to hide.
  const gone = new Set([...removed, ...removal.along.map((l) => l.id)])
  const hides = hidden.filter((h) => !gone.has(h.layer.id))
  const count = doomed.size + hides.length + removed.size + points.length + entries.length
  if (!count) return null
  const commands: Command[] = []
  if (doomed.size)
    commands.push({
      type: 'node.set',
      id: graph.id,
      path: ['annotations'],
      value: graph.annotations.filter((_, i) => !doomed.has(i)),
    })
  for (const { layer, key } of hides)
    commands.push({
      type: 'node.set',
      id: graph.id,
      path: layerPath(layer.id, 'series', key, 'hide'),
      // Hidden: the layer's default where it hides data sets, else an explicit hide.
      value: layer.seriesHidden ? undefined : true,
    })
  commands.push(...hidePointsCommands(graph, points), ...removal.commands)
  // Roadmap 47b: entries hidden from the legend (`legend.hidden`), the data sets still drawn.
  const hideEntries = entries.length ? entriesShownCommand(graph, entries, false) : null
  if (hideEntries) commands.push(hideEntries)

  // The label: what is deleted, then what is hidden; one thing, its own.
  const tally: DeleteTally = {
    annotations: doomed.size,
    layers: removed.size,
    dataSets: hides.length,
    points: points.length,
    point: points.length ? singleMarkName(graph, points[0]![1]).replace('data ', '') : 'point',
    ...(entries.length ? { entries: entries.length } : {}),
  }
  const one = [...removed][0]
  const typed = graph.layers.find((l) => l.id === one && l.data?.from === 'values')
  const deletedOne = doomed.size
    ? annotationLabel(graph.annotations[[...doomed][0]!]!)
    : typed
      ? typed.geom === 'band'
        ? 'Delete band'
        : 'Delete line'
      : 'Delete layer'
  let label: string
  if (count === 1 && hides.length) {
    const { layer, key } = hides[0]!
    label = `Hide ${title(key) ?? 'data set'} in ${layerTitle(layer, graph.frame)}`
  } else if (count === 1 && points.length) label = `Hide ${singleMarkName(graph, points[0]![1])}`
  else if (count === entries.length) label = shownLabel(count, false)
  else label = deleteLabel(tally, deletedOne)
  const menuLabel = deleteMenuLabel(tally, label)
  return {
    commands,
    label,
    menuLabel,
    count,
    tally,
    along: removal.along,
    layers: [...removed],
  }
}
