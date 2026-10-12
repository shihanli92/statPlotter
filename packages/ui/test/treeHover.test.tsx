// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  boxInRoot,
  FontRegistry,
  layoutGraph,
  markInfo,
  presetGraph,
  type Scene,
  type SceneNode,
  treeOfLayer,
  withTrees,
} from '@ps/graph'
import {
  createProject,
  createTable,
  type GraphNode,
  type Layer,
  type LayerOf,
  type NodeId,
  type Project,
} from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cardPlace, HOVER_DELAY_MS, HoverCard, useHoverMark } from '../src/graph/HoverCard.tsx'
import { PX_PER_PT, SceneSvg } from '../src/graph/SceneSvg.tsx'

// Roadmap 49c (left for 49d): hover cards on a heat map's trees, on the canvas — the pointer on a
// branch shows its merge's card; on a leg down to a leaf, the leaf's (its row and, cut, its
// cluster); on a strip's band, its leaf's. The card waits for the pointer to rest, as any mark's.

// The bundled fonts, read by path (happy-dom's URLs aren't Node's).
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../graph/assets/fonts')
const fonts = await FontRegistry.load(
  async (file) => new Uint8Array(await readFile(join(FONT_DIR, file))),
)

/** Seven genes × five samples, clustered both ways, the rows' tree cut in three with a strip. */
function setup(): { project: Project; graph: GraphNode } {
  const rows = [
    [1, 9, 2, 8, 4],
    [2, 7, 1, 9, 3],
    [0, 8, 3, 7, 5],
    [5, 5, 6, 4, 2],
    [9, 1, 8, 2, 6],
    [3, 6, 2, 5, 9],
    [8, 2, 9, 1, 7],
  ]
  const table = createTable({ tableKind: 'grouped', columns: 5, rows: 7 })
  table.rowTitles = rows.map((_, i) => `Gene ${i + 1}`)
  table.dataSets.forEach((d, j) => {
    d.subcolumns[0]!.values = rows.map((r) => r[j]!)
  })
  const base = { ...presetGraph(table, 'heatmap'), id: 'g1' as NodeId }
  const cluster = { rows: true, columns: true }
  const clustered = base.layers.map((l) =>
    l.geom === 'tile' ? ({ ...l, style: { ...l.style, cluster } } as Layer) : l,
  )
  const layers = withTrees(clustered).map((l) =>
    l.geom === 'dendrogram' && l.stat.of === 'rows'
      ? ({ ...l, stat: { ...l.stat, cut: { k: 3 } }, style: { ...l.style, strip: true } } as Layer)
      : l,
  )
  const graph = { ...base, layers }
  const project = createProject()
  project.nodes[table.id] = table
  project.nodes[graph.id] = graph
  project.order.push(table.id, graph.id)
  return { project, graph }
}

const flatten = (n: SceneNode, out: SceneNode[] = []): SceneNode[] => {
  out.push(n)
  for (const c of n.children ?? []) flatten(c, out)
  return out
}

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
  vi.useRealTimers()
})

const { project, graph } = setup()
const scene: Scene = layoutGraph({ project, graph, fonts })
const rowTree = graph.layers.find((l) => l.geom === 'dendrogram' && l.stat.of === 'rows')
const hc = treeOfLayer(project, graph, rowTree as LayerOf<'dendrogram'>)!
const k = PX_PER_PT

/** The canvas as the graph view has it: the scene, the hovered mark's card. */
function Canvas({ g }: { g: GraphNode }) {
  const hover = useHoverMark()
  const info = hover.node ? markInfo(project, g, hover.node) : null
  const at = hover.node && info ? cardPlace(scene.root, scene.width, hover.node, k) : null
  return (
    <div>
      <SceneSvg
        scene={scene}
        zoom={1}
        selected={[]}
        onSelect={() => {}}
        onHoverNode={hover.hover}
      />
      {info && at && <HoverCard info={info} place={at} />}
    </div>
  )
}

function mount() {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() => root!.render(<Canvas g={graph} />))
  return host
}

/** The pointer resting over a mark's element at a scene point (happy-dom's svg sits at 0, 0). */
function rest(el: Element, x: number, y: number, type = 'pointerover') {
  act(() => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x * k, clientY: y * k }))
  })
  act(() => {
    vi.advanceTimersByTime(HOVER_DELAY_MS + 10)
  })
}

/** A card's heading and lines as text. */
const cardText = (h: HTMLElement) =>
  [...h.querySelectorAll('[data-testid="hover-card"] dt, [data-testid="hover-card"] dd')].map(
    (e) => e.textContent,
  )

/** A polyline node's segment middle, in the scene's coordinates. */
function middle(n: SceneNode, seg: number): [number, number] {
  const b = boxInRoot(scene.root, n)!
  const pts = (n.prim as { points: [number, number][] }).points
  const x0 = Math.min(...pts.map((p) => p[0]))
  const y0 = Math.min(...pts.map((p) => p[1]))
  const [a, c] = [pts[seg]!, pts[seg + 1]!]
  return [b.x - x0 + (a[0] + c[0]) / 2, b.y - y0 + (a[1] + c[1]) / 2]
}

describe('hover cards on a tree', () => {
  it('a branch’s bar shows its merge; its leg down to a leaf, the leaf; a strip band, its leaf', () => {
    vi.useFakeTimers()
    const h = mount()
    const merge = flatten(scene.root).find((n) => n.id === 'dendrogram/rows/0')!
    const el = h.querySelector('[data-id="dendrogram/rows/0"]')!
    expect(el).not.toBeNull()
    // The bar across: the merge (two leaves, in one cluster).
    rest(el, ...middle(merge, 1))
    expect(h.querySelector('.hover-card-title')?.textContent).toBe('Row dendrogram')
    const lines = cardText(h)
    expect(lines.slice(0, 4)).toEqual([
      'Height',
      String(Number(hc.height[0]!.toPrecision(4))),
      'Leaves',
      '2',
    ])
    expect(lines[4]).toBe('Cluster')
    // Along the branch to its leg down to its first leaf: that leaf's row.
    const leaf = -hc.merge[0]![0] - 1
    rest(el, ...middle(merge, 0), 'pointermove')
    expect(cardText(h).slice(0, 2)).toEqual(['Row', `Gene ${leaf + 1}`])
    // A strip's band: its leaf (the tree's first, at slot 0).
    const band = h.querySelector('[data-id="dendrogram/rows/strip/0"]')!
    const box = boxInRoot(
      scene.root,
      flatten(scene.root).find((n) => n.id === band.getAttribute('data-id'))!,
    )!
    rest(band, box.x + box.w / 2, box.y + box.h / 2)
    expect(cardText(h).slice(0, 2)).toEqual(['Row', `Gene ${hc.order[0]! + 1}`])
  })
})
