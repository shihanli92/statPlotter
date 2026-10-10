import {
  type AnalysisResult,
  GraphNode,
  graphOutputs,
  type NodeId,
  type OutputDecl,
  TableKind,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  bracketsFromAnalysis,
  createGraphFor,
  defaultPresetFor,
  layoutGraph,
  matchGraphFormat,
  outputGraphsFor,
  presetGraph,
  presetsFor,
  sliceGraphs,
  withOutputSeries,
} from '../src/index.ts'
import { fonts, projectOf, sampleTable, sampleVariables } from './helpers.ts'

// New graphs (roadmap 33c): a preset's frame and layers on its frame's scaffold, drawn layer by
// layer (presets.test.ts compares them with what roadmap 33b's compiled presets made).

describe('graph creators', () => {
  it('make valid graphs, drawn layer by layer, for every preset of every table kind', () => {
    for (const kind of TableKind.options) {
      for (const p of presetsFor(kind)) {
        // A dot plot (roadmap 34g) groups by a text variable: a table with some.
        const table = p.id === 'dotPlot' ? sampleVariables() : sampleTable(kind)
        const g = presetGraph(table, p.id)
        expect(GraphNode.safeParse(g).success, `${kind} ${p.id}`).toBe(true)
        expect(g.drawOrder).toBeUndefined()
        expect(g.preset).toBe(p.id)
        expect(layoutGraph({ project: projectOf(table, g), graph: g, fonts }).warnings).toEqual([])
      }
      const table = sampleTable(kind)
      expect(createGraphFor(table).preset).toBe(defaultPresetFor(table))
    }
  })

  it('a preset applied to a graph changes its layers; what is the graph’s own stays', () => {
    const table = sampleTable('grouped')
    const bars = presetGraph(table, 'barsPoints')
    expect(bars.layers.map((l) => [l.id, l.geom, l.stat.kind])).toEqual([
      ['bars', 'bar', 'summary'],
      ['points', 'points', 'identity'],
      ['error', 'errorbar', 'summary'],
    ])
    expect(presetGraph(table, 'heatmap').frame).toBe('matrix')
    const g = {
      ...createGraphFor(table),
      drawOrder: 'layer' as const,
      notes: 'mine',
      seriesOverrides: { a: { color: { palette: 4 } } },
    }
    const stacked = applyPreset(g, 'stacked', table)
    expect(stacked.layers.find((l) => l.id === 'bars')?.position).toEqual({ kind: 'stack' })
    expect(stacked).toMatchObject({ drawOrder: 'layer', notes: 'mine' })
    expect(stacked.seriesOverrides).toEqual({ a: { color: { palette: 4 } } })
    const box = applyPreset(g, 'box', table)
    expect(box.look).toBe('grouped.box')
    expect(box.layers.map((l) => l.geom)).toEqual(['box'])
  })

  it('outputs of an analysis join the graph’s output layers; graphs of their own are made', () => {
    const table = sampleTable('xy')
    const decls: OutputDecl[] = [
      { key: 'curve:a', forDataSet: 'a' },
      { key: 'resid', graph: { id: 'r', name: 'Residuals' }, mark: 'points' },
    ]
    const g = createGraphFor(table)
    const { graph, edits } = withOutputSeries(g, 'fit' as NodeId, decls)
    expect(graphOutputs(graph).map((o) => o.series.ref.key)).toEqual(['curve:a'])
    expect(graph.layers.slice(0, 2).map((l) => l.id)).toEqual(['curves', 'curveBands'])
    expect(edits.length).toBeGreaterThan(0)
    // Already there: nothing to add.
    expect(withOutputSeries(graph, 'fit' as NodeId, decls)).toEqual({ graph, edits: [] })
    const [own] = outputGraphsFor(table, 'fit' as NodeId, decls)
    expect(own!.seriesSource.include).toEqual([])
    expect(own!.layers.slice(0, 3).map((l) => l.id)).toEqual([
      'curves',
      'curveBands',
      'curvePoints',
    ])
    expect(GraphNode.safeParse(own).success).toBe(true)
  })

  it('brackets go between cells on grouped frames, between data sets otherwise', () => {
    const result = {
      comparisons: [
        { key: 'a|b', a: { node: 't1', key: 'a' }, b: { node: 't1', key: 'b' }, p: 0.01 },
        {
          key: 'row1:a|b',
          a: { node: 't1', key: 'a' },
          b: { node: 't1', key: 'b' },
          rowA: 1,
          p: 0.02,
        },
      ],
    } as unknown as AnalysisResult
    const column = createGraphFor(sampleTable('column'))
    const grouped = createGraphFor(sampleTable('grouped'))
    const keys = (g: GraphNode) =>
      bracketsFromAnalysis(g, 'an' as NodeId, result).map((b) =>
        b.type === 'bracket' && b.label.source === 'analysis' ? b.label.comparison : '',
      )
    expect(keys(column)).toEqual(['a|b'])
    expect(keys(grouped)).toEqual(['row1:a|b'])
  })

  it('small multiples and Magic work on layers', () => {
    const table = sampleTable('grouped')
    const g = createGraphFor(table)
    const slices = sliceGraphs(table, 'row', g)
    expect(slices).toHaveLength(3)
    for (const s of slices) {
      expect(s.drawOrder).toBeUndefined()
      expect(s.id).not.toBe(g.id)
      expect(GraphNode.safeParse(s).success).toBe(true)
    }
    const source = presetGraph(table, 'connected')
    const matched = matchGraphFormat(projectOf(table, g, source), g, source)
    expect(matched.layers.map((l) => l.id)).toEqual(source.layers.map((l) => l.id))
    expect(matched.id).toBe(g.id)
  })
})
