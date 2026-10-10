import { createTable, type GraphNode, type Project } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { createGraphFor, layoutGraph, presetsFor, sceneToSvg } from '../src/index.ts'
import { addLayers } from './graphs.ts'
import { fonts, nodes, prim, projectOf } from './helpers.ts'

function project(table: ReturnType<typeof createTable>, graph: GraphNode): Project {
  const p = projectOf(table, graph)
  return p
}

/** Group A: events at 2 and 4, censored at 3; group B: event at 5, censored at 6. */
function survivalSetup() {
  const table = createTable({ tableKind: 'survival', columns: 2, rows: 5 })
  table.x!.subcolumns[0]!.values = [2, 3, 4, 5, 6]
  table.dataSets[0]!.subcolumns[0]!.values = [1, 0, 1, null, null]
  table.dataSets[1]!.subcolumns[0]!.values = [null, null, null, 1, 0]
  const graph = createGraphFor(table)
  return { table, graph, project: project(table, graph) }
}

describe('survival graphs', () => {
  it('survival tables get a Kaplan-Meier graph with a percent axis', () => {
    const { table, graph } = survivalSetup()
    expect(graph.look).toBe('survival.step')
    expect(graph.layers.map((l) => [l.geom, l.stat.kind])).toEqual([
      ['step', 'km'],
      ['censor', 'km'],
    ])
    expect(presetsFor('survival').map((p) => p.id)).toEqual(['survival'])
    expect(table.x!.title).toBe('Days elapsed')
  })

  it('draws a staircase from 100% and a tick at each censored time', () => {
    const { project: p, graph, table } = survivalSetup()
    const scene = layoutGraph({ project: p, graph, fonts })
    const a = table.dataSets[0]!.id
    const line = prim(nodes(scene, `series/${a}/line/`)[0], 'polyline')
    const ys = line.points.map((q) => q[1])
    const xs = line.points.map((q) => q[0])
    // Starts at the top of the plot (100%) at time 0 and only ever steps down and right.
    expect(ys[0]).toBeCloseTo(scene.plot.y, 6)
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]!).toBeGreaterThanOrEqual(ys[i - 1]! - 1e-9)
      expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]! - 1e-9)
    }
    // S = 2/3 after the event at 2; the subject censored at 3 leaves one at risk, so the event
    // at 4 takes S to 0.
    const yOf = (pct: number) => scene.plot.y + scene.plot.h * (1 - pct / 100)
    expect(ys).toContain(yOf(200 / 3))
    expect(ys.at(-1)!).toBeCloseTo(yOf(0), 6)
    const ticks = nodes(scene, `series/${a}/censor/`)
    expect(ticks).toHaveLength(1)
    expect(prim(ticks[0], 'line').y1).toBeLessThan(yOf(200 / 3))
    expect(nodes(scene, 'legend/').filter((n) => n.id.endsWith('/label'))).toHaveLength(2)
    expect(sceneToSvg(scene)).not.toContain('NaN')
  })

  it('shades the confidence band on request', () => {
    const { project: p, graph, table } = survivalSetup()
    const a = table.dataSets[0]!.id
    // A confidence band layer behind the curves, drawing only group A.
    const band = { id: 'ciBand', geom: 'band', stat: { kind: 'km' } } as const
    const g = addLayers(
      graph,
      [{ ...band, seriesHidden: true, series: { [a]: { hide: false } } }],
      0,
    )
    const scene = layoutGraph({ project: p, graph: g, fonts })
    expect(nodes(scene, `series/${a}/band`)).toHaveLength(1)
    expect(nodes(scene, `series/${table.dataSets[1]!.id}/band`)).toHaveLength(0)
  })
})

describe('contingency graphs', () => {
  it('contingency tables graph as interleaved bars of the counts', () => {
    const table = createTable({ tableKind: 'contingency', columns: 2, rows: 2 })
    table.dataSets[0]!.subcolumns[0]!.values = [15, 30]
    table.dataSets[1]!.subcolumns[0]!.values = [85, 70]
    const graph = createGraphFor(table)
    expect(graph.look).toBe('grouped.bar')
    const scene = layoutGraph({ project: project(table, graph), graph, fonts })
    const [a] = table.dataSets.map((d) => d.id)
    expect(nodes(scene, `series/${a}/bar/`)).toHaveLength(2)
    expect(nodes(scene, `series/${a}/error/`)).toHaveLength(0)
    expect(sceneToSvg(scene)).not.toContain('NaN')
  })
})
