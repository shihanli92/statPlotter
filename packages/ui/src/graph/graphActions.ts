import { registry } from '@ps/analyses'
import { type Command, editCommands } from '@ps/engine'
import { bracketsFromAnalysis, defaultBracketMaxP, withOutputSeries } from '@ps/graph'
import {
  type AnalysisNode,
  type AnalysisResult,
  type Annotation,
  type GraphEdit,
  type GraphNode,
  graphEdits,
  type NodeId,
  newAnnotationId,
  type Project,
} from '@ps/model'

/**
 * Things you can add to a graph (text, lines, brackets, curves), shared by the toolbar's Add menu
 * and the Format graph dialog.
 */

export const newTextBox = (): Annotation => ({
  type: 'text',
  id: newAnnotationId(),
  anchor: { space: 'plot', x: 0.05, y: 0.05 },
  content: { content: [{ text: 'Text' }] },
})

export const newLine = (arrow: 'none' | 'end'): Annotation => ({
  type: 'line',
  id: newAnnotationId(),
  space: 'plot',
  from: { x: 0.2, y: 0.3 },
  to: { x: 0.5, y: 0.15 },
  stroke: { color: { rgb: '#000000' }, width: 1, dash: 'solid' },
  arrow,
})

/**
 * The commands turning a graph into its changed version: `node.set` at the paths that differ
 * (layers named by id), the layer list replaced where layers come or go.
 */
export const graphChangeCommands = (before: GraphNode, after: GraphNode): Command[] =>
  editCommands(before.id, graphEdits(before, after))

/**
 * The analyses of the graph’s data table, shown on it or not (those it shows: `graphAnalyses` of
 * @ps/model).
 */
function tableAnalysesOf(project: Project, graph: Pick<GraphNode, 'seriesSource'>): AnalysisNode[] {
  return Object.values(project.nodes).filter(
    (n): n is AnalysisNode => n.kind === 'analysis' && n.input.source === graph.seriesSource.table,
  )
}

/** Analyses of the graph's table with comparisons that could become brackets. */
export function bracketableAnalyses(
  project: Project,
  graph: Pick<GraphNode, 'seriesSource'>,
  lookup: (id: NodeId) => AnalysisResult | undefined,
): { a: AnalysisNode; result: AnalysisResult }[] {
  return tableAnalysesOf(project, graph).flatMap((a) => {
    const result = lookup(a.id as NodeId)
    return result && result.comparisons.length > 0 ? [{ a, result }] : []
  })
}

/**
 * Curves (fits…) of the graph's analyses not yet on the graph, by analysis: the edits adding them
 * to its output layers.
 */
export function missingCurves(
  project: Project,
  graph: GraphNode,
): { a: AnalysisNode; edits: GraphEdit[] }[] {
  return tableAnalysesOf(project, graph).flatMap((a) => {
    const def = registry.get(a.analysisId)
    const decls = def?.outputs?.(a.input.dataSets, a.params) ?? []
    const { edits } = withOutputSeries(graph, a.id, decls)
    return edits.length ? [{ a, edits }] : []
  })
}

/** How existing analysis brackets are labelled (new ones follow suit). */
export function bracketLabelShow(graph: Pick<GraphNode, 'annotations'>) {
  const first = graph.annotations.find((x) => x.type === 'bracket' && x.label.source === 'analysis')
  return first?.type === 'bracket' && first.label.source === 'analysis' ? first.label.show : 'stars'
}

/** Brackets to add from an analysis: significant comparisons, or all of them. */
export function newBrackets(
  graph: GraphNode,
  analysisId: NodeId,
  result: AnalysisResult,
  includeNonSignificant: boolean,
): Annotation[] {
  const maxP = includeNonSignificant ? Number.POSITIVE_INFINITY : defaultBracketMaxP(result)
  return bracketsFromAnalysis(graph, analysisId, result, bracketLabelShow(graph), maxP)
}
