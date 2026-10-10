import { createGraphFor, layoutGraph, type StylePath } from '@ps/graph'
import {
  createTable,
  type GraphNode,
  type LayoutItem,
  type LayoutItemId,
  type NodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import { dragOutcome } from '../src/graph/canvasDrag.ts'
import {
  dragSelection,
  enteredItems,
  itemIdsOf,
  itemKey,
  itemsSelection,
  type PageHit,
  pageElementClick,
  pageElementKey,
  pageElementName,
  pageElementsOf,
  pageElementsText,
  pageKeyResolves,
  pageStepOut,
  primaryPageElement,
} from '../src/selection/pageSelection.ts'
import { resolvesIn, sceneIndex } from '../src/selection/sceneKeys.ts'
import {
  EMPTY_SELECTION,
  primaryKey,
  resolveSelection,
  type Selection,
  selectionOf,
  single,
} from '../src/selection/selection.ts'

// Roadmap 44 stage 2 (decisions 870–872): a layout page's selection on the one model — items by
// id, parts of graphs placed on the page, and the deep-select click rules.

const L = 'layout1' as NodeId
const B = 'itemB' as LayoutItemId
const C = 'itemC' as LayoutItemId
const T = 'itemT' as LayoutItemId
const plain = { alt: false, additive: false }
const shift = { alt: false, additive: true }
const part = (item: LayoutItemId, path: StylePath) => pageElementKey(L, item, path)
const paths = (s: Selection) => pageElementsOf(s).map((k) => [k.item, k.path])
const hit = (key: StylePath, point?: string): PageHit => ({ key, point, target: key })
const Y_TITLE: StylePath = ['axes', 'y', 'title']
const marks = (ds: string): StylePath => ['layers', 'L1', 'series', ds]

describe('a page’s items on the selection model', () => {
  it('holds items by id, in the order selected; ids gone drop out', () => {
    const s = itemsSelection(L, [B, T])
    expect(itemIdsOf(s)).toEqual([B, T])
    expect(primaryKey(s)).toEqual(itemKey(L, T))
    const items = [{ type: 'text', id: B }] as unknown as LayoutItem[]
    const r = resolveSelection(s, (k) => pageKeyResolves(k, items, () => true))
    expect(itemIdsOf(r)).toEqual([B])
    expect(itemIdsOf(itemsSelection(L, []))).toEqual([])
  })

  it('goes into the graph selected alone, or the graphs holding selected parts', () => {
    expect([...enteredItems(single(itemKey(L, B)))]).toEqual([B])
    expect([...enteredItems(itemsSelection(L, [B, C]))]).toEqual([])
    expect([...enteredItems(EMPTY_SELECTION)]).toEqual([])
    const parts = selectionOf([part(B, Y_TITLE), part(C, Y_TITLE)])
    expect([...enteredItems(parts)]).toEqual([B, C])
  })
})

describe('clicks on graphs on a page', () => {
  it('the first click selects the graph (an item click), the next one the part clicked', () => {
    // A graph not selected: the click is the item's.
    expect(pageElementClick(EMPTY_SELECTION, L, B, hit(Y_TITLE), 1, plain)).toBeNull()
    expect(pageElementClick(itemsSelection(L, [B, C]), L, B, hit(Y_TITLE), 1, plain)).toBeNull()
    // Selected alone: its part.
    const s = pageElementClick(single(itemKey(L, B)), L, B, hit(Y_TITLE), 1, plain)!
    expect(paths(s)).toEqual([[B, Y_TITLE]])
    expect(primaryPageElement(s)).toEqual(part(B, Y_TITLE))
    // Off its parts (nothing, a background): the graph item.
    expect(pageElementClick(s, L, B, null, 1, plain)).toEqual(single(itemKey(L, B)))
    expect(pageElementClick(single(itemKey(L, B)), L, B, null, 1, plain)).toEqual(
      single(itemKey(L, B)),
    )
    // Another graph while a part is selected: an item click (that graph selected).
    expect(pageElementClick(s, L, C, hit(Y_TITLE), 1, plain)).toBeNull()
  })

  it('keeps the canvas’ rules inside a graph: its data set, then a point of it', () => {
    let s = pageElementClick(single(itemKey(L, B)), L, B, hit(marks('A'), 'r0'), 1, plain)!
    expect(paths(s)).toEqual([[B, marks('A')]])
    s = pageElementClick(s, L, B, hit(marks('A'), 'r1'), 1, plain)!
    expect(paths(s)).toEqual([[B, ['pointOverrides', 'A', 'r1']]])
    expect(s.drill).toEqual(marks('A'))
    // Escape: the point's data set, then the graph item, then nothing.
    s = pageStepOut(s, L)
    expect(paths(s)).toEqual([[B, marks('A')]])
    s = pageStepOut(s, L)
    expect(s).toEqual(single(itemKey(L, B)))
    expect(pageStepOut(s, L)).toBe(EMPTY_SELECTION)
    // The second click of a double-click never drills (a double-click formats the data set).
    const d = pageElementClick(
      selectionOf([part(B, marks('A'))]),
      L,
      B,
      hit(marks('A'), 'r1'),
      2,
      plain,
    )!
    expect(paths(d)).toEqual([[B, marks('A')]])
  })

  it('Shift-click adds parts of the same or another graph; again takes them out', () => {
    let s = pageElementClick(single(itemKey(L, B)), L, B, hit(Y_TITLE), 1, plain)!
    // With items selected, Shift-click is the item's (toggling it).
    expect(pageElementClick(single(itemKey(L, B)), L, C, hit(Y_TITLE), 1, shift)).toBeNull()
    s = pageElementClick(s, L, C, hit(Y_TITLE), 1, shift)!
    expect(paths(s)).toEqual([
      [B, Y_TITLE],
      [C, Y_TITLE],
    ])
    expect(primaryPageElement(s)).toEqual(part(C, Y_TITLE))
    s = pageElementClick(s, L, B, hit(['title']), 1, shift)!
    expect(paths(s)).toEqual([
      [B, Y_TITLE],
      [C, Y_TITLE],
      [B, ['title']],
    ])
    expect(pageElementsText(s, graphOf)).toBe('3 elements in 2 graphs')
    // Off any part: nothing changes.
    expect(pageElementClick(s, L, C, null, 1, shift)).toBe(s)
    // Taken out again: the primary stays.
    s = pageElementClick(s, L, C, hit(Y_TITLE), 1, shift)!
    expect(paths(s)).toEqual([
      [B, Y_TITLE],
      [B, ['title']],
    ])
    expect(primaryPageElement(s)).toEqual(part(B, ['title']))
    expect(pageElementsText(s, graphOf)).toBe('2 elements of “Dose response”')
    // A data set's point added with Shift adds the data set (never a drill).
    s = pageElementClick(s, L, C, hit(marks('A'), 'r0'), 1, shift)!
    expect(paths(s).at(-1)).toEqual([C, marks('A')])
    // Escape from parts of several graphs: the primary part's graph item.
    expect(pageStepOut(s, L)).toEqual(single(itemKey(L, C)))
  })

  it('a plain click on one of several selected parts selects it alone', () => {
    const s = selectionOf([part(B, marks('A')), part(C, marks('A'))])
    // Not a drill into the data set's point: it is one of several.
    const r = pageElementClick(s, L, B, hit(marks('A'), 'r1'), 1, plain)!
    expect(paths(r)).toEqual([[B, marks('A')]])
    // Another part of a graph worked in: that one, the other graph's parts dropped.
    const t = pageElementClick(s, L, C, hit(['title']), 1, plain)!
    expect(paths(t)).toEqual([[C, ['title']]])
  })

  it('a drag selects the part dragged, unless it is one of the selected (they all move)', () => {
    const s = selectionOf([part(B, Y_TITLE), part(C, Y_TITLE)])
    expect(dragSelection(s, L, C, Y_TITLE)).toBe(s)
    expect(dragSelection(s, L, B, ['title'])).toEqual(single(part(B, ['title'])))
  })
})

const graphs = new Map<LayoutItemId, GraphNode>()
/** A graph per item (made once): “Dose response” for B, “Cell area” for the others. */
const graphOf = (item: LayoutItemId) => {
  let g = graphs.get(item)
  if (!g) {
    const made = createGraphFor(createTable({ columns: 1, rows: 1 }))
    g = { ...made, name: item === B ? 'Dose response' : 'Cell area' }
    graphs.set(item, g)
  }
  return g
}

describe('parts of graphs on a page', () => {
  it('are named with their graph', () => {
    const g = graphOf(B)
    expect(pageElementName(g, Y_TITLE)).toBe('Y axis title of “Dose response”')
    expect(pageElementsText(single(part(B, Y_TITLE)), graphOf)).toBe(
      'Y axis title of “Dose response”',
    )
    expect(pageElementsText(single(itemKey(L, B)), graphOf)).toBe('')
  })

  it('resolve while their item is on the page, unlocked, and the part is drawn', () => {
    const table = createTable({ tableKind: 'column', columns: 2, rows: 3 })
    table.dataSets.forEach((d, i) => {
      d.subcolumns[0]!.values = [1 + i, 2, 3]
    })
    const base = createGraphFor(table)
    const graph: GraphNode = {
      ...base,
      axes: { ...base.axes, y: { ...base.axes.y, title: { content: [{ text: 'Response' }] } } },
    }
    const project = projectOf(table, graph)
    const scene = layoutGraph({ project, graph, fonts })
    const drawn = (_: LayoutItemId, p: StylePath) => resolvesIn(sceneIndex(scene.root).marks, p)
    const items = [
      { type: 'graph', id: B, graph: graph.id, x: 0, y: 0, scale: 1 },
      { type: 'graph', id: C, graph: graph.id, x: 0, y: 0, scale: 1, locked: true },
    ] as LayoutItem[]
    const s = selectionOf([
      part(B, Y_TITLE),
      part(B, ['annotations', 3]),
      part(C, Y_TITLE),
      part(T, Y_TITLE),
    ])
    const r = resolveSelection(s, (k) => pageKeyResolves(k, items, drawn))
    expect(paths(r)).toEqual([[B, Y_TITLE]])
    // An undo that brings them back: the same selection again (it is derived, not reconciled).
    expect(
      resolveSelection(single(part(B, Y_TITLE)), (k) => pageKeyResolves(k, items, drawn)),
    ).toEqual(single(part(B, Y_TITLE)))
  })

  it('of another graph follow a dragged part by its snapped move (`move`)', () => {
    const table = createTable({ tableKind: 'column', columns: 2, rows: 3 })
    table.dataSets.forEach((d, i) => {
      d.subcolumns[0]!.values = [1 + i, 2, 3]
    })
    const base = createGraphFor(table)
    const graph: GraphNode = {
      ...base,
      axes: { ...base.axes, y: { ...base.axes.y, title: { content: [{ text: 'Response' }] } } },
    }
    const project = projectOf(table, graph)
    const scene = layoutGraph({ project, graph, fonts })
    const o = dragOutcome(
      graph,
      scene,
      { kind: 'move', target: { kind: 'axisTitle', axis: 'y' }, dx: 7, dy: 11, free: true },
      { threshold: 0, sizes: [] },
    )
    // Free (Alt): the pointer's move along both axes.
    expect(o.move).toEqual({ dx: 7, dy: 11 })
    expect(o.commits).toHaveLength(1)
  })
})

describe('legends of graphs on a page (roadmap 47b)', () => {
  it('the legend first, then one of its entries; Escape steps back to the legend, then out', () => {
    const entry: StylePath = ['legend', 'entries', 'a']
    let s = single(itemKey(L, B))
    s = pageElementClick(s, L, B, hit(entry), 1, plain)!
    expect(paths(s)).toEqual([[B, ['legend']]])
    s = pageElementClick(s, L, B, hit(entry), 1, plain)!
    expect(paths(s)).toEqual([[B, entry]])
    // Shift-click another entry: both.
    s = pageElementClick(s, L, B, hit(['legend', 'entries', 'b']), 1, shift)!
    expect(paths(s)).toEqual([
      [B, entry],
      [B, ['legend', 'entries', 'b']],
    ])
    s = pageStepOut(s, L)
    expect(paths(s)).toEqual([[B, ['legend']]])
    expect(primaryKey(pageStepOut(s, L))).toEqual(itemKey(L, B))
  })
})
