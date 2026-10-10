import {
  type AnalysisNode,
  type ColumnId,
  createProject,
  createTable,
  type DataTable,
  type GraphNode,
  type LayoutNode,
  newColumnId,
  newLayoutItemId,
  newNodeId,
  type Project,
} from '@ps/model'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type Command, CommandError, DocumentStore } from '../src/index.ts'
import { POINTS } from './graphs.ts'

function setup(rows = 3, columns = 2) {
  const table = createTable({ rows, columns })
  const store = new DocumentStore(createProject('T', new Date('2026-01-01T00:00:00Z')))
  store.dispatch({ type: 'node.add', node: table })
  const t = () => store.getState().nodes[table.id] as DataTable
  const col = (i: number) => table.dataSets[i]!.id
  return { store, table, t, col }
}

const values = (t: DataTable, i: number) => t.dataSets[i]!.subcolumns[0]!.values

describe('DocumentStore', () => {
  it('edits cells and undoes/redoes them', () => {
    const { store, t, table, col } = setup()
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [
        { col: col(0), sub: 0, row: 0, value: 1.5 },
        { col: col(1), sub: 0, row: 2, value: -3 },
      ],
    })
    expect(values(t(), 0)).toEqual([1.5, null, null])
    expect(values(t(), 1)).toEqual([null, null, -3])
    expect(store.undoLabel).toBe('Edit cells')

    store.undo()
    expect(values(t(), 0)).toEqual([null, null, null])
    store.redo()
    expect(values(t(), 1)).toEqual([null, null, -3])
  })

  it('keeps untouched columns identical (structural sharing)', () => {
    const { store, t, table, col } = setup()
    const before = t().dataSets[1]
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col: col(0), sub: 0, row: 0, value: 1 }],
    })
    expect(t().dataSets[1]).toBe(before)
  })

  it('grows rows when typing below the last row', () => {
    const { store, t, table, col } = setup(2)
    store.dispatch({ type: 'table.showRowTitles', table: table.id, show: true })
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col: col(0), sub: 0, row: 4, value: 7 }],
    })
    expect(t().rowCount).toBe(5)
    expect(values(t(), 0)).toEqual([null, null, null, null, 7])
    expect(values(t(), 1)).toHaveLength(5)
    expect(t().rowTitles).toHaveLength(5)
  })

  it('rejects non-finite values without changing state', () => {
    const { store, t, table, col } = setup()
    const before = store.getState()
    expect(() =>
      store.dispatch({
        type: 'table.setCells',
        table: table.id,
        edits: [{ col: col(0), sub: 0, row: 0, value: Number.NaN }],
      }),
    ).toThrow(CommandError)
    expect(store.getState()).toBe(before)
    expect(values(t(), 0)).toEqual([null, null, null])
  })

  it('splices every parallel array on row insert/delete', () => {
    const { store, t, table, col } = setup(3)
    store.dispatch([
      {
        type: 'table.setCells',
        table: table.id,
        edits: [0, 1, 2].map((row) => ({ col: col(0), sub: 0, row, value: row })),
      },
      {
        type: 'table.setExcluded',
        table: table.id,
        cells: [{ col: col(0), sub: 0, row: 2 }],
        excluded: true,
      },
      { type: 'table.setRowTitle', table: table.id, row: 1, title: 'mid' },
    ])
    store.dispatch({ type: 'table.insertRows', table: table.id, at: 1, count: 2 })
    expect(values(t(), 0)).toEqual([0, null, null, 1, 2])
    expect(t().dataSets[0]!.subcolumns[0]!.excluded).toEqual([false, false, false, false, true])
    expect(t().rowTitles).toEqual([null, null, null, 'mid', null])

    store.dispatch({ type: 'table.deleteRows', table: table.id, rows: [0, 4] })
    expect(values(t(), 0)).toEqual([null, null, 1])
    // The only excluded cell was deleted, so the exclusion array is pruned.
    expect(t().dataSets[0]!.subcolumns[0]!.excluded).toBeUndefined()
    expect(t().rowCount).toBe(3)
    expect(t().rowTitles).toEqual([null, null, 'mid'])
  })

  it('drops all-false exclusion arrays', () => {
    const { store, t, table, col } = setup()
    const cell = { col: col(0), sub: 0, row: 1 }
    store.dispatch({ type: 'table.setExcluded', table: table.id, cells: [cell], excluded: true })
    expect(t().dataSets[0]!.subcolumns[0]!.excluded).toEqual([false, true, false])
    store.dispatch({ type: 'table.setExcluded', table: table.id, cells: [cell], excluded: false })
    expect(t().dataSets[0]!.subcolumns[0]!.excluded).toBeUndefined()
  })

  it('groups a command list into one undo step', () => {
    const { store, t, table } = setup()
    const id = newColumnId()
    store.dispatch(
      [
        { type: 'table.addDataSet', table: table.id, id },
        { type: 'table.renameDataSet', table: table.id, id, title: 'Treated' },
      ],
      'Add treated column',
    )
    expect(t().dataSets.map((d) => d.title)).toEqual(['Group A', 'Group B', 'Treated'])
    expect(store.undoLabel).toBe('Add treated column')
    store.undo()
    expect(t().dataSets).toHaveLength(2)
  })

  it('removing a table removes its dependents', () => {
    const { store, table } = setup()
    const analysis: AnalysisNode = {
      kind: 'analysis',
      id: newNodeId(),
      name: 'a',
      analysisId: 'x',
      pluginVersion: 1,
      input: { source: table.id, dataSets: [] },
      params: {},
    }
    store.dispatch({ type: 'node.add', node: analysis })
    store.dispatch({ type: 'node.remove', id: table.id })
    expect(store.getState().nodes).toEqual({})
    expect(store.getState().order).toEqual([])
    store.undo()
    expect(Object.keys(store.getState().nodes)).toHaveLength(2)
    expect(store.getState().order).toEqual([table.id, analysis.id])
  })

  it('removing a graph takes it off layouts but keeps the layouts', () => {
    const { store, table } = setup()
    const graph: GraphNode = {
      kind: 'graph',
      id: newNodeId(),
      name: 'g',
      frame: 'category',
      look: 'column.scatter',
      layers: [POINTS],
      seriesSource: { table: table.id, include: 'all' },
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
    }
    const layout: LayoutNode = {
      kind: 'layout',
      id: newNodeId(),
      name: 'L',
      page: { width: 612, height: 792 },
      items: [
        { type: 'graph', id: newLayoutItemId(), graph: graph.id, x: 0, y: 0, scale: 1 },
        { type: 'text', id: newLayoutItemId(), x: 0, y: 0, content: { content: [{ text: 'T' }] } },
      ],
      panelLabels: { show: true, style: 'A', size: 14 },
    }
    store.dispatch({ type: 'node.add', node: graph })
    store.dispatch({ type: 'node.add', node: layout })
    store.dispatch({ type: 'node.remove', id: table.id })
    const after = store.getState().nodes[layout.id] as LayoutNode
    expect(Object.keys(store.getState().nodes)).toEqual([layout.id])
    expect(after.items.map((i) => i.type)).toEqual(['text'])
    store.undo()
    expect((store.getState().nodes[layout.id] as LayoutNode).items).toHaveLength(2)
  })

  it('rejects changes that break project integrity', () => {
    const { store } = setup()
    const orphan: AnalysisNode = {
      kind: 'analysis',
      id: newNodeId(),
      name: 'a',
      analysisId: 'x',
      pluginVersion: 1,
      input: { source: newNodeId(), dataSets: [] },
      params: {},
    }
    expect(() => store.dispatch({ type: 'node.add', node: orphan })).toThrow(
      /references missing node/,
    )
  })

  it('node.set writes and deletes nested values, validated by schema', () => {
    const { store, table } = setup()
    store.dispatch({ type: 'node.set', id: table.id, path: ['notes'], value: 'hello' })
    expect((store.getState().nodes[table.id] as DataTable).notes).toBe('hello')
    expect(() =>
      store.dispatch({ type: 'node.set', id: table.id, path: ['rowCount'], value: -1 }),
    ).toThrow(CommandError)
    expect(() =>
      store.dispatch({ type: 'node.set', id: table.id, path: ['id'], value: 'x' }),
    ).toThrow(/cannot set id/)
  })

  it('tracks dirty state', () => {
    const { store, table } = setup()
    store.markSaved()
    expect(store.dirty).toBe(false)
    store.dispatch({ type: 'node.rename', id: table.id, name: 'Renamed' })
    expect(store.dirty).toBe(true)
  })

  it('resets clean, or unsaved (a recovered copy) until saved', () => {
    const { store } = setup()
    const project = store.getState()
    store.reset(project)
    expect(store.dirty).toBe(false)
    store.reset(project, { unsaved: true })
    expect(store.dirty).toBe(true)
    store.markSaved()
    expect(store.dirty).toBe(false)
  })

  it('notifies listeners with touched nodes', () => {
    const { store, table, col } = setup()
    const seen: string[][] = []
    store.subscribe((_, change) => {
      if (change.touched !== 'all') seen.push([...change.touched])
    })
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col: col(0), sub: 0, row: 0, value: 1 }],
    })
    store.undo()
    expect(seen).toEqual([[table.id], [table.id]])
  })
})

describe('undo/redo property', () => {
  // Random edit sequences on a 2-column table; undoing everything must restore the exact
  // original document, and redoing everything must reproduce the final one.
  const cellValue = fc.oneof(fc.constant(null), fc.double({ noNaN: true, noDefaultInfinity: true }))

  const command = (tableId: string, cols: ColumnId[]): fc.Arbitrary<Command> =>
    fc.oneof(
      fc.record({
        type: fc.constant('table.setCells' as const),
        table: fc.constant(tableId as never),
        edits: fc.array(
          fc.record({
            col: fc.constantFrom(...cols),
            sub: fc.constant(0),
            row: fc.nat(12),
            value: cellValue,
          }),
          { minLength: 1, maxLength: 4 },
        ),
      }),
      fc.record({
        type: fc.constant('table.insertRows' as const),
        table: fc.constant(tableId as never),
        at: fc.constant(0),
        count: fc.integer({ min: 1, max: 3 }),
      }),
      fc.record({
        type: fc.constant('table.setExcluded' as const),
        table: fc.constant(tableId as never),
        cells: fc.array(
          fc.record({ col: fc.constantFrom(...cols), sub: fc.constant(0), row: fc.nat(2) }),
          {
            minLength: 1,
            maxLength: 2,
          },
        ),
        excluded: fc.boolean(),
      }),
      fc.record({
        type: fc.constant('table.deleteRows' as const),
        table: fc.constant(tableId as never),
        rows: fc.array(fc.nat(2), { minLength: 1, maxLength: 2 }),
      }),
      fc.record({
        type: fc.constant('table.setRowTitle' as const),
        table: fc.constant(tableId as never),
        row: fc.nat(2),
        title: fc.option(fc.string({ maxLength: 5 })),
      }),
    )

  it('undo all restores the original; redo all restores the final', () => {
    const { store: seed, table } = setup(3, 2)
    const initial: Project = seed.getState()
    const cols = table.dataSets.map((d) => d.id)
    fc.assert(
      fc.property(fc.array(command(table.id, cols), { minLength: 1, maxLength: 25 }), (cmds) => {
        const store = new DocumentStore(initial)
        let applied = 0
        for (const c of cmds) {
          const before = store.getState()
          try {
            store.dispatch(c)
            applied++
          } catch (e) {
            // Out-of-range rows etc. are rejected, leaving the state unchanged.
            if (!(e instanceof CommandError)) throw e
            expect(store.getState()).toBe(before)
          }
        }
        const final = store.getState()
        for (let i = 0; i < applied; i++) store.undo()
        expect(store.getState()).toEqual(initial)
        for (let i = 0; i < applied; i++) store.redo()
        expect(store.getState()).toEqual(final)
      }),
      { numRuns: 300 },
    )
  })
})

describe('stored nodes hold every field (audit 2, M14)', () => {
  const layout = (): LayoutNode => ({
    kind: 'layout',
    id: newNodeId(),
    name: 'L',
    page: { width: 612, height: 792 },
    items: [],
    panelLabels: { show: true, style: 'A', size: 14 },
  })

  it('refuses removing a field the schema would fill with a default', () => {
    const { store } = setup()
    const page = layout()
    store.dispatch({ type: 'node.add', node: page })
    const before = store.getState()
    const unset = (path: string[]) =>
      store.dispatch({ type: 'node.set', id: page.id, path, value: undefined })
    expect(() => unset(['panelLabels'])).toThrow(/panelLabels: required/)
    expect(() => unset(['panelLabels', 'size'])).toThrow(/panelLabels\.size: required/)
    expect(store.getState()).toBe(before)
    // Optional fields still go.
    store.dispatch({ type: 'node.set', id: page.id, path: ['notes'], value: 'n' })
    unset(['notes'])
    expect(store.getState().nodes[page.id]).not.toHaveProperty('notes')
  })

  it('refuses nodes added without them', () => {
    const { store } = setup()
    const { notes: _, ...table } = createTable()
    expect(() => store.dispatch({ type: 'node.add', node: table as DataTable })).toThrow(
      /notes: required/,
    )
    const { panelLabels: __, ...page } = layout()
    expect(() => store.dispatch({ type: 'node.add', node: page as LayoutNode })).toThrow(
      /panelLabels: required/,
    )
  })

  it('refuses analysis parameters that are not plain JSON', () => {
    const { store, table, col } = setup()
    const a: AnalysisNode = {
      kind: 'analysis',
      id: newNodeId(),
      name: 'a',
      analysisId: 'descriptive',
      pluginVersion: 1,
      input: { source: table.id, dataSets: [col(0)] },
      params: {},
    }
    store.dispatch({ type: 'node.add', node: a })
    const set = (params: unknown) =>
      store.dispatch({ type: 'analysis.setParams', id: a.id, params })
    expect(() => set({ alpha: Number.NaN })).toThrow(/params\.alpha: not a finite number/)
    expect(() => set({ list: [1, undefined] })).toThrow(/params\.list\.1: undefined/)
    expect(() => set({ when: new Date(0) })).toThrow(/params\.when: not plain data/)
    expect(() => set({ alpha: Number.POSITIVE_INFINITY })).toThrow(CommandError)
    set({ alpha: 0.05, groups: [['a', 'b']], label: null, on: true })
    expect((store.getState().nodes[a.id] as AnalysisNode).params).toEqual({
      alpha: 0.05,
      groups: [['a', 'b']],
      label: null,
      on: true,
    })
  })
})
