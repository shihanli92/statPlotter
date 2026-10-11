import { DocumentStore } from '@ps/engine'
import { frontFirst, layoutGraph, presetGraph, rowToIndex } from '@ps/graph'
import { createTable, type GraphNode, type Layer } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { flatten, fonts, projectOf } from '../../graph/test/helpers.ts'
import {
  clickSelection,
  describeTarget,
  formatTargetFor,
  pointPlace,
  selectionText,
  singleMarkName,
} from '../src/graph/format/route.ts'
import type { PanelContext } from '../src/graph/inspector/context.ts'
import { addStyleCommands } from '../src/graph/inspector/LayersSection.tsx'
import { moveLayersCommands, moveLayersToCommands } from '../src/graph/inspector/layers.ts'
import { selectionKey, selectionMatcher } from '../src/graph/SceneSvg.tsx'

function setup(preset = 'bars') {
  const table = createTable({
    tableKind: 'grouped',
    columns: 2,
    rows: 3,
    yFormat: { type: 'replicates', count: 2 },
  })
  table.dataSets.forEach((d, i) => {
    d.subcolumns.forEach((c, k) => {
      c.values = [1 + i + k, 3 + i + k, 5 + i + k]
    })
  })
  const graph = presetGraph(table, preset)
  const project = projectOf(table, graph)
  return { project, graph, ds: table.dataSets[0]!.id as string, table }
}

describe('selecting and formatting one bar', () => {
  it('first click the bars of the data set, then the bar; it opens “this bar” in Appearance', () => {
    const { project, graph, ds } = setup()
    const scene = layoutGraph({ project, graph, fonts })
    const bar = flatten(scene.root).find((n) => n.id === `series/${ds}/bar/1`)!
    const hit = selectionKey(bar.target!)
    const first = clickSelection(hit, bar.point, null)
    expect(first).toEqual(['layers', 'bars', 'series', ds])
    const second = clickSelection(hit, bar.point, first)
    expect(second).toEqual(['pointOverrides', ds, 'r1'])
    const target = formatTargetFor(second, graph, 'bars')
    expect(target).toEqual(pointPlace(ds, 'r1', 'bars'))
    expect(describeTarget(target, graph)).toBe('bar')
    // The halo covers that cell's bar and error bar, not the other bars.
    const match = selectionMatcher(second!)
    const covered = flatten(scene.root).filter((n) => n.prim && match(n.target, n))
    expect(covered.map((n) => n.id).sort()).toEqual(
      [`series/${ds}/bar/1`, ...[0, 1].map((k) => `series/${ds}/error/1/${k}`)].sort(),
    )
  })

  it('the selection hint names the layer of the marks selected', () => {
    const { graph, ds } = setup()
    const hint = (t: Parameters<typeof formatTargetFor>[0]) =>
      selectionText(formatTargetFor(t, graph)!, t!, graph)
    expect(hint(['layers', 'bars', 'series', ds])).toBe('Data set selected in “Bars (mean)”')
    expect(hint(['layers', 'error'])).toBe('Layer “Error bars (SD)” selected')
    expect(hint(['pointOverrides', ds, 'r1'])).toBe('Bar selected')
    expect(hint(['axes', 'y', 'tickLabels'])).toBe('Y axis tick labels selected')
  })

  it('names single marks by graph type', () => {
    const { graph } = setup('box')
    expect(singleMarkName(graph, 'r0')).toBe('box')
    expect(singleMarkName(graph, 'r0s1')).toBe('data point')
    expect(singleMarkName(setup('points').graph, 'r0')).toBe('data point')
  })

  it('bar formats move with their row when rows are inserted', () => {
    const { project, graph, ds, table } = setup()
    const store = new DocumentStore(project)
    store.dispatch({
      type: 'node.set',
      id: graph.id,
      path: ['pointOverrides', ds, 'r1', 'bar', 'fill'],
      value: { type: 'none' },
    })
    store.dispatch({ type: 'table.insertRows', table: table.id, at: 0, count: 1 })
    const g = store.getState().nodes[graph.id] as GraphNode
    expect(Object.keys(g.pointOverrides?.[ds as never] ?? {})).toEqual(['r2'])
  })
})

describe('moving layers', () => {
  it('moves a layer a step; attached layers stay in front of their host', () => {
    const { graph } = setup('barsPoints')
    const ids = (g: GraphNode, cmds: ReturnType<typeof moveLayersCommands>) => {
      const order = g.layers.map((l) => l.id)
      for (const c of cmds)
        if (c.type === 'graph.moveLayer') {
          order.splice(order.indexOf(c.layer), 1)
          order.splice(c.to, 0, c.layer)
        }
      return order
    }
    expect(graph.layers.map((l) => l.id)).toEqual(['bars', 'points', 'error'])
    // Points to the back: behind the bars.
    expect(ids(graph, moveLayersCommands(graph, ['points'], -1))).toEqual([
      'points',
      'bars',
      'error',
    ])
    // Bars forward: past the points, their error bars still in front of them.
    expect(ids(graph, moveLayersCommands(graph, ['bars'], 1))).toEqual(['points', 'bars', 'error'])
    // Error bars can't go behind their bars.
    expect(ids(graph, moveLayersCommands(graph, ['error'], -1))).toEqual([
      'bars',
      'error',
      'points',
    ])
    expect(moveLayersCommands(graph, ['error'], 1)).toEqual([])
    // Bars back (down the list): their error bars, just in front of them, go along.
    const front = { ...graph, layers: [1, 0, 2].map((i) => graph.layers[i]!) }
    expect(ids(front, moveLayersCommands(front, ['bars'], -1))).toEqual(['bars', 'error', 'points'])
  })

  it('drags a row: the document place of the row it lands on (the list shows the front first)', () => {
    const { graph } = setup('barsPoints')
    const order = (cmds: ReturnType<typeof moveLayersToCommands>) => {
      const out = graph.layers.map((l) => l.id)
      for (const c of cmds)
        if (c.type === 'graph.moveLayer') {
          out.splice(out.indexOf(c.layer), 1)
          out.splice(c.to, 0, c.layer)
        }
      return out
    }
    const rows = frontFirst(graph.layers).map((l) => l.id)
    expect(rows).toEqual(['error', 'points', 'bars'])
    // Points dropped on the top row (the front): in front of the error bars.
    expect(order(moveLayersToCommands(graph, ['points'], 'points', rowToIndex(3, 0)))).toEqual([
      'bars',
      'error',
      'points',
    ])
    // Points dropped on the bottom row (the back): behind the bars.
    expect(order(moveLayersToCommands(graph, ['points'], 'points', rowToIndex(3, 2)))).toEqual([
      'points',
      'bars',
      'error',
    ])
  })

  it('adds a mark on top, a fill behind the marks, error bars in front of their host', () => {
    const { project, graph } = setup('points')
    const ctx = {
      graph,
      project,
      lookup: () => undefined,
      dispatch: () => {},
    } as unknown as PanelContext
    // Bars (a fill) behind the points already there.
    const [bars] = addStyleCommands(ctx, 'bars')
    expect(graph.layers[0]?.geom).toBe('points')
    expect(bars).toMatchObject({ type: 'graph.addLayer', at: 0 })
    const withBars = {
      ...graph,
      layers: [(bars as { layer: Layer }).layer, ...graph.layers],
    } as GraphNode
    const n = withBars.layers.length
    // A line (a mark) on top.
    expect(addStyleCommands({ ...ctx, graph: withBars }, 'joinMeans')[0]).toMatchObject({ at: n })
    // Error bars just in front of their bars.
    const error = addStyleCommands({ ...ctx, graph: withBars }, 'error')[0]
    expect(error).toMatchObject({ at: 1, layer: { on: 'bars' } })
    // Bars in front: their error bars go just in front of them, on top.
    const front = { ...withBars, layers: [...graph.layers, withBars.layers[0]!] }
    expect(addStyleCommands({ ...ctx, graph: front }, 'error')[0]).toMatchObject({ at: n })
  })
})
