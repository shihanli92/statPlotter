import { registry } from '@ps/analyses'
import { DocumentStore } from '@ps/engine'
import { dataOf, graphTheme, layoutGraph, type Scene, type SceneNode } from '@ps/graph'
import type { GraphNode, NodeId, Project } from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { startedEngine } from '../../engine/test/helpers.ts'
import { fonts } from '../../graph/test/helpers.ts'
import { EXAMPLES } from '../src/examples/registry.ts'
import {
  basePointsLayer,
  cutoffOf,
  cutoffsCommands,
  volcanoCommands,
} from '../src/graph/inspector/Volcano.tsx'
import { builtExample } from './exampleBuilds.ts'

vi.mock('../../model/src/ids.ts', async (importOriginal) =>
  (await import('./countedIds.ts')).countedIds(await importOriginal(), { always: true }),
)

// Roadmap 46b: Insert › Volcano thresholds… on the grouped example's volcano plot — one step
// adding the lines at the shared cut-offs and the Significance layer over the analysis' points,
// greying them, the classes' counts in the legend; editing the cut-offs moves everything at once.

async function volcanoExample() {
  const project = (await builtExample(EXAMPLES.find((e) => e.id === 'grouped')!))!
  const graph = Object.values(project.nodes).find(
    (n): n is GraphNode => n.kind === 'graph' && n.name === 'Volcano plot',
  )!
  const engine = await startedEngine(project, registry)
  engine.stop()
  const lookup = (id: NodeId) => engine.latest(id)
  return { project, graph, lookup }
}

const flatten = (n: SceneNode, out: SceneNode[] = []): SceneNode[] => {
  out.push(n)
  for (const c of n.children ?? []) flatten(c, out)
  return out
}
const text = (s: Scene, id: string) => {
  const n = flatten(s.root).find((x) => x.id === id)
  return n?.prim?.type === 'text' ? n.prim.layout.runs.map((r) => r.text).join('') : undefined
}

describe('volcano thresholds', () => {
  it('one step: the cut-offs, the lines, the Significance layer over the grey points', async () => {
    const { project, graph, lookup } = await volcanoExample()
    const base = basePointsLayer(graph)!
    expect(dataOf(graph, base).from).toBe('outputs')
    const store = new DocumentStore(project)
    const theme = graphTheme(project, graph)
    const { cmds, added } = volcanoCommands(project, graph, lookup, theme, {
      fold: 1,
      p: 0.05,
      foldAxis: 'x',
      pValues: false,
      colour: true,
    })
    store.dispatch(cmds, 'Volcano thresholds')
    const g = store.getState().nodes[graph.id] as GraphNode
    expect(g.cutoffs).toEqual({ fold: 1, sig: { p: 0.05 } })
    expect(added).toHaveLength(3)
    const sig = g.layers.find((l) => l.stat.kind === 'threshold')!
    expect(sig.data).toEqual({ from: 'layer', layer: base.id })
    // In front of the points; the lines along X (±) and across (P).
    expect(g.layers.indexOf(sig)).toBeGreaterThan(g.layers.findIndex((l) => l.id === base.id))
    const fold = g.layers.find((l) => cutoffOf(l) === 'fold')!
    const p = g.layers.find((l) => cutoffOf(l) === 'sig')!
    expect(fold.stat).toMatchObject({ axis: 'x', mirror: true })
    expect((p.stat as { axis?: string }).axis).toBeUndefined()
    // The points grey, the legend shown with the classes in place of the points' entries.
    const style = g.layers.find((l) => l.id === base.id)!.style as Record<string, never>
    expect(style.fill).toMatchObject({ color: { rgb: '#c8c8c8' } })
    expect(style.border).toMatchObject({ color: { rgb: '#c8c8c8' } })
    expect(g.legend.show).toBe(true)
    const data = dataOf(graph, base)
    const outputs = data.from === 'outputs' ? data.series.map((s) => s.id) : []
    expect(outputs).toHaveLength(2)
    expect(g.legend.hidden).toEqual(expect.arrayContaining(outputs))

    const lay = (gr: GraphNode) =>
      layoutGraph({ project: store.getState(), graph: gr, fonts, result: lookup })
    const scene = lay(g)
    expect(scene.warnings).toEqual([])
    const labels = ['up', 'down', 'ns'].map((k) =>
      text(scene, `legend/threshold/${sig.id}/${k}/label`),
    )
    expect(labels.map((l) => /^(Up|Down|NS) \((\d+)\)$/.test(l ?? ''))).toEqual([true, true, true])
    const counts = labels.map((l) => Number(/\((\d+)\)/.exec(l!)![1]))
    expect(counts.reduce((a, b) => a + b, 0)).toBe(30)
    // The points' own entries are hidden.
    expect(flatten(scene.root).some((n) => n.id.startsWith('legend/curve/'))).toBe(false)

    // One undo step restores the graph.
    store.undo()
    expect(store.getState().nodes[graph.id]).toEqual(graph)
  })

  it('without colouring: the lines alone; again: nothing doubled', async () => {
    const { project, graph, lookup } = await volcanoExample()
    const store = new DocumentStore(project)
    const theme = graphTheme(project, graph)
    const choice = { fold: 1, p: 0.01, foldAxis: 'x' as const, pValues: false, colour: false }
    store.dispatch(volcanoCommands(project, graph, lookup, theme, choice).cmds, 'Volcano')
    const g = store.getState().nodes[graph.id] as GraphNode
    expect(g.layers.some((l) => l.stat.kind === 'threshold')).toBe(false)
    expect(g.layers.filter((l) => cutoffOf(l))).toHaveLength(2)
    expect(g.layers.find((l) => l.id === basePointsLayer(graph)!.id)!.style).toEqual(
      basePointsLayer(graph)!.style,
    )
    const again = volcanoCommands(store.getState(), g, lookup, theme, { ...choice, fold: 2 })
    expect(again.added).toEqual([])
  })

  it('the fold change along Y: the cut-offs and the lines’ axes in one step', async () => {
    const { project, graph, lookup } = await volcanoExample()
    const store = new DocumentStore(project)
    const theme = graphTheme(project, graph)
    const choice = { fold: 1, p: 0.05, foldAxis: 'x' as const, pValues: false, colour: true }
    store.dispatch(volcanoCommands(project, graph, lookup, theme, choice).cmds, 'Volcano')
    const g = store.getState().nodes[graph.id] as GraphNode
    store.dispatch(cutoffsCommands(g, { ...g.cutoffs!, foldAxis: 'y' }), 'Fold change axis')
    const h = store.getState().nodes[graph.id] as GraphNode
    const axis = (w: 'fold' | 'sig') =>
      (h.layers.find((l) => cutoffOf(l) === w)!.stat as { axis?: string }).axis
    expect(h.cutoffs?.foldAxis).toBe('y')
    expect(axis('fold')).toBeUndefined()
    expect(axis('sig')).toBe('x')
    store.undo()
    expect(store.getState().nodes[graph.id]).toEqual(g)
  })
})

/** (The project type, for helpers.) */
export type { Project }
