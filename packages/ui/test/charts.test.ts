import { DocumentStore, DraftStore } from '@ps/engine'
import { applyPreset, createGraphFor, layoutGraph, presetGraph } from '@ps/graph'
import { createProject, createTable, type GraphNode, parseProject } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { flatten, fonts, projectOf } from '../../graph/test/helpers.ts'
import { defaultPresetFor } from '../src/graph/builder/GraphBuilder.tsx'
import {
  describeTarget,
  formatTargetFor,
  graphPlace,
  highlightOf,
  seriesPlace,
  singleMarkName,
} from '../src/graph/format/route.ts'
import { layerPath, statCommands, styleCommands } from '../src/graph/inspector/layers.ts'
import { plotFunctionNodes } from '../src/graph/plotFunction.ts'
import { sampleTable } from '../src/samples.ts'

// The chart types of roadmap item 17 in the UI: routing clicks to Format dialogs, defaults of
// new graphs and draft edits validated by the store (examples.test.ts checks the examples that
// show them).

describe('format routing for the new charts', () => {
  const table = createTable({ tableKind: 'partsOfWhole', columns: 1, rows: 3 })
  const pie = createGraphFor(table)
  const { graph: withFn, fn } = plotFunctionNodes(createProject())

  it('functions open Appearance on that function; chart layers their layer', () => {
    const t = formatTargetFor(['layers', 'functions', 'series', fn], withFn)
    expect(t).toEqual(seriesPlace({ fn }, 'functions'))
    expect(highlightOf(t)).toEqual(['layers', 'functions', 'series', fn])
    expect(describeTarget(t, withFn)).toBe('function')
    expect(formatTargetFor(['layers', 'nothing'], withFn)).toEqual(graphPlace())
    expect(formatTargetFor(['layers', 'labels'], pie)).toEqual(seriesPlace({ all: true }, 'labels'))
  })

  it('names single marks: slices, bubbles', () => {
    expect(singleMarkName(pie, 'r1')).toBe('slice')
    expect(describeTarget(seriesPlace({ dataSet: 'x', point: 'r1' }), pie)).toBe('slice')
    const multi = createTable({ tableKind: 'multipleVariables', columns: 2 })
    expect(singleMarkName(presetGraph(multi, 'bubble'), 'r0')).toBe('bubble')
    expect(singleMarkName(withFn, 'r0')).toBe('data point')
  })
})

describe('new graphs and drafts', () => {
  it('a frequency distribution graphs as a histogram by default', () => {
    expect(
      defaultPresetFor({
        kind: 'analysis',
        analysisId: 'frequencyDistribution',
      } as never),
    ).toBe('histogram')
    expect(defaultPresetFor(undefined)).toBeUndefined()
  })

  it('Plot a function makes a valid table and graph with the curve drawn', () => {
    const { table, graph } = plotFunctionNodes(createProject())
    const project = projectOf(table, graph)
    expect(() => parseProject(JSON.parse(JSON.stringify(project)))).not.toThrow()
    const scene = layoutGraph({ project, graph, fonts })
    expect(scene.warnings).toEqual([])
    expect(flatten(scene.root).some((n) => n.id.startsWith('function/0/'))).toBe(true)
  })

  it('draft edits of the new options validate (function parameters, violins, labels, pies)', () => {
    const { table, graph, fn } = plotFunctionNodes(createProject())
    const col = sampleTable('column', 'Data')
    const colGraph = presetGraph(col, 'violin')
    const whole = sampleTable('partsOfWhole', 'Parts')
    const pie = createGraphFor(whole)
    const store = new DocumentStore(projectOf(table, graph, col, colGraph, whole, pie))
    const draft = new DraftStore(store)
    draft.dispatch({
      type: 'node.set',
      id: graph.id,
      path: layerPath('functions', 'data', 'functions', { id: fn }, 'params', 'HillSlope'),
      value: 2,
    })
    const violin = colGraph.layers.find((l) => l.id === 'violin')!
    draft.dispatch(
      statCommands(colGraph, violin, null, {
        ...(violin.stat as object),
        extent: 'extended',
      } as never),
    )
    draft.dispatch({
      type: 'graph.addLayer',
      id: colGraph.id,
      layer: { id: 'labels', geom: 'label', stat: { kind: 'summary', center: 'mean' } },
    })
    draft.dispatch(
      styleCommands(
        draft.getState().nodes[colGraph.id] as GraphNode,
        { id: 'labels', geom: 'label', stat: { kind: 'summary', center: 'mean' } },
        null,
        [['value', 'n']],
      ),
    )
    draft.dispatch([
      { type: 'node.set', id: pie.id, path: ['style', 'polar', 'hole'], value: 0.4 },
      {
        type: 'node.set',
        id: pie.id,
        path: ['pointOverrides', whole.dataSets[0]!.id, 'r0', 'explode'],
        value: 0.2,
      },
    ])
    expect(() =>
      draft.dispatch({ type: 'node.set', id: pie.id, path: ['style', 'polar', 'hole'], value: 2 }),
    ).toThrow()
    draft.commit('Format graph')
    const g = store.getState().nodes[graph.id] as GraphNode
    const fns = g.layers.find((l) => l.id === 'functions')!.data
    expect(fns?.from === 'functions' && fns.functions[0]!.params.HillSlope).toBe(2)
    const c = store.getState().nodes[colGraph.id] as GraphNode
    // In the document: a violin layer, its extent the density's, and labels of n.
    expect(c.layers.find((l) => l.id === 'violin')?.stat).toMatchObject({ extent: 'extended' })
    expect(c.layers.find((l) => l.id === 'labels')?.style).toMatchObject({ value: 'n' })
    const p = store.getState().nodes[pie.id] as GraphNode
    expect(p.style.polar?.hole).toBe(0.4)
  })

  it('switching a multiple-variables graph to a bubble plot and back', () => {
    const table = sampleTable('multipleVariables', 'Cohort')
    const g = createGraphFor(table)
    const bubble = applyPreset(g, 'bubble', table)
    const project = projectOf(table, bubble)
    const scene = layoutGraph({ project, graph: bubble, fonts })
    expect(scene.warnings).toEqual([])
    expect(bubble.layers.find((l) => l.aes)?.aes?.x).toBe(table.dataSets[0]!.id)
    const back = applyPreset(bubble, 'points', table)
    expect(back.frame).toBe('category')
    expect(back.axes.x.type).toBe('categorical')
  })
})
