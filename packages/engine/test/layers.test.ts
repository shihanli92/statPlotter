import {
  createProject,
  createTable,
  type GraphNode,
  type Layer,
  type NodeId,
  type Project,
} from '@ps/model'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  applyToTables,
  type Command,
  CommandError,
  DocumentStore,
  DraftStore,
} from '../src/index.ts'
import { testGraph } from './graphs.ts'

// Layers in the document (roadmap 33b): `{ id }` path segments, the layer commands, removal of
// attached layers and drawing orders, and undo / redo as one step each.

const BARS: Layer = { id: 'bars', geom: 'bar', stat: { kind: 'summary', center: 'mean' } }
const ERROR: Layer = {
  id: 'error',
  geom: 'errorbar',
  stat: { kind: 'summary', center: 'mean', error: 'SD' },
  on: 'bars',
}
const LABELS: Layer = {
  id: 'labels',
  geom: 'label',
  stat: { kind: 'summary', center: 'mean' },
  on: 'error',
}
const POINTS: Layer = { id: 'points', geom: 'points', stat: { kind: 'identity' } }
const BAND: Layer = {
  id: 'band',
  geom: 'band',
  stat: { kind: 'identity' },
  data: { from: 'layer', layer: 'bars' },
}

function setup(layers: Layer[] = [BARS, POINTS, ERROR, LABELS]) {
  const table = createTable({ rows: 3, columns: 2 })
  const [a, b] = table.dataSets.map((d) => d.id as string) as [string, string]
  const graph = testGraph(table.id, {
    look: 'column.bar',
    layers,
    seriesOverrides: {
      [a]: { order: ['points', 'error', 'bars'] },
      [b]: { color: { palette: 2 } },
    },
  })
  const store = new DocumentStore(createProject('T', new Date('2026-01-01T00:00:00Z')))
  store.dispatch([
    { type: 'node.add', node: table },
    { type: 'node.add', node: graph },
  ])
  const g = (s: { getState(): Project } = store) => s.getState().nodes[graph.id] as GraphNode
  const ids = (s?: { getState(): Project }) => g(s).layers.map((l) => l.id)
  return { store, graph, table, a, b, g, ids }
}

describe('node.set with { id } segments', () => {
  it('names a layer by its id, wherever it is in the list', () => {
    const { store, graph, g } = setup()
    const path = ['layers', { id: 'error' }, 'style', 'capWidth']
    store.dispatch({ type: 'node.set', id: graph.id, path, value: 4 })
    expect(g().layers[2]).toMatchObject({ id: 'error', style: { capWidth: 4 } })
    store.dispatch({ type: 'graph.moveLayer', id: graph.id, layer: 'error', to: 0 })
    store.dispatch({ type: 'node.set', id: graph.id, path, value: 6 })
    expect(g().layers[0]).toMatchObject({ id: 'error', style: { capWidth: 6 } })
    store.undo()
    store.undo()
    expect(g().layers[2]).toMatchObject({ id: 'error', style: { capWidth: 4 } })
  })

  it('refuses a layer the graph doesn’t have (removing from one is nothing)', () => {
    const { store, graph, g } = setup()
    const set = (value: unknown) =>
      store.dispatch({
        type: 'node.set',
        id: graph.id,
        path: ['layers', { id: 'nope' }, 'style'],
        value,
      })
    expect(() => set({ size: 3 })).toThrow(CommandError)
    const before = g()
    set(undefined)
    expect(g()).toBe(before)
    expect(() =>
      store.dispatch({
        type: 'node.set',
        id: graph.id,
        path: ['layers', { id: 'bars', x: 1 } as never, 'style'],
        value: {},
      }),
    ).toThrow(CommandError)
    expect(() =>
      store.dispatch({ type: 'node.set', id: graph.id, path: ['size', { id: 'x' }], value: 1 }),
    ).toThrow(CommandError)
  })

  it('replays in a draft after the layers moved', () => {
    const { store, graph, g } = setup()
    const draft = new DraftStore(store)
    draft.dispatch({ type: 'graph.moveLayer', id: graph.id, layer: 'points', to: 3 })
    draft.dispatch({
      type: 'node.set',
      id: graph.id,
      path: ['layers', { id: 'points' }, 'style', 'size'],
      value: 7,
    })
    expect(draft.commit('Format graph')).toBe(true)
    expect(g().layers.at(-1)).toMatchObject({ id: 'points', style: { size: 7 } })
  })
})

describe('layer commands', () => {
  it('add a layer where asked; ids are unique and well formed', () => {
    const { store, graph, ids } = setup()
    store.dispatch({ type: 'graph.addLayer', id: graph.id, layer: BAND, at: 1 })
    expect(ids()).toEqual(['bars', 'band', 'points', 'error', 'labels'])
    expect(store.undoLabel).toBe('Add layer')
    expect(() =>
      store.dispatch({ type: 'graph.addLayer', id: graph.id, layer: { ...POINTS } }),
    ).toThrow(CommandError)
    expect(() =>
      store.dispatch({ type: 'graph.addLayer', id: graph.id, layer: { ...POINTS, id: 'Bad id' } }),
    ).toThrow(CommandError)
    // A layer attached to a host the graph doesn't have is refused by validation.
    expect(() =>
      store.dispatch({
        type: 'graph.addLayer',
        id: graph.id,
        layer: { ...ERROR, id: 'e2', on: 'x' },
      }),
    ).toThrow(/no host layer x/)
    store.undo()
    expect(ids()).toEqual(['bars', 'points', 'error', 'labels'])
  })

  it('remove a host with the layers attached to it and drawing its data, out of every order', () => {
    const { store, graph, a, b, g, ids } = setup([BARS, BAND, POINTS, ERROR, LABELS])
    const before = store.getState()
    store.dispatch({ type: 'graph.removeLayer', id: graph.id, layer: 'bars' })
    // Error bars on the bars, labels on the error bars, the band of the bars' data: all gone.
    expect(ids()).toEqual(['points'])
    expect(g().seriesOverrides[a]).toEqual({ order: ['points'] })
    expect(g().seriesOverrides[b]).toEqual({ color: { palette: 2 } })
    expect(store.undoLabel).toBe('Delete layer')
    store.undo()
    expect(store.getState()).toEqual(before)
    // An order left empty goes.
    store.dispatch({ type: 'graph.removeLayer', id: graph.id, layer: 'points' })
    store.dispatch({ type: 'graph.removeLayer', id: graph.id, layer: 'bars' })
    expect(g().seriesOverrides[a]).toEqual({})
    expect(() =>
      store.dispatch({ type: 'graph.removeLayer', id: graph.id, layer: 'nope' }),
    ).toThrow(CommandError)
  })

  it('move a layer in the list', () => {
    const { store, graph, ids } = setup()
    store.dispatch({ type: 'graph.moveLayer', id: graph.id, layer: 'bars', to: 99 })
    expect(ids()).toEqual(['points', 'error', 'labels', 'bars'])
    expect(store.undoLabel).toBe('Move layer')
    expect(() =>
      store.dispatch({ type: 'graph.moveLayer', id: graph.id, layer: 'bars', to: -1 }),
    ).toThrow(CommandError)
  })

  it('replace the layers (and frame, look, preset) as one step; orders keep layers still there', () => {
    const { store, graph, a, g, ids } = setup()
    const before = store.getState()
    store.dispatch({
      type: 'graph.setLayers',
      id: graph.id,
      layers: [
        POINTS,
        { id: 'center', geom: 'center', stat: { kind: 'summary', center: 'median' } },
      ],
      look: 'column.scatter',
      preset: 'pointsMedian',
    })
    expect(ids()).toEqual(['points', 'center'])
    expect(g()).toMatchObject({ frame: 'category', look: 'column.scatter', preset: 'pointsMedian' })
    expect(g().seriesOverrides[a]).toEqual({ order: ['points'] })
    expect(store.undoLabel).toBe('Change layers')
    store.undo()
    expect(store.getState()).toEqual(before)
    expect(() =>
      store.dispatch({ type: 'graph.setLayers', id: graph.id, layers: [POINTS, POINTS] }),
    ).toThrow(/repeated/)
  })

  it('apply to graphs only', () => {
    const { store, table } = setup()
    expect(() =>
      store.dispatch({ type: 'graph.removeLayer', id: table.id, layer: 'bars' }),
    ).toThrow(/not a graph/)
  })
})

describe('undo / redo of layer edits (property)', () => {
  const LAYER_IDS = ['bars', 'points', 'error', 'labels', 'band', 'line']
  const layerOf = (id: string): Layer =>
    id === 'line'
      ? { id, geom: 'line', stat: { kind: 'summary', center: 'mean' } }
      : ([BARS, POINTS, ERROR, LABELS, BAND].find((l) => l.id === id) as Layer)
  const command = (graph: NodeId, keys: string[]): fc.Arbitrary<Command> =>
    fc.oneof(
      fc.record({
        type: fc.constant('graph.addLayer' as const),
        id: fc.constant(graph),
        layer: fc.constantFrom(...LAYER_IDS).map(layerOf),
        at: fc.option(fc.nat(6), { nil: undefined }),
      }),
      fc.record({
        type: fc.constant('graph.removeLayer' as const),
        id: fc.constant(graph),
        layer: fc.constantFrom(...LAYER_IDS),
      }),
      fc.record({
        type: fc.constant('graph.moveLayer' as const),
        id: fc.constant(graph),
        layer: fc.constantFrom(...LAYER_IDS),
        to: fc.nat(6),
      }),
      fc.record({
        type: fc.constant('graph.setLayers' as const),
        id: fc.constant(graph),
        layers: fc.subarray(LAYER_IDS).map((ids) => ids.map(layerOf)),
      }),
      fc.record({
        type: fc.constant('node.set' as const),
        id: fc.constant(graph),
        path: fc
          .tuple(fc.constantFrom(...LAYER_IDS), fc.constantFrom(...keys))
          .map(([l, k]) => ['layers', { id: l }, 'series', k, 'hide']),
        value: fc.option(fc.boolean(), { nil: undefined }),
      }),
      fc.record({
        type: fc.constant('node.set' as const),
        id: fc.constant(graph),
        path: fc.constantFrom(...keys).map((k) => ['seriesOverrides', k, 'order']),
        value: fc.subarray(LAYER_IDS),
      }),
      fc.record({
        type: fc.constant('node.set' as const),
        id: fc.constant(graph),
        path: fc.constantFrom(...LAYER_IDS).map((l) => ['layers', { id: l }, 'style', 'size']),
        value: fc.constantFrom(3, 5, 8),
      }),
    ) as fc.Arbitrary<Command>

  it('undo all restores the original; redo all the final, each command one step', () => {
    const { store: seed, graph, a, b } = setup()
    const initial = seed.getState()
    fc.assert(
      fc.property(fc.array(command(graph.id, [a, b]), { minLength: 1, maxLength: 20 }), (cmds) => {
        const store = new DocumentStore(initial)
        let steps = 0
        for (const c of cmds) {
          const before = store.getState()
          try {
            store.dispatch(c)
          } catch (e) {
            // Missing layers, repeated ids, dangling hosts: refused, nothing changed.
            if (!(e instanceof CommandError)) throw e
            expect(store.getState()).toBe(before)
          }
          if (store.getState() !== before) steps++
        }
        const final = store.getState()
        for (let i = 0; i < steps; i++) expect(store.undo()).toBe(true)
        expect(store.getState()).toEqual(initial)
        for (let i = 0; i < steps; i++) expect(store.redo()).toBe(true)
        expect(store.getState()).toEqual(final)
      }),
      { numRuns: 300, seed: 7 },
    )
  })
})

describe('reference walkers see layers', () => {
  it('Apply to other tables maps the data sets the layers name', () => {
    const { store, graph, table, a, b } = setup()
    const other = createTable({ name: 'Other', rows: 3, columns: 2 })
    const [x, y] = other.dataSets.map((d) => d.id as string) as [string, string]
    store.dispatch([
      { type: 'node.add', node: other },
      {
        type: 'node.set',
        id: graph.id,
        path: ['layers', { id: 'points' }, 'series'],
        value: { [a]: { style: { size: 9 } }, [b]: { hide: true } },
      },
      {
        type: 'node.set',
        id: graph.id,
        path: ['layers', { id: 'bars' }, 'aes'],
        value: { x: a, color: b },
      },
    ])
    const plan = applyToTables(store.getState(), table.id, store.getState(), [other.id], {
      match: 'position',
      layouts: false,
      find: '',
    })
    store.dispatch(plan.commands)
    const copy = store.getState().nodes[plan.created[0]!.nodes[0]!] as GraphNode
    expect(copy.seriesSource.table).toBe(other.id)
    expect(copy.layers.find((l) => l.id === 'points')!.series).toEqual({
      [x]: { style: { size: 9 } },
      [y]: { hide: true },
    })
    expect(copy.layers.find((l) => l.id === 'bars')!.aes).toEqual({ x, color: y })
    expect(copy.seriesOverrides).toEqual({
      [x]: { order: ['points', 'error', 'bars'] },
      [y]: { color: { palette: 2 } },
    })
  })
})
