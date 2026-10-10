import { registry } from '@ps/analyses'
import { DocumentStore } from '@ps/engine'
import {
  createGraphFor,
  type ExportWidth,
  layoutGraph,
  layoutGraphAtWidth,
  layoutPage,
  pointsAsImages,
  type Scene,
  type SizeMode,
  sceneAtWidth,
  scenePointCount,
  sceneToSvg,
  widthInPoints,
} from '@ps/graph'
import { nodeFontLoader } from '@ps/graph/node'
import {
  type AnalysisResult,
  createTable,
  type DataTable,
  type GraphNode,
  type LayoutNode,
  type NodeId,
  newLayoutItemId,
  newNodeId,
  type Project,
} from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { startedEngine } from '../../engine/test/helpers.ts'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import { SYNTHETIC_EXAMPLES } from '../src/examples/synthetic/index.ts'
import type { DrawTile } from '../src/graph/exportGraph.ts'
import { exportPdf, exportSvg } from '../src/graph/figureFiles.ts'
import { pageSources } from '../src/layout/pageScene.ts'
import type { FigureTarget } from '../src/worker/figureCore.ts'
import {
  createFigureExporter,
  ExportBusy,
  type FigureData,
  type FigureExporter,
  type FigureSource,
  type FigureWorkerLike,
  type RenderSettings,
} from '../src/worker/figureExport.ts'
import { COLUMN_ROWS } from '../src/worker/figureSync.ts'
import { type FigureRequest, figureWorker } from '../src/worker/figureWorker.ts'
import { builtExample } from './exampleBuilds.ts'

vi.mock('../../model/src/ids.ts', async (importOriginal) =>
  (await import('./countedIds.ts')).countedIds(await importOriginal(), { always: false }),
)

// Roadmap 42: figure exports made in the export worker are the bytes the main thread made before
// (its layouts and writers, composed as the views and dialogs did). The worker runs in-process:
// every message structured-cloned (buffers transferred) both ways, as the browser does.

/** A worker running `figureWorker` here; `log` records what the main thread sent. */
function inProcessWorker() {
  const log: FigureRequest[] = []
  const w: FigureWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(msg, transfer = []) {
      log.push(msg)
      const copy = structuredClone(msg, { transfer })
      setTimeout(() => handle(copy), 0)
    },
    terminate() {},
  }
  const handle = figureWorker({
    fonts: Promise.resolve(fonts),
    fontFile: nodeFontLoader,
    post(reply, transfer) {
      const copy = structuredClone(reply, { transfer })
      setTimeout(() => w.onmessage?.({ data: copy }), 0)
    },
  })
  return { w, log }
}

/** Tiles "drawn" as pixels made from their SVG's text (no browser here), the same both ways. */
const draw: DrawTile = async (svg, w, h) => {
  let hash = 2166136261
  for (let i = 0; i < svg.length; i++) hash = Math.imul(hash ^ svg.charCodeAt(i), 16777619)
  const px = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < px.length; i++) px[i] = ((hash >>> (i % 25)) ^ (i >> 7)) & 255
  return px
}

const DATE = Date.UTC(2026, 9, 7, 12, 30, 0)

/** The scenes and files as the main thread made them before roadmap 42. */
function mainThread(src: FigureSource, target: FigureTarget) {
  const graphCtx = () => {
    const graph = src.project.nodes[(target as { graph: NodeId }).graph] as GraphNode
    return { project: src.project, graph, fonts, ...(src.result ? { result: src.result } : {}) }
  }
  const natural: Scene =
    target.kind === 'graph'
      ? layoutGraph(graphCtx())
      : layoutPage({
          project: src.project,
          layout: target.layout,
          fonts,
          ...pageSources(src.project, src.result, src.asset),
        })
  const sized = (width: ExportWidth | undefined, mode: SizeMode) =>
    width
      ? sceneAtWidth(
          natural,
          widthInPoints(width, natural.width),
          target.kind === 'graph' && mode === 'keepText'
            ? (w) => layoutGraphAtWidth(graphCtx(), w)
            : undefined,
        )
      : natural
  return {
    natural,
    file(s: RenderSettings, title?: string): FigureData {
      const scene0 = sized(s.width, s.mode)
      const scene = s.pointsAsImage ? pointsAsImages(scene0, s.dpi / 72) : scene0
      return s.format === 'svg'
        ? exportSvg(scene, { transparent: s.transparent })
        : exportPdf(scene, fonts, {
            transparent: s.transparent,
            ...(title ? { title } : {}),
            date: new Date(DATE),
          })
    },
  }
}

const settings = (patch: Partial<RenderSettings>): RenderSettings => ({
  format: 'pdf',
  mode: 'keepText',
  dpi: 300,
  transparent: false,
  pointsAsImage: false,
  ...patch,
})

/** The variants checked: Export ▸ PDF, a journal width, scaled, transparent, points as image. */
const variants = (pages: boolean): RenderSettings[] => [
  settings({ format: 'pdf' }),
  settings({ format: 'svg', width: { unit: 'mm', value: 85 }, mode: pages ? 'scale' : 'keepText' }),
  settings({
    format: 'svg',
    width: { unit: '%', value: 50 },
    mode: 'scale',
    transparent: true,
    pointsAsImage: true,
    dpi: 150,
  }),
]

/** A file's bytes (an SVG file comes from the worker as its UTF-8 bytes). */
const bytesOf = (d: FigureData) => (typeof d === 'string' ? new TextEncoder().encode(d) : d)
const same = (a: FigureData, b: FigureData) =>
  Buffer.from(bytesOf(a)).equals(Buffer.from(bytesOf(b)))

/** Points above which only the copy's and print's SVGs and one variant are checked (time). */
const MANY_POINTS = 5000

/** Checks every variant, the copy's and the print's SVG of `target` both ways; returns how many. */
async function checkTarget(
  exporter: FigureExporter,
  src: FigureSource,
  name: string,
  target: FigureTarget,
) {
  const ref = mainThread(src, target)
  const all = variants(target.kind === 'page')
  let n = 0
  for (const s of scenePointCount(ref.natural.root) > MANY_POINTS ? all.slice(2) : all) {
    const got = await exporter.render(src, target, s, { title: name, date: DATE })
    expect(same(got, ref.file(s, name)), `${name}: ${s.format} ${JSON.stringify(s.width)}`).toBe(
      true,
    )
    n++
  }
  const copy = await exporter.svg(src, target, 'copy')
  expect(copy.svg === exportSvg(ref.natural), `${name}: copy`).toBe(true)
  expect([copy.width, copy.height]).toEqual([ref.natural.width, ref.natural.height])
  const print = await exporter.svg(src, target, 'print')
  expect(print.svg === sceneToSvg(ref.natural, { background: '#ffffff' }), `${name}: print`).toBe(
    true,
  )
  return n + 2
}

const targetsOf = (p: Project) =>
  p.order.flatMap((id): { name: string; target: FigureTarget }[] => {
    const n = p.nodes[id]
    if (n?.kind === 'graph') return [{ name: n.name, target: { kind: 'graph', graph: n.id } }]
    if (n?.kind === 'layout')
      return [{ name: n.name, target: { kind: 'page', layout: n as LayoutNode } }]
    return []
  })

/**
 * A table of `rows` rows built with exact arithmetic (no platform's last bits): nulls, a −0,
 * excluded cells and row titles, so every kind of per-row array goes as a column.
 */
function bigTable(kind: 'column' | 'xy', rows: number): DataTable {
  const t = createTable({ tableKind: kind, columns: 3, rows })
  const v = (i: number, k: number) =>
    i % 97 === k ? null : i === 5 ? -0 : (((i * 7919 + k * 104729) % 4096) - 1024) / 64
  for (const [k, d] of t.dataSets.entries()) {
    const sub = d.subcolumns[0]!
    sub.values = Array.from({ length: rows }, (_, i) => v(i, k))
    sub.excluded = Array.from({ length: rows }, (_, i) => i % 211 === k)
  }
  if (t.x) t.x.subcolumns[0]!.values = Array.from({ length: rows }, (_, i) => i / 8)
  t.rowTitles = Array.from({ length: rows }, (_, i) => (i % 5 ? `r${i % 13}` : null))
  return t
}

describe('figure exports in the export worker (roadmap 42)', () => {
  it('are byte for byte the main thread’s, for every synthetic example’s graphs and pages', {
    timeout: 600_000,
  }, async () => {
    const { w } = inProcessWorker()
    const exporter = createFigureExporter({ createWorker: () => w, leaving: () => false })
    let checked = 0
    for (const ex of SYNTHETIC_EXAMPLES) {
      const project = (await builtExample(ex))!
      const store = new DocumentStore(project)
      const engine = await startedEngine(store, registry)
      engine.stop()
      const src: FigureSource = {
        project: store.getState(),
        result: (id) => engine.latest(id),
        fonts,
      }
      for (const { name, target } of targetsOf(src.project))
        checked += await checkTarget(exporter, src, `${ex.id}: ${name}`, target)
    }
    // Nothing fell back to this thread on the way.
    expect(exporter.where).toBe('worker')
    expect(checked).toBeGreaterThan(300)
  })

  it('sends a large table’s columns once, and only those an edit changed', {
    timeout: 120_000,
  }, async () => {
    const { w, log } = inProcessWorker()
    const exporter = createFigureExporter({ createWorker: () => w, leaving: () => false })
    const rows = COLUMN_ROWS + 100
    const col = bigTable('column', rows)
    const xy = bigTable('xy', rows)
    const g1 = createGraphFor(col, 'Columns')
    const g2 = createGraphFor(xy, 'Scatter')
    const layout: LayoutNode = {
      kind: 'layout',
      id: newNodeId(),
      name: 'Figure',
      page: { width: 612, height: 792 },
      items: [
        { type: 'graph', id: newLayoutItemId(), graph: g1.id, x: 36, y: 36, scale: 0.5 },
        { type: 'graph', id: newLayoutItemId(), graph: g2.id, x: 300, y: 36, scale: 0.5 },
      ],
      panelLabels: { show: true, style: 'A', size: 14 },
    }
    let project = projectOf(col, xy, g1, g2, layout)
    const columns = () => log.filter((m) => m.type === 'column').length
    for (const { name, target } of targetsOf(project))
      await checkTarget(exporter, { project, fonts }, name, target)
    // Each table's values (3, and the X column), exclusions (3) and row titles, once.
    expect(columns()).toBe(7 + 8)
    // One cell edited: its column is a new array, the others the same.
    const values = [...xy.dataSets[1]!.subcolumns[0]!.values]
    values[10] = 99.5
    const edited: DataTable = {
      ...xy,
      dataSets: xy.dataSets.map((d, k) =>
        k === 1 ? { ...d, subcolumns: [{ ...d.subcolumns[0]!, values }] } : d,
      ),
    }
    project = { ...project, nodes: { ...project.nodes, [xy.id]: edited } }
    const before = columns()
    for (const { name, target } of targetsOf(project))
      await checkTarget(exporter, { project, fonts }, name, target)
    expect(columns() - before).toBe(1)
    expect(exporter.where).toBe('worker')
  })

  it('makes PNG and TIFF tiles in the worker: the same images', { timeout: 120_000 }, async () => {
    const { w } = inProcessWorker()
    const worker = createFigureExporter({ createWorker: () => w, leaving: () => false, draw })
    const here = createFigureExporter({ createWorker: null, draw, fontFile: nodeFontLoader })
    const project = (await builtExample(SYNTHETIC_EXAMPLES[0]!))!
    const src: FigureSource = { project, fonts }
    const [graph, page] = [
      targetsOf(project).find((t) => t.target.kind === 'graph')!,
      targetsOf(project).find((t) => t.target.kind === 'page')!,
    ]
    for (const { target } of [graph, page])
      for (const s of [
        settings({ format: 'png', dpi: 72 }),
        settings({ format: 'tiff', dpi: 96, transparent: true, width: { unit: 'mm', value: 60 } }),
      ]) {
        const seen: number[] = []
        const a = await worker.render(src, target, s, { onProgress: (f) => seen.push(f) })
        const b = await here.render(src, target, s)
        expect(same(a, b)).toBe(true)
        expect(seen.at(-1)).toBe(1)
      }
    expect(worker.where).toBe('worker')
    expect(here.where).toBe('here')
  })
})

describe('the export worker’s life', () => {
  const graphProject = () => {
    const t = createTable({ tableKind: 'column', columns: 2, rows: 3 })
    for (const [i, d] of t.dataSets.entries()) d.subcolumns[0]!.values = [1 + i, 2, 4]
    const g = createGraphFor(t, 'G')
    return { project: projectOf(t, g), target: { kind: 'graph', graph: g.id } as const }
  }
  const svg = settings({ format: 'svg' })

  it('starts with the first export, not before, and never while the page is being left', async () => {
    const { project, target } = graphProject()
    const create = vi.fn(() => inProcessWorker().w)
    let leaving = true
    const exporter = createFigureExporter({ createWorker: create, leaving: () => leaving })
    expect(create).not.toHaveBeenCalled()
    expect(exporter.where).toBe('idle')
    const ref = mainThread({ project, fonts }, target).file(svg)
    // Leaving: made on this thread, no worker started.
    expect(same(await exporter.render({ project, fonts }, target, svg), ref)).toBe(true)
    expect(create).not.toHaveBeenCalled()
    leaving = false
    expect(same(await exporter.render({ project, fonts }, target, svg), ref)).toBe(true)
    expect(create).toHaveBeenCalledOnce()
    expect(exporter.where).toBe('worker')
  })

  it('ends the worker when unused for a while (its copy of the document with it)', async () => {
    const { project, target } = graphProject()
    const ended = vi.fn()
    const create = vi.fn(() => {
      const { w } = inProcessWorker()
      w.terminate = ended
      return w
    })
    const exporter = createFigureExporter({
      createWorker: create,
      leaving: () => false,
      idleMs: 30,
    })
    const ref = mainThread({ project, fonts }, target).file(svg)
    expect(same(await exporter.render({ project, fonts }, target, svg), ref)).toBe(true)
    expect(exporter.where).toBe('worker')
    await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce())
    expect(exporter.where).toBe('idle')
    // The next export starts another, sent the document again.
    expect(same(await exporter.render({ project, fonts }, target, svg), ref)).toBe(true)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('ends the worker at once when another project replaces the document (audit 3, P5)', async () => {
    const { project, target } = graphProject()
    const ended = vi.fn()
    const create = vi.fn(() => {
      const { w } = inProcessWorker()
      w.terminate = ended
      return w
    })
    const exporter = createFigureExporter({ createWorker: create, leaving: () => false })
    const ref = mainThread({ project, fonts }, target).file(svg)
    // Not while an export runs.
    let release!: () => void
    const running = exporter.exclusive('Exporting', () => new Promise<void>((r) => (release = r)))
    expect(same(await exporter.render({ project, fonts }, target, svg), ref)).toBe(true)
    exporter.release()
    expect(ended).not.toHaveBeenCalled()
    release()
    await running
    exporter.release()
    expect(ended).toHaveBeenCalledOnce()
    expect(exporter.where).toBe('idle')
    expect(same(await exporter.render({ project, fonts }, target, svg), ref)).toBe(true)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('falls back to this thread when the worker can’t be made or dies', async () => {
    const { project, target } = graphProject()
    const ref = mainThread({ project, fonts }, target).file(svg)
    const refused = createFigureExporter({
      createWorker: () => {
        throw new Error('blocked by the content security policy')
      },
      leaving: () => false,
    })
    expect(same(await refused.render({ project, fonts }, target, svg), ref)).toBe(true)
    expect(refused.where).toBe('here')

    // A worker whose script never loads: the error event, then this thread.
    const dead: FigureWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage() {
        setTimeout(() => dead.onerror?.({ message: 'failed to load', preventDefault() {} }), 0)
      },
      terminate() {},
    }
    const dies = createFigureExporter({ createWorker: () => dead, leaving: () => false })
    expect(same(await dies.render({ project, fonts }, target, svg), ref)).toBe(true)
    expect(dies.where).toBe('here')
  })

  it('runs one export at a time: another is refused while it runs', async () => {
    const exporter = createFigureExporter({ createWorker: null })
    let finish!: () => void
    const first = exporter.exclusive('Exporting “A”', (progress) => {
      progress(0.5)
      return new Promise<void>((r) => {
        finish = r
      })
    })
    expect(exporter.activity).toEqual({ label: 'Exporting “A”', fraction: 0.5, status: true })
    await expect(exporter.exclusive('Copying “B”', async () => 1)).rejects.toBeInstanceOf(
      ExportBusy,
    )
    await expect(exporter.exclusive('Copying “B”', async () => 1)).rejects.toThrow(
      'Exporting “A” is still under way: try again when it has finished.',
    )
    finish()
    await first
    expect(exporter.activity).toBeNull()
    expect(await exporter.exclusive('Copying “B”', async () => 1)).toBe(1)
  })

  it('reports an export’s own failure (not a worker failure) without falling back', async () => {
    const { project } = graphProject()
    const { w } = inProcessWorker()
    const exporter = createFigureExporter({ createWorker: () => w, leaving: () => false })
    const gone = { kind: 'graph', graph: 'missing' as NodeId } as const
    await expect(exporter.render({ project, fonts }, gone, svg)).rejects.toThrow(
      'The graph is no longer in the project.',
    )
    expect(exporter.where).toBe('worker')
  })

  it('sends results and drops what left the document', async () => {
    const { project, target } = graphProject()
    const { w, log } = inProcessWorker()
    const exporter = createFigureExporter({ createWorker: () => w, leaving: () => false })
    const result = (() => undefined) as (id: NodeId) => AnalysisResult | undefined
    await exporter.render({ project, result, fonts }, target, svg)
    await exporter.render({ project, result, fonts }, target, svg)
    const syncs = log.filter((m) => m.type === 'sync')
    // The second sync sends nothing (nothing changed).
    expect(syncs[1]).toMatchObject({ project: null, nodes: [], results: [] })
  })
})
