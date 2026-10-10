import {
  type AnalysisNode,
  type Annotation,
  createProject,
  createTable,
  type DataTable,
  DocNode,
  type GraphNode,
  type LayoutNode,
  type NodeId,
  newAnnotationId,
  newLayoutItemId,
  newNodeId,
  newSeriesId,
} from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { CommandError, DocumentStore } from '../src/index.ts'
import { curves, outputsOf, POINTS } from './graphs.ts'

function graphOf(table: NodeId, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    kind: 'graph',
    id: newNodeId(),
    name: 'g',
    frame: 'category',
    look: 'column.scatter',
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

function analysisOf(table: NodeId): AnalysisNode {
  return {
    kind: 'analysis',
    id: newNodeId(),
    name: 'a',
    analysisId: 'twoWayAnova',
    pluginVersion: 1,
    input: { source: table, dataSets: [] },
    params: {},
  }
}

function setup(table: DataTable) {
  const store = new DocumentStore(createProject('T', new Date('2026-01-01T00:00:00Z')))
  store.dispatch({ type: 'node.add', node: table })
  return store
}

type Bracket = Extract<Annotation, { type: 'bracket' }>

describe('row edits move grouped brackets', () => {
  function grouped() {
    const table = createTable({ tableKind: 'grouped', rows: 3, columns: 2 })
    const store = setup(table)
    const [c0, c1] = table.dataSets.map((d) => d.id)
    const analysis = analysisOf(table.id)
    const other = createTable({ tableKind: 'grouped', rows: 3, columns: 2 })
    const otherAnalysis = analysisOf(other.id)
    const label = (comparison: string, a = analysis.id) => ({
      source: 'analysis' as const,
      analysis: a,
      comparison,
      show: 'stars' as const,
    })
    const bracket = (rowA: number, rowB: number, l: Bracket['label'], a = c0!, b = c1!) => ({
      type: 'bracket' as const,
      id: newAnnotationId(),
      a,
      b,
      rowA,
      rowB,
      label: l,
      level: 'auto' as const,
    })
    const withinRow = bracket(1, 1, label(`row1:${c0}|${c1}`))
    const withinCol = bracket(0, 2, label(`col${c0}:0|2`), c0, c0)
    const manual = bracket(2, 2, { source: 'manual', text: '*' })
    // An analysis of another table: its key isn't this table's row index.
    const foreign = bracket(1, 1, label('row1:x|y', otherAnalysis.id))
    // All-cells comparisons (two-way ANOVA) join cells in different rows and columns.
    const cross = bracket(0, 2, label(`cell0:${c0}|2:${c1}`))
    const graph = graphOf(table.id, {
      frame: 'grouped',
      look: 'grouped.bar',
      annotations: [withinRow, withinCol, manual, foreign, cross],
    })
    store.dispatch([
      { type: 'node.add', node: analysis },
      { type: 'node.add', node: other },
      { type: 'node.add', node: otherAnalysis },
      { type: 'node.add', node: graph },
    ])
    const brackets = () => (store.getState().nodes[graph.id] as GraphNode).annotations as Bracket[]
    const view = () =>
      brackets().map((b) => [
        b.rowA,
        b.rowB,
        b.label.source === 'analysis' ? b.label.comparison : b.label.text,
      ])
    return { store, table, c0, c1, brackets, view }
  }

  it('shifts rows and comparison keys on insert, in one undo step', () => {
    const { store, table, c0, c1, view } = grouped()
    const before = view()
    store.dispatch({ type: 'table.insertRows', table: table.id, at: 1, count: 2 })
    expect(view()).toEqual([
      [3, 3, `row3:${c0}|${c1}`],
      [0, 4, `col${c0}:0|4`],
      [4, 4, '*'],
      [3, 3, 'row1:x|y'],
      [0, 4, `cell0:${c0}|4:${c1}`],
    ])
    store.undo()
    expect(view()).toEqual(before)
  })

  it('shifts rows on delete and drops brackets on deleted rows', () => {
    const { store, table, c0, c1, view } = grouped()
    const before = view()
    store.dispatch({ type: 'table.deleteRows', table: table.id, rows: [0] })
    expect(view()).toEqual([
      [0, 0, `row0:${c0}|${c1}`],
      [1, 1, '*'],
      [0, 0, 'row1:x|y'],
    ])
    store.undo()
    expect(view()).toEqual(before)
    store.dispatch({ type: 'table.deleteRows', table: table.id, rows: [1, 2] })
    expect(view()).toEqual([])
  })

  it('leaves whole-data-set brackets alone', () => {
    const table = createTable({ rows: 3, columns: 2 })
    const store = setup(table)
    const graph = graphOf(table.id, {
      annotations: [
        {
          type: 'bracket',
          id: newAnnotationId(),
          a: table.dataSets[0]!.id,
          b: table.dataSets[1]!.id,
          label: { source: 'manual', text: 'ns' },
          level: 'auto',
        },
      ],
    })
    store.dispatch({ type: 'node.add', node: graph })
    const before = store.getState().nodes[graph.id]
    store.dispatch({ type: 'table.deleteRows', table: table.id, rows: [0] })
    expect(store.getState().nodes[graph.id]).toBe(before)
  })
})

describe('removing an analysis', () => {
  it('strips its curves and brackets from other graphs and removes its own output graph', () => {
    const table = createTable({ tableKind: 'xy', rows: 3, columns: 2 })
    const store = setup(table)
    const analysis: AnalysisNode = { ...analysisOf(table.id), analysisId: 'nonlinearFit' }
    const keep = analysisOf(table.id)
    const [c0, c1] = table.dataSets.map((d) => d.id)
    const curve = { id: newSeriesId(), ref: { node: analysis.id, key: `curve:${c0}` } }
    const otherCurve = { id: newSeriesId(), ref: { node: keep.id, key: `curve:${c1}` } }
    const textNote: Annotation = {
      type: 'text',
      id: newAnnotationId(),
      anchor: { space: 'plot', x: 0, y: 0 },
      content: { content: [{ text: 'note' }] },
    }
    const liveBracket: Annotation = {
      type: 'bracket',
      id: newAnnotationId(),
      a: c0!,
      b: c1!,
      label: { source: 'analysis', analysis: analysis.id, comparison: 'x', show: 'stars' },
      level: 'auto',
    }
    const dataGraph = graphOf(table.id, {
      frame: 'xy',
      look: 'xy.scatter',
      layers: [POINTS, curves([curve, otherCurve])],
      // The removed analysis' curve has a style of its own there: it goes with the curve.
      seriesOverrides: { [curve.id]: { color: { palette: 3 } } },
      annotations: [liveBracket, textNote],
      legend: { show: true, position: 'right', hidden: [curve.id, c1!] },
    })
    const outputGraph = graphOf(table.id, {
      frame: 'xy',
      look: 'xy.scatter',
      layers: [curves([{ id: newSeriesId(), ref: { node: analysis.id, key: 'residuals' } }])],
      seriesSource: { table: table.id, include: [] },
    })
    const layout: LayoutNode = {
      kind: 'layout',
      id: newNodeId(),
      name: 'L',
      page: { width: 612, height: 792 },
      items: [dataGraph.id, outputGraph.id].map((graph) => ({
        type: 'graph' as const,
        id: newLayoutItemId(),
        graph,
        x: 0,
        y: 0,
        scale: 1,
      })),
      panelLabels: { show: true, style: 'A', size: 14 },
    }
    store.dispatch([
      { type: 'node.add', node: analysis },
      { type: 'node.add', node: keep },
      { type: 'node.add', node: dataGraph },
      { type: 'node.add', node: outputGraph },
      { type: 'node.add', node: layout },
    ])
    const before = store.getState()

    store.dispatch({ type: 'node.remove', id: analysis.id })
    const s = store.getState()
    expect(Object.keys(s.nodes).sort()).toEqual([table.id, keep.id, dataGraph.id, layout.id].sort())
    const g = s.nodes[dataGraph.id] as GraphNode
    expect(outputsOf(g)).toEqual([otherCurve])
    expect(g.seriesOverrides).toEqual({})
    expect(g.annotations).toEqual([textNote])
    expect(g.legend.hidden).toEqual([c1])
    expect(
      (s.nodes[layout.id] as LayoutNode).items.map((i) => i.type === 'graph' && i.graph),
    ).toEqual([dataGraph.id])

    store.undo()
    expect(store.getState()).toEqual(before)
  })

  it('removing the table still removes every graph of it', () => {
    const table = createTable({ rows: 3, columns: 2 })
    const store = setup(table)
    const analysis = analysisOf(table.id)
    store.dispatch([
      { type: 'node.add', node: analysis },
      { type: 'node.add', node: graphOf(table.id) },
    ])
    store.dispatch({ type: 'node.remove', id: table.id })
    expect(store.getState().nodes).toEqual({})
  })
})

describe('command input hardening', () => {
  it('node.set refuses prototype paths', () => {
    const table = createTable({ rows: 3, columns: 2 })
    const store = setup(table)
    const graph = graphOf(table.id)
    store.dispatch({ type: 'node.add', node: graph })
    for (const path of [
      ['seriesOverrides', '__proto__', 'color'],
      ['constructor', 'prototype', 'color'],
      ['style', 'prototype'],
    ]) {
      expect(() =>
        store.dispatch({ type: 'node.set', id: graph.id, path, value: { palette: 3 } }),
      ).toThrow(CommandError)
    }
    expect(({} as Record<string, unknown>).color).toBeUndefined()
    // Inherited members are not walked into: `toString` is not an own key of the overrides.
    expect(() =>
      store.dispatch({
        type: 'node.set',
        id: graph.id,
        path: ['seriesOverrides', 'toString', 'color'],
        value: { palette: 3 },
      }),
    ).not.toThrow()
    const overrides = (store.getState().nodes[graph.id] as GraphNode).seriesOverrides
    expect(Object.hasOwn(overrides, 'toString')).toBe(true)
  })

  it('node lookups ignore Object.prototype members', () => {
    const store = setup(createTable({ rows: 1, columns: 1 }))
    expect(() =>
      store.dispatch({ type: 'node.rename', id: 'constructor' as NodeId, name: 'x' }),
    ).toThrow(/no node constructor/)
    expect(() =>
      store.dispatch({
        type: 'node.add',
        node: { ...createTable({ rows: 1, columns: 1 }), id: '__proto__' as NodeId },
      }),
    ).toThrow(CommandError)
  })

  it('rejects fractional and negative rows', () => {
    const table = createTable({ rows: 3, columns: 2 })
    const store = setup(table)
    const col = table.dataSets[0]!.id
    const before = store.getState()
    expect(() =>
      store.dispatch({
        type: 'table.setCells',
        table: table.id,
        edits: [{ col, sub: 0, row: 1.5, value: 7 }],
      }),
    ).toThrow(CommandError)
    expect(() =>
      store.dispatch({
        type: 'table.setExcluded',
        table: table.id,
        cells: [{ col, sub: 0.5, row: 1 }],
        excluded: true,
      }),
    ).toThrow(CommandError)
    expect(() =>
      store.dispatch({ type: 'table.insertRows', table: table.id, at: 0.5, count: 1 }),
    ).toThrow(CommandError)
    expect(() => store.dispatch({ type: 'table.deleteRows', table: table.id, rows: [-1] })).toThrow(
      CommandError,
    )
    expect(store.getState()).toBe(before)
  })

  it('validates project settings', () => {
    const store = setup(createTable({ rows: 1, columns: 1 }))
    const before = store.getState()
    expect(() =>
      store.dispatch({ type: 'project.setSettings', settings: { pValueDigits: 0 } }),
    ).toThrow(/pValueDigits/)
    expect(() =>
      store.dispatch({
        type: 'project.setSettings',
        settings: { pValueStyle: 'XX' as never },
      }),
    ).toThrow(CommandError)
    expect(() =>
      store.dispatch({
        type: 'project.setSettings',
        settings: JSON.parse('{"__proto__": {"x": 1}}'),
      }),
    ).toThrow(/unknown setting/)
    expect(store.getState()).toBe(before)
    store.dispatch({ type: 'project.setSettings', settings: { pValueStyle: 'APA' } })
    expect(store.getState().settings.pValueStyle).toBe('APA')
  })
})

describe('cell edit performance', () => {
  it('a single-cell edit does not re-validate every cell; structural commands do', () => {
    // A full schema parse of a 100k × 20 table takes tens of ms per edit, so cell commands check
    // only the table's (cheap) shape invariants. Tested by mechanism rather than by the clock.
    const table = createTable({ rows: 1_000, columns: 20 })
    for (const ds of table.dataSets)
      ds.subcolumns[0]!.values = ds.subcolumns[0]!.values.map((_, i) => i)
    const store = setup(table)
    const col = table.dataSets[0]!.id
    const parse = vi.spyOn(DocNode, 'safeParse')
    try {
      for (let i = 0; i < 20; i++) {
        store.dispatch({
          type: 'table.setCells',
          table: table.id,
          edits: [{ col, sub: 0, row: i, value: -1 }],
        })
      }
      expect(parse).not.toHaveBeenCalled()
      const edited = (store.getState().nodes[table.id] as DataTable).dataSets[0]!.subcolumns[0]!
      expect(edited.values.slice(18, 21)).toEqual([-1, -1, 20])
      // Structural commands still get the full parse.
      expect(() =>
        store.dispatch({
          type: 'node.set',
          id: table.id,
          path: ['dataSets', 0, 'title'],
          value: 3,
        }),
      ).toThrow(CommandError)
      expect(parse).toHaveBeenCalled()
    } finally {
      parse.mockRestore()
    }
  })
})

describe('graph row slices follow row edits', () => {
  it('shifts slice rows on insert and drops deleted rows, undoably', () => {
    const table = createTable({ tableKind: 'grouped', columns: 2, rows: 4 })
    const graph = graphOf(table.id, {
      seriesSource: { table: table.id, include: 'all', rows: [3, 1] },
    })
    const project = createProject()
    const store = new DocumentStore(project)
    store.dispatch([
      { type: 'node.add', node: table },
      { type: 'node.add', node: graph },
    ])
    const rows = () => (store.getState().nodes[graph.id] as GraphNode).seriesSource.rows
    store.dispatch({ type: 'table.insertRows', table: table.id, at: 2, count: 1 })
    expect(rows()).toEqual([4, 1])
    store.dispatch({ type: 'table.deleteRows', table: table.id, rows: [1] })
    expect(rows()).toEqual([3])
    store.undo()
    store.undo()
    expect(rows()).toEqual([3, 1])
  })
})

describe('nested tables: subjects', () => {
  function nested() {
    const table = createTable({
      tableKind: 'nested',
      yFormat: { type: 'replicates', count: 2 },
      columns: 2,
      rows: 3,
    })
    const store = new DocumentStore(createProject())
    store.dispatch({ type: 'node.add', node: table })
    const t = () => store.getState().nodes[table.id] as DataTable
    return { store, table, t, a: table.dataSets[0]!.id }
  }

  it('names subjects, keeping the document minimal', () => {
    const { store, table, t, a } = nested()
    const name = (sub: number, title: string | null) =>
      store.dispatch({ type: 'table.setSubcolumnTitle', table: table.id, id: a, sub, title })
    name(1, 'M2')
    expect(t().dataSets[0]!.subcolumnTitles).toEqual([null, 'M2'])
    name(1, null)
    expect(t().dataSets[0]!.subcolumnTitles).toBeUndefined()
    expect(() => name(2, 'x')).toThrow(CommandError)
  })

  it('adds and removes subjects in every group, undoably', () => {
    const { store, table, t, a } = nested()
    store.dispatch([
      { type: 'table.setCells', table: table.id, edits: [{ col: a, sub: 1, row: 0, value: 4 }] },
      { type: 'table.setSubcolumnTitle', table: table.id, id: a, sub: 1, title: 'M2' },
    ])
    store.dispatch({ type: 'table.setReplicateCount', table: table.id, count: 3 })
    expect(t().yFormat).toEqual({ type: 'replicates', count: 3 })
    expect(t().dataSets.map((d) => d.subcolumns.length)).toEqual([3, 3])
    expect(t().dataSets[1]!.subcolumns[2]!.values).toEqual([null, null, null])

    store.dispatch({ type: 'table.setReplicateCount', table: table.id, count: 1 })
    expect(t().dataSets.map((d) => d.subcolumns.length)).toEqual([1, 1])
    expect(t().dataSets[0]!.subcolumnTitles).toBeUndefined()
    store.undo()
    expect(t().dataSets[0]!.subcolumns[1]!.values[0]).toBe(4)
    expect(t().dataSets[0]!.subcolumnTitles).toEqual([null, 'M2'])
  })

  it('refuses subcolumn counts that make no sense', () => {
    const { store, table } = nested()
    const set = (id: NodeId, count: number) =>
      store.dispatch({ type: 'table.setReplicateCount', table: id, count })
    expect(() => set(table.id, 0)).toThrow(CommandError)
    expect(() => set(table.id, 1.5)).toThrow(CommandError)
    const summary = createTable({ yFormat: { type: 'summary', preset: 'meanSdN' } })
    const column = createTable()
    store.dispatch([
      { type: 'node.add', node: summary },
      { type: 'node.add', node: column },
    ])
    expect(() => set(summary.id, 2)).toThrow(CommandError)
    // Column tables stack replicates down the rows: the store refuses a second subcolumn.
    expect(() => set(column.id, 2)).toThrow(CommandError)
  })
})
