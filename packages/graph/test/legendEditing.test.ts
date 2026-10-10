import type { AnalysisResult, DataTable, DocNode, GraphNode, LegendSpec, NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  LEGEND_MAX_ENTRIES,
  layoutGraph,
  orderedEntries,
  presetGraph,
  type Scene,
  type SceneNode,
} from '../src/index.ts'
import { cutoffCases } from './cutoffCases.ts'
import { graphOf } from './graphs.ts'
import {
  appearanceTable,
  byId,
  flatten,
  fonts,
  prim,
  projectOf,
  sampleTable,
  sampleVariables,
} from './helpers.ts'
import { groupsTable } from './legendCases.ts'
import { resultCases } from './resultCases.ts'

// Roadmap 47b: the legend's order (within each group of entries), legend-only labels, its grid's
// columns at every position and its fill, on every frame that builds a legend.

const lay = (
  table: DataTable | DocNode[],
  graph: GraphNode,
  results: Record<string, AnalysisResult> = {},
): Scene =>
  layoutGraph({
    project: projectOf(...(Array.isArray(table) ? table : [table]), graph),
    graph,
    fonts,
    result: (id) => results[id],
  })

/** The legend's entry nodes as drawn, in the legend's order. */
const entries = (s: Scene): SceneNode[] => flatten(s.root).filter((n) => !!n.legendEntry)
const keys = (s: Scene) => entries(s).map((n) => n.legendEntry!.key)
const labelText = (s: Scene, id: string) =>
  prim(byId(s, `${id}/label`), 'text')
    .layout.runs.map((r) => r.text)
    .join('')
const withLegend = (g: GraphNode, legend: Partial<LegendSpec>): GraphNode => ({
  ...g,
  legend: { ...g.legend, show: true, ...legend },
})

describe('legend order (roadmap 47b)', () => {
  const four = groupsTable(4)
  const g = graphOf(four, 'bars', (x) => ({ legend: { ...x.legend, show: true } }))

  it('lists the entries the order names in its order, the others after them in their own', () => {
    expect(keys(lay(four, g))).toEqual(['a', 'b', 'c', 'd'])
    expect(keys(lay(four, withLegend(g, { order: ['d', 'b', 'a', 'c'] })))).toEqual([
      'd',
      'b',
      'a',
      'c',
    ])
    // A data set the order doesn't name (added later) comes after those it names.
    expect(keys(lay(four, withLegend(g, { order: ['c', 'a'] })))).toEqual(['c', 'a', 'b', 'd'])
    // Unknown keys and duplicates are ignored; an empty order is no order.
    expect(keys(lay(four, withLegend(g, { order: ['zz', 'b', 'b', 'a', 'zz'] })))).toEqual([
      'b',
      'a',
      'c',
      'd',
    ])
    expect(keys(lay(four, withLegend(g, { order: [] })))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('never changes the drawing order of the marks', () => {
    const marks = (s: Scene) =>
      flatten(s.root)
        .filter((n) => n.id.startsWith('series/') && n.prim)
        .map((n) => n.id)
    expect(marks(lay(four, withLegend(g, { order: ['d', 'c', 'b', 'a'] })))).toEqual(
      marks(lay(four, g)),
    )
  })

  it('reverse applies to a group the order doesn’t list, not to one it lists', () => {
    expect(keys(lay(four, withLegend(g, { reverse: true })))).toEqual(['d', 'c', 'b', 'a'])
    expect(keys(lay(four, withLegend(g, { reverse: true, order: ['b'] })))).toEqual([
      'b',
      'a',
      'c',
      'd',
    ])
  })

  it('keeps hidden entries out and still orders the rest', () => {
    expect(keys(lay(four, withLegend(g, { order: ['d', 'c', 'b', 'a'], hidden: ['c'] })))).toEqual([
      'd',
      'b',
      'a',
    ])
  })

  it('orders within each group: headings, colour bars and other groups stay put', () => {
    const items = [
      { key: 'h', group: 'x', fixed: true },
      { key: 'a' },
      { key: 'b' },
      { key: 'h2', group: 'g', fixed: true },
      { key: 'l1', group: 'g' },
      { key: 'l2', group: 'g' },
      { key: 'more', group: 'g', fixed: true },
      { key: 'c' },
    ]
    expect(orderedEntries(['l2', 'c', 'h2', 'more', 'b'], items).map((e) => e.key)).toEqual([
      'h',
      'c',
      'b',
      'h2',
      'l2',
      'l1',
      'more',
      'a',
    ])
  })

  it('caps a long legend after ordering it', () => {
    const many = groupsTable(LEGEND_MAX_ENTRIES + 5)
    const last = many.dataSets[many.dataSets.length - 1]!.id
    const big = graphOf(many, 'points', (x) => ({ legend: { ...x.legend, show: true } }))
    const s = lay(many, withLegend(big, { order: [last] }))
    expect(keys(s)[0]).toBe(last)
    expect(keys(s)).toHaveLength(LEGEND_MAX_ENTRIES)
    expect(byId(s, 'legend/more')).toBeDefined()
    expect(byId(s, 'legend/more')!.legendEntry).toBeUndefined()
  })

  it('lists every entry for the editors in its order, hidden ones too, even with the legend off', () => {
    const s = lay(four, withLegend(g, { show: false, order: ['b'], hidden: ['a'] }))
    expect(s.legend?.map((e) => [e.key, e.group, e.hidden])).toEqual([
      ['b', 'dataSets', false],
      ['a', 'dataSets', true],
      ['c', 'dataSets', false],
      ['d', 'dataSets', false],
    ])
    expect(s.legend?.[0]?.label).toEqual([{ text: 'Group 2' }])
    expect(entries(s)).toEqual([])
  })
})

describe('legend-only labels (roadmap 47b)', () => {
  const xy = sampleTable('xy')
  const g = graphOf(xy, 'meanSd', (x) => ({ legend: { ...x.legend, show: true } }))

  it('replaces the entry’s label on the legend alone, measured as rich text', () => {
    const plain = lay(xy, g)
    const s = lay(
      xy,
      withLegend(g, { labels: { a: [{ text: 'A much longer label', bold: true }], zz: [] } }),
    )
    expect(labelText(s, 'legend/a')).toBe('A much longer label')
    expect(prim(byId(s, 'legend/a/label'), 'text').layout.runs[0]!.bold).toBe(true)
    expect(labelText(s, 'legend/b')).toBe('Fast')
    // The wider label widens the legend.
    expect(byId(s, 'legend')!.bbox!.w).toBeGreaterThan(byId(plain, 'legend')!.bbox!.w)
    // The editors keep the entry's own label.
    expect(s.legend?.[0]?.label).toEqual([{ text: 'Slow' }])
    // An empty label leaves the sample alone.
    expect(labelText(lay(xy, withLegend(g, { labels: { a: [] } })), 'legend/a')).toBe('')
  })

  it('keeps a result label shown in the legend after a legend-only label', () => {
    const c = resultCases().find(([, , graph]) =>
      graph.layers.some(
        (l) => l.stat.kind === 'result' && 'show' in l.stat && l.stat.show === 'legend',
      ),
    )
    expect(c).toBeDefined()
    const [, nodes, graph, results] = c!
    const s = lay(nodes, graph, results)
    const key = keys(s)[0]!
    const id = entries(s)[0]!.id
    const own = labelText(s, id)
    expect(own).toContain(' (')
    const relabelled = lay(
      nodes,
      withLegend(graph, { labels: { [key]: [{ text: 'Mine' }] } }),
      results,
    )
    expect(labelText(relabelled, id)).toBe(`Mine${own.slice(own.indexOf(' ('))}`)
  })
})

describe('legend columns and fill (roadmap 47b)', () => {
  const four = groupsTable(4)
  const g = graphOf(four, 'bars', (x) => ({ legend: { ...x.legend, show: true } }))
  const places = (s: Scene) =>
    Object.fromEntries(entries(s).map((n) => [n.legendEntry!.key, [n.bbox!.x, n.bbox!.y]]))

  it('columns apply at every position', () => {
    for (const position of ['right', 'top', 'inside'] as const) {
      const p = places(lay(four, withLegend(g, { position, columns: 2 })))
      // a b / c d
      expect(p.a![1]).toBe(p.b![1])
      expect(p.c![1]).toBe(p.d![1])
      expect(p.c![1]).toBeGreaterThan(p.a![1]!)
      expect(p.b![0]).toBeGreaterThan(p.a![0]!)
      expect(p.c![0]).toBe(p.a![0])
    }
    // Without columns: one column (right, inside), one row (top), as before.
    const right = places(lay(four, g))
    expect(new Set(Object.values(right).map((v) => v[0])).size).toBe(1)
    const top = places(lay(four, withLegend(g, { position: 'top' })))
    expect(new Set(Object.values(top).map((v) => v[1])).size).toBe(1)
  })

  it('fills down the columns when asked: as many columns as the rows need', () => {
    const p = places(lay(four, withLegend(g, { columns: 2, fill: 'columns' })))
    // a c / b d
    expect(p.a![0]).toBe(p.b![0])
    expect(p.c![0]).toBe(p.d![0])
    expect(p.c![0]).toBeGreaterThan(p.a![0]!)
    expect(p.a![1]).toBe(p.c![1])
    expect(p.b![1]).toBeGreaterThan(p.a![1]!)
    const five = groupsTable(5)
    const g5 = graphOf(five, 'bars', (x) => ({ legend: { ...x.legend, show: true } }))
    // Five in four columns down: two rows, three columns (a c e / b d).
    const q = places(lay(five, withLegend(g5, { columns: 4, fill: 'columns' })))
    expect(new Set(Object.values(q).map((v) => v[0])).size).toBe(3)
    expect(q.e![1]).toBe(q.a![1])
    // Rows (the default) fill across: a b c d / e.
    const r = places(lay(five, withLegend(g5, { columns: 4, fill: 'rows' })))
    expect(new Set(Object.values(r).map((v) => v[0])).size).toBe(4)
    expect(r.e![0]).toBe(r.a![0])
  })

  it('more columns than entries: one row', () => {
    const p = places(lay(four, withLegend(g, { columns: 9 })))
    expect(new Set(Object.values(p).map((v) => v[1])).size).toBe(1)
  })
})

/** Graphs of every frame that builds a legend (and of its kinds of entries). */
function legendGraphs(): [
  string,
  DataTable | DocNode[],
  GraphNode,
  Record<string, AnalysisResult>,
][] {
  const show = (g: GraphNode): GraphNode => ({
    ...g,
    id: 'g1' as NodeId,
    legend: { ...g.legend, show: true },
  })
  const appearance = appearanceTable()
  const bubble = presetGraph(appearance, 'bubble')
  const out: [string, DataTable | DocNode[], GraphNode, Record<string, AnalysisResult>][] = [
    ['category', groupsTable(3), show(presetGraph(groupsTable(3), 'points')), {}],
    ['grouped', sampleTable('grouped'), show(presetGraph(sampleTable('grouped'), 'bars')), {}],
    ['xy', sampleTable('xy'), show(presetGraph(sampleTable('xy'), 'meanSd')), {}],
    [
      'survival',
      sampleTable('survival'),
      show(presetGraph(sampleTable('survival'), 'survival')),
      {},
    ],
    ['pie', sampleTable('partsOfWhole'), show(presetGraph(sampleTable('partsOfWhole'), 'pie')), {}],
    [
      'bubble guides',
      appearance,
      show({
        ...bubble,
        layers: bubble.layers.map((l) =>
          l.aes ? ({ ...l, aes: { x: 'c', y: 'd', color: 'f', size: 'e' } } as typeof l) : l,
        ),
      }),
      {},
    ],
    [
      'grouped guides',
      sampleVariables(),
      show(
        presetGraph(sampleVariables(), 'barsPoints', undefined, {
          mapping: { x: 'a', y: 'c', color: 'b' },
        }),
      ),
      {},
    ],
  ]
  const volcano = cutoffCases().find(([name]) => name === 'cutoff-volcano-significance')!
  out.push([
    'threshold',
    volcano[1],
    show({ ...volcano[2], legend: { ...volcano[2].legend, hidden: [] } }),
    {},
  ])
  for (const [name, nodes, graph, results] of resultCases())
    if (graph.layers.some((l) => l.stat.kind === 'result' && l.geom !== 'label'))
      out.push([`result ${name}`, nodes, show(graph), results])
  return out
}

describe('every frame building a legend orders and labels it (roadmap 47b)', () => {
  it.each(legendGraphs())('%s', (_, table, graph, results) => {
    const s = lay(table, graph, results)
    expect(s.legend?.length, 'a legend').toBeGreaterThan(0)
    const groups = new Map<string, string[]>()
    for (const e of s.legend!)
      if (!e.fixed) groups.set(e.group, [...(groups.get(e.group) ?? []), e.key])
    const movable = [...groups.values()].filter((k) => k.length > 1)
    expect(movable.length, 'a group of entries to order').toBeGreaterThan(0)
    // Every group reversed through the order: each group's entries drawn in that order.
    const order = movable.flatMap((k) => [...k].reverse())
    const o = lay(table, withLegend(graph, { order }), results)
    const drawn = keys(o)
    for (const k of movable) {
      const want = [...k].reverse().filter((x) => drawn.includes(x))
      expect(drawn.filter((x) => k.includes(x))).toEqual(want)
    }
    // Other parts (headings, colour bars) keep their places in the editors' list.
    expect(o.legend!.map((e) => (e.fixed ? e.key : '*'))).toEqual(
      s.legend!.map((e) => (e.fixed ? e.key : '*')),
    )
    // A legend-only label on the first entry.
    const first = entries(s)[0]!
    const l = lay(
      table,
      withLegend(graph, { labels: { [first.legendEntry!.key]: [{ text: 'Relabelled' }] } }),
      results,
    )
    expect(labelText(l, first.id)).toMatch(/^Relabelled/)
    // Two columns, filled down.
    const c = lay(table, withLegend(graph, { columns: 2, fill: 'columns' }), results)
    expect(c.warnings).toEqual(s.warnings)
  })
})
