import { registry } from '@ps/analyses'
import { AssetStore, ComputeEngine, DocumentStore, inlineRunner, type JobRunner } from '@ps/engine'
import type { FontRegistry } from '@ps/graph'
import { readProjectFile, resultsForFile, writeProjectFile } from '@ps/io'
import { createProject, type MigrationNote, type NodeId, type Project } from '@ps/model'
import type { MenuModel } from './commands/registry.ts'
import type { DroppedFile } from './drop/useFileDrop.tsx'
import { releaseAssetUrlsWith } from './graph/assetUrls.ts'
import type { ClipboardFormat } from './graph/copyGraph.ts'
import { releaseOnReset } from './graph/sceneCache.ts'
import type { RecentFile } from './recent.ts'
import type { RecoveryStorage } from './recovery.ts'
import type { Updates } from './updates/updates.ts'

/** File access differs between the browser and the desktop shell; the app supplies this. */
export interface Platform {
  kind: 'web' | 'desktop'
  /** Returns null if the user cancelled. */
  openProject(): Promise<{ name: string; bytes: Uint8Array; handle: unknown } | null>
  /**
   * Saves to `handle` if given (plain Save), otherwise asks for a location. Returns the handle
   * and display name, or null if cancelled.
   */
  saveProject(
    /**
     * The file's bytes, or a function making them, called once the location is chosen (roadmap
     * 34e: a large project's file is made in a worker, after the save dialog).
     */
    bytes: Uint8Array | (() => Promise<Uint8Array>),
    suggestedName: string,
    handle: unknown,
  ): Promise<{ name: string; handle: unknown } | null>
  /** Asks for any file with one of these extensions (no dots), e.g. for import. */
  openFile(
    description: string,
    extensions: readonly string[],
  ): Promise<{ name: string; bytes: Uint8Array } | null>
  /**
   * As `openFile`, the file not read yet (roadmap 34e): a large CSV file is streamed from it
   * into a table, never held whole.
   */
  openData?(
    description: string,
    extensions: readonly string[],
  ): Promise<{ name: string; blob: Blob } | null>
  /**
   * Offers a file to the user (download / save dialog). `data` may be a function making the
   * contents, called once the location is chosen (so a slow export starts after the save
   * dialog, and not at all when it is cancelled).
   */
  exportFile(
    data: ExportData | (() => Promise<ExportData>),
    suggestedName: string,
    mime: string,
  ): Promise<void>
  /**
   * Several files into a folder the user picks (batch export; desktop). Null if cancelled.
   * Absent: they are offered as one zip file through `exportFile`.
   */
  pickFolder?(): Promise<ExportFolder | null>
  /**
   * Puts graphics on the system clipboard as one item in several formats (macOS desktop: the
   * PDF, the PNG, the SVG). Resolves to the formats written and the clipboard's change count
   * afterwards. Absent: the browser's clipboard is used (`graph/copyGraph.ts`).
   */
  copyGraphics?: (
    svg: string,
    png: Uint8Array,
    pdf: Uint8Array,
  ) => Promise<{ formats: ClipboardFormat[]; stamp: number }>
  /** The clipboard's change count now, to tell whether a copy is still on it (with copyGraphics). */
  clipboardStamp?: () => Promise<number>
  /**
   * A file from the local `source_data/` folder (development builds only; see the Examples
   * dialog's published-data examples). Absent, or resolving to null, where there is none.
   */
  readSourceData?: (path: string) => Promise<Uint8Array | null>
  /**
   * Shows the menus as the operating system's menu bar (desktop app); the shell then hides its
   * own. Called again whenever the menus change (the platform debounces); `run` is called with a
   * command id when an item is chosen.
   */
  setMenus?(menus: MenuModel[], run: (id: string) => void): void
  /** Open recent; absent where files can't be reopened later (browsers without file handles). */
  recent?: RecentFiles
  /**
   * Private storage for recovery copies of unsaved work (web: IndexedDB; desktop: the app data
   * folder); absent where there is none.
   */
  recovery?: RecoveryStorage
  /**
   * The user's project templates (roadmap 31; desktop: the app data folder's `templates/`; web:
   * templates saved or opened recently, in IndexedDB). Absent: only files picked each time.
   */
  templates?: Library
  /** The user's saved methods (desktop: `methods/` in the app data folder; web: IndexedDB). */
  methods?: Library
  /**
   * The user's graph presets (roadmap 33c; desktop: `presets/` in the app data folder; web:
   * IndexedDB, in memory where that fails).
   */
  presets?: Library
  /**
   * The user's styles (roadmap 37; desktop: `styles/` in the app data folder; web: IndexedDB, in
   * memory where that fails).
   */
  styles?: Library
  /**
   * The user's preferences (roadmap 37): one entry, `preferences` (desktop: `settings/` in the
   * app data folder; web: IndexedDB, in memory where that fails).
   */
  settings?: Library
  /**
   * Roadmap 41 (desktop): files the operating system asked the app to open (a double-click, Open
   * with, a file dropped on the Dock icon), at launch and while it runs.
   */
  openedFiles?: OpenedFiles
  /** Roadmap 41 (desktop): the app's updates. Absent on the web. */
  updates?: Updates
  /**
   * Roadmap 41: the window's own colours (the desktop app's title bar) follow the app's: 'light',
   * 'dark', or null for the system's.
   */
  setColorScheme?(scheme: 'light' | 'dark' | null): void
}

/** Files the operating system asked the app to open, waiting to be taken (roadmap 41). */
export interface OpenedFiles {
  /** The files asked for since the last call (at start: those the app was launched with). */
  take(): Promise<DroppedFile[]>
  /** Calls `ready` whenever more files arrive (then `take` them); returns the unsubscribe. */
  subscribe(ready: () => void): () => void
}

/** Named files the app keeps for the user (templates, methods, presets), newest first. */
export interface Library {
  list(): Promise<LibraryEntry[]>
  read(name: string): Promise<Uint8Array | null>
  /** Adds or replaces the file of this name. */
  write(name: string, bytes: Uint8Array): Promise<void>
  remove(name: string): Promise<void>
}

export interface LibraryEntry {
  name: string
  /** When it was saved (ms since 1970), where known. */
  modified?: number
}

export type ExportData = Uint8Array | string

/** A folder chosen for a batch export. */
export interface ExportFolder {
  /** Shown in messages ("Exported 12 graphs to Figures"). */
  name: string
  /** Writes a file into the folder (replacing one of that name). */
  write(fileName: string, data: ExportData): Promise<void>
}

/** The platform's list of recently opened or saved project files. */
export interface RecentFiles {
  list(): Promise<RecentFile[]>
  /** Remembers a file just opened or saved (a handle from openProject / saveProject). */
  add(file: { name: string; handle: unknown }): Promise<RecentFile[]>
  remove(file: RecentFile): Promise<RecentFile[]>
  clear(): Promise<void>
  /**
   * Reads a remembered file again, asking for permission where needed; null if the user
   * declined. Throws if the file can't be read (moved, deleted).
   */
  open(file: RecentFile): Promise<{ name: string; bytes: Uint8Array; handle: unknown } | null>
}

export interface AppServices {
  store: DocumentStore
  engine: ComputeEngine
  /** Images placed on layout pages (beside the document; see `AssetStore`). */
  assets: AssetStore
  fonts: FontRegistry
  platform: Platform
  file: { name: string; handle: unknown } | null
}

export function createServices(opts: {
  fonts: FontRegistry
  platform: Platform
  runner?: JobRunner
  project?: Project
}): AppServices {
  const store = new DocumentStore(opts.project ?? createProject())
  const engine = new ComputeEngine(store, registry, opts.runner ?? inlineRunner(registry))
  engine.start()
  const assets = new AssetStore()
  // The URLs images were shown from go with them (audit 2, U23); the scenes and the export
  // worker's copy with the project (audit 3, P5).
  releaseAssetUrlsWith(assets)
  releaseOnReset(store)
  return {
    store,
    engine,
    assets,
    fonts: opts.fonts,
    platform: opts.platform,
    file: null,
  }
}

interface ViewState {
  selected: NodeId | null
}

/**
 * What a project file is written from: the document, the cached results, the view, and the images
 * the document places (only those: unplaced ones are left out of the file).
 */
export function projectFileParts(services: AppServices, view: ViewState) {
  const project = services.store.getState()
  return {
    project,
    // Only what the file keeps (audit 2, P14): a worker writing it is sent no more.
    results: resultsForFile(project, services.engine.snapshot()),
    view,
    assets: services.assets.referenced(project),
  }
}

export function serialize(services: AppServices, view: ViewState): Uint8Array {
  const { project, results, assets } = projectFileParts(services, view)
  return writeProjectFile(project, { results, view, assets })
}

/**
 * Loads a file into the existing services (keeps engine, runner, and fonts). `unsaved`: the
 * bytes are a recovery copy, so the project starts with unsaved changes.
 */
export function load(
  services: AppServices,
  bytes: Uint8Array,
  opts: { unsaved?: boolean } = {},
): ViewState & { notes: MigrationNote[] } {
  const { project, results, view, assets, notes } = readProjectFile(bytes)
  // Shown at once, recomputed once the app is idle (`verifyLoadedResults`).
  services.engine.seed(results.values(), { fromFile: true })
  services.assets.replace(assets.values())
  services.store.reset(project, opts)
  // view.json is untrusted: only an own node id (not e.g. "constructor") is a valid selection.
  const selected: unknown =
    typeof view === 'object' && view !== null ? (view as Record<string, unknown>).selected : null
  return {
    selected:
      typeof selected === 'string' && Object.hasOwn(project.nodes, selected)
        ? (selected as NodeId)
        : (project.order[0] ?? null),
    notes,
  }
}

/**
 * Recomputes the results a loaded file held (audit 2 X8), when the app is next idle, so a file's
 * results can't stay shown unless the analyses give them. Those that come out the same change
 * nothing; `notify` is told when some differed (and were replaced).
 */
export function verifyLoadedResults(services: AppServices, notify: (message: string) => void) {
  const run = () =>
    services.engine.verifySeeded().then(
      ({ differed }) => {
        if (differed) notify(`Results recomputed: ${differed} differed from the saved file.`)
      },
      () => {},
    )
  const idle = (globalThis as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback
  if (idle) idle(() => void run())
  else setTimeout(() => void run(), 0)
}
