import type { GraphNode, Layer, NodeId } from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import {
  layoutGraph,
  newGraphNode,
  type Scene,
  type SceneNode,
  sceneToPdf,
  sceneToSvg,
} from '../src/index.ts'
import { primFinite } from '../src/render/finite.ts'
import { cytometryTable, flatten, fonts, projectOf } from './helpers.ts'

// Audit 2 (G2): a value inside an axis break has no place on the axis (the scale gives NaN), so
// ellipse and hull fills, hexagons, contour bands and density images used to carry NaN corners
// into the scene, and the SVG and PDF writers printed them ("NaN" in a PDF content stream makes
// the file invalid). Filled shapes now place such corners at the break's edge and are cut at the
// breaks; and the writers never print a non-finite number.

const cy = cytometryTable()
const lay = (g: GraphNode): Scene => layoutGraph({ project: projectOf(cy, g), graph: g, fonts })

/** An XY graph of CD3 by CD19 with these layers and a break in Y inside the data. */
function withBreak(layers: Layer[]): GraphNode {
  const g = newGraphNode(cy, { frame: 'xy', look: 'bubble.scatter', layers })
  return {
    ...g,
    id: 'g1' as NodeId,
    axes: { ...g.axes, y: { ...g.axes.y, breaks: [{ from: 1000, to: 3000, gap: 8 }] } },
  } as GraphNode
}
const points: Layer = {
  id: 'points',
  geom: 'points',
  stat: { kind: 'identity' },
  aes: { x: 'c', y: 'd', color: 'p' },
} as Layer
const polygonsOf = (s: Scene, part: string) =>
  flatten(s.root).filter((n) => n.id.includes(part) && n.prim?.type === 'polygon')
const pdfText = (s: Scene) =>
  new TextDecoder('latin1').decode(sceneToPdf(s, fonts, { compress: false }))

const CASES: [string, Layer, string][] = [
  [
    'an ellipse fill',
    {
      id: 'ellipse',
      geom: 'polygon',
      stat: { kind: 'ellipse', type: 'norm', level: 0.95 },
    } as Layer,
    '/ellipse/fill',
  ],
  ['a hull', { id: 'hull', geom: 'polygon', stat: { kind: 'hull' } } as Layer, '/hull/fill'],
  [
    'hexagons',
    { id: 'hexes', geom: 'hex', stat: { kind: 'hexbin', bins: 12 }, aes: {} } as Layer,
    '/hex/',
  ],
  [
    'contour bands',
    {
      id: 'contours',
      geom: 'contour',
      stat: { kind: 'density2d' },
      aes: {},
      style: { draw: 'both' },
    } as Layer,
    '',
  ],
  [
    'a density image',
    { id: 'raster', geom: 'raster', stat: { kind: 'density2d' }, aes: {} } as Layer,
    '',
  ],
]

describe('axis breaks inside the data (no NaN in the scene, the SVG or the PDF)', () => {
  for (const [what, layer, part] of CASES)
    it(what, () => {
      const scene = lay(withBreak([layer, points]))
      const bad = flatten(scene.root).filter((n) => n.prim && !primFinite(n.prim))
      expect(bad.map((n) => n.id)).toEqual([])
      // The layer draws something.
      const marks = flatten(scene.root).filter((n) => n.prim && n.layer === layer.id)
      expect(marks.length).toBeGreaterThan(0)
      if (part) expect(polygonsOf(scene, part).length).toBeGreaterThan(0)
      expect(sceneToSvg(scene)).not.toMatch(/NaN|Infinity/)
      expect(pdfText(scene)).not.toMatch(/NaN|Infinity/)
    })

  it('fills are cut at the break: the parts either side of its 8 pt gap', () => {
    const scene = lay(withBreak([CASES[0]![1], CASES[1]![1], points]))
    const ys = (id: string) =>
      (
        flatten(scene.root).find((n) => n.id === id)!.prim as { points: [number, number][] }
      ).points.map((p) => p[1])
    // Group 3's ellipse and hull reach across the break: each is two parts, the gap between.
    for (const what of ['ellipse', 'hull']) {
      const [a, b] = [ys(`series/d/${what}/fill/3`), ys(`series/d/${what}/fill/1/3`)]
      const [lo, hi] = Math.min(...a) < Math.min(...b) ? [a, b] : [b, a]
      expect(Math.min(...hi) - Math.max(...lo)).toBeCloseTo(8, 6)
    }
  })
})

describe('the SVG and PDF writers', () => {
  const sceneOf = (...prims: SceneNode['prim'][]): Scene => ({
    width: 100,
    height: 100,
    root: { id: 'root', children: prims.map((prim, i) => ({ id: `n${i}`, prim })) },
    plot: { x: 0, y: 0, w: 100, h: 100 },
    warnings: [],
  })
  const stroke = { color: '#000000', width: 1, dash: 'solid' } as const

  it('drop a primitive with a non-finite number, and report it in development', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const scene = sceneOf(
      { type: 'line', x1: 0, y1: 0, x2: 10, y2: 10, stroke },
      { type: 'line', x1: 0, y1: Number.NaN, x2: 10, y2: 10, stroke },
      {
        type: 'polygon',
        points: [
          [0, 0],
          [Number.POSITIVE_INFINITY, 5],
          [5, 5],
        ],
        fill: { color: '#ff0000', opacity: 1 },
        stroke: null,
      },
    )
    const svg = sceneToSvg(scene)
    expect(svg).not.toMatch(/NaN|Infinity/)
    expect(svg.match(/<line /g)).toHaveLength(1)
    expect(svg).not.toContain('<polygon')
    const pdf = pdfText(scene)
    expect(pdf).not.toMatch(/NaN|Infinity/)
    expect(report).toHaveBeenCalled()
    report.mockRestore()
  })

  it('leave out a point cloud’s non-finite points only', () => {
    const scene = sceneOf({
      type: 'points',
      n: 3,
      x: Float64Array.from([10, Number.NaN, 30]),
      y: Float64Array.from([10, 20, 30]),
      size: Float64Array.from([4, 4, 4]),
      paint: Uint8Array.from([0, 0, 0]),
      paints: [{ shape: 'circle', stroke, fill: null }],
    } as unknown as SceneNode['prim'])
    const svg = sceneToSvg(scene)
    expect(svg).not.toMatch(/NaN/)
    expect(svg.match(/<path /g)).toHaveLength(2)
    expect(pdfText(scene)).not.toMatch(/NaN/)
  })
})
