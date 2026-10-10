import type { AnalysisResult } from './analysis.ts'
import { mayNameInfo, resolvedTable, withConstants } from './formula.ts'
import type { NodeId } from './ids.ts'
import { infoConstants } from './info.ts'
import { nodeById, type Project } from './project.ts'
import type { DataTable } from './table.ts'

/** Latest result of an analysis node (derived data, from outside the document). */
export type ResultLookup = (analysisId: NodeId) => AnalysisResult | undefined

/** Result tables re-addressed under their analysis node, per result table object. */
const addressed = new WeakMap<DataTable, Map<string, DataTable>>()

/**
 * A result table as a source: the table an analysis produced, with `id` set to the analysis
 * node's id (a plugin's own node id is ignored) and, when given, `name` to the analysis node's
 * name. Memoized per result table object, so the same result gives the same object and
 * per-column normalization stays cached.
 */
export function resultTableAs(table: DataTable, analysisId: NodeId, name?: string): DataTable {
  if (table.id === analysisId && (name === undefined || table.name === name)) return table
  const key = `${analysisId}\u0000${name ?? ''}`
  let byKey = addressed.get(table)
  const hit = byKey?.get(key)
  if (hit) return hit
  const out: DataTable = { ...table, id: analysisId, name: name ?? table.name }
  if (!byKey) {
    byKey = new Map()
    addressed.set(table, byKey)
  }
  byKey.set(key, out)
  return out
}

/**
 * The data table a node provides to analyses and graphs: a data table itself (its text formulas'
 * values as text, `resolvedTable`), or the table an
 * analysis produced (its latest result's `table`, addressed by the analysis node's id and named
 * after it). Undefined when the node is missing, of another kind, or has no result table (yet).
 */
export function sourceTable(
  project: Pick<Project, 'nodes'> & Partial<Pick<Project, 'order'>>,
  id: NodeId | string,
  result?: ResultLookup,
): DataTable | undefined {
  const node = nodeById(project.nodes, id)
  // Calculated variables giving text are text variables to graphs (roadmap 38, `resolvedTable`;
  // the table itself when it has none).
  // Roadmap 40: formulas naming info fields read the project's info sheets (given its order).
  if (node?.kind === 'table')
    return resolvedTable(
      project.order && mayNameInfo(node)
        ? withConstants(node, infoConstants({ nodes: project.nodes, order: project.order }))
        : node,
    )
  if (node?.kind !== 'analysis') return undefined
  const table = result?.(node.id)?.table
  return table ? resultTableAs(table, node.id, node.name) : undefined
}
