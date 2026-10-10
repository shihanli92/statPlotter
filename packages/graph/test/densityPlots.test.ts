import {
  type DataTable,
  type GraphNode,
  graphRefs,
  type Layer,
  type LayerOf,
  levelKey,
  type NodeId,
  presetRecipe,
} from '@ps/model'
import { dotPlotStats, hexbin, logicle } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { syntheticTable } from '../../model/test/synthetic.ts'
import {
  ARCSINH_COFACTOR,
  binRows,
  cellsAllowed,
  checkLayers,
  continuousColor,
  cytoRange,
  cytoTicks,
  cytoTickText,
  DOT_COLORS,
  frameAllowed,
  geomAllowed,
  isCytoScale,
  isLogScale,
  layoutGraph,
  layoutLayers,
  levelVariables,
  markInfo,
  newGraphNode,
  plotStyle,
  presetFits,
  presetLayers,
  recipeLayers,
  resolveSeries,
  type Scene,
  splitGraphs,
  styleAllowed,
  styleContext,
  styleOfLayer,
  tickFormatter,
  transformOf,
  variableHistogram,
} from '../src/index.ts'
import {
  cytometryTable,
  flatten,
  fonts,
  growthRatio,
  nodes,
  prim,
  projectOf,
  sampleVariables,
} from './helpers.ts'

// Roadmap 34g: cytometry axes (arcsinh, logicle) and densities of a graph of variables' points —
// hexagons, contours, images, points coloured by density — histograms in transformed bins and
// dot plots. The numbers are `@ps/stats`' (oracle suites `cytometry`, `density2d`, `hexbin`,
// `dotplot`); these tests check how the graphs draw them.

const cy = cytometryTable()
const lay = (g: GraphNode, table: DataTable = cy): Scene =>
  layoutGraph({ project: projectOf(table, g), graph: g, fonts })

/** An XY graph of the cytometry table's variables with these layers and axes. */
function xyGraph(
  layers: Layer[],
  axes: { x?: object; y?: object } = {},
  table: DataTable = cy,
): GraphNode {
  const g = newGraphNode(table, { frame: 'xy', look: 'bubble.scatter', layers })
  return {
    ...g,
    id: 'g1' as NodeId,
    legend: { ...g.legend, show: true },
    axes: {
      ...g.axes,
      x: { ...g.axes.x, ...axes.x },
      y: { ...g.axes.y, ...axes.y },
    } as GraphNode['axes'],
  }
}
const points = (aes: Layer['aes'] = { x: 'c', y: 'd' }, style: object = {}, visible = true) =>
  ({
    id: 'points',
    geom: 'points',
    stat: { kind: 'identity' },
    aes,
    style,
    ...(visible ? {} : { visible: false }),
  }) as Layer
const values = (key: string) => cy.dataSets.find((d) => d.id === key)!.subcolumns[0]!.values

describe('cytometry transforms of axes', () => {
  it('logicle and arcsinh transforms, with their parameters and defaults', () => {
    const lg = transformOf({ scale: 'logicle' })
    expect(lg.forward(262144)).toBeCloseTo(4.5, 12)
    expect(lg.forward(0)).toBeCloseTo(0.5, 12)
    expect(lg.inverse(lg.forward(-300))).toBeCloseTo(-300, 8)
    // Unusable parameters fall back to flowCore's defaults.
    expect(transformOf({ scale: 'logicle', logicle: { W: 9 } }).forward(0)).toBeCloseTo(0.5, 12)
    const a5 = transformOf({ scale: 'arcsinh' })
    expect(a5.forward(ARCSINH_COFACTOR)).toBe(Math.asinh(1))
    const a150 = transformOf({ scale: 'arcsinh', arcsinh: { cofactor: 150 } })
    expect(a150.forward(-300)).toBe(Math.asinh(-2))
    expect(a150.inverse(Math.asinh(-2))).toBeCloseTo(-300, 9)
    expect([isLogScale('log2'), isLogScale('logicle'), isCytoScale('arcsinh')]).toEqual([
      true,
      false,
      true,
    ])
    expect(a5.positive || lg.positive).toBe(false)
  })

  it('tick at 0 and the decades that stand apart (FlowJo’s 0, 10³, 10⁴, 10⁵)', () => {
    const lg = transformOf('logicle')
    expect(cytoTicks(lg, -500, 262144).ticks).toEqual([0, 1000, 10000, 100000])
    expect(cytoTicks(lg, -5000, 262144).ticks).toEqual([-1000, 0, 1000, 10000, 100000])
    const a5 = transformOf('arcsinh')
    expect(cytoTicks(a5, 0, 10000).ticks).toEqual([0, 10, 100, 1000, 10000])
    const a150 = transformOf({ scale: 'arcsinh', arcsinh: { cofactor: 150 } })
    expect(cytoTicks(a150, -1000, 100000).ticks).toEqual([-1000, 0, 1000, 10000, 100000])
    // Labels that crowd: every other decade.
    const fewer = cytoTicks(a5, 0, 10000, (v) => v.length <= 3).ticks
    expect(fewer).toEqual([0, 100, 10000])
    // Minor ticks between decades, none on a major tick.
    const { minorTicks, ticks } = cytoTicks(lg, -500, 262144)
    expect(minorTicks).toContain(2000)
    expect(minorTicks.some((m) => ticks.includes(m))).toBe(false)
  })

  it('range automatically: zero shown; logicle its whole display; ends rounded', () => {
    const lg = transformOf('logicle')
    const bottom = lg.inverse(0)
    expect(cytoRange(lg, -50, 20000, 262144)).toEqual([bottom, 262144])
    expect(cytoRange(lg, -5000, 5e5, 262144)).toEqual([-5000, 500000])
    expect(cytoRange(lg, -1234, 300001, 262144)).toEqual([-2000, 400000])
    const a5 = transformOf('arcsinh')
    expect(cytoRange(a5, -37, 2345)).toEqual([-40, 3000])
    expect(cytoRange(a5, 12, 2345)).toEqual([0, 3000])
  })

  it('label 0, ±10ⁿ from 1,000 as powers, smaller values plainly', () => {
    expect(cytoTickText(0)).toEqual([{ text: '0' }])
    expect(cytoTickText(1000)).toEqual([{ text: '10' }, { text: '3', sup: true }])
    expect(cytoTickText(-10000)).toEqual([{ text: '−10' }, { text: '4', sup: true }])
    expect(cytoTickText(100)).toEqual([{ text: '100' }])
    expect(cytoTickText(-10)).toEqual([{ text: '−10' }])
    // A number format of the user's own still applies.
    expect(tickFormatter({ mode: 'fixed', digits: 0 }, [1000], 'logicle')(1000)).toEqual([
      { text: '1000' },
    ])
  })

  it('place every point by its transformed value, negatives included', () => {
    const g = xyGraph([points()], { x: { scale: 'logicle' }, y: { scale: 'arcsinh' } })
    const scene = lay(g)
    const drawn = nodes(scene, 'series/d/point/')
    expect(drawn).toHaveLength(cy.rowCount)
    const lg = transformOf('logicle')
    const x = scene.axes!.x
    const [r0, r1] = [3, 7]
    const [v0, v1] = [values('c')[r0]!, values('c')[r1]!]
    const p = (r: number) =>
      prim(
        drawn.find((n) => n.id === `series/d/point/${r}`),
        'symbol',
      ).cx
    // Positions are linear in the transformed values.
    const k = (p(r1) - p(r0)) / (lg.forward(v1) - lg.forward(v0))
    expect(x.toPx(0) - p(r0)).toBeCloseTo(k * (lg.forward(0) - lg.forward(v0)), 6)
    expect(values('c').some((v) => (v ?? 0) < 0)).toBe(true)
    const labels = flatten(scene.root)
      .filter((n) => n.id.startsWith('axis/x/tickLabel'))
      .map((n) => (n.prim?.type === 'text' ? n.prim.layout.runs.map((r) => r.text).join('') : ''))
    expect(labels).toEqual(['0', '103', '104', '105'])
    expect(scene.warnings).toEqual([])
  })

  it('colour scales of a number variable on a transformed scale (log, arcsinh, logicle)', () => {
    const c = continuousColor([1, 10, 100], { transform: 'log10' })
    expect(c.t(10)).toBeCloseTo(0.5, 12)
    expect(c.color(-1)).toBe('#b4b4b4')
    const s = continuousColor([-100, 0, 1000], { transform: 'arcsinh', arcsinh: { cofactor: 150 } })
    expect(s.t(0)).toBeCloseTo(
      Math.asinh(100 / 150) / (Math.asinh(100 / 150) + Math.asinh(1000 / 150)),
      12,
    )
  })
})

describe('hexagons', () => {
  const hex = (stat: object = {}, style: object = {}): Layer =>
    ({ id: 'hexes', geom: 'hex', stat: { kind: 'hexbin', ...stat }, aes: {}, style }) as Layer

  it('count every point drawn once, in regular hexagons, with a colour bar of counts', () => {
    const g = xyGraph([hex({ bins: 12 }), points(undefined, {}, false)])
    const scene = lay(g)
    const cells = nodes(scene, 'series/d/hex/')
    expect(cells.length).toBeGreaterThan(10)
    // The counts are hexbin's of the points (here on linear axes, their own values).
    const xs = values('c') as number[]
    const ys = values('d') as number[]
    const h = hexbin(xs, ys, { xbins: 12, shape: cellsShape(scene, xs, ys) })!
    expect(h.count.reduce((a, b) => a + b, 0)).toBe(cy.rowCount)
    expect(cells.length).toBe(h.cell.length)
    // A hexagon inside the plot: its height over its width is 2 / √3.
    const whole = cells.map((n) => prim(n, 'polygon').points).find((pts) => pts.length === 6)!
    const w = Math.max(...whole.map((q) => q[0])) - Math.min(...whole.map((q) => q[0]))
    const hgt = Math.max(...whole.map((q) => q[1])) - Math.min(...whole.map((q) => q[1]))
    expect(hgt / w).toBeCloseTo(2 / Math.sqrt(3), 3)
    // The legend: "Count" and its colour bar; no hover card on a hexagon.
    expect(flatten(scene.root).some((n) => n.id === 'legend/density/hexes')).toBe(true)
    expect(nodes(scene, 'legend/density/hexes/bar/band/')).toHaveLength(64)
    expect(markInfo(projectOf(cy, g), g, cells[0]!)).toBeNull()
  })

  it('bin in the axes’ transformed values (logicle), log colours by count', () => {
    const g = xyGraph([hex({ bins: 10 }, { log: true }), points(undefined, {}, false)], {
      x: { scale: 'logicle' },
      y: { scale: 'logicle' },
    })
    const scene = lay(g)
    const lg = logicle({ T: 262144, W: 0.5, M: 4.5, A: 0 })
    const xs = (values('c') as number[]).map(lg.scale)
    const ys = (values('d') as number[]).map(lg.scale)
    const h = hexbin(xs, ys, { xbins: 10, shape: cellsShape(scene, xs, ys, true) })!
    expect(nodes(scene, 'series/d/hex/').length).toBe(h.cell.length)
    // A log colour bar ticks at round counts.
    const labels = flatten(scene.root).filter((n) =>
      n.id.startsWith('legend/density/hexes/bar/label'),
    )
    expect(labels.length).toBeGreaterThan(1)
  })

  it('draw where a graph of variables maps points (shown or hidden), on cells tables too', () => {
    expect(geomAllowed('multipleVariables', 'hex', 'hexbin').allowed).toBe(true)
    expect(geomAllowed('xy', 'hex', 'hexbin').allowed).toBe(false)
    expect(frameAllowed('category', 'multipleVariables', 'hex', 'hexbin').allowed).toBe(false)
    const hidden = checkLayers(
      { frame: 'xy', layers: [hex(), points(undefined, {}, false)] },
      'multipleVariables',
    )
    expect(hidden.get('hexes')).toEqual({ allowed: true })
    const none = checkLayers({ frame: 'xy', layers: [hex()] }, 'multipleVariables')
    expect(none.get('hexes')?.reason).toBe('needs mapped points')
    expect(cellsAllowed('multipleVariables', 'xy', 'hex', 'hexbin', { rows: 1e6 }).allowed).toBe(
      true,
    )
    expect(
      cellsAllowed('multipleVariables', 'xy', 'contour', 'density2d', { rows: 1e6 }).allowed,
    ).toBe(true)
  })
})

/** The shape the hex layer bins with: the points' span on screen, height over width. */
function cellsShape(scene: Scene, xs: number[], ys: number[], transformed = false): number {
  const ax = scene.axes!
  const lg = logicle({ T: 262144, W: 0.5, M: 4.5, A: 0 })
  const raw = (v: number) => (transformed ? lg.inverse(v) : v)
  const span = (v: number[], to: (u: number) => number) =>
    Math.abs(to(raw(Math.max(...v))) - to(raw(Math.min(...v))))
  return span(ys, ax.y.toPx) / span(xs, ax.x.toPx)
}

describe('density contours and images', () => {
  const cells = syntheticTable({ rows: 400, genes: 2, pcs: 2, cellIds: false })
  const key = (title: string) => cells.dataSets.find((d) => d.title === title)!.id
  const umap = { x: key('UMAP_1'), y: key('UMAP_2') }
  const contour = (stat: object = {}, style: object = {}): Layer =>
    ({
      id: 'contours',
      geom: 'contour',
      stat: { kind: 'density2d', n: 40, ...stat },
      aes: {},
      style,
    }) as Layer

  it('draw lines at ggplot2’s levels, one set per group of the colour variable', () => {
    const g = xyGraph([points({ ...umap, color: key('cell_type') }), contour()], {}, cells)
    const scene = lay(g, cells)
    const lines = nodes(scene, `series/${umap.y}/contour/`)
    expect(lines.length).toBeGreaterThan(10)
    // Each group's lines in its colour (8 cell types; a sparse one may reach no level).
    const colors = new Set(lines.map((n) => prim(n, 'polyline').stroke.color))
    expect(colors.size).toBeGreaterThanOrEqual(6)
  })

  it('at the levels holding shares of each group’s points, or as filled bands', () => {
    const g = xyGraph([points(umap), contour({ levels: 'shares' }, { draw: 'bands' })], {}, cells)
    const scene = lay(g, cells)
    // One group: four bands (50, 75, 90, 95%) on viridis, the regions nested.
    const bands = nodes(scene, `series/${umap.y}/band/`)
    expect(bands).toHaveLength(4)
    expect(bands.every((n) => prim(n, 'path').fill)).toBe(true)
    expect(flatten(scene.root).some((n) => n.id === 'legend/density/contours')).toBe(true)
  })

  it('an image of the density grid, cut to the plot', () => {
    const raster = {
      id: 'density',
      geom: 'raster',
      stat: { kind: 'density2d', n: 30 },
      aes: {},
    } as Layer
    const scene = lay(xyGraph([raster, points(umap, {}, false)], {}, cells), cells)
    const img = prim(nodes(scene, `series/${umap.y}/raster`)[0], 'image')
    expect([img.asset.width, img.asset.height]).toEqual([30, 30])
    expect(img.x).toBeGreaterThanOrEqual(scene.plot.x - 1e-9)
    expect(img.x + img.w).toBeLessThanOrEqual(scene.plot.x + scene.plot.w + 1e-9)
  })

  it('points coloured by their local density, the densest drawn last', () => {
    const g = xyGraph([points(umap, { colorBy: 'density', order: 'value', size: 3 })], {}, cells)
    const scene = lay(g, cells)
    const drawn = nodes(scene, `series/${umap.y}/point/`)
    expect(drawn).toHaveLength(cells.rowCount)
    const fills = drawn.map((n) => prim(n, 'symbol').fill?.color)
    expect(new Set(fills).size).toBeGreaterThan(50)
    // Viridis's top, the densest point's, is painted last.
    expect(fills.at(-1)).toBe('#fde725')
    // The colour bar headed "Density".
    const heading = flatten(scene.root).find((n) => n.id === 'legend/bubble/color')
    expect(heading).toBeDefined()
  })

  it('are styles of graphs of variables with mapped points', () => {
    const c = styleContext(cells, 'xy', [points(umap)])
    for (const id of ['hexbin', 'contours', 'contourBands', 'densityImage'])
      expect(styleAllowed(plotStyle(id)!, c), id).toEqual({ allowed: true })
    expect(styleAllowed(plotStyle('hexbin')!, styleContext(cells, 'xy', [])).reason).toBe(
      'needs mapped points',
    )
    expect(presetLayers('densityContours', cells)?.layers.map((l) => l.geom)).toEqual([
      'points',
      'contour',
    ])
    expect(styleOfLayer(contour({}, { draw: 'both' }), 'xy')?.id).toBe('contourBands')
  })
})

describe('histograms on cytometry axes', () => {
  it('bin the transformed values: bars equally wide on a logicle axis, edges in raw units', () => {
    const base = newGraphNode(cy, {
      frame: 'xy',
      look: 'xy.scatter',
      layers: [variableHistogram('c')],
    })
    const g: GraphNode = {
      ...base,
      id: 'g1' as NodeId,
      axes: { ...base.axes, x: { ...base.axes.x, scale: 'logicle' } } as GraphNode['axes'],
    }
    const scene = lay(g)
    const bars = nodes(scene, 'series/c/bar/').map((n) => prim(n, 'rect'))
    expect(bars.length).toBeGreaterThan(5)
    const widths = bars.map((b) => b.w).sort((a, b) => a - b)
    expect(widths.at(-1)! - widths[1]!).toBeLessThan(1e-6)
    const layer = g.layers[0] as LayerOf<'bar'>
    const sets = resolveSeries(projectOf(cy, g), g).map((s) => s.ds)
    const lg = transformOf('logicle')
    const bins = binRows(layer, sets, lg)
    const [lo, hi] = bins.edges![0]!
    expect(lg.forward(hi) - lg.forward(lo)).toBeCloseTo(bins.width, 12)
    // The hover card names the bin's raw edges.
    const info = markInfo(projectOf(cy, g), g, {
      target: ['layers', 'bars', 'series', 'c'],
      point: 'r0',
    })
    expect(info?.lines[0]?.label).toBe('Bin')
    // On a linear axis, as before: raw bins.
    expect(binRows(layer, sets).edges).toBeUndefined()
  })

  it('one histogram per variable: a set split by data set, each binning its own', () => {
    const base = newGraphNode(cy, {
      frame: 'xy',
      look: 'xy.scatter',
      layers: [variableHistogram('c', 'p')],
    })
    const g: GraphNode = {
      ...base,
      id: 'g1' as NodeId,
      seriesSource: { ...base.seriesSource, include: ['c', 'd', 'e'] as never },
      axes: {
        ...base.axes,
        x: { ...base.axes.x, title: { content: [{ text: 'CD3' }] } },
      } as GraphNode['axes'],
    }
    const set = splitGraphs(cy, g, { by: 'dataSet' })
    expect(set.map((m) => (m.layers[0] as LayerOf<'bar'>).aes?.x)).toEqual(['c', 'd', 'e'])
    expect(set.map((m) => m.axes.x.title?.content[0]?.text)).toEqual(['CD3', 'CD19', 'CD56'])
    expect(set.every((m) => (m.layers[0] as LayerOf<'bar'>).aes?.color === 'p')).toBe(true)
  })
})

describe('dot plots', () => {
  const cells = syntheticTable({ rows: 300, genes: 4, pcs: 0, cellIds: false })
  const key = (title: string) => cells.dataSets.find((d) => d.title === title)!.id
  const genes = ['GENE1', 'GENE2', 'GENE3', 'GENE4'].map(key)
  const dotGraph = (layers: Layer[], more: Partial<GraphNode> = {}): GraphNode => {
    const g = newGraphNode(cells, { frame: 'matrix', look: 'heatmap.cells', layers })
    return {
      ...g,
      id: 'g1' as NodeId,
      levelOrder: 'natural',
      seriesSource: { ...g.seriesSource, include: genes as never },
      ...more,
    }
  }
  const dots = (stat: object = {}, group: string = key('cluster')): Layer =>
    ({ id: 'dots', geom: 'points', stat: { kind: 'dotplot', ...stat }, aes: { group } }) as Layer

  it('a dot per variable and level: size the percent expressing, colour the scaled average', () => {
    const scene = lay(dotGraph([dots()]), cells)
    const levels = [...new Set(cells.dataSets.find((d) => d.id === key('cluster'))!.text!)]
      .filter((t): t is string => !!t)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    const groups = cells.dataSets
      .find((d) => d.id === key('cluster'))!
      .text!.map((t) => levels.indexOf(t!))
    const vals = cells.dataSets.find((d) => d.id === genes[0])!.subcolumns[0]!.values as number[]
    const stats = dotPlotStats(vals, groups, levels.length, { scale: true })
    const first = nodes(scene, `series/${genes[0]}/dot/`)
    // Each level with someone expressing has its dot, the largest for the most expressing.
    expect(first.length).toBe(Array.from(stats.percent).filter((p) => p > 0).length)
    const at = (level: string) =>
      prim(
        first.find((n) => n.id.endsWith(levelKey(level))),
        'symbol',
      ).size
    const most = levels[stats.percent.indexOf(Math.max(...stats.percent))]!
    expect(first.every((n) => prim(n, 'symbol').size <= at(most) + 1e-9)).toBe(true)
    // Rows top to bottom in natural order; the variables along the bottom.
    const yLabels = flatten(scene.root)
      .filter((n) => n.id.startsWith('axis/y/tickLabel'))
      .map((n) => (n.prim?.type === 'text' ? n.prim.layout.runs.map((r) => r.text).join('') : ''))
    expect(yLabels).toEqual(levels)
    // Seurat's colours unless the graph sets its own; a size guide and a colour bar.
    const colors = nodes(scene, 'series/').map((n) => prim(n, 'symbol').fill?.color)
    expect(colors).toContain(DOT_COLORS[1])
    expect(flatten(scene.root).some((n) => n.id === 'legend/dotplot/size')).toBe(true)
    expect(nodes(scene, 'legend/dotplot/color/bar/band/')).toHaveLength(64)
    expect(scene.warnings).toEqual([])
  })

  it('tiles of the averages behind the dots; nothing else on a dot plot', () => {
    const tiles = {
      id: 'tiles',
      geom: 'tile',
      stat: { kind: 'dotplot' },
      aes: { group: key('cluster') },
    } as Layer
    const scene = lay(dotGraph([tiles, dots()]), cells)
    expect(nodes(scene, `series/${genes[0]}/cell/`).length).toBe(14)
    const heat = { id: 'cells', geom: 'tile', stat: { kind: 'identity' } } as Layer
    const check = checkLayers({ frame: 'matrix', layers: [heat, dots()] }, 'multipleVariables')
    expect(check.get('cells')?.reason).toBe(
      'a dot plot draws dots and tiles of its statistics only',
    )
    expect(frameAllowed('xy', 'multipleVariables', 'points', 'dotplot').allowed).toBe(false)
    const ungrouped = checkLayers(
      { frame: 'matrix', layers: [{ ...dots(), aes: {} } as Layer] },
      'multipleVariables',
    )
    expect(ungrouped.get('dots')?.reason).toBe('needs a text variable to group by')
  })

  it('without a text variable says so; a split graph summarises its level’s rows', () => {
    const none = lay(dotGraph([dots({}, 'nope')]), cells)
    expect(none.warnings).toContain('A dot plot needs a text variable to group the rows by.')
    const sample = key('sample')
    const g = dotGraph([dots()], {
      seriesSource: {
        table: cells.id,
        include: genes as never,
        filter: { variable: sample as never, level: levelKey('S1_ctrl') },
      },
    })
    const all = nodes(lay(dotGraph([dots()]), cells), `series/${genes[0]}/dot/`)
    const part = nodes(lay(g, cells), `series/${genes[0]}/dot/`)
    expect(part.map((n) => prim(n, 'symbol').size)).not.toEqual(
      all.map((n) => prim(n, 'symbol').size),
    )
  })

  it('lists its group variable in Order of levels…', () => {
    const vars = levelVariables(cells, dotGraph([dots()]), null)
    expect(vars.map((v) => [v.id, v.role])).toEqual([[key('cluster'), 'groups']])
    expect(vars[0]!.levels.slice(0, 3)).toEqual(['C0', 'C1', 'C2'])
  })

  it('walks its group variable as a reference, and keeps it out of user presets', () => {
    const g = dotGraph([dots()])
    expect(
      graphRefs(g).some((r) => r.kind === 'key' && r.key === key('cluster') && r.role === 'aes'),
    ).toBe(true)
    const recipe = presetRecipe(g, 'multipleVariables', cells)
    expect(presetFits(recipe, 'multipleVariables', sampleVariables())).toBe(true)
    const applied = recipeLayers(recipe, sampleVariables(), 'Dots')
    expect(applied.layers[0]!.aes).toEqual({ group: 'a' })
    expect(presetFits(recipe, 'multipleVariables', cy)).toBe(true)
  })
})

describe('linear time on many points', () => {
  const big = syntheticTable({ rows: 200_000, genes: 3, pcs: 0, cellIds: false })
  const key = (title: string) => big.dataSets.find((d) => d.title === title)!.id
  const umap = { x: key('UMAP_1'), y: key('UMAP_2') }
  /** The first `n` rows of the big table (each layout a new table: nothing cached). */
  const head = (n: number): DataTable => ({
    ...big,
    rowCount: n,
    dataSets: big.dataSets.map((d) => ({
      ...d,
      subcolumns: d.subcolumns.map((s) => ({ ...s, values: s.values.slice(0, n) })),
      ...(d.text ? { text: d.text.slice(0, n) } : {}),
    })),
  })
  it('hexagons and contours of 20,000 vs 200,000 points: linear', () => {
    const layers = [
      { id: 'hexes', geom: 'hex', stat: { kind: 'hexbin' }, aes: {} } as Layer,
      { id: 'contours', geom: 'contour', stat: { kind: 'density2d' }, aes: {} } as Layer,
      points(umap, {}, false),
    ]
    const ratio = growthRatio(
      (n) => {
        const t = head(n)
        layoutLayers({ project: projectOf(t), graph: xyGraph(layers, {}, t), fonts })
      },
      20_000,
      10,
      2,
    )
    expect(ratio).toBeLessThan(16)
  })
})
