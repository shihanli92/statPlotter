import { describe, expect, it } from 'vitest'
import {
  type AnalysisNode,
  createProject,
  createTable,
  type GraphNode,
  type Layer,
  type NodeId,
  newNodeId,
  type Project,
  parseProject,
} from '../src/index.ts'

// Repairs on reading a document (`repairs.ts`): what earlier versions wrote wrongly, fixed exactly
// and only there.

const tdfLayer = (id: string, row: string, data: Layer['data']): Layer => ({
  id,
  geom: 'label',
  stat: {
    kind: 'result',
    fields: {
      t: { ref: { from: 'cell', sheet: 'results', row: 't' }, format: { digits: 3 } },
      df: { ref: { from: 'cell', sheet: 'results', row } },
      P: { ref: { from: 'value', key: 'p' }, format: { p: 'below' } },
    },
    template: [{ text: 't = {t}, df = {df}, P = {P}' }],
  },
  data,
})

function projectWith(analysisId: string, layers: (analysis: NodeId) => Layer[]): Project {
  const p = createProject()
  const table = createTable({ columns: 2, rows: 5 })
  const analysis: AnalysisNode = {
    kind: 'analysis',
    id: newNodeId(),
    name: 'Paired t test',
    analysisId,
    pluginVersion: 1,
    input: { source: table.id, dataSets: [] },
    params: { design: 'paired' },
  }
  const graph: GraphNode = {
    kind: 'graph',
    id: newNodeId(),
    name: 'g',
    frame: 'category',
    look: 'column.scatter',
    layers: [{ id: 'points', geom: 'points', stat: { kind: 'identity' } }, ...layers(analysis.id)],
    seriesSource: { table: table.id, include: 'all' },
    seriesOverrides: {},
    size: { plotWidth: 100, plotHeight: 100 },
    axes: {
      x: { type: 'categorical', title: null, labels: 'dataSetTitles', rotation: 0 },
      y: {
        type: 'continuous',
        title: null,
        scale: 'linear',
        range: 'auto',
        ticks: 'auto',
        format: { mode: 'auto' },
        frame: 'plain',
        breaks: [],
      },
    },
    annotations: [],
    legend: { show: false, position: 'right' },
    title: null,
    style: {},
  }
  return {
    ...p,
    nodes: { [table.id]: table, [analysis.id]: analysis, [graph.id]: graph },
    order: [table.id, analysis.id, graph.id],
  }
}

const graphOf = (p: Project) => Object.values(p.nodes).find((n) => n.kind === 'graph') as GraphNode
const dfRow = (l: Layer | undefined) =>
  l?.stat?.kind === 'result' && l.stat.fields.df?.ref.from === 'cell'
    ? l.stat.fields.df.ref.row
    : undefined

describe('repairs on reading a document', () => {
  it('points the paired t test label’s df at the df row (audit 2, decision 680)', () => {
    const doc = projectWith('ttest', (a) => [
      tdfLayer('tdf', 'Number of pairs', { from: 'analysis', analysis: a }),
      // A layer drawing the same data as another layer (`from: 'layer'`) is repaired too.
      tdfLayer('again', 'Number of pairs', { from: 'layer', layer: 'tdf' }),
    ])
    const read = parseProject(JSON.parse(JSON.stringify(doc)))
    const layers = graphOf(read).layers
    expect(dfRow(layers[1])).toBe('df')
    expect(dfRow(layers[2])).toBe('df')
    // Everything else as it was.
    const before = graphOf(doc).layers[1]!
    expect(layers[1]!.stat).toEqual({
      ...before.stat,
      fields: {
        ...(before.stat as { fields: object }).fields,
        df: { ref: { from: 'cell', sheet: 'results', row: 'df' } },
      },
    })
  })

  it('leaves other analyses, fields and documents as they are', () => {
    // Another analysis whose sheet has a 'Number of pairs' row.
    const other = projectWith('wilcoxon', (a) => [
      tdfLayer('tdf', 'Number of pairs', { from: 'analysis', analysis: a }),
    ])
    expect(dfRow(graphOf(parseProject(other)).layers[1])).toBe('Number of pairs')
    // The row read by another field name, or in a named block: not the ready label's df.
    const named = projectWith('ttest', (a) => {
      const l = tdfLayer('tdf', 'df', { from: 'analysis', analysis: a })
      if (l.stat?.kind === 'result')
        l.stat.fields.n = { ref: { from: 'cell', sheet: 'results', row: 'Number of pairs' } }
      return [l]
    })
    const read = graphOf(parseProject(named)).layers[1]!
    expect(read.stat?.kind === 'result' && read.stat.fields.n?.ref).toMatchObject({
      row: 'Number of pairs',
    })
    // Nothing to repair: the document's own nodes.
    const fine = projectWith('ttest', (a) => [
      tdfLayer('tdf', 'df', { from: 'analysis', analysis: a }),
    ])
    const parsed = parseProject(fine)
    expect(dfRow(graphOf(parsed).layers[1])).toBe('df')
  })
})
