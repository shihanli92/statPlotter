import {
  GraphNode,
  type Layer,
  type NodeId,
  PresetRecipe,
  presetRecipe,
  type SeriesStroke,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  aesAllowed,
  DEFAULT_THEME,
  fillsByDataSet,
  graphFillPalette,
  groupStroke,
  layoutGraph,
  matchGraphFormat,
  presetGraph,
  recipeLayers,
  recipeMapping,
  resetToStyle,
  sceneToSvg,
  styleFromGraph,
  themeOf,
} from '../src/index.ts'
import { LayerKit } from '../src/layers/kit.ts'
import { byGroupCases } from './byGroupCases.ts'
import { fillOutlineCases, LIGHT, mappedXY } from './fillOutlineCases.ts'
import { graphOf, layerOf, withLayer } from './graphs.ts'
import { appearanceTable, fonts, nodes, prim, projectOf, sampleTable } from './helpers.ts'

// Roadmap 49d: fill and outline mapped separately — a data set's fill colour beside its colour
// and the graph's fill palette (the fill channel by data set), a fill variable on a scale of its
// own (graphs of variables), merged or split legends as ggplot draws them, and line patterns by
// group for the overlay geoms. Absent, everything draws as before.

const column = sampleTable('column')
const BY = { series: true } as const
const cases = () => Object.fromEntries(fillOutlineCases().map(([n, t, g]) => [n, [t, g] as const]))
const draw = (name: string) => {
  const [table, graph] = cases()[name]!
  return layoutGraph({ project: projectOf(table), graph, fonts })
}
const sym = (s: ReturnType<typeof layoutGraph>, id: string) => prim(nodes(s, id)[0], 'symbol')
const keysOf = (s: ReturnType<typeof layoutGraph>) => (s.legend ?? []).map((e) => e.key)

describe('absent means today', () => {
  it('a graph without a fill colour of its own resolves the very same styles', () => {
    const g = withLayer(graphOf(column, 'points'), 'points', {
      style: { fill: { type: 'solid', color: BY, opacity: 1 } },
    })
    const kit = new LayerKit({ project: projectOf(column), graph: g, fonts })
    const l = layerOf(g, 'points')
    expect(kit.fillOf('a')).toBeUndefined()
    expect(kit.fillChannel).toBe(false)
    expect(kit.style(l, 'a').points.fill).toEqual({ type: 'solid', color: BY, opacity: 1 })
    expect(graphFillPalette(g, DEFAULT_THEME)).toBeUndefined()
  })

  it('a fill palette equal to the palette draws every 49a golden exactly as without', () => {
    for (const [name, table, graph] of byGroupCases()) {
      const plain = sceneToSvg(layoutGraph({ project: projectOf(table), graph, fonts }))
      const palette = [...(graph.style.palette ?? DEFAULT_THEME.categorical!)]
      const same: GraphNode = { ...graph, style: { ...graph.style, fillPalette: palette } }
      expect(sceneToSvg(layoutGraph({ project: projectOf(table), graph: same, fonts })), name).toBe(
        plain,
      )
    }
  })
})

describe('fill by data set: its own colours', () => {
  it('the fill palette in turn; a data set’s own fill wins; outlines keep their colours', () => {
    const s = draw('filloutline-light-fill-dark-outline-bars')
    const bar = (k: string) => prim(nodes(s, `series/${k}/bar`)[0], 'rect')
    expect([bar('a').fill?.color, bar('a').stroke?.color]).toEqual([LIGHT[0], '#0072b2'])
    expect([bar('b').fill?.color, bar('b').stroke?.color]).toEqual([LIGHT[1], '#d55e00'])
    // Its own fill, over the palette's.
    expect([bar('c').fill?.color, bar('c').stroke?.color]).toEqual(['#d9d9d9', '#009e73'])
    // The legend draws what the bars draw: one entry per data set, both colours.
    const swatch = prim(nodes(s, 'legend/c/swatch')[0], 'rect')
    expect([swatch.fill?.color, swatch.stroke?.color]).toEqual(['#d9d9d9', '#009e73'])
  })

  it('wraps a fill palette shorter than the data sets', () => {
    const g = withLayer(
      graphOf(column, 'points', (x) => ({ style: { ...x.style, fillPalette: ['#eeeeee'] } })),
      'points',
      { style: { fill: { type: 'solid', color: BY, opacity: 1 } } },
    )
    const s = layoutGraph({ project: projectOf(column), graph: g, fonts })
    expect(['a', 'b', 'c'].map((k) => sym(s, `series/${k}/point/0`).fill?.color)).toEqual([
      '#eeeeee',
      '#eeeeee',
      '#eeeeee',
    ])
  })

  it('a black outline with fills of their own (the legend too)', () => {
    const s = draw('filloutline-fill-palette-black-outline')
    for (const [i, k] of ['a', 'b', 'c'].entries()) {
      expect(sym(s, `series/${k}/point/0`).fill?.color).toBe(LIGHT[i])
      expect(sym(s, `series/${k}/point/0`).stroke?.color).toBe('#000000')
      expect(sym(s, `legend/${k}/symbol`).fill?.color).toBe(LIGHT[i])
    }
  })

  it('XY data sets’ own fills, their outlines their colours', () => {
    const s = draw('filloutline-xy-own-fills')
    expect([
      sym(s, 'series/b/point/0').fill?.color,
      sym(s, 'series/b/point/0').stroke?.color,
    ]).toEqual([LIGHT[1], '#d55e00'])
  })

  it('only fills by data set take it: fixed fills, outlines and lines keep theirs', () => {
    const g = withLayer(
      graphOf(column, 'points', (x) => ({ style: { ...x.style, fillPalette: LIGHT } })),
      'points',
      {
        style: {
          fill: { type: 'solid', color: { rgb: '#123456' }, opacity: 1 },
          border: { color: BY, width: 1, dash: 'solid' },
        },
      },
    )
    const s = layoutGraph({ project: projectOf(column), graph: g, fonts })
    const p = sym(s, 'series/a/point/0')
    expect([p.fill?.color, p.stroke?.color]).toEqual(['#123456', '#0072b2'])
  })

  it('which layers fill by data set (not dot plots, classes, 100% bars, mapped rows)', () => {
    const l = (geom: string, stat: object, more: object = {}) =>
      ({ id: 'x', geom, stat, ...more }) as Layer
    const g = { frame: 'category' } as GraphNode
    expect(fillsByDataSet(g, l('points', { kind: 'identity' }))).toBe(true)
    expect(fillsByDataSet(g, l('bar', { kind: 'summary', center: 'mean' }))).toBe(true)
    expect(fillsByDataSet(g, l('box', { kind: 'boxplot', whiskers: 'tukey' }))).toBe(true)
    expect(fillsByDataSet(g, l('points', { kind: 'dotplot' }))).toBe(false)
    expect(fillsByDataSet(g, l('points', { kind: 'threshold' }))).toBe(false)
    expect(fillsByDataSet(g, l('bar', { kind: 'fraction' }))).toBe(false)
    expect(fillsByDataSet(g, l('line', { kind: 'identity' }))).toBe(false)
    const xy = { frame: 'xy' } as GraphNode
    expect(fillsByDataSet(xy, l('points', { kind: 'identity' }, { aes: { x: 'a' } }))).toBe(false)
    // Points of every row filled by a variable of their own; their summaries by data set.
    expect(fillsByDataSet(g, l('points', { kind: 'identity' }), true)).toBe(false)
    expect(fillsByDataSet(g, l('points', { kind: 'summary', center: 'mean' }), true)).toBe(true)
  })

  it('a style’s fill palette reaches graphs without their own', () => {
    const theme = themeOf({ fillPalette: ['#abcdef'] })
    const g = graphOf(column, 'points')
    expect(graphFillPalette(g, theme)).toEqual(['#abcdef'])
    expect(
      graphFillPalette({ ...g, style: { ...g.style, fillPalette: ['#111111'] } }, theme),
    ).toEqual(['#111111'])
  })
})

describe('fill by a variable: a scale of its own', () => {
  it('fill and outline by different variables: each row both, two legends', () => {
    const s = draw('filloutline-variables-split-legends')
    const t = appearanceTable()
    // Row 0: Group Low (blue outline), Site South (blue fill); row 1: High, North.
    const p1 = sym(s, 'series/d/point/1')
    expect([p1.stroke?.color, p1.fill?.color]).toEqual(['#d55e00', '#d55e00'])
    const p2 = sym(s, 'series/d/point/2')
    // Row 2: Mid (green outline), North (orange fill).
    expect([p2.stroke?.color, p2.fill?.color]).toEqual(['#009e73', '#d55e00'])
    expect(t.dataSets[0]!.text?.[2]).toBe('Mid')
    const keys = keysOf(s)
    expect(keys).toContain('bubble/color')
    expect(keys).toContain('bubble/fill')
    expect(keys.filter((k) => k.startsWith('bubble/fill/lv_')).length).toBe(2)
    expect(keys).toContain('bubble/fill/missing')
    const groups = new Set((s.legend ?? []).map((e) => e.group))
    expect(groups).toEqual(new Set(['bubble/color', 'bubble/fill']))
  })

  it('fill mapping the colour’s variable: one legend whose keys show both', () => {
    const s = draw('filloutline-variables-merged-legend')
    const keys = keysOf(s)
    expect(keys.some((k) => k.startsWith('bubble/fill'))).toBe(false)
    const key = sym(s, 'legend/bubble/color/0/symbol')
    expect([key.stroke?.color, key.fill?.color]).toEqual(['#0072b2', LIGHT[0]])
    const p = sym(s, 'series/d/point/0')
    expect([p.stroke?.color, p.fill?.color]).toEqual(['#0072b2', LIGHT[0]])
  })

  it('a fill palette alone fills a text colour variable’s levels (keys show both)', () => {
    const { table, graph } = mappedXY({ color: 'a' }, { style: { fillPalette: LIGHT } })
    const s = layoutGraph({ project: projectOf(table), graph, fonts })
    const p = sym(s, 'series/d/point/1')
    expect([p.stroke?.color, p.fill?.color]).toEqual(['#d55e00', LIGHT[1]])
    expect(sym(s, 'legend/bubble/color/1/symbol').fill?.color).toBe(LIGHT[1])
    // Without it, the legend's swatches as before.
    const plain = mappedXY({ color: 'a' })
    const s0 = layoutGraph({ project: projectOf(plain.table), graph: plain.graph, fonts })
    expect(nodes(s0, 'legend/bubble/color/1/swatch').length).toBe(1)
  })

  it('a number fill variable: its own colour scale and colour bar', () => {
    const s = draw('filloutline-variables-fill-number')
    expect(keysOf(s)).toContain('bubble/fill/bar')
    // Viridis' ends at the data's range: the smallest BMI dark, the largest yellow.
    const t = appearanceTable()
    const bmi = t.dataSets[4]!.subcolumns[0]!.values as (number | null)[]
    const lo = bmi.indexOf(Math.min(...(bmi.filter((v) => v !== null) as number[])))
    expect(sym(s, `series/d/point/${lo}`).fill?.color).toBe('#440154')
  })

  it('may map fill where the matrix allows (points of every row)', () => {
    const { graph } = mappedXY({ color: 'a' })
    expect(aesAllowed('multipleVariables', 'xy', 'fill', 'text', graph.layers).allowed).toBe(true)
    expect(aesAllowed('multipleVariables', 'xy', 'fill', 'number', graph.layers).allowed).toBe(true)
    expect(aesAllowed('mvTextText', 'matrix', 'fill', 'text', []).allowed).toBe(false)
  })

  it('a category graph of variables fills its points of every row by a variable', () => {
    const t = appearanceTable()
    const g = presetGraph(t, 'points', undefined, { mapping: { x: 'a', y: 'c', fill: 'f' } })
    const graph: GraphNode = { ...g, id: 'g1' as NodeId, legend: { ...g.legend, show: true } }
    expect(GraphNode.safeParse(graph).success).toBe(true)
    const s = layoutGraph({ project: projectOf(t), graph, fonts })
    const points = nodes(s, 'series/').filter((n) => n.prim?.type === 'symbol')
    const fills = new Set(points.map((n) => prim(n, 'symbol').fill?.color))
    // South, North and missing.
    expect(fills.size).toBeGreaterThanOrEqual(2)
    expect(keysOf(s)).toContain('aes/fill')
  })
})

describe('line patterns by group for the overlay geoms', () => {
  it('resolve the graph’s line styles at the group’s place; fixed ones as they are', () => {
    const stroke: SeriesStroke = { color: BY, width: 1, dash: BY }
    expect(groupStroke(stroke, ['solid', 'dash', 'dot'], 4).dash).toBe('dash')
    expect(groupStroke(stroke, undefined, 2).dash).toBe('dot')
    const fixed = { color: BY, width: 1, dash: 'dot' } as const
    expect(groupStroke(fixed, ['solid'], 1)).toBe(fixed)
  })

  it('ellipses by a variable’s groups, in its level order', () => {
    const s = draw('filloutline-ellipses-dashed-by-group')
    const dash = (g: number) =>
      prim(
        nodes(s, `series/d/ellipse/`).find(
          (n) => n.id.endsWith(`/${g}`) && n.prim?.type === 'polyline',
        ),
        'polyline',
      ).stroke.dash
    // Groups in the rows' order (Low, High, Mid) take the level order's patterns.
    expect([dash(0), dash(1), dash(2)].sort()).toEqual(['dash', 'dot', 'solid'])
  })

  it('XY data sets’ paths and their legend samples', () => {
    const s = draw('filloutline-paths-dashed-by-data-set')
    const path = (k: string) => prim(nodes(s, `series/${k}/path/0`)[0], 'polyline').stroke.dash
    expect(['a', 'b', 'c'].map(path)).toEqual(['solid', 'dash', 'dot'])
    expect(
      ['a', 'b', 'c'].map((k) => prim(nodes(s, `legend/${k}/line`)[0], 'line').stroke.dash),
    ).toEqual(['solid', 'dash', 'dot'])
  })

  it('vectors take their row’s group’s pattern', () => {
    const t = appearanceTable()
    const { graph } = mappedXY({ color: 'a' })
    const g: GraphNode = {
      ...graph,
      layers: [
        ...graph.layers,
        {
          id: 'vectors',
          geom: 'segment',
          stat: { kind: 'identity' },
          aes: { xend: 'e', yend: 'd' },
          style: { stroke: { color: BY, width: 1, dash: BY } },
        } as Layer,
      ],
    }
    expect(GraphNode.safeParse(g).success).toBe(true)
    const s = layoutGraph({ project: projectOf(t), graph: g, fonts })
    const dash = (row: number) =>
      prim(
        nodes(s, `series/d/vector/${row}/`).find((n) => n.prim?.type === 'polyline'),
        'polyline',
      ).stroke.dash
    // Rows 0, 1, 2: Low, High, Mid — the level order Low, High, Mid.
    expect([dash(0), dash(1), dash(2)]).toEqual(['solid', 'dash', 'dot'])
  })
})

describe('the model and what carries the fill channel', () => {
  it('parses the new fields; older graphs unchanged', () => {
    for (const [, , g] of fillOutlineCases()) expect(GraphNode.parse(g)).toEqual(g)
    const plain = graphOf(column, 'points')
    expect(GraphNode.parse(plain)).toEqual(plain)
    expect(() =>
      GraphNode.parse({ ...plain, style: { ...plain.style, fillPalette: [] } }),
    ).toThrow()
  })

  it('styles: saved from a graph, cleared by Reset to style', () => {
    const g = graphOf(column, 'points', (x) => ({ style: { ...x.style, fillPalette: LIGHT } }))
    const settings = { theme: 'default', pValueStyle: 'GP', pValueDigits: 4 } as const
    expect(styleFromGraph(g, settings as never).fillPalette).toEqual(LIGHT)
    expect(styleFromGraph(graphOf(column, 'points'), settings as never).fillPalette).toBeUndefined()
    expect(resetToStyle(g, settings).style.fillPalette).toBeUndefined()
  })

  it('presets keep the fill palette, a fill scale and the fill variable (or the colour’s)', () => {
    const g = graphOf(column, 'points', (x) => ({ style: { ...x.style, fillPalette: LIGHT } }))
    const recipe = PresetRecipe.parse(presetRecipe(g, 'column'))
    expect(recipe.fillPalette).toEqual(LIGHT)
    expect(recipeLayers(recipe, column, 'Mine').fillPalette).toEqual(LIGHT)
    const t = appearanceTable()
    const same = mappedXY({ color: 'a', fill: 'a' }).graph
    const r1 = PresetRecipe.parse(presetRecipe(same, 'multipleVariables', t))
    expect(r1.variables?.fill).toBe('color')
    expect(recipeMapping(r1, t)?.fill).toBe(recipeMapping(r1, t)?.color)
    const other = mappedXY(
      { color: 'a', fill: 'e' },
      { scales: { fill: { colors: 'magma', min: 1 } } },
    ).graph
    const r2 = PresetRecipe.parse(presetRecipe(other, 'multipleVariables', t))
    expect(r2.variables?.fill).toBe('number')
    // Value ranges are the data's: not kept.
    expect(r2.scales?.fill).toEqual({ colors: 'magma' })
  })

  it('Match format copies the fill palette and data sets’ own fills', () => {
    const g = graphOf(column, 'points', (x) => ({
      style: { ...x.style, fillPalette: LIGHT },
      seriesOverrides: { b: { fill: { rgb: '#eeeeee' } } },
    }))
    const target = { ...graphOf(column, 'bars'), id: 'g2' as NodeId }
    const matched = matchGraphFormat(projectOf(column, g, target), target, g)
    expect(matched.style.fillPalette).toEqual(LIGHT)
    expect(matched.seriesOverrides.b?.fill).toEqual({ rgb: '#eeeeee' })
  })
})
