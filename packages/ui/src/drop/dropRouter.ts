import { IMPORT_EXTENSIONS, PROJECT_EXTENSION } from '@ps/io'
import { PRESET_EXTENSION, STYLE_EXTENSION } from '@ps/model'

// Files dropped on the window (roadmap 39, decision 578): each routed by its extension to what
// File › Open, Import data…, Insert › Image…, Manage presets and Styles do with it, one after
// another, then a summary. The functions here are pure (tested); `useFileDrop` does the work.

/** What a dropped file is to the app. */
export type DropKind = 'project' | 'data' | 'pzfx' | 'image' | 'preset' | 'style' | 'unsupported'

/** Images a layout page can hold (roadmap 32; TIFF only to explain it can't be placed). */
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'tif', 'tiff'])

const extensionOf = (name: string): string => /\.([^.\\/]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''

export function dropKindOf(name: string): DropKind {
  const ext = extensionOf(name)
  if (ext === PROJECT_EXTENSION) return 'project'
  if (ext === 'pzfx') return 'pzfx'
  if (ext === PRESET_EXTENSION) return 'preset'
  if (ext === STYLE_EXTENSION) return 'style'
  if (IMAGES.has(ext)) return 'image'
  if ((IMPORT_EXTENSIONS as readonly string[]).includes(ext)) return 'data'
  return 'unsupported'
}

/**
 * How files came: dropped on the window, or opened from the operating system (roadmap 41: a
 * double-click, Open with, the Dock icon), which go through the same steps.
 */
export type FileSource = 'drop' | 'open'

/**
 * What a project file does (decisions 602, 614): opened from the operating system it opens in
 * place of the current project (asking about unsaved changes), as File › Open would; dropped on
 * an open, non-empty project it asks "Open" or "Import into this project…" (Alt or Shift held:
 * import); dropped on an empty one it opens.
 */
export function projectAction(
  source: FileSource,
  projectEmpty: boolean,
  mods: { alt: boolean; shift: boolean },
): 'open' | 'import' | 'ask' {
  if (source === 'open' || projectEmpty) return 'open'
  return mods.alt || mods.shift ? 'import' : 'ask'
}

/** Where files are dropped: on a layout page, on a graph, or elsewhere. */
export type DropTarget = 'page' | 'graph' | 'other'

/** A dropped file in order with its kind (projects after the first are refused). */
export interface DropStep {
  name: string
  kind: DropKind
}

/**
 * The order dropped files are handled in: as dropped, except that only the first project is
 * opened (opening one replaces the others' work) and it goes last, so imports land in the
 * project open now rather than being replaced by it.
 */
export function dropSteps(names: readonly string[]): { steps: DropStep[]; refused: DropStep[] } {
  const all = names.map((name) => ({ name, kind: dropKindOf(name) }))
  const projects = all.filter((s) => s.kind === 'project')
  const others = all.filter((s) => s.kind !== 'project')
  return {
    steps: projects.length ? [...others, projects[0]!] : others,
    refused: projects.slice(1),
  }
}

/** What dropping does, by kind, for the overlay (the kinds a drag carries, when known). */
export function dropHints(kinds: ReadonlySet<DropKind> | null, target: DropTarget): string[] {
  const image =
    target === 'page'
      ? 'Images are placed on this page where you drop them'
      : 'Images: you choose a page to put them on'
  const all: [DropKind, string][] = [
    [
      'project',
      'A project (.psproj) opens in place of this one, or its sheets are imported into it (Alt or Shift: import)',
    ],
    ['data', 'CSV, TSV, TXT and Excel files open the import dialog'],
    ['pzfx', 'Prism files (.pzfx) open the Prism import dialog'],
    ['image', image],
    ['preset', 'Graph presets (.pspreset) and styles (.psstyle) go into your library'],
  ]
  return all
    .filter(([k]) => !kinds || kinds.has(k) || (k === 'preset' && kinds.has('style')))
    .map(([, t]) => t)
}

/** The kinds a drag shows by its items' MIME types (null: can't tell before the drop). */
export function kindsOfTypes(types: readonly string[]): Set<DropKind> | null {
  if (!types.length || types.some((t) => t === '' || t === 'application/octet-stream')) return null
  const kinds = new Set<DropKind>()
  for (const t of types) {
    if (t.startsWith('image/')) kinds.add('image')
    else if (
      t === 'text/csv' ||
      t === 'text/plain' ||
      t === 'text/tab-separated-values' ||
      t.includes('spreadsheet') ||
      t.includes('excel') ||
      t === 'application/zip'
    )
      kinds.add('data')
    else if (t === 'application/json') {
      // Presets and styles are JSON; so are some projects' parts: can't tell.
      return null
    } else return null
  }
  return kinds
}

/** One line of the summary of a drop. */
export interface DropOutcome {
  name: string
  /** What happened ("imported", "opened", "added to your presets"…). */
  result: string
  ok: boolean
  /** Said even when it is the only file (nothing else shows what happened). */
  notify?: boolean
}

/** The summary shown once every dropped file was handled (several files only). */
export function dropSummary(outcomes: readonly DropOutcome[]): string {
  if (outcomes.length === 1) return `${outcomes[0]!.name}: ${outcomes[0]!.result}.`
  const ok = outcomes.filter((o) => o.ok).length
  const head = `${outcomes.length} files dropped: ${ok} handled${ok < outcomes.length ? `, ${outcomes.length - ok} not` : ''}.`
  return [head, ...outcomes.map((o) => `${o.name}: ${o.result}.`)].join(' ')
}
