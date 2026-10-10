import { createTable, GraphNode as GraphNodeSchema, type Layer } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  bandwidthNrd0,
  kernelDensity,
  labelText,
  layoutGraph,
  type Scene,
  type SceneNode,
  sceneToSvg,
} from '../src/index.ts'
import { addLayers, graphOf, layerOf, withLayer, withSeriesStyle } from './graphs.ts'
import { byId, flatten, fonts, prim, projectOf } from './helpers.ts'

// Geometry of the chart types added in roadmap item 17: XY bars (histograms), violins and bar
// labels (more in the files for estimation, bubble, parts-of-whole and function graphs).

const all = (s: Scene) => flatten(s.root)

/** A labels layer (bar labels: `on` the bars) showing `value`, placed by `position`. */
const labelsLayer = (style: Record<string, unknown>, more: Partial<Layer> = {}): Layer =>
  ({
    id: 'labels',
    geom: 'label',
    stat: { kind: 'summary', center: 'mean' },
    ...more,
    ...(Object.keys(style).length ? { style } : {}),
  }) as Layer

/** A frequency-distribution-like XY table: bin centres 1, 2, 3, 4 (bin 3 empty-less), counts. */
function histogramSetup() {
  const table = createTable({ tableKind: 'xy', columns: 1, rows: 4 })
  table.x!.subcolumns[0]!.values = [1, 2, 3, 4]
  table.dataSets[0]!.subcolumns[0]!.values = [2, 5, 0, 3]
  const graph = graphOf(table, 'histogram')
  return { table, graph, project: projectOf(table, graph), key: table.dataSets[0]!.id }
}

describe('XY bars (histograms)', () => {
  it('draws touching bars a bin wide from the baseline, centred on X', () => {
    const { project, graph, key } = histogramSetup()
    const scene = layoutGraph({ project, graph, fonts })
    const x = scene.axes!.x
    const y = scene.axes!.y
    const bars = [0, 1, 2, 3].map((r) => prim(byId(scene, `series/${key}/bar/${r}`), 'rect'))
    // Bin width = spacing of the X values (1): bar r spans X ± 0.5.
    bars.forEach((b, r) => {
      expect(b.x).toBeCloseTo(x.toPx(r + 0.5), 6)
      expect(b.x + b.w).toBeCloseTo(x.toPx(r + 1.5), 6)
    })
    // Neighbours touch.
    expect(bars[0]!.x + bars[0]!.w).toBeCloseTo(bars[1]!.x, 6)
    // Heights: from zero to the count.
    expect(bars[1]!.y).toBeCloseTo(y.toPx(5), 6)
    expect(bars[1]!.y + bars[1]!.h).toBeCloseTo(y.toPx(0), 6)
    expect(bars[2]!.h).toBeCloseTo(0, 6)
    // No points in the histogram look; the X axis reaches the outer bar edges.
    expect(all(scene).filter((n) => n.id.startsWith(`series/${key}/point/`))).toHaveLength(0)
    expect(x.fromPx(scene.plot.x)).toBeLessThanOrEqual(0.5 + 1e-9)
    expect(x.fromPx(scene.plot.x + scene.plot.w)).toBeGreaterThanOrEqual(4.5 - 1e-9)
    expect(scene.warnings).toEqual([])
  })

  it('uses an explicit bin width and bar fraction, and a swatch in the legend', () => {
    const { project, graph, key } = histogramSetup()
    const g = withSeriesStyle(graph, 'bars', key, { binWidth: 0.5, width: 0.8 })
    project.nodes[g.id] = g as never
    const scene = layoutGraph({ project, graph: g, fonts })
    const x = scene.axes!.x
    const b = prim(byId(scene, `series/${key}/bar/1`), 'rect')
    expect(b.x).toBeCloseTo(x.toPx(2 - 0.2), 6)
    expect(b.w).toBeCloseTo(x.toPx(2.2) - x.toPx(1.8), 6)
    expect(byId(scene, `legend/${key}/swatch`)?.prim?.type).toBe('rect')
  })

  it('switching to another XY preset removes the bars', () => {
    const { graph, table } = histogramSetup()
    const back = applyPreset(graph, 'meanSd', table)
    expect(back.layers.some((l) => l.geom === 'bar')).toBe(false)
  })

  it('labels each bar with its count, above it', () => {
    const { project, graph, key } = histogramSetup()
    const g = addLayers(graph, [labelsLayer({ value: 'value' })])
    project.nodes[g.id] = g as never
    const scene = layoutGraph({ project, graph: g, fonts })
    const label = byId(scene, `series/${key}/label/1`)!
    const bar = prim(byId(scene, `series/${key}/bar/1`), 'rect')
    expect(
      prim(label, 'text')
        .layout.runs.map((r) => r.text)
        .join(''),
    ).toBe('5')
    expect(label.bbox!.y + label.bbox!.h).toBeLessThanOrEqual(bar.y)
    expect(label.target).toEqual(['layers', 'labels', 'series', key])
  })
})

describe('violins', () => {
  it("bandwidth follows R's bw.nrd0", () => {
    const x = [1.2, 3.4, 2.2, 5.1, 4.4, 3.3, 2.9, 6.0, 1.1, 3.8]
    // R 4.x: bw.nrd0(x); mean(dnorm((3 - x) / bw)) / bw
    expect(bandwidthNrd0(x)).toBeCloseTo(0.79458247672412397, 14)
    expect(kernelDensity(x, bandwidthNrd0(x), 3)).toBeCloseTo(0.22022594553083941, 14)
    // No spread: falls back to |x1| (R: bw.nrd0(c(5, 5, 5)) = 3.6123370279210381).
    expect(bandwidthNrd0([5, 5, 5])).toBeCloseTo(3.6123370279210381, 13)
  })

  function violinSetup(extent: 'truncated' | 'extended' = 'truncated') {
    const table = createTable({ columns: 2, rows: 10 })
    table.dataSets[0]!.subcolumns[0]!.values = [1.2, 3.4, 2.2, 5.1, 4.4, 3.3, 2.9, 6.0, 1.1, 3.8]
    table.dataSets[1]!.subcolumns[0]!.values = [5, 6, 7, 8, 9, 6.5, 7.5, 7, null, null]
    let graph = graphOf(table, 'violin')
    graph = withLayer(graph, 'violin', {
      stat: { ...layerOf<'violin'>(graph, 'violin').stat, extent },
    })
    return { table, graph, project: projectOf(table, graph), key: table.dataSets[0]!.id }
  }

  it('draws a symmetric outline from the smallest to the largest value, widest at the mode', () => {
    const { project, graph, key } = violinSetup()
    expect(graph.look).toBe('column.box')
    const scene = layoutGraph({ project, graph, fonts })
    const y = scene.axes!.y
    const poly = prim(byId(scene, `series/${key}/box`), 'polygon')
    const ys = poly.points.map((p) => p[1])
    expect(Math.min(...ys)).toBeCloseTo(y.toPx(6.0), 6)
    expect(Math.max(...ys)).toBeCloseTo(y.toPx(1.1), 6)
    // Mirror image about the column centre.
    const xs = poly.points.map((p) => p[0])
    const cx = scene.axes!.x.toPx(0)
    expect(Math.max(...xs) - cx).toBeCloseTo(cx - Math.min(...xs), 6)
    // Widest point = the bar width (60% of the column).
    const band = scene.plot.w / 2
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.6 * band, 6)
    // Median line (solid) and dashed quartile lines, across the violin at those values.
    const med = prim(byId(scene, `series/${key}/center`), 'line')
    expect(med.y1).toBeCloseTo(y.toPx(3.35), 6)
    expect(med.x2 - med.x1).toBeGreaterThan(0)
    expect(med.x2 - med.x1).toBeLessThanOrEqual(0.6 * band + 1e-9)
    const q1 = prim(byId(scene, `series/${key}/box/q1`), 'line')
    expect(q1.stroke.dash).toBe('dash')
    expect(scene.warnings).toEqual([])
  })

  it('extended violins reach three bandwidths past the data (and the axis follows)', () => {
    const { project, graph, key } = violinSetup('extended')
    const scene = layoutGraph({ project, graph, fonts })
    const y = scene.axes!.y
    const bw = bandwidthNrd0([1.2, 3.4, 2.2, 5.1, 4.4, 3.3, 2.9, 6.0, 1.1, 3.8])
    const ys = prim(byId(scene, `series/${key}/box`), 'polygon').points.map((p) => p[1])
    expect(Math.min(...ys)).toBeCloseTo(y.toPx(6 + 3 * bw), 6)
    expect(y.fromPx(scene.plot.y)).toBeGreaterThanOrEqual(6 + 3 * bw - 1e-9)
  })

  it('grouped violins, one per cell, and a warning without raw data', () => {
    const table = createTable({
      tableKind: 'grouped',
      columns: 2,
      rows: 2,
      yFormat: { type: 'replicates', count: 4 },
    })
    table.dataSets.forEach((d, i) => {
      d.subcolumns.forEach((c, k) => {
        c.values = [1 + i + k * 0.7, 4 + i + k * 0.3]
      })
    })
    const graph = graphOf(table, 'violinPoints')
    const project = projectOf(table, graph)
    const scene = layoutGraph({ project, graph, fonts })
    const key = table.dataSets[1]!.id
    expect(prim(byId(scene, `series/${key}/box/1`), 'polygon').points.length).toBeGreaterThan(10)
    expect(byId(scene, `series/${key}/box/1`)!.point).toBe('r1')
    expect(all(scene).filter((n) => n.id.startsWith(`series/${key}/point/`)).length).toBe(8)

    const summary = createTable({ yFormat: { type: 'summary', preset: 'meanSdN' }, columns: 1 })
    summary.dataSets[0]!.subcolumns.forEach((c, i) => {
      c.values = [[5, 1, 4][i]!]
    })
    const g2 = graphOf(summary, 'violin')
    const s2 = layoutGraph({ project: projectOf(summary, g2), graph: g2, fonts })
    expect(s2.warnings.join(' ')).toMatch(/violin plots need raw data/)
  })

  it('is valid in the schema and exports', () => {
    const { project, graph } = violinSetup()
    expect(() => GraphNodeSchema.parse(graph)).not.toThrow()
    expect(sceneToSvg(layoutGraph({ project, graph, fonts }))).toContain('<polygon')
  })
})

describe('bar labels', () => {
  function barSetup(label: Record<string, unknown>) {
    const table = createTable({ columns: 2, rows: 4 })
    table.dataSets[0]!.subcolumns[0]!.values = [10, 12, 14, 16]
    table.dataSets[1]!.subcolumns[0]!.values = [20, 22, 24, null]
    const graph = addLayers(graphOf(table, 'bars'), [labelsLayer(label, { on: 'bars' })])
    return { table, graph, project: projectOf(table, graph) }
  }
  const text = (n: SceneNode | undefined) =>
    prim(n, 'text')
      .layout.runs.map((r) => r.text)
      .join('')

  it('shows the mean above the bar and its error bar', () => {
    const { project, graph, table } = barSetup({})
    const scene = layoutGraph({ project, graph, fonts })
    const key = table.dataSets[0]!.id
    const label = byId(scene, `series/${key}/label`)!
    expect(text(label)).toBe('13')
    const err = byId(scene, `series/${key}/error`)!
    expect(label.bbox!.y + label.bbox!.h).toBeLessThanOrEqual(err.bbox!.y)
  })

  it('n with its prefix, inside the bar, and a fixed format', () => {
    const { project, graph, table } = barSetup({ value: 'n', position: 'inside' })
    const scene = layoutGraph({ project, graph, fonts })
    const key = table.dataSets[1]!.id
    const label = byId(scene, `series/${key}/label`)!
    expect(text(label)).toBe('n = 3')
    const bar = prim(byId(scene, `series/${key}/bar`), 'rect')
    expect(label.bbox!.y).toBeGreaterThan(bar.y)
    expect(labelText({ stat: 'mean', format: { mode: 'fixed', digits: 2 } }, 13)).toEqual([
      { text: '13.00' },
    ])
    expect(labelText({ stat: 'mean', format: { mode: 'auto' } }, 0.012345)).toEqual([
      { text: '0.0123' },
    ])
  })

  it('grouped bars get a label per cell, and brackets go above labels', () => {
    const table = createTable({
      tableKind: 'grouped',
      columns: 2,
      rows: 2,
      yFormat: { type: 'replicates', count: 2 },
    })
    table.dataSets.forEach((d, i) => {
      d.subcolumns.forEach((c, k) => {
        c.values = [2 + i + k, 5 + i + k]
      })
    })
    const bars = graphOf(table, 'bars')
    const graph = addLayers(bars, [
      labelsLayer({ value: 'median' }, { on: 'bars', position: { kind: 'dodge' } }),
    ])
    const scene = layoutGraph({ project: projectOf(table, graph), graph, fonts })
    const key = table.dataSets[0]!.id
    expect(text(byId(scene, `series/${key}/label/1`))).toBe('5.5')
    expect(byId(scene, `series/${key}/label/1`)!.point).toBe('r1')
  })
})
