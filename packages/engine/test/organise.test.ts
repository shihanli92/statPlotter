import {
  createInfoSheet,
  createTable,
  type DataTable,
  type FolderId,
  type InfoNode,
  newNodeId,
  sourceTable,
  tableFormulas,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  CommandError,
  DocumentStore,
  duplicateFamily,
  duplicateNode,
  type FamilyEntry,
  familyNodes,
  familyTree,
  moveSheetCommands,
  stepSheetCommands,
} from '../src/index.ts'
import { analysis, deepFamily, graph } from './familyFixture.ts'

// Roadmap 40: reordering sheets, folders, the Family view, info sheets' renames.

const F1 = 'folder1' as FolderId
const F2 = 'folder2' as FolderId

describe('reordering sheets', () => {
  it('moves sheets before or after another as one undo step', () => {
    const f = deepFamily()
    const { store } = f
    const before = store.getState().order
    store.dispatch(moveSheetCommands(store.getState(), [f.gOther.id], { before: f.g1.id }), 'Move')
    const order = store.getState().order
    expect(order.indexOf(f.gOther.id)).toBe(order.indexOf(f.g1.id) - 1)
    expect(order.length).toBe(before.length)
    store.undo()
    expect(store.getState().order).toEqual(before)
    // Several at once keep their order; after the last.
    store.dispatch(
      moveSheetCommands(store.getState(), [f.g2.id, f.g1.id], { after: f.gOther.id }),
      'Move',
    )
    const o2 = store.getState().order
    expect(o2.slice(o2.indexOf(f.gOther.id), o2.indexOf(f.gOther.id) + 3)).toEqual([
      f.gOther.id,
      f.g1.id,
      f.g2.id,
    ])
    // Nothing to do: no commands.
    expect(moveSheetCommands(store.getState(), [f.g1.id], { after: f.gOther.id })).toEqual([])
    expect(moveSheetCommands(store.getState(), [f.g1.id], { before: f.g1.id })).toEqual([])
  })

  it('moves up and down among the sheets shown beside it', () => {
    const f = deepFamily()
    const { store } = f
    const graphs = [f.g1.id, f.g2.id, f.gOther.id]
    store.dispatch(stepSheetCommands(store.getState(), f.gOther.id, 'up', graphs), 'Move up')
    const shown = () => store.getState().order.filter((id) => graphs.includes(id))
    expect(shown()).toEqual([f.g1.id, f.gOther.id, f.g2.id])
    store.dispatch(stepSheetCommands(store.getState(), f.g1.id, 'down', shown()), 'Move down')
    expect(shown()).toEqual([f.gOther.id, f.g1.id, f.g2.id])
    expect(stepSheetCommands(store.getState(), f.gOther.id, 'up', shown())).toEqual([])
    store.undo()
    store.undo()
    expect(shown()).toEqual(graphs)
  })
})

describe('folders', () => {
  it('are made, filed into, renamed, nested one level, and deleted keeping the sheets', () => {
    const f = deepFamily()
    const { store } = f
    store.dispatch({ type: 'folder.add', folder: { id: F1, name: 'Day 1' } })
    store.dispatch({ type: 'folder.file', ids: [f.day1.id, f.g1.id], folder: F1 })
    expect(store.getState().folders).toEqual([
      { id: F1, name: 'Day 1', members: [f.day1.id, f.g1.id] },
    ])
    store.dispatch({ type: 'folder.add', folder: { id: F2, name: 'Graphs', parent: F1 } })
    store.dispatch({ type: 'folder.file', ids: [f.g1.id], folder: F2 })
    const doc = store.getState()
    expect(doc.folders!.map((x) => x.members)).toEqual([[f.day1.id], [f.g1.id]])
    // One level only.
    expect(() =>
      store.dispatch({
        type: 'folder.add',
        folder: { id: 'f3' as FolderId, name: 'x', parent: F2 },
      }),
    ).toThrow(CommandError)
    expect(() => store.dispatch({ type: 'folder.move', id: F1, parent: F2 })).toThrow(CommandError)
    store.dispatch({ type: 'folder.rename', id: F2, name: 'Figures' })
    expect(store.getState().folders![1]!.name).toBe('Figures')
    // Deleting the parent: its sheets are unfiled, its subfolder moves to the top.
    store.dispatch({ type: 'folder.remove', id: F1 })
    expect(store.getState().folders).toEqual([{ id: F2, name: 'Figures', members: [f.g1.id] }])
    // Deleting a subfolder puts its sheets in its parent; the last folder leaves no list.
    store.dispatch({ type: 'folder.remove', id: F2 })
    expect('folders' in store.getState()).toBe(false)
    for (const id of store.getState().order) expect(store.getState().nodes[id]).toBeDefined()
    // Every step undoes.
    for (let i = 0; i < 7; i++) store.undo()
    expect('folders' in store.getState()).toBe(false)
  })

  it('lose deleted sheets; new and duplicated sheets join their folder', () => {
    const f = deepFamily()
    const { store } = f
    store.dispatch([
      { type: 'folder.add', folder: { id: F1, name: 'Day 1' } },
      { type: 'folder.file', ids: [f.day1.id, f.whole.id], folder: F1 },
    ])
    // An analysis or graph of a filed table goes in its folder.
    const a = analysis('Sum again', 'test.sum', f.day1.id, [f.A])
    const g = graph('More', f.day1.id)
    const loose = graph('Loose', f.other.id)
    store.dispatch([
      { type: 'node.add', node: a },
      { type: 'node.add', node: g },
      { type: 'node.add', node: loose },
    ])
    expect(store.getState().folders![0]!.members).toEqual([f.day1.id, f.whole.id, a.id, g.id])
    // A duplicate sits with its original.
    const dup = duplicateNode(store.getState(), f.whole.id)
    store.dispatch(dup)
    expect(store.getState().folders![0]!.members).toContain(dup.node.id)
    // A duplicated family goes in the table's folder.
    const plan = duplicateFamily(store.getState(), f.day1.id, {
      find: 'Day 1',
      replace: 'Day 2',
      layouts: 'none',
    })
    store.dispatch(plan.commands)
    for (const id of plan.created) expect(store.getState().folders![0]!.members).toContain(id)
    // Deleting the table removes its family from the folder; the folder stays.
    store.dispatch({ type: 'node.remove', id: f.day1.id })
    const members = store.getState().folders![0]!.members
    expect(members).not.toContain(f.day1.id)
    expect(members).not.toContain(a.id)
    for (const id of members) expect(store.getState().nodes[id]).toBeDefined()
  })
})

const ids = (es: readonly FamilyEntry[]): unknown[] =>
  es.map((e) =>
    e.kind === 'set'
      ? { set: e.set, children: ids(e.children) }
      : e.children.length
        ? { [e.link ? `→${e.id}` : e.id]: ids(e.children) }
        : e.link
          ? `→${e.id}`
          : e.id,
  )

describe('the Family view', () => {
  it('nests analyses, chained results and graphs under their table; layouts list their graphs', () => {
    const f = deepFamily()
    const sheet: InfoNode = createInfoSheet(newNodeId(), 'Experiment', 'experiment')
    // A derived table (an analysis producing a table) with a set of split graphs of it.
    const derived = analysis('Filtered', 'test.scale', f.other.id, [])
    const s1 = graph('Split A', derived.id, { split: { set: 'set1', by: 'dataSet' } })
    const s2 = graph('Split B', derived.id, { split: { set: 'set1', by: 'dataSet' } })
    f.store.dispatch([
      { type: 'node.add', node: sheet },
      { type: 'node.add', node: derived },
      { type: 'node.add', node: s1 },
      { type: 'node.add', node: s2 },
    ])
    const tree = familyTree(f.store.getState())
    expect(ids(tree)).toEqual([
      sheet.id,
      {
        [f.day1.id]: [{ [f.scale.id]: [f.sumOfScale.id, f.g2.id] }, f.sum.id, f.gof.id, f.g1.id],
      },
      {
        [f.other.id]: [{ [derived.id]: [{ set: 'set1', children: [s1.id, s2.id] }] }, f.gOther.id],
      },
      { [f.whole.id]: [`→${f.g1.id}`, `→${f.g2.id}`] },
      { [f.mixed.id]: [`→${f.g1.id}`, `→${f.gOther.id}`] },
    ])
    // Every sheet appears once at home.
    const home = familyNodes(tree)
    expect([...home].sort()).toEqual([...f.store.getState().order].sort())
  })
})

describe('info sheets', () => {
  function project() {
    const t = createTable({ tableKind: 'multipleVariables', name: 'T', columns: 2, rows: 2 })
    t.dataSets[0]!.title = 'Conc'
    t.dataSets[0]!.subcolumns[0]!.values = [1, 2]
    t.dataSets[1]!.title = 'D'
    t.dataSets[1]!.formula = '=Conc * [Info: dilution] + [Experiment: offset]'
    const sheet: InfoNode = {
      ...createInfoSheet(newNodeId(), 'Experiment'),
      fields: [
        { label: 'dilution', value: '10' },
        { label: 'offset', value: '1' },
      ],
    }
    const store = new DocumentStore({
      schemaVersion: 3,
      meta: {
        title: 'p',
        created: '2026-10-06T00:00:00.000Z',
        modified: '2026-10-06T00:00:00.000Z',
        appVersion: '0',
      },
      settings: {
        pValueStyle: 'GP',
        pValueDigits: 4,
        defaultConfidenceLevel: 0.95,
        theme: 'default',
      },
      nodes: { [t.id]: t, [sheet.id]: sheet },
      order: [t.id, sheet.id],
    })
    const formula = () => (store.getState().nodes[t.id] as DataTable).dataSets[1]!.formula
    const values = () => {
      const doc = store.getState()
      const bound = sourceTable(doc, t.id)!
      return [...tableFormulas(bound).get(t.dataSets[1]!.id)!.values]
    }
    return { store, t, sheet, formula, values }
  }

  it('give live constants; renames of fields and sheets follow in formulas', () => {
    const { store, sheet, formula, values, t } = project()
    expect(values()).toEqual([11, 21])
    store.dispatch({ type: 'info.setField', id: sheet.id, index: 0, value: '100' })
    expect(values()).toEqual([101, 201])
    store.dispatch({ type: 'info.setField', id: sheet.id, index: 0, label: 'Dilution factor' })
    expect(formula()).toBe('=Conc * [Info: Dilution factor] + [Experiment: offset]')
    store.dispatch({ type: 'node.rename', id: sheet.id, name: 'Exp 1' })
    expect(formula()).toBe('=Conc * [Info: Dilution factor] + [Exp 1: offset]')
    expect(values()).toEqual([101, 201])
    store.undo()
    expect(formula()).toBe('=Conc * [Info: Dilution factor] + [Experiment: offset]')
    // A removed field: the formula's error.
    store.dispatch({ type: 'info.setFields', id: sheet.id, fields: [] })
    const bound = sourceTable(store.getState(), t.id)!
    expect(tableFormulas(bound).get(t.dataSets[1]!.id)!.error).toBe(
      'no info sheet has a field “Dilution factor”',
    )
  })

  it('keep their notes formatted or plain, and duplicate', () => {
    const { store, sheet } = project()
    store.dispatch({
      type: 'info.setNotes',
      id: sheet.id,
      notes: 'Bold text',
      rich: [{ text: 'Bold', bold: true }, { text: ' text' }],
    })
    expect((store.getState().nodes[sheet.id] as InfoNode).notesRich).toHaveLength(2)
    store.dispatch({ type: 'info.setNotes', id: sheet.id, notes: 'plain' })
    expect('notesRich' in store.getState().nodes[sheet.id]!).toBe(false)
    const dup = duplicateNode(store.getState(), sheet.id)
    store.dispatch(dup)
    expect(store.getState().nodes[dup.node.id]!.name).toBe('Experiment (copy)')
  })
})
