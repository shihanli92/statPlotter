import { layoutGraph, presetGraph, type StylePath } from '@ps/graph'
import {
  type Annotation,
  createTable,
  type GraphNode,
  type LayoutItem,
  type LayoutItemId,
  type NodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import { CommandRegistry } from '../src/commands/registry.ts'
import { commandItems, countedLabel } from '../src/components/commandItems.ts'
import { itemKey, itemsSelection, pageElementKey } from '../src/selection/pageSelection.ts'
import {
  kindName,
  kindOf,
  type PageGraph,
  pageKindName,
  pathsOfKind,
  selectSameItems,
  selectSameKind,
  selectSameKindOnPage,
} from '../src/selection/sameKind.ts'
import { sceneIndex } from '../src/selection/sceneKeys.ts'
import {
  elementKey,
  elementPaths,
  primaryKey,
  primaryPath,
  type Selection,
  selectionOf,
  single,
} from '../src/selection/selection.ts'
import {
  FORMAT_MENU_IDS,
  SAME_KIND_IDS,
  sameKindCommands,
  selectionCommandEntries,
  selectMenuEntry,
} from '../src/selection/selectionMenu.ts'

// Roadmap 45: Select ▸ Same kind on the graph canvas and on layout pages, and the context menus'
// registry commands (counts, Select ▸, the format painter's ids).

/** A column graph of three data sets in two layers (points and a median line), with titles. */
function sample(id = 'g1') {
  const table = createTable({ tableKind: 'column', columns: 3, rows: 4 })
  table.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = [1 + i, 2 + i, 4 + 2 * i, 3 + i]
  })
  const [A, B, C] = table.dataSets.map((d) => d.id as string) as [string, string, string]
  const bracket = (a: string, b: string): Annotation =>
    ({
      type: 'bracket',
      id: `br${a}${b}` as never,
      a,
      b,
      label: { source: 'manual', text: '*' },
      level: 'auto',
    }) as Annotation
  const text = (x: number): Annotation =>
    ({
      type: 'text',
      id: `t${x}` as never,
      anchor: { space: 'plot', x, y: 0.1 },
      content: { content: [{ text: 'Note' }] },
    }) as Annotation
  const base = presetGraph(table, 'pointsMedian')
  const graph: GraphNode = {
    ...base,
    id: id as NodeId,
    // Two layers: the points (back) and the median line (front).
    layers: base.layers.filter((l) => l.id !== 'error'),
    title: { content: [{ text: 'Growth' }] },
    axes: {
      ...base.axes,
      x: { ...base.axes.x, title: { content: [{ text: 'Group' }] } },
      y: { ...base.axes.y, title: { content: [{ text: 'Response' }] } },
    },
    annotations: [text(0.1), bracket(A, B), text(0.6), bracket(B, C)],
  }
  const project = projectOf(table, graph)
  const scene = layoutGraph({ project, graph, fonts })
  const { all } = sceneIndex(scene.root).nodes
  const layers = graph.layers.map((l) => l.id)
  return { graph, all, A, B, C, layers, project }
}

const s = sample()
const G = s.graph.id
const on = (path: StylePath): Selection => single(elementKey(G, path))
const paths = (sel: Selection | null) => (sel ? elementPaths(sel, G) : null)

describe('Same kind on the graph canvas', () => {
  it('names the kind of what is selected', () => {
    expect(kindOf(s.graph, ['title'])).toEqual({ kind: 'title' })
    expect(kindOf(s.graph, ['axes', 'y', 'title'])).toEqual({ kind: 'title' })
    expect(kindOf(s.graph, ['axes', 'x', 'tickLabels'])).toEqual({ kind: 'tickLabels' })
    expect(kindOf(s.graph, ['axes', 'x'])).toEqual({ kind: 'axis' })
    expect(kindOf(s.graph, ['annotations', 1])).toEqual({ kind: 'annotation', type: 'bracket' })
    expect(kindOf(s.graph, ['annotations', 2])).toEqual({ kind: 'annotation', type: 'text' })
    expect(kindOf(s.graph, ['layers', 'L', 'series', s.A])).toEqual({ kind: 'dataSet', layer: 'L' })
    // A single point has no kind (Enter and the marquee pick points).
    expect(kindOf(s.graph, ['pointOverrides', s.A, '0'])).toBeNull()
    expect(kindName(s.graph, { kind: 'title' })).toBe('titles')
    expect(kindName(s.graph, { kind: 'title' }, 'everyLayer')).toBeNull()
    expect(kindName(s.graph, { kind: 'dataSet', layer: 'x' }, 'everyLayer')).toBe(
      'data sets in every layer',
    )
  })

  it('selects every title, the primary kept', () => {
    const next = selectSameKind(on(['axes', 'y', 'title']), s.graph, s.all)!
    expect(paths(next)).toEqual([['title'], ['axes', 'y', 'title'], ['axes', 'x', 'title']])
    expect(primaryPath(next)).toEqual(['axes', 'y', 'title'])
  })

  it('selects every tick-label group, every axis', () => {
    expect(paths(selectSameKind(on(['axes', 'x', 'tickLabels']), s.graph, s.all))).toEqual([
      ['axes', 'y', 'tickLabels'],
      ['axes', 'x', 'tickLabels'],
    ])
    expect(paths(selectSameKind(on(['axes', 'y']), s.graph, s.all))).toEqual([
      ['axes', 'y'],
      ['axes', 'x'],
    ])
  })

  it('selects the data sets of the layer, or of every layer', () => {
    const [back, front] = s.layers as [string, string]
    const one = on(['layers', front, 'series', s.B])
    expect(paths(selectSameKind(one, s.graph, s.all))).toEqual(
      [s.A, s.B, s.C].map((k) => ['layers', front, 'series', k]),
    )
    // Front layer first, as ⌘A orders them.
    expect(paths(selectSameKind(one, s.graph, s.all, 'everyLayer'))).toEqual([
      ...[s.A, s.B, s.C].map((k) => ['layers', front, 'series', k]),
      ...[s.A, s.B, s.C].map((k) => ['layers', back, 'series', k]),
    ])
    expect(primaryPath(selectSameKind(one, s.graph, s.all, 'everyLayer')!)).toEqual([
      'layers',
      front,
      'series',
      s.B,
    ])
    // Whole layers, and data sets themselves.
    expect(paths(selectSameKind(on(['layers', back]), s.graph, s.all))).toEqual([
      ['layers', front],
      ['layers', back],
    ])
    expect(paths(selectSameKind(on(['seriesOverrides', s.C]), s.graph, s.all))).toEqual(
      [s.A, s.B, s.C].map((k) => ['seriesOverrides', k]),
    )
  })

  it('selects the annotations of the same type', () => {
    expect(paths(selectSameKind(on(['annotations', 3]), s.graph, s.all))).toEqual([
      ['annotations', 1],
      ['annotations', 3],
    ])
    expect(paths(selectSameKind(on(['annotations', 0]), s.graph, s.all))).toEqual([
      ['annotations', 0],
      ['annotations', 2],
    ])
  })

  it('works from the primary of several, and does nothing for points or nothing', () => {
    const mixed = selectionOf([elementKey(G, ['legend']), elementKey(G, ['title'])])
    expect(paths(selectSameKind(mixed, s.graph, s.all))).toEqual([
      ['title'],
      ['axes', 'y', 'title'],
      ['axes', 'x', 'title'],
    ])
    expect(selectSameKind(on(['pointOverrides', s.A, '0']), s.graph, s.all)).toBeNull()
    expect(selectSameKind(selectionOf([]), s.graph, s.all)).toBeNull()
    // Every layer of a title: not offered.
    expect(selectSameKind(on(['title']), s.graph, s.all, 'everyLayer')).toBeNull()
  })

  it('leaves out what isn’t drawn', () => {
    const { title: _, ...x } = s.graph.axes.x
    const noXTitle: GraphNode = {
      ...s.graph,
      axes: { ...s.graph.axes, x: x as GraphNode['axes']['x'] },
    }
    const all = sceneIndex(layoutGraph({ project: s.project, graph: noXTitle, fonts }).root).nodes
      .all
    expect(pathsOfKind(noXTitle, all, { kind: 'title' })).toEqual([
      ['title'],
      ['axes', 'y', 'title'],
    ])
  })
})

describe('Same kind on a page', () => {
  const L = 'layout1' as NodeId
  const P = 'itemP' as LayoutItemId
  const Q = 'itemQ' as LayoutItemId
  const R = 'itemR' as LayoutItemId
  const q = sample('g2')
  const graphs: PageGraph[] = [
    { item: P, graph: s.graph, all: s.all },
    { item: Q, graph: q.graph, all: q.all },
    { item: R, graph: q.graph, all: q.all },
  ]
  const part = (item: LayoutItemId, path: StylePath) => pageElementKey(L, item, path)
  const parts = (sel: Selection | null) =>
    sel?.keys.map((k) => (k.kind === 'pageElement' ? [k.item, k.path] : k.kind)) ?? null

  it('selects the kind across the graphs worked in, or every graph on the page', () => {
    // P's Y title alone: P's titles.
    const one = single(part(P, ['axes', 'y', 'title']))
    expect(parts(selectSameKindOnPage(one, L, graphs))).toEqual([
      [P, ['title']],
      [P, ['axes', 'y', 'title']],
      [P, ['axes', 'x', 'title']],
    ])
    // P's and Q's: titles of both (R is not worked in) …
    const two = selectionOf([part(Q, ['title']), part(P, ['axes', 'y', 'title'])])
    const both = selectSameKindOnPage(two, L, graphs)!
    expect(parts(both)).toHaveLength(6)
    expect(primaryKey(both)).toEqual(part(P, ['axes', 'y', 'title']))
    // … or of every graph on the page.
    expect(parts(selectSameKindOnPage(one, L, graphs, 'everyGraph'))).toHaveLength(9)
  })

  it('takes a data set’s layer by its id in each graph, or every layer', () => {
    const front = s.layers[1]!
    const one = single(part(P, ['layers', front, 'series', s.A]))
    expect(parts(selectSameKindOnPage(one, L, graphs, 'everyGraph'))).toHaveLength(9)
    expect(parts(selectSameKindOnPage(one, L, graphs, 'everyLayer'))).toHaveLength(6)
    expect(selectSameKindOnPage(single(itemKey(L, P)), L, graphs)).toBeNull()
  })

  it('selects page items of the same type, unlocked, groups whole', () => {
    const items = [
      { id: 'a', type: 'text' },
      { id: 'b', type: 'graph' },
      { id: 'c', type: 'text', locked: true },
      { id: 'd', type: 'text', group: 'g' },
      { id: 'e', type: 'image', group: 'g' },
      { id: 'f', type: 'text' },
    ] as unknown as LayoutItem[]
    const ids = (sel: Selection | null) =>
      sel?.keys.map((k) => (k.kind === 'item' ? k.item : '?')) ?? null
    const next = selectSameItems(itemsSelection(L, ['f' as LayoutItemId]), L, items)
    expect(ids(next)).toEqual(['a', 'd', 'e', 'f'])
    expect(primaryKey(next!)).toEqual(itemKey(L, 'f' as LayoutItemId))
    expect(pageKindName(itemsSelection(L, ['b' as LayoutItemId]), items, () => undefined)).toBe(
      'graphs',
    )
    expect(selectSameItems(single(part(P, ['title'])), L, items)).toBeNull()
  })

  it('names what it selects', () => {
    const graphOf = (item: LayoutItemId) => graphs.find((g) => g.item === item)?.graph
    const two = selectionOf([part(Q, ['title']), part(P, ['axes', 'y', 'title'])])
    expect(pageKindName(two, [], graphOf)).toBe('titles in 2 graphs')
    expect(pageKindName(two, [], graphOf, 'everyGraph')).toBe('titles in every graph on the page')
    expect(pageKindName(two, [], graphOf, 'everyLayer')).toBeNull()
  })
})

describe('the context menus’ registry commands (roadmap 45)', () => {
  const registry = new CommandRegistry()
  const ran: string[] = []
  registry.set('view', 'view', [
    ...sameKindCommands(
      ['kind', 'everyLayer'],
      (scope) => (scope === 'kind' ? 'titles' : null),
      (scope) => ran.push(scope),
    ),
    { id: 'format.pasteFormat', label: 'Paste format', run: () => ran.push('paste') },
    { id: 'format.copyFormat', label: 'Copy format…', run: () => {} },
  ])

  it('counts what a command acts on', () => {
    expect(countedLabel('Paste format', 3)).toBe('Paste format (3)')
    expect(countedLabel('Copy format…', 2)).toBe('Copy format (2)…')
    expect(countedLabel('Paste format', 1)).toBe('Paste format')
  })

  it('lists the format painter’s commands registered, with the count', () => {
    const items = commandItems(registry, selectionCommandEntries(FORMAT_MENU_IDS, 3))
    // Paste format with colour isn't registered: left out.
    expect(items.map((i) => i.label)).toEqual(['Copy format (3)…', 'Paste format (3)'])
    items[1]!.onSelect!()
    expect(ran).toContain('paste')
    expect(
      commandItems(new CommandRegistry(), selectionCommandEntries(FORMAT_MENU_IDS, 3)),
    ).toEqual([])
  })

  it('offers Select ▸ Same kind, the wider scopes only when they apply', () => {
    const [select] = commandItems(registry, [selectMenuEntry(['kind', 'everyLayer'])])
    expect(select!.label).toBe('Select')
    expect(select!.submenu!.map((i) => i.label)).toEqual(['All titles'])
    select!.submenu![0]!.onSelect!()
    expect(ran).toContain('kind')
    expect(registry.get(SAME_KIND_IDS.kind)?.label).toBe('Select all titles')
    expect(registry.get(SAME_KIND_IDS.everyLayer)?.enabled).toBe(false)
    // Nothing on offer: no submenu.
    const none = new CommandRegistry()
    expect(commandItems(none, ['-', selectMenuEntry(['kind'])])).toEqual([])
  })
})
