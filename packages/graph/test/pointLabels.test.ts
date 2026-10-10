import {
  type AnalysisResult,
  createTable,
  type DataSetKey,
  type DataTable,
  type GraphNode,
  newNodeId,
  type PointLabels,
  type PointStyle,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { lcg } from '../../stats/test/rng.ts'
import {
  type Box,
  createGraphFor,
  layoutGraph,
  leaderLine,
  outputGraphsFor,
  passesThresholds,
  placeLabels,
  type RepelLabel,
  type RepelObstacle,
  type RepelPlacement,
  type Scene,
  type SceneNode,
  sceneToSvg,
} from '../src/index.ts'
import { layerOf } from './graphs.ts'
import { flatten, fonts, growthRatio, projectOf } from './helpers.ts'

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('label placement (repel)', () => {
  const label = (x: number, y: number, extra: Partial<RepelLabel> = {}): RepelLabel => ({
    x,
    y,
    r: 3,
    w: 30,
    h: 10,
    ...extra,
  })

  it('puts a lone label just right of its point, level with it', () => {
    const [p] = placeLabels([label(50, 50)], [{ x: 50, y: 50, r: 3 }], { width: 200, height: 100 })
    expect(p!.box).toEqual({ x: 56, y: 45, w: 30, h: 10 })
    expect(p!.away).toBe(false)
  })

  it('keeps labels inside the plot (left of a point at the right edge)', () => {
    const [p] = placeLabels([label(195, 5)], [{ x: 195, y: 5, r: 3 }], { width: 200, height: 100 })
    const b = p!.box
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.y).toBeGreaterThanOrEqual(0)
    expect(b.x + b.w).toBeLessThanOrEqual(200)
    expect(b.y + b.h).toBeLessThanOrEqual(100)
    expect(b.x + b.w).toBeLessThan(195)
  })

  it('moves crowded labels apart, off the points, with leaders when away', () => {
    // A tight cluster of ten labelled points.
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: 100 + (i % 3) * 4, y: 60 + i * 2 }))
    const labels = pts.map((p) => label(p.x, p.y))
    const obstacles = pts.map((p) => ({ ...p, r: 3 }))
    const placed = placeLabels(labels, obstacles, { width: 300, height: 150 })
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++)
        expect(overlap(placed[i]!.box, placed[j]!.box)).toBe(false)
      for (const o of obstacles) {
        const b = placed[i]!.box
        const dx = Math.max(b.x - o.x, 0, o.x - (b.x + b.w))
        const dy = Math.max(b.y - o.y, 0, o.y - (b.y + b.h))
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(o.r)
      }
    }
    const away = placed.filter((p) => p.away)
    expect(away.length).toBeGreaterThan(0)
    for (const [i, p] of placed.entries()) {
      if (!p.away) continue
      const line = leaderLine(labels[i]!.x, labels[i]!.y, 3, p.box)
      expect(line).not.toBeNull()
      // The leader starts at the point's edge.
      expect(Math.hypot(line!.x1 - labels[i]!.x, line!.y1 - labels[i]!.y)).toBeCloseTo(3, 9)
    }
    // Deterministic.
    expect(placeLabels(labels, obstacles, { width: 300, height: 150 })).toEqual(placed)
  })

  it('keeps fixed labels where they are and places the others around them', () => {
    const labels = [label(50, 50), label(50, 50, { at: { x: 71, y: 50 } })]
    const [free, fixed] = placeLabels(labels, [{ x: 50, y: 50, r: 3 }], {
      width: 200,
      height: 100,
    })
    expect(fixed!.box).toEqual({ x: 56, y: 45, w: 30, h: 10 })
    expect(overlap(free!.box, fixed!.box)).toBe(false)
  })

  it('without repel puts every label beside its point, even overlapping', () => {
    const labels = [label(50, 50), label(52, 52)]
    const placed = placeLabels(labels, [], { width: 200, height: 100, repel: false })
    expect(placed.map((p) => p.box.x)).toEqual([56, 58])
    expect(overlap(placed[0]!.box, placed[1]!.box)).toBe(true)
  })

  it('places 100 labels among 20 000 points quickly, without label overlaps', () => {
    const rnd = lcg(7)
    const W = 400
    const H = 300
    // A volcano-like cloud: dense near the bottom centre, sparse at the top corners.
    const obstacles: RepelObstacle[] = Array.from({ length: 20000 }, () => {
      const x = (rnd() - 0.5) * (rnd() < 0.9 ? 0.4 : 1) * W + W / 2
      const y = H - rnd() ** 3 * H
      return { x, y, r: 2 }
    })
    const labelled = [...obstacles]
      .map((o, i) => ({ o, i, d: (o.x - W / 2) ** 2 + (H - o.y) ** 2 }))
      .sort((a, b) => b.d - a.d)
      .slice(0, 100)
    const labels = labelled.map(({ o }) => ({ x: o.x, y: o.y, r: 2, w: 28, h: 9 }))
    // Quickly: the spatial grids keep each label's search local, so 80 000 more points below the
    // plot, where no label can go, change nothing and cost little (checking every point for every
    // spot would take ~5× as long). A ratio of CPU times, so it holds on a slow or busy machine.
    const far: RepelObstacle[] = Array.from({ length: 80000 }, (_, i) => ({
      x: (i % W) + 0.5,
      y: H + 50 + Math.floor(i / W) * 0.1,
      r: 2,
    }))
    const all = [...obstacles, ...far]
    const out = new Map<number, RepelPlacement[]>()
    const place = (n: number) => {
      out.set(n, placeLabels(labels, all.slice(0, n), { width: W, height: H }))
    }
    expect(growthRatio(place, obstacles.length, 5, 1)).toBeLessThan(3)
    const placed = out.get(obstacles.length)!
    expect(out.get(all.length)).toEqual(placed)
    let overlaps = 0
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        if (overlap(placed[i]!.box, placed[j]!.box)) overlaps++
    expect(overlaps).toBe(0)
    for (const p of placed) {
      expect(p.box.x).toBeGreaterThanOrEqual(0)
      expect(p.box.x + p.box.w).toBeLessThanOrEqual(W)
    }
  })
})

describe('thresholds', () => {
  const volcano = [
    { value: 'x' as const, test: 'abs' as const, limit: 1 },
    { value: 'y' as const, test: 'above' as const, limit: 2 },
  ]
  it('combines with and (default) or or', () => {
    expect(passesThresholds(volcano, 'and', -1.5, 3)).toBe(true)
    expect(passesThresholds(volcano, 'and', 0.5, 3)).toBe(false)
    expect(passesThresholds(volcano, 'or', 0.5, 3)).toBe(true)
    expect(passesThresholds([{ value: 'y', test: 'below', limit: 0 }], 'and', 0, -1)).toBe(true)
    // A threshold on X fails where there is no X (column graphs).
    expect(passesThresholds(volcano, 'or', null, 1)).toBe(false)
  })
})

/** An XY table: X = 0..n-1, Y from `ys`, row titles `g0`, `g1`… */
function xyProject(ys: number[], labels?: PointLabels, points: Record<string, PointStyle> = {}) {
  const table: DataTable = createTable({ tableKind: 'xy', columns: 1, rows: ys.length })
  table.x!.subcolumns[0]!.values = ys.map((_, i) => i - ys.length / 2)
  table.dataSets[0]!.subcolumns[0]!.values = ys
  table.rowTitles = ys.map((_, i) => `g${i}`)
  const ds = table.dataSets[0]!.id as unknown as DataSetKey
  const base = createGraphFor(table)
  const graph: GraphNode = {
    ...base,
    seriesOverrides: labels ? { [ds]: { pointLabels: labels } } : {},
    pointOverrides: { [ds]: points },
  }
  const project = projectOf(table, graph)
  return { project, graph, table, ds: ds as string }
}

const labelNodes = (scene: Scene) =>
  flatten(scene.root).filter((n) => n.target?.[0] === 'pointLabel' && n.prim?.type === 'text')
const textOf = (n: SceneNode) =>
  n.prim?.type === 'text' ? n.prim.layout.runs.map((r) => r.text).join('') : ''

describe('point labels on graphs', () => {
  const ys = [1, 5, 2, 8, 3, 9, 4, 0.5]

  it('labels every point with its row title, targeting the point', () => {
    const { project, graph, ds } = xyProject(ys, { source: 'rowTitle', which: 'all' })
    const scene = layoutGraph({ project, graph, fonts })
    const nodes = labelNodes(scene)
    expect(nodes.map(textOf).sort()).toEqual(ys.map((_, i) => `g${i}`).sort())
    const n = nodes.find((x) => textOf(x) === 'g3')!
    expect(n.target).toEqual(['pointLabel', ds, 'r3'])
    expect(n.point).toBe('r3')
    // The recorded offset leads back to the point's symbol.
    const sym = flatten(scene.root).find(
      (x) => x.point === 'r3' && x.prim?.type === 'symbol' && x.target?.[0] === 'layers',
    )!
    const b = n.bbox!
    expect(b.x + b.w / 2 - n.labelOffset!.dx).toBeCloseTo(
      sym.prim?.type === 'symbol' ? sym.prim.cx : 0,
      9,
    )
    expect(b.y + b.h / 2 - n.labelOffset!.dy).toBeCloseTo(
      sym.prim?.type === 'symbol' ? sym.prim.cy : 0,
      9,
    )
    // Labels stay inside the plot.
    for (const x of nodes) {
      expect(x.bbox!.x).toBeGreaterThanOrEqual(scene.plot.x - 1e-9)
      expect(x.bbox!.x + x.bbox!.w).toBeLessThanOrEqual(scene.plot.x + scene.plot.w + 1e-9)
    }
  })

  it('labels only points past the thresholds, or the chosen rows', () => {
    const past = xyProject(ys, {
      source: 'rowTitle',
      which: 'threshold',
      thresholds: [{ value: 'y', test: 'above', limit: 5 }],
    })
    expect(
      labelNodes(layoutGraph({ ...past, fonts }))
        .map(textOf)
        .sort(),
    ).toEqual(['g1', 'g3', 'g5'])
    const chosen = xyProject(ys, { source: 'rowTitle', which: 'rows', rows: [0, 6] })
    expect(
      labelNodes(layoutGraph({ ...chosen, fonts }))
        .map(textOf)
        .sort(),
    ).toEqual(['g0', 'g6'])
  })

  it('keeps the most extreme points under max (largest |Y| with thresholds)', () => {
    const p = xyProject(ys, {
      source: 'rowTitle',
      which: 'threshold',
      thresholds: [{ value: 'y', test: 'above', limit: 2 }],
      max: 2,
    })
    expect(
      labelNodes(layoutGraph({ ...p, fonts }))
        .map(textOf)
        .sort(),
    ).toEqual(['g3', 'g5'])
  })

  it('shows X or Y values in the number format; no row title means no label', () => {
    const p = xyProject(ys, {
      source: 'y',
      which: 'rows',
      rows: [1],
      format: { mode: 'fixed', digits: 2 },
    })
    expect(labelNodes(layoutGraph({ ...p, fonts })).map(textOf)).toEqual(['5.00'])
    const untitled = xyProject(ys, { source: 'rowTitle', which: 'all' })
    untitled.table.rowTitles = null
    expect(labelNodes(layoutGraph({ ...untitled, fonts }))).toEqual([])
  })

  it('skips hidden points; a point’s own label wins; a dragged label sits at its offset', () => {
    const p = xyProject(
      ys,
      { source: 'rowTitle', which: 'all' },
      {
        r0: { hide: true },
        r1: { label: 'TP53' },
        r2: { labelOffset: { dx: 20, dy: -15 } },
      },
    )
    const scene = layoutGraph({ ...p, fonts })
    const nodes = labelNodes(scene)
    const texts = nodes.map(textOf)
    expect(texts).not.toContain('g0')
    expect(texts).toContain('TP53')
    expect(texts).not.toContain('g1')
    const dragged = nodes.find((n) => textOf(n) === 'g2')!
    expect(dragged.labelOffset!.dx).toBeCloseTo(20, 9)
    expect(dragged.labelOffset!.dy).toBeCloseTo(-15, 9)
    // It is away from its point: a leader line in the label's colour.
    const leader = flatten(scene.root).find((n) => n.id === `pointLabel/${p.ds}/r2/leader`)
    expect(leader?.prim?.type).toBe('line')
    expect(leader?.target).toEqual(['pointLabel', p.ds, 'r2'])
    // Exported SVG has the labels and leaders.
    const svg = sceneToSvg(scene, { ids: true })
    expect(svg).toContain('>TP53<')
    expect(svg).toContain('>g2<')
    expect(svg).toContain(`data-id="pointLabel/${p.ds}/r2/leader"`)
    // A leader width of 0 draws none.
    const none = xyProject(
      ys,
      { source: 'rowTitle', which: 'all', leader: { width: 0 } },
      {
        r2: { labelOffset: { dx: 20, dy: -15 } },
      },
    )
    expect(
      flatten(layoutGraph({ ...none, fonts }).root).some((n) => n.id.endsWith('/leader')),
    ).toBe(false)
  })

  it('draws a point’s own label without automatic labels', () => {
    const p = xyProject(ys, undefined, { r4: { label: 'outlier' } })
    expect(labelNodes(layoutGraph({ ...p, fonts })).map(textOf)).toEqual(['outlier'])
  })

  it('labels column scatter points by row title', () => {
    const table = createTable({ tableKind: 'column', columns: 1, rows: 3 })
    table.dataSets[0]!.subcolumns[0]!.values = [1, 4, 9]
    table.rowTitles = ['mouse A', 'mouse B', null]
    const ds = table.dataSets[0]!.id as unknown as DataSetKey
    const graph: GraphNode = {
      ...createGraphFor(table),
      seriesOverrides: { [ds]: { pointLabels: { source: 'rowTitle', which: 'all' } } },
    }
    const project = projectOf(table, graph)
    const nodes = labelNodes(layoutGraph({ project, graph, fonts }))
    expect(nodes.map(textOf).sort()).toEqual(['mouse A', 'mouse B'])
    expect(nodes[0]!.target?.[2]).toMatch(/^r\ds0$/)
  })

  it('labels an analysis output’s points by the rows they come from (volcano plot)', () => {
    const table = createTable({ tableKind: 'grouped', columns: 2, rows: 4 })
    const analysisId = newNodeId()
    const [graph] = outputGraphsFor(table, analysisId, [
      {
        key: 'flagged',
        graph: { id: 'v', name: 'Volcano plot' },
        mark: 'points',
        pointLabels: { source: 'rowTitle', which: 'all', max: 20 },
      },
    ])
    const project = projectOf(table, graph!)
    const result: AnalysisResult = {
      status: 'ok',
      diagnostics: [],
      sheets: [],
      values: {},
      comparisons: [],
      outputs: {
        flagged: {
          title: 'Discovery',
          x: [-2, 1.5, 3],
          y: [4, 3, 6],
          rows: [0, 2, 3],
          rowTitles: ['Il6', null, 'Tnf'],
        },
      },
    }
    const scene = layoutGraph({ project, graph: graph!, fonts, result: () => result })
    const nodes = labelNodes(scene)
    expect(nodes.map(textOf).sort()).toEqual(['Il6', 'Tnf'])
    const curves = layerOf(graph!, 'curves')
    const id = curves.data?.from === 'outputs' ? curves.data.series[0]!.id : undefined
    expect(nodes.find((n) => textOf(n) === 'Tnf')!.target).toEqual(['pointLabel', id, 'r3'])
  })
})
