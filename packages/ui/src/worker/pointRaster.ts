import type { Box, PointsPrim, pointsImagePrim } from '@ps/graph'
import { pageLeaving } from '../pageLeaving.ts'

// Audit 4 (P5): point clouds' images drawn in a worker (`pointRaster.worker.ts`) when the canvas
// can wait for them: a zoom that rests keeps the image shown till the new one is ready, instead of
// a main-thread task of seconds for a million points. Without workers (tests, a script that can't
// load, a crash) nothing is drawn here: `available()` says so and the caller draws on its thread.

export type CloudImage = ReturnType<typeof pointsImagePrim>

/** What a cloud's image needs of it (its typed arrays and paints; no functions). */
export type CloudData = Pick<PointsPrim, 'n' | 'x' | 'y' | 'size' | 'paint' | 'paints'>

export interface PointRasterRequest {
  id: number
  /** The cloud's number; its data with it when the worker doesn't keep it. */
  key: number
  cloud?: CloudData
  scale: number
  clip?: Box
  /** How many clouds the worker keeps (the latest sent). */
  kept: number
}

export type PointRasterReply = { id: number; img: CloudImage } | { id: number; error: string }

/** Clouds the worker keeps (a zoom of one of them sends only its number). */
export const CLOUDS_KEPT = 3

interface WorkerLike {
  postMessage(msg: PointRasterRequest, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<PointRasterReply>) => void) | null
  onerror: ((e: unknown) => void) | null
  terminate(): void
}

let worker: WorkerLike | null | undefined
let nextId = 0
let nextKey = 0
const keys = new WeakMap<PointsPrim, number>()
/** The clouds sent, latest first (as the worker keeps them). */
let sent: number[] = []
const waiting = new Map<
  number,
  { resolve: (img: CloudImage) => void; reject: (e: unknown) => void }
>()

function start(): WorkerLike | null {
  if (worker !== undefined) return worker
  if (typeof Worker === 'undefined' || pageLeaving()) return null
  try {
    const w = new Worker(new URL('./pointRaster.worker.ts', import.meta.url), {
      type: 'module',
    }) as unknown as WorkerLike
    w.onmessage = (e) => {
      const reply = e.data
      const p = waiting.get(reply.id)
      waiting.delete(reply.id)
      if (!p) return
      if ('error' in reply) p.reject(new Error(reply.error))
      else p.resolve(reply.img)
    }
    w.onerror = () => {
      // Failed (a script that can't load, a crash): every image is drawn on the page from now on.
      for (const p of waiting.values()) p.reject(new Error('The worker failed.'))
      waiting.clear()
      w.terminate()
      worker = null
    }
    worker = w
  } catch {
    worker = null
  }
  return worker
}

/** Whether images can be drawn in the worker. */
export const rasterWorkerAvailable = (): boolean => start() !== null

/** What a request answers when a later one for the same cloud has taken its place. */
export const SUPERSEDED = 'superseded'

interface Job {
  p: PointsPrim
  scale: number
  clip: Box | undefined
  resolve: (img: CloudImage | typeof SUPERSEDED) => void
  reject: (e: unknown) => void
}
/** Each cloud's image (whole, or a part) one at a time: the one being drawn, and the next. */
const busy = new Set<string>()
const queued = new Map<string, Job>()

/**
 * The cloud's image at `scale` pixels per point (`clip`: only that part), drawn in the worker;
 * rejects when it can't be (the caller then draws it itself). While one of the cloud's images is
 * being drawn, a later request waits, and takes the place of any waiting already (that one
 * answers SUPERSEDED): zooms in quick succession draw two images, not one per zoom.
 */
export function rasterInWorker(
  p: PointsPrim,
  scale: number,
  clip?: Box,
): Promise<CloudImage | typeof SUPERSEDED> {
  if (!start()) return Promise.reject(new Error('No worker.'))
  let key = keys.get(p)
  if (key === undefined) {
    key = ++nextKey
    keys.set(p, key)
  }
  const slot = `${key}:${clip ? 'part' : 'whole'}`
  return new Promise((resolve, reject) => {
    const job: Job = { p, scale, clip, resolve, reject }
    if (!busy.has(slot)) return run(slot, job)
    queued.get(slot)?.resolve(SUPERSEDED)
    queued.set(slot, job)
  })
}

function run(slot: string, job: Job) {
  busy.add(slot)
  post(job)
    .then(job.resolve, job.reject)
    .finally(() => {
      busy.delete(slot)
      const next = queued.get(slot)
      queued.delete(slot)
      if (next) run(slot, next)
    })
}

function post({ p, scale, clip }: Job): Promise<CloudImage> {
  const w = start()
  if (!w) return Promise.reject(new Error('No worker.'))
  const key = keys.get(p)!
  const send = !sent.includes(key)
  if (send) sent = [key, ...sent].slice(0, CLOUDS_KEPT)
  const id = ++nextId
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    w.postMessage({
      id,
      key,
      ...(send
        ? { cloud: { n: p.n, x: p.x, y: p.y, size: p.size, paint: p.paint, paints: p.paints } }
        : {}),
      scale,
      ...(clip ? { clip } : {}),
      kept: CLOUDS_KEPT,
    })
  })
}
