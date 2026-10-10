import {
  type ExportWidth,
  type FontBytesLoader,
  type FontRegistry,
  hasPointClouds,
  layoutGraph,
  layoutGraphAtWidth,
  layoutPage,
  pointsAsImages,
  type Scene,
  type SizeMode,
  sceneAtWidth,
  scenePointCount,
  smallestText,
  widthInPoints,
} from '@ps/graph'
import type {
  AnalysisResult,
  AssetId,
  GraphNode,
  ImageAsset,
  LayoutNode,
  NodeId,
  Project,
} from '@ps/model'
import {
  canBeTransparent,
  exportPdf,
  exportSvg,
  fontCss,
  imageSize,
  imageTooLarge,
  jpegSvg,
  printSvg,
  type RasterJob,
  type RasterTile,
  rasterJob,
} from '../graph/figureFiles.ts'
import { pageSources } from '../layout/pageScene.ts'

// What a figure export does with a document (roadmap 42): lay a graph or a layout page out with
// every point, at the export's width, and write its SVG or PDF, or the SVGs a PNG, TIFF or JPEG
// is drawn from. The export worker runs this on its copy of the document; the main thread runs
// the same code where there is no worker, so a file is the same bytes either way.

/** What is exported: a graph of the document, or a layout page (the document's, or made up). */
export type FigureTarget =
  | { kind: 'graph'; graph: NodeId }
  /** A page: the document's own layout node, or one made for a selection of its items. */
  | { kind: 'page'; layout: LayoutNode }

/** A figure to export: its name (the file's, the PDF's title) and what it draws. */
export interface FigureItem {
  name: string
  target: FigureTarget
}

/** What a layout reads besides the target: the document, results, images, fonts. */
export interface FigureContext {
  project: Project
  result?: (id: NodeId) => AnalysisResult | undefined
  asset?: (id: AssetId) => ImageAsset | undefined
  fonts: FontRegistry
}

/**
 * The width an export is made at and how it is reached (pages are always scaled); no width: its
 * own size (File › Export ▸, copies).
 */
export interface FigureSize {
  width?: ExportWidth
  mode: SizeMode
}

/** A figure's size and contents at an export width, for the Export dialog. */
export interface FigureMeasure {
  /** Its natural width (points), for converting the width box's units. */
  natural: number
  width: number
  height: number
  /** The smallest font size drawn (points); null when there is no text. */
  minText: number | null
  /** It draws point clouds (offered as an image). */
  clouds: boolean
  /** Points it draws. */
  points: number
}

/** The Export dialog's settings, as a file is made from them. */
export interface FigureSettings extends FigureSize {
  format: 'svg' | 'pdf' | 'png' | 'tiff' | 'jpeg'
  dpi: number
  transparent: boolean
  pointsAsImage: boolean
}

/** A PNG, TIFF or JPEG to draw: its tiles (PNG, TIFF) or its one SVG (JPEG). */
export type RasterStart =
  | { job: number; w: number; h: number; tiles: RasterTile[] }
  | { job: null; w: number; h: number; svg: string }

/** The SVG of a copy or a print, with the figure's size (points). */
export interface FigureSvg {
  svg: string
  width: number
  height: number
}

/** Scenes kept between requests (the dialog's measure, then its export): a few, the latest. */
const SCENES_KEPT = 6

export interface FigureCore {
  /** Forgets the scenes laid out (the document changed). */
  clear(): void
  measure(targets: readonly FigureTarget[], size: FigureSize): FigureMeasure[]
  /** An SVG or PDF file. `date`: the PDF's creation date (ms since 1970). */
  file(
    target: FigureTarget,
    s: FigureSettings,
    opts?: { title?: string; date?: number },
  ): string | Uint8Array
  /** A PNG, TIFF or JPEG begun: its tiles to draw (`tile`, `put`, `finish`) or its one SVG. */
  raster(target: FigureTarget, s: FigureSettings): Promise<RasterStart>
  tile(job: number, i: number): string
  put(job: number, i: number, rgba: Uint8Array | Uint8ClampedArray): number | null
  finish(job: number): Uint8Array
  abort(job: number): void
  /** The SVG of a copy (portable fonts, white) or a print (the app's fonts), at its own size. */
  svg(target: FigureTarget, use: 'copy' | 'print'): FigureSvg
  /** The scene at its own size (tests). */
  scene(target: FigureTarget): Scene
}

/**
 * The export's layouts and writers over `context()` (read on each request). Scenes are kept
 * (a few) until `clear`. Requests can throw `FontsPending`; callers retry (`withFonts`).
 */
export function createFigureCore(opts: {
  context: () => FigureContext
  /** Loads a font file, for inlining the fonts into the images' SVGs. */
  fontFile?: FontBytesLoader
}): FigureCore {
  const scenes = new Map<string, Scene>()
  const jobs = new Map<number, RasterJob>()
  let nextJob = 1

  const kept = (key: string, make: () => Scene): Scene => {
    const hit = scenes.get(key)
    if (hit) {
      scenes.delete(key)
      scenes.set(key, hit)
      return hit
    }
    const s = make()
    scenes.set(key, s)
    while (scenes.size > SCENES_KEPT) scenes.delete(scenes.keys().next().value as string)
    return s
  }
  const keyOf = (t: FigureTarget) =>
    t.kind === 'graph' ? `g:${t.graph}` : `p:${JSON.stringify(t.layout)}`

  const graphContext = (id: NodeId) => {
    const ctx = opts.context()
    const graph = ctx.project.nodes[id]
    if (graph?.kind !== 'graph') throw new Error('The graph is no longer in the project.')
    return {
      project: ctx.project,
      graph: graph as GraphNode,
      fonts: ctx.fonts,
      ...(ctx.result ? { result: ctx.result } : {}),
    }
  }
  /** Every point (no screen sample): what exports, copies and prints draw. */
  const natural = (t: FigureTarget): Scene =>
    kept(keyOf(t), () => {
      if (t.kind === 'graph') return layoutGraph(graphContext(t.graph))
      const ctx = opts.context()
      return layoutPage({
        project: ctx.project,
        layout: t.layout,
        fonts: ctx.fonts,
        ...pageSources(ctx.project, ctx.result, ctx.asset),
      })
    })
  /** At the export's width: a graph laid out again keeping its text size, or scaled. */
  const sized = (t: FigureTarget, size: FigureSize): Scene => {
    const scene = natural(t)
    if (!size.width) return scene
    const width = widthInPoints(size.width, scene.width)
    return kept(`${keyOf(t)}|${width}|${size.mode}`, () =>
      sceneAtWidth(
        scene,
        width,
        t.kind === 'graph' && size.mode === 'keepText'
          ? (w) => layoutGraphAtWidth(graphContext(t.graph), w)
          : undefined,
      ),
    )
  }
  /** Points as an image (roadmap 34e): the clouds drawn at the export's resolution. */
  const drawn = (t: FigureTarget, s: FigureSettings) => {
    const scene = sized(t, s)
    return s.pointsAsImage ? pointsAsImages(scene, s.dpi / 72) : scene
  }
  const job = (id: number) => {
    const j = jobs.get(id)
    if (!j) throw new Error('The image export was stopped.')
    return j
  }

  return {
    clear: () => scenes.clear(),
    measure: (targets, size) =>
      targets.map((t) => {
        const scene = sized(t, size)
        return {
          natural: natural(t).width,
          width: scene.width,
          height: scene.height,
          minText: smallestText(scene),
          clouds: hasPointClouds(scene.root),
          points: scenePointCount(scene.root),
        }
      }),
    file(t, s, o = {}) {
      const scene = drawn(t, s)
      const transparent = s.transparent && canBeTransparent(s.format)
      if (s.format === 'svg') return exportSvg(scene, { transparent })
      if (s.format === 'pdf')
        return exportPdf(scene, opts.context().fonts, {
          transparent,
          ...(o.title ? { title: o.title } : {}),
          ...(o.date !== undefined ? { date: new Date(o.date) } : {}),
        })
      throw new Error(`${s.format} is an image: draw it with raster()`)
    },
    async raster(t, s) {
      const scene = drawn(t, s)
      const { w, h } = imageSize(scene, s.dpi)
      const format = s.format === 'jpeg' ? 'jpeg' : s.format === 'tiff' ? 'tiff' : 'png'
      const tooLarge = imageTooLarge(format, w, h)
      if (tooLarge) throw new Error(tooLarge)
      const css = await fontCss(scene, ...(opts.fontFile ? [opts.fontFile] : []))
      if (format === 'jpeg') return { job: null, ...jpegSvg(scene, s.dpi, css) }
      const transparent = s.transparent && canBeTransparent(s.format)
      const j = rasterJob(scene, format, { dpi: s.dpi, transparent, css })
      const id = nextJob++
      jobs.set(id, j)
      return { job: id, w: j.w, h: j.h, tiles: j.tiles }
    },
    tile: (id, i) => job(id).svg(i),
    put: (id, i, rgba) => job(id).put(i, rgba),
    finish(id) {
      const bytes = job(id).finish()
      jobs.delete(id)
      return bytes
    },
    abort: (id) => void jobs.delete(id),
    svg(t, use) {
      const scene = natural(t)
      return {
        svg: use === 'copy' ? exportSvg(scene) : printSvg(scene),
        width: scene.width,
        height: scene.height,
      }
    },
    scene: natural,
  }
}
