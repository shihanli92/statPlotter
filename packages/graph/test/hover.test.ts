import {
  type ColumnId,
  createTable,
  type DataTable,
  type GraphNode,
  type NodeId,
  type Project,
  parsePointKey,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { layoutGraph, markInfo, markSeries, presetGraph, type SceneNode } from '../src/index.ts'
import { fonts, projectOf, sampleVariables } from './helpers.ts'

// Roadmap 34d: what hovering a mark shows — a single value's whole row (every variable of a
// multiple-variables table; else its row, X, value and replicate), a summary's statistics as the
// graph draws them — and where "Go to row" goes.

/** The marks of a laid-out graph's layer (of a geom), with a data set and (maybe) a point. */
function marksOf(project: Project, graph: GraphNode, geom: string): SceneNode[] {
  const scene = layoutGraph({ project, graph, fonts })
  const layers = new Set(graph.layers.filter((l) => l.geom === geom).map((l) => l.id))
  const out: SceneNode[] = []
  const walk = (n: SceneNode) => {
    const m = markSeries(n)
    if (n.prim && m && layers.has(m.layer)) out.push(n)
    for (const c of n.children ?? []) walk(c)
  }
  walk(scene.root)
  return out
}

const info = (project: Project, graph: GraphNode, geom: string, pick = (_: SceneNode) => true) => {
  const node = marksOf(project, graph, geom).find(pick)
  expect(node, geom).toBeDefined()
  return markInfo(project, graph, node!)
}
const atRow = (row: number) => (n: SceneNode) =>
  n.point !== undefined && parsePointKey(n.point)?.row === row

describe('a single value: its whole row', () => {
  it('every variable of a multiple-variables table’s row, calculated ones computed', () => {
    const t = sampleVariables()
    t.dataSets[3]!.subcolumns[0]!.excluded = Array.from({ length: 14 }, (_, r) => r === 4)
    const g = presetGraph(t, 'groupBoxPoints', undefined, { mapping: { x: 'a', y: 'c' } })
    const p = projectOf(t, g)
    const card = info(p, g, 'points', atRow(4))!
    expect(card.title).toBe('Row 5')
    expect(card.lines).toEqual([
      { label: 'Group', value: 'High' },
      { label: 'Sex', value: 'F' },
      { label: 'Score', value: '21' },
      { label: 'Age', value: '29 (excluded)' },
    ])
    expect(card.goTo).toEqual({ table: t.id, row: 4 })
  })

  it('an XY table’s row: its title, X, the value and its replicate', () => {
    const t = createTable({
      tableKind: 'xy',
      rows: 3,
      columns: 1,
      yFormat: { type: 'replicates', count: 2 },
    })
    t.x!.title = 'Time'
    t.x!.subcolumns[0]!.values = [0, 1, 2]
    t.rowTitles = ['a', 'b', 'c']
    const ds = t.dataSets[0]!
    ds.id = 'y' as ColumnId
    ds.title = 'Signal'
    ds.subcolumns[0]!.values = [1, 2, 3]
    ds.subcolumns[1]!.values = [1.5, 2.5, 3.5]
    const g = presetGraph(t, 'each')
    const p = projectOf(t, g)
    const node = marksOf(p, g, 'points').find(
      (n) =>
        n.point !== undefined &&
        parsePointKey(n.point)?.row === 1 &&
        parsePointKey(n.point)?.sub === 1,
    )!
    const card = markInfo(p, g, node)!
    expect(card.title).toBe('b')
    expect(card.lines).toEqual([
      { label: 'Time', value: '1' },
      { label: 'Signal', value: '2.5' },
      { label: 'Replicate', value: 'Replicate 2' },
    ])
    expect(card.goTo).toEqual({ table: t.id, row: 1, column: 'y', sub: 1 })
  })

  it('a column table’s value', () => {
    const t = createTable({ tableKind: 'column', rows: 3, columns: 2 })
    t.dataSets[0]!.title = 'Control'
    t.dataSets[0]!.subcolumns[0]!.values = [4, 5, 6]
    t.dataSets[1]!.subcolumns[0]!.values = [7, 8, 9]
    const g = presetGraph(t, 'barsPoints')
    const p = projectOf(t, g)
    const card = info(p, g, 'points', atRow(2))!
    expect(card.title).toBe('Row 3')
    expect(card.lines[0]).toEqual({ label: 'Control', value: '6' })
    expect(card.goTo).toMatchObject({ table: t.id, row: 2, column: t.dataSets[0]!.id })
  })
})

describe('a summary: what the graph shows', () => {
  it('a bar of the mean ± SD of a data set (its error bars’ layer), with n', () => {
    const t = createTable({ tableKind: 'column', rows: 3, columns: 1 })
    t.dataSets[0]!.title = 'Control'
    t.dataSets[0]!.subcolumns[0]!.values = [4, 5, 9]
    const g = presetGraph(t, 'barsPoints')
    const p = projectOf(t, g)
    const card = info(p, g, 'bar')!
    expect(card.title).toBe('Control')
    expect(card.lines).toEqual([
      { label: 'Mean', value: '6.000' },
      { label: 'SD', value: '2.646' },
      { label: 'n', value: '3' },
    ])
    expect(card.goTo).toBeUndefined()
  })

  it('a grouped graph of variables: a cell’s mean, its category, n', () => {
    const t = sampleVariables()
    const g = presetGraph(t, 'barsPoints', undefined, { mapping: { x: 'a', y: 'c', color: 'b' } })
    const p = projectOf(t, g)
    const bars = marksOf(p, g, 'bar')
    const cards = bars.map((n) => markInfo(p, g, n)!)
    // Group Low, Sex F: rows 0 and 6 (12 and 13).
    const lowF = cards.find((c) => c.title === 'F · Low')!
    expect(lowF.lines.find((l) => l.label === 'Mean')?.value).toBe('12.50')
    expect(lowF.lines.at(-1)).toEqual({ label: 'n', value: '2' })
    // Its points are rows: every variable.
    const pt = info(p, g, 'points', atRow(3))!
    expect(pt.lines.map((l) => l.label)).toEqual(['Group', 'Sex', 'Score', 'Age'])
  })

  it('boxes: median, quartiles, whiskers', () => {
    const t = sampleVariables()
    const g = presetGraph(t, 'groupBoxPoints', undefined, { mapping: { x: 'a', y: 'c' } })
    const p = projectOf(t, g)
    const card = info(p, g, 'box')!
    expect(card.lines.map((l) => l.label)).toEqual(['Median', 'Quartiles', 'Whiskers', 'n'])
  })

  it('counts of two text variables', () => {
    const t = sampleVariables()
    const g = presetGraph(t, 'bars', undefined, { mapping: { x: 'a', y: 'b' } })
    const p = projectOf(t, g)
    const cards = marksOf(p, g, 'bar').map((n) => markInfo(p, g, n)!)
    // Group Low and Sex F: rows 0, 6 and 13.
    expect(cards.find((c) => c.title === 'F · Low')?.lines).toEqual([
      { label: 'Count', value: '3' },
    ])
  })

  it('graphs of result tables show values but go nowhere', () => {
    const t = sampleVariables()
    const g = presetGraph(t, 'groupBoxPoints', undefined, { mapping: { x: 'a', y: 'c' } })
    const result = { ...g, seriesSource: { ...g.seriesSource, table: 'gone' as NodeId } }
    const p = projectOf(t, result)
    expect(marksOf(p, result, 'points')).toEqual([])
    const p2 = projectOf(t as DataTable, g)
    expect(markInfo(p2, g, { target: ['axes', 'y'] })).toBeNull()
  })
})
