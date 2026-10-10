import { removalSet, removalSetOf } from '@ps/engine'
import { DEFAULT_MATCH_OPTIONS } from '@ps/graph'
import {
  createInfoSheet,
  createTable,
  type FolderId,
  type GraphNode,
  type LayoutNode,
  newNodeId,
  newSeriesId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { analysis, deepFamily, graph } from '../../engine/test/familyFixture.ts'
import { curves } from '../../engine/test/graphs.ts'
import { batchItems } from '../src/graph/batchExport.tsx'
import { matchFormatCommands } from '../src/graph/MatchFormat.tsx'
import {
  dropCommands,
  duplicatesOf,
  openAfterRemoval,
  removalOf,
  removalQuestion,
  sheetsToMove,
} from '../src/organise/navBatch.ts'

// Roadmap 47 (UX review S8): what the navigator does to several selected sheets — each one undo
// step: Delete (the union of the cascades, one question), Duplicate, Move to folder and drags,
// Export selected (the graphs and pages among them), Match format.

const F = 'f1' as FolderId

describe('deleting several sheets', () => {
  it('removes the union of their cascades in one step; undo brings everything back', () => {
    const f = deepFamily()
    const before = f.store.getState()
    // Day 1, one of its graphs and an analysis of it: one `node.remove` (the others go with it).
    const r = removalOf(before, [f.g1.id, f.whole.id, f.day1.id, f.scale.id])
    expect(r.commands).toEqual([
      { type: 'node.remove', id: f.day1.id },
      { type: 'node.remove', id: f.whole.id },
    ])
    expect(new Set(r.gone)).toEqual(
      new Set([...removalSet(before, f.day1.id), ...removalSet(before, f.whole.id)]),
    )
    // Not selected but going: Day 1's other analyses and graph.
    expect(r.also).toEqual([f.sumOfScale.id, f.sum.id, f.gof.id, f.g2.id])
    f.store.dispatch(r.commands, 'Delete 4 sheets')
    const after = f.store.getState()
    expect(after.order).toEqual([f.other.id, f.gOther.id, f.mixed.id])
    // The page placing a deleted graph keeps its other one (and its text).
    const mixed = after.nodes[f.mixed.id] as LayoutNode
    expect(mixed.items.map((it) => it.type)).toEqual(['graph', 'text'])
    expect(f.store.undoLabel).toBe('Delete 4 sheets')
    expect(f.store.historyLength.undo).toBe(1)
    f.store.undo()
    expect(f.store.getState()).toEqual(before)
    // The sheet opened next: where the first deleted one was.
    expect(openAfterRemoval(before.order, after.order, r.gone)).toBe(f.other.id)
    expect(openAfterRemoval([], [], [])).toBe(null)
  })

  it('a graph of curves from two deleted analyses goes, though neither alone takes it', () => {
    const f = deepFamily()
    const t3 = createTable({ name: 'Third', rows: 1, columns: 1 })
    const sumOther = analysis('Sum of Other', 'test.sum', f.other.id, [f.other.dataSets[0]!.id])
    const both: GraphNode = graph('Curves', t3.id, {
      seriesSource: { table: t3.id, include: [] },
      layers: [
        curves([
          { id: newSeriesId(), ref: { node: f.sum.id, key: `curve:${f.A}` } },
          {
            id: newSeriesId(),
            ref: { node: sumOther.id, key: `curve:${f.other.dataSets[0]!.id}` },
          },
        ]),
      ],
    })
    f.store.dispatch([
      { type: 'node.add', node: t3 },
      { type: 'node.add', node: sumOther },
      { type: 'node.add', node: both },
    ])
    const doc = f.store.getState()
    expect(removalSet(doc, f.sum.id).has(both.id)).toBe(false)
    expect(removalSet(doc, sumOther.id).has(both.id)).toBe(false)
    expect(removalSetOf(doc, [f.sum.id, sumOther.id]).has(both.id)).toBe(true)
    const r = removalOf(doc, [f.sum.id, sumOther.id])
    expect(r.also).toContain(both.id)
    // Removing them one after the other in one step removes the same.
    f.store.dispatch(r.commands, 'Delete 2 sheets')
    expect(f.store.getState().nodes[both.id]).toBeUndefined()
  })

  it('asks once, listing what goes with them; one sheet asks only with a warning', () => {
    const f = deepFamily()
    const doc = f.store.getState()
    const q = removalQuestion(doc, [f.day1.id, f.gOther.id])!
    expect(q.title).toBe('Delete 2 sheets?')
    expect(q.ok).toBe('Delete 2 sheets')
    expect(q.message).toContain('“Day 1” and “Other” will be deleted.')
    expect(q.message).toContain(
      'With them: 4 results sheets (“Scale of Day 1”, “Sum of Scale of Day 1”, “Sum of Day 1” and “Expected of Day 1”) and 2 graphs (“Day 1” and “Scale of Day 1”).',
    )
    expect(q.message).toContain('You can undo this.')
    expect(removalQuestion(doc, [f.gOther.id])).toBeNull()
  })

  it('warns of info fields formulas read, unless the tables reading them go too', () => {
    const f = deepFamily()
    const info = { ...createInfoSheet(newNodeId(), 'Lab'), fields: [{ label: 'n', value: '4' }] }
    const t = createTable({ name: 'Calc', tableKind: 'multipleVariables', columns: 2, rows: 2 })
    t.dataSets[1]!.formula = '=[Lab: n] * 2'
    f.store.dispatch([
      { type: 'node.add', node: info },
      { type: 'node.add', node: t },
    ])
    const doc = f.store.getState()
    expect(removalQuestion(doc, [info.id])).toEqual({
      title: 'Delete it anyway?',
      message: 'The formulas of “Calc” read “n” from “Lab”.',
      ok: 'Delete',
    })
    expect(removalQuestion(doc, [info.id, f.gOther.id])!.message).toContain(
      'The formulas of “Calc” read “n” from “Lab”.',
    )
    expect(removalOf(doc, [info.id, t.id]).warnings).toEqual([])
  })
})

describe('duplicating several sheets', () => {
  it('copies each after its original, named as one at a time would be; one step', () => {
    const f = deepFamily()
    const before = f.store.getState()
    const { commands, copies } = duplicatesOf(before, [f.g1.id, f.day1.id, f.whole.id])
    expect(copies).toHaveLength(3)
    f.store.dispatch(commands, 'Duplicate 3 sheets')
    const doc = f.store.getState()
    const name = (id: string) => doc.nodes[id as never]!.name
    // In navigator order: Day 1 (table), then its graph, then the page.
    expect(copies.map(name)).toEqual(['Day 1 (copy)', 'Day 1 (copy 2)', 'Figure Day 1 (copy)'])
    for (const [i, id] of [f.day1.id, f.g1.id, f.whole.id].entries())
      expect(doc.order.indexOf(copies[i]!)).toBe(doc.order.indexOf(id) + 1)
    f.store.undo()
    expect(f.store.getState()).toEqual(before)
  })
})

describe('moving several sheets', () => {
  it('Move to folder: the selected sheets, with their families in the Family view', () => {
    const f = deepFamily()
    const doc = f.store.getState()
    expect(sheetsToMove(doc, [f.whole.id, f.day1.id], 'kind')).toEqual([f.day1.id, f.whole.id])
    const family = sheetsToMove(doc, [f.whole.id, f.day1.id], 'family')
    expect(family[0]).toBe(f.day1.id)
    expect(family).toEqual(expect.arrayContaining([f.g1.id, f.g2.id, f.scale.id, f.whole.id]))
    expect(family).not.toContain(f.other.id)
  })

  it('a drag of several into a folder, then next to a sheet in another: one step each', () => {
    const f = deepFamily()
    f.store.dispatch({ type: 'folder.add', folder: { id: F, name: 'Figures' } })
    const start = f.store.getState()
    const move = [f.g1.id, f.gOther.id]
    const into = dropCommands(start, { move, file: move }, { folder: F })
    expect(into).toEqual([{ type: 'folder.file', ids: move, folder: F }])
    f.store.dispatch(into, 'Move 2 sheets')
    expect(f.store.getState().folders![0]!.members).toEqual(move)
    // Out again, before Day 1's results: unfiled, and in the order dragged.
    const doc = f.store.getState()
    const out = dropCommands(doc, { move, file: move }, { sheet: { before: f.scale.id } })
    f.store.dispatch(out, 'Move 2 sheets')
    const after = f.store.getState()
    expect(after.folders![0]!.members).toEqual([])
    const at = after.order.indexOf(f.scale.id)
    expect(after.order.slice(at - 2, at)).toEqual(move)
    f.store.undo()
    f.store.undo()
    expect(f.store.getState()).toEqual(start)
  })

  it('a reorder within one folder files nothing; a family is filed with its table', () => {
    const f = deepFamily()
    f.store.dispatch([
      { type: 'folder.add', folder: { id: F, name: 'Figures' } },
      { type: 'folder.file', ids: [f.whole.id, f.mixed.id], folder: F },
    ])
    const doc = f.store.getState()
    expect(
      dropCommands(
        doc,
        { move: [f.mixed.id], file: [f.mixed.id] },
        { sheet: { before: f.whole.id } },
      ),
    ).toEqual([{ type: 'node.move', id: f.mixed.id, to: doc.order.indexOf(f.whole.id) }])
    const family = sheetsToMove(doc, [f.day1.id], 'family')
    const cmds = dropCommands(doc, { move: [f.day1.id], file: family }, { folder: F })
    expect(cmds).toEqual([{ type: 'folder.file', ids: family, folder: F }])
  })
})

describe('the selected graphs and pages', () => {
  it('Export selected: only the graphs and layout pages among them, in navigator order', () => {
    const f = deepFamily()
    const doc = f.store.getState()
    const items = batchItems(doc, 'figures', [f.whole.id, f.day1.id, f.g2.id, f.sum.id])
    expect(items.map((it) => [it.name, it.target.kind])).toEqual([
      ['Scale of Day 1', 'graph'],
      ['Figure Day 1', 'page'],
    ])
    expect(batchItems(doc, 'graphs', [f.whole.id])).toEqual([])
  })

  it('Match format: every other selected graph looks like the one chosen, in one step', () => {
    const f = deepFamily()
    const before = f.store.getState()
    const source = { ...f.g1, size: { plotWidth: 222, plotHeight: 111 } }
    f.store.dispatch({ type: 'node.replace', node: source }, 'Size')
    const doc = f.store.getState()
    const cmds = matchFormatCommands(doc, [f.g1.id, f.g2.id, f.gOther.id], source, {
      ...DEFAULT_MATCH_OPTIONS,
      size: true,
    })
    f.store.dispatch(cmds, 'Match format of 2 graphs')
    const size = (id: string) => (f.store.getState().nodes[id as never] as GraphNode).size
    expect(size(f.g2.id)).toMatchObject({ plotWidth: 222, plotHeight: 111 })
    expect(size(f.gOther.id)).toMatchObject({ plotWidth: 222, plotHeight: 111 })
    f.store.undo()
    expect(f.store.getState()).toEqual(doc)
    f.store.undo()
    expect(f.store.getState()).toEqual(before)
  })
})
