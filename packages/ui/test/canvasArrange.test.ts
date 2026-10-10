import { createGraphFor, layoutGraph, type Scene, type SceneNode } from '@ps/graph'
import { type Annotation, createTable, type GraphNode } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import { dragOutcome } from '../src/graph/canvasDrag.ts'
import {
  applyDrag,
  commitOf,
  dragTargetOf,
  pointLabelAt,
  resetPositionOf,
  selectedDragTarget,
  selectionOf,
  tickLabelSelection,
} from '../src/graph/canvasEdit.ts'
import { elementBox, homeBox, snapElementMove } from '../src/graph/canvasSnap.ts'
import {
  anchorPoint,
  MIN_PLOT,
  RESIZE_HANDLES,
  resizeAnchor,
  resizeHandles,
  resizePlot,
  resizeReadout,
  SIZE_STEP,
  scaleForResize,
  sizeTargets,
} from '../src/graph/resize.ts'
import { snapBox } from '../src/layout/snap.ts'

// Roadmap 22: arranging a graph on its canvas (resize handles, moving elements, snapping).

function setup() {
  const table = createTable({ tableKind: 'column', columns: 3, rows: 3 })
  table.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = [1 + i, 2 + i, 4 + 2 * i]
  })
  const [a, b, c] = table.dataSets.map((d) => d.id)
  const bracket = (id: string, from: string, to: string): Annotation => ({
    type: 'bracket',
    id: id as never,
    a: from,
    b: to,
    label: { source: 'manual', text: '*' },
    level: 'auto',
  })
  const base = createGraphFor(table)
  const graph: GraphNode = {
    ...base,
    name: 'Panel A',
    title: { content: [{ text: 'Growth' }] },
    axes: {
      ...base.axes,
      x: { ...base.axes.x, title: { content: [{ text: 'Group' }] } },
      y: { ...base.axes.y, title: { content: [{ text: 'Response' }] } },
    },
    annotations: [bracket('b1', a!, b!), bracket('b2', a!, c!)],
  }
  const project = projectOf(table, graph)
  const lay = (g: GraphNode) => layoutGraph({ project, graph: g, fonts })
  return { project, table, graph, lay, scene: lay(graph) }
}

describe('snapping a moved box', () => {
  const box = { x: 100, y: 50, w: 40, h: 10 }
  it('lines a box up on the nearest target line within the threshold, centres first', () => {
    const r = snapBox(box, 7, 0, { x: [{ v: 130, a: 0, b: 200 }], y: [] }, 4)
    // Centre at 127 → 130.
    expect(r.dx).toBe(10)
    expect(r.guides).toEqual([{ axis: 'x', at: 130, from: 0, to: 200 }])
    expect(snapBox(box, 7, 0, { x: [{ v: 140, a: 0, b: 1 }], y: [] }, 2).dx).toBe(7)
  })

  it('restricts snap-back lines to the same edge, and moves only along allowed axes', () => {
    const home = [0, 1, 2].map((kind) => ({
      v: [100, 120, 140][kind]!,
      a: 0,
      b: 1,
      kind: kind as 0 | 1 | 2,
      rank: 3,
    }))
    // Left edge at 119: only the left home line (100) would match a left edge; the centre (139)
    // is 1 from the right home line (140) but that is not the same kind — the end edge (159) is
    // too far. So it doesn't snap.
    expect(snapBox(box, 19, 0, { x: home, y: [] }, 4).dx).toBe(19)
    expect(snapBox(box, 2, 0, { x: home, y: [] }, 4).dx).toBe(0)
    const ys = { x: [{ v: 121, a: 0, b: 1 }], y: [{ v: 57, a: 0, b: 1 }] }
    const r = snapBox(box, 0, 1, ys, 4, { x: false, y: true })
    expect([r.dx, r.dy]).toEqual([0, 2])
    expect(snapBox(box, 0, 1, ys, -1).dy).toBe(1)
  })
})

describe('resizing the plot', () => {
  const opts = { keepAspect: false, free: false, threshold: 3, others: [] }
  it('widens from the right or left edge and heightens from the top or bottom, in 0.1 in steps', () => {
    const r = resizePlot({ w: 216, h: 180 }, 'e', 30, 50, opts)
    expect(r.h).toBe(180)
    expect(r.w).toBeCloseTo(Math.round(246 / SIZE_STEP) * SIZE_STEP, 9)
    // The left edge widens leftwards, the bottom edge heightens downwards.
    expect(resizePlot({ w: 216, h: 180 }, 'w', -30, 50, opts)).toMatchObject({ w: r.w, h: 180 })
    expect(resizePlot({ w: 216, h: 180 }, 'w', 30, 0, opts).w).toBeCloseTo(187.2, 9)
    const up = resizePlot({ w: 216, h: 180 }, 'n', 40, -20, opts)
    expect(up.w).toBe(216)
    expect(up.h).toBeCloseTo(201.6, 9) // 200 → 28 × 7.2
    expect(resizePlot({ w: 216, h: 180 }, 's', 40, 20, opts).h).toBeCloseTo(201.6, 9)
    const corner = resizePlot({ w: 216, h: 180 }, 'ne', 14, 14, opts)
    expect([corner.w, corner.h]).toEqual([230.4, 165.6])
    expect(resizePlot({ w: 216, h: 180 }, 'ne', 14, 14, { ...opts, free: true })).toMatchObject({
      w: 230,
      h: 166,
    })
    // Every corner: away from the plot grows both sides.
    for (const [h, dx, dy] of [
      ['nw', -14, -14],
      ['se', 14, 14],
      ['sw', -14, 14],
    ] as const)
      expect(resizePlot({ w: 216, h: 180 }, h, dx, dy, { ...opts, free: true })).toMatchObject({
        w: 230,
        h: 194,
      })
  })

  it('keeps the proportions with Shift, and never goes below the minimum', () => {
    const r = resizePlot({ w: 200, h: 100 }, 'ne', 100, -50, { ...opts, keepAspect: true })
    expect(r.w).toBeCloseTo(302.4, 9)
    expect(r.h / r.w).toBeCloseTo(0.5, 9)
    const sw = resizePlot({ w: 200, h: 100 }, 'sw', -100, 50, { ...opts, keepAspect: true })
    expect(sw.w).toBeCloseTo(302.4, 9)
    const y = resizePlot({ w: 200, h: 100 }, 'n', 0, -50, { ...opts, keepAspect: true })
    expect(y.w / y.h).toBeCloseTo(2, 9)
    const tiny = resizePlot({ w: 200, h: 100 }, 'e', -500, 0, opts)
    expect(tiny.w).toBe(MIN_PLOT)
    const tinyAspect = resizePlot({ w: 200, h: 100 }, 'ne', -500, 500, {
      ...opts,
      keepAspect: true,
    })
    expect(tinyAspect.h).toBeGreaterThanOrEqual(MIN_PLOT - 1e-9)
  })

  it('scales text and marks with the plot area, unless the scale is kept', () => {
    const free = { ...opts, free: true }
    // Proportional: exactly the sides' ratio, as for a picture.
    const doubled = resizePlot({ w: 200, h: 100 }, 'se', 200, 100, { ...free, keepAspect: true })
    expect(doubled).toMatchObject({ w: 400, h: 200, scale: 2 })
    // One side: the square root of its ratio (the geometric mean of the sides' ratios).
    expect(resizePlot({ w: 200, h: 100 }, 'e', 200, 0, free).scale).toBeCloseTo(Math.SQRT2, 4)
    // From a scale already set, and back: the scale depends only on the area.
    const wide = resizePlot({ w: 200, h: 100 }, 'w', -100, 0, { ...free, scale: 1.2 })
    const back = resizePlot({ w: wide.w, h: wide.h }, 'n', 0, 50, { ...free, scale: wide.scale })
    expect(back.h).toBeCloseTo(50, 9)
    expect(back.scale).toBeCloseTo(1.2 * Math.sqrt((300 * 50) / (200 * 100)), 4)
    expect(scaleForResize(1.2, { w: 200, h: 100 }, { w: 200, h: 100 })).toBe(1.2)
    // ⌘ / Ctrl: the size changes, the scale doesn't.
    expect(
      resizePlot({ w: 200, h: 100 }, 'e', 200, 0, { ...free, scale: 1.5, keepScale: true }),
    ).toMatchObject({ w: 400, scale: 1.5 })
    // Within 10%–1000%.
    expect(scaleForResize(9, { w: 36, h: 36 }, { w: 2880, h: 2880 })).toBe(10)
    expect(scaleForResize(0.2, { w: 2880, h: 2880 }, { w: 36, h: 36 })).toBe(0.1)
    expect(resizeReadout({ w: 216, h: 144, scale: 1.2, matched: {} })).toBe(
      'Plot 3.00 × 2.00 in · text 120%',
    )
    expect(resizeReadout({ w: 216, h: 144, scale: 1, matched: {} }, true)).toBe(
      'Plot 3.00 × 2.00 in · text 100% (kept)',
    )
  })

  it('snaps to another graph of the same kind, and says so', () => {
    const { project, graph } = setup()
    const other: GraphNode = {
      ...graph,
      id: 'other' as never,
      name: 'Panel B',
      size: { plotWidth: 250, plotHeight: 150 },
    }
    const xy: GraphNode = {
      ...other,
      id: 'xy' as never,
      name: 'Curve',
      frame: 'xy',
      look: 'xy.scatter',
    }
    project.nodes[other.id] = other
    project.nodes[xy.id] = xy
    project.order.push(other.id, xy.id)
    const others = sizeTargets(project, graph)
    expect(others).toEqual([{ w: 250, h: 150, name: 'Panel B' }])
    const w = graph.size.plotWidth
    const r = resizePlot({ w, h: 180 }, 'e', 250 - w + 2, 0, { ...opts, others, keepScale: true })
    expect(r.w).toBe(250)
    expect(r.matched).toEqual({ w: 'Panel B' })
    expect(resizeReadout(r, true)).toBe(
      'Plot 3.47 × 2.50 in (width as “Panel B”) · text 100% (kept)',
    )
    // On a page: the graphs given, whatever their kind.
    expect(sizeTargets(project, graph, [xy.id, graph.id]).map((t) => t.name)).toEqual(['Curve'])
  })

  it('puts handles on the plot’s corners and edges; the opposite side stays put', () => {
    const { scene } = setup()
    const p = scene.plot
    const hs = resizeHandles(scene, 6)
    expect(hs.map((h) => h.handle)).toEqual(RESIZE_HANDLES)
    const at = Object.fromEntries(hs.map((h) => [h.handle, [h.x, h.y]]))
    expect(at.nw).toEqual([p.x, p.y])
    expect(at.se).toEqual([p.x + p.w, p.y + p.h])
    expect(at.e).toEqual([p.x + p.w, p.y + p.h / 2])
    expect(at.s).toEqual([p.x + p.w / 2, p.y + p.h])
    // Too short a side for an edge handle clear of the corners': none.
    expect(resizeHandles(scene, p.h / 3).map((h) => h.handle)).not.toContain('e')
    expect(resizeAnchor('w')).toEqual({ x: 1, y: 1 })
    expect(resizeAnchor('nw')).toEqual({ x: 1, y: 1 })
    expect(resizeAnchor('se')).toEqual({ x: 0, y: 0 })
    expect(resizeAnchor('ne')).toEqual({ x: 0, y: 1 })
    expect(resizeAnchor(null)).toEqual({ x: 0, y: 1 })
    expect(anchorPoint(p, 'sw')).toEqual({ x: p.x + p.w, y: p.y })
  })
})

describe('moving elements', () => {
  it('finds what a press drags: titles, tick labels, brackets, point labels', () => {
    const { graph } = setup()
    expect(dragTargetOf(['title'], graph)).toEqual({ kind: 'title' })
    expect(dragTargetOf(['axes', 'y', 'title'], graph)).toEqual({ kind: 'axisTitle', axis: 'y' })
    expect(dragTargetOf(['axes', 'x', 'tickLabels'], graph)).toEqual({
      kind: 'tickLabels',
      axis: 'x',
    })
    expect(dragTargetOf(['axes', 'x'], graph)).toBeNull()
    expect(dragTargetOf(['axes', 'y2', 'title'], graph)).toBeNull()
    expect(dragTargetOf(['annotations', 1], graph)).toEqual({ kind: 'bracket', index: 1 })
    expect(dragTargetOf(['pointLabel', 'ds', 'r2'], graph)).toEqual({
      kind: 'pointLabel',
      dataSet: 'ds',
      point: 'r2',
    })
    expect(selectionOf({ kind: 'tickLabels', axis: 'y' })).toEqual(['axes', 'y', 'tickLabels'])
    expect(dragTargetOf(['title'], { ...graph, title: null })).toBeNull()
  })

  it('stores moves as offsets and commits each as one edit', () => {
    const { graph, scene } = setup()
    const t = applyDrag(graph, scene, { kind: 'title' }, 5.004, -3)
    expect(t.titleOffset).toEqual({ dx: 5, dy: -3 })
    expect(commitOf(t, { kind: 'title' })).toEqual({
      path: ['titleOffset'],
      value: { dx: 5, dy: -3 },
      label: 'Move graph title',
    })
    // Back to zero: no offset at all.
    expect(applyDrag(t, scene, { kind: 'title' }, -5, 3).titleOffset).toBeUndefined()
    // Tick labels across the axis only: down for X, left for Y.
    const x = applyDrag(graph, scene, { kind: 'tickLabels', axis: 'x' }, 30, 6)
    expect(x.axes.x.tickLabelOffset).toBe(6)
    const y = applyDrag(graph, scene, { kind: 'tickLabels', axis: 'y' }, -4, 30)
    expect(y.axes.y.tickLabelOffset).toBe(4)
    expect(commitOf(y, { kind: 'tickLabels', axis: 'y' }).path).toEqual([
      'axes',
      'y',
      'tickLabelOffset',
    ])
    const at = applyDrag(graph, scene, { kind: 'axisTitle', axis: 'x' }, 2, 3)
    expect(at.axes.x.titleOffset).toEqual({ dx: 2, dy: 3 })
    // Brackets up and down.
    const b = applyDrag(graph, scene, { kind: 'bracket', index: 1 }, 20, -7)
    const moved = b.annotations[1]!
    expect(moved.type === 'bracket' && moved.offset).toBe(-7)
    expect(commitOf(b, { kind: 'bracket', index: 1 })).toMatchObject({
      path: ['annotations', 1, 'offset'],
      value: -7,
      label: 'Move bracket',
    })
  })

  it('resets what was moved', () => {
    const { graph, scene } = setup()
    let g = applyDrag(graph, scene, { kind: 'axisTitle', axis: 'y' }, -5, 0)
    g = applyDrag(g, scene, { kind: 'tickLabels', axis: 'y' }, -3, 0)
    expect(resetPositionOf(g, ['axes', 'y', 'title'])).toEqual([['axes', 'y', 'titleOffset']])
    expect(resetPositionOf(g, ['axes', 'y'])).toEqual([
      ['axes', 'y', 'titleOffset'],
      ['axes', 'y', 'tickLabelOffset'],
    ])
    expect(resetPositionOf(g, ['title'])).toEqual([])
    expect(resetPositionOf(g, ['legend'])).toEqual([])
    expect(resetPositionOf(g, null)).toEqual([])
  })

  it('drills from a selected axis to its tick labels', () => {
    const labels = ['axes', 'x', 'tickLabels']
    expect(tickLabelSelection(['axes', 'x'], labels, null)).toEqual(['axes', 'x'])
    expect(tickLabelSelection(['axes', 'x'], labels, ['axes', 'x'])).toEqual(labels)
    expect(tickLabelSelection(['axes', 'x'], labels, labels)).toEqual(labels)
    expect(tickLabelSelection(['axes', 'x'], labels, ['axes', 'y'])).toEqual(['axes', 'x'])
    expect(tickLabelSelection(['axes', 'x'], ['axes', 'x'], ['axes', 'x'])).toEqual(['axes', 'x'])
  })
})

describe('snapping moved elements', () => {
  it('snaps an element back onto its computed place', () => {
    const { graph, scene, lay } = setup()
    const moved = applyDrag(graph, scene, { kind: 'axisTitle', axis: 'y' }, -20, 12)
    const s = lay(moved)
    const home = homeBox(s, moved, { kind: 'axisTitle', axis: 'y' })!
    // The graph grew on the left to hold the moved title; relative to the plot, home is where
    // the title is drawn unmoved.
    const unmoved = elementBox(scene, graph, { kind: 'axisTitle', axis: 'y' })!
    expect(home.x - s.plot.x).toBeCloseTo(unmoved.x - scene.plot.x, 9)
    expect(home.y - s.plot.y).toBeCloseTo(unmoved.y - scene.plot.y, 9)
    const r = snapElementMove(s, moved, { kind: 'axisTitle', axis: 'y' }, 18.5, -13, 3)
    expect([r.dx, r.dy]).toEqual([20, -12])
    expect(r.guides.length).toBe(2)
    const back = applyDrag(moved, s, { kind: 'axisTitle', axis: 'y' }, r.dx, r.dy)
    expect(back.axes.y.titleOffset).toBeUndefined()
    // Alt: free.
    expect(snapElementMove(s, moved, { kind: 'axisTitle', axis: 'y' }, 18.5, -13, -1).dx).toBe(18.5)
  })

  it('snaps to the plot centre and levels text with other text', () => {
    const { graph, scene, lay } = setup()
    const g = applyDrag(graph, scene, { kind: 'title' }, 40, 0)
    const s = lay(g)
    const title = elementBox(s, g, { kind: 'title' })!
    const centre = s.plot.x + s.plot.w / 2
    // Home and plot centre coincide for a title: 38 back lands on either within 3.
    const r = snapElementMove(s, g, { kind: 'title' }, -38, 0, 3)
    expect(title.x + title.w / 2 + r.dx).toBeCloseTo(centre, 9)
    // The X axis title's top level with the Y axis title's bottom… or any other text edge.
    const xt = elementBox(scene, graph, { kind: 'axisTitle', axis: 'x' })!
    const yt = elementBox(scene, graph, { kind: 'axisTitle', axis: 'y' })!
    const want = yt.x - xt.x // X title's left edge onto the Y title's left edge
    const r2 = snapElementMove(scene, graph, { kind: 'axisTitle', axis: 'x' }, want + 1.5, 0, 3)
    expect(r2.dx).toBeCloseTo(want, 9)
    expect(r2.guides[0]).toMatchObject({ axis: 'x', at: yt.x })
  })

  it('moves tick labels and brackets along one axis only', () => {
    const { graph, scene } = setup()
    const r = snapElementMove(scene, graph, { kind: 'tickLabels', axis: 'x' }, 50, 9, 3)
    expect(r.dx).toBe(0)
    const b = snapElementMove(scene, graph, { kind: 'bracket', index: 0 }, 50, -9, -1)
    expect([b.dx, b.dy]).toEqual([0, -9])
  })
})

describe('dragging a point label', () => {
  // Point labels are drawn by the point-label layout (not on this branch): a synthetic scene
  // with a point's symbol (target ['seriesOverrides', dataSet], point key) and its label (target
  // ['pointLabel', dataSet, pointKey], with a bbox).
  const scene: Scene = {
    width: 200,
    height: 200,
    plot: { x: 20, y: 20, w: 160, h: 160 },
    warnings: [],
    root: {
      id: 'graph',
      target: [],
      children: [
        {
          id: 'series/ds',
          target: ['seriesOverrides', 'ds'],
          children: [
            {
              id: 'series/ds/point/3',
              point: 'r3',
              prim: {
                type: 'symbol',
                shape: 'circle',
                cx: 100,
                cy: 80,
                size: 6,
                stroke: null,
                fill: null,
              },
            },
          ],
        },
        {
          id: 'pointLabel/ds/r3',
          target: ['pointLabel', 'ds', 'r3'],
          bbox: { x: 106, y: 66, w: 30, h: 10 },
        } satisfies SceneNode,
      ],
    },
  }

  it('finds the label and its point, and stores the new offset from the point', () => {
    const { graph } = setup()
    const at = pointLabelAt(scene, 'ds', 'r3')!
    expect(at.point).toEqual({ x: 100, y: 80 })
    const t = dragTargetOf(['pointLabel', 'ds', 'r3'], graph)!
    // Label centre (121, 71) moved by (4, -6): offset (25, -15) from the point.
    const g = applyDrag(graph, scene, t, 4, -6)
    expect(g.pointOverrides?.ds?.r3?.labelOffset).toEqual({ dx: 25, dy: -15 })
    expect(commitOf(g, t)).toEqual({
      path: ['pointOverrides', 'ds', 'r3', 'labelOffset'],
      value: { dx: 25, dy: -15 },
      label: 'Move point label',
    })
    expect(resetPositionOf(g, ['pointLabel', 'ds', 'r3'])).toEqual([
      ['pointOverrides', 'ds', 'r3', 'labelOffset'],
    ])
    expect(resetPositionOf(g, ['pointOverrides', 'ds', 'r3'])).toHaveLength(1)
    expect(elementBox(scene, graph, t)).toEqual({ x: 106, y: 66, w: 30, h: 10 })
    expect(pointLabelAt(scene, 'ds', 'r9')).toBeNull()
    // Dragging a label selects its point; arrow keys on a selected point nudge its label.
    expect(selectionOf(t)).toEqual(['pointOverrides', 'ds', 'r3'])
    expect(selectedDragTarget(['pointOverrides', 'ds', 'r3'], graph)).toEqual(t)
  })

  it('reads the point from the label node’s own relative offset when the layout gives one', () => {
    const { graph } = setup()
    // As the point-label layout draws them: the leader line first (same target, no bounds of
    // its own), then the label with `labelOffset` = its box centre minus the point's centre.
    const labelled: Scene = {
      ...scene,
      root: {
        id: 'graph',
        target: [],
        children: [
          {
            id: 'pointLabel/vol/r7/leader',
            target: ['pointLabel', 'vol', 'r7'],
            prim: {
              type: 'line',
              x1: 50,
              y1: 50,
              x2: 60,
              y2: 40,
              stroke: { color: '#000000', width: 0.5, dash: 'solid' },
            },
          },
          {
            id: 'pointLabel/vol/r7',
            target: ['pointLabel', 'vol', 'r7'],
            bbox: { x: 60, y: 30, w: 20, h: 10 },
            labelOffset: { dx: 20, dy: -15 },
          } as SceneNode,
        ],
      },
    }
    const at = pointLabelAt(labelled, 'vol', 'r7')!
    expect(at.point).toEqual({ x: 50, y: 50 })
    const t = dragTargetOf(['pointLabel', 'vol', 'r7'], graph)!
    // The stored offset is the node's plus the drag.
    const g = applyDrag(graph, labelled, t, -3, 2)
    expect(g.pointOverrides?.vol?.r7?.labelOffset).toEqual({ dx: 17, dy: -13 })
    expect(elementBox(labelled, graph, t)).toEqual({ x: 60, y: 30, w: 20, h: 10 })
    // A graph drawn at 200%: the offset in its own points, half what is seen.
    const scaled = { ...graph, size: { ...graph.size, scale: 2 } }
    const h = applyDrag(scaled, labelled, t, -3, 2)
    expect(h.pointOverrides?.vol?.r7?.labelOffset).toEqual({ dx: 8.5, dy: -6.5 })
  })
})

describe('a drag and its commit', () => {
  it('resizes the plot as one edit, snapping to the sizes given', () => {
    const { graph, scene } = setup()
    const w = graph.size.plotWidth
    const sizes = [{ w: w + 50, h: 99, name: 'B' }]
    const drag = { kind: 'resize', handle: 'e', dx: 51, dy: 0, free: false, aspect: false } as const
    const o = dragOutcome(graph, scene, drag, { threshold: 3, sizes })
    expect(o.graph.size.plotWidth).toBe(w + 50)
    const scale = Math.round(Math.sqrt((w + 50) / w) * 1e4) / 1e4
    expect(o.commit).toEqual({
      path: ['size'],
      value: { plotWidth: w + 50, plotHeight: graph.size.plotHeight, scale },
      label: 'Resize graph',
    })
    expect(o.readout).toContain('width as “B”')
    expect(o.readout).toContain(`text ${+(scale * 100).toFixed(1)}%`)
    const free = dragOutcome(graph, scene, { ...drag, free: true }, { threshold: 3, sizes })
    expect(free.graph.size.plotWidth).toBe(w + 51)
    // ⌘ / Ctrl: no scale at all (absent = 100%).
    const kept = dragOutcome(graph, scene, { ...drag, keepScale: true }, { threshold: 3, sizes })
    expect(kept.commit.value).toEqual({ plotWidth: w + 50, plotHeight: graph.size.plotHeight })
    expect(kept.readout).toContain('text 100% (kept)')
  })

  it('moves elements of a scaled graph by what is seen, storing unscaled offsets', () => {
    const { graph: g0, lay } = setup()
    const graph: GraphNode = {
      ...g0,
      size: { plotWidth: g0.size.plotWidth * 2, plotHeight: g0.size.plotHeight * 2, scale: 2 },
    }
    const scene = lay(graph)
    // A 10 pt drag on the canvas is a 5 pt offset of the graph's own.
    const t = applyDrag(graph, scene, { kind: 'title' }, 10, -4)
    expect(t.titleOffset).toEqual({ dx: 5, dy: -2 })
    const moved = lay(t)
    const before = elementBox(scene, graph, { kind: 'title' })!
    const after = elementBox(moved, t, { kind: 'title' })!
    // (Relative to the plot: a title moved past the margin grows the graph above.)
    expect(after.x - moved.plot.x - (before.x - scene.plot.x)).toBeCloseTo(10, 6)
    expect(after.y - moved.plot.y - (before.y - scene.plot.y)).toBeCloseTo(-4, 6)
    // Its computed place is found back through the scale, so it snaps home.
    const home0 = homeBox(moved, t, { kind: 'title' })!
    expect(home0.x - moved.plot.x).toBeCloseTo(before.x - scene.plot.x, 6)
    expect(home0.y - moved.plot.y).toBeCloseTo(before.y - scene.plot.y, 6)
    const home = snapElementMove(moved, t, { kind: 'title' }, -9, 3, 3)
    expect(applyDrag(t, moved, { kind: 'title' }, home.dx, home.dy).titleOffset).toBeUndefined()
    // A bracket and tick labels too.
    const b = applyDrag(graph, scene, { kind: 'bracket', index: 0 }, 0, -8)
    expect(b.annotations[0]).toMatchObject({ offset: -4 })
    const y = applyDrag(graph, scene, { kind: 'tickLabels', axis: 'y' }, -6, 0)
    expect(y.axes.y.tickLabelOffset).toBe(3)
  })

  it('moves an element with snapping, or freely with Alt', () => {
    const { graph, scene } = setup()
    const move = {
      kind: 'move',
      target: { kind: 'bracket', index: 0 },
      dx: 0,
      dy: -1.5,
      free: false,
    } as const
    // Within the threshold of its own place: snaps back, nothing to store.
    const o = dragOutcome(graph, scene, move, { threshold: 3, sizes: [] })
    expect(o.commit).toMatchObject({ path: ['annotations', 0, 'offset'], value: undefined })
    const free = dragOutcome(graph, scene, { ...move, free: true }, { threshold: 3, sizes: [] })
    expect(free.commit.value).toBe(-1.5)
  })
})

describe('moving elements of a horizontal graph (roadmap 30)', () => {
  it('moves brackets left and right, tick labels across their axes, and snaps home', () => {
    const { graph: g, lay } = setup()
    const graph: GraphNode = { ...g, style: { ...g.style, orientation: 'horizontal' } }
    const scene = lay(graph)
    const b = snapElementMove(scene, graph, { kind: 'bracket', index: 0 }, 12, -9, -1)
    expect([b.dx, b.dy]).toEqual([12, 0])
    // Right is away from the data: up in the vertical sense, a negative offset.
    const moved = applyDrag(graph, scene, { kind: 'bracket', index: 0 }, 12, -9)
    const a = moved.annotations[0]!
    expect(a.type === 'bracket' && a.offset).toBe(-12)
    const after = lay(moved)
    const was = elementBox(scene, graph, { kind: 'bracket', index: 0 })!
    const now = elementBox(after, moved, { kind: 'bracket', index: 0 })!
    expect(now.x - was.x).toBeCloseTo(12, 6)
    expect(homeBox(after, moved, { kind: 'bracket', index: 0 })!.x).toBeCloseTo(was.x, 6)
    // The category (X) labels are down the left: they move sideways, away from the plot = left.
    const x = snapElementMove(scene, graph, { kind: 'tickLabels', axis: 'x' }, -6, 9, -1)
    expect([x.dx, x.dy]).toEqual([-6, 0])
    const lx = applyDrag(graph, scene, { kind: 'tickLabels', axis: 'x' }, -6, 0)
    expect(lx.axes.x.tickLabelOffset).toBe(6)
    // The value (Y) labels are along the bottom: down is away.
    const y = snapElementMove(scene, graph, { kind: 'tickLabels', axis: 'y' }, 5, 4, -1)
    expect([y.dx, y.dy]).toEqual([0, 4])
    const ly = applyDrag(graph, scene, { kind: 'tickLabels', axis: 'y' }, 0, 4)
    expect(ly.axes.y.tickLabelOffset).toBe(4)
    const home = homeBox(lay(ly), ly, { kind: 'tickLabels', axis: 'y' })!
    expect(home.y).toBeCloseTo(elementBox(scene, graph, { kind: 'tickLabels', axis: 'y' })!.y, 6)
  })
})
