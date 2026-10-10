import {
  type AnalysisResult,
  createTable,
  type DataTable,
  type GraphNode,
  type Layer,
  type NodeId,
  type SeriesId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { layoutGraph, presetGraph, type Scene } from '../src/index.ts'
import { layoutLayers } from '../src/layers/engine.ts'
import { graphOf } from './graphs.ts'
import { appearanceTable, fonts, growthRatio, projectOf } from './helpers.ts'
import { paintOrder, statFor } from './zorder.ts'

// The layer engine's cost (roadmap 33a): CPU time, never wall clock (tests share a busy machine).
// (Roadmap 33a also held the golden set's layout within 10% of the v1 layouts' CPU time, 1.07;
// the v1 layouts went with roadmap 33d.)

describe('layer engine CPU time', () => {
  it('a 12-layer graph grows linearly from 10k to 100k values', () => {
    const graphAt = (n: number) => {
      const rows = n / 2
      const table = createTable({
        tableKind: 'xy',
        yFormat: { type: 'replicates', count: 2 },
        columns: 1,
        rows,
      })
      table.id = 't1' as NodeId
      table.x!.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) => r)
      table.dataSets[0]!.subcolumns.forEach((s, j) => {
        s.values = Array.from({ length: rows }, (_, r) => 1 + ((r * 7 + j * 3) % 11))
      })
      const curve = {
        title: 'Fit',
        x: Array.from({ length: rows / 10 }, (_, i) => i * 10),
        y: Array.from({ length: rows / 10 }, () => 6),
        lo: Array.from({ length: rows / 10 }, () => 5),
        hi: Array.from({ length: rows / 10 }, () => 7),
      }
      const mean = { kind: 'summary', center: 'mean' } as const
      const ID = { kind: 'identity' } as const
      const fit = { id: 'e1' as SeriesId, ref: { node: 'a1' as NodeId, key: 'fit' } }
      // Every kind of XY layer: the data set's marks, an output's curve, band and points, and a
      // function.
      const layers: Layer[] = [
        { id: 'curveBands', geom: 'band', stat: ID, data: { from: 'layer', layer: 'curves' } },
        { id: 'area', geom: 'area', stat: mean },
        { id: 'envelope', geom: 'band', stat: { ...mean, error: 'SD' } },
        { id: 'subjects', geom: 'line', stat: ID },
        { id: 'line', geom: 'line', stat: mean },
        { id: 'bars', geom: 'bar', stat: mean },
        { id: 'box', geom: 'box', stat: { kind: 'boxplot', whiskers: 'minmax' } },
        { id: 'curves', geom: 'line', stat: ID, data: { from: 'outputs', series: [fit] } },
        {
          id: 'curvePoints',
          geom: 'points',
          stat: ID,
          data: { from: 'layer', layer: 'curves' },
        },
        {
          id: 'functions',
          geom: 'line',
          stat: ID,
          data: {
            from: 'functions',
            functions: [
              { id: 'f1' as SeriesId, equation: 'user', userEquation: 'Y = 2', params: {} },
            ],
          },
        },
        { id: 'error', geom: 'errorbar', stat: { ...mean, error: 'SD' }, style: { x: true } },
        { id: 'points', geom: 'points', stat: mean },
      ]
      const graph: GraphNode = { ...graphOf(table, 'meanSd'), layers }
      const result: AnalysisResult = {
        status: 'ok',
        diagnostics: [],
        sheets: [],
        values: {},
        comparisons: [],
        outputs: { fit: curve },
      }
      return { project: projectOf(table, graph), graph, fonts, result: () => result }
    }
    const graphs = new Map([10_000, 100_000].map((n) => [n, graphAt(n)]))
    expect(graphs.get(10_000)!.graph.layers).toHaveLength(12)
    // Every layer draws.
    const scene = layoutLayers(graphs.get(10_000)!)
    const drew = new Set<string>()
    const walk = (n: (typeof scene)['root']) => {
      if (n.layer && n.prim) drew.add(n.layer)
      for (const c of n.children ?? []) walk(c)
    }
    walk(scene.root)
    expect(drew.size).toBe(12)
    const ratio = growthRatio((n) => layoutLayers(graphs.get(n)!), 10_000, 10, 2)
    expect(ratio).toBeLessThan(25)
  })
})

/** The layers of a scene that drew a mark (a mark's layer: its nearest tagged ancestor's). */
const drawn = (scene: Scene): Set<string> =>
  new Set(
    paintOrder(scene)
      .map((m) => m.layer)
      .filter((l) => l !== undefined),
  )

/** A table's every per-row array `n` rows long (its rows repeated), numbers varied a little. */
function grown(t: DataTable, n: number): DataTable {
  const grow = <T>(xs: readonly T[]) => Array.from({ length: n }, (_, r) => xs[r % xs.length] as T)
  return {
    ...t,
    rowCount: n,
    dataSets: t.dataSets.map((d) => ({
      ...d,
      ...(d.text ? { text: grow(d.text) } : {}),
      subcolumns: d.subcolumns.map((c) => ({
        ...c,
        values: grow(c.values).map((v, r) => (v === null || d.text ? v : v + (r % 97) / 10)),
      })),
    })),
  }
}

// Audit 2 (G18): the same guard on a category graph of a column table and on a graph of a
// multiple-variables table's variables by group (grouped frame), not only on XY.
describe('layer engine CPU time on category and grouped graphs', () => {
  const mean = { kind: 'summary', center: 'mean' } as const

  it('a column table’s category graph grows linearly from 6k to 60k values', () => {
    const graphAt = (n: number) => {
      const rows = n / 3
      const table = createTable({ tableKind: 'column', columns: 3, rows })
      table.id = 't1' as NodeId
      table.dataSets.forEach((d, i) => {
        d.subcolumns[0]!.values = Array.from(
          { length: rows },
          (_, r) => 1 + i + ((r * 7) % 101) / 10,
        )
      })
      // Every kind of summary, and a point per row.
      const layers = [
        { id: 'violin', geom: 'violin', stat: statFor('violin', 'density') },
        { id: 'box', geom: 'box', stat: statFor('box', 'boxplot') },
        { id: 'bars', geom: 'bar', stat: mean },
        { id: 'error', geom: 'errorbar', stat: { ...mean, error: 'SD' } },
        { id: 'center', geom: 'center', stat: mean },
        { id: 'points', geom: 'points', stat: { kind: 'identity' } },
      ] as Layer[]
      const graph: GraphNode = { ...graphOf(table, 'boxPoints'), layers }
      return { project: projectOf(table, graph), graph, fonts }
    }
    const graphs = new Map([6000, 60_000].map((n) => [n, graphAt(n)]))
    const all = graphs.get(6000)!.graph.layers.map((l) => l.id)
    expect([...drawn(layoutGraph(graphs.get(6000)!))].sort()).toEqual(all.sort())
    const ratio = growthRatio((n) => layoutLayers(graphs.get(n)!), 6000, 10, 2)
    expect(ratio).toBeLessThan(25)
  })

  it('a graph of variables by group grows linearly from 10k to 100k rows', () => {
    const graphAt = (n: number) => {
      const table = grown(appearanceTable(), n)
      const g = presetGraph(table, 'groupViolin', undefined, {
        mapping: { x: 'a', y: 'c', color: 'b' },
      })
      const dodge = { kind: 'dodge' } as const
      const layers = [
        ...g.layers,
        { id: 'bars', geom: 'bar', stat: mean, position: dodge },
        { id: 'error', geom: 'errorbar', stat: { ...mean, error: 'SEM' }, position: dodge },
      ] as Layer[]
      const graph: GraphNode = { ...g, id: 'g1' as NodeId, layers }
      return { project: projectOf(table, graph), graph, fonts }
    }
    const graphs = new Map([10_000, 100_000].map((n) => [n, graphAt(n)]))
    const first = graphs.get(10_000)!
    expect(first.graph.frame).toBe('grouped')
    expect(drawn(layoutGraph(first)).size).toBe(first.graph.layers.length)
    const ratio = growthRatio((n) => layoutLayers(graphs.get(n)!), 10_000, 10, 2)
    expect(ratio).toBeLessThan(25)
  })
})

// Audit 2 (G15): XY bars' bin width is the smallest spacing of every data set's X values; each
// data set's bars and extent found it again (sorting every data set's X), quadratic in the data
// sets (a ratio near 10 here, 2.9 now). Found once per layout and layer.
describe('XY bars of many data sets', () => {
  it('grow linearly from 6 to 24 data sets', () => {
    const graphAt = (n: number) => {
      const rows = 1500
      const table = createTable({ tableKind: 'xy', columns: n, rows })
      table.id = 't1' as NodeId
      table.x!.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) => r * 0.5)
      table.dataSets.forEach((d, i) => {
        d.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) => 1 + ((r * 7 + i) % 13))
      })
      const graph = graphOf(table, 'histogram')
      return { project: projectOf(table, graph), graph, fonts }
    }
    const graphs = new Map([6, 24].map((n) => [n, graphAt(n)]))
    expect(drawn(layoutGraph(graphs.get(6)!))).toContain('bars')
    const ratio = growthRatio((n) => layoutLayers(graphs.get(n)!), 6, 4, 2)
    expect(ratio).toBeLessThan(6)
  })
})
