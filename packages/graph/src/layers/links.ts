import {
  type AnalysisResult,
  type GraphNode,
  type NodeId,
  type Project,
  type ResultLookup,
  sourceTable,
} from '@ps/model'
import type { FontRegistry } from '../fonts/registry.ts'
import { Extent } from '../layout/common.ts'
import { graphTheme, type Theme } from '../theme.ts'
import { isLogScale } from '../transform.ts'
import { frameExtent } from './engine.ts'
import { LayerKit } from './kit.ts'

// Linked axes: graphs with the same group id in `links.x` / `links.y` plan that axis' automatic
// range from the union of all members' data extents. Only continuous axes with an automatic
// range take part (a member with a manual range neither contributes nor changes). Extents come
// from the graphs' layers (`frameExtent`), without laying out any text.

export type LinkAxis = 'x' | 'y'

/** A graph whose axes may be linked. */
export type AnyGraph = GraphNode

/** Whether a graph draws this axis as a continuous (value) axis. */
function valueAxis(graph: GraphNode, axis: LinkAxis): boolean {
  // Parts of whole are drawn as fractions of each whole, heat maps have no value axis: nothing
  // to share.
  if (graph.frame === 'polar' || graph.frame === 'matrix') return false
  if (graph.layers.some((l) => l.stat.kind === 'fraction')) return false
  return graph.frame === 'category' || graph.frame === 'grouped' ? axis === 'y' : true
}

/** True when the graph's axis takes part in a link: continuous, automatic range. */
export function linkableAxis(graph: AnyGraph, axis: LinkAxis): boolean {
  const g = graph
  const spec = graph.axes[axis]
  return valueAxis(g, axis) && spec.type === 'continuous' && spec.range === 'auto'
}

export interface AxisExtentOptions {
  theme?: Theme
  /**
   * Keep only positive values (for a log axis). Default: the graph's own axis scale (survival
   * axes are always linear).
   */
  log?: boolean
}

interface CacheEntry {
  table: unknown
  theme: Theme
  conf: number
  results: readonly (AnalysisResult | undefined)[]
  extent: { lo: number; hi: number } | null
}

/** Per graph object (immutable), per axis and log flag; validated against its inputs. */
const cache = new WeakMap<AnyGraph, Map<string, CacheEntry>>()

/** Measuring needs no text: extents never lay any out. */
const NO_FONTS = {} as FontRegistry

/**
 * The data extent a graph plots along an axis (what its automatic range is planned from): data
 * including error bars, points, box whiskers, curves and bands shown; brackets and annotations
 * excluded. Null for a categorical axis or when there is nothing to plot. No text is laid out, so
 * this is cheap; results are cached per graph object.
 */
export function axisExtent(
  project: Project,
  graph: AnyGraph,
  axis: LinkAxis,
  result?: ResultLookup,
  opts: AxisExtentOptions = {},
): { lo: number; hi: number } | null {
  const g = graph
  if (!valueAxis(g, axis)) return null
  const spec = graph.axes[axis]
  const km = g.layers.some((l) => l.stat.kind === 'km')
  const log = opts.log ?? (!km && spec.type === 'continuous' && isLogScale(spec.scale))
  const theme = opts.theme ?? graphTheme(project, graph)
  const table = sourceTable(project, graph.seriesSource.table, result)
  const conf = project.settings.defaultConfidenceLevel
  // Every result the extent reads: analysis curves' (outputs), and result layers' (roadmap 35;
  // audit 2, G17: a rerun analysis widens or narrows its partners too).
  const results = g.layers.flatMap((l) => {
    const d = l.data
    if (d?.from === 'outputs') return d.series.map((e) => result?.(e.ref.node))
    if (d?.from === 'analysis') return [result?.(d.analysis)]
    return []
  })

  const key = `${axis}:${log}`
  let entries = cache.get(graph)
  const hit = entries?.get(key)
  if (
    hit &&
    hit.table === table &&
    hit.theme === theme &&
    hit.conf === conf &&
    hit.results.length === results.length &&
    hit.results.every((r, i) => r === results[i])
  ) {
    return hit.extent
  }

  const kit = new LayerKit({ project, graph: g, fonts: NO_FONTS, theme, result })
  const e = frameExtent(kit, axis, log)
  const extent = !e || e.empty ? null : { lo: e.lo, hi: e.hi }

  if (!entries) {
    entries = new Map()
    cache.set(graph, entries)
  }
  entries.set(key, { table, theme, conf, results, extent })
  return extent
}

/**
 * A graph's own extent along an axis widened by every other member of its link group (the
 * automatic range is then planned from the union). Unchanged when the axis isn't linked or has a
 * manual range. Members are measured with `axisExtent`, which never consults links, so linking
 * can't recurse however the groups are wired.
 */
export function linkedExtent(kit: LayerKit, axis: LinkAxis, own: Extent, log: boolean): Extent {
  const { project, result } = kit.ctx
  const { graph } = kit
  const group = graph.links?.[axis]
  if (!group || !linkableAxis(graph, axis)) return own
  const out = new Extent(log)
  out.add(own.lo)
  out.add(own.hi)
  for (const node of Object.values(project.nodes)) {
    if (node.kind !== 'graph' || node.id === graph.id || node.links?.[axis] !== group) continue
    if (!linkableAxis(node, axis)) continue
    const e = axisExtent(project, node, axis, result, { theme: kit.theme, log })
    if (e) {
      out.add(e.lo)
      out.add(e.hi)
    }
  }
  return out
}

/**
 * Link groups of a project: group id → member graph ids (navigator order), over both axes or
 * just one. Ids are matched per axis; a graph linked on X and Y with the same id is listed once.
 */
export function linkGroups(project: Project, axis?: LinkAxis): Map<string, NodeId[]> {
  const out = new Map<string, NodeId[]>()
  const seen = new Set<NodeId>()
  const graphs: GraphNode[] = []
  const take = (id: NodeId) => {
    const n = project.nodes[id]
    if (n?.kind === 'graph' && !seen.has(id)) {
      seen.add(id)
      graphs.push(n)
    }
  }
  for (const id of project.order) take(id)
  for (const id of Object.keys(project.nodes)) take(id as NodeId)
  for (const g of graphs) {
    const ids = new Set(
      (axis ? [g.links?.[axis]] : [g.links?.x, g.links?.y]).filter((v): v is string => !!v),
    )
    for (const id of ids) out.set(id, [...(out.get(id) ?? []), g.id])
  }
  return out
}
