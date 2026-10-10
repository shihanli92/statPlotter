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
import { frequencyDistribution, histogram } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import {
  binRows,
  binsFill,
  checkLayers,
  frameChoiceSelected,
  histogramLayer,
  layoutGraph,
  levelVariables,
  markInfo,
  newGraphNode,
  newLayerLooks,
  OVERLAID_BINS,
  plotStyle,
  presetFits,
  presetGraph,
  recipeLayers,
  resolveSeries,
  styleAllowed,
  styleContext,
  styleOfLayer,
  variableBins,
  variableHistogram,
} from '../src/index.ts'
import { fonts, nodes, projectOf, sampleTable, sampleVariables } from './helpers.ts'

// Roadmap 34f: histograms of a multiple-variables table's number variable (decision 435), per
// level of a text variable, overlaid or stacked; the numbers are the frequency distribution's
// (`@ps/stats` `histogram`, R oracle suite `frequency`).

// Sample variables: a Group (Low, High, Mid; row 12 none), b Sex, c Score (row 13 none), d Age.
const t = sampleVariables()
const graphOf = (layer: Layer, more: Partial<GraphNode> = {}): GraphNode => ({
  ...newGraphNode(t, { frame: 'xy', look: 'xy.scatter', layers: [layer] }),
  id: 'g1' as NodeId,
  ...more,
})
const scores = (rows: readonly number[]) =>
  rows.map((r) => t.dataSets[2]!.subcolumns[0]!.values[r]!)
const lay = (g: GraphNode, table: DataTable = t) =>
  layoutGraph({ project: projectOf(table, g), graph: g, fonts })

describe('a histogram of a variable’s data sets', () => {
  it('bins the variable on X as one data set, keyed and coloured by the variable', () => {
    const [s, ...more] = variableBins(t, {}, { aes: { x: 'c' } }, null).series
    expect(more).toEqual([])
    expect(s!.key).toBe('c')
    expect(s!.title).toBe('Score')
    expect(s!.index).toBe(2)
    // Every row with a value (row 13 has none).
    expect([...(s!.ds.data as { reps: Float64Array[] }).reps[0]!]).toEqual(
      scores(Array.from({ length: 13 }, (_, r) => r)),
    )
  })

  it('makes a data set per level of the colour variable, in the graph’s order', () => {
    const appearance = variableBins(t, {}, { aes: { x: 'c', color: 'a' } }, null)
    expect(appearance.series.map((s) => s.title)).toEqual(['Low', 'High', 'Mid'])
    expect(appearance.series.map((s) => s.key)).toEqual(['Low', 'High', 'Mid'].map(levelKey))
    expect(appearance.series.map((s) => s.index)).toEqual([0, 1, 2])
    expect(appearance.groupTitle).toBe('Group')
    // Row 12 has a score but no group: left out, counted.
    expect(appearance.noLevel).toBe(1)
    const low = appearance.series[0]!.ds.data as { reps: Float64Array[] }
    expect([...low.reps[0]!]).toEqual(scores([0, 3, 6, 9]))
    const natural = variableBins(
      t,
      { levelOrder: 'natural' },
      { aes: { x: 'c', color: 'a' } },
      null,
    )
    expect(natural.series.map((s) => s.title)).toEqual(['High', 'Low', 'Mid'])
    const stored = variableBins(
      t,
      { levels: { a: ['Mid'] } },
      { aes: { x: 'c', color: 'a' } },
      null,
    )
    expect(stored.series.map((s) => s.title)).toEqual(['Mid', 'Low', 'High'])
  })

  it('bins only the graph’s rows (one graph per level), and nothing without a number on X', () => {
    const g = graphOf(variableHistogram('c', 'a'), {
      seriesSource: {
        table: t.id,
        include: 'all',
        filter: { variable: 'b', level: levelKey('F') },
      },
    })
    const sets = resolveSeries(projectOf(t, g), g)
    const all = sets.flatMap((s) => [...(s.ds.data as { reps: Float64Array[] }).reps[0]!])
    expect(all.sort((x, y) => x - y)).toEqual(scores([0, 2, 4, 6, 8, 10]).sort((x, y) => x - y))
    expect(variableBins(t, {}, { aes: { x: 'a' } }, null).series).toEqual([])
    expect(variableBins(t, {}, { aes: {} }, null).series).toEqual([])
  })

  it('is the graph’s data sets: Format, legends and hover cards read the levels', () => {
    const g = graphOf(variableHistogram('c', 'a'))
    expect(histogramLayer(g)?.id).toBe('bars')
    expect(resolveSeries(projectOf(t, g), g).map((s) => s.title)).toEqual(['Low', 'High', 'Mid'])
    // A graph without a histogram of a variable keeps the variables as its data sets.
    const columns = presetGraph(t, 'points')
    expect(resolveSeries(projectOf(t, columns), columns).map((s) => s.key)).toEqual(['c', 'd'])
  })
})

describe('the bins', () => {
  it('are the frequency distribution’s, per group, in shared bins', () => {
    const g = graphOf(variableHistogram('c', 'a'))
    const layer = g.layers[0] as LayerOf<'bar'>
    const sets = resolveSeries(projectOf(t, g), g).map((s) => s.ds)
    const bins = binRows(layer, sets)
    const groups = [scores([0, 3, 6, 9]), scores([1, 4, 7, 10]), scores([2, 5, 8, 11])]
    const fd = frequencyDistribution(groups)
    expect(bins.width).toBe(fd.binWidth)
    expect(bins.centers).toEqual(fd.centers)
    expect(bins.values).toEqual(histogram(groups).values)
    for (const [k, rows] of bins.rows.entries())
      for (const r of rows) expect(r.stats.mean).toBe(fd.counts[k]![r.row])
  })

  it('stack each group on the ones before it when stacked', () => {
    const layer = variableHistogram('c', 'a', true)
    expect(layer.position).toEqual({ kind: 'stack' })
    const g = graphOf(layer)
    const sets = resolveSeries(projectOf(t, g), g).map((s) => s.ds)
    const bins = binRows(layer, sets)
    const below = bins.centers.map(() => 0)
    for (const [k, rows] of bins.rows.entries())
      for (const r of rows) {
        expect(r.base).toBe(below[r.row])
        expect(r.stats.mean).toBe(below[r.row]! + bins.values[k]![r.row]!)
        below[r.row] = r.stats.mean
      }
    // Overlaid bars stand on zero.
    const flat = binRows(variableHistogram('c', 'a'), sets)
    expect(flat.rows.flat().every((r) => r.base === undefined)).toBe(true)
  })

  it('are drawn as bars in each group’s colour, stacked ones touching', () => {
    const g = graphOf(variableHistogram('c', 'a', true))
    const scene = lay(g)
    const bars = nodes(scene, 'series/').filter((n) => n.prim?.type === 'rect')
    expect(bars.length).toBeGreaterThan(3)
    expect(scene.warnings).toEqual(['1 row without a level of the colour variable left out.'])
    // A bin's segments meet: each one's bottom is the top of the one below.
    const byX = new Map<number, { y: number; h: number }[]>()
    for (const b of bars) {
      const r = b.prim as { x: number; y: number; h: number }
      byX.set(Math.round(r.x * 100), [...(byX.get(Math.round(r.x * 100)) ?? []), r])
    }
    for (const segs of byX.values()) {
      const sorted = [...segs].sort((a, b) => b.y - a.y)
      for (let i = 1; i < sorted.length; i++)
        expect(sorted[i]!.y + sorted[i]!.h).toBeCloseTo(sorted[i - 1]!.y, 6)
    }
  })

  it('are overlaid translucent when grouped, opaque as the theme’s otherwise', () => {
    expect(variableHistogram('c', 'a').style).toEqual({ fill: OVERLAID_BINS })
    expect(variableHistogram('c').style).toBeUndefined()
    expect(variableHistogram('c', 'a', true).style).toBeUndefined()
    // Grouping or stacking later follows (a fill of the user's own stays).
    const grouped = binsFill({ ...variableHistogram('c'), aes: { x: 'c', color: 'a' } })
    expect(grouped.style).toEqual({ fill: OVERLAID_BINS })
    const stacked = binsFill({ ...variableHistogram('c', 'a'), position: { kind: 'stack' } })
    expect(stacked.style).toBeUndefined()
    const own = { type: 'solid', color: { rgb: '#ff0000' }, opacity: 1 } as const
    const mine = binsFill({
      ...variableHistogram('c'),
      aes: { x: 'c', color: 'a' },
      style: { fill: own },
    })
    expect(mine.style).toEqual({ fill: own })
  })
})

describe('a histogram graph of variables', () => {
  it('is titled after its variable and what it counts, with a legend of its groups', () => {
    const plain = graphOf(variableHistogram('c'))
    expect(plain.axes.x.title?.content).toEqual([{ text: 'Score' }])
    expect(plain.axes.y.title?.content).toEqual([{ text: 'Number of values' }])
    expect(plain.legend.show).toBe(false)
    expect(graphOf(variableHistogram('c', 'a')).legend.show).toBe(true)
    expect(plain.look).toBe('xy.scatter')
  })

  it('comes from the Histogram frame choice, chosen on a multiple-variables table', () => {
    const g = presetGraph(t, 'histogramBins')
    expect(g.layers).toEqual(newLayerLooks([variableHistogram('c')]))
    expect(styleOfLayer(g.layers[0]!, 'xy')?.id).toBe('histogram')
    // A column table's histogram is still its bars.
    const column = presetGraph(sampleTable('column'), 'histogramBins')
    expect(styleOfLayer(column.layers[0]!, 'xy')?.id).toBe('bars')
    const hist = styleContext(t, 'xy', g.layers)
    const bubble = presetGraph(t, 'bubble')
    const scatter = styleContext(t, 'xy', bubble.layers)
    expect(frameChoiceSelected(plotStyle('histogram')!, hist)).toBe(true)
    expect(frameChoiceSelected(plotStyle('bubbles')!, hist)).toBe(false)
    expect(frameChoiceSelected(plotStyle('histogram')!, scatter)).toBe(false)
    expect(frameChoiceSelected(plotStyle('bubbles')!, scatter)).toBe(true)
    expect(
      frameChoiceSelected(
        plotStyle('histogram')!,
        styleContext(sampleTable('column'), 'xy', column.layers),
      ),
    ).toBe(true)
  })

  it('draws binned bars only, and bins a number variable', () => {
    const points: Layer = {
      id: 'p',
      geom: 'points',
      stat: { kind: 'identity' },
      aes: { x: 'c', y: 'd' },
    }
    const check = checkLayers(
      { frame: 'xy', layers: [variableHistogram('c'), points] },
      'multipleVariables',
    )
    expect(check.get('bars')?.allowed).toBe(true)
    expect(check.get('p')?.reason).toBe('a histogram draws binned bars only')
    const bare = { ...variableHistogram(undefined), id: 'b' }
    expect(checkLayers({ frame: 'xy', layers: [bare] }, 'multipleVariables').get('b')?.reason).toBe(
      'needs a number variable on X',
    )
    const c = styleContext(t, 'xy', [variableHistogram('c', 'a')])
    expect(styleAllowed(plotStyle('groupLines')!, c).reason).toBe(
      'a histogram draws binned bars only',
    )
  })

  it('orders its colour variable’s levels in Order of levels…, sorted by the mean of X', () => {
    const g = graphOf(variableHistogram('c', 'a'))
    const [v, ...more] = levelVariables(t, g, null)
    expect(more).toEqual([])
    expect(v).toMatchObject({ id: 'a', role: 'colours', value: 'Score' })
    expect(v!.levels).toEqual(['Low', 'High', 'Mid'])
  })

  it('keeps as a user preset: the first number variable binned, by the first group if grouped', () => {
    const stacked = presetRecipe(graphOf(variableHistogram('d', 'b', true)), 'multipleVariables', t)
    expect(presetFits(stacked, 'multipleVariables', t)).toBe(true)
    expect(presetFits(stacked, 'column')).toBe(false)
    expect(recipeLayers(stacked, t, 'Mine').layers[0]).toMatchObject({
      aes: { x: 'c', color: 'a' },
      position: { kind: 'stack' },
    })
    const plain = presetRecipe(graphOf(variableHistogram('d')), 'multipleVariables', t)
    expect(recipeLayers(plain, t, 'Mine').layers[0]?.aes).toEqual({ x: 'c' })
  })

  it('walks its variables through graphRefs', () => {
    const g = graphOf(variableHistogram('c', 'a'))
    const aes = graphRefs(g).flatMap((r) => (r.kind === 'key' && r.role === 'aes' ? [r.key] : []))
    expect(aes).toEqual(['c', 'a'])
  })

  it('says what a bar counts on hover', () => {
    const g = graphOf(variableHistogram('c', 'a'))
    const bar = nodes(lay(g), `series/${levelKey('High')}/`).find((n) => n.prim?.type === 'rect')!
    const info = markInfo(projectOf(t, g), g, bar)!
    expect(info.title).toBe('High')
    expect(info.lines.map((l) => l.label)).toEqual(['Bin', 'Count'])
    expect(info.lines[0]!.value).toMatch(/^\S+ to \S+$/)
    expect(Number(info.lines[1]!.value)).toBeGreaterThan(0)
  })
})
