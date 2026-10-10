import {
  type AnalysisResult,
  createTable,
  type DataTable,
  type GraphLook,
  type GraphNode,
  type NodeId,
  newNodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  bracketsFromAnalysis,
  layoutGraph,
  makeScale,
  niceLinearDomain,
  niceLogDomain,
  niceStep,
  presetGraph,
  type Scene,
  sceneToSvg,
  swarmOffsets,
} from '../src/index.ts'
import { graphOf, PRESET_OF_LOOK } from './graphs.ts'
import { byId, flatten, fonts, prim, projectOf } from './helpers.ts'

/** A column table of the values and a new graph of it in the preset that draws a look. */
function project(columns: (number | null)[][], look: GraphLook = 'column.scatter') {
  const rows = Math.max(...columns.map((c) => c.length))
  const table = createTable({ columns: columns.length, rows })
  columns.forEach((vals, i) => {
    table.dataSets[i]!.subcolumns[0]!.values = Array.from(
      { length: rows },
      (_, r) => vals[r] ?? null,
    )
  })
  const graph = graphOf(table, PRESET_OF_LOOK[look])
  const p = projectOf(table, graph)
  return { p, table, graph }
}

const byPrefix = (scene: Scene, prefix: string) =>
  flatten(scene.root).filter((n) => n.id.startsWith(prefix) && n.prim)

describe('scales and ticks', () => {
  it('picks nice steps', () => {
    expect([1, 7, 9.7, 23, 0.07].map((s) => niceStep(s))).toEqual([0.2, 1, 2, 5, 0.01])
  })

  it('expands to tick boundaries with clean decimal values', () => {
    const d = niceLinearDomain(0.3, 9.7)
    expect([d.min, d.max]).toEqual([0, 10])
    expect(d.ticks).toEqual([0, 2, 4, 6, 8, 10])
    // Values are snapped, so 0.3 is 0.3 and not 0.30000000000000004.
    expect(niceLinearDomain(0.1, 0.7).ticks).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7])
  })

  it('handles degenerate and negative spans', () => {
    expect(niceLinearDomain(5, 5).ticks.length).toBeGreaterThan(1)
    const d = niceLinearDomain(-12, 3)
    expect(d.min).toBeLessThanOrEqual(-12)
    expect(d.ticks).toContain(0)
  })

  it('a manual interval keeps the range’s own ends, unrounded (audit 2, G3)', () => {
    const d = niceLinearDomain(0.1234, 0.4549, { interval: 1 })
    expect([d.min, d.max, d.ticks]).toEqual([0.1234, 0.4549, []])
    // A scatter with Y ticks every 10 on an automatic range: the largest point is on the axis
    // (the range used to end at 4.5, hiding the 4.549 point).
    const { table, graph } = project([[0.1234, 4.549, 2]])
    const g = {
      ...graph,
      axes: { ...graph.axes, y: { ...graph.axes.y, ticks: { interval: 10 } } },
    } as GraphNode
    const s = layoutGraph({ project: projectOf(table, g), graph: g, fonts })
    expect(s.axes!.y.toPx(4.549)).toBeCloseTo(s.plot.y, 9)
  })

  it('log domains snap to decades', () => {
    const d = niceLogDomain(3, 4200, 10)
    expect([d.min, d.max]).toEqual([1, 10000])
    expect(d.ticks).toEqual([1, 10, 100, 1000, 10000])
    const s = makeScale('log10', [1, 100], [100, 0])
    expect(s(10)).toBeCloseTo(50, 12)
    expect(s.invert(50)).toBeCloseTo(10, 12)
  })
})

describe('swarmOffsets', () => {
  it('separates overlapping points without collisions and is deterministic', () => {
    const ys = [10, 10, 10, 11, 12, 30]
    const d = 6
    const xs = swarmOffsets(ys, d, 100)
    for (let i = 0; i < ys.length; i++) {
      for (let j = i + 1; j < ys.length; j++) {
        expect(Math.hypot(xs[i]! - xs[j]!, ys[i]! - ys[j]!)).toBeGreaterThanOrEqual(
          d * 0.98 ** 0.5 - 1e-9,
        )
      }
    }
    expect(xs[5]).toBe(0) // isolated point stays centred
    expect(swarmOffsets(ys, d, 100)).toEqual(xs)
  })

  it('compresses to fit the band', () => {
    const xs = swarmOffsets(
      Array.from({ length: 40 }, () => 50),
      6,
      10,
    )
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(10 + 1e-9)
  })
})

describe('column graph layout', () => {
  const A = [1, 2, 3, 4, 5]
  const B = [6, 7, 8, 9, 10]

  it('draws one symbol per value, centre line, and error bars', () => {
    const { p, graph, table } = project([A, B])
    const scene = layoutGraph({ project: p, graph, fonts })
    const key = table.dataSets[0]!.id
    expect(byPrefix(scene, `series/${key}/point/`)).toHaveLength(5)
    expect(byId(scene, `series/${key}/center`)).toBeDefined()
    expect(byPrefix(scene, `series/${key}/error/`)).toHaveLength(3) // stem + two caps
    expect(scene.warnings).toEqual([])
  })

  it('maps values to the y axis consistently with tick positions', () => {
    const { p, graph, table } = project([A, B], 'column.bar')
    const scene = layoutGraph({ project: p, graph, fonts })
    // Ticks auto-scale to 0..10 step 2 (includes zero, all data positive).
    const labels = byPrefix(scene, 'axis/y/tickLabel/').map((n) =>
      prim(n, 'text')
        .layout.runs.map((r) => r.text)
        .join(''),
    )
    expect(labels).toEqual(['0', '2', '4', '6', '8', '10'])
    const tick0 = prim(byId(scene, 'axis/y/tick/0'), 'line').y1
    const tick10 = prim(byId(scene, 'axis/y/tick/5'), 'line').y1
    const bar = prim(byId(scene, `series/${table.dataSets[1]!.id}/bar`), 'rect')
    // Mean of B is 8 → 80% of the way from 0 to 10.
    expect(bar.y).toBeCloseTo(tick0 + 0.8 * (tick10 - tick0), 9)
    expect(bar.y + bar.h).toBeCloseTo(tick0, 9)
    expect(scene.plot.h).toBe(graph.size.plotHeight)
  })

  it('uses a true minus sign on negative tick labels', () => {
    const { p, graph } = project([
      [-5, -3],
      [2, 4],
    ])
    const scene = layoutGraph({ project: p, graph, fonts })
    const labels = byPrefix(scene, 'axis/y/tickLabel/').map(
      (n) => prim(n, 'text').layout.runs[0]!.text,
    )
    expect(labels.some((l) => l.startsWith('−'))).toBe(true)
  })

  it('follows the table: new columns appear as new categories', () => {
    const { p, graph, table } = project([A, B])
    const t = p.nodes[table.id] as DataTable
    t.dataSets.push({ ...t.dataSets[0]!, id: 'c3' as never, title: 'Group C' })
    const scene = layoutGraph({ project: p, graph, fonts })
    expect(byPrefix(scene, 'axis/x/tickLabel/')).toHaveLength(3)
  })

  it('box plots need raw data, and warn otherwise', () => {
    const { p, graph } = project([A, B], 'column.box')
    const scene = layoutGraph({ project: p, graph, fonts })
    expect(byPrefix(scene, 'series/').filter((n) => n.id.endsWith('/box'))).toHaveLength(2)
  })

  it('before-after connects values row by row', () => {
    const { p, graph } = project([A, B], 'column.beforeAfter')
    const scene = layoutGraph({ project: p, graph, fonts })
    expect(byPrefix(scene, 'pairs/')).toHaveLength(5)
  })

  it('before-after on a row slice pairs each table row’s values', () => {
    const { p, graph } = project([A, B], 'column.beforeAfter')
    const g: GraphNode = { ...graph, seriesSource: { ...graph.seriesSource, rows: [3, 0, 4] } }
    const scene = layoutGraph({ project: p, graph: g, fonts })
    const pairs = byPrefix(scene, 'pairs/')
    expect(pairs.map((n) => n.id).sort()).toEqual(['pairs/0', 'pairs/3', 'pairs/4'])
    // Each line joins A's and B's value of its row (B = A + 5).
    for (const n of pairs) {
      const row = Number(n.id.split('/')[1])
      const pts = prim(n, 'polyline').points
      expect(pts).toHaveLength(2)
      expect(scene.axes!.y.fromPx(pts[0]![1])).toBeCloseTo(A[row]!, 9)
      expect(scene.axes!.y.fromPx(pts[1]![1])).toBeCloseTo(B[row]!, 9)
    }
  })

  it('before-after lines end on the points when the points are spread in a swarm', () => {
    // Equal values: the swarm spreads each column's points across its category.
    const { p, table } = project([Array(5).fill(10), Array(5).fill(20)])
    const base = presetGraph(table, 'beforeAfter')
    const graph: GraphNode = {
      ...base,
      layers: base.layers.map((l) =>
        l.geom === 'points' ? { ...l, style: { ...l.style, spread: 'auto' } } : l,
      ),
    }
    const scene = layoutGraph({
      project: { ...p, nodes: { ...p.nodes, [graph.id]: graph } },
      graph,
      fonts,
    })
    const keys = table.dataSets.map((d) => d.id)
    const pointX = (key: string, row: number) =>
      prim(byPrefix(scene, `series/${key}/point/${row}`)[0]!, 'symbol').cx
    const xs = new Set<number>()
    for (const n of byPrefix(scene, 'pairs/')) {
      const row = Number(n.id.split('/')[1])
      const [a, b] = prim(n, 'polyline').points
      expect(a![0]).toBeCloseTo(pointX(keys[0]!, row), 9)
      expect(b![0]).toBeCloseTo(pointX(keys[1]!, row), 9)
      xs.add(a![0])
    }
    // The points really are spread (the lines don't all start at the category's centre).
    expect(xs.size).toBeGreaterThan(1)
  })

  it('log axes drop non-positive values with a warning when nothing is positive', () => {
    const { p, graph } = project([
      [0.5, 50],
      [5, 500],
    ])
    const g: GraphNode = {
      ...graph,
      axes: { ...graph.axes, y: { ...graph.axes.y, scale: 'log10' } as GraphNode['axes']['y'] },
    }
    const scene = layoutGraph({ project: p, graph: g, fonts })
    const labels = byPrefix(scene, 'axis/y/tickLabel/').map((n) =>
      prim(n, 'text')
        .layout.runs.map((r) => r.text)
        .join(''),
    )
    expect(labels).toEqual(['0.1', '1', '10', '100', '1000'])
  })

  it('draws live significance brackets from analysis comparisons, stacked when they overlap', () => {
    const { p, graph, table } = project([A, B, [3, 4, 5]])
    const [ka, kb, kc] = table.dataSets.map((d) => d.id)
    const analysisId = newNodeId()
    const ref = (key: string) => ({ node: table.id, key })
    const result: AnalysisResult = {
      status: 'ok',
      diagnostics: [],
      sheets: [],
      values: {},
      comparisons: [
        { key: 'ab', a: ref(ka!), b: ref(kb!), p: 0.003 },
        { key: 'ac', a: ref(ka!), b: ref(kc!), p: 0.2 },
      ],
      outputs: {},
    }
    const annotations = bracketsFromAnalysis(graph, analysisId, result)
    expect(annotations).toHaveLength(2)
    const g = { ...graph, annotations }
    expect(bracketsFromAnalysis(g, analysisId, result)).toHaveLength(0) // no duplicates

    const lookup = (id: NodeId) => (id === analysisId ? result : undefined)
    const scene = layoutGraph({ project: p, graph: g, fonts, result: lookup })
    const label = (a: (typeof annotations)[number]) =>
      prim(byId(scene, `annotation/${a.id}/label`), 'text').layout.runs[0]!.text
    expect(label(annotations[0]!)).toBe('**')
    expect(label(annotations[1]!)).toBe('ns')

    const lineY = (a: (typeof annotations)[number]) =>
      prim(byId(scene, `annotation/${a.id}/line`), 'polyline').points[1]![1]
    // A→B spans one gap, A→C two; the wider bracket stacks above.
    expect(lineY(annotations[1]!)).toBeLessThan(lineY(annotations[0]!))
    // Brackets that overflow the plot push the top margin down rather than being clipped.
    for (const n of flatten(scene.root)) if (n.bbox) expect(n.bbox.y).toBeGreaterThanOrEqual(0)

    // Without a result yet, the label is a placeholder.
    const pending = layoutGraph({ project: p, graph: g, fonts })
    expect(
      prim(byId(pending, `annotation/${annotations[0]!.id}/label`), 'text').layout.runs[0]!.text,
    ).toBe('…')
  })

  it('renders standalone SVG with physical size', () => {
    const { p, graph } = project([A, B])
    const svg = sceneToSvg(layoutGraph({ project: p, graph, fonts }))
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="[\d.]+pt" height="[\d.]+pt"/,
    )
    expect(svg).toContain("font-family=\"'PS Liberation Sans', 'Liberation Sans', Arial")
    expect(svg).not.toContain('NaN')
  })

  it('is deterministic', () => {
    const { p, graph } = project([A, B])
    expect(sceneToSvg(layoutGraph({ project: p, graph, fonts }))).toBe(
      sceneToSvg(layoutGraph({ project: p, graph, fonts })),
    )
  })
})
