import { DocumentStore, DraftStore } from '@ps/engine'
import { createGraphFor, layoutGraph, seriesOnRight } from '@ps/graph'
import { createTable, type GraphNode } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { flatten, fonts, projectOf } from '../../graph/test/helpers.ts'
import {
  axisPlace,
  describeTarget,
  formatTargetFor,
  graphPlace,
  highlightOf,
  tabsFor,
} from '../src/graph/format/route.ts'
import {
  addRightAxisCommands,
  removeRightAxisCommands,
  setAxisCommands,
} from '../src/graph/inspector/yAxis.ts'
import { selectionKey } from '../src/graph/SceneSvg.tsx'

function setup(kind: 'xy' | 'column' = 'xy') {
  const table = createTable({ tableKind: kind, columns: 2, rows: 3 })
  if (kind === 'xy') table.x!.subcolumns[0]!.values = [1, 2, 3]
  table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3]
  table.dataSets[1]!.subcolumns[0]!.values = [100, 200, 300]
  const graph = createGraphFor(table)
  const project = projectOf(table, graph)
  const [a, b] = table.dataSets.map((d) => d.id as string) as [string, string]
  return { project, graph, a, b }
}

describe('right Y axis in the Format dialogs', () => {
  it('moving a data set to the right adds the axis; one OK is one undo step', () => {
    const { project, graph, b } = setup()
    const store = new DocumentStore(project)
    const draft = new DraftStore(store)
    draft.dispatch(setAxisCommands(graph, b, 'right'), 'Plot on right Y axis')
    const g = draft.getState().nodes[graph.id] as GraphNode
    expect(g.axes.y2).toBeDefined()
    expect(seriesOnRight(g, b)).toBe(true)
    // The live document hasn't changed until OK.
    expect((store.getState().nodes[graph.id] as GraphNode).axes.y2).toBeUndefined()
    expect(draft.commit('Format graph')).toBe(true)
    expect(store.undoLabel).toBe('Format graph')
    expect(seriesOnRight(store.getState().nodes[graph.id] as GraphNode, b)).toBe(true)
    store.undo()
    expect((store.getState().nodes[graph.id] as GraphNode).axes.y2).toBeUndefined()
  })

  it('an existing right axis is kept when another data set moves to it', () => {
    const { graph, a } = setup()
    const g = { ...graph, axes: { ...graph.axes, y2: { ...graph.axes.y, type: 'continuous' } } }
    const cmds = setAxisCommands(g as GraphNode, a, 'right')
    expect(cmds.map((c) => c.type === 'node.set' && c.path.join('.'))).toEqual([
      `seriesOverrides.${a}.yAxis`,
    ])
    // Back to the left clears the choice (left is the default).
    expect(setAxisCommands(g as GraphNode, a, 'left')).toMatchObject([
      { path: ['seriesOverrides', a, 'yAxis'], value: undefined },
    ])
  })

  it('removing the right axis brings every data set back to the left', () => {
    const { project, graph, b } = setup()
    const store = new DocumentStore(project)
    store.dispatch(setAxisCommands(graph, b, 'right'))
    const g = store.getState().nodes[graph.id] as GraphNode
    store.dispatch(removeRightAxisCommands(g))
    const after = store.getState().nodes[graph.id] as GraphNode
    expect(after.axes.y2).toBeUndefined()
    expect(after.seriesOverrides[b]?.yAxis).toBeUndefined()
    expect(addRightAxisCommands(after)).toHaveLength(1)
  })

  it('graphs without a right axis option get none', () => {
    const { graph, b } = setup('column')
    expect(addRightAxisCommands(graph)).toEqual([])
    expect(setAxisCommands(graph, b, 'right')).toEqual([])
  })

  it('shows a Right Y axis tab when the graph has one; clicking it opens that axis', () => {
    const { project, graph, b } = setup()
    expect(tabsFor(axisPlace('x'), graph).map((t) => t.id)).toEqual(['x', 'y'])
    const store = new DocumentStore(project)
    store.dispatch(setAxisCommands(graph, b, 'right'))
    const g = store.getState().nodes[graph.id] as GraphNode
    expect(tabsFor(axisPlace('x'), g).map((t) => t.label)).toEqual([
      'X axis',
      'Left Y axis',
      'Right Y axis',
    ])
    const scene = layoutGraph({ project: store.getState(), graph: g, fonts })
    const tick = flatten(scene.root).find((n) => n.id === 'axis/y2/tickLabel/0')!
    const target = formatTargetFor(selectionKey(tick.target!), g)
    expect(target).toEqual(axisPlace('y2'))
    expect(highlightOf(target)).toEqual(['axes', 'y2'])
    expect(describeTarget(target, g)).toBe('right Y axis')
    expect(formatTargetFor(['axes', 'y2', 'title'], g)).toEqual(axisPlace('y2', 'title'))
    // Without a right axis a stale target falls back to the graph's frame.
    expect(formatTargetFor(['axes', 'y2'], graph)).toEqual(graphPlace('frame'))
  })
})
