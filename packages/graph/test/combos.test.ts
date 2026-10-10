import {
  type GraphNode,
  GraphNode as GraphNodeSchema,
  type Layer,
  normalizeDataSet,
} from '@ps/model'
import { histogram } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import {
  binValues,
  checkLayers,
  layoutGraph,
  presetGraph,
  type Scene,
  type SceneNode,
  sceneToSvg,
} from '../src/index.ts'
import { builtGraph, comboCases, histogramTable } from './goldenCases.ts'
import { flatten, fonts, nodes, prim, projectOf, sampleTable } from './helpers.ts'

// The combinations of roadmap 33d (each a golden too): valid by the matrix, drawn without
// warnings, and drawn as they mean; and drawing by layer stacking every layer, frame-drawn ones
// included, in the list's order.

const layout = (table: Parameters<typeof projectOf>[0], graph: GraphNode) =>
  layoutGraph({ project: projectOf(table, graph), graph, fonts })

describe('roadmap 33d combinations', () => {
  it.each(comboCases())('%s: valid, allowed by the matrix, drawn without warnings', (_, t, g) => {
    expect(() => GraphNodeSchema.parse(g)).not.toThrow()
    for (const [id, a] of checkLayers(g, t.tableKind, { raw: true }))
      expect(a, id).toEqual({ allowed: true })
    expect(layout(t, g).warnings).toEqual([])
  })

  const combo = (name: string) => comboCases().find(([n]) => n === name)!

  it('a mean symbol over every value: a second points layer, its ids `point@<layer>`', () => {
    const [, t, g] = combo('combo-column-points-mean-symbol')
    const ids = flatten(layout(t, g).root).map((n) => n.id)
    expect(ids).toContain('series/a/point/0')
    expect(ids).toContain('series/a/point@means')
    expect(nodes(layout(t, g), 'series/b/point@means')).toHaveLength(1)
  })

  it('a line through the means joins the categories at their means', () => {
    const [, t, g] = combo('combo-column-join-means')
    const scene = layout(t, g)
    const line = prim(nodes(scene, 'means/')[0], 'polyline')
    expect(line.points).toHaveLength(3)
    // At each category's centre line.
    for (const key of ['a', 'b', 'c']) {
      const c = prim(nodes(scene, `series/${key}/center`)[0], 'line')
      expect(
        line.points.some(([x, y]) => Math.abs(x - (c.x1 + c.x2) / 2) < 1e-9 && y === c.y1),
      ).toBe(true)
    }
  })

  it('histogram bars: the stats package’s bins, as counts or percents', () => {
    const t = histogramTable()
    const want = histogram(
      t.dataSets.map((d) => d.subcolumns[0]!.values.filter((v): v is number => v !== null)),
    )
    const [, , g] = combo('combo-column-histogram')
    const scene = layout(t, g)
    const bars = nodes(scene, 'series/a/bar/')
    expect(bars).toHaveLength(want.values[0]!.filter((v) => v > 0).length)
    // The heights are in proportion to the counts.
    const h = bars.map((b) => prim(b, 'rect').h)
    const counts = want.values[0]!.filter((v) => v > 0)
    h.forEach((x, i) => {
      expect(x / h[0]!).toBeCloseTo(counts[i]! / counts[0]!, 9)
    })
    // The values binned: every value of the data set.
    expect(binValues(normalizeDataSet(t, t.dataSets[0]!))).toHaveLength(40)
    const [, , pct] = combo('combo-column-histogram-percent-width')
    const p = pct.layers[0]!
    expect(p.stat).toEqual({ kind: 'bin', measure: 'percent', width: 5 })
    expect(layout(t, pct).warnings).toEqual([])
  })

  it('stacked areas: each data set’s band starts where the one before ends', () => {
    const [, t, g] = combo('combo-xy-stacked-areas')
    const scene = layout(t, g)
    const [a, b] = ['a', 'b'].map((k) => prim(nodes(scene, `series/${k}/area/`)[0], 'polygon'))
    const n = a!.points.length / 2
    // a's top edge is b's bottom edge (reversed).
    expect(b!.points.slice(n).reverse()).toEqual(a!.points.slice(0, n))
  })

  it('100% stacked bars label each segment with its share of the row', () => {
    const [, t, g] = combo('combo-grouped-percent-labels')
    const svg = sceneToSvg(layout(t, g))
    // Each label: the percent, then the sign (its own run).
    for (const text of ['43.4', '56.6', '46.5', '53.5']) expect(svg).toContain(`>${text}<`)
    expect(svg.match(/>%</g)).toHaveLength(6)
  })

  it('a step line climbs level to each X, then up', () => {
    const [, t, g] = combo('combo-xy-step')
    const step = prim(nodes(layout(t, g), 'series/a/step/')[0], 'polyline')
    for (let i = 1; i < step.points.length; i += 2)
      expect(step.points[i]![1]).toBe(step.points[i - 1]![1])
  })

  it('lines by group: one line per group, in the colour legend’s colours', () => {
    const [, t, g] = combo('combo-mv-scatter-colour-group-lines')
    const lines = nodes(layout(t, g), 'series/b/line/')
    expect(lines).toHaveLength(2)
  })
})

/** The order of layers' groups in a scene drawn by layer (`layer/<id>`, front last). */
function layerOrder(scene: Scene): string[] {
  return flatten(scene.root)
    .filter((n) => n.id.startsWith('layer/') && hasMarks(n))
    .map((n) => n.id.slice('layer/'.length))
}
const hasMarks = (n: SceneNode): boolean => !!n.prim || (n.children ?? []).some(hasMarks)

/** The graph with layer `id` moved to the end of the list (the front). */
const toFront = (g: GraphNode, id: string): GraphNode => {
  const l = g.layers.find((x) => x.id === id)!
  return { ...g, layers: [...g.layers.filter((x) => x !== l), l] }
}
/** The graph with layer `id` moved to the start of the list (the back). */
const toBack = (g: GraphNode, id: string): GraphNode => {
  const l = g.layers.find((x) => x.id === id)!
  return { ...g, layers: [l, ...g.layers.filter((x) => x !== l)] }
}

describe('drawing by layer: every layer in the list’s order (frame-drawn ones too)', () => {
  /** [what, table, graph, a layer, another]: moving `a` behind or in front of `b` moves it. */
  const cases: [string, Parameters<typeof projectOf>[0], GraphNode, string, string][] = (() => {
    const column = sampleTable('column')
    const grouped = sampleTable('grouped')
    const xy = sampleTable('xy')
    const survival = sampleTable('survival')
    const whole = sampleTable('partsOfWhole')
    const contingency = sampleTable('contingency')
    const [, mv, scatter] = comboCases().find(([n]) => n.startsWith('combo-mv'))!
    const estimation = presetGraph(column, 'estimation')
    const survivalBand: GraphNode = (() => {
      const g = presetGraph(survival, 'survival')
      const band: Layer = { id: 'ciBand', geom: 'band', stat: { kind: 'km' } }
      return { ...g, layers: [band, ...g.layers] }
    })()
    return [
      [
        'category: before-after lines',
        column,
        builtGraph(column, 'category', ['points', 'pairs']),
        'pairs',
        'points',
      ],
      [
        'category: grand mean',
        column,
        builtGraph(column, 'category', ['points', 'grandMean']),
        'grandMean',
        'points',
      ],
      ['category: differences', column, estimation, 'diff', 'points'],
      [
        'category: line through the means',
        column,
        builtGraph(column, 'category', ['points', 'joinMeans']),
        'line',
        'points',
      ],
      [
        'grouped: band',
        grouped,
        builtGraph(grouped, 'grouped', ['points', 'band'], { kind: 'dodge' }),
        'envelope',
        'points',
      ],
      ['xy: error band', xy, presetGraph(xy, 'envelope'), 'envelope', 'points'],
      ['xy: area', xy, builtGraph(xy, 'xy', ['points', 'area']), 'area', 'points'],
      ['survival: CI band', survival, survivalBand, 'ciBand', 'curve'],
      [
        'matrix: cell values',
        contingency,
        builtGraph(
          contingency,
          'matrix',
          ['labels'],
          undefined,
          presetGraph(contingency, 'heatmap').layers,
        ),
        'values',
        'cells',
      ],
      ['bubbles: lines by group', mv, scatter, 'groupLines', 'bubbles'],
      ['polar: slice labels', whole, presetGraph(whole, 'pie'), 'labels', 'slices'],
    ]
  })()

  it.each(cases)('%s', (_, table, graph, a, b) => {
    expect(graph.drawOrder ?? 'layer').toBe('layer')
    const front = layerOrder(layout(table, toFront(graph, a)))
    expect(front.indexOf(a), front.join()).toBeGreaterThan(front.indexOf(b))
    const back = layerOrder(layout(table, toBack(graph, a)))
    expect(back.indexOf(a), back.join()).toBeLessThan(back.indexOf(b))
    expect(back.indexOf(b)).toBeGreaterThanOrEqual(0)
  })
})
