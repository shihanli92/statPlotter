import { createProject, createTable, type DataTable, DataTable as TableSchema } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { CommandError, DocumentStore } from '../src/index.ts'

// Formatted titles (roadmap 28): commands take the plain title and, when typed with formatting,
// its runs; the plain title stays what everything else reads.

const IC50 = [{ text: 'IC' }, { text: '50', sub: true }]

function setup(kind: 'xy' | 'nested' = 'xy') {
  const table = createTable({
    tableKind: kind,
    yFormat: { type: 'replicates', count: 2 },
    columns: 2,
    rows: 3,
  })
  const store = new DocumentStore(createProject())
  store.dispatch({ type: 'node.add', node: table })
  const t = () => store.getState().nodes[table.id] as DataTable
  return { store, id: table.id, t, a: table.dataSets[0]!.id }
}

describe('rich titles', () => {
  it('renames a data set with formatting, keeping the plain title in step', () => {
    const { store, id, t, a } = setup()
    store.dispatch({ type: 'table.renameDataSet', table: id, id: a, title: 'IC50', rich: IC50 })
    expect(t().dataSets[0]!.title).toBe('IC50')
    expect(t().dataSets[0]!.titleRich).toEqual(IC50)
    // A plain rename (paste, import, formula follow-ups) drops the formatting.
    store.dispatch({ type: 'table.renameDataSet', table: id, id: a, title: 'IC50' })
    expect(t().dataSets[0]!.titleRich).toBeUndefined()
    store.undo()
    expect(t().dataSets[0]!.titleRich).toEqual(IC50)
    expect(TableSchema.safeParse(t()).success).toBe(true)
  })

  it('stores only formatted runs that spell the title', () => {
    const { store, id, t, a } = setup()
    const rename = (title: string, rich: DataTable['dataSets'][0]['titleRich']) =>
      store.dispatch({ type: 'table.renameDataSet', table: id, id: a, title, rich })
    rename('Plain', [{ text: 'Pla' }, { text: 'in' }])
    expect(t().dataSets[0]!.titleRich).toBeUndefined()
    rename('Other', IC50)
    expect(t().dataSets[0]!.titleRich).toBeUndefined()
    // Adjacent runs of one format are merged, empty runs dropped.
    rename('ab', [{ text: 'a', bold: true }, { text: '' }, { text: 'b', bold: true }])
    expect(t().dataSets[0]!.titleRich).toEqual([{ text: 'ab', bold: true }])
  })

  it('renames the X column', () => {
    const { store, id, t } = setup()
    const rich = [{ text: 'Time' }, { text: ' (h)', italic: true }]
    store.dispatch({ type: 'table.renameX', table: id, title: 'Time (h)', rich })
    expect(t().x).toMatchObject({ title: 'Time (h)', titleRich: rich })
    expect(store.undoLabel).toBe('Rename X column')
    store.dispatch({ type: 'table.renameX', table: id, title: 'Time' })
    expect(t().x!.titleRich).toBeUndefined()
    const column = createTable()
    store.dispatch({ type: 'node.add', node: column })
    expect(() => store.dispatch({ type: 'table.renameX', table: column.id, title: 'X' })).toThrow(
      CommandError,
    )
  })

  it('keeps formatted row titles with their rows', () => {
    const { store, id, t } = setup()
    const title = (row: number, text: string | null, rich?: typeof IC50) =>
      store.dispatch({ type: 'table.setRowTitle', table: id, row, title: text, rich })
    title(1, 'IC50', IC50)
    expect(t().rowTitles).toEqual([null, 'IC50', null])
    expect(t().rowTitlesRich).toEqual([null, IC50, null])
    store.dispatch({ type: 'table.insertRows', table: id, at: 0, count: 2 })
    expect(t().rowTitlesRich).toEqual([null, null, null, IC50, null])
    expect(TableSchema.safeParse(t()).success).toBe(true)
    store.dispatch({ type: 'table.deleteRows', table: id, rows: [0] })
    expect(t().rowTitlesRich).toEqual([null, null, IC50, null])
    // Deleting the only formatted row leaves no list behind.
    store.dispatch({ type: 'table.deleteRows', table: id, rows: [2] })
    expect(t().rowTitlesRich).toBeUndefined()
    store.undo()
    title(2, 'plain')
    expect(t().rowTitlesRich).toBeUndefined()
    title(0, 'IC50', IC50)
    store.dispatch({ type: 'table.showRowTitles', table: id, show: false })
    expect(t().rowTitlesRich).toBeUndefined()
  })

  it('formats subcolumn titles and trims them with the subcolumns', () => {
    const { store, id, t, a } = setup('nested')
    const rich = [{ text: 'M' }, { text: '2', sup: true }]
    store.dispatch({ type: 'table.setSubcolumnTitle', table: id, id: a, sub: 1, title: 'M2', rich })
    expect(t().dataSets[0]!.subcolumnTitlesRich).toEqual([null, rich])
    store.dispatch({ type: 'table.setReplicateCount', table: id, count: 1 })
    expect(t().dataSets[0]!.subcolumnTitlesRich).toBeUndefined()
    store.undo()
    store.dispatch({ type: 'table.setSubcolumnTitle', table: id, id: a, sub: 1, title: null })
    expect(t().dataSets[0]!.subcolumnTitlesRich).toBeUndefined()
  })
})
