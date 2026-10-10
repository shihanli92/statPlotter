import { createProject, type DataTable, levelKey, type NodeId, type Project } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { syntheticTable } from '../../model/test/synthetic.ts'
import { cpuRatio, growthRatio } from '../../stats/test/timing.ts'
import {
  applyDocPatches,
  BIG_ARRAY,
  type Command,
  compactRowPatches,
  DocumentStore,
  freezeDoc,
  HISTORY_CELLS,
  HISTORY_STEPS,
  produceCommands,
} from '../src/index.ts'
import { testGraph } from './graphs.ts'

// The store with large tables (roadmap 34e): the document frozen but its large arrays (V8
// boxes frozen doubles), cell edits patched cell by cell without Immer, row inserts and deletes
// as whole arrays, undo and redo copying only along the patches' paths.

const NOW = new Date('2026-10-02T00:00:00Z')

function storeWith(t: DataTable): DocumentStore {
  const p = createProject('P', NOW)
  p.nodes[t.id] = t
  p.order.push(t.id)
  return new DocumentStore(p)
}

const table = (s: DocumentStore, id = 't1') => s.getState().nodes[id as NodeId] as DataTable
const keyOf = (t: DataTable, title: string) => t.dataSets.find((d) => d.title === title)!.id

describe('freezing', () => {
  it('freezes the document but large arrays, which stay plain arrays of numbers', () => {
    const s = storeWith(syntheticTable({ rows: BIG_ARRAY + 5, genes: 2, pcs: 1 }))
    const t = table(s)
    expect(Object.isFrozen(s.getState())).toBe(true)
    expect(Object.isFrozen(t)).toBe(true)
    expect(Object.isFrozen(t.dataSets)).toBe(true)
    expect(Object.isFrozen(t.dataSets[4]!.subcolumns[0])).toBe(true)
    expect(Object.isFrozen(t.dataSets[4]!.subcolumns[0]!.values)).toBe(false)
    const small = storeWith(syntheticTable({ rows: 50, genes: 2, pcs: 1 }))
    expect(Object.isFrozen(table(small).dataSets[4]!.subcolumns[0]!.values)).toBe(true)
  })

  it('freezes only what is new: a frozen part is not walked again', () => {
    const p = freezeDoc(createProject('P', NOW))
    expect(freezeDoc(p)).toBe(p)
  })
})

describe('cell edits', () => {
  const edit = (s: DocumentStore, rows: number[], value: number): Command => ({
    type: 'table.setCells',
    table: 't1' as NodeId,
    edits: rows.map((row) => ({ col: keyOf(table(s), 'GENE1'), sub: 0, row, value })),
  })

  it('patch the cells alone, as Immer would, and undo and redo them', () => {
    const s = storeWith(syntheticTable({ rows: 20_000, genes: 2, pcs: 1 }))
    const before = s.getState()
    const cmd = edit(s, [3, 7, 3], 42)
    // What Immer makes of the same command.
    const [viaImmer, patches, inverse] = produceCommands(before, [cmd])
    s.dispatch(cmd)
    const after = s.getState()
    expect(after).toEqual(viaImmer)
    const entry = (s as unknown as { undoStack: { patches: unknown[]; inverse: unknown[] }[] })
      .undoStack[0]!
    expect(entry.patches).toEqual(patches)
    expect(entry.inverse).toEqual(inverse)
    expect(entry.patches).toHaveLength(2)
    // Other columns, and the rest of the document, are shared.
    expect(table(s).dataSets[0]).toBe((before.nodes['t1' as NodeId] as DataTable).dataSets[0])
    s.undo()
    expect(s.getState()).toEqual(before)
    s.redo()
    expect(s.getState()).toEqual(after)
  })

  it('a column filled down is one patch, not a patch a cell', () => {
    const s = storeWith(syntheticTable({ rows: 6000, genes: 2, pcs: 1 }))
    const before = s.getState()
    s.dispatch(
      edit(
        s,
        Array.from({ length: 5000 }, (_, r) => r + 1),
        1,
      ),
    )
    const entry = (s as unknown as { undoStack: { patches: unknown[] }[] }).undoStack[0]!
    expect(entry.patches).toHaveLength(1)
    s.undo()
    expect(s.getState()).toEqual(before)
  })

  it('refuse what the reducers refuse (text into numbers), leaving the document as it was', () => {
    const s = storeWith(syntheticTable({ rows: 100, genes: 2, pcs: 1 }))
    const before = s.getState()
    expect(() =>
      s.dispatch({
        type: 'table.setCells',
        table: 't1' as NodeId,
        edits: [{ col: keyOf(table(s), 'cluster'), sub: 0, row: 1, value: 3 }],
      }),
    ).toThrow(/text variable/)
    expect(s.getState()).toBe(before)
  })

  it('cost the same however many other columns the table has', () => {
    const stores = new Map<number, DocumentStore>()
    const ratio = growthRatio(
      (genes) => {
        let s = stores.get(genes)
        if (!s) {
          s = storeWith(syntheticTable({ rows: 20_000, genes, pcs: 1 }))
          stores.set(genes, s)
        }
        s.dispatch(edit(s, [5], Math.random()))
        s.undo()
        s.redo()
      },
      10,
      4,
      3,
    )
    expect(ratio).toBeLessThan(2.5)
  })
})

describe('rows inserted and deleted', () => {
  it('replace each column whole (one patch each), and undo exactly', () => {
    const s = storeWith(syntheticTable({ rows: 3000, genes: 2, pcs: 1 }))
    const before = s.getState()
    s.dispatch({ type: 'table.deleteRows', table: 't1' as NodeId, rows: [0, 5, 2999] })
    expect(table(s).rowCount).toBe(2997)
    expect(table(s).dataSets[4]!.subcolumns[0]!.values[0]).toBe(
      (before.nodes['t1' as NodeId] as DataTable).dataSets[4]!.subcolumns[0]!.values[1],
    )
    const entry = (s as unknown as { undoStack: { patches: unknown[] }[] }).undoStack[0]!
    expect(entry.patches.length).toBeLessThan(table(s).dataSets.length * 2 + 5)
    s.dispatch({ type: 'table.insertRows', table: 't1' as NodeId, at: 10, count: 4 })
    expect(table(s).rowCount).toBe(3001)
    expect(table(s).dataSets[4]!.subcolumns[0]!.values.slice(10, 14)).toEqual([
      null,
      null,
      null,
      null,
    ])
    s.undo()
    s.undo()
    expect(s.getState()).toEqual(before)
  })

  it('take time linear in the rows', () => {
    const ratio = growthRatio(
      (rows) => {
        const s = storeWith(syntheticTable({ rows, genes: 2, pcs: 1 }))
        s.dispatch({ type: 'table.deleteRows', table: 't1' as NodeId, rows: [1, 2, 3] })
        s.undo()
      },
      5000,
      4,
      2,
    )
    expect(ratio).toBeLessThan(8)
  })

  // Audit 2 (M2): without Immer (which walked every array replaced, then the patches compared
  // them element by element) and without checking cells the edit only moved.
  it('cost a fraction of the reducers under Immer', () => {
    const s = storeWith(syntheticTable({ rows: 50_000, genes: 4, pcs: 2 }))
    const del: Command = { type: 'table.deleteRows', table: 't1' as NodeId, rows: [1, 2, 3] }
    const ins: Command = { type: 'table.insertRows', table: 't1' as NodeId, at: 7, count: 2 }
    const ratio = cpuRatio(
      () => {
        produceCommands(s.getState(), [del])
        produceCommands(s.getState(), [ins])
      },
      () => {
        s.dispatch(del)
        s.undo()
        s.dispatch(ins)
        s.undo()
      },
    )
    expect(ratio).toBeLessThan(0.6)
  })
})

describe('edits leaving the per-row arrays (audit 2, M2)', () => {
  it('check none of the cells: a rename or a column width costs the same at 4× the rows', () => {
    const stores = new Map<number, DocumentStore>()
    const ratio = growthRatio(
      (rows) => {
        let s = stores.get(rows)
        if (!s) {
          s = storeWith(syntheticTable({ rows, genes: 4, pcs: 2 }))
          stores.set(rows, s)
        }
        s.dispatch({ type: 'node.rename', id: 't1' as NodeId, name: `t${Math.random()}` })
        s.dispatch({
          type: 'table.setColumnWidths',
          table: 't1' as NodeId,
          widths: { v8: 40 + Math.round(Math.random() * 100) },
        })
      },
      20_000,
      4,
      3,
    )
    expect(ratio).toBeLessThan(2)
  })
})

describe('sets of split graphs (audit 2, M7)', () => {
  it('a cell edit outside the columns a set reads costs about what it costs without sets', () => {
    const t = syntheticTable({ rows: 100_000, genes: 4, pcs: 2 })
    const plain = storeWith(t)
    const split = storeWith(t)
    const cluster = keyOf(t, 'cluster')
    split.dispatch([
      {
        type: 'node.add',
        node: testGraph('t1' as NodeId, {
          seriesSource: {
            table: 't1' as NodeId,
            include: 'all',
            filter: { variable: cluster, level: levelKey('C0') },
          },
          split: { set: 'set1', by: 'level', variable: cluster },
        }),
      },
      {
        type: 'node.add',
        node: testGraph('t1' as NodeId, {
          seriesSource: { table: 't1' as NodeId, include: [keyOf(t, 'GENE2')] },
          split: { set: 'set2', by: 'dataSet' },
        }),
      },
    ])
    const edit = (s: DocumentStore) => () =>
      s.dispatch({
        type: 'table.setCells',
        table: 't1' as NodeId,
        edits: [{ col: keyOf(t, 'GENE1'), sub: 0, row: 5, value: Math.random() }],
      })
    const ratio = cpuRatio(edit(plain), edit(split))
    expect(ratio).toBeLessThan(1.6)
  })
})

describe('patches applied along their paths', () => {
  it('add, remove and replace in objects and arrays, sharing the rest', () => {
    const base = freezeDoc({ a: { b: [1, 2, 3] }, c: { d: 1 } }) as unknown as Project
    const next = applyDocPatches(base, [
      { op: 'replace', path: ['a', 'b', 1], value: 9 },
      { op: 'add', path: ['a', 'b', 0], value: 0 },
      { op: 'remove', path: ['a', 'b', 3] },
      { op: 'add', path: ['a', 'e'], value: 'x' },
    ]) as unknown as { a: { b: number[]; e: string }; c: unknown }
    expect(next.a).toEqual({ b: [0, 1, 9], e: 'x' })
    expect(next.c).toBe((base as unknown as { c: unknown }).c)
    expect(Object.isFrozen(next.a.b)).toBe(true)
  })
})

// Audit 2 (M1): the undo history is bounded, and row inserts and deletes of large tables hold
// the rows that changed, not every per-row array before and after.
type Entry = { patches: { op: string }[]; inverse: { op: string }[]; cells: number }
const entries = (s: DocumentStore) => (s as unknown as { undoStack: Entry[] }).undoStack

describe('row edits of large tables in the history', () => {
  const rows = BIG_ARRAY + 500

  it('hold the rows deleted and inserted, and undo and redo exactly', () => {
    const s = storeWith(syntheticTable({ rows, genes: 3, pcs: 2 }))
    const states = [s.getState()]
    s.dispatch({ type: 'table.deleteRows', table: 't1' as NodeId, rows: [0, 7, 8, rows - 1] })
    states.push(s.getState())
    s.dispatch({ type: 'table.insertRows', table: 't1' as NodeId, at: 3, count: 5 })
    states.push(s.getState())
    // A paste past the end grows the table (insertRows inside setCells).
    s.dispatch({
      type: 'table.setCells',
      table: 't1' as NodeId,
      edits: [{ col: keyOf(table(s), 'GENE1'), sub: 0, row: rows + 10, value: 4 }],
    })
    states.push(s.getState())
    for (const e of entries(s)) {
      expect(e.patches.some((p) => p.op === 'removeRows' || p.op === 'insertRows')).toBe(true)
      // A few values per column, not the columns.
      expect(e.cells).toBeLessThan(500)
    }
    expect(table(s).rowCount).toBe(rows + 11)
    for (let i = states.length - 2; i >= 0; i--) {
      s.undo()
      expect(s.getState()).toEqual(states[i])
    }
    for (let i = 1; i < states.length; i++) {
      s.redo()
      expect(s.getState()).toEqual(states[i])
    }
  })

  it('count a table removed by its cells', () => {
    const s = storeWith(syntheticTable({ rows, genes: 1, pcs: 1 }))
    s.dispatch({ type: 'node.remove', id: 't1' as NodeId })
    expect(entries(s)[0]!.cells).toBeGreaterThanOrEqual(rows * 2)
  })
})

describe('the undo history', () => {
  const titled = (s: DocumentStore, title: string) =>
    s.dispatch({ type: 'project.setSettings', settings: { theme: title } })

  it('keeps at most its number of steps, dropping the oldest', () => {
    const s = new DocumentStore(createProject('P', NOW), { steps: 3 })
    for (const t of ['a', 'b', 'c', 'd', 'e']) titled(s, t)
    expect(s.historyLength).toEqual({ undo: 3, redo: 0 })
    while (s.undo());
    expect(s.getState().settings.theme).toBe('b')
    expect(s.historyLength).toEqual({ undo: 0, redo: 3 })
    while (s.redo());
    expect(s.getState().settings.theme).toBe('e')
  })

  it('drops its oldest steps while they hold more values than its bound, keeping the newest', () => {
    const big = (id: string) => ({
      ...syntheticTable({ rows: 3000, genes: 1, pcs: 1 }),
      id: id as NodeId,
    })
    const one = new DocumentStore(createProject('P', NOW))
    one.dispatch({ type: 'node.add', node: big('t1') })
    const size = entries(one)[0]!.cells
    const s = new DocumentStore(createProject('P', NOW), { cells: Math.floor(size * 2.5) })
    s.dispatch({ type: 'node.add', node: big('t1') })
    s.dispatch({ type: 'node.add', node: big('t2') })
    titled(s, 'x')
    expect(s.historyLength.undo).toBe(3)
    s.dispatch({ type: 'node.add', node: big('t3') })
    // Three tables are over the bound: the oldest step goes.
    expect(s.historyLength.undo).toBe(3)
    while (s.undo());
    expect(Object.keys(s.getState().nodes)).toEqual(['t1'])
    // A step larger than the bound stays (the newest is always kept).
    const tiny = new DocumentStore(createProject('P', NOW), { cells: 10 })
    tiny.dispatch({ type: 'node.add', node: big('t1') })
    tiny.dispatch({ type: 'node.add', node: big('t2') })
    expect(tiny.historyLength.undo).toBe(1)
    expect(tiny.undo()).toBe(true)
    expect(Object.keys(tiny.getState().nodes)).toEqual(['t1'])
  })

  it('keeps commands only where a draft replays them', () => {
    const s = new DocumentStore(createProject('P', NOW))
    titled(s, 'a')
    expect(entries(s)[0]).not.toHaveProperty('commands')
  })

  it('is bounded by default (200 steps, 1.5e8 values)', () => {
    expect(HISTORY_STEPS).toBe(200)
    expect(HISTORY_CELLS).toBe(1.5e8)
    const s = new DocumentStore(createProject('P', NOW))
    for (let i = 0; i < 205; i++) titled(s, `t${i}`)
    expect(s.historyLength.undo).toBe(200)
  })
})

describe('compact row patches', () => {
  it('take out and put back rows of a large array', () => {
    const n = BIG_ARRAY + 3
    const a = Array.from({ length: n }, (_, i) => (i % 7 === 0 ? null : i % 5))
    const b = a.filter((_, i) => i !== 2 && i !== 3 && i !== n - 1)
    const [fwd, inv] = compactRowPatches(
      [{ op: 'replace', path: ['v'], value: b }],
      [{ op: 'replace', path: ['v'], value: a }],
    )
    expect(fwd[0]!.op).toBe('removeRows')
    expect(inv[0]!.op).toBe('insertRows')
    const base = { v: a } as unknown as Project
    const after = applyDocPatches(base, fwd) as unknown as { v: unknown[] }
    expect(after.v).toEqual(b)
    const back = applyDocPatches(after as unknown as Project, inv) as unknown as { v: unknown[] }
    expect(back.v).toEqual(a)
    // Not a subsequence (a reorder): whole arrays stay.
    const [same] = compactRowPatches(
      [{ op: 'replace', path: ['v'], value: [...b].reverse() }],
      [{ op: 'replace', path: ['v'], value: a }],
    )
    expect(same[0]!.op).toBe('replace')
  })
})
