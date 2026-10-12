import { layoutGraph } from '@ps/graph'
import type { GraphNode, LayerOf } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { clusteredMap, genesTable, treeAlone } from '../../graph/test/dendrogramCases.ts'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import { dragOutcome } from '../src/graph/canvasDrag.ts'
import {
  draggedDepth,
  layerAlone,
  pageTreeHandle,
  treeHandle,
  treeSide,
} from '../src/graph/treeDrag.ts'

// Roadmap 49c: a heat map's tree resized by dragging its outer edge (its handle), one edit of its
// layer's `depth`; a dendrogram alone has none (the plot's handles size it).

const table = genesTable()
const sceneOf = (graph: GraphNode) =>
  layoutGraph({ project: projectOf(table, graph), graph, fonts })
const tree = (g: GraphNode, id: string) =>
  g.layers.find((l) => l.id === id) as LayerOf<'dendrogram'>
const OPTS = { threshold: 4, sizes: [] }

describe('a tree’s handle', () => {
  it('stands at the middle of the outer edge of each side', () => {
    const g = clusteredMap(table, {}, { style: { side: 'bottom' } })
    const s = sceneOf(g)
    const row = treeHandle(s, g, 'rowTree')!
    expect(row.side).toBe('right')
    expect(row.x).toBeCloseTo(s.plot.x + s.plot.w + 6 + 36, 6)
    const col = treeHandle(s, g, 'columnTree')!
    expect(col.side).toBe('bottom')
    expect(col.y).toBeCloseTo(s.plot.y + s.plot.h + 6 + 36, 6)
    // A tree alone, a hidden tree, another layer: none.
    const alone = treeAlone(table)
    expect(treeHandle(sceneOf(alone), alone, 'rowTree')).toBeNull()
    expect(treeHandle(s, g, 'cells')).toBeNull()
    const hidden = clusteredMap(table, { visible: false })
    expect(treeHandle(sceneOf(hidden), hidden, 'rowTree')).toBeNull()
  })

  it('dragged out deepens the tree, in shallows it, within 4–400 pt, to half a point', () => {
    const g = clusteredMap(table, { style: { side: 'left' } })
    const l = tree(g, 'rowTree')
    expect(treeSide(l)).toBe('left')
    // Left: outwards is to the left.
    expect(draggedDepth(l, -20.3, 5)).toBe(56.5)
    expect(draggedDepth(l, -20.3, 5, true)).toBeCloseTo(56.3, 9)
    expect(draggedDepth(l, 100, 0)).toBe(4)
    expect(draggedDepth(l, -1000, 0)).toBe(400)
    const top = tree(clusteredMap(table), 'columnTree')
    expect(draggedDepth(top, 0, -14)).toBe(50)
  })
})

describe('the drag', () => {
  it('is one edit of the tree’s depth, previewed on the graph', () => {
    const g = clusteredMap(table)
    const out = dragOutcome(
      g,
      sceneOf(g),
      { kind: 'tree', layer: 'rowTree', dx: 24, dy: 3, free: false },
      OPTS,
    )
    expect(out.commits).toEqual([
      {
        path: ['layers', { id: 'rowTree' }, 'style', 'depth'],
        value: 60,
        label: 'Dendrogram size',
      },
    ])
    expect(out.label).toBe('Dendrogram size')
    expect(out.readout).toBe('Width 60 pt')
    expect(tree(out.graph, 'rowTree').style).toEqual({ depth: 60 })
    // The preview draws it deeper.
    const s = sceneOf(out.graph)
    expect(treeHandle(s, out.graph, 'rowTree')!.x).toBeCloseTo(s.plot.x + s.plot.w + 6 + 60, 6)
    const col = dragOutcome(
      g,
      sceneOf(g),
      { kind: 'tree', layer: 'columnTree', dx: 0, dy: -4, free: false },
      OPTS,
    )
    expect(col.readout).toBe('Height 40 pt')
    // Not a tree beside a heat map: nothing.
    const none = dragOutcome(
      g,
      sceneOf(g),
      { kind: 'tree', layer: 'cells', dx: 9, dy: 0, free: false },
      OPTS,
    )
    expect(none.commits).toEqual([])
    expect(none.graph).toBe(g)
  })
})

describe('on a layout page (roadmap 49c, left for 49d)', () => {
  it('shows for one whole tree layer alone among the graph’s selected parts', () => {
    expect(layerAlone([['layers', 'rowTree']])).toBe('rowTree')
    expect(layerAlone([['layers', 'rowTree', 'series', 'a']])).toBeNull()
    expect(
      layerAlone([
        ['layers', 'rowTree'],
        ['layers', 'columnTree'],
      ]),
    ).toBeNull()
    expect(layerAlone([['title']])).toBeNull()
    expect(layerAlone([])).toBeNull()
  })

  it('stands on the placed graph’s tree, a page move scaled by the item’s into graph points', () => {
    const g = clusteredMap(table)
    const s = sceneOf(g)
    const h = treeHandle(s, g, 'rowTree')!
    const item = { x: 100, y: 200, scale: 0.5 }
    const onPage = pageTreeHandle(h, item)
    expect(onPage).toEqual({ ...h, x: 100 + h.x / 2, y: 200 + h.y / 2 })
    // 12 page points out at half size: 24 graph points, the depth 36 → 60, one edit.
    const out = dragOutcome(
      g,
      s,
      { kind: 'tree', layer: 'rowTree', dx: 12 / item.scale, dy: 0, free: false },
      OPTS,
    )
    expect(out.commits.map((c) => [c.path, c.value, c.label])).toEqual([
      [['layers', { id: 'rowTree' }, 'style', 'depth'], 60, 'Dendrogram size'],
    ])
  })
})
