import { type PointsPrim, pointsImagePrim } from '@ps/graph'
import { errorMessage } from '../util.ts'
import type { CloudData, PointRasterReply, PointRasterRequest } from './pointRaster.ts'

// Minimal worker scope typing (the DOM and WebWorker libs can't share one program).
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<PointRasterRequest>) => void) | null
  postMessage: (msg: PointRasterReply, transfer?: Transferable[]) => void
}

// Audit 4 (P5): a point cloud's image at a zoom drawn off the main thread (a million points took
// two seconds there each time a zoom rested). The clouds sent last are kept, in the order the page
// keeps them (`CLOUDS_KEPT`), so a zoom sends only the cloud's number.

const clouds: { key: number; cloud: PointsPrim }[] = []

const prim = (c: CloudData): PointsPrim => ({
  type: 'points',
  ...c,
  rows: new Int32Array(0),
  point: () => ({ id: '', key: '' }),
})

scope.onmessage = (e) => {
  const { id, key, cloud, scale, clip, kept } = e.data
  try {
    if (cloud) {
      clouds.unshift({ key, cloud: prim(cloud) })
      clouds.length = Math.min(clouds.length, kept)
    }
    const p = clouds.find((c) => c.key === key)?.cloud
    if (!p) throw new Error('The cloud was not sent.')
    const img = pointsImagePrim(p, scale, { ...(clip ? { clip } : {}), level: 1 })
    scope.postMessage({ id, img }, img ? [img.asset.bytes.buffer as ArrayBuffer] : [])
  } catch (err) {
    scope.postMessage({ id, error: errorMessage(err) })
  }
}
