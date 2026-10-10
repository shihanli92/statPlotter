import { type DocNode, type NodeId, nodeById, type Project } from '@ps/model'
import type { Command } from './commands.ts'

// Organising the navigator (roadmap 40): sheets moved in `Project.order` (drag, Move up / down,
// Alt+↑/↓), and the Family view's tree, derived from the references nodes make (no stored links).

/** Where moved sheets go: right before or right after another sheet. */
export type SheetTarget = { before: NodeId } | { after: NodeId }

/**
 * `node.move` commands putting `ids` (in their present relative order) next to `target`, one
 * undo step when dispatched together. None when the order would not change.
 */
export function moveSheetCommands(
  doc: Pick<Project, 'order'>,
  ids: readonly NodeId[],
  target: SheetTarget,
): Command[] {
  const anchor = 'before' in target ? target.before : target.after
  const set = new Set(ids)
  if (set.has(anchor) || !doc.order.includes(anchor)) return []
  const moving = doc.order.filter((id) => set.has(id))
  if (!moving.length) return []
  const cur = [...doc.order]
  const cmds: Command[] = []
  let prev: NodeId | null = null
  for (const id of moving) {
    cur.splice(cur.indexOf(id), 1)
    const at =
      prev === null ? cur.indexOf(anchor) + ('before' in target ? 0 : 1) : cur.indexOf(prev) + 1
    cur.splice(at, 0, id)
    cmds.push({ type: 'node.move', id, to: at })
    prev = id
  }
  return cur.every((id, i) => id === doc.order[i]) ? [] : cmds
}

/**
 * Move up / down (roadmap 40): a sheet past its neighbour among `siblings` (the sheets shown
 * beside it: the same section and folder, or the same family branch), in navigator order.
 */
export function stepSheetCommands(
  doc: Pick<Project, 'order'>,
  id: NodeId,
  dir: 'up' | 'down',
  siblings: readonly NodeId[],
): Command[] {
  const i = siblings.indexOf(id)
  if (i < 0) return []
  const other = siblings[dir === 'up' ? i - 1 : i + 1]
  if (!other) return []
  return moveSheetCommands(doc, [id], dir === 'up' ? { before: other } : { after: other })
}

// ---- Family view -------------------------------------------------------------------------------

/** An entry of the Family view: a sheet with what is made from it, or a set of split graphs. */
export type FamilyEntry =
  | {
      kind: 'node'
      id: NodeId
      children: FamilyEntry[]
      /** Shown again where it is used (a graph under the layout placing it), not its home. */
      link?: true
    }
  | { kind: 'set'; set: string; first: NodeId; children: FamilyEntry[] }

/**
 * The node a sheet belongs under in the Family view: an analysis under what it analyzes (a
 * table, or the analysis whose result table it reads), a graph under the table or result table
 * it shows. Tables, layouts and info sheets are at the top.
 */
export function familyParent(doc: Pick<Project, 'nodes'>, node: DocNode): NodeId | null {
  const up =
    node.kind === 'analysis'
      ? node.input.source
      : node.kind === 'graph'
        ? node.seriesSource.table
        : null
  return up && up !== node.id && nodeById(doc.nodes, up) ? up : null
}

const KIND_RANK: Record<DocNode['kind'], number> = {
  info: 0,
  table: 1,
  analysis: 2,
  graph: 3,
  layout: 4,
}

/**
 * The Family view (roadmap 40, decision 593): info sheets (project level), then each data table
 * with its analyses (and theirs, chained through result tables, derived tables of 38 among
 * them) and the graphs of the table and of the results, then layouts with the graphs they place.
 * Split graphs (34d) are grouped as their set. Within a branch: analyses before graphs, each in
 * navigator order. Every node appears once at home; layouts list their graphs as links.
 */
export function familyTree(doc: Pick<Project, 'nodes' | 'order'>): FamilyEntry[] {
  const nodes = doc.order.flatMap((id) => {
    const n = nodeById(doc.nodes, id)
    return n ? [n] : []
  })
  const children = new Map<NodeId | null, DocNode[]>()
  for (const n of nodes) {
    const p = familyParent(doc, n)
    children.set(p, [...(children.get(p) ?? []), n])
  }
  const build = (list: readonly DocNode[], seen: Set<NodeId>): FamilyEntry[] => {
    const sorted = [...list].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])
    const out: FamilyEntry[] = []
    const sets = new Map<string, Extract<FamilyEntry, { kind: 'set' }>>()
    for (const n of sorted) {
      if (seen.has(n.id)) continue
      seen.add(n.id)
      const entry: FamilyEntry = {
        kind: 'node',
        id: n.id,
        children:
          n.kind === 'layout'
            ? [...new Set(n.items.flatMap((it) => (it.type === 'graph' ? [it.graph] : [])))]
                .filter((g) => nodeById(doc.nodes, g))
                .map((g) => ({ kind: 'node', id: g, children: [], link: true }))
            : build(children.get(n.id) ?? [], seen),
      }
      const set = n.kind === 'graph' ? n.split?.set : undefined
      if (set === undefined) {
        out.push(entry)
        continue
      }
      const group = sets.get(set)
      if (group) group.children.push(entry)
      else {
        const g: FamilyEntry = { kind: 'set', set, first: n.id, children: [entry] }
        sets.set(set, g)
        out.push(g)
      }
    }
    return out
  }
  return build(children.get(null) ?? [], new Set())
}

/** Every node of a Family view entry list at home (links left out), depth first. */
export function familyNodes(entries: readonly FamilyEntry[]): NodeId[] {
  const out: NodeId[] = []
  const walk = (es: readonly FamilyEntry[]) => {
    for (const e of es) {
      if (e.kind === 'node' && !e.link) out.push(e.id)
      walk(e.children)
    }
  }
  walk(entries)
  return out
}
