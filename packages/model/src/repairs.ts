import { layerData } from './graphRefs.ts'
import type { NodeId } from './ids.ts'
import type { GraphNode, Layer } from './layers.ts'
import type { DocNode, Project } from './project.ts'
import type { ResultField } from './results.ts'

// Repairs made when a document is read (not migrations: the schema is unchanged). Each fixes
// data an earlier version wrote wrongly, identified exactly, and leaves everything else as it is
// (the same object when nothing needed repairing).

/**
 * Audit 2 (decision 680): the paired t test's ready "t, df and P" label named the sheet's
 * 'Number of pairs' row as its df (n where df is n − 1). Its `df` field reading that row of the
 * results sheet, on a layer drawing a t test's results, now reads the 'df' row.
 */
function repairTtestDf(layer: Layer, graph: GraphNode, nodes: Project['nodes']): Layer {
  const stat = layer.stat
  if (stat?.kind !== 'result') return layer
  const field = stat.fields.df
  const ref = field?.ref
  if (
    !field ||
    ref?.from !== 'cell' ||
    ref.sheet !== 'results' ||
    ref.row !== 'Number of pairs' ||
    ref.block !== undefined ||
    ref.column !== undefined ||
    ref.end !== undefined
  )
    return layer
  const data = layerData(graph, layer)
  if (data.from !== 'analysis') return layer
  const analysis = Object.hasOwn(nodes, data.analysis) ? nodes[data.analysis] : undefined
  if (analysis?.kind !== 'analysis' || analysis.analysisId !== 'ttest') return layer
  const fixed: ResultField = { ...field, ref: { ...ref, row: 'df' } }
  // Only the stat's fields change (the geom, and so the layer's kind, stay).
  return { ...layer, stat: { ...stat, fields: { ...stat.fields, df: fixed } } } as Layer
}

/** The document with what earlier versions wrote wrongly repaired. */
export function repairProject(project: Project): Project {
  let nodes: Record<NodeId, DocNode> | null = null
  for (const [id, node] of Object.entries(project.nodes) as [NodeId, DocNode][]) {
    if (node.kind !== 'graph') continue
    let changed = false
    const layers = node.layers.map((l) => {
      const r = repairTtestDf(l, node, project.nodes)
      if (r !== l) changed = true
      return r
    })
    if (!changed) continue
    nodes ??= { ...project.nodes }
    nodes[id] = { ...node, layers }
  }
  return nodes ? { ...project, nodes } : project
}
