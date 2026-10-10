import type { DataTable, FigureStyle, GraphNode, Layer, NodeId, ResultStat } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  layerTitle,
  layoutLayers,
  lineEquation,
  makeAxisScale,
  presetGraph,
  resultName,
  type Scene,
  SLOPED_SAMPLES,
  slopedRuns,
  slopedSpans,
  slopedValues,
} from '../src/index.ts'
import { withValueAxis } from './axisExtrasCases.ts'
import { graphOf } from './graphs.ts'
import { byId, flatten, fonts, projectOf, sampleTable, sampleVariables } from './helpers.ts'
import { methodsTable, pairedTable, scatterWith, slopedLayer } from './identityLineCases.ts'

// Roadmap 46b: identity and reference lines y = a·x + b — edge to edge across the plot on linear,
// log, reversed and broken axes, nothing (and no error) where the line misses the plot, never
// widening the axes; their labels, legend entries, names and theme defaults.

const lay = (table: DataTable, graph: GraphNode): Scene =>
  layoutLayers({ project: projectOf(table), graph, fonts })

type Pt = [number, number]

/** A sloped layer's drawn polylines (scene coordinates). */
const runsOf = (scene: Scene, id = 'identity'): Pt[][] =>
  flatten(scene.root)
    .filter((n) => n.id.startsWith(`result/${id}/all/line`) && n.prim?.type === 'polyline')
    .map((n) => (n.prim as { points: Pt[] }).points)

/** Data values of a scene point. */
const data = (scene: Scene, [px, py]: Pt): Pt => [
  scene.axes!.x.fromPx(px),
  scene.axes!.y.fromPx(py),
]

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol

describe('the line’s geometry (slopedRuns)', () => {
  const W = 200
  const H = 100
  const lin = (lo: number, hi: number, range: [number, number], opts = {}) =>
    makeAxisScale('linear', [lo, hi], range, opts)

  it('runs corner to corner for y = x on −1…1 (straight: two points)', () => {
    const runs = slopedRuns(lin(-1, 1, [0, W]), lin(-1, 1, [H, 0]), 1, 0, W, H)
    expect(runs).toEqual([
      [
        [0, H],
        [W, 0],
      ],
    ])
  })

  it('stops at the plot’s edges where it leaves through the top or bottom', () => {
    // y = 2x + 0.5 leaves the top (y = 1) at x = 0.25 and enters the bottom at x = −0.75.
    const u = lin(-1, 1, [0, W])
    const v = lin(-1, 1, [H, 0])
    const [run] = slopedRuns(u, v, 2, 0.5, W, H)
    expect(run).toHaveLength(2)
    expect(run![0]![0]).toBeCloseTo(u(-0.75), 9)
    expect(run![0]![1]).toBeCloseTo(H, 9)
    expect(run![1]![0]).toBeCloseTo(u(0.25), 9)
    expect(run![1]![1]).toBeCloseTo(0, 9)
  })

  it('follows reversed axes', () => {
    const runs = slopedRuns(lin(-1, 1, [0, W], { reverse: true }), lin(-1, 1, [H, 0]), 1, 0, W, H)
    // x = −1 is now on the right, at the bottom.
    expect(runs).toEqual([
      [
        [W, H],
        [0, 0],
      ],
    ])
  })

  it('is straight on log–log axes for y = a·x, bent (and exact) with an intercept', () => {
    const u = makeAxisScale('log10', [1, 1000], [0, W])
    const v = makeAxisScale('log10', [1, 1000], [H, 0])
    expect(slopedRuns(u, v, 1, 0, W, H)).toEqual([
      [
        [0, H],
        [W, 0],
      ],
    ])
    const [bent] = slopedRuns(u, v, 2, 5, W, H)
    expect(bent).toHaveLength(SLOPED_SAMPLES + 1)
    for (const [px, py] of bent!) {
      const x = u.invert(px)
      expect(v.invert(py) / (2 * x + 5)).toBeCloseTo(1, 9)
    }
    // From the left edge (y = 7 at x = 1) to where it leaves the top (y = 1000 at x = 497.5).
    expect(bent![0]![0]).toBeCloseTo(0, 9)
    expect(u.invert(bent!.at(-1)![0])).toBeCloseTo(497.5, 6)
    expect(bent!.at(-1)![1]).toBeCloseTo(0, 6)
  })

  it('bends on a log Y axis against a linear X, inside the plot', () => {
    const u = lin(0, 10, [0, W])
    const v = makeAxisScale('log10', [0.1, 100], [H, 0])
    const [run] = slopedRuns(u, v, 1, 0, W, H)
    // y = x is below the axis' start (0.1) left of x = 0.1.
    expect(u.invert(run![0]![0])).toBeCloseTo(0.1, 9)
    expect(run![0]![1]).toBeCloseTo(H, 9)
    expect(run!.every(([px, py]) => px >= 0 && px <= W && py >= 0 && py <= H)).toBe(true)
  })

  it('breaks across an X axis break, each piece edge to edge', () => {
    const u = lin(0, 10, [0, W], { breaks: [{ from: 3, to: 6, gap: 10 }] })
    const v = lin(0, 10, [H, 0])
    const runs = slopedRuns(u, v, 1, 0, W, H)
    expect(runs).toHaveLength(2)
    expect(runs[0]![1]![0]).toBeCloseTo(u(3), 9)
    expect(runs[1]![0]![0]).toBeCloseTo(u(6), 9)
    expect(runs[1]![0]![0] - runs[0]![1]![0]).toBeCloseTo(10, 9)
    expect(slopedSpans(u, v, 1, 0)).toEqual([
      [0, 3],
      [6, 10],
    ])
  })

  it('breaks across a Y axis break', () => {
    const u = lin(0, 10, [0, W])
    const v = lin(0, 10, [H, 0], { breaks: [{ from: 4, to: 8, gap: 8 }] })
    const runs = slopedRuns(u, v, 1, 0, W, H)
    expect(runs).toHaveLength(2)
    expect(runs.flat().every(([, py]) => Number.isFinite(py))).toBe(true)
    expect(slopedSpans(u, v, 1, 0)).toEqual([
      [0, 4],
      [8, 10],
    ])
  })

  it('draws nothing (and never throws) where the line misses the plot or isn’t a number', () => {
    const u = lin(-1, 1, [0, W])
    const v = lin(-1, 1, [H, 0])
    expect(slopedRuns(u, v, 1, 100, W, H)).toEqual([])
    expect(slopedRuns(u, v, 0, 5, W, H)).toEqual([])
    expect(slopedRuns(u, v, Number.NaN, 0, W, H)).toEqual([])
    expect(slopedRuns(u, v, 1, Number.POSITIVE_INFINITY, W, H)).toEqual([])
    expect(slopedRuns(u, v, 1e-300, 0.5, W, H)).toEqual([
      [
        [0, H * 0.25],
        [W, H * 0.25],
      ],
    ])
    // Negative values on log axes: none.
    const lu = makeAxisScale('log10', [1, 100], [0, W])
    const lv = makeAxisScale('log10', [1, 100], [H, 0])
    expect(slopedRuns(lu, lv, -1, 0, W, H)).toEqual([])
    // Horizontal: across the whole plot.
    expect(slopedRuns(u, v, 0, 0, W, H)).toEqual([
      [
        [0, H / 2],
        [W, H / 2],
      ],
    ])
  })
})

describe('identity lines on graphs', () => {
  const paired = pairedTable()

  it('draws y = x edge to edge on a −1…1 scatter, through (−1, −1) and (1, 1)', () => {
    const scene = lay(paired, scatterWith(paired, [slopedLayer()], -1, 1))
    expect(scene.warnings).toEqual([])
    const runs = runsOf(scene)
    expect(runs).toHaveLength(1)
    const [a, b] = [data(scene, runs[0]![0]!), data(scene, runs[0]!.at(-1)!)]
    expect(near(a[0], -1) && near(a[1], -1)).toBe(true)
    expect(near(b[0], 1) && near(b[1], 1)).toBe(true)
  })

  it('never widens the axes: a line far off the data leaves the ticks as they were', () => {
    const plain = graphOf(paired, 'meanSd')
    const ticks = (s: Scene) =>
      flatten(s.root)
        .filter((n) => /^axis\/[xy]\/tickLabel\//.test(n.id))
        .map((n) => n.id)
    const off = lay(paired, {
      ...plain,
      layers: [slopedLayer('identity', 1, 100), ...plain.layers],
    })
    const before = lay(paired, plain)
    expect(ticks(off)).toEqual(ticks(before))
    expect(off.axes!.y.toPx(0)).toBe(before.axes!.y.toPx(0))
    expect(runsOf(off)).toEqual([])
    expect(off.warnings).toEqual([])
  })

  it('follows the slope and intercept (y = 2x + 1) and the X axis reversed', () => {
    const g = scatterWith(paired, [slopedLayer('identity', 2, 1)], -1, 1)
    for (const graph of [g, withValueAxis(g, 'x', { reverse: true })]) {
      const scene = lay(paired, graph)
      const pts = runsOf(scene).flat()
      expect(pts.length).toBeGreaterThan(1)
      for (const p of pts) {
        const [x, y] = data(scene, p)
        expect(y).toBeCloseTo(2 * x + 1, 6)
      }
      // From the bottom edge (y = −1 at x = −1) to the top (y = 1 at x = 0).
      const xs = pts.map((p) => data(scene, p)[0]).sort((p, q) => p - q)
      expect(xs[0]).toBeCloseTo(-1, 6)
      expect(xs.at(-1)).toBeCloseTo(0, 6)
    }
  })

  it('is exact on log axes and cut at a broken axis', () => {
    const methods = methodsTable()
    const base = scatterWith(methods, [slopedLayer('identity', 1, 0.5)], 0.5, 10)
    const log = withValueAxis(withValueAxis(base, 'x', { scale: 'log10' }), 'y', {
      scale: 'log10',
    })
    const scene = lay(methods, log)
    expect(scene.warnings).toEqual([])
    for (const p of runsOf(scene).flat()) {
      const [x, y] = data(scene, p)
      expect(y / (x + 0.5)).toBeCloseTo(1, 6)
    }
    const broken = withValueAxis(base, 'x', { breaks: [{ from: 3.5, to: 4.5, gap: 6 }] })
    const cut = lay(methods, broken)
    expect(runsOf(cut)).toHaveLength(2)
  })

  it('draws on a scatter of two variables (graphs of variables’ XY frame) and survival curves', () => {
    const survival = sampleTable('survival')
    const sg = graphOf(survival, 'survival')
    const s = lay(survival, { ...sg, layers: [...sg.layers, slopedLayer('identity', -10, 100)] })
    expect(runsOf(s).length).toBe(1)
    expect(s.warnings).toEqual([])
    const vars = sampleVariables()
    const mv = { ...presetGraph(vars, 'bubble'), id: 'g1' as NodeId }
    const scene = lay(vars, { ...mv, layers: [...mv.layers, slopedLayer('identity', 0, 0)] })
    expect(runsOf(scene).length).toBe(1)
    expect(scene.warnings.some((w) => w.includes('two continuous axes'))).toBe(false)
  })

  it('warns (and draws nothing) on a graph without two continuous axes', () => {
    const column = sampleTable('column')
    const g = graphOf(column, 'barsPoints')
    const scene = lay(column, { ...g, layers: [...g.layers, slopedLayer()] })
    expect(runsOf(scene)).toEqual([])
    expect(scene.warnings.some((w) => w.includes('two continuous axes'))).toBe(true)
  })

  it('takes the theme’s reference line (dashed grey; a style’s data line width), its own over it', () => {
    const g = scatterWith(paired, [slopedLayer()], -1, 1)
    const stroke = (s: Scene) =>
      flatten(s.root).find((n) => n.id === 'result/identity/all/line')!.prim as {
        stroke: { color: string; width: number; dash?: unknown }
      }
    const plain = stroke(lay(paired, g)).stroke
    expect(plain.color).toBe('#808080')
    expect(plain.width).toBe(1)
    const style: FigureStyle = { lines: { dataLine: 2 } }
    const styled = layoutLayers({
      project: { ...projectOf(paired), settings: { ...projectOf(paired).settings, style } },
      graph: g,
      fonts,
    })
    expect(stroke(styled).stroke.width).toBe(2)
    const own = scatterWith(paired, [slopedLayer('identity', 1, 0, { line: { width: 3 } })], -1, 1)
    expect(stroke(lay(paired, own)).stroke).toMatchObject({ color: '#808080', width: 3 })
  })

  it('draws its label inside the plot at its start or end', () => {
    for (const lineLabel of ['start', 'end'] as const) {
      const g = scatterWith(
        paired,
        [slopedLayer('identity', 1, 0, { template: 'y = x', lineLabel })],
        -1,
        1,
      )
      const scene = lay(paired, g)
      const label = byId(scene, 'result/identity/all/lineLabel')!
      const b = label.bbox!
      const p = scene.plot
      expect(b.x).toBeGreaterThanOrEqual(p.x - 1e-6)
      expect(b.y).toBeGreaterThanOrEqual(p.y - 1e-6)
      expect(b.x + b.w).toBeLessThanOrEqual(p.x + p.w + 1e-6)
      expect(b.y + b.h).toBeLessThanOrEqual(p.y + p.h + 1e-6)
      // Near its end of the line.
      const near = lineLabel === 'start' ? p.x : p.x + p.w
      expect(Math.min(Math.abs(b.x - near), Math.abs(b.x + b.w - near))).toBeLessThan(10)
    }
  })

  it('has a legend entry when shown (hidden by default), its sample rising with the slope', () => {
    const shown = (l: Layer) => {
      const g = scatterWith(paired, [l], -1, 1)
      return lay(paired, { ...g, legend: { ...g.legend, show: true } })
    }
    expect(byId(shown(slopedLayer()), 'legend/result/identity')).toBeUndefined()
    const scene = shown(slopedLayer('identity', 1, 0, { legend: 'auto' }))
    const line = byId(scene, 'legend/result/identity/line')!.prim as { y1: number; y2: number }
    expect(line.y1).toBeGreaterThan(line.y2)
    const falling = shown(slopedLayer('identity', -1, 0, { legend: 'auto' }))
    const down = byId(falling, 'legend/result/identity/line')!.prim as { y1: number; y2: number }
    expect(down.y1).toBeLessThan(down.y2)
  })
})

describe('names and equations', () => {
  it('writes the equation', () => {
    expect(lineEquation(1, 0)).toBe('y = x')
    expect(lineEquation(2, 1)).toBe('y = 2x + 1')
    expect(lineEquation(-1, -0.5)).toBe('y = −x − 0.5')
    expect(lineEquation(0.333333, 0)).toBe('y = 0.3333x')
    expect(lineEquation(0, 4)).toBe('y = 4')
    expect(lineEquation(0, -4)).toBe('y = −4')
    expect(lineEquation(Number.NaN, 0)).toBe('y = a·x + b')
  })

  it('names the layer and its legend entry by its equation (or label)', () => {
    const l = slopedLayer()
    expect(layerTitle(l, 'xy')).toBe('Identity line (y = x)')
    expect(layerTitle(slopedLayer('ref', 2, -1), 'xy')).toBe('Reference line (y = 2x − 1)')
    expect(resultName(slopedLayer('ref', 2, -1) as never)).toBe('y = 2x − 1')
    expect(resultName(slopedLayer('ref', 2, -1, { template: 'Fit' }) as never)).toBe('Fit')
    expect(slopedValues((l as unknown as { stat: ResultStat }).stat)).toEqual({ a: 1, b: 0 })
  })
})
