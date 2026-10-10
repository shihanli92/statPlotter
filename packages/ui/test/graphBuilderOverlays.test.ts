import { builderPresetsFor, layoutGraph, newGraphNode } from '@ps/graph'
import { type DataTable, GraphNode, type NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { vectorTable } from '../../graph/test/goldenCases.ts'
import { appearanceTable, fonts, projectOf, sampleTable } from '../../graph/test/helpers.ts'
import {
  type BuilderAction,
  type BuilderState,
  builderChange,
  builderReducer,
  initialBuilder,
  styleChoices,
} from '../src/graph/builder/builderState.ts'

// The graph builder and roadmap 34c: the chips "Scatter with ellipses" and "Trajectories", the
// plot styles Ellipses, Convex hulls, Path and Vectors (a path's groups and a vector's ends in
// Map variables), and before-after lines on grouped graphs.

const run = (table: DataTable, actions: BuilderAction[], from = initialBuilder(table)) =>
  actions.reduce((s, a) => builderReducer(table, s, a), from)
const offered = (table: DataTable, s: BuilderState) =>
  styleChoices(table, s)
    .filter((c) => c.allowed.allowed)
    .map((c) => c.style.id)
const made = (table: DataTable, s: BuilderState) => {
  const graph = GraphNode.parse({ ...newGraphNode(table, builderChange(s)), id: 'g1' as NodeId })
  return { graph, scene: layoutGraph({ project: projectOf(table, graph), graph, fonts }) }
}

describe('the graph builder: group overlays, paths and vectors', () => {
  it('offers the two chips for a table with a text variable, drawing what they say', () => {
    const t = appearanceTable()
    expect(builderPresetsFor('multipleVariables', t).map((p) => p.id)).toEqual(
      expect.arrayContaining(['scatterEllipses', 'trajectories']),
    )
    const s = run(t, [{ type: 'preset', id: 'scatterEllipses' }])
    expect(s.layers.map((l) => l.geom)).toEqual(['polygon', 'points'])
    const { scene } = made(t, s)
    expect(scene.warnings.filter((w) => !/left out/.test(w))).toEqual([])
    const tr = run(t, [{ type: 'preset', id: 'trajectories' }])
    expect(tr.layers.map((l) => l.geom)).toEqual(['path', 'points'])
  })

  it('a path’s groups and a vector’s ends are mapped in Map variables', () => {
    const t = appearanceTable()
    let s = run(t, [
      { type: 'preset', id: 'scatterEllipses' },
      { type: 'toggle', style: 'path' },
      { type: 'aes', field: 'group', key: 'b' },
    ])
    const path = s.layers.find((l) => l.geom === 'path')!
    expect(path.aes).toEqual({ group: 'b' })
    // The points keep their own variables.
    expect(s.layers.find((l) => l.geom === 'points')!.aes?.color).toBe('a')
    expect(offered(t, s)).toEqual(expect.arrayContaining(['ellipses', 'hull', 'path']))
    // Three number variables: no vectors (two on the axes).
    expect(offered(t, s)).not.toContain('vectors')
    const v = vectorTable()
    s = run(v, [
      { type: 'preset', id: 'bubble' },
      { type: 'toggle', style: 'vectors' },
    ])
    const seg = () => s.layers.find((l) => l.geom === 'segment')!
    expect(seg().aes).toMatchObject({ xend: 'c', yend: 'd' })
    s = run(v, [{ type: 'aes', field: 'yend', key: 'e' }], s)
    expect(seg().aes).toMatchObject({ xend: 'c', yend: 'e' })
    expect(s.layers.find((l) => l.geom === 'points')!.aes?.y).not.toBe('e')
    expect(made(v, s).scene.warnings).toEqual([])
  })

  it('before-after lines on a grouped graph join each subject', () => {
    const t = sampleTable('grouped')
    const s = run(t, [{ type: 'preset', id: 'points' }])
    expect(offered(t, s)).toContain('pairs')
    const next = run(t, [{ type: 'toggle', style: 'pairs' }], s)
    const pairs = next.layers.find((l) => l.geom === 'connector')!
    expect(pairs.position).toBeUndefined()
    expect(made(t, next).scene.warnings).toEqual([])
  })
})
