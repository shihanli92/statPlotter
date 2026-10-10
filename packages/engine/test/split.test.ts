import {
  type ColumnId,
  createInfoSheet,
  createProject,
  createTable,
  type DataTable,
  type FolderId,
  folderOf,
  type GraphNode,
  type LayoutNode,
  levelKey,
  memberSlice,
  type NodeId,
  newLayoutItemId,
  newNodeId,
  type Project,
  placeOnGrid,
  type SetGrid,
  setMembers,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { DocumentStore, duplicateNode, type Remap, remapNode } from '../src/index.ts'
import { GROUPED, testGraph, XY } from './graphs.ts'

// Roadmap 34d: sets of split graphs follow their table — a new level, data set or row gets a
// graph like the others, on the set's page in its place, in the same undo step as the edit.

const SET = 'set1'
const GRID: SetGrid = { set: SET, columns: 2, x: 36, y: 36, dx: 200, dy: 150 }

/** A multiple-variables table: `g` Group (text: A, B, A, B) and `s` Score. */
function variables(): DataTable {
  const t = createTable({ tableKind: 'multipleVariables', rows: 4, columns: 2 })
  t.dataSets[0]!.id = 'g' as ColumnId
  t.dataSets[0]!.title = 'Group'
  t.dataSets[0]!.text = ['A', 'B', 'A', 'B']
  t.dataSets[0]!.subcolumns[0]!.values = [null, null, null, null]
  t.dataSets[1]!.id = 's' as ColumnId
  t.dataSets[1]!.title = 'Score'
  t.dataSets[1]!.subcolumns[0]!.values = [1, 2, 3, 4]
  return t
}

/** A member of the level split by Group. */
const member = (table: NodeId, level: string, legend = false): GraphNode =>
  testGraph(table, {
    name: `Data – ${level}`,
    seriesSource: { table, include: 'all', filter: { variable: 'g', level: levelKey(level) } },
    split: { set: SET, by: 'level', variable: 'g' },
    title: { content: [{ text: level }], style: { size: 13 } },
    legend: { show: legend, position: 'right' },
    links: { y: 'ly' },
  })

/** A page with the set's graphs in its grid cells, each 5 pt right and 3 down in its cell. */
function page(graphs: readonly GraphNode[]): LayoutNode {
  return {
    kind: 'layout',
    id: newNodeId(),
    name: 'Page',
    page: { width: 612, height: 400 },
    items: graphs.map((g, i) => ({
      type: 'graph' as const,
      id: newLayoutItemId(),
      graph: g.id,
      x: GRID.x + (i % 2) * GRID.dx + 5,
      y: GRID.y + Math.floor(i / 2) * GRID.dy + 3,
      scale: 0.8,
    })),
    panelLabels: { show: true, style: 'A', size: 14 },
    grids: [GRID],
  }
}

function setup(
  table = variables(),
  graphs = (id: NodeId) => [member(id, 'A'), member(id, 'B', true)],
) {
  const members = graphs(table.id)
  const layout = page(members)
  const project: Project = createProject()
  const store = new DocumentStore(project)
  store.dispatch([
    { type: 'node.add', node: table },
    ...members.map((node) => ({ type: 'node.add' as const, node })),
    { type: 'node.add', node: layout },
  ])
  const doc = () => store.getState()
  const set = () => setMembers(doc(), SET)
  const items = () => (doc().nodes[layout.id] as LayoutNode).items
  return { store, table, layout, doc, set, items }
}

const text = (table: NodeId, row: number, value: string | null, col = 'g' as ColumnId) => ({
  type: 'table.setText' as const,
  table,
  edits: [{ col, row, value }],
})

describe('a new level gets its graph', () => {
  it('formatted like the others, after them, placed in the next cell, in one undo step', () => {
    const { store, table, layout, doc, set, items } = setup()
    store.dispatch(text(table.id, 4, 'C'))
    const [a, b, c] = set()
    expect(set()).toHaveLength(3)
    expect(memberSlice(c!)).toBe(levelKey('C'))
    expect(c!.title).toEqual({ content: [{ text: 'C' }], style: { size: 13 } })
    expect(c!.name).toBe(`${table.name} – C`)
    expect(c!.links).toEqual(a!.links)
    expect(c!.split).toEqual(a!.split)
    // The legend stays on the graph that showed it.
    expect([a, b, c].map((g) => g!.legend.show)).toEqual([false, true, false])
    // Just after the set's graphs in the navigator.
    expect(doc().order.indexOf(c!.id)).toBe(doc().order.indexOf(b!.id) + 1)
    // The third cell (row 2, column 1), where the others sit in theirs, at their scale.
    const item = items().find((it) => it.type === 'graph' && it.graph === c!.id)
    expect(item).toMatchObject({ x: 41, y: 189, scale: 0.8 })
    expect(items().map((it) => (it.type === 'graph' ? it.graph : null))).toEqual(
      [a, b, c].map((g) => g!.id),
    )
    // One step: undo takes the edit and the graph away; redo brings both back.
    expect(store.undoLabel).toBe('Edit cells')
    store.undo()
    expect(set()).toHaveLength(2)
    expect((doc().nodes[table.id] as DataTable).rowCount).toBe(4)
    expect(items()).toHaveLength(2)
    expect((doc().nodes[layout.id] as LayoutNode).page.height).toBe(400)
    store.redo()
    expect(set().map((g) => g.id)).toEqual([a, b, c].map((g) => g!.id))
    expect(items()).toHaveLength(3)
  })

  it('keeps a set’s colours by level: a new level takes its place’s (roadmap 41)', () => {
    const pinned = (g: GraphNode): GraphNode => ({
      ...g,
      seriesOverrides: {
        [levelKey('A')]: { color: { palette: 0 } },
        [levelKey('B')]: { color: { palette: 1 } },
      },
    })
    const { store, table, set } = setup(variables(), (id) => [
      pinned(member(id, 'A')),
      pinned(member(id, 'B', true)),
    ])
    store.dispatch(text(table.id, 4, 'C'))
    const c = set()[2]!
    expect(c.seriesOverrides[levelKey('C')]?.color).toEqual({ palette: 2 })
    // A set without pinned colours stays as it was.
    const plain = setup()
    plain.store.dispatch(text(plain.table.id, 4, 'C'))
    expect(plain.set()[2]!.seriesOverrides[levelKey('C')]).toBeUndefined()
  })

  it('grows the page when the grid passes its bottom', () => {
    const { store, table, layout, doc } = setup()
    store.dispatch(text(table.id, 4, 'C'))
    // Row 2 of the grid ends at 36 + 2 × 150 = 336; within 400.
    expect((doc().nodes[layout.id] as LayoutNode).page.height).toBe(400)
    store.dispatch(text(table.id, 5, 'D'))
    store.dispatch(text(table.id, 6, 'E'))
    // Row 3 ends at 486: the page grows to keep a margin under it.
    expect((doc().nodes[layout.id] as LayoutNode).page.height).toBe(510)
  })

  it('a row moving to a level that has a graph adds none; a level emptied keeps its graph', () => {
    const { store, table, set } = setup()
    store.dispatch(text(table.id, 0, 'B'))
    expect(set()).toHaveLength(2)
    store.dispatch(text(table.id, 2, 'B'))
    // A has no rows left: its graph stays (empty) until the user deletes it.
    expect(set().map(memberSlice)).toEqual([levelKey('A'), levelKey('B')])
    // Renaming a level is a new level: its graph comes, the old one stays.
    store.dispatch({
      type: 'table.setText',
      table: table.id,
      edits: [0, 1, 2, 3].map((row) => ({ col: 'g' as ColumnId, row, value: 'Z' })),
    })
    expect(set().map(memberSlice)).toEqual(['A', 'B', 'Z'].map(levelKey))
  })

  it('puts a new level where the set’s order has it', () => {
    // Levels ordered Z, B, A on the graphs: a new level the order lists goes in its place.
    const levels = { g: ['C', 'A', 'B'] }
    const { store, table, set, items } = setup(variables(), (id) => [
      { ...member(id, 'A'), levels },
      { ...member(id, 'B', true), levels },
    ])
    store.dispatch(text(table.id, 4, 'C'))
    const c = set().find((g) => memberSlice(g) === levelKey('C'))!
    const graphsOnPage = items().map((it) => (it.type === 'graph' ? it.graph : null))
    expect(graphsOnPage[0]).toBe(c.id)
    // C takes the first cell; A and B move one cell on, keeping their place within it.
    expect(items()[0]).toMatchObject({ x: 41, y: 39 })
    expect(items()[1]).toMatchObject({ x: 241, y: 39 })
    expect(items()[2]).toMatchObject({ x: 41, y: 189 })
  })

  it('leaves out levels the set left out, and levels whose graph was deleted', () => {
    const { store, table, set } = setup(variables(), (id) => [member(id, 'A', true)])
    // B has rows but no graph (left out): editing other cells doesn't add one.
    store.dispatch(text(table.id, 0, 'A'))
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col: 's' as ColumnId, row: 0, sub: 0, value: 9 }],
    })
    expect(set().map(memberSlice)).toEqual([levelKey('A')])
    // A new level still gets one.
    store.dispatch(text(table.id, 4, 'C'))
    expect(set().map(memberSlice)).toEqual(['A', 'C'].map(levelKey))
    // A shows the set's legend: the new graph doesn't repeat it.
    expect(set().map((g) => g.legend.show)).toEqual([true, false])
  })

  it('a graph deleted with a table edit in one batch stays deleted; new levels still come', () => {
    // Phase 42: the delete and an edit of the table in one dispatch added the graph back (the
    // slice had a graph before the change, so it counted as new), unlike the delete alone.
    const { store, table, set, items } = setup()
    const [a, b] = set()
    store.dispatch([
      { type: 'node.remove', id: a!.id },
      {
        type: 'table.setCells',
        table: table.id,
        edits: [{ col: 's' as ColumnId, row: 0, sub: 0, value: 9 }],
      },
    ])
    expect(set().map((g) => g.id)).toEqual([b!.id])
    // A new level in the same batch as a delete still gets its graph, the deleted one doesn't.
    store.undo()
    expect(set().map((g) => g.id)).toEqual([a!.id, b!.id])
    store.dispatch([{ type: 'node.remove', id: a!.id }, text(table.id, 4, 'C')])
    expect(set().map(memberSlice)).toEqual(['B', 'C'].map(levelKey))
    expect(items().map((it) => (it.type === 'graph' ? it.graph : null))).toEqual([
      b!.id,
      set()[1]!.id,
    ])
    // With an edit of the split variable itself (A keeps a row).
    store.undo()
    store.dispatch([{ type: 'node.remove', id: a!.id }, text(table.id, 0, 'B')])
    expect(set().map((g) => g.id)).toEqual([b!.id])
    // Taking a graph out of the set in a batch with an edit leaves its slice without a graph too.
    store.undo()
    store.dispatch([
      { type: 'node.set', id: a!.id, path: ['split'], value: undefined },
      text(table.id, 0, 'B'),
    ])
    expect(set().map((g) => g.id)).toEqual([b!.id])
  })
})

describe('other tables', () => {
  it('a new data set with values gets its graph (XY tables, per data set)', () => {
    const t = createTable({ tableKind: 'xy', rows: 3, columns: 2 })
    t.x!.subcolumns[0]!.values = [1, 2, 3]
    t.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
    t.dataSets[1]!.subcolumns[0]!.values = [3, 2, 1]
    const [d0, d1] = t.dataSets.map((d) => d.id)
    const graph = (id: NodeId, key: string, legend = false) =>
      testGraph(id, {
        ...XY,
        seriesSource: { table: id, include: [key] },
        seriesOverrides: { [key]: { color: { palette: key === d0 ? 0 : 1 } } },
        split: { set: SET, by: 'dataSet' },
        legend: { show: legend, position: 'right' },
        links: { x: 'lx', y: 'ly' },
      })
    const { store, set } = setup(t, (id) => [graph(id, d0!), graph(id, d1!, true)])
    // An empty data set: no graph yet.
    store.dispatch({ type: 'table.addDataSet', table: t.id, id: 'zz' as ColumnId })
    expect(set()).toHaveLength(2)
    store.dispatch({
      type: 'table.setCells',
      table: t.id,
      edits: [{ col: 'zz' as ColumnId, row: 0, sub: 0, value: 5 }],
    })
    const made = set()[2]!
    expect(made.seriesSource.include).toEqual(['zz'])
    // Its colour follows its place, as the others' do; the formats of the model's data set move.
    expect(made.seriesOverrides).toEqual({ zz: { color: { palette: 2 } } })
    expect(made.links).toEqual({ x: 'lx', y: 'ly' })
    store.undo()
    expect(set()).toHaveLength(2)
  })

  it('a new row with values gets its graph (grouped tables, per row)', () => {
    const t = createTable({ tableKind: 'grouped', rows: 3, columns: 2 })
    t.dataSets[0]!.subcolumns[0]!.values = [1, 2, null]
    const graph = (id: NodeId, row: number) =>
      testGraph(id, {
        ...GROUPED,
        seriesSource: { table: id, include: 'all', rows: [row] },
        split: { set: SET, by: 'row' },
      })
    const { store, set } = setup(t, (id) => [graph(id, 0), graph(id, 1)])
    const col = t.dataSets[1]!.id
    store.dispatch({
      type: 'table.setCells',
      table: t.id,
      edits: [{ col, row: 2, sub: 0, value: 4 }],
    })
    expect(set().map((g) => g.seriesSource.rows)).toEqual([[0], [1], [2]])
    expect(set()[2]!.title?.content).toEqual([{ text: 'Row 3' }])
    // Rows inserted above move the graphs' rows with them and add nothing (they are empty).
    store.dispatch({ type: 'table.insertRows', table: t.id, at: 0, count: 1 })
    expect(set().map((g) => g.seriesSource.rows)).toEqual([[1], [2], [3]])
    // A row deleted leaves its graph empty.
    store.dispatch({ type: 'table.deleteRows', table: t.id, rows: [1] })
    expect(set().map((g) => g.seriesSource.rows)).toEqual([[], [1], [2]])
  })
})

describe('copies', () => {
  it('a duplicated graph is not in the set; a copied family gets sets of its own', () => {
    const { doc, set, layout } = setup()
    const copy = duplicateNode(doc(), set()[0]!.id).node as GraphNode
    expect(copy.split).toBeUndefined()
    const links = new Map<string, string>()
    const m: Remap = { nodes: new Map(), keys: new Map(), links, newLink: () => 'fresh' }
    const graph = remapNode(set()[0]!, m)
    const page = remapNode(doc().nodes[layout.id] as LayoutNode, m)
    expect(graph.split?.set).toBe('fresh')
    expect(page.grids?.[0]?.set).toBe('fresh')
  })

  it('places a set on a grid with a new column count', () => {
    const graphs = [0, 1, 2].map(() => testGraph(newNodeId()))
    const p = page(graphs)
    const next = placeOnGrid(
      p,
      { ...GRID, columns: 3 },
      graphs.map((g) => g.id),
    )
    expect(next.items.map((it) => (it.type === 'graph' ? [it.x, it.y] : null))).toEqual([
      [41, 39],
      [241, 39],
      [441, 39],
    ])
    expect(next.grids).toEqual([{ ...GRID, columns: 3 }])
  })
})

describe('split sets and info sheets, folders (audit 2, M9)', () => {
  /** Score's level (lo, mid, hi) by a cut point read from the info sheet. */
  function byInfo(cut: string) {
    const t = variables()
    t.dataSets.push({
      id: 'c' as ColumnId,
      title: 'Level',
      formula: '=if(Score > [Info: cut], "hi", if(Score > 1, "mid", "lo"))',
      subcolumns: [{ type: 'number', values: [null, null, null, null] }],
    })
    const info = { ...createInfoSheet(newNodeId(), 'Info'), fields: [{ label: 'cut', value: cut }] }
    const graph = (id: NodeId, level: string) =>
      testGraph(id, {
        name: `Data – ${level}`,
        seriesSource: {
          table: id,
          include: 'all',
          filter: { variable: 'c', level: levelKey(level) },
        },
        split: { set: SET, by: 'level', variable: 'c' },
      })
    const store = new DocumentStore(createProject())
    store.dispatch({ type: 'node.add', node: info })
    store.dispatch([
      { type: 'node.add', node: t },
      { type: 'node.add', node: graph(t.id, 'lo') },
      { type: 'node.add', node: graph(t.id, 'mid') },
    ])
    const levels = () => setMembers(store.getState(), SET).map((g) => memberSlice(g))
    return { store, t, info, levels }
  }

  it('a calculated text variable reading an info field: a new level gets its graph', () => {
    const f = byInfo('10')
    expect(f.levels()).toEqual([levelKey('lo'), levelKey('mid')])
    f.store.dispatch({
      type: 'table.setCells',
      table: f.t.id,
      edits: [{ col: 's' as ColumnId, sub: 0, row: 3, value: 40 }],
    })
    expect(f.levels()).toEqual([levelKey('lo'), levelKey('mid'), levelKey('hi')])
  })

  it('editing the info field re-runs the follow-ups, in the same undo step', () => {
    const f = byInfo('10')
    const before = f.store.getState()
    f.store.dispatch({ type: 'info.setField', id: f.info.id, index: 0, value: '3.5' })
    expect(f.levels()).toEqual([levelKey('lo'), levelKey('mid'), levelKey('hi')])
    f.store.undo()
    expect(f.store.getState()).toEqual(before)
  })

  it('a new graph goes in the folder of the set’s graphs, not its table’s', () => {
    const { store, doc, table, set } = setup()
    const graphs = set().map((g) => g.id)
    store.dispatch([
      {
        type: 'folder.add',
        folder: { id: 'tables' as FolderId, name: 'Tables' },
        members: [table.id],
      },
      { type: 'folder.add', folder: { id: 'figs' as FolderId, name: 'Figures' }, members: graphs },
    ])
    store.dispatch({
      type: 'table.setText',
      table: table.id,
      edits: [{ col: 'g' as ColumnId, row: 1, value: 'C' }],
    })
    const made = set().find((g) => !graphs.includes(g.id))!
    expect(made).toBeDefined()
    expect(folderOf(doc().folders, made.id)?.id).toBe('figs')
  })
})

// Audit 2 (M7): follow-ups after edits the set's slices don't read (and with them in one step).
describe('edits outside a set’s slices', () => {
  const score = (table: NodeId, row: number, value: number | null) => ({
    type: 'table.setCells' as const,
    table,
    edits: [{ col: 's' as ColumnId, sub: 0, row, value }],
  })

  it('a level split: other variables’ cells, rows, widths add nothing; a level with them does', () => {
    const { store, table, set } = setup()
    store.dispatch(score(table.id, 0, 9))
    store.dispatch({ type: 'table.setColumnWidths', table: table.id, widths: { s: 90 } })
    store.dispatch({
      type: 'table.renameDataSet',
      table: table.id,
      id: 's' as ColumnId,
      title: 'S',
    })
    store.dispatch({ type: 'table.insertRows', table: table.id, at: 4, count: 2 })
    store.dispatch({ type: 'table.deleteRows', table: table.id, rows: [5] })
    expect(set().map(memberSlice)).toEqual(['A', 'B'].map(levelKey))
    store.dispatch([score(table.id, 1, 3), text(table.id, 4, 'C')])
    expect(set().map(memberSlice)).toEqual(['A', 'B', 'C'].map(levelKey))
    // A level cleared in one row, and back: nothing new (the set has its graph).
    store.dispatch(text(table.id, 4, null))
    store.dispatch(text(table.id, 4, 'C'))
    expect(set()).toHaveLength(3)
  })

  it('a data set split: cells of data sets with values add nothing; a new one’s value does', () => {
    const t = createTable({ tableKind: 'xy', rows: 3, columns: 3 })
    t.x!.subcolumns[0]!.values = [1, 2, 3]
    t.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
    t.dataSets[1]!.subcolumns[0]!.values = [3, 2, 1]
    const [d0, d1, d2] = t.dataSets.map((d) => d.id) as [ColumnId, ColumnId, ColumnId]
    const graph = (id: NodeId, key: string) =>
      testGraph(id, {
        ...XY,
        seriesSource: { table: id, include: [key] },
        split: { set: SET, by: 'dataSet' },
      })
    const { store, set } = setup(t, (id) => [graph(id, d0), graph(id, d1)])
    const cell = (col: string, row: number, value: number | null) => ({
      type: 'table.setCells' as const,
      table: t.id,
      edits: [{ col: col as ColumnId, sub: 0, row, value }],
    })
    store.dispatch(cell(d0, 0, 7))
    store.dispatch(cell('x', 1, 7))
    store.dispatch(cell(d1, 2, null))
    store.dispatch({ type: 'table.renameDataSet', table: t.id, id: d1, title: 'B' })
    expect(set()).toHaveLength(2)
    store.dispatch([cell(d0, 1, 1), cell(d2, 0, 5)])
    expect(set().map((g) => g.seriesSource.include)).toEqual([[d0], [d1], [d2]])
  })

  it('a new data set’s graph takes no legend-only label of the template’s own data set', () => {
    // Audit 3 (G4): the template's label for its data set named the new graph's.
    const t = createTable({ tableKind: 'xy', rows: 3, columns: 3 })
    t.x!.subcolumns[0]!.values = [1, 2, 3]
    t.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
    t.dataSets[1]!.subcolumns[0]!.values = [3, 2, 1]
    const [d0, d1, d2] = t.dataSets.map((d) => d.id) as [ColumnId, ColumnId, ColumnId]
    const graph = (id: NodeId, key: string) =>
      testGraph(id, {
        ...XY,
        seriesSource: { table: id, include: [key] },
        split: { set: SET, by: 'dataSet' },
        legend: {
          show: true,
          position: 'right',
          labels: { [key]: [{ text: `Label of ${key}` }] },
          hidden: [key],
        },
      })
    const { store, set } = setup(t, (id) => [graph(id, d0), graph(id, d1)])
    store.dispatch({
      type: 'table.setCells',
      table: t.id,
      edits: [{ col: d2, sub: 0, row: 0, value: 5 }],
    })
    const added = set().find((g) => (g.seriesSource.include as string[])[0] === d2)!
    expect(added.legend.labels?.[d2]).toBeUndefined()
    // Hiding its own entry is a format: the new graph's own entry is hidden too.
    expect(added.legend.hidden).toEqual([d2])
  })

  it('a row split: cells of rows with values and row titles add nothing; a new row’s does', () => {
    const t = createTable({ tableKind: 'grouped', rows: 3, columns: 2 })
    t.dataSets[0]!.subcolumns[0]!.values = [1, 2, null]
    const graph = (id: NodeId, row: number) =>
      testGraph(id, {
        ...GROUPED,
        seriesSource: { table: id, include: 'all', rows: [row] },
        split: { set: SET, by: 'row' },
      })
    const { store, set } = setup(t, (id) => [graph(id, 0), graph(id, 1)])
    const [c0, c1] = t.dataSets.map((d) => d.id) as [ColumnId, ColumnId]
    const cell = (col: ColumnId, row: number, value: number | null) => ({
      type: 'table.setCells' as const,
      table: t.id,
      edits: [{ col, row, sub: 0, value }],
    })
    store.dispatch(cell(c1, 0, 4))
    store.dispatch({ type: 'table.setRowTitle', table: t.id, row: 1, title: 'Second' })
    expect(set()).toHaveLength(2)
    store.dispatch([cell(c0, 0, 5), cell(c1, 2, 6)])
    expect(set().map((g) => g.seriesSource.rows)).toEqual([[0], [1], [2]])
  })
})
