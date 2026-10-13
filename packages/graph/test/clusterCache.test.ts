import type { GraphNode, LayerOf } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { cpuRatio } from '../../stats/test/timing.ts'
import { layoutGraph, treeOfLayer } from '../src/index.ts'
import { clusterOrder } from '../src/layers/stats/cell.ts'
import { clusteredMap, genesTable } from './dendrogramCases.ts'
import { fonts, projectOf } from './helpers.ts'

// Audit 4 (P4): a heat map's clustering (O(n²) and more) is found once for the same values,
// distance and linkage — not again at every layout and every render of the Format view (2,000
// rows: 358–400 ms per edit of a tree's width, 77% of it clustering). (No mocks: these files share
// one module graph.)

const genes = genesTable()
const tree = (g: GraphNode, id: string) =>
  g.layers.find((l) => l.id === id) as LayerOf<'dendrogram'>

/** n rows × 6 columns of values (no random draws). */
const matrix = (n: number, shift = 0) =>
  Array.from({ length: n }, (_, i) =>
    Array.from({ length: 6 }, (_, j) => ((i * 37 + j * 11) % 101) / 7 + j + shift),
  )

describe('the clustering of a heat map, found once (audit 4 P4)', () => {
  it('the same values, distance, linkage and axis: the clustering found before', () => {
    const rows = matrix(40)
    const warnings: string[] = []
    const a = clusterOrder(rows, {}, 'rows', warnings)
    // A fresh copy of the same values (as each layout makes).
    expect(
      clusterOrder(
        rows.map((r) => [...r]),
        {},
        'rows',
        warnings,
      ),
    ).toBe(a)
    expect(clusterOrder(rows, { linkage: 'average' }, 'rows', warnings)).not.toBe(a)
    expect(clusterOrder(rows, { distance: 'pearson' }, 'rows', warnings)).not.toBe(a)
    expect(clusterOrder(rows, {}, 'columns', warnings)).not.toBe(a)
    const changed = rows.map((r) => [...r])
    changed[3]![2] = 99
    const c = clusterOrder(changed, {}, 'rows', warnings)
    expect(c).not.toBe(a)
    expect(c!.order).not.toEqual(a!.order)
    expect(warnings).toEqual([])
  })

  it('the Format view shares it: an edit that leaves the values (a tree’s width) finds it', () => {
    const g = clusteredMap(genes)
    const project = projectOf(genes, g)
    layoutGraph({ project, graph: g, fonts })
    const wider: GraphNode = {
      ...g,
      layers: g.layers.map((l) =>
        l.id === 'rowTree' ? ({ ...l, style: { ...l.style, width: 30 } } as typeof l) : l,
      ),
    }
    const hc = treeOfLayer(project, g, tree(g, 'rowTree'))
    expect(hc).not.toBeNull()
    expect(treeOfLayer(projectOf(genes, wider), wider, tree(wider, 'rowTree'))).toBe(hc)
  })

  it('a clustering that can’t be done warns every time it is asked', () => {
    const rows = [
      [1, Number.NaN],
      [Number.NaN, 2],
    ]
    const w1: string[] = []
    const w2: string[] = []
    expect(clusterOrder(rows, {}, 'rows', w1)).toBeNull()
    expect(clusterOrder(rows, {}, 'rows', w2)).toBeNull()
    expect(w1).toHaveLength(1)
    expect(w2).toEqual(w1)
  })

  it('asking again costs a comparison of the values, not a clustering', () => {
    const rows = matrix(1200)
    clusterOrder(rows, {}, 'rows', [])
    let k = 0
    // Each run new values (a clustering), against the same values again (found).
    const fresh = () => clusterOrder(matrix(1200, ++k), {}, 'rows', [])
    const again = () => clusterOrder(rows, {}, 'rows', [])
    expect(cpuRatio(fresh, again, 3)).toBeLessThan(0.05)
  })
})
