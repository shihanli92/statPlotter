import { DocumentStore } from '@ps/engine'
import {
  createProject,
  createTable,
  type DataTable,
  type GridColumn,
  gridColumns,
  type NodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fitWidth } from '../src/table/columnWidths.ts'
import { cellShown, choiceOf, displayOf, groupThousands, shownText } from '../src/table/display.ts'
import {
  fillDownCommands,
  fillRightCommands,
  fillSeriesCommands,
  seriesValues,
} from '../src/table/fill.ts'
import {
  findMatches,
  matchRanges,
  replaceCommands,
  replaceRuns,
  replaceText,
} from '../src/table/find.ts'
import type { Rect } from '../src/table/gridModel.ts'
import { edgeIndex, navigate } from '../src/table/navigation.ts'
import {
  columnLabel,
  dropIndex,
  moveDataSetsCommand,
  moveRowsOrder,
  sortCommand,
  sortOrder,
} from '../src/table/reorder.ts'

// Table editing (roadmap 29): sort, move, fill, find and replace, column formats and widths.

/** A table in a store; `set` fills data sets by column (numbers, or text for text variables). */
function setup(opts: Parameters<typeof createTable>[0] = {}) {
  const table = createTable({ rows: 4, columns: 2, ...opts })
  const store = new DocumentStore(createProject())
  store.dispatch({ type: 'node.add', node: table })
  const t = () => store.getState().nodes[table.id] as DataTable
  const cols = () => gridColumns(t())
  const run = (cmds: Parameters<typeof store.dispatch>[0] | null) => {
    if (cmds) store.dispatch(cmds)
  }
  return { store, t, cols, run, id: table.id as NodeId }
}

const values = (t: DataTable, i = 0) => t.dataSets[i]!.subcolumns[0]!.values
const rect = (r0: number, c0: number, r1: number, c1: number): Rect => ({ r0, c0, r1, c1 })
const col = (t: DataTable, kind: GridColumn['kind'], i = 0): GridColumn =>
  gridColumns(t).filter((c) => c.kind === kind)[i]!

describe('sorting rows', () => {
  function table() {
    const s = setup({ tableKind: 'grouped', rows: 6, columns: 2 })
    const edits = [3, null, 1, 3, 10, 2].map((value, row) => ({
      col: s.t().dataSets[0]!.id,
      sub: 0,
      row,
      value,
    }))
    s.run({ type: 'table.setCells', table: s.id, edits })
    const titles = ['b', 'Mouse 10', 'a', 'B', null, 'Mouse 2']
    for (const [row, title] of titles.entries())
      s.run({ type: 'table.setRowTitle', table: s.id, row, title })
    return s
  }

  it('sorts numbers by value with blanks last either way, stably', () => {
    const { t } = table()
    const key = (descending: boolean) => [{ col: col(t(), 'data'), descending }]
    expect(sortOrder(t(), key(false))).toEqual([2, 5, 0, 3, 4, 1])
    expect(sortOrder(t(), key(true))).toEqual([4, 0, 3, 5, 2, 1])
  })

  it('sorts text ignoring case, with numbers in it in numeric order; then by a second key', () => {
    const { t } = table()
    const titles = { col: col(t(), 'rowTitle'), descending: false }
    // "b" and "B" tie on the first key: kept in table order, or ordered by the second key.
    expect(sortOrder(t(), [titles])).toEqual([2, 0, 3, 5, 1, 4])
    const byValueDown = { col: col(t(), 'data'), descending: true }
    expect(sortOrder(t(), [titles, byValueDown])).toEqual([2, 0, 3, 5, 1, 4])
    expect(columnLabel(t(), titles.col)).toBe('Row titles')
  })

  it('gives one undoable permutation, or nothing when already in order', () => {
    const { t, run, store } = table()
    run(sortCommand(t(), [{ col: col(t(), 'data'), descending: false }]))
    expect(values(t())).toEqual([1, 2, 3, 3, 10, null])
    expect(t().rowTitles).toEqual(['a', 'Mouse 2', 'b', 'B', null, 'Mouse 10'])
    expect(sortCommand(t(), [{ col: col(t(), 'data'), descending: false }])).toBeNull()
    store.undo()
    expect(values(t())).toEqual([3, null, 1, 3, 10, 2])
  })

  it('sorts text variables and X', () => {
    const mv = setup({ tableKind: 'multipleVariables', rows: 3, columns: 1 })
    mv.run({
      type: 'table.setVariableType',
      table: mv.id,
      ids: [mv.t().dataSets[0]!.id],
      to: 'text',
    })
    mv.run({
      type: 'table.setText',
      table: mv.id,
      edits: ['pear', 'Apple', 'fig'].map((value, row) => ({
        col: mv.t().dataSets[0]!.id,
        row,
        value,
      })),
    })
    expect(sortOrder(mv.t(), [{ col: col(mv.t(), 'data'), descending: false }])).toEqual([1, 2, 0])
    const xy = setup({ tableKind: 'xy', rows: 3, columns: 1 })
    xy.run({
      type: 'table.setCells',
      table: xy.id,
      edits: [5, -1, 2].map((value, row) => ({ col: 'x' as const, sub: 0, row, value })),
    })
    expect(sortOrder(xy.t(), [{ col: col(xy.t(), 'x'), descending: true }])).toEqual([0, 2, 1])
  })
})

describe('moving rows and data sets', () => {
  it('moves a block of rows among the others', () => {
    expect(moveRowsOrder(5, 1, 2, 0)).toEqual([1, 2, 0, 3, 4])
    expect(moveRowsOrder(5, 1, 2, 3)).toEqual([0, 3, 4, 1, 2])
    // Rows past the table are clipped; a block past the end moves nothing.
    expect(moveRowsOrder(3, 1, 9, 0)).toEqual([1, 2, 0])
    expect(moveRowsOrder(3, 5, 6, 0)).toEqual([0, 1, 2])
  })

  it('drops a dragged block before items above it and after items below it', () => {
    expect(dropIndex(2, 3, 0)).toBe(0)
    expect(dropIndex(2, 3, 5)).toBe(4)
    expect(dropIndex(2, 3, 3)).toBeNull()
    // Dropped on the last of 6 rows: the block (2…3) ends last.
    expect(moveRowsOrder(6, 2, 3, dropIndex(2, 3, 5)!)).toEqual([0, 1, 4, 5, 2, 3])
  })

  it('moves data sets by a step or to a place; X stays first', () => {
    const { t, run } = setup({ tableKind: 'xy', columns: 3 })
    const [a, b, c] = t().dataSets.map((d) => d.id) as [never, never, never]
    expect(moveDataSetsCommand(t(), [a], { step: -1 })).toBeNull()
    run(moveDataSetsCommand(t(), [a], { step: 1 }))
    expect(t().dataSets.map((d) => d.id)).toEqual([b, a, c])
    run(moveDataSetsCommand(t(), [b, a], { to: 1 }))
    expect(t().dataSets.map((d) => d.id)).toEqual([c, b, a])
    expect(gridColumns(t())[0]!.kind).toBe('x')
  })
})

describe('fill', () => {
  it('fills down and right from the first cells, keeping exclusion out', () => {
    const { t, cols, run, id } = setup({ rows: 4, columns: 3 })
    const [a] = t().dataSets.map((d) => d.id)
    run({ type: 'table.setCells', table: id, edits: [{ col: a!, sub: 0, row: 0, value: 7 }] })
    run({
      type: 'table.setExcluded',
      table: id,
      cells: [{ col: a!, sub: 0, row: 0 }],
      excluded: true,
    })
    const down = fillDownCommands(t(), cols(), rect(0, 0, 3, 0))
    expect(down.ok).toBe(true)
    if (down.ok) run(down.commands)
    expect(values(t())).toEqual([7, 7, 7, 7])
    expect(t().dataSets[0]!.subcolumns[0]!.excluded).toEqual([true, false, false, false])
    const right = fillRightCommands(t(), cols(), rect(1, 0, 2, 2))
    if (right.ok) run(right.commands)
    expect(t().dataSets.map((d) => d.subcolumns[0]!.values[1])).toEqual([7, 7, 7])
    expect(values(t(), 2)).toEqual([null, 7, 7, null])
  })

  it('refuses text into number columns and values into calculated variables', () => {
    const { t, cols, run, id } = setup({ tableKind: 'grouped', rows: 3, columns: 1 })
    const r = fillRightCommands(t(), cols(), rect(0, 0, 0, 1))
    expect(r).toEqual({ ok: false, error: 'Can\'t fill text into a data cell: "Row 1".' })
    const mv = setup({ tableKind: 'multipleVariables', rows: 2, columns: 2 })
    const [x, f] = mv.t().dataSets.map((d) => d.id)
    mv.run({ type: 'table.setCells', table: mv.id, edits: [{ col: x!, sub: 0, row: 0, value: 1 }] })
    mv.run({ type: 'table.setFormula', table: mv.id, id: f!, formula: '=1' })
    const calc = fillRightCommands(mv.t(), mv.cols(), rect(0, 0, 0, 1))
    expect(calc.ok).toBe(false)
    if (!calc.ok) expect(calc.error).toMatch(/calculated from its formula/)
    // Row titles fill down as text.
    run({ type: 'table.setRowTitle', table: id, row: 0, title: 'Ctrl' })
    const titles = fillDownCommands(t(), cols(), rect(0, 0, 2, 0))
    if (titles.ok) run(titles.commands)
    expect(t().rowTitles).toEqual(['Ctrl', 'Ctrl', 'Ctrl'])
  })

  it('makes linear, multiplied and log series without floating-point noise', () => {
    expect(seriesValues({ kind: 'linear', start: 0, step: 0.1 }, 4)).toEqual([0, 0.1, 0.2, 0.3])
    expect(seriesValues({ kind: 'multiply', start: 100, factor: 0.5 }, 4)).toEqual([
      100, 50, 25, 12.5,
    ])
    expect(seriesValues({ kind: 'multiply', start: 1e-9, factor: 10 }, 3)).toEqual([
      1e-9, 1e-8, 1e-7,
    ])
    expect(seriesValues({ kind: 'log', start: 1, end: 1000 }, 4)).toEqual([1, 10, 100, 1000])
    expect(seriesValues({ kind: 'log', start: 0, end: 10 }, 3)).toMatch(/above zero/)
    expect(seriesValues({ kind: 'multiply', start: 1, factor: 0 }, 3)).toMatch(/other than zero/)
    expect(seriesValues({ kind: 'linear', start: Number.NaN, step: 1 }, 3)).toMatch(/start/)
    expect(seriesValues({ kind: 'multiply', start: 1, factor: 1e300 }, 3)).toMatch(/too large/)
  })

  it('fills a series down the selected columns or a count of rows, growing the table', () => {
    const { t, cols, store } = setup({ rows: 2, columns: 2 })
    const r = fillSeriesCommands(
      t(),
      cols(),
      rect(0, 0, 0, 1),
      { kind: 'linear', start: 1, step: 2 },
      4,
    )
    if (r.ok) store.dispatch(r.commands, 'Fill series')
    expect(t().rowCount).toBe(4)
    expect(values(t(), 0)).toEqual([1, 3, 5, 7])
    expect(values(t(), 1)).toEqual([1, 3, 5, 7])
    store.undo()
    expect(t().rowCount).toBe(2)
  })
})

describe('find and replace', () => {
  const plain = { matchCase: false, wholeCell: false }

  it('matches text, case and whole cells', () => {
    expect(matchRanges('Mouse mouse', 'mouse', plain)).toEqual([
      [0, 5],
      [6, 11],
    ])
    expect(matchRanges('Mouse mouse', 'mouse', { ...plain, matchCase: true })).toEqual([[6, 11]])
    expect(matchRanges('Mouse', 'mouse', { ...plain, wholeCell: true })).toEqual([[0, 5]])
    expect(matchRanges('Mouse 1', 'mouse', { ...plain, wholeCell: true })).toEqual([])
    expect(matchRanges('a.b', '.', plain)).toEqual([[1, 2]])
    expect(replaceText('1.5 and 1.5', '1.5', '2', plain)).toBe('2 and 2')
  })

  it('keeps a title’s formatting: the replacement takes the format of what it replaces', () => {
    const runs = [{ text: 'IC' }, { text: '50', sub: true }, { text: ' (nM)', italic: true }]
    expect(replaceRuns(runs, '50', '90', plain)).toEqual([
      { text: 'IC' },
      { text: '90', sub: true },
      { text: ' (nM)', italic: true },
    ])
    expect(replaceRuns(runs, 'nm', 'µM', plain)).toEqual([
      { text: 'IC' },
      { text: '50', sub: true },
      { text: ' (µM)', italic: true },
    ])
  })

  function table() {
    const s = setup({ tableKind: 'grouped', rows: 3, columns: 2 })
    const [a, b] = s.t().dataSets.map((d) => d.id)
    s.run([
      { type: 'table.renameDataSet', table: s.id, id: a!, title: 'Dose 1' },
      {
        type: 'table.setCells',
        table: s.id,
        edits: [
          { col: a!, sub: 0, row: 0, value: 1.5 },
          { col: a!, sub: 0, row: 2, value: 11 },
          { col: b!, sub: 0, row: 1, value: 21 },
        ],
      },
    ])
    return s
  }

  it('finds titles, then cells row by row; numbers by their entered value', () => {
    const { t, cols } = table()
    expect(findMatches(t(), cols(), '1', plain)).toEqual([
      { kind: 'title', c: 1 },
      { kind: 'cell', r: 0, c: 0 },
      { kind: 'cell', r: 0, c: 1 },
      { kind: 'cell', r: 1, c: 2 },
      { kind: 'cell', r: 2, c: 1 },
    ])
    expect(findMatches(t(), cols(), '1', { ...plain, wholeCell: true })).toEqual([])
    expect(findMatches(t(), cols(), 'row 2', plain)).toEqual([{ kind: 'cell', r: 1, c: 0 }])
  })

  it('replaces all in one undo step; numbers must stay numbers', () => {
    const { t, cols, store } = table()
    const all = findMatches(t(), cols(), '1', plain)
    const bad = replaceCommands(t(), cols(), all, '1', 'x', plain)
    expect(bad).toEqual({ ok: false, error: '"x.5" is not a number.' })
    const good = replaceCommands(t(), cols(), all, '1', '3', plain)
    expect(good.ok && good.replaced).toBe(5)
    if (good.ok) store.dispatch(good.commands, 'Replace all')
    expect(t().dataSets[0]!.title).toBe('Dose 3')
    expect(t().rowTitles).toEqual(['Row 3', 'Row 2', 'Row 3'])
    expect(values(t())).toEqual([3.5, null, 33])
    expect(values(t(), 1)).toEqual([null, 23, null])
    store.undo()
    expect(values(t())).toEqual([1.5, null, 11])
    expect(t().dataSets[0]!.title).toBe('Dose 1')
  })

  it('leaves calculated cells alone and replaces text variables', () => {
    const mv = setup({ tableKind: 'multipleVariables', rows: 2, columns: 2 })
    const [x, f] = mv.t().dataSets.map((d) => d.id)
    mv.run([
      { type: 'table.setVariableType', table: mv.id, ids: [x!], to: 'text' },
      { type: 'table.setText', table: mv.id, edits: [{ col: x!, row: 0, value: 'wt 7' }] },
      { type: 'table.setFormula', table: mv.id, id: f!, formula: '=7' },
    ])
    const all = findMatches(mv.t(), mv.cols(), '7', plain)
    expect(all).toHaveLength(3)
    const r = replaceCommands(mv.t(), mv.cols(), all, '7', '8', plain)
    expect(r.ok && [r.replaced, r.skipped]).toEqual([1, 2])
    if (r.ok) mv.run(r.commands)
    expect(mv.t().dataSets[0]!.text).toEqual(['wt 8', null])
  })
})

describe('column number formats', () => {
  const cell = (value: number) => ({ value, excluded: false })
  const show = (value: number, display: Parameters<typeof cellShown>[1]) =>
    shownText(cellShown(cell(value), display, false))

  it('shows numbers in the column’s format; text and blanks as they are', () => {
    expect(show(1234.5678, undefined)).toBe('1234.5678')
    expect(show(1234.5678, { mode: 'fixed', digits: 2 })).toBe('1234.57')
    expect(show(1234.5678, { mode: 'fixed', digits: 1, thousands: true })).toBe('1,234.6')
    expect(show(1234.5678, { mode: 'scientific', digits: 2 })).toBe('1.23e+3')
    expect(show(1234.5678, { mode: 'power10', digits: 1 })).toBe('1.2×10^3')
    expect(show(0.256, { mode: 'percent', digits: 1 })).toBe('25.6%')
    expect(show(-1234567.25, { mode: 'auto', thousands: true })).toBe('-1,234,567.25')
    expect(groupThousands('1e+21')).toBe('1e+21')
    expect(cellShown({ value: null, excluded: false, text: 'wt' }, { mode: 'fixed' }, false)).toBe(
      'wt',
    )
  })

  it('maps the dialog’s choices to stored formats and back', () => {
    expect(displayOf({ mode: 'entered', digits: 2, thousands: false })).toBeNull()
    expect(displayOf({ mode: 'entered', digits: 2, thousands: true })).toEqual({
      mode: 'auto',
      thousands: true,
    })
    expect(displayOf({ mode: 'scientific', digits: 3, thousands: true })).toEqual({
      mode: 'scientific',
      digits: 3,
    })
    for (const d of [
      { mode: 'fixed', digits: 4 },
      { mode: 'percent', digits: 0, thousands: true },
    ] as const)
      expect(displayOf(choiceOf(d))).toEqual(d)
  })

  it('fits a column to its widest cell as shown, and its title', () => {
    const { t, run, id } = setup({ rows: 2, columns: 1 })
    const a = t().dataSets[0]!.id
    run({
      type: 'table.setCells',
      table: id,
      edits: [{ col: a, sub: 0, row: 0, value: 123456.789 }],
    })
    const measure = (text: string) => text.length * 10
    expect(fitWidth(t(), gridColumns(t()), a, measure)).toBe(10 * 10 + 20)
    run({ type: 'table.setDisplay', table: id, cols: [a], display: { mode: 'fixed', digits: 0 } })
    // "Group A" (7) is now wider than "123457" (6).
    expect(fitWidth(t(), gridColumns(t()), a, measure)).toBe(7 * 10 + 20)
  })
})

describe('keyboard navigation', () => {
  it('jumps to the edge of the data as spreadsheets do', () => {
    const filled = (cells: string) => (i: number) => cells[i] === 'x'
    // From a filled run: its end. From a blank or a run's end: the next filled cell, or the end.
    expect(edgeIndex(0, 1, 7, filled('xxx..x..'))).toBe(2)
    expect(edgeIndex(2, 1, 7, filled('xxx..x..'))).toBe(5)
    expect(edgeIndex(5, 1, 7, filled('xxx..x..'))).toBe(7)
    expect(edgeIndex(7, 1, 7, filled('xxx..x..'))).toBe(7)
    expect(edgeIndex(7, -1, 7, filled('xxx..x..'))).toBe(5)
    expect(edgeIndex(3, -1, 7, filled('xxx..x..'))).toBe(2)
  })

  it('moves with ⌘/Ctrl + arrows, Home / End and pages', () => {
    const { t, cols, run, id } = setup({ rows: 6, columns: 3 })
    const [a] = t().dataSets.map((d) => d.id)
    run({
      type: 'table.setCells',
      table: id,
      edits: [0, 1, 2].map((row) => ({ col: a!, sub: 0, row, value: row })),
    })
    const go = (key: string, mod: boolean, at = { r: 0, c: 0 }) =>
      navigate(t(), cols(), at, key, mod, 10, 25)
    expect(go('ArrowDown', true)).toEqual({ r: 2, c: 0 })
    expect(go('ArrowDown', true, { r: 2, c: 0 })).toEqual({ r: 5, c: 0 })
    expect(go('ArrowRight', true)).toEqual({ r: 0, c: 2 })
    expect(go('ArrowDown', false)).toBeNull()
    expect(go('End', false, { r: 3, c: 0 })).toEqual({ r: 3, c: 2 })
    expect(go('Home', false, { r: 3, c: 2 })).toEqual({ r: 3, c: 0 })
    expect(go('End', true)).toEqual({ r: 5, c: 2 })
    expect(go('Home', true, { r: 4, c: 1 })).toEqual({ r: 0, c: 0 })
    expect(go('PageDown', false, { r: 20, c: 1 })).toEqual({ r: 25, c: 1 })
    expect(go('PageUp', false, { r: 4, c: 1 })).toEqual({ r: 0, c: 1 })
  })
})
