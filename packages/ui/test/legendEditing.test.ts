import { DocumentStore } from '@ps/engine'
import { createGraphFor, type LegendItem, layoutGraph, type StylePath } from '@ps/graph'
import { createProject, createTable, type GraphNode, type NodeId, type Project } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts } from '../../graph/test/helpers.ts'
import { dragOutcome } from '../src/graph/canvasDrag.ts'
import {
  entryPlace,
  formatTargetFor,
  LEGEND_PLACE,
  seriesPlace,
} from '../src/graph/format/route.ts'
import {
  barSelection,
  columnsCommand,
  entriesMovedBy,
  entriesShownCommand,
  entryDropped,
  entryInsertion,
  fillCommand,
  labelCommand,
  legendColumns,
  moveEntriesCommand,
  orderWithGroup,
  reverseCommand,
} from '../src/graph/legendEdits.ts'
import { legendHalos } from '../src/graph/SceneSvg.tsx'
import { deletable, deleteEdits } from '../src/graph/selectionEdits.ts'
import {
  clickSelect,
  elementName,
  elementOrder,
  entryStep,
  hoverSelect,
  selectAll,
  stepIn,
  stepOut,
  tabStep,
} from '../src/selection/graphSelection.ts'
import { kindName, kindOf, selectSameKind } from '../src/selection/sameKind.ts'
import {
  entryTargetIn,
  hitKey,
  keyResolves,
  legendEntryPath,
  sceneIndex,
} from '../src/selection/sceneKeys.ts'
import {
  elementKey,
  elementPaths,
  primaryPath,
  type Selection,
  selectionOf,
  single,
} from '../src/selection/selection.ts'

// Roadmap 47b: legend editing — the legend selected first, then one of its entries (a drill),
// Escape back; an entry moved within its group (drag, Alt+arrows), hidden, given a legend-only
// label; the grid's columns and fill. The Format panel's list and the format bar's Layout group:
// `legendPanel.test.tsx`.

/** A column graph of four data sets (A, B, C, D) with its legend shown on the right. */
function setup(legend: Partial<GraphNode['legend']> = {}) {
  const table = createTable({ tableKind: 'column', columns: 4, rows: 3 })
  table.dataSets.forEach((d, i) => {
    d.title = 'ABCD'[i]!
    d.subcolumns[0]!.values = [1 + i, 2 + i, 3 + i]
  })
  const base = createGraphFor(table)
  const graph: GraphNode = {
    ...base,
    id: 'g1' as NodeId,
    legend: { ...base.legend, show: true, position: 'right', ...legend },
  }
  const project: Project = createProject()
  project.nodes[table.id] = table
  project.nodes[graph.id] = graph
  project.order.push(table.id, graph.id)
  const store = new DocumentStore(project)
  const g = () => store.getState().nodes[graph.id] as GraphNode
  const scene = () => layoutGraph({ project: store.getState(), graph: g(), fonts })
  const ds = table.dataSets.map((d) => d.id as string)
  return { store, graph, g, scene, ds, table }
}

const G = 'g1' as NodeId
const el = (p: StylePath) => elementKey(G, p)
const plain = { alt: false, additive: false }
const shift = { alt: false, additive: true }
const LEGEND: StylePath = ['legend']

/** Items of a legend: keys of one group (`h` hidden), then a heading and a guide group. */
const items = (keys: string, hidden = ''): LegendItem[] => [
  ...[...keys].map((k) => ({ key: k, group: 'dataSets', label: k, hidden: hidden.includes(k) })),
  { key: 'aes/size', group: 'aes/size', label: 'Size', hidden: false, fixed: true },
  { key: 's0', group: 'aes/size', label: '1', hidden: false },
  { key: 's1', group: 'aes/size', label: '2', hidden: false },
]

describe('moving entries within their group (roadmap 47b)', () => {
  it('one place earlier or later; several as a block; at an end they stay', () => {
    const it4 = items('abcd')
    expect(entriesMovedBy(it4, ['c'], -1)).toEqual(['a', 'c', 'b', 'd'])
    expect(entriesMovedBy(it4, ['c'], 1)).toEqual(['a', 'b', 'd', 'c'])
    expect(entriesMovedBy(it4, ['a'], -1)).toBeNull()
    expect(entriesMovedBy(it4, ['d'], 1)).toBeNull()
    expect(entriesMovedBy(it4, ['b', 'c'], 1)).toEqual(['a', 'd', 'b', 'c'])
    expect(entriesMovedBy(it4, ['a', 'c'], -1)).toEqual(['a', 'c', 'b', 'd'])
    // Another group's entries move within theirs only.
    expect(entriesMovedBy(it4, ['s1'], -1)).toEqual(['s1', 's0'])
    // Headings never move.
    expect(entriesMovedBy(it4, ['aes/size'], 1)).toBeNull()
  })

  it('on the canvas, past the next entry shown (hidden ones keep their places)', () => {
    const it4 = items('abcd', 'b')
    expect(entriesMovedBy(it4, ['c'], -1, true)).toEqual(['c', 'b', 'a', 'd'])
    expect(entriesMovedBy(it4, ['c'], -1)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('dropped next to an entry of its group; in place or across groups, nothing', () => {
    const it4 = items('abcd')
    expect(entryDropped(it4, 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd'])
    expect(entryDropped(it4, 'd', 'a', false)).toEqual(['d', 'a', 'b', 'c'])
    expect(entryDropped(it4, 'b', 'c', false)).toBeNull()
    expect(entryDropped(it4, 'b', 's0', false)).toBeNull()
  })

  it('writes the whole group into the order, keeping other groups’ keys', () => {
    const legend = { show: true, position: 'right' as const, order: ['s1', 'b', 's0'] }
    expect(orderWithGroup(legend, ['d', 'c', 'b', 'a'])).toEqual(['s1', 's0', 'd', 'c', 'b', 'a'])
  })

  it('finds where a dragged entry goes in a column, a row and a grid of either fill', () => {
    const box = (x: number, y: number) => ({ x, y, w: 40, h: 16 })
    // One column: a b c d.
    const column = [...'abcd'].map((k, i) => ({ key: k, box: box(0, i * 16) }))
    const down = entryInsertion(column, 'a', { x: 10, y: 3 * 16 + 12 })
    expect(down).toMatchObject({ target: 'd', after: true, line: { y1: 64, y2: 64 } })
    expect(entryInsertion(column, 'a', { x: 10, y: 16 + 2 })).toBeNull()
    expect(entryInsertion(column, 'b', { x: 10, y: 4 })).toMatchObject({
      target: 'a',
      after: false,
    })
    // 2 × 2 across the rows (a b / c d): a vertical line between the columns.
    const across = [box(0, 0), box(52, 0), box(0, 16), box(52, 16)].map((b, i) => ({
      key: 'abcd'[i]!,
      box: b,
    }))
    const r = entryInsertion(across, 'a', { x: 85, y: 20 })
    expect(r).toMatchObject({ target: 'd', after: true, line: { x1: 92, x2: 92, y1: 16, y2: 32 } })
    // 2 × 2 down the columns (a c / b d): entries run down each column.
    const columns = [box(0, 0), box(0, 16), box(52, 0), box(52, 16)].map((b, i) => ({
      key: 'abcd'[i]!,
      box: b,
    }))
    expect(entryInsertion(columns, 'd', { x: 60, y: 2 })).toMatchObject({
      target: 'c',
      after: false,
      line: { y1: 0, y2: 0, x1: 52, x2: 92 },
    })
  })
})

describe('legend-only edits (roadmap 47b)', () => {
  it('hides and shows entries, labels them on the legend alone, sets the grid', () => {
    const { g, store } = setup()
    store.dispatch(entriesShownCommand(g(), ['x', 'y'], false)!)
    expect(g().legend.hidden).toEqual(['x', 'y'])
    expect(entriesShownCommand(g(), ['x'], false)).toBeNull()
    store.dispatch(entriesShownCommand(g(), ['x', 'y'], true)!)
    expect(g().legend.hidden).toBeUndefined()
    store.dispatch(labelCommand(g(), 'a', [{ text: 'Alpha', bold: true }])!)
    expect(g().legend.labels).toEqual({ a: [{ text: 'Alpha', bold: true }] })
    // Emptied, or "Use data set name": no label.
    store.dispatch(labelCommand(g(), 'a', [{ text: ' ' }])!)
    expect(g().legend.labels).toBeUndefined()
    expect(labelCommand(g(), 'a', null)).toBeNull()
    store.dispatch(columnsCommand(g(), 2))
    store.dispatch(fillCommand(g(), 'columns'))
    expect([g().legend.columns, g().legend.fill]).toEqual([2, 'columns'])
    store.dispatch(fillCommand(g(), 'rows'))
    expect(g().legend.fill).toBeUndefined()
    expect(legendColumns({ show: true, position: 'top' }, 5)).toBe(5)
    expect(legendColumns({ show: true, position: 'right' }, 5)).toBe(1)
    expect(legendColumns({ show: true, position: 'inside', columns: 9 }, 5)).toBe(5)
  })

  it('Reverse turns ordered groups over too (reverse doesn’t apply to them)', () => {
    const { g, store } = setup({ order: ['s1', 's0'] })
    const it4 = items('abcd')
    store.dispatch(reverseCommand(g(), it4, true))
    expect(g().legend.reverse).toBe(true)
    expect(g().legend.order).toEqual(['s1', 's0'])
    // Unordered groups: reverse alone.
    const plainGraph = setup()
    plainGraph.store.dispatch(reverseCommand(plainGraph.g(), it4, true))
    expect(plainGraph.g().legend).toMatchObject({ reverse: true })
    expect(plainGraph.g().legend.order).toBeUndefined()
  })

  it('moving one step through the canvas: one undo step labelled for it', () => {
    const { g, store, scene, ds } = setup()
    const m = moveEntriesCommand(g(), scene().legend!, [ds[2]!], -1, true)!
    store.dispatch(m.command, m.label)
    expect(store.undoLabel).toBe('Move legend entry')
    expect(scene().legend!.map((e) => e.key)).toEqual([ds[0], ds[2], ds[1], ds[3]])
    // The drawing order is the layers' and data sets' own: unchanged.
    expect(g().layers).toEqual(setup().graph.layers)
    store.undo()
    expect(g().legend.order).toBeUndefined()
  })
})

describe('clicks in the legend: the legend, then an entry (roadmap 47b)', () => {
  const entry = (k: string) => legendEntryPath(k)

  it('selects the legend first, then the entry clicked; Escape steps back to the legend', () => {
    let s: Selection = single(null)
    s = clickSelect(s, G, entry('a'), undefined, ['seriesOverrides', 'a'], 1, plain)
    expect(primaryPath(s)).toEqual(LEGEND)
    s = clickSelect(s, G, entry('a'), undefined, ['seriesOverrides', 'a'], 1, plain)
    expect(primaryPath(s)).toEqual(entry('a'))
    // Another entry: that one; the legend's box or heading: the legend again.
    s = clickSelect(s, G, entry('b'), undefined, undefined, 1, plain)
    expect(primaryPath(s)).toEqual(entry('b'))
    expect(primaryPath(clickSelect(s, G, LEGEND, undefined, undefined, 1, plain))).toEqual(LEGEND)
    expect(primaryPath(stepOut(s, G))).toEqual(LEGEND)
    expect(primaryPath(stepOut(single(el(LEGEND)), G))).toBeNull()
    // The second click of a double-click never drills.
    const legend = single(el(LEGEND))
    expect(clickSelect(legend, G, entry('a'), undefined, undefined, 2, plain)).toBe(legend)
    // The hover shows what a click would select.
    expect(hoverSelect(single(null), G, entry('a'), undefined, undefined, plain)).toEqual(LEGEND)
    expect(hoverSelect(legend, G, entry('a'), undefined, undefined, plain)).toEqual(entry('a'))
  })

  it('Shift / ⌘ toggles entries once the legend is entered, the legend giving way', () => {
    let s = single(el(LEGEND))
    s = clickSelect(s, G, entry('a'), undefined, undefined, 1, shift)
    expect(elementPaths(s, G)).toEqual([entry('a')])
    s = clickSelect(s, G, entry('c'), undefined, undefined, 1, shift)
    expect(elementPaths(s, G)).toEqual([entry('a'), entry('c')])
    s = clickSelect(s, G, entry('a'), undefined, undefined, 1, shift)
    expect(elementPaths(s, G)).toEqual([entry('c')])
    // Not entered: Shift-click adds the legend (with what else is selected).
    const t = clickSelect(single(el(['title'])), G, entry('a'), undefined, undefined, 1, shift)
    expect(elementPaths(t, G)).toEqual([['title'], LEGEND])
    // Several selected: a plain click on one selects it alone.
    const two = selectionOf([el(entry('a')), el(entry('b'))])
    expect(
      elementPaths(clickSelect(two, G, entry('a'), undefined, undefined, 1, plain), G),
    ).toEqual([entry('a')])
  })

  it('in a laid-out graph: hit keys, halos, Enter, Tab, Same kind, names, resolving', () => {
    const { g, scene, ds } = setup()
    const s = scene()
    const { nodes, marks } = sceneIndex(s.root)
    const label = nodes.map.get(`legend/${ds[1]}/label`)!
    expect(hitKey(label, label.target, nodes.entryOf)).toEqual(entry(ds[1]!))
    // The legend's frame (no box here): every part of it.
    expect(hitKey({ id: 'legend' }, ['legend'], nodes.entryOf)).toEqual(LEGEND)
    // A mark: as before.
    const mark = nodes.all.find((n) => n.id.startsWith('series/') && n.prim)!
    expect(hitKey(mark, mark.target, nodes.entryOf)?.[0]).toBe('layers')
    // The legend and an entry resolve while drawn; a hidden entry doesn't.
    expect(keyResolves(marks, g(), LEGEND)).toBe(true)
    expect(keyResolves(marks, g(), entry(ds[0]!))).toBe(true)
    expect(keyResolves(marks, g(), entry('nothing'))).toBe(false)
    // Halos: the legend outlined, entries each.
    expect(legendHalos(s, [LEGEND]).legend).not.toBeNull()
    expect(legendHalos(s, [entry(ds[0]!), entry(ds[2]!)]).entries).toHaveLength(2)
    expect(legendHalos(s, [entry(ds[0]!)]).legend).toBeNull()
    // Enter: into the legend's first entry; Tab from an entry: past the legend.
    expect(primaryPath(stepIn(single(el(LEGEND)), G, nodes, marks)!)).toEqual(entry(ds[0]!))
    const order = [['title'], LEGEND, ['annotations', 0]] as StylePath[]
    expect(primaryPath(tabStep(single(el(entry(ds[0]!))), G, order, 1)!)).toEqual([
      'annotations',
      0,
    ])
    // Same kind: every entry, in the legend's order.
    expect(kindName(g(), kindOf(g(), entry(ds[0]!))!)).toBe('legend entries')
    const same = selectSameKind(single(el(entry(ds[1]!))), g(), nodes.all)!
    expect(elementPaths(same, G)).toEqual(ds.map((k) => entry(k)))
    expect(primaryPath(same)).toEqual(entry(ds[1]!))
    // Names.
    expect(elementName(g(), entry(ds[0]!), () => 'A')).toBe('Legend entry “A”')
    expect(elementName(g(), LEGEND)).toBe('Legend')
  })

  it('audit 3 (A1): the legend is in Tab’s, ⌘A’s and the bar’s order whenever entries are drawn', () => {
    // No box (as made): none of the legend's nodes targets the legend (its entries their data sets).
    const { g, scene, ds } = setup()
    const { nodes } = sceneIndex(scene().root)
    const order = elementOrder(g(), nodes.all)
    expect(order.filter((p) => p[0] === 'legend')).toEqual([LEGEND])
    // After the axes and data sets (reading order; no annotations here: last).
    expect(order.at(-1)).toEqual(LEGEND)
    expect(elementPaths(selectAll(G, order), G)).toContainEqual(LEGEND)
    // Tab reaches it, and goes on from it (and from an entry).
    const before = order.at(-2)!
    expect(primaryPath(tabStep(single(el(before)), G, order, 1)!)).toEqual(LEGEND)
    // No legend drawn: not in the order.
    const hidden = setup({ show: false })
    expect(
      elementOrder(hidden.g(), sceneIndex(hidden.scene().root).nodes.all).some(
        (p) => p[0] === 'legend',
      ),
    ).toBe(false)
    // ] and [ step through the entries from the legend or an entry, round; else nothing.
    const entries = nodes.entries
    const at = (s: Selection | null) => (s ? primaryPath(s) : null)
    expect(at(entryStep(single(el(LEGEND)), G, entries, 1))).toEqual(entry(ds[0]!))
    expect(at(entryStep(single(el(LEGEND)), G, entries, -1))).toEqual(entry(ds[3]!))
    expect(at(entryStep(single(el(entry(ds[1]!))), G, entries, 1))).toEqual(entry(ds[2]!))
    expect(at(entryStep(single(el(entry(ds[3]!))), G, entries, 1))).toEqual(entry(ds[0]!))
    expect(at(entryStep(single(el(entry(ds[0]!))), G, entries, -1))).toEqual(entry(ds[3]!))
    expect(entryStep(single(el(['title'])), G, entries, 1)).toBeNull()
    expect(entryStep(single(el(LEGEND)), G, [], 1)).toBeNull()
  })

  it('an entry formats its data set (Legend entry first); the format bar its identity', () => {
    const { g, scene, ds } = setup()
    const nodes = sceneIndex(scene().root).nodes
    const t = formatTargetFor(entry(ds[0]!), g(), undefined, entryTargetIn(nodes))
    expect(t).toEqual({ ...seriesPlace({ dataSet: ds[0]! }), entry: ds[0] })
    expect(formatTargetFor(LEGEND, g())).toEqual(LEGEND_PLACE)
    // Other entries: a Significance class's or result line's layer, else the legend.
    expect(entryPlace('category/0', ['layers', 'wedges'], g())).toEqual({
      ...LEGEND_PLACE,
      entry: 'category/0',
    })
    const sel = selectionOf([el(entry(ds[0]!)), el(['title'])], el(entry(ds[0]!)))
    const bar = barSelection(sel, (k) =>
      k.kind === 'element' ? entryTargetIn(nodes)(String(k.path[2])) : undefined,
    )
    expect(elementPaths(bar, G)).toEqual([['seriesOverrides', ds[0]], ['title']])
    expect(primaryPath(bar)).toEqual(['seriesOverrides', ds[0]])
    const none = single(el(['title']))
    expect(barSelection(none, () => undefined)).toBe(none)
  })

  it('Delete hides selected entries from the legend, one step', () => {
    const { g, ds, store } = setup()
    expect(deletable(g(), entry(ds[0]!))).toBe(true)
    const one = deleteEdits(g(), [entry(ds[0]!)])!
    expect(one.label).toBe('Hide legend entry')
    const two = deleteEdits(g(), [entry(ds[0]!), entry(ds[1]!)])!
    expect([two.label, two.menuLabel]).toEqual(['Hide 2 legend entries', 'Hide from legend (2)'])
    store.dispatch(two.commands, two.label)
    expect(g().legend.hidden).toEqual([ds[0], ds[1]])
    expect(deletable(g(), entry(ds[0]!))).toBe(false)
    const mixed = deleteEdits(g(), [entry(ds[2]!), ['annotations', 0]])
    expect(mixed?.label).toBe('Hide legend entry')
  })

  it('dragging a selected entry: a line where it goes, one edit of the order on release', () => {
    const { g, scene, ds } = setup({ columns: 2 })
    const s = scene()
    const boxes = sceneIndex(s.root).nodes.entries.map((n) => n.bbox!)
    // a b / c d: a dragged to the right half of d.
    const from = boxes[0]!
    const to = boxes[3]!
    const d = {
      kind: 'entry' as const,
      key: ds[0]!,
      x: from.x + 4,
      y: from.y + from.h / 2,
      dx: to.x + to.w - 2 - (from.x + 4),
      dy: to.y + to.h / 2 - (from.y + from.h / 2),
      free: false,
    }
    const o = dragOutcome(g(), s, d, { threshold: 0, sizes: [] })
    expect(o.graph).toBe(g())
    expect(o.insertion).toBeDefined()
    expect(o.commits).toEqual([
      {
        path: ['legend', 'order'],
        value: [ds[1], ds[2], ds[3], ds[0]],
        label: 'Move legend entry',
      },
    ])
    // Dropped where it is: nothing.
    expect(
      dragOutcome(g(), s, { ...d, dx: 1, dy: 0 }, { threshold: 0, sizes: [] }).commits,
    ).toEqual([])
  })
})
