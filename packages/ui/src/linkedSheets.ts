import { type DocNode, graphOutputs, type NodeId, type Project } from '@ps/model'

/** The sheets View › Go to… opens from a sheet (absent: nothing to go to). */
interface LinkedSheets {
  /** The data table the sheet's data come from (up through analyses of analyses). */
  table?: NodeId
  /**
   * Results: a table's first analysis, an analysis' upstream one, the analysis a graph shows (its
   * source, or curves on it), else its table's first analysis.
   */
  results?: NodeId
  /** The first graph of a table, or of an analysis' results (else of the data it analyzed). */
  graph?: NodeId
}

/** The nearest data table upstream of a node (the node itself for a table). */
function tableOf(project: Project, id: NodeId): NodeId | undefined {
  const seen = new Set<NodeId>()
  let n: DocNode | undefined = project.nodes[id]
  while (n && !seen.has(n.id)) {
    seen.add(n.id)
    if (n.kind === 'table') return n.id
    if (n.kind === 'analysis') n = project.nodes[n.input.source]
    else if (n.kind === 'graph') n = project.nodes[n.seriesSource.table]
    else return undefined
  }
  return undefined
}

export function linkedSheets(project: Project, id: NodeId): LinkedSheets {
  const node = project.nodes[id]
  const nodes = project.order.map((k) => project.nodes[k]).filter((n) => n !== undefined)
  const graphOf = (src: NodeId) =>
    nodes.find((n) => n.kind === 'graph' && n.seriesSource.table === src)?.id
  const analysisOf = (src: NodeId) =>
    nodes.find((n) => n.kind === 'analysis' && n.input.source === src)?.id
  switch (node?.kind) {
    case 'table':
      return {
        results: analysisOf(id),
        graph: graphOf(id),
      }
    case 'analysis': {
      const source = project.nodes[node.input.source]
      return {
        table: tableOf(project, node.input.source),
        results: source?.kind === 'analysis' ? source.id : undefined,
        // Its own results graphed, else a graph showing its curves, else the analyzed data's.
        graph:
          graphOf(id) ??
          nodes.find(
            (n) => n.kind === 'graph' && graphOutputs(n).some((o) => o.series.ref.node === id),
          )?.id ??
          graphOf(node.input.source),
      }
    }
    case 'graph': {
      const source = project.nodes[node.seriesSource.table]
      return {
        table: tableOf(project, node.seriesSource.table),
        results:
          source?.kind === 'analysis'
            ? source.id
            : (graphOutputs(node).find((o) => project.nodes[o.series.ref.node]?.kind === 'analysis')
                ?.series.ref.node ?? analysisOf(node.seriesSource.table)),
      }
    }
    default:
      return {}
  }
}
