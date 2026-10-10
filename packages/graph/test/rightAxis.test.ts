import {
  type AnalysisResult,
  createTable,
  type DataTable,
  GraphNode,
  type NodeId,
  newNodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  axisExtent,
  createGraphFor,
  DEFAULT_RIGHT_AXIS,
  hasRightAxis,
  layoutGraph,
  matchGraphFormat,
  type Scene,
  sceneToSvg,
  seriesOnRight,
  withOutputSeries,
} from '../src/index.ts'
import { layerOf } from './graphs.ts'
import { byId, fonts, nodes, prim, projectOf } from './helpers.ts'

const labels = (s: Scene, axis: 'y' | 'y2') =>
  nodes(s, `axis/${axis}/tickLabel/`).map((n) =>
    prim(n, 'text')
      .layout.runs.map((r) => r.text)
      .join(''),
  )
const top = (s: Scene, axis: 'y' | 'y2') => Number(labels(s, axis).at(-1))

/** Two XY data sets of very different size: A ≈ 1–3, B ≈ 100–300. */
function setup(kind: 'xy' | 'grouped' = 'xy') {
  const table: DataTable = createTable({ tableKind: kind, columns: 2, rows: 3 })
  if (kind === 'xy') table.x!.subcolumns[0]!.values = [1, 2, 3]
  table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
  table.dataSets[1]!.subcolumns[0]!.values = [100, 200, 300]
  const [a, b] = table.dataSets.map((d) => d.id as string) as [string, string]
  const base = createGraphFor(table)
  const project = projectOf(table, base)
  /** The graph with B on the right axis (and a right axis unless `axis` is false). */
  const withRight = (axis = true, graph: GraphNode = base): GraphNode => ({
    ...graph,
    axes: axis
      ? {
          ...graph.axes,
          y2: { ...DEFAULT_RIGHT_AXIS, title: { content: [{ text: 'Right' }] } },
        }
      : graph.axes,
    seriesOverrides: { ...graph.seriesOverrides, [b]: { yAxis: 'right' } },
  })
  return { project, table, base, a, b, withRight }
}

const symbolY = (s: Scene, key: string, row: number) =>
  prim(byId(s, `series/${key}/point/${row}`), 'symbol').cy

describe('right Y axis: model', () => {
  it('validates a right axis and the per-data-set axis choice', () => {
    const { withRight } = setup()
    expect(GraphNode.safeParse(withRight()).success).toBe(true)
    const g = withRight()
    const categorical = { ...g, axes: { ...g.axes, y2: { ...g.axes.x, type: 'categorical' } } }
    expect(GraphNode.safeParse(categorical).success).toBe(false)
    const bad = { ...g, seriesOverrides: { x: { yAxis: 'middle' } } }
    expect(GraphNode.safeParse(bad).success).toBe(false)
  })

  it('a data set is on the right only while the graph has a right axis', () => {
    const { withRight, b, a } = setup()
    expect(seriesOnRight(withRight(), b)).toBe(true)
    expect(seriesOnRight(withRight(), a)).toBe(false)
    expect(seriesOnRight(withRight(false), b)).toBe(false)
    expect(hasRightAxis(withRight(false))).toBe(false)
  })
})

describe('right Y axis: layout', () => {
  it('gives the right axis its own range and ticks; each data set plots against its axis', () => {
    const { project, withRight, a, b } = setup()
    const s = layoutGraph({ project, graph: withRight(), fonts })
    // Left: 0–3 (A only), right: 0–300 (B).
    expect(top(s, 'y')).toBe(3)
    expect(top(s, 'y2')).toBe(300)
    expect(s.axes!.y2).toBeDefined()
    for (const row of [0, 1, 2]) {
      expect(symbolY(s, a, row)).toBeCloseTo(s.axes!.y.toPx(row + 1), 6)
      expect(symbolY(s, b, row)).toBeCloseTo(s.axes!.y2!.toPx((row + 1) * 100), 6)
    }
    // A at 3 on the left and B at 300 on the right both reach the top of the plot.
    expect(symbolY(s, a, 2)).toBeCloseTo(symbolY(s, b, 2), 6)
    expect(prim(byId(s, 'axis/y2/title'), 'text').layout.runs[0]!.text).toBe('Right')
    expect(byId(s, 'axis/y2')?.target).toEqual(['axes', 'y2'])
    expect(sceneToSvg(s)).not.toContain('NaN')
  })

  it('without a right axis, a data set asking for it stays on the left', () => {
    const { project, withRight } = setup()
    const s = layoutGraph({ project, graph: withRight(false), fonts })
    expect(byId(s, 'axis/y2')).toBeUndefined()
    expect(top(s, 'y')).toBe(300)
  })

  it('draws the right axis on the plot’s right edge, ticks and labels outward; legend beyond', () => {
    const { project, withRight, base } = setup()
    const g = withRight(true, { ...base, legend: { ...base.legend, show: true } })
    const s = layoutGraph({ project, graph: g, fonts })
    const right = s.plot.x + s.plot.w
    const line = prim(byId(s, 'axis/y2/line'), 'line')
    expect(line.x1).toBeCloseTo(right, 6)
    const tick = prim(byId(s, 'axis/y2/tick/0'), 'line')
    expect(Math.min(tick.x1, tick.x2)).toBeCloseTo(right, 6)
    expect(Math.max(tick.x1, tick.x2)).toBeGreaterThan(right)
    const labelsX = nodes(s, 'axis/y2/tickLabel/').map((n) => n.bbox!.x)
    expect(Math.min(...labelsX)).toBeGreaterThan(right)
    // The legend is unaffected (one entry per data set) and sits right of the axis title.
    expect(nodes(s, 'legend/').filter((n) => n.id.endsWith('/label'))).toHaveLength(2)
    const title = byId(s, 'axis/y2/title')!.bbox!
    const legendX = Math.min(...nodes(s, 'legend/').map((n) => n.bbox?.x ?? Infinity))
    expect(legendX).toBeGreaterThan(title.x + title.w)
    // Wider than the same graph without the right axis.
    const plain = layoutGraph({ project, graph: { ...g, axes: base.axes }, fonts })
    expect(s.width).toBeGreaterThan(plain.width)
  })

  it('formats the right axis independently (log scale, manual range, number format)', () => {
    const { project, withRight } = setup()
    const g = withRight()
    const s = layoutGraph({
      project,
      graph: {
        ...g,
        axes: {
          ...g.axes,
          y2: {
            ...g.axes.y2!,
            scale: 'log10',
            range: { min: 10, max: 1000 },
            format: { mode: 'auto', suffix: ' U' },
          },
        },
      },
      fonts,
    })
    expect(labels(s, 'y2')).toEqual(['10 U', '100 U', '1000 U'])
    expect(top(s, 'y')).toBe(3)
  })

  it('curves follow the axis of the data set they are drawn with', () => {
    const { project, withRight, b } = setup()
    const analysis = newNodeId()
    const result: AnalysisResult = {
      status: 'ok',
      diagnostics: [],
      sheets: [],
      values: {},
      comparisons: [],
      outputs: { fit: { title: 'Fit', x: [1, 3], y: [100, 300] } },
    }
    const g = withOutputSeries(withRight(), analysis, [{ key: 'fit', forDataSet: b }]).graph
    const curves = layerOf<'line'>(g, 'curves')
    const fit = curves.data?.from === 'outputs' ? curves.data.series[0]!.id : ''
    const lookup = (id: NodeId) => (id === analysis ? result : undefined)
    const s = layoutGraph({ project, graph: g, fonts, result: lookup })
    const curve = prim(byId(s, 'curve/0/0'), 'polyline')
    expect(curve.points[1]![1]).toBeCloseTo(s.axes!.y2!.toPx(300), 6)
    expect(top(s, 'y')).toBe(3)
    // Its own choice wins.
    const left = {
      ...g,
      seriesOverrides: { ...g.seriesOverrides, [fit]: { yAxis: 'left' as const } },
    }
    const s2 = layoutGraph({ project, graph: left, fonts, result: lookup })
    expect(top(s2, 'y')).toBe(300)
  })

  it('linked Y axes share the left axis only', () => {
    const { project, withRight, base } = setup()
    const g = { ...withRight(), links: { y: 'grp' } }
    expect(axisExtent(project, g, 'y')).toEqual({ lo: 1, hi: 3 })
    const other = { ...base, id: newNodeId(), links: { y: 'grp' } }
    project.nodes[other.id] = { ...other, seriesOverrides: {} } as never
    project.nodes[g.id] = g as never
    // The other graph plots B on its left axis: the group's left range reaches 300 for both.
    const s = layoutGraph({ project, graph: g, fonts })
    expect(top(s, 'y')).toBe(300)
    expect(top(s, 'y2')).toBe(300)
  })

  it('grouped graphs: bars on the right axis use its scale; brackets still sit above', () => {
    const { project, withRight, b } = setup('grouped')
    const base = project.nodes[project.order[1]!] as GraphNode
    expect(base.look).toBe('grouped.bar')
    const g = withRight(true, base)
    const s = layoutGraph({ project, graph: g, fonts })
    const bar = prim(byId(s, `series/${b}/bar/2`), 'rect')
    expect(bar.y).toBeCloseTo(s.axes!.y2!.toPx(300), 6)
    expect(top(s, 'y')).toBe(3)
    expect(top(s, 'y2')).toBe(300)
  })

  it('column graphs ignore a right axis', () => {
    const table = createTable({ tableKind: 'column', columns: 2, rows: 2 })
    const g = createGraphFor(table)
    const project = projectOf(table)
    const withY2 = { ...g, axes: { ...g.axes, y2: DEFAULT_RIGHT_AXIS } }
    expect(hasRightAxis(withY2)).toBe(false)
    expect(byId(layoutGraph({ project, graph: withY2, fonts }), 'axis/y2')).toBeUndefined()
  })
})

describe('right Y axis: Magic', () => {
  it('copies the right axis format; keeps the target’s own when the source has none', () => {
    const { project, withRight, base } = setup()
    const source = withRight()
    const styled = {
      ...source,
      axes: {
        ...source.axes,
        y2: { ...source.axes.y2!, format: { mode: 'fixed' as const, digits: 2 } },
      },
    }
    const out = matchGraphFormat(project, base, styled)
    expect(out.axes.y2?.format).toEqual({ mode: 'fixed', digits: 2 })
    // Title wording stays the target's (it had none).
    expect(out.axes.y2?.title).toBeNull()
    const back = matchGraphFormat(project, styled, base)
    expect(back.axes.y2).toEqual(styled.axes.y2)
  })
})
