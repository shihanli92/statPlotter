import { type FontBytesLoader, withFonts } from '@ps/graph'
import { type DrawTile, jpegOf, rasterize } from '../graph/exportGraph.ts'
import { pageLeaving } from '../pageLeaving.ts'
import {
  createFigureCore,
  type FigureContext,
  type FigureCore,
  type FigureMeasure,
  type FigureSettings,
  type FigureSize,
  type FigureSvg,
  type FigureTarget,
  type RasterStart,
} from './figureCore.ts'
import { SyncSender } from './figureSync.ts'
import type { FigureOp, FigureReply, FigureRequest } from './figureWorker.ts'

// Figure exports, copies and prints (roadmap 42): graphs and pages laid out with every point and
// written in the export worker, so a large export leaves the window responsive; on this thread
// (the same code) where a worker can't be had. The worker starts with the first export, never
// while the page is being left (decision 786). Images are drawn here (the browser draws SVG only
// through the DOM), from tiles' SVGs the worker makes, and encoded there. One export at a time:
// another asked for meanwhile is refused (`ExportBusy`), and `activity` says what is running.

/** What an export reads: the document, results, images and the fonts (this thread's). */
export type FigureSource = FigureContext

/** A file's settings (`quality` for JPEG). */
export interface RenderSettings extends FigureSettings {
  quality?: number
}

/** The file's contents: SVG text or bytes. */
export type FigureData = string | Uint8Array

/** An export asked for while another runs. */
export class ExportBusy extends Error {
  constructor(running: string) {
    super(`${running} is still under way: try again when it has finished.`)
    this.name = 'ExportBusy'
  }
}

/** The worker failed (didn't load, crashed): the request is made on this thread instead. */
class WorkerFailed extends Error {}

/** What is running: shown as the export status (unless its own dialog shows it). */
export interface ExportActivity {
  /** "Exporting “Graph 1”". */
  label: string
  /** How far it has got (0–1), when known. */
  fraction: number | null
  /** Shown in the window's export status (false: its dialog shows its progress). */
  status: boolean
}

export interface FigureExporter {
  readonly activity: ExportActivity | null
  /**
   * How many runs of `exclusive` (files, batches, copies, prints) have finished without failing
   * (roadmap 47: the getting-started checklist's "Export a graph" ticks off on a change).
   */
  readonly finished: number
  subscribe(fn: () => void): () => void
  /** The figures' sizes and contents at an export size (the Export dialog's summary). */
  measure(
    source: FigureSource,
    targets: readonly FigureTarget[],
    size: FigureSize,
  ): Promise<FigureMeasure[]>
  /** A file. `date`: the PDF's creation date (default now). */
  render(
    source: FigureSource,
    target: FigureTarget,
    s: RenderSettings,
    opts?: { title?: string; date?: number; onProgress?: (done: number) => void },
  ): Promise<FigureData>
  /** The SVG of a copy or a print, at the figure's own size. */
  svg(source: FigureSource, target: FigureTarget, use: 'copy' | 'print'): Promise<FigureSvg>
  /**
   * Runs one export (a file, a batch, a copy, a print) as the only one: refused with `ExportBusy`
   * while another runs. `fn` is called at once (inside the user's click, for the clipboard and
   * the save dialog), with a progress callback.
   */
  exclusive<T>(
    label: string,
    fn: (progress: (fraction: number | null) => void) => Promise<T>,
    opts?: { status?: boolean },
  ): Promise<T>
  /** Where requests go now (tests): the worker, or this thread. */
  readonly where: 'worker' | 'here' | 'idle'
  /**
   * Ends the worker now, its copy of the document with it, unless an export runs (then it ends
   * when unused, as always): another project replaced the document (audit 3, P5). The next export
   * starts another.
   */
  release(): void
}

/** The part of a Worker used here (tests pass a fake). */
export interface FigureWorkerLike {
  onmessage: ((e: { data: FigureReply }) => void) | null
  onerror: ((e: { message?: string; preventDefault?(): void }) => void) | null
  postMessage(msg: FigureRequest, transfer?: Transferable[]): void
  terminate(): void
}

/** The requests, made here or in the worker. */
interface Backend {
  measure(src: FigureSource, t: readonly FigureTarget[], s: FigureSize): Promise<FigureMeasure[]>
  file(
    src: FigureSource,
    t: FigureTarget,
    s: FigureSettings,
    o: { title?: string; date?: number },
  ): Promise<FigureData>
  raster(src: FigureSource, t: FigureTarget, s: FigureSettings): Promise<RasterStart>
  tile(job: number, i: number): Promise<string>
  put(job: number, i: number, rgba: Uint8ClampedArray): Promise<number | null>
  finish(job: number): Promise<Uint8Array>
  abort(job: number): void
  svg(src: FigureSource, t: FigureTarget, use: 'copy' | 'print'): Promise<FigureSvg>
}

/** On this thread: a core per request over the live document (images keep theirs per job). */
function hereBackend(fontFile?: FontBytesLoader): Backend {
  const jobs = new Map<number, { core: FigureCore; job: number }>()
  let next = 1
  const core = (src: FigureSource) =>
    createFigureCore({ context: () => src, ...(fontFile ? { fontFile } : {}) })
  const job = (id: number) => {
    const j = jobs.get(id)
    if (!j) throw new Error('The image export was stopped.')
    return j
  }
  return {
    measure: (src, t, s) => withFonts(() => core(src).measure(t, s)),
    file: (src, t, s, o) => withFonts(() => core(src).file(t, s, o)),
    async raster(src, t, s) {
      const c = core(src)
      const start = await withFonts(() => c.raster(t, s))
      if (start.job === null) return start
      const id = next++
      jobs.set(id, { core: c, job: start.job })
      return { ...start, job: id }
    },
    tile: async (id, i) => {
      const j = job(id)
      return j.core.tile(j.job, i)
    },
    put: async (id, i, rgba) => {
      const j = job(id)
      return j.core.put(j.job, i, rgba)
    },
    finish: async (id) => {
      const j = job(id)
      jobs.delete(id)
      return j.core.finish(j.job)
    },
    abort: (id) => void jobs.delete(id),
    svg: (src, t, use) => withFonts(() => core(src).svg(t, use)),
  }
}

/** Gives the event loop a turn when this task has run long (between columns of a sync). */
function pauser(budgetMs = 8): () => Promise<void> {
  let since = performance.now()
  return async () => {
    if (performance.now() - since < budgetMs) return
    await new Promise((r) => setTimeout(r, 0))
    since = performance.now()
  }
}

/** In the worker: its copy of the document brought up to date before each request. */
function workerBackend(w: FigureWorkerLike, onFail: () => void): Backend & { dispose(): void } {
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  const sender = new SyncSender()
  let next = 1
  let failed = false
  let lock: Promise<void> = Promise.resolve()

  const fail = () => {
    if (failed) return
    failed = true
    w.onmessage = w.onerror = null
    try {
      w.terminate()
    } catch {}
    const waiting = [...pending.values()]
    pending.clear()
    for (const p of waiting) p.reject(new WorkerFailed())
    onFail()
  }
  w.onmessage = (e) => {
    const data = e.data
    if ('ready' in data) return
    const p = pending.get(data.id)
    if (!p) return
    pending.delete(data.id)
    if ('error' in data) p.reject(new Error(data.error))
    else p.resolve(data.value)
  }
  // The script didn't load or the worker died: not an uncaught error, the request is made here.
  w.onerror = (e) => {
    e.preventDefault?.()
    fail()
  }
  const post = (msg: FigureRequest, transfer: Transferable[] = []) => {
    if (failed) throw new WorkerFailed()
    try {
      w.postMessage(msg, transfer)
    } catch {
      // Something in the document can't be cloned: this worker's copy can't be trusted now.
      fail()
      throw new WorkerFailed()
    }
  }
  const call = <T>(op: FigureOp, args: unknown[], transfer: Transferable[] = []): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (failed) return reject(new WorkerFailed())
      const id = next++
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      try {
        post({ type: 'call', id, op, args }, transfer)
      } catch (e) {
        pending.delete(id)
        reject(e)
      }
    })
  /** Syncs the document, then asks: one sync at a time, each followed by its request. */
  const synced = <T>(src: FigureSource, op: FigureOp, args: unknown[]): Promise<T> => {
    const before = lock
    let release!: () => void
    lock = new Promise((r) => {
      release = r
    })
    return (async () => {
      await before
      let answer: Promise<T>
      try {
        await sender.sync(src, post, pauser())
        answer = call<T>(op, args)
      } finally {
        release()
      }
      return answer
    })()
  }
  return {
    measure: (src, t, s) => synced(src, 'measure', [t, s]),
    file: (src, t, s, o) => synced(src, 'file', [t, s, o]),
    raster: (src, t, s) => synced(src, 'raster', [t, s]),
    tile: (job, i) => call('tile', [job, i]),
    put: (job, i, rgba) => call('put', [job, i, rgba], [rgba.buffer as ArrayBuffer]),
    finish: (job) => call('finish', [job]),
    abort: (job) => void call('abort', [job]).catch(() => {}),
    svg: (src, t, use) => synced(src, 'svg', [t, use]),
    /** Ends the worker (idle): its copy of the document goes with it. */
    dispose() {
      failed = true
      w.onmessage = w.onerror = null
      try {
        w.terminate()
      } catch {}
    },
  }
}

/**
 * The worker is ended after this long without a request (roadmap 42): it holds a copy of the
 * document (hundreds of MB for a table of a million rows) and the last scenes laid out. The next
 * export starts another (its script and fonts from the browser's cache) and sends the document
 * again.
 */
export const FIGURE_WORKER_IDLE_MS = 120_000

const startWorker = (): FigureWorkerLike =>
  new Worker(new URL('./figureExport.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as FigureWorkerLike

/**
 * The app's figure exporter. Worker failures (none in this environment, a script that can't be
 * loaded, a crash) are never thrown: the request is made on this thread instead, and so are all
 * later ones.
 */
export function createFigureExporter(
  opts: {
    createWorker?: (() => FigureWorkerLike) | null
    /** Whether the page is being left: no worker is started then (decision 786). */
    leaving?: () => boolean
    /** Draws an image's tile (tests draw without a browser). */
    draw?: DrawTile
    /** Loads a font file for the images' inlined fonts on this thread (tests). */
    fontFile?: FontBytesLoader
    /** The worker is ended after this long unused (default `FIGURE_WORKER_IDLE_MS`). */
    idleMs?: number
  } = {},
): FigureExporter {
  const leaving = opts.leaving ?? pageLeaving
  const create =
    opts.createWorker !== undefined
      ? opts.createWorker
      : typeof Worker === 'undefined'
        ? null
        : startWorker
  const here = hereBackend(opts.fontFile)
  let worker: (Backend & { dispose(): void }) | null = null
  let failed = !create
  /** Requests under way (a raster job's steps between them included). */
  let inFlight = 0
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const idleMs = opts.idleMs ?? FIGURE_WORKER_IDLE_MS
  /** Ends the worker once nothing has used it for `idleMs`. */
  const releaseWhenIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (inFlight > 0 || activity) {
        releaseWhenIdle()
        return
      }
      worker?.dispose()
      worker = null
    }, idleMs)
  }
  let activity: ExportActivity | null = null
  let runs = 0
  let finished = 0
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const fn of [...listeners]) fn()
  }

  const backend = (): Backend => {
    if (failed || !create) return here
    if (!worker) {
      // Started with the first export; a worker started as the page goes is refused by WebKit
      // and reported as a page error: requests made meanwhile are made here.
      if (leaving()) return here
      try {
        worker = workerBackend(create(), () => {
          failed = true
          worker = null
        })
      } catch {
        // e.g. a content security policy refusing workers: this thread it is.
        failed = true
        return here
      }
    }
    return worker
  }
  const run = async <T>(fn: (b: Backend) => Promise<T>): Promise<T> => {
    const b = backend()
    inFlight++
    try {
      return await fn(b)
    } catch (e) {
      if (e instanceof WorkerFailed) return fn(here)
      throw e
    } finally {
      inFlight--
      if (worker) releaseWhenIdle()
    }
  }
  const render = async (
    b: Backend,
    src: FigureSource,
    t: FigureTarget,
    s: RenderSettings,
    o: { title?: string; date?: number; onProgress?: (done: number) => void },
  ): Promise<FigureData> => {
    if (s.format === 'svg' || s.format === 'pdf')
      return b.file(src, t, s, {
        ...(o.title ? { title: o.title } : {}),
        date: o.date ?? Date.now(),
      })
    const start = await b.raster(src, t, s)
    if (start.job === null) return jpegOf(start, s.dpi, s.quality ?? 0.9)
    const job = start.job
    try {
      return await rasterize(
        {
          tiles: start.tiles,
          svg: (i) => b.tile(job, i),
          put: (i, rgba) => b.put(job, i, rgba),
          finish: () => b.finish(job),
        },
        o.onProgress,
        opts.draw,
      )
    } catch (e) {
      b.abort(job)
      throw e
    }
  }

  return {
    get activity() {
      return activity
    },
    get finished() {
      return finished
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    measure: (src, targets, size) => run((b) => b.measure(src, targets, size)),
    render: (src, t, s, o = {}) => run((b) => render(b, src, t, s, o)),
    svg: (src, t, use) => run((b) => b.svg(src, t, use)),
    exclusive<T>(
      label: string,
      fn: (progress: (fraction: number | null) => void) => Promise<T>,
      o: { status?: boolean } = {},
    ): Promise<T> {
      if (activity) return Promise.reject(new ExportBusy(activity.label))
      const id = ++runs
      activity = { label, fraction: null, status: o.status ?? true }
      notify()
      let p: Promise<T>
      try {
        p = fn((fraction) => {
          if (runs !== id || !activity) return
          activity = { ...activity, fraction }
          notify()
        })
      } catch (e) {
        p = Promise.reject(e)
      }
      p = p.then((v) => {
        finished++
        return v
      })
      return p.finally(() => {
        if (runs !== id) return
        activity = null
        notify()
      })
    },
    get where() {
      return failed || !create ? 'here' : worker ? 'worker' : 'idle'
    },
    release() {
      if (inFlight > 0 || activity || !worker) return
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = null
      worker.dispose()
      worker = null
    },
  }
}

/** The window's exporter (its worker started by the first export). */
export const figureExports: FigureExporter = createFigureExporter()
