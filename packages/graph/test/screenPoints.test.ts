import {
  type ColumnId,
  createTable,
  type DataTable,
  type GraphNode,
  type Layer,
  type NodeId,
  normalizeDataSet,
  parsePointKey,
} from '@ps/model'
import { median, quantile } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import {
  cloudHit,
  cloudPointNode,
  evenIndices,
  evenSample,
  layoutGraph,
  layoutPage,
  markInfo,
  type PointsPrim,
  PREVIEW_MARKS,
  PREVIEW_SETS,
  plotStats,
  presetGraph,
  previewGraph,
  previewNote,
  previewScreen,
  previewSource,
  RASTER_THRESHOLD,
  SCREEN_POINTS,
  SCREEN_SAMPLE,
  type Scene,
  type SceneNode,
  sampledNote,
  sceneToPdf,
  sceneToSvg,
  swarmOffsets,
  THUMBNAIL_XY_ROWS,
  thumbnailSource,
  violinOf,
} from '../src/index.ts'
import { fonts, projectOf } from './helpers.ts'

// Points on screen (decisions 450–452): at most 1,000 per-row points per column or group on
// screen (an even sample; statistics and exports from every row), the raster decision counted
// over the whole graph, and builder previews of bounded work.

/** A multiple-variables table of `rows` rows × `cols` number variables (deterministic values). */
function wideTable(rows: number, cols: number, id = 'w1'): DataTable {
  const t = createTable({ tableKind: 'multipleVariables', columns: 0, rows: 0 })
  t.id = id as NodeId
  t.name = 'Wide'
  t.rowCount = rows
  let a = 12345
  const u = () => {
    a = (Math.imul(a, 1103515245) + 12345) >>> 0
    return a / 4294967296
  }
  t.dataSets = Array.from({ length: cols }, (_, k) => ({
    id: `v${k}` as ColumnId,
    title: `Gene ${k + 1}`,
    subcolumns: [
      {
        type: 'number' as const,
        values: Array.from({ length: rows }, () => Math.round((k + 4 * u() * u()) * 1000) / 1000),
      },
    ],
  }))
  return t
}

const graphOf = (t: DataTable, preset = 'points', patch: Partial<GraphNode> = {}): GraphNode => ({
  ...presetGraph(t, preset),
  id: 'g1' as NodeId,
  ...patch,
})

/** Where two byte arrays first differ (-1: nowhere): a quick comparison of large exports. */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
  return a.length === b.length ? -1 : n
}

function all(n: SceneNode, out: SceneNode[] = []): SceneNode[] {
  out.push(n)
  for (const c of n.children ?? []) all(c, out)
  return out
}
const clouds = (s: Scene) =>
  all(s.root).filter((n): n is SceneNode & { prim: PointsPrim } => n.prim?.type === 'points')
/** Per-row points drawn (symbols with a point key and clouds' points), by data set key. */
function rowPoints(s: Scene): Map<string, number[]> {
  const out = new Map<string, number[]>()
  const push = (target: SceneNode['target'], key: string) => {
    const ds = String(target?.[3] ?? target?.[1])
    const rows = out.get(ds) ?? []
    rows.push(parsePointKey(key)!.row)
    out.set(ds, rows)
  }
  for (const n of all(s.root)) {
    if (n.prim?.type === 'points')
      for (let i = 0; i < n.prim.n; i++) push(n.target, n.prim.point(i).key)
    else if (n.prim?.type === 'symbol' && n.point !== undefined) push(n.target, n.point)
  }
  return out
}
const lay = (t: DataTable, g: GraphNode, screen = true) =>
  layoutGraph({
    project: projectOf(t, g),
    graph: g,
    fonts,
    ...(screen ? { screen: SCREEN_SAMPLE } : {}),
  })

describe('an even sample', () => {
  it('spreads evenly in order, the first first, the same every time, all when few', () => {
    expect(evenIndices(10, 4)).toEqual([0, 2, 5, 7])
    expect(evenIndices(3, 5)).toEqual([0, 1, 2])
    expect(evenIndices(16_171, 1000)).toEqual(evenIndices(16_171, 1000))
    const idx = evenIndices(16_171, 1000)
    expect(idx).toHaveLength(1000)
    expect(idx[0]).toBe(0)
    // Gaps of 16 or 17 rows: evenly spread.
    const gaps = new Set(idx.slice(1).map((v, i) => v - idx[i]!))
    expect([...gaps].sort()).toEqual([16, 17])
    const items = ['a', 'b', 'c']
    expect(evenSample(items, 5)).toBe(items)
    expect(evenSample(items, 2)).toEqual(['a', 'b'])
  })

  it('says how many points of how many it shows, and that exports use all', () => {
    expect(sampledNote({ shown: 1000, of: 16_171, per: 'column' })).toBe(
      'Showing 1,000 of 16,171 points per column on screen; exports and statistics use all',
    )
    expect(sampledNote({ shown: 1000, of: 30_000, per: 'group' })).toBe(
      'Showing 1,000 of 30,000 points per group on screen; exports and statistics use all',
    )
    expect(sampledNote({ shown: 1000, of: 5000, per: 'row' })).toBe(
      'Showing 1,000 of 5,000 rows on screen; exports and statistics use all',
    )
    expect(SCREEN_POINTS).toBe(1000)
  })
})

describe('per-row points on screen', () => {
  const t = wideTable(3000, 8)
  const g = graphOf(t)

  it('draws at most 1,000 per column, evenly spread, with the note; exports every one', () => {
    const screen = lay(t, g)
    const full = lay(t, g, false)
    expect(screen.sampled).toEqual({ shown: 1000, of: 3000, per: 'column' })
    expect(full.sampled).toBeUndefined()
    const shown = rowPoints(screen)
    const every = rowPoints(full)
    expect(shown.size).toBe(8)
    for (const [key, rows] of shown) {
      expect(rows.length, key).toBe(1000)
      // The same rows in every column (none missing): evenly spread over the table.
      expect([...rows].sort((a, b) => a - b)).toEqual(evenIndices(3000, 1000))
      expect(every.get(key)).toHaveLength(3000)
    }
  })

  it('computes every statistic from every row (the mean and SD drawn the same)', () => {
    const marks = (s: Scene) =>
      all(s.root)
        .filter((n) => n.layer === 'error' || n.layer === 'center')
        .map((n) => [n.id, n.prim])
    expect(marks(lay(t, g))).toEqual(marks(lay(t, g, false)))
    const box = graphOf(t, 'boxPoints')
    const boxes = (s: Scene) =>
      all(s.root)
        .filter((n) => n.layer === 'box')
        .map((n) => [n.id, n.prim])
    expect(boxes(lay(t, box))).toEqual(boxes(lay(t, box, false)))
  })

  it('leaves small data sets and XY graphs of variables whole', () => {
    const small = wideTable(800, 3)
    expect(lay(small, graphOf(small)).sampled).toBeUndefined()
    const xy = graphOf(t, 'bubble')
    const s = lay(t, xy)
    expect(s.sampled).toBeUndefined()
    expect([...rowPoints(s).values()].reduce((n, r) => n + r.length, 0)).toBe(3000)
  })

  it('hovers a drawn point as its own row (Go to row)', () => {
    const s = lay(t, g)
    const cloud = clouds(s)[0]
    // 8 × 1,000 points: under the graph-wide threshold, drawn as nodes.
    expect(cloud).toBeUndefined()
    const node = all(s.root).find(
      (n) => n.prim?.type === 'symbol' && n.point && parsePointKey(n.point)?.row === 3,
    )!
    const card = markInfo(projectOf(t, g), g, node)!
    expect(card.goTo).toEqual({ table: t.id, row: 3 })
  })

  it('joins only the rows drawn with before–after lines', () => {
    const pairs = graphOf(t, 'beforeAfter')
    const s = lay(t, pairs)
    const lines = all(s.root).filter((n) => n.layer === 'pairs' && n.prim?.type === 'polyline')
    expect(lines).toHaveLength(1000)
    expect(all(lay(t, pairs, false).root).filter((n) => n.layer === 'pairs')).toHaveLength(3000)
  })

  it('draws at most 1,000 rows of a heat map of every value', () => {
    const heat = graphOf(t, 'heatmap')
    const s = lay(t, heat)
    expect(s.sampled).toEqual({ shown: 1000, of: 3000, per: 'row' })
    expect(all(s.root).filter((n) => n.layer === 'cells')).toHaveLength(8000)
    expect(all(lay(t, heat, false).root).filter((n) => n.layer === 'cells')).toHaveLength(24_000)
  })

  it('on pages too, the page saying so', () => {
    const layout = {
      id: 'L1' as NodeId,
      kind: 'layout' as const,
      name: 'Page',
      page: { width: 612, height: 792 },
      items: [{ type: 'graph' as const, id: 'i1', graph: g.id, x: 36, y: 36, scale: 1 }],
      panelLabels: { show: false, style: 'A' as const, size: 14 },
    }
    const project = projectOf(t, g)
    const page = (screen: boolean) =>
      layoutPage({
        project,
        layout: layout as never,
        fonts,
        ...(screen ? { screen: SCREEN_SAMPLE } : {}),
      })
    expect(page(true).sampled).toEqual({ shown: 1000, of: 3000, per: 'column' })
    expect(page(false).sampled).toBeUndefined()
  })
})

describe('per-row points of groups on screen', () => {
  /** 12,000 rows: Group (3 levels) × Sex (2 levels), 2,000 rows a cell, and a Score. */
  function grouped(): DataTable {
    const t = wideTable(12_000, 1)
    t.dataSets = [
      { id: 'a' as ColumnId, title: 'Group', subcolumns: [{ type: 'number', values: [] }] },
      { id: 'b' as ColumnId, title: 'Sex', subcolumns: [{ type: 'number', values: [] }] },
      { ...t.dataSets[0]!, id: 'c' as ColumnId, title: 'Score' },
    ]
    t.dataSets[0]!.text = Array.from({ length: 12_000 }, (_, r) => ['Low', 'Mid', 'High'][r % 3]!)
    t.dataSets[1]!.text = Array.from({ length: 12_000 }, (_, r) => (r % 2 ? 'F' : 'M'))
    t.dataSets[0]!.subcolumns[0]!.values = new Array(12_000).fill(null)
    t.dataSets[1]!.subcolumns[0]!.values = new Array(12_000).fill(null)
    return t
  }

  it('draws at most 1,000 per cell, a sample of its rows; the bars from every row', () => {
    const t = grouped()
    const g = {
      ...presetGraph(t, 'barsPoints', undefined, { mapping: { x: 'a', y: 'c', color: 'b' } }),
      id: 'g1' as NodeId,
    }
    expect(g.frame).toBe('grouped')
    const screen = lay(t, g)
    expect(screen.sampled).toEqual({ shown: 1000, of: 2000, per: 'group' })
    const drawn = [...rowPoints(screen).values()].flat()
    expect(drawn).toHaveLength(6000)
    expect(new Set(drawn).size).toBe(6000)
    const full = lay(t, g, false)
    expect([...rowPoints(full).values()].flat()).toHaveLength(12_000)
    const bars = (s: Scene) =>
      all(s.root)
        .filter((n) => n.layer === 'bars')
        .map((n) => n.prim)
    expect(bars(screen)).toEqual(bars(full))
  })
})

describe('a sampled swarm', () => {
  it('spreads as the whole swarm would: evenly when the whole is crowded', () => {
    // 1,000 of 16,000 values in a narrow band: the whole swarm would be crowded, so is spread
    // evenly (34e); alone, 1,000 points are swarmed point by point.
    const ys = Array.from({ length: 1000 }, (_, i) => 100 + (i % 50) / 5)
    const whole = swarmOffsets(ys, 4, 20, 16_000)
    expect(whole[0]).toBeCloseTo((0.6180339887 * 2 - 1) * 20, 6)
    const alone = swarmOffsets(ys, 4, 20)
    expect(alone).not.toEqual(whole)
    expect(swarmOffsets(ys, 4, 20, 1000)).toEqual(alone)
  })
})

describe('the raster decision counts the whole graph', () => {
  // 25 columns of 1,000: no data set reaches the threshold, the graph does.
  const t = wideTable(1000, 25)
  const g = graphOf(t)
  // Laid out once for the tests below (nothing changes a scene); about a second each time.
  let laidOut: Scene | undefined
  const asClouds = () => {
    laidOut ??= lay(t, g, false)
    return laidOut
  }

  it('draws every column’s points as a cloud in place when the graph’s exceed the threshold', () => {
    expect(25 * 1000).toBeGreaterThan(RASTER_THRESHOLD)
    const s = asClouds()
    const cs = clouds(s)
    expect(cs).toHaveLength(25)
    expect(cs.every((c) => c.prim.n === 1000)).toBe(true)
    expect(all(s.root).filter((n) => n.prim?.type === 'symbol' && n.point)).toHaveLength(0)
    // In its layer's place: the points' layer group holds the clouds, between the others.
    const layerGroups = all(s.root).filter((n) => n.id.startsWith('layer/'))
    expect(layerGroups.map((n) => n.id)).toEqual(g.layers.map((l) => `layer/${l.id}`))
    const points = layerGroups.find((n) => n.id === 'layer/points')!
    expect(points.children?.every((c) => c.prim?.type === 'points')).toBe(true)
  })

  it('exports a cloud as its symbols, byte for byte', () => {
    // Audit 3 (T6): a small graph whose points are drawn as an image (a cloud) or as vectors:
    // the exports are the same, as they are for the clouds above the threshold (which take
    // megabytes to export), and the comparison takes milliseconds.
    const small = wideTable(40, 3)
    const rendered = (render: 'image' | 'vector'): GraphNode => {
      const graph = graphOf(small)
      return {
        ...graph,
        layers: graph.layers.map((l) =>
          l.geom === 'points' ? ({ ...l, style: { ...l.style, render } } as Layer) : l,
        ),
      }
    }
    const asCloud = lay(small, rendered('image'), false)
    const asNodes = lay(small, rendered('vector'), false)
    expect(clouds(asCloud)).toHaveLength(3)
    expect(clouds(asNodes)).toHaveLength(0)
    expect(sceneToSvg(asCloud)).toBe(sceneToSvg(asNodes))
    const date = new Date('2026-01-01T00:00:00Z')
    const pdf = [asCloud, asNodes].map((s) => sceneToPdf(s, fonts, { date }))
    expect(firstDifference(pdf[0]!, pdf[1]!)).toBe(-1)
  })

  it('stays vector under the threshold; a cloud’s point hovers as its row', () => {
    const few = wideTable(1000, 3)
    expect(clouds(lay(few, graphOf(few), false))).toHaveLength(0)
    const s = asClouds()
    const cloud = clouds(s)[2]!
    const i = 417
    const hit = cloudHit(cloud.prim, cloud.prim.x[i]!, cloud.prim.y[i]!, 0)
    const node = cloudPointNode(cloud, hit)
    const row = parsePointKey(node.point!)!.row
    expect(markInfo(projectOf(t, g), g, node)!.goTo).toEqual({ table: t.id, row })
    expect(node.id).toBe(`series/v2/point/${row}`)
  })

  it('on screen: 60 columns of 16,000 draw 60,000 points, as 60 clouds', () => {
    const wide = wideTable(16_000, 60)
    const s = lay(wide, graphOf(wide))
    expect(s.sampled).toEqual({ shown: 1000, of: 16_000, per: 'column' })
    const cs = clouds(s)
    expect(cs).toHaveLength(60)
    expect(cs.reduce((n, c) => n + c.prim.n, 0)).toBe(60_000)
  })
})

describe('builder previews of many variables', () => {
  const t = wideTable(16_000, 60)
  const project = projectOf(t)

  it('draw the first 20 variables and about 5,000 per-row marks in all, saying so', () => {
    const src = previewSource(project, t.id, undefined)
    const sample = src.project.nodes[t.id] as DataTable
    const made = { ...presetGraph(sample, 'points'), id: 'p' as NodeId }
    const { graph, sets } = previewGraph(made, t)
    expect(sets).toEqual({ shown: PREVIEW_SETS, of: 60 })
    expect(graph.seriesSource.include).toEqual(t.dataSets.slice(0, 20).map((d) => d.id))
    const screen = previewScreen(sets!.shown)
    expect(screen).toEqual({ points: PREVIEW_MARKS / PREVIEW_SETS, xy: true })
    const scene = layoutGraph({
      project: { ...src.project, nodes: { ...src.project.nodes, [graph.id]: graph } },
      graph,
      fonts,
      screen,
    })
    const drawn = [...rowPoints(scene).values()]
    expect(drawn).toHaveLength(20)
    expect(drawn.reduce((n, r) => n + r.length, 0)).toBeLessThanOrEqual(PREVIEW_MARKS)
    expect(previewNote({ ...src, sets })).toBe(
      'Preview of 20 of 60 variables, 5,000 of 16,000 rows',
    )
    expect(previewNote({ shown: 10, of: 10, sets: { shown: 4, of: 4 } })).toBeNull()
    expect(
      previewNote({ shown: 10, of: 10, sets: { shown: 20, of: 25 }, setsName: 'data sets' }),
    ).toBe('Preview of 20 of 25 data sets')
  })

  it('leave graphs whose data sets are levels or rows alone', () => {
    const bubble = { ...presetGraph(t, 'bubble'), id: 'p' as NodeId }
    expect(previewGraph(bubble, t).sets).toBeNull()
    expect(previewScreen(null)).toEqual({ points: PREVIEW_MARKS, xy: true })
    const few = { ...presetGraph(wideTable(10, 5), 'points'), id: 'p' as NodeId }
    expect(previewGraph(few, wideTable(10, 5)).sets).toEqual({ shown: 5, of: 5 })
    // Many data sets of few rows: every one previewed.
    const small = wideTable(100, 30)
    const many = { ...presetGraph(small, 'points'), id: 'p' as NodeId }
    expect(previewGraph(many, small)).toEqual({ graph: many, sets: { shown: 30, of: 30 } })
  })
})

describe('statistics kept per data set', () => {
  it('are computed once per data set, the quartiles as before', () => {
    const t = wideTable(2001, 1)
    const ds = normalizeDataSet(t, t.dataSets[0]!)
    const st = plotStats(ds)
    expect(plotStats(ds)).toBe(st)
    expect(plotStats(ds, 0.99)).not.toBe(st)
    const values = st.points.map((p) => p.value)
    expect([st.q1, st.median, st.q3]).toEqual([
      quantile(values, 0.25),
      median(values),
      quantile(values, 0.75),
    ])
    const opts = { extent: 'truncated' as const, smoothing: 1 }
    expect(violinOf(st, opts)).toBe(violinOf(st, opts))
    expect(violinOf(st, { ...opts, smoothing: 2 })).not.toBe(violinOf(st, opts))
  })
})

describe('navigator thumbnails (audit 3, P2)', () => {
  const t = wideTable(30_000, 3)
  const thumb = (table: DataTable, g: GraphNode) => {
    const src = thumbnailSource(projectOf(table, g), g, undefined)
    return { src, scene: layoutGraph({ ...src, fonts, screen: SCREEN_SAMPLE }) }
  }
  const drawn = (s: Scene) => [...rowPoints(s).values()].reduce((n, r) => n + r.length, 0)

  it('draw a big XY graph from an even sample of its rows, the same every time', () => {
    const g = graphOf(t, 'bubble')
    expect(drawn(lay(t, g))).toBe(30_000)
    const { src, scene } = thumb(t, g)
    expect(drawn(scene)).toBe(THUMBNAIL_XY_ROWS)
    expect(clouds(scene)).toHaveLength(0)
    expect(thumbnailSource(projectOf(t, g), g, undefined).project.nodes[t.id]).toBe(
      src.project.nodes[t.id],
    )
  })

  it('leave small XY graphs, other graphs and graphs of chosen rows as they are', () => {
    const small = wideTable(THUMBNAIL_XY_ROWS, 3)
    const cases: [DataTable, GraphNode][] = [
      [small, graphOf(small, 'bubble')],
      [t, graphOf(t)],
      [
        t,
        {
          ...graphOf(t, 'bubble'),
          seriesSource: { ...graphOf(t, 'bubble').seriesSource, rows: [1, 2, 3] },
        },
      ],
    ]
    for (const [table, g] of cases) {
      const p = projectOf(table, g)
      const src = thumbnailSource(p, g, undefined)
      expect(src.project).toBe(p)
      expect(src.graph).toBe(g)
    }
  })

  it('move single points’ formats to the sample’s rows, dropping those not in it', () => {
    const red = { color: { rgb: '#ff0000' } }
    const g: GraphNode = {
      ...graphOf(t, 'bubble'),
      pointOverrides: { v1: { r15: red, r16: red } },
    }
    // Rows 0, 15, 30, … are drawn: row 15 is the sample's second.
    expect(thumbnailSource(projectOf(t, g), g, undefined).graph.pointOverrides).toEqual({
      v1: { r1: red },
    })
  })
})
