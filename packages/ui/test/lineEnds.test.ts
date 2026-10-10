import { createGraphFor, layoutGraph, sceneToSvg } from '@ps/graph'
import {
  type Annotation,
  annotationEnds,
  createTable,
  type GraphNode,
  lineEndsOf,
  newAnnotationId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { flatten, fonts, projectOf } from '../../graph/test/helpers.ts'
import { dragOutcome } from '../src/graph/canvasDrag.ts'
import { lineEndPoint } from '../src/graph/canvasEdit.ts'

// Roadmap 32: graph line annotations share the page's arrowheads and get handles on their ends.

type Line = Extract<Annotation, { type: 'line' }>

function setup(line: Partial<Line> = {}) {
  const table = createTable({ tableKind: 'xy', columns: 1, rows: 3 })
  table.x!.subcolumns[0]!.values = [1, 2, 3]
  table.dataSets[0]!.subcolumns[0]!.values = [1, 4, 9]
  const a: Line = {
    type: 'line',
    id: newAnnotationId(),
    space: 'plot',
    from: { x: 0.1, y: 0.2 },
    to: { x: 0.5, y: 0.2 },
    stroke: { color: { rgb: '#000000' }, width: 1, dash: 'solid' },
    arrow: 'end',
    ...line,
  }
  const graph: GraphNode = { ...createGraphFor(table), annotations: [a] }
  const project = projectOf(table, graph)
  return { graph, a, scene: layoutGraph({ project, graph, fonts }) }
}

describe('line annotation heads', () => {
  it('read older files’ `arrow` as triangles, and store heads only when `arrow` can’t say them', () => {
    expect(lineEndsOf({ arrow: 'none' })).toEqual({})
    expect(lineEndsOf({ arrow: 'both' })).toEqual({
      start: { shape: 'triangle' },
      end: { shape: 'triangle' },
    })
    expect(annotationEnds({ end: { shape: 'triangle' } })).toEqual({
      arrow: 'end',
      heads: undefined,
    })
    expect(annotationEnds({ start: { shape: 'triangle' } })).toEqual({
      arrow: 'both',
      heads: { start: { shape: 'triangle' } },
    })
    const open = { end: { shape: 'open' as const, size: 2 } }
    expect(annotationEnds(open)).toEqual({ arrow: 'end', heads: open })
  })

  it('draws the heads a line has: an old arrow unchanged, other shapes as the page does', () => {
    const old = setup()
    const same = setup({ heads: { end: { shape: 'triangle' } } })
    expect(sceneToSvg(same.scene)).toBe(sceneToSvg(old.scene))
    const bar = setup({ heads: { start: { shape: 'bar' }, end: { shape: 'circle' } } })
    const kinds = flatten(bar.scene.root)
      .filter((n) => n.id.startsWith(`annotation/${bar.a.id}/arrow/`))
      .map((n) => n.prim!.type)
    expect(kinds).toEqual(['ellipse', 'line'])
  })
})

describe('line end handles', () => {
  it('move one end, snapping, or along 45° steps from the other end with Shift', () => {
    const { graph, a, scene } = setup()
    const from = lineEndPoint(scene, a, 'from')!
    const to = lineEndPoint(scene, a, 'to')!
    expect(to.y).toBeCloseTo(from.y, 9)
    const target = { kind: 'lineEnd' as const, index: 0, end: 'to' as const }
    const drag = { kind: 'move' as const, target, dx: 0, dy: 30, free: true }
    const moved = dragOutcome(graph, scene, drag, { threshold: 4, sizes: [] })
    const m = moved.graph.annotations[0] as Line
    expect(m.from).toEqual(a.from)
    expect(m.to.x).toBeCloseTo(0.5, 9)
    expect(m.to.y).toBeGreaterThan(0.2)
    expect(moved.commit).toMatchObject({ path: ['annotations', 0], label: 'Move line end' })
    // Shift: at 45° from the start.
    const dx = to.x - from.x
    const c = dragOutcome(
      graph,
      scene,
      { ...drag, dy: dx * 0.9, constrain: true },
      {
        threshold: 4,
        sizes: [],
      },
    )
    const next = c.graph.annotations[0] as Line
    // In the graph as drawn when the drag began.
    const p = lineEndPoint(scene, next, 'to')!
    expect(Math.abs(p.x - from.x)).toBeCloseTo(Math.abs(p.y - from.y), 3)
  })
})
