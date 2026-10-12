import { GraphNode, type Layer } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  graphScale,
  layoutGraph,
  presetsFor,
  type Scene,
  sceneToSvg,
  unscaledGraph,
} from '../src/index.ts'
import { addLayers, graphOf as presetGraphOf } from './graphs.ts'
import { fonts, projectOf, sampleTable, TABLE_KINDS } from './helpers.ts'

// Roadmap 23: a graph's scale multiplies everything it draws, exactly.

/**
 * Numbers that aren't lengths: rotation angles, opacities, placed subtrees' own scale, paths, a
 * dendrogram's hover facts (merge heights, counts, clusters: roadmap 49c).
 */
const NOT_LENGTHS = new Set(['angle', 'opacity', 'scale', 'target', 'tree'])

/** Expects every length in `b` to be `s` times the one in `a`, and everything else equal. */
function expectScaled(a: unknown, b: unknown, s: number, path = ''): void {
  if (typeof a === 'number') {
    expect(typeof b, path).toBe('number')
    const want = a * s
    expect(Math.abs((b as number) - want), path).toBeLessThanOrEqual(
      1e-9 * Math.max(1, Math.abs(want)),
    )
    return
  }
  if (a === null || typeof a !== 'object') {
    expect(b, path).toEqual(a)
    return
  }
  expect(b !== null && typeof b === 'object', path).toBe(true)
  if (Array.isArray(a)) {
    expect((b as unknown[]).length, path).toBe(a.length)
    for (const [i, v] of a.entries()) expectScaled(v, (b as unknown[])[i], s, `${path}[${i}]`)
    return
  }
  const bo = b as Record<string, unknown>
  expect(Object.keys(bo).sort(), path).toEqual(Object.keys(a).sort())
  for (const [k, v] of Object.entries(a)) {
    if (typeof v === 'function') continue
    if (NOT_LENGTHS.has(k)) expect(bo[k], `${path}.${k}`).toEqual(v)
    else expectScaled(v, bo[k], s, `${path}.${k}`)
  }
}

const sceneData = (sc: Scene) => ({
  width: sc.width,
  height: sc.height,
  plot: sc.plot,
  root: sc.root,
  warnings: sc.warnings,
})

function graphOf(kind: (typeof TABLE_KINDS)[number], preset: string) {
  const table = sampleTable(kind)
  return { table, graph: presetGraphOf(table, preset) }
}

describe('scaling a graph', () => {
  const cases = TABLE_KINDS.flatMap((kind) => presetsFor(kind).map(({ id }) => ({ kind, id })))
  it.each(cases)('$kind as $id: the scaled scene is the unscaled one × s', ({ kind, id }) => {
    const { table, graph } = graphOf(kind, id)
    const s = 1.37
    const scaled: GraphNode = {
      ...graph,
      size: {
        plotWidth: graph.size.plotWidth * s,
        plotHeight: graph.size.plotHeight * s,
        scale: s,
      },
    }
    const project = projectOf(table, graph)
    const a = layoutGraph({ project, graph, fonts })
    const b = layoutGraph({ project, graph: scaled, fonts })
    expectScaled(sceneData(a), sceneData(b), s)
    // Axis mappings follow.
    if (a.axes && b.axes) {
      for (const v of [0, 1, 2.5]) {
        expect(b.axes.x.toPx(v)).toBeCloseTo(a.axes.x.toPx(v) * s, 6)
        expect(b.axes.y.fromPx(a.axes.y.toPx(v) * s)).toBeCloseTo(v, 6)
      }
    }
  })

  it('scales moved elements, point labels, dashes and the legend; exports the scaled scene', () => {
    const table = { ...sampleTable('xy'), rowTitles: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'] }
    // Mean ± SD; the second data set's means also joined by a dashed line (behind the rest).
    const line: Layer = {
      id: 'line',
      geom: 'line',
      stat: { kind: 'summary', center: 'mean' },
      seriesHidden: true,
      series: {
        b: { hide: false, style: { stroke: { color: { series: true }, width: 1, dash: 'dash' } } },
      },
    }
    const base = addLayers(presetGraphOf(table, 'meanSd'), [line], 0)
    const graph: GraphNode = {
      ...base,
      title: { content: [{ text: 'Title' }] },
      titleOffset: { dx: 12, dy: -3 },
      legend: { ...base.legend, show: true, position: 'right' },
      seriesOverrides: {
        a: { pointLabels: { source: 'rowTitle', which: 'all', repel: true } },
      },
      pointOverrides: { a: { r2: { labelOffset: { dx: 20, dy: -10 } } } },
      annotations: [
        {
          type: 'text',
          id: 'n1' as never,
          anchor: { space: 'plot', x: 0.5, y: 0.5 },
          content: { content: [{ text: 'note' }] },
        } as GraphNode['annotations'][number],
      ],
    }
    const s = 0.6
    const scaled = { ...graph, size: { plotWidth: 216 * s, plotHeight: 180 * s, scale: s } }
    const project = projectOf(table, graph)
    const a = layoutGraph({
      project,
      graph: { ...graph, size: { plotWidth: 216, plotHeight: 180 } },
      fonts,
    })
    const b = layoutGraph({ project, graph: scaled, fonts })
    expectScaled(sceneData(a), sceneData(b), s)
    const svg = sceneToSvg(b)
    expect(svg).toContain(`width="${+(a.width * s).toFixed(3)}pt"`)
    expect(svg).toMatch(/stroke-dasharray="2\.4 1\.8"/)
  })

  it('reads the scale, lays out at plot size ÷ scale, and accepts only 10%–1000%', () => {
    const { graph } = graphOf('column', 'points')
    expect(graphScale(graph)).toBe(1)
    expect(unscaledGraph(graph)).toBe(graph)
    const g = { ...graph, size: { plotWidth: 300, plotHeight: 150, scale: 1.5 } }
    expect(graphScale(g)).toBe(1.5)
    expect(unscaledGraph(g).size).toEqual({ plotWidth: 200, plotHeight: 100 })
    expect(GraphNode.safeParse(g).success).toBe(true)
    for (const scale of [0.05, 11])
      expect(GraphNode.safeParse({ ...g, size: { ...g.size, scale } }).success).toBe(false)
  })
})
