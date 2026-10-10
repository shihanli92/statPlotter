import type { FontRegistry, Scene } from '@ps/graph'
import {
  FontsPending,
  layoutGraph,
  layoutPage,
  pointsAsImages,
  RASTER_THRESHOLD,
  SCREEN_SAMPLE,
  scenePointCount,
  sceneToSvg,
  thumbnailSource,
} from '@ps/graph'
import {
  type AnalysisResult,
  type AssetId,
  type GraphNode,
  type ImageAsset,
  type LayoutNode,
  type NodeId,
  nodeById,
  nodeDependencies,
  type Project,
} from '@ps/model'
import { pageSources } from '../layout/pageScene.ts'

// Thumbnails of graphs and layout pages (roadmap 40, decision 603): rendered in the background
// (idle callbacks, one at a time, so editing never waits), cached per node and version (a
// signature of everything the drawing reads), redrawn when that changes. Derived data: never in
// the document, not kept between sessions.

/** A per-object stamp: the same object, the same number (document objects are immutable). */
const stamps = new WeakMap<object, number>()
let nextStamp = 1
const stamp = (o: object | undefined | null): string => {
  if (!o) return '-'
  let s = stamps.get(o)
  if (s === undefined) {
    s = nextStamp++
    stamps.set(o, s)
  }
  return String(s)
}

type ResultOf = (id: NodeId) => AnalysisResult | undefined

/**
 * The version of a graph's or page's drawing: the node, the project's settings and info sheets,
 * every node it reads (transitively: tables, analyses, a page's graphs and theirs) and the
 * latest results of those analyses, by identity. Anything else changing leaves it alone.
 */
export function thumbnailVersion(
  project: Project,
  id: NodeId,
  result: ResultOf,
  assetsVersion = 0,
): string | null {
  const node = nodeById(project.nodes, id)
  if (node?.kind !== 'graph' && node?.kind !== 'layout') return null
  const seen = new Set<NodeId>()
  const parts: string[] = [stamp(project.settings)]
  const visit = (nid: NodeId) => {
    if (seen.has(nid)) return
    seen.add(nid)
    const n = nodeById(project.nodes, nid)
    parts.push(`${nid}:${stamp(n)}`)
    if (!n) return
    if (n.kind === 'analysis') parts.push(`r${stamp(result(nid))}`)
    // Formulas may read info sheets' fields.
    if (n.kind === 'table' && n.dataSets.some((d) => d.formula?.includes(':')))
      for (const o of project.order) {
        const x = project.nodes[o]
        if (x?.kind === 'info') parts.push(`i${stamp(x)}`)
      }
    for (const dep of nodeDependencies(n)) visit(dep)
  }
  visit(id)
  if (node.kind === 'layout') parts.push(`a${assetsVersion}`)
  return parts.join('|')
}

/** The longer side of a thumbnail's point clouds drawn as images, in pixels. */
const THUMBNAIL_PIXELS = 400

/**
 * A thumbnail's scene: one drawing more points than the canvas draws as symbols has its point
 * clouds as images at about `THUMBNAIL_PIXELS` (audit 3, P2: a page of big graphs, many data
 * sets); any other as it is.
 */
function thumbnailScene(scene: Scene): Scene {
  if (scenePointCount(scene.root) <= RASTER_THRESHOLD) return scene
  return pointsAsImages(scene, THUMBNAIL_PIXELS / Math.max(scene.width, scene.height, 1), 1)
}

/**
 * A graph or page drawn small, as an SVG data URL: sampled points for large tables (an XY
 * graph's rows too, `thumbnailSource`), many points' clouds as images.
 */
export function renderThumbnail(
  project: Project,
  id: NodeId,
  fonts: FontRegistry,
  result: ResultOf,
  asset: (id: AssetId) => ImageAsset | undefined,
): string | null {
  const node = nodeById(project.nodes, id)
  let svg: string
  if (node?.kind === 'graph') {
    const src = thumbnailSource(project, node as GraphNode, result)
    const scene = layoutGraph({
      project: src.project,
      graph: src.graph,
      fonts,
      result: src.result,
      screen: SCREEN_SAMPLE,
    })
    svg = sceneToSvg(thumbnailScene(scene), { background: '#ffffff', portableFonts: true })
  } else if (node?.kind === 'layout') {
    const scene = layoutPage({
      project,
      layout: node as LayoutNode,
      fonts,
      ...pageSources(project, result, asset),
      screen: SCREEN_SAMPLE,
    })
    svg = sceneToSvg(thumbnailScene(scene), { background: '#ffffff', portableFonts: true })
  } else return null
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Runs a task when the browser is idle (WebKit has no requestIdleCallback: a short timeout). */
type Scheduler = (task: () => void) => void
const idleScheduler: Scheduler = (task) => {
  const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: object) => number }
  if (w.requestIdleCallback) w.requestIdleCallback(task, { timeout: 2000 })
  else setTimeout(task, 30)
}

interface Entry {
  version: string
  url: string | null
}

/**
 * The thumbnails cache: `get` answers at once with what it has (possibly an older drawing, or
 * nothing) and queues a redraw when the version changed; drawings are made one per idle slot,
 * the most recently asked for first. Subscribers hear of each new one.
 */
export class ThumbnailCache {
  private entries = new Map<NodeId, Entry>()
  private wanted = new Map<NodeId, string>()
  private scheduled = false
  private listeners = new Set<() => void>()
  /** Changes with every new drawing (for React subscriptions). */
  version = 0

  constructor(
    private readonly deps: {
      project: () => Project
      result: ResultOf
      assetsVersion: () => number
      render: (project: Project, id: NodeId) => string | null
      schedule?: Scheduler
    },
  ) {}

  /** The drawing of `id` now (null: none yet); a newer one is queued when it is out of date. */
  get(id: NodeId): string | null {
    const project = this.deps.project()
    const v = thumbnailVersion(project, id, this.deps.result, this.deps.assetsVersion())
    if (v === null) return null
    const e = this.entries.get(id)
    if (e?.version !== v) {
      // The latest asked for goes first (the rows shown now).
      this.wanted.delete(id)
      this.wanted.set(id, v)
      this.kick()
    }
    return e?.url ?? null
  }

  /** Whether the drawing of `id` is current. */
  isCurrent(id: NodeId): boolean {
    const v = thumbnailVersion(this.deps.project(), id, this.deps.result, this.deps.assetsVersion())
    return v !== null && this.entries.get(id)?.version === v
  }

  /** Forgets nodes no longer in the project. */
  prune(project: Project): void {
    for (const id of this.entries.keys()) if (!nodeById(project.nodes, id)) this.entries.delete(id)
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Draws the next wanted thumbnail (the latest asked for); exposed for tests. */
  step(): boolean {
    const last = [...this.wanted.keys()].at(-1)
    if (last === undefined) return false
    this.wanted.delete(last)
    const project = this.deps.project()
    const v = thumbnailVersion(project, last, this.deps.result, this.deps.assetsVersion())
    if (v === null) return this.wanted.size > 0
    let url: string | null = null
    try {
      url = this.deps.render(project, last)
    } catch (e) {
      if (e instanceof FontsPending) {
        // Drawn once the font it needs has loaded, never with another (audit 2 P5).
        void e.settled.then(() => {
          if (!this.wanted.has(last)) this.wanted.set(last, v)
          this.kick()
        })
        return this.wanted.size > 0
      }
      url = null
    }
    this.entries.set(last, { version: v, url })
    this.version++
    for (const fn of this.listeners) fn()
    return this.wanted.size > 0
  }

  private kick() {
    if (this.scheduled) return
    this.scheduled = true
    const schedule = this.deps.schedule ?? idleScheduler
    const run = () => {
      this.scheduled = false
      if (this.step()) this.kick()
    }
    schedule(run)
  }
}
