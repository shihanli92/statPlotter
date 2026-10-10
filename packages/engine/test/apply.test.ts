import {
  type AnalysisNode,
  type ColumnId,
  createTable,
  type DataTable,
  type GraphNode,
  type LayoutNode,
  type NodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  applyToTables,
  CommandError,
  compatibleTables,
  dataSetMap,
  mapKey,
  mapParams,
  retargetAnalysis,
} from '../src/index.ts'
import { analysis, deepFamily, graph, refsOf, registry } from './familyFixture.ts'
import { curves, outputsOf, POINTS } from './graphs.ts'
import { startedEngine } from './helpers.ts'

/** A column table named `name` with these data set titles and rows, added to the fixture. */
function addTable(f: ReturnType<typeof deepFamily>, name: string, titles: string[], rows: number) {
  const t = createTable({ name, rows, columns: titles.length })
  t.dataSets.forEach((d, i) => {
    d.title = titles[i]!
    d.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) => (i + 1) * 100 + r)
  })
  f.store.dispatch({ type: 'node.add', node: t })
  return t
}

const byName = <N extends { name: string }>(nodes: readonly N[], name: string) =>
  nodes.find((n) => n.name === name)

describe('keys and parameters', () => {
  it('maps data set ids inside output, comparison and grouped keys', () => {
    const keys = new Map<string, string | null>([
      ['aaa', 'xxx'],
      ['bbb', 'yyy'],
      ['ccc', null],
    ])
    expect(mapKey('curve:aaa', keys)).toBe('curve:xxx')
    expect(mapKey('aaa|bbb', keys)).toBe('xxx|yyy')
    expect(mapKey('aaa|ccc', keys)).toBeNull()
    expect(mapKey('row3:aaa|bbb', keys, (r) => (r < 3 ? r : null))).toBeNull()
    expect(mapKey('row1:aaa|bbb', keys, (r) => r)).toBe('row1:xxx|yyy')
    expect(mapKey('colaaa:0|2', keys, (r) => r + 1)).toBe('colxxx:1|3')
    expect(mapKey('cell0:aaa|1:bbb', keys)).toBe('cell0:xxx|1:yyy')
    expect(mapKey('mv:curve:0', keys)).toBe('mv:curve:0')
  })

  it('maps keys in parameters (values, lists and record keys)', () => {
    const keys = new Map<string, string | null>([
      ['aaa', 'xxx'],
      ['ccc', null],
    ])
    expect(
      mapParams(
        {
          outcome: 'aaa',
          predictors: ['aaa', 'ccc', 'zzz'],
          kByDataSet: { aaa: 2, ccc: 3 },
          y: 'log',
        },
        keys,
      ),
    ).toEqual({ outcome: 'xxx', predictors: ['xxx', 'zzz'], kByDataSet: { xxx: 2 }, y: 'log' })
  })

  it('matches data sets by position or by title', () => {
    const a = createTable({ columns: 3 })
    const b = createTable({ columns: 2 })
    ;['Control', 'Low', 'High'].forEach((t, i) => {
      a.dataSets[i]!.title = t
    })
    ;[' high', 'Control'].forEach((t, i) => {
      b.dataSets[i]!.title = t
    })
    const [a0, a1, a2] = a.dataSets.map((d) => d.id)
    const [b0, b1] = b.dataSets.map((d) => d.id)
    expect([...dataSetMap(a, b, 'position')]).toEqual([
      [a0, b0],
      [a1, b1],
      [a2, null],
    ])
    expect([...dataSetMap(a, b, 'title')]).toEqual([
      [a0, b1],
      [a1, null],
      [a2, b0],
    ])
  })
})

describe('applyToTables', () => {
  it('copies the family onto each target, by position, reporting what has no place', () => {
    const f = deepFamily()
    const day2 = addTable(f, 'Day 2', ['Group A', 'Group B'], 2)
    const day3 = addTable(f, 'Day 3', ['x', 'y', 'z'], 6)
    const before = f.store.getState()
    expect(compatibleTables(before, f.day1).map((t) => t.name)).toEqual(['Other', 'Day 2', 'Day 3'])
    const plan = applyToTables(before, f.day1.id, before, [day2.id, day3.id], {
      match: 'position',
      layouts: true,
      find: 'Day 1',
    })
    f.store.dispatch(plan.commands, 'Apply analyses and graphs')
    const doc = f.store.getState()
    for (const id of before.order) expect(doc.nodes[id]).toBe(before.nodes[id])

    const [on2, on3] = plan.created.map((c) => c.nodes.map((id) => doc.nodes[id]!))
    expect(on2!.map((n) => n.name)).toEqual([
      'Scale of Day 2',
      'Sum of Scale of Day 2',
      'Sum of Day 2',
      'Expected of Day 2',
      'Day 2',
      'Scale of Day 2',
      'Figure Day 2',
    ])
    const [x2, y2] = day2.dataSets.map((d) => d.id) as [ColumnId, ColumnId]
    const sum2 = byName(on2!, 'Sum of Day 2') as AnalysisNode
    // C has no third data set to go to in Day 2: left out, and its weight too.
    expect(sum2.input).toEqual({ source: day2.id, dataSets: [x2, y2] })
    expect(sum2.params).toEqual({ weights: {} })
    const chained = byName(on2!, 'Sum of Scale of Day 2') as AnalysisNode
    expect(chained.input).toEqual({
      source: byName(on2!, 'Scale of Day 2')!.id,
      dataSets: [x2, y2],
    })
    // Rows past Day 2's two rows are left out: the row slice, labelled rows, point formats, row
    // parameters.
    expect((byName(on2!, 'Expected of Day 2') as AnalysisNode).params).toEqual({ expected: [1, 2] })
    const g = on2!.find((n) => n.kind === 'graph' && n.seriesSource.table === day2.id) as GraphNode
    expect(g.seriesSource).toEqual({ table: day2.id, include: [x2, y2], rows: [0, 1] })
    expect(g.seriesOverrides).toEqual({
      [x2]: {
        color: { palette: 2 },
        pointLabels: { source: 'rowTitle', which: 'rows', rows: [0] },
      },
    })
    expect(g.pointOverrides).toEqual({ [x2]: { r1s0: { label: 'odd' } } })
    expect(outputsOf(g)[0]).toMatchObject({
      ref: { node: sum2.id, key: `curve:${x2}` },
      colorOf: x2,
    })
    expect(g.annotations[0]).toMatchObject({
      a: x2,
      b: y2,
      label: { analysis: sum2.id, comparison: `${x2}|${y2}` },
    })
    expect(g.legend.hidden).toEqual([])
    const page = on2!.find((n) => n.kind === 'layout') as LayoutNode
    expect(
      page.items.filter((it) => it.type === 'graph').map((it) => it.type === 'graph' && it.graph),
    ).toEqual(on2!.filter((n) => n.kind === 'graph').map((n) => n.id))
    // Every reference inside the copies or to the target.
    for (const n of [...on2!, ...on3!]) {
      for (const r of refsOf(n))
        expect(
          [day2.id, day3.id, ...plan.created.flatMap((c) => c.nodes)].includes(r),
          `${n.name} → ${r}`,
        ).toBe(true)
    }
    // Day 3 has everything: C maps to z, all rows exist.
    const sum3 = byName(on3!, 'Sum of Day 3') as AnalysisNode
    const z3 = day3.dataSets[2]!.id
    expect(sum3.params).toEqual({ weights: { [z3]: 2 } })
    expect(plan.warnings).toEqual([
      '“Sum of Day 2”: no match for “Group C”, left out.',
      '“Expected of Day 2”: rows it names past the end of the table were dropped.',
      '“Day 2”: no match for “Group C”, left out; row 4 past the end of the table, left out.',
    ])
    f.store.undo()
    expect(f.store.getState()).toEqual(before)
  })

  it('matches by title and computes the copies on the target', async () => {
    const f = deepFamily()
    const day2 = addTable(f, 'Day 2', ['group c', 'Group A', 'Group B'], 4)
    const engine = await startedEngine(f.store, registry)
    const doc = f.store.getState()
    const plan = applyToTables(doc, f.day1.id, doc, [day2.id], {
      match: 'title',
      layouts: false,
      find: 'Day 1',
    })
    expect(plan.warnings).toEqual([])
    f.store.dispatch(plan.commands)
    await engine.idle()
    const nodes = plan.created[0]!.nodes.map((id) => f.store.getState().nodes[id]!)
    expect(nodes.some((n) => n.kind === 'layout')).toBe(false)
    const sum = byName(nodes, 'Sum of Day 2') as AnalysisNode
    const [c, a, b] = day2.dataSets.map((d) => d.id)
    expect(sum.input.dataSets).toEqual([a, b, c])
    // Sums of Day 2's A (200…203), B (300…303) and C (100…103) × 2, its weight.
    expect(engine.latest(sum.id)?.values).toMatchObject({
      'Group A': { v: 806 },
      'Group B': { v: 1206 },
      'group c': { v: 812 },
    })
  })

  it('refuses tables of another kind', () => {
    const f = deepFamily()
    const xy = createTable({ tableKind: 'xy' })
    f.store.dispatch({ type: 'node.add', node: xy })
    const doc = f.store.getState()
    expect(() =>
      applyToTables(doc, f.day1.id, doc, [xy.id], { match: 'position', layouts: false, find: '' }),
    ).toThrow(CommandError)
  })
})

describe('retargetAnalysis', () => {
  it('points an analysis at another table; graphs showing only it follow, others lose it', () => {
    const f = deepFamily()
    const day2 = addTable(f, 'Day 2', ['Group A', 'Group B'], 4)
    // A graph showing another analysis' curve besides this one's keeps the old table.
    const other = analysis('Sum of B', 'test.sum', f.day1.id, [f.B])
    const both = graph('Both', f.day1.id, {
      layers: [
        POINTS,
        curves([
          { id: 'c1' as never, ref: { node: f.sum.id, key: `curve:${f.A}` } },
          { id: 'c2' as never, ref: { node: other.id, key: `curve:${f.B}` } },
        ]),
      ],
    })
    f.store.dispatch([
      { type: 'node.add', node: other },
      { type: 'node.add', node: both },
    ])
    const before = f.store.getState()
    const { commands, warnings } = retargetAnalysis(before, f.sum.id, day2.id, 'position')
    f.store.dispatch(commands, 'Change analyzed table')
    const doc = f.store.getState()
    const [x, y] = day2.dataSets.map((d) => d.id)
    expect(doc.nodes[f.sum.id]).toMatchObject({
      name: 'Sum of Day 2',
      input: { source: day2.id, dataSets: [x, y] },
      params: { weights: {} },
    })
    const g1 = doc.nodes[f.g1.id] as GraphNode
    expect(g1).toMatchObject({ name: 'Day 2', seriesSource: { table: day2.id, include: [x, y] } })
    expect(g1.annotations[0]).toMatchObject({ label: { comparison: `${x}|${y}` } })
    expect(outputsOf(g1)[0]).toMatchObject({
      ref: { node: f.sum.id, key: `curve:${x}` },
      colorOf: x,
    })
    expect(outputsOf(doc.nodes[both.id] as GraphNode).map((e) => e.id)).toEqual(['c2'])
    expect(doc.nodes[f.scale.id]).toBe(before.nodes[f.scale.id])
    expect(warnings).toEqual([
      '“Sum of Day 1”: no match for “Group C”, left out.',
      '“Day 1”: no match for “Group C”, left out.',
      '“Both”: no longer shows the curves and brackets of “Sum of Day 1”.',
    ])
    f.store.undo()
    expect(f.store.getState()).toEqual(before)
  })

  it('remaps what reads the analysis’ result table, and moves its own output graph', () => {
    const f = deepFamily()
    const day2 = addTable(f, 'Day 2', ['P', 'Q', 'R'], 4)
    // An output graph of the sum (a ROC curve's kind): no table series, only its outputs.
    const own = graph('Curves of Scale', f.day1.id, {
      seriesSource: { table: f.day1.id, include: [] },
      layers: [curves([{ id: 'o1' as never, ref: { node: f.scale.id, key: `out:${f.A}` } }])],
    })
    f.store.dispatch({ type: 'node.add', node: own })
    const doc = f.store.getState()
    f.store.dispatch(retargetAnalysis(doc, f.scale.id, day2.id, 'position').commands)
    const next = f.store.getState()
    const [p, q] = day2.dataSets.map((d) => d.id)
    expect((next.nodes[f.sumOfScale.id] as AnalysisNode).input).toEqual({
      source: f.scale.id,
      dataSets: [p, q],
    })
    expect((next.nodes[f.g2.id] as GraphNode).seriesSource.include).toEqual([q])
    expect((next.nodes[f.scale.id] as AnalysisNode).input.source).toBe(day2.id)
    expect(next.nodes[own.id]).toMatchObject({
      seriesSource: { table: day2.id, include: [] },
      layers: [{ data: { series: [{ ref: { node: f.scale.id, key: `out:${p}` } }] } }],
    })
  })

  it('refuses analyses of result tables and tables of another kind', () => {
    const f = deepFamily()
    const doc = f.store.getState()
    expect(() => retargetAnalysis(doc, f.sumOfScale.id, f.other.id, 'position')).toThrow(
      CommandError,
    )
    const xy = createTable({ tableKind: 'xy' }) as DataTable
    f.store.dispatch({ type: 'node.add', node: xy })
    expect(() => retargetAnalysis(f.store.getState(), f.sum.id, xy.id as NodeId, 'title')).toThrow(
      CommandError,
    )
  })
})
