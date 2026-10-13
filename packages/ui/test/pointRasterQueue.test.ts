import type { PointsPrim } from '@ps/graph'
import { afterAll, describe, expect, it } from 'vitest'
import type { PointRasterReply, PointRasterRequest } from '../src/worker/pointRaster.ts'

// Audit 4 (P5): point clouds' images drawn in a worker — a cloud's data sent once, its requests
// one at a time, a waiting request taken over by a later one (zooms in quick succession draw the
// first and the last zoom's images, not one per zoom).

const posted: PointRasterRequest[] = []
let reply: ((r: PointRasterReply) => void) | null = null
class FakeWorker {
  onmessage: ((e: { data: PointRasterReply }) => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    reply = (r) => this.onmessage?.({ data: r })
  }
  postMessage(m: PointRasterRequest) {
    posted.push(m)
  }
  terminate() {}
}
const saved = (globalThis as { Worker?: unknown }).Worker
;(globalThis as { Worker?: unknown }).Worker = FakeWorker
afterAll(() => {
  ;(globalThis as { Worker?: unknown }).Worker = saved
})
const { rasterInWorker, SUPERSEDED } = await import('../src/worker/pointRaster.ts')

const cloud = (): PointsPrim => ({
  type: 'points',
  n: 1,
  x: new Float64Array([1]),
  y: new Float64Array([1]),
  size: new Float64Array([3]),
  paint: new Uint32Array(1),
  paints: [{ shape: 'circle', stroke: null, fill: { color: '#000000', opacity: 1 } }],
  rows: new Int32Array(1),
  point: () => ({ id: 'p', key: '0' }),
})
const img = (w: number) =>
  ({ type: 'image', x: 0, y: 0, w, h: 1, asset: { bytes: new Uint8Array(1) } }) as never
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('point cloud images in a worker (audit 4 P5)', () => {
  it('one at a time per cloud; a waiting request taken over by a later one', async () => {
    const p = cloud()
    const a = rasterInWorker(p, 2)
    const b = rasterInWorker(p, 3)
    const c = rasterInWorker(p, 4)
    expect(posted.map((m) => m.scale)).toEqual([2])
    expect(posted[0]!.cloud?.n).toBe(1)
    expect(await b).toBe(SUPERSEDED)
    reply!({ id: posted[0]!.id, img: img(2) })
    expect(((await a) as { w: number }).w).toBe(2)
    await tick()
    // The last zoom's, without the cloud's data again.
    expect(posted.map((m) => m.scale)).toEqual([2, 4])
    expect(posted[1]!.cloud).toBeUndefined()
    reply!({ id: posted[1]!.id, img: img(4) })
    expect(((await c) as { w: number }).w).toBe(4)
  })

  it('a failure rejects (the page then draws the image itself)', async () => {
    const r = rasterInWorker(cloud(), 2)
    const last = posted.at(-1)!
    expect(last.cloud).toBeDefined()
    reply!({ id: last.id, error: 'no' })
    await expect(r).rejects.toThrow('no')
  })
})
