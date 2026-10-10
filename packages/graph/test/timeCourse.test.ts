import type { DataTable, GraphNode, Layer } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  grandMeanOf,
  layoutGraph,
  mixColor,
  type Scene,
  sceneToSvg,
  statsOfPoints,
} from '../src/index.ts'
import { addLayers, graphOf, withLayer, withoutLayers } from './graphs.ts'
import { byId, fonts, nodes, prim, projectOf, sampleTable } from './helpers.ts'

// Roadmap 30b: XY time-course options (spaghetti lines, gaps, envelopes, areas, X error bars,
// boxes at each X), geometric error bars, whisker percentiles and the grand mean line.

const MEAN = { kind: 'summary', center: 'mean' } as const

const lay = (table: DataTable, graph: GraphNode): Scene => {
  const scene = layoutGraph({ project: projectOf(table, graph), graph, fonts })
  expect(sceneToSvg(scene)).not.toContain('NaN')
  return scene
}

/** The sample XY table (X 0–5, two data sets of duplicates) with X errors and a missing row. */
function gappy(): DataTable {
  const t = structuredClone(sampleTable('xy'))
  for (const s of t.dataSets[0]!.subcolumns) s.values[3] = null
  t.x = {
    ...t.x!,
    xFormat: 'numbersWithError',
    subcolumns: [t.x!.subcolumns[0]!, { type: 'number', values: [0.2, 0.3, 0.1, 0.4, null, 0.3] }],
  }
  return t
}

describe('XY lines', () => {
  it('joins across a missing value by default and breaks there with gaps', () => {
    const t = gappy()
    const g = graphOf(t, 'meanSdJoined')
    const joined = lay(t, g)
    expect(nodes(joined, 'series/a/line/')).toHaveLength(1)
    expect(prim(byId(joined, 'series/a/line/0'), 'polyline').points).toHaveLength(5)
    const broken = lay(t, withLayer(g, 'line', { style: { gaps: true } }))
    const runs = nodes(broken, 'series/a/line/').map((n) => prim(n, 'polyline').points.length)
    expect(runs).toEqual([3, 2])
    // The other data set has no gap.
    expect(nodes(broken, 'series/b/line/')).toHaveLength(1)
  })

  it('draws a faded line through each replicate, behind the mean line', () => {
    const t = sampleTable('xy')
    // Drawn by data set, to see the order of each data set's marks.
    const g = withLayer(graphOf(t, 'spaghetti'), 'subjects', { style: { fade: 0.5 } })
    const scene = lay(t, { ...g, drawOrder: 'series' })
    const subjects = nodes(scene, 'series/a/subject/')
    expect(subjects).toHaveLength(2)
    const line = prim(subjects[0], 'polyline')
    expect(line.points).toHaveLength(6)
    expect(line.stroke.color).toBe(mixColor('#0072b2', '#ffffff', 0.5))
    // Its points are the first replicate's values.
    expect(scene.axes!.y.fromPx(line.points[1]![1])).toBeCloseTo(2.2, 9)
    const children = byId(scene, 'series/a')!.children!.map((n) => n.id)
    expect(children.indexOf('series/a/subject/0/0')).toBeLessThan(
      children.indexOf('series/a/line/0'),
    )
  })

  it('shades the error as an envelope instead of error bars, broken with the line', () => {
    const t = gappy()
    let g = graphOf(t, 'envelope')
    g = withLayer(g, 'envelope', {
      stat: { ...MEAN, error: 'range' },
      style: { opacity: 0.3, gaps: true },
    })
    g = withLayer(g, 'line', { style: { gaps: true } })
    g = withLayer(g, 'error', { style: { x: false } })
    const scene = lay(t, g)
    expect(nodes(scene, 'series/a/error/')).toHaveLength(0)
    const bands = nodes(scene, 'series/a/envelope/')
    expect(bands).toHaveLength(2)
    const band = prim(bands[0], 'polygon')
    expect(band.fill).toEqual({ color: '#0072b2', opacity: 0.3 })
    // Upper edge at the rows' maxima, lower at their minima (range error bars).
    const y = scene.axes!.y
    expect(y.fromPx(band.points[0]![1])).toBeCloseTo(1.4, 9)
    expect(y.fromPx(band.points.at(-1)![1])).toBeCloseTo(1, 9)
    // Drawn behind every data set's lines and points (its layer is first in the list).
    const layer = byId(scene, 'layer/envelope')!
    expect(layer.children!.length).toBe(3)
    expect(byId(scene, 'series')!.children![0]).toBe(layer)
  })

  it('fills the area under the line down to the baseline', () => {
    const t = sampleTable('xy')
    const areaLayer: Layer = { id: 'area', geom: 'area', stat: MEAN, style: { baseline: 2 } }
    const scene = lay(t, addLayers(graphOf(t, 'meanSdJoined'), [areaLayer], 0))
    const area = prim(byId(scene, 'series/a/area/0'), 'polygon')
    const y = scene.axes!.y
    expect(y.fromPx(area.points.at(-1)![1])).toBeCloseTo(2, 9)
    expect(y.fromPx(area.points.at(-2)![1])).toBeCloseTo(2, 9)
    expect(area.points).toHaveLength(8)
    expect(y.fromPx(area.points[0]![1])).toBeCloseTo(1.2, 9)
  })

  it('draws X error bars from the table’s X errors, and can hide them', () => {
    const t = gappy()
    const g = graphOf(t, 'meanSd')
    const scene = lay(t, g)
    const x = scene.axes!.x
    const bar = prim(byId(scene, 'series/b/xError/1/0'), 'line')
    expect(x.fromPx(bar.x1)).toBeCloseTo(0.7, 9)
    expect(x.fromPx(bar.x2)).toBeCloseTo(1.3, 9)
    expect(bar.y1).toBe(bar.y2)
    const cap = prim(byId(scene, 'series/b/xError/1/1'), 'line')
    expect(cap.x1).toBe(cap.x2)
    // No error on row 4; the axis reaches the widest bar.
    expect(byId(scene, 'series/b/xError/4/0')).toBeUndefined()
    expect(x.fromPx(scene.plot.x)).toBeLessThanOrEqual(-0.2)
    const off = lay(t, withLayer(g, 'error', { style: { x: false } }))
    expect(nodes(off, 'series/b/xError/')).toHaveLength(0)
    // A table without X errors draws none.
    const plain = sampleTable('xy')
    expect(nodes(lay(plain, graphOf(plain, 'meanSd')), 'series/a/xError/')).toHaveLength(0)
  })

  it('draws a box of the replicates at each X, with a box legend swatch', () => {
    const t = structuredClone(sampleTable('xy'))
    t.yFormat = { type: 'replicates', count: 4 }
    for (const d of t.dataSets)
      d.subcolumns.push(
        { type: 'number', values: d.subcolumns[0]!.values.map((v) => (v as number) + 1) },
        { type: 'number', values: d.subcolumns[1]!.values.map((v) => (v as number) - 1) },
      )
    const box: Layer = { id: 'box', geom: 'box', stat: { kind: 'boxplot', whiskers: 'p025p975' } }
    const scene = lay(t, addLayers(withoutLayers(graphOf(t, 'meanSd'), 'points'), [box], 0))
    const boxes = nodes(scene, 'series/a/box/').filter((n) => n.prim?.type === 'rect')
    expect(boxes).toHaveLength(6)
    const b = prim(boxes[0], 'rect')
    const s = statsOfPoints([1, 1.4, 2, 0.4].map((value, row) => ({ value, row })))
    expect(scene.axes!.y.fromPx(b.y + b.h)).toBeCloseTo(s.q1, 9)
    expect(scene.axes!.y.fromPx(b.y)).toBeCloseTo(s.q3, 9)
    expect(scene.axes!.x.fromPx(b.x + b.w / 2)).toBeCloseTo(0, 9)
    expect(nodes(scene, 'legend/a').some((n) => n.prim?.type === 'rect')).toBe(true)
  })

  it('comes from the spaghetti and envelope presets, which other presets turn off', () => {
    const t = sampleTable('xy')
    const g = graphOf(t, 'meanSd')
    const sp = applyPreset(g, 'spaghetti', t)
    const ids = (graph: GraphNode) => graph.layers.map((l) => l.id)
    expect(ids(sp)).toEqual(expect.arrayContaining(['subjects', 'line']))
    expect(sp.layers.some((l) => l.geom === 'errorbar')).toBe(false)
    const env = applyPreset(sp, 'envelope', t)
    expect(ids(env)).not.toContain('subjects')
    expect(ids(env)).toContain('envelope')
    expect(ids(applyPreset(env, 'meanSd', t))).not.toContain('envelope')
  })
})

describe('geometric error bars and the grand mean', () => {
  const column = sampleTable('column')
  it('centres on the geometric mean with its SD factor', () => {
    let g = graphOf(column, 'points')
    g = withLayer(g, 'center', { stat: { kind: 'summary', center: 'geomean' } })
    g = withLayer(g, 'error', { stat: { kind: 'summary', center: 'geomean', error: 'geoSD' } })
    const scene = lay(column, g)
    const s = statsOfPoints([12, 15, 11, 14, 13, 16].map((value, row) => ({ value, row })))
    const y = scene.axes!.y
    const centre = prim(byId(scene, 'series/a/center'), 'line')
    expect(y.fromPx(centre.y1)).toBeCloseTo(s.gmean, 9)
    const stem = prim(byId(scene, 'series/a/error/0'), 'line')
    expect(y.fromPx(Math.min(stem.y1, stem.y2))).toBeCloseTo(s.gmean * s.gsdf, 9)
    expect(y.fromPx(Math.max(stem.y1, stem.y2))).toBeCloseTo(s.gmean / s.gsdf, 9)
    // XY graphs plot the geometric mean with geometric error bars.
    const xy = sampleTable('xy')
    let gx = graphOf(xy, 'meanSd')
    gx = withLayer(gx, 'error', { stat: { kind: 'summary', center: 'geomean', error: 'geoCI' } })
    gx = withLayer(gx, 'points', { stat: { kind: 'summary', center: 'geomean' } })
    const xs = lay(xy, gx)
    const p = prim(byId(xs, 'series/a/point/0'), 'symbol')
    expect(xs.axes!.y.fromPx(p.cy)).toBeCloseTo(Math.sqrt(1 * 1.4), 9)
  })

  it('draws a line across at the mean of every value, across a horizontal graph too', () => {
    const grandMean: Layer = {
      id: 'grandMean',
      geom: 'refline',
      stat: { kind: 'summary', center: 'mean', by: 'all' },
    }
    const graph = addLayers(graphOf(column, 'bars'), [grandMean], 0)
    const scene = lay(column, graph)
    const values = [12, 15, 11, 14, 13, 16, 18, 21, 17, 22, 20, 19, 9, 11, 10, 8, 12]
    const gm = values.reduce((a, b) => a + b) / values.length
    const line = prim(byId(scene, 'grandMean'), 'line')
    expect(scene.axes!.y.fromPx(line.y1)).toBeCloseTo(gm, 9)
    expect([line.x1, line.x2]).toEqual([scene.plot.x, scene.plot.x + scene.plot.w])
    expect(line.stroke).toMatchObject({ color: '#808080', dash: 'dash' })
    const turned = lay(column, { ...graph, style: { ...graph.style, orientation: 'horizontal' } })
    const v = prim(byId(turned, 'grandMean'), 'line')
    expect(v.x1).toBe(v.x2)
    expect(turned.axes!.x.fromPx(v.x1)).toBeCloseTo(gm, 9)
    // Entered means count by their N.
    expect(
      grandMeanOf([
        { stats: { ...statsOfPoints([]), raw: false, mean: 10, n: 3 } },
        { stats: { ...statsOfPoints([]), raw: false, mean: 20, n: 1 } },
      ]),
    ).toBe(12.5)
  })
})
