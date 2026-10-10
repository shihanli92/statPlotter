import type { GraphLook, LayoutNode, NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  fromPoints,
  JOURNAL_WIDTHS,
  layoutGraph,
  layoutGraphAtWidth,
  layoutPage,
  type Scene,
  type SceneNode,
  sceneAtWidth,
  smallestText,
  widthInPoints,
} from '../src/index.ts'
import { graphOf, PRESET_OF_LOOK } from './graphs.ts'
import { fonts, projectOf, sampleTable } from './helpers.ts'

/** Every font size drawn, sorted, without duplicates. */
function textSizes(scene: Scene): number[] {
  const out = new Set<number>()
  const walk = (n: SceneNode) => {
    if (n.prim?.type === 'text') for (const r of n.prim.layout.runs) out.add(r.size)
    for (const c of n.children ?? []) walk(c)
  }
  walk(scene.root)
  return [...out].sort((a, b) => a - b)
}

/** A new graph (id `g1`) of a sample table in the preset that draws a look. */
function ctxOf(kind: Parameters<typeof sampleTable>[0], look: GraphLook, scale?: number) {
  const table = sampleTable(kind)
  const g = graphOf(table, PRESET_OF_LOOK[look])
  const graph = scale ? { ...g, size: { ...g.size, scale } } : g
  return { project: projectOf(table, graph), graph, fonts }
}

describe('export size', () => {
  it('converts widths to points; percentages of the natural width; clamped', () => {
    expect(widthInPoints({ unit: 'mm', value: 85 }, 300)).toBeCloseTo(240.945, 3)
    expect(widthInPoints({ unit: 'cm', value: 2.54 }, 300)).toBeCloseTo(72, 9)
    expect(widthInPoints({ unit: 'in', value: 2 }, 300)).toBe(144)
    expect(widthInPoints({ unit: 'pt', value: 100 }, 300)).toBe(100)
    expect(widthInPoints({ unit: '%', value: 50 }, 300)).toBe(150)
    expect(widthInPoints({ unit: 'pt', value: 0 }, 300)).toBe(7.2)
    expect(widthInPoints({ unit: 'in', value: 1000 }, 300)).toBe(7200)
    expect(JOURNAL_WIDTHS.map((j) => j.mm)).toEqual([85, 114, 174])
    expect(fromPoints(240.945, 'mm')).toBe(85)
    expect(fromPoints(100, 'in')).toBe(1.39)
    expect(fromPoints(100, 'cm')).toBe(3.53)
  })

  it.each([
    ['xy', 'xy.scatter', undefined],
    ['column', 'column.bar', undefined],
    ['grouped', 'grouped.bar', 1.5],
    ['partsOfWhole', 'whole.pie', undefined],
  ] as const)(
    'keep text size: %s %s (scale %s) laid out at each journal width',
    (kind, type, scale) => {
      const ctx = ctxOf(kind, type, scale)
      const natural = layoutGraph(ctx)
      for (const { mm } of JOURNAL_WIDTHS) {
        const width = widthInPoints({ unit: 'mm', value: mm }, natural.width)
        const scene = layoutGraphAtWidth(ctx, width)
        expect(scene.width).toBeCloseTo(width, 1)
        // The height follows the graph's proportions.
        expect(scene.height).toBeCloseTo((natural.height * width) / natural.width, 1)
        // Fonts unchanged: the plot took the difference.
        expect(textSizes(scene)).toEqual(textSizes(natural))
        expect(Math.sign(scene.plot.w - natural.plot.w)).toBe(Math.sign(width - natural.width))
      }
      // The document's graph is untouched.
      expect(ctx.graph.size).toEqual(ctxOf(kind, type, scale).graph.size)
    },
  )

  it('keep text size: narrower than the margins allow, the rest is scaled', () => {
    const ctx = ctxOf('xy', 'xy.scatter')
    const scene = layoutGraphAtWidth(ctx, 30)
    expect(scene.width).toBeCloseTo(30, 6)
    expect(smallestText(scene)!).toBeLessThan(smallestText(layoutGraph(ctx))!)
  })

  it('scale everything: every length in proportion', () => {
    const natural = layoutGraph(ctxOf('column', 'column.scatter'))
    const scene = sceneAtWidth(natural, natural.width / 2)
    expect(scene.width).toBeCloseTo(natural.width / 2, 9)
    expect(scene.height).toBeCloseTo(natural.height / 2, 9)
    expect(textSizes(scene)).toEqual(textSizes(natural).map((s) => s / 2))
    expect(sceneAtWidth(natural, natural.width)).toBe(natural)
    // With a relayout, that is used instead.
    expect(sceneAtWidth(natural, 100, () => scene)).toBe(scene)
  })

  it('the smallest text includes placed subtrees’ scales (layout pages)', () => {
    const ctx = ctxOf('xy', 'xy.scatter')
    const graphMin = smallestText(layoutGraph(ctx))!
    expect(graphMin).toBeGreaterThan(0)
    const layout = {
      kind: 'layout',
      id: 'l1' as NodeId,
      name: 'Figure',
      page: { width: 612, height: 792 },
      items: [{ type: 'graph', id: 'i1', graph: 'g1', x: 36, y: 36, scale: 0.5 }],
      panelLabels: { show: false, style: 'A', size: 14 },
    } as unknown as LayoutNode
    const page = layoutPage({ project: { ...ctx.project }, layout, fonts })
    expect(smallestText(page)).toBeCloseTo(graphMin / 2, 9)
    expect(smallestText(sceneAtWidth(page, 306))).toBeCloseTo(graphMin / 4, 9)
    expect(smallestText({ ...page, root: { id: 'empty' } })).toBeNull()
  })
})
