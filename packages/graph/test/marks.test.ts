import {
  createTable,
  type DataSetKey,
  type GraphNode,
  GraphNode as GraphNodeSchema,
  type Layer,
  newAnnotationId,
  type PointStyle,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { createGraphFor, hitTest, layoutGraph, type Prim, type Scene } from '../src/index.ts'
import { addLayers, graphOf } from './graphs.ts'
import { byId, flatten, fonts, projectOf } from './helpers.ts'

type Rect = Extract<Prim, { type: 'rect' }>

/** A grouped table: 2 data sets × 3 rows, 3 replicates each; a graph of it in a preset. */
function setup(preset: string, points: Record<string, PointStyle> = {}) {
  const table = createTable({
    tableKind: 'grouped',
    columns: 2,
    rows: 3,
    yFormat: { type: 'replicates', count: 3 },
  })
  table.dataSets.forEach((d, i) => {
    d.subcolumns.forEach((c, k) => {
      c.values = [1 + i + k, 3 + i + k, 5 + i + k]
    })
  })
  const ds = table.dataSets[0]!.id as unknown as DataSetKey
  const graph: GraphNode = { ...graphOf(table, preset), pointOverrides: { [ds]: points } }
  const project = projectOf(table, graph)
  return { project, graph, ds: ds as string, other: table.dataSets[1]!.id as string }
}

describe('single bars and boxes', () => {
  it('a bar format changes that bar only; the bar and its error bar carry the row key', () => {
    const red = { rgb: '#ff0000' }
    const { project, graph, ds } = setup('bars', {
      r1: { bar: { fill: { type: 'solid', color: red, opacity: 1 } } },
    })
    const s = layoutGraph({ project, graph, fonts })
    const bar = (row: number) => byId(s, `series/${ds}/bar/${row}`)!
    expect((bar(1).prim as Rect).fill).toEqual({ color: '#ff0000', opacity: 1 })
    expect((bar(0).prim as Rect).fill?.color).not.toBe('#ff0000')
    expect(bar(1).point).toBe('r1')
    expect(byId(s, `series/${ds}/error/1/0`)?.point).toBe('r1')
  })

  it('a cell colour recolours its bar, border and error bar', () => {
    const { project, graph, ds } = setup('bars', { r2: { color: { rgb: '#123456' } } })
    const s = layoutGraph({ project, graph, fonts })
    const p = byId(s, `series/${ds}/bar/2`)!.prim as Rect
    expect([p.fill?.color, p.stroke?.color]).toEqual(['#123456', '#123456'])
    expect((byId(s, `series/${ds}/bar/1`)!.prim as Rect).fill?.color).not.toBe('#123456')
  })

  it('hiding a cell leaves out its bar and error bar but keeps its values’ points', () => {
    const { project, graph, ds } = setup('bars', { r0: { hide: true } })
    // Every value's point, for this data set only.
    const points: Layer = {
      id: 'points',
      geom: 'points',
      stat: { kind: 'identity' },
      position: { kind: 'dodge' },
      seriesHidden: true,
      series: { [ds]: { hide: false } },
    }
    const g = addLayers(graph, [points], 1)
    const s = layoutGraph({ project, graph: g, fonts })
    expect(byId(s, `series/${ds}/bar/0`)).toBeUndefined()
    expect(byId(s, `series/${ds}/error/0/0`)).toBeUndefined()
    expect(byId(s, `series/${ds}/bar/1`)).toBeDefined()
    expect(flatten(s.root).filter((n) => n.id.startsWith(`series/${ds}/point/0/`))).toHaveLength(3)
  })

  it('a box format changes one box of a grouped box plot', () => {
    const { project, graph, ds } = setup('box', {
      r1: { box: { border: { color: { rgb: '#00ff00' }, width: 3, dash: 'solid' } } },
    })
    const s = layoutGraph({ project, graph, fonts })
    const box = (row: number) => byId(s, `series/${ds}/box/${row}`)!
    expect((box(1).prim as Rect).stroke).toEqual({ color: '#00ff00', width: 3, dash: 'solid' })
    expect((box(0).prim as Rect).stroke?.width).toBe(1)
    expect(box(1).point).toBe('r1')
  })

  it('validates bar and box formats in the schema', () => {
    const { graph, ds } = setup('bars')
    const ok = { ...graph, pointOverrides: { [ds]: { r0: { bar: { fill: { type: 'none' } } } } } }
    expect(GraphNodeSchema.safeParse(ok).success).toBe(true)
    const bad = { ...graph, pointOverrides: { [ds]: { r0: { bar: { fill: 'red' } } } } }
    expect(GraphNodeSchema.safeParse(bad).success).toBe(false)
  })
})

describe('drawing order', () => {
  // Drawn by data set: each data set's marks in a group, back to front.
  const bySeries = (g: GraphNode): GraphNode => ({ ...g, drawOrder: 'series' })
  const kinds = (s: Scene, ds: string) =>
    (byId(s, `series/${ds}`)!.children ?? []).map((n) => n.id.split('/')[2])

  it('the layer list sets the drawing order (back to front)', () => {
    const col = createTable({ tableKind: 'column', columns: 1, rows: 4 })
    col.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3, 4]
    const g = bySeries(createGraphFor(col))
    const project = projectOf(col)
    const key = col.dataSets[0]!.id as string
    const s = layoutGraph({ project, graph: g, fonts })
    // Column scatter: points, then error bars, then the centre line on top.
    expect([...new Set(kinds(s, key))]).toEqual(['point', 'error', 'center'])

    const { project: p2, graph: g2, ds } = setup('barsPoints')
    expect([
      ...new Set(kinds(layoutGraph({ project: p2, graph: bySeries(g2), fonts }), ds)),
    ]).toEqual(['bar', 'point', 'error'])
  })

  it('a data set’s mark order puts error bars behind the points', () => {
    const { project, graph, ds } = setup('barsPoints')
    const g = bySeries({ ...graph, seriesOverrides: { [ds]: { order: ['points', 'error'] } } })
    const s = layoutGraph({ project, graph: g, fonts })
    expect([...new Set(kinds(s, ds))]).toEqual(['bar', 'error', 'point'])
  })

  it('completes a partial order with the layer list', () => {
    const { project, graph, ds, other } = setup('barsPoints')
    // The bars in front; the other layers behind them in the list's order.
    const g = bySeries({ ...graph, seriesOverrides: { [ds]: { order: ['bars'] } } })
    const s = layoutGraph({ project, graph: g, fonts })
    expect([...new Set(kinds(s, ds))]).toEqual(['point', 'error', 'bar'])
    expect([...new Set(kinds(s, other))]).toEqual(['bar', 'point', 'error'])
  })

  it('annotations sent behind the data are drawn (and hit) under it', () => {
    const { project, graph, ds } = setup('bars')
    const note = {
      type: 'line' as const,
      id: newAnnotationId(),
      space: 'plot' as const,
      from: { x: 0, y: 0.9 },
      to: { x: 1, y: 0.9 },
      stroke: { color: { rgb: '#000000' }, width: 4, dash: 'solid' as const },
      arrow: 'none' as const,
    }
    const front = layoutGraph({ project, graph: { ...graph, annotations: [note] }, fonts })
    const back = layoutGraph({
      project,
      graph: { ...graph, annotations: [{ ...note, behind: true }] },
      fonts,
    })
    const order = (s: Scene) => (s.root.children ?? []).map((n) => n.id)
    expect(order(front).indexOf('annotations')).toBeGreaterThan(order(front).indexOf('series'))
    expect(order(back).indexOf('annotations/behind')).toBeLessThan(order(back).indexOf('series'))
    // A point on both the line and a bar: the line when in front, the bar when behind.
    const bar = byId(front, `series/${ds}/bar/0`)!.prim as Rect
    const at: [number, number] = [bar.x + bar.w / 2, front.plot.y + front.plot.h * 0.9]
    expect(hitTest(front.root, ...at)?.target).toEqual(['annotations', 0])
    expect(hitTest(back.root, ...at)?.target?.slice(2)).toEqual(['series', ds])
  })
})
