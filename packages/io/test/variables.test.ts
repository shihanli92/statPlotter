import { createProject, createTable, type DataTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  isTextColumn,
  readCsv,
  readProjectFile,
  readPzfx,
  type Sheet,
  sheetToTable,
  writeProjectFile,
} from '../src/index.ts'

const sheet = (rows: Sheet['rows']): Sheet => ({ name: 's', rows })

describe('multiple-variables import', () => {
  it('keeps columns of words as text variables and numbers as numbers', () => {
    const csv = readCsv(
      'Id,Group,Sex,Age,Weight,Note\nP1,WT,F,30,61.5,ok\nP2,KO,M,41,NA,x\nP3,WT,M,52,70,3\nP4,KO,F,n/a,55.2,\n',
    )
    const { table, warnings, account } = sheetToTable(csv, {
      name: 'Cohort',
      tableKind: 'multipleVariables',
      headerRow: true,
      firstColumn: 'rowTitles',
    })
    expect(warnings).toEqual([])
    expect(table.tableKind).toBe('multipleVariables')
    expect(table.rowTitles).toEqual(['P1', 'P2', 'P3', 'P4'])
    expect(table.dataSets.map((d) => d.title)).toEqual(['Group', 'Sex', 'Age', 'Weight', 'Note'])
    const [group, sex, age, weight, note] = table.dataSets
    expect(group!.text).toEqual(['WT', 'KO', 'WT', 'KO'])
    expect(group!.subcolumns[0]!.values).toEqual([null, null, null, null])
    expect(sex!.text).toEqual(['F', 'M', 'M', 'F'])
    expect(age!.text).toBeUndefined()
    expect(age!.subcolumns[0]!.values).toEqual([30, 41, 52, null])
    expect(weight!.subcolumns[0]!.values).toEqual([61.5, null, 70, 55.2])
    // Mostly words: text, the number kept as its text.
    expect(note!.text).toEqual(['ok', 'x', '3', null])
    // Numbers in text variables count as read.
    expect(account?.leftOut).toEqual([])
  })

  it('keeps a numeric column with a stray word numeric, counting the word', () => {
    const { table, warnings } = sheetToTable(
      sheet([
        ['A', 'B'],
        [1, 'x'],
        [2, 3],
        ['oops', 4],
        [4, 5],
      ]),
      { name: 't', tableKind: 'multipleVariables', headerRow: true, firstColumn: 'data' },
    )
    expect(table.dataSets[0]!.subcolumns[0]!.values).toEqual([1, 2, null, 4])
    expect(table.dataSets[1]!.subcolumns[0]!.values).toEqual([null, 3, 4, 5])
    expect(warnings).toEqual([
      '2 non-numeric cells in numeric variables were imported as empty (first: “oops” in A).',
    ])
    expect(isTextColumn(['a', 'b', 1])).toBe(true)
    expect(isTextColumn([1, 2, 'NA', null])).toBe(false)
    expect(isTextColumn(['a', 1, 2, 3])).toBe(false)
  })

  it('saves and opens text and calculated variables unchanged', () => {
    const t = createTable({ tableKind: 'multipleVariables', rows: 2, columns: 3 })
    t.dataSets[0]!.text = ['WT', null]
    t.dataSets[1]!.subcolumns[0]!.values = [1, 2]
    t.dataSets[1]!.title = 'A'
    t.dataSets[2]!.formula = '=A * 2'
    const project = createProject()
    project.nodes[t.id] = t
    project.order.push(t.id)
    const back = readProjectFile(writeProjectFile(project)).project.nodes[t.id] as DataTable
    expect(back.dataSets[0]!.text).toEqual(['WT', null])
    expect(back.dataSets[2]!.formula).toBe('=A * 2')
    expect(back.dataSets[2]!.subcolumns[0]!.values).toEqual([null, null])
  })

  it('reads pzfx multiple-variables tables, text columns as text variables', () => {
    const { tables, warnings } = readPzfx(
      `<?xml version="1.0"?><GraphPadPrismFile PrismXMLVersion="5.00">
      <Table TableType="MultipleVariables" YFormat="replicates" Replicates="1"><Title>MV</Title>
        <YColumn><Title>Group</Title><Subcolumn><d>WT</d><d>KO</d><d/></Subcolumn></YColumn>
        <YColumn><Title>Age</Title><Subcolumn><d>30</d><d>41,5</d><d>52</d></Subcolumn></YColumn>
      </Table></GraphPadPrismFile>`,
    )
    expect(warnings).toEqual([])
    const t = tables[0]!
    expect(t.tableKind).toBe('multipleVariables')
    expect(t.dataSets[0]!.text).toEqual(['WT', 'KO', null])
    expect(t.dataSets[1]!.subcolumns[0]!.values).toEqual([30, 41.5, 52])
  })
})
