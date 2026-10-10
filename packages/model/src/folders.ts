import { z } from 'zod'
import { FolderId, NodeId } from './ids.ts'

// The navigator's folders (roadmap 40, decisions 591–592): the user's own grouping of sheets,
// optional project data beside `order`. A folder lists the sheets filed in it (`members`); their
// order is `Project.order`'s (one order for everything), so reordering never touches folders. A
// folder may sit in another (`parent`), one level deep. A sheet is in at most one folder; sheets
// in none are "unfiled". Folders hold node ids, so the commands that remove, file, copy or merge
// nodes keep their members valid themselves (`node.remove`, `folder.file`, `node.add`'s `folder`,
// Import from project), checked by `folderIssues` — graph references stay `graphRefs`' business
// (a folder is not a reference a graph makes).

export const Folder = z.object({
  id: FolderId,
  name: z.string(),
  /** The folder this one sits in (one level only); absent: at the top. */
  parent: FolderId.optional(),
  /** The sheets filed here (shown in `Project.order`'s order). */
  members: z.array(NodeId),
})
export type Folder = z.infer<typeof Folder>

/** Where something is wrong with a project's folders. */
export interface FolderIssue {
  path: (string | number)[]
  message: string
}

/** Integrity of folders: unique ids, parents that exist one level up, members that exist once. */
export function folderIssues(
  folders: readonly Folder[] | undefined,
  hasNode: (id: NodeId) => boolean,
): FolderIssue[] {
  if (!folders) return []
  const out: FolderIssue[] = []
  const byId = new Map<string, Folder>()
  folders.forEach((f, i) => {
    if (byId.has(f.id))
      out.push({ path: ['folders', i, 'id'], message: `duplicate folder ${f.id}` })
    byId.set(f.id, f)
  })
  const filed = new Map<NodeId, string>()
  folders.forEach((f, i) => {
    if (f.parent !== undefined) {
      const parent = byId.get(f.parent)
      if (!parent || f.parent === f.id)
        out.push({ path: ['folders', i, 'parent'], message: `no folder ${f.parent}` })
      else if (parent.parent !== undefined)
        out.push({
          path: ['folders', i, 'parent'],
          message: 'folders nest one level only',
        })
    }
    for (const id of f.members) {
      if (!hasNode(id))
        out.push({ path: ['folders', i, 'members'], message: `folder lists missing node ${id}` })
      const other = filed.get(id)
      if (other !== undefined)
        out.push({
          path: ['folders', i, 'members'],
          message: `node ${id} is in two folders (${other}, ${f.id})`,
        })
      filed.set(id, f.id)
    }
  })
  return out
}

/** The folder a sheet is filed in (undefined: unfiled). */
export function folderOf(
  folders: readonly Folder[] | undefined,
  node: NodeId | string,
): Folder | undefined {
  return folders?.find((f) => f.members.includes(node as NodeId))
}

/** Sheet id → its folder's id, for every filed sheet. */
export function folderIndex(folders: readonly Folder[] | undefined): Map<NodeId, string> {
  const out = new Map<NodeId, string>()
  for (const f of folders ?? []) for (const id of f.members) out.set(id, f.id)
  return out
}

/** A folder's subfolders, in the folders' order. */
export const subfolders = (folders: readonly Folder[] | undefined, id: string): Folder[] =>
  (folders ?? []).filter((f) => f.parent === id)

/** "Name", or "Name (2)", "Name (3)"… when taken (ignoring case). */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()))
  if (!used.has(name.toLowerCase())) return name
  const base = name.replace(/ \((\d+)\)$/, '')
  for (let i = 2; ; i++) {
    const next = `${base} (${i})`
    if (!used.has(next.toLowerCase())) return next
  }
}
