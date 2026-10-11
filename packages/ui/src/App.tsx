import { registry } from '@ps/analyses'
import { createGraphFor, fontFaceCss, GRAPH_PRESETS, presetsFor } from '@ps/graph'
import {
  BINARY_TABLE_CELLS,
  IMPORT_EXTENSIONS,
  ImportError,
  importFile,
  isTextImport,
  ProjectFileError,
  type Sheet,
  type TextImportOptions,
  tableCells,
} from '@ps/io'
import {
  createProjectWith,
  createTable,
  type DataTable,
  type MigrationNote,
  type NodeId,
  type Project,
  type TableKind,
} from '@ps/model'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ResultsView } from './analysis/ResultsView.tsx'
import {
  type Command,
  CommandsContext,
  createCommandRegistry,
  dispatchKey,
  GROUPS,
  isMacPlatform,
  isTextTarget,
  NativeKeyGate,
  TOOLBAR_GROUPS,
  useCommandRegistry,
  useCommands,
} from './commands/index.ts'
import { CommandPalette, type PaletteExtra } from './components/CommandPalette.tsx'
import { lazyComponent, preloadAll, whenIdle } from './components/lazy.tsx'
import { MenuBar } from './components/MenuBar.tsx'
import { ConfirmContext, useModalHost } from './components/modals.tsx'
import { PRIVACY_SUMMARY, privacyText } from './components/privacy.ts'
import {
  errorToast,
  type ShowError,
  type ToastKind,
  type ToastMessage,
  Toasts,
} from './components/Toasts.tsx'
import { Toolbar } from './components/Toolbar.tsx'
import {
  type NoticeChannel,
  UndoNoticeContext,
  UndoNotices,
  useUndoNotices,
} from './components/undoNotice.tsx'
import {
  ServicesContext,
  useDoc,
  useHistory,
  useResultLookup,
  useServices,
  useSourceTable,
} from './context.tsx'
import { type DropTarget, type FileSource, projectAction } from './drop/dropRouter.ts'
import { readFiles } from './drop/transfer.ts'
import {
  DropContext,
  type DropHandled,
  type DropModifiers,
  DropOverlay,
  type DroppedFile,
  NO_MODS,
  useFileDrop,
} from './drop/useFileDrop.tsx'
import { EXAMPLES, type ExampleContext, type ExampleDef, exampleById } from './examples/registry.ts'
import { useWorkbookExport } from './export/dataExport.tsx'
import { projectSheets } from './export/workbooks.ts'
import { useBatchExport } from './graph/batchExport.tsx'
import { GraphBuilder } from './graph/builder/GraphBuilder.tsx'
import { ExportStatus } from './graph/ExportStatus.tsx'
import { type FormatTarget, seriesPlace } from './graph/format/route.ts'
import { GraphView } from './graph/GraphView.tsx'
import { plotFunctionNodes } from './graph/plotFunction.ts'
import { importPreset } from './graph/presets/userPresetStore.ts'
import { LARGE_CSV_BYTES } from './import/largeFiles.ts'
import { createLayoutFor } from './layout/figure.ts'
import { LayoutView } from './layout/LayoutView.tsx'
import { KIND_NAMES, Navigator } from './Navigator.tsx'
import { GettingStarted } from './onboarding/GettingStarted.tsx'
import { ThumbnailsContext, useThumbnailCache } from './organise/context.tsx'
import { InfoView } from './organise/InfoView.tsx'
import { useOrganise } from './organise/useOrganise.tsx'
import type { RecentFile } from './recent.ts'
import {
  recentAnalyses,
  recentPresets,
  rememberAnalysis,
  useRecentChoicesVersion,
} from './recentChoices.ts'
import {
  defaultLiveness,
  defaultRecoveryBuffer,
  RecoveryController,
  type RecoveryRecord,
  recoveryName,
  recoveryTime,
} from './recovery.ts'
import { dataNodeFor } from './resultTables.ts'
import { useReuse } from './reuse/useReuse.tsx'
import {
  type AppServices,
  load,
  projectFileParts,
  serialize,
  verifyLoadedResults,
} from './services.ts'
import {
  currentPreferences,
  importStyle,
  preferencesRead,
  usePreferences,
} from './styles/styleStore.ts'
import { useStyles } from './styles/useStyles.tsx'
import { TableView } from './table/TableView.tsx'
import { useColorScheme } from './theme/colorScheme.ts'
import { capitalize, errorMessage, nextName, validSelection } from './util.ts'
import { createSerializer } from './worker/serialize.ts'

// Audit 2 (P8): the shell's dialogs, loaded when first shown (fetched once the page is idle).
const AnalyzeDialog = lazyComponent(() =>
  import('./analysis/AnalyzeDialog.tsx').then((m) => m.AnalyzeDialog),
)
const AboutDialog = lazyComponent(() =>
  import('./components/HelpDialogs.tsx').then((m) => m.AboutDialog),
)
const ShortcutsDialog = lazyComponent(() =>
  import('./components/HelpDialogs.tsx').then((m) => m.ShortcutsDialog),
)
const ImageDropDialog = lazyComponent(() =>
  import('./drop/ImageDropDialog.tsx').then((m) => m.ImageDropDialog),
)
const ExamplesDialog = lazyComponent(() =>
  import('./examples/ExamplesDialog.tsx').then((m) => m.ExamplesDialog),
)
const ImportDialog = lazyComponent(() => import('./ImportDialog.tsx').then((m) => m.ImportDialog))
const PzfxImportDialog = lazyComponent(() =>
  import('./import/PzfxImportDialog.tsx').then((m) => m.PzfxImportDialog),
)
const LargeImportDialog = lazyComponent(() =>
  import('./LargeImportDialog.tsx').then((m) => m.LargeImportDialog),
)
const MigrationNotice = lazyComponent(() =>
  import('./MigrationNotice.tsx').then((m) => m.MigrationNotice),
)
const NewTableDialog = lazyComponent(() =>
  import('./NewTableDialog.tsx').then((m) => m.NewTableDialog),
)
const RecoveryDialog = lazyComponent(() =>
  import('./RecoveryDialog.tsx').then((m) => m.RecoveryDialog),
)
// The desktop app's update check and prompt (Tauri only).
const UpdateCheck = lazyComponent(() =>
  import('./updates/UpdatePrompt.tsx').then((m) => m.UpdateCheck),
)

type DialogState =
  | null
  | { kind: 'newTable' }
  | { kind: 'analyze'; tableId: NodeId; analysisId?: string; draftTable?: DataTable }
  | { kind: 'editAnalysis'; analysisId: NodeId }
  | {
      kind: 'import'
      fileName: string
      sheets: Sheet[]
      reparse?: (opts: TextImportOptions) => Sheet[]
    }
  | { kind: 'largeImport'; fileName: string; blob: Blob }
  /** Roadmap 39: a .pzfx project's tables and, ticked, its graphs. */
  | { kind: 'pzfx'; fileName: string; bytes: Uint8Array }
  /** Roadmap 39: images dropped off a layout page, to put on a page or ignore. */
  | { kind: 'images'; files: { name: string; bytes: Uint8Array }[] }
  | { kind: 'newGraph'; tableId: NodeId; preset?: string }
  | { kind: 'examples' }
  | { kind: 'palette' }
  | { kind: 'shortcuts' }
  | { kind: 'about' }
  | { kind: 'recover'; records: RecoveryRecord[] }
  | { kind: 'migrated'; notes: MigrationNote[] }

/**
 * Analyze menu shortcuts to common analyses: each opens the Analyze dialog on the current table
 * with the first of its analyses that the table's kind accepts.
 */
const QUICK_ANALYSES: { label: string; ids: string[]; keywords?: string[] }[] = [
  { label: 't test…', ids: ['ttest'], keywords: ['unpaired', 'paired', 'welch'] },
  { label: 'One-way ANOVA…', ids: ['oneWayAnova'], keywords: ['kruskal', 'tukey'] },
  { label: 'Two-way ANOVA…', ids: ['twoWayAnova'] },
  {
    label: 'Nonlinear regression (curve fit)…',
    ids: ['nonlinearFit', 'nonlinearFitMV'],
    keywords: ['fit', 'dose response', 'nls'],
  },
  { label: 'Simple linear regression…', ids: ['linearRegression'] },
  { label: 'Correlation…', ids: ['correlation'], keywords: ['pearson', 'spearman'] },
  { label: 'Descriptive statistics…', ids: ['descriptive'], keywords: ['mean', 'sd', 'median'] },
  { label: 'Chi-square and Fisher’s exact test…', ids: ['contingency'] },
  {
    label: 'Survival curves…',
    ids: ['survival', 'survivalFromVariables'],
    keywords: ['kaplan meier', 'log-rank'],
  },
  { label: 'Multiple linear regression…', ids: ['multipleRegression'] },
]

/** Roadmap 38: analyses making tables that follow their source (Analyze › Data manipulation). */
const DATA_ANALYSES: { label: string; ids: string[]; hint: string; keywords?: string[] }[] = [
  {
    label: 'Filter rows…',
    ids: ['filterRows'],
    hint: 'A table of the rows that meet a condition, following the source',
    keywords: ['subset', 'where', 'select rows', 'condition'],
  },
  {
    label: 'Aggregate by group…',
    ids: ['aggregate'],
    hint: 'One row per group of text variables: mean, median, SD, n… of each number variable',
    keywords: ['summarise', 'summarize', 'group by', 'pseudobulk', 'per sample'],
  },
  {
    label: 'Row, column or total percentages…',
    ids: ['percentages'],
    hint: 'Each count as a % of its row, its column or the total',
    keywords: ['row %', 'column %', 'proportions'],
  },
  {
    label: 'Convert time units…',
    ids: ['survivalTime'],
    hint: 'Days, weeks, months or years',
    keywords: ['days', 'weeks', 'months', 'years'],
  },
]

/** Analyses that need no data, and the kind of table made for them when none is open. */
const NO_DATA_ANALYSES: { id: string; label: string; kind: TableKind }[] = [
  { id: 'powerAnalysis', label: 'Sample size and power…', kind: 'column' },
  { id: 'simulateXY', label: 'Simulate XY data…', kind: 'xy' },
  { id: 'simulateColumn', label: 'Simulate column data…', kind: 'column' },
  { id: 'simulateContingency', label: 'Simulate contingency table…', kind: 'contingency' },
  { id: 'monteCarlo', label: 'Monte Carlo analysis…', kind: 'column' },
]

const NAV_KEY = 'ps.showNavigator'
/** View › Toolbar › Icons only (roadmap 43), remembered per user like the navigator. */
const TOOLBAR_KEY = 'ps.toolbarIconsOnly'
const readFlag = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

export function App({ services }: { services: AppServices }) {
  const [commands] = useState(createCommandRegistry)
  const [undoNotices] = useState(() => new UndoNotices())
  return (
    <ServicesContext.Provider value={services}>
      <CommandsContext.Provider value={commands}>
        <UndoNoticeContext.Provider value={undoNotices}>
          <Shell />
        </UndoNoticeContext.Provider>
      </CommandsContext.Provider>
    </ServicesContext.Provider>
  )
}

function Shell() {
  const services = useServices()
  const { store, platform } = services
  const project = useDoc((d) => d)
  const history = useHistory()
  const [selected, setSelected] = useState<NodeId | null>(project.order[0] ?? null)
  // Audit 2 (U26): the one modal host. The shell's dialogs and its hooks' (organise, reuse,
  // styles, batch export) are held in its slot, one at a time; questions are asked in its
  // dialog, not the browser's (`window.confirm`, which Tauri doesn't show).
  const modals = useModalHost()
  const { confirm } = modals
  const shellModal = modals.slot<NonNullable<DialogState>>('shell')
  const dialog = shellModal.open
  const { show: showDialog, close: closeDialog } = shellModal
  const setDialog = useCallback(
    (d: DialogState) => (d ? showDialog(d) : closeDialog()),
    [showDialog, closeDialog],
  )
  const [showNavigator, setShowNavigator] = useState(() => readFlag(NAV_KEY, true))
  useEffect(() => {
    try {
      localStorage.setItem(NAV_KEY, showNavigator ? '1' : '0')
    } catch {}
  }, [showNavigator])
  const [iconsOnly, setIconsOnly] = useState(() => readFlag(TOOLBAR_KEY, false))
  useEffect(() => {
    try {
      localStorage.setItem(TOOLBAR_KEY, iconsOnly ? '1' : '0')
    } catch {}
  }, [iconsOnly])
  useRecentChoicesVersion()
  // A Format dialog to open on a graph just made (Plot a function).
  const [pendingFormat, setPendingFormat] = useState<{
    graph: NodeId
    target: FormatTarget
  } | null>(null)
  // Only when the graph opens right after it is made (not when coming back to it later).
  useEffect(() => {
    if (pendingFormat && selected !== pendingFormat.graph) setPendingFormat(null)
  }, [selected, pendingFormat])
  // Audit 2, U15: errors (kept until dismissed) and notices (passing) apart (`Toasts`).
  const [toasts, setToasts] = useState<Record<ToastKind, ToastMessage | null>>({
    error: null,
    notice: null,
  })
  const [fileName, setFileName] = useState<string | null>(null)
  const desktop = platform.kind === 'desktop'

  const toastKey = useRef(0)
  /**
   * An error, or a warning about the data: shown until dismissed; a validation message (what
   * was typed or chosen can't be used, roadmap 43) for `VALIDATION_MS`.
   */
  const showError = useCallback<ShowError>((msg, kind = 'failure') => {
    const toast = errorToast(msg, kind, ++toastKey.current)
    setToasts((t) => ({ ...t, error: toast }))
  }, [])
  /** A passing message (what was copied, added, saved): gone after a few seconds. */
  const showNotice = useCallback((msg: string) => {
    setToasts((t) => ({ ...t, notice: { msg, kind: 'notice', key: ++toastKey.current } }))
  }, [])
  const dismissToast = useCallback(
    (kind: ToastKind) => setToasts((t) => ({ ...t, [kind]: null })),
    [],
  )
  // Roadmap 43: a step made outside the menus (a Format dialog's OK, a drag) with its Undo.
  const undoChannel = useMemo<NoticeChannel>(
    () => ({
      show: (msg, { key = ++toastKey.current, ...o }) => {
        setToasts((t) => ({ ...t, notice: { msg, kind: 'notice', key, ...o } }))
        return key
      },
      drop: (key) => setToasts((t) => (t.notice?.key === key ? { ...t, notice: null } : t)),
    }),
    [],
  )
  /**
   * Audit 3 (A7): what screen readers are told with nothing shown (undo and redo: "Undone:
   * Bold title"); a new node each time, so the same words are read again.
   */
  const [announced, setAnnounced] = useState<{ text: string; key: number } | null>(null)
  const announce = useCallback(
    (text: string) => setAnnounced((a) => ({ text, key: (a?.key ?? 0) + 1 })),
    [],
  )
  /** Undo or redo, announced with the step's label. */
  const undoOrRedo = (back: boolean) => {
    const label = back ? store.undoLabel : store.redoLabel
    if (!(back ? store.undo() : store.redo())) return
    announce(`${back ? 'Undone' : 'Redone'}${label ? `: ${label}` : ''}`)
  }
  const undoRegistry = useCommandRegistry()
  const undoStep = useCallback(() => void undoRegistry.run('edit.undo'), [undoRegistry])
  useUndoNotices(store, undoChannel, undoStep)

  // Fonts for on-screen SVG text, matching the measurement fonts exactly.
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = fontFaceCss()
    document.head.append(style)
    return () => style.remove()
  }, [])

  // The dialogs loaded when first shown (audit 2, P8): fetched once the page is idle, so a first
  // open doesn't wait for them.
  useEffect(() => whenIdle(() => void preloadAll()), [])

  // Keep the selection valid (e.g. after undoing a node's creation, or redoing it).
  useEffect(() => {
    const valid = validSelection(project, selected)
    if (valid !== selected) setSelected(valid)
  }, [project, selected])

  useEffect(() => {
    document.title = `${fileName ?? 'Untitled'}${history.dirty ? ' •' : ''} — statPlotter`
  }, [fileName, history.dirty])

  const node = selected ? project.nodes[selected] : undefined
  // What Analyze… / New graph… work on: a data table, a result table, or the analyzed data.
  const { lookup } = useResultLookup()
  const exportWorkbook = useWorkbookExport(showError)
  const batchExport = useBatchExport({
    project,
    result: lookup,
    projectName: (fileName ?? 'Untitled').replace(/\.psproj$/i, ''),
    onNotice: showNotice,
    onError: showError,
    slot: modals.slot,
  })
  const tableForAnalyze: NodeId | null = dataNodeFor(node, (id) => registry.get(id), lookup)
  const analyzeKind = useSourceTable(tableForAnalyze)?.tableKind

  // ---- Open recent ----------------------------------------------------------------------------

  const recentFiles = platform.recent
  const [recent, setRecent] = useState<RecentFile[]>([])
  useEffect(() => {
    recentFiles?.list().then(setRecent, () => {})
  }, [recentFiles])
  const remember = useCallback(
    (file: { name: string; handle: unknown }) => {
      if (recentFiles && file.handle) recentFiles.add(file).then(setRecent, () => {})
    },
    [recentFiles],
  )

  // ---- Recovery copies -------------------------------------------------------------------------

  // What the copy's view.json records as the open sheet (read when a copy is written).
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const [recoverySaved, setRecoverySaved] = useState<number | null>(null)
  // Large tables take long to write (JSON, deflate): in a worker where there is one, started
  // when the page is first idle; on the main thread when the page is going away.
  const [serializer] = useState(() => (typeof Worker === 'undefined' ? null : createSerializer()))
  /** The project holds a large table (roadmap 34e): its files are made in the worker. */
  const isLarge = useCallback(
    () =>
      Object.values(store.getState().nodes).some(
        (n) => n.kind === 'table' && tableCells(n) > BINARY_TABLE_CELLS,
      ),
    [store],
  )
  const [recovery] = useState(() => {
    if (!platform.recovery) return null
    const serializer_ = serializer ?? createSerializer()
    return new RecoveryController({
      storage: platform.recovery,
      liveness: defaultLiveness(),
      store,
      serializer: serializer_,
      buffer: defaultRecoveryBuffer(),
      // Large tables (roadmap 34e): copies from the worker only (see `large`).
      large: isLarge,
      snapshot: (here) => {
        const view = { selected: selectedRef.current }
        const { project: doc, results, assets } = projectFileParts(services, view)
        const file = services.file
        return {
          bytes: here
            ? serialize(services, view)
            : serializer_.serialize(doc, results, view, assets),
          file: file && {
            name: file.name,
            path: typeof file.handle === 'string' ? file.handle : null,
            handle: file.handle,
          },
          tableNames: doc.order.flatMap((id) => {
            const n = doc.nodes[id]
            return n?.kind === 'table' ? [n.name] : []
          }),
          sheetCount: doc.order.length,
        }
      },
      onStatus: setRecoverySaved,
      onError: (e) => console.warn('Recovery copy not written:', e),
    })
  })
  useEffect(() => {
    if (!recovery) return
    const stop = recovery.start()
    // Leaving the page (or the app) now: keep what isn't saved yet.
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void recovery.flush()
    }
    const onBlur = () => void recovery.flush()
    // Closing, reloading, navigating: the last edits are written now, from the main thread; a
    // clean close leaves nothing to recover.
    const onPageHide = () => void recovery.leave()
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', onPageHide)
      stop()
    }
  }, [recovery])

  // ---- File ------------------------------------------------------------------------------------

  const save = useCallback(
    async (as: boolean) => {
      try {
        // A project with large tables (roadmap 34e) is written in the serializing worker (seconds
        // of deflate for a million rows), once the location is chosen.
        const view = { selected }
        const bytes =
          isLarge() && serializer
            ? () => {
                const { project: doc, results, assets } = projectFileParts(services, view)
                return serializer.serialize(doc, results, view, assets)
              }
            : serialize(services, view)
        const res = await platform.saveProject(
          bytes,
          fileName ?? `${project.meta.title}.psproj`,
          as ? null : services.file?.handle,
        )
        if (!res) return
        services.file = res
        setFileName(res.name)
        store.markSaved()
        void recovery?.clear()
        remember(res)
      } catch (e) {
        showError(`Save failed: ${String(e)}`)
      }
    },
    [
      services,
      platform,
      store,
      selected,
      fileName,
      project.meta.title,
      showError,
      remember,
      recovery,
      serializer,
      isLarge,
    ],
  )

  const loadFile = useCallback(
    (file: { name: string; bytes: Uint8Array; handle: unknown }) => {
      const view = load(services, file.bytes)
      verifyLoadedResults(services, showError)
      services.file = { name: file.name, handle: file.handle }
      setFileName(file.name)
      setSelected(view.selected)
      remember(file)
      if (view.notes.length) setDialog({ kind: 'migrated', notes: view.notes })
    },
    [services, remember, showError, setDialog],
  )

  /** Whether the project may be replaced: nothing unsaved, or the user says to discard it. */
  const discardOk = useCallback(
    async () =>
      !store.dirty ||
      (await confirm({ title: 'Discard unsaved changes?', ok: 'Discard', danger: true })),
    [store, confirm],
  )

  const open = useCallback(async () => {
    if (!(await discardOk())) return
    try {
      const file = await platform.openProject()
      if (file) loadFile(file)
    } catch (e) {
      showError(e instanceof ProjectFileError ? e.message : `Open failed: ${String(e)}`)
    }
  }, [platform, discardOk, loadFile, showError])

  const openRecent = async (file: RecentFile) => {
    if (!recentFiles || !(await discardOk())) return
    let res: Awaited<ReturnType<typeof recentFiles.open>>
    try {
      res = await recentFiles.open(file)
    } catch (e) {
      // Moved or deleted: forget it.
      showError(`Couldn’t open ${file.name}: ${errorMessage(e)}`)
      recentFiles.remove(file).then(setRecent, () => {})
      return
    }
    if (!res) return
    try {
      loadFile(res)
    } catch (e) {
      showError(e instanceof ProjectFileError ? e.message : `Open failed: ${String(e)}`)
    }
  }

  /**
   * Starts the import of a picked or dropped file: a large CSV file's own dialog (roadmap 34e), a
   * .pzfx project's (roadmap 39) or the import dialog. Answers whether a dialog opened.
   */
  const importPicked = async (picked: { name: string; blob: Blob }): Promise<boolean> => {
    // A large CSV file (roadmap 34e) is streamed into a table, never read whole here.
    if (isTextImport(picked.name) && picked.blob.size >= LARGE_CSV_BYTES) {
      setDialog({ kind: 'largeImport', fileName: picked.name, blob: picked.blob })
      return true
    }
    const bytes = new Uint8Array(await picked.blob.arrayBuffer())
    return importBytes({ name: picked.name, bytes })
  }
  const importBytes = (file: { name: string; bytes: Uint8Array }): boolean => {
    if (/\.pzfx$/i.test(file.name)) {
      setDialog({ kind: 'pzfx', fileName: file.name, bytes: file.bytes })
      return true
    }
    const res = importFile(file.name, file.bytes)
    if (res.kind === 'sheets') {
      if (!res.sheets.length) throw new ImportError('The file has no data.')
      // Delimited text can be re-read with another delimiter / decimal separator.
      const reparse = isTextImport(file.name)
        ? (opts: TextImportOptions) => {
            const again = importFile(file.name, file.bytes, opts)
            return again.kind === 'sheets' ? again.sheets : []
          }
        : undefined
      setDialog({ kind: 'import', fileName: file.name, sheets: res.sheets, reparse })
      return true
    }
    if (!res.tables.length) throw new ImportError('The file has no data tables this app can read.')
    store.dispatch(
      res.tables.flatMap((table) => [
        { type: 'node.add' as const, node: table },
        { type: 'node.add' as const, node: createGraphFor(table, table.name), fresh: true },
      ]),
      `Import ${file.name}`,
    )
    setSelected(res.tables[0]!.id)
    if (res.warnings.length) showError(res.warnings.join(' '))
    return false
  }

  const importData = async () => {
    try {
      if (platform.openData) {
        const picked = await platform.openData('Data files', [...IMPORT_EXTENSIONS])
        if (picked) await importPicked(picked)
        return
      }
      const file = await platform.openFile('Data files', [...IMPORT_EXTENSIONS])
      if (file) importBytes(file)
    } catch (e) {
      showError(e instanceof ImportError ? e.message : `Import failed: ${String(e)}`)
    }
  }

  // Files dropped on the window (roadmap 39), or opened from the operating system (roadmap 41):
  // each handled as File › Open, Import data…, Insert › Image… or the preset and style libraries
  // would, one after another.
  const handleDropped = async (
    step: { name: string; kind: string },
    files: DroppedFile[],
    // Where they were dropped: the same for every kind of file here (images: a page is asked).
    _target: DropTarget,
    mods: DropModifiers,
    source: FileSource,
  ): Promise<DropHandled> => {
    const file = files[0]!
    const done = (result: string, ok = true, notify = false): DropHandled => ({
      outcome: {
        name: files.length > 1 ? `${files.length} images` : step.name,
        result,
        ok,
        notify,
      },
      waits: false,
    })
    try {
      switch (step.kind) {
        case 'project': {
          const read = {
            name: file.name,
            bytes: new Uint8Array(await file.blob.arrayBuffer()),
            handle: file.handle,
          }
          // Roadmap 40: onto an open project, import from it (Alt / Shift) or ask; opened
          // from the operating system (roadmap 41), it opens.
          const action = projectAction(source, !store.getState().order.length, mods)
          if (action === 'import') {
            // Unreadable: the message is shown, no dialog opened, the next file's turn (U4).
            if (!organise.importFile(read)) return done('not imported (couldn’t be read)', false)
            return { ...done('offered for import'), waits: true }
          }
          if (action === 'ask') {
            organise.askOpenOrImport(read)
            return { ...done('opened or imported, as chosen'), waits: true }
          }
          if (!(await discardOk())) return done('not opened (the current project was kept)', false)
          loadFile(read)
          return done('opened')
        }
        case 'data':
        case 'pzfx': {
          const waits = await importPicked(file)
          return { ...done(waits ? 'opened in the import dialog' : 'imported'), waits }
        }
        case 'image': {
          setDialog({ kind: 'images', files: await readFiles(files) })
          return { ...done('offered for a page'), waits: true }
        }
        case 'preset': {
          if (!platform.presets) return done('presets can’t be kept here', false, true)
          const p = await importPreset(platform.presets, await file.blob.text())
          return done(`added to your graph presets as “${p.name}”`, true, true)
        }
        case 'style': {
          if (!platform.styles) return done('styles can’t be kept here', false, true)
          const st = await importStyle(platform.styles, await file.blob.text())
          return done(`added to your styles as “${st.name}”`, true, true)
        }
        default:
          return done('not a file this app opens', false, true)
      }
    } catch (e) {
      const msg = e instanceof ImportError || e instanceof ProjectFileError ? e.message : String(e)
      return done(`not opened: ${msg}`, false, true)
    }
  }
  const exampleContext = useMemo<ExampleContext>(
    () => ({
      fonts: services.fonts,
      sourceFile: (path) => services.platform.readSourceData?.(path) ?? Promise.resolve(null),
      localSourceData: services.platform.readSourceData !== undefined,
    }),
    [services],
  )
  /** Replaces the project (a new one, an example) without asking. */
  const replaceProject = useCallback(
    (next: Project) => {
      services.assets.replace([])
      store.reset(next)
      services.file = null
      setFileName(null)
      setSelected(next.order[0] ?? null)
    },
    [services, store],
  )
  /** Replaces the project with an example (asks first if there are unsaved changes). */
  const openProject = useCallback(
    async (example: Project) => {
      if (!(await discardOk())) return false
      replaceProject(example)
      return true
    },
    [discardOk, replaceProject],
  )

  // Duplicate family, apply to tables, methods, templates… (roadmap 31).
  const reuse = useReuse({
    selected,
    onSelect: setSelected,
    onMessage: showError,
    onNotice: showNotice,
    openProject,
    fileName,
    slot: modals.slot,
  })
  // Styles, Fit to column and Preferences (roadmap 37).
  const prefs = usePreferences()
  // The app's colours (roadmap 41): the preference once read, else the system's.
  useColorScheme(preferencesRead() ? prefs.colorScheme : null, platform.setColorScheme)
  const styles = useStyles({ selected, onMessage: showNotice, slot: modals.slot })
  // Info sheets, Import from project, the Gallery (roadmap 40).
  const thumbnails = useThumbnailCache()
  const organise = useOrganise({
    onSelect: setSelected,
    onMessage: showError,
    onNotice: showNotice,
    openFile: async (file) => {
      if (!(await discardOk())) return
      try {
        loadFile(file)
      } catch (e) {
        showError(e instanceof ProjectFileError ? e.message : `Open failed: ${String(e)}`)
      }
    },
    applyStyle: styles.openFor,
    slot: modals.slot,
  })
  // Audit 2, U22 and U26: a modal dialog is open (the host's, whoever opened it, or a question):
  // a dropped file waits for it to close, the update prompt too.
  const modalOpen = modals.open
  const fileDrop = useFileDrop({
    handle: handleDropped,
    dialogOpen: modalOpen,
    targetOf: (el) =>
      el?.closest('[data-drop="page"]') ? 'page' : node?.kind === 'graph' ? 'graph' : 'other',
    // A summary of files all handled is a notice; one naming a failure stays.
    onSummary: (text, ok) => (ok ? showNotice(text) : showError(text)),
  })
  // The blank project the app starts with is a new project too: it takes the preferences once
  // they are read, unless it was replaced or changed meanwhile (decision 538).
  const startedWith = useRef(project)
  const prefsDone = useRef(false)
  useEffect(() => {
    if (prefsDone.current) return
    const p = store.getState()
    if (p !== startedWith.current || p.order.length || store.dirty) {
      prefsDone.current = true
      return
    }
    const settings = createProjectWith(prefs, p.meta.title).settings
    if (JSON.stringify(settings) === JSON.stringify(p.settings)) return
    prefsDone.current = true
    store.reset({ ...p, settings })
  }, [prefs, store])

  const openExample = async (e: ExampleDef) => {
    if (!(await discardOk())) return
    try {
      replaceProject(await e.build(exampleContext))
    } catch (err) {
      showError(`Couldn’t open the example: ${errorMessage(err)}`)
    }
  }

  // ---- Start: an example, a recovery copy, the last project ------------------------------------

  // ---- Files opened from the operating system (roadmap 41) --------------------------------------

  // A double-click on a project, Open with on a data file, a file dropped on the Dock icon: the
  // same steps as a drop, except that a project opens (asking about unsaved changes).
  const openedFiles = platform.openedFiles
  const openedAny = useRef(false)
  const { enqueue } = fileDrop
  const takeOpened = useCallback(async () => {
    if (!openedFiles) return false
    const files = await openedFiles.take().catch(() => [])
    if (!files.length) return false
    openedAny.current = true
    enqueue(files, 'other', NO_MODS, 'open')
    return true
  }, [openedFiles, enqueue])
  useEffect(() => openedFiles?.subscribe(() => void takeOpened()), [openedFiles, takeOpened])

  /**
   * Desktop: opens the files the app was started with or, when there are none, reopens the most
   * recent project if nothing has been started meanwhile.
   */
  const reopenLast = async () => {
    if ((await takeOpened()) || openedAny.current) return
    if (!desktop || !recentFiles) return
    const untouched = () => !store.dirty && !store.getState().order.length
    const [last] = await recentFiles.list().catch(() => [])
    if (!last || !untouched()) return
    // Moved or deleted since: start empty, say nothing.
    const res = await recentFiles.open(last).catch(() => null)
    if (!res || !untouched()) return
    try {
      loadFile(res)
    } catch (e) {
      showError(e instanceof ProjectFileError ? e.message : `Open failed: ${String(e)}`)
    }
  }

  // `?example=<id>` in the URL opens that example at start (`?demo` and `?paper` are the
  // getting-started example and the Stucchi figures); handy for testing. Otherwise recovery
  // copies left by pages that closed with unsaved changes are offered, and then (desktop) the
  // last project reopens. A ref, not state: StrictMode runs effects twice in development.
  const started = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, at start
  useEffect(() => {
    if (started.current) return
    started.current = true
    const q = new URLSearchParams(window.location.search)
    if (project.order.length) return
    const id =
      q.get('example') ?? (q.has('demo') ? 'getting-started' : q.has('paper') ? 'stucchi' : null)
    const example = id ? exampleById(id) : undefined
    if (example) {
      void Promise.resolve(example.build(exampleContext)).then(openProject)
      return
    }
    void (async () => {
      const records = recovery ? await recovery.orphans().catch(() => []) : []
      if (records.length) setDialog({ kind: 'recover', records })
      else await reopenLast()
    })()
  }, [])

  const recoverCopy = async (record: RecoveryRecord) => {
    if (!recovery) return
    try {
      const slot = await recovery.read(record.session)
      if (!slot) throw new Error('the copy is no longer there')
      const view = load(services, slot.bytes, { unsaved: true })
      verifyLoadedResults(services, showError)
      // Save goes back to the same file where the copy knows it (desktop path, browser file
      // handle); with only a name, Save asks where, suggesting it.
      services.file = record.fileName
        ? { name: record.fileName, handle: slot.handle ?? null }
        : null
      setFileName(record.fileName)
      setSelected(view.selected)
      selectedRef.current = view.selected
      setDialog(view.notes.length ? { kind: 'migrated', notes: view.notes } : null)
      // This window's own copy of it first; only then does the orphan go.
      await recovery.flush()
      await recovery.discard(record.session)
    } catch (e) {
      showError(`Couldn’t recover ${recoveryName(record)}: ${errorMessage(e)}`)
    }
  }

  const discardCopy = async (record: RecoveryRecord) => {
    await recovery?.discard(record.session).catch(() => {})
    const rest =
      dialog?.kind === 'recover' ? dialog.records.filter((r) => r.session !== record.session) : []
    if (rest.length) setDialog({ kind: 'recover', records: rest })
    else {
      setDialog(null)
      await reopenLast()
    }
  }

  const recoverLater = () => {
    setDialog(null)
    void reopenLast()
  }

  // ---- Insert / Analyze ---------------------------------------------------------------------

  const plotFunction = () => {
    const { table, graph, fn } = plotFunctionNodes(project)
    store.dispatch(
      [
        { type: 'node.add', node: table },
        { type: 'node.add', node: graph, fresh: true },
      ],
      'Plot a function',
    )
    setPendingFormat({ graph: graph.id, target: seriesPlace({ fn }, 'functions') })
    setSelected(graph.id)
  }

  const newLayout = () => {
    const layout = createLayoutFor(
      project,
      services.fonts,
      nextName(project, 'layout'),
      prefs.pageSize,
    )
    store.dispatch({ type: 'node.add', node: layout }, 'New layout')
    setSelected(layout.id)
  }

  const newGraph = (preset?: string) => {
    if (tableForAnalyze)
      setDialog({ kind: 'newGraph', tableId: tableForAnalyze, ...(preset ? { preset } : {}) })
  }

  /** Whether the current table's kind accepts one of these analyses; the first that does. */
  const applicable = (ids: readonly string[]) =>
    analyzeKind ? ids.find((id) => registry.get(id)?.accepts.includes(analyzeKind)) : undefined

  /** The Analyze dialog on the current table, `analysisId` preselected. */
  const analyze = (analysisId?: string) => {
    if (tableForAnalyze) setDialog({ kind: 'analyze', tableId: tableForAnalyze, analysisId })
  }

  /** An analysis that needs no data: on the current table, or on a new empty one. */
  const analyzeWithoutData = (analysisId: string, kind: TableKind) => {
    if (tableForAnalyze) return analyze(analysisId)
    const draftTable = createTable({ name: nextName(project, 'table'), tableKind: kind })
    setDialog({ kind: 'analyze', tableId: draftTable.id, analysisId, draftTable })
  }

  // ---- Commands --------------------------------------------------------------------------------

  const examples = EXAMPLES.filter((e) => exampleContext.localSourceData || !e.available)

  // Roadmap 43: the split buttons' menus — the graph presets and analyses chosen last.
  const offeredPresets = analyzeKind ? presetsFor(analyzeKind).map((p) => p.id) : []
  const recentGraphCommands: Command[] = analyzeKind
    ? recentPresets(analyzeKind)
        .filter((id) => offeredPresets.includes(id))
        .map((id) => ({
          id: `insert.graph.recent.${id}`,
          label: `${GRAPH_PRESETS.find((p) => p.id === id)?.label ?? id}…`,
          enabled: !!tableForAnalyze,
          hideInPalette: true,
          hint: 'A new graph of this type (chosen in the graph builder)',
          run: () => newGraph(id),
        }))
    : []
  const recentGraphIds = recentGraphCommands.length
    ? recentGraphCommands.map((c) => c.id)
    : ['insert.graph.recent.none']
  if (!recentGraphCommands.length)
    recentGraphCommands.push({
      id: 'insert.graph.recent.none',
      label: 'No recent graph types',
      enabled: false,
      hideInPalette: true,
      run: () => {},
    })
  const recentAnalysisCommands: Command[] = recentAnalyses().flatMap((id): Command[] => {
    const def = registry.get(id)
    if (!def) return []
    const noData = NO_DATA_ANALYSES.find((a) => a.id === id)
    return [
      {
        id: `analyze.recent.${id}`,
        label: `${def.title}…`,
        enabled: noData ? true : !!tableForAnalyze && !!applicable([id]),
        hideInPalette: true,
        hint: def.description,
        run: () => (noData ? analyzeWithoutData(id, noData.kind) : analyze(id)),
      },
    ]
  })
  const recentAnalysisIds = recentAnalysisCommands.length
    ? recentAnalysisCommands.map((c) => c.id)
    : ['analyze.recent.none']
  if (!recentAnalysisCommands.length)
    recentAnalysisCommands.push({
      id: 'analyze.recent.none',
      label: 'No recent analyses',
      enabled: false,
      hideInPalette: true,
      run: () => {},
    })

  const appCommands: Command[] = [
    // File
    {
      id: 'file.new',
      label: 'New project',
      menu: { menu: 'file', group: GROUPS.file.open, order: 10 },
      // Browsers keep ⌘N / ⌘W / ⌘T for themselves.
      ...(desktop ? { shortcut: 'Mod+N', inTextFields: true } : {}),
      keywords: ['clear', 'empty'],
      run: () => void openProject(createProjectWith(currentPreferences())),
    },
    {
      id: 'file.open',
      label: 'Open…',
      menu: { menu: 'file', group: GROUPS.file.open, order: 20 },
      shortcut: 'Mod+O',
      inTextFields: true,
      icon: 'folder-open',
      toolbar: { group: TOOLBAR_GROUPS.file, order: 20 },
      run: () => open(),
    },
    ...(recentFiles
      ? [
          ...(recent.length
            ? recent.map(
                (f, i): Command => ({
                  id: `file.recent.${i}`,
                  label: f.name,
                  menu: {
                    menu: 'file',
                    group: GROUPS.file.open,
                    order: 30,
                    submenu: 'Open recent',
                  },
                  hint: f.path,
                  keywords: ['recent'],
                  run: () => openRecent(f),
                }),
              )
            : [
                {
                  id: 'file.recent.none',
                  label: 'No recent files',
                  menu: {
                    menu: 'file',
                    group: GROUPS.file.open,
                    order: 30,
                    submenu: 'Open recent',
                  },
                  enabled: false,
                  hideInPalette: true,
                  run: () => {},
                } satisfies Command,
              ]),
          {
            id: 'file.recent.clear',
            label: 'Clear recent',
            menu: { menu: 'file', group: GROUPS.file.open, order: 31, submenu: 'Open recent' },
            enabled: recent.length > 0,
            run: () => {
              void recentFiles.clear().then(() => setRecent([]))
            },
          } satisfies Command,
        ]
      : []),
    ...examples.map(
      (e): Command => ({
        id: `file.example.${e.id}`,
        label: e.title,
        menu: { menu: 'file', group: GROUPS.file.open, order: 40, submenu: 'Examples' },
        hint: e.description,
        keywords: ['example'],
        run: () => openExample(e),
      }),
    ),
    {
      id: 'file.examples',
      label: 'Browse examples…',
      menu: { menu: 'file', group: GROUPS.file.open, order: 41, submenu: 'Examples' },
      keywords: ['example', 'demo', 'sample'],
      run: () => setDialog({ kind: 'examples' }),
    },
    {
      id: 'file.save',
      label: 'Save',
      menu: { menu: 'file', group: GROUPS.file.save, order: 10 },
      shortcut: 'Mod+S',
      inTextFields: true,
      icon: 'save',
      toolbar: { group: TOOLBAR_GROUPS.file, order: 30 },
      run: () => save(false),
    },
    {
      id: 'file.saveAs',
      label: 'Save as…',
      menu: { menu: 'file', group: GROUPS.file.save, order: 20 },
      shortcut: 'Mod+Shift+S',
      inTextFields: true,
      run: () => save(true),
    },
    {
      id: 'file.import',
      label: 'Import data…',
      menu: { menu: 'file', group: GROUPS.file.import, order: 10 },
      hint: 'CSV, Excel (.xlsx) or .pzfx',
      keywords: ['csv', 'excel', 'xlsx', 'pzfx'],
      icon: 'file-input',
      toolbar: { group: TOOLBAR_GROUPS.file, order: 15, label: 'Import' },
      run: () => importData(),
    },
    {
      id: 'file.export.all',
      label: 'All data and results…',
      menu: { menu: 'file', group: GROUPS.file.export, order: 90, submenu: 'Export' },
      enabled: Object.values(project.nodes).some(
        (n) => n.kind === 'table' || n.kind === 'analysis',
      ),
      keywords: ['export', 'excel', 'xlsx', 'workbook', 'all data'],
      hint: 'Export every data table and results sheet as one Excel workbook, with a sheet listing them',
      run: () =>
        exportWorkbook(
          () => projectSheets({ project: store.getState(), result: lookup }),
          `${(fileName ?? 'Untitled').replace(/\.psproj$/i, '')} data and results`,
        ),
    },
    {
      id: 'file.close',
      label: 'Close project',
      menu: { menu: 'file', group: GROUPS.file.close, order: 10 },
      ...(desktop ? { shortcut: 'Mod+W', inTextFields: true } : {}),
      run: () => void openProject(createProjectWith(currentPreferences())),
    },
    // Edit
    {
      id: 'edit.undo',
      label: history.undo ? `Undo ${history.undo}` : 'Undo',
      menu: { menu: 'edit', group: GROUPS.edit.undo, order: 10 },
      shortcut: 'Mod+Z',
      enabled: !!history.undo,
      icon: 'undo-2',
      toolbar: { group: TOOLBAR_GROUPS.undo, order: 10, label: 'Undo' },
      disabledReason: 'Nothing to undo',
      run: () => undoOrRedo(true),
    },
    {
      id: 'edit.redo',
      label: history.redo ? `Redo ${history.redo}` : 'Redo',
      menu: { menu: 'edit', group: GROUPS.edit.undo, order: 20 },
      shortcut: 'Mod+Shift+Z',
      enabled: !!history.redo,
      icon: 'redo-2',
      toolbar: { group: TOOLBAR_GROUPS.undo, order: 20, label: 'Redo' },
      disabledReason: 'Nothing to redo',
      run: () => undoOrRedo(false),
    },
    {
      // Windows' redo key; not in the menus.
      id: 'edit.redoY',
      label: 'Redo',
      shortcut: 'Mod+Y',
      enabled: !!history.redo,
      hideInPalette: true,
      run: () => undoOrRedo(false),
    },
    // View
    {
      id: 'view.navigator',
      label: 'Show navigator',
      menu: { menu: 'view', group: GROUPS.view.panels, order: 10 },
      shortcut: 'Mod+\\',
      checked: showNavigator,
      keywords: ['sidebar', 'panel', 'sheets'],
      run: () => setShowNavigator((v) => !v),
    },
    {
      id: 'view.toolbarIconsOnly',
      label: 'Icons only',
      menu: { menu: 'view', group: GROUPS.view.panels, order: 20, submenu: 'Toolbar' },
      checked: iconsOnly,
      keywords: ['toolbar', 'labels', 'compact'],
      hint: 'Show the toolbar’s icons without their labels',
      run: () => setIconsOnly((v) => !v),
    },
    // Insert
    {
      id: 'insert.table',
      label: 'New data table…',
      menu: { menu: 'insert', group: GROUPS.insert.sheets, order: 10 },
      icon: 'table',
      toolbar: { group: TOOLBAR_GROUPS.file, order: 10, label: 'New table' },
      keywords: ['sheet', 'data'],
      run: () => setDialog({ kind: 'newTable' }),
    },
    {
      id: 'insert.graph',
      label: 'New graph…',
      menu: { menu: 'insert', group: GROUPS.insert.sheets, order: 20 },
      enabled: !!tableForAnalyze,
      icon: 'chart-column',
      toolbar: {
        group: TOOLBAR_GROUPS.create,
        order: 20,
        split: { label: 'Recent graph types', items: [...recentGraphIds, '-', 'insert.graph'] },
      },
      disabledReason: 'Open a data table first',
      keywords: ['plot', 'chart'],
      run: () => newGraph(),
    },
    ...recentGraphCommands,
    {
      id: 'insert.layout',
      label: 'New layout',
      menu: { menu: 'insert', group: GROUPS.insert.sheets, order: 30 },
      icon: 'layout-dashboard',
      toolbar: { group: TOOLBAR_GROUPS.create, order: 40, label: 'Layout' },
      hint: 'A page combining graphs',
      keywords: ['page', 'figure'],
      run: newLayout,
    },
    {
      id: 'insert.function',
      label: 'Plot a function…',
      menu: { menu: 'insert', group: GROUPS.insert.sheets, order: 40 },
      icon: 'square-function',
      toolbar: { group: TOOLBAR_GROUPS.create, order: 30, label: 'Function' },
      hint: 'Graph an equation (built-in or your own) with chosen parameter values',
      keywords: ['equation', 'curve'],
      run: plotFunction,
    },
    // Analyze
    {
      id: 'analyze.analyze',
      label: 'Analyze…',
      menu: { menu: 'analyze', group: GROUPS.analyze.analyze, order: 10 },
      shortcut: 'Mod+Shift+A',
      enabled: !!tableForAnalyze,
      icon: 'flask-conical',
      toolbar: {
        group: TOOLBAR_GROUPS.create,
        order: 10,
        split: {
          label: 'Recent analyses',
          items: [...recentAnalysisIds, '-', 'analyze.analyze'],
        },
      },
      disabledReason: 'Open a data table first',
      keywords: ['statistics', 'test'],
      run: () => analyze(),
    },
    ...recentAnalysisCommands,
    ...QUICK_ANALYSES.map((q, i): Command => {
      const id = applicable(q.ids)
      return {
        id: `analyze.quick.${q.ids[0]}`,
        label: q.label,
        menu: { menu: 'analyze', group: GROUPS.analyze.quick, order: i },
        enabled: !!id && !!tableForAnalyze,
        keywords: q.keywords,
        run: () => analyze(id),
      }
    }),
    // Roadmap 38: tables derived from the current table that follow it (Data manipulation).
    ...DATA_ANALYSES.map((q, i): Command => {
      const id = applicable(q.ids)
      return {
        id: `data.${q.ids[0]}`,
        label: q.label,
        menu: {
          menu: 'analyze',
          group: GROUPS.analyze.analyze,
          order: 60 + i,
          submenu: 'Data manipulation',
        },
        enabled: !!id && !!tableForAnalyze,
        hint: q.hint,
        keywords: q.keywords,
        hideInPalette: !id,
        run: () => analyze(id),
      }
    }),
    ...NO_DATA_ANALYSES.map(
      (a, i): Command => ({
        id: `analyze.simulate.${a.id}`,
        label: a.label,
        menu: { menu: 'analyze', group: GROUPS.analyze.simulate, order: i },
        keywords: ['simulate', 'random', 'generate'],
        run: () => analyzeWithoutData(a.id, a.kind),
      }),
    ),
    // Help
    {
      id: 'help.palette',
      label: 'Command palette…',
      menu: { menu: 'help', group: GROUPS.help.commands, order: 10 },
      shortcut: 'Mod+K',
      inTextFields: true,
      keywords: ['search', 'find', 'command'],
      run: () => setDialog({ kind: 'palette' }),
    },
    {
      id: 'help.shortcuts',
      label: 'Keyboard shortcuts',
      menu: { menu: 'help', group: GROUPS.help.commands, order: 20 },
      shortcut: 'Mod+/',
      keywords: ['keys', 'hotkeys'],
      run: () => setDialog({ kind: 'shortcuts' }),
    },
    {
      id: 'help.about',
      label: 'About statPlotter',
      menu: { menu: 'help', group: GROUPS.help.about, order: 90 },
      keywords: ['version', 'licence', 'license'],
      run: () => setDialog({ kind: 'about' }),
    },
  ]
  useCommands('app', [
    ...appCommands,
    ...batchExport.commands,
    ...reuse.commands,
    ...styles.commands,
    ...organise.commands,
  ])

  // The palette's own entries: every analysis (on the current table) and every sheet.
  const paletteExtras = (): PaletteExtra[] => [
    ...registry.list().map((d) => {
      const noData = NO_DATA_ANALYSES.find((a) => a.id === d.id)
      const ok = noData ? true : !!tableForAnalyze && !!applicable([d.id])
      return {
        id: `palette.analysis.${d.id}`,
        label: `${d.title}…`,
        section: `Analyze › ${d.category}`,
        keywords: ['analyze', 'analysis'],
        enabled: ok,
        hint: d.description,
        run: () => (noData ? analyzeWithoutData(d.id, noData.kind) : analyze(d.id)),
      }
    }),
    ...project.order.flatMap((id) => {
      const n = project.nodes[id]
      if (!n) return []
      return [
        {
          id: `nav.goto.${id}`,
          label: `Go to ${n.name}`,
          section: capitalize(KIND_NAMES[n.kind]),
          keywords: ['go to', 'open', 'sheet'],
          enabled: id !== selected,
          run: () => setSelected(id),
        },
      ]
    }),
  ]

  // ---- Keys and native menus -------------------------------------------------------------------

  const commandRegistry = useCommandRegistry()
  const [nativeGate] = useState(() => new NativeKeyGate())
  useEffect(() => {
    const isMac = isMacPlatform()
    const onKey = (e: KeyboardEvent) => {
      if (dispatchKey(commandRegistry, e, isMac)) return
      // A shortcut left to the page (text field, dialog…) may still reach a native menu item.
      if (e.metaKey || e.ctrlKey) nativeGate.unhandled(e, isTextTarget(e.target), performance.now())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commandRegistry, nativeGate])

  // Desktop: the operating system's menu bar, kept in step with the registry.
  useEffect(() => {
    if (!platform.setMenus) return
    const isMac = isMacPlatform()
    const run = (id: string) => {
      const action = nativeGate.decide(commandRegistry.get(id)?.shortcut, {
        isMac,
        dialogOpen: !!document.querySelector('dialog[open]'),
        now: performance.now(),
      })
      if (action.kind === 'run') commandRegistry.run(id)
      else if (action.kind === 'textEdit') document.execCommand(action.command)
    }
    const push = () => platform.setMenus?.(commandRegistry.menus(), run)
    push()
    return commandRegistry.subscribe(push)
  }, [platform, commandRegistry, nativeGate])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!store.dirty) return
      e.preventDefault()
      // The browser may ask whether to leave: the recovery copy's write runs meanwhile.
      void recovery?.leave()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [store, recovery])

  return (
    <ConfirmContext.Provider value={confirm}>
      <ThumbnailsContext.Provider value={thumbnails}>
        <DropContext.Provider value={fileDrop.enqueue}>
          <div className="app" {...fileDrop.handlers}>
            {fileDrop.overlay && <DropOverlay hints={fileDrop.overlay.hints} />}
            <header className="app-header">
              {!platform.setMenus && <MenuBar />}
              <Toolbar iconsOnly={iconsOnly}>
                <span
                  className="file-title"
                  title={
                    recoverySaved && history.dirty
                      ? `Recovery copy saved ${recoveryTime(recoverySaved, Date.now())}`
                      : undefined
                  }
                >
                  {fileName ?? 'Untitled'}
                  {history.dirty && (
                    <span
                      className="dirty"
                      title="Unsaved changes"
                      role="img"
                      aria-label="Unsaved changes"
                    >
                      {' '}
                      •
                    </span>
                  )}
                </span>
              </Toolbar>
            </header>
            <div className="workspace">
              {/* Hidden, not unmounted: the navigator registers the sheet commands. */}
              <div className="navigator-slot" hidden={!showNavigator}>
                <Navigator
                  selected={selected}
                  onSelect={setSelected}
                  onShow={() => setShowNavigator(true)}
                  onApplyStyle={(graphs) => styles.openFor(graphs, 'navigator')}
                  onExport={batchExport.exportSheets}
                />
                <GettingStarted
                  selected={selected}
                  onSelect={setSelected}
                  onShow={() => setShowNavigator(true)}
                />
              </div>
              <main className="main">
                {!node && (
                  <div className="empty">
                    <h2>Start a project</h2>
                    <p>
                      Enter values in a data table or import a file, then analyze and graph them.
                      Everything stays linked.
                    </p>
                    <div className="empty-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => setDialog({ kind: 'newTable' })}
                      >
                        New data table
                      </button>
                      {/* Roadmap 43: bringing a file in, the first thing many users do. */}
                      <button type="button" onClick={() => void importData()}>
                        Import data… (CSV, Excel, .pzfx)
                      </button>
                      <button type="button" onClick={reuse.newFromTemplate}>
                        New from template…
                      </button>
                      <button type="button" onClick={() => setDialog({ kind: 'examples' })}>
                        Open an example…
                      </button>
                    </div>
                    <p className="empty-drop">or drop a file anywhere in the window</p>
                    {recent[0] && (
                      <p>
                        <button
                          type="button"
                          className="link"
                          title={recent[0].path}
                          onClick={() => void openRecent(recent[0]!)}
                        >
                          Continue with {recent[0].name}
                        </button>
                      </p>
                    )}
                    {/* Roadmap 48: what happens to the user's data, folded under one line. */}
                    <details className="empty-privacy">
                      <summary>{PRIVACY_SUMMARY}</summary>
                      <p>{privacyText(desktop)}</p>
                    </details>
                  </div>
                )}
                {node?.kind === 'table' && (
                  <TableView key={node.id} id={node.id} onError={showError} onOpen={setSelected} />
                )}
                {node?.kind === 'analysis' && (
                  <ResultsView
                    id={node.id}
                    onEdit={() => setDialog({ kind: 'editAnalysis', analysisId: node.id })}
                    onError={showError}
                    onAnalyze={(tableId) => setDialog({ kind: 'analyze', tableId })}
                    onNewGraph={(tableId) => setDialog({ kind: 'newGraph', tableId })}
                    onOpen={setSelected}
                  />
                )}
                {node?.kind === 'graph' && (
                  <GraphView
                    key={node.id}
                    id={node.id}
                    onError={showError}
                    onNotice={showNotice}
                    onOpen={setSelected}
                    initialFormat={
                      pendingFormat?.graph === node.id ? pendingFormat.target : undefined
                    }
                  />
                )}
                {node?.kind === 'layout' && (
                  <LayoutView
                    key={node.id}
                    id={node.id}
                    onError={showError}
                    onNotice={showNotice}
                    onOpen={setSelected}
                  />
                )}
                {node?.kind === 'info' && (
                  <InfoView key={node.id} id={node.id} onError={showError} />
                )}
              </main>
            </div>
            <Toasts error={toasts.error} notice={toasts.notice} onDismiss={dismissToast} />
            <div
              className="visually-hidden"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              data-testid="announcer"
            >
              {announced && <span key={announced.key}>{announced.text}</span>}
            </div>
            <ExportStatus />
            {dialog?.kind === 'palette' && (
              <CommandPalette extras={paletteExtras()} onClose={() => setDialog(null)} />
            )}
            {dialog?.kind === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
            {batchExport.dialog}
            {reuse.dialog}
            {styles.dialog}
            {organise.dialog}
            {platform.updates && <UpdateCheck blocked={modalOpen} />}
            {dialog?.kind === 'about' && (
              <AboutDialog desktop={desktop} onClose={() => setDialog(null)} />
            )}
            {dialog?.kind === 'migrated' && (
              <MigrationNotice notes={dialog.notes} onClose={() => setDialog(null)} />
            )}
            {dialog?.kind === 'recover' && (
              <RecoveryDialog
                records={dialog.records}
                onRecover={(r) => void recoverCopy(r)}
                onDiscard={(r) => void discardCopy(r)}
                onLater={recoverLater}
              />
            )}
            {dialog?.kind === 'examples' && (
              <ExamplesDialog
                context={exampleContext}
                onOpen={(p) => void openProject(p).then((done) => done && setDialog(null))}
                onClose={() => setDialog(null)}
              />
            )}
            {dialog?.kind === 'newTable' && (
              <NewTableDialog
                onClose={() => setDialog(null)}
                onCreated={setSelected}
                onNotice={showNotice}
              />
            )}
            {dialog?.kind === 'newGraph' && (
              <GraphBuilder
                mode={{ kind: 'new', tableId: dialog.tableId, preset: dialog.preset }}
                onClose={() => setDialog(null)}
                onCreated={setSelected}
              />
            )}
            {dialog?.kind === 'import' && (
              <ImportDialog
                fileName={dialog.fileName}
                sheets={dialog.sheets}
                reparse={dialog.reparse}
                onClose={() => setDialog(null)}
                onCreated={setSelected}
                onWarnings={showError}
              />
            )}
            {dialog?.kind === 'pzfx' && (
              <PzfxImportDialog
                fileName={dialog.fileName}
                bytes={dialog.bytes}
                onClose={() => setDialog(null)}
                onCreated={setSelected}
                onWarnings={showError}
              />
            )}
            {dialog?.kind === 'images' && (
              <ImageDropDialog
                files={dialog.files}
                onDone={({ placed, page, problems }) => {
                  setDialog(null)
                  if (page) setSelected(page)
                  if (problems.length) showError(problems.join(' '))
                  else if (placed)
                    showNotice(`${placed} ${placed === 1 ? 'image' : 'images'} added to the page.`)
                }}
              />
            )}
            {dialog?.kind === 'largeImport' && (
              <LargeImportDialog
                fileName={dialog.fileName}
                blob={dialog.blob}
                onClose={() => setDialog(null)}
                onCreated={setSelected}
                onWarnings={showError}
              />
            )}
            {dialog?.kind === 'analyze' && (
              <AnalyzeDialog
                mode="create"
                tableId={dialog.tableId}
                analysisId={dialog.analysisId}
                draftTable={dialog.draftTable}
                onClose={() => setDialog(null)}
                onCreated={(id) => {
                  // Offered again by the toolbar's Analyze ▾ (roadmap 43).
                  const made = store.getState().nodes[id]
                  if (made?.kind === 'analysis') rememberAnalysis(made.analysisId)
                  setSelected(id)
                }}
                onError={showError}
              />
            )}
            {dialog?.kind === 'editAnalysis' && (
              <AnalyzeDialog
                mode="edit"
                analysisId={dialog.analysisId}
                onClose={() => setDialog(null)}
                onError={showError}
              />
            )}
            {/* Over any other dialog: asked last. */}
            {modals.question}
          </div>
        </DropContext.Provider>
      </ThumbnailsContext.Provider>
    </ConfirmContext.Provider>
  )
}
