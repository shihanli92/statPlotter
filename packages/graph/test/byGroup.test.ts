import { GraphNode, type Layer, type NodeId, PresetRecipe, presetRecipe, statOf } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DASHES,
  DEFAULT_SHAPES,
  DEFAULT_THEME,
  graphDashes,
  graphShapes,
  layerStyle,
  layoutGraph,
  matchGraphFormat,
  recipeLayers,
  resetToStyle,
  styleFromGraph,
  themeOf,
} from '../src/index.ts'
import { LayerKit } from '../src/layers/kit.ts'
import { byGroupCases, groupsOf, xyThree } from './byGroupCases.ts'
import { builtGraph } from './goldenCases.ts'
import { graphOf, layerOf, withLayer, withSeriesStyle } from './graphs.ts'
import { fonts, nodes, prim, projectOf, sampleTable } from './helpers.ts'

// Roadmap 49a: aesthetics by data set (`{ series: true }`) or fixed — a symbol's shape and a
// line's pattern cycling through the graph's lists as colours cycle through the palette, fills
// and outlines by data set or fixed, per-data-set formats over the layer's, the legend drawing
// what the layer draws, and the lists carried by styles, presets and Match format.

const column = sampleTable('column')
const shapesOf = (g: GraphNode, layer: string, keys: readonly string[]) =>
  keys.map((k, i) => {
    const l = layerOf(g, layer)
    return layerStyle(DEFAULT_THEME, g, l, k, statOf(l, k), i).points.shape
  })

describe('shapes and line patterns by data set', () => {
  it('cycle through the default lists by the data set’s place, wrapping', () => {
    const g = withLayer(graphOf(groupsOf(8), 'points'), 'points', {
      style: { shape: { series: true } },
    })
    const keys = 'abcdefgh'.split('')
    expect(shapesOf(g, 'points', keys)).toEqual([...DEFAULT_SHAPES, ...DEFAULT_SHAPES.slice(0, 2)])
    expect(DEFAULT_SHAPES).toEqual(['circle', 'square', 'triangle', 'diamond', 'cross', 'plus'])
    expect(DEFAULT_DASHES).toEqual(['solid', 'dash', 'dot'])
  })

  it('take the graph’s own list, else its style’s, else the default', () => {
    const base = withLayer(graphOf(groupsOf(3), 'points'), 'points', {
      style: { shape: { series: true } },
    })
    const own: GraphNode = { ...base, style: { ...base.style, shapes: ['plus', 'diamond'] } }
    expect(shapesOf(own, 'points', ['a', 'b', 'c'])).toEqual(['plus', 'diamond', 'plus'])
    const styled = themeOf({ shapes: ['triangle', 'square'], dashes: ['dot', 'solid'] })
    expect(graphShapes(base, styled)).toEqual(['triangle', 'square'])
    expect(graphShapes(own, styled)).toEqual(['plus', 'diamond'])
    expect(graphDashes(base, styled)).toEqual(['dot', 'solid'])
    expect(graphDashes(base, DEFAULT_THEME)).toEqual(DEFAULT_DASHES)
  })

  it('a data set’s own shape wins over the layer’s by data set', () => {
    const g = withSeriesStyle(
      withLayer(graphOf(column, 'points'), 'points', { style: { shape: { series: true } } }),
      'points',
      'b',
      { shape: 'plus' },
    )
    expect(shapesOf(g, 'points', ['a', 'b', 'c'])).toEqual(['circle', 'plus', 'triangle'])
    // And a data set may take the cycle where the layer is fixed.
    const h = withSeriesStyle(
      withLayer(graphOf(column, 'points'), 'points', { style: { shape: 'diamond' } }),
      'points',
      'c',
      { shape: { series: true } },
    )
    expect(shapesOf(h, 'points', ['a', 'b', 'c'])).toEqual(['diamond', 'diamond', 'triangle'])
  })

  it('cycle the patterns of lines, error bars and centre lines', () => {
    const series = { color: { series: true }, width: 1, dash: { series: true } }
    const xy = builtGraph(xyThree(), 'xy', ['line', 'points', 'error'])
    const g = withLayer(withLayer(xy, 'line', { style: { stroke: series } }), 'error', {
      style: { line: series },
    })
    const dash = (layer: string, k: string, i: number) => {
      const l = layerOf(g, layer)
      const s = layerStyle(DEFAULT_THEME, g, l, k, statOf(l, k), i)
      return layer === 'line' ? s.line.stroke.dash : s.error.line.dash
    }
    expect(['a', 'b', 'c', 'a'].map((k, i) => dash('line', k, i))).toEqual([
      'solid',
      'dash',
      'dot',
      'solid',
    ])
    expect(dash('error', 'b', 1)).toBe('dash')
    const c = withLayer(graphOf(column, 'points'), 'center', { style: { line: series } })
    const center = layerOf(c, 'center')
    expect(layerStyle(DEFAULT_THEME, c, center, 'c', statOf(center, 'c'), 2).center.line.dash).toBe(
      'dot',
    )
  })

  it('ask for the place only when something is by data set (graphs before 49a unchanged)', () => {
    const g = graphOf(column, 'points')
    const l = layerOf(g, 'points')
    let asked = 0
    const s = layerStyle(DEFAULT_THEME, g, l, 'b', statOf(l, 'b'), () => {
      asked++
      return 1
    })
    expect(asked).toBe(0)
    expect(s).toEqual(layerStyle(DEFAULT_THEME, g, l, 'b', statOf(l, 'b')))
    const by = withLayer(g, 'points', { style: { shape: { series: true } } })
    const bl = layerOf(by, 'points')
    layerStyle(DEFAULT_THEME, by, bl, 'b', statOf(bl, 'b'), () => {
      asked++
      return 1
    })
    expect(asked).toBe(1)
  })

  it('a series’ place: data sets, then analysis outputs, then functions (as colours count)', () => {
    const table = xyThree()
    const g = builtGraph(table, 'xy', ['points'])
    const outputs = {
      id: 'fits',
      geom: 'line',
      stat: { kind: 'identity' },
      data: {
        from: 'outputs',
        series: [
          { id: 'o1', ref: { node: 'n1', key: 'curve:a' } },
          { id: 'o2', ref: { node: 'n1', key: 'curve:b' } },
        ],
      },
    } as Layer
    const fns = {
      id: 'fns',
      geom: 'line',
      stat: { kind: 'identity' },
      data: { from: 'functions', functions: [{ id: 'f1', equation: 'line', params: {} }] },
    } as Layer
    const graph = { ...g, layers: [...g.layers, outputs, fns] }
    const kit = new LayerKit({ project: projectOf(table), graph, fonts })
    expect(['a', 'b', 'c', 'o1', 'o2', 'f1', 'gone'].map((k) => kit.cycleIndex(k))).toEqual([
      0, 1, 2, 3, 4, 5, 0,
    ])
    // The layout's symbols take them.
    const by = withLayer(g, 'points', { style: { shape: { series: true } } })
    const scene = layoutGraph({ project: projectOf(table), graph: by, fonts })
    const shape = (k: string) => prim(nodes(scene, `series/${k}/point/0`)[0], 'symbol').shape
    expect(['a', 'b', 'c'].map(shape)).toEqual(['circle', 'square', 'triangle'])
  })
})

describe('fills and outlines by data set or fixed', () => {
  it('fill by data set with a black outline (ggplot’s shape 21, colour black)', () => {
    const [, table, graph] = byGroupCases().find(
      ([n]) => n === 'bygroup-points-filled-black-outline',
    )!
    const scene = layoutGraph({ project: projectOf(table), graph, fonts })
    const sym = (id: string) => prim(nodes(scene, id)[0], 'symbol')
    for (const [k, color] of [
      ['a', '#0072b2'],
      ['b', '#d55e00'],
      ['c', '#009e73'],
    ] as const) {
      expect(sym(`series/${k}/point/0`).fill?.color).toBe(color)
      expect(sym(`series/${k}/point/0`).stroke?.color).toBe('#000000')
      // The legend draws what the layer draws.
      expect(sym(`legend/${k}/symbol`).fill?.color).toBe(color)
      expect(sym(`legend/${k}/symbol`).stroke?.color).toBe('#000000')
    }
  })

  it('outlined by data set, fixed white fill; bars and boxes with a fixed fill', () => {
    const cases = Object.fromEntries(byGroupCases().map(([n, t, g]) => [n, [t, g] as const]))
    const draw = (name: string) => {
      const [table, graph] = cases[name]!
      return layoutGraph({ project: projectOf(table), graph, fonts })
    }
    const white = draw('bygroup-points-outlined-white-fill')
    const p = prim(nodes(white, 'series/b/point/0')[0], 'symbol')
    expect([p.fill?.color, p.stroke?.color]).toEqual(['#ffffff', '#d55e00'])
    const bars = draw('bygroup-bars-fixed-fill')
    const bar = prim(nodes(bars, 'series/c/bar')[0], 'rect')
    expect([bar.fill?.color, bar.stroke?.color]).toEqual(['#d9d9d9', '#009e73'])
    const swatch = prim(nodes(bars, 'legend/c/swatch')[0], 'rect')
    expect([swatch.fill?.color, swatch.stroke?.color]).toEqual(['#d9d9d9', '#009e73'])
    const boxes = draw('bygroup-boxes-fixed-fill')
    const legend = prim(nodes(boxes, 'legend/a/swatch')[0], 'rect')
    expect([legend.fill?.color, legend.stroke?.color]).toEqual(['#ffffff', '#0072b2'])
  })
})

describe('legend glyphs draw what the layers draw', () => {
  it('cycled shapes and line patterns', () => {
    const cases = Object.fromEntries(byGroupCases().map(([n, t, g]) => [n, [t, g] as const]))
    const [t1, g1] = cases['bygroup-shapes-cycled']!
    const s1 = layoutGraph({ project: projectOf(t1), graph: g1, fonts })
    expect(
      ['a', 'b', 'c'].map((k) => prim(nodes(s1, `legend/${k}/symbol`)[0], 'symbol').shape),
    ).toEqual(['circle', 'square', 'triangle'])
    const [t2, g2] = cases['bygroup-dashes-cycled']!
    const s2 = layoutGraph({ project: projectOf(t2), graph: g2, fonts })
    const dashes = ['a', 'b', 'c'].map(
      (k) => prim(nodes(s2, `legend/${k}/line`)[0], 'line').stroke.dash,
    )
    expect(dashes).toEqual(['solid', 'dash', 'dot'])
    const lines = ['a', 'b', 'c'].map(
      (k) => prim(nodes(s2, `series/${k}/line/0`)[0], 'polyline').stroke.dash,
    )
    expect(lines).toEqual(dashes)
    const [t3, g3] = cases['bygroup-shapes-custom-cycle']!
    const s3 = layoutGraph({ project: projectOf(t3), graph: g3, fonts })
    expect(
      ['a', 'b', 'c', 'd'].map((k) => prim(nodes(s3, `legend/${k}/symbol`)[0], 'symbol').shape),
    ).toEqual(['diamond', 'triangle', 'diamond', 'triangle'])
  })
})

describe('the model and what carries the lists', () => {
  it('parses shapes and dashes by data set and the graph’s lists; older graphs unchanged', () => {
    const [, , g] = byGroupCases().find(([n]) => n === 'bygroup-dashes-cycled')!
    const custom = { ...g, style: { ...g.style, shapes: ['plus'], dashes: ['dot', 'dash'] } }
    expect(GraphNode.parse(custom)).toEqual(custom)
    expect(() => GraphNode.parse({ ...g, style: { ...g.style, shapes: [] } })).toThrow()
    expect(() =>
      GraphNode.parse({ ...g, style: { ...g.style, dashes: ['dash', 'zigzag'] } }),
    ).toThrow()
    const plain = graphOf(column, 'points')
    expect(GraphNode.parse(plain)).toEqual(plain)
  })

  it('styles: saved from a graph, cleared by Reset to style', () => {
    const g = graphOf(column, 'points', (x) => ({
      style: { ...x.style, shapes: ['square', 'circle'], dashes: ['dash'] },
    }))
    const settings = { theme: 'default', pValueStyle: 'GP', pValueDigits: 4 } as const
    const style = styleFromGraph(g, settings as never)
    expect([style.shapes, style.dashes]).toEqual([['square', 'circle'], ['dash']])
    expect(styleFromGraph(graphOf(column, 'points'), settings as never).shapes).toBeUndefined()
    const reset = resetToStyle(g, settings)
    expect([reset.style.shapes, reset.style.dashes]).toEqual([undefined, undefined])
  })

  it('presets keep the lists and the layers’ choices; Match format copies them', () => {
    const g = withLayer(
      graphOf(column, 'points', (x) => ({ style: { ...x.style, shapes: ['diamond', 'plus'] } })),
      'points',
      { style: { shape: { series: true } } },
    )
    const recipe = PresetRecipe.parse(presetRecipe(g, 'column'))
    expect(recipe.shapes).toEqual(['diamond', 'plus'])
    expect(recipe.dashes).toBeUndefined()
    const made = recipeLayers(recipe, column, 'Mine')
    expect(made.shapes).toEqual(['diamond', 'plus'])
    expect(made.layers.find((l) => l.id === 'points')?.style).toMatchObject({
      shape: { series: true },
    })
    const target = { ...graphOf(column, 'bars'), id: 'g2' as NodeId }
    const matched = matchGraphFormat(projectOf(column, g, target), target, g)
    expect(matched.style.shapes).toEqual(['diamond', 'plus'])
  })
})
