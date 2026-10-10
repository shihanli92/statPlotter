import { createProject, createTable, DataTable, isCellsTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { DocumentStore } from '../src/index.ts'

// Roadmap 34f: a multiple-variables table made a cells table, or not, by the user; null: back to
// automatic (by its rows). One undo step each.

function setup() {
  const table = createTable({ tableKind: 'multipleVariables', rows: 5, columns: 2 })
  const store = new DocumentStore(createProject('T', new Date('2026-01-01T00:00:00Z')))
  store.dispatch({ type: 'node.add', node: table })
  const t = () => store.getState().nodes[table.id] as DataTable
  return { store, table, t }
}

describe('table.setCellsTable', () => {
  it('sets, clears and undoes the setting', () => {
    const { store, table, t } = setup()
    expect(isCellsTable(t())).toBe(false)
    store.dispatch({ type: 'table.setCellsTable', table: table.id, on: true })
    expect(t().cellsTable).toBe(true)
    expect(isCellsTable(t())).toBe(true)
    expect(store.undoLabel).toBe('Cells table')
    store.dispatch({ type: 'table.setCellsTable', table: table.id, on: null })
    expect('cellsTable' in t()).toBe(false)
    expect(isCellsTable(t())).toBe(false)
    store.undo()
    expect(t().cellsTable).toBe(true)
    store.undo()
    expect('cellsTable' in t()).toBe(false)
    store.redo()
    expect(t().cellsTable).toBe(true)
    store.dispatch({ type: 'table.setCellsTable', table: table.id, on: false })
    expect(t().cellsTable).toBe(false)
  })

  it('keeps the table valid', () => {
    const { store, table, t } = setup()
    store.dispatch({ type: 'table.setCellsTable', table: table.id, on: true }, 'Make a cells table')
    expect(store.undoLabel).toBe('Make a cells table')
    expect(DataTable.safeParse(t()).success).toBe(true)
    expect(DataTable.safeParse({ ...t(), cellsTable: 'yes' }).success).toBe(false)
  })
})
