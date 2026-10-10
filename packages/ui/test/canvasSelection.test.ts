import { DocumentStore } from '@ps/engine'
import { createGraphFor, layoutGraph, type StylePath } from '@ps/graph'
import {
  type Annotation,
  createTable,
  type GraphNode,
  type LayoutItemId,
  type NodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import { dragOutcome } from '../src/graph/canvasDrag.ts'
import {
  deletable,
  deleteEdits,
  graphCommands,
  movableTargets,
  moveEdits,
  moveLabel,
  resetPaths,
} from '../src/graph/selectionEdits.ts'
import {
  clickSelect,
  elementName,
  elementOrder,
  hoverSelect,
  selectAll,
  selectionAnnouncement,
  stepIn,
  stepOut,
  tabStep,
} from '../src/selection/graphSelection.ts'
import { resolvesIn, sceneIndex } from '../src/selection/sceneKeys.ts'
import {
  add,
  compatible,
  contains,
  EMPTY_SELECTION,
  elementKey,
  elementPaths,
  keyId,
  primaryKey,
  primaryPath,
  remove,
  resolveSelection,
  type Selection,
  type SelKey,
  selectionOf,
  single,
  toggle,
} from '../src/selection/selection.ts'

// Roadmap 44: one selection model (decision 850) and the graph canvas' rules on it (851–856).

const G = 'graph1' as NodeId
const el = (path: StylePath): SelKey => elementKey(G, path)
const paths = (s: Selection) => elementPaths(s, G)
const plain = { alt: false, additive: false }
const shift = { alt: false, additive: true }

describe('the selection model', () => {
  const a = el(['title'])
  const b = el(['axes', 'y', 'title'])
  const c = el(['legend'])

  it('keeps keys in the order selected, without duplicates, the last one primary', () => {
    const s = selectionOf([a, b, el(['title'])])
    expect(s.keys).toEqual([a, b])
    expect(primaryKey(s)).toEqual(b)
    expect(primaryPath(selectionOf([a, b], a))).toEqual(['title'])
    expect(primaryPath(EMPTY_SELECTION)).toBeNull()
    expect(single(null)).toBe(EMPTY_SELECTION)
    // Keys compare by value.
    expect(keyId(el(['axes', 'y']))).toBe(keyId(el(['axes', 'y'])))
    expect(keyId(el(['axes', 'y']))).not.toBe(keyId(el(['axes', 'y', 'title'])))
  })

  it('toggles: adding makes a key primary, removing hands the primary to the last left', () => {
    let s = toggle(single(a), b)
    expect(paths(s)).toEqual([['title'], ['axes', 'y', 'title']])
    expect(primaryKey(s)).toEqual(b)
    s = toggle(s, c)
    expect(primaryKey(s)).toEqual(c)
    s = toggle(s, c)
    expect(paths(s)).toEqual([['title'], ['axes', 'y', 'title']])
    expect(primaryKey(s)).toEqual(b)
    // Removing a key that isn't the primary keeps the primary (and its drill).
    const drilled = selectionOf([b, a], a, ['layers', 'p', 'series', 'A'])
    expect(remove(drilled, b).drill).toEqual(['layers', 'p', 'series', 'A'])
    expect(remove(drilled, a).drill).toBeUndefined()
    expect(contains(s, el(['title']))).toBe(true)
    expect(add(s, a).keys).toHaveLength(2)
    expect(primaryKey(add(s, a))).toEqual(a)
  })

  it('selects together only keys of one surface', () => {
    const page = 'layout1' as NodeId
    const item: SelKey = { kind: 'item', layout: page, item: 'i1' as LayoutItemId }
    const part: SelKey = {
      kind: 'pageElement',
      layout: page,
      item: 'i2' as LayoutItemId,
      path: ['title'],
    }
    expect(compatible(a, b)).toBe(true)
    expect(compatible(a, elementKey('graph2' as NodeId, ['title']))).toBe(false)
    expect(compatible(item, { ...item, item: 'i3' as LayoutItemId })).toBe(true)
    expect(compatible(item, part)).toBe(false)
    expect(compatible(part, { ...part, item: 'i9' as LayoutItemId })).toBe(true)
    // Adding an incompatible key replaces the selection.
    expect(add(selectionOf([a, b]), item).keys).toEqual([item])
  })

  it('leaves out keys that no longer resolve, the same object while all do', () => {
    const s = selectionOf([a, b, c], b)
    expect(resolveSelection(s, () => true)).toBe(s)
    const r = resolveSelection(s, (k) => !(k.kind === 'element' && k.path[0] === 'legend'))
    expect(r.keys).toEqual([a, b])
    expect(primaryKey(r)).toEqual(b)
    const gone = resolveSelection(s, (k) => k !== b)
    expect(primaryKey(gone)).toEqual(c)
    expect(selectionOf([a, b, c], b)).toEqual(s)
    expect(selectionOf([a, b, c])).not.toEqual(s)
  })
})

/** A column graph of three data sets with a title, axis titles and a text box. */
function setup() {
  const table = createTable({ tableKind: 'column', columns: 3, rows: 3 })
  table.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = [1 + i, 2 + i, 4 + 2 * i]
  })
  const [A, B, C] = table.dataSets.map((d) => d.id as string) as [string, string, string]
  const text: Annotation = {
    type: 'text',
    id: 't1' as never,
    anchor: { space: 'plot', x: 0.1, y: 0.1 },
    content: { content: [{ text: 'Note' }] },
  } as Annotation
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
    annotations: [text],
  }
  const project = projectOf(table, graph)
  const lay = (g: GraphNode) => layoutGraph({ project, graph: g, fonts })
  const scene = lay(graph)
  // The layer drawing a mark per value (its data sets' points).
  const { nodes } = sceneIndex(scene.root)
  const pointNode = nodes.all.find(
    (n) => n.prim && n.point !== undefined && n.target?.[0] === 'layers',
  )!
  const layer = String(pointNode.target![1])
  const titles = new Map(table.dataSets.map((d) => [d.id as string, d.title]))
  return {
    project,
    table,
    graph,
    lay,
    scene,
    layer,
    A,
    B,
    C,
    marksOf: (ds: string): StylePath => ['layers', layer, 'series', ds],
    title: (k: string) => titles.get(k),
  }
}

describe('clicks on the canvas', () => {
  it('a plain click selects one thing, the second on its data set a point; Shift adds', () => {
    const { A, B, marksOf } = setup()
    let s = clickSelect(EMPTY_SELECTION, G, marksOf(A), 'r0s0', marksOf(A), 1, plain)
    expect(paths(s)).toEqual([marksOf(A)])
    s = clickSelect(s, G, marksOf(A), 'r1s0', marksOf(A), 1, plain)
    expect(paths(s)).toEqual([['pointOverrides', A, 'r1s0']])
    // The point remembers the layer's marks it was picked from (Escape goes back to them).
    expect(s.drill).toEqual(marksOf(A))
    expect(paths(stepOut(s, G))).toEqual([marksOf(A)])
    // Shift-click on a point of another data set adds that data set, not the point.
    s = clickSelect(s, G, marksOf(B), 'r0s0', marksOf(B), 1, shift)
    expect(paths(s)).toEqual([['pointOverrides', A, 'r1s0'], marksOf(B)])
    // On a point of the data set whose point is selected: that point.
    s = clickSelect(s, G, marksOf(A), 'r2s0', marksOf(A), 1, shift)
    expect(paths(s)).toEqual([
      ['pointOverrides', A, 'r1s0'],
      marksOf(B),
      ['pointOverrides', A, 'r2s0'],
    ])
    expect(primaryPath(s)).toEqual(['pointOverrides', A, 'r2s0'])
    // Shift-click on a selected data set's mark takes it out; never a drill.
    s = clickSelect(s, G, marksOf(B), 'r1s0', marksOf(B), 1, shift)
    expect(paths(s)).toEqual([
      ['pointOverrides', A, 'r1s0'],
      ['pointOverrides', A, 'r2s0'],
    ])
    // Adding a data set (a mark of it that is no single point: a line, a mean) drops its own
    // selected points: the data set wins.
    const won = clickSelect(
      selectionOf([el(['title']), el(['pointOverrides', A, 'r0s0'])]),
      G,
      marksOf(A),
      undefined,
      marksOf(A),
      1,
      shift,
    )
    expect(paths(won)).toEqual([['title'], marksOf(A)])
  })

  it('Shift-clicks on bars toggle their data sets; Alt+Shift the layer; nothing on empty space', () => {
    const { A, B, layer, marksOf } = setup()
    let s = clickSelect(EMPTY_SELECTION, G, marksOf(A), 'r0s0', marksOf(A), 1, shift)
    s = clickSelect(s, G, marksOf(B), 'r0s0', marksOf(B), 1, shift)
    expect(paths(s)).toEqual([marksOf(A), marksOf(B)])
    expect(clickSelect(s, G, null, undefined, undefined, 1, shift)).toBe(s)
    // The second click of a Shift-double-click changes nothing (it would undo the first).
    expect(clickSelect(s, G, marksOf(A), 'r0s0', marksOf(A), 2, shift)).toBe(s)
    s = clickSelect(s, G, marksOf(A), 'r0s0', marksOf(A), 1, { alt: true, additive: true })
    expect(paths(s)).toEqual([marksOf(A), marksOf(B), ['layers', layer]])
    // A plain click on one of several selected: that one alone; on empty space: nothing.
    expect(paths(clickSelect(s, G, marksOf(B), 'r1s0', marksOf(B), 1, plain))).toEqual([marksOf(B)])
    expect(clickSelect(s, G, null, undefined, undefined, 1, plain)).toBe(EMPTY_SELECTION)
    // The hover halo shows what a Shift-click would add.
    expect(hoverSelect(single(el(marksOf(A))), G, marksOf(B), 'r0s0', marksOf(B), shift)).toEqual(
      marksOf(B),
    )
  })

  it('tick labels: a group once its axis is selected, Shift-clicks add groups once one is', () => {
    const ticks = ['axes', 'x', 'tickLabels', 0]
    let s = clickSelect(EMPTY_SELECTION, G, ['axes', 'x'], undefined, ticks, 1, plain)
    expect(paths(s)).toEqual([['axes', 'x']])
    s = clickSelect(s, G, ['axes', 'x'], undefined, ticks, 1, plain)
    expect(paths(s)).toEqual([['axes', 'x', 'tickLabels']])
    s = clickSelect(s, G, ['axes', 'y'], undefined, ['axes', 'y', 'tickLabels', 1], 1, shift)
    expect(paths(s)).toEqual([
      ['axes', 'x', 'tickLabels'],
      ['axes', 'y', 'tickLabels'],
    ])
    // Escape from tick labels: their axis.
    expect(paths(stepOut(single(el(['axes', 'y', 'tickLabels'])), G))).toEqual([['axes', 'y']])
    expect(stepOut(s, G)).toBe(EMPTY_SELECTION)
  })

  it('a double-click on a point leaves its data set selected (it formats the data set)', () => {
    const { A, marksOf } = setup()
    const point = single(el(['pointOverrides', A, 'r1s0']), marksOf(A))
    // The double-click's first click keeps the point, its second goes to the data set.
    const first = clickSelect(point, G, marksOf(A), 'r1s0', marksOf(A), 1, plain)
    expect(paths(first)).toEqual([['pointOverrides', A, 'r1s0']])
    expect(paths(clickSelect(first, G, marksOf(A), 'r1s0', marksOf(A), 2, plain))).toEqual([
      marksOf(A),
    ])
  })
})

describe('keyboard: ⌘A, Tab, Enter and Escape', () => {
  it('⌘A selects every top-level element, in reading order', () => {
    const { graph, scene, A, B, C, marksOf } = setup()
    const order = elementOrder(graph, sceneIndex(scene.root).nodes.all)
    expect(order).toEqual([
      ['title'],
      ['axes', 'y', 'title'],
      ['axes', 'y', 'tickLabels'],
      ['axes', 'y'],
      // Data sets of the front layer first (then the layers behind it).
      ...graph.layers
        .slice()
        .reverse()
        .flatMap((l) =>
          [A, B, C]
            .map((d) => ['layers', l.id, 'series', d])
            .filter((p) => order.some((o) => JSON.stringify(o) === JSON.stringify(p))),
        ),
      ['axes', 'x'],
      ['axes', 'x', 'tickLabels'],
      ['axes', 'x', 'title'],
      ...order.filter((p) => p[0] === 'legend'),
      ['annotations', 0],
    ])
    expect(order).toContainEqual(marksOf(A))
    const all = selectAll(G, order)
    expect(paths(all)).toEqual(order)
    expect(primaryPath(all)).toEqual(['title'])
    expect(stepOut(all, G)).toBe(EMPTY_SELECTION)
  })

  it('Tab steps through the elements and leaves past the ends; Enter goes in, Shift+Enter out', () => {
    const { graph, scene, A, marksOf } = setup()
    const { nodes, marks } = sceneIndex(scene.root)
    const order = elementOrder(graph, nodes.all)
    let s = tabStep(EMPTY_SELECTION, G, order, 1)!
    expect(paths(s)).toEqual([['title']])
    s = tabStep(s, G, order, 1)!
    expect(paths(s)).toEqual([['axes', 'y', 'title']])
    expect(paths(tabStep(s, G, order, -1)!)).toEqual([['title']])
    expect(tabStep(single(el(['title'])), G, order, -1)).toBeNull()
    expect(tabStep(single(el(order.at(-1)!)), G, order, 1)).toBeNull()
    expect(paths(tabStep(EMPTY_SELECTION, G, order, -1)!)).toEqual([order.at(-1)])
    // Into a data set: its first point; Tab from the point goes on from its data set.
    const into = stepIn(single(el(marksOf(A))), G, nodes, marks)!
    expect(paths(into)).toEqual([['pointOverrides', A, 'r0s0']])
    expect(into.drill).toEqual(marksOf(A))
    const i = order.findIndex((p) => JSON.stringify(p) === JSON.stringify(marksOf(A)))
    expect(paths(tabStep(into, G, order, 1)!)).toEqual([order[i + 1]])
    expect(paths(stepOut(into, G))).toEqual([marksOf(A)])
    // Into an axis: its tick labels; nothing to go into: null (Enter formats).
    expect(paths(stepIn(single(el(['axes', 'y'])), G, nodes, marks)!)).toEqual([
      ['axes', 'y', 'tickLabels'],
    ])
    expect(stepIn(single(el(['title'])), G, nodes, marks)).toBeNull()
    expect(stepIn(EMPTY_SELECTION, G, nodes, marks)).toBeNull()
  })

  it('names the selection for screen readers', () => {
    const { graph, A, marksOf, title } = setup()
    expect(selectionAnnouncement(graph, EMPTY_SELECTION, title)).toBe('Graph')
    expect(selectionAnnouncement(graph, single(el(['axes', 'y', 'title'])), title)).toBe(
      'Y axis title',
    )
    expect(selectionAnnouncement(graph, selectionOf([el(['title']), el(['legend'])]), title)).toBe(
      '2 elements selected',
    )
    expect(elementName(graph, marksOf(A), title)).toMatch(/^“Group A” in “.+”$/)
    expect(elementName(graph, ['axes', 'x', 'tickLabels'])).toBe('X axis tick labels')
    expect(elementName(graph, ['annotations', 0])).toBe('Text box')
    expect(elementName(graph, ['pointOverrides', A, 'r0s0'], title)).toBe('Data point of “Group A”')
  })
})

describe('keys after an edit', () => {
  it('a removed layer’s or a hidden data set’s keys drop out, and come back with Undo', () => {
    const { project, graph, A, B, layer, marksOf } = setup()
    const store = new DocumentStore(project)
    const resolved = (s: Selection) => {
      const g = store.getState().nodes[G] as GraphNode
      const scene = layoutGraph({ project: store.getState(), graph: g, fonts })
      const { marks } = sceneIndex(scene.root)
      return resolveSelection(s, (k) => k.kind === 'element' && resolvesIn(marks, k.path))
    }
    const s = selectionOf([el(['title']), el(marksOf(A)), el(marksOf(B)), el(['layers', layer])])
    expect(resolved(s)).toBe(s)
    store.dispatch({ type: 'graph.removeLayer', id: G, layer }, 'Delete layer')
    expect(paths(resolved(s))).toEqual([['title']])
    store.undo()
    expect(paths(resolved(s))).toEqual(paths(s))
    // Delete hides a data set in its layer: its key goes; Undo brings it back.
    const d = deleteEdits(store.getState().nodes[G] as GraphNode, [marksOf(B)])!
    store.dispatch(d.commands, d.label)
    expect(paths(resolved(s))).not.toContainEqual(marksOf(B))
    expect(paths(resolved(s))).toContainEqual(marksOf(A))
    store.undo()
    expect(paths(resolved(s))).toContainEqual(marksOf(B))
    // A single point resolves while it is drawn.
    expect(paths(resolved(single(el(['pointOverrides', A, 'r0s0']))))).toHaveLength(1)
    expect(paths(resolved(single(el(['pointOverrides', A, 'r9s0']))))).toHaveLength(0)
    void graph
  })
})

describe('edits of several elements, one undo step each', () => {
  it('arrow keys nudge the title and an axis title together', () => {
    const { project, graph, scene } = setup()
    const store = new DocumentStore(project)
    const keys: StylePath[] = [['title'], ['axes', 'y', 'title'], ['axes', 'x'], ['legend']]
    const targets = movableTargets(graph, scene, keys)
    // The axis isn't movable; whether the legend is depends on it being shown.
    expect(targets.slice(0, 2)).toEqual([{ kind: 'title' }, { kind: 'axisTitle', axis: 'y' }])
    const { edits } = moveEdits(graph, scene, targets.slice(0, 2), 3, -2)
    expect(moveLabel(edits)).toBe('Move 2 elements')
    store.dispatch(graphCommands(graph, edits), moveLabel(edits).replace('Move', 'Nudge'))
    const g = store.getState().nodes[G] as GraphNode
    expect(g.titleOffset).toEqual({ dx: 3, dy: -2 })
    expect(g.axes.y.titleOffset).toEqual({ dx: 3, dy: -2 })
    expect(store.undoLabel).toBe('Nudge 2 elements')
    // Reset position clears both offsets, once each.
    expect(resetPaths(g, [['title'], ['axes', 'y'], ['axes', 'y', 'title']])).toEqual([
      ['titleOffset'],
      ['axes', 'y', 'titleOffset'],
    ])
    store.undo()
    const back = store.getState().nodes[G] as GraphNode
    expect(back.titleOffset).toBeUndefined()
    expect(back.axes.y.titleOffset).toBeUndefined()
  })

  it('a drag of one of several selected elements moves them all, the dragged one snapping', () => {
    const { graph, scene } = setup()
    const out = dragOutcome(
      graph,
      scene,
      {
        kind: 'move',
        target: { kind: 'title' },
        dx: 20,
        dy: 10,
        free: true,
        others: [
          { kind: 'axisTitle', axis: 'y' },
          { kind: 'annotation', index: 0 },
        ],
      },
      { threshold: 0, sizes: [] },
    )
    expect(out.label).toBe('Move 3 elements')
    expect(out.commits.map((c) => c.path)).toEqual([
      ['titleOffset'],
      ['axes', 'y', 'titleOffset'],
      ['annotations', 0],
    ])
    expect(out.commit.path).toEqual(['titleOffset'])
    expect(out.graph.titleOffset).toEqual({ dx: 20, dy: 10 })
    expect(out.graph.axes.y.titleOffset).toEqual({ dx: 20, dy: 10 })
    // A drag of one element alone is labelled as before.
    const one = dragOutcome(
      graph,
      scene,
      { kind: 'move', target: { kind: 'title' }, dx: 5, dy: 0, free: true },
      { threshold: 0, sizes: [] },
    )
    expect(one.label).toBe('Move graph title')
    expect(one.commits).toHaveLength(1)
  })

  it('Delete hides data sets in their layer and removes annotations, one step', () => {
    const { project, graph, A, B, layer, marksOf, title } = setup()
    const store = new DocumentStore(project)
    expect(deletable(graph, marksOf(A))).toBe(true)
    expect(deletable(graph, ['title'])).toBe(false)
    expect(deleteEdits(graph, [['title'], ['axes', 'y']])).toBeNull()
    const one = deleteEdits(graph, [marksOf(A)], title)!
    expect(one.label).toMatch(/^Hide Group A in .+/)
    store.dispatch(one.commands, one.label)
    const g = store.getState().nodes[G] as GraphNode
    expect(g.layers.find((l) => l.id === layer)?.series?.[A]?.hide).toBe(true)
    expect(deletable(g, marksOf(A))).toBe(false)
    store.undo()
    const many = deleteEdits(graph, [marksOf(A), marksOf(B)], title)!
    expect(many.label).toBe('Hide 2 data sets')
    const mixed = deleteEdits(graph, [marksOf(A), ['annotations', 0], ['title']], title)!
    // Roadmap 47: what is deleted, then what is hidden.
    expect(mixed.label).toBe('Delete text, hide 1 data set')
    store.dispatch(mixed.commands, mixed.label)
    const after = store.getState().nodes[G] as GraphNode
    expect(after.annotations).toEqual([])
    expect(after.layers.find((l) => l.id === layer)?.series?.[A]?.hide).toBe(true)
    expect(store.undoLabel).toBe('Delete text, hide 1 data set')
    store.undo()
    expect((store.getState().nodes[G] as GraphNode).annotations).toHaveLength(1)
    expect(deleteEdits(graph, [['annotations', 0]])!.label).toBe('Delete text')
  })
})
