import type { ResultState } from '@ps/engine'
import {
  type AnalysisDef,
  type DataTable,
  type DocNode,
  type NodeId,
  newNodeId,
  type ResultLookup,
} from '@ps/model'

// Result tables: the data table an analysis produces (Transform, Normalize, Frequency
// distribution…) can be viewed, analyzed and graphed like a data table. It lives in the results,
// not the document, and is addressed by the analysis node's id.

/** Whether an analysis node gives a data table: its plugin says so, or its result has one. */
export function givesTable(
  node: DocNode | undefined,
  def: Pick<AnalysisDef, 'producesTable'> | undefined,
  result: ResultLookup,
): boolean {
  return node?.kind === 'analysis' && (!!def?.producesTable || !!result(node.id)?.table)
}

/**
 * The node that "Analyze…" and "New graph…" work on for the selection: a data
 * table; an analysis' own result table when it gives one, else the data it analyzed; a graph's
 * source (a data table or a result table).
 */
export function dataNodeFor(
  node: DocNode | undefined,
  def: (analysisId: string) => Pick<AnalysisDef, 'producesTable'> | undefined,
  result: ResultLookup,
): NodeId | null {
  if (!node) return null
  if (node.kind === 'table') return node.id
  if (node.kind === 'graph') return node.seriesSource.table
  if (node.kind === 'analysis')
    return givesTable(node, def(node.analysisId), result) ? node.id : node.input.source
  return null
}

/** Why a node's data table can't be used (yet), or null when it is there. */
export function sourceProblem(
  node: DocNode | undefined,
  table: DataTable | undefined,
  state: ResultState | undefined,
): string | null {
  if (table) return null
  if (node?.kind !== 'analysis') return 'There is no data table to use.'
  if (state?.status === 'pending') return `“${node.name}” is still computing. Try again shortly.`
  if (state?.status === 'error') return `“${node.name}” could not be computed: ${state.message}`
  return `The result “${node.name}” has no data table.`
}

/**
 * Roadmap 38, "Freeze as data table": a result table as a data table of its own — the same data
 * (every variable's values, calculated ones already values), a new id and name, no link back.
 */
export function frozenCopy(table: DataTable, name: string): DataTable {
  const copy = structuredClone(table)
  return { ...copy, id: newNodeId(), name }
}
