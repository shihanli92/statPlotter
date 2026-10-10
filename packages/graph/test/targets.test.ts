import { readdirSync, readFileSync } from 'node:fs'
import { type GraphNode, type NodeId, parseProject } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  defaultContinuousAxis,
  layerTargets,
  layerTitle,
  layoutLayers,
  matrixWarnings,
  type Scene,
  type SceneNode,
  type StylePath,
} from '../src/index.ts'
import { fonts, projectOf, sampleTable } from './helpers.ts'

// Layer-scoped targets (roadmap 33c): every mark targets its layer and data set, chart-wide
// options their layer, identities stay the data set's.

const FIX = new URL('./fixtures/v1/', import.meta.url)
const projects = (dir: string) =>
  readdirSync(new URL(`${dir}/`, FIX))
    .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'renders.json')
    .map(
      (f) =>
        [
          `${dir}/${f}`,
          parseProject(JSON.parse(readFileSync(new URL(`${dir}/${f}`, FIX), 'utf8'))),
        ] as const,
    )

const all = (n: SceneNode, out: SceneNode[] = []) => {
  out.push(n)
  for (const c of n.children ?? []) all(c, out)
  return out
}

/** Targets left in v1's form (they should all be layer-scoped now). */
function v1Targets(scene: Scene): StylePath[] {
  return all(scene.root).flatMap((n) => {
    const t = n.target
    if (!t) return []
    const [root, second] = t
    const v1 =
      (root === 'seriesOverrides' && t.length > 2) ||
      root === 'extraSeries' ||
      root === 'functions' ||
      (root === 'style' &&
        (t.length === 1 || ['heatmap', 'estimation', 'grandMean', 'pie'].includes(String(second))))
    return v1 ? [t] : []
  })
}

describe('layer targets', () => {
  const cases = [...projects('golden'), ...projects('exotic')]
  it.each(cases)('%s', (_, project) => {
    for (const g of Object.values(project.nodes).filter((n) => n.kind === 'graph')) {
      const graph = g as GraphNode
      const scene = layerTargets(layoutLayers({ project, graph, fonts }), graph)
      expect(v1Targets(scene), graph.name).toEqual([])
      const ids = new Set(graph.layers.map((l) => l.id))
      // Marks of a layer target that layer (and a data set it draws).
      for (const n of all(scene.root)) {
        const t = n.target
        if (t?.[0] !== 'layers') continue
        expect(ids.has(String(t[1])), `${graph.name}: ${t.join('/')}`).toBe(true)
        if (n.layer && t.length === 4) expect(t[1]).toBe(n.layer)
      }
    }
  })

  it('a data set’s group and legend entry keep its identity; marks name layer and data set', () => {
    const project = cases.find(([n]) => n === 'golden/grouped-grouped.bar.json')![1]
    const graph = Object.values(project.nodes).find((n) => n.kind === 'graph') as GraphNode
    const scene = layerTargets(layoutLayers({ project, graph, fonts }), graph)
    const byId = new Map(all(scene.root).map((n) => [n.id, n]))
    expect(byId.get('series/a')?.target).toEqual(['seriesOverrides', 'a'])
    expect(byId.get('legend/a')?.target).toEqual(['seriesOverrides', 'a'])
    expect(byId.get('series/a/bar/0')?.target).toEqual(['layers', 'bars', 'series', 'a'])
    expect(byId.get('series/b/bar/1')?.point).toBe('r1')
  })
})

describe('matrix warnings', () => {
  it('name unsupported layers that draw, not those drawing nothing', () => {
    const nested = sampleTable('nested')
    const graph: GraphNode = {
      kind: 'graph',
      id: 'g1' as NodeId,
      name: 'G',
      frame: 'category',
      layers: [
        { id: 'pairs', geom: 'connector', stat: { kind: 'identity' } },
        { id: 'points', geom: 'points', stat: { kind: 'identity' } },
      ],
      seriesSource: { table: nested.id, include: 'all' },
      seriesOverrides: {},
      size: { plotWidth: 200, plotHeight: 150 },
      axes: {
        x: { type: 'categorical', title: null, labels: 'dataSetTitles', rotation: 0 },
        y: defaultContinuousAxis(),
      },
      annotations: [],
      legend: { show: false, position: 'right' },
      title: null,
      style: {},
    }
    const project = projectOf(nested)
    const scene = layoutLayers({ project, graph, fonts })
    const name = (l: GraphNode['layers'][number]) => layerTitle(l, graph.frame)
    expect(matrixWarnings(scene, graph, nested, name)).toEqual([
      'Before–after (values): not for nested tables.',
    ])
    // A contingency table's error bars (v1's grouped options, kept): one count per cell, nothing
    // drawn, no warning.
    const counts = sampleTable('contingency')
    const bars: GraphNode = {
      ...graph,
      frame: 'grouped',
      seriesSource: { table: counts.id, include: 'all' },
      layers: [
        { id: 'bars', geom: 'bar', stat: { kind: 'summary', center: 'mean' } },
        {
          id: 'error',
          geom: 'errorbar',
          stat: { kind: 'summary', center: 'mean', error: 'SD' },
          on: 'bars',
        },
      ],
    }
    const s2 = layoutLayers({ project: projectOf(counts), graph: bars, fonts })
    expect(matrixWarnings(s2, bars, counts, name)).toEqual([])
  })
})
