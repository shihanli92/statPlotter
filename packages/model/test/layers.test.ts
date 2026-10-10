import { describe, expect, it } from 'vitest'
import {
  compileV1,
  createTable,
  Geom,
  GraphNode,
  GraphNodeV1,
  GraphType,
  type NodeId,
  type SeriesId,
  Stat,
  styleSections,
  v1SectionTable,
} from '../src/index.ts'
import { GraphNodeV1 as FrozenV1 } from '../src/migrations/v1schema.ts'

// compileV1 (roadmap 33a): v1 graphs as frame + layers. Its exactness is the graph package's
// shadow test; here, its shape: valid, deterministic, styles and stats where they belong.

const AXIS = {
  type: 'continuous' as const,
  title: null,
  scale: 'linear' as const,
  range: 'auto' as const,
  ticks: 'auto' as const,
  format: { mode: 'auto' as const },
  frame: 'plain' as const,
  breaks: [],
}

function v1(graphType: GraphType, patch: Partial<GraphNodeV1> = {}): GraphNodeV1 {
  return {
    kind: 'graph',
    id: 'g1' as NodeId,
    name: 'G',
    graphType,
    seriesSource: { table: 't1' as NodeId, include: 'all' },
    seriesOverrides: {},
    extraSeries: [],
    size: { plotWidth: 200, plotHeight: 150 },
    axes: { x: AXIS, y: AXIS },
    annotations: [],
    legend: { show: false, position: 'right' },
    title: null,
    style: {},
    ...patch,
  }
}

const ids = (g: GraphNode) => g.layers.map((l) => l.id)
const layer = (g: GraphNode, id: string) => g.layers.find((l) => l.id === id)!

describe('compileV1', () => {
  it('compiles every graph type to a valid, deterministic layered graph', () => {
    for (const type of GraphType.options) {
      const a = compileV1(v1(type))
      expect(() => GraphNode.parse(a.graph), type).not.toThrow()
      expect(a.graph.look).toBe(type)
      expect(a.graph.drawOrder).toBe('series')
      expect(compileV1(v1(type))).toEqual(a)
      expect(a.report, type).toEqual([])
    }
  })

  it('maps graph types to frames and their marks to layers, back to front', () => {
    const bar = compileV1(v1('column.bar')).graph
    expect(bar.frame).toBe('category')
    expect(ids(bar)).toEqual(['bars', 'points', 'error'])
    // Points are hidden on bar graphs: kept (their format names the legend's symbol).
    expect(layer(bar, 'points').seriesHidden).toBe(true)
    expect(layer(bar, 'error')).toMatchObject({ on: 'bars', stat: { center: 'mean', error: 'SD' } })
    expect(compileV1(v1('grouped.box')).graph.frame).toBe('grouped')
    expect(compileV1(v1('whole.pie')).graph.frame).toBe('polar')
    expect(compileV1(v1('whole.bar')).graph.frame).toBe('category')
    expect(compileV1(v1('heatmap.cells')).graph.frame).toBe('matrix')
    const xy = compileV1(v1('xy.scatter')).graph
    expect(xy.frame).toBe('xy')
    // XY: symbols in front of their error bars.
    expect(ids(xy)).toEqual(['error', 'points'])
    expect(layer(xy, 'points').stat).toEqual({ kind: 'summary', center: 'mean' })
  })

  it('moves styles into layers: the graph’s defaults, each data set’s own, renamed', () => {
    const g = compileV1(
      v1('column.scatter', {
        style: { seriesDefaults: { points: { size: 9, jitter: 'none' }, color: { palette: 3 } } },
        seriesOverrides: { b: { points: { shape: 'square', show: false }, yAxis: 'right' } },
      }),
    ).graph
    expect(layer(g, 'points').style).toEqual({ size: 9, spread: 'none' })
    expect(layer(g, 'points').series).toEqual({ b: { hide: true, style: { shape: 'square' } } })
    expect(g.style.seriesDefaults).toEqual({ color: { palette: 3 } })
    expect(g.seriesOverrides).toEqual({ b: { yAxis: 'right' } })
  })

  it('keeps per-data-set stats and drawing order', () => {
    const g = compileV1(
      v1('grouped.scatter', {
        seriesOverrides: {
          a: { points: { replicates: 'mean' }, center: { stat: 'median' } },
          b: { markOrder: ['points'] },
        },
      }),
    ).graph
    expect(layer(g, 'points').series?.a?.stat).toEqual({
      kind: 'summary',
      center: 'median',
    })
    // Front to back. A mean symbol is drawn where v1 drew it: among the centre lines.
    expect(ids(g)).toEqual(['points', 'error', 'center'])
    expect(g.seriesOverrides.a?.order).toEqual(['center', 'points', 'error'])
    expect(g.seriesOverrides.b?.order).toEqual(['points', 'center', 'error'])
  })

  it('puts curves and functions in layers of their own, styles by series id', () => {
    const g = compileV1(
      v1('xy.scatter', {
        extraSeries: [
          { id: 'e1' as SeriesId, ref: { node: 'a1' as NodeId, key: 'fit' }, colorOf: 'a' },
          {
            id: 'e2' as SeriesId,
            ref: { node: 'a1' as NodeId, key: 'dots' },
            style: { points: { show: true }, line: { show: false }, color: { palette: 1 } },
          },
        ],
        functions: [{ id: 'f1' as SeriesId, equation: 'user', userEquation: 'Y = X', params: {} }],
      }),
    ).graph
    expect(layer(g, 'curves').data).toEqual({
      from: 'outputs',
      series: [
        { id: 'e1', ref: { node: 'a1', key: 'fit' }, colorOf: 'a' },
        { id: 'e2', ref: { node: 'a1', key: 'dots' } },
      ],
    })
    expect(layer(g, 'curves').series).toEqual({ e2: { hide: true } })
    expect(layer(g, 'curvePoints')).toMatchObject({
      seriesHidden: true,
      series: { e2: { hide: false } },
    })
    expect(layer(g, 'functions').data?.from).toBe('functions')
    expect(g.seriesOverrides.e2).toEqual({ color: { palette: 1 } })
  })

  it('reports settings v1 ignored, and what it can only approximate', () => {
    const survival = compileV1(v1('survival.step', { axes: { x: AXIS, y: AXIS, y2: AXIS } }))
    expect(survival.graph.axes.y2).toBeUndefined()
    expect(survival.report).toEqual([
      { kind: 'dropped', text: 'axes.y2: not used by survival.step graphs' },
    ])
    const bars = compileV1(
      v1('grouped.bar', {
        style: { seriesDefaults: { points: { show: true, replicates: 'mean' } } },
      }),
    )
    expect(bars.report.map((n) => n.kind)).toEqual(['approximated'])
    // Formats of marks the type doesn't draw (kept by v1 after a type change) are reported.
    const scatter = compileV1(
      v1('column.scatter', {
        style: { seriesDefaults: { bar: { width: 0.5 }, error: { stat: 'SD' } } },
        seriesOverrides: { a: { bar: { fill: { type: 'none' } } }, b: { bar: { width: 0.2 } } },
      }),
    )
    expect(scatter.report).toEqual([
      { kind: 'dropped', text: 'bar (width) of every data set: not used by column.scatter graphs' },
      { kind: 'dropped', text: 'bar (fill) of a data set: not used by column.scatter graphs' },
      { kind: 'dropped', text: 'bar (width) of a data set: not used by column.scatter graphs' },
    ])
  })

  it('copies the first data set’s error bar line to before-after connectors', () => {
    const table = createTable({ tableKind: 'column', columns: 2, rows: 3 })
    table.id = 't1' as NodeId
    const first = table.dataSets[0]!.id
    const line = { color: { rgb: '#ff0000' }, width: 2, dash: 'dot' } as const
    const g = compileV1(
      v1('column.beforeAfter', { seriesOverrides: { [first]: { error: { line } } } }),
      table,
    ).graph
    expect(layer(g, 'pairs').style).toEqual({ line })
    expect(styleSections(layer(g, 'pairs')).line).toEqual(['error', 'line'])
  })
})

describe('the migration’s own copy of where layer styles come from', () => {
  it('agrees with the theme’s (`styleSections`) for every geom, stat and data source', () => {
    // The migration is frozen with its copy; the theme's table may change only with a migration.
    const kinds = Stat.options.map((o) => o.shape.kind.value)
    for (const geom of Geom.options)
      for (const kind of kinds)
        for (const table of [true, false]) {
          const layer = {
            geom,
            stat: { kind } as never,
            ...(table ? {} : { data: { from: 'outputs' as const, series: [] } }),
          }
          expect(styleSections(layer), `${geom} ${kind} ${table}`).toEqual(
            v1SectionTable(geom, kind, table),
          )
        }
  })
})

describe('the v1 schema (audit 2, M10)', () => {
  it('is frozen as 33b released it, apart from the v2 graph’s growing common fields', () => {
    expect(GraphNodeV1).toBe(FrozenV1)
    expect(GraphNodeV1.safeParse(v1('xy.scatter')).success).toBe(true)
    // Roadmap 34g's scales came after v1: a v2 axis takes them, a v1 file never held them.
    const logicle = { ...AXIS, scale: 'logicle' as const }
    expect(
      GraphNodeV1.safeParse({ ...v1('xy.scatter'), axes: { x: logicle, y: AXIS } }).success,
    ).toBe(false)
    const v2 = compileV1(v1('xy.scatter')).graph
    expect(GraphNode.safeParse({ ...v2, axes: { x: logicle, y: AXIS } }).success).toBe(true)
  })
})
