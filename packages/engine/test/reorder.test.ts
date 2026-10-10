import {
  type AnalysisNode,
  type Annotation,
  type ColumnId,
  createProject,
  createTable,
  type DataSetKey,
  type DataTable,
  DocNode,
  type GraphNode,
  type NodeId,
  newAnnotationId,
  newNodeId,
  remapRowParams,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { CommandError, DocumentStore } from '../src/index.ts'
import { POINTS } from './graphs.ts'

// Table editing (roadmap 29): reordering rows and data sets, column display and widths.

function graphOf(table: NodeId, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    kind: 'graph',
    id: newNodeId(),
    name: 'g',
    frame: 'grouped',
    look: 'grouped.scatter',
    layers: [POINTS],
    seriesSource: { table, include: 'all' },
    seriesOverrides: {},
    size: { plotWidth: 100, plotHeight: 100 },
    axes: {
      x: { type: 'categorical', title: null, labels: 'dataSetTitles', rotation: 0 },
      y: {
        type: 'continuous',
        title: null,
        scale: 'linear',
        range: 'auto',
        ticks: 'auto',
        format: { mode: 'auto' },
        frame: 'plain',
        breaks: [],
      },
    },
    annotations: [],
    legend: { show: false, position: 'right' },
    title: null,
    style: {},
    ...extra,
  }
}

function analysisOf(table: NodeId, analysisId: string, params: unknown): AnalysisNode {
  return {
    kind: 'analysis',
    id: newNodeId(),
    name: analysisId,
    analysisId,
    pluginVersion: 1,
    input: { source: table, dataSets: [] },
    params,
  }
}

type Bracket = Extract<Annotation, { type: 'bracket' }>

/** A grouped table of 5 rows (values 0…4 in the first data set) with everything that names rows. */
function linked() {
  const table = createTable({ tableKind: 'grouped', rows: 5, columns: 2 })
  const [c0, c1] = table.dataSets.map((d) => d.id) as [ColumnId, ColumnId]
  table.dataSets[0]!.subcolumns[0]!.values = [0, 1, 2, 3, 4]
  table.dataSets[0]!.subcolumns[0]!.excluded = [false, true, false, false, false]
  table.rowTitles = ['A', 'B', 'C', 'D', 'E']
  table.rowTitlesRich = [null, null, [{ text: 'C', bold: true }], null, null]
  const ds = c0 as unknown as DataSetKey
  const contingency = analysisOf(table.id, 'contingency', { pairwiseControl: '1' })
  const gof = analysisOf(table.id, 'goodnessOfFit', { expected: [10, 20, 30, 40] })
  const other = createTable({ tableKind: 'grouped', rows: 5, columns: 1 })
  const foreign = analysisOf(other.id, 'contingency', { pairwiseControl: '1' })
  const anova = analysisOf(table.id, 'twoWayAnova', {})
  const bracket = (rowA: number, rowB: number, comparison: string): Bracket => ({
    type: 'bracket',
    id: newAnnotationId(),
    a: c0 as never,
    b: c1 as never,
    rowA,
    rowB,
    label: { source: 'analysis', analysis: anova.id, comparison, show: 'stars' },
    level: 'auto',
  })
  const graph = graphOf(table.id, {
    seriesSource: { table: table.id, include: 'all', rows: [1, 3] },
    seriesOverrides: { [ds]: { pointLabels: { source: 'rowTitle', which: 'rows', rows: [0, 4] } } },
    pointOverrides: { [ds]: { r1: { size: 9 }, r4s0: { hide: true } } },
    annotations: [
      bracket(1, 1, `row1:${c0}|${c1}`),
      bracket(0, 3, `col${c0}:0|3`),
      bracket(2, 4, `cell2:${c0}|4:${c1}`),
    ],
  })
  const store = new DocumentStore(createProject('T', new Date('2026-01-01T00:00:00Z')))
  store.dispatch(
    [table, other, contingency, gof, foreign, anova, graph].map((node) => ({
      type: 'node.add' as const,
      node,
    })),
  )
  const t = () => store.getState().nodes[table.id] as DataTable
  const g = () => store.getState().nodes[graph.id] as GraphNode
  const params = (a: AnalysisNode) => (store.getState().nodes[a.id] as AnalysisNode).params
  const view = () => ({
    values: t().dataSets[0]!.subcolumns[0]!.values,
    excluded: t().dataSets[0]!.subcolumns[0]!.excluded,
    titles: t().rowTitles,
    rich: t().rowTitlesRich?.map((r) => r?.[0]?.text ?? null),
    slice: g().seriesSource.rows,
    labels: g().seriesOverrides[ds]!.pointLabels!.rows,
    points: Object.keys(g().pointOverrides![ds]!),
    brackets: (g().annotations as Bracket[]).map((b) => [
      b.rowA,
      b.rowB,
      b.label.source === 'analysis' ? b.label.comparison : '',
    ]),
    control: (params(contingency) as { pairwiseControl: string }).pairwiseControl,
    expected: (params(gof) as { expected: (number | null)[] }).expected,
    foreign: (params(foreign) as { pairwiseControl: string }).pairwiseControl,
  })
  return { store, table, c0, c1, t, view }
}

describe('table.permuteRows', () => {
  it('moves every per-row array and everything that names rows, in one undo step', () => {
    const { store, table, c0, c1, view } = linked()
    const before = view()
    // Reverse: row i ← row 4 − i.
    store.dispatch({ type: 'table.permuteRows', table: table.id, order: [4, 3, 2, 1, 0] })
    expect(view()).toEqual({
      values: [4, 3, 2, 1, 0],
      excluded: [false, false, false, true, false],
      titles: ['E', 'D', 'C', 'B', 'A'],
      rich: [null, null, 'C', null, null],
      // The slice shows the same rows in the same order: the graph doesn't change.
      slice: [3, 1],
      labels: [4, 0],
      points: ['r3', 'r0s0'],
      brackets: [
        [3, 3, `row3:${c0}|${c1}`],
        [4, 1, `col${c0}:4|1`],
        [2, 0, `cell2:${c0}|0:${c1}`],
      ],
      control: '3',
      // Entries move with their rows; row 0 (was row 4) had none.
      expected: [null, 40, 30, 20, 10],
      foreign: '1',
    })
    expect(store.undoLabel).toBe('Reorder rows')
    store.undo()
    expect(view()).toEqual(before)
    store.redo()
    expect(view().values).toEqual([4, 3, 2, 1, 0])
  })

  it('leaves rows past the reordered ones alone, and does nothing for the same order', () => {
    const { store, table, view } = linked()
    const before = view()
    const state = store.getState()
    store.dispatch({ type: 'table.permuteRows', table: table.id, order: [0, 1, 2] })
    expect(store.getState()).toBe(state)
    store.dispatch({ type: 'table.permuteRows', table: table.id, order: [1, 0] })
    const after = view()
    expect(after.values).toEqual([1, 0, 2, 3, 4])
    expect(after.titles).toEqual(['B', 'A', 'C', 'D', 'E'])
    expect(after.slice).toEqual([0, 3])
    expect(after.control).toBe('0')
    expect(after.expected).toEqual([20, 10, 30, 40])
    expect(after.points).toEqual(['r0', 'r4s0'])
    expect(before.values).toEqual([0, 1, 2, 3, 4])
  })

  it('refuses orders that are not a reordering of the first rows', () => {
    const { store, table } = linked()
    const permute = (order: number[]) => () =>
      store.dispatch({ type: 'table.permuteRows', table: table.id, order })
    expect(permute([0, 0])).toThrow(CommandError)
    expect(permute([1, 2])).toThrow(CommandError)
    expect(permute([0, 1, 2, 3, 4, 5])).toThrow(CommandError)
    expect(permute([0.5, 1])).toThrow(CommandError)
    expect(permute([-1, 0])).toThrow(CommandError)
  })

  it('reorders text variables and keeps the table valid', () => {
    const table = createTable({ tableKind: 'multipleVariables', rows: 3, columns: 2 })
    table.dataSets[1]!.text = ['x', null, 'z']
    const store = new DocumentStore(createProject())
    store.dispatch({ type: 'node.add', node: table })
    store.dispatch({ type: 'table.permuteRows', table: table.id, order: [2, 0, 1] })
    const t = store.getState().nodes[table.id] as DataTable
    expect(t.dataSets[1]!.text).toEqual(['z', 'x', null])
    expect(DocNode.safeParse(t).success).toBe(true)
  })
})

describe('analysis row parameters follow row inserts and deletes', () => {
  it('shifts a control row and per-row values; a deleted control falls back to the first row', () => {
    const { store, table, view } = linked()
    store.dispatch({ type: 'table.insertRows', table: table.id, at: 1, count: 2 })
    expect(view().control).toBe('3')
    expect(view().expected).toEqual([10, null, null, 20, 30, 40])
    store.dispatch({ type: 'table.deleteRows', table: table.id, rows: [3] })
    expect(view().control).toBe('0')
    expect(view().expected).toEqual([10, null, null, 30, 40])
    expect(view().foreign).toBe('1')
    store.undo()
    store.undo()
    expect(view().control).toBe('1')
    expect(view().expected).toEqual([10, 20, 30, 40])
  })

  it('remapRowParams leaves other analyses and unreadable values alone', () => {
    const shift = (r: number) => r + 1
    expect(remapRowParams('ttest', { pairwiseControl: '1' }, shift)).toBeUndefined()
    expect(remapRowParams('contingency', { pairwiseControl: 'x' }, shift)).toBeUndefined()
    expect(remapRowParams('contingency', {}, shift)).toBeUndefined()
    expect(remapRowParams('goodnessOfFit', { expected: [] }, shift)).toBeUndefined()
    const params = { pairwiseControl: '0', other: [1] }
    const next = remapRowParams('contingency', params, shift) as typeof params
    expect(next).toEqual({ pairwiseControl: '1', other: [1] })
    expect(params.pairwiseControl).toBe('0')
  })
})

describe('table.moveDataSets', () => {
  it('moves a block of data sets to a position among the others, undoably', () => {
    const table = createTable({ rows: 2, columns: 4 })
    const ids = table.dataSets.map((d) => d.id)
    const store = new DocumentStore(createProject())
    store.dispatch({ type: 'node.add', node: table })
    const order = () => (store.getState().nodes[table.id] as DataTable).dataSets.map((d) => d.id)
    store.dispatch({ type: 'table.moveDataSets', table: table.id, ids: [ids[0]!, ids[1]!], to: 2 })
    expect(order()).toEqual([ids[2], ids[3], ids[0], ids[1]])
    store.dispatch({ type: 'table.moveDataSets', table: table.id, ids: [ids[1]!], to: 0 })
    expect(order()).toEqual([ids[1], ids[2], ids[3], ids[0]])
    expect(store.undoLabel).toBe('Move columns')
    store.undo()
    store.undo()
    expect(order()).toEqual(ids)
    const before = store.getState()
    store.dispatch({ type: 'table.moveDataSets', table: table.id, ids: [ids[0]!], to: 0 })
    expect(store.getState()).toBe(before)
    expect(() =>
      store.dispatch({
        type: 'table.moveDataSets',
        table: table.id,
        ids: ['nope' as never],
        to: 0,
      }),
    ).toThrow(CommandError)
  })
})

describe('column display and widths', () => {
  it('sets and clears number formats of data sets and X', () => {
    const table = createTable({ tableKind: 'xy', rows: 2, columns: 2 })
    const store = new DocumentStore(createProject())
    store.dispatch({ type: 'node.add', node: table })
    const t = () => store.getState().nodes[table.id] as DataTable
    const [a, b] = table.dataSets.map((d) => d.id) as [never, never]
    store.dispatch({
      type: 'table.setDisplay',
      table: table.id,
      cols: [a, 'x'],
      display: { mode: 'fixed', digits: 2 },
    })
    expect(t().dataSets[0]!.display).toEqual({ mode: 'fixed', digits: 2 })
    expect(t().x!.display).toEqual({ mode: 'fixed', digits: 2 })
    expect(t().dataSets[1]!.display).toBeUndefined()
    store.dispatch({ type: 'table.setDisplay', table: table.id, cols: [a], display: null })
    expect('display' in t().dataSets[0]!).toBe(false)
    expect(() =>
      store.dispatch({
        type: 'table.setDisplay',
        table: table.id,
        cols: [b],
        display: { mode: 'nope' } as never,
      }),
    ).toThrow()
  })

  it('stores widths by column, clamped; removing a data set drops its width', () => {
    const table = createTable({ rows: 2, columns: 2 })
    const store = new DocumentStore(createProject())
    store.dispatch({ type: 'node.add', node: table })
    const t = () => store.getState().nodes[table.id] as DataTable
    const [a, b] = table.dataSets.map((d): string => d.id) as [string, string]
    store.dispatch({
      type: 'table.setColumnWidths',
      table: table.id,
      widths: { [a]: 120.4, rowTitle: 5, [b]: 99999 },
    })
    expect(t().columnWidths).toEqual({ [a]: 120, rowTitle: 24, [b]: 1200 })
    store.dispatch({ type: 'table.removeDataSets', table: table.id, ids: [b as never] })
    expect(t().columnWidths).toEqual({ [a]: 120, rowTitle: 24 })
    store.dispatch({
      type: 'table.setColumnWidths',
      table: table.id,
      widths: { [a]: null, rowTitle: null },
    })
    expect('columnWidths' in t()).toBe(false)
    expect(() =>
      store.dispatch({
        type: 'table.setColumnWidths',
        table: table.id,
        widths: JSON.parse('{"__proto__":5}'),
      }),
    ).toThrow()
  })
})
