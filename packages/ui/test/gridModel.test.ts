import { DocumentStore } from '@ps/engine'
import { parseClipboardGrid } from '@ps/io'
import { type ColumnId, createProject, createTable, type DataTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  clearCommands,
  computedCellText,
  copyText,
  gridColumns,
  isMultiCellPaste,
  pasteCommands,
  subLabel,
} from '../src/table/gridModel.ts'

function setup(opts: Parameters<typeof createTable>[0] = {}) {
  const table = createTable({ rows: 3, columns: 2, ...opts })
  const store = new DocumentStore(createProject())
  store.dispatch({ type: 'node.add', node: table })
  const t = () => store.getState().nodes[table.id] as DataTable
  let n = 0
  const newId = () => `new${n++}` as ColumnId
  return { store, t, newId }
}

const vals = (t: DataTable) => t.dataSets.map((d) => d.subcolumns[0]!.values)

describe('gridColumns', () => {
  it('lays out row titles, then data subcolumns with role labels', () => {
    const { store, t } = setup({ yFormat: { type: 'summary', preset: 'meanSdN' } })
    store.dispatch({ type: 'table.showRowTitles', table: t().id, show: true })
    const cols = gridColumns(t())
    expect(cols.map((c) => c.kind)).toEqual([
      'rowTitle',
      'data',
      'data',
      'data',
      'data',
      'data',
      'data',
    ])
    expect(cols.map((c) => subLabel(t(), c))).toEqual(['', 'Mean', 'SD', 'N', 'Mean', 'SD', 'N'])
  })
})

describe('paste', () => {
  it('pastes 300k rows (more than a call takes arguments)', () => {
    // The commands only: applying them is the engine's (see its data-sized command tests).
    const { t, newId } = setup()
    const N = 300_000
    const grid = Array.from({ length: N }, (_, i) => [i, -i])
    const r = pasteCommands(t(), gridColumns(t()), { r: 0, c: 0 }, grid, newId)
    if (!r.ok) throw new Error(r.error)
    const set = r.commands.find((c) => c.type === 'table.setCells')
    expect(set?.type === 'table.setCells' && set.edits).toHaveLength(2 * N)
  })

  it('pastes numbers, growing rows and adding columns', () => {
    const { store, t, newId } = setup()
    const grid = parseClipboardGrid('1\t2\t3\n4\t5\t6\n7\t8\t9\n10\t11\t12\n')
    const r = pasteCommands(t(), gridColumns(t()), { r: 0, c: 0 }, grid, newId)
    expect(r.ok).toBe(true)
    if (r.ok) store.dispatch(r.commands)
    expect(t().rowCount).toBe(4)
    expect(vals(t())).toEqual([
      [1, 4, 7, 10],
      [2, 5, 8, 11],
      [3, 6, 9, 12],
    ])
    expect(t().dataSets[2]!.title).toBe('Group C')
  })

  it('treats a first row of text as column titles when pasted at the top', () => {
    const { store, t, newId } = setup()
    const r = pasteCommands(
      t(),
      gridColumns(t()),
      { r: 0, c: 0 },
      parseClipboardGrid('Control\tDrug\n1\t2\n'),
      newId,
    )
    if (!r.ok) throw new Error(r.error)
    store.dispatch(r.commands)
    expect(t().dataSets.map((d) => d.title)).toEqual(['Control', 'Drug'])
    expect(vals(t())).toEqual([
      [1, null, null],
      [2, null, null],
    ])
  })

  it('rejects text in data cells', () => {
    const { t, newId } = setup()
    const r = pasteCommands(
      t(),
      gridColumns(t()),
      { r: 1, c: 0 },
      parseClipboardGrid('1\tabc\n'),
      newId,
    )
    expect(r).toEqual({ ok: false, error: 'Can\'t paste text into a data cell: "abc".' })
  })

  it('pastes into row titles', () => {
    const { store, t, newId } = setup()
    store.dispatch({ type: 'table.showRowTitles', table: t().id, show: true })
    const r = pasteCommands(
      t(),
      gridColumns(t()),
      { r: 1, c: 0 },
      parseClipboardGrid('mouse 1\t5\nmouse 2\t6\nmouse 3\t7\n'),
      newId,
    )
    if (!r.ok) throw new Error(r.error)
    store.dispatch(r.commands)
    expect(t().rowTitles).toEqual([null, 'mouse 1', 'mouse 2', 'mouse 3'])
    expect(vals(t())[0]).toEqual([null, 5, 6, 7])
  })

  it('refuses multi-row pastes into summary column tables', () => {
    const { t, newId } = setup({ yFormat: { type: 'summary', preset: 'meanSdN' } })
    const r = pasteCommands(
      t(),
      gridColumns(t()),
      { r: 0, c: 0 },
      parseClipboardGrid('1\t2\t3\n4\t5\t6\n'),
      newId,
    )
    expect(r.ok).toBe(false)
  })
})

describe('copy and clear', () => {
  it('copies a selection as TSV and clears it', () => {
    const { store, t } = setup()
    const cols = gridColumns(t())
    const r = pasteCommands(t(), cols, { r: 0, c: 0 }, parseClipboardGrid('1\t2\n3\t4\n'))
    if (r.ok) store.dispatch(r.commands)
    expect(copyText(t(), gridColumns(t()), { r0: 0, c0: 0, r1: 1, c1: 1 })).toBe('1\t2\n3\t4')
    store.dispatch(clearCommands(t(), gridColumns(t()), { r0: 0, c0: 1, r1: 5, c1: 1 }))
    expect(vals(t())).toEqual([
      [1, 3, null],
      [null, null, null],
    ])
  })
})

describe('isMultiCellPaste', () => {
  it('tells a block of cells from one value', () => {
    expect(isMultiCellPaste('53.1\t4.2\n5.9\t12\n')).toBe(true)
    expect(isMultiCellPaste('53.1\r\n5.9\r\n')).toBe(true)
    expect(isMultiCellPaste('53.1\t4.2')).toBe(true)
    // One cell copied from a spreadsheet ends with a line break; it stays in the cell.
    expect(isMultiCellPaste('53.1\n')).toBe(false)
    expect(isMultiCellPaste('53.1')).toBe(false)
  })
})

describe('computedCellText', () => {
  it('shows result-table values to 6 significant digits', () => {
    expect(computedCellText(1.5327543789924978)).toBe('1.53275')
    expect(computedCellText(0.30000000000000004)).toBe('0.3')
    expect(computedCellText(123456789)).toBe('123456789')
    expect(computedCellText(0.000123456789)).toBe('0.000123457')
    expect(computedCellText(null)).toBe('')
  })
})
