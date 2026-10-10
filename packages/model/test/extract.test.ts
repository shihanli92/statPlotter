import { describe, expect, it } from 'vitest'
import { createTable, DataTable, extractVariables, tableIssues } from '../src/index.ts'

function cohort() {
  const t = createTable({ tableKind: 'multipleVariables', columns: 5, rows: 6, name: 'Cohort' })
  const [group, sex, before, after, change] = t.dataSets
  group!.title = 'Group'
  group!.text = ['WT', 'KO', 'WT', 'KO', null, 'WT']
  sex!.title = 'Sex'
  sex!.text = ['F', 'F', 'M', 'M', 'F', null]
  before!.title = 'Before'
  before!.subcolumns[0]!.values = [1, 2, 3, 4, 5, 6]
  after!.title = 'After'
  after!.subcolumns[0]!.values = [2, null, 5, 7, 8, 9]
  change!.title = 'Change'
  change!.formula = '=After - Before'
  return t
}

describe('extract and rearrange', () => {
  it('lays variables side by side, rows aligned (a column table)', () => {
    const t = cohort()
    const [, , before, after, change] = t.dataSets.map((d) => d.id)
    const { table, leftOut } = extractVariables(t, { values: [before!, after!, change!] })
    expect(tableIssues(table)).toEqual([])
    expect(() => DataTable.parse(table)).not.toThrow()
    expect(table.tableKind).toBe('column')
    expect(table.name).toBe('Cohort (extracted)')
    expect(table.dataSets.map((d) => d.title)).toEqual(['Before', 'After', 'Change'])
    expect(table.dataSets[1]!.subcolumns[0]!.values).toEqual([2, null, 5, 7, 8, 9])
    // The calculated variable's values.
    expect(table.dataSets[2]!.subcolumns[0]!.values).toEqual([1, null, 2, 3, 3, 3])
    expect(leftOut).toBe(0)
  })

  it('groups a variable by the categories of a text variable', () => {
    const t = cohort()
    const [group, , before] = t.dataSets.map((d) => d.id)
    const { table, leftOut } = extractVariables(t, { values: [before!], groupBy: group! })
    expect(tableIssues(table)).toEqual([])
    expect(table.tableKind).toBe('column')
    expect(table.dataSets.map((d) => d.title)).toEqual(['WT', 'KO'])
    expect(table.dataSets.map((d) => d.subcolumns[0]!.values)).toEqual([
      [1, 3, 6],
      [2, 4, null],
    ])
    // Row 5 (value 5) has no group.
    expect(leftOut).toBe(1)
  })

  it('makes a grouped table with a second text variable as rows', () => {
    const t = cohort()
    const [group, sex, , after] = t.dataSets.map((d) => d.id)
    const { table, leftOut } = extractVariables(t, {
      values: [after!],
      groupBy: group!,
      rowsBy: sex!,
      name: 'After by group and sex',
    })
    expect(tableIssues(table)).toEqual([])
    expect(table.tableKind).toBe('grouped')
    expect(table.rowTitles).toEqual(['F', 'M'])
    expect(table.yFormat).toEqual({ type: 'replicates', count: 1 })
    // WT: F → 2, M → 5; KO: F → (empty), M → 7. Rows 4 and 5 lack a group / sex.
    expect(table.dataSets.map((d) => d.subcolumns.map((c) => c.values))).toEqual([
      [[2, 5]],
      [[null, 7]],
    ])
    expect(leftOut).toBe(2)
  })

  it('refuses what it cannot rearrange', () => {
    const t = cohort()
    const [group, sex, before, after] = t.dataSets.map((d) => d.id)
    expect(() => extractVariables(t, { values: [] })).toThrow('choose a variable')
    expect(() => extractVariables(t, { values: [group!] })).toThrow('is a text variable')
    expect(() => extractVariables(t, { values: [before!], groupBy: before! })).toThrow(
      'text variable',
    )
    expect(() => extractVariables(t, { values: [before!, after!], groupBy: group! })).toThrow(
      'one variable',
    )
    expect(() => extractVariables(t, { values: [before!], rowsBy: sex! })).toThrow(
      'data sets by category',
    )
  })
})
