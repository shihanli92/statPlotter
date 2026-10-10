import {
  type AnalysisNode,
  type ColumnId,
  createProject,
  createTable,
  type DataTable,
  type GraphNode,
  type Layer,
  type NodeId,
  newColumnId,
  newNodeId,
  type Project,
  type YFormat,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { DocumentStore } from '../src/index.ts'
import { curves, GROUPED, POINTS, testGraph, XY } from './graphs.ts'

// Audit 2: what names a table's data sets follows Swap X and Y (M3) and deleting columns (M15);
// what names its rows follows row edits on any graph, result labels included (M4).

const analysis = (
  source: NodeId,
  dataSets: string[],
  params: unknown = {},
  analysisId = 'test',
): AnalysisNode => ({
  kind: 'analysis',
  id: newNodeId(),
  name: analysisId,
  analysisId,
  pluginVersion: 1,
  input: { source, dataSets },
  params,
})

/** A result label of an analysis reading a value and a comparison by key. */
const resultLayer = (id: string, of: NodeId, value: string, comparison: string): Layer =>
  ({
    id,
    geom: 'label',
    stat: {
      kind: 'result',
      fields: {
        v: { ref: { from: 'value', key: value } },
        p: { ref: { from: 'comparison', key: comparison } },
      },
      template: '{v} {p}',
    },
    data: { from: 'analysis', analysis: of },
  }) as Layer

/**
 * An XY table (data sets A, B, C), analyses of it (a fit drawing curves, an ANOVA labelling a
 * bracket, a correlation shown as results), a transform whose result table names A, an analysis of
 * that result, and graphs naming A, B and C at every place a graph names a data set.
 */
function fixture() {
  const table = createTable({ tableKind: 'xy', rows: 3, columns: 3 })
  table.x!.subcolumns[0]!.values = [1, 2, 3]
  const [A, B, C] = table.dataSets.map((d) => d.id) as [ColumnId, ColumnId, ColumnId]
  const other = createTable({ tableKind: 'xy', rows: 3, columns: 1 })
  const fit = analysis(table.id, [A, B], {}, 'fit')
  const anova = analysis(table.id, [A, B, C], {}, 'anova')
  const corr = analysis(table.id, [A, B], { x: A, cols: [A, B], k: { [B]: 1, [A]: 2 } }, 'corr')
  const transform = analysis(table.id, [A, B], {}, 'transform')
  const downstream = analysis(transform.id, [A, B], { cols: [A, B] }, 'stats')
  const graph = testGraph(table.id, {
    ...XY,
    layers: [
      { ...POINTS, series: { [A]: { hide: true }, [B]: {} } },
      curves([
        { id: 'c1' as never, ref: { node: fit.id, key: `curve:${A}` }, colorOf: A },
        { id: 'c2' as never, ref: { node: fit.id, key: `curve:${B}` }, colorOf: B },
      ]),
      {
        id: 'bubbles',
        geom: 'points',
        stat: { kind: 'identity' },
        aes: { x: A, y: B, color: C },
      } as Layer,
      resultLayer('result', corr.id, `slope:${A}`, `${A}|${B}`),
    ],
    seriesSource: { table: table.id, include: [A, B, C], rows: [2, 0] },
    seriesOverrides: { [A]: { color: { palette: 1 } }, [B]: { color: { palette: 2 } } },
    pointOverrides: { [B]: { r1s0: { size: 3 } } },
    annotations: [
      {
        type: 'bracket',
        id: 'n1' as never,
        a: A,
        b: C,
        label: { source: 'analysis', analysis: anova.id, comparison: `${A}|${C}`, show: 'stars' },
        level: 'auto',
        group: [B],
      },
      {
        type: 'bracket',
        id: 'n2' as never,
        a: A,
        b: B,
        label: { source: 'analysis', analysis: anova.id, comparison: `${A}|${B}`, show: 'stars' },
        level: 'auto',
      },
    ],
    legend: { show: true, position: 'right', hidden: [B, 'c1'] },
    levels: { [C]: ['High', 'Low'] },
  } as Partial<GraphNode>)
  const ofResult = testGraph(transform.id, {
    seriesSource: { table: transform.id, include: [A, B] },
    seriesOverrides: { [A]: { color: { palette: 3 } } },
  })
  const elsewhere = testGraph(other.id, {
    ...XY,
    layers: [
      POINTS,
      curves([{ id: 'c3' as never, ref: { node: fit.id, key: `curve:${A}` } }]),
      resultLayer('result', corr.id, `slope:${A}`, `${A}|${B}`),
    ],
  })
  const store = new DocumentStore(createProject())
  for (const node of [table, other, fit, anova, corr, transform, downstream])
    store.dispatch({ type: 'node.add', node })
  for (const node of [graph, ofResult, elsewhere]) store.dispatch({ type: 'node.add', node })
  const node = <T>(id: NodeId) => store.getState().nodes[id] as T
  return {
    store,
    A,
    B,
    C,
    table,
    ids: { fit, anova, corr, transform, downstream, graph, ofResult, elsewhere },
    node,
  }
}

/** Every node but the table, as JSON (what may name its data sets). */
const others = (doc: Project, table: NodeId) =>
  JSON.stringify(Object.values(doc.nodes).filter((n) => n.id !== table))

describe('Swap X and Y (audit 2, M3)', () => {
  it('renames the data set everywhere it is named, downstream too, as one undo step', () => {
    const f = fixture()
    const before = f.store.getState()
    const id = newColumnId()
    f.store.dispatch({ type: 'table.swapXY', table: f.table.id, dataSet: f.A, id })
    const doc = f.store.getState()
    expect(JSON.stringify(doc)).not.toContain(f.A)
    const g = f.node<GraphNode>(f.ids.graph.id)
    expect(g.seriesSource.include).toEqual([id, f.B, f.C])
    expect(Object.keys(g.seriesOverrides)).toEqual([id, f.B])
    expect(g.layers[0]!.series).toEqual({ [id]: { hide: true }, [f.B]: {} })
    expect(g.layers[1]!.data).toMatchObject({
      series: [{ ref: { key: `curve:${id}` }, colorOf: id }, { ref: { key: `curve:${f.B}` } }],
    })
    expect(g.layers[2]!.aes).toEqual({ x: id, y: f.B, color: f.C })
    expect(g.layers[3]!.stat).toMatchObject({
      fields: {
        v: { ref: { key: `slope:${id}` } },
        p: { ref: { key: `${id}|${f.B}` } },
      },
    })
    expect(g.annotations).toMatchObject([
      { a: id, b: f.C, group: [f.B], label: { comparison: `${id}|${f.C}` } },
      { a: id, b: f.B, label: { comparison: `${id}|${f.B}` } },
    ])
    // Downstream: the transform's result table, its graph and the analysis of it.
    expect(f.node<AnalysisNode>(f.ids.transform.id).input.dataSets).toEqual([id, f.B])
    expect(f.node<AnalysisNode>(f.ids.downstream.id).input.dataSets).toEqual([id, f.B])
    expect(f.node<AnalysisNode>(f.ids.downstream.id).params).toEqual({ cols: [id, f.B] })
    expect(f.node<GraphNode>(f.ids.ofResult.id).seriesSource.include).toEqual([id, f.B])
    expect(f.node<AnalysisNode>(f.ids.corr.id).params).toEqual({
      x: id,
      cols: [id, f.B],
      k: { [f.B]: 1, [id]: 2 },
    })
    // A graph of another table drawing the fit's curve and the correlation's results.
    const e = f.node<GraphNode>(f.ids.elsewhere.id)
    expect(e.layers[1]!.data).toMatchObject({ series: [{ ref: { key: `curve:${id}` } }] })
    expect(e.layers[2]!.stat).toMatchObject({ fields: { v: { ref: { key: `slope:${id}` } } } })
    // What nothing renamed is left as it was (shared).
    const params = (n: Project, id: NodeId) => (n.nodes[id] as AnalysisNode).params
    expect(params(doc, f.ids.anova.id)).toBe(params(before, f.ids.anova.id))
    f.store.undo()
    expect(f.store.getState()).toEqual(before)
  })
})

describe('Deleting columns (audit 2, M15)', () => {
  it('drops them wherever they are named, downstream too; undo brings everything back', () => {
    const f = fixture()
    const before = f.store.getState()
    f.store.dispatch({ type: 'table.removeDataSets', table: f.table.id, ids: [f.B] })
    const doc = f.store.getState()
    // Nothing names B but a result field reading a comparison with it, which reads "—" (as any
    // value gone from an analysis' results).
    expect(others(doc, f.table.id).split(`"${f.A}|${f.B}"`).join('')).not.toContain(f.B)
    const g = f.node<GraphNode>(f.ids.graph.id)
    expect(g.seriesSource.include).toEqual([f.A, f.C])
    expect(Object.keys(g.seriesOverrides)).toEqual([f.A])
    expect(g.pointOverrides).toEqual({})
    expect(g.layers[0]!.series).toEqual({ [f.A]: { hide: true } })
    // The fit's curve of B goes (with its series); A's stays.
    expect(g.layers[1]!.data).toMatchObject({ series: [{ id: 'c1' }] })
    expect(g.layers[2]!.aes).toEqual({ x: f.A, color: f.C })
    expect(g.legend.hidden).toEqual(['c1'])
    // The bracket against B goes; the one pooling B with A keeps its other ends.
    expect(g.annotations).toHaveLength(1)
    expect(g.annotations[0]).toMatchObject({ id: 'n1', a: f.A, b: f.C })
    expect(g.annotations[0]).not.toHaveProperty('group')
    expect(f.node<AnalysisNode>(f.ids.corr.id).input.dataSets).toEqual([f.A])
    expect(f.node<AnalysisNode>(f.ids.corr.id).params).toEqual({
      x: f.A,
      cols: [f.A],
      k: { [f.A]: 2 },
    })
    expect(f.node<AnalysisNode>(f.ids.anova.id).input.dataSets).toEqual([f.A, f.C])
    expect(f.node<AnalysisNode>(f.ids.downstream.id).input.dataSets).toEqual([f.A])
    expect(f.node<GraphNode>(f.ids.ofResult.id).seriesSource.include).toEqual([f.A])
    f.store.undo()
    expect(f.store.getState()).toEqual(before)
  })

  it('drops a mapping, levels, a filter and a split set naming them', () => {
    const table = createTable({ tableKind: 'multipleVariables', rows: 3, columns: 3 })
    const [x, y, kind] = table.dataSets.map((d) => d.id) as [ColumnId, ColumnId, ColumnId]
    table.dataSets[2]!.text = ['a', 'b', 'a']
    table.dataSets[2]!.subcolumns[0]!.values = [null, null, null]
    const pools = analysis(table.id, [x, y], {})
    pools.input.pools = [[x, y, kind]]
    const graph = testGraph(table.id, {
      ...XY,
      seriesSource: { table: table.id, include: 'all', filter: { variable: kind, level: 'lv_61' } },
      mapping: { x, y, color: kind },
      levels: { [kind]: ['a', 'b'] },
      split: { set: 's1', by: 'level', variable: kind },
    } as Partial<GraphNode>)
    const store = new DocumentStore(createProject())
    for (const node of [table, pools, graph]) store.dispatch({ type: 'node.add', node })
    const before = store.getState()
    store.dispatch({ type: 'table.removeDataSets', table: table.id, ids: [kind] })
    const g = store.getState().nodes[graph.id] as GraphNode
    expect(g.mapping).toEqual({ x, y })
    expect(g.levels).toEqual({})
    expect(g.seriesSource).not.toHaveProperty('filter')
    expect(g).not.toHaveProperty('split')
    expect((store.getState().nodes[pools.id] as AnalysisNode).input.pools).toEqual([[x, y]])
    store.dispatch({ type: 'table.removeDataSets', table: table.id, ids: [y] })
    const h = store.getState().nodes[graph.id] as GraphNode
    // Without its Y variable the graph shows the table's variables.
    expect(h).not.toHaveProperty('mapping')
    expect(store.getState().nodes[pools.id] as AnalysisNode).not.toHaveProperty('input.pools')
    store.undo()
    store.undo()
    expect(store.getState()).toEqual(before)
  })
})

describe('Row edits and result labels (audit 2, M4)', () => {
  /** A grouped table, an analysis of it, result labels reading its comparisons on two graphs. */
  function grouped(yFormat?: YFormat, tableKind: 'grouped' | 'column' = 'grouped') {
    const table = createTable({ tableKind, rows: 4, columns: 2, ...(yFormat ? { yFormat } : {}) })
    const [A, B] = table.dataSets.map((d) => d.id) as [ColumnId, ColumnId]
    const anova = analysis(table.id, [A, B], {}, 'twoWayAnova')
    const keys = [`row1:${A}|${B}`, `col${A}:0|2`, `cell1:${A}|3:${B}`, `row3:${A}|${B}`]
    const labels = (id: string) =>
      ({
        id,
        geom: 'label',
        stat: {
          kind: 'result',
          fields: Object.fromEntries(
            keys.map((key, i) => [`f${i}`, { ref: { from: 'comparison', key } }]),
          ),
          template: '{f0}',
        },
        data: { from: 'analysis', analysis: anova.id },
      }) as Layer
    const graph = testGraph(table.id, {
      ...(tableKind === 'grouped' ? GROUPED : {}),
      layers: [POINTS, labels('result')],
    })
    const other = createTable({ rows: 2, columns: 1 })
    const elsewhere = testGraph(other.id, { layers: [POINTS, labels('result')] })
    const store = new DocumentStore(createProject())
    for (const node of [table, other, anova, graph, elsewhere])
      store.dispatch({ type: 'node.add', node })
    const fields = (id: NodeId) => {
      const l = (store.getState().nodes[id] as GraphNode).layers[1]!
      return Object.fromEntries(
        Object.entries((l.stat as { fields: Record<string, { ref: { key: string } }> }).fields).map(
          ([k, f]) => [k, f.ref.key],
        ),
      )
    }
    return { store, table, A, B, graph, elsewhere, fields }
  }

  it('follow inserted rows, on graphs of the table and of others', () => {
    const f = grouped()
    f.store.dispatch({ type: 'table.insertRows', table: f.table.id, at: 1, count: 2 })
    const want = {
      f0: `row3:${f.A}|${f.B}`,
      f1: `col${f.A}:0|4`,
      f2: `cell3:${f.A}|5:${f.B}`,
      f3: `row5:${f.A}|${f.B}`,
    }
    expect(f.fields(f.graph.id)).toEqual(want)
    expect(f.fields(f.elsewhere.id)).toEqual(want)
  })

  it('follow deleted rows; a deleted row’s comparison is no longer read', () => {
    const f = grouped()
    const before = f.store.getState()
    f.store.dispatch({ type: 'table.deleteRows', table: f.table.id, rows: [0, 2] })
    const want = {
      f0: `row0:${f.A}|${f.B}`,
      f2: `cell0:${f.A}|1:${f.B}`,
      f3: `row1:${f.A}|${f.B}`,
    }
    expect(f.fields(f.graph.id)).toEqual(want)
    expect(f.fields(f.elsewhere.id)).toEqual(want)
    f.store.undo()
    expect(f.store.getState()).toEqual(before)
  })

  it('follow reordered rows', () => {
    const f = grouped()
    f.store.dispatch({ type: 'table.permuteRows', table: f.table.id, order: [3, 2, 1, 0] })
    expect(f.fields(f.graph.id)).toEqual({
      f0: `row2:${f.A}|${f.B}`,
      f1: `col${f.A}:3|1`,
      f2: `cell2:${f.A}|0:${f.B}`,
      f3: `row0:${f.A}|${f.B}`,
    })
  })

  it('follow a format that keeps fewer rows', () => {
    const f = grouped(undefined, 'column')
    const t = f.store.getState().nodes[f.table.id] as DataTable
    expect(t.rowCount).toBe(4)
    f.store.dispatch({
      type: 'table.setYFormat',
      table: f.table.id,
      format: { type: 'summary', preset: 'meanSd' },
    })
    expect((f.store.getState().nodes[f.table.id] as DataTable).rowCount).toBe(1)
    // Every key named a row past the one left.
    expect(f.fields(f.graph.id)).toEqual({})
  })
})
