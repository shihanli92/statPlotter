import {
  type AnalysisNode,
  createProject,
  createTable,
  type GraphNode,
  type GraphPathSegment,
  type NodeId,
  newNodeId,
  type Project,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { CommandError, DocumentStore, DraftStore } from '../src/index.ts'
import { POINTS } from './graphs.ts'

function setup() {
  const table = createTable({ rows: 3, columns: 2 })
  const graph: GraphNode = {
    kind: 'graph',
    id: newNodeId(),
    name: 'g',
    frame: 'category',
    look: 'column.scatter',
    layers: [POINTS],
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
  const store = new DocumentStore(createProject('T', new Date('2026-01-01T00:00:00Z')))
  store.dispatch({ type: 'node.add', node: table })
  store.dispatch({ type: 'node.add', node: graph })
  const g = (s: { getState(): Project }) => s.getState().nodes[graph.id] as GraphNode
  return { store, graph, table, g }
}

const set = (id: NodeId, path: GraphPathSegment[], value: unknown) =>
  ({ type: 'node.set', id, path, value }) as const

describe('DraftStore', () => {
  it('edits a copy; the document and its listeners see nothing until commit', () => {
    const { store, graph, g } = setup()
    const before = store.getState()
    let heard = 0
    store.subscribe(() => heard++)
    const draft = new DraftStore(store)
    draft.dispatch(set(graph.id, ['size', 'plotWidth'], 200))
    draft.dispatch(set(graph.id, ['legend', 'show'], true))
    expect(g(draft).size.plotWidth).toBe(200)
    expect(store.getState()).toBe(before)
    expect(heard).toBe(0)
    expect(draft.changed).toBe(true)
  })

  it('commits every change as one undo step with the given label', () => {
    const { store, graph, g } = setup()
    const undoBefore = store.undoLabel
    const draft = new DraftStore(store)
    draft.dispatch(set(graph.id, ['size', 'plotWidth'], 200))
    draft.dispatch(set(graph.id, ['axes', 'y', 'reverse'], true))
    // Changes to other parts of the project (settings) ride along in the same step.
    draft.dispatch({ type: 'project.setSettings', settings: { pValueStyle: 'APA' } })
    expect(draft.commit('Format graph')).toBe(true)
    expect(store.undoLabel).toBe('Format graph')
    expect(g(store).size.plotWidth).toBe(200)
    expect((g(store).axes.y as { reverse?: boolean }).reverse).toBe(true)
    expect(store.getState().settings.pValueStyle).toBe('APA')
    // One undo reverts all of it, and the previous entry is next.
    store.undo()
    expect(g(store).size.plotWidth).toBe(100)
    expect((g(store).axes.y as { reverse?: boolean }).reverse).toBeUndefined()
    expect(store.getState().settings.pValueStyle).not.toBe('APA')
    expect(store.undoLabel).toBe(undoBefore)
    store.redo()
    expect(g(store).size.plotWidth).toBe(200)
  })

  it('discarding (cancel) leaves the document and its history untouched', () => {
    const { store, graph } = setup()
    const before = store.getState()
    const label = store.undoLabel
    const draft = new DraftStore(store)
    draft.dispatch(set(graph.id, ['size', 'plotWidth'], 200))
    // Cancel = drop the draft: nothing to call on the parent.
    expect(store.getState()).toBe(before)
    expect(store.undoLabel).toBe(label)
    expect(store.redoLabel).toBeNull()
  })

  it('makes no undo step when nothing changed or the changes cancel out', () => {
    const { store, graph } = setup()
    const label = store.undoLabel
    expect(new DraftStore(store).commit('Format graph')).toBe(false)
    const draft = new DraftStore(store)
    draft.dispatch(set(graph.id, ['size', 'plotWidth'], 200))
    draft.dispatch(set(graph.id, ['size', 'plotWidth'], 100))
    expect(draft.changed).toBe(false)
    expect(draft.commit('Format graph')).toBe(false)
    expect(store.undoLabel).toBe(label)
  })

  it('drops changes undone inside the draft', () => {
    const { store, graph, g } = setup()
    const draft = new DraftStore(store)
    draft.dispatch(set(graph.id, ['size', 'plotWidth'], 200))
    draft.dispatch(set(graph.id, ['size', 'plotHeight'], 50))
    draft.undo()
    expect(draft.commands()).toHaveLength(1)
    draft.commit('Format graph')
    expect(g(store).size).toEqual({ plotWidth: 200, plotHeight: 100 })
  })

  it('validates in the draft: an invalid change throws there and is not committed', () => {
    const { store, graph, g } = setup()
    const draft = new DraftStore(store)
    expect(() => draft.dispatch(set(graph.id, ['size', 'plotWidth'], 'wide'))).toThrow(CommandError)
    draft.dispatch(set(graph.id, ['size', 'plotWidth'], 150))
    draft.commit('Format graph')
    expect(g(store).size.plotWidth).toBe(150)
  })

  it('replays a change inside an object an earlier command set (values are frozen after use)', () => {
    // A data set given a whole style object in a layer, then a field inside it: on replay the
    // first command's value is already frozen by the draft, and the second must not write into it.
    const { store, graph, g } = setup()
    const draft = new DraftStore(store)
    const key = 'ds'
    const points = ['layers', { id: 'points' }, 'series', key] as const
    draft.dispatch(set(graph.id, [...points], { style: { size: 6 } }))
    draft.dispatch(set(graph.id, [...points, 'style', 'shape'], 'square'))
    expect(draft.changed).toBe(true)
    expect(draft.commit('Format graph')).toBe(true)
    expect(g(store).layers[0]!.series?.[key]).toEqual({ style: { size: 6, shape: 'square' } })
  })

  it('replays layer and identity edits as dispatched', () => {
    const { store, graph, g } = setup()
    const draft = new DraftStore(store)
    draft.dispatch(set(graph.id, ['layers', { id: 'points' }, 'style'], { size: 7 }))
    draft.dispatch(set(graph.id, ['seriesOverrides', 'ds', 'color'], { palette: 3 }))
    expect(draft.commands()).toEqual([
      set(graph.id, ['layers', { id: 'points' }, 'style'], { size: 7 }),
      set(graph.id, ['seriesOverrides', 'ds', 'color'], { palette: 3 }),
    ])
    expect(draft.commit('Format graph')).toBe(true)
    expect(g(store).layers[0]!.style).toEqual({ size: 7 })
    expect(g(store).seriesOverrides).toEqual({ ds: { color: { palette: 3 } } })
  })

  it('copies what commands store: a node added, then changed in the same batch (audit 2, M8)', () => {
    const { store, graph, table } = setup()
    const draft = new DraftStore(store)
    const other: GraphNode = { ...structuredClone(graph), id: newNodeId(), name: 'g2' }
    const given = structuredClone(other)
    draft.dispatch([
      { type: 'node.add', node: other },
      {
        type: 'graph.addLayer',
        id: other.id,
        layer: { id: 'bars', geom: 'bar', stat: { kind: 'summary', center: 'mean' } },
      },
    ])
    // The caller's node is neither changed nor frozen.
    expect(other).toEqual(given)
    expect(Object.isFrozen(other)).toBe(false)
    expect(Object.isFrozen(other.layers)).toBe(false)
    expect(draft.commit('New graph')).toBe(true)
    expect((store.getState().nodes[other.id] as GraphNode).layers.map((l) => l.id)).toEqual([
      'points',
      'bars',
    ])
    // Parameters and inputs too.
    const params = { a: [1, 2] }
    const dataSets = [table.dataSets[0]!.id]
    const analysis: AnalysisNode = {
      kind: 'analysis',
      id: newNodeId(),
      name: 'a',
      analysisId: 'descriptive',
      pluginVersion: 1,
      input: { source: table.id, dataSets: [table.dataSets[0]!.id] },
      params: {},
    }
    store.dispatch([
      { type: 'node.add', node: analysis },
      { type: 'analysis.setParams', id: analysis.id, params },
      { type: 'analysis.setInput', id: analysis.id, dataSets },
    ])
    expect(Object.isFrozen(params) || Object.isFrozen(params.a) || Object.isFrozen(dataSets)).toBe(
      false,
    )
    // And the project's style (audit 2 step 4: project.setSettings stored the caller's).
    const style = { name: 'Mine', palette: ['#112233'] }
    store.dispatch({ type: 'project.setSettings', settings: { style } })
    expect(store.getState().settings.style).toEqual(style)
    expect(Object.isFrozen(style) || Object.isFrozen(style.palette)).toBe(false)
  })
})
