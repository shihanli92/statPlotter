import { type FamilyEntry, familyOf, familyTree } from '@ps/engine'
import {
  type DocNode,
  type Folder,
  type FolderId,
  folderIndex,
  type NodeId,
  type Project,
} from '@ps/model'

// What the navigator shows (roadmap 40), as plain data the component renders: the by-kind view's
// sections with the user's folders in each, and the Family view's tree in folders. Pure, tested.

export type NavView = 'kind' | 'family'

export interface NavFolder {
  type: 'folder'
  folder: Folder
  depth: number
  open: boolean
  /** The collapse key (per view). */
  key: string
  items: NavItem[]
  /** Sheets in it (and its subfolder) shown in this section. */
  count: number
}

export interface NavSheet {
  type: 'sheet'
  id: NodeId
  kind: DocNode['kind']
  depth: number
  /** The sheets shown beside it, for Move up / down and drags (navigator order). */
  siblings: NodeId[]
  /** Drags reorder within one group. */
  group: string
  /** The folder it is shown in. */
  folder: FolderId | null
  /** Family view: what is made from it, and whether that is shown. */
  items: NavItem[]
  open: boolean
  key: string
  /** Family view: a graph shown under the page placing it (its home is elsewhere). */
  link?: boolean
  /** Family view: a set of split graphs' heading. */
  set?: { label: string }
}

export type NavItem = NavFolder | NavSheet

export interface NavSection {
  kind: DocNode['kind']
  title: string
  items: NavItem[]
}

/**
 * The by-kind view's sections, in Prism's order (info sheets after Data Tables). Roadmap 43:
 * "Info sheets", as the Insert menu and the sheet itself call them.
 */
const SECTIONS: { kind: DocNode['kind']; title: string }[] = [
  { kind: 'table', title: 'Data Tables' },
  { kind: 'info', title: 'Info sheets' },
  { kind: 'analysis', title: 'Results' },
  { kind: 'graph', title: 'Graphs' },
  { kind: 'layout', title: 'Layouts' },
]

const folderKey = (view: NavView, id: string) => `${view}:folder:${id}`
const nodeKey = (id: string) => `family:node:${id}`

/**
 * The by-kind view (decision 591): a section per kind; in each, the folders holding sheets of
 * that kind (empty folders in every section, so sheets can be dragged into them), subfolders
 * within, then the sheets in no folder. Sheets keep navigator order everywhere.
 */
export function kindSections(project: Project, collapsed: ReadonlySet<string>): NavSection[] {
  const folders = project.folders ?? []
  const filed = folderIndex(folders)
  const nodes = project.order.flatMap((id) => {
    const n = project.nodes[id]
    return n ? [n] : []
  })
  // Folders holding anything at all (directly or in a subfolder).
  const holds = new Map<string, number>()
  for (const f of folders) {
    holds.set(f.id, (holds.get(f.id) ?? 0) + f.members.length)
    if (f.parent) holds.set(f.parent, (holds.get(f.parent) ?? 0) + f.members.length)
  }
  return SECTIONS.map(({ kind, title }) => {
    const ofKind = nodes.filter((n) => n.kind === kind)
    const sheet = (
      n: DocNode,
      depth: number,
      folder: FolderId | null,
      list: DocNode[],
    ): NavSheet => ({
      type: 'sheet',
      id: n.id,
      kind: n.kind,
      depth,
      siblings: list.map((x) => x.id),
      group: `kind:${kind}:${folder ?? ''}`,
      folder,
      items: [],
      open: false,
      key: n.id,
    })
    const folderItem = (f: Folder, depth: number): NavFolder | null => {
      const members = ofKind.filter((n) => filed.get(n.id) === f.id)
      const subs = folders
        .filter((s) => s.parent === f.id)
        .flatMap((s) => folderItem(s, depth + 1) ?? [])
      const empty = !holds.get(f.id)
      if (!members.length && !subs.length && !empty) return null
      const key = folderKey('kind', f.id)
      return {
        type: 'folder',
        folder: f,
        depth,
        open: !collapsed.has(key),
        key,
        items: [...subs, ...members.map((n) => sheet(n, depth + 1, f.id, members))],
        count: members.length + subs.reduce((s, x) => s + x.count, 0),
      }
    }
    const tops = folders
      .filter((f) => f.parent === undefined)
      .flatMap((f) => folderItem(f, 0) ?? [])
    const loose = ofKind.filter((n) => !filed.has(n.id))
    return { kind, title, items: [...tops, ...loose.map((n) => sheet(n, 0, null, loose))] }
  })
}

/**
 * The sections the by-kind view shows (roadmap 43): those with something in them (a sheet, or a
 * folder to drag sheets into), and Data Tables always, where a project starts. Empty headings
 * of results, graphs and layouts said nothing to a new project; each shows with its first sheet.
 */
export const shownSections = (sections: readonly NavSection[]): NavSection[] =>
  sections.filter((s) => s.kind === 'table' || s.items.length > 0)

/** The label of a set of split graphs: its first graph's name and how many there are. */
const setLabel = (project: Project, e: Extract<FamilyEntry, { kind: 'set' }>) =>
  `${project.nodes[e.first]?.name ?? 'Split graphs'} (set of ${e.children.length})`

/**
 * The Family view (decision 593): `familyTree`'s entries, each top-level entry (an info sheet,
 * a table's family, a layout) in the folder its sheet is filed in.
 */
export function familyItems(project: Project, collapsed: ReadonlySet<string>): NavItem[] {
  const folders = project.folders ?? []
  const filed = folderIndex(folders)
  const tree = familyTree(project)
  const kindOf = (e: FamilyEntry) =>
    e.kind === 'set' ? 'set' : (project.nodes[e.id]?.kind ?? 'table')
  const build = (
    entries: readonly FamilyEntry[],
    depth: number,
    parent: string,
    folder: FolderId | null,
  ): NavItem[] =>
    entries.map((e): NavItem => {
      const kind = kindOf(e)
      const same = entries.filter((x) => kindOf(x) === kind && !(x.kind === 'node' && x.link))
      const id = e.kind === 'set' ? e.first : e.id
      const key =
        e.kind === 'set'
          ? `family:set:${e.set}`
          : `${nodeKey(e.id)}${e.kind === 'node' && e.link ? `@${parent}` : ''}`
      return {
        type: 'sheet',
        id,
        kind: project.nodes[id]?.kind ?? 'graph',
        depth,
        siblings: same.map((x) => (x.kind === 'set' ? x.first : x.id)),
        group: `family:${parent}:${kind}`,
        folder,
        items: build(e.children, depth + 1, e.kind === 'set' ? `set:${e.set}` : e.id, folder),
        open: !collapsed.has(key),
        key,
        ...(e.kind === 'node' && e.link ? { link: true as const } : {}),
        ...(e.kind === 'set' ? { set: { label: setLabel(project, e) } } : {}),
      }
    })
  const rootFolder = (e: FamilyEntry) => (e.kind === 'node' ? (filed.get(e.id) ?? null) : null)
  const folderItem = (f: Folder, depth: number): NavFolder => {
    const subs = folders.filter((s) => s.parent === f.id).map((s) => folderItem(s, depth + 1))
    const roots = tree.filter((e) => rootFolder(e) === f.id)
    const key = folderKey('family', f.id)
    return {
      type: 'folder',
      folder: f,
      depth,
      open: !collapsed.has(key),
      key,
      items: [...subs, ...build(roots, depth + 1, `folder:${f.id}`, f.id)],
      count: roots.length + subs.reduce((s, x) => s + x.count, 0),
    }
  }
  return [
    ...folders.filter((f) => f.parent === undefined).map((f) => folderItem(f, 0)),
    ...build(
      tree.filter((e) => rootFolder(e) === null),
      0,
      'root',
      null,
    ),
  ]
}

/** The rows shown, depth first (open folders and branches only): for keyboard moves. */
export function visibleKeys(items: readonly NavItem[]): string[] {
  const out: string[] = []
  const walk = (list: readonly NavItem[]) => {
    for (const it of list) {
      out.push(it.key)
      if (it.open) walk(it.items)
    }
  }
  walk(items)
  return out
}

/**
 * The sheets "Move to folder" moves: in the Family view a table's whole family (its analyses,
 * results and graphs), so the by-kind view shows them in the folder too; else the sheet.
 */
export function sheetsToFile(project: Project, id: NodeId, view: NavView): NodeId[] {
  const n = project.nodes[id]
  if (view === 'family' && n?.kind === 'table') return [id, ...familyOf(project, id, 'none')]
  return [id]
}

/** A new folder's name: "Folder", "Folder 2"… */
export function newFolderName(project: Project): string {
  const taken = new Set((project.folders ?? []).map((f) => f.name.toLowerCase()))
  if (!taken.has('folder')) return 'Folder'
  for (let i = 2; ; i++) if (!taken.has(`folder ${i}`)) return `Folder ${i}`
}

// ---- Collapse state and the view, per user (not in the document) --------------------------------

const COLLAPSED_KEY = 'ps.nav.collapsed'
const VIEW_KEY = 'ps.nav.view'
const THUMBS_KEY = 'ps.nav.thumbnails'

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

export function loadCollapsed(): Set<string> {
  try {
    const v = JSON.parse(read(COLLAPSED_KEY) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
export const saveCollapsed = (s: ReadonlySet<string>) =>
  write(COLLAPSED_KEY, JSON.stringify([...s].slice(-500)))
export const loadView = (): NavView => (read(VIEW_KEY) === 'family' ? 'family' : 'kind')
export const saveView = (v: NavView) => write(VIEW_KEY, v)
export const loadThumbnails = (): boolean => read(THUMBS_KEY) === '1'
export const saveThumbnails = (on: boolean) => write(THUMBS_KEY, on ? '1' : '0')
