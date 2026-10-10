import type { DocumentStore } from '@ps/engine'
import { type GraphContext, layoutGraph, type Scene } from '@ps/graph'
import type { AnalysisResult, NodeId, Project } from '@ps/model'
import { type FigureExporter, figureExports } from '../worker/figureExport.ts'

// Graph scenes shared by the views that draw graphs on screen (audit 2, P3 and P15): the graph
// view and every graph on a layout page. A graph is laid out again only when something its layout
// read has changed, so dragging an item on a page, an edit elsewhere in the project or another
// analysis' new result lays out nothing.
//
// What a layout depends on is recorded as it runs, not listed by hand: the project it is given
// is a view that notes every field and every node read through it (by id; a walk over all the
// nodes, as linked axes make, depends on the whole node map), and the result lookup notes every
// result it returned. The document shares what an edit leaves alone (every edit replaces only
// the objects on its path), so an entry is still good when each of those reads gives the same
// object again: comparing a few references, not the data.

const MISSING = Symbol('missing')

/** The value of an own property (`MISSING` when absent), as recorded and as compared. */
const own = (o: object, k: string): unknown =>
  Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : MISSING

/** What one layout read. */
interface Reads {
  /** The project's own fields read (but `nodes`, whose reads are by node). */
  fields: Map<string, unknown>
  /** Nodes read by id. */
  nodes: Map<string, unknown>
  /** The node map, when the layout went through all of it. */
  allNodes: object | null
  /** Results looked up, by analysis. */
  results: Map<NodeId, AnalysisResult | undefined>
}

/** The project and lookup a layout runs on, recording what it reads into `reads`. */
function recording(
  project: Project,
  result: GraphContext['result'],
  reads: Reads,
): Pick<GraphContext, 'project' | 'result'> {
  const nodes = project.nodes as object
  const nodeView = new Proxy(nodes, {
    get(t, k, r) {
      if (typeof k === 'string' && !reads.nodes.has(k)) reads.nodes.set(k, own(t, k))
      return Reflect.get(t, k, r)
    },
    has(t, k) {
      if (typeof k === 'string' && !reads.nodes.has(k)) reads.nodes.set(k, own(t, k))
      return Reflect.has(t, k)
    },
    getOwnPropertyDescriptor(t, k) {
      if (typeof k === 'string' && !reads.nodes.has(k)) reads.nodes.set(k, own(t, k))
      return Reflect.getOwnPropertyDescriptor(t, k)
    },
    ownKeys(t) {
      reads.allNodes = t
      return Reflect.ownKeys(t)
    },
  })
  const field = (k: string) => {
    if (k !== 'nodes' && !reads.fields.has(k)) reads.fields.set(k, own(project, k))
  }
  // A copy as the target, holding the nodes' view: the store's project is frozen, and a proxy of a
  // frozen object must give its fields as they are.
  const projectView = new Proxy({ ...project, nodes: nodeView } as Project, {
    get(t, k, r) {
      if (typeof k === 'string') field(k)
      return Reflect.get(t, k, r)
    },
    has(t, k) {
      if (typeof k === 'string') field(k)
      return Reflect.has(t, k)
    },
    getOwnPropertyDescriptor(t, k) {
      if (typeof k === 'string') field(k)
      return Reflect.getOwnPropertyDescriptor(t, k)
    },
    ownKeys(t) {
      for (const k of Reflect.ownKeys(t)) if (typeof k === 'string') field(k)
      return Reflect.ownKeys(t)
    },
  })
  return {
    project: projectView,
    ...(result
      ? {
          result: (id: NodeId) => {
            const r = result(id)
            if (!reads.results.has(id)) reads.results.set(id, r)
            return r
          },
        }
      : {}),
  }
}

/** The context's other fields (fonts, theme, screen sample…), compared one by one. */
type Settings = Omit<GraphContext, 'project' | 'graph' | 'result'>

const sameSetting = (a: unknown, b: unknown) =>
  a === b ||
  // A screen sample may be spelled again ({ points: 1000 }).
  (!!a &&
    !!b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([k, v]) => (b as Record<string, unknown>)[k] === v))

function sameSettings(a: Settings, b: Settings): boolean {
  const ka = Object.keys(a) as (keyof Settings)[]
  return ka.length === Object.keys(b).length && ka.every((k) => sameSetting(a[k], b[k]))
}

interface Entry {
  graph: GraphContext['graph']
  settings: Settings
  /** Whether the layout had a result lookup (none: no result was read). */
  lookup: boolean
  reads: Reads
  scene: Scene
}

function stillGood(e: Entry, ctx: GraphContext, settings: Settings): boolean {
  if (e.graph !== ctx.graph || e.lookup !== !!ctx.result) return false
  if (!sameSettings(e.settings, settings)) return false
  const { project, result } = ctx
  for (const [k, v] of e.reads.fields) if (own(project, k) !== v) return false
  if (e.reads.allNodes) {
    if (project.nodes !== e.reads.allNodes) return false
  } else {
    for (const [k, v] of e.reads.nodes) if (own(project.nodes, k) !== v) return false
  }
  for (const [id, r] of e.reads.results) if (result?.(id) !== r) return false
  return true
}

export interface SceneCache {
  /** `layoutGraph`, laid out again only when what the last layout read has changed. */
  layout(ctx: GraphContext): Scene
  /** How many layouts it has made (misses), for tests. */
  readonly layouts: number
  /** Graphs it holds scenes of, for tests. */
  readonly size: number
  clear(): void
}

/**
 * A cache of graph scenes: per graph id its last `perGraph` layouts (the screen's sample and every
 * point, or the graph before and after an edit, for an undo), for at most `graphs` graphs, the
 * least recently used dropped first. Bounded by count, as the views it serves were (a scene can
 * hold a large table's points): a page of more graphs than that lays them out as before.
 */
export function createSceneCache(
  opts: { graphs?: number; perGraph?: number; layout?: (ctx: GraphContext) => Scene } = {},
): SceneCache {
  const maxGraphs = opts.graphs ?? 40
  const perGraph = opts.perGraph ?? 2
  const lay = opts.layout ?? layoutGraph
  const byGraph = new Map<NodeId, Entry[]>()
  let layouts = 0
  return {
    get layouts() {
      return layouts
    },
    get size() {
      return byGraph.size
    },
    clear() {
      byGraph.clear()
    },
    layout(ctx) {
      const { project, graph, result, ...settings } = ctx
      const id = graph.id
      const list = byGraph.get(id) ?? []
      byGraph.delete(id)
      byGraph.set(id, list)
      const hit = list.findIndex((e) => stillGood(e, ctx, settings))
      if (hit >= 0) {
        const e = list[hit]!
        if (hit > 0) list.unshift(...list.splice(hit, 1))
        return e.scene
      }
      const reads: Reads = {
        fields: new Map(),
        nodes: new Map(),
        allNodes: null,
        results: new Map(),
      }
      const scene = lay({ ...ctx, ...recording(project, result, reads) })
      layouts++
      list.unshift({ graph, settings, lookup: !!result, reads, scene })
      if (list.length > perGraph) list.length = perGraph
      if (byGraph.size > maxGraphs) byGraph.delete(byGraph.keys().next().value!)
      return scene
    },
  }
}

/** The app's scene cache: the graph view's canvas and layout pages share it. */
export const screenScenes = createSceneCache()

/**
 * Audit 3, P5: what the screen and the export worker keep of a project is let go when another
 * replaces it (a file opened, a new project, an example): the scenes (each holds what its layout
 * read, the old tables among it) and the worker's copy of the document. Returns the unsubscribe.
 */
export function releaseOnReset(
  store: Pick<DocumentStore, 'subscribe'>,
  scenes: Pick<SceneCache, 'clear'> = screenScenes,
  exporter: Pick<FigureExporter, 'release'> = figureExports,
): () => void {
  return store.subscribe((_, change) => {
    if (change.kind !== 'reset') return
    scenes.clear()
    exporter.release()
  })
}
