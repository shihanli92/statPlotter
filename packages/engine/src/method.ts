import {
  APP_VERSION,
  createProject,
  type DataTable,
  type DocNode,
  infoReads,
  infoSheets,
  mapGraphRefs,
  NodeId,
  nodeById,
  type Project,
  parseProject,
  UnsupportedVersionError,
} from '@ps/model'
import { z } from 'zod'
import { type ApplyOptions, type ApplyPlan, applyToTables } from './apply.ts'
import { CommandError, copyData } from './commands.ts'
import { familyOf } from './family.ts'
import { clearTableValues } from './template.ts'

// Saved methods (roadmap 31): a table's analyses (with their parameters) and graphs (with their
// formatting), and optionally its layouts, kept apart from any project and applied to any table
// of the same kind as Apply to other tables does. A method holds a small project: the table
// without its values (kind, entry format, data set titles, rows) and its family, so the project
// file's migrations and validation apply to it, and nothing in it names another project's nodes.

export const METHOD_FORMAT = 'plotting-software-method'
/** Version of the method file's envelope; the project inside has its own schema version. */
export const METHOD_VERSION = 1
export const METHOD_EXTENSION = 'psmethod'

export interface Method {
  name: string
  description: string
  /** ISO date and time it was saved. */
  created: string
  appVersion: string
  /** The table it was made from (in `project`), without its values. */
  table: NodeId
  /** That table and its family, nothing else. */
  project: Project
}

const MethodFile = z.object({
  format: z.literal(METHOD_FORMAT),
  version: z.number().int().min(1),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).default(''),
  created: z.string(),
  appVersion: z.string(),
  table: NodeId,
  project: z.unknown(),
})

export class MethodError extends Error {}

/** The method's table (kind, format, data set titles; no values). */
export const methodTable = (m: Method): DataTable => m.project.nodes[m.table] as DataTable

/** What a method makes, counted by kind. */
export function methodContents(m: Method): Record<'analysis' | 'graph' | 'layout', number> {
  const out = { analysis: 0, graph: 0, layout: 0 }
  for (const n of Object.values(m.project.nodes))
    if (n.kind !== 'table' && n.kind !== 'info') out[n.kind]++
  return out
}

/** Images on the pages a method of `tableId` would include, which it leaves out. */
export function methodImages(doc: Project, tableId: NodeId, layouts: boolean): number {
  if (!layouts) return 0
  let n = 0
  for (const id of familyOf(doc, tableId, 'whole')) {
    const node = nodeById(doc.nodes, id)
    if (node?.kind === 'layout') n += node.items.filter((it) => it.type === 'image').length
  }
  return n
}

/**
 * A method from table `tableId` of `doc`: its analyses and graphs (and, with `layouts`, the
 * layouts whose graphs and live tables are all among them), with the info sheets its formulas
 * read. Curves and brackets a graph takes from
 * analyses of other tables are left out, as those analyses are not part of it, and so are images on
 * its pages (`methodImages`).
 */
export function createMethod(
  doc: Project,
  tableId: NodeId,
  opts: { name: string; description?: string; layouts: boolean; now?: Date },
): Method {
  const table = nodeById(doc.nodes, tableId)
  if (table?.kind !== 'table') throw new CommandError(`${tableId} is not a data table`)
  const members = familyOf(doc, tableId, opts.layouts ? 'whole' : 'none')
  const kept = new Set<string>([tableId, ...members])
  const nodes: Record<NodeId, DocNode> = { [tableId]: clearTableValues(table) }
  for (const id of members) {
    let n = copyData(nodeById(doc.nodes, id)!)
    if (n.kind === 'graph')
      n = mapGraphRefs(n, {
        output: (o) => (kept.has(o.ref.node) ? 'keep' : 'drop'),
        bracket: (a) =>
          a.label.source === 'analysis' && !kept.has(a.label.analysis) ? 'drop' : 'keep',
        analysis: (node) => (kept.has(node) ? 'keep' : 'drop'),
      })
    // Images stay out: their bytes live beside a project, not in a method (`methodImages`).
    if (n.kind === 'layout') n.items = n.items.filter((it) => it.type !== 'image')
    nodes[id] = n
  }
  // Audit 2 (M5): the info sheets the table's formulas read come along, so nothing in the
  // method names a sheet it doesn't hold.
  const info = [
    ...new Set(infoReads(table, infoSheets(doc)).flatMap((r) => (r.sheet ? [r.sheet.id] : []))),
  ]
  for (const id of info) nodes[id] = copyData(nodeById(doc.nodes, id)!)
  const now = opts.now ?? new Date()
  const project = parseProject({
    ...createProject(opts.name, now),
    nodes,
    order: [...info, tableId, ...members],
  })
  return {
    name: opts.name.trim(),
    description: opts.description ?? '',
    created: now.toISOString(),
    appVersion: APP_VERSION,
    table: tableId,
    project,
  }
}

/** The method file's text (JSON). */
export function writeMethod(m: Method): string {
  const file: z.input<typeof MethodFile> = {
    format: METHOD_FORMAT,
    version: METHOD_VERSION,
    name: m.name,
    description: m.description,
    created: m.created,
    appVersion: m.appVersion,
    table: m.table,
    project: m.project,
  }
  return `${JSON.stringify(file, null, 1)}\n`
}

/**
 * A method file read back and checked: the envelope's shape and version, then its project
 * through the project file's migrations and validation. Throws MethodError with a message for
 * the user.
 */
export function readMethod(text: string): Method {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new MethodError('Not a method file (it is not valid JSON).')
  }
  const format = (raw as { format?: unknown } | null)?.format
  if (format !== METHOD_FORMAT) throw new MethodError('Not a method file.')
  const version = (raw as { version?: unknown }).version
  if (typeof version === 'number' && version > METHOD_VERSION)
    throw new MethodError('This method was saved by a newer version of the app.')
  const env = MethodFile.safeParse(raw)
  if (!env.success)
    throw new MethodError(
      `Invalid method file: ${env.error.issues[0]?.path.join('.')} ${env.error.issues[0]?.message}`,
    )
  let project: Project
  try {
    project = parseProject(env.data.project)
  } catch (e) {
    if (e instanceof UnsupportedVersionError) throw new MethodError(e.message)
    const issue = (e as { issues?: { path: PropertyKey[]; message: string }[] }).issues?.[0]
    throw new MethodError(
      `Invalid method file${issue ? `: ${issue.path.join('.')}: ${issue.message}` : '.'}`,
    )
  }
  if (nodeById(project.nodes, env.data.table)?.kind !== 'table')
    throw new MethodError('Invalid method file: its table is missing.')
  const { format: _f, version: _v, ...rest } = env.data
  return { ...rest, project }
}

/**
 * Commands creating the method's analyses, graphs and layouts for each target table (same kind
 * as the method's table), as Apply to other tables does. `find` defaults to the name of the table
 * the method was made from.
 */
export function applyMethod(
  m: Method,
  doc: Project,
  targets: readonly NodeId[],
  opts: Omit<ApplyOptions, 'layouts' | 'find'> & { find?: string },
): ApplyPlan {
  return applyToTables(m.project, m.table, doc, targets, {
    ...opts,
    layouts: true,
    find: opts.find ?? methodTable(m).name,
  })
}
