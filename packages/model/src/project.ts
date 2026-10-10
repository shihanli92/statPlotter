import { z } from 'zod'
import { AnalysisNode } from './analysis.ts'
import { FigureStyle } from './figureStyle.ts'
import { Folder, folderIssues } from './folders.ts'
import { graphRefs } from './graphRefs.ts'
import { NodeId } from './ids.ts'
import { GraphNode, layerIssues } from './layers.ts'
import { InfoNode, LayoutNode } from './other.ts'
import { DataTable, type Issue, type RowArrayKind, withKnownRowArrays } from './table.ts'

export const DocNode = z.discriminatedUnion('kind', [
  DataTable,
  AnalysisNode,
  GraphNode,
  LayoutNode,
  InfoNode,
])
export type DocNode = z.infer<typeof DocNode>
export type DocNodeKind = DocNode['kind']

export const ProjectSettings = z.object({
  /** GP: ns, *, **, ***, ****. */
  pValueStyle: z.enum(['GP', 'APA', 'NEJM']).default('GP'),
  pValueDigits: z.number().int().min(1).max(15).default(4),
  defaultConfidenceLevel: z.number().gt(0).lt(1).default(0.95),
  /**
   * The project's style (roadmap 37): a built-in's id ('default', 'journal-nature', …) or
   * `user:<name>`, for menus; `style` holds its values (absent: the app's own look, old files).
   */
  theme: z.string().default('default'),
  /** Roadmap 37: the values of the project's style, copied in (decision 530). */
  style: FigureStyle.optional(),
})
export type ProjectSettings = z.infer<typeof ProjectSettings>

/** Schema v2 (roadmap 33b): graphs as a frame plus layers; v1 files migrate (`migrate.ts`). */
export const CURRENT_SCHEMA_VERSION = 2

const ProjectObject = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  meta: z.object({
    title: z.string(),
    created: z.iso.datetime(),
    modified: z.iso.datetime(),
    appVersion: z.string(),
  }),
  settings: ProjectSettings,
  nodes: z.record(NodeId, DocNode),
  /** Navigator order. Sections (Tables / Results / Graphs…) are derived from node kind. */
  order: z.array(NodeId),
  /** Roadmap 40: the navigator's folders (absent: none). Sheets keep `order`'s order. */
  folders: z.array(Folder).optional(),
})
type ProjectShape = z.infer<typeof ProjectObject>

/** A node-level reference and which node kinds it may point at. */
interface NodeRef {
  target: NodeId
  allowed: readonly DocNodeKind[]
  path: Issue['path']
}

function nodeRefs(node: DocNode): NodeRef[] {
  switch (node.kind) {
    case 'table':
    case 'info':
      return []
    case 'analysis':
      return [
        { target: node.input.source, allowed: ['table', 'analysis'], path: ['input', 'source'] },
      ]
    case 'graph':
      // A data table, or an analysis whose result is a table (Transform, Normalize…); the
      // analyses (or tables) whose outputs its layers draw; analyses labelling its brackets.
      return graphRefs(node).flatMap((r): NodeRef[] =>
        r.kind === 'source'
          ? [{ target: r.node, allowed: ['table', 'analysis'], path: r.path }]
          : r.kind === 'output'
            ? [{ target: r.node, allowed: ['table', 'analysis'], path: [...r.path, 'ref', 'node'] }]
            : r.kind === 'analysis'
              ? [{ target: r.node, allowed: ['analysis'], path: r.path }]
              : r.kind === 'bracket' && r.annotation.label.source === 'analysis'
                ? [
                    {
                      target: r.annotation.label.analysis,
                      allowed: ['analysis'],
                      path: [...r.path, 'label', 'analysis'],
                    },
                  ]
                : [],
      )
    case 'layout':
      return node.items.flatMap((it, i): NodeRef[] =>
        it.type === 'graph'
          ? [{ target: it.graph, allowed: ['graph'], path: ['items', i, 'graph'] }]
          : it.type === 'table'
            ? [
                {
                  target: it.source.node,
                  // A data table or an analysis (its result table, or a sheet of its results).
                  allowed: it.source.kind === 'table' ? ['table', 'analysis'] : ['analysis'],
                  path: ['items', i, 'source', 'node'],
                },
              ]
            : [],
      )
  }
}

/**
 * A node's issues as the store holds it (audit 2, M14): the schema's; fields missing that the
 * schema would fill with a default (files are read with their defaults filled, so code reads every
 * field without them: a stored node must hold them all); and analysis parameters that are not
 * plain JSON data (NaN, infinities, undefined, functions, class instances). `known`: per-row
 * arrays already checked, by kind (`rowArraysOf` of the node as stored before the change), whose
 * elements are not checked again where they stand as that kind (audit 2, M2:
 * `withKnownRowArrays`).
 */
export function storedNodeIssues(
  node: unknown,
  known: ReadonlyMap<unknown, RowArrayKind> = new Map(),
): Issue[] {
  const parsed = withKnownRowArrays(known, () => DocNode.safeParse(node))
  if (!parsed.success)
    return parsed.error.issues.map((i) => ({
      path: i.path.filter((k): k is string | number => typeof k !== 'symbol'),
      message: i.message,
    }))
  const out: Issue[] = []
  defaultedFields(node, parsed.data, [], out, known)
  if (parsed.data.kind === 'analysis')
    jsonIssues((node as { params?: unknown }).params, ['params'], out)
  return out
}

/** Places where the parsed value holds a field its input lacks (a default filled). */
function defaultedFields(
  input: unknown,
  parsed: unknown,
  path: Issue['path'],
  out: Issue[],
  known: ReadonlyMap<unknown, RowArrayKind>,
) {
  if (parsed === null || typeof parsed !== 'object') return
  if (Array.isArray(parsed)) {
    // A per-row array checked before holds no objects a default could fill.
    if (!Array.isArray(input) || known.has(input)) return
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i]
      if (p !== null && typeof p === 'object')
        defaultedFields(input[i], p, [...path, i], out, known)
    }
    return
  }
  if (input === null || typeof input !== 'object') return
  const given = input as Record<string, unknown>
  for (const [k, v] of Object.entries(parsed)) {
    if (v === undefined) continue
    if (given[k] === undefined) out.push({ path: [...path, k], message: 'required' })
    else defaultedFields(given[k], v, [...path, k], out, known)
  }
}

/** Places in a value that are not plain JSON data. */
function jsonIssues(v: unknown, path: Issue['path'], out: Issue[]) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) out.push({ path, message: 'not a finite number' })
    return
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) jsonIssues(v[i], [...path, i], out)
    return
  }
  const proto = typeof v === 'object' ? Object.getPrototypeOf(v) : undefined
  if (proto === Object.prototype || proto === null) {
    for (const [k, x] of Object.entries(v as object)) jsonIssues(x, [...path, k], out)
    return
  }
  out.push({ path, message: v === undefined ? 'undefined' : 'not plain data' })
}

/** Nodes this node depends on (its upstream in the DAG), deduplicated. */
export function nodeDependencies(node: DocNode): NodeId[] {
  return [...new Set(nodeRefs(node).map((r) => r.target))]
}

/**
 * Own-property node lookup: an id such as `constructor` must not resolve to an Object.prototype
 * member.
 */
export const nodeById = (
  nodes: Readonly<Record<NodeId, DocNode>>,
  id: string,
): DocNode | undefined => (Object.hasOwn(nodes, id) ? nodes[id as NodeId] : undefined)

/** Returns one cycle as a list of node ids, or null if the graph is acyclic. */
export function findCycle(nodes: Readonly<Record<NodeId, DocNode>>): NodeId[] | null {
  const state = new Map<NodeId, 'visiting' | 'done'>()
  const stack: NodeId[] = []

  const visit = (id: NodeId): NodeId[] | null => {
    const s = state.get(id)
    if (s === 'done') return null
    if (s === 'visiting') return stack.slice(stack.indexOf(id))
    const node = nodeById(nodes, id)
    if (!node) return null
    state.set(id, 'visiting')
    stack.push(id)
    for (const dep of nodeDependencies(node)) {
      const cycle = visit(dep)
      if (cycle) return cycle
    }
    stack.pop()
    state.set(id, 'done')
    return null
  }

  for (const id of Object.keys(nodes) as NodeId[]) {
    const cycle = visit(id)
    if (cycle) return cycle
  }
  return null
}

/** Referential integrity of a project: ids, navigator order, node references, no cycles. */
export function projectIssues(p: ProjectShape): Issue[] {
  const out: Issue[] = []
  const ids = Object.keys(p.nodes) as NodeId[]

  for (const id of ids) {
    const node = p.nodes[id]!
    if (node.id !== id)
      out.push({ path: ['nodes', id, 'id'], message: `node id ${node.id} does not match key` })
    if (node.kind === 'graph')
      for (const i of layerIssues(node)) out.push({ ...i, path: ['nodes', id, ...i.path] })
    for (const ref of nodeRefs(node)) {
      const target = nodeById(p.nodes, ref.target)
      if (!target) {
        out.push({
          path: ['nodes', id, ...ref.path],
          message: `references missing node ${ref.target}`,
        })
      } else if (!ref.allowed.includes(target.kind)) {
        out.push({
          path: ['nodes', id, ...ref.path],
          message: `must reference a ${ref.allowed.join(' or ')}, not a ${target.kind}`,
        })
      }
    }
  }

  const inOrder = new Set(p.order)
  if (inOrder.size !== p.order.length)
    out.push({ path: ['order'], message: 'duplicate ids in order' })
  for (const id of p.order) {
    if (!nodeById(p.nodes, id))
      out.push({ path: ['order'], message: `order lists missing node ${id}` })
  }
  for (const id of ids) {
    if (!inOrder.has(id)) out.push({ path: ['order'], message: `node ${id} missing from order` })
  }

  for (const i of folderIssues(p.folders, (id) => !!nodeById(p.nodes, id))) out.push(i)

  const cycle = findCycle(p.nodes)
  if (cycle) out.push({ path: ['nodes'], message: `dependency cycle: ${cycle.join(' → ')}` })

  return out
}

export const Project = ProjectObject.superRefine((p, ctx) => {
  for (const issue of projectIssues(p)) ctx.addIssue({ code: 'custom', ...issue })
})
export type Project = z.infer<typeof Project>
