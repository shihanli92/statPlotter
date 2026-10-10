import type { AnnotationId, DataTable, GraphNode, Layer } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  cellStats,
  flipBox,
  flipNode,
  isHorizontal,
  layoutGraph,
  positionAllowed,
  type ResolvedSeriesStyle,
  resolveSeries,
  type Scene,
  type SceneNode,
  sceneToSvg,
  stackCells,
  withOrientation,
} from '../src/index.ts'
import { addLayers, layerOf, graphOf as presetGraphOf, withLayer, withoutLayers } from './graphs.ts'
import { byId, flatten, fonts, nodes, prim, projectOf, sampleTable } from './helpers.ts'

// Roadmap 30a: horizontal column and grouped graphs, stacked grouped bars, bar baselines.

/** A preset's graph of a table (id `g1`), its graph-wide style and other fields patched. */
function graphOf(
  table: DataTable,
  preset: string,
  style: GraphNode['style'] = {},
  patch: Partial<GraphNode> = {},
): GraphNode {
  return presetGraphOf(table, preset, (g) => ({ ...patch, style: { ...g.style, ...style } }))
}
/** Value labels on a graph's bars. */
const withBarLabels = (graph: GraphNode, style: Record<string, unknown> = {}): GraphNode =>
  addLayers(graph, [
    {
      id: 'labels',
      geom: 'label',
      stat: { kind: 'summary', center: 'mean' },
      on: 'bars',
      ...(Object.keys(style).length ? { style } : {}),
    } as Layer,
  ])
const lay = (table: DataTable, graph: GraphNode): Scene => {
  const scene = layoutGraph({ project: projectOf(table, graph), graph, fonts })
  expect(sceneToSvg(scene)).not.toContain('NaN')
  return scene
}
const H = { orientation: 'horizontal' } as const
const text = (n: SceneNode | undefined) =>
  prim(n, 'text')
    .layout.runs.map((r) => r.text)
    .join('')

describe('turning marks horizontal', () => {
  it('maps (u, v) to (L − v, u): boxes, lines, symbols, paths; text stays', () => {
    expect(flipBox({ x: 10, y: 20, w: 4, h: 30 }, 100)).toEqual({ x: 50, y: 10, w: 30, h: 4 })
    const n = flipNode(
      {
        id: 'g',
        children: [
          { id: 'l', prim: { type: 'line', x1: 1, y1: 2, x2: 3, y2: 4, stroke: null! } },
          {
            id: 's',
            prim: {
              type: 'symbol',
              shape: 'triangle',
              cx: 5,
              cy: 6,
              size: 4,
              stroke: null,
              fill: null,
            },
          },
          {
            id: 'p',
            prim: {
              type: 'path',
              d: [['M', 1, 2], ['C', 1, 2, 3, 4, 5, 6], ['Z']],
              stroke: null,
              fill: null,
            },
          },
        ],
      },
      100,
    )
    const [l, s, p] = n.children!
    expect(l!.prim).toMatchObject({ x1: 98, y1: 1, x2: 96, y2: 3 })
    expect(s!.prim).toMatchObject({ cx: 94, cy: 5, shape: 'triangle' })
    expect(p!.prim).toMatchObject({ d: [['M', 98, 1], ['C', 98, 1, 96, 3, 94, 5], ['Z']] })
  })

  it('only column and grouped graphs turn; withOrientation sets or clears the option', () => {
    const column = sampleTable('column')
    const g = graphOf(column, 'bars')
    expect(isHorizontal(withOrientation(g, true))).toBe(true)
    expect(withOrientation(withOrientation(g, true), false).style).not.toHaveProperty('orientation')
    const xy = graphOf(sampleTable('xy'), 'meanSd')
    expect(withOrientation(xy, true)).toBe(xy)
    expect(isHorizontal({ ...xy, style: H })).toBe(false)
  })
})

describe('horizontal column graphs', () => {
  const column = sampleTable('column')

  it('puts the categories down the left in order and the values along the bottom', () => {
    const scene = lay(column, graphOf(column, 'bars', H))
    // The category axis (axes.x) is drawn down the left: its labels are left of the plot, top down.
    const labels = nodes(scene, 'axis/x/tickLabel/')
    expect(labels.map(text)).toEqual(['Control', 'Drug A', 'Drug B'])
    const ys = labels.map((n) => n.bbox!.y)
    expect(ys[0]).toBeLessThan(ys[1]!)
    for (const n of labels) expect(n.bbox!.x + n.bbox!.w).toBeLessThanOrEqual(scene.plot.x)
    // The value axis (axes.y) runs along the bottom, below the plot, 0 at the left.
    const ticks = nodes(scene, 'axis/y/tickLabel/')
    for (const n of ticks) expect(n.bbox!.y).toBeGreaterThanOrEqual(scene.plot.y + scene.plot.h)
    expect(text(ticks[0])).toBe('0')
    expect(ticks[0]!.bbox!.x).toBeLessThan(ticks[1]!.bbox!.x)
    // Axis targets keep their specs.
    expect(byId(scene, 'axis/x')!.target).toEqual(['axes', 'x'])
    expect(byId(scene, 'axis/y')!.target).toEqual(['axes', 'y'])
    // Bars run from the left edge to their means (Drug A, 19.5, is the longest).
    const bar = (k: string) => prim(byId(scene, `series/${k}/bar`), 'rect')
    expect(bar('a').x).toBeCloseTo(scene.plot.x, 6)
    expect(bar('b').w).toBeGreaterThan(bar('a').w)
    expect(bar('a').y).toBeLessThan(bar('b').y)
    // Scene mappings: X along the values, Y the categories.
    expect(scene.axes!.y.categorical).toBe(true)
    expect(scene.axes!.x.toPx(0)).toBeCloseTo(scene.plot.x, 6)
    expect(bar('a').x + bar('a').w).toBeCloseTo(scene.axes!.x.toPx(13.5), 6)
  })

  it('draws error bars across and caps upright', () => {
    const scene = lay(column, graphOf(column, 'bars', H))
    const [stem, cap] = nodes(scene, 'series/a/error/').map((n) => prim(n, 'line'))
    expect(stem!.y1).toBeCloseTo(stem!.y2, 9)
    expect(cap!.x1).toBeCloseTo(cap!.x2, 9)
  })

  it('stands brackets upright right of the data, labels level beside them', () => {
    const bracket = (id: string, a: string, b: string, label: string) => ({
      type: 'bracket' as const,
      id: id as AnnotationId,
      a,
      b,
      label: { source: 'manual' as const, text: label },
      level: 'auto' as const,
    })
    const graph = graphOf(column, 'bars', H, {
      annotations: [bracket('n1', 'a', 'b', '**'), bracket('n2', 'a', 'c', 'ns')],
    })
    const scene = lay(column, graph)
    const line = prim(byId(scene, 'annotation/n1/line'), 'polyline')
    const xs = line.points.map((p) => p[0])
    // The long side is vertical, the ticks point left towards the bars.
    expect(line.points[1]![0]).toBeCloseTo(line.points[2]![0], 9)
    expect(Math.min(...xs)).toBe(line.points[0]![0])
    const barEnd = (k: string) => {
      const r = prim(byId(scene, `series/${k}/bar`), 'rect')
      return r.x + r.w
    }
    expect(Math.min(...xs)).toBeGreaterThan(barEnd('b'))
    // The label sits right of its line, centred between the two categories.
    const label = byId(scene, 'annotation/n1/label')!
    expect(label.bbox!.x).toBeGreaterThan(line.points[1]![0])
    const mid = (line.points[1]![1] + line.points[2]![1]) / 2
    expect(label.bbox!.y + label.bbox!.h / 2).toBeCloseTo(mid, 0)
    // The wider bracket stacks further right, and the graph is wide enough for both.
    const outer = prim(byId(scene, 'annotation/n2/line'), 'polyline')
    expect(outer.points[1]![0]).toBeGreaterThan(label.bbox!.x + label.bbox!.w)
    const ns = byId(scene, 'annotation/n2/label')!.bbox!
    expect(ns.x + ns.w).toBeLessThanOrEqual(scene.width)
  })

  it('puts bar labels right of the bars, or inside their ends', () => {
    const above = lay(column, withBarLabels(graphOf(column, 'bars', H)))
    const bar = prim(byId(above, 'series/b/bar'), 'rect')
    const label = byId(above, 'series/b/label')!
    expect(label.bbox!.x).toBeGreaterThan(bar.x + bar.w)
    expect(label.bbox!.y + label.bbox!.h / 2).toBeCloseTo(bar.y + bar.h / 2, 0)
    expect(label.bbox!.x + label.bbox!.w).toBeLessThanOrEqual(above.width)
    const inside = lay(column, withBarLabels(graphOf(column, 'bars', H), { position: 'inside' }))
    const b2 = prim(byId(inside, 'series/b/bar'), 'rect')
    const l2 = byId(inside, 'series/b/label')!.bbox!
    expect(l2.x + l2.w).toBeLessThan(b2.x + b2.w)
    expect(l2.x).toBeGreaterThan(b2.x)
  })

  it('labels points where they are drawn', () => {
    const table = { ...column, rowTitles: ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'] }
    const graph = graphOf(table, 'points', H, {
      seriesOverrides: { a: { pointLabels: { source: 'rowTitle', which: 'all', repel: false } } },
    })
    const scene = lay(table, graph)
    const labels = flatten(scene.root).filter((n) => n.id.startsWith('pointLabel/a/'))
    expect(labels.length).toBeGreaterThan(0)
    for (const l of labels) {
      const point = flatten(scene.root).find(
        (n) => n.point === l.point && n.prim?.type === 'symbol' && n.target?.[3] === 'a',
      )!
      const p = prim(point, 'symbol')
      const c = { x: l.bbox!.x + l.bbox!.w / 2, y: l.bbox!.y + l.bbox!.h / 2 }
      // The label's recorded offset leads back to its point.
      expect(c.x - l.labelOffset!.dx).toBeCloseTo(p.cx, 6)
      expect(c.y - l.labelOffset!.dy).toBeCloseTo(p.cy, 6)
      expect(Math.hypot(l.labelOffset!.dx, l.labelOffset!.dy)).toBeLessThan(30)
    }
  })

  it('draws box plots, violins and dot plots across', () => {
    for (const preset of ['box', 'violin', 'points']) {
      const scene = lay(column, graphOf(column, preset, H))
      const marks = nodes(scene, 'series/a/').filter((n) => n.bbox)
      expect(marks.length, preset).toBeGreaterThan(0)
      for (const m of marks) {
        // Every mark of the first group is in the top third of the plot.
        expect(m.bbox!.y).toBeGreaterThanOrEqual(scene.plot.y - 1)
        expect(m.bbox!.y + m.bbox!.h).toBeLessThanOrEqual(scene.plot.y + scene.plot.h / 3)
      }
    }
  })

  it('draws an estimation plot’s difference axis along the top', () => {
    const scene = lay(column, graphOf(column, 'estimation', H))
    const ticks = nodes(scene, 'axis/y2/tickLabel/')
    expect(ticks.length).toBeGreaterThan(1)
    for (const t of ticks) expect(t.bbox!.y + t.bbox!.h).toBeLessThanOrEqual(scene.plot.y)
    // Zero on the difference axis is at the control's mean on the value axis.
    const zero = ticks.find((t) => text(t) === '0')!
    const at = zero.bbox!.x + zero.bbox!.w / 2
    expect(at).toBeCloseTo(scene.axes!.x.toPx(13.5), 0)
    // Differences come after the groups, further down.
    const diff = prim(byId(scene, 'estimation/b/diff'), 'symbol')
    const group = prim(nodes(scene, 'series/b/point/')[0], 'symbol')
    expect(diff.cy).toBeGreaterThan(group.cy)
  })
})

describe('horizontal grouped graphs', () => {
  const grouped = sampleTable('grouped')
  it('lays rows down the left, data sets within each row top to bottom', () => {
    const scene = lay(grouped, graphOf(grouped, 'bars', H))
    expect(nodes(scene, 'axis/x/tickLabel/').map(text)).toEqual(['WT', 'KO', 'Het'])
    const bar = (k: string, r: number) => prim(byId(scene, `series/${k}/bar/${r}`), 'rect')
    expect(bar('a', 0).y).toBeLessThan(bar('b', 0).y)
    expect(bar('b', 0).y).toBeLessThan(bar('a', 1).y)
    expect(bar('b', 1).w).toBeGreaterThan(bar('a', 1).w)
  })
  it('draws a right Y axis along the top', () => {
    const graph = graphOf(grouped, 'bars', H, {
      seriesOverrides: { b: { yAxis: 'right' } },
    })
    const withY2 = {
      ...graph,
      axes: { ...graph.axes, y2: { ...graph.axes.y, type: 'continuous' as const } },
    }
    const scene = lay(grouped, withY2 as GraphNode)
    const ticks = nodes(scene, 'axis/y2/tickLabel/')
    expect(ticks.length).toBeGreaterThan(1)
    for (const t of ticks) expect(t.bbox!.y + t.bbox!.h).toBeLessThanOrEqual(scene.plot.y)
  })
})

describe('stacked grouped bars', () => {
  const grouped = sampleTable('grouped')

  it('piles positive centres up and negative ones down, in data set order', () => {
    const t = sampleTable('grouped')
    // Row 0: means 11 and 13 (both positive); make data set b negative in row 1.
    t.dataSets[1]!.subcolumns.forEach((s) => {
      s.values[1] = -(s.values[1] as number)
    })
    const g = graphOf(t, 'stacked')
    // Each data set's cells (one per row), stacked at their means.
    const d = {
      series: resolveSeries(projectOf(t, g), g).map((s) => ({
        cells: Array.from({ length: s.ds.rowCount }, (_, r) => cellStats(s.ds, r)),
        style: { center: { stat: 'mean' } } as Pick<ResolvedSeriesStyle, 'center'>,
      })),
    }
    const [a, b] = stackCells(d, false)
    expect(a![0]).toEqual({ start: 0, end: 11, k: 1, joined: [false, true] })
    expect(b![0]).toMatchObject({ start: 11, end: 11 + 43 / 3, joined: [true, false] })
    expect(a![1]).toMatchObject({ start: 0, end: 62 / 3, joined: [false, false] })
    expect(b![1]!.start).toBe(0)
    expect(b![1]!.end).toBeCloseTo(-79 / 3, 12)
    const pct = stackCells(d, true)
    const total = 11 + 43 / 3
    expect(pct[0]![0]!.end).toBeCloseTo((11 * 100) / total, 12)
    expect(pct[1]![0]!.end).toBeCloseTo(100, 12)
    expect(pct[0]![0]!.k).toBeCloseTo(100 / total, 12)
  })

  it('draws one bar per row with its segments, error bars on each segment’s end', () => {
    const scene = lay(grouped, graphOf(grouped, 'stacked'))
    const bar = (k: string, r: number) => prim(byId(scene, `series/${k}/bar/${r}`), 'rect')
    for (const r of [0, 1, 2]) {
      expect(bar('a', r).x).toBeCloseTo(bar('b', r).x, 9)
      // b sits on top of a.
      expect(bar('b', r).y + bar('b', r).h).toBeCloseTo(bar('a', r).y, 6)
    }
    const stem = prim(byId(scene, 'series/b/error/0/0'), 'line')
    expect(Math.max(stem.y1, stem.y2)).toBeCloseTo(bar('b', 0).y, 6)
    // The axis reaches the stacks' tops.
    const top = scene.axes!.y.fromPx(bar('b', 1).y)
    expect(top).toBeCloseTo(62 / 3 + 79 / 3, 6)
  })

  it('leaves gaps between segments and makes percent stacks reach 100', () => {
    const stacked = withoutLayers(graphOf(grouped, 'stacked'), 'error')
    const scene = lay(
      grouped,
      withLayer(stacked, 'bars', { position: { kind: 'stack', percent: true, gap: 3 } }),
    )
    const bar = (k: string, r: number) => prim(byId(scene, `series/${k}/bar/${r}`), 'rect')
    expect(bar('a', 0).y - (bar('b', 0).y + bar('b', 0).h)).toBeCloseTo(3, 6)
    expect(scene.axes!.y.fromPx(bar('b', 0).y)).toBeCloseTo(100, 6)
    expect(scene.axes!.y.fromPx(bar('a', 0).y + bar('a', 0).h)).toBeCloseTo(0, 6)
  })

  it('comes from presets and only on bar graphs', () => {
    const g = graphOf(grouped, 'points')
    const s = applyPreset(g, 'stackedPercent', grouped)
    expect(s.look).toBe('grouped.bar')
    expect(layerOf(s, 'bars').position).toEqual({ kind: 'stack', percent: true })
    expect(layerOf(applyPreset(s, 'stacked', grouped), 'bars').position).toEqual({ kind: 'stack' })
    expect(layerOf(applyPreset(s, 'bars', grouped), 'bars').position).toEqual({ kind: 'dodge' })
    const dots = applyPreset(s, 'points', grouped)
    expect(dots.layers.filter((l) => l.position?.kind === 'stack')).toEqual([])
    // Back to a dot plot: its points side by side again.
    expect(nodes(lay(grouped, dots), 'series/a/point/').length).toBeGreaterThan(0)
    // Only bars (and XY areas) stack.
    expect(positionAllowed('grouped', 'bar', { kind: 'stack' }).allowed).toBe(true)
    expect(positionAllowed('grouped', 'points', { kind: 'stack' }).allowed).toBe(false)
  })
})

describe('bar baselines', () => {
  const column = sampleTable('column')
  it('starts bars at the baseline, up or down, error bars pointing away from it', () => {
    const scene = lay(
      column,
      withLayer(graphOf(column, 'bars'), 'bars', { style: { baseline: 15 } }),
    )
    const y = scene.axes!.y
    const bar = (k: string) => prim(byId(scene, `series/${k}/bar`), 'rect')
    // Control (13.5) and Drug B (10) go down from 15, Drug A (19.5) up.
    expect(y.fromPx(bar('a').y)).toBeCloseTo(15, 6)
    expect(y.fromPx(bar('a').y + bar('a').h)).toBeCloseTo(13.5, 6)
    expect(y.fromPx(bar('b').y + bar('b').h)).toBeCloseTo(15, 6)
    const stem = (k: string) => prim(byId(scene, `series/${k}/error/0`), 'line')
    // 'above' (the bar default) points away from the baseline: down for bars below it.
    expect(y.fromPx(Math.max(stem('c').y1, stem('c').y2))).toBeLessThan(10)
    expect(y.fromPx(Math.min(stem('b').y1, stem('b').y2))).toBeGreaterThan(19.5)
  })
  it('widens the axis to the baseline and applies to grouped and XY bars', () => {
    const scene = lay(
      column,
      withLayer(graphOf(column, 'bars'), 'bars', { style: { baseline: 40 } }),
    )
    expect(scene.axes!.y.fromPx(scene.plot.y)).toBeGreaterThanOrEqual(40)
    const grouped = sampleTable('grouped')
    const g = lay(grouped, withLayer(graphOf(grouped, 'bars'), 'bars', { style: { baseline: 12 } }))
    const r = prim(byId(g, 'series/a/bar/0'), 'rect')
    expect(g.axes!.y.fromPx(r.y)).toBeCloseTo(12, 6)
    const xy = sampleTable('xy')
    const x = lay(
      xy,
      // Mean ± SD with bars at the means behind the rest.
      addLayers(
        graphOf(xy, 'meanSd'),
        [
          {
            id: 'bars',
            geom: 'bar',
            stat: { kind: 'summary', center: 'mean' },
            style: { baseline: 2 },
          },
        ],
        0,
      ),
    )
    const xr = prim(nodes(x, 'series/a/bar/')[0], 'rect')
    // The first point (1.2) is below the baseline: its bar hangs down from 2.
    expect(x.axes!.y.fromPx(xr.y)).toBeCloseTo(2, 6)
    expect(x.axes!.y.fromPx(xr.y + xr.h)).toBeCloseTo(1.2, 6)
  })
})
