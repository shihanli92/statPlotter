import {
  type AnalysisNode,
  type Annotation,
  type ColumnId,
  createProject,
  createTable,
  type DataSetKey,
  DEFAULT_LIMIT_RULE,
  type DocNode,
  type GraphNode,
  type NodeId,
  type Project,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  BIG_ARRAY,
  type Change,
  type Command,
  DocumentStore,
  freezeDoc,
  produceCommands,
} from '../src/index.ts'
import { POINTS, testGraph } from './graphs.ts'

// Audit 2 (M2): row inserts and deletes give exactly the document the reducers give under Immer
// (`produceCommands`, the reference), share every node they leave alone, report the nodes they
// change, refuse what the reducers refuse, and undo and redo exactly; on small tables and on
// tables of `BIG_ARRAY` rows or more (compact row patches, decision 670).

const id = <T extends string>(s: string) => s as T
const T = id<NodeId>('grouped')
const O = id<NodeId>('other')
const V = id<NodeId>('vars')
const S = id<NodeId>('summary')
const c0 = id<ColumnId>('c0')
const c1 = id<ColumnId>('c1')

type Bracket = Extract<Annotation, { type: 'bracket' }>

const analysisOf = (aid: string, table: NodeId, analysisId: string, params: unknown) =>
  ({
    kind: 'analysis',
    id: id<NodeId>(aid),
    name: analysisId,
    analysisId,
    pluginVersion: 1,
    input: { source: table, dataSets: [] },
    params,
  }) as AnalysisNode

/**
 * A grouped table of `rows` rows with everything that names its rows (row titles, formatted ones,
 * exclusions, limit flags, graphs' slices, point formats and labels, brackets, analyses' row
 * parameters), a table of variables (text, a formula), a summary column table, and graphs and
 * analyses of another table (left alone by edits of the first).
 */
function fixture(rows: number): Project {
  const p = createProject('P', new Date('2026-10-07T00:00:00Z'))
  const t = createTable({ tableKind: 'grouped', rows, columns: 2, name: 'Grouped' })
  t.id = T
  t.dataSets[0]!.id = c0
  t.dataSets[1]!.id = c1
  t.dataSets[0]!.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) => r)
  t.dataSets[0]!.subcolumns[0]!.excluded = Array.from({ length: rows }, (_, r) => r === 1)
  t.dataSets[1]!.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) =>
    r % 3 ? r / 2 : null,
  )
  t.limits = DEFAULT_LIMIT_RULE
  t.dataSets[1]!.subcolumns[0]!.limit = Array.from({ length: rows }, (_, r) =>
    r === 3 ? { side: 'below' as const, text: '<1' } : null,
  )
  t.rowTitles = Array.from({ length: rows }, (_, r) => (r % 2 ? `R${r}` : null))
  t.rowTitlesRich = Array.from({ length: rows }, (_, r) =>
    r === 2 ? [{ text: 'R2', bold: true }] : null,
  )
  t.rowTitles[2] = 'R2'
  const ds = c0 as unknown as DataSetKey
  const anova = analysisOf('anova', T, 'twoWayAnova', {})
  const bracket = (bid: string, rowA: number, rowB: number, comparison: string): Bracket => ({
    type: 'bracket',
    id: id(bid),
    a: c0 as never,
    b: c1 as never,
    rowA,
    rowB,
    label: { source: 'analysis', analysis: anova.id, comparison, show: 'stars' },
    level: 'auto',
  })
  const graph: GraphNode = testGraph(T, {
    id: id('graph'),
    frame: 'grouped',
    look: 'grouped.scatter',
    layers: [POINTS],
    seriesSource: { table: T, include: 'all', rows: [1, 3] },
    seriesOverrides: { [ds]: { pointLabels: { source: 'rowTitle', which: 'rows', rows: [0, 4] } } },
    pointOverrides: { [ds]: { r1: { size: 9 }, r4s0: { hide: true } } },
    annotations: [
      bracket('b1', 1, 1, `row1:${c0}|${c1}`),
      bracket('b2', 0, 3, `col${c0}:0|3`),
      bracket('b3', 2, 4, `cell2:${c0}|4:${c1}`),
    ],
  })
  const other = createTable({ tableKind: 'grouped', rows: 5, columns: 1, name: 'Other' })
  other.id = O
  const vars = createTable({ tableKind: 'multipleVariables', rows: 4, columns: 3, name: 'Vars' })
  vars.id = V
  vars.dataSets[0]!.title = 'n'
  vars.dataSets[0]!.subcolumns[0]!.values = [1, 2, null, 4]
  vars.dataSets[1]!.text = ['a', null, 'b', 'a']
  vars.dataSets[2]!.formula = '=n*2'
  const summary = createTable({
    tableKind: 'column',
    rows: 1,
    columns: 1,
    yFormat: { type: 'summary', preset: 'meanSdN' },
    name: 'Summary',
  })
  summary.id = S
  const nodes: DocNode[] = [
    t,
    other,
    vars,
    summary,
    analysisOf('contingency', T, 'contingency', { pairwiseControl: '1' }),
    analysisOf('gof', T, 'goodnessOfFit', { expected: [10, 20, 30, 40] }),
    analysisOf('foreign', O, 'contingency', { pairwiseControl: '1' }),
    anova,
    graph,
    testGraph(O, { id: id('othergraph'), seriesSource: { table: O, include: 'all', rows: [1] } }),
  ]
  for (const n of nodes) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
  return freezeDoc(p)
}

/** Dispatches `cmd` and compares everything with the reducers' result under Immer. */
function check(doc: Project, cmd: Command) {
  let ref: Project | Error
  try {
    ref = produceCommands(doc, [cmd])[0]
  } catch (e) {
    ref = e as Error
  }
  const store = new DocumentStore(doc)
  const changes: Change[] = []
  store.subscribe((_, c) => changes.push(c))
  try {
    store.dispatch(cmd)
  } catch (e) {
    expect(ref, JSON.stringify(cmd)).toBeInstanceOf(Error)
    expect((e as Error).message).toBe((ref as Error).message)
    expect(store.getState()).toBe(doc)
    return
  }
  expect(ref).not.toBeInstanceOf(Error)
  const want = ref as Project
  const got = store.getState()
  if (want === doc) {
    expect(got).toBe(doc)
    expect(changes).toEqual([])
    return
  }
  expect(got).toStrictEqual(want)
  // The nodes Immer shares, shared; the nodes it changes, reported.
  const changed = new Set<NodeId>()
  for (const nid of Object.keys(doc.nodes) as NodeId[]) {
    const same = want.nodes[nid] === doc.nodes[nid]
    expect(got.nodes[nid] === doc.nodes[nid], `${nid} shared`).toBe(same)
    if (!same) changed.add(nid)
  }
  expect(changes).toHaveLength(1)
  expect(changes[0]!.touched).toEqual(changed)
  store.undo()
  expect(store.getState()).toStrictEqual(doc)
  store.redo()
  expect(store.getState()).toStrictEqual(want)
}

const SIZES = [6, BIG_ARRAY + 6]

describe.each(SIZES)('row edits of a table of %i rows', (rows) => {
  const doc = fixture(rows)
  const last = rows - 1

  it('the fixture is valid as the store sees it (an edit of every node goes through)', () => {
    const store = new DocumentStore(doc)
    const nodes = Object.keys(doc.nodes) as NodeId[]
    store.dispatch(nodes.map((n) => ({ type: 'node.rename', id: n, name: 'n' })))
    expect(store.historyLength.undo).toBe(1)
  })

  it('inserts: at the start, inside, at the end, none, many; past the end refused', () => {
    for (const [at, count] of [
      [0, 1],
      [2, 3],
      [rows, 2],
      [3, 0],
      [1, 40],
      [rows + 1, 1],
      [-1, 1],
      [0, 1.5],
    ] as const)
      check(doc, { type: 'table.insertRows', table: T, at, count })
  })

  it('deletes: one, several, repeated, none, every row; out of range refused', () => {
    for (const list of [
      [0],
      [last],
      [1, 2, 3],
      [4, 1, 4, 1],
      [],
      [3],
      Array.from({ length: rows }, (_, r) => r),
      [rows],
      [-1],
      [0.5],
    ])
      check(doc, { type: 'table.deleteRows', table: T, rows: list })
  })

  it('of other tables: text and calculated variables, a summary table, a missing table', () => {
    check(doc, { type: 'table.insertRows', table: V, at: 1, count: 2 })
    check(doc, { type: 'table.deleteRows', table: V, rows: [0, 3] })
    check(doc, { type: 'table.insertRows', table: S, at: 0, count: 1 })
    check(doc, { type: 'table.deleteRows', table: S, rows: [0] })
    check(doc, { type: 'table.insertRows', table: id('nope'), at: 0, count: 1 })
    check(doc, { type: 'table.deleteRows', table: id('nope'), rows: [0] })
    check(doc, { type: 'table.deleteRows', table: id('graph'), rows: [0] })
  })

  it('one after another, undone and redone as steps', () => {
    const store = new DocumentStore(doc)
    const states = [store.getState()]
    const cmds: Command[] = [
      { type: 'table.deleteRows', table: T, rows: [0, 2] },
      { type: 'table.insertRows', table: T, at: 1, count: 3 },
      { type: 'table.deleteRows', table: T, rows: [1, last - 2] },
      { type: 'table.insertRows', table: O, at: 0, count: 1 },
    ]
    for (const cmd of cmds) {
      const [want] = produceCommands(store.getState(), [cmd])
      store.dispatch(cmd)
      expect(store.getState()).toStrictEqual(want)
      states.push(store.getState())
    }
    for (let i = states.length - 2; i >= 0; i--) {
      store.undo()
      expect(store.getState()).toStrictEqual(states[i])
    }
    for (let i = 1; i < states.length; i++) {
      store.redo()
      expect(store.getState()).toStrictEqual(states[i])
    }
  })
})
