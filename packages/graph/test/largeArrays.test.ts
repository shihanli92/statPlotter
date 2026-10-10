import type { DataTable, GraphNode, Layer, NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  bubbleSizer,
  layoutGraph,
  nodeBounds,
  type PointsPrim,
  presetGraph,
  primBounds,
  type Scene,
  type SceneNode,
  swarmOffsets,
  unionBoxes,
} from '../src/index.ts'
import { minMax } from '../src/minMax.ts'
import { appearanceTable, byId, flatten, fonts, projectOf } from './helpers.ts'

/**
 * `Math.max(...values)` overflows the call stack beyond ~120k values, so data-sized extremes are
 * found with loops. 300k values: more than any spread takes.
 */
const N = 300_000
const STROKE = { color: '#000000', width: 1, dash: 'solid' } as const
const ramp = Array.from({ length: N }, (_, i) => i)

describe('data-sized arrays (no argument spreading)', () => {
  it('minMax matches Math.min / Math.max, NaN and empty included', () => {
    expect(minMax([3, -1, 2])).toEqual([-1, 3])
    expect(minMax([])).toEqual([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
    expect(minMax([1, Number.NaN, 2])).toEqual([Number.NaN, Number.NaN])
    expect(minMax(ramp)).toEqual([0, N - 1])
  })

  it('bounds of a long polyline and of a group with many children', () => {
    const points = ramp.map((i): [number, number] => [i / 1000, (i % 500) / 10])
    expect(primBounds({ type: 'polyline', points, stroke: STROKE })).toEqual({
      x: 0,
      y: 0,
      w: (N - 1) / 1000,
      h: 49.9,
    })
    const children: SceneNode[] = ramp.map((i) => ({
      id: `p/${i}`,
      bbox: { x: i, y: -i, w: 1, h: 1 },
    }))
    const all = { x: 0, y: -(N - 1), w: N, h: N }
    expect(nodeBounds({ id: 'g', children })).toEqual(all)
    expect(unionBoxes(children.map((c) => c.bbox))).toEqual(all)
  })

  it('bubble sizes and swarm offsets of 300k values', () => {
    const size = bubbleSizer(ramp, 30, 2)
    expect(size(N - 1)).toBeCloseTo(30, 9)
    // Far apart, so no point moves and the swarm stays quick.
    const offsets = swarmOffsets(
      ramp.map((i) => i * 10),
      4,
      20,
    )
    expect(offsets).toHaveLength(N)
    expect(offsets.every((x) => x === 0)).toBe(true)
  })
})

// Audit 2 (G1): colour and size by a number variable over 150k rows. The legends' values came
// from `Math.min(...values)` over the rows drawn (a RangeError past ~120k); they now come from
// the scales' ranges, so a fixed colour or size range sets them too.
describe('variables mapped to appearance on 150k rows', () => {
  const ROWS = 150_000
  const big = (() => {
    const t = appearanceTable()
    const grow = <T>(xs: readonly T[]) =>
      Array.from({ length: ROWS }, (_, r) => xs[r % xs.length] as T)
    return {
      ...t,
      rowCount: ROWS,
      dataSets: t.dataSets.map((d) => ({
        ...d,
        ...(d.text ? { text: grow(d.text) } : {}),
        subcolumns: d.subcolumns.map((c) => ({ ...c, values: d.text ? c.values : grow(c.values) })),
      })),
    } as DataTable
  })()
  const labels = (s: Scene, aes: string) =>
    flatten(s.root)
      .filter((n) => new RegExp(`^legend/[^/]+/${aes}/\\d+/label$`).test(n.id))
      .map((n) => JSON.stringify(n).match(/"text":"([^"]*)"/)?.[1])
  const xy = (aes: NonNullable<Layer['aes']>, scales: GraphNode['scales'] = {}): GraphNode => {
    const g = presetGraph(big, 'bubble')
    const layers = g.layers.map((l) =>
      l.aes ? ({ ...l, aes: { x: 'c', y: 'd', ...aes } } as Layer) : l,
    )
    return { ...g, id: 'g1' as NodeId, layers, legend: { ...g.legend, show: true }, scales }
  }
  const draw = (g: GraphNode) => layoutGraph({ project: projectOf(big, g), graph: g, fonts })

  it('XY: colour by a number, its legend over the data, or over a fixed range', () => {
    expect(labels(draw(xy({ color: 'e' })), 'color')).toEqual(['30', '25', '20'])
    const fixed = draw(xy({ color: 'e' }, { color: { min: 0, max: 100 } }))
    expect(labels(fixed, 'color')).toEqual(['100', '50', '0'])
  })

  it('XY: size by a number, its legend over the data, or over a fixed range', () => {
    expect(labels(draw(xy({ size: 'e' })), 'size')).toEqual(['30', '25', '20'])
    const fixed = draw(xy({ size: 'e' }, { size: { low: 0, high: 100 } }))
    expect(labels(fixed, 'size')).toEqual(['100', '75', '25'])
  })

  // Audit 2 (G18): text variables mapped to colour and shape, as many rows.
  it('XY: colour and shape by a text variable, one paint per level (and missing)', () => {
    const s = draw(xy({ color: 'f', shape: 'f' }))
    expect(labels(s, 'color')).toEqual(['South', 'North'])
    expect(byId(s, 'legend/bubble/color/missing/label')).toBeDefined()
    // One cloud of every row with both numbers, a paint for each level and one for no level.
    const cloud = flatten(s.root).find((n) => n.prim?.type === 'points')!.prim as PointsPrim
    const [c, d, f] = ['c', 'd', 'f'].map((k) => big.dataSets.find((x) => x.id === k)!)
    const drawnRows = Array.from({ length: ROWS }, (_, r) => r).filter(
      (r) => c!.subcolumns[0]!.values[r] !== null && d!.subcolumns[0]!.values[r] !== null,
    )
    expect(cloud.n).toBe(drawnRows.length)
    expect(cloud.paints.map((p) => p.shape)).toEqual(['circle', 'square', 'circle'])
    const count = (level: string | null) => drawnRows.filter((r) => f!.text![r] === level).length
    const painted = [0, 0, 0]
    for (let i = 0; i < cloud.n; i++) painted[cloud.paint[i]!]!++
    expect(painted).toEqual([count('South'), count('North'), count(null)])
    for (const xs of [cloud.x, cloud.y, cloud.size]) expect(xs.every(Number.isFinite)).toBe(true)
  })

  it('grouped: groups by one text variable, shapes by another', () => {
    const made = presetGraph(big, 'barsPoints', undefined, {
      mapping: { x: 'a', y: 'c', color: 'b', shape: 'f' },
    })
    const g = { ...made, id: 'g1' as NodeId, legend: { ...made.legend, show: true } }
    expect(g.frame).toBe('grouped')
    const s = draw(g)
    expect(labels(s, 'shape')).toEqual(['South', 'North'])
    const clouds = flatten(s.root).flatMap((n) => (n.prim?.type === 'points' ? [n.prim] : []))
    // Every row with a group, a sex and a score, in the clouds of the groups' cells.
    const [a, c] = ['a', 'c'].map((k) => big.dataSets.find((x) => x.id === k)!)
    const rows = Array.from({ length: ROWS }, (_, r) => r).filter(
      (r) => a!.text![r] !== null && c!.subcolumns[0]!.values[r] !== null,
    )
    expect(clouds.reduce((n, p) => n + p.n, 0)).toBe(rows.length)
    for (const p of clouds) {
      expect(new Set(p.paints.map((q) => q.shape)).size).toBeGreaterThan(1)
      for (const xs of [p.x, p.y, p.size]) expect(xs.every(Number.isFinite)).toBe(true)
    }
  })

  it('category: points coloured and sized by numbers', () => {
    const g = {
      ...presetGraph(big, 'groupBoxPoints', undefined, {
        mapping: { x: 'a', y: 'c', color: 'e', size: 'd' },
      }),
      id: 'g1' as NodeId,
    }
    const s = draw(g)
    expect(labels(s, 'color').length).toBeGreaterThan(1)
    expect(labels(s, 'size').length).toBeGreaterThan(1)
  })
})
