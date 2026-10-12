// biome-ignore-all lint/a11y/noRedundantRoles: the grid's table is presentational (roadmap 41), so its rows, headers and cells name their roles for the ARIA grid that owns them
// biome-ignore-all lint/a11y/useSemanticElements: as above: header cells are th elements, with roles the presentational table no longer gives them

import { CommandError } from '@ps/engine'
import {
  parseClipboardGrid,
  type Row,
  tableRows,
  toDelimited,
  toHtmlTable,
  transposeGrid,
} from '@ps/io'
import {
  type CellView,
  type ColumnId,
  columnWidthKey,
  type DataTable,
  hasLimitFlags,
  infoConstants,
  isCellsTable,
  mayNameInfo,
  type NodeId,
  type NumberDisplay,
  newColumnId,
  type RichText,
  resolvedTable,
  richPlain,
  subcolumnCount,
  type TableKind,
  titleRuns,
  withConstants,
} from '@ps/model'
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { type Command, GROUPS, isMacPlatform, useCommands } from '../commands/index.ts'
import { CommandMenu, type CommandMenuState } from '../components/CommandMenu.tsx'
import { lazyComponent } from '../components/lazy.tsx'
import { useConfirm } from '../components/modals.tsx'
import type { ShowError } from '../components/Toasts.tsx'
import { useUndoNotice } from '../components/undoNotice.tsx'
import { useDoc, useServices } from '../context.tsx'
import { useTableExport } from '../export/dataExport.tsx'
import {
  copyTable,
  pastedText,
  readPastedText,
  setClipboardData,
  type TableCopy,
  tableCopy,
} from '../export/tableClipboard.ts'
import { SheetNotes } from '../reuse/SheetNotes.tsx'
import { capitalize } from '../util.ts'
import { useColumnWidths, widthStyle } from './ColumnResize.tsx'
import { CELLS_TABLE_HINT, CELLS_TABLE_LABEL, cellsTableCommand } from './cellsTable.ts'
import { cellShown, columnDisplay } from './display.ts'
import { editingCommands } from './editingCommands.ts'
import { matchKey, useFind } from './FindBar.tsx'
import { FormulaBar, variableBadge } from './FormulaBar.tsx'
import { fillDownCommands, fillRightCommands, fillSeriesCommands, type SeriesSpec } from './fill.ts'
import type { FindTarget } from './find.ts'
import {
  addr,
  cellAt,
  cellText,
  clearCommands,
  copyText,
  editCommands,
  type GridColumn,
  gridColumns,
  hasSubHeader,
  isMultiCellPaste,
  isSummaryColumnTable,
  normRect,
  type PasteResult,
  pasteCommands,
  selectionRows,
  subcolumnNoun,
  subLabel,
  variableKind,
} from './gridModel.ts'
import { LimitsDialog, limitTitle } from './LimitsDialog.tsx'
import { navigate } from './navigation.ts'
import {
  columnLabel,
  dataSetsIn,
  dropIndex,
  moveDataSetsCommand,
  moveRowsCommand,
  type SortKey,
  sortCommand,
} from './reorder.ts'
import { useReveal } from './reveal.ts'
import {
  RichTitle,
  renameDataSetCommand,
  renameXCommand,
  rowTitleCommand,
  rowTitleRuns,
  subTitleRichCommand,
  TitleEditor,
} from './titles.tsx'

// The table's dialogs load when first shown (audit 2, P8).
const dataDialogs = () => import('./DataDialogs.tsx')
const BinDialog = lazyComponent(() => dataDialogs().then((m) => m.BinDialog))
const RecodeDialog = lazyComponent(() => dataDialogs().then((m) => m.RecodeDialog))
const SwapXYDialog = lazyComponent(() => dataDialogs().then((m) => m.SwapXYDialog))
const TransformVariablesDialog = lazyComponent(() =>
  dataDialogs().then((m) => m.TransformVariablesDialog),
)
const ExtractDialog = lazyComponent(() =>
  import('./ExtractDialog.tsx').then((m) => m.ExtractDialog),
)
const FillSeriesDialog = lazyComponent(() =>
  import('./FillSeriesDialog.tsx').then((m) => m.FillSeriesDialog),
)
const FormatColumnDialog = lazyComponent(() =>
  import('./FormatColumnDialog.tsx').then((m) => m.FormatColumnDialog),
)
const SortDialog = lazyComponent(() => import('./SortDialog.tsx').then((m) => m.SortDialog))

const ROW_H = 24

const OVERSCAN = 10

/** How a table of each kind is laid out, under its toolbar (column tables: by their format). */
const KIND_HINTS: Record<Exclude<TableKind, 'column'>, string> = {
  xy: 'XY table: X values in the first column; double-click a title to rename',
  survival:
    'Survival table: one subject per row; time in X, 1 (event) or 0 (censored) in its group’s column',
  contingency: 'Contingency table: counts, with groups in rows and outcomes in columns',
  partsOfWhole:
    'Parts of whole: one part (category) per row, named by its row title; each column is a whole (a pie)',
  grouped: 'Grouped table: one row per level of the row factor, replicates side by side',
  nested:
    'Nested table: a column per group, a subcolumn per subject (double-click its name to rename), replicate measurements down the rows',
  multipleVariables:
    'Multiple variables: one row per observation, one column per variable (numbers, text categories, or calculated with ƒx)',
}

/** The grid's right-click menu: commands of the Edit menu. */
const CELL_MENU = [
  'edit.cut',
  'edit.copy',
  'edit.copyWithTitles',
  'edit.paste',
  'edit.pasteTransposed',
  '-',
  'edit.clear',
  'edit.exclude',
  '-',
  'edit.insertRow',
  'edit.deleteRows',
  '-',
  'edit.insertColumn',
  'edit.addColumn',
  'edit.deleteColumns',
  'edit.addSubcolumn',
  'edit.removeSubcolumn',
  '-',
  'edit.fillDown',
  'edit.fillRight',
  'edit.fillSeries',
  '-',
  'analyze.compareColumns',
]

/** A column header's right-click menu (roadmap 29). */
const HEADER_MENU = [
  'edit.sortAscending',
  'edit.sortDescending',
  'edit.sort',
  '-',
  'format.column',
  '-',
  'edit.insertColumn',
  'edit.addColumn',
  'edit.deleteColumns',
  '-',
  'edit.moveColumnsLeft',
  'edit.moveColumnsRight',
  '-',
  'analyze.compareColumns',
]

/** The row numbers' right-click menu. */
const ROW_MENU = [
  'edit.insertRow',
  'edit.deleteRows',
  '-',
  'edit.moveRowsUp',
  'edit.moveRowsDown',
  '-',
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'edit.clear',
  'edit.exclude',
]

interface Pos {
  r: number
  c: number
}

/** The row-number gutter's width (`.grid th.row-num`), left of the scrolled columns. */
const ROW_NUM_W = 44

/** A mouse drag over the grid's headers (roadmap 29). */
type Drag =
  /** Selecting whole rows from their numbers. */
  | { kind: 'selectRows' }
  /** Moving selected rows `r0`…`r1` by their numbers; a click without a move selects `row`. */
  | { kind: 'moveRows'; r0: number; r1: number; row: number }
  /** Moving data sets by their headers; a click without a move selects grid columns `click`. */
  | { kind: 'moveColumns'; ids: ColumnId[]; i0: number; i1: number; click: [number, number] }

/** Runs of a formatted number (×10ⁿ has a superscript exponent). */
const numberRuns = (runs: RichText) =>
  // biome-ignore lint/suspicious/noArrayIndexKey: runs have no identity
  runs.map((r, i) => (r.sup ? <sup key={i}>{r.text}</sup> : r.text))

/**
 * The spreadsheet grid of a data table. With `source` it shows that table read-only instead: a
 * result table an analysis produced (selectable and copyable, not editable).
 */
export function TableView({
  id,
  onError,
  source,
  onOpen,
  onCompare,
}: {
  id: NodeId
  onError: ShowError
  source?: DataTable
  /** Opens another node (e.g. a table made by Extract and rearrange). */
  onOpen?: (id: NodeId) => void
  /** Roadmap 51a: Compare these columns… (Guide me on the selected data sets). */
  onCompare?: (dataSets: string[]) => void
}) {
  const { store } = useServices()
  const confirm = useConfirm()
  const trackUndo = useUndoNotice()
  // Roadmap 40: formulas naming info fields read the project's info sheets (live).
  const docTable = useDoc((d) => {
    // (A result table's view is given `source`; its id is the analysis'.)
    const t = d.nodes[id] as DataTable | undefined
    return t?.kind === 'table' && mayNameInfo(t) ? withConstants(t, infoConstants(d)) : t
  }) as DataTable
  const table = source ?? docTable
  const readOnly = source !== undefined
  const cols = useMemo(() => gridColumns(table), [table])
  const summary = isSummaryColumnTable(table)
  const displayRows = summary
    ? 1
    : Math.max(table.rowCount + (readOnly ? 0 : 20), readOnly ? 1 : 40)
  const hasSub = hasSubHeader(table, cols)
  const nested = table.tableKind === 'nested'
  const variables = table.tableKind === 'multipleVariables'
  const noun = subcolumnNoun(table)
  // Visual column whose subcolumn title (a nested subject's name) is being edited.
  const [editingSub, setEditingSub] = useState<number | null>(null)
  const [extracting, setExtracting] = useState(false)
  // Roadmap 39: Limits… (the rule of values imported at a detection limit).
  const [limitsOpen, setLimitsOpen] = useState(false)
  // Roadmap 38's dialogs (data manipulation), with the focused variable when it was opened.
  const [manip, setManip] = useState<{
    kind: 'transform' | 'recode' | 'bin' | 'swapXY'
    initial?: string
  } | null>(null)
  const [menu, setMenu] = useState<CommandMenuState | null>(null)
  // Dialogs of roadmap 29 (Sort…, Fill series…, Format column…).
  const [dialog, setDialog] = useState<'sort' | 'fillSeries' | 'format' | null>(null)
  // A header drag in progress and where it would drop (a row, or a data set index).
  const drag = useRef<Drag | null>(null)
  const [drop, setDropState] = useState<number | null>(null)
  const dropRef = useRef<number | null>(null)
  const setDrop = (d: number | null) => {
    dropRef.current = d
    setDropState(d)
  }

  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 })
  const [focus, setFocus] = useState<Pos>({ r: 0, c: 0 })
  // A cell being edited; a row title's text is rich (`rich`, roadmap 28).
  const [editing, setEditing] = useState<{ pos: Pos; text: string; rich?: RichText } | null>(null)
  const [editingTitle, setEditingTitle] = useState<string | null>(null)
  // Finishing an edit focuses the grid, which blurs the input while it still exists; its blur
  // handler (from an older render) must not commit again. This marks a cell edit as finished
  // (title editors commit once by themselves).
  const cellDone = useRef(true)
  const endTitleEdit = () => {
    setEditingTitle(null)
    grid.current?.focus()
  }
  // Set by ⇧⌘V: the paste event that follows pastes transposed.
  const transposeNext = useRef(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)
  const scroller = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const sel = normRect(anchor, focus)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Reset selection when switching tables.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on table change
  useEffect(() => {
    setAnchor({ r: 0, c: 0 })
    setFocus({ r: 0, c: 0 })
    setEditing(null)
    grid.current?.focus()
  }, [id])

  /** Applies commands as one undo step; the error message when refused (null: done). */
  const tryDispatch = (cmds: Parameters<typeof store.dispatch>[0], label?: string) => {
    if (readOnly) return 'This table is computed by an analysis. Edit the data it analyzes instead.'
    try {
      store.dispatch(cmds, label)
      return null
    } catch (e) {
      return e instanceof CommandError ? e.message.split('\n')[0]! : String(e)
    }
  }
  const dispatch = (cmds: Parameters<typeof store.dispatch>[0], label?: string) => {
    const error = tryDispatch(cmds, label)
    // A computed table refuses edits (what was typed can't go there); else a real failure.
    if (error) onError(error, readOnly ? 'validation' : 'failure')
    return error === null
  }

  const lastCol = cols.length - 1
  const clampPos = (p: Pos): Pos => ({
    r: Math.max(0, Math.min(displayRows - 1, p.r)),
    c: Math.max(0, Math.min(lastCol, p.c)),
  })

  /** Moves the focus to `p` (clamped), extending the selection or starting one there. */
  const moveTo = (p: Pos, extend: boolean) => {
    const next = clampPos(p)
    setFocus(next)
    if (!extend) setAnchor(next)
    scrollIntoView(next.r, next.c)
  }
  const move = (dr: number, dc: number, extend: boolean) =>
    moveTo({ r: focus.r + dr, c: focus.c + dc }, extend)

  const headerH = hasSub ? ROW_H * 2 : ROW_H
  /** Scrolls row `r` (and grid column `c`) into view. */
  const scrollIntoView = (r: number, c?: number) => {
    const el = scroller.current
    if (!el) return
    const top = r * ROW_H
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_H > el.scrollTop + el.clientHeight - headerH)
      el.scrollTop = top + ROW_H - el.clientHeight + headerH
    if (c === undefined) return
    // Any rendered row has the column's cell after the row number.
    const td = grid.current?.querySelector('tbody tr[data-row]')?.children[c + 1]
    if (!(td instanceof HTMLElement)) return
    const left = td.offsetLeft - ROW_NUM_W
    const right = td.offsetLeft + td.offsetWidth
    if (left < el.scrollLeft) el.scrollLeft = Math.max(0, left)
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth
  }

  // Go to row (roadmap 34d): a graph's point asks for its row — the whole row of a table of
  // variables, else the value's cell — selected and scrolled into view (after the reset above).
  useReveal(id, (r) => {
    // Roadmap 40: search jumps to a column ('x': the X column).
    const c = cols.findIndex((col) =>
      r.column === 'x'
        ? col.kind === 'x'
        : col.kind === 'data' && col.ds.id === r.column && col.sub === (r.sub ?? 0),
    )
    const row = Math.max(0, Math.min(displayRows - 1, r.row))
    setEditing(null)
    setAnchor({ r: row, c: c < 0 ? 0 : c })
    setFocus({ r: row, c: c < 0 ? lastCol : c })
    grid.current?.focus({ preventScroll: true })
    // After the grid has its rows (a table just opened lays out first).
    requestAnimationFrame(() => scrollIntoView(row, c < 0 ? 0 : c))
  })

  /** Selects grid columns `from`…`to`, every row (a header press). */
  const selectColumns = (from: number, to: number) => {
    setAnchor({ r: 0, c: from })
    setFocus({ r: Math.max(0, table.rowCount - 1), c: to })
  }
  /** Selects rows `from`…`to`, every column (a row number press). */
  const selectRows = (from: number, to: number) => {
    setAnchor({ r: from, c: 0 })
    setFocus({ r: to, c: lastCol })
  }
  /** After data sets moved: selects them where they are now, on the same rows. */
  const selectDataSets = (ids: readonly ColumnId[]) => {
    const now = gridColumns(store.getState().nodes[id] as DataTable)
    const at = now.flatMap((c, i) => (c.kind === 'data' && ids.includes(c.ds.id) ? [i] : []))
    if (!at.length) return
    setAnchor({ r: sel.r0, c: at[0]! })
    setFocus({ r: sel.r1, c: at.at(-1)! })
  }
  // Whole rows are selected (from the row numbers, or every column).
  const wholeRows = sel.c0 === 0 && sel.c1 === lastCol
  // The selected rows that exist, and whether the selection spans every row (a column press).
  const selLast = Math.min(sel.r1, table.rowCount - 1)
  const allRows = sel.r0 === 0 && selLast === table.rowCount - 1
  const pageRows = Math.max(1, Math.floor((viewH - headerH) / ROW_H) - 1)

  const commitEdit = (then?: Pos) => {
    if (!editing || cellDone.current) return
    const col = cols[editing.pos.c]!
    const text = editing.text.trim()
    let ok = true
    if (col.kind === 'rowTitle') {
      const { r } = editing.pos
      const setTitle = rowTitleCommand(table, r, editing.rich ?? [{ text }])
      ok =
        r >= table.rowCount
          ? dispatch(
              [
                {
                  type: 'table.insertRows',
                  table: id,
                  at: table.rowCount,
                  count: r + 1 - table.rowCount,
                },
                setTitle,
              ],
              'Edit row title',
            )
          : dispatch(setTitle)
    } else {
      const result = editCommands(table, col, editing.pos.r, editing.text)
      if (!result.ok) {
        const { makeText, error } = result
        if (!makeText) {
          onError(error, 'validation')
          return
        }
        // Text typed into a numeric variable: offer to make it a text variable. The edit stays
        // open meanwhile, done for the blur the question causes.
        cellDone.current = true
        void confirm({ title: makeText.question, ok: 'Make text' }).then((convert) => {
          if (!convert) {
            cellDone.current = false
            onError(error, 'validation')
          } else if (dispatch(makeText.commands, 'Make text variable')) finishEdit(then)
        })
        return
      } else if (result.commands.length) ok = dispatch(result.commands)
    }
    if (ok) finishEdit(then)
  }
  /** After a commit: the editor closes, the selection moves to `then`, the grid has the keys. */
  const finishEdit = (then?: Pos) => {
    cellDone.current = true
    setEditing(null)
    if (then) {
      const p = clampPos(then)
      setAnchor(p)
      setFocus(p)
      scrollIntoView(p.r)
    }
    grid.current?.focus()
  }

  const startEdit = (pos: Pos, initial?: string) => {
    const col = cols[pos.c]
    if (!col || readOnly) return
    if (col.kind === 'data' && col.ds.formula !== undefined) {
      onError(
        `“${col.ds.title}” is calculated from its formula: edit it in the ƒx bar above the grid.`,
        'validation',
      )
      return
    }
    let text = initial
    if (text === undefined) {
      if (pos.r >= table.rowCount) text = ''
      else {
        const cell = cellAt(table, col, pos.r)
        text =
          'title' in cell
            ? (cell.title ?? '')
            : cell.text !== undefined
              ? (cell.text ?? '')
              : cellText(cell.value)
      }
    }
    cellDone.current = false
    const rich =
      col.kind !== 'rowTitle'
        ? undefined
        : initial !== undefined || pos.r >= table.rowCount
          ? [{ text: text ?? '' }]
          : rowTitleRuns(table, pos.r)
    setEditing({ pos, text: text ?? '', ...(rich ? { rich } : {}) })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && ['c', 'x', 'v'].includes(e.key.toLowerCase())) dropOutsideSelection()
    if (editing || editingTitle !== null) return
    // ⇧⌘V still fires a paste event (Edit › Paste transposed leaves the key to the browser); it
    // pastes rows as columns. ⌘A, ⌘E and the like are commands (see below).
    if (mod && e.shiftKey && e.key.toLowerCase() === 'v') transposeNext.current = true
    // ⌥⌘↑ / ⌥⌘↓ move rows: commands, left to the shortcut dispatcher.
    if (mod && e.altKey) return
    const to = navigate(table, cols, focus, e.key, mod, pageRows, displayRows - 1)
    if (to) {
      e.preventDefault()
      return moveTo(to, e.shiftKey)
    }
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        return move(-1, 0, e.shiftKey)
      case 'ArrowDown':
        e.preventDefault()
        return move(1, 0, e.shiftKey)
      case 'ArrowLeft':
        e.preventDefault()
        return move(0, -1, e.shiftKey)
      case 'ArrowRight':
        e.preventDefault()
        return move(0, 1, e.shiftKey)
      case 'Tab':
        e.preventDefault()
        return move(0, e.shiftKey ? -1 : 1, false)
      case 'Enter':
        e.preventDefault()
        return e.shiftKey ? move(-1, 0, false) : move(1, 0, false)
      case 'F2':
        e.preventDefault()
        return startEdit(focus)
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        return clearSelection()
    }
    if (!mod && !e.altKey && e.key.length === 1) {
      e.preventDefault()
      startEdit(focus, e.key)
    }
  }

  const selectedCells = () => {
    const out: { col: Extract<GridColumn, { kind: 'x' | 'data' }>; r: number }[] = []
    for (let c = sel.c0; c <= sel.c1; c++) {
      const col = cols[c]
      if (!col || col.kind === 'rowTitle') continue
      for (let r = sel.r0; r <= Math.min(sel.r1, table.rowCount - 1); r++) out.push({ col, r })
    }
    return out
  }

  const toggleExclude = () => {
    const cells = selectedCells().filter(({ col, r }) => {
      const cell = cellAt(table, col, r) as CellView
      return cell.value !== null && !cell.calculated
    })
    if (!cells.length) return
    const allExcluded = cells.every(({ col, r }) => (cellAt(table, col, r) as CellView).excluded)
    dispatch(
      {
        type: 'table.setExcluded',
        table: id,
        excluded: !allExcluded,
        cells: cells.map(({ col, r }) => ({ ...addr(col), row: r })),
      },
      allExcluded ? 'Include values' : 'Exclude values',
    )
  }

  // Inline inputs (cell editor, column titles) handle their own clipboard.
  const fromInput = (e: React.ClipboardEvent) => e.target !== grid.current

  // Browsers send ⌘C / ⌘X / ⌘V's events to the page's text selection, not to the focused element.
  // The cells can't be selected, so clicking one leaves a selection made elsewhere (on macOS a
  // right-click selects the word under it, e.g. a sheet's name) in place, and would take them.
  const dropOutsideSelection = () => {
    const s = window.getSelection()
    if (s?.rangeCount && !grid.current?.contains(s.anchorNode)) s.removeAllRanges()
  }

  // Copies carry the cells as tab-separated text (Excel, and this grid: pasting them back gives
  // the same values) and as an HTML table (Word and PowerPoint paste a real table), formula-like
  // text guarded in both and kept exactly for this grid (`tableCopy`).
  const clipOf = (rows: Row[], text: (guard: boolean) => string): TableCopy =>
    tableCopy(text, toHtmlTable(rows, { guard: true }))
  const selectionClip = () =>
    clipOf(selectionRows(table, cols, sel), (guard) => copyText(table, cols, sel, guard))
  const onCopy = (e: React.ClipboardEvent) => {
    if (editing || fromInput(e)) return
    setClipboardData(e, selectionClip())
  }

  const onCut = (e: React.ClipboardEvent) => {
    if (editing || fromInput(e)) return
    onCopy(e)
    if (readOnly) return
    const cmds = clearCommands(table, cols, sel)
    if (cmds.length) dispatch(cmds, 'Cut')
  }

  /** Pastes copied cells at the selection (or `at`), optionally transposed (rows ↔ columns). */
  const pasteText = (text: string, transpose: boolean, at: Pos = { r: sel.r0, c: sel.c0 }) => {
    const grid = parseClipboardGrid(text)
    const cells = transpose ? transposeGrid(grid) : grid
    const result = pasteCommands(table, cols, at, cells)
    if (!result.ok) return onError(result.error, 'validation')
    if (result.commands.length) dispatch(result.commands, transpose ? 'Paste transposed' : 'Paste')
  }
  const onPaste = (e: React.ClipboardEvent) => {
    if (editing || fromInput(e)) return
    e.preventDefault()
    const transpose = transposeNext.current
    transposeNext.current = false
    pasteText(pastedText(e.clipboardData), transpose)
  }
  // Edit › Cut / Copy / Paste chosen from a menu: no clipboard event of the keys' own. Copy and
  // cut raise one on the grid (handled above, no permission needed), else use the async
  // clipboard API; paste can only read that (the browser may ask, or refuse).
  const keys = isMacPlatform()
    ? { c: '⌘C', x: '⌘X', v: '⌘V', tv: '⇧⌘V' }
    : { c: 'Ctrl+C', x: 'Ctrl+X', v: 'Ctrl+V', tv: 'Ctrl+Shift+V' }
  const copyToClipboard = async (cut = false, data = selectionClip()) => {
    try {
      await copyTable(data, grid.current)
    } catch {
      const key = cut ? keys.x : keys.c
      onError(`The clipboard could not be written here. Select the cells and press ${key} instead.`)
      return
    }
    const cmds = cut ? clearCommands(table, cols, sel) : []
    if (cmds.length) dispatch(cmds, 'Cut')
  }
  /** The whole table with its header rows (data set titles, subcolumn labels, row titles). */
  const copyWithTitles = () => {
    const rows = tableRows(table)
    void copyToClipboard(
      false,
      clipOf(rows, (guard) => toDelimited(rows, '\t', { guard })),
    )
  }
  const exporter = useTableExport(table, onError)
  const pasteFromClipboard = async (transpose: boolean) => {
    let text: string
    try {
      text = await readPastedText()
    } catch {
      onError(
        `The clipboard could not be read here. Select a cell and press ${transpose ? keys.tv : keys.v} instead.`,
      )
      return
    }
    pasteText(text, transpose)
  }
  const clearSelection = () => {
    const cmds = clearCommands(table, cols, sel)
    if (cmds.length) dispatch(cmds, 'Clear cells')
  }
  const selectAll = () => {
    setAnchor({ r: 0, c: 0 })
    setFocus({ r: Math.max(0, table.rowCount - 1), c: cols.length - 1 })
  }

  const addColumn = () => dispatch({ type: 'table.addDataSet', table: id, id: newColumnId() })
  const deleteColumns = () => {
    const ids = [
      ...new Set(
        cols.slice(sel.c0, sel.c1 + 1).flatMap((c) => (c.kind === 'data' ? [c.ds.id] : [])),
      ),
    ]
    if (ids.length) dispatch({ type: 'table.removeDataSets', table: id, ids })
  }
  const deleteRows = () => {
    const rows = []
    for (let r = sel.r0; r <= Math.min(sel.r1, table.rowCount - 1); r++) rows.push(r)
    if (rows.length && !summary) dispatch({ type: 'table.deleteRows', table: id, rows })
  }
  // Insert rows: as many as selected, above the selection (one when whole columns are selected).
  const insertCount = allRows ? 1 : sel.r1 - sel.r0 + 1
  const insertRow = () => {
    if (!summary)
      dispatch({
        type: 'table.insertRows',
        table: id,
        at: Math.min(sel.r0, table.rowCount),
        count: insertCount,
      })
  }
  // Insert column: a data set before the first selected one (first when none is selected).
  const insertColumn = () => {
    const first = cols.slice(sel.c0, sel.c1 + 1).find((c) => c.kind === 'data')
    const at = first?.kind === 'data' ? first.dsIndex : 0
    const newId = newColumnId()
    if (dispatch({ type: 'table.addDataSet', table: id, id: newId, at }, 'Insert column'))
      selectDataSets([newId])
  }

  // ---- Reordering (roadmap 29) ----------------------------------------------------------------

  const selectedIds = dataSetsIn(cols, sel.c0, sel.c1)
  const dsIndex = (dsId: ColumnId) => table.dataSets.findIndex((d) => d.id === dsId)
  const moveColumns = (step: number) => {
    const cmd = moveDataSetsCommand(table, selectedIds, { step })
    if (cmd && dispatch(cmd, step < 0 ? 'Move column left' : 'Move column right'))
      selectDataSets(selectedIds)
  }
  const canMoveRows = !readOnly && !summary && sel.r0 < table.rowCount
  const moveRows = (step: number) => {
    const cmd = moveRowsCommand(table, sel.r0, selLast, sel.r0 + step)
    if (!cmd || !dispatch(cmd, step < 0 ? 'Move rows up' : 'Move rows down')) return
    setAnchor({ r: anchor.r + step, c: anchor.c })
    setFocus({ r: focus.r + step, c: focus.c })
    scrollIntoView(focus.r + step)
  }
  const sortBy = (keys: SortKey[]) => {
    const cmd = sortCommand(table, keys)
    if (cmd) dispatch(cmd, 'Sort rows')
  }

  /** Starts a header drag; releasing the mouse anywhere ends it. */
  const startDrag = (d: Drag) => {
    drag.current = d
    setDrop(null)
    window.addEventListener('mouseup', () => endDrag.current(), { once: true })
  }
  const endDrag = useRef(() => {})
  endDrag.current = () => {
    const d = drag.current
    const at = dropRef.current
    drag.current = null
    setDrop(null)
    if (d?.kind === 'moveRows') {
      const to = at === null ? null : dropIndex(d.r0, d.r1, Math.min(at, table.rowCount - 1))
      if (to === null) return selectRows(d.row, d.row)
      const cmd = moveRowsCommand(table, d.r0, d.r1, to)
      if (cmd && dispatch(cmd, 'Move rows')) selectRows(to, to + d.r1 - d.r0)
    } else if (d?.kind === 'moveColumns') {
      const to = at === null ? null : dropIndex(d.i0, d.i1, at)
      if (to === null) return selectColumns(...d.click)
      const cmd = moveDataSetsCommand(table, d.ids, { to })
      if (cmd && dispatch(cmd, d.ids.length > 1 ? 'Move columns' : 'Move column'))
        selectDataSets(d.ids)
    }
  }

  const onRowNumberDown = (e: React.MouseEvent, r: number) => {
    if (editing) commitEdit()
    const inRows = wholeRows && r >= sel.r0 && r <= sel.r1
    if (e.button !== 0) {
      // A right-click inside selected rows keeps them (for its menu).
      if (!inRows) selectRows(r, r)
      return
    }
    if (e.shiftKey) {
      setAnchor({ r: anchor.r, c: 0 })
      setFocus({ r, c: lastCol })
      return
    }
    if (inRows && canMoveRows && r <= selLast)
      return startDrag({ kind: 'moveRows', r0: sel.r0, r1: selLast, row: r })
    selectRows(r, r)
    startDrag({ kind: 'selectRows' })
  }
  /** The pointer entered row `r` (its number or a cell) during a drag. */
  const dragOverRow = (r: number) => {
    const d = drag.current
    if (d?.kind === 'selectRows') setFocus({ r, c: lastCol })
    else if (d?.kind === 'moveRows') setDrop(r)
  }

  const onHeaderDown = (
    e: React.MouseEvent,
    g: { col: GridColumn; span: number; index: number },
  ) => {
    const [from, to] = [g.index, g.index + g.span - 1]
    const inCols = allRows && from >= sel.c0 && to <= sel.c1
    if (e.button === 0 && e.shiftKey) {
      setAnchor({ r: 0, c: anchor.c })
      setFocus({ r: Math.max(0, table.rowCount - 1), c: from < anchor.c ? from : to })
      return
    }
    // A press inside selected columns keeps them: a right-click for its menu, a drag moves them.
    if (!inCols) selectColumns(from, to)
    if (e.button !== 0 || readOnly || g.col.kind !== 'data' || editingTitle !== null) return
    const ids = inCols ? selectedIds : [g.col.ds.id]
    const click: [number, number] = [from, to]
    startDrag({ kind: 'moveColumns', ids, i0: dsIndex(ids[0]!), i1: dsIndex(ids.at(-1)!), click })
  }

  const widths = useColumnWidths({
    table,
    cols,
    readOnly,
    grid,
    dispatch: (cmd, label) => dispatch(cmd, label),
  })

  // ---- Fill, find, format ---------------------------------------------------------------------

  const fill = (result: PasteResult, label: string) => {
    if (!result.ok) return onError(result.error, 'validation')
    if (result.commands.length) dispatch(result.commands, label)
  }
  const fillSeries = (spec: SeriesSpec, n: number | undefined): string | null => {
    const result = fillSeriesCommands(table, cols, sel, spec, n)
    if (!result.ok) return result.error
    return result.commands.length ? tryDispatch(result.commands, 'Fill series') : null
  }

  const goToMatch = (m: FindTarget) => {
    if (m.kind === 'cell') {
      setAnchor({ r: m.r, c: m.c })
      setFocus({ r: m.r, c: m.c })
      scrollIntoView(m.r, m.c)
    } else {
      setAnchor({ r: 0, c: m.c })
      setFocus({ r: 0, c: m.c })
      if (scroller.current) scroller.current.scrollTop = 0
      scrollIntoView(0, m.c)
    }
  }
  const find = useFind({
    table,
    cols,
    readOnly,
    onGo: goToMatch,
    dispatch: (cmds, label) => dispatch(cmds, label),
    onError,
    onClose: () => grid.current?.focus(),
  })

  // Format column: the selected data sets and X.
  const formatTargets = cols
    .slice(sel.c0, sel.c1 + 1)
    .filter(
      (c, i, all) =>
        c.kind !== 'rowTitle' &&
        all.findIndex((o) => columnWidthKey(o) === columnWidthKey(c)) === i,
    )
  const formatColumns = (display: NumberDisplay | null) => {
    const targets = formatTargets.map((c) => (c.kind === 'data' ? c.ds.id : ('x' as const)))
    // Roadmap 43: the dialog's OK announced with its Undo.
    if (targets.length)
      trackUndo(() =>
        dispatch({ type: 'table.setDisplay', table: id, cols: targets, display }, 'Format column'),
      )
  }
  const formatSample = () => {
    for (const col of formatTargets)
      for (let r = 0; r < table.rowCount; r++) {
        const cell = cellAt(table, col, r)
        if (!('title' in cell) && cell.value !== null) return cell.value
      }
    return 1234.5678
  }

  // Virtualized row window.
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last = Math.min(displayRows, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN)
  const rows = []
  for (let r = first; r < last; r++) rows.push(r)

  // Header groups: one cell per data set spanning its subcolumns.
  const groups: { col: GridColumn; span: number; index: number }[] = []
  cols.forEach((col, index) => {
    const prev = groups.at(-1)
    if (col.kind === 'data' && prev?.col.kind === 'data' && prev.col.ds.id === col.ds.id)
      prev.span++
    else groups.push({ col, span: 1, index })
  })

  const inSel = (r: number, c: number) => r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1

  const count = subcolumnCount(table.yFormat)
  const setSubcolumns = (n: number) =>
    noun &&
    dispatch(
      { type: 'table.setReplicateCount', table: id, count: n },
      n > count ? `Add ${noun.one}` : `Remove ${noun.one}`,
    )
  // Roadmap 34f: a multiple-variables table's cells mode (automatic when it matches the rows).
  const setCellsTable = (on: boolean) =>
    dispatch(cellsTableCommand(table, on), on ? 'Make a cells table' : 'Not a cells table')
  const nounTitle = noun ? capitalize(noun.one) : ''
  const group = nested ? 'group' : 'column'
  const hasDataColumn = cols.slice(sel.c0, sel.c1 + 1).some((c) => c.kind === 'data')
  const clip = (order: number) => ({ menu: 'edit' as const, group: GROUPS.edit.clipboard, order })
  const tbl = (order: number) => ({ menu: 'edit' as const, group: GROUPS.edit.table, order })
  const commands: Command[] = [
    {
      id: 'edit.cut',
      label: 'Cut',
      menu: clip(10),
      shortcut: 'Mod+X',
      nativeShortcut: true,
      icon: 'scissors',
      enabled: !readOnly,
      run: () => copyToClipboard(true),
    },
    {
      id: 'edit.copy',
      label: 'Copy',
      menu: clip(20),
      shortcut: 'Mod+C',
      nativeShortcut: true,
      icon: 'copy',
      run: () => copyToClipboard(),
    },
    {
      id: 'edit.copyWithTitles',
      label: 'Copy with titles',
      menu: clip(25),
      hint: 'Copy the whole table with its column titles and row titles, to paste into Excel, Word or PowerPoint',
      keywords: ['copy table', 'clipboard', 'word', 'powerpoint'],
      run: copyWithTitles,
    },
    {
      id: 'edit.paste',
      label: 'Paste',
      menu: clip(30),
      shortcut: 'Mod+V',
      nativeShortcut: true,
      icon: 'clipboard-paste',
      enabled: !readOnly,
      run: () => pasteFromClipboard(false),
    },
    {
      id: 'edit.pasteTransposed',
      label: 'Paste transposed',
      menu: clip(40),
      shortcut: 'Mod+Shift+V',
      nativeShortcut: true,
      enabled: !readOnly,
      hint: 'Paste copied cells with rows and columns swapped',
      run: () => pasteFromClipboard(true),
    },
    {
      id: 'edit.clear',
      label: 'Clear',
      menu: clip(50),
      // The grid's own key (it also works with nothing but the grid focused).
      shortcut: isMacPlatform() ? 'Backspace' : 'Delete',
      nativeShortcut: true,
      enabled: !readOnly,
      hint: 'Empty the selected cells',
      run: clearSelection,
    },
    {
      id: 'edit.selectAll',
      label: 'Select all',
      menu: clip(60),
      shortcut: 'Mod+A',
      run: selectAll,
    },
    {
      id: 'edit.exclude',
      label: 'Exclude / include values',
      menu: tbl(10),
      shortcut: 'Mod+E',
      enabled: !readOnly,
      hint: 'Leave the selected values out of analyses and graphs (shown in italics with *), or bring them back',
      run: toggleExclude,
    },
    {
      id: 'edit.limits',
      label: 'Limits…',
      menu: tbl(15),
      enabled: !readOnly && hasLimitFlags(table),
      hint: 'Values imported at a detection limit (“<0.5”, “BLQ”): what replaces them, substituted again from their original text',
      keywords: ['detection limit', 'LOD', 'LLOQ', 'BLQ', 'censored', 'substitute'],
      run: () => setLimitsOpen(true),
    },
    {
      id: 'edit.insertRow',
      label: insertCount > 1 ? `Insert ${insertCount} rows` : 'Insert row',
      menu: tbl(20),
      enabled: !readOnly && !summary,
      hint: 'Blank rows above the selection, as many as are selected',
      keywords: ['insert rows'],
      run: insertRow,
    },
    {
      id: 'edit.deleteRows',
      label: 'Delete rows',
      menu: tbl(30),
      enabled: !readOnly && !summary && sel.r0 < table.rowCount,
      hint: 'Delete the selected rows (undoable)',
      run: deleteRows,
    },
    {
      id: 'edit.insertColumn',
      label: `Insert ${group}`,
      menu: tbl(35),
      enabled: !readOnly,
      hint: `A new ${group} before the selected one`,
      run: insertColumn,
    },
    {
      id: 'edit.addColumn',
      label: `Add ${group}`,
      menu: tbl(40),
      enabled: !readOnly,
      hint: `A new ${group} after the last one`,
      run: addColumn,
    },
    {
      // Roadmap 51a: the chooser, on the columns selected (two or more).
      id: 'analyze.compareColumns',
      label: 'Compare these columns…',
      menu: { menu: 'analyze', group: GROUPS.analyze.analyze, order: 16 },
      enabled:
        !!onCompare &&
        (table.tableKind === 'column' || table.tableKind === 'nested') &&
        selectedIds.length >= 2,
      disabledReason: 'Select two or more columns of a column table',
      hint: 'Guide me through comparing the selected columns',
      keywords: ['compare', 'guide', 'which test'],
      run: () => onCompare?.(selectedIds),
    },
    {
      id: 'edit.deleteColumns',
      label: `Delete ${group}`,
      menu: tbl(50),
      enabled: !readOnly && hasDataColumn,
      hint: `Delete the selected ${group}s (undoable)`,
      run: deleteColumns,
    },
    ...editingCommands({
      table,
      readOnly,
      summary,
      sel,
      selLast,
      // A header press selects a data set: sort by its first subcolumn.
      focusCol: cols[allRows ? sel.c0 : focus.c],
      group,
      firstDataSet: selectedIds[0] ? dsIndex(selectedIds[0]) : -1,
      dataSetsSelected: selectedIds.length,
      formattable: formatTargets.length,
      act: {
        find: find.show,
        findStep: find.step,
        dialog: setDialog,
        sort: sortBy,
        fillDown: () => fill(fillDownCommands(table, cols, sel), 'Fill down'),
        fillRight: () => fill(fillRightCommands(table, cols, sel), 'Fill right'),
        moveRows,
        moveColumns,
      },
    }),
  ]
  if (noun)
    commands.push(
      {
        id: 'edit.addSubcolumn',
        label: `Add ${noun.one} subcolumn`,
        menu: tbl(60),
        enabled: !readOnly,
        hint: `Add a ${noun.one} subcolumn to every ${nested ? 'group' : 'data set'}`,
        keywords: [noun.one, nounTitle],
        run: () => setSubcolumns(count + 1),
      },
      {
        id: 'edit.removeSubcolumn',
        label: `Remove ${noun.one} subcolumn`,
        menu: tbl(70),
        enabled: !readOnly && count > 1,
        hint: `Remove the last ${noun.one} subcolumn of every ${nested ? 'group' : 'data set'} (undoable)`,
        keywords: [noun.one, nounTitle],
        run: () => setSubcolumns(count - 1),
      },
    )
  if (variables && !readOnly)
    commands.push({
      id: 'analyze.extract',
      label: 'Extract and rearrange…',
      menu: { menu: 'analyze', group: GROUPS.analyze.analyze, order: 50 },
      hint: 'Make a column or grouped table from variables, e.g. a variable by the categories of a text variable',
      run: () => setExtracting(true),
    })
  // Roadmap 38: data manipulation (the Analyze menu's Data manipulation submenu).
  const focusedDs = (() => {
    const col = cols[focus.c]
    return col?.kind === 'data' ? col.ds.id : undefined
  })()
  const manipulation = (order: number) => ({
    menu: 'analyze' as const,
    group: GROUPS.analyze.analyze,
    order,
    submenu: 'Data manipulation',
  })
  if (variables && !readOnly)
    commands.push(
      {
        id: 'data.transformVariables',
        label: 'Transform variables…',
        menu: manipulation(10),
        hint: 'Log, square root, z-score, normalize, rank, arcsinh… of number variables, within groups if you like, as calculated variables',
        keywords: ['log', 'zscore', 'normalize', 'asinh', 'rank'],
        run: () => setManip({ kind: 'transform', ...(focusedDs ? { initial: focusedDs } : {}) }),
      },
      {
        id: 'data.recode',
        label: 'Recode levels…',
        menu: manipulation(20),
        hint: 'Rename or merge the levels of a text variable into a new calculated variable',
        keywords: ['rename levels', 'merge', 'categories'],
        run: () => setManip({ kind: 'recode', ...(focusedDs ? { initial: focusedDs } : {}) }),
      },
      {
        id: 'data.bin',
        label: 'Bin a variable…',
        menu: manipulation(30),
        hint: 'Cut a number variable into intervals (cut points, equal widths or quantiles)',
        keywords: ['cut', 'categories', 'quantiles', 'intervals'],
        run: () => setManip({ kind: 'bin', ...(focusedDs ? { initial: focusedDs } : {}) }),
      },
    )
  if (table.tableKind === 'xy' && !readOnly)
    commands.push({
      id: 'data.swapXY',
      label: 'Swap X and Y…',
      menu: manipulation(40),
      hint: 'Make a data set X and X a data set',
      keywords: ['exchange', 'transpose axes'],
      run: () => setManip({ kind: 'swapXY', ...(focusedDs ? { initial: focusedDs } : {}) }),
    })
  if (!readOnly)
    commands.push({
      id: 'view.rowTitles',
      label: 'Row titles',
      menu: { menu: 'view', group: GROUPS.view.options, order: 10 },
      checked: !!table.rowTitles,
      hint: 'A column of row titles left of the data',
      run: () => dispatch({ type: 'table.showRowTitles', table: id, show: !table.rowTitles }),
    })
  if (variables && !readOnly)
    commands.push({
      id: 'view.cellsTable',
      label: CELLS_TABLE_LABEL,
      menu: { menu: 'view', group: GROUPS.view.options, order: 20 },
      checked: isCellsTable(table),
      hint: CELLS_TABLE_HINT,
      keywords: ['single-cell', 'cytometry', 'FACS', 'large'],
      run: () => setCellsTable(!isCellsTable(table)),
    })
  commands.push(...exporter.commands)
  useCommands('view', commands)

  const commitSubTitle = (c: number, runs: RichText) => {
    const col = cols[c]
    setEditingSub(null)
    grid.current?.focus()
    if (col?.kind !== 'data') return
    const cmd = subTitleRichCommand(table, col, runs)
    if (cmd) dispatch(cmd, nested ? 'Rename subject' : 'Rename subcolumn')
  }

  return (
    <div className="table-view">
      {limitsOpen && <LimitsDialog table={table} onClose={() => setLimitsOpen(false)} />}
      {extracting && (
        <ExtractDialog
          table={resolvedTable(table)}
          onClose={() => setExtracting(false)}
          onCreated={onOpen}
        />
      )}
      {manip?.kind === 'transform' && (
        <TransformVariablesDialog
          table={table}
          dispatch={dispatch}
          initial={manip.initial}
          onClose={() => setManip(null)}
        />
      )}
      {manip?.kind === 'recode' && (
        <RecodeDialog
          table={table}
          dispatch={dispatch}
          initial={manip.initial}
          onClose={() => setManip(null)}
        />
      )}
      {manip?.kind === 'bin' && (
        <BinDialog
          table={table}
          dispatch={dispatch}
          initial={manip.initial}
          onClose={() => setManip(null)}
        />
      )}
      {manip?.kind === 'swapXY' && (
        <SwapXYDialog
          table={table}
          dispatch={dispatch}
          initial={manip.initial}
          onClose={() => setManip(null)}
        />
      )}
      {menu && <CommandMenu menu={menu} onClose={() => setMenu(null)} />}
      {exporter.dialog}
      {dialog === 'sort' && (
        <SortDialog
          table={table}
          cols={cols}
          initial={focus.c}
          onSort={sortBy}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'fillSeries' && (
        <FillSeriesDialog
          rows={sel.r1 - sel.r0 + 1}
          columns={sel.c1 - sel.c0 + 1}
          onFill={fillSeries}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'format' && formatTargets[0] && (
        <FormatColumnDialog
          names={formatTargets.map((c) =>
            c.kind === 'data' ? c.ds.title || columnLabel(table, c) : table.x?.title || 'X',
          )}
          current={columnDisplay(table, formatTargets[0])}
          sample={formatSample()}
          onApply={formatColumns}
          onClose={() => setDialog(null)}
        />
      )}
      {!readOnly && (
        <div className="view-toolbar">
          <button
            type="button"
            onClick={addColumn}
            title="Add a data set (more in the Edit menu, or right-click the cells)"
          >
            + {nested ? 'Group' : 'Column'}
          </button>
          <button type="button" onClick={insertRow} disabled={summary}>
            Insert row
          </button>
          {variables && (
            <button
              type="button"
              onClick={() => setExtracting(true)}
              title="Make a column or grouped table from variables, e.g. a variable by the categories of a text variable"
            >
              Extract and rearrange…
            </button>
          )}
          {variables && (
            <label className="check" title={CELLS_TABLE_HINT}>
              <input
                type="checkbox"
                checked={isCellsTable(table)}
                onChange={(e) => setCellsTable(e.target.checked)}
              />
              {CELLS_TABLE_LABEL}
            </label>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={!!table.rowTitles}
              onChange={(e) =>
                dispatch({ type: 'table.showRowTitles', table: id, show: e.target.checked })
              }
            />
            Row titles
          </label>
          <span className="hint">
            {table.tableKind !== 'column'
              ? KIND_HINTS[table.tableKind]
              : table.yFormat.type === 'summary'
                ? 'Summary data (one row per group)'
                : 'Replicate values stacked in columns'}
          </span>
        </div>
      )}
      {variables && !readOnly && (
        <FormulaBar
          table={table}
          focused={(() => {
            const col = cols[focus.c]
            return col?.kind === 'data' ? col.ds : null
          })()}
          dispatch={dispatch}
          onAdded={(dsId) => {
            const c = gridColumns(store.getState().nodes[id] as DataTable).findIndex(
              (x) => x.kind === 'data' && x.ds.id === dsId,
            )
            if (c >= 0) {
              setAnchor({ r: 0, c })
              setFocus({ r: 0, c })
            }
          }}
          onDone={() => grid.current?.focus()}
        />
      )}
      {/* The table's notes (imported sticky notes, an example's sources and checks), editable. */}
      {!readOnly && <SheetNotes node={table} />}
      {find.bar}
      <div
        className="grid-scroller"
        ref={scroller}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div
          className="grid"
          ref={grid}
          tabIndex={0}
          role="grid"
          aria-label={table.name}
          onKeyDown={onKeyDown}
          onFocus={dropOutsideSelection}
          onCopy={onCopy}
          onCut={onCut}
          onPaste={onPaste}
          onContextMenu={(e) => {
            if (editing || editingTitle !== null || editingSub !== null) return
            e.preventDefault()
            grid.current?.focus({ preventScroll: true })
            const at = e.target as Element
            const [entries, label] = at.closest('thead')
              ? [HEADER_MENU, 'Column']
              : at.closest('th.row-num')
                ? [ROW_MENU, 'Rows']
                : [CELL_MENU, 'Cells']
            setMenu({ x: e.clientX, y: e.clientY, entries, label })
          }}
        >
          {/* Roadmap 41: the grid owns rows directly (ARIA grid > rowgroup > row); the table only lays them out. */}
          <table role="presentation">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" className="corner" rowSpan={hasSub ? 2 : 1} />
                {groups.map((g) => {
                  const w = widths.widthOf(g.col)
                  const titleKey = matchKey({ kind: 'title', c: g.index })
                  const dropSide =
                    drop !== null && drag.current?.kind === 'moveColumns' && g.col.kind === 'data'
                      ? g.col.dsIndex === drop
                        ? drop < drag.current.i0
                          ? 'drop-before'
                          : drop > drag.current.i1
                            ? 'drop-after'
                            : ''
                        : ''
                      : ''
                  return (
                    <th
                      role="columnheader"
                      key={g.col.kind === 'data' ? g.col.ds.id : `${g.col.kind}-${g.index}`}
                      colSpan={g.span}
                      rowSpan={hasSub && g.col.kind !== 'data' ? 2 : 1}
                      className={[
                        'col-title',
                        dropSide,
                        find.keys.has(titleKey) ? 'match' : '',
                        find.current === titleKey ? 'match-current' : '',
                      ].join(' ')}
                      style={widthStyle(w === undefined ? undefined : w * g.span)}
                      onDoubleClick={() => {
                        if (readOnly) return
                        if (g.col.kind === 'data') setEditingTitle(g.col.ds.id)
                        else if (g.col.kind === 'x') setEditingTitle('x')
                      }}
                      onMouseDown={(e) => onHeaderDown(e, g)}
                      onMouseEnter={(e) => {
                        if (e.buttons === 1 && drag.current?.kind === 'moveColumns')
                          setDrop(g.col.kind === 'data' ? g.col.dsIndex : null)
                      }}
                    >
                      {g.col.kind === 'data' && editingTitle === g.col.ds.id ? (
                        <TitleEditor
                          label="Title"
                          value={titleRuns(g.col.ds.title, g.col.ds.titleRich)}
                          onCommit={(runs) => {
                            const ds = (g.col as Extract<GridColumn, { kind: 'data' }>).ds
                            const text = richPlain(runs)
                            // Typing "=…" over a variable's name makes it calculated.
                            if (variables && text.trim().startsWith('=')) {
                              dispatch(
                                { type: 'table.setFormula', table: id, id: ds.id, formula: text },
                                'Calculated variable',
                              )
                            } else {
                              const cmd = renameDataSetCommand(table, ds, runs)
                              if (cmd) dispatch(cmd)
                            }
                            endTitleEdit()
                          }}
                          onCancel={endTitleEdit}
                        />
                      ) : g.col.kind === 'x' && editingTitle === 'x' ? (
                        <TitleEditor
                          label="Title"
                          value={titleRuns(table.x?.title ?? '', table.x?.titleRich)}
                          onCommit={(runs) => {
                            const cmd = renameXCommand(table, runs)
                            if (cmd) dispatch(cmd)
                            endTitleEdit()
                          }}
                          onCancel={endTitleEdit}
                        />
                      ) : g.col.kind === 'data' ? (
                        <>
                          {g.col.ds.title ? (
                            <RichTitle title={g.col.ds.title} rich={g.col.ds.titleRich} />
                          ) : (
                            ' '
                          )}
                          {variables && variableBadge(table, g.col.ds)}
                        </>
                      ) : g.col.kind === 'rowTitle' ? (
                        ''
                      ) : (
                        <RichTitle title={table.x?.title ?? ''} rich={table.x?.titleRich} />
                      )}
                      {widths.handle(columnWidthKey(g.col), g.span)}
                    </th>
                  )
                })}
              </tr>
              {hasSub && (
                <tr role="row">
                  {cols.map((c, i) =>
                    c.kind === 'data' ? (
                      <th
                        role="columnheader"
                        key={`${c.ds.id}-${c.sub}`}
                        className={[
                          'sub-title',
                          nested && !c.ds.subcolumnTitles?.[c.sub] ? 'untitled' : '',
                          find.keys.has(`s:${i}`) ? 'match' : '',
                          find.current === `s:${i}` ? 'match-current' : '',
                        ].join(' ')}
                        style={widthStyle(widths.widthOf(c))}
                        title={
                          nested && !readOnly ? 'Double-click to name this subject' : undefined
                        }
                        onDoubleClick={() => {
                          if (nested && !readOnly) setEditingSub(i)
                        }}
                        onMouseDown={() => selectColumns(i, i)}
                      >
                        {editingSub === i ? (
                          <TitleEditor
                            label="Subcolumn title"
                            value={titleRuns(
                              c.ds.subcolumnTitles?.[c.sub] ?? '',
                              c.ds.subcolumnTitlesRich?.[c.sub],
                            )}
                            placeholder={subLabel(table, c)}
                            onCommit={(runs) => commitSubTitle(i, runs)}
                            onCancel={() => {
                              setEditingSub(null)
                              grid.current?.focus()
                            }}
                          />
                        ) : (
                          <RichTitle
                            title={subLabel(table, c)}
                            rich={c.ds.subcolumnTitlesRich?.[c.sub]}
                          />
                        )}
                      </th>
                    ) : null,
                  )}
                </tr>
              )}
            </thead>
            <tbody role="rowgroup">
              {first > 0 && (
                <tr role="row" className="spacer" style={{ height: first * ROW_H }}>
                  <td role="cell" colSpan={cols.length + 1} />
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  role="row"
                  key={r}
                  data-row={r}
                  className={r >= table.rowCount ? 'beyond' : undefined}
                >
                  <th
                    role="rowheader"
                    className={[
                      'row-num',
                      wholeRows && r >= sel.r0 && r <= sel.r1 ? 'sel' : '',
                      drop === r && drag.current?.kind === 'moveRows'
                        ? r < drag.current.r0
                          ? 'drop-before'
                          : r > drag.current.r1
                            ? 'drop-after'
                            : ''
                        : '',
                    ].join(' ')}
                    onMouseDown={(e) => onRowNumberDown(e, r)}
                    onMouseEnter={(e) => {
                      if (e.buttons === 1) dragOverRow(r)
                    }}
                  >
                    {r + 1}
                  </th>
                  {cols.map((col, c) => {
                    const isEditing = editing?.pos.r === r && editing.pos.c === c
                    const isFocus = focus.r === r && focus.c === c
                    let content: ReactNode = ''
                    let excluded = false
                    let invalid = false
                    let limit: CellView['limit']
                    if (r < table.rowCount) {
                      const cell = cellAt(table, col, r)
                      if ('title' in cell)
                        content = cell.title ? (
                          <RichTitle title={cell.title} rich={table.rowTitlesRich?.[r]} />
                        ) : (
                          ''
                        )
                      else {
                        const shown = cellShown(cell, columnDisplay(table, col), readOnly)
                        content = typeof shown === 'string' ? shown : numberRuns(shown)
                        excluded = cell.excluded
                        invalid = !!cell.calculated?.invalid
                        limit = cell.limit
                      }
                    }
                    const kind = col.kind === 'data' ? variableKind(col.ds) : 'number'
                    const cls = [
                      col.kind === 'rowTitle' ? 'row-title' : kind === 'text' ? 'text' : 'num',
                      kind === 'calculated' ? 'calc' : '',
                      invalid ? 'invalid' : '',
                      inSel(r, c) ? 'sel' : '',
                      isFocus ? 'focus' : '',
                      excluded ? 'excluded' : '',
                      limit ? `at-limit ${limit.side}` : '',
                      col.kind === 'data' && col.sub === 0 ? 'group-start' : '',
                      find.keys.has(`${r}:${c}`) ? 'match' : '',
                      find.current === `${r}:${c}` ? 'match-current' : '',
                    ].join(' ')
                    return (
                      <td
                        role="cell"
                        // biome-ignore lint/suspicious/noArrayIndexKey: positional columns
                        key={c}
                        className={cls}
                        style={widthStyle(widths.widthOf(col))}
                        onMouseDown={(e) => {
                          if (editing) commitEdit()
                          // A right-click inside the selection keeps it (for its menu).
                          if (e.button === 2 && inSel(r, c)) return
                          const p = { r, c }
                          setFocus(p)
                          if (!e.shiftKey) setAnchor(p)
                        }}
                        onMouseEnter={(e) => {
                          if (e.buttons !== 1 || editing) return
                          if (drag.current) dragOverRow(r)
                          else setFocus({ r, c })
                        }}
                        onDoubleClick={() => startEdit({ r, c })}
                        title={
                          invalid
                            ? 'The formula gives no number here (e.g. ln of a negative number, or division by zero)'
                            : limit
                              ? limitTitle(limit, table)
                              : undefined
                        }
                      >
                        {isEditing && editing.rich ? (
                          <TitleEditor
                            className="cell-input"
                            label="Row title"
                            value={editing.rich}
                            selectAll={false}
                            onChange={(rich) => setEditing({ ...editing, rich })}
                            onCommit={() => commitEdit()}
                            onCancel={() => {
                              cellDone.current = true
                              setEditing(null)
                              grid.current?.focus()
                            }}
                            // Several cells pasted (from a spreadsheet) go into the grid.
                            onPasteText={(text) => {
                              if (!isMultiCellPaste(text)) return false
                              cellDone.current = true
                              setEditing(null)
                              grid.current?.focus()
                              pasteText(text, false, { r, c })
                              return true
                            }}
                            onKeyDown={(e) => {
                              const move = (to: Pos) => {
                                e.preventDefault()
                                commitEdit(to)
                              }
                              if (e.key === 'Enter') move({ r: r + (e.shiftKey ? -1 : 1), c })
                              else if (e.key === 'Tab') move({ r, c: c + (e.shiftKey ? -1 : 1) })
                              else if (e.key === 'ArrowDown' || e.key === 'ArrowUp')
                                move({ r: r + (e.key === 'ArrowDown' ? 1 : -1), c })
                            }}
                          />
                        ) : isEditing ? (
                          <input
                            className={`cell-input${kind === 'text' ? ' text' : ''}`}
                            // biome-ignore lint/a11y/noAutofocus: cell editor
                            autoFocus
                            value={editing.text}
                            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                            onBlur={() => commitEdit()}
                            onPaste={(e) => {
                              // Several cells (from a spreadsheet) go into the grid from here,
                              // not into this one cell's text.
                              const text = pastedText(e.clipboardData)
                              if (!isMultiCellPaste(text)) {
                                // One cell of this app's copy guarded for spreadsheets: its
                                // exact text, where the browser would put the plain one.
                                if (text === e.clipboardData.getData('text/plain')) return
                                e.preventDefault()
                                const el = e.currentTarget
                                const from = el.selectionStart ?? el.value.length
                                const to = el.selectionEnd ?? from
                                setEditing({
                                  ...editing,
                                  text: el.value.slice(0, from) + text + el.value.slice(to),
                                })
                                return
                              }
                              e.preventDefault()
                              e.stopPropagation()
                              cellDone.current = true
                              setEditing(null)
                              grid.current?.focus()
                              pasteText(text, false, { r, c })
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                commitEdit({ r: r + (e.shiftKey ? -1 : 1), c })
                              } else if (e.key === 'Tab') {
                                e.preventDefault()
                                commitEdit({ r, c: c + (e.shiftKey ? -1 : 1) })
                              } else if (e.key === 'Escape') {
                                cellDone.current = true
                                setEditing(null)
                                grid.current?.focus()
                              } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                                e.preventDefault()
                                commitEdit({ r: r + (e.key === 'ArrowDown' ? 1 : -1), c })
                              }
                            }}
                          />
                        ) : (
                          <>
                            {limit && (
                              <span className="limit-mark" aria-hidden="true">
                                {limit.side === 'below' ? '‹' : '›'}
                              </span>
                            )}
                            {content}
                            {excluded && <span className="excl-mark">*</span>}
                          </>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {last < displayRows && (
                <tr role="row" className="spacer" style={{ height: (displayRows - last) * ROW_H }}>
                  <td role="cell" colSpan={cols.length + 1} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
