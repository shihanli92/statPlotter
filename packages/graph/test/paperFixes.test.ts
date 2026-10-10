import type { ContinuousAxisSpec, DataTable, GraphNode } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  COLOR_MAPS,
  coarserStep,
  colorAlong,
  colorAt,
  continuousColor,
  continuousDomain,
  defaultContinuousAxis,
  Extent,
  heatScale,
  layoutGraph,
  mixColor,
  niceLogDomain,
  type Scene,
  type SceneNode,
  TICK_LABEL_GAP,
} from '../src/index.ts'
import { barErrorDirection } from '../src/layers/geoms/errorbar.ts'
import { heatTable, meanSemColumn, signedGrouped } from './goldenCases.ts'
import { graphOf, withLayer } from './graphs.ts'
import { fixedTable, flatten, fonts, nodes, prim, projectOf } from './helpers.ts'

// Bugs found rebuilding paper figures (docs/design/PAPER_PANELS.md, "Bugs found"): error bars of
// negative bars, crowded automatic ticks, heat maps ignoring a two-colour scale.

const lay = (table: DataTable, graph: GraphNode): Scene =>
  layoutGraph({ project: projectOf(table, graph), graph, fonts })

const horizontal = (g: GraphNode): Partial<GraphNode> => ({
  style: { ...g.style, orientation: 'horizontal' },
})

/** The drawn nodes of a data set's error bars or bars (`row`: a grouped graph's row). */
function marks(s: Scene, key: string, part: 'error' | 'bar', row?: number): SceneNode[] {
  return flatten(s.root).filter((n) => {
    const [series, k, p, r] = n.id.split('/')
    return (
      n.prim &&
      series === 'series' &&
      k === key &&
      p === part &&
      (row === undefined || r === String(row))
    )
  })
}

/**
 * Where a bar's error bar reaches along the value axis relative to the bar's end, in units of
 * "away from the base": [nearest, farthest] (positive = beyond the bar's end, away from its base).
 */
function reach(s: Scene, key: string, value: number, turned: boolean, row?: number) {
  const r = prim(marks(s, key, 'bar', row)[0], 'rect')
  // Plot-local value positions grow up (vertical: y down) or right (horizontal).
  const [lo, hi] = turned ? [r.x, r.x + r.w] : [r.y + r.h, r.y]
  // The bar's end is its high side for a positive value, its low side for a negative one.
  const end = value >= 0 ? hi : lo
  const away = (p: number) => (value >= 0 ? 1 : -1) * (turned ? p - end : end - p)
  const ps = marks(s, key, 'error', row).flatMap((n) => {
    const l = prim(n, 'line')
    return turned ? [l.x1, l.x2] : [l.y1, l.y2]
  })
  expect(ps.length).toBeGreaterThan(0)
  const a = ps.map(away)
  return [Math.min(...a), Math.max(...a)] as const
}

describe('error bars of bars point away from the bar’s base', () => {
  it('flips above / below for a value below the base; both and no bar stay', () => {
    expect(barErrorDirection('above', -2, 0)).toBe('below')
    expect(barErrorDirection('below', -2, 0)).toBe('above')
    expect(barErrorDirection('both', -2, 0)).toBe('both')
    expect(barErrorDirection('above', 2, 0)).toBe('above')
    expect(barErrorDirection('above', 2, 5)).toBe('below')
    expect(barErrorDirection('above', -2, undefined)).toBe('above')
  })

  // The paper repro: one data set, mean −2, SEM 0.5, N 3, preset barsSem ('above', no baseline).
  it.each([false, true])('a negative bar’s error bar points down (horizontal: %s)', (turned) => {
    const t = meanSemColumn([-2], [0.5])
    const s = lay(t, graphOf(t, 'barsSem', turned ? horizontal : () => ({})))
    const [near, far] = reach(s, 'a', -2, turned)
    expect(near).toBeCloseTo(0, 6)
    expect(far).toBeGreaterThan(5)
  })

  it.each([
    ['above', 'away'],
    ['below', 'towards'],
    ['both', 'both ways'],
  ] as const)('direction %s goes %s from the base, either sign', (direction, way) => {
    const t = meanSemColumn([-2, 3], [0.5, 0.4])
    for (const turned of [false, true]) {
      const g = withLayer(graphOf(t, 'barsSem', turned ? horizontal : () => ({})), 'error', {
        style: { direction },
      })
      const s = lay(t, g)
      for (const [key, value] of [
        ['a', -2],
        ['b', 3],
      ] as const) {
        const [near, far] = reach(s, key, value, turned)
        if (way === 'away') expect([near, far > 1]).toEqual([expect.closeTo(0, 6), true])
        if (way === 'towards') expect([far, near < -1]).toEqual([expect.closeTo(0, 6), true])
        if (way === 'both ways') expect([near < -1, far > 1]).toEqual([true, true])
      }
    }
  })

  it('a chosen baseline: a bar below it points down, above it up', () => {
    const t = meanSemColumn([2, 8], [0.5, 0.5])
    const g = withLayer(graphOf(t, 'barsSem'), 'bars', { style: { baseline: 5 } })
    const s = lay(t, g)
    const rect = (k: string) => prim(marks(s, k, 'bar')[0], 'rect')
    const ys = (k: string) =>
      marks(s, k, 'error').flatMap((n) => [prim(n, 'line').y1, prim(n, 'line').y2])
    // 2 sits below the baseline 5: its bar hangs down from it and the error bar goes further down;
    // 8 stands above it, its error bar further up.
    expect(Math.min(...ys('a'))).toBeCloseTo(rect('a').y + rect('a').h, 6)
    expect(Math.max(...ys('a'))).toBeGreaterThan(rect('a').y + rect('a').h + 1)
    expect(Math.max(...ys('b'))).toBeCloseTo(rect('b').y, 6)
    expect(Math.min(...ys('b'))).toBeLessThan(rect('b').y - 1)
  })

  it.each([false, true])('grouped bars side by side (horizontal: %s)', (turned) => {
    const t = signedGrouped()
    const s = lay(t, graphOf(t, 'barsSem', turned ? horizontal : () => ({})))
    // Row 0: 4, −2, −1.5; row 1: −3, 5, 2.
    const cells = [
      ['a', 0, 4],
      ['b', 0, -2],
      ['c', 0, -1.5],
      ['a', 1, -3],
      ['b', 1, 5],
    ] as const
    for (const [key, row, value] of cells) {
      const [near, far] = reach(s, key, value, turned, row)
      expect(near).toBeCloseTo(0, 6)
      expect(far).toBeGreaterThan(1)
    }
  })

  it.each([false, true])(
    'stacked bars: negative segments point down (horizontal: %s)',
    (turned) => {
      const t = signedGrouped()
      const s = lay(t, graphOf(t, 'stacked', turned ? horizontal : () => ({})))
      // Row 0 stacks 4 up, then −2 and −1.5 down from 0; the error bar sits on each segment's end.
      for (const [key, row, value] of [
        ['a', 0, 4],
        ['b', 0, -2],
        ['c', 0, -1.5],
        ['a', 1, -3],
        ['c', 1, 2],
      ] as const) {
        const [near, far] = reach(s, key, value, turned, row)
        expect(near).toBeCloseTo(0, 6)
        expect(far).toBeGreaterThan(1)
      }
    },
  )
})

/** A value axis' tick labels as drawn: their text and boxes, in order along the axis. */
function tickLabels(s: Scene, axis: 'x' | 'y') {
  const labels = nodes(s, `axis/${axis}/tickLabel/`).map((n) => {
    const p = prim(n, 'text')
    return { text: p.layout.runs.map((r) => r.text).join(''), box: n.bbox! }
  })
  return labels
}

/** The least room between neighbouring labels along the axis drawn `along` x or y. */
function leastGap(labels: ReturnType<typeof tickLabels>, along: 'x' | 'y'): number {
  const spans = labels
    .map(({ box }) => (along === 'x' ? [box.x, box.x + box.w] : [box.y, box.y + box.h]))
    .sort((a, b) => a[0]! - b[0]!)
  let least = Number.POSITIVE_INFINITY
  for (let i = 1; i < spans.length; i++) least = Math.min(least, spans[i]![0]! - spans[i - 1]![1]!)
  return least
}

/** Labels side by side keep half an em apart; stacked ones, their line boxes apart. */
const GAP = TICK_LABEL_GAP * 11 - 1e-6
const STACKED = -1e-6

describe('automatic ticks leave their labels room', () => {
  it('steps to the next nice step', () => {
    expect([1, 2, 2.5, 5, 10, 0.25, 0.5, 20, 50].map(coarserStep)).toEqual([
      2, 2.5, 5, 10, 20, 0.5, 1, 25, 100,
    ])
  })

  const axis = (patch: Partial<ContinuousAxisSpec> = {}) => ({
    ...defaultContinuousAxis(),
    ...patch,
  })
  const extent = (lo: number, hi: number, log = false) => {
    const e = new Extent(log)
    e.add(lo)
    e.add(hi)
    return e
  }

  it('makes automatic ticks coarser (and the range with them) until they fit', () => {
    const atMost = (n: number) => (v: readonly number[]) => v.length <= n
    const e = extent(-4, 12)
    expect(continuousDomain(axis(), e, true, []).ticks).toEqual([
      -5, -2.5, 0, 2.5, 5, 7.5, 10, 12.5,
    ])
    expect(continuousDomain(axis(), e, true, [], atMost(5)).ticks).toEqual([-5, 0, 5, 10, 15])
    const d = continuousDomain(axis(), e, true, [], atMost(4))
    expect([d.min, d.max, d.ticks]).toEqual([-10, 20, [-10, 0, 10, 20]])
    // Never coarser than a step spanning the data: three ticks at most, two steps of range.
    const most = continuousDomain(axis(), e, true, [], () => false)
    expect([most.min, most.max, most.ticks]).toEqual([-20, 20, [-20, 0, 20]])
    // A manual range keeps its ends; a manual interval is kept as set.
    const ranged = continuousDomain(axis({ range: { min: -4, max: 12 } }), e, true, [], atMost(4))
    expect([ranged.min, ranged.max, ranged.ticks]).toEqual([-4, 12, [0, 5, 10]])
    const manual = axis({ ticks: { interval: 2.5, minor: 0 } })
    expect(continuousDomain(manual, e, true, [], () => false).ticks).toEqual([
      -2.5, 0, 2.5, 5, 7.5, 10,
    ])
  })

  it('thins a log axis to every k-th power, the others kept as minor ticks', () => {
    const e = extent(1e-6, 1e6, true)
    const all = niceLogDomain(1e-6, 1e6, 10)
    const d = continuousDomain(axis({ scale: 'log10' }), e, true, [], (v) => v.length <= 5)
    expect(d.ticks).toEqual([1e-6, 1e-3, 1, 1e3, 1e6])
    expect([d.min, d.max]).toEqual([all.min, all.max])
    expect(d.minorTicks).toContain(1e-5)
    expect(d.minorTicks).toHaveLength(all.minorTicks.length + 8)
  })

  // The paper repro: means from −4 to 10, barsSem horizontal, plot 150 × 270 pt.
  const narrow = () => meanSemColumn([-4, -1.5, 2, 6.5, 10, 3], [0.6, 0.9, 0.5, 1.1, 1.5, 0.7])
  const sized = (w: number, h: number, turned: boolean) => (g: GraphNode) => ({
    ...(turned ? horizontal(g) : {}),
    size: { ...g.size, plotWidth: w, plotHeight: h },
  })

  it('a narrow horizontal value axis ticks every 5, its labels apart', () => {
    const t = narrow()
    const s = lay(t, graphOf(t, 'barsSem', sized(150, 270, true)))
    const labels = tickLabels(s, 'y')
    expect(labels.map((l) => l.text)).toEqual(['−5', '0', '5', '10', '15'])
    expect(leastGap(labels, 'x')).toBeGreaterThanOrEqual(GAP)
    // With room for them, the usual ticks.
    const wide = tickLabels(lay(t, graphOf(t, 'barsSem', sized(420, 270, true))), 'y')
    expect(wide.map((l) => l.text)).toEqual([
      '−5.0',
      '−2.5',
      '0.0',
      '2.5',
      '5.0',
      '7.5',
      '10.0',
      '12.5',
    ])
    // Ticks set by hand are drawn as set, however crowded.
    const g = graphOf(t, 'barsSem', sized(150, 270, true))
    const manual = {
      ...g,
      axes: { ...g.axes, y: { ...g.axes.y, ticks: { interval: 2.5, minor: 0 } } },
    }
    expect(tickLabels(lay(t, manual as GraphNode), 'y').map((l) => l.text)).toEqual([
      '−2.5',
      '0.0',
      '2.5',
      '5.0',
      '7.5',
      '10.0',
    ])
  })

  it('a short vertical value axis, an XY graph’s narrow X and log axes', () => {
    const t = narrow()
    const short = tickLabels(lay(t, graphOf(t, 'barsSem', sized(150, 60, false))), 'y')
    expect(short.length).toBeGreaterThanOrEqual(2)
    expect(leastGap(short, 'y')).toBeGreaterThanOrEqual(STACKED)
    // XY: X from 0.001 to 1000 on a log axis, then 0–12345 linear, 80 pt wide.
    const xy = graphOf(sampleXY(), 'meanSd', (g) => ({
      size: { ...g.size, plotWidth: 80, plotHeight: 80 },
    }))
    for (const x of [
      { ...xy.axes.x, scale: 'log10' },
      { ...xy.axes.x, scale: 'linear' },
    ]) {
      const g = { ...xy, axes: { ...xy.axes, x } } as GraphNode
      const s = lay(sampleXY(x.scale === 'linear' ? 12345 : undefined), g)
      const xs = tickLabels(s, 'x')
      expect(xs.length).toBeGreaterThanOrEqual(2)
      expect(leastGap(xs, 'x')).toBeGreaterThanOrEqual(GAP)
      expect(leastGap(tickLabels(s, 'y'), 'y')).toBeGreaterThanOrEqual(STACKED)
    }
  })
})

/** An XY table of 7 rows, X from 10⁻³ to 10³ (`top` given: evenly from 0 to it), one Y each. */
function sampleXY(top?: number): DataTable {
  const x = [1e-3, 1e-2, 1e-1, 1, 10, 100, 1000].map((v, i) => (top ? (i / 6) * top : v))
  return fixedTable('xy', { type: 'replicates', count: 1 }, [[[1, 3, 2, 5, 4, 6, 5]]], { x })
}

describe('heat maps take a two-colour scale', () => {
  const pair: [string, string] = ['#fff8d0', '#e00000']

  it('colours along a map or between two colours, as number variables do', () => {
    expect(colorAlong('viridis', 0.3)).toBe(colorAt(COLOR_MAPS.viridis, 0.3))
    expect(colorAlong(pair, 0.25)).toBe(mixColor(pair[0], pair[1], 0.25))
    expect(colorAlong(pair, 0.25, true)).toBe(mixColor(pair[1], pair[0], 0.25))
    const c = continuousColor([0, 10], { colors: pair })
    expect(c.color(2.5)).toBe(colorAlong(pair, 0.25))
  })

  it('a heat scale between two colours (reversed when asked)', () => {
    const s = heatScale({ colors: pair }, [0, 5, 10])
    expect([s.color(0), s.color(10), s.color(5)]).toEqual([
      '#fff8d0',
      '#e00000',
      mixColor(pair[0], pair[1], 0.5),
    ])
    expect(Number.isNaN(s.mid)).toBe(true)
    expect(heatScale({ colors: pair, reverse: true }, [0, 10]).color(0)).toBe('#e00000')
  })

  it('the paper repro: cells and colour bar run from pale yellow to red', () => {
    const t = heatTable()
    const g = graphOf(t, 'heatmap')
    const s = lay(t, { ...g, scales: { ...g.scales, color: { colors: pair } } })
    const fill = (k: string, r: number) => prim(nodes(s, `series/${k}/cell/${r}`)[0], 'rect').fill
    // Smallest value 0.5 (d, row 0), largest 9.5 (d, row 1).
    expect(fill('d', 0)!.color).toBe('#fff8d0')
    expect(fill('d', 1)!.color).toBe('#e00000')
    expect(fill('a', 0)!.color).toBe(mixColor(pair[0], pair[1], 0.5 / 9))
    const bands = nodes(s, 'colorScale/band/').map((n) => prim(n, 'rect').fill!.color)
    expect(bands).toHaveLength(64)
    expect(bands[0]).toBe(mixColor(pair[0], pair[1], 0.5 / 64))
    expect(bands[63]).toBe(mixColor(pair[0], pair[1], 63.5 / 64))
  })
})
