import { applyPreset, layoutGraph, presetGraph } from '@ps/graph'
import { createTable, type GraphNode } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import { copyGraph } from '../src/graph/builder/GraphBuilder.tsx'
import { stackGraphs } from '../src/layout/stack.ts'

/** "Three doses" drawn twice: bars and a scatter with much wider Y labels. */
function setup() {
  const table = createTable({ columns: 3, rows: 4 })
  const values = [
    [4.2, 5.1, 3.9, 4.8],
    [6.1, 5.8, 7.2, 6.6],
    [5.0, 4.6, 5.9, 5.3],
  ]
  values.forEach((v, i) => {
    table.dataSets[i]!.subcolumns[0]!.values = v
  })
  const bars = presetGraph(table, 'bars', 'Bars')
  let scatter = applyPreset(copyGraph(bars, 'Scatter'), 'points', table)
  scatter = { ...scatter, size: { plotWidth: bars.size.plotWidth - 40, plotHeight: 150 } }
  // Wider tick labels on the scatter's Y axis shift its plot area right.
  scatter.axes = {
    ...scatter.axes,
    y:
      scatter.axes.y.type === 'continuous'
        ? { ...scatter.axes.y, format: { mode: 'fixed', digits: 4, suffix: ' mg/L' } }
        : scatter.axes.y,
  }
  const project = projectOf(table, bars, scatter)
  return { project, bars, scatter }
}

describe('stacking graphs', () => {
  it('lines up plot areas and categories one above the other', () => {
    const { project, bars, scatter } = setup()
    const page = { width: 612, height: 792 }
    const res = stackGraphs(project, [bars, scatter], fonts, page, {
      direction: 'vertical',
      shareY: true,
      hideInner: true,
    })
    const [top, bottom] = res.graphs as [GraphNode, GraphNode]
    expect(top.size.plotWidth).toBe(bottom.size.plotWidth)
    expect(top.links?.y).toBeDefined()
    expect(top.links?.y).toBe(bottom.links?.y)
    expect(top.axes.x.showLabels).toBe(false)
    expect(top.axes.x.title).toBeNull()
    expect(bottom.axes.x.showLabels).toBeUndefined()
    // The copy's title repeated the top graph's: dropped below it.
    expect(top.title).not.toBeNull()

    const withAll = { ...project, nodes: { ...project.nodes, [top.id]: top, [bottom.id]: bottom } }
    const [a, b] = [top, bottom].map((graph) => layoutGraph({ project: withAll, graph, fonts }))
    const [pa, pb] = res.placements as [(typeof res.placements)[0], (typeof res.placements)[0]]
    // Plot areas share their left edge on the page, and the top graph is above.
    expect(pa.x + a!.plot.x * pa.scale).toBeCloseTo(pb.x + b!.plot.x * pb.scale, 6)
    expect(pa.y + a!.height * pa.scale).toBeLessThanOrEqual(pb.y + 1e-6)
    // Same categories at the same page x: category centres map equally.
    const cx = (s: typeof a, p: typeof pa, i: number) => p.x + s!.axes!.x.toPx(i) * p.scale
    for (const i of [0, 1, 2]) expect(cx(a, pa, i)).toBeCloseTo(cx(b, pb, i), 6)
    // Shared Y range: the same value sits at the same height within each plot.
    const rel = (s: typeof a, v: number) => (s!.axes!.y.toPx(v) - s!.plot.y) / s!.plot.h
    expect(rel(a, 5)).toBeCloseTo(rel(b, 5), 6)
  })

  it('side by side: equal plot heights and Y labels only on the left', () => {
    const { project, bars, scatter } = setup()
    const res = stackGraphs(
      project,
      [bars, scatter],
      fonts,
      { width: 792, height: 612 },
      {
        direction: 'horizontal',
        shareY: true,
        hideInner: true,
      },
    )
    const [left, right] = res.graphs as [GraphNode, GraphNode]
    expect(left.size.plotHeight).toBe(right.size.plotHeight)
    expect(right.axes.y.showLabels).toBe(false)
    expect(left.axes.y.showLabels).toBeUndefined()
    expect(res.placements[0]!.x).toBeLessThan(res.placements[1]!.x)
  })
})
