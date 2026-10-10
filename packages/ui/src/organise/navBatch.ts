import {
  type Command,
  DUPLICABLE_KINDS,
  duplicateNode,
  moveSheetCommands,
  removalSetOf,
  removalWarnings,
  type SheetTarget,
} from '@ps/engine'
import type { DocNode, FolderId, NodeId, Project } from '@ps/model'
import { type NavView, sheetsToFile } from './navModel.ts'

// Roadmap 47 (UX review S8): what the navigator does to several selected sheets at once, as
// commands dispatched together: one undo step each, labelled with the count ("Delete 3 sheets").
// Pure, tested.

const KIND_NOUN: Record<DocNode['kind'], [string, string]> = {
  table: ['data table', 'data tables'],
  analysis: ['results sheet', 'results sheets'],
  graph: ['graph', 'graphs'],
  layout: ['layout', 'layouts'],
  info: ['info sheet', 'info sheets'],
}

/** "3 sheets", "1 sheet". */
export const sheetCount = (n: number): string => `${n} ${n === 1 ? 'sheet' : 'sheets'}`

/** `ids` in navigator (project) order, those still in the project. */
export const inOrder = (project: Pick<Project, 'order'>, ids: Iterable<NodeId>): NodeId[] => {
  const set = new Set(ids)
  return project.order.filter((id) => set.has(id))
}

export interface Removal {
  /** The `node.remove` commands: one per selected sheet no other one's removal takes along. */
  commands: Command[]
  /** Everything removed, in navigator order. */
  gone: NodeId[]
  /** What goes too without being selected (analyses and graphs of removed data…). */
  also: NodeId[]
  /** What the user should know first (info fields formulas read). */
  warnings: string[]
}

/** Deleting several sheets together: the union of their cascades, as one step. */
export function removalOf(project: Project, ids: readonly NodeId[]): Removal {
  const chosen = inOrder(project, ids)
  const doomed = removalSetOf(project, chosen)
  // `node.remove` of a sheet already taken by an earlier one's cascade would fail.
  const roots: NodeId[] = []
  let covered = new Set<NodeId>()
  for (const id of chosen) {
    if (covered.has(id)) continue
    roots.push(id)
    covered = removalSetOf(project, roots)
  }
  const picked = new Set(chosen)
  const gone = inOrder(project, doomed)
  return {
    commands: roots.map((id) => ({ type: 'node.remove', id })),
    gone,
    also: gone.filter((id) => !picked.has(id)),
    warnings: chosen.flatMap((id) => removalWarnings(project, id, doomed)),
  }
}

/** “A”, “B” and 2 more. */
function nameList(project: Project, ids: readonly NodeId[], max = 6): string {
  const names = ids.map((id) => `“${project.nodes[id]?.name ?? id}”`)
  if (names.length <= max)
    return names.length > 1
      ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
      : (names[0] ?? '')
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}

/** What goes with the selected sheets, by kind: "2 results sheets (“t test of A”, …) and 1 graph". */
function alsoText(project: Project, also: readonly NodeId[]): string {
  const kinds: DocNode['kind'][] = ['table', 'info', 'analysis', 'graph', 'layout']
  const parts = kinds.flatMap((k) => {
    const of = also.filter((id) => project.nodes[id]?.kind === k)
    if (!of.length) return []
    return [`${of.length} ${KIND_NOUN[k][of.length === 1 ? 0 : 1]} (${nameList(project, of)})`]
  })
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
    : (parts[0] ?? '')
}

/**
 * The one question asked before deleting several sheets: what is deleted, what goes with them
 * and the warnings. One sheet asks only when there is a warning (as before).
 */
export function removalQuestion(
  project: Project,
  ids: readonly NodeId[],
  r: Removal = removalOf(project, ids),
): { title: string; message: string; ok: string } | null {
  const chosen = inOrder(project, ids)
  if (chosen.length < 2) {
    return r.warnings.length
      ? { title: 'Delete it anyway?', message: r.warnings.join(' '), ok: 'Delete' }
      : null
  }
  const parts = [`${nameList(project, chosen)} will be deleted.`]
  if (r.also.length) parts.push(`With them: ${alsoText(project, r.also)}.`)
  parts.push(...r.warnings)
  parts.push('You can undo this.')
  return {
    title: `Delete ${sheetCount(chosen.length)}?`,
    message: parts.join(' '),
    ok: `Delete ${sheetCount(chosen.length)}`,
  }
}

/** The sheet opened after deleting `gone`: the one now where the first of them was. */
export function openAfterRemoval(
  before: readonly NodeId[],
  after: readonly NodeId[],
  gone: readonly NodeId[],
): NodeId | null {
  const first = Math.min(...gone.map((id) => before.indexOf(id)).filter((i) => i >= 0))
  if (!Number.isFinite(first)) return after[0] ?? null
  return after[Math.min(first, after.length - 1)] ?? null
}

/**
 * Duplicate several sheets: each copy right after its original, in its folder, named as one
 * duplicated alone would be (`duplicateNode`, applied in turn so names and places follow the
 * copies made before it).
 */
export function duplicatesOf(
  project: Project,
  ids: readonly NodeId[],
): { commands: Command[]; copies: NodeId[] } {
  let doc = project
  const commands: Command[] = []
  const copies: NodeId[] = []
  for (const id of inOrder(project, ids)) {
    const n = doc.nodes[id]
    if (!n || !DUPLICABLE_KINDS.has(n.kind)) continue
    const cmd = duplicateNode(doc, id)
    commands.push(cmd)
    copies.push(cmd.node.id)
    const order = [...doc.order]
    order.splice(cmd.at ?? order.length, 0, cmd.node.id)
    doc = { ...doc, nodes: { ...doc.nodes, [cmd.node.id]: cmd.node }, order }
  }
  return { commands, copies }
}

/**
 * The sheets filed or dragged with the selection: each selected sheet, and in the Family view a
 * table's whole family (`sheetsToFile`), in navigator order.
 */
export function sheetsToMove(project: Project, ids: readonly NodeId[], view: NavView): NodeId[] {
  return inOrder(
    project,
    inOrder(project, ids).flatMap((id) => sheetsToFile(project, id, view)),
  )
}

/**
 * A drop of dragged sheets next to another sheet or into a folder (`move`: the sheets dragged,
 * `file`: those and, in the Family view, their families): when a dragged sheet is in another
 * folder than the target, everything is filed where the target is; next to a sheet, the dragged
 * ones are put before or after it, in their order. One step.
 */
export function dropCommands(
  project: Project,
  drag: { move: readonly NodeId[]; file: readonly NodeId[] },
  at: { folder: FolderId | null } | { sheet: SheetTarget },
): Command[] {
  const folders = project.folders ?? []
  const folderOf = (id: NodeId) => folders.find((f) => f.members.includes(id))?.id ?? null
  const target =
    'folder' in at ? at.folder : folderOf('before' in at.sheet ? at.sheet.before : at.sheet.after)
  const cmds: Command[] = []
  if (drag.move.some((id) => folderOf(id) !== target)) {
    const ids = drag.file.filter((id) => folderOf(id) !== target)
    if (ids.length) cmds.push({ type: 'folder.file', ids, folder: target })
  }
  if ('sheet' in at) cmds.push(...moveSheetCommands(project, drag.move, at.sheet))
  return cmds
}
