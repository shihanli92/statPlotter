import {
  encodeNumbers,
  isEncodedOnce,
  largeNumberColumns,
  type PackedTables,
  packProject,
  type ResultCacheEntry,
  writeProjectFile,
} from '@ps/io'
import type { AssetId, ImageAsset, NodeId, Project } from '@ps/model'
import { pageLeaving } from '../pageLeaving.ts'

export interface SerializeRequest {
  id: number
  /** The project, its large tables as packed JSON (their columns in `packed`). */
  project: Project
  results: Map<NodeId, ResultCacheEntry>
  view: unknown
  assets: Map<AssetId, ImageAsset>
  /** Large tables' columns, encoded here and transferred (roadmap 34e). */
  packed: PackedTables
}

/** The worker's messages: `ready` once when it has loaded, then one answer per request. */
export type SerializeReply =
  | { ready: true }
  | { id: number; bytes: Uint8Array }
  | { id: number; error: string }

type SerializeFn = (
  project: Project,
  results: Map<NodeId, ResultCacheEntry>,
  view: unknown,
  assets: Map<AssetId, ImageAsset>,
) => Uint8Array

/** The part of a Worker used here (tests pass a fake). */
export interface WorkerLike {
  onmessage: ((e: { data: SerializeReply }) => void) | null
  onerror: ((e: { message?: string; preventDefault?(): void }) => void) | null
  postMessage(msg: SerializeRequest, transfer?: Transferable[]): void
  terminate(): void
}

export interface Serializer {
  /**
   * Starts the worker now if it isn't started (at startup, when the page is idle), so its script
   * has loaded long before a copy is needed: a load cut short by the page going away is an error
   * in WebKit, and a copy sent to a loading worker comes back only after the load.
   */
  warm(): void
  /** The worker has loaded and answered: a copy sent to it now comes back promptly. */
  readonly ready: boolean
  /** The worker has failed (or there is none): copies are made on the main thread. */
  readonly failed: boolean
  /**
   * The project file's bytes, from the worker (started if need be), or on the main thread where
   * there is no worker or it failed to load. A request the worker can't finish because it failed
   * is made on the main thread instead.
   */
  serialize: (...args: Parameters<SerializeFn>) => Promise<Uint8Array>
}

/**
 * Whether the main thread is due to be let go: `budgetMs` have passed since it last was (a copy
 * of a small project is posted at once, in the call).
 */
function budget(budgetMs = 8): () => boolean {
  let since = performance.now()
  return () => {
    if (performance.now() - since < budgetMs) return false
    since = performance.now()
    return true
  }
}

const letGo = () => new Promise((r) => setTimeout(r, 0))

const startWorker = (): WorkerLike =>
  new Worker(new URL('./serialize.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike

/**
 * writeProjectFile in a worker (the same function Save calls, so the bytes are what Save would
 * write). Worker failures — none in this environment, a script that can't be loaded (a blocked
 * or aborted request, a content policy), a crash — are never thrown: the copy is made by
 * `fallback` on the main thread.
 */
export function createSerializer(
  opts: {
    createWorker?: (() => WorkerLike) | null
    fallback?: SerializeFn
    /** Whether the page is being left: no worker is started then (decision 786). */
    leaving?: () => boolean
  } = {},
): Serializer {
  const leaving = opts.leaving ?? pageLeaving
  const fallback: SerializeFn =
    opts.fallback ??
    ((project, results, view, assets) => writeProjectFile(project, { results, view, assets }))
  const create =
    opts.createWorker !== undefined
      ? opts.createWorker
      : typeof Worker === 'undefined'
        ? null
        : startWorker
  let state: 'idle' | 'loading' | 'ready' | 'failed' = create ? 'idle' : 'failed'
  let worker: WorkerLike | null = null
  type Pending = {
    args: Parameters<SerializeFn>
    resolve: (b: Uint8Array) => void
    reject: (e: unknown) => void
  }
  const pending = new Map<number, Pending>()
  let next = 0

  const onThisThread = (p: Pending) => {
    try {
      p.resolve(fallback(...p.args))
    } catch (e) {
      p.reject(e)
    }
  }
  const fail = () => {
    state = 'failed'
    const w = worker
    worker = null
    if (w) {
      w.onmessage = w.onerror = null
      try {
        w.terminate()
      } catch {}
    }
    const waiting = [...pending.values()]
    pending.clear()
    for (const p of waiting) onThisThread(p)
  }
  const start = () => {
    // A worker started as the page goes (a warm-up due just after an edit) is refused by WebKit
    // and reported as a page error: copies made meanwhile are made on this thread.
    if (state !== 'idle' || !create || leaving()) return
    state = 'loading'
    let w: WorkerLike
    try {
      w = create()
    } catch {
      // e.g. a content security policy refusing workers: the main thread it is.
      fail()
      return
    }
    worker = w
    w.onmessage = (e) => {
      const data = e.data
      if ('ready' in data) {
        if (state === 'loading') state = 'ready'
        return
      }
      const p = pending.get(data.id)
      if (!p) return
      pending.delete(data.id)
      if ('error' in data) p.reject(new Error(data.error))
      else p.resolve(data.bytes)
    }
    // The script didn't load or the worker died: not an uncaught error, the copy is made here.
    w.onerror = (e) => {
      e.preventDefault?.()
      fail()
    }
  }

  return {
    warm: start,
    get ready() {
      return state === 'ready'
    },
    get failed() {
      return state === 'failed'
    },
    serialize: (...args) =>
      new Promise<Uint8Array>((resolve, reject) => {
        start()
        const p: Pending = { args, resolve, reject }
        if (state === 'failed' || !worker) return onThisThread(p)
        const id = next++
        pending.set(id, p)
        const [project, results, view, assets] = args
        const send = (numbers?: ReadonlyMap<readonly unknown[], Uint8Array>) => {
          // The worker failed meanwhile: the copy was made here.
          if (!pending.has(id) || !worker) return
          try {
            // Large tables (roadmap 34e) go as their binary columns, encoded here in one loop
            // each and transferred, not structured-cloned value by value (seconds for a million
            // rows); the tables' own JSON names them. The images' bytes are copied (the store
            // keeps them). Columns kept encoded between copies (audit 3, P7: texts) are sent as
            // copies.
            const packed = packProject(project, numbers)
            const nodes = { ...project.nodes }
            const transfer: ArrayBuffer[] = []
            for (const [tid, p] of packed) {
              nodes[tid as NodeId] = p.json as never
              for (const [name, b] of p.columns) {
                const own = isEncodedOnce(b) ? b.slice() : b
                p.columns.set(name, own)
                transfer.push(own.buffer as ArrayBuffer)
              }
            }
            const sent = packed.size ? { ...project, nodes } : project
            worker.postMessage({ id, project: sent, results, view, assets, packed }, transfer)
          } catch {
            pending.delete(id)
            onThisThread(p)
          }
        }
        // Audit 3, P7: a large table's numbers are encoded a few columns at a time, the main
        // thread let go between them, so a copy holds it in no long task.
        const columns = largeNumberColumns(project)
        if (!columns.length) return send()
        void (async () => {
          const numbers = new Map<readonly unknown[], Uint8Array>()
          const due = budget()
          for (const a of columns) {
            if (!numbers.has(a)) numbers.set(a, encodeNumbers(a))
            if (due()) await letGo()
          }
          send(numbers)
        })()
      }),
  }
}
