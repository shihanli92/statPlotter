import {
  type AnalysisResult,
  type Annotation,
  type DataTable,
  type DocNode,
  type GraphNode,
  type NodeId,
  newAnnotationId,
} from '@ps/model'
import { defaultPresetFor, presetGraph } from './presets.ts'

// Making graphs (roadmap 33c): a new graph is a preset's frame and layers on its frame's scaffold
// (`presets.ts`, `scaffold.ts`), drawn layer by layer (decision 231); analysis outputs join a
// graph's output layers (`outputs.ts`).

/**
 * The default graph of a table: its kind's usual preset, or the natural one of the node it comes
 * from (a frequency distribution's table is a histogram).
 */
export const createGraphFor = (table: DataTable, name?: string, node?: DocNode): GraphNode =>
  presetGraph(table, defaultPresetFor(table, node), name)

/**
 * Brackets for every comparison of an analysis whose two data sets are on the graph and don't
 * already have a bracket from that analysis. Labels stay live: they reference the comparison.
 */
export function bracketsFromAnalysis(
  graph: GraphNode,
  analysisId: NodeId,
  result: AnalysisResult,
  show: 'stars' | 'p' | 'both' | 'number' = 'stars',
  /** Only comparisons with (adjusted) P below this; Infinity keeps all. */
  maxP = Number.POSITIVE_INFINITY,
): Annotation[] {
  const existing = new Set(
    graph.annotations.flatMap((a) =>
      a.type === 'bracket' && a.label.source === 'analysis' && a.label.analysis === analysisId
        ? [a.label.comparison]
        : [],
    ),
  )
  return (
    result.comparisons
      .filter((c) => c.a.node === graph.seriesSource.table && c.b.node === graph.seriesSource.table)
      .filter((c) => !existing.has(c.key))
      .filter((c) => (c.pAdjusted ?? c.p) < maxP)
      // Grouped graphs place brackets between cells; column graphs between whole data sets.
      .filter((c) => (graph.frame === 'grouped') === (c.rowA !== undefined))
      .map((c) => ({
        type: 'bracket' as const,
        id: newAnnotationId(),
        a: c.a.key,
        b: c.b.key,
        ...(c.rowA !== undefined ? { rowA: c.rowA, rowB: c.rowB ?? c.rowA } : {}),
        label: { source: 'analysis' as const, analysis: analysisId, comparison: c.key, show },
        level: 'auto' as const,
      }))
  )
}

/**
 * Default for adding brackets: a single comparison (e.g. a t test) is shown even when ns; with
 * several (ANOVA post tests), only significant ones, to avoid clutter.
 */
export const defaultBracketMaxP = (result: AnalysisResult): number =>
  result.comparisons.length <= 1 ? Number.POSITIVE_INFINITY : 0.05
