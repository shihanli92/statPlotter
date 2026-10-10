import type { DataTable, GraphNode, Layer, NodeId } from '@ps/model'
import { median } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { syntheticTable } from '../../model/test/synthetic.ts'
import {
  builderDefaultFor,
  CloudBuilder,
  cloudHit,
  cloudIndex,
  defaultPresetFor,
  drawOrder,
  drawsCloud,
  groupCentre,
  groupVariables,
  LARGE_TABLE_ROWS,
  layoutLayers,
  movePoints,
  type PointsPrim,
  pointsAsImages,
  pointsShift,
  presetGraph,
  RASTER_THRESHOLD,
  rasterizePoints,
  type Scene,
  type SceneNode,
  SWARM_MAX_POINTS,
  sceneToPdf,
  sceneToSvg,
  swarmOffsets,
} from '../src/index.ts'
import { fonts, growthRatio, projectOf } from './helpers.ts'

// Point clouds (roadmap 34e): a points layer of many points as one primitive — exported as the
// very symbols separate nodes draw, drawn into an image by our rasteriser on screen, hit through
// a grid — draw orders, and group names at their centres.

const key = (t: DataTable, title: string) => t.dataSets.find((d) => d.title === title)!.id

function umap(t: DataTable, points: object = {}, aes: Layer['aes'] = {}, front: Layer[] = []) {
  const g = presetGraph(t, 'bubble')
  return {
    ...g,
    id: 'g1' as NodeId,
    layers: [
      ...g.layers.map((l) =>
        l.aes
          ? ({
              ...l,
              aes: { x: key(t, 'UMAP_1'), y: key(t, 'UMAP_2'), color: key(t, 'cluster'), ...aes },
              style: { ...l.style, ...points },
            } as Layer)
          : l,
      ),
      ...front,
    ],
  } as GraphNode
}

const lay = (t: DataTable, g: GraphNode) => layoutLayers({ project: projectOf(t), graph: g, fonts })

function all(n: SceneNode, out: SceneNode[] = []): SceneNode[] {
  out.push(n)
  for (const c of n.children ?? []) all(c, out)
  return out
}
const clouds = (s: Scene) =>
  all(s.root).filter((n): n is SceneNode & { prim: PointsPrim } => n.prim?.type === 'points')
const symbols = (s: Scene) => all(s.root).filter((n) => n.prim?.type === 'symbol')

describe('a points layer of many points', () => {
  const t = syntheticTable({ rows: 600, genes: 2, pcs: 2 })

  it('exports as the same symbols, byte for byte, as a node per point', () => {
    const vector = lay(t, umap(t, { render: 'vector' }))
    const image = lay(t, umap(t, { render: 'image' }))
    expect(clouds(vector)).toHaveLength(0)
    expect(clouds(image)).toHaveLength(1)
    expect(clouds(image)[0]!.prim.n).toBe(600)
    expect(symbols(image).length).toBe(symbols(vector).length - 600)
    expect(sceneToSvg(image)).toBe(sceneToSvg(vector))
    const date = new Date('2026-01-01T00:00:00Z')
    expect(sceneToPdf(image, fonts, { date })).toEqual(sceneToPdf(vector, fonts, { date }))
  })

  it('is a cloud above the threshold (automatic), never when asked for vectors', () => {
    expect(drawsCloud(undefined, RASTER_THRESHOLD)).toBe(false)
    expect(drawsCloud('auto', RASTER_THRESHOLD + 1)).toBe(true)
    expect(drawsCloud('vector', 10 * RASTER_THRESHOLD)).toBe(false)
    expect(drawsCloud('image', 1)).toBe(true)
    const big = syntheticTable({ rows: RASTER_THRESHOLD + 1, genes: 1, pcs: 1 })
    expect(clouds(lay(big, umap(big)))).toHaveLength(1)
  })

  it('as an image in an export: the clouds rasterised, everything else vector', () => {
    const image = lay(t, umap(t, { render: 'image' }))
    const svg = sceneToSvg(pointsAsImages(image, 2))
    expect(svg).toContain('data:image/png;base64,')
    expect(svg.match(/<path /g)?.length ?? 0).toBeLessThan(100)
    expect(svg).toContain('<text')
  })
})

describe('the rasteriser', () => {
  const cloud = (pts: [number, number, number, string][], shape = 'circle' as const) => {
    const b = new CloudBuilder('p')
    pts.forEach(([x, y, size, color], r) => {
      b.add(x, y, size, b.paintOf(shape, null, { color, opacity: 1 }), r)
    })
    return b.build()
  }
  const px = (img: NonNullable<ReturnType<typeof rasterizePoints>>, x: number, y: number) => {
    const i =
      (Math.floor((y - img.box.y) * img.scale) * img.width +
        Math.floor((x - img.box.x) * img.scale)) *
      4
    return [...img.rgba.subarray(i, i + 4)]
  }

  it('fills a symbol, anti-aliases its edge, leaves the rest clear; the same every time', () => {
    const p = cloud([[10.1, 10.1, 8, '#ff0000']])
    const img = rasterizePoints(p, 4)!
    expect(px(img, 10.1, 10.1)).toEqual([255, 0, 0, 255])
    // On the edge (x = 14.1, inside the pixel from 14 to 14.25): partly covered.
    const edge = px(img, 14.05, 10.1)
    expect(edge[3]).toBeGreaterThan(0)
    expect(edge[3]).toBeLessThan(255)
    expect(px(img, 7.2, 7.2)[3]).toBe(0)
    expect(rasterizePoints(p, 4)!.rgba).toEqual(img.rgba)
  })

  it('draws later points over earlier ones', () => {
    const img = rasterizePoints(
      cloud([
        [10, 10, 8, '#ff0000'],
        [10, 10, 4, '#0000ff'],
      ]),
      4,
    )!
    expect(px(img, 10, 10)).toEqual([0, 0, 255, 255])
    expect(px(img, 13, 10)).toEqual([255, 0, 0, 255])
  })

  it('every shape covers about its area', () => {
    for (const shape of ['circle', 'square', 'diamond', 'triangle'] as const) {
      const b = new CloudBuilder('p')
      b.add(20, 20, 10, b.paintOf(shape, null, { color: '#000000', opacity: 1 }), 0)
      const img = rasterizePoints(b.build(), 4)!
      let covered = 0
      for (let k = 3; k < img.rgba.length; k += 4) covered += img.rgba[k]! / 255
      const area = covered / 16
      // Circle π·25 ≈ 78.5; the square as large; the diamond and triangle bigger outlines.
      expect(area, shape).toBeGreaterThan(40)
      expect(area, shape).toBeLessThan(110)
    }
  })
})

describe('clouds drawing the same (audit 3, P4)', () => {
  it('are the same sizes and paints in the same order, every point moved alike', () => {
    const make = (color = '#000000', last = 3) => {
      const b = new CloudBuilder('p')
      const paint = b.paintOf('circle', null, { color, opacity: 1 })
      for (let i = 0; i < 4; i++) b.add(i + 0.1, 2 * i + 0.3, i === 3 ? last : 3, paint, i)
      return b.build()
    }
    const a = make()
    expect(pointsShift(a, make())).toEqual([0, 0])
    expect(pointsShift(a, { ...a, rows: new Int32Array(4) })).toEqual([0, 0])
    const moved = pointsShift(
      a,
      movePoints(a, (x, y) => [x + 12.7, y - 3.3]),
    )!
    expect(moved[0]).toBeCloseTo(12.7, 12)
    expect(moved[1]).toBeCloseTo(-3.3, 12)
    expect(pointsShift(a, make('#ff0000'))).toBeNull()
    expect(pointsShift(a, make('#000000', 4))).toBeNull()
    expect(
      pointsShift(
        a,
        movePoints(a, (x, y) => [x * 1.001, y]),
      ),
    ).toBeNull()
    expect(
      pointsShift(
        a,
        movePoints(a, (x, y) => [x, y === 0.3 ? y + 1e-3 : y]),
      ),
    ).toBeNull()
    expect(pointsShift(a, { ...a, n: 3, x: a.x.slice(0, 3) })).toBeNull()
  })
})

describe('a cloud’s paints (audit 3, P4)', () => {
  it('are the same by shape and colour of a style as made each time', () => {
    const quick = new CloudBuilder('p')
    const slow = new CloudBuilder('p')
    const style = {}
    const stroke = (color: string) => ({ color, width: 1, dash: 'solid' as const })
    for (const [shape, color] of [
      ['circle', '#000000'],
      ['square', '#ff0000'],
      ['circle', '#000000'],
      ['circle', '#ff0000'],
      ['square', '#ff0000'],
    ] as const) {
      const made = { stroke: stroke(color), fill: { color, opacity: 0.5 } }
      expect(quick.paintFor(style, shape, color, () => made)).toBe(
        slow.paintOf(shape, made.stroke, made.fill),
      )
    }
    // Another style starts again.
    const other = { stroke: null, fill: { color: '#000000', opacity: 1 } }
    expect(quick.paintFor({}, 'circle', '#000000', () => other)).toBe(3)
  })
})

describe('hit-testing a cloud', () => {
  it('finds the topmost point under the pointer, none off the points', () => {
    const b = new CloudBuilder('p')
    const paint = b.paintOf('circle', null, { color: '#000000', opacity: 1 })
    b.add(10, 10, 6, paint, 0)
    b.add(12, 10, 6, paint, 1)
    b.add(50, 50, 6, paint, 2)
    const p = b.build()
    expect(cloudHit(p, 11, 10, 0)).toBe(1)
    expect(cloudHit(p, 7.5, 10, 0)).toBe(0)
    expect(cloudHit(p, 50, 52, 0)).toBe(2)
    expect(cloudHit(p, 30, 30, 2)).toBe(-1)
  })

  it('builds its grid in linear time and answers a hover in about constant time', () => {
    /** n points over a square of side `side` (points), as dense whatever n. */
    const make = (n: number) => {
      const side = Math.sqrt(n) * 2
      const b = new CloudBuilder('p')
      const paint = b.paintOf('circle', null, { color: '#000000', opacity: 1 })
      for (let i = 0; i < n; i++)
        b.add((((i * 7919) % 1000) * side) / 1000, (((i * 104729) % 997) * side) / 997, 3, paint, i)
      return b.build()
    }
    // Only the grid is timed, the fastest of five: each call indexes a shallow copy of a cloud
    // made beforehand (the index is kept per cloud object; the copy shares its arrays). Making
    // the clouds inside the timing let a shared worker's garbage push the ratio past the bound
    // in CI.
    const made = new Map([20_000, 80_000].map((n) => [n, make(n)]))
    const index = (n: number) => cloudIndex({ ...made.get(n)! })
    expect(growthRatio(index, 20_000, 4, 5)).toBeLessThan(8)
    const clouds = new Map<number, PointsPrim>()
    const cloudOf = (n: number) => {
      let p = clouds.get(n)
      if (!p) {
        p = make(n)
        cloudIndex(p)
        clouds.set(n, p)
      }
      return p
    }
    // A thousand hovers over 20,000 points or over 320,000 (as dense): about the same work.
    const hovers = (n: number) => {
      const p = cloudOf(n)
      const side = Math.sqrt(n) * 2
      for (let k = 0; k < 1000; k++)
        cloudHit(p, (((k * 13) % 100) * side) / 100, (((k * 29) % 100) * side) / 100, 2)
    }
    expect(growthRatio(hovers, 20_000, 16, 3)).toBeLessThan(4)
  })
})

describe('draw orders', () => {
  it('value: ascending, missing first, ties in order; random: a fixed shuffle', () => {
    const v = [3, Number.NaN, 1, 3, 2]
    expect([...drawOrder(5, 'value', (i) => v[i]!)!]).toEqual([1, 2, 4, 0, 3])
    const a = drawOrder(1000, 'random')!
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 1000 }, (_, i) => i))
    expect([...drawOrder(1000, 'random')!]).toEqual([...a])
    expect(drawOrder(5, 'table')).toBeNull()
  })

  it('a UMAP coloured by a gene draws its highest values last', () => {
    const t = syntheticTable({ rows: 300, genes: 2, pcs: 2 })
    const s = lay(t, umap(t, { order: 'value', render: 'image' }, { color: key(t, 'GENE1') }))
    const p = clouds(s)[0]!.prim
    const gene = t.dataSets.find((d) => d.title === 'GENE1')!.subcolumns[0]!.values
    const drawn = Array.from(p.rows, (r) => gene[r] ?? Number.NEGATIVE_INFINITY)
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]!).toBeGreaterThanOrEqual(drawn[i - 1]!)
  })
})

describe('group names at their centres', () => {
  it('the median (or mean) of each group’s points, from @ps/stats', () => {
    const g = { xs: [1, 2, 10, Number.NaN], ys: [0, 4, 5, 1] }
    const ok = (x: number, y: number) => Number.isFinite(x) && Number.isFinite(y)
    expect(groupCentre(g, 'median', ok)).toEqual([median([1, 2, 10]), median([0, 4, 5])])
    expect(groupCentre(g, 'mean', ok)).toEqual([13 / 3, 3])
    expect(groupCentre({ xs: [], ys: [] }, 'median', ok)).toBeNull()
  })

  it('names every cluster, the names never overlapping, with a halo or a box', () => {
    const t = syntheticTable({ rows: 400, genes: 1, pcs: 1 })
    const names: Layer = { id: 'names', geom: 'label', stat: { kind: 'centroid' } }
    const s = lay(t, umap(t, {}, {}, [names]))
    const texts = all(s.root).filter((n) => n.layer === 'names' && n.prim?.type === 'text')
    const clusters = new Set(t.dataSets.find((d) => d.title === 'cluster')!.text)
    expect(texts.length).toBe(clusters.size)
    for (const n of texts) expect(n.prim?.type === 'text' && n.prim.halo).toBeTruthy()
    const boxes = texts.map((n) => n.bbox!)
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i]!, boxes[j]!]
        const overlap =
          Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 &&
          Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5
        expect(overlap).toBe(false)
      }
    const boxed = lay(t, umap(t, {}, {}, [{ ...names, style: { background: 'box' } } as Layer]))
    expect(
      all(boxed.root).filter((n) => n.layer === 'names' && n.prim?.type === 'rect'),
    ).toHaveLength(clusters.size)
  })
})

describe('defaults for large tables', () => {
  it('a large multiple-variables table starts as an XY graph, grouped by a variable of few levels', () => {
    const t = syntheticTable({ rows: LARGE_TABLE_ROWS + 1, genes: 1, pcs: 1 })
    expect(defaultPresetFor(t)).toBe('bubble')
    expect(builderDefaultFor(t)).toBe('bubble')
    expect(defaultPresetFor({ ...t, rowCount: 100 })).toBe('points')
    // The cell ids (a level per row) are no group; the samples are.
    expect(groupVariables(t).map((d) => d.title)).toEqual(['sample', 'cluster', 'cell_type'])
    const aes = presetGraph(t, 'bubble').layers.find((l) => l.aes)!.aes!
    expect(aes.color).toBe(key(t, 'sample'))
  })

  it('a crowded swarm of many points is spread evenly, in linear time', () => {
    const ys = (n: number) => Array.from({ length: n }, (_, i) => (i % 100) / 10)
    const offsets = swarmOffsets(ys(SWARM_MAX_POINTS + 1), 4, 20)
    expect(Math.max(...offsets.map(Math.abs))).toBeLessThanOrEqual(20)
    expect(new Set(offsets).size).toBeGreaterThan(1000)
    expect(growthRatio((n) => swarmOffsets(ys(n), 4, 20), 20_000, 4, 2)).toBeLessThan(10)
  })
})
