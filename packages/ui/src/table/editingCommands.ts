import type { DataTable, GridColumn } from '@ps/model'
import { type Command, GROUPS } from '../commands/index.ts'
import type { Rect } from './gridModel.ts'
import { columnLabel, type SortKey } from './reorder.ts'

// The table view's commands of roadmap 29: find, sort, fill, move rows and columns, Format
// column. Built from the view's state and actions, as plain command values.

export interface EditingState {
  table: DataTable
  readOnly: boolean
  /** A column table of summary data (one row): nothing to sort or move. */
  summary: boolean
  sel: Rect
  /** The last selected row that exists. */
  selLast: number
  focusCol: GridColumn | undefined
  /** 'column', or 'group' in nested tables. */
  group: string
  /** Index of the first selected data set (−1: none) and how many are selected. */
  firstDataSet: number
  dataSetsSelected: number
  /** Columns Format column… would format (data sets and X). */
  formattable: number
  act: {
    find: () => void
    findStep: (dir: 1 | -1) => void
    dialog: (d: 'sort' | 'fillSeries' | 'format') => void
    sort: (keys: SortKey[]) => void
    fillDown: () => void
    fillRight: () => void
    moveRows: (step: number) => void
    moveColumns: (step: number) => void
  }
}

export function editingCommands(s: EditingState): Command[] {
  const { table, readOnly, sel, focusCol, act } = s
  const findIn = (order: number) => ({ menu: 'edit' as const, group: GROUPS.edit.find, order })
  const arrange = (order: number) => ({ menu: 'edit' as const, group: GROUPS.edit.arrange, order })
  const sortable = !readOnly && !s.summary && table.rowCount > 1
  const canMoveRows = !readOnly && !s.summary && sel.r0 < table.rowCount
  const quickSort = (descending: boolean): Command => ({
    id: descending ? 'edit.sortDescending' : 'edit.sortAscending',
    label: `Sort ${descending ? 'descending' : 'ascending'} by ${focusCol ? columnLabel(table, focusCol) : 'this column'}`,
    enabled: sortable && !!focusCol,
    hint: 'Sort every row of the table by this column (undoable)',
    keywords: ['sort'],
    run: () => focusCol && act.sort([{ col: focusCol, descending }]),
  })
  return [
    {
      id: 'edit.find',
      label: readOnly ? 'Find…' : 'Find and replace…',
      menu: findIn(10),
      shortcut: 'Mod+F',
      inTextFields: true,
      hint: 'Find numbers, text and titles in the table; replace them',
      keywords: ['search', 'replace'],
      run: act.find,
    },
    {
      id: 'edit.findNext',
      label: 'Find next',
      menu: findIn(20),
      shortcut: 'Mod+G',
      inTextFields: true,
      run: () => act.findStep(1),
    },
    {
      id: 'edit.findPrevious',
      label: 'Find previous',
      menu: findIn(30),
      shortcut: 'Mod+Shift+G',
      inTextFields: true,
      run: () => act.findStep(-1),
    },
    {
      id: 'edit.sort',
      label: 'Sort…',
      menu: arrange(10),
      enabled: sortable,
      hint: 'Sort every row of the table by up to three columns',
      keywords: ['sort rows', 'order'],
      run: () => act.dialog('sort'),
    },
    quickSort(false),
    quickSort(true),
    {
      id: 'edit.fillDown',
      label: 'Fill down',
      menu: arrange(20),
      shortcut: 'Mod+D',
      enabled: !readOnly && sel.r1 > sel.r0,
      hint: 'Copy the top cells of the selection into the rows below',
      run: act.fillDown,
    },
    {
      id: 'edit.fillRight',
      label: 'Fill right',
      menu: arrange(21),
      shortcut: 'Mod+R',
      enabled: !readOnly && sel.c1 > sel.c0,
      hint: 'Copy the left cells of the selection into the columns right of them',
      run: act.fillRight,
    },
    {
      id: 'edit.fillSeries',
      label: 'Fill series…',
      menu: arrange(22),
      enabled: !readOnly && !s.summary,
      hint: 'Numbers in steps, multiples (dilutions) or log-spaced down the selection',
      keywords: ['dilution', 'sequence'],
      run: () => act.dialog('fillSeries'),
    },
    {
      id: 'edit.moveRowsUp',
      label: 'Move rows up',
      menu: arrange(30),
      shortcut: 'Mod+Alt+ArrowUp',
      enabled: canMoveRows && sel.r0 > 0,
      run: () => act.moveRows(-1),
    },
    {
      id: 'edit.moveRowsDown',
      label: 'Move rows down',
      menu: arrange(31),
      shortcut: 'Mod+Alt+ArrowDown',
      enabled: canMoveRows && s.selLast < table.rowCount - 1,
      run: () => act.moveRows(1),
    },
    {
      id: 'edit.moveColumnsLeft',
      label: `Move ${s.group} left`,
      menu: arrange(40),
      enabled: !readOnly && s.firstDataSet > 0,
      run: () => act.moveColumns(-1),
    },
    {
      id: 'edit.moveColumnsRight',
      label: `Move ${s.group} right`,
      menu: arrange(41),
      enabled:
        !readOnly &&
        s.firstDataSet >= 0 &&
        s.firstDataSet + s.dataSetsSelected < table.dataSets.length,
      run: () => act.moveColumns(1),
    },
    {
      id: 'format.column',
      label: 'Format column…',
      menu: { menu: 'format', group: GROUPS.format.table, order: 10 },
      enabled: !readOnly && s.formattable > 0,
      hint: 'Decimals, scientific notation, percent or thousands for the selected columns (display only)',
      keywords: ['decimals', 'number format', 'digits'],
      run: () => act.dialog('format'),
    },
  ]
}
