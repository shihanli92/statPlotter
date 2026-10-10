import { createTable, type DataTable, isCellsTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  CELLS_PROMPT_ROWS,
  cellsPromptTitle,
  needsCellsPrompt,
  withCellsChoice,
} from '../src/table/cellsTable.ts'

// Decision 456: importing a multiple-variables table of more than 5,000 rows asks whether it is
// a cells table; the answer is stored as `table.setCellsTable` stores it; Cancel imports nothing.

const table = (rows: number, kind: DataTable['tableKind'] = 'multipleVariables'): DataTable => ({
  ...createTable({ tableKind: kind, columns: 3, rows: 0 }),
  rowCount: rows,
})

describe('asking whether a big import is a cells table', () => {
  it('asks above 5,000 rows of a multiple-variables table only', () => {
    expect(CELLS_PROMPT_ROWS).toBe(5000)
    expect(needsCellsPrompt(table(5000))).toBe(false)
    expect(needsCellsPrompt(table(5001))).toBe(true)
    expect(needsCellsPrompt(table(200_000))).toBe(true)
    expect(needsCellsPrompt(table(50_000, 'column'))).toBe(false)
  })

  it('stores each answer as the table setting does, automatic where the rows agree', () => {
    const small = table(6000)
    const cells = withCellsChoice(small, 'cells')!
    expect(cells.cellsTable).toBe(true)
    expect(isCellsTable(cells)).toBe(true)
    const ordinary = withCellsChoice(small, 'ordinary')!
    expect('cellsTable' in ordinary).toBe(false)
    expect(isCellsTable(ordinary)).toBe(false)
    // Above 20,000 rows a cells table is what the rows give: stored as absent.
    const big = table(30_000)
    expect('cellsTable' in withCellsChoice(big, 'cells')!).toBe(false)
    expect(isCellsTable(withCellsChoice(big, 'cells')!)).toBe(true)
    expect(withCellsChoice(big, 'ordinary')!.cellsTable).toBe(false)
    // An answer replaces a setting the table came with.
    expect(withCellsChoice({ ...small, cellsTable: true }, 'ordinary')!.cellsTable).toBeUndefined()
  })

  it('imports nothing on Cancel', () => {
    expect(withCellsChoice(table(6000), 'cancel')).toBeNull()
  })

  it('names the table’s size', () => {
    const t = { ...table(16_171), dataSets: table(1).dataSets.slice(0, 1) }
    expect(cellsPromptTitle(t)).toBe('Large table: 16,171 rows × 1 variable')
    expect(
      cellsPromptTitle({ rowCount: 16_171, dataSets: new Array(51).fill(t.dataSets[0]) }),
    ).toBe('Large table: 16,171 rows × 51 variables')
  })
})
