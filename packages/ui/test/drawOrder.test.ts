import { DocumentStore } from '@ps/engine'
import { layoutGraph, presetGraph } from '@ps/graph'
import { createProject, type GraphNode } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { byId, fonts } from '../../graph/test/helpers.ts'
import { sampleTable } from '../src/samples.ts'

// Drawing order (roadmap 33b): new graphs draw layer by layer; Format graph › Appearance ›
// Drawing order switches a graph to data set by data set, where each data set's own order counts.

describe('drawing order', () => {
  it('new graphs draw layer by layer; switched, data set by data set in each one’s order', () => {
    const table = sampleTable('column', 'Data')
    const graph = presetGraph(table, 'barsPoints')
    const store = new DocumentStore(createProject())
    store.dispatch([
      { type: 'node.add', node: table },
      { type: 'node.add', node: graph },
    ])
    const g = () => store.getState().nodes[graph.id] as GraphNode
    const groups = () =>
      byId(layoutGraph({ project: store.getState(), graph: g(), fonts }), 'series')!.children!.map(
        (c) => c.id,
      )
    expect(g().drawOrder).toBeUndefined()
    expect(groups()).toEqual(['layer/bars', 'layer/points', 'layer/error'])

    store.dispatch({ type: 'node.set', id: graph.id, path: ['drawOrder'], value: 'series' })
    const [a, b] = table.dataSets.map((d) => d.id as string)
    expect(groups()).toEqual([`series/${a}`, `series/${b}`])
    // One data set's points behind its bars (its own order, front to back).
    store.dispatch({
      type: 'node.set',
      id: graph.id,
      path: ['seriesOverrides', a!, 'order'],
      value: ['error', 'bars', 'points'],
    })
    expect(g().seriesOverrides[a!]).toEqual({ order: ['error', 'bars', 'points'] })
    const own = byId(layoutGraph({ project: store.getState(), graph: g(), fonts }), `series/${a}`)
    expect(own!.children!.map((c) => c.layer)).toEqual(
      expect.arrayContaining(['points', 'bars', 'error']),
    )
    expect(g().layers.map((l) => l.id)).toEqual(['bars', 'points', 'error'])
    store.undo()
    store.undo()
    expect(g()).toEqual(graph)
  })
})
