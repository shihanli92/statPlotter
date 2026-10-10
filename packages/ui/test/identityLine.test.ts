import { DocumentStore } from '@ps/engine'
import { layoutGraph, presetGraph } from '@ps/graph'
import type { GraphNode, NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf, sampleTable } from '../../graph/test/helpers.ts'
import { elementTarget, lineCommands } from '../src/formatBar/selectionStyles.ts'
import {
  addIdentityLayer,
  hasContinuousAxes,
  identityLayer,
  isTypedSloped,
} from '../src/graph/inspector/IdentityLine.tsx'
import { setLayerStat } from '../src/graph/inspector/layers.ts'
import { deletable, deleteEdits } from '../src/graph/selectionEdits.ts'

// Roadmap 46b: Insert › Identity line (y = x) — the layer it adds, where it goes in the list, the
// format bar's Line group on it and Delete removing it, each one undo step.

const G = 'g1' as NodeId

function setup() {
  const table = sampleTable('xy')
  const graph: GraphNode = { ...presetGraph(table, 'meanSd'), id: G }
  const project = projectOf(table, graph)
  return { table, graph, project, store: new DocumentStore(project) }
}

const graphIn = (store: DocumentStore) => store.getState().nodes[G] as GraphNode

describe('Insert › Identity line (y = x)', () => {
  it('adds y = x of typed values behind the points, its legend hidden, one undo step', () => {
    const { graph, store } = setup()
    expect(hasContinuousAxes(graph)).toBe(true)
    const layer = identityLayer(graph)
    expect(layer).toMatchObject({
      id: 'identity',
      geom: 'refline',
      data: { from: 'values' },
      legend: 'hide',
      stat: { kind: 'result', slope: 'slope', intercept: 'intercept', template: 'y = x' },
    })
    expect(isTypedSloped(layer)).toBe(true)
    store.dispatch(addIdentityLayer(graph, layer), 'Add identity line')
    const g = graphIn(store)
    const ids = g.layers.map((l) => l.id)
    // A reference line is a fill: behind the back-most mark (the points).
    expect(ids.indexOf('identity')).toBeLessThan(ids.indexOf('points'))
    // A second one takes a fresh id.
    expect(identityLayer(g).id).toBe('identity2')
    expect(store.undoLabel).toBe('Add identity line')
    store.undo()
    expect(graphIn(store).layers.some((l) => l.id === 'identity')).toBe(false)
  })

  it('is offered only on graphs with two continuous axes', () => {
    const column = sampleTable('column')
    expect(hasContinuousAxes(presetGraph(column, 'barsPoints'))).toBe(false)
  })

  it('takes the format bar’s Line group, on its layer path', () => {
    const { graph, project } = setup()
    const g = { ...graph, layers: [identityLayer(graph), ...graph.layers] }
    const t = elementTarget(
      { ...project, nodes: { ...project.nodes, [G]: g } },
      g,
      ['layers', 'identity'],
      null,
    )
    expect(t.line).toMatchObject({
      path: ['layers', { id: 'identity' }, 'style', 'line'],
      partial: false,
      shown: { color: { rgb: '#808080' }, width: 1, dash: 'dash' },
    })
    // Written whole (a layer's line style is a whole stroke), from what it draws.
    expect(lineCommands([t.line!], { width: 2 })).toEqual([
      {
        type: 'node.set',
        id: G,
        path: ['layers', { id: 'identity' }, 'style', 'line'],
        value: { color: { rgb: '#808080' }, width: 2, dash: 'dash' },
      },
    ])
  })

  it('is removed by Delete when selected (one step, undone)', () => {
    const { graph, store } = setup()
    store.dispatch(addIdentityLayer(graph, identityLayer(graph)), 'Add identity line')
    const g = graphIn(store)
    expect(deletable(g, ['layers', 'identity'])).toBe(true)
    // Roadmap 47 (amends 934): every whole layer is removed by Delete, the table's too.
    expect(deletable(g, ['layers', 'points'])).toBe(true)
    const d = deleteEdits(g, [['layers', 'identity']])!
    expect(d.label).toBe('Delete line')
    store.dispatch(d.commands, d.label)
    expect(graphIn(store).layers.some((l) => l.id === 'identity')).toBe(false)
    store.undo()
    expect(graphIn(store).layers.some((l) => l.id === 'identity')).toBe(true)
  })

  it('draws as soon as it is added', () => {
    const { graph, store, table } = setup()
    store.dispatch(addIdentityLayer(graph, identityLayer(graph)), 'Add identity line')
    const g = graphIn(store)
    const scene = layoutGraph({ project: projectOf(table, g), graph: g, fonts })
    expect(JSON.stringify(scene.root)).toContain('result/identity/all/line')
    expect(scene.warnings).toEqual([])
  })
})

describe('setLayerStat (audit 3, T9: the result-layer panels share it)', () => {
  it('merges the fields into the stat at its path, a field set to undefined left out', () => {
    const calls: unknown[][] = []
    const ctx = { set: (...args: unknown[]) => void calls.push(args) }
    const layer = { id: 'ref', stat: { kind: 'result', slope: 'a', lineLabel: 'end' } as const }
    setLayerStat(ctx, layer, { slope: 'b', lineLabel: undefined } as never, 'Slope')
    expect(calls).toEqual([
      [['layers', { id: 'ref' }, 'stat'], { kind: 'result', slope: 'b' }, 'Slope'],
    ])
  })
})
