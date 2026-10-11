import { readFileSync } from 'node:fs'
import {
  CURRENT_SCHEMA_VERSION,
  GraphNode,
  type LayerOf,
  type MigrationNote,
  migrateProject,
  parseProject,
  readPreset,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { layoutGraph, sceneToSvg } from '../src/index.ts'
import { fonts } from './helpers.ts'

// Roadmap 49c: the v2 → v3 migration (a heat map's trees become dendrogram layers). The fixtures
// (`fixtures/v2/`) are v2 projects of clustered heat maps written by the 0.3.4 code (commit
// dbc7ece, by `genV2Fixtures.test.ts` there, kept as `fixtures/v2/generator.txt`) with the SVGs
// 0.3.4 drew of them, and a version 1 preset file of a clustered heat map. Opened now, each is a
// valid v3 project that draws exactly what 0.3.4 drew: byte for byte drawing by data set; drawing
// by layer, the same primitives in the same order (the trees' marks now sit in their layers'
// groups, `layer/<id>`, rather than the `dendrograms` group: groups carry nothing but their id).

const DIR = new URL('./fixtures/v2/', import.meta.url)
const read = (f: string) => readFileSync(new URL(f, DIR), 'utf8')
const NAMES: string[] = JSON.parse(read('index.json'))

/** An SVG without its groups' wrappers (each line a primitive, in paint order). */
const unwrapped = (svg: string) =>
  svg
    .split('\n')
    .filter((l) => !/^<g data-id="[^"]*">$/.test(l) && l !== '</g>')
    .join('\n')

const opened = (name: string, notes: MigrationNote[] = []) => {
  const raw = JSON.parse(read(`${name}.json`))
  expect(raw.schemaVersion).toBe(2)
  const project = parseProject(raw, notes)
  const graph = Object.values(project.nodes).find((n) => n.kind === 'graph') as GraphNode
  return { raw, project, graph }
}

const trees = (g: GraphNode) =>
  g.layers.filter((l): l is LayerOf<'dendrogram'> => l.geom === 'dendrogram')

describe('v2 fixtures open as v3 projects and draw as 0.3.4 drew them', () => {
  it.each(NAMES)('%s', (name) => {
    const notes: MigrationNote[] = []
    const { raw, project, graph } = opened(name, notes)
    expect(project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(notes).toEqual([])
    expect(GraphNode.parse(graph)).toEqual(graph)
    // No depth left on the tiles.
    for (const l of graph.layers)
      if (l.geom === 'tile') expect(l.style?.cluster ?? {}).not.toHaveProperty('dendrogram')
    // Deterministic, its input left alone; saved and reopened the same, needing no migration.
    expect(parseProject(JSON.parse(read(`${name}.json`)))).toEqual(project)
    expect(JSON.stringify(raw)).toBe(JSON.stringify(JSON.parse(read(`${name}.json`))))
    expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project)
    expect(migrateProject(project)).toBe(project)
    // Drawn as 0.3.4 drew it.
    const svg = sceneToSvg(layoutGraph({ project, graph, fonts }), { ids: true })
    const before = read(`${name}.svg`)
    if (graph.drawOrder === 'series' || !trees(graph).some((l) => l.visible !== false))
      expect(svg).toBe(before)
    else {
      expect(unwrapped(svg)).toBe(unwrapped(before))
      expect(svg).not.toContain('data-id="dendrograms"')
    }
  })

  it('adds a tree for each axis the drawn tiles cluster, at the front, with its depth', () => {
    const ids = (name: string) => opened(name).graph.layers.map((l) => l.id)
    expect(ids('heatmap-both-by-layer')).toEqual(['cells', 'rowTree', 'columnTree'])
    const both = trees(opened('heatmap-both-by-layer').graph)
    expect(both.map((l) => [l.stat, l.style, l.visible])).toEqual([
      [{ kind: 'cluster', of: 'rows' }, undefined, undefined],
      [{ kind: 'cluster', of: 'columns' }, undefined, undefined],
    ])
    const deep = opened('heatmap-rows-depth-values').graph
    expect(deep.layers.map((l) => l.id)).toEqual(['cells', 'values', 'rowTree'])
    expect(trees(deep)[0]!.style).toEqual({ depth: 50 })
    expect(trees(opened('heatmap-columns-by-data-set').graph)[0]!.style).toEqual({ depth: 24 })
    // A hidden heat map drew no trees: its trees are added hidden.
    const hidden = trees(opened('heatmap-hidden-tile').graph)
    expect(hidden.map((l) => [l.stat.of, l.visible, l.style])).toEqual([
      ['rows', false, { depth: 40 }],
    ])
    // The tiles drawn don't cluster (the clustered ones are hidden): no trees; a dot plot drew
    // none either.
    expect(trees(opened('heatmap-two-tiles').graph)).toEqual([])
    expect(trees(opened('dotplot-tile-cluster').graph)).toEqual([])
    const tiles = opened('dotplot-tile-cluster').graph.layers.find((l) => l.geom === 'tile')!
    expect(tiles.style).toEqual({ cluster: { rows: true } })
  })

  it('reads a version 1 preset file with its trees as layers', () => {
    const p = readPreset(read('clustered-heatmap.pspreset'))
    expect(p.recipe.layers.map((l) => l.id)).toEqual(['cells', 'values', 'rowTree'])
    const [cells, , tree] = p.recipe.layers
    expect(cells!.style).toEqual({ cluster: { distance: 'pearson', linkage: 'ward', rows: true } })
    expect(tree).toEqual({
      id: 'rowTree',
      geom: 'dendrogram',
      stat: { kind: 'cluster', of: 'rows' },
      style: { depth: 50 },
    })
  })
})
