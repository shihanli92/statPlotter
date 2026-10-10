import {
  cloudHit,
  cloudPointNode,
  layoutGraph,
  markInfo,
  presetGraph,
  type SceneNode,
} from '@ps/graph'
import { type DataTable, type GraphNode, gridColumns, type Layer, type NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import { syntheticTable } from '../../model/test/synthetic.ts'
import { growthRatio } from '../../stats/test/timing.ts'
import { selectedPoint } from '../src/graph/HoverCard.tsx'
import { cloudImage, cloudPoint } from '../src/graph/SceneSvg.tsx'
import { defaultSplitVariable, textVariables } from '../src/graph/split.ts'
import { findMatches } from '../src/table/find.ts'
import { moveRowsOrder, sortOrder } from '../src/table/reorder.ts'

// The app with large tables (roadmap 34e): finding and sorting a million rows' worth, and a
// UMAP's point cloud on the canvas — its image, hovering and selecting a point, its card.

const key = (t: DataTable, title: string) => t.dataSets.find((d) => d.title === title)!.id

function umap(t: DataTable, points: object = {}): GraphNode {
  const g = presetGraph(t, 'bubble')
  return {
    ...g,
    id: 'g1' as NodeId,
    layers: g.layers.map((l) =>
      l.aes
        ? ({
            ...l,
            aes: { x: key(t, 'UMAP_1'), y: key(t, 'UMAP_2'), color: key(t, 'cluster') },
            style: { ...l.style, ...points },
          } as Layer)
        : l,
    ),
  }
}

/** The scene's point cloud node. */
function cloudOf(root: SceneNode): SceneNode | null {
  if (root.prim?.type === 'points') return root
  for (const c of root.children ?? []) {
    const hit = cloudOf(c)
    if (hit) return hit
  }
  return null
}

describe('find and sort, a million rows’ worth', () => {
  it('finds words in text variables without reading number columns, in linear time', () => {
    const tables = new Map<number, DataTable>()
    const table = (n: number) => {
      let t = tables.get(n)
      if (!t) {
        t = syntheticTable({ rows: n, genes: 10, pcs: 4 })
        tables.set(n, t)
      }
      return t
    }
    const t = table(2000)
    const cols = gridColumns(t)
    const found = findMatches(t, cols, 'c1', { matchCase: false, wholeCell: true })
    const cluster = cols.findIndex((c) => c.kind === 'data' && c.ds.title === 'cluster')
    expect(found.length).toBe(t.dataSets[cluster]!.text!.filter((v) => v === 'C1').length)
    // Numbers are still found by their text.
    const n = findMatches(t, cols, '0.5', { matchCase: false, wholeCell: false })
    expect(n.length).toBeGreaterThan(0)
    // Roadmap 41: the tables and their columns are made before timing (the first timed call of
    // each size used to build its table, which a loaded machine could leave in the fastest of
    // two runs: a ratio of 8.5), and each size keeps its fastest of five runs. The search is one
    // pass over rows × text columns, so linear: about 4; quadratic would be 16. Audit 2 (P12):
    // 25,000 and 100,000 rows, so each call takes milliseconds (5,000 rows took a fraction of
    // one, and a loaded machine's ratios ranged 3.97 to 6.46).
    const sizes = [25_000, 100_000].map((rows) => ({
      rows,
      t: table(rows),
      cols: gridColumns(table(rows)),
    }))
    const at = new Map(sizes.map((x) => [x.rows, x]))
    expect(
      growthRatio(
        (rows) => {
          const { t: tr, cols: cr } = at.get(rows)!
          findMatches(tr, cr, 'naive', { matchCase: false, wholeCell: false })
        },
        25_000,
        4,
        5,
      ),
    ).toBeLessThan(8)
  })

  it('sorts by a text variable as before (case-blind, numbers within text in order), quickly', () => {
    const t = syntheticTable({ rows: 50, genes: 1, pcs: 1 })
    const text = t.dataSets.find((d) => d.title === 'cell_type')!
    text.text = text.text!.map((v, r) => (r % 5 === 0 ? null : r % 2 ? v!.toUpperCase() : v))
    const col = gridColumns(t).find((c) => c.kind === 'data' && c.ds.id === text.id)!
    const order = sortOrder(t, [{ col, descending: false }])
    const shown = order.map((r) => text.text![r])
    const filled = shown.filter((v) => v !== null) as string[]
    // Blanks last; the rest in the collator's order, ties in table order.
    expect(shown.slice(filled.length).every((v) => v === null)).toBe(true)
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    for (let i = 1; i < filled.length; i++)
      expect(collator.compare(filled[i - 1]!, filled[i]!)).toBeLessThanOrEqual(0)
    const tables = new Map<number, DataTable>()
    const ratio = growthRatio(
      (rows) => {
        let u = tables.get(rows)
        if (!u) {
          u = syntheticTable({ rows, genes: 1, pcs: 1 })
          tables.set(rows, u)
        }
        const c = gridColumns(u).find((g) => g.kind === 'data' && g.ds.title === 'cell')!
        sortOrder(u, [{ col: c, descending: false }])
      },
      5000,
      4,
      2,
    )
    // n log n.
    expect(ratio).toBeLessThan(10)
  })

  it('moves a block of a million rows without spreading it into arguments', () => {
    const order = moveRowsOrder(1_000_000, 0, 999_998, 1)
    expect(order[0]).toBe(999_999)
    expect(order[1]).toBe(0)
  })
})

describe('a UMAP of many cells on the canvas', () => {
  const t = syntheticTable({ rows: 25_000, genes: 2, pcs: 2 })
  const graph = umap(t)
  const project = projectOf(t, graph)
  const scene = layoutGraph({ project, graph, fonts })
  const node = cloudOf(scene.root)!

  it('draws its points as one cloud, an image made once per zoom', () => {
    expect(node).not.toBeNull()
    expect(node.target?.[0]).toBe('layers')
    if (node.prim?.type !== 'points') throw new Error('no cloud')
    expect(node.prim.n).toBe(25_000)
    const a = cloudImage(node.prim, 2)
    expect(cloudImage(node.prim, 2)).toBe(a)
    expect(a?.asset.mime).toBe('image/png')
  })

  it('a hovered point is its row: its card, and selected, its halo and pinned card', () => {
    if (node.prim?.type !== 'points') throw new Error('no cloud')
    const i = 1234
    const at = cloudHit(node.prim, node.prim.x[i]!, node.prim.y[i]!, 0)
    expect(at).toBeGreaterThanOrEqual(0)
    const point = cloudPointNode(node, at)
    const row = node.prim.rows[at]!
    expect(point.point).toBe(`r${row}`)
    const info = markInfo(project, graph, point)!
    expect(info.goTo).toMatchObject({ table: t.id, row })
    const selected = ['pointOverrides', point.target![3]!, point.point!]
    expect(selectedPoint(scene.root, selected)?.id).toBe(point.id)
    expect(cloudPoint(node, node.target, [selected])?.point).toBe(point.point)
  })
})

describe('text variables of many levels in the app', () => {
  it('are no split variable (a graph per cell id), and never the default one', () => {
    const t = syntheticTable({ rows: 1500, genes: 1, pcs: 1 })
    const vars = textVariables(t)
    expect(vars.map((d) => d.title)).toEqual(['sample', 'cluster', 'cell_type'])
    expect(defaultSplitVariable(umap(t), vars)).toBe(vars[0]!.id)
  })
})
