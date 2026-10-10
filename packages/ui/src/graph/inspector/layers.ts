import type { Command } from '@ps/engine'
import {
  dataOf,
  freshLayerId,
  frontFirstIds,
  functionModel,
  layerStyle,
  layersMovedBy,
  layersMovedTo,
  layerTitle,
  type ResolvedSeriesStyle,
  resolveSeries,
  type Theme,
} from '@ps/graph'
import {
  type FunctionDef,
  type GraphNode,
  type GraphPathSegment,
  type Layer,
  labelPlain,
  type Project,
  type ResultLookup,
  type Stat,
  type StatParams,
  statOf,
} from '@ps/model'

// Format graph's layer edits (roadmap 33c): what a layer draws (its series), its style and stat
// for every data set or one (decisions 59 and 78, the layer the extra key), and the list
// operations of the Layers section and the canvas. Pure: commands for the store.

/** A path into a graph's layer by its id. */
export const layerPath = (id: string, ...rest: GraphPathSegment[]): GraphPathSegment[] => [
  'layers',
  { id },
  ...rest,
]

/**
 * Sets fields of a layer's stat (`patch`; a field set to undefined is removed) through a Format
 * panel's setter, as one change at the stat's path (audit 3, T9: the result-layer panels').
 */
export function setLayerStat<S extends object>(
  ctx: { set: (path: GraphPathSegment[], value: unknown, label?: string) => void },
  layer: { id: string; stat: S },
  patch: Partial<S>,
  label: string,
): void {
  const next: Record<string, unknown> = { ...layer.stat, ...patch }
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
  ctx.set(layerPath(layer.id, 'stat'), next, label)
}

/** A series a layer draws: a data set of the table, an analysis output or a function. */
export interface SeriesItem {
  key: string
  title: string
  kind: 'dataSet' | 'output' | 'function'
  /** Position among the series of its kind (a data set's in the graph, for its colour). */
  index: number
}

/** A function's name: its title, else its equation's (`invalid` for an equation with an error). */
export function functionTitle(f: FunctionDef, invalid = 'Function'): string {
  if (f.title) return labelPlain(f.title)
  const m = functionModel(f)
  return 'error' in m ? invalid : m.name
}

/** The series a layer draws. */
export function seriesOfLayer(
  project: Project,
  graph: GraphNode,
  layer: Layer,
  lookup?: ResultLookup,
): SeriesItem[] {
  const data = dataOf(graph, layer)
  if (data.from === 'outputs')
    return data.series.map((e, index) => ({
      key: e.id,
      title: lookup?.(e.ref.node)?.outputs[e.ref.key]?.title ?? e.ref.key,
      kind: 'output',
      index,
    }))
  if (data.from === 'functions')
    return data.functions.map((f, index) => ({
      key: f.id,
      title: functionTitle(f),
      kind: 'function',
      index,
    }))
  return resolveSeries(project, graph, lookup).map((s) => ({
    key: s.key,
    title: s.title || '(untitled)',
    kind: 'dataSet',
    index: s.index,
  }))
}

/** Every series of a graph: its data sets, then outputs and functions its layers draw. */
export function graphSeries(project: Project, graph: GraphNode, lookup?: ResultLookup) {
  const out: SeriesItem[] = resolveSeries(project, graph, lookup).map((s) => ({
    key: s.key,
    title: s.title || '(untitled)',
    kind: 'dataSet',
    index: s.index,
  }))
  for (const l of graph.layers)
    if (l.data?.from === 'outputs' || l.data?.from === 'functions')
      for (const s of seriesOfLayer(project, graph, l, lookup))
        if (!out.some((x) => x.key === s.key)) out.push(s)
  return out
}

/** A layer's name for the UI. */
export const layerName = (graph: GraphNode, layer: Layer) => layerTitle(layer, graph.frame)

/** Each series' look in a layer, as the drawing code resolves it (v1 sections). */
export function resolvedStyles(
  theme: Theme,
  graph: GraphNode,
  layer: Layer,
  keys: readonly string[],
): ResolvedSeriesStyle[] {
  return keys.map((k) => layerStyle(theme, graph, layer, k, statOf(layer, k)))
}

/**
 * Whether resolved styles differ in a field (compared as data), i.e. "All data sets" shows it as
 * mixed (decision 78).
 */
export function differsAcross(
  styles: readonly ResolvedSeriesStyle[],
  f: (s: ResolvedSeriesStyle) => unknown,
): boolean {
  if (styles.length < 2) return false
  const first = JSON.stringify(f(styles[0]!))
  return styles.some((x) => JSON.stringify(f(x)) !== first)
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Commands setting style fields of a layer: for one series (`key`, its entry in the layer), or —
 * `key` null — for every series (the layer's style, the same fields dropped from each series'
 * entry, so all follow).
 */
export function styleCommands(
  graph: GraphNode,
  layer: Layer,
  key: string | null,
  changes: readonly [field: string, value: unknown][],
): Command[] {
  const set = (path: GraphPathSegment[], value: unknown): Command => ({
    type: 'node.set',
    id: graph.id,
    path: layerPath(layer.id, ...path),
    value,
  })
  /** Removing fields of a series' entry: the whole style (or entry) when nothing would be left. */
  const drop = (k: string, fields: readonly string[]): Command[] => {
    const e = layer.series?.[k]
    const style = isObject(e?.style) ? e.style : {}
    const left = Object.keys(style).filter((f) => !fields.includes(f))
    if (left.length)
      return fields.filter((f) => f in style).map((f) => set(['series', k, 'style', f], undefined))
    const rest = Object.keys(e ?? {}).filter((f) => f !== 'style')
    return [set(rest.length ? ['series', k, 'style'] : ['series', k], undefined)]
  }
  if (key !== null) {
    const removed = changes.filter(([, v]) => v === undefined).map(([f]) => f)
    return [
      ...changes
        .filter(([, v]) => v !== undefined)
        .map(([f, v]) => set(['series', key, 'style', f], v)),
      ...(removed.length ? drop(key, removed) : []),
    ]
  }
  const fields = changes.map(([f]) => f)
  return [
    ...changes.map(([f, v]) => set(['style', f], v)),
    ...Object.entries(layer.series ?? {})
      .filter(([, e]) => isObject(e.style) && fields.some((f) => Object.hasOwn(e.style!, f)))
      .flatMap(([k]) => drop(k, fields)),
  ]
}

/** The parameters of `b` that differ from `a` (kind included), or undefined when none do. */
export function statDiff(a: Stat, b: Stat): StatParams | undefined {
  const out: Record<string, unknown> = {}
  const A = a as Record<string, unknown>
  for (const [k, v] of Object.entries(b)) if (v !== undefined && A[k] !== v) out[k] = v
  return Object.keys(out).length ? (out as StatParams) : undefined
}

/**
 * Commands giving a layer a stat: for one series (its entry's parameters that differ from the
 * layer's), or — `key` null — for every series (the layer's stat; series entries dropped).
 */
export function statCommands(
  graph: GraphNode,
  layer: Layer,
  key: string | null,
  stat: Stat,
): Command[] {
  const path = (...rest: GraphPathSegment[]) => layerPath(layer.id, ...rest)
  if (key !== null)
    return [
      {
        type: 'node.set',
        id: graph.id,
        path: path('series', key, 'stat'),
        value: statDiff(layer.stat, stat),
      },
    ]
  return [
    { type: 'node.set', id: graph.id, path: path('stat'), value: stat },
    ...Object.entries(layer.series ?? {})
      .filter(([, e]) => e.stat !== undefined)
      .map(
        ([k]): Command => ({
          type: 'node.set',
          id: graph.id,
          path: path('series', k, 'stat'),
          value: undefined,
        }),
      ),
  ]
}

/** Layers attached to a layer (error bars, labels on it) or drawing its data. */
export const attachedTo = (graph: Pick<GraphNode, 'layers'>, id: string): Layer[] =>
  graph.layers.filter((l) => l.on === id || (l.data?.from === 'layer' && l.data.layer === id))

/**
 * Commands putting a graph's layers in a new order (document terms: `graph.moveLayer` to places
 * of the list, 0 the back), one per layer that moves.
 */
function orderCommands(graph: GraphNode, order: readonly Pick<Layer, 'id'>[]): Command[] {
  const cmds: Command[] = []
  const now = graph.layers.map((l) => l.id)
  order.forEach(({ id: lid }, i) => {
    if (now[i] === lid) return
    now.splice(now.indexOf(lid), 1)
    now.splice(i, 0, lid)
    cmds.push({ type: 'graph.moveLayer', id: graph.id, layer: lid, to: i })
  })
  return cmds
}

/** A copy of a layer, with a fresh id, just in front of it. */
export function duplicateLayerCommand(graph: GraphNode, id: string): Command | null {
  const i = graph.layers.findIndex((l) => l.id === id)
  const l = graph.layers[i]
  if (!l) return null
  const base = l.id.replace(/\d+$/, '')
  const { name: _, ...rest } = l
  const copy = { ...structuredClone(rest), id: freshLayerId(base, graph.layers) } as Layer
  return { type: 'graph.addLayer', id: graph.id, layer: copy, at: i + 1 }
}

/** Shows or hides a layer (kept with its formats). */
export const visibilityCommand = (graph: GraphNode, id: string, visible: boolean): Command => ({
  type: 'node.set',
  id: graph.id,
  path: layerPath(id, 'visible'),
  value: visible ? undefined : false,
})

// --- Roadmap 47: several layers at once (the list's multi-select, the canvas' whole layers) ------

/** "Hide layer", "Hide 3 layers"; `after` follows the noun ("Bring 3 layers forward"). */
export const layersLabel = (verb: string, n: number, after = ''): string =>
  `${verb} ${n === 1 ? 'layer' : `${n} layers`}${after ? ` ${after}` : ''}`

/** The ids of these layers that are in the graph, front first (the list's order). */
export const chosenLayers = (graph: Pick<GraphNode, 'layers'>, ids: Iterable<string>): string[] =>
  frontFirstIds(graph.layers, ids)

/** Commands moving several layers one step together (`layersMovedBy`): one undo step. */
export const moveLayersCommands = (graph: GraphNode, ids: readonly string[], by: -1 | 1) =>
  orderCommands(graph, layersMovedBy(graph.layers, ids, by))

/** Commands dragging several layers by the row of `dragged` onto place `to` (`layersMovedTo`). */
export const moveLayersToCommands = (
  graph: GraphNode,
  ids: readonly string[],
  dragged: string,
  to: number,
) => orderCommands(graph, layersMovedTo(graph.layers, ids, dragged, to))

/** Shows or hides several layers: only those that change. */
export const visibilityCommands = (
  graph: GraphNode,
  ids: readonly string[],
  visible: boolean,
): Command[] =>
  graph.layers
    .filter((l) => ids.includes(l.id) && (l.visible !== false) !== visible)
    .map((l) => visibilityCommand(graph, l.id, visible))

/**
 * Copies of several layers, each with a fresh id just in front of its original (as one layer's
 * Duplicate), and the copies' ids in the list's order.
 */
export function duplicateLayersCommands(
  graph: GraphNode,
  ids: readonly string[],
): { commands: Command[]; copies: string[] } {
  let layers = graph.layers
  const commands: Command[] = []
  const copies: string[] = []
  // The front-most first: a copy put in front of its original moves none behind it.
  for (const id of chosenLayers(graph, ids)) {
    const cmd = duplicateLayerCommand({ ...graph, layers }, id)
    if (cmd?.type !== 'graph.addLayer') continue
    commands.push(cmd)
    copies.push(cmd.layer.id)
    const at = cmd.at ?? layers.length
    layers = [...layers.slice(0, at), cmd.layer, ...layers.slice(at)]
  }
  return { commands, copies }
}

/** The layers a layer is attached to or draws the data of. */
const hostsOf = (l: Layer): string[] => [
  ...(l.on === undefined ? [] : [l.on]),
  ...(l.data?.from === 'layer' ? [l.data.layer] : []),
]

/**
 * Removing several layers: a `graph.removeLayer` for each that no other one takes along (the
 * engine removes a layer's attached layers and those drawing its data with it), and the layers
 * that go along without being chosen (named in the question asked first).
 */
export function removeLayersCommands(
  graph: Pick<GraphNode, 'id' | 'layers'>,
  ids: readonly string[],
): { commands: Command[]; along: Layer[] } {
  const chosen = new Set(chosenLayers(graph, ids))
  // What depends on a chosen layer, transitively, as the engine's removeLayer finds it.
  const gone = new Set(chosen)
  for (let grew = true; grew; ) {
    grew = false
    for (const l of graph.layers)
      if (!gone.has(l.id) && hostsOf(l).some((h) => gone.has(h))) {
        gone.add(l.id)
        grew = true
      }
  }
  const commands: Command[] = graph.layers
    .filter((l) => chosen.has(l.id) && !hostsOf(l).some((h) => gone.has(h)))
    .map((l) => ({ type: 'graph.removeLayer', id: graph.id, layer: l.id }))
  return { commands, along: graph.layers.filter((l) => gone.has(l.id) && !chosen.has(l.id)) }
}

/**
 * The question asked before removing layers that take others along (null: none do): "Delete
 * Bars and what is on it (Error bars)?", "Delete 2 layers and what is on them (Error bars,
 * Labels)?" (audit 3, A10: Delete, the one verb for taking layers off a graph).
 */
export function removeLayersQuestion(
  graph: Pick<GraphNode, 'id' | 'layers' | 'frame'>,
  ids: readonly string[],
): { title: string; ok: string; danger: true } | null {
  const chosen = chosenLayers(graph, ids)
  const { along } = removeLayersCommands(graph, chosen)
  if (!along.length || !chosen.length) return null
  const one = chosen.length === 1 ? graph.layers.find((l) => l.id === chosen[0]) : undefined
  const name = (l: Layer) => layerTitle(l, graph.frame)
  const what = one
    ? `${name(one)} and what is on it`
    : `${chosen.length} layers and what is on them`
  return { title: `Delete ${what} (${along.map(name).join(', ')})?`, ok: 'Delete', danger: true }
}
