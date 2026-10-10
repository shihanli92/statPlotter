import { DocumentStore, DraftStore } from '@ps/engine'
import { createGraphFor, layoutGraph, type SceneNode, type StylePath } from '@ps/graph'
import { createTable, type GraphNode } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import {
  clickSelection,
  describeTarget,
  dialogTitle,
  formatTargetFor,
  highlightOf,
  seriesPlace,
} from '../src/graph/format/route.ts'
import { describePoint } from '../src/graph/inspector/PointPanel.tsx'
import { selectionMatcher } from '../src/graph/SceneSvg.tsx'
import { stepOut } from '../src/selection/graphSelection.ts'
import { EMPTY_SELECTION, elementKey, primaryPath, single } from '../src/selection/selection.ts'

function setup() {
  const table = createTable({ tableKind: 'column', columns: 2, rows: 3 })
  table.dataSets[0]!.subcolumns[0]!.values = [1, 4, 9]
  table.dataSets[1]!.subcolumns[0]!.values = [2, 3, 5]
  const base = createGraphFor(table)
  const graph: GraphNode = { ...base, legend: { ...base.legend, show: true } }
  const project = projectOf(table, graph)
  return { project, table, graph, keys: table.dataSets.map((d) => d.id as string) }
}

/** Every scene node that draws something, with the style target it (or an ancestor) carries. */
function drawn(root: SceneNode): { node: SceneNode; target: StylePath | undefined }[] {
  const out: { node: SceneNode; target: StylePath | undefined }[] = []
  const walk = (n: SceneNode, inherited?: StylePath) => {
    const target = n.target ?? inherited
    if (n.prim) out.push({ node: n, target })
    for (const c of n.children ?? []) walk(c, target)
  }
  walk(root)
  return out
}

describe('selecting a single point', () => {
  it('first click selects the layer’s marks of the data set; a second one the point', () => {
    const series = ['layers', 'points', 'series', 'A']
    // Nothing selected, or another data set, or another layer of it: the layer's data set.
    expect(clickSelection(series, 'r2s0', null)).toEqual(series)
    expect(clickSelection(series, 'r2s0', ['layers', 'points', 'series', 'B'])).toEqual(series)
    expect(clickSelection(series, 'r2s0', ['layers', 'bars', 'series', 'A'])).toEqual(series)
    expect(clickSelection(series, 'r2s0', ['seriesOverrides', 'A'])).toEqual(series)
    // Alt-click: the whole layer, across data sets.
    expect(clickSelection(series, 'r2s0', null, 1, true)).toEqual(['layers', 'points'])
    // The layer's data set selected (or another of its points): the point.
    expect(clickSelection(series, 'r2s0', series)).toEqual(['pointOverrides', 'A', 'r2s0'])
    expect(clickSelection(series, 'r1s0', ['pointOverrides', 'A', 'r2s0'])).toEqual([
      'pointOverrides',
      'A',
      'r1s0',
    ])
    // The second click of a double-click doesn't drill down: double-clicking a point formats its
    // data set, even when that point was selected (roadmap 44, decision 856; a single point is
    // formatted with Enter once selected, or from its context menu).
    expect(clickSelection(series, 'r2s0', series, 2)).toEqual(series)
    expect(clickSelection(series, 'r2s0', ['pointOverrides', 'A', 'r2s0'], 2)).toEqual(series)
    // Marks that aren't single points (lines) select the layer's data set.
    expect(clickSelection(series, undefined, series)).toEqual(series)
    expect(clickSelection(['axes', 'y'], undefined, series)).toEqual(['axes', 'y'])
    // Escape steps back: point → the layer's data set it was picked in → nothing.
    const G = 'g1' as never
    const stepOutOf = (path: StylePath, from?: StylePath) =>
      primaryPath(stepOut(single(elementKey(G, path), from), G))
    expect(stepOutOf(['pointOverrides', 'A', 'r2s0'], series)).toEqual(series)
    expect(stepOutOf(['pointOverrides', 'A', 'r2s0'])).toEqual(['seriesOverrides', 'A'])
    expect(stepOut(single(elementKey(G, series)), G)).toEqual(EMPTY_SELECTION)
    expect(stepOut(single(elementKey(G, ['layers', 'points'])), G)).toEqual(EMPTY_SELECTION)
  })

  it('a selected point opens Format graph › Appearance scoped to that point', () => {
    const { graph, keys, project, table } = setup()
    const t = formatTargetFor(['pointOverrides', keys[0]!, 'r1s0'], graph, 'points')
    expect(t).toEqual(seriesPlace({ dataSet: keys[0]!, point: 'r1s0' }, 'points'))
    expect(highlightOf(t)).toEqual(['pointOverrides', keys[0], 'r1s0'])
    expect(describeTarget(t, graph)).toBe('data point')
    expect(dialogTitle(t, graph)).toBe('Format graph')
    const title = table.dataSets[0]!.title
    expect(describePoint(project, graph, keys[0]!, 'r1s0')).toBe(`${title} · row 2`)
    expect(describePoint(project, graph, keys[0]!, 'r1')).toBe(`${title} · row 2 · mean of the row`)
  })

  it('the selection halo covers a layer’s marks of a data set, its identity, or one point', () => {
    const { project, graph, keys } = setup()
    const scene = layoutGraph({ project, graph, fonts })
    const all = drawn(scene.root)
    const covered = (sel: StylePath) => {
      const m = selectionMatcher(sel)
      return all.filter((d) => m(d.target, d.node)).map((d) => d.node.id)
    }
    const ds = covered(['seriesOverrides', keys[0]!])
    expect(ds.some((id) => id.startsWith('legend/'))).toBe(true)
    expect(ds.filter((id) => id.includes('/point/'))).toHaveLength(3)
    expect(ds.some((id) => id.includes(keys[1]!))).toBe(false)
    expect(covered(['pointOverrides', keys[0]!, 'r1s0'])).toEqual([`series/${keys[0]}/point/1`])
    // A layer's marks of one data set: only those (not its error bars, centre or legend entry).
    const points = covered(['layers', 'points', 'series', keys[0]!])
    expect(points).toHaveLength(3)
    expect(points.every((id) => id.includes('/point/'))).toBe(true)
    // The whole layer: every data set's points.
    expect(covered(['layers', 'points'])).toHaveLength(6)
  })
})

describe('formatting a single point in the dialog', () => {
  it('is one undo step on OK; nothing reaches the document before', () => {
    const { project, graph, keys } = setup()
    const store = new DocumentStore(project)
    const before = store.getState()
    const draft = new DraftStore(store)
    const p = ['pointOverrides', keys[0]!, 'r1s0']
    draft.dispatch({ type: 'node.set', id: graph.id, path: [...p, 'shape'], value: 'square' })
    draft.dispatch({ type: 'node.set', id: graph.id, path: [...p, 'size'], value: 10 })
    draft.dispatch({ type: 'node.set', id: graph.id, path: [...p, 'label'], value: 'x' })
    expect(store.getState()).toBe(before)
    expect(draft.commit('Format graph')).toBe(true)
    const g = store.getState().nodes[graph.id] as GraphNode
    expect(g.pointOverrides?.[keys[0]! as never]).toEqual({
      r1s0: { shape: 'square', size: 10, label: 'x' },
    })
    expect(store.undoLabel).toBe('Format graph')
    store.undo()
    expect((store.getState().nodes[graph.id] as GraphNode).pointOverrides).toBeUndefined()
  })

  it('"Reset to the data set’s style" drops the point’s entry', () => {
    const { project, graph, keys } = setup()
    const store = new DocumentStore(project)
    const p = ['pointOverrides', keys[0]!, 'r1s0']
    store.dispatch({ type: 'node.set', id: graph.id, path: [...p, 'size'], value: 10 })
    const draft = new DraftStore(store)
    draft.dispatch({ type: 'node.set', id: graph.id, path: p, value: undefined })
    draft.commit('Format graph')
    expect((store.getState().nodes[graph.id] as GraphNode).pointOverrides).toEqual({
      [keys[0]!]: {},
    })
  })
})
