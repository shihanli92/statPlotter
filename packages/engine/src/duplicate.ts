import { type DocNode, folderOf, type NodeId, newNodeId, type Project } from '@ps/model'
import { type Command, CommandError, copyData } from './commands.ts'

/** Node kinds a sheet can be duplicated of (Edit › Duplicate sheet / Duplicate analysis). */
export const DUPLICABLE_KINDS: ReadonlySet<DocNode['kind']> = new Set([
  'table',
  'analysis',
  'graph',
  'layout',
  'info',
])

/** "Name (copy)", or "Name (copy 2)"… when that is taken. */
export function copyName(doc: Project, name: string): string {
  const taken = new Set(Object.values(doc.nodes).map((n) => n.name))
  const base = `${name} (copy)`
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const next = `${name} (copy ${i})`
    if (!taken.has(next)) return next
  }
}

/**
 * The `node.add` command that adds a copy of a sheet under a new id and name, right after the
 * original (one undo step removes it). A table copy is its data only: analyses and graphs of it
 * are separate nodes and stay with the original (Duplicate family copies them too: family.ts). An
 * analysis copy analyzes the same data with the same parameters; a graph copy shows the same data
 * (same source table; a split graph's copy is not in its set); a layout copy places the same graphs. Ids inside a node (data sets, series,
 * annotations, page items) are scoped to it, so they are kept and what refers to them stays
 * valid (legend entries, formats by data set).
 */
export function duplicateNode(
  doc: Project,
  id: NodeId,
  newId: NodeId = newNodeId(),
): Extract<Command, { type: 'node.add' }> {
  const node = doc.nodes[id]
  if (!node) throw new CommandError(`no node ${id}`)
  if (!DUPLICABLE_KINDS.has(node.kind))
    throw new CommandError(`${node.kind} sheets cannot be duplicated`)
  const copy: DocNode = { ...copyData(node), id: newId, name: copyName(doc, node.name) }
  // A copy of a split graph is a graph of its own, not one more member of the set (roadmap 34d).
  if (copy.kind === 'graph') delete copy.split
  const at = doc.order.indexOf(id)
  // Roadmap 40: in the original's folder.
  const folder = folderOf(doc.folders, id)?.id
  return {
    type: 'node.add',
    node: copy,
    at: at < 0 ? undefined : at + 1,
    ...(doc.folders ? { folder: folder ?? null } : {}),
  }
}
