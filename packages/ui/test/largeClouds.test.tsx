// @vitest-environment happy-dom
import type { PointsPrim, SceneNode } from '@ps/graph'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  cloudPixels,
  LARGE_CLOUD_PIXELS,
  NodeEl,
  RasterScale,
  RasterView,
} from '../src/graph/SceneSvg.tsx'

// Audit 4 (P5): zoomed in on a large point cloud, the canvas draws the cloud whole at a fixed size
// and the part in view (and a quarter of a view around it) at the zoom's resolution — not one image of all
// of it at the zoom's (1,000,000 points: a 2 s task each time the zoom rested). A pan within the
// part drawn draws nothing new; beyond it, the new part once the view rests.

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
  delete (SVGElement.prototype as unknown as { getScreenCTM?: unknown }).getScreenCTM
})

/** A grid of n × n points over a square of `side` points. */
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

/** The screen shows the scene's user space 1:1 (no transform), through `view`. */
function screen(view: { left: number; top: number; width: number; height: number }) {
  // happy-dom has no getScreenCTM: an identity, for this test.
  const proto = SVGElement.prototype as unknown as { getScreenCTM?: () => DOMMatrix }
  proto.getScreenCTM = () => new DOMMatrix()
  const el = document.createElement('div')
  vi.spyOn(el, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        left: view.left,
        top: view.top,
        right: view.left + view.width,
        bottom: view.top + view.height,
        width: view.width,
        height: view.height,
      }) as DOMRect,
  )
  return el
}

function draw(node: SceneNode, scale: number, viewport: Element | null, key: number) {
  if (!root) {
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
  }
  act(() =>
    root!.render(
      <svg role="img" aria-label="Graph">
        <RasterScale.Provider value={scale}>
          <RasterView.Provider value={viewport ? { el: () => viewport, key } : null}>
            <NodeEl node={node} />
          </RasterView.Provider>
        </RasterScale.Provider>
      </svg>,
    ),
  )
  return [...host!.querySelectorAll('image')].map((i) => ({
    part: i.getAttribute('data-part') === 'in view',
    x: Number(i.getAttribute('x')),
    y: Number(i.getAttribute('y')),
    w: Number(i.getAttribute('width')),
    h: Number(i.getAttribute('height')),
    href: i.getAttribute('href'),
  }))
}

function urls() {
  let made = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:cloud-${++made}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return () => made
}

describe('a large point cloud zoomed in (audit 4 P5)', () => {
  // 300 × 300 points over 600 × 600 pt; at 8 px per pt its whole image would be 23 Mpx (each
  // test its own cloud: images are kept per cloud).
  const nodeOf = (p: PointsPrim): SceneNode => ({ id: 'series/0/points', prim: p })

  it('draws the whole cloud small and the part in view sharp', () => {
    const made = urls()
    const p = cloud(300, 600)
    const node = nodeOf(p)
    expect(cloudPixels(p, 8)).toBeGreaterThan(LARGE_CLOUD_PIXELS)
    const view = screen({ left: 100, top: 100, width: 100, height: 80 })
    const imgs = draw(node, 8, view, 0)
    expect(imgs).toHaveLength(2)
    const [whole, part] = imgs as [(typeof imgs)[0], (typeof imgs)[0]]
    expect(whole.part).toBe(false)
    expect(part.part).toBe(true)
    // The whole image covers the cloud; the part, the view and a quarter of a view around it.
    expect(whole.w).toBeGreaterThan(595)
    expect(part.x).toBeCloseTo(75, 0)
    expect(part.y).toBeCloseTo(80, 0)
    expect(part.w).toBeCloseTo(150, 0)
    expect(part.h).toBeCloseTo(120, 0)
    expect(made()).toBe(2)
    // A pan within the part drawn, rested: nothing new.
    const near = screen({ left: 120, top: 110, width: 100, height: 80 })
    expect(draw(node, 8, near, 1).map((i) => i.href)).toEqual(imgs.map((i) => i.href))
    expect(made()).toBe(2)
    // Beyond it: the new part; the whole image kept.
    const far = screen({ left: 400, top: 400, width: 100, height: 80 })
    const after = draw(node, 8, far, 2)
    expect(after[0]!.href).toBe(whole.href)
    expect(after[1]!.x).toBeCloseTo(375, 0)
    expect(made()).toBe(3)
  })

  it('zoomed further: the whole image is kept, only the part in view is drawn anew', () => {
    const made = urls()
    const node = nodeOf(cloud(300, 600))
    const view = screen({ left: 100, top: 100, width: 100, height: 80 })
    const a = draw(node, 8, view, 0)
    const b = draw(node, 16, view, 1)
    expect(b[0]!.href).toBe(a[0]!.href)
    expect(b[1]!.href).not.toBe(a[1]!.href)
    expect(made()).toBe(3)
  })

  it('a cloud whose image is small, or no view known: one image of it all, as before', () => {
    urls()
    const node = nodeOf(cloud(300, 600))
    const view = screen({ left: 0, top: 0, width: 100, height: 80 })
    expect(draw(node, 2, view, 0)).toHaveLength(1)
    act(() => root?.unmount())
    root = null
    expect(draw(node, 8, null, 0)).toHaveLength(1)
  })
})
