import { DocumentStore } from '@ps/engine'
import { parseClipboardGrid, toHtmlTable } from '@ps/io'
import { type ColumnId, createProject, createTable, type DataTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { pastedText, tableCopy } from '../src/export/tableClipboard.ts'
import {
  type CellView,
  cellAt,
  cellDisplay,
  clearCommands,
  copyText,
  editCommands,
  gridColumns,
  INVALID_CELL,
  pasteCommands,
  selectionRows,
} from '../src/table/gridModel.ts'

/** A multiple-variables table: Weight, Height (numbers) and Group (text), 3 rows. */
function setup(kind: DataTable['tableKind'] = 'multipleVariables') {
  const table = createTable({ tableKind: kind, rows: 3, columns: 3 })
  table.dataSets.forEach((d, i) => {
    d.title = ['Weight', 'Height', 'Group'][i]!
  })
  table.dataSets[0]!.subcolumns[0]!.values = [80, 60, 90]
  table.dataSets[1]!.subcolumns[0]!.values = [2, 1.5, 0]
  if (kind === 'multipleVariables') table.dataSets[2]!.text = ['WT', 'KO', null]
  const store = new DocumentStore(createProject())
  store.dispatch({ type: 'node.add', node: table })
  const t = () => store.getState().nodes[table.id] as DataTable
  let n = 0
  const newId = () => `new${n++}` as ColumnId
  const paste = (text: string, at: { r: number; c: number }) => {
    const res = pasteCommands(t(), gridColumns(t()), at, parseClipboardGrid(text), newId)
    if (res.ok) store.dispatch(res.commands)
    return res
  }
  return { store, t, paste, ids: table.dataSets.map((d) => d.id) }
}

const dataCol = (t: DataTable, c: number) =>
  gridColumns(t)[c] as Extract<ReturnType<typeof gridColumns>[number], { kind: 'data' }>

describe('text and calculated cells in the grid', () => {
  it('shows text as typed and calculated values read-only, invalid ones marked', () => {
    const { store, t, ids } = setup()
    store.dispatch([
      { type: 'table.addDataSet', table: t().id, id: 'bmi' as never, title: 'BMI' },
      { type: 'table.setFormula', table: t().id, id: 'bmi' as never, formula: '=Weight/Height^2' },
    ])
    const cols = gridColumns(t())
    const g = cellAt(t(), cols[2]!, 1) as CellView
    expect(g.text).toBe('KO')
    expect(cellDisplay(g, false)).toBe('KO')
    const bmi0 = cellAt(t(), cols[3]!, 0) as CellView
    expect(bmi0.value).toBe(20)
    expect(bmi0.calculated).toEqual({ invalid: false })
    // Height 0: division by zero gives no number.
    const bmi2 = cellAt(t(), cols[3]!, 2) as CellView
    expect(bmi2.calculated?.invalid).toBe(true)
    expect(cellDisplay(bmi2, false)).toBe(INVALID_CELL)
    expect(cellDisplay(cellAt(t(), cols[3]!, 1) as CellView, false)).toBe('26.6667')

    expect(copyText(t(), cols, { r0: 0, c0: 0, r1: 1, c1: 3 })).toBe(
      `80\t2\tWT\t20\n60\t1.5\tKO\t${60 / 2.25}`,
    )
    // Clearing: text cells cleared, calculated cells left alone.
    store.dispatch(clearCommands(t(), cols, { r0: 0, c0: 2, r1: 0, c1: 3 }))
    expect(t().dataSets[2]!.text).toEqual([null, 'KO', null])
    expect(ids).toHaveLength(3)
  })

  it('types text into text variables, and offers to make a numeric variable text', () => {
    const { store, t } = setup()
    const text = editCommands(t(), dataCol(t(), 2), 2, ' Het ')
    expect(text.ok).toBe(true)
    if (text.ok) store.dispatch(text.commands)
    expect(t().dataSets[2]!.text).toEqual(['WT', 'KO', 'Het'])

    const word = editCommands(t(), dataCol(t(), 0), 0, 'heavy')
    expect(word.ok).toBe(false)
    if (word.ok) return
    expect(word.error).toBe('"heavy" is not a number.')
    expect(word.makeText?.question).toContain('Make “Weight” a text (categorical) variable?')
    store.dispatch(word.makeText!.commands)
    expect(t().dataSets[0]!.text).toEqual(['heavy', '60', '90'])

    // Not offered in other kinds of table.
    const col = setup('column')
    const plain = editCommands(col.t(), dataCol(col.t(), 0), 0, 'x')
    expect(plain.ok === false && plain.makeText).toBeUndefined()
  })

  it('refuses typing into calculated cells', () => {
    const { store, t } = setup()
    store.dispatch([
      { type: 'table.addDataSet', table: t().id, id: 'c' as never, title: 'C' },
      { type: 'table.setFormula', table: t().id, id: 'c' as never, formula: '=Weight*2' },
    ])
    const res = editCommands(t(), dataCol(t(), 3), 0, '5')
    expect(res.ok === false && res.error).toContain('is calculated from its formula (=Weight*2)')
  })
})

describe('pasting into multiple-variables tables', () => {
  it('pastes text into text variables and numbers as their text', () => {
    const { t, paste } = setup()
    expect(paste('Het\n7', { r: 1, c: 2 }).ok).toBe(true)
    expect(t().dataSets[2]!.text).toEqual(['WT', 'Het', '7'])
  })

  it('makes a numeric variable text when words are pasted, missing marks stay empty', () => {
    const { t, paste } = setup()
    expect(paste('NA\n65', { r: 0, c: 0 }).ok).toBe(true)
    expect(t().dataSets[0]!.text).toBeUndefined()
    expect(t().dataSets[0]!.subcolumns[0]!.values).toEqual([null, 65, 90])
    expect(paste('tall\n1.8', { r: 1, c: 1 }).ok).toBe(true)
    expect(t().dataSets[1]!.text).toEqual(['2', 'tall', '1.8'])
  })

  it('reads a header over data and adds text variables past the last column', () => {
    const { t, paste } = setup()
    const res = paste('Sex\tAge\nF\t30\nM\t41\nF\t52\nM\t60', { r: 0, c: 3 })
    expect(res.ok).toBe(true)
    const [sex, age] = t().dataSets.slice(3)
    expect(sex!.title).toBe('Sex')
    expect(sex!.text).toEqual(['F', 'M', 'F', 'M'])
    expect(age!.title).toBe('Age')
    expect(age!.subcolumns[0]!.values).toEqual([30, 41, 52, 60])
    expect(t().rowCount).toBe(4)
    expect(t().dataSets[2]!.text).toEqual(['WT', 'KO', null, null])
  })

  it('treats a first row of repeating categories as data, not a header', () => {
    const { t, paste } = setup()
    expect(paste('KO\nWT\nKO', { r: 0, c: 2 }).ok).toBe(true)
    expect(t().dataSets[2]!.title).toBe('Group')
    expect(t().dataSets[2]!.text).toEqual(['KO', 'WT', 'KO'])
  })

  it('refuses pasting into a calculated variable', () => {
    const { store, t, paste } = setup()
    store.dispatch([
      { type: 'table.addDataSet', table: t().id, id: 'c' as never, title: 'C' },
      { type: 'table.setFormula', table: t().id, id: 'c' as never, formula: '=Weight*2' },
    ])
    const res = paste('1\n2', { r: 0, c: 3 })
    expect(res.ok === false && res.error).toBe(
      'Can’t paste into “C”: it is calculated from its formula.'.replace('’', "'"),
    )
  })
})

// Audit 2 X13: copies guard formula-like text for spreadsheets; pasting a copy back into the
// grid gives the exact text.
describe('formula-like text on the clipboard', () => {
  it('is guarded for other applications and pastes back here unchanged', () => {
    const { store, t, paste } = setup()
    store.dispatch({
      type: 'table.setText',
      table: t().id,
      edits: [
        { col: t().dataSets[2]!.id, row: 0, value: '=HYPERLINK("http://x","y")' },
        { col: t().dataSets[2]!.id, row: 1, value: '-x' },
      ],
    })
    const cols = gridColumns(t())
    const sel = { r0: 0, c0: 0, r1: 1, c1: 2 }
    const copy = tableCopy(
      (guard) => copyText(t(), cols, sel, guard),
      toHtmlTable(selectionRows(t(), cols, sel), { guard: true }),
    )
    // Numbers as they are; the text guarded in both forms.
    expect(copy.text).toBe(`80\t2\t"'=HYPERLINK(""http://x"",""y"")"\n60\t1.5\t'-x`)
    expect(copy.html).toContain('&#39;-x</td>')
    // The app's own paste takes the exact text from the HTML.
    const clip = (types: Record<string, string>) => ({ getData: (k: string) => types[k] ?? '' })
    const own = pastedText(clip({ 'text/plain': copy.text, 'text/html': copy.html }))
    expect(own).toBe(copyText(t(), cols, sel))
    expect(pastedText(clip({ 'text/plain': `'=1` }))).toBe(`'=1`)
    const other = clip({ 'text/plain': 'a', 'text/html': '<table><tr><td>b</td></tr></table>' })
    expect(pastedText(other)).toBe('a')
    expect(pastedText(null)).toBe('')
    const before = t().dataSets[2]!.text
    store.dispatch(clearCommands(t(), cols, sel))
    paste(own, { r: 0, c: 0 })
    expect(t().dataSets[2]!.text).toEqual(before)
  })
})
