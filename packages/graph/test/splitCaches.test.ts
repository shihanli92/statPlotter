import type { DataTable, GraphNode, Layer, NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { syntheticTable } from '../../model/test/synthetic.ts'
import {
  graphRows,
  layoutLayers,
  presetGraph,
  resolveSeries,
  sceneToSvg,
  splitGraphs,
} from '../src/index.ts'
import { fonts, projectOf } from './helpers.ts'

// Audit 2 (G8): the caches of a graph's rows (row slices of its data sets, the points a density
// is computed of, densities) on a set of split graphs of more levels than they kept (8 slices, 12
// densities: a set of 14 clusters laid out in turn evicted each graph's entries before it was
// drawn again). Characterised before the caches were keyed by the rows' identity: every graph of
// the set laid out in turn, twice, draws what it draws from a copy of the table (cold caches).

const t = syntheticTable({ rows: 3000, genes: 2, pcs: 2, cellIds: false })
const key = (title: string) => t.dataSets.find((d) => d.title === title)!.id
const cluster = key('cluster')

/** A graph of the genes' values as columns (category frame, sliced data sets). */
function columns(): GraphNode {
  const g = presetGraph(t, 'points')
  return {
    ...g,
    id: 'g1' as NodeId,
    seriesSource: { ...g.seriesSource, include: [key('GENE1'), key('GENE2')] },
  } as GraphNode
}

/** The UMAP coloured by sample with hexagons and contours by sample, points coloured by density. */
function umap(): GraphNode {
  const g = presetGraph(t, 'bubble')
  const layers = [
    { id: 'hex', geom: 'hex', stat: { kind: 'hexbin', bins: 12 } },
    ...g.layers.map((l) =>
      l.aes
        ? ({
            ...l,
            aes: { x: key('UMAP_1'), y: key('UMAP_2'), color: key('sample') },
            style: { ...l.style, size: 2, colorBy: 'density' },
          } as Layer)
        : l,
    ),
    { id: 'contour', geom: 'contour', stat: { kind: 'density2d', n: 30 } },
  ] as Layer[]
  return { ...g, id: 'g1' as NodeId, layers }
}

/** Every third row of the table: a graph of rows given explicitly (`seriesSource.rows`). */
const third = (g: GraphNode): GraphNode => ({
  ...g,
  seriesSource: {
    ...g.seriesSource,
    rows: Array.from({ length: t.rowCount / 3 }, (_, i) => 3 * i),
  },
})

const svg = (table: DataTable, graph: GraphNode) =>
  sceneToSvg(layoutLayers({ project: projectOf(table), graph, fonts }), { ids: true })

describe('split sets laid out in turn (characterised)', () => {
  it.each([
    ['columns', columns()],
    ['columns of every third row', third(columns())],
    ['a UMAP with densities', umap()],
    ['a UMAP of every third row', third(umap())],
  ] as const)('%s', (_, base) => {
    const set = splitGraphs(t, base, { by: 'level', variable: cluster })
    expect(set).toHaveLength(14)
    const first = set.map((g) => svg(t, g))
    const again = set.map((g) => svg(t, g))
    expect(again).toEqual(first)
    // A copy of the table: nothing cached of it.
    const copy = structuredClone(t)
    for (const [i, g] of set.entries()) expect(svg(copy, g), `level ${i}`).toBe(first[i])
  })
})

describe('split sets keep every graph’s rows cached (audit 2, G8)', () => {
  it('the same rows and slices for each graph, however many were laid out between', () => {
    for (const base of [columns(), third(columns())]) {
      const set = splitGraphs(t, base, { by: 'level', variable: cluster })
      const project = projectOf(t)
      const slices = () => set.map((g) => resolveSeries(project, g).map((s) => s.ds))
      const rows = () => set.map((g) => graphRows(g, t))
      const [before, beforeRows] = [slices(), rows()]
      // Each level's slices are other objects than the others' (14 levels, 2 data sets each).
      expect(new Set(before.flat()).size).toBe(28)
      const [after, afterRows] = [slices(), rows()]
      for (const [i, ds] of after.entries()) {
        expect(afterRows[i]).toBe(beforeRows[i])
        for (const [k, d] of ds.entries()) expect(d, `level ${i}`).toBe(before[i]![k])
      }
    }
  })

  it('the same rows for a graph’s own rows array and table', () => {
    const g = third(columns())
    expect(graphRows(g, t)).toBe(graphRows({ ...g }, t))
    // Another array of the same rows: equal rows (made again).
    const copy = { ...g, seriesSource: { ...g.seriesSource, rows: [...g.seriesSource.rows!] } }
    expect(graphRows(copy, t)).toEqual(graphRows(g, t))
  })
})
