// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CloudBuilder,
  FontRegistry,
  layoutGraph,
  movePoints,
  type PointsPrim,
  presetGraph,
  type SceneNode,
} from '@ps/graph'
import { createProject, type DataTable, type GraphNode, type Layer, type NodeId } from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { syntheticTable } from '../../model/test/synthetic.ts'
import { cloudUrls } from '../src/graph/assetUrls.ts'
import { NodeEl } from '../src/graph/SceneSvg.tsx'

// Audit 3, P3 and P4: a point cloud on the canvas is an image of its points, shown from an object
// URL. A re-layout that leaves the points as they were or moves them alike (a title moved, each
// step of a drag) keeps the image and its URL; images of changed points are new, and a URL is
// revoked a little after no element shows it, so dragging or editing a big UMAP no longer keeps
// every image made.

// The bundled fonts, read by path (happy-dom's URLs aren't Node's).
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../graph/assets/fonts')
const fonts = await FontRegistry.load(
  async (file) => new Uint8Array(await readFile(join(FONT_DIR, file))),
)

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

/** Draws `node` (again, in the same element: the canvas redrawn) and its images' URLs. */
function draw(node: SceneNode): string[] {
  if (!root) {
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
  }
  act(() =>
    root!.render(
      <svg role="img" aria-label="Graph">
        <NodeEl node={node} />
      </svg>,
    ),
  )
  return [...host!.querySelectorAll('image')].map((i) => i.getAttribute('href')!)
}

/** Object URLs made and revoked. */
function blobs() {
  let made = 0
  const revoked: string[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:cloud-${++made}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => {
    revoked.push(u)
  })
  return { made: () => made, revoked }
}

const key = (t: DataTable, title: string) => t.dataSets.find((d) => d.title === title)!.id

const cloudOf = (n: SceneNode): SceneNode | null =>
  n.prim?.type === 'points' ? n : ((n.children ?? []).map(cloudOf).find(Boolean) ?? null)

describe('a point cloud on the canvas', () => {
  it('keeps its image and URL when laid out again with the same points', () => {
    const urls = blobs()
    const t = syntheticTable({ rows: 3000, genes: 2, pcs: 2 })
    const g0 = presetGraph(t, 'bubble')
    const graph = (title: string): GraphNode =>
      ({
        ...g0,
        id: 'g1' as NodeId,
        layers: g0.layers.map((l) =>
          l.aes
            ? ({
                ...l,
                aes: { x: key(t, 'UMAP_1'), y: key(t, 'UMAP_2'), color: key(t, 'cluster') },
                style: { ...l.style, render: 'image' },
              } as Layer)
            : l,
        ),
        title: { ...g0.title, content: [{ text: title }] },
      }) as GraphNode
    const lay = (title: string) => {
      const g = graph(title)
      const project = createProject()
      project.nodes[t.id] = t
      project.nodes[g.id] = g
      project.order.push(t.id, g.id)
      return cloudOf(layoutGraph({ project, graph: g, fonts }).root)!
    }
    const a = lay('UMAP')
    const b = lay('UMAP of cells')
    expect(b.prim).not.toBe(a.prim)
    const [first] = draw(a)
    expect(first).toBe('blob:cloud-1')
    expect(draw(b)).toEqual([first])
    expect(urls.made()).toBe(1)
    // The plot moved (a title above it dragged): the image, moved with it.
    const x = () => Number(host!.querySelector('image')!.getAttribute('x'))
    const x0 = x()
    const moved = { ...b, prim: movePoints(b.prim as PointsPrim, (x, y) => [x + 10, y]) }
    expect(draw(moved)).toEqual([first])
    expect(x()).toBeCloseTo(x0 + 10, 9)
    // Points that changed (an axis' range): a new image.
    const changed = { ...b, prim: movePoints(b.prim as PointsPrim, (x, y) => [x * 1.01, y]) }
    expect(draw(changed)).toEqual(['blob:cloud-2'])
  })

  it('lets an image’s URL go a little after it is no longer shown, never while it is', () => {
    // (The test before's URLs may still be in their grace.)
    const before = cloudUrls.size
    vi.useFakeTimers()
    try {
      const urls = blobs()
      const b = new CloudBuilder('p')
      const paint = b.paintOf('circle', null, { color: '#000000', opacity: 1 })
      for (let i = 0; i < 50; i++) b.add(i, i, 4, paint, i)
      const cloud = b.build()
      const changed = (k: number) => movePoints(cloud, (x, y) => [x * (1 + k / 100), y])
      // A graph of 60 clouds (a column each): every one kept while shown.
      const many = {
        id: 'g',
        children: Array.from({ length: 60 }, (_, k) => ({ id: `c${k}`, prim: changed(k) })),
      } as SceneNode
      const all = draw(many)
      expect(new Set(all).size).toBe(60)
      vi.advanceTimersByTime(60_000)
      expect(urls.revoked).toEqual([])
      // Each edit draws another image in their place: the ones before go after a while.
      const shown: string[] = []
      for (let k = 100; k < 110; k++)
        shown.push(...draw({ id: 'c', prim: changed(k) } as SceneNode))
      expect(urls.revoked).toEqual([])
      vi.advanceTimersByTime(10_000)
      expect(urls.revoked.sort()).toEqual([...all, ...shown.slice(0, -1)].sort())
      expect(cloudUrls.size).toBe(before + 1)
    } finally {
      vi.useRealTimers()
    }
  })
})
