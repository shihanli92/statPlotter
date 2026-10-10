import {
  BUILTIN_STYLES,
  builtinStyle,
  type FigureStyle,
  GraphLook,
  type GraphNode,
  type Project,
  styledNewGraph,
  withGraphStyle,
  withProjectStyle,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  CONTEXT_RULES,
  DEFAULT_THEME,
  fitToWidth,
  GRAPH_PRESETS,
  graphTheme,
  hasOwnFormatting,
  layoutGraph,
  presetGraph,
  resetToStyle,
  type Scene,
  sceneToSvg,
  styleFromGraph,
  type Theme,
  themeOf,
} from '../src/index.ts'
import { V1_CURVE, V1_SERIES } from './fixtures/v1ThemeTable.ts'
import { flatten, fonts, projectOf, sampleFor, sampleTable, sampleVariables } from './helpers.ts'

// Roadmap 37: styles resolved into the theme, their precedence below what a graph sets itself,
// Reset to style, a graph's look saved as a style, Fit to column, and the per-chart-type theme
// table retired into per-geom defaults and context rules (decisions 530–539).

const nature = builtinStyle('journal-nature')!
const cell = builtinStyle('journal-cell')!

const withSettings = (p: Project, s: Partial<Project['settings']>): Project => ({
  ...p,
  settings: { ...p.settings, ...s },
})
const svg = (s: Scene) => sceneToSvg(s, { ids: true })
/** The sizes of the scene's text runs whose node id contains `part`. */
const textSizes = (s: Scene, part: string) =>
  flatten(s.root)
    .filter((n) => n.id.includes(part) && n.prim?.type === 'text')
    .flatMap((n) => (n.prim?.type === 'text' ? n.prim.layout.runs.map((r) => r.size) : []))

/** The v1 table as a theme, with the donut's hole the old branch on `look` gave it. */
const V1_THEME: Theme = {
  ...DEFAULT_THEME,
  series: { ...V1_SERIES, 'whole.donut': { ...V1_SERIES['whole.donut'], hole: 0.5 } },
  curve: V1_CURVE,
}

describe('per-geom defaults and context rules (retiring look, decision 536)', () => {
  it('reproduce the v1 per-graph-type table exactly', () => {
    const { hole, ...donut } = DEFAULT_THEME.series['whole.donut']
    expect(hole).toBe(0.5)
    expect({ ...DEFAULT_THEME.series, 'whole.donut': donut }).toEqual(V1_SERIES)
    expect(DEFAULT_THEME.curve).toEqual(V1_CURVE)
    expect(Object.keys(CONTEXT_RULES).sort()).toEqual([...GraphLook.options].sort())
  })

  it('the app default is the empty style', () => {
    expect(themeOf(undefined)).toBe(DEFAULT_THEME)
    expect(themeOf({})).toBe(DEFAULT_THEME)
    expect(themeOf(builtinStyle('default')!.style)).toBe(DEFAULT_THEME)
    const p = projectOf()
    expect(graphTheme(p)).toBe(DEFAULT_THEME)
    expect(graphTheme(withSettings(p, { theme: 'default', style: { name: 'Default' } }))).toBe(
      DEFAULT_THEME,
    )
  })

  // Every preset on every table kind it lists, in every context: the same SVG under the theme
  // built from per-geom defaults and context rules as under the v1 table.
  const cases = GRAPH_PRESETS.flatMap((p) =>
    p.tableKinds.map((kind) => [p.id, kind] as [string, (typeof p.tableKinds)[number]]),
  )
  it.each(cases)('%s on %s draws identically in every context', (id, kind) => {
    const { table, opts } =
      id === 'dotPlot' ? { table: sampleVariables(), opts: {} } : sampleFor(kind)
    const g = presetGraph(table, id, undefined, opts)
    const project = projectOf(table)
    const looks = GraphLook.options
    for (const look of [g.look, ...looks]) {
      const graph = { ...g, look }
      const a = svg(layoutGraph({ project, graph, fonts }))
      const b = svg(layoutGraph({ project, graph, fonts, theme: V1_THEME }))
      expect(a, `${id} ${kind} ${look}`).toBe(b)
    }
  })
})

describe('styles as themes', () => {
  it('a journal style sets fonts and sizes per role, lines, symbols and axis look', () => {
    const t = themeOf(nature.style)
    expect(t.axisTitle).toMatchObject({ font: 'sans', size: 7, bold: false })
    expect(t.tickLabel.size).toBe(6)
    expect(t.graphTitle).toMatchObject({ size: 8, bold: true })
    expect(t.axisLine.width).toBe(0.5)
    expect(t.tickWidth).toBe(0.5)
    expect(t.tickLength).toBe(2.5)
    expect(t.bracket.line.width).toBe(0.5)
    expect(t.bracket.label.size).toBe(6)
    for (const look of GraphLook.options) {
      expect(t.series[look].points.size).toBe(3.5)
      expect(t.series[look].error.line.width).toBe(0.5)
      expect(t.series[look].line.stroke.width).toBe(0.75)
      expect(t.series[look].bar.border.width).toBe(0.5)
    }
    expect(t.curve.line.stroke.width).toBe(0.75)
    // Context rules still apply where the style says nothing (bar widths, caps).
    expect(t.series['grouped.bar'].bar.width).toBe(0.8)
    expect(themeOf(nature.style)).toBe(t)
  })

  it('a palette, colour map and bar fill', () => {
    const t = themeOf({ palette: ['#111111', '#222222'], colorMap: 'magma', barFillOpacity: 0.6 })
    expect(t.palette).toEqual(['#111111', '#222222'])
    expect(t.categorical!.slice(0, 2)).toEqual(['#111111', '#222222'])
    expect(t.colorMap).toBe('magma')
    expect(t.series['column.bar'].bar.fill).toMatchObject({ opacity: 0.6 })
    // Parts of whole stay solid.
    expect(t.series['whole.pie'].bar.fill).toMatchObject({ opacity: 1 })
  })

  it('every built-in style is valid and named descriptively', () => {
    expect(BUILTIN_STYLES.map((s) => s.id)).toEqual([
      'default',
      'journal-nature',
      'journal-cell',
      'journal-science',
      'journal-pnas',
    ])
    for (const s of BUILTIN_STYLES.slice(1)) {
      expect(s.style.name).toMatch(/^Journal: \w+-style \(/)
      expect(s.style.description).toMatch(/Approximate/)
      expect(s.style.description).toMatch(/Not affiliated with or endorsed/)
      expect(s.style.columns?.single).toBeGreaterThan(150)
    }
  })
})

describe('precedence: the graph’s own values > its style > the project’s > the app’s', () => {
  const table = sampleTable('column')
  const base = presetGraph(table, 'bars')
  const graphIn = (g: GraphNode, p: Project) => layoutGraph({ project: p, graph: g, fonts })
  const yTitle = (s: Scene) => textSizes(s, 'axis/y/title')[0]

  it('resolves each level in turn', () => {
    const g0 = {
      ...base,
      axes: { ...base.axes, y: { ...base.axes.y, title: { content: [{ text: 'Y' }] } } },
    }
    const plain = projectOf(table, g0)
    expect(yTitle(graphIn(g0, plain))).toBe(12)
    const natureProject = withSettings(plain, { theme: nature.id, style: nature.style })
    expect(yTitle(graphIn(g0, natureProject))).toBe(7)
    const own = { ...g0, theme: { id: 'x', style: { text: { axisTitle: { size: 9 } } } } }
    expect(yTitle(graphIn(own, natureProject))).toBe(9)
    const explicit = {
      ...own,
      axes: {
        ...own.axes,
        y: { ...own.axes.y, title: { content: [{ text: 'Y' }], style: { size: 20 } } },
      },
    } as GraphNode
    expect(yTitle(graphIn(explicit, natureProject))).toBe(20)
  })

  it('applying another style keeps the user’s edits; Reset to style clears them', () => {
    const edited = {
      ...base,
      title: { content: [{ text: 'T' }], style: { size: 18 } },
      axes: { ...base.axes, y: { ...base.axes.y, line: { width: 3 } } },
    } as GraphNode
    const s0 = { theme: 'default', style: undefined }
    const s1 = { theme: nature.id, style: nature.style }
    const a = withProjectStyle(edited, s0, s1, true)
    expect(a.title?.style?.size).toBe(18)
    expect(a.axes.y.line?.width).toBe(3)
    const p = withSettings(projectOf(table, a), s1)
    expect(textSizes(graphIn(a, p), 'title')).toContain(18)
    const b = withGraphStyle(a, s1, cell)
    expect(b.theme?.id).toBe(cell.id)
    expect(b.title?.style?.size).toBe(18)
    expect(hasOwnFormatting(b, s1)).toBe(true)
    const r = resetToStyle(b, s1)
    expect(r.title?.style).toBeUndefined()
    expect(r.axes.y.line).toBeUndefined()
    expect(hasOwnFormatting(r, s1)).toBe(false)
    // The colours of data sets are the user's choice, not the style's: kept.
    const coloured = { ...b, seriesOverrides: { a: { color: { rgb: '#123456' } } } } as GraphNode
    expect(resetToStyle(coloured, s1).seriesOverrides).toEqual(coloured.seriesOverrides)
  })

  it('axis frames and the legend place follow the style unless the user changed them', () => {
    const offset: FigureStyle = { axes: { frame: 'offset' }, legend: { position: 'top' } }
    const s0 = { theme: 'default' }
    const s1 = { theme: 'user:o', style: offset }
    const g = presetGraph(sampleTable('xy'), 'meanSd')
    const fresh = styledNewGraph(g, s1)
    expect(fresh.axes.y.type === 'continuous' && fresh.axes.y.frame).toBe('offset')
    expect(fresh.legend.position).toBe('top')
    const moved = withProjectStyle(g, s0, s1, true)
    expect(moved.axes.x.type === 'continuous' && moved.axes.x.frame).toBe('offset')
    // Set by the user (differs from the old style's value): kept.
    const own = { ...g, legend: { ...g.legend, position: 'inside' } } as GraphNode
    expect(withProjectStyle(own, s0, s1, true).legend.position).toBe('inside')
    expect(withProjectStyle(moved, s1, s0, true).legend.position).toBe('right')
  })
})

describe('a graph’s look as a style', () => {
  it('draws the same in a project of that style', () => {
    const table = sampleTable('column')
    const g = presetGraph(table, 'barsSem')
    const styled = withSettings(projectOf(table, g), { theme: nature.id, style: nature.style })
    const saved = styleFromGraph(g, styled.settings)
    const elsewhere = withSettings(projectOf(table, g), { theme: 'user:s', style: saved })
    expect(svg(layoutGraph({ project: elsewhere, graph: g, fonts }))).toBe(
      svg(layoutGraph({ project: styled, graph: g, fonts })),
    )
    expect(saved.text?.axisTitle?.size).toBe(7)
    expect(saved.columns).toEqual(nature.style.columns)
  })
})

describe('Fit to column (decision 535)', () => {
  const table = sampleTable('column')
  const g = { ...presetGraph(table, 'bars'), size: { plotWidth: 150, plotHeight: 120, scale: 2 } }
  const project = withSettings(projectOf(table, g), { theme: nature.id, style: nature.style })

  it('makes the whole graph the column wide at scale 1, text at its point sizes', () => {
    const width = nature.style.columns!.single!
    const size = fitToWidth({ project, graph: g, fonts }, width, 'aspect')
    expect(size.scale).toBeUndefined()
    const s = layoutGraph({ project, graph: { ...g, size }, fonts })
    expect(Math.abs(s.width - width)).toBeLessThan(0.05)
    expect(size.plotHeight / size.plotWidth).toBeCloseTo(120 / 150, 2)
    expect(Math.max(...textSizes(s, 'axis/x/tickLabel'))).toBe(6)
  })

  it('keeps the plot’s height when asked', () => {
    const size = fitToWidth({ project, graph: g, fonts }, nature.style.columns!.double!, 'height')
    expect(size.plotHeight).toBe(120)
    const s = layoutGraph({ project, graph: { ...g, size }, fonts })
    expect(Math.abs(s.width - nature.style.columns!.double!)).toBeLessThan(0.05)
  })
})

describe('the newer geoms under a style (audit 2, G9)', () => {
  it('take its data line width and result label size; Default is the app’s defaults', () => {
    const t = themeOf(nature.style)
    expect(t.overlay.polygon.border.width).toBe(0.75)
    expect(t.overlay.path.stroke.width).toBe(0.75)
    expect(t.overlay.segment.stroke.width).toBe(0.75)
    expect(t.refline.width).toBe(0.75)
    expect(t.centroid.text.size).toBe(6)
    expect(themeOf(builtinStyle('journal-science')!.style).density.contour.stroke.width).toBe(1)
    // Hexagons keep no outline.
    expect(t.density.hex.border.width).toBe(0)
    expect(DEFAULT_THEME.overlay.polygon.border.width).toBe(1)
    expect(DEFAULT_THEME.centroid.text.size).toBe(10)
  })

  it('Reset to style clears their widths and sizes set on the layer', () => {
    const line = { color: { rgb: '#000000' }, width: 3, dash: 'solid' }
    const layers = [
      {
        id: 'e',
        geom: 'polygon',
        stat: { kind: 'ellipse' },
        style: { border: line, draw: 'fill' },
      },
      { id: 'c', geom: 'contour', stat: { kind: 'density2d' }, style: { stroke: line } },
      { id: 'p', geom: 'path', stat: { kind: 'identity' }, style: { stroke: line } },
      { id: 'g', geom: 'refline', stat: { kind: 'summary' }, style: { line } },
      { id: 'j', geom: 'connector', stat: { kind: 'identity' }, style: { line } },
    ] as unknown as GraphNode['layers']
    const g = { ...presetGraph(sampleTable('column'), 'points'), layers } as GraphNode
    const r = resetToStyle(g, { theme: nature.id, style: nature.style })
    expect(r.layers.map((l) => l.style)).toEqual([
      { draw: 'fill' },
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })
})
