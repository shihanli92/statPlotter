import { builderPresetsFor, checkLayers, layoutGraph, presetGraph } from '@ps/graph'
import type { DataTable, Layer } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf, sampleVariables } from '../../graph/test/helpers.ts'
import { syntheticTable } from '../../model/test/synthetic.ts'
import {
  type BuilderAction,
  builderReducer,
  densityColored,
  initialBuilder,
} from '../src/graph/builder/builderState.ts'

// Roadmap 34g: the graph builder's density plots and dot plots — the chips of cells tables, the
// plot styles they add, points coloured by their local density.

const run = (table: DataTable, actions: BuilderAction[], from = initialBuilder(table)) =>
  actions.reduce((s, a) => builderReducer(table, s, a), from)

const cells = syntheticTable({ rows: 25_000, genes: 3, pcs: 0, cellIds: false })

describe('density plots in the graph builder', () => {
  it('offers a Density and a Dot plot chip on cells tables only', () => {
    const ids = builderPresetsFor('multipleVariables', cells).map((p) => p.id)
    expect(ids).toEqual(expect.arrayContaining(['density', 'dotPlot']))
    const small = builderPresetsFor('multipleVariables', sampleVariables()).map((p) => p.id)
    expect(small).not.toContain('density')
    expect(small).not.toContain('dotPlot')
  })

  it('the Density chip: hexagons over hidden mapped points; the Dot plot chip: genes by group', () => {
    const density = run(cells, [{ type: 'preset', id: 'density' }])
    expect(density.frame).toBe('xy')
    expect(density.layers.map((l) => [l.geom, l.visible ?? true])).toEqual([
      ['hex', true],
      ['points', false],
    ])
    expect([...checkLayers(density, 'multipleVariables').values()].every((a) => a.allowed)).toBe(
      true,
    )
    const dots = run(cells, [{ type: 'preset', id: 'dotPlot' }])
    expect(dots.frame).toBe('matrix')
    const layer = dots.layers[0] as Layer
    expect(layer.stat.kind).toBe('dotplot')
    const group = cells.dataSets.find((d) => d.id === layer.aes?.group)
    // Grouped by the clusters (a variable named like them), not the first text variable.
    expect(group?.title).toBe('cluster')
    const g = presetGraph(cells, 'dotPlot')
    const scene = layoutGraph({ project: projectOf(cells, g), graph: g, fonts })
    expect(scene.warnings).toEqual([])
  })

  it('adds contours, filled contours, images and hexagons as plot styles on cells tables', () => {
    let s = run(cells, [{ type: 'preset', id: 'bubble' }])
    for (const style of ['hexbin', 'contours', 'contourBands', 'densityImage'])
      s = builderReducer(cells, s, { type: 'toggle', style })
    expect(s.layers.map((l) => l.geom).sort()).toEqual(
      ['contour', 'contour', 'hex', 'points', 'raster'].sort(),
    )
  })

  it('colours the points by their local density in place of a colour variable, and back', () => {
    const s0 = run(cells, [{ type: 'preset', id: 'bubble' }])
    const points0 = s0.layers.find((l) => l.geom === 'points')!
    expect(points0.aes?.color).toBeDefined()
    const on = builderReducer(cells, s0, { type: 'densityColor', on: true })
    expect(densityColored(on)).toBe(true)
    const p = on.layers.find((l) => l.geom === 'points')!
    expect(p.aes?.color).toBeUndefined()
    expect(p.style).toMatchObject({ colorBy: 'density', order: 'value' })
    const off = builderReducer(cells, on, { type: 'densityColor', on: false })
    expect(densityColored(off)).toBe(false)
    const q = off.layers.find((l) => l.geom === 'points')!
    expect((q.style as { order?: string }).order).toBeUndefined()
    // Not on a graph without mapped points.
    const dots = run(cells, [{ type: 'preset', id: 'dotPlot' }])
    expect(builderReducer(cells, dots, { type: 'densityColor', on: true })).toBe(dots)
  })
})
