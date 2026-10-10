import { presetGraph } from '@ps/graph'
import {
  type AnalysisResult,
  type Annotation,
  createTable,
  type GraphNode,
  newAnnotationId,
  newNodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { bracketLabelShow, newBrackets } from '../src/graph/graphActions.ts'

/** Brackets added from a results sheet, the Add menu or Format graph share one label style. */
describe('new significance brackets', () => {
  const table = createTable({ columns: 3, rows: 3 })
  const [ka, kb, kc] = table.dataSets.map((d) => d.id as string)
  const ref = (key: string) => ({ node: table.id, key })
  const result: AnalysisResult = {
    status: 'ok',
    diagnostics: [],
    sheets: [],
    values: {},
    comparisons: [
      { key: 'ab', a: ref(ka!), b: ref(kb!), p: 0.003 },
      { key: 'ac', a: ref(ka!), b: ref(kc!), p: 0.2 },
    ],
    outputs: {},
  }
  const labels = (as: Annotation[]) =>
    as.map((a) => (a.type === 'bracket' && a.label.source === 'analysis' ? a.label.show : null))

  it('use stars on a graph without analysis brackets, significant comparisons only', () => {
    const graph = presetGraph(table, 'points')
    expect(bracketLabelShow(graph)).toBe('stars')
    expect(labels(newBrackets(graph, newNodeId(), result, false))).toEqual(['stars'])
    expect(labels(newBrackets(graph, newNodeId(), result, true))).toEqual(['stars', 'stars'])
  })

  it('follow the label style of the graph’s existing brackets', () => {
    const existing: Annotation = {
      type: 'bracket',
      id: newAnnotationId(),
      a: ka!,
      b: kc!,
      label: { source: 'analysis', analysis: newNodeId(), comparison: 'x', show: 'number' },
      level: 'auto',
    }
    const graph: GraphNode = {
      ...presetGraph(table, 'points'),
      annotations: [existing],
    }
    expect(labels(newBrackets(graph, newNodeId(), result, false))).toEqual(['number'])
  })
})
