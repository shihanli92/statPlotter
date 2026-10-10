import { createProject, createTable, type DataTable, type Project } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { applyCommand } from '../src/index.ts'

/**
 * Pastes and row inserts of more values than a call takes arguments (~120k): spreading them into
 * `Math.max(...)` or `splice(...)` overflowed the call stack.
 */
const N = 300_000

function setup(kind: DataTable['tableKind'] = 'column') {
  const table = createTable({ tableKind: kind, rows: 3, columns: 2 })
  table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
  const doc: Project = createProject()
  doc.nodes[table.id] = table
  doc.order.push(table.id)
  return { doc, table, t: () => doc.nodes[table.id] as DataTable }
}

describe('data-sized commands', () => {
  it('pastes 300k cells, growing the table', () => {
    const { doc, table, t } = setup()
    const col = table.dataSets[1]!.id
    const edits = Array.from({ length: N }, (_, row) => ({ col, sub: 0, row, value: row }))
    applyCommand(doc, { type: 'table.setCells', table: table.id, edits })
    expect(t().rowCount).toBe(N)
    expect(t().dataSets[1]!.subcolumns[0]!.values[N - 1]).toBe(N - 1)
    expect(t().dataSets[0]!.subcolumns[0]!.values).toHaveLength(N)
    expect(t().dataSets[0]!.subcolumns[0]!.values[N - 1]).toBeNull()
  })

  it('pastes 300k text cells', () => {
    const { doc, table, t } = setup('multipleVariables')
    const col = table.dataSets[1]!.id
    applyCommand(doc, { type: 'table.setVariableType', table: table.id, ids: [col], to: 'text' })
    const edits = Array.from({ length: N }, (_, row) => ({ col, row, value: `s${row}` }))
    applyCommand(doc, { type: 'table.setText', table: table.id, edits })
    expect(t().rowCount).toBe(N)
    expect(t().dataSets[1]!.text![N - 1]).toBe(`s${N - 1}`)
  })

  it('reverses 300k rows', () => {
    const { doc, table, t } = setup()
    applyCommand(doc, { type: 'table.insertRows', table: table.id, at: 3, count: N - 3 })
    const order = Array.from({ length: N }, (_, i) => N - 1 - i)
    applyCommand(doc, { type: 'table.permuteRows', table: table.id, order })
    const values = t().dataSets[0]!.subcolumns[0]!.values
    expect(values).toHaveLength(N)
    expect(values.slice(-3)).toEqual([3, 2, 1])
  })

  it('inserts 300k rows in the middle', () => {
    const { doc, table, t } = setup()
    applyCommand(doc, { type: 'table.insertRows', table: table.id, at: 1, count: N })
    const values = t().dataSets[0]!.subcolumns[0]!.values
    expect(t().rowCount).toBe(N + 3)
    expect(values).toHaveLength(N + 3)
    expect([values[0], values[1], values[N], values[N + 1], values[N + 2]]).toEqual([
      1,
      null,
      null,
      2,
      3,
    ])
  })
})
