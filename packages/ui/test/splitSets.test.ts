import { DocumentStore } from '@ps/engine'
import {
  layoutGraph,
  markInfo,
  markSeries,
  matchSetFormat,
  presetGraph,
  type Scene,
} from '@ps/graph'
import { readProjectFile, writeProjectFile } from '@ps/io'
import {
  type ColumnId,
  createProject,
  createTable,
  type GraphNode,
  type LayoutNode,
  levelKey,
  memberSlice,
  type NodeId,
  setMembers,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, sampleTable, sampleVariables } from '../../graph/test/helpers.ts'
import { cardPlace, scenePoints, selectedPoint } from '../src/graph/HoverCard.tsx'
import { autoColumns, defaultSplitVariable, splitKinds, splitSet } from '../src/graph/split.ts'

// Roadmap 34d in the app: a graph split into a set on a page, live with the table (a new level's
// graph in the same undo step, on the page's grid), saved and reopened; shared or free axes;
// "Apply to all graphs of the set"; hover cards and Go to row.

function setup() {
  const table = sampleVariables()
  const box = presetGraph(table, 'groupBoxPoints', 'Scores', { mapping: { x: 'a', y: 'c' } })
  const base: GraphNode = { ...box, id: 'g0' as NodeId, legend: { ...box.legend, show: true } }
  const project = createProject()
  project.nodes[table.id] = table
  project.nodes[base.id] = base
  project.order.push(table.id, base.id)
  const made = splitSet(project, fonts, table, base, { by: 'level', variable: 'b' })!
  const store = new DocumentStore(project)
  store.dispatch([
    ...made.graphs.map((node) => ({ type: 'node.add' as const, node })),
    { type: 'node.add' as const, node: made.layout },
  ])
  const set = () => setMembers(store.getState(), made.graphs[0]!.split!.set)
  const page = () => store.getState().nodes[made.layout.id] as LayoutNode
  const scene = (g: GraphNode): Scene => layoutGraph({ project: store.getState(), graph: g, fonts })
  return { store, table, base, made, set, page, scene }
}

/** The value at the top of a scene's Y axis. */
const yTop = (s: Scene) => s.axes!.y.fromPx(s.plot.y)

describe('a split set in the app', () => {
  it('a page in a grid, a graph per level of Sex, titled with it, one legend, Y shared', () => {
    const { made, set, page, scene } = setup()
    expect(set().map((g) => g.title?.content?.[0]?.text)).toEqual(['F', 'M'])
    expect(page().items.map((it) => (it.type === 'graph' ? it.graph : null))).toEqual(
      set().map((g) => g.id),
    )
    expect(page().grids).toEqual([
      expect.objectContaining({ set: made.graphs[0]!.split!.set, columns: 2 }),
    ])
    // Plot areas line up: the two items share a top.
    const [a, b] = page().items
    expect(a!.type === 'graph' && b!.type === 'graph' && Math.abs(a.y - b.y) < 0.01).toBe(true)
    expect(set().map((g) => g.legend.show)).toEqual([false, true])
    const [f, m] = set().map(scene)
    expect(yTop(f!)).toBe(yTop(m!))
  })

  it('a new level in the table: its graph, on the page, undone and redone with the edit', () => {
    const { store, table, set, page } = setup()
    store.dispatch({
      type: 'table.setText',
      table: table.id,
      edits: [{ col: 'b' as ColumnId, row: 14, value: 'X' }],
    })
    expect(set().map(memberSlice)).toEqual(['F', 'M', 'X'].map(levelKey))
    expect(page().items).toHaveLength(3)
    // The third cell: below the first, in its column.
    const [a, , c] = page().items as { x: number; y: number }[]
    expect(c!.x).toBeCloseTo(a!.x, 6)
    expect(c!.y).toBeGreaterThan(a!.y)
    store.undo()
    expect(set()).toHaveLength(2)
    expect(page().items).toHaveLength(2)
    store.redo()
    expect(set()).toHaveLength(3)
  })

  it('a row moved to another level moves to its graph', () => {
    const { store, table, set } = setup()
    const rowsOf = (g: GraphNode) => {
      const s = layoutGraph({ project: store.getState(), graph: g, fonts })
      return new Set(scenePoints(s.root).map((n) => Number(n.point!.slice(1).split('s')[0])))
    }
    expect(rowsOf(set()[1]!).has(0)).toBe(false)
    store.dispatch({
      type: 'table.setText',
      table: table.id,
      edits: [{ col: 'b' as ColumnId, row: 0, value: 'M' }],
    })
    expect(rowsOf(set()[1]!).has(0)).toBe(true)
    expect(rowsOf(set()[0]!).has(0)).toBe(false)
  })

  it('free scales: each graph its own Y range; shared again: one', () => {
    const { store, set, scene } = setup()
    const links = (y: string | undefined) =>
      set().map((g) => ({
        type: 'node.set' as const,
        id: g.id,
        path: ['links'],
        value: y ? { y } : undefined,
      }))
    store.dispatch(links(undefined))
    const [f, m] = set().map(scene)
    expect(yTop(f!)).not.toBe(yTop(m!))
    store.dispatch(links('shared'))
    const [f2, m2] = set().map(scene)
    expect(yTop(f2!)).toBe(yTop(m2!))
  })

  it('apply to all graphs of the set: formats by level, each keeps its title and legend', () => {
    const { store, set } = setup()
    const [f, m] = set()
    const styled: GraphNode = {
      ...f!,
      seriesOverrides: { [levelKey('Low')]: { color: { palette: 4 } } },
      size: { ...f!.size, plotWidth: f!.size.plotWidth + 40 },
    }
    const next = matchSetFormat(store.getState(), m!, styled)
    expect(next.seriesOverrides[levelKey('Low')]).toEqual({ color: { palette: 4 } })
    expect(next.size.plotWidth).toBe(styled.size.plotWidth)
    expect(next.title?.content).toEqual(m!.title?.content)
    expect(next.legend.show).toBe(true)
    expect(next.seriesSource).toEqual(m!.seriesSource)
    expect(next.split).toEqual(m!.split)
  })

  it('saved and reopened: the filter, the set and the grid', () => {
    const { store, set, page } = setup()
    const back = readProjectFile(writeProjectFile(store.getState())).project
    const g = back.nodes[set()[0]!.id] as GraphNode
    expect(g.seriesSource.filter).toEqual(set()[0]!.seriesSource.filter)
    expect(g.split).toEqual(set()[0]!.split)
    expect((back.nodes[page().id] as LayoutNode).grids).toEqual(page().grids)
  })

  it('other tables: per data set (XY) and per row (grouped)', () => {
    const xy = sampleTable('xy')
    const p = createProject()
    p.nodes[xy.id] = xy
    const perSet = splitSet(p, fonts, xy, presetGraph(xy, 'meanSdJoined'), { by: 'dataSet' })!
    expect(perSet.graphs.every((g) => g.split?.by === 'dataSet' && g.links?.x && g.links.y)).toBe(
      true,
    )
    const grouped = sampleTable('grouped')
    p.nodes[grouped.id] = grouped
    const perRow = splitSet(p, fonts, grouped, presetGraph(grouped, 'barsPoints'), { by: 'row' })!
    expect(perRow.graphs.map((g) => g.seriesSource.rows)).toEqual(perRow.graphs.map((_, i) => [i]))
    expect(perRow.layout.grids?.[0]?.columns).toBe(autoColumns(perRow.graphs.length))
  })

  it('offers what a table can split by, and a variable the graph doesn’t show', () => {
    const t = sampleVariables()
    const g = presetGraph(t, 'groupBoxPoints', undefined, { mapping: { x: 'a', y: 'c' } })
    expect(splitKinds(t, g)).toEqual({ level: true, dataSet: false, row: false })
    expect(
      defaultSplitVariable(
        g,
        t.dataSets.filter((d) => d.text),
      ),
    ).toBe('b')
    // A bubble plot draws variables: no data sets to split by.
    expect(splitKinds(t, presetGraph(t, 'bubble')).dataSet).toBe(false)
    const col = createTable({ tableKind: 'column', columns: 3 })
    expect(splitKinds(col, presetGraph(col, 'barsPoints'))).toEqual({
      level: false,
      dataSet: true,
      row: false,
    })
  })
})

describe('hover cards and Go to row', () => {
  it('a selected point’s card: its scene node, placed beside it at any zoom', () => {
    const { set, scene, store } = setup()
    const g = set()[0]!
    const s = scene(g)
    const points = scenePoints(s.root)
    expect(points.length).toBeGreaterThan(3)
    const first = points[0]!
    const key = markSeries(first)!.key
    expect(selectedPoint(s.root, ['pointOverrides', key, first.point!])).toBe(first)
    expect(selectedPoint(s.root, ['axes', 'y'])).toBeNull()
    const at1 = cardPlace(s.root, s.width, first, 1)!
    const at2 = cardPlace(s.root, s.width, first, 2)!
    expect(at2.top).toBeCloseTo(((at1.top as number) + 4) * 2 - 4, 6)
    // Its row: every variable, and the table row to go to.
    const info = markInfo(store.getState(), g, first)!
    expect(info.lines.map((l) => l.label)).toEqual(['Group', 'Sex', 'Score', 'Age'])
    expect(info.lines[1]).toEqual({ label: 'Sex', value: 'F' })
    expect(info.goTo?.table).toBe('t1')
  })
})
