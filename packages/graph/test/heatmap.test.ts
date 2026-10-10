import {
  type ColorScale,
  createTable,
  type DataTable,
  type GraphNode,
  type HeatmapStyle,
  type Layer,
  type NodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { loadFixtures } from '../../stats/test/oracle.ts'
import {
  applyPreset,
  COLOR_MAPS,
  colorAt,
  dendrogramLines,
  heatmapData,
  heatScale,
  layoutGraph,
  MISSING_COLOR,
  presetsFor,
  type Scene,
  sceneToSvg,
  textOn,
} from '../src/index.ts'
import { addLayers, graphOf, layerOf, withLayer } from './graphs.ts'
import { byId, fonts, nodes, prim, projectOf, sampleTable } from './helpers.ts'

// Roadmap 30c: heat maps of grouped and multiple-variables tables.

/**
 * A new heat map of a table with the heat map options `h` set where a graph holds them: the
 * cells layer's style (missing colour, border, clustering) and stat (standardizing), a values
 * layer for cell labels, and the graph's colour scale.
 */
function heatmap(table: DataTable, h: HeatmapStyle = {}, patch: Partial<GraphNode> = {}) {
  let g = graphOf(table, 'heatmap', () => patch)
  const { labels, standardize, colorBar, colors, reverse, min, max, midpoint } = h
  const { missing, border, clusterRows, clusterColumns, distance, linkage, dendrogram } = h
  const cluster = {
    ...(clusterRows !== undefined ? { rows: clusterRows } : {}),
    ...(clusterColumns !== undefined ? { columns: clusterColumns } : {}),
    ...(distance !== undefined ? { distance } : {}),
    ...(linkage !== undefined ? { linkage } : {}),
    ...(dendrogram !== undefined ? { dendrogram } : {}),
  }
  const style = {
    ...(missing !== undefined ? { missing } : {}),
    ...(border !== undefined ? { border } : {}),
    ...(Object.keys(cluster).length ? { cluster } : {}),
  }
  g = withLayer(g, 'cells', {
    ...(standardize ? { stat: { kind: 'cell', standardize } } : {}),
    ...(Object.keys(style).length ? { style } : {}),
  })
  if (labels?.show) {
    const { show: _, ...rest } = labels
    const values: Layer = { id: 'values', geom: 'label', stat: { kind: 'cell' }, on: 'cells' }
    g = addLayers(g, [Object.keys(rest).length ? ({ ...values, style: rest } as Layer) : values])
  }
  const color: ColorScale = {
    ...(colors !== undefined ? { colors } : {}),
    ...(reverse !== undefined ? { reverse } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(midpoint !== undefined ? { midpoint } : {}),
    ...(colorBar !== undefined ? { bar: colorBar } : {}),
  }
  return Object.keys(color).length ? { ...g, scales: { ...g.scales, color } } : g
}
const lay = (table: DataTable, graph: GraphNode): Scene => {
  const scene = layoutGraph({ project: projectOf(table, graph), graph, fonts })
  expect(sceneToSvg(scene)).not.toContain('NaN')
  return scene
}
const text = (s: Scene, prefix: string) =>
  nodes(s, prefix).map((n) =>
    prim(n, 'text')
      .layout.runs.map((r) => r.text)
      .join(''),
  )

/** A grouped table (one value per cell) from a matrix, rows titled r1, r2…, data sets c1, c2…. */
function matrixTable(rows: readonly (readonly (number | null)[])[]): DataTable {
  const t = createTable({
    tableKind: 'grouped',
    yFormat: { type: 'replicates', count: 1 },
    columns: rows[0]!.length,
    rows: rows.length,
  })
  t.id = 't1' as NodeId
  t.rowTitles = rows.map((_, i) => `r${i + 1}`)
  t.dataSets.forEach((d, j) => {
    d.id = `c${j + 1}` as never
    d.title = `c${j + 1}`
    d.subcolumns[0]!.values = rows.map((r) => r[j] ?? null)
  })
  return t
}

describe('heat map data', () => {
  it('takes each grouped cell’s mean and each variable’s value, rows with values only', () => {
    const grouped = sampleTable('grouped')
    const g = heatmap(grouped)
    const d = heatmapData(projectOf(grouped, g), g)
    expect(d.rows).toEqual([0, 1, 2])
    expect(d.values[0]![0]).toBeCloseTo(11, 12)
    expect(d.values[1]![1]).toBeCloseTo(79 / 3, 12)
    const mv = sampleTable('multipleVariables')
    const m = heatmap(mv)
    const dm = heatmapData(projectOf(mv, m), m)
    expect(dm.series.map((s) => s.title)).toEqual(['Age', 'Dose', 'Weight', 'Score'])
    expect(dm.values[4]![2]).toBeNaN()
    // Data sets and rows chosen on the graph.
    const sliced = heatmap(
      grouped,
      {},
      { seriesSource: { table: grouped.id, include: ['b'], rows: [2, 0] } },
    )
    const ds = heatmapData(projectOf(grouped, sliced), sliced)
    expect(ds.values.map((v) => v.length)).toEqual([1, 1])
    expect(ds.values[0]![0]).toBeCloseTo(53 / 3, 12)
  })

  it('is offered for grouped, multiple-variables and contingency tables, and applies both ways', () => {
    const offers = (kind: Parameters<typeof presetsFor>[0]) => presetsFor(kind).map((p) => p.id)
    expect(offers('grouped')).toContain('heatmap')
    expect(offers('multipleVariables')).toContain('heatmap')
    expect(offers('contingency')).toContain('heatmap')
    expect(offers('column')).not.toContain('heatmap')
    const grouped = sampleTable('grouped')
    const bars = graphOf(grouped, 'bars')
    const map = applyPreset(bars, 'heatmap', grouped)
    expect(map.frame).toBe('matrix')
    expect(map.axes.y.type).toBe('categorical')
    expect(map.legend.show).toBe(false)
    const back = applyPreset({ ...map, scales: { color: { colors: 'magma' } } }, 'bars', grouped)
    expect(back.frame).toBe('grouped')
    expect(back.axes.y.type).toBe('continuous')
    expect(back.legend.show).toBe(true)
  })
})

describe('Duplicate as… a heat map, and back', () => {
  it('applies presets across frames: bars of a heat map, a heat map of bars', () => {
    const grouped = sampleTable('grouped')
    const map = heatmap(grouped, { colors: 'magma' })
    const bars = applyPreset(map, 'stacked', grouped)
    expect(bars.look).toBe('grouped.bar')
    expect(layerOf(bars, 'bars').position).toEqual({ kind: 'stack' })
    expect(bars.axes.y.type).toBe('continuous')
    const again = applyPreset(bars, 'heatmap', grouped)
    expect(again.look).toBe('heatmap.cells')
    expect(again.layers.map((l) => l.geom)).toEqual(['tile'])
    expect(again.scales?.color).toEqual({ colors: 'magma' })
    // A preset not offered for the table leaves the graph as it is.
    expect(applyPreset(map, 'histogram', grouped)).toBe(map)
  })
})

describe('colour maps and scales', () => {
  it('runs from the first to the last stop, interpolated in between, or reversed', () => {
    const v = COLOR_MAPS.viridis
    expect(colorAt(v, 0)).toBe('#440154')
    expect(colorAt(v, 1)).toBe('#fde725')
    expect(colorAt(v, 0.5)).toBe(v.stops[8])
    expect(colorAt(v, 1, true)).toBe('#440154')
    expect(colorAt(v, -3)).toBe('#440154')
    expect(colorAt(COLOR_MAPS.greys, 0.0625)).toBe('#f8f8f8')
    expect(textOn('#440154')).toBe('#ffffff')
    expect(textOn('#fde725')).toBe('#000000')
  })

  it('maps the data’s range, or a fixed one (clamped), missing values to their colour', () => {
    const s = heatScale({}, [2, 4, Number.NaN, 6])
    expect([s.lo, s.hi]).toEqual([2, 6])
    expect(s.color(2)).toBe('#440154')
    expect(s.color(6)).toBe('#fde725')
    expect(s.color(Number.NaN)).toBe(MISSING_COLOR)
    const fixed = heatScale({ min: 0, max: 4, missing: '#ff00ff' }, [2, 4, 6])
    expect(fixed.color(6)).toBe('#fde725')
    expect(fixed.color(Number.NaN)).toBe('#ff00ff')
    expect(heatScale({}, [3, 3]).t(3)).toBe(0.5)
  })

  it('centres diverging maps on the midpoint, symmetrically', () => {
    const s = heatScale({ colors: 'blueRed' }, [-1, 0.5, 3])
    expect(s.mid).toBe(0)
    expect(s.t(0)).toBe(0.5)
    expect(s.t(3)).toBe(1)
    expect(s.t(-1)).toBeCloseTo(1 / 3, 12)
    expect(s.color(0)).toBe('#f7f7f7')
    const m = heatScale({ colors: 'blueRed', midpoint: 1 }, [0, 5])
    expect(m.t(1)).toBe(0.5)
    expect(m.t(5)).toBe(1)
    // No midpoint and all positive: the range's middle.
    expect(heatScale({ colors: 'purpleGreen' }, [2, 6]).mid).toBe(4)
  })
})

describe('dendrograms', () => {
  it('draws a ⊓ per merge, children at their leaves’ slots or their middles', () => {
    // Leaves 0 and 1 merge at 1, then leaf 2 joins at 3: order 2, 0, 1.
    const lines = dendrogramLines({
      merge: [
        [-1, -2],
        [-3, 1],
      ],
      height: [1, 3],
      order: [2, 0, 1],
    })
    expect(lines).toEqual([
      [
        [1, 0],
        [1, 1],
        [2, 1],
        [2, 0],
      ],
      [
        [0, 0],
        [0, 3],
        [1.5, 3],
        [1.5, 1],
      ],
    ])
  })
})

describe('heat map layout', () => {
  it('colours a cell per value, rows down the left, data sets across', () => {
    const t = matrixTable([
      [1, 2],
      [3, null],
    ])
    const scene = lay(t, heatmap(t, { labels: { show: true } }))
    const cell = (k: string, r: number) => prim(byId(scene, `series/${k}/cell/${r}`), 'rect')
    expect(nodes(scene, 'series/').filter((n) => n.id.includes('/cell/'))).toHaveLength(4)
    expect(cell('c1', 0).fill!.color).toBe('#440154')
    expect(cell('c1', 1).fill!.color).toBe('#fde725')
    expect(cell('c2', 1).fill!.color).toBe(MISSING_COLOR)
    expect(cell('c2', 0).x).toBeGreaterThan(cell('c1', 0).x)
    expect(cell('c1', 1).y).toBeGreaterThan(cell('c1', 0).y)
    expect(text(scene, 'axis/y/tickLabel/')).toEqual(['r1', 'r2'])
    expect(text(scene, 'axis/x/tickLabel/')).toEqual(['c1', 'c2'])
    // Values in the cells, in black or white to read on their colour; none in a missing cell.
    expect(text(scene, 'series/c1/cellLabel/')).toEqual(['1', '3'])
    expect(byId(scene, 'series/c2/cellLabel/1')).toBeUndefined()
    expect(prim(byId(scene, 'series/c1/cellLabel/0'), 'text').color).toBe('#ffffff')
    // No axis lines or ticks by default.
    expect(nodes(scene, 'axis/x/line')).toHaveLength(0)
    expect(nodes(scene, 'axis/y/tick/')).toHaveLength(0)
  })

  it('draws the colour scale right of the map, or below it', () => {
    const t = matrixTable([
      [0, 10],
      [20, 30],
    ])
    const right = lay(t, heatmap(t))
    expect(nodes(right, 'colorScale/band/')).toHaveLength(64)
    const frame = byId(right, 'colorScale/frame')!.bbox!
    expect(frame.x).toBeGreaterThan(right.plot.x + right.plot.w)
    expect(text(right, 'colorScale/label/')).toEqual(['0', '10', '20', '30'])
    // Bands run from the low colour at the bottom to the high one at the top.
    const bands = nodes(right, 'colorScale/band/').map((n) => prim(n, 'rect'))
    expect(bands[0]!.y).toBeGreaterThan(bands[63]!.y)
    expect(bands[63]!.fill!.color).toBe(colorAt(COLOR_MAPS.viridis, 63.5 / 64))
    const below = lay(t, heatmap(t, { colorBar: { position: 'bottom', title: 'Level' } }))
    const f2 = byId(below, 'colorScale/frame')!.bbox!
    expect(f2.y).toBeGreaterThan(below.plot.y + below.plot.h)
    expect(f2.w).toBeGreaterThan(f2.h)
    expect(text(below, 'colorScale/title')).toEqual(['Level'])
    expect(nodes(lay(t, heatmap(t, { colorBar: { show: false } })), 'colorScale/')).toHaveLength(0)
  })

  it('orders rows and columns as R’s hclust does, with dendrograms beside the map', () => {
    for (const f of loadFixtures<
      { rows: (number | null)[][] },
      { order: number[] | null; merge: number[][] | null }
    >('cluster')) {
      const { distance, linkage } = f.params as HeatmapStyle
      if (!f.expected.order || f.name.startsWith('columns_') || f.input.rows.length < 3) continue
      const t = matrixTable(f.input.rows)
      const scene = lay(t, heatmap(t, { clusterRows: true, distance, linkage }))
      expect(text(scene, 'axis/y/tickLabel/'), f.name).toEqual(f.expected.order.map((i) => `r${i}`))
      expect(nodes(scene, 'dendrogram/rows/'), f.name).toHaveLength(f.input.rows.length - 1)
    }
  })

  it('clusters columns (above the map) on the values shown, z-scored by row', () => {
    const rows = [
      [1, 9, 2, 8],
      [2, 7, 1, 9],
      [0, 8, 3, 7],
    ]
    const t = matrixTable(rows)
    const scene = lay(
      t,
      heatmap(t, { clusterColumns: true, standardize: 'row', colors: 'blueRed' }),
    )
    // Columns 1 and 3 are alike, as are 2 and 4.
    const order = text(scene, 'axis/x/tickLabel/')
    expect(new Set(order.slice(0, 2))).toEqual(
      order[0] === 'c1' || order[0] === 'c3' ? new Set(['c1', 'c3']) : new Set(['c2', 'c4']),
    )
    const tree = nodes(scene, 'dendrogram/columns/').map((n) => prim(n, 'polyline'))
    expect(tree).toHaveLength(3)
    for (const line of tree) for (const [, y] of line.points) expect(y).toBeLessThan(scene.plot.y)
    // The colour scale says what is shown.
    expect(text(scene, 'colorScale/title')).toEqual(['z-score'])
  })

  it('keeps the order with a warning when rows can’t be clustered', () => {
    const t = matrixTable([
      [1, 2, 3],
      [5, 5, 5],
      [2, 4, 7],
    ])
    const scene = lay(t, heatmap(t, { clusterRows: true, distance: 'pearson' }))
    expect(scene.warnings.join(' ')).toMatch(/can’t be clustered/)
    expect(text(scene, 'axis/y/tickLabel/')).toEqual(['r1', 'r2', 'r3'])
    expect(nodes(scene, 'dendrogram/')).toHaveLength(0)
  })
})
