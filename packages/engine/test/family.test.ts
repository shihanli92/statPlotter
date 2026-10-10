import {
  type AnalysisNode,
  createTable,
  type DataTable,
  type GraphNode,
  type LayoutNode,
  type NodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { applyToTables, duplicateFamily, familyOf, newGraphLike } from '../src/index.ts'
import { deepFamily, layout, refsOf, registry } from './familyFixture.ts'
import { outputsOf } from './graphs.ts'
import { startedEngine } from './helpers.ts'

describe('familyOf', () => {
  it('holds the chain, graphs of the table and of results, and layouts as asked', () => {
    const f = deepFamily()
    const doc = f.store.getState()
    const chain = [f.scale.id, f.sumOfScale.id, f.sum.id, f.gof.id, f.g1.id, f.g2.id]
    expect(familyOf(doc, f.day1.id, 'none')).toEqual(chain)
    expect(familyOf(doc, f.day1.id, 'whole')).toEqual([...chain, f.whole.id])
    expect(familyOf(doc, f.day1.id, 'any')).toEqual([...chain, f.whole.id, f.mixed.id])
    expect(familyOf(doc, f.other.id, 'whole')).toEqual([f.gOther.id])
  })
})

describe('duplicateFamily', () => {
  it('copies every member with each reference pointing inside the copy, originals untouched', () => {
    const f = deepFamily()
    const before = f.store.getState()
    const plan = duplicateFamily(before, f.day1.id, {
      find: 'Day 1',
      replace: 'Day 2',
      layouts: 'any',
    })
    f.store.dispatch(plan.commands, 'Duplicate family')
    const doc = f.store.getState()

    // Originals are the same objects (nothing written into them).
    for (const id of before.order) expect(doc.nodes[id]).toBe(before.nodes[id])
    const copies = plan.created.map((id) => doc.nodes[id]!)
    expect(copies.map((n) => n.name)).toEqual([
      'Day 2',
      'Scale of Day 2',
      'Sum of Scale of Day 2',
      'Sum of Day 2',
      'Expected of Day 2',
      'Day 2',
      'Scale of Day 2',
      'Figure Day 2',
      'Figure both',
    ])
    const inside = new Set<NodeId>(plan.created)
    const table = doc.nodes[plan.table] as DataTable
    expect(table.dataSets.map((d) => d.subcolumns[0]!.values)).toEqual(
      f.day1.dataSets.map((d) => d.subcolumns[0]!.values),
    )
    // The mixed page keeps its other graph (shared with the original); everything else inside.
    const mixedCopy = plan.ids.get(f.mixed.id)!
    for (const n of copies) {
      for (const r of refsOf(n)) {
        if (n.id === mixedCopy && r === f.gOther.id) continue
        expect(inside.has(r), `${n.name} → ${r}`).toBe(true)
      }
    }
    const g1 = doc.nodes[plan.ids.get(f.g1.id)!] as GraphNode
    const bracket = g1.annotations[0]!
    expect(bracket).toMatchObject({ a: f.A, b: f.B, id: f.bracket })
    expect(bracket.type === 'bracket' && bracket.label).toMatchObject({
      analysis: plan.ids.get(f.sum.id),
      comparison: `${f.A}|${f.B}`,
    })
    expect(outputsOf(g1)[0]).toMatchObject({
      ref: { node: plan.ids.get(f.sum.id), key: `curve:${f.A}` },
    })
    expect(g1.seriesSource.rows).toEqual([0, 1, 3])
    expect(g1.pointOverrides).toEqual(f.g1.pointOverrides)
    // Shared axes: the copies share a new group, not the originals'.
    const g2 = doc.nodes[plan.ids.get(f.g2.id)!] as GraphNode
    expect(g1.links?.y).toBeDefined()
    expect(g1.links?.y).not.toBe('day1axes')
    expect(g2.links?.y).toBe(g1.links?.y)
    expect(g2.seriesSource.table).toBe(plan.ids.get(f.scale.id))
    const chained = doc.nodes[plan.ids.get(f.sumOfScale.id)!] as AnalysisNode
    expect(chained.input).toEqual({ source: plan.ids.get(f.scale.id), dataSets: [f.A, f.B] })
    const page = doc.nodes[plan.ids.get(f.whole.id)!] as LayoutNode
    expect(page.items.map((it) => it.type === 'graph' && it.graph)).toEqual([
      plan.ids.get(f.g1.id),
      plan.ids.get(f.g2.id),
      false,
    ])
    // Navigator: each copy after the originals of its kind.
    expect(doc.order.indexOf(plan.table)).toBe(doc.order.indexOf(f.day1.id) + 1)
    expect(doc.order.indexOf(plan.ids.get(f.scale.id)!)).toBe(doc.order.indexOf(f.gof.id) + 1)

    // One undo step.
    f.store.undo()
    expect(f.store.getState()).toEqual(before)
  })

  it('names the table copy “(copy)” when the text is not found; layouts on request', () => {
    const f = deepFamily()
    const plan = duplicateFamily(f.store.getState(), f.day1.id, {
      find: 'xyz',
      replace: 'q',
      layouts: 'none',
    })
    f.store.dispatch(plan.commands)
    const doc = f.store.getState()
    expect(doc.nodes[plan.table]!.name).toBe('Day 1 (copy)')
    expect(plan.created.map((id) => doc.nodes[id]!.kind)).not.toContain('layout')
  })

  it('gives the copies the results of analysing the copied data', async () => {
    const f = deepFamily()
    const engine = await startedEngine(f.store, registry)
    const plan = duplicateFamily(f.store.getState(), f.day1.id, {
      find: 'Day 1',
      replace: 'Day 2',
      layouts: 'whole',
    })
    f.store.dispatch(plan.commands)
    await engine.idle()
    // The same results, but for the node ids they name (a plugin's own table id is ignored).
    const back = new Map([...plan.ids].map(([from, to]) => [to as string, from as string]))
    const same = (r: unknown) =>
      JSON.parse(
        JSON.stringify(r, (k, v) =>
          k === 'id' ? '' : typeof v === 'string' ? (back.get(v) ?? v) : v,
        ),
      )
    for (const id of [f.scale.id, f.sumOfScale.id, f.sum.id]) {
      const original = engine.latest(id)
      expect(original?.status).toBe('ok')
      expect(same(engine.latest(plan.ids.get(id)!))).toEqual(same(original))
    }
    // Edits to the copy's data change only the copy's results.
    f.store.dispatch({
      type: 'table.setCells',
      table: plan.table,
      edits: [{ col: f.A, sub: 0, row: 0, value: 101 }],
    })
    await engine.idle()
    const sum = (id: NodeId) => (engine.latest(id)!.values['Group A'] as { v: number }).v
    expect(sum(f.sum.id)).toBe(10)
    expect(sum(plan.ids.get(f.sum.id)!)).toBe(110)
  })
})

describe('newGraphLike', () => {
  it('copies the graph and the analyses it shows onto an empty copy of its table', () => {
    const f = deepFamily()
    const before = f.store.getState()
    const plan = newGraphLike(before, f.g1.id, 'Day 3')
    f.store.dispatch(plan.commands, 'New graph like this')
    const doc = f.store.getState()
    const table = doc.nodes[plan.table] as DataTable
    expect(table.name).toBe('Day 3')
    expect(table.rowTitles).toEqual(['r1', 'r2', 'r3', 'r4'])
    expect(table.dataSets.map((d) => d.id)).toEqual([f.A, f.B, f.C])
    expect(table.dataSets.every((d) => d.subcolumns[0]!.values.every((v) => v === null))).toBe(true)
    // The graph, and the analysis whose curve and bracket it shows; nothing else.
    expect(plan.created.map((id) => doc.nodes[id]!.name)).toEqual([
      'Day 3',
      'Sum of Day 3',
      'Day 3',
    ])
    const g = doc.nodes[plan.graph] as GraphNode
    expect(g.seriesSource.table).toBe(plan.table)
    expect(refsOf(g).every((r) => plan.created.includes(r))).toBe(true)
    f.store.undo()
    expect(f.store.getState()).toEqual(before)
  })

  it('refuses graphs of result tables', () => {
    const f = deepFamily()
    expect(() => newGraphLike(f.store.getState(), f.g2.id, 'x')).toThrow(/data table/)
  })
})

describe('pages with live tables, images and groups (roadmap 32)', () => {
  /** A page with live tables of Day 1 and of its sum's results, an image and a group. */
  function pages() {
    const f = deepFamily()
    const at = { x: 0, y: 0 }
    const tables: LayoutNode = {
      ...layout('Tables Day 1', [f.g1.id]),
      items: [
        {
          type: 'graph',
          id: 'i1' as never,
          graph: f.g1.id,
          scale: 1,
          ...at,
          group: 'grp1' as never,
        },
        {
          type: 'table',
          id: 'i2' as never,
          source: { kind: 'table', node: f.day1.id },
          ...at,
          group: 'grp1' as never,
        },
        {
          type: 'table',
          id: 'i3' as never,
          source: { kind: 'results', node: f.sum.id, sheet: 's' },
          ...at,
        },
        {
          type: 'image',
          id: 'i4' as never,
          asset: 'a'.repeat(32) as never,
          w: 10,
          h: 10,
          ...at,
          locked: true,
        },
      ],
    }
    // A live table of another table: not Day 1's family.
    const otherPage: LayoutNode = {
      ...layout('Tables other', []),
      items: [
        { type: 'table', id: 'j1' as never, source: { kind: 'table', node: f.other.id }, ...at },
      ],
    }
    f.store.dispatch([tables, otherPage].map((node) => ({ type: 'node.add' as const, node })))
    return { ...f, tables, otherPage }
  }

  it('counts a live table of the family (or of the table itself) as in it', () => {
    const f = pages()
    const doc = f.store.getState()
    expect(familyOf(doc, f.day1.id, 'whole')).toContain(f.tables.id)
    expect(familyOf(doc, f.day1.id, 'any')).not.toContain(f.otherPage.id)
    expect(familyOf(doc, f.other.id, 'whole')).toContain(f.otherPage.id)
  })

  it('points copied live tables at the copies; images, groups and locks are kept', () => {
    const f = pages()
    const plan = duplicateFamily(f.store.getState(), f.day1.id, {
      find: 'Day 1',
      replace: 'Day 2',
      layouts: 'whole',
    })
    f.store.dispatch(plan.commands)
    const page = f.store.getState().nodes[plan.ids.get(f.tables.id)!] as LayoutNode
    expect(page.name).toBe('Tables Day 2')
    expect(page.items).toEqual([
      { ...f.tables.items[0], graph: plan.ids.get(f.g1.id) },
      { ...f.tables.items[1], source: { kind: 'table', node: plan.table } },
      {
        ...f.tables.items[2],
        source: { kind: 'results', node: plan.ids.get(f.sum.id), sheet: 's' },
      },
      f.tables.items[3],
    ])
  })

  it('applies pages to another table: its live tables show the target', () => {
    const f = pages()
    const day2 = createTable({ name: 'Day 2', rows: 4, columns: 3 })
    f.store.dispatch({ type: 'node.add', node: day2 })
    const doc = f.store.getState()
    const plan = applyToTables(doc, f.day1.id, doc, [day2.id], {
      match: 'position',
      layouts: true,
      find: 'Day 1',
    })
    f.store.dispatch(plan.commands)
    const made = plan.created[0]!.nodes.map((id) => f.store.getState().nodes[id]!)
    const page = made.find((n) => n.name === 'Tables Day 2') as LayoutNode
    const sum = made.find((n) => n.name === 'Sum of Day 2')!
    expect(page.items[1]).toMatchObject({ source: { kind: 'table', node: day2.id } })
    expect(page.items[2]).toMatchObject({ source: { kind: 'results', node: sum.id } })
  })
})
