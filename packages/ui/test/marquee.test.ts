import {
  type Box,
  createGraphFor,
  layoutGraph,
  type PointsPrim,
  type SceneNode,
  type StylePath,
  unionBoxes,
} from '@ps/graph'
import { createTable, type GraphNode, type NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import { nodeBox } from '../src/graph/canvasEdit.ts'
import { marqueeSelect, selectedDataSets } from '../src/selection/graphSelection.ts'
import { boxBetween, cloudPointsInBox, pickInBox, picksInBox } from '../src/selection/pickInBox.ts'
import { sceneIndex } from '../src/selection/sceneKeys.ts'
import {
  EMPTY_SELECTION,
  elementKey,
  elementPaths,
  primaryPath,
  type Selection,
  selectionOf,
  single,
} from '../src/selection/selection.ts'

// Roadmap 44 (O3, decisions 860–862): the marquee's rules, shared by the graph canvas and the
// layout page (`pickInBox`), and how its picks join the selection (`marqueeSelect`).

const G = 'graph1' as NodeId
const paths = (s: Selection) => elementPaths(s, G)
const inside = { kind: 'inside' } as const

/** A column graph of three data sets (three points each), with a title and axis titles. */
function setup() {
  const table = createTable({ tableKind: 'column', columns: 3, rows: 3 })
  table.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = [1 + i, 2 + i, 4 + 2 * i]
  })
  const [A, B] = table.dataSets.map((d) => d.id as string) as [string, string]
  const base = createGraphFor(table)
  const graph: GraphNode = {
    ...base,
    id: G,
    title: { content: [{ text: 'Growth' }] },
    axes: {
      ...base.axes,
      x: { ...base.axes.x, title: { content: [{ text: 'Group' }] } },
      y: { ...base.axes.y, title: { content: [{ text: 'Response' }] } },
    },
  }
  const scene = layoutGraph({ project: projectOf(table, graph), graph, fonts })
  const { nodes } = sceneIndex(scene.root)
  const node = (id: string) => nodes.map.get(id)!
  /** The box round these nodes, `pad` points wider on every side. */
  const around = (ids: string[], pad = 1): Box => {
    const b = unionBoxes(ids.map((id) => nodeBox(node(id))))!
    return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }
  }
  const point = (ds: string, i: number) => `series/${ds}/point/${i}`
  const layer = String(node(point(A, 0)).target![1])
  return {
    scene,
    A,
    B,
    around,
    point,
    node,
    marks: (ds: string) => ['layers', layer, 'series', ds],
  }
}

describe('a box over a graph picks the elements with a mark wholly inside it', () => {
  it('a box round the title picks the title; one cutting through it, nothing', () => {
    const { scene, around } = setup()
    const b = around(['title'])
    expect(pickInBox(scene.root, b, inside)).toEqual([['title']])
    // Touching is not enough: the box stops halfway across the title.
    expect(pickInBox(scene.root, { ...b, w: b.w / 2 }, inside)).toEqual([])
    // Empty space picks nothing.
    expect(pickInBox(scene.root, { x: 0, y: 0, w: 2, h: 2 }, inside)).toEqual([])
  })

  it('a box round both axis titles picks the two', () => {
    const { scene, around } = setup()
    const picked = pickInBox(scene.root, around(['axis/y/title', 'axis/x/title']), inside)
    // The box spans the plot too, but no data mark, tick label or axis line lies wholly inside
    // it unless it does: here every element it covers whole is listed once.
    expect(picked).toContainEqual(['axes', 'y', 'title'])
    expect(picked).toContainEqual(['axes', 'x', 'title'])
    expect(new Set(picked.map((k) => JSON.stringify(k))).size).toBe(picked.length)
  })

  it('a box round the tick labels picks their group, not the axis', () => {
    const { scene, around } = setup()
    const ids = [0, 1, 2, 3, 4].map((i) => `axis/y/tickLabel/${i}`)
    expect(pickInBox(scene.root, around(ids), inside)).toEqual([['axes', 'y', 'tickLabels']])
    // One label is enough (one of its marks).
    expect(pickInBox(scene.root, around([ids[2]!]), inside)).toEqual([['axes', 'y', 'tickLabels']])
  })

  it('a box round one mark picks its data set in that layer', () => {
    const { scene, around, point, A, B, marks } = setup()
    const picked = pickInBox(scene.root, around([point(A, 2)]), inside)
    // Its symbol, and the error bar drawn at it (a mark of A in the error layer); nothing of B.
    expect(picked[0]).toEqual(marks(A))
    expect(picked.every((k) => k[0] === 'layers' && k[3] === A)).toBe(true)
    expect(picked).not.toContainEqual(marks(B))
  })

  it('the marks it picked come with the keys, the first mark of each element', () => {
    const { scene, around, point, A, marks } = setup()
    const picks = picksInBox(scene.root, around([point(A, 0), point(A, 1)]), inside)
    expect(picks.map((p) => p.key)).toEqual([marks(A)])
    expect(picks[0]!.node.id).toBe(point(A, 0))
  })

  it('backgrounds are never picked', () => {
    const root: SceneNode = {
      id: 'root',
      children: [
        {
          id: 'bg',
          target: ['style', 'background'],
          prim: { type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: null, stroke: null },
        },
        {
          id: 'plot',
          target: ['style', 'plotBackground'],
          prim: { type: 'rect', x: 2, y: 2, w: 6, h: 6, fill: null, stroke: null },
        },
        {
          id: 'frame',
          target: ['style', 'frame'],
          prim: { type: 'rect', x: 2, y: 2, w: 6, h: 6, fill: null, stroke: null },
        },
      ],
    }
    expect(pickInBox(root, { x: -1, y: -1, w: 20, h: 20 }, inside)).toEqual([['style', 'frame']])
  })
})

describe('a box picks points of the data sets asked for', () => {
  it('the points whose marks lie wholly inside, as single points', () => {
    const { scene, around, point, A, B } = setup()
    const b = around([point(A, 0), point(A, 1)])
    const rule = (dataSets: string[] | null) => ({ kind: 'points', dataSets }) as const
    expect(pickInBox(scene.root, b, rule([A]))).toEqual([
      ['pointOverrides', A, 'r0s0'],
      ['pointOverrides', A, 'r1s0'],
    ])
    expect(pickInBox(scene.root, b, rule([B]))).toEqual([])
    // Of every data set: A's two and B's point the box happens to hold, if any, never a mark
    // cut by the box.
    const all = pickInBox(scene.root, around([point(A, 0), point(B, 0)]), rule(null))
    expect(all).toContainEqual(['pointOverrides', A, 'r0s0'])
    expect(all).toContainEqual(['pointOverrides', B, 'r0s0'])
    expect(all.every((k) => k[0] === 'pointOverrides')).toBe(true)
    // Half a symbol isn't inside.
    const half = around([point(A, 0)], 0)
    expect(pickInBox(scene.root, { ...half, w: half.w / 2 }, rule([A]))).toEqual([])
  })

  /** A cloud of n × n points 2 pt apart (symbols 1 pt wide), point i keyed `r<i>s0`. */
  function cloud(side: number, outlier = -1): SceneNode {
    const n = side * side
    const prim: PointsPrim = {
      type: 'points',
      n,
      x: Float64Array.from({ length: n }, (_, i) => 10 + 2 * (i % side)),
      y: Float64Array.from({ length: n }, (_, i) => 10 + 2 * Math.floor(i / side)),
      size: new Float64Array(n).fill(1),
      paint: new Uint32Array(n),
      paints: [{ shape: 'circle', stroke: null, fill: { color: '#000', opacity: 1 } }],
      rows: Int32Array.from({ length: n }, (_, i) => i),
      point: (i) => ({ id: `series/A/point/${i}`, key: i === outlier ? '' : `r${i}s0` }),
    }
    return {
      id: 'root',
      children: [{ id: 'series/A/points', target: ['layers', 'p', 'series', 'A', 'points'], prim }],
    }
  }

  it('in a cloud, through its grid: the same points as testing every one', () => {
    const root = cloud(200)
    const prim = root.children![0]!.prim as PointsPrim
    const box = { x: 37.2, y: 101.6, w: 41, h: 13.3 }
    const brute: number[] = []
    for (let i = 0; i < prim.n; i++) {
      const [x, y] = [prim.x[i]!, prim.y[i]!]
      if (x - 0.5 >= box.x && y - 0.5 >= box.y && x + 0.5 <= box.x + box.w)
        if (y + 0.5 <= box.y + box.h) brute.push(i)
    }
    expect(brute.length).toBeGreaterThan(50)
    expect(cloudPointsInBox(prim, box)).toEqual(brute)
    const picked = pickInBox(root, box, { kind: 'points', dataSets: ['A'] })
    expect(picked).toEqual(brute.map((i) => ['pointOverrides', 'A', `r${i}s0`]))
    // As an element: the data set, once.
    expect(pickInBox(root, box, inside)).toEqual([['layers', 'p', 'series', 'A']])
    // A box between the points picks nothing.
    expect(pickInBox(root, { x: 10.6, y: 10.6, w: 0.8, h: 0.8 }, inside)).toEqual([])
  })

  it("a cloud's outliers have no key: they aren't picked alone", () => {
    const root = cloud(3, 4)
    const picked = pickInBox(
      root,
      { x: 0, y: 0, w: 100, h: 100 },
      { kind: 'points', dataSets: null },
    )
    expect(picked).toHaveLength(8)
    expect(picked).not.toContainEqual(['pointOverrides', 'A', 'r4s0'])
  })
})

describe('a box over a page picks the items it touches (decision 191)', () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })
  const items = [
    { index: 0, box: box(0, 0, 100, 100) },
    { index: 1, box: box(200, 0, 100, 100), locked: true },
    { index: 2, box: box(0, 200, 100, 100), group: 'g' },
    { index: 3, box: box(400, 400, 50, 50), group: 'g' },
    { index: 4, box: box(200, 200, 100, 100), group: 'h' },
    { index: 5, box: box(600, 0, 10, 10), group: 'h', locked: true },
  ]
  const touch = { kind: 'touch' } as const

  it('touching is enough; sharing an edge is not', () => {
    expect(pickInBox(items, box(90, 90, 20, 5), touch)).toEqual([0])
    expect(pickInBox(items, box(100, 0, 50, 50), touch)).toEqual([])
  })

  it('locked items are passed by', () => {
    expect(pickInBox(items, box(150, 10, 100, 10), touch)).toEqual([])
    expect(pickInBox(items, box(50, 10, 200, 10), touch)).toEqual([0])
  })

  it('a group is picked whole, its locked members too', () => {
    expect(pickInBox(items, box(10, 210, 5, 5), touch)).toEqual([2, 3])
    expect(pickInBox(items, box(210, 210, 5, 5), touch)).toEqual([4, 5])
    // A locked member alone picks nothing.
    expect(pickInBox(items, box(601, 1, 5, 5), touch)).toEqual([])
  })

  it('the box between two corners, either way round', () => {
    expect(boxBetween({ x: 10, y: 20 }, { x: 4, y: 2 })).toEqual({ x: 4, y: 2, w: 6, h: 18 })
  })
})

describe('what a marquee picked joins the selection (decision 862)', () => {
  const k = (p: StylePath) => elementKey(G, p)
  const A = ['layers', 'p', 'series', 'A']
  const B = ['layers', 'p', 'series', 'B']
  const pt = (ds: string, i: number) => ['pointOverrides', ds, `r${i}s0`]
  const elements = { additive: false, points: false }
  const points = { additive: false, points: true }

  it('elements replace the selection, or with Shift / ⌘ join it', () => {
    const was = single(k(['title']))
    const picked = [
      ['axes', 'y', 'title'],
      ['axes', 'x', 'title'],
    ]
    const s = marqueeSelect(was, G, picked, elements)
    expect(paths(s)).toEqual(picked)
    expect(primaryPath(s)).toEqual(['axes', 'x', 'title'])
    expect(paths(marqueeSelect(was, G, picked, { ...elements, additive: true }))).toEqual([
      ['title'],
      ...picked,
    ])
    // Nothing picked: cleared, unless adding.
    expect(marqueeSelect(was, G, [], elements)).toBe(EMPTY_SELECTION)
    expect(marqueeSelect(was, G, [], { ...elements, additive: true })).toBe(was)
  })

  it('a data set added drops its selected points', () => {
    const was = selectionOf([k(pt('A', 0)), k(['title'])])
    const s = marqueeSelect(was, G, [A], { additive: true, points: false })
    expect(paths(s)).toEqual([['title'], A])
  })

  it('points replace the data set they were picked from, remembering it', () => {
    const was = selectionOf([k(['title']), k(A)])
    const s = marqueeSelect(was, G, [pt('A', 0), pt('A', 2)], points)
    expect(paths(s)).toEqual([pt('A', 0), pt('A', 2)])
    expect(s.drill).toEqual(A)
    // Adding: the other keys stay, the data set gives way to its points.
    const added = marqueeSelect(was, G, [pt('A', 1)], { additive: true, points: true })
    expect(paths(added)).toEqual([['title'], pt('A', 1)])
    expect(added.drill).toEqual(A)
    // Points of another data set leave A's key alone.
    const other = marqueeSelect(selectionOf([k(A), k(B)]), G, [pt('B', 0)], {
      additive: true,
      points: true,
    })
    expect(paths(other)).toEqual([A, pt('B', 0)])
  })

  it('the data sets a marquee picks points of', () => {
    expect(selectedDataSets(EMPTY_SELECTION, G)).toEqual([])
    expect(selectedDataSets(single(k(['title'])), G)).toEqual([])
    const s = selectionOf([k(A), k(['seriesOverrides', 'C']), k(pt('B', 0)), k(pt('A', 1))])
    expect(selectedDataSets(s, G)).toEqual(['A', 'C', 'B'])
  })
})
