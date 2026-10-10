import { registry } from '@ps/analyses'
import {
  DUPLICABLE_KINDS,
  duplicateNode,
  removalWarnings,
  type SearchTarget,
  stepSheetCommands,
} from '@ps/engine'
import { type DocNode, type FolderId, type NodeId, newFolderId } from '@ps/model'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  type Command,
  GROUPS,
  isMacPlatform,
  isViewKey,
  NAVIGATOR_KEYS,
  useCommands,
} from './commands/index.ts'
import { CommandMenu, type CommandMenuState } from './components/CommandMenu.tsx'
import { countedLabel, type MenuEntry } from './components/commandItems.ts'
import { Icon } from './components/icons.tsx'
import { useConfirm } from './components/modals.tsx'
import { CommandTip, Tooltip } from './components/Tooltip.tsx'
import { useDoc, useResultLookup, useServices } from './context.tsx'
import { MatchFormatDialog } from './graph/MatchFormat.tsx'
import { linkedSheets } from './linkedSheets.ts'
import { requestFocus, useThumbnail } from './organise/context.tsx'
import { MoveToFolderDialog } from './organise/FolderDialogs.tsx'
import {
  dropCommands,
  duplicatesOf,
  inOrder,
  openAfterRemoval,
  removalOf,
  removalQuestion,
  sheetCount,
  sheetsToMove,
} from './organise/navBatch.ts'
import {
  familyItems,
  kindSections,
  loadCollapsed,
  loadThumbnails,
  loadView,
  type NavFolder,
  type NavItem,
  type NavSheet,
  type NavView,
  newFolderName,
  saveCollapsed,
  saveThumbnails,
  saveView,
  sheetsToFile,
  shownSections,
  visibleKeys,
} from './organise/navModel.ts'
import {
  actingOn,
  afterClick,
  clearToOpen,
  clickKind,
  extendTo,
  onlyOpen,
  selectAllShown,
  showsSelection,
  visibleSheets,
} from './organise/navSelection.ts'
import { SearchPanel } from './organise/SearchPanel.tsx'
import { useNavSelection } from './organise/useNavSelection.ts'
import { givesTable } from './resultTables.ts'
import { requestReveal } from './table/reveal.ts'

/** A sheet's right-click menu: the Edit menu's sheet commands, and reuse by kind (roadmap 31). */
const sheetMenu = (kind: DocNode['kind']): MenuEntry[] => [
  { command: 'edit.renameSheet', label: 'Rename…' },
  { command: 'edit.duplicateSheet', label: 'Duplicate' },
  ...(kind === 'table'
    ? ['edit.duplicateFamily', '-', 'analyze.applyTo', 'analyze.saveMethod', 'analyze.applyMethod']
    : kind === 'graph'
      ? ['insert.graphLike']
      : []),
  '-',
  { command: 'edit.moveSheetUp', label: 'Move up' },
  { command: 'edit.moveSheetDown', label: 'Move down' },
  { command: 'edit.moveToFolder', label: 'Move to folder…' },
  '-',
  { command: 'edit.deleteSheet', label: 'Delete', danger: true },
]

/**
 * Roadmap 47: the menu of several selected sheets, each item with the count it acts on (Move up
 * / down and Rename stay for one sheet).
 */
const selectionMenu = (sheets: number, figures: number, graphs: number): MenuEntry[] => [
  { command: 'edit.duplicateSheet', label: 'Duplicate', count: sheets },
  { command: 'edit.moveToFolder', label: 'Move to folder…', count: sheets },
  '-',
  { command: 'file.export.selected', label: 'Export selected…', count: figures },
  { command: 'format.applyStyleSelected', label: 'Apply style…', count: graphs },
  { command: 'format.matchFormatSelected', label: 'Match format…', count: graphs },
  '-',
  { command: 'edit.deleteSheet', label: 'Delete', danger: true, count: sheets },
]

export const KIND_NAMES: Record<DocNode['kind'], string> = {
  table: 'data table',
  analysis: 'results',
  graph: 'graph',
  layout: 'layout',
  info: 'info sheet',
}

/** Where a dragged sheet would land (roadmap 40). */
type DropAt =
  | { kind: 'sheet'; id: NodeId; key: string; side: 'before' | 'after' }
  | { kind: 'folder'; folder: FolderId | null; key: string }

interface DragState {
  /** The row grabbed. */
  id: NodeId
  /** Roadmap 47: the sheets dragged, the grabbed one's selection when it is selected. */
  ids: NodeId[]
  group: string
  /**
   * Family view: a top-level entry (a table's family, a page, an info sheet); several: each is
   * one, or in the family of one.
   */
  root: boolean
  x: number
  y: number
  moving: boolean
  at: DropAt | null
}

export function Navigator({
  selected,
  onSelect,
  onShow,
  onApplyStyle,
  onExport,
}: {
  /** The open sheet. */
  selected: NodeId | null
  onSelect: (id: NodeId | null) => void
  /** Shows the navigator (when hidden) for Search the project. */
  onShow?: () => void
  /** Roadmap 47: the Styles dialog for the selected graphs. */
  onApplyStyle?: (graphs: NodeId[]) => void
  /** Roadmap 47: the export dialog for the selected graphs and layout pages. */
  onExport?: (ids: NodeId[]) => void
}) {
  const { store, engine } = useServices()
  const confirm = useConfirm()
  const project = useDoc((d) => d)
  const { version, lookup } = useResultLookup()
  const [renaming, setRenaming] = useState<NodeId | null>(null)
  /** A folder being renamed, in one section (null: the first showing it). */
  const [renaming_, setRenaming_] = useState<{ id: FolderId; where: string | null } | null>(null)
  const renamingFolder = renaming_?.id ?? null
  const setRenamingFolder = (id: FolderId | null, where: string | null = null) =>
    setRenaming_(id ? { id, where } : null)
  const [menu, setMenu] = useState<CommandMenuState | null>(null)
  const [view, setViewState] = useState<NavView>(loadView)
  const [thumbs, setThumbsState] = useState(loadThumbnails)
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [query, setQuery] = useState('')
  const [moveDialog, setMoveDialog] = useState<NodeId[] | null>(null)
  // Roadmap 47: Move to folder… and Match format… for several selected sheets.
  const [moveMany, setMoveMany] = useState<{ ids: NodeId[]; count: number } | null>(null)
  const [matchFor, setMatchFor] = useState<NodeId[] | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  // Roadmap 47: the sheets selected (several, or the open one alone), beside the open one.
  const { selection: sel, set: setSel } = useNavSelection(selected, project)
  const nav = useRef<HTMLElement>(null)
  const search = useRef<HTMLInputElement>(null)
  // A click right after a drag is the drag's end, not a selection.
  const dragged = useRef(false)

  const setView = (v: NavView) => {
    setViewState(v)
    saveView(v)
  }
  const setThumbs = (on: boolean) => {
    setThumbsState(on)
    saveThumbnails(on)
  }
  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveCollapsed(next)
      return next
    })

  const sections = useMemo(
    () => (view === 'kind' ? shownSections(kindSections(project, collapsed)) : null),
    [project, collapsed, view],
  )
  const family = useMemo(
    () => (view === 'family' ? familyItems(project, collapsed) : null),
    [project, collapsed, view],
  )
  /** Each sheet's entry at home (for Move up / down of the selected sheet). */
  const homes = useMemo(() => {
    const out = new Map<NodeId, NavSheet>()
    const walk = (items: readonly NavItem[]) => {
      for (const it of items) {
        if (it.type === 'sheet' && !it.link && !it.set && !out.has(it.id)) out.set(it.id, it)
        walk(it.items)
      }
    }
    for (const s of sections ?? []) walk(s.items)
    walk(family ?? [])
    return out
  }, [sections, family])

  // ---- The selection (roadmap 47) -----------------------------------------------------------

  /** The sheets shown, in order: Shift ranges and ⌘A run over them. */
  const shown = useMemo(
    () => visibleSheets(sections ? sections.flatMap((s) => s.items) : (family ?? [])),
    [sections, family],
  )
  /** What the commands act on, in navigator order: the selected sheets, else the open one. */
  const chosen = actingOn(sel, project.order)
  const several = chosen.length > 1
  const multi = showsSelection(sel)
  const picked = new Set(sel.ids)
  const chosenGraphs = chosen.filter((id) => project.nodes[id]?.kind === 'graph')
  const chosenFigures = chosen.filter((id) => {
    const k = project.nodes[id]?.kind
    return k === 'graph' || k === 'layout'
  })
  /** A plain click or Enter: the sheet alone, opened. */
  const open = (id: NodeId) => {
    setSel(onlyOpen(id))
    onSelect(id)
  }

  /** Several sheets deleted together: one question listing what goes with them, one step. */
  /** Deletes the sheets (asking first); whether it did. */
  const removeMany = async (ids: readonly NodeId[]): Promise<boolean> => {
    const q = removalQuestion(project, ids)
    if (q && !(await confirm({ ...q, danger: true }))) return false
    const doc = store.getState()
    const r = removalOf(doc, ids)
    if (!r.commands.length) return false
    store.dispatch(r.commands, `Delete ${sheetCount(inOrder(doc, ids).length)}`)
    const rest = store.getState().order
    const next =
      selected && rest.includes(selected) ? selected : openAfterRemoval(doc.order, rest, r.gone)
    setSel(onlyOpen(next))
    onSelect(next)
    return true
  }
  /** Several sheets duplicated together: the copies selected, the first opened. */
  const duplicateMany = (ids: readonly NodeId[]) => {
    const { commands: cmds, copies } = duplicatesOf(store.getState(), ids)
    if (!cmds.length) return
    store.dispatch(cmds, `Duplicate ${sheetCount(copies.length)}`)
    setSel({ ids: copies, anchor: copies[0]!, open: copies[0]! })
    onSelect(copies[0]!)
  }
  /** The rows the keyboard reaches, in the order shown. */
  const rowEls = () => [
    ...(nav.current?.querySelectorAll<HTMLElement>('[data-key][tabindex]') ?? []),
  ]
  /**
   * Delete on a row: the selection when the row is in it, else the row's sheet. Audit 3 (A5): the
   * focus then goes to the row now where the (first) deleted one was, else the last row — once
   * the sheet opened in its place has taken the focus for itself (no rows left: the search box).
   */
  const removeFrom = (id: NodeId) => {
    const several = sel.ids.length > 1 && picked.has(id)
    const ids = new Set<string>(several ? sel.ids : [id])
    const rows = rowEls()
    const at = rows.findIndex((r) => !r.classList.contains('link') && ids.has(r.dataset.node ?? ''))
    void (several ? removeMany(sel.ids) : remove(id)).then((done) => {
      if (!done || at < 0) return
      requestAnimationFrame(() =>
        setTimeout(() => {
          const now = rowEls()
          // No rows left: the search box, still in the navigator.
          const to = now[Math.min(at, now.length - 1)] ?? nav.current?.querySelector('input')
          to?.focus()
        }),
      )
    })
  }

  /** Deletes a sheet (asking first when formulas read it); whether it did. */
  const remove = async (id: NodeId): Promise<boolean> => {
    // Audit 2 (M5): an info sheet whose fields formulas read.
    const uses = removalWarnings(project, id)
    if (
      uses.length &&
      !(await confirm({
        title: 'Delete it anyway?',
        message: uses.join(' '),
        ok: 'Delete',
        danger: true,
      }))
    )
      return false
    const idx = project.order.indexOf(id)
    store.dispatch({ type: 'node.remove', id })
    const rest = store.getState().order
    // Audit 3 (U3): the open sheet stays open unless it went (as `removeMany` does).
    if (!(selected && rest.includes(selected)))
      onSelect(rest[Math.min(idx, rest.length - 1)] ?? null)
    return true
  }

  /** Focus back on a sheet's row once it has moved (React moves the element). */
  const refocus = (id: NodeId) =>
    requestAnimationFrame(() =>
      nav.current?.querySelector<HTMLElement>(`.nav-item[data-node="${id}"]:not(.link)`)?.focus(),
    )

  const step = (id: NodeId, dir: 'up' | 'down') => {
    const home = homes.get(id)
    if (!home) return
    const cmds = stepSheetCommands(store.getState(), id, dir, home.siblings)
    if (cmds.length) store.dispatch(cmds, dir === 'up' ? 'Move up' : 'Move down')
    refocus(id)
  }
  const canStep = (id: NodeId | null, dir: 'up' | 'down') => {
    const home = id ? homes.get(id) : undefined
    if (!home) return false
    const i = home.siblings.indexOf(home.id)
    return dir === 'up' ? i > 0 : i >= 0 && i < home.siblings.length - 1
  }

  const newFolder = (parent?: FolderId, members: NodeId[] = []) => {
    const id = newFolderId()
    store.dispatch(
      {
        type: 'folder.add',
        folder: { id, name: newFolderName(store.getState()), ...(parent ? { parent } : {}) },
        members,
      },
      'New folder',
    )
    onShow?.()
    setRenamingFolder(id)
  }

  // The selected sheet's commands (Edit menu) and the sheets linked to it (View › Go to…). The
  // navigator owns the selection, so it offers them whatever view is open. Roadmap 47: with
  // several sheets selected, Duplicate, Delete and Move to folder… act on them all (their labels
  // counting them), Rename and Move up / down are for one sheet; the selected graphs and pages
  // can be exported, styled and matched.
  const one = chosen.length === 1 ? project.nodes[chosen[0]!] : undefined
  const node = several ? undefined : one
  const kind = node ? KIND_NAMES[node.kind] : 'sheet'
  const forOne = several ? { disabledReason: 'Select one sheet for this' } : {}
  const openNode = selected ? project.nodes[selected] : undefined
  const linked = selected ? linkedSheets(project, selected) : {}
  const sheet = (order: number) => ({ menu: 'edit' as const, group: GROUPS.edit.sheet, order })
  const goTo = (id: string, label: string, order: number, target: NodeId | undefined): Command => ({
    id,
    label,
    menu: { menu: 'view', group: GROUPS.view.goTo, order },
    enabled: !!target,
    hint: target ? `Open “${project.nodes[target]?.name}”` : undefined,
    run: () => target && onSelect(target),
  })
  const commands: Command[] = [
    {
      id: 'edit.renameSheet',
      label: 'Rename sheet…',
      menu: sheet(10),
      enabled: !!node,
      ...forOne,
      hint: 'Rename the selected sheet (or double-click it, or F2 in the navigator)',
      run: () => node && setRenaming(node.id),
    },
    {
      id: 'edit.duplicateSheet',
      label: several
        ? `Duplicate ${sheetCount(chosen.length)}`
        : node?.kind === 'analysis'
          ? 'Duplicate analysis'
          : 'Duplicate sheet',
      menu: sheet(20),
      enabled: several
        ? chosen.some((id) => DUPLICABLE_KINDS.has(project.nodes[id]!.kind))
        : !!node && DUPLICABLE_KINDS.has(node.kind),
      hint: several
        ? 'A copy of each, after it'
        : node?.kind === 'table'
          ? 'A copy of the data (not its analyses or graphs)'
          : node?.kind === 'graph'
            ? 'A copy of the graph, showing the same data'
            : node?.kind === 'layout'
              ? 'A copy of the page, with the same graphs'
              : node?.kind === 'analysis'
                ? 'A copy of the analysis, of the same data with the same parameters'
                : undefined,
      run: () => {
        if (several) return duplicateMany(chosen)
        if (!node || !DUPLICABLE_KINDS.has(node.kind)) return
        const cmd = duplicateNode(store.getState(), node.id)
        store.dispatch(cmd, `Duplicate ${node.kind === 'analysis' ? 'analysis' : kind}`)
        open(cmd.node.id)
      },
    },
    {
      id: 'edit.deleteSheet',
      label: several ? `Delete ${sheetCount(chosen.length)}` : 'Delete sheet',
      menu: sheet(30),
      enabled: several || !!node,
      hint: several
        ? 'Delete the selected sheets and what is computed from them (undoable)'
        : 'Delete the selected sheet and what is computed from it (undoable)',
      run: () => (several ? void removeMany(chosen) : node && void remove(node.id)),
    },
    // Roadmap 40: reordering and folders.
    {
      id: 'edit.moveSheetUp',
      label: 'Move sheet up',
      menu: sheet(40),
      enabled: canStep(node?.id ?? null, 'up'),
      ...forOne,
      hint: 'Before the sheet above it in the navigator (Alt+↑ on the sheet)',
      keywords: ['reorder', 'order'],
      run: () => node && step(node.id, 'up'),
    },
    {
      id: 'edit.moveSheetDown',
      label: 'Move sheet down',
      menu: sheet(41),
      enabled: canStep(node?.id ?? null, 'down'),
      ...forOne,
      hint: 'After the sheet below it in the navigator (Alt+↓ on the sheet)',
      keywords: ['reorder', 'order'],
      run: () => node && step(node.id, 'down'),
    },
    {
      id: 'edit.moveToFolder',
      label: several ? `Move ${sheetCount(chosen.length)} to folder…` : 'Move to folder…',
      menu: sheet(42),
      enabled: several || !!node,
      keywords: ['folder', 'organise', 'organize', 'group'],
      run: () =>
        several
          ? setMoveMany({ ids: sheetsToMove(project, chosen, view), count: chosen.length })
          : node && setMoveDialog(sheetsToFile(project, node.id, view)),
    },
    // Roadmap 47: the selected graphs and layout pages.
    {
      id: 'file.export.selected',
      label: countedLabel('Selected in the navigator…', chosenFigures.length),
      menu: { menu: 'file', group: GROUPS.file.export, order: 72, submenu: 'Export' },
      enabled: chosenFigures.length > 0 && !!onExport,
      disabledReason: 'Select graphs or layout pages in the navigator',
      keywords: ['export', 'batch', 'selected', 'figures', 'zip', 'folder'],
      hint: 'Export the graphs and layout pages selected in the navigator, one file each',
      run: () => onExport?.(chosenFigures),
    },
    {
      id: 'format.applyStyleSelected',
      label: countedLabel('Apply style to the selected graphs…', chosenGraphs.length),
      menu: { menu: 'format', group: GROUPS.format.styles, order: 12 },
      enabled: chosenGraphs.length > 0 && !!onApplyStyle,
      disabledReason: 'Select graphs in the navigator',
      keywords: ['style', 'theme', 'journal', 'selected', 'graphs'],
      hint: 'A style for the graphs selected in the navigator',
      run: () => onApplyStyle?.(chosenGraphs),
    },
    {
      id: 'format.matchFormatSelected',
      label: countedLabel('Match format of the selected graphs…', chosenGraphs.length),
      menu: { menu: 'format', group: GROUPS.format.styles, order: 13 },
      enabled:
        chosenGraphs.length > 0 &&
        Object.values(project.nodes).filter((x) => x.kind === 'graph').length > 1,
      disabledReason: 'Select graphs in the navigator',
      keywords: ['magic', 'match', 'format', 'look like', 'selected', 'graphs'],
      hint: 'Make the graphs selected in the navigator look like another graph',
      run: () => setMatchFor(chosenGraphs),
    },
    {
      id: 'insert.folder',
      label: 'New folder',
      menu: { menu: 'insert', group: GROUPS.insert.sheets, order: 60 },
      hint: 'A folder of the navigator, to group sheets',
      keywords: ['folder', 'organise', 'organize', 'group'],
      run: () => newFolder(),
    },
    {
      id: 'view.navFamilies',
      label: 'Show families in the navigator',
      menu: { menu: 'view', group: GROUPS.view.panels, order: 20 },
      checked: view === 'family',
      hint: 'Each data table with its analyses, results and graphs (else sheets by kind)',
      keywords: ['family', 'tree', 'navigator', 'by kind'],
      run: () => setView(view === 'family' ? 'kind' : 'family'),
    },
    {
      id: 'view.navThumbnails',
      label: 'Thumbnails in the navigator',
      menu: { menu: 'view', group: GROUPS.view.panels, order: 21 },
      checked: thumbs,
      hint: 'Small pictures of graphs and layouts',
      keywords: ['thumbnail', 'preview', 'picture'],
      run: () => setThumbs(!thumbs),
    },
    {
      id: 'view.searchProject',
      label: 'Search the project…',
      menu: { menu: 'view', group: GROUPS.view.panels, order: 15 },
      // A table keeps ⌘F for its find bar (the view's command; no second accelerator there).
      ...(openNode?.kind !== 'table' ? { shortcut: 'Mod+F' } : {}),
      hint: 'Sheet names, notes, info fields, column, graph and axis titles, text on pages',
      keywords: ['find', 'search', 'sheet'],
      run: () => {
        onShow?.()
        requestAnimationFrame(() => {
          search.current?.focus()
          search.current?.select()
        })
      },
    },
    goTo('view.goToTable', 'Go to data table', 10, linked.table),
    goTo('view.goToResults', 'Go to results', 20, linked.results),
    goTo('view.goToGraph', 'Go to graph', 30, linked.graph),
  ]
  useCommands('app', commands)

  // ---- Dragging sheets (pointer events: Chromium, WebKit, Firefox alike; no HTML5 drag, so the
  // file-drop overlay of roadmap 39 never sees it) ---------------------------------------------

  const dropAt = (x: number, y: number, d: DragState): DropAt | null => {
    const el = document.elementFromPoint(x, y)
    const row = el?.closest<HTMLElement>('.nav-item[data-node]')
    if (row && !row.classList.contains('link')) {
      const id = row.dataset.node as NodeId
      if (d.ids.includes(id)) return null
      const group = row.dataset.group ?? ''
      const sameKind = row.dataset.kind === project.nodes[d.id]?.kind
      // Beside a sheet of its kind (by kind: in any folder; families: among its siblings, or
      // top-level entries in any folder).
      const ok =
        group === d.group ||
        (view === 'kind' && sameKind) ||
        (view === 'family' && sameKind && d.root && row.dataset.root === '1')
      if (!ok) return null
      const box = row.getBoundingClientRect()
      return {
        kind: 'sheet',
        id,
        key: row.dataset.key ?? id,
        side: y < box.top + box.height / 2 ? 'before' : 'after',
      }
    }
    const folder = el?.closest<HTMLElement>('[data-folder-drop]')
    if (folder) {
      const f = folder.dataset.folderDrop!
      // In the Family view only top-level entries go into folders.
      if (view === 'family' && !d.root) return null
      return {
        kind: 'folder',
        folder: f ? (f as FolderId) : null,
        key: folder.dataset.keyDrop ?? folder.dataset.key ?? f,
      }
    }
    return null
  }

  const finishDrag = (d: DragState) => {
    const at = d.at
    if (!at) return
    const doc = store.getState()
    // Roadmap 47: several selected sheets dragged together, each with its family (Family view).
    const move = inOrder(doc, d.ids)
    const drag = { move, file: sheetsToMove(doc, move, view) }
    const many = move.length > 1 ? `Move ${sheetCount(move.length)}` : null
    if (at.kind === 'folder') {
      const cmds = dropCommands(doc, drag, { folder: at.folder })
      if (cmds.length)
        store.dispatch(cmds, many ?? (at.folder ? 'Move to folder' : 'Move out of folder'))
      return
    }
    const cmds = dropCommands(doc, drag, {
      sheet: at.side === 'before' ? { before: at.id } : { after: at.id },
    })
    if (cmds.length) store.dispatch(cmds, many ?? 'Move sheet')
    refocus(d.id)
  }

  const dragRef = useRef(drag)
  dragRef.current = drag
  const dragging = drag !== null
  // biome-ignore lint/correctness/useExhaustiveDependencies: listeners read the latest state
  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const moving = d.moving || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4
      if (!moving) return
      const at = dropAt(e.clientX, e.clientY, d)
      setDrag({ ...d, moving, at })
    }
    const up = () => {
      const d = dragRef.current
      setDrag(null)
      if (d?.moving) {
        dragged.current = true
        setTimeout(() => {
          dragged.current = false
        }, 0)
        finishDrag(d)
      }
    }
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', cancel)
    }
  }, [dragging])

  // ---- Keyboard: ↑/↓ between rows, Alt+↑/↓ moves the sheet, ←/→ fold ------------------------

  const keys = useMemo(
    () => visibleKeys(sections ? sections.flatMap((s) => s.items) : (family ?? [])),
    [sections, family],
  )
  const focusKey = (key: string | undefined) => {
    if (!key) return
    nav.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus()
  }
  /** The sheet each selectable row shows, by its key. */
  const keyIds = useMemo(() => {
    const out = new Map<string, NodeId>()
    const walk = (items: readonly NavItem[]) => {
      for (const it of items) {
        if (it.type === 'sheet' && !it.link && !it.set) out.set(it.key, it.id)
        walk(it.items)
      }
    }
    walk(sections ? sections.flatMap((s) => s.items) : (family ?? []))
    return out
  }, [sections, family])
  const arrows = (e: React.KeyboardEvent, key: string): boolean => {
    if (e.altKey || e.metaKey || e.ctrlKey) return false
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false
    e.preventDefault()
    const i = keys.indexOf(key)
    const next = keys[e.key === 'ArrowDown' ? i + 1 : i - 1]
    focusKey(next)
    // Roadmap 47: Shift extends the selection from the anchor to the row reached.
    const to = next === undefined ? undefined : keyIds.get(next)
    if (e.shiftKey && to) setSel(extendTo(sel, to, shown))
    return true
  }

  // ---- Rows ------------------------------------------------------------------------------------

  const markerOf = (key: string) =>
    drag?.moving && drag.at && drag.at.key === key
      ? drag.at.kind === 'sheet'
        ? ` drop-${drag.at.side}`
        : ' drop-into'
      : ''

  // Set while rendering: the rename field of a folder has been placed.
  let renameShown = false

  // Audit 2, U16: the Family view is a tree (rows are tree items with their level and whether
  // they are open; a row's children are its group). ↑/↓ move between rows, ←/→ fold and unfold.
  // Roadmap 47: each section of the By kind view is a tree too (it was a list of buttons), so
  // rows can say they are selected: every tree is multi-selectable, its sheets' rows
  // `aria-selected`.
  const level = (depth: number) => depth + 1
  /** A row's children: the row's group in the tree. */
  const children = (nodes: ReactNode) => (
    // biome-ignore lint/a11y/useSemanticElements: a tree item's group of rows, not a form's
    <div role="group">{nodes}</div>
  )

  /** Family view: a top-level entry (unfiled, or at the top of a folder). */
  const isRoot = (it: NavSheet) =>
    view === 'family' &&
    (it.group.startsWith('family:root:') || it.group.startsWith('family:folder:'))
  /** Roadmap 47, Family view: several dragged sheets, each top-level or in a dragged family. */
  const allRoots = (ids: readonly NodeId[]) => {
    const roots = ids.filter((id) => {
      const home = homes.get(id)
      return !!home && isRoot(home)
    })
    const carried = new Set(sheetsToMove(project, roots, view))
    return ids.every((id) => carried.has(id))
  }

  const renderSheet = (it: NavSheet): ReactNode => {
    const n = project.nodes[it.id]
    if (!n) return null
    if (it.set)
      return (
        <div key={it.key} className="nav-set" role="none">
          <div
            className="nav-set-label"
            role="treeitem"
            aria-level={level(it.depth)}
            tabIndex={0}
            data-key={it.key}
            aria-expanded={it.open}
            style={{ paddingLeft: 14 + it.depth * 14 }}
            onClick={() => toggle(it.key)}
            onKeyDown={(e) => {
              if (arrows(e, it.key)) return
              if (e.key === 'Enter' || e.key === ' ') toggle(it.key)
            }}
          >
            <span className={`chevron ${it.open ? 'open' : ''}`} aria-hidden />
            {it.set.label}
          </div>
          {it.open && children(it.items.map(renderItem))}
        </div>
      )
    const state = n.kind === 'analysis' ? engine.get(n.id) : undefined
    const hasItems = it.items.length > 0
    const isSelected = !it.link && picked.has(n.id)
    const row = (
      <div
        key={it.key}
        role="treeitem"
        aria-level={level(it.depth)}
        tabIndex={0}
        aria-current={n.id === selected && !it.link ? 'page' : undefined}
        aria-selected={it.link ? undefined : isSelected}
        data-version={version}
        data-node={n.id}
        data-key={it.key}
        data-kind={n.kind}
        data-group={it.group}
        data-root={isRoot(it) ? '1' : '0'}
        aria-expanded={view === 'family' && hasItems ? it.open : undefined}
        className={`nav-item ${n.id === selected && !it.link ? 'on' : ''}${it.link ? ' link' : ''}${
          multi && isSelected ? ' selected' : ''
        }${drag?.moving && drag.ids.includes(n.id) ? ' dragging' : ''}${markerOf(it.key)}`}
        style={{ paddingLeft: 14 + it.depth * 14 }}
        onClick={(e) => {
          if (dragged.current) return
          // Roadmap 47: ⌘-click (Ctrl elsewhere) and Shift-click select without opening.
          const how = it.link ? 'plain' : clickKind(e)
          if (how === 'plain') open(n.id)
          else setSel(afterClick(sel, n.id, how, shown))
        }}
        onDoubleClick={() => !it.link && setRenaming(n.id)}
        onPointerDown={(e) => {
          if (e.button !== 0 || it.link || renaming === n.id) return
          if ((e.target as Element).closest('button, input, .chevron, .nav-delete')) return
          // Roadmap 47: a selected row drags the whole selection.
          const ids = sel.ids.length > 1 && isSelected ? inOrder(project, sel.ids) : [n.id]
          setDrag({
            id: n.id,
            ids,
            group: it.group,
            root: ids.length > 1 ? allRoots(ids) : isRoot(it),
            x: e.clientX,
            y: e.clientY,
            moving: false,
            at: null,
          })
        }}
        onContextMenu={(e) => {
          if (renaming === n.id) return
          e.preventDefault()
          const at = { x: e.clientX, y: e.clientY }
          // Roadmap 47: on one of several selected sheets, the selection's menu; elsewhere the
          // row is selected (and opened) first, as Finder does.
          if (isSelected && sel.ids.length > 1) {
            setMenu({
              ...at,
              entries: selectionMenu(chosen.length, chosenFigures.length, chosenGraphs.length),
              label: `${sheetCount(chosen.length)} selected`,
            })
            return
          }
          open(n.id)
          // After the sheet has opened (a view takes focus as it opens; the menu's
          // keyboard needs it).
          setTimeout(() => setMenu({ ...at, entries: sheetMenu(n.kind), label: n.name }))
        }}
        onKeyDown={(e) => {
          if (renaming) return
          const up = isViewKey(NAVIGATOR_KEYS.moveUp, e)
          if ((up || isViewKey(NAVIGATOR_KEYS.moveDown, e)) && !it.link) {
            e.preventDefault()
            step(n.id, up ? 'up' : 'down')
            return
          }
          if (arrows(e, it.key)) return
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            if (hasItems && (e.key === 'ArrowRight') !== it.open) toggle(it.key)
            // Audit 3 (A3): a tree's keys, on a leaf too (nothing else acts on them).
            if (!e.altKey && !e.metaKey && !e.ctrlKey) e.preventDefault()
            return
          }
          if (e.key === 'Enter') open(n.id)
          if (it.link) return
          if (isViewKey(NAVIGATOR_KEYS.rename, e)) setRenaming(n.id)
          if (isViewKey(NAVIGATOR_KEYS.remove, e)) {
            e.preventDefault()
            removeFrom(n.id)
          }
        }}
      >
        {view === 'family' &&
          (hasItems ? (
            <span
              className={`chevron ${it.open ? 'open' : ''}`}
              aria-hidden
              onClick={(e) => {
                e.stopPropagation()
                toggle(it.key)
              }}
            />
          ) : (
            <span className="chevron none" aria-hidden />
          ))}
        <span
          className={`icon icon-${n.kind} ${givesTable(n, n.kind === 'analysis' ? registry.get(n.analysisId) : undefined, lookup) ? 'icon-result-table' : ''}`}
          aria-hidden
        />
        {thumbs && (n.kind === 'graph' || n.kind === 'layout') && <Thumb id={n.id} />}
        {renaming === n.id && !it.link ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: inline rename
            autoFocus
            defaultValue={n.name}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== n.name) {
                store.dispatch({ type: 'node.rename', id: n.id, name: e.target.value })
              }
              setRenaming(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenaming(null)
            }}
          />
        ) : (
          <span className="name">{n.name}</span>
        )}
        {state?.status === 'error' && (
          <span className="badge error" title={state.message}>
            !
          </span>
        )}
        {state?.status === 'pending' && <span className="badge pending" title="Updating" />}
        {!it.link && (
          // For the pointer: a sheet's row holds no controls (roadmap 41); Delete or Backspace on
          // the focused row, or its menu, does this.
          <span
            className="nav-delete"
            title={`Delete ${n.name} (undoable)`}
            aria-hidden="true"
            onClick={(e) => {
              e.stopPropagation()
              void remove(n.id)
            }}
          >
            ×
          </span>
        )}
      </div>
    )
    if (!hasItems) return row
    return (
      <div key={`${it.key}#branch`} className="nav-branch" role="none">
        {row}
        {it.open && children(it.items.map(renderItem))}
      </div>
    )
  }

  const folderMenu = (f: NavFolder['folder'], at: { x: number; y: number }, where: string) =>
    setMenu({
      ...at,
      label: f.name,
      entries: [
        { label: 'Rename folder…', onSelect: () => setRenamingFolder(f.id, where) },
        ...(f.parent === undefined
          ? [{ label: 'New folder inside', onSelect: () => newFolder(f.id) }]
          : []),
        ...(f.parent !== undefined
          ? [
              {
                label: 'Move out to the top',
                onSelect: () =>
                  store.dispatch({ type: 'folder.move', id: f.id, parent: null }, 'Move folder'),
              },
            ]
          : (project.folders ?? [])
              .filter(
                (o) =>
                  o.id !== f.id &&
                  o.parent === undefined &&
                  !(project.folders ?? []).some((s) => s.parent === f.id),
              )
              .map((o) => ({
                label: `Move into “${o.name}”`,
                onSelect: () =>
                  store.dispatch({ type: 'folder.move', id: f.id, parent: o.id }, 'Move folder'),
              }))),
        '-',
        {
          label: 'Delete folder (keeps its sheets)',
          danger: true,
          onSelect: () => store.dispatch({ type: 'folder.remove', id: f.id }, 'Delete folder'),
        },
      ],
    })

  const renderFolder = (it: NavFolder, section: string): ReactNode => {
    const f = it.folder
    // The rename field shows once (a folder shows in several sections).
    const editing =
      renaming_?.id === f.id &&
      (renaming_.where === section || (renaming_.where === null && !renameShown))
    if (editing) renameShown = true
    return (
      <div key={`${section}:${it.key}`} className="nav-folder-group" role="none">
        <div
          className={`nav-folder${markerOf(`${section}:${it.key}`)}`}
          role="treeitem"
          aria-level={level(it.depth)}
          tabIndex={0}
          aria-expanded={it.open}
          data-key={it.key}
          data-folder-drop={f.id}
          data-key-drop={`${section}:${it.key}`}
          style={{ paddingLeft: 10 + it.depth * 14 }}
          onClick={() => renamingFolder !== f.id && toggle(it.key)}
          onDoubleClick={() => setRenamingFolder(f.id, section)}
          onContextMenu={(e) => {
            e.preventDefault()
            folderMenu(f, { x: e.clientX, y: e.clientY }, section)
          }}
          onKeyDown={(e) => {
            if (renamingFolder === f.id) return
            if (arrows(e, it.key)) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggle(it.key)
            }
            if (
              (e.key === 'ArrowRight') === !it.open &&
              (e.key === 'ArrowRight' || e.key === 'ArrowLeft')
            )
              toggle(it.key)
            if (isViewKey(NAVIGATOR_KEYS.rename, e)) setRenamingFolder(f.id, section)
          }}
        >
          <span className={`chevron ${it.open ? 'open' : ''}`} aria-hidden />
          <span className="icon icon-folder" aria-hidden />
          {editing ? (
            <input
              // biome-ignore lint/a11y/noAutofocus: inline rename
              autoFocus
              aria-label="Folder name"
              defaultValue={f.name}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const name = e.target.value.trim()
                if (name && name !== f.name)
                  store.dispatch({ type: 'folder.rename', id: f.id, name }, 'Rename folder')
                setRenamingFolder(null)
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenamingFolder(null)
              }}
            />
          ) : (
            <span className="folder-name">{f.name}</span>
          )}
          <span className="folder-count" aria-hidden>
            {it.count || ''}
          </span>
        </div>
        {it.open &&
          children(
            it.items.map((x) => (x.type === 'folder' ? renderFolder(x, section) : renderSheet(x))),
          )}
      </div>
    )
  }

  const renderItem = (it: NavItem): ReactNode =>
    it.type === 'folder' ? renderFolder(it, view) : renderSheet(it)

  return (
    <nav
      className={`navigator${multi ? ' multi' : ''}`}
      aria-label="Project"
      ref={nav}
      onKeyDown={(e) => {
        // ⌘F / Ctrl+F in the navigator searches the project, even with a table open.
        if (
          (isMacPlatform() ? e.metaKey : e.ctrlKey) &&
          !e.shiftKey &&
          e.key.toLowerCase() === 'f'
        ) {
          e.preventDefault()
          search.current?.focus()
          search.current?.select()
        }
        // Roadmap 47: on a row, ⌘A selects every sheet shown, Escape the open one alone.
        if (!(e.target as Element).closest?.('.nav-item, .nav-folder, .nav-set-label')) return
        if (renaming || renaming_) return
        if (isViewKey(NAVIGATOR_KEYS.selectAll, e, isMacPlatform())) {
          e.preventDefault()
          setSel(selectAllShown(sel, shown))
        } else if (isViewKey(NAVIGATOR_KEYS.clear, e) && multi) {
          e.preventDefault()
          setSel(clearToOpen(sel))
        }
      }}
    >
      <div className="nav-head">
        <input
          ref={search}
          type="search"
          className="nav-search"
          aria-label="Search the project"
          placeholder="Search sheets, titles, notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="nav-tools">
          <fieldset className="segmented" aria-label="Navigator view">
            {(
              [
                ['kind', 'By kind'],
                ['family', 'Families'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                className={view === v ? 'on' : ''}
                onClick={() => setView(v)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          {/* Roadmap 43: icons at least 24 px, with the app's tooltips. */}
          <Tooltip
            content={
              <CommandTip name="Thumbnails" hint="Show small pictures of graphs and layouts" />
            }
          >
            <button
              type="button"
              className={`nav-tool ${thumbs ? 'on' : ''}`}
              aria-pressed={thumbs}
              aria-label="Thumbnails"
              onClick={() => setThumbs(!thumbs)}
            >
              <Icon name="gallery-thumbnails" />
            </button>
          </Tooltip>
          <Tooltip content={<CommandTip name="New folder" hint="A folder to organise sheets in" />}>
            <button
              type="button"
              className="nav-tool"
              aria-label="New folder"
              onClick={() => newFolder()}
            >
              <Icon name="folder-plus" />
            </button>
          </Tooltip>
        </div>
      </div>
      {/* Roadmap 47: how many sheets are selected (a live region, there before it says so). */}
      <p className="nav-selection" role="status">
        {multi ? `${sheetCount(sel.ids.length)} selected` : ''}
      </p>
      {query.trim() ? (
        <SearchPanel
          query={query}
          inputRef={search}
          onClear={() => setQuery('')}
          onJump={(id: NodeId, target: SearchTarget) => {
            onSelect(id)
            // The column's first cell, an info field…: the view shows it once open.
            if (target.kind === 'column')
              requestReveal({ table: id, row: 0, column: target.column })
            else requestFocus(id, target)
          }}
        />
      ) : sections ? (
        sections.map((sec) => (
          <div
            key={sec.kind}
            className={`nav-section${drag?.moving && drag.at?.kind === 'folder' && drag.at.folder === null && drag.at.key === `section:${sec.kind}` ? ' drop-into' : ''}`}
            data-folder-drop=""
            data-key={`section:${sec.kind}`}
          >
            <h3>{sec.title}</h3>
            {sec.items.length > 0 && (
              <div role="tree" aria-label={sec.title} aria-multiselectable="true">
                {sec.items.map((it) =>
                  it.type === 'folder' ? renderFolder(it, sec.kind) : renderSheet(it),
                )}
              </div>
            )}
            {!sec.items.length && <p className="nav-empty">No data tables yet.</p>}
          </div>
        ))
      ) : (
        <div
          className={`nav-section nav-families${drag?.moving && drag.at?.kind === 'folder' && drag.at.folder === null ? ' drop-into' : ''}`}
          data-folder-drop=""
          data-key="section:family"
          {...(family?.length
            ? { role: 'tree', 'aria-label': 'Sheets by family', 'aria-multiselectable': true }
            : {})}
        >
          {(family ?? []).map(renderItem)}
          {!family?.length && <p className="nav-empty">No sheets yet.</p>}
        </div>
      )}
      {moveMany && (
        <MoveToFolderDialog
          ids={moveMany.ids}
          count={moveMany.count}
          onNewFolder={(members) => newFolder(undefined, members)}
          onClose={() => setMoveMany(null)}
        />
      )}
      {matchFor && (
        <MatchFormatDialog
          graphs={matchFor}
          {...(selected ? { initial: selected } : {})}
          onClose={() => setMatchFor(null)}
        />
      )}
      {menu && <CommandMenu menu={menu} onClose={() => setMenu(null)} />}
      {moveDialog && (
        <MoveToFolderDialog
          ids={moveDialog}
          onNewFolder={(members) => newFolder(undefined, members)}
          onClose={() => setMoveDialog(null)}
        />
      )}
    </nav>
  )
}

/** A graph's or page's thumbnail in the navigator. */
function Thumb({ id }: { id: NodeId }) {
  const url = useThumbnail(id)
  return (
    <span className="nav-thumb" aria-hidden>
      {url ? <img src={url} alt="" draggable={false} /> : null}
    </span>
  )
}
