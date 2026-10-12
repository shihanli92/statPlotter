import type { GraphNode, LayerOf } from '@ps/model'
import { cutree } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import {
  boxInRoot,
  hasHoverCard,
  hitTest,
  layoutGraph,
  markInfo,
  type Scene,
  type SceneNode,
  treeLegAt,
  treeOfLayer,
} from '../src/index.ts'
import { clusteredMap, genesTable, measuresTable, treeAlone } from './dendrogramCases.ts'
import { flatten, fonts, prim, projectOf } from './helpers.ts'

// Roadmap 49c (left for 49d): hover cards on dendrograms — a branch (a merge's ⊓, or a part of a
// merge of several colours) tells its merge height (R's), the leaves under it and, cut, its
// cluster when they are all in one; a leaf (a strip's band, or a branch's leg down to a leaf)
// its row's or column's name and, cut, its cluster. The facts ride on the scene's nodes (`tree`),
// never drawn: the goldens pin the SVGs unchanged.

const genes = genesTable()
const project = (g: GraphNode, t = genes) => projectOf(t, g)
const lay = (g: GraphNode, t = genes): Scene =>
  layoutGraph({ project: project(g, t), graph: g, fonts })
const byId = (s: Scene, id: string) => flatten(s.root).find((n) => n.id === id)!
const tree = (g: GraphNode, id: string) =>
  g.layers.find((l) => l.id === id) as LayerOf<'dendrogram'>
const card = (g: GraphNode, n: SceneNode, t = genes) => markInfo(project(g, t), g, n)

describe('hover cards on a tree', () => {
  it('a branch: its merge height, its leaves, the tree’s name', () => {
    const g = clusteredMap(genes)
    const s = lay(g)
    const hc = treeOfLayer(project(g), g, tree(g, 'rowTree'))!
    const last = hc.merge.length - 1
    const top = byId(s, `dendrogram/rows/${last}`)
    expect(hasHoverCard(top)).toBe(true)
    expect(card(g, top)).toEqual({
      title: 'Row dendrogram',
      lines: [
        { label: 'Height', value: String(Number(hc.height[last]!.toPrecision(4))) },
        { label: 'Leaves', value: '7' },
      ],
    })
    // The first merge joins two leaves; the columns' tree is named so; a renamed layer by name.
    expect(card(g, byId(s, 'dendrogram/rows/0'))?.lines[1]).toEqual({
      label: 'Leaves',
      value: '2',
    })
    expect(card(g, byId(s, 'dendrogram/columns/0'))?.title).toBe('Column dendrogram')
    const named = clusteredMap(genes, { name: 'Genes' })
    expect(card(named, byId(lay(named), 'dendrogram/rows/0'))?.title).toBe('Genes')
  })

  it('cut: a branch’s cluster when it is all in one, a part of a merge above the cut its merge’s', () => {
    const g = clusteredMap(genes, { stat: { kind: 'cluster', of: 'rows', cut: { k: 3 } } })
    const s = lay(g)
    const hc = treeOfLayer(project(g), g, tree(g, 'rowTree'))!
    const leaves = cutree(hc, { k: 3 })
    const sizes: number[] = []
    const under = (c: number): number[] =>
      c < 0 ? [-c - 1] : [...under(hc.merge[c - 1]![0]), ...under(hc.merge[c - 1]![1])]
    hc.merge.forEach(([a, b], k) => {
      const ls = [...under(a), ...under(b)]
      sizes.push(ls.length)
      const one = new Set(ls.map((l) => leaves[l])).size === 1
      const node = byId(s, `dendrogram/rows/${k}`)
      const info = card(g, node)!
      expect(info.lines.find((l) => l.label === 'Leaves')?.value).toBe(String(ls.length))
      expect(info.lines.find((l) => l.label === 'Cluster')?.value).toBe(
        one ? String(leaves[ls[0]!]) : undefined,
      )
      // A merge above the cut is drawn in parts; each tells of its merge.
      for (const c of node.children ?? []) expect(card(g, c)).toEqual(info)
    })
    expect(Math.max(...sizes)).toBe(7)
    expect(flatten(s.root).some((n) => n.id.endsWith('/bar'))).toBe(true)
  })

  it('a leaf: a strip’s band and a branch’s leg down to it name its row and cluster', () => {
    const g = clusteredMap(genes, {
      stat: { kind: 'cluster', of: 'rows', cut: { k: 3 } },
      style: { strip: true },
    })
    const s = lay(g)
    const hc = treeOfLayer(project(g), g, tree(g, 'rowTree'))!
    const leaves = cutree(hc, { k: 3 })
    // The strip's bands, in the tree's order.
    hc.order.forEach((leaf, slot) => {
      expect(card(g, byId(s, `dendrogram/rows/strip/${slot}`))).toEqual({
        title: 'Row dendrogram',
        lines: [
          { label: 'Row', value: `Gene ${leaf + 1}` },
          { label: 'Cluster', value: String(leaves[leaf]) },
        ],
      })
    })
    // The first merge joins two leaves: its legs are theirs, its bar the merge's.
    const [a, b] = hc.merge[0]!
    expect(a < 0 && b < 0).toBe(true)
    const merge = byId(s, 'dendrogram/rows/0')
    const pts = prim(merge, 'polyline').points
    const mid = (i: number): [number, number] => [
      (pts[i]![0] + pts[i + 1]![0]) / 2,
      (pts[i]![1] + pts[i + 1]![1]) / 2,
    ]
    const leg = treeLegAt(merge, ...mid(0))!
    expect(leg.within).toBe(merge)
    expect(leg.target).toEqual(['layers', 'rowTree'])
    expect(card(g, leg)?.lines[0]).toEqual({ label: 'Row', value: `Gene ${-a}` })
    expect(card(g, treeLegAt(merge, ...mid(2))!)?.lines[0]).toEqual({
      label: 'Row',
      value: `Gene ${-b}`,
    })
    expect(treeLegAt(merge, ...mid(1))).toBeNull()
    // The top merge (above the cut: in parts) joins two merges: no legs.
    const whole = byId(s, `dendrogram/rows/${hc.merge.length - 1}`)
    const top = whole.children?.[0] ?? whole
    expect(top.tree?.legs).toBeUndefined()
    const tp = prim(top, 'polyline').points
    expect(treeLegAt(top, tp[0]![0], (tp[0]![1] + tp[1]![1]) / 2)).toBeNull()
  })

  it('found by hit-testing the scene, its card placed beside the leg', () => {
    const g = clusteredMap(genes)
    const s = lay(g)
    const merge = byId(s, 'dendrogram/rows/0')
    const box = boxInRoot(s.root, merge)!
    // The leg nearest the map is at the first point; hit it in the scene's coordinates.
    const [p0, p1] = prim(merge, 'polyline').points as [number, number][]
    const dx = box.x - Math.min(...prim(merge, 'polyline').points.map((p) => p[0]))
    const dy = box.y - Math.min(...prim(merge, 'polyline').points.map((p) => p[1]))
    const x = (p0[0] + p1[0]) / 2 + dx
    const y = (p0[1] + p1[1]) / 2 + dy
    const hit = hitTest(s.root, x, y, 1)!
    expect(hit.node.within?.id).toBe(merge.id)
    expect(hit.node.tree?.leaf).toBeDefined()
    const at = boxInRoot(s.root, hit.node)!
    expect(at.x).toBeCloseTo(Math.min(p0[0], p1[0]) + dx, 6)
    expect(at.y).toBeCloseTo(Math.min(p0[1], p1[1]) + dy, 6)
    expect(hasHoverCard(hit.node)).toBe(true)
  })

  it('a dendrogram alone names its leaves by the rows or the data sets', () => {
    const t = measuresTable()
    const g = treeAlone(t, { stat: { kind: 'cluster', of: 'columns' } })
    const s = lay(g, t)
    const leaf = flatten(s.root).find((n) => n.tree?.legs?.length)!
    const names = leaf.tree!.legs!.map((l) => l.leaf.name)
    for (const n of names) expect(['Height', 'Weight', 'Span', 'Mass']).toContain(n)
    const rows = treeAlone(t)
    const r = flatten(lay(rows, t).root).find((n) => n.tree?.legs?.length)!
    for (const l of r.tree!.legs!) expect(l.leaf.name).toMatch(/^[A-H]$/)
    expect(card(rows, r, t)?.title).toBe('Row dendrogram')
  })

  it('other marks keep theirs: a cell has none of a tree’s', () => {
    const g = clusteredMap(genes)
    const s = lay(g)
    const cell = flatten(s.root).find((n) => n.layer === 'cells' && n.prim)!
    expect(cell.tree).toBeUndefined()
    expect(treeLegAt(cell, 0, 0)).toBeNull()
  })
})
