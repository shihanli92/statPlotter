import {
  type DataTable,
  type GraphNode,
  GraphNode as GraphNodeSchema,
  presetRecipe,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  defaultUserPreset,
  layoutGraph,
  newGraphNode,
  newLayerLooks,
  presetFits,
  presetGraph,
  recipeLayers,
  userPresetId,
  userPresetsFor,
  withLayers,
} from '../src/index.ts'
import { fonts, projectOf, sampleTable } from './helpers.ts'

// User presets (roadmap 33c): a graph's layers kept as a recipe, without what belongs to its
// table's data sets, and made again for another table of a kind it fits.

/** A bars-with-points graph of a column table formatted every which way. */
function formatted(table: DataTable): GraphNode {
  const g = presetGraph(table, 'barsPoints')
  const [a] = table.dataSets.map((d) => d.id)
  return {
    ...g,
    title: { content: [{ text: 'My title' }] },
    axes: {
      ...g.axes,
      y: g.axes.y.type === 'continuous' ? { ...g.axes.y, range: { min: 0, max: 50 } } : g.axes.y,
    },
    annotations: [
      {
        type: 'text',
        id: 'ann1',
        content: { content: [{ text: 'Note' }] },
        x: 10,
        y: 10,
      } as unknown as GraphNode['annotations'][number],
    ],
    seriesOverrides: { [a!]: { color: { rgb: '#ff0000' } } },
    pointOverrides: { [a!]: { r0: { hide: true } } },
    style: { ...g.style, orientation: 'horizontal' },
    drawOrder: 'series',
    layers: g.layers.map((l) =>
      l.id === 'bars'
        ? {
            ...l,
            name: 'Means',
            style: { width: 0.5 },
            series: { [a!]: { style: { width: 0.2 } } },
          }
        : l.id === 'error'
          ? { ...l, stat: { kind: 'summary', center: 'mean', error: 'SEM' } }
          : l,
    ) as GraphNode['layers'],
  }
}

describe('user presets', () => {
  const column = sampleTable('column')

  it('keep the layers (stat, position, style), orientation and drawing order; not the rest', () => {
    const r = presetRecipe(formatted(column), 'column')
    expect(r).toMatchObject({
      tableKind: 'column',
      frame: 'category',
      look: 'column.bar',
      orientation: 'horizontal',
      drawOrder: 'series',
    })
    expect(r.layers.map((l) => l.id)).toEqual(['bars', 'points', 'error'])
    expect(r.layers[0]).toEqual({
      id: 'bars',
      geom: 'bar',
      stat: { kind: 'summary', center: 'mean' },
      name: 'Means',
      style: { width: 0.5 },
    })
    expect(r.layers[2]).toMatchObject({ on: 'bars', stat: { error: 'SEM' } })
    const text = JSON.stringify(r)
    for (const gone of ['My title', 'Note', '#ff0000', 'r0', 'range', '"series":{'])
      expect(text, gone).not.toContain(gone)
  })

  it('leave out layers of analysis results and what is on them; mappings become the table’s', () => {
    const g = presetGraph(column, 'points')
    const withCurves: GraphNode = {
      ...g,
      layers: [
        ...g.layers,
        {
          id: 'curves',
          geom: 'line',
          stat: { kind: 'identity' },
          data: { from: 'outputs', series: [] },
        },
        {
          id: 'curveBands',
          geom: 'band',
          stat: { kind: 'identity' },
          data: { from: 'layer', layer: 'curves' },
        },
      ] as GraphNode['layers'],
    }
    expect(presetRecipe(withCurves, 'column').layers.map((l) => l.id)).toEqual(
      g.layers.map((l) => l.id),
    )
    const mv = sampleTable('multipleVariables')
    const bubbles = presetGraph(mv, 'bubble')
    const r = presetRecipe(bubbles, 'multipleVariables')
    expect(r.layers[0]!.aes).toEqual({})
    const other: DataTable = {
      ...mv,
      dataSets: [...mv.dataSets].reverse(),
    }
    expect(recipeLayers(r, other, 'B').layers[0]!.aes).toEqual(
      presetGraph(other, 'bubble').layers[0]!.aes,
    )
    expect(presetFits(r, 'column')).toBe(false)
  })

  it('make the same graph for another table of the kind, and fit kinds of the same frame', () => {
    const r = presetRecipe(formatted(column), 'column')
    const other: DataTable = { ...sampleTable('column'), name: 'Other' }
    const spec = recipeLayers(r, other, 'Bars SEM')
    expect(spec.preset).toBe(userPresetId('Bars SEM'))
    const g = newGraphNode(other, spec, 'From my preset')
    expect(() => GraphNodeSchema.parse(g)).not.toThrow()
    // Audit 3 (RTA-12): the layers a new graph starts with (solid bars).
    expect(g.layers).toEqual(newLayerLooks(r.layers))
    expect(layoutGraph({ project: projectOf(other, g), graph: g, fonts }).warnings).toEqual([])
    // Change layers: the keep-formats rule applies (the graph's own bar fill stays).
    const mine = presetGraph(other, 'points')
    const fill = { type: 'solid' as const, color: { rgb: '#123456' }, opacity: 1 }
    const changed = withLayers(
      {
        ...mine,
        layers: [
          { id: 'bars', geom: 'bar', stat: { kind: 'summary', center: 'mean' }, style: { fill } },
        ],
      },
      spec,
      other,
    )
    expect(changed.layers[0]!.style).toEqual({ fill, width: 0.5 })
    expect(changed.preset).toBe('user:Bars SEM')
    // Kinds: column bars fit nested and multiple-variables tables (category frames), not XY.
    expect(presetFits(r, 'nested')).toBe(true)
    expect(presetFits(r, 'xy')).toBe(false)
    expect(presetFits(r, 'grouped')).toBe(false)
  })

  it('a default per table kind, only where it fits', () => {
    const r = presetRecipe(presetGraph(column, 'boxPoints'), 'column')
    const xy = presetRecipe(presetGraph(sampleTable('xy'), 'envelope'), 'xy')
    const presets = [
      { name: 'Box', created: '', appVersion: '', recipe: r, isDefault: true },
      { name: 'Band', created: '', appVersion: '', recipe: xy },
    ]
    expect(defaultUserPreset(presets, 'column')?.name).toBe('Box')
    expect(defaultUserPreset(presets, 'nested')).toBeUndefined()
    expect(defaultUserPreset(presets, 'xy')).toBeUndefined()
    expect(userPresetsFor(presets, 'xy').map((p) => p.name)).toEqual(['Band'])
    expect(userPresetsFor(presets, 'column').map((p) => p.name)).toEqual(['Box'])
  })
})
