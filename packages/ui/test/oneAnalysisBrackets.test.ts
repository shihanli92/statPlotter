import { registry } from '@ps/analyses'
import { DocumentStore } from '@ps/engine'
import { layoutGraph, presetGraph, type Scene } from '@ps/graph'
import {
  type AnalysisNode,
  type Annotation,
  type ColumnId,
  createProject,
  createTable,
  type DataTable,
  type GraphNode,
  type NodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { startedEngine } from '../../engine/test/helpers.ts'
import { flatten, fonts } from '../../graph/test/helpers.ts'
import { duplicateComparisons, duplicateText } from '../src/graph/results/duplicates.ts'
import {
  BRACKET_TESTS,
  bracketTests,
  offersOneAnalysis,
  oneAnalysisBracketCommands,
  UNCORRECTED,
  xBracketCommands,
} from '../src/graph/results/resultActions.ts'

// Roadmap 51c (design §7.3–§7.5): brackets labelled from one analysis of all the groups instead
// of a test per bracket; bracket tests marked uncorrected when a graph has several; P labels
// naming their test; two tests of one comparison on a graph flagged.

const textOf = (s: Scene, prefix: string) =>
  flatten(s.root)
    .filter((n) => n.id.startsWith(prefix) && n.prim?.type === 'text')
    .map((n) => (n.prim?.type === 'text' ? n.prim.layout.runs.map((r) => r.text).join('') : ''))

async function setup(table: DataTable, preset: string) {
  const store = new DocumentStore(createProject('P', new Date('2026-01-01T00:00:00Z')))
  store.dispatch({ type: 'node.add', node: table })
  const graph = { ...presetGraph(table, preset), id: 'g1' as NodeId }
  store.dispatch({ type: 'node.add', node: graph })
  const engine = await startedEngine(store, registry)
  const g = () => store.getState().nodes[graph.id] as GraphNode
  const scene = () =>
    layoutGraph({ project: store.getState(), graph: g(), fonts, result: (id) => engine.latest(id) })
  return { store, engine, g, scene }
}

const brackets = (g: GraphNode) =>
  g.annotations.filter((a): a is Extract<Annotation, { type: 'bracket' }> => a.type === 'bracket')

function xyTable(): DataTable {
  const t = createTable({
    tableKind: 'xy',
    columns: 2,
    rows: 4,
    yFormat: { type: 'replicates', count: 3 },
  })
  t.id = 't1' as NodeId
  t.name = 'Time course'
  t.x!.subcolumns[0]!.values = [0, 24, 48, 72]
  t.dataSets.forEach((d, i) => {
    d.id = String.fromCharCode(97 + i) as ColumnId
    d.title = ['NT', 'KO'][i]!
    d.subcolumns.forEach((s, j) => {
      s.values = [0, 24, 48, 72].map((x, r) => 10 + x * (i + 1) * 0.1 + ((r * 3 + j * 5 + i) % 4))
    })
  })
  return t
}

function columnTable(n: number): DataTable {
  const t = createTable({ tableKind: 'column', columns: n, rows: 4 })
  t.id = 't2' as NodeId
  t.name = 'Doses'
  t.dataSets.forEach((d, i) => {
    d.id = String.fromCharCode(97 + i) as ColumnId
    d.title = ['Vehicle', 'Low', 'High', 'Max'][i]!
    d.subcolumns[0]!.values = [10, 12, 11, 13].map((v, r) => v + i * 2 + ((r * 7 + i) % 3))
  })
  return t
}

describe('bracket tests', () => {
  it('Welch’s t test first; a P label names its test; several on a graph are uncorrected', async () => {
    expect(BRACKET_TESTS[0]!.value).toBe('welch')
    const table = xyTable()
    const { store, engine, g, scene } = await setup(table, 'meanSd')
    const first = xBracketCommands(
      g(),
      table,
      { x: 72, a: 'a', b: 'b', test: 'welch', show: 'p' },
      store.getState(),
    )
    store.dispatch(first.commands)
    expect(first.analysis.name).toBe('Welch’s t test at X = 72 (NT vs. KO)')
    expect(first.analysis.params).toMatchObject({ unpaired: { assumeEqualSD: false } })
    await engine.idle()
    expect(textOf(scene(), 'annotation/')[0]).toMatch(/^P [<=] .* \(Welch’s t\)$/)
    const second = xBracketCommands(
      g(),
      table,
      { x: 24, a: 'a', b: 'b', test: 'welch', show: 'stars' },
      store.getState(),
    )
    store.dispatch(second.commands)
    const names = bracketTests(store.getState(), g()).map((n) => n.name)
    expect(names).toHaveLength(2)
    expect(names.every((n) => n.endsWith(UNCORRECTED))).toBe(true)
  })
})

describe('one analysis of all the groups', () => {
  it('offered with three or more groups, or a second bracket', () => {
    const two = columnTable(2)
    const graph = presetGraph(two, 'bars')
    expect(offersOneAnalysis(graph, two)).toBe(false)
    const bracket: Annotation = {
      type: 'bracket',
      id: 'b1' as never,
      a: 'a',
      b: 'b',
      label: { source: 'manual', text: '*' },
      level: 'auto',
    }
    expect(offersOneAnalysis({ ...graph, annotations: [bracket] }, two)).toBe(true)
    const three = columnTable(3)
    expect(offersOneAnalysis(presetGraph(three, 'bars'), three)).toBe(true)
  })

  it('column data: one-way ANOVA with Tukey’s comparisons, a bracket each; reused', async () => {
    const table = columnTable(3)
    const { store, engine, g, scene } = await setup(table, 'bars')
    const r = oneAnalysisBracketCommands(store.getState(), g(), table, { show: 'p' })
    if ('error' in r) throw new Error(r.error)
    expect(r.analysis).toMatchObject({
      analysisId: 'oneWayAnova',
      name: 'One-way ANOVA (Tukey) of Doses',
    })
    expect(r.added).toBe(3)
    store.dispatch(r.commands)
    await engine.idle()
    const res = engine.latest(r.analysis.id)!
    const keys = res.comparisons.map((c) => c.key)
    expect(brackets(g()).map((b) => b.label.source === 'analysis' && b.label.comparison)).toEqual(
      keys,
    )
    const labels = textOf(scene(), 'annotation/')
    expect(labels).toHaveLength(3)
    expect(labels).toEqual(labels.map(() => expect.stringMatching(/ \(Tukey\)$/)))
    // Asked again: the same analysis, nothing to add.
    const again = oneAnalysisBracketCommands(store.getState(), g(), table, { show: 'p' })
    if ('error' in again) throw new Error(again.error)
    expect(again.analysis.id).toBe(r.analysis.id)
    expect(again.added).toBe(0)
    // Against a control: Dunnett's, a bracket per group.
    const vs = oneAnalysisBracketCommands(store.getState(), g(), table, {
      show: 'stars',
      control: 'a',
    })
    if ('error' in vs) throw new Error(vs.error)
    expect(vs.analysis.name).toBe('One-way ANOVA (Dunnett) of Doses')
    expect(vs.added).toBe(2)
  })

  it('XY data: two-way ANOVA compared at each X; the bracket tests relabelled and removed', async () => {
    const table = xyTable()
    const { store, engine, g } = await setup(table, 'meanSd')
    for (const x of [72, 24])
      store.dispatch(
        xBracketCommands(
          g(),
          table,
          { x, a: 'a', b: 'b', test: 'welch', show: 'stars' },
          store.getState(),
        ).commands,
      )
    const tests = bracketTests(store.getState(), g()).map((n) => n.id)
    expect(tests).toHaveLength(2)
    const r = oneAnalysisBracketCommands(store.getState(), g(), table, {
      show: 'stars',
      x: 72,
      a: 'a',
      b: 'b',
    })
    if ('error' in r) throw new Error(r.error)
    expect(r.analysis.input.byX).toBe(true)
    expect(r.added).toBe(0)
    store.dispatch(r.commands)
    await engine.idle()
    for (const t of tests) expect(store.getState().nodes[t]).toBeUndefined()
    const comparisons = brackets(g()).map((b) => b.label.source === 'analysis' && b.label)
    expect(comparisons.map((l) => l && [l.analysis, l.comparison])).toEqual([
      [r.analysis.id, 'row3:a|b'],
      [r.analysis.id, 'row1:a|b'],
    ])
    const res = engine.latest(r.analysis.id)!
    expect(res.status).not.toBe('error')
    expect(res.comparisons.map((c) => c.key)).toEqual(
      expect.arrayContaining(['row1:a|b', 'row3:a|b']),
    )
    // One undo step: the tests and their brackets back.
    store.undo()
    expect(bracketTests(store.getState(), g()).map((n) => n.id)).toEqual(tests)
  })
})

describe('two tests of one comparison on a graph', () => {
  it('flagged, with the analyses that test it', async () => {
    const table = columnTable(3)
    const { store, g } = await setup(table, 'bars')
    const r = oneAnalysisBracketCommands(store.getState(), g(), table, { show: 'stars' })
    if ('error' in r) throw new Error(r.error)
    store.dispatch(r.commands)
    expect(duplicateComparisons(g(), store.getState())).toEqual([])
    const t: AnalysisNode = {
      kind: 'analysis',
      id: 'tt' as NodeId,
      name: 'Welch’s t test',
      analysisId: 'ttest',
      pluginVersion: 2,
      input: { source: table.id, dataSets: ['a', 'b'] },
      params: registry.get('ttest')!.params.parse({}),
    }
    const extra: Annotation = {
      type: 'bracket',
      id: 'bx' as never,
      a: 'b',
      b: 'a',
      label: { source: 'analysis', analysis: t.id, comparison: 'a|b', show: 'p' },
      level: 'auto',
    }
    store.dispatch([
      { type: 'node.add', node: t },
      { type: 'node.set', id: g().id, path: ['annotations'], value: [...g().annotations, extra] },
    ])
    const d = duplicateComparisons(g(), store.getState())
    expect(d).toHaveLength(1)
    expect(d[0]!.tests.map((x) => x.analysis)).toEqual([r.analysis.id, t.id])
    expect(duplicateText(d[0]!)).toBe('2 tests of Vehicle vs Low shown')
  })
})
