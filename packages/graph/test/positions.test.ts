import { type Annotation, createTable, type GraphNode } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { layoutGraph, nodeBounds, PAD, type Scene, sceneToSvg } from '../src/index.ts'
import { graphOf } from './graphs.ts'
import { byId, flatten, fonts, projectOf } from './helpers.ts'

// Roadmap 22: elements dragged on the canvas are stored as offsets from their computed places.

/** A node's bounds relative to the plot's top-left corner. */
const rel = (s: Scene, id: string) => {
  const b = nodeBounds(byId(s, id)!)!
  return { x: b.x - s.plot.x, y: b.y - s.plot.y, w: b.w, h: b.h }
}
const union = (s: Scene, prefix: string) => {
  const bs = flatten(s.root)
    .filter((n) => n.id.startsWith(prefix) && n.prim)
    .map((n) => nodeBounds(n)!)
  const x = Math.min(...bs.map((b) => b.x))
  const y = Math.min(...bs.map((b) => b.y))
  return { x: x - s.plot.x, y: y - s.plot.y }
}

function setup() {
  const table = createTable({ tableKind: 'column', columns: 3, rows: 3 })
  table.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = [1 + i, 2 + i, 3 + 2 * i]
  })
  const [a, b, c] = table.dataSets.map((d) => d.id)
  const bracket = (id: string, from: string, to: string): Annotation => ({
    type: 'bracket',
    id: id as never,
    a: from,
    b: to,
    label: { source: 'manual', text: '*' },
    level: 'auto',
  })
  const base = graphOf(table, 'points')
  const graph: GraphNode = {
    ...base,
    title: { content: [{ text: 'Growth' }] },
    axes: {
      ...base.axes,
      x: { ...base.axes.x, title: { content: [{ text: 'Group' }] } },
      y: { ...base.axes.y, title: { content: [{ text: 'Response' }] } },
    },
    annotations: [bracket('b1', a!, b!), bracket('b2', a!, c!)],
  }
  const project = projectOf(table, graph)
  const lay = (g: GraphNode) => layoutGraph({ project: { ...project }, graph: g, fonts })
  return { graph, lay }
}

/** Every drawn node lies inside the scene. */
function inside(s: Scene) {
  for (const n of flatten(s.root)) {
    if (!n.prim) continue
    const b = nodeBounds(n)
    if (!b) continue
    expect(b.x).toBeGreaterThanOrEqual(-1e-9)
    expect(b.y).toBeGreaterThanOrEqual(-1e-9)
    expect(b.x + b.w).toBeLessThanOrEqual(s.width + 1e-9)
    expect(b.y + b.h).toBeLessThanOrEqual(s.height + 1e-9)
  }
}

describe('element offsets', () => {
  it('moves the graph title and axis titles by their offsets', () => {
    const { graph, lay } = setup()
    const s0 = lay(graph)
    const s1 = lay({
      ...graph,
      titleOffset: { dx: 12, dy: 5 },
      axes: {
        ...graph.axes,
        x: { ...graph.axes.x, titleOffset: { dx: -20, dy: 4 } },
        y: { ...graph.axes.y, titleOffset: { dx: 3, dy: -15 } },
      },
    })
    for (const [id, dx, dy] of [
      ['title', 12, 5],
      ['axis/x/title', -20, 4],
      ['axis/y/title', 3, -15],
    ] as const) {
      const a = rel(s0, id)
      const b = rel(s1, id)
      expect(b.x - a.x).toBeCloseTo(dx, 9)
      expect(b.y - a.y).toBeCloseTo(dy, 9)
      expect(b.w).toBeCloseTo(a.w, 9)
      expect(b.h).toBeCloseTo(a.h, 9)
    }
    // The plot itself doesn't move relative to its axes.
    expect(rel(s1, 'axis/y/tickLabel/0')).toEqual(rel(s0, 'axis/y/tickLabel/0'))
    inside(s1)
  })

  it('moves tick labels across the axis only, and the axis title and margin follow', () => {
    const { graph, lay } = setup()
    const s0 = lay(graph)
    const s1 = lay({
      ...graph,
      axes: {
        ...graph.axes,
        x: { ...graph.axes.x, tickLabelOffset: 7 },
        y: { ...graph.axes.y, tickLabelOffset: 5 },
      },
    })
    // X labels: down; Y labels: left (away from the axis line), at their ticks.
    const [x0, x1] = [union(s0, 'axis/x/tickLabel/'), union(s1, 'axis/x/tickLabel/')]
    expect(x1.y - x0.y).toBeCloseTo(7, 9)
    expect(x1.x).toBeCloseTo(x0.x, 9)
    const [y0, y1] = [union(s0, 'axis/y/tickLabel/'), union(s1, 'axis/y/tickLabel/')]
    expect(y1.x - y0.x).toBeCloseTo(-5, 9)
    expect(y1.y).toBeCloseTo(y0.y, 9)
    expect(rel(s1, 'axis/x/title').y - rel(s0, 'axis/x/title').y).toBeCloseTo(7, 9)
    expect(rel(s1, 'axis/y/title').x - rel(s0, 'axis/y/title').x).toBeCloseTo(-5, 9)
    expect(s1.height - s0.height).toBeCloseTo(7, 9)
    expect(s1.width - s0.width).toBeCloseTo(5, 9)
    // Tick labels are their own style target (the axis' `tickLabels`).
    expect(byId(s1, 'axis/x/tickLabel/0')!.target).toEqual(['axes', 'x', 'tickLabels'])
    // Towards the axis: never past the axis line.
    const s2 = lay({
      ...graph,
      axes: { ...graph.axes, y: { ...graph.axes.y, tickLabelOffset: -50 } },
    })
    const tick = nodeBounds(byId(s2, 'axis/y/tick/0')!)!
    const label = nodeBounds(byId(s2, 'axis/y/tickLabel/0')!)!
    expect(label.x + label.w).toBeLessThanOrEqual(tick.x + tick.w + 1e-9)
    expect(label.x + label.w).toBeGreaterThan(tick.x + tick.w - 1)
    inside(s2)
  })

  it('moves a bracket up or down without reshuffling the others', () => {
    const { graph, lay } = setup()
    const s0 = lay(graph)
    const moved = graph.annotations.map((a, i) =>
      i === 0 && a.type === 'bracket' ? { ...a, offset: -9 } : a,
    )
    const s1 = lay({ ...graph, annotations: moved })
    expect(rel(s1, 'annotation/b1').y - rel(s0, 'annotation/b1').y).toBeCloseTo(-9, 9)
    expect(rel(s1, 'annotation/b1').x).toBeCloseTo(rel(s0, 'annotation/b1').x, 9)
    expect(rel(s1, 'annotation/b2')).toEqual(rel(s0, 'annotation/b2'))
    inside(s1)
    // Far down past the plot: the graph grows to hold it.
    const down = graph.annotations.map((a, i) =>
      i === 1 && a.type === 'bracket' ? { ...a, offset: 400 } : a,
    )
    const s2 = lay({ ...graph, annotations: down })
    expect(s2.height).toBeGreaterThan(s0.height + 100)
    inside(s2)
  })

  it('grows the graph to hold elements moved past its edges, and exports them', () => {
    const { graph, lay } = setup()
    const s0 = lay(graph)
    const s1 = lay({
      ...graph,
      titleOffset: { dx: 0, dy: -40 },
      axes: { ...graph.axes, y: { ...graph.axes.y, titleOffset: { dx: -30, dy: 0 } } },
    })
    expect(s1.height - s0.height).toBeCloseTo(40, 9)
    expect(s1.width - s0.width).toBeCloseTo(30, 9)
    expect(nodeBounds(byId(s1, 'title')!)!.y).toBeCloseTo(PAD, 9)
    expect(nodeBounds(byId(s1, 'axis/y/title')!)!.x).toBeCloseTo(PAD, 9)
    // Relative to the plot everything else is where it was.
    expect(rel(s1, 'axis/x/title')).toEqual(rel(s0, 'axis/x/title'))
    expect(s1.axes!.y.toPx(2) - s1.plot.y).toBeCloseTo(s0.axes!.y.toPx(2) - s0.plot.y, 9)
    inside(s1)
    // Export draws the same scene: its size holds the moved title.
    const svg = sceneToSvg(s1)
    const [, w, h] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!
    expect(Number(w)).toBeCloseTo(s1.width, 2)
    expect(Number(h)).toBeCloseTo(s1.height, 2)
    expect(svg).toContain('>Growth</tspan>')
    // A title moved inwards keeps the space reserved at its computed place.
    const s2 = lay({ ...graph, titleOffset: { dx: 0, dy: 30 } })
    expect(s2.height).toBeCloseTo(s0.height, 9)
  })

  it('keeps offsets relative to the computed places when the plot is resized', () => {
    const { graph, lay } = setup()
    const off = {
      ...graph,
      titleOffset: { dx: 10, dy: 0 },
      axes: { ...graph.axes, y: { ...graph.axes.y, titleOffset: { dx: 0, dy: 20 } } },
    }
    const big = (g: GraphNode) => ({ ...g, size: { plotWidth: 300, plotHeight: 250 } })
    const [a0, a1] = [lay(graph), lay(off)]
    const [b0, b1] = [lay(big(graph)), lay(big(off))]
    for (const [id, dx, dy] of [
      ['title', 10, 0],
      ['axis/y/title', 0, 20],
    ] as const) {
      expect(rel(a1, id).x - rel(a0, id).x).toBeCloseTo(dx, 9)
      expect(rel(b1, id).x - rel(b0, id).x).toBeCloseTo(dx, 9)
      expect(rel(b1, id).y - rel(b0, id).y).toBeCloseTo(dy, 9)
    }
    // Still centred on the (larger) plot, plus the offset.
    const t = rel(b1, 'title')
    expect(t.x + t.w / 2).toBeCloseTo(150 + 10, 6)
  })
})
