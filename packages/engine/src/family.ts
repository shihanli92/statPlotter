import {
  type DataTable,
  type DocNode,
  folderOf,
  graphAnalyses,
  type NodeId,
  newNodeId,
  nodeById,
  type Project,
} from '@ps/model'
import { type Command, CommandError, copyData, removalSet } from './commands.ts'
import { copyName } from './duplicate.ts'
import { analysisSourceIn, type Remap, remapNode, substitute } from './remap.ts'
import { clearTableValues } from './template.ts'

// A table's family (roadmap 31): the table and everything computed from it — its analyses, the
// analyses of their result tables (chains), graphs of the table and of those results, the
// analyses' own output graphs — plus the layouts placing its graphs. Derived, never stored.

/**
 * Which layouts belong to a family: 'whole' — pages whose graphs are all in it (a figure of this
 * experiment); 'any' — pages with at least one of its graphs (their other graphs stay shared
 * with the original); 'none'.
 */
export type FamilyLayouts = 'whole' | 'any' | 'none'

/** The nodes of a table's family other than the table itself, in navigator order. */
export function familyOf(doc: Project, table: NodeId, layouts: FamilyLayouts = 'whole'): NodeId[] {
  const derived = removalSet(doc, table)
  derived.delete(table)
  // A page's live content: its graphs and live tables (whose source may be the table itself).
  const inFamily = (id: NodeId) => id === table || derived.has(id)
  return doc.order.filter((id) => {
    const n = nodeById(doc.nodes, id)
    if (!n) return false
    if (n.kind !== 'layout') return derived.has(id)
    const shown = pageSources(n)
    if (layouts === 'none' || !shown.length) return false
    return layouts === 'whole' ? shown.every(inFamily) : shown.some(inFamily)
  })
}

/** The nodes a page shows live: its graphs and the sources of its live tables (roadmap 32). */
export const pageSources = (page: Extract<DocNode, { kind: 'layout' }>): NodeId[] =>
  page.items.flatMap((it) =>
    it.type === 'graph' ? [it.graph] : it.type === 'table' ? [it.source.node] : [],
  )

/** The fresh ids of a copy, and the command list that adds it. */
export interface CopyPlan {
  commands: Command[]
  /** New node ids in the order they were added. */
  created: NodeId[]
  /** Old id → new id. */
  ids: Map<NodeId, NodeId>
}

/**
 * `node.add` commands for copies, each put after the last original of its kind among them (or
 * the latest copy of that kind), so a family's copies sit together below the originals in each
 * navigator section. Copies of nodes not in `doc` go at the end.
 */
export function addCopies(
  doc: Project,
  copies: readonly { original: NodeId; node: DocNode }[],
): Command[] {
  const order = [...doc.order]
  const lastOfKind = new Map<string, NodeId>()
  for (const c of copies) {
    const kind = c.node.kind
    if (order.includes(c.original)) {
      const prev = lastOfKind.get(kind)
      // The later of the original and the kind's last placed copy or original.
      if (!prev || order.indexOf(c.original) > order.indexOf(prev)) lastOfKind.set(kind, c.original)
    }
  }
  const out: Command[] = []
  for (const c of copies) {
    const anchor = lastOfKind.get(c.node.kind)
    const at = anchor ? order.indexOf(anchor) + 1 : order.length
    order.splice(at, 0, c.node.id)
    lastOfKind.set(c.node.kind, c.node.id)
    // Roadmap 40: tables and pages go in their original's folder; what is made from a table
    // follows its (copied) table into its folder.
    const folder =
      c.node.kind === 'analysis' || c.node.kind === 'graph'
        ? undefined
        : folderOf(doc.folders, c.original)?.id
    out.push({ type: 'node.add', node: c.node, at, ...(folder !== undefined ? { folder } : {}) })
  }
  return out
}

/** The name of a duplicated family's table: `find` replaced, else "… (copy)". */
export function tableCopyName(doc: Project, name: string, find: string, replace: string): string {
  const renamed = substitute(name, find, replace)
  return renamed === name ? copyName(doc, name) : renamed
}

export interface DuplicateFamilyOptions {
  /** Replace this text in the copies' names… */
  find: string
  /** …with this. */
  replace: string
  layouts: FamilyLayouts
  /** The table copied without its values (New graph like this). */
  clear?: boolean
  /** Only these family members (default: the whole family). */
  only?: readonly NodeId[]
  newId?: () => NodeId
}

/**
 * Commands copying a data table with its family (one undo step): the table's values, analyses
 * with their parameters, graphs with their formatting and layouts, every reference between them
 * pointing at the copies. Data set ids are scoped to their table, so the copy keeps them and
 * everything naming data sets (inputs, series, brackets, comparison and output keys, formats)
 * stays valid as is; result tables of the copied analyses get the same ids for the same reason.
 * Shared axis groups of the copies are new, linking the copies with each other only. Names have
 * `find` replaced by `replace`; the table copy is named "… (copy)" if that leaves its name as it
 * was.
 */
export function duplicateFamily(
  doc: Project,
  tableId: NodeId,
  opts: DuplicateFamilyOptions,
): CopyPlan & { table: NodeId } {
  const table = nodeById(doc.nodes, tableId)
  if (table?.kind !== 'table') throw new CommandError(`${tableId} is not a data table`)
  const newId = opts.newId ?? newNodeId
  const members = opts.only ?? familyOf(doc, tableId, opts.layouts)
  const ids = new Map<NodeId, NodeId>([[tableId, newId()]])
  for (const id of members) ids.set(id, newId())

  const rename = (name: string) => substitute(name, opts.find, opts.replace)
  const tableCopy: DataTable = {
    ...(opts.clear ? clearTableValues(table) : copyData(table)),
    id: ids.get(tableId)!,
    name: tableCopyName(doc, table.name, opts.find, opts.replace),
  }
  const remap: Remap = {
    nodes: ids,
    keys: new Map(),
    links: new Map(),
    newLink: () => newNodeId(),
    analysisSource: analysisSourceIn(doc),
  }
  const copies = [
    { original: tableId, node: tableCopy as DocNode },
    ...members.map((id) => {
      const node = remapNode(nodeById(doc.nodes, id)!, remap)
      return { original: id, node: { ...node, id: ids.get(id)!, name: rename(node.name) } }
    }),
  ]
  return {
    commands: addCopies(doc, copies),
    created: copies.map((c) => c.node.id),
    ids,
    table: tableCopy.id,
  }
}

/**
 * New graph like this (roadmap 31): an empty copy of a graph's data table (titles, rows and
 * format kept, no values) and a copy of the graph on it, with copies of the analyses whose curves
 * and brackets it shows (and the analyses they read from), for the next experiment. The graph
 * must show a data table.
 */
export function newGraphLike(
  doc: Project,
  graphId: NodeId,
  tableName: string,
  newId: () => NodeId = newNodeId,
): CopyPlan & { table: NodeId; graph: NodeId } {
  const graph = nodeById(doc.nodes, graphId)
  if (graph?.kind !== 'graph') throw new CommandError(`${graphId} is not a graph`)
  const tableId = graph.seriesSource.table
  const table = nodeById(doc.nodes, tableId)
  if (table?.kind !== 'table') throw new CommandError('the graph does not show a data table')
  const family = new Set(familyOf(doc, tableId, 'none'))
  // The analyses it shows, and upstream analyses they need, within the table's family.
  const needed = new Set<NodeId>([graphId])
  const need = (id: NodeId) => {
    for (let n = nodeById(doc.nodes, id); n?.kind === 'analysis' && family.has(n.id); ) {
      needed.add(n.id)
      n = nodeById(doc.nodes, n.input.source)
    }
  }
  for (const id of graphAnalyses(graph)) need(id)
  const plan = duplicateFamily(doc, tableId, {
    find: table.name,
    replace: tableName,
    layouts: 'none',
    clear: true,
    only: doc.order.filter((id) => needed.has(id)),
    newId,
  })
  // The table is named as asked even when the name has no "(copy)" to replace.
  const add = plan.commands[0] as Extract<Command, { type: 'node.add' }>
  add.node = { ...add.node, name: tableName }
  return { ...plan, graph: plan.ids.get(graphId)! }
}
