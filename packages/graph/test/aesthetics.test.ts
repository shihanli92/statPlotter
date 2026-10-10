import { type GraphNode, type Layer, levelKey, type NodeId, presetRecipe } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  aesAllowed,
  aesVariables,
  COLOR_MAPS,
  colorAt,
  continuousColor,
  continuousDomain,
  defaultContinuousAxis,
  Extent,
  GRADIENT_COLORS,
  layoutGraph,
  legendValues,
  levelShape,
  levelVariables,
  MISSING_POINT_COLOR,
  matrixKindOf,
  mixColor,
  presetGraph,
  recipeLayers,
  type Scene,
  scaffoldFor,
  sizeDefaults,
  sizeScale,
  sortLevels,
  subjectShape,
  themeFor,
  withLayers,
} from '../src/index.ts'
import {
  byId,
  flatten,
  fonts,
  nodes,
  prim,
  projectOf,
  appearanceTable as table,
} from './helpers.ts'

// Variables mapped to appearance (roadmap 34b): the scales on their own (colours, sizes, shapes,
// legend values), then each row's look and the legends on XY, category and grouped graphs.

describe('a number variable’s colours', () => {
  it('runs along two colours (light to dark blue unless chosen) over the data’s range', () => {
    const c = continuousColor([10, 20, 30])
    expect([c.lo, c.hi]).toEqual([10, 30])
    expect(c.color(10)).toBe(GRADIENT_COLORS[0])
    expect(c.color(30)).toBe(GRADIENT_COLORS[1])
    expect(c.color(20)).toBe(mixColor(GRADIENT_COLORS[0], GRADIENT_COLORS[1], 0.5))
    const own = continuousColor([0, 1], { colors: ['#000000', '#ffffff'], reverse: true })
    expect(own.color(0)).toBe('#ffffff')
  })

  it('takes a colour map, reversed when asked, and a fixed range', () => {
    const c = continuousColor([0, 5, 10], { colors: 'viridis', min: 0, max: 20 })
    expect(c.color(0)).toBe(colorAt(COLOR_MAPS.viridis, 0))
    expect(c.color(10)).toBe(colorAt(COLOR_MAPS.viridis, 0.5))
    const r = continuousColor([0, 10], { colors: 'viridis', reverse: true })
    expect(r.color(0)).toBe(colorAt(COLOR_MAPS.viridis, 1))
  })

  it('centres a diverging map on its midpoint (else 0 inside the range)', () => {
    const c = continuousColor([-2, 1], { colors: 'blueRed' })
    expect(c.t(0)).toBe(0.5)
    expect(c.t(-2)).toBe(0)
    const m = continuousColor([0, 10], { colors: 'blueRed', midpoint: 4 })
    expect(m.t(4)).toBe(0.5)
  })

  it('clamps values outside a fixed range, or gives them a colour of their own', () => {
    const clamped = continuousColor([0, 50], { colors: 'viridis', min: 10, max: 20 })
    expect(clamped.color(0)).toBe(clamped.color(10))
    expect(clamped.color(50)).toBe(clamped.color(20))
    const own = continuousColor([0, 50], {
      colors: 'viridis',
      min: 10,
      max: 20,
      outOfRange: '#ff00ff',
    })
    expect(own.color(0)).toBe('#ff00ff')
    expect(own.color(50)).toBe('#ff00ff')
    expect(own.color(15)).toBe(clamped.color(15))
  })

  it('colours rows without a value in the missing colour; one value in its high colour', () => {
    expect(continuousColor([1, 2]).color(Number.NaN)).toBe(MISSING_POINT_COLOR)
    expect(continuousColor([1, 2], { missing: '#123456' }).color(Number.NaN)).toBe('#123456')
    expect(continuousColor([3, 3]).color(3)).toBe(GRADIENT_COLORS[1])
  })
})

describe('a size variable’s sizes', () => {
  it('by area: proportional to the value from 0 (the bubble plot’s rule), never under the smallest', () => {
    const s = sizeScale([0, 25, 100], { max: 20, min: 4 })
    expect(s(100)).toBeCloseTo(20, 12)
    expect(s(25)).toBeCloseTo(10, 12)
    expect(s(0)).toBe(4)
    // Negative values: area rising linearly from the smallest to the largest size.
    const n = sizeScale([-1, 1], { max: 20, min: 4 })
    expect(n(-1)).toBeCloseTo(4, 12)
    expect(n(1)).toBeCloseTo(20, 12)
    expect(n(0) ** 2).toBeCloseTo((4 ** 2 + 20 ** 2) / 2, 9)
  })

  it('by area over a fixed range: area linear from the smallest to the largest size', () => {
    const s = sizeScale([0, 100], { max: 20, min: 4, low: 10, high: 50 })
    expect(s(10)).toBeCloseTo(4, 12)
    expect(s(50)).toBeCloseTo(20, 12)
    expect(s(30) ** 2).toBeCloseTo((4 ** 2 + 20 ** 2) / 2, 9)
  })

  it('by radius: the diameter linear in the value', () => {
    const s = sizeScale([10, 20, 30], { by: 'radius', max: 16, min: 4 })
    expect([s(10), s(20), s(30)]).toEqual([4, 10, 16])
  })

  it('clamps values outside a fixed range to the ends’ sizes, or extends past them', () => {
    const clamp = sizeScale([0, 100], { by: 'radius', max: 16, min: 4, low: 10, high: 20 })
    expect([clamp(0), clamp(100)]).toEqual([4, 16])
    const extend = sizeScale([0, 100], {
      by: 'radius',
      max: 16,
      min: 4,
      low: 10,
      high: 20,
      outside: 'extend',
    })
    expect(extend(30)).toBe(28)
    expect(extend(-100)).toBe(0)
  })

  it('draws every symbol the largest for one value; frames have defaults of their own', () => {
    expect(sizeScale([5, 5], { by: 'radius', max: 12 })(5)).toBe(12)
    expect(sizeScale([])(1)).toBe(30)
    expect(sizeDefaults('xy')).toEqual({ min: 4, max: 30 })
    expect(sizeDefaults('category').max).toBeLessThan(20)
  })
})

describe('shapes and legend values', () => {
  it('a level’s symbol: its own, else the sequence from the points’ symbol', () => {
    expect(levelShape('square', undefined, 'A', 0)).toBe('square')
    expect(levelShape('square', undefined, 'B', 1)).toBe(subjectShape('square', 1))
    expect(levelShape('square', { [levelKey('B')]: 'cross' }, 'B', 1)).toBe('cross')
  })

  it('round values inside the range, largest first, whole numbers when asked', () => {
    expect(legendValues(0, 100, 3)).toEqual([100, 50, 0])
    expect(legendValues(0, 2, 5, false, true).every(Number.isInteger)).toBe(true)
    expect(legendValues(5, 5, 3)).toEqual([5])
  })
})

// --- Graphs ------------------------------------------------------------------------------

const t = table()
const project = projectOf(t)
const palette = themeFor(project.settings.theme).palette
const layout = (g: GraphNode): Scene => layoutGraph({ project: projectOf(t, g), graph: g, fonts })

/** A scatter of Age by Score with these variables mapped to its points. */
function xy(aes: NonNullable<Layer['aes']>, more: Partial<GraphNode> = {}): GraphNode {
  const g = presetGraph(t, 'bubble')
  const layers = g.layers.map((l) =>
    l.aes ? ({ ...l, aes: { x: 'c', y: 'd', ...aes } } as Layer) : l,
  )
  return { ...g, id: 'g1' as NodeId, layers, legend: { ...g.legend, show: true }, ...more }
}
/** Score by Group (category or grouped) with more variables mapped. */
const byGroup = (id: string, mapping: GraphNode['mapping'], more: Partial<GraphNode> = {}) => ({
  ...presetGraph(t, id, undefined, { mapping }),
  id: 'g1' as NodeId,
  ...more,
})
const fill = (s: Scene, id: string) => prim(byId(s, id), 'symbol').fill?.color
const shape = (s: Scene, id: string) => prim(byId(s, id), 'symbol').shape
const size = (s: Scene, id: string) => prim(byId(s, id), 'symbol').size
const legendIds = (s: Scene) =>
  flatten(s.root)
    .map((n) => n.id)
    .filter(
      (id) =>
        id.startsWith('legend/') &&
        !/\/(label|swatch|symbol|line|level)$/.test(id) &&
        !/\/bar\/./.test(id),
    )

describe('guide entries keyed by level (audit 3, G2)', () => {
  /** The entries drawn: own label → [key, label drawn, hidden]. */
  const entries = (s: Scene) =>
    Object.fromEntries(
      (s.legend ?? [])
        .filter((e) => !e.fixed)
        .map((e) => {
          const node = flatten(s.root).find((n) => n.legendEntry?.key === e.key)
          const drawn = node && flatten(node).find((n) => n.id.endsWith('/label'))
          const text = drawn ? JSON.stringify(drawn).match(/"text":"([^"]*)"/)?.[1] : undefined
          return [String(e.label), { key: e.key, drawn: text, hidden: e.hidden }]
        }),
    )

  it('a colour level’s label and hidden entry stay with it when the levels are reordered', () => {
    const base = xy({ color: 'f' })
    const keys = entries(layout(base))
    const labelled = {
      ...base,
      legend: {
        ...base.legend,
        labels: { [keys.South!.key]: [{ text: 'Southern sites' }] },
        hidden: [keys.North!.key],
      },
    }
    for (const levels of [undefined, { f: ['North', 'South'] }, { f: ['South', 'North'] }]) {
      const e = entries(layout({ ...labelled, ...(levels ? { levels } : {}) }))
      expect(e.South, JSON.stringify(levels)).toMatchObject({
        drawn: 'Southern sites',
        hidden: false,
      })
      expect(e.North!.hidden, JSON.stringify(levels)).toBe(true)
    }
  })

  it('a shape level’s key is its level’s, whatever its place', () => {
    const a = entries(layout(xy({ shape: 'f' }, { levels: { f: ['North', 'South'] } })))
    const b = entries(layout(xy({ shape: 'f' }, { levels: { f: ['South', 'North'] } })))
    expect(a.South!.key).toBe(b.South!.key)
    expect(a.North!.key).not.toBe(a.South!.key)
  })
})

describe('each row’s look', () => {
  it('XY: a text colour variable by the graph’s order of levels, a level’s own colour, missing grey', () => {
    const g = xy(
      { color: 'f' },
      {
        levels: { f: ['South', 'North'] },
        seriesOverrides: { [levelKey('North')]: { color: { rgb: '#d62728' } } },
      },
    )
    const s = layout(g)
    // Row 0 is South (first in the graph's order: palette 0), row 1 North (its own colour).
    expect(fill(s, 'series/d/point/0')).toBe(palette[0])
    expect(fill(s, 'series/d/point/1')).toBe('#d62728')
    expect(fill(s, 'series/d/point/7')).toBe(MISSING_POINT_COLOR)
    // Roadmap 41: the grey row has its legend entry, last.
    expect(legendIds(s)).toEqual([
      'legend/bubble/color',
      'legend/bubble/color/0',
      'legend/bubble/color/1',
      'legend/bubble/color/missing',
    ])
    expect(JSON.stringify(byId(s, 'legend/bubble/color/missing/label'))).toContain('Missing')
    expect(prim(byId(s, 'legend/bubble/color/missing/swatch'), 'rect').fill?.color).toBe(
      MISSING_POINT_COLOR,
    )
  })

  it('no "Missing" entry when every row drawn has its colour (roadmap 41)', () => {
    const full = structuredClone(t)
    full.dataSets[5]!.text![7] = 'North'
    const g = xy({ color: 'f' })
    const s = layoutGraph({ project: projectOf(full, g), graph: g, fonts })
    expect(legendIds(s)).not.toContain('legend/bubble/color/missing')
  })

  it('a new level takes the next palette colour', () => {
    const more = structuredClone(t)
    more.dataSets[5]!.text![0] = 'East'
    const g = xy({ color: 'f' })
    const s = layoutGraph({ project: projectOf(more, g), graph: g, fonts })
    // East appears first in the table: palette 0; South (rows 3, 6…) and North follow.
    expect(fill(s, 'series/d/point/0')).toBe(palette[0])
    expect(fill(s, 'series/d/point/1')).toBe(palette[1])
    expect(fill(s, 'series/d/point/3')).toBe(palette[2])
  })

  it('category graphs: points coloured by a number, shaped by a level, sized by a number', () => {
    const g = byGroup(
      'groupBoxPoints',
      { x: 'a', y: 'c', color: 'e', shape: 'b', size: 'd' },
      { scales: { color: { colors: 'viridis', bar: { show: true } } } },
    )
    const s = layout(g)
    const scale = continuousColor(
      [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11].map((r) => t.dataSets[4]!.subcolumns[0]!.values[r]!),
      { colors: 'viridis' },
    )
    const low = levelKey('Low')
    expect(fill(s, `series/${low}/point/0`)).toBe(scale.color(21.5))
    // Row 5 has no BMI: grey.
    expect(fill(s, `series/${levelKey('Mid')}/point/5`)).toBe(MISSING_POINT_COLOR)
    expect(shape(s, `series/${low}/point/0`)).not.toBe(shape(s, `series/${low}/point/3`))
    expect(size(s, `series/${low}/point/0`)).toBeLessThan(size(s, `series/${low}/point/9`))
    // The categories are on the axis: the legend is the variables'.
    expect(legendIds(s)).toEqual([
      'legend/aes/size',
      'legend/aes/size/0',
      'legend/aes/size/1',
      'legend/aes/size/2',
      'legend/aes/color',
      'legend/aes/color/bar',
      'legend/aes/color/missing',
      'legend/aes/shape',
      'legend/aes/shape/0',
      'legend/aes/shape/1',
    ])
  })

  it('summaries keep their data set’s look; without points of every row nothing is mapped', () => {
    const g = byGroup('barsPoints', { x: 'a', y: 'c', shape: 'b' })
    const bars = { ...g, layers: g.layers.filter((l) => l.geom !== 'points') }
    expect(nodes(layout(bars), 'legend/aes/')).toHaveLength(0)
  })
})

describe('legends', () => {
  it('merges colour and shape of one variable into one legend of symbols', () => {
    const s = layout(xy({ color: 'b', shape: 'b' }))
    expect(byId(s, 'legend/bubble/shape')).toBeUndefined()
    expect(prim(byId(s, 'legend/bubble/color/1/symbol'), 'symbol').shape).toBe(
      shape(s, 'series/d/point/1'),
    )
  })

  it('a grouped graph shaped by its groups’ variable shows the symbols in the groups’ legend', () => {
    const s = layout(byGroup('barsPoints', { x: 'a', y: 'c', color: 'b', shape: 'b' }))
    expect(byId(s, 'legend/aes/shape')).toBeUndefined()
    expect(prim(byId(s, `legend/${levelKey('M')}/level/symbol`), 'symbol').shape).toBe(
      subjectShape('circle', 1),
    )
    // Without other legends, no heading (as before 34b); with one, the variable's name.
    expect(byId(s, 'legend/aes/groups')).toBeUndefined()
    const sized = layout(byGroup('barsPoints', { x: 'a', y: 'c', color: 'b', size: 'd' }))
    expect(byId(sized, 'legend/aes/groups/label')).toBeDefined()
  })

  it('a colour bar in the legend, its ticks as asked', () => {
    const g = xy(
      { color: 'e' },
      { scales: { color: { colors: 'viridis', bar: { show: true, ticks: 3 } } } },
    )
    const s = layout(g)
    expect(byId(s, 'legend/bubble/color/bar/frame')).toBeDefined()
    expect(nodes(s, 'legend/bubble/color/bar/tick/').length).toBeLessThanOrEqual(4)
    // Without the bar: a few swatches.
    expect(byId(layout(xy({ color: 'e' })), 'legend/bubble/color/0/swatch')).toBeDefined()
  })

  it('headings: the variable’s name, edited, or none; entries reversed when asked', () => {
    const s = layout(
      xy(
        { size: 'e' },
        { legend: { show: true, position: 'right', titles: { size: 'Body mass' } } },
      ),
    )
    expect(prim(byId(s, 'legend/bubble/size/label'), 'text').layout.runs[0]?.text).toBe('Body mass')
    const none = layout(
      xy({ size: 'e' }, { legend: { show: true, position: 'right', titles: { size: '' } } }),
    )
    expect(byId(none, 'legend/bubble/size')).toBeUndefined()
    const label = (sc: Scene, k: number) =>
      prim(byId(sc, `legend/bubble/size/${k}/label`), 'text').layout.runs[0]?.text
    const reversed = layout(
      xy({ size: 'e' }, { legend: { show: true, position: 'right', reverse: true } }),
    )
    const plain = layout(xy({ size: 'e' }))
    const ys = (sc: Scene) => [0, 1, 2].map((k) => byId(sc, `legend/bubble/size/${k}`)!.bbox!.y)
    expect(label(reversed, 0)).toBe(label(plain, 0))
    expect(ys(reversed)[0]).toBeGreaterThan(ys(reversed)[2]!)
    expect(ys(plain)[0]).toBeLessThan(ys(plain)[2]!)
  })
})

describe('labels from a variable', () => {
  it('labels each point with its row’s value, numbers in the labels’ format', () => {
    const text = (s: Scene, row: number) =>
      prim(byId(s, `pointLabel/d/r${row}`), 'text')
        .layout.runs.map((r) => r.text)
        .join('')
    expect(text(layout(xy({ label: 'a' })), 0)).toBe('Low')
    // Row 12 has no Group: no label.
    expect(byId(layout(xy({ label: 'a' })), 'pointLabel/d/r12')).toBeUndefined()
    const fixed = xy(
      { label: 'e' },
      {
        style: {
          seriesDefaults: {
            pointLabels: { source: 'variable', which: 'all', format: { mode: 'fixed', digits: 2 } },
          },
        },
      },
    )
    expect(text(layout(fixed), 0)).toBe('21.50')
  })

  it('stand at an offset when one is set', () => {
    const g = xy(
      { label: 'a' },
      {
        style: {
          seriesDefaults: {
            pointLabels: { source: 'variable', which: 'all', offset: { dx: 0, dy: -20 } },
          },
        },
      },
    )
    const s = layout(g)
    const off = byId(s, 'pointLabel/d/r0')!.labelOffset!
    expect(off.dx).toBeCloseTo(0, 6)
    expect(off.dy).toBeCloseTo(-20, 6)
  })
})

describe('the matrix, scaffolds and orders of levels', () => {
  const pts = [{ id: 'points', geom: 'points', stat: { kind: 'identity' } }] as Layer[]
  const bars = [{ id: 'bars', geom: 'bar', stat: { kind: 'summary', center: 'mean' } }] as Layer[]
  it('offers shape, size, labels and colour by a number on points of every row', () => {
    expect(aesAllowed('mvTextNumber', 'category', 'shape', 'text', pts).allowed).toBe(true)
    expect(aesAllowed('mvTextNumber', 'category', 'shape', 'number', pts).allowed).toBe(false)
    expect(aesAllowed('mvTextNumber', 'category', 'size', 'number', bars)).toEqual({
      allowed: false,
      reason: 'needs points of every row',
    })
    expect(aesAllowed('mvTextNumber', 'category', 'color', 'text', bars).allowed).toBe(true)
    expect(aesAllowed('mvTextText', 'grouped', 'shape', 'text', pts).allowed).toBe(false)
    expect(aesAllowed('multipleVariables', 'category', 'label', 'text', pts).allowed).toBe(false)
    expect(aesAllowed('multipleVariables', 'xy', 'label', 'text', pts).allowed).toBe(true)
  })

  it('reads the variables from a mapping or from mapped points', () => {
    expect(aesVariables(byGroup('groupBoxPoints', { x: 'a', y: 'c', shape: 'b' }))).toEqual({
      shape: 'b',
    })
    expect(aesVariables(xy({ size: 'e', label: 'a' }))).toEqual({ size: 'e', label: 'a' })
    expect(matrixKindOf(t, { mapping: { x: 'a', y: 'c', shape: 'b' } })).toBe('mvTextNumber')
  })

  it('shows the legend of a new graph with variables mapped to appearance', () => {
    const spec = (mapping: GraphNode['mapping']) =>
      scaffoldFor(t, { frame: 'category', look: 'column.box', layers: pts, mapping })
    expect(spec({ x: 'a', y: 'c' }).legend.show).toBe(false)
    expect(spec({ x: 'a', y: 'c', shape: 'b' }).legend.show).toBe(true)
    expect(spec({ x: 'a', y: 'c', color: 'e' }).legend.show).toBe(true)
    expect(spec({ x: 'a', y: 'c', label: 'b' }).legend.show).toBe(false)
    // Mapping a shape later shows it; the axes stay.
    const g = byGroup('groupBoxPoints', { x: 'a', y: 'c' })
    const titled = {
      ...g,
      axes: { ...g.axes, y: { ...g.axes.y, title: { content: [{ text: 'Mine' }] } } },
    }
    const next = withLayers(
      titled,
      { frame: g.frame, look: g.look!, layers: g.layers, mapping: { x: 'a', y: 'c', shape: 'b' } },
      t,
    )
    expect(next.legend.show).toBe(true)
    expect(next.axes.y.title?.content).toEqual([{ text: 'Mine' }])
  })

  it('orders and sorts the levels of a variable mapped to shape or (XY) colour', () => {
    const g = byGroup('groupBoxPoints', { x: 'a', y: 'c', shape: 'f' })
    const vars = levelVariables(t, g, null)
    expect(vars.map((v) => [v.id, v.role])).toEqual([
      ['a', 'categories'],
      ['f', 'shapes'],
    ])
    expect(vars[1]!.levels).toEqual(['South', 'North'])
    // North has more rows with a Score.
    expect(sortLevels(t, g, 'f', ['South', 'North'], 'count')).toEqual(['North', 'South'])
    const scatter = xy({ color: 'b' })
    expect(levelVariables(t, scatter, null).map((v) => [v.id, v.role])).toEqual([['b', 'colours']])
  })
})

describe('whole-number ticks of counts', () => {
  const tick = (s: Scene, prefix: string) =>
    nodes(s, prefix)
      .filter((n) => n.prim?.type === 'text')
      .map((n) =>
        Number(
          prim(n, 'text')
            .layout.runs.map((r) => r.text)
            .join(''),
        ),
      )
  it('count bars and a count heat map’s colour bar tick at whole numbers', () => {
    const bars = byGroup('bars', { x: 'a', y: 'b' })
    expect(tick(layout(bars), 'axis/y/tickLabel/').every(Number.isInteger)).toBe(true)
    const heat = byGroup('heatmap', { x: 'a', y: 'b' })
    const labels = tick(layout(heat), 'colorScale/label/')
    expect(labels.length).toBeGreaterThan(1)
    expect(labels.every(Number.isInteger)).toBe(true)
  })

  it('an axis of whole numbers never ticks between them (a histogram’s small counts)', () => {
    const extent = new Extent(false)
    extent.add(0)
    extent.add(3)
    extent.integer = true
    expect(continuousDomain(defaultContinuousAxis(), extent, true, []).ticks).toEqual([0, 1, 2, 3])
    extent.integer = false
    expect(continuousDomain(defaultContinuousAxis(), extent, true, []).ticks).toContain(0.5)
  })
})

describe('presets of graphs with variables mapped to appearance', () => {
  it('keep the variables’ types, never the variables, and map the table’s first of each', () => {
    const g = byGroup('groupBoxPoints', {
      x: 'a',
      y: 'c',
      color: 'e',
      shape: 'b',
      size: 'd',
      label: 'f',
    })
    const r = presetRecipe(g, 'multipleVariables', t)
    expect(r.variables).toEqual({
      x: 'text',
      y: 'number',
      color: 'number',
      shape: 'text',
      size: 'number',
      label: 'text',
    })
    // Applied: X the first text variable, Y the first number, then the next of each type.
    expect(recipeLayers(r, t, 'P').mapping).toEqual({
      x: 'a',
      y: 'c',
      color: 'd',
      shape: 'b',
      size: 'e',
      label: 'f',
    })
    const scatter = presetRecipe(xy({ shape: 'b', label: 'a' }), 'multipleVariables', t)
    expect(scatter.variables).toMatchObject({
      x: 'number',
      y: 'number',
      shape: 'text',
      label: 'text',
    })
    const spec = recipeLayers(scatter, t, 'S')
    expect(spec.mapping).toBeUndefined()
    expect(spec.layers.find((l) => l.aes)?.aes).toMatchObject({ shape: 'a', label: 'b' })
  })
})
