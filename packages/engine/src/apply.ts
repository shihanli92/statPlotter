import {
  type AnalysisNode,
  type DataTable,
  type DocNode,
  graphAnalyses,
  mapGraphRefs,
  type NodeId,
  newNodeId,
  nodeById,
  type Project,
} from '@ps/model'
import { type Command, CommandError, removalSet } from './commands.ts'
import { familyOf } from './family.ts'
import {
  analysisSourceIn,
  dataSetMap,
  type Remap,
  remapNode,
  rowsUpTo,
  substitute,
  warnings,
} from './remap.ts'

// Reusing analyses on other tables (roadmap 31): copies of a table's analyses and graphs (and
// optionally layouts) pointed at other tables of the same kind, and one analysis moved to another
// table. Methods (method.ts) apply a stored family the same way.

export type DataSetMatch = 'position' | 'title'

export interface ApplyOptions {
  /** Pair data sets by position (the first with the first…) or by title. */
  match: DataSetMatch
  /** Copy the layouts whose graphs are all in the family too. */
  layouts: boolean
  /**
   * In the copies' names, this text (usually the source table's name) is replaced by the target
   * table's name. Empty: names unchanged.
   */
  find: string
  newId?: () => NodeId
}

export interface ApplyPlan {
  commands: Command[]
  /** The nodes made, per target (in the order given). */
  created: { target: NodeId; nodes: NodeId[] }[]
  /**
   * What could not be carried over: data sets without a match, rows past the target's end
   * (row slices, labelled rows, brackets, row parameters) — left out of the copies.
   */
  warnings: string[]
}

/** Data tables of `doc` that a family of `table` can be applied to: same kind, not itself. */
export function compatibleTables(
  doc: Project,
  table: Pick<DataTable, 'id' | 'tableKind'>,
): DataTable[] {
  return doc.order.flatMap((id) => {
    const n = nodeById(doc.nodes, id)
    return n?.kind === 'table' && n.id !== table.id && n.tableKind === table.tableKind ? [n] : []
  })
}

/**
 * Commands creating, for each target table of `doc`, copies of the analyses and graphs (and
 * layouts) of `sourceTable`'s family in `source` (the same project, or a method's) that read the
 * target instead: data sets matched by position or title, rows kept where the target has them.
 * One undo step for all targets.
 */
export function applyToTables(
  source: Project,
  sourceTable: NodeId,
  doc: Project,
  targets: readonly NodeId[],
  opts: ApplyOptions,
): ApplyPlan {
  const from = nodeById(source.nodes, sourceTable)
  if (from?.kind !== 'table') throw new CommandError(`${sourceTable} is not a data table`)
  const newId = opts.newId ?? newNodeId
  const members = familyOf(source, sourceTable, opts.layouts ? 'whole' : 'none')
  const report = warnings()
  const commands: Command[] = []
  const created: ApplyPlan['created'] = []
  for (const targetId of targets) {
    const to = nodeById(doc.nodes, targetId)
    if (to?.kind !== 'table') throw new CommandError(`${targetId} is not a data table`)
    if (to.tableKind !== from.tableKind)
      throw new CommandError(`“${to.name}” is not a ${from.tableKind} table`)
    const ids = new Map<NodeId, NodeId>([[sourceTable, targetId]])
    for (const id of members) ids.set(id, newId())
    const keys = dataSetMap(from, to, opts.match)
    const titles = new Map(from.dataSets.map((d) => [d.id as string, d.title || '(untitled)']))
    const remap: Remap = {
      nodes: ids,
      keys,
      rowsOf: sourceTable,
      rows: rowsUpTo(to.rowCount),
      links: new Map(),
      newLink: () => newNodeId(),
      analysisSource: analysisSourceIn(source),
      title: (k) => titles.get(k) ?? k,
      warn: report.warn,
    }
    const nodes: NodeId[] = []
    for (const id of members) {
      const original = nodeById(source.nodes, id)!
      const name = substitute(original.name, opts.find, to.name)
      const node: DocNode = { ...remapNode({ ...original, name }, remap), id: ids.get(id)! }
      commands.push({ type: 'node.add', node })
      nodes.push(node.id)
    }
    created.push({ target: targetId, nodes })
  }
  return { commands, created, warnings: report.list() }
}

/**
 * Change the analyzed table (roadmap 31): commands pointing analysis `id` at data table
 * `targetId` (same kind), its data sets and parameters remapped by position or title. What
 * depends on it follows: analyses and graphs of its result table (their keys remapped), its own
 * output graphs, and graphs of the old table that show only this analysis' curves and brackets
 * (now graphs of the new table). Other graphs lose its curves and brackets. The names of the
 * analysis and of what follows it have the old table's name replaced by the new one's.
 */
export function retargetAnalysis(
  doc: Project,
  id: NodeId,
  targetId: NodeId,
  match: DataSetMatch,
): { commands: Command[]; warnings: string[] } {
  const analysis = nodeById(doc.nodes, id)
  if (analysis?.kind !== 'analysis') throw new CommandError(`${id} is not an analysis`)
  const from = nodeById(doc.nodes, analysis.input.source)
  const to = nodeById(doc.nodes, targetId)
  if (from?.kind !== 'table') throw new CommandError('the analysis does not read a data table')
  if (to?.kind !== 'table') throw new CommandError(`${targetId} is not a data table`)
  if (to.tableKind !== from.tableKind)
    throw new CommandError(`“${to.name}” is not a ${from.tableKind} table`)
  if (from.id === to.id) return { commands: [], warnings: [] }

  const report = warnings()
  const titles = new Map(from.dataSets.map((d) => [d.id as string, d.title || '(untitled)']))
  const remap: Remap = {
    // The analysis keeps its id; listed so keys of its outputs (curves) are remapped too.
    nodes: new Map([
      [from.id, to.id],
      [id, id],
    ]),
    keys: dataSetMap(from, to, match),
    rowsOf: from.id,
    rows: rowsUpTo(to.rowCount),
    analysisSource: analysisSourceIn(doc),
    title: (k) => titles.get(k) ?? k,
    warn: report.warn,
  }
  const rename = <N extends DocNode>(n: N): N => ({
    ...n,
    name: substitute(n.name, from.name, to.name),
  })
  const downstream = removalSet(doc, id)
  downstream.delete(id)
  const commands: Command[] = []
  const replace = (node: DocNode) => commands.push({ type: 'node.replace', node })
  replace(rename(remapNode(analysis as AnalysisNode, remap)))
  for (const nid of doc.order) {
    const n = nodeById(doc.nodes, nid)
    if (!n || n.id === id) continue
    if (downstream.has(n.id)) {
      // Downstream nodes read the analysis' results: data set keys change (not rows), and its
      // own output graphs (drawn from its outputs alone) move to the new table with it.
      replace(rename(remapNode(n, { nodes: remap.nodes, keys: remap.keys, warn: report.warn })))
      continue
    }
    if (n.kind !== 'graph') continue
    const shown = graphAnalyses(n)
    if (!shown.includes(id)) continue
    if (n.seriesSource.table === from.id && shown.every((r) => r === id))
      replace(rename(remapNode(n, remap)))
    else {
      // Its curves and brackets would now describe other data than the graph shows.
      replace(
        mapGraphRefs(n, {
          output: (o) => (o.ref.node === id ? 'drop' : 'keep'),
          bracket: (a) =>
            a.label.source === 'analysis' && a.label.analysis === id ? 'drop' : 'keep',
          analysis: (node) => (node === id ? 'drop' : 'keep'),
        }),
      )
      report.warn(n.name, `no longer shows the curves and brackets of “${analysis.name}”`)
    }
  }
  return { commands, warnings: report.list() }
}
