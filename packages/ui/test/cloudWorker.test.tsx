// @vitest-environment happy-dom
import { type PointsPrim, pointsImagePrim, type SceneNode } from '@ps/graph'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { NodeEl, RasterScale } from '../src/graph/SceneSvg.tsx'

// Audit 4 (P5): when the zoom rests on a point cloud, its image at the new zoom is drawn in a
// worker; the image shown stays until the new one is ready (a million points took a 2 s task on
// the main thread each time). (The worker's module is replaced here: happy-dom has no workers.)

const asked: {
  p: PointsPrim
  scale: number
  done: (img: ReturnType<typeof pointsImagePrim>) => void
}[] = []
vi.mock('../src/worker/pointRaster.ts', () => ({
  SUPERSEDED: 'superseded',
  rasterWorkerAvailable: () => true,
  rasterInWorker: (p: PointsPrim, scale: number) =>
    new Promise((resolve) => asked.push({ p, scale, done: resolve })),
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
  vi.restoreAllMocks()
})

function cloud(n: number, side: number): PointsPrim {
  const N = n * n
  const x = new Float64Array(N)
  const y = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    x[i] = ((i % n) + 0.5) * (side / n)
    y[i] = (Math.floor(i / n) + 0.5) * (side / n)
  }
  return {
    type: 'points',
    n: N,
    x,
    y,
    size: new Float64Array(N).fill(3),
    paint: new Uint32Array(N),
    paints: [{ shape: 'circle', stroke: null, fill: { color: '#336699', opacity: 1 } }],
    rows: new Int32Array(N),
    point: (i) => ({ id: `p${i}`, key: String(i) }),
  }
}

function draw(node: SceneNode, scale: number) {
  if (!root) {
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
  }
  act(() =>
    root!.render(
      <svg role="img" aria-label="Graph">
        <RasterScale.Provider value={scale}>
          <NodeEl node={node} />
        </RasterScale.Provider>
      </svg>,
    ),
  )
  return [...host!.querySelectorAll('image')].map((i) => ({
    href: i.getAttribute('href'),
    w: Number(i.getAttribute('width')),
  }))
}

describe('a point cloud zoomed (audit 4 P5)', () => {
  it('keeps its image while the worker draws the new zoom’s, then shows that', async () => {
    let made = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:cloud-${++made}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const p = cloud(40, 200)
    const node: SceneNode = { id: 'series/0/points', prim: p }
    // First shown: drawn here (nothing to show till then).
    const first = draw(node, 2)
    expect(first).toHaveLength(1)
    expect(asked).toHaveLength(0)
    // Zoomed: the same image, the worker asked for the new zoom's.
    const zoomed = draw(node, 4)
    expect(zoomed.map((i) => i.href)).toEqual(first.map((i) => i.href))
    expect(asked.map((a) => [a.p, a.scale])).toEqual([[p, 4]])
    // Drawn: shown.
    await act(async () => asked[0]!.done(pointsImagePrim(p, 4, { level: 1 })))
    const after = draw(node, 4)
    expect(after).toHaveLength(1)
    expect(after[0]!.href).not.toBe(first[0]!.href)
    // At that zoom again: nothing more asked.
    draw(node, 4)
    expect(asked).toHaveLength(1)
  })
})
