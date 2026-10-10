import {
  createProject,
  DataTable,
  DEFAULT_LIMIT_RULE,
  type LimitFlag,
  type NodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { CommandError, DocumentStore } from '../src/index.ts'

// Roadmap 39: cells imported at a detection limit through table edits, and the rule changed later.

const flag = (text: string, side: LimitFlag['side'] = 'below'): LimitFlag => ({ side, text })

function store() {
  const table = DataTable.parse({
    kind: 'table',
    id: 'lt1',
    name: 'Cytokines',
    tableKind: 'column',
    yFormat: { type: 'replicates', count: 1 },
    rowCount: 4,
    rowTitles: null,
    x: null,
    dataSets: [
      {
        id: 'il6',
        title: 'IL-6',
        subcolumns: [
          {
            type: 'number',
            values: [0.25, 3, null, 1],
            limit: [flag('<0.5'), null, flag('BLQ'), null],
          },
        ],
      },
      {
        id: 'tnf',
        title: 'TNF',
        subcolumns: [
          {
            type: 'number',
            values: [5, null, 2, 8],
            limit: [null, flag('>ULOQ', 'above'), null, null],
          },
        ],
      },
    ],
    notes: '',
    limits: DEFAULT_LIMIT_RULE,
  })
  const p = createProject('P')
  p.nodes[table.id] = table
  p.order.push(table.id)
  return { s: new DocumentStore(p), id: table.id as NodeId }
}

const tableOf = (s: DocumentStore, id: NodeId) => s.getState().nodes[id] as DataTable
const col = (s: DocumentStore, id: NodeId, k: number) => tableOf(s, id).dataSets[k]!.subcolumns[0]!

describe('table.setLimits (roadmap 39)', () => {
  it('substitutes again from the kept text under a new rule, in one undo step', () => {
    const { s, id } = store()
    s.dispatch({
      type: 'table.setLimits',
      table: id,
      rule: {
        below: { method: 'sqrt2' },
        above: { method: 'fixed', value: 1000 },
        lower: { columns: { il6: 0.2 } },
      },
    })
    expect(col(s, id, 0).values).toEqual([0.5 / Math.SQRT2, 3, 0.2 / Math.SQRT2, 1])
    expect(col(s, id, 1).values).toEqual([5, 1000, 2, 8])
    expect(col(s, id, 0).limit).toEqual([flag('<0.5'), null, flag('BLQ'), null])
    expect(tableOf(s, id).limits?.below.method).toBe('sqrt2')
    expect(DataTable.safeParse(tableOf(s, id)).success).toBe(true)
    s.undo()
    expect(col(s, id, 0).values).toEqual([0.25, 3, null, 1])
    expect(tableOf(s, id).limits).toEqual(DEFAULT_LIMIT_RULE)
  })

  it('drops the rule and the flags with null, keeping the values', () => {
    const { s, id } = store()
    s.dispatch({ type: 'table.setLimits', table: id, rule: null })
    expect(col(s, id, 0).limit).toBeUndefined()
    expect(col(s, id, 0).values).toEqual([0.25, 3, null, 1])
    expect(tableOf(s, id).limits).toBeUndefined()
  })

  it('refuses something that isn’t a rule', () => {
    const { s, id } = store()
    expect(() =>
      s.dispatch({
        type: 'table.setLimits',
        table: id,
        rule: { below: { method: 'third' } } as never,
      }),
    ).toThrow(CommandError)
  })

  it('unflags a cell typed over, and keeps flags with their rows through inserts, deletes and sorts', () => {
    const { s, id } = store()
    s.dispatch({
      type: 'table.setCells',
      table: id,
      edits: [{ col: 'il6' as never, sub: 0, row: 0, value: 0.4 }],
    })
    expect(col(s, id, 0).limit).toEqual([null, null, flag('BLQ'), null])
    s.dispatch({ type: 'table.insertRows', table: id, at: 0, count: 1 })
    expect(col(s, id, 0).limit).toEqual([null, null, null, flag('BLQ'), null])
    s.dispatch({ type: 'table.permuteRows', table: id, order: [3, 0, 1, 2, 4] })
    expect(col(s, id, 0).limit?.[0]).toEqual(flag('BLQ'))
    s.dispatch({ type: 'table.deleteRows', table: id, rows: [0] })
    // The last flag of the data set gone: no array left.
    expect(col(s, id, 0).limit).toBeUndefined()
    expect(col(s, id, 1).limit).toEqual([null, null, flag('>ULOQ', 'above'), null])
    expect(DataTable.safeParse(tableOf(s, id)).success).toBe(true)
  })
})
