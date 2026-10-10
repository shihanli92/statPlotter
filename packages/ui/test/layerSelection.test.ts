import { DocumentStore } from '@ps/engine'
import { createGraphFor, graphTheme, layoutGraph } from '@ps/graph'
import { createTable, type GraphNode, type Layer, type NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import {
  lineCommands,
  lineSlots,
  lineValues,
  selectionTargets,
} from '../src/formatBar/selectionStyles.ts'
import {
  chosenLayers,
  duplicateLayersCommands,
  layersLabel,
  moveLayersCommands,
  moveLayersToCommands,
  removeLayersCommands,
  removeLayersQuestion,
  visibilityCommands,
} from '../src/graph/inspector/layers.ts'
import { fanOutPoints, pointEffective, pointsLabel, pointsName } from '../src/graph/pointEdits.ts'
import { deletable, deleteEdits, deleteLabel } from '../src/graph/selectionEdits.ts'
import { keyResolves, resolvesIn, sceneIndex } from '../src/selection/sceneKeys.ts'
import { elementKey, selectionOf } from '../src/selection/selection.ts'

// Roadmap 47 (UX finding S9): several layers selected in the list of layers act together, one
// undo step each; Delete on the canvas removes whole layers (asking about what goes along) and
// hides single points; the Format panel's point edits reach every selected point.

const G = 'graph1' as NodeId

/** A column graph: points, error bars, a centre line with error bars of its own attached. */
function setup() {
  const table = createTable({ tableKind: 'column', columns: 3, rows: 3 })
  table.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = [1 + i, 2 + i, 4 + 2 * i]
  })
  const [A, B] = table.dataSets.map((d) => d.id as string) as [string, string]
  const base = createGraphFor(table)
  const error = base.layers.find((l) => l.id === 'error')!
  const graph: GraphNode = {
    ...base,
    id: G,
    // Back to front: points, error, center, centerError (on center).
    layers: [...base.layers, { ...error, id: 'centerError', on: 'center' } as Layer],
  }
  const project = projectOf(table, graph)
  const store = new DocumentStore(project)
  const g = () => store.getState().nodes[G] as GraphNode
  const order = () =>
    g()
      .layers.map((l) => l.id)
      .join(' ')
  return { table, graph, project, store, g, order, A, B }
}

describe('several layers from the list, one undo step each', () => {
  it('names counts like the single-layer labels', () => {
    expect(layersLabel('Hide', 1)).toBe('Hide layer')
    expect(layersLabel('Hide', 3)).toBe('Hide 3 layers')
    expect(layersLabel('Bring', 2, 'forward')).toBe('Bring 2 layers forward')
    expect(layersLabel('Send', 1, 'backward')).toBe('Send layer backward')
  })

  it('lists the chosen layers front first, those not in the graph left out', () => {
    const { graph } = setup()
    expect(chosenLayers(graph, ['points', 'gone', 'center'])).toEqual(['center', 'points'])
  })

  it('hides and shows several, only those that change', () => {
    const { store, g, graph } = setup()
    const hide = visibilityCommands(graph, ['points', 'error'], false)
    expect(hide).toHaveLength(2)
    store.dispatch(hide, layersLabel('Hide', hide.length))
    expect(store.undoLabel).toBe('Hide 2 layers')
    expect(
      g()
        .layers.filter((l) => l.visible === false)
        .map((l) => l.id),
    ).toEqual(['points', 'error'])
    // Showing points and center: only points changes.
    expect(visibilityCommands(g(), ['points', 'center'], true)).toHaveLength(1)
    store.undo()
    expect(g().layers.some((l) => l.visible === false)).toBe(false)
  })

  it('moves a block forward and back together, one step, stopping at the ends', () => {
    const { store, g, order } = setup()
    store.dispatch(moveLayersCommands(g(), ['points', 'error'], 1), 'Bring 2 layers forward')
    // Past the centre line and the error bars on it, in their order.
    expect(order()).toBe('center centerError points error')
    store.dispatch(moveLayersCommands(g(), ['points', 'error'], 1), 'Bring 2 layers forward')
    expect(order()).toBe('center centerError points error')
    expect(moveLayersCommands(g(), ['points', 'error'], 1)).toEqual([])
    store.undo()
    expect(order()).toBe('points error center centerError')
    // A drag of the block onto the front row.
    store.dispatch(moveLayersToCommands(g(), ['points', 'error'], 'error', 3), 'Move 2 layers')
    expect(order()).toBe('center centerError points error')
    store.undo()
    expect(order()).toBe('points error center centerError')
  })

  it('duplicates several, each copy in front of its original, one step', () => {
    const { store, graph, order } = setup()
    const { commands, copies } = duplicateLayersCommands(graph, ['points', 'center'])
    expect(copies).toHaveLength(2)
    store.dispatch(commands, layersLabel('Duplicate', 2))
    const ids = order().split(' ')
    expect(ids.indexOf(copies[0]!)).toBe(ids.indexOf('center') + 1)
    expect(ids.indexOf(copies[1]!)).toBe(ids.indexOf('points') + 1)
    expect(new Set(ids).size).toBe(ids.length)
    store.undo()
    expect(order()).toBe('points error center centerError')
  })

  it('removes several with what is on them, asking first, one step', () => {
    const { store, g, graph, order } = setup()
    // The centre line takes its error bars along: asked about by name.
    const one = removeLayersQuestion(graph, ['center'])
    // Audit 3 (A10): one verb, Delete, wherever a layer goes.
    expect(one?.title).toMatch(/^Delete .+ and what is on it \(.+\)\?$/)
    expect(one?.ok).toBe('Delete')
    const many = removeLayersQuestion(graph, ['center', 'points'])
    expect(many?.title).toMatch(/^Delete 2 layers and what is on them \(.+\)\?$/)
    // Chosen with its host: nothing more to ask, and one command for the host.
    expect(removeLayersQuestion(graph, ['center', 'centerError'])).toBeNull()
    const { commands, along } = removeLayersCommands(graph, ['center', 'centerError', 'points'])
    expect(along).toEqual([])
    expect(commands).toHaveLength(2)
    store.dispatch(commands, layersLabel('Delete', 3))
    expect(order()).toBe('error')
    store.undo()
    expect(order()).toBe('points error center centerError')
    expect(g().layers).toHaveLength(4)
  })
})

describe('Delete on the canvas (roadmap 47, amending 852 and 934)', () => {
  it('removes a whole layer of any kind, with the layers depending on it', () => {
    const { store, g, graph, order } = setup()
    expect(deletable(graph, ['layers', 'points'])).toBe(true)
    expect(deletable(graph, ['layers', 'gone'])).toBe(false)
    const d = deleteEdits(graph, [['layers', 'center']])!
    expect(d.label).toBe('Delete layer')
    expect(d.along.map((l) => l.id)).toEqual(['centerError'])
    expect(removeLayersQuestion(graph, d.layers)).not.toBeNull()
    store.dispatch(d.commands, d.label)
    expect(order()).toBe('points error')
    store.undo()
    expect(order()).toBe('points error center centerError')
    const two = deleteEdits(g(), [
      ['layers', 'center'],
      ['layers', 'points'],
    ])!
    expect(two.label).toBe('Delete 2 layers')
    expect(two.menuLabel).toBe('Delete layers (2)')
  })

  it('hides a selected point on the graph, the table untouched', () => {
    const { store, g, graph, A, table } = setup()
    const p = ['pointOverrides', A, 'r0s0']
    expect(deletable(graph, p)).toBe(true)
    const d = deleteEdits(graph, [p])!
    expect(d.label).toBe('Hide data point')
    store.dispatch(d.commands, d.label)
    expect(g().pointOverrides?.[A as never]?.r0s0?.hide).toBe(true)
    expect(deletable(g(), p)).toBe(false)
    // The table's values are where they were.
    const t = store.getState().nodes[table.id]
    expect(t).toEqual(table)
    // Hidden, it is no longer drawn (its key drops out of the selection).
    const scene = layoutGraph({ project: store.getState(), graph: g(), fonts })
    expect(resolvesIn(sceneIndex(scene.root).marks, p)).toBe(false)
    store.undo()
    expect(g().pointOverrides?.[A as never]?.r0s0).toBeUndefined()
  })

  it('handles each kind by its rule in one step, labelled by what it does', () => {
    const { store, g, graph, A, B, order } = setup()
    const points = [
      ['pointOverrides', A, 'r0s0'],
      ['pointOverrides', A, 'r1s0'],
      ['pointOverrides', B, 'r0s0'],
    ]
    const d = deleteEdits(graph, [['layers', 'center'], ['layers', 'error'], ...points])!
    expect(d.label).toBe('Delete 2 layers, hide 3 points')
    expect(d.menuLabel).toBe(d.label)
    store.dispatch(d.commands, d.label)
    expect(order()).toBe('points')
    expect(Object.keys(g().pointOverrides?.[A as never] ?? {})).toEqual(['r0s0', 'r1s0'])
    store.undo()
    expect(order()).toBe('points error center centerError')
    expect(g().pointOverrides).toBeUndefined()
    // A data set hidden in a layer removed with it: nothing to hide there.
    const both = deleteEdits(graph, [
      ['layers', 'center'],
      ['layers', 'centerError', 'series', A],
    ])!
    expect(both.label).toBe('Delete layer')
    expect(() => store.dispatch(both.commands, both.label)).not.toThrow()
    // Points only: their count in the menu.
    expect(deleteEdits(graph, points)!.menuLabel).toBe('Hide points (3)')
    expect(deleteEdits(graph, points)!.label).toBe('Hide 3 points')
  })

  it('combines labels across graphs on a page', () => {
    const t = { annotations: 0, layers: 1, dataSets: 2, points: 0, point: 'point' }
    expect(deleteLabel(t)).toBe('Delete 1 layer, hide 2 data sets')
    expect(deleteLabel({ ...t, layers: 0, points: 3 })).toBe('Hide 2 data sets and 3 points')
    expect(deleteLabel({ ...t, annotations: 2, dataSets: 0 })).toBe('Delete 3 elements')
  })

  it('keeps a whole layer selected while the graph has it, hidden or not', () => {
    const { graph } = setup()
    const hidden = {
      ...graph,
      layers: graph.layers.map((l) => (l.id === 'center' ? { ...l, visible: false } : l)),
    }
    const scene = layoutGraph({ project: projectOf(setup().table, hidden), graph: hidden, fonts })
    const marks = sceneIndex(scene.root).marks
    expect(resolvesIn(marks, ['layers', 'center'])).toBe(false)
    expect(keyResolves(marks, hidden, ['layers', 'center'])).toBe(true)
    expect(keyResolves(marks, hidden, ['layers', 'gone'])).toBe(false)
  })
})

describe('the Format panel on several points', () => {
  it('writes a field at every selected point in one step', () => {
    const { store, g, A, B } = setup()
    const pts = [
      [A, 'r0s0'],
      [A, 'r1s0'],
      [B, 'r2s0'],
    ] as const
    const set = (path: (string | number)[], value: unknown) =>
      fanOutPoints(
        g(),
        [{ type: 'node.set', id: G, path, value }],
        pts[0],
        pts,
        pointEffective(graphTheme(store.getState(), g()), g()),
      )
    store.dispatch(set(['pointOverrides', A, 'r0s0', 'size'], 9), pointsLabel('Format point', 3))
    expect(store.undoLabel).toBe('Format point (3 points)')
    for (const [d, p] of pts) expect(g().pointOverrides?.[d as never]?.[p]?.size).toBe(9)
    // Reset: every one.
    store.dispatch(set(['pointOverrides', A, 'r0s0'], undefined), 'Reset point')
    for (const [d, p] of pts) expect(g().pointOverrides?.[d as never]?.[p]).toBeUndefined()
    // Other commands pass unchanged.
    const other = { type: 'node.set' as const, id: G, path: ['title'], value: undefined }
    expect(fanOutPoints(g(), [other], pts[0], pts, () => undefined)).toEqual([other])
    expect(pointsLabel('Format point', 1)).toBe('Format point')
  })

  it('changes only the field edited of each point’s own border, from the bar and the panel', () => {
    const { store, g, A, B } = setup()
    const red = { color: { rgb: '#ff0000' }, width: 1, dash: 'solid' }
    const blue = { color: { rgb: '#0000ff' }, width: 1.5, dash: 'dash' }
    const [p1, p2, p3] = [
      ['pointOverrides', A, 'r0s0'],
      ['pointOverrides', B, 'r1s0'],
      ['pointOverrides', A, 'r2s0'],
    ] as const
    store.dispatch(
      [
        { type: 'node.set', id: G, path: [...p1, 'border'], value: red },
        { type: 'node.set', id: G, path: [...p2, 'border'], value: blue },
      ],
      'Format point',
    )
    const border = (p: readonly string[]) => g().pointOverrides?.[p[1] as never]?.[p[2]!]?.border
    const theme = () => graphTheme(store.getState(), g())
    // What the third point inherits (it has no border of its own).
    const inherited = pointEffective(theme(), g())([...p3, 'border']) as typeof red
    expect(inherited).toBeDefined()

    // The format bar: a line width for the three.
    const keys = [p1, p2, p3].map((p) => elementKey(G, [...p]))
    const targets = selectionTargets({ project: store.getState() }, selectionOf(keys))
    expect(lineValues(lineSlots(targets))!.color.mixed).toBe(true)
    store.dispatch(lineCommands(lineSlots(targets), { width: 3 }), 'Line width 3 pt')
    expect(border(p1)).toEqual({ ...red, width: 3 })
    expect(border(p2)).toEqual({ ...blue, width: 3 })
    expect(border(p3)).toEqual({ ...inherited, width: 3 })
    store.undo()

    // The Format panel shown for the first: its Border field writes the whole border from what
    // the first draws with, and each point gets its own with the width changed.
    const pts = [p1, p2, p3].map((p) => [p[1], p[2]] as const)
    const effective = pointEffective(theme(), g())
    store.dispatch(
      fanOutPoints(
        g(),
        [{ type: 'node.set', id: G, path: [...p1, 'border'], value: { ...red, width: 4 } }],
        pts[0]!,
        pts,
        effective,
      ),
      'Format point',
    )
    expect(border(p1)).toEqual({ ...red, width: 4 })
    expect(border(p2)).toEqual({ ...blue, width: 4 })
    expect(border(p3)).toEqual({ ...inherited, width: 4 })
    // A fill turned hollow is written whole (another kind of fill); the borders stay.
    store.dispatch(
      fanOutPoints(
        g(),
        [{ type: 'node.set', id: G, path: [...p1, 'fill'], value: { type: 'none' } }],
        pts[0]!,
        pts,
        pointEffective(theme(), g()),
      ),
      'Format point',
    )
    for (const p of [p1, p2, p3])
      expect(g().pointOverrides?.[p[1] as never]?.[p[2]]?.fill).toEqual({ type: 'none' })
    expect(border(p2)).toEqual({ ...blue, width: 4 })
  })

  it('a bar’s border width keeps each bar’s own border colour and its own fill', () => {
    const { store, g, A, B } = setup()
    const red = { color: { rgb: '#ff0000' }, width: 1, dash: 'solid' }
    const fill = { type: 'solid', color: { rgb: '#00ff00' }, opacity: 0.5 }
    store.dispatch(
      [
        {
          type: 'node.set',
          id: G,
          path: ['pointOverrides', A, 'r0', 'bar'],
          value: { border: red },
        },
        { type: 'node.set', id: G, path: ['pointOverrides', B, 'r0', 'bar'], value: { fill } },
      ],
      'Format bar',
    )
    const effective = pointEffective(graphTheme(store.getState(), g()), g())
    // Shown: a bar with nothing of its own; CellPanel writes its mark with the border it draws.
    const drawn = effective(['pointOverrides', A, 'r1', 'bar', 'border']) as typeof red
    const pts = [
      [A, 'r1'],
      [A, 'r0'],
      [B, 'r0'],
    ] as const
    store.dispatch(
      fanOutPoints(
        g(),
        [
          {
            type: 'node.set',
            id: G,
            path: ['pointOverrides', A, 'r1', 'bar'],
            value: { border: { ...drawn, width: 3 } },
          },
        ],
        pts[0],
        pts,
        effective,
      ),
      'Format bar',
    )
    const bar = (d: string, p: string) => g().pointOverrides?.[d as never]?.[p]?.bar
    expect(bar(A, 'r1')).toEqual({ border: { ...drawn, width: 3 } })
    expect(bar(A, 'r0')).toEqual({ border: { ...red, width: 3 } })
    expect(bar(B, 'r0')?.fill).toEqual(fill)
    expect(bar(B, 'r0')?.border?.width).toBe(3)
  })

  it('heads the panel with the count when it shows one of them', () => {
    const { graph, A } = setup()
    const pts = [
      [A, 'r0s0'],
      [A, 'r1s0'],
    ] as const
    const at = (point: string) =>
      ({ place: 'series', series: { dataSet: A, point } }) as Parameters<typeof pointsName>[0]
    expect(pointsName(at('r0s0'), graph, pts)).toBe('2 points')
    expect(pointsName(at('r2s0'), graph, pts)).toBeNull()
    expect(pointsName(at('r0s0'), graph, [pts[0]])).toBeNull()
  })
})
