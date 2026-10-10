import { DocumentStore } from '@ps/engine'
import { createGraphFor, DEFAULT_THEME, type StylePath } from '@ps/graph'
import {
  type AnnotationId,
  createProject,
  type GraphNode,
  type LayoutItemId,
  type LayoutNode,
  type NodeId,
  newNodeId,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { sampleTable } from '../../graph/test/helpers.ts'
import { matchesShortcut, parseShortcut } from '../src/commands/shortcut.ts'
import { editedElement, patchLabel } from '../src/formatBar/editStyle.ts'
import { canPaste, copyFormat, pasteCommands } from '../src/formatBar/formatClipboard.ts'
import {
  changeLabel,
  elementTarget,
  fillCommands,
  fillSlots,
  fillValue,
  lineCommands,
  lineSlots,
  lineValues,
  markCommands,
  markSlots,
  markValues,
  positionCommands,
  selectionTargets,
  sharedCapabilities,
  stepCommands,
  type Target,
  textCommands,
  textSlots,
  textValues,
  toggleCommands,
} from '../src/formatBar/selectionStyles.ts'
import { clearRunFields } from '../src/richText/model.ts'
import { itemKey, pageElementKey } from '../src/selection/pageSelection.ts'
import { EMPTY_SELECTION, elementKey, selectionOf } from '../src/selection/selection.ts'

// Roadmap 45: the format bar's targets — what each kind of selection key can be formatted with,
// where its formats live (sparse paths, layer and identity paths), the values shown (as drawn,
// mixed where they differ) and the commands a change makes (checked by the store's validation).

const text = (s: string) => ({ content: [{ text: s }] })
const id = <T extends string>(s: string) => s as T

function fixture() {
  const table = sampleTable('column')
  const base = createGraphFor(table, 'G')
  const ds = table.dataSets.map((d) => d.id as string)
  const graph: GraphNode = {
    ...base,
    title: { content: [{ text: 'Big ' }, { text: 'title', size: 20 }] },
    axes: {
      ...base.axes,
      x: { ...base.axes.x, title: text('Group') },
      y: { ...base.axes.y, title: { ...text('Value'), style: { size: 13 } } },
    },
    legend: { ...base.legend, show: true },
    annotations: [
      {
        type: 'text',
        id: id<AnnotationId>('an1'),
        anchor: { space: 'plot', x: 0.5, y: 0.5 },
        content: text('Note'),
      },
      {
        type: 'line',
        id: id<AnnotationId>('an2'),
        space: 'plot',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        stroke: { color: { rgb: '#ff0000' }, width: 2, dash: 'dash' },
        arrow: 'none',
      },
      {
        type: 'bracket',
        id: id<AnnotationId>('an3'),
        a: ds[0]! as never,
        b: ds[1]! as never,
        label: { source: 'manual', text: [{ text: 'ns', italic: true }] },
        level: 'auto',
      },
    ],
  }
  const second: GraphNode = {
    ...createGraphFor(table, 'H'),
    title: { content: [{ text: 'Other' }], style: { size: 14 } },
  }
  const layout: LayoutNode = {
    kind: 'layout',
    id: newNodeId(),
    name: 'Page',
    page: { width: 612, height: 792 },
    items: [
      { type: 'graph', id: id<LayoutItemId>('ig'), graph: graph.id, x: 0, y: 0, scale: 1 },
      { type: 'graph', id: id<LayoutItemId>('ih'), graph: second.id, x: 0, y: 300, scale: 1 },
      { type: 'text', id: id<LayoutItemId>('it'), x: 10, y: 10, content: text('Caption') },
      {
        type: 'shape',
        id: id<LayoutItemId>('is'),
        shape: 'rect',
        x: 0,
        y: 0,
        w: 50,
        h: 50,
        fill: { type: 'solid', color: { rgb: '#00ff00' }, opacity: 0.5 },
      },
      {
        type: 'line',
        id: id<LayoutItemId>('il'),
        from: { x: 0, y: 0 },
        to: { x: 9, y: 9 },
        stroke: { color: { rgb: '#000000' }, width: 1, dash: 'solid' },
      },
    ],
    panelLabels: { show: false, style: 'A', size: 14 },
  }
  const store = new DocumentStore(createProject())
  store.dispatch([table, graph, second, layout].map((node) => ({ type: 'node.add', node })))
  const project = () => store.getState()
  const g = () => project().nodes[graph.id] as GraphNode
  const points = graph.layers.find((l) => l.geom === 'points')!
  const el = (path: StylePath) => elementKey(graph.id, path)
  const targetOf = (path: StylePath): Target => elementTarget(project(), g(), path, el(path))
  return { store, project, graph, second, layout, g, ds, points, el, targetOf }
}

const theme = DEFAULT_THEME

describe('targets by key kind (one per head of the style path)', () => {
  it('the graph title: its text style, sized as drawn, its runs', () => {
    const f = fixture()
    const t = f.targetOf(['title'])
    expect(t.text?.path).toEqual(['title', 'style'])
    expect(t.text?.runs?.path).toEqual(['title', 'content'])
    expect(t.fill).toBeUndefined()
    // One run is 20 pt, the other the title's: mixed (what is drawn).
    const v = textValues([t.text!])!
    expect(v.size.mixed).toBe(true)
    expect(v.font).toEqual({ value: theme.graphTitle.font, mixed: false })
  })

  it('axes: a title, tick labels, the whole axis (its tick labels and line)', () => {
    const f = fixture()
    const title = f.targetOf(['axes', 'y', 'title'])
    expect(title.text?.path).toEqual(['axes', 'y', 'title', 'style'])
    expect(textValues([title.text!])!.size).toEqual({ value: 13, mixed: false })
    const ticks = f.targetOf(['axes', 'y', 'tickLabels'])
    expect(ticks.text?.path).toEqual(['axes', 'y', 'tickLabels'])
    expect(ticks.line).toBeUndefined()
    const axis = f.targetOf(['axes', 'x'])
    expect(axis.text?.path).toEqual(['axes', 'x', 'tickLabels'])
    expect(axis.line).toMatchObject({ path: ['axes', 'x', 'line'], partial: true })
    expect(lineValues([axis.line!])!.width.value).toBe(theme.axisLine.width)
  })

  it('the legend: text, background and border', () => {
    const t = fixture().targetOf(['legend'])
    expect(t.text?.path).toEqual(['legend', 'text'])
    expect(t.fill).toMatchObject({ kind: 'fill', path: ['legend', 'background'] })
    expect(t.line).toMatchObject({ path: ['legend', 'border'], partial: false, optional: true })
    expect(fillValue([t.fill!])).toEqual({ value: null, mixed: false })
  })

  it('annotations: a text box, a line, a bracket (the graph’s bracket text and line)', () => {
    const f = fixture()
    const box = f.targetOf(['annotations', 0])
    expect(box.text?.path).toEqual(['annotations', 0, 'content', 'style'])
    expect(box.fill?.kind).toBe('fill')
    const line = f.targetOf(['annotations', 1])
    expect(line.text).toBeUndefined()
    expect(lineValues([line.line!])).toEqual({
      color: { value: '#ff0000', mixed: false },
      width: { value: 2, mixed: false },
      dash: { value: 'dash', mixed: false },
    })
    const bracket = f.targetOf(['annotations', 2])
    expect(bracket.text?.path).toEqual(['style', 'bracket', 'label'])
    expect(bracket.text?.runs).toMatchObject({
      path: ['annotations', 2, 'label', 'text'],
      label: true,
    })
    expect(bracket.line?.path).toEqual(['style', 'bracket', 'line'])
    // A run in italic: the bracket's label reads italic.
    expect(textValues([bracket.text!])!.italic.value).toBe(true)
  })

  it('a layer’s data set: its colour (identity) and, in a points layer, its symbols', () => {
    const f = fixture()
    const t = f.targetOf(['layers', f.points.id, 'series', f.ds[0]!])
    expect(t.dataSet).toMatchObject({ node: f.graph.id, key: f.ds[0], layer: { id: f.points.id } })
    expect(t.fill?.kind).toBe('identity')
    expect(fillValue([t.fill!])!.value).toBe(theme.palette[0])
    expect(t.mark).toMatchObject({ key: f.ds[0], layer: { id: f.points.id } })
    // The whole layer: symbols for every data set, no colour.
    const layer = f.targetOf(['layers', f.points.id])
    expect(layer.mark?.key).toBeNull()
    expect(layer.fill).toBeUndefined()
    // Another geom: no symbols.
    const other = f.g().layers.find((l) => l.geom !== 'points')
    if (other) expect(f.targetOf(['layers', other.id, 'series', f.ds[0]!]).mark).toBeUndefined()
  })

  it('a data set’s identity, the graph’s backgrounds, a single point', () => {
    const f = fixture()
    expect(f.targetOf(['seriesOverrides', f.ds[1]!]).fill).toMatchObject({
      kind: 'identity',
      shown: theme.palette[1],
    })
    expect(f.targetOf(['style', 'plotBackground']).fill).toMatchObject({
      path: ['style', 'plotBackground'],
    })
    // Roadmap 47: a single point: its colour, border and symbol at its own override.
    const point = f.targetOf(['pointOverrides', f.ds[0]!, 'r0'])
    expect([...sharedCapabilities([point])].sort()).toEqual(['fill', 'line', 'mark'])
    expect(point.fill).toMatchObject({
      kind: 'identity',
      path: ['pointOverrides', f.ds[0], 'r0', 'color'],
      shown: theme.palette[0],
    })
    expect(point.line?.path).toEqual(['pointOverrides', f.ds[0], 'r0', 'border'])
    expect(point.mark).toMatchObject({ key: f.ds[0], point: 'r0' })
    expect(point.dataSet).toBeUndefined()
  })

  it('several points: mixed values, each written at its own override in one step', () => {
    const f = fixture()
    const keys: StylePath[] = [
      ['pointOverrides', f.ds[0]!, 'r0'],
      ['pointOverrides', f.ds[0]!, 'r1'],
      ['pointOverrides', f.ds[1]!, 'r0'],
    ]
    // One point red and larger already.
    f.store.dispatch(
      [
        {
          type: 'node.set',
          id: f.graph.id,
          path: [...keys[0]!, 'color'],
          value: { rgb: '#ff0000' },
        },
        { type: 'node.set', id: f.graph.id, path: [...keys[0]!, 'size'], value: 9 },
      ],
      'Format point',
    )
    const targets = selectionTargets(
      { project: f.project() },
      selectionOf(keys.map((k) => f.el(k))),
    )
    expect(fillValue(fillSlots(targets))!.mixed).toBe(true)
    expect(markValues(markSlots(targets))!.size.mixed).toBe(true)
    expect(markValues(markSlots(targets))!.shape.mixed).toBe(false)
    // Colour, border width, shape and size: every point's own, one valid step each.
    f.store.dispatch(fillCommands(fillSlots(targets), { palette: 3 }), 'Colour')
    f.store.dispatch(lineCommands(lineSlots(targets), { width: 2 }), 'Line width')
    f.store.dispatch(markCommands(markSlots(targets), { shape: 'square', size: 6 }), 'Symbol')
    const own = f.g().pointOverrides!
    for (const k of keys) {
      const p = own[k[1] as never]![String(k[2])]!
      expect(p).toMatchObject({ color: { palette: 3 }, shape: 'square', size: 6 })
      expect(p.border?.width).toBe(2)
    }
    // The data sets' and layers' own formats untouched.
    expect(f.g().seriesOverrides[f.ds[0] as never]?.color).toBeUndefined()
    expect(f.g().layers.find((l) => l.id === f.points.id)?.series?.[f.ds[0]!]).toBeUndefined()
    // Automatic: the colour follows the data set again.
    const now = selectionTargets({ project: f.project() }, selectionOf(keys.map((k) => f.el(k))))
    f.store.dispatch(fillCommands(fillSlots(now), undefined), 'Colour')
    expect(f.g().pointOverrides![f.ds[0] as never]!.r0!.color).toBeUndefined()
    const after = selectionTargets({ project: f.project() }, selectionOf(keys.map((k) => f.el(k))))
    expect(fillValue(fillSlots(after))).toEqual({ value: theme.palette[0], mixed: true })
  })

  it('nothing selected: the graph’s base text', () => {
    const f = fixture()
    const [t] = selectionTargets({ project: f.project(), graph: f.graph.id }, EMPTY_SELECTION)
    expect(t?.text?.path).toEqual(['style', 'text'])
    expect(t?.key).toBeNull()
  })

  it('page items and parts of graphs on a page', () => {
    const f = fixture()
    const L = f.layout.id
    const ctx = { project: f.project() }
    const [graphItem, textItem, shape, line] = selectionTargets(
      ctx,
      selectionOf(['ig', 'it', 'is', 'il'].map((i) => itemKey(L, i as LayoutItemId))),
    )
    expect(graphItem!.text).toMatchObject({ node: f.graph.id, path: ['style', 'text'] })
    expect(textItem!.text).toMatchObject({
      node: L,
      path: ['items', { id: 'it' }, 'content', 'style'],
    })
    expect(textItem!.fill).toMatchObject({ path: ['items', { id: 'it' }, 'background'] })
    expect(fillValue([shape!.fill!])!.value).toBe('#00ff00')
    expect(line!.line).toMatchObject({ optional: false, partial: false })
    const parts = selectionTargets(
      ctx,
      selectionOf([
        pageElementKey(L, 'ig' as LayoutItemId, ['title']),
        pageElementKey(L, 'ih' as LayoutItemId, ['title']),
      ]),
    )
    expect(parts.map((t) => t.text?.node)).toEqual([f.graph.id, f.second.id])
  })
})

describe('values shown and groups enabled', () => {
  it('mixed where the targets differ, not where they agree', () => {
    const f = fixture()
    const a = f.targetOf(['axes', 'x', 'title']).text!
    const b = f.targetOf(['axes', 'y', 'title']).text!
    expect(textValues([a, b])!.size.mixed).toBe(true)
    expect(textValues([a, b])!.font.mixed).toBe(false)
    expect(textValues([a, a])!.size.mixed).toBe(false)
    const fills = fillSlots([
      f.targetOf(['layers', f.points.id, 'series', f.ds[0]!]),
      f.targetOf(['layers', f.points.id, 'series', f.ds[1]!]),
    ])
    expect(fillValue(fills)!.mixed).toBe(true)
    const marks = markSlots([
      f.targetOf(['layers', f.points.id, 'series', f.ds[0]!]),
      f.targetOf(['layers', f.points.id, 'series', f.ds[1]!]),
    ])
    expect(markValues(marks)!.size.mixed).toBe(false)
  })

  it('the groups every target offers (position: any moved one)', () => {
    const f = fixture()
    const title = f.targetOf(['title'])
    const legend = f.targetOf(['legend'])
    const ds = f.targetOf(['layers', f.points.id, 'series', f.ds[0]!])
    expect([...sharedCapabilities([title, legend])]).toEqual(['text'])
    expect([...sharedCapabilities([title, ds])]).toEqual([])
    expect([...sharedCapabilities([ds])].sort()).toEqual(['fill', 'mark'])
    const moved = { ...title, position: { node: f.graph.id, paths: [['titleOffset']] } }
    expect(sharedCapabilities([moved, legend]).has('position')).toBe(true)
  })
})

describe('changes', () => {
  it('a size for three titles: sparse writes, runs’ sizes cleared, one valid step', () => {
    const f = fixture()
    const keys = [['title'], ['axes', 'x', 'title'], ['axes', 'y', 'title']] as StylePath[]
    const slots = textSlots(keys.map(f.targetOf))
    const cmds = textCommands(slots, { size: 10 })
    expect(cmds).toContainEqual({
      type: 'node.set',
      id: f.graph.id,
      path: ['axes', 'x', 'title', 'style', 'size'],
      value: 10,
    })
    // The title's 20 pt run follows the title.
    expect(cmds).toContainEqual({
      type: 'node.set',
      id: f.graph.id,
      path: ['title', 'content'],
      value: [{ text: 'Big title' }],
    })
    f.store.dispatch(cmds, changeLabel('Font size 10 pt', 3))
    expect(f.store.undoLabel).toBe('Font size 10 pt (3 elements)')
    const after = textSlots(keys.map(f.targetOf))
    expect(textValues(after)!.size).toEqual({ value: 10, mixed: false })
    // Fields not changed stay absent (sparse).
    expect(f.g().axes.x.title?.style).toEqual({ size: 10 })
    // Automatic: the field removed.
    f.store.dispatch(textCommands(after, { size: undefined }))
    expect(f.g().axes.y.title?.style).toEqual({})
  })

  it('grow steps each from its own size; bold toggles on for all unless all are bold', () => {
    const f = fixture()
    const slots = textSlots([f.targetOf(['axes', 'y', 'title']), f.targetOf(['legend'])])
    f.store.dispatch(stepCommands(slots, 1))
    expect(f.g().axes.y.title?.style?.size).toBe(14)
    expect(f.g().legend.text?.size).toBe(stepSizeOf(theme.legend.size))
    const ticks = () => textSlots([f.targetOf(['axes', 'y', 'tickLabels'])])
    f.store.dispatch(toggleCommands(ticks(), 'bold'))
    expect(f.g().axes.y.tickLabels?.bold).toBe(true)
    f.store.dispatch(toggleCommands(ticks(), 'bold'))
    expect(f.g().axes.y.tickLabels?.bold).toBe(false)
  })

  it('a bracket’s label runs stored as a label (a string once plain)', () => {
    const f = fixture()
    f.store.dispatch(textCommands(textSlots([f.targetOf(['annotations', 2])]), { italic: false }))
    const b = f.g().annotations[2]
    expect(b?.type === 'bracket' && b.label.source === 'manual' && b.label.text).toBe('ns')
    expect(f.g().style.bracket?.label).toEqual({ italic: false })
  })

  it('colours: a data set’s identity, a fill made solid, Automatic removing it', () => {
    const f = fixture()
    const two = fillSlots([
      f.targetOf(['layers', f.points.id, 'series', f.ds[0]!]),
      f.targetOf(['layers', f.points.id, 'series', f.ds[1]!]),
    ])
    f.store.dispatch(fillCommands(two, { rgb: '#123456' }))
    expect(f.g().seriesOverrides[f.ds[0]!]?.color).toEqual({ rgb: '#123456' })
    expect(f.g().seriesOverrides[f.ds[1]!]?.color).toEqual({ rgb: '#123456' })
    const box = () => fillSlots([f.targetOf(['annotations', 0])])
    f.store.dispatch(fillCommands(box(), { palette: 2 }))
    expect(f.g().annotations[0]).toMatchObject({
      background: { type: 'solid', color: { palette: 2 }, opacity: 1 },
    })
    f.store.dispatch(fillCommands(box(), undefined))
    expect(f.g().annotations[0]).not.toHaveProperty('background')
  })

  it('lines: an axis field by field, a border whole, a required line never removed', () => {
    const f = fixture()
    const axis = lineSlots([f.targetOf(['axes', 'y'])])
    expect(lineCommands(axis, { width: 2 })).toEqual([
      { type: 'node.set', id: f.graph.id, path: ['axes', 'y', 'line', 'width'], value: 2 },
    ])
    const legend = lineSlots([f.targetOf(['legend'])])
    f.store.dispatch(lineCommands(legend, { dash: 'dot' }))
    expect(f.g().legend.border).toEqual({ color: { rgb: '#000000' }, width: 1, dash: 'dot' })
    f.store.dispatch(lineCommands(lineSlots([f.targetOf(['legend'])]), null))
    expect(f.g().legend.border).toBeUndefined()
    expect(lineCommands(lineSlots([f.targetOf(['annotations', 1])]), null)).toEqual([])
  })

  it('symbols: a data set’s entry in its layer, or the layer for all', () => {
    const f = fixture()
    const one = markSlots([f.targetOf(['layers', f.points.id, 'series', f.ds[0]!])])
    f.store.dispatch(markCommands(one, { shape: 'square', size: 9 }))
    const l = f.g().layers.find((x) => x.id === f.points.id)!
    expect(l.series?.[f.ds[0]!]?.style).toEqual({ shape: 'square', size: 9 })
    const all = markSlots([f.targetOf(['layers', f.points.id])])
    f.store.dispatch(markCommands(all, { size: 4 }))
    const m = f.g().layers.find((x) => x.id === f.points.id)!
    expect(m.style).toMatchObject({ size: 4 })
    expect(m.series?.[f.ds[0]!]?.style).toEqual({ shape: 'square' })
  })

  it('Reset position clears the moved targets’ offsets', () => {
    const f = fixture()
    f.store.dispatch({
      type: 'node.set',
      id: f.graph.id,
      path: ['axes', 'y', 'titleOffset'],
      value: { dx: 3, dy: 0 },
    })
    const t = f.targetOf(['axes', 'y', 'title'])
    expect(t.position?.paths).toEqual([['axes', 'y', 'titleOffset']])
    f.store.dispatch(positionCommands([t]))
    expect(f.g().axes.y.titleOffset).toBeUndefined()
  })

  it('page items: a text box’s style, a shape’s fill keeping its opacity', () => {
    const f = fixture()
    const L = f.layout.id
    const ts = () =>
      selectionTargets(
        { project: f.project() },
        selectionOf([itemKey(L, 'it' as LayoutItemId), itemKey(L, 'is' as LayoutItemId)]),
      )
    f.store.dispatch(textCommands(textSlots(ts()), { font: 'serif' }))
    f.store.dispatch(fillCommands(fillSlots(ts()), { rgb: '#0000ff' }))
    const page = f.project().nodes[L] as LayoutNode
    expect(page.items[2]).toMatchObject({ content: { style: { font: 'serif' } } })
    expect(page.items[3]).toMatchObject({
      fill: { type: 'solid', color: { rgb: '#0000ff' }, opacity: 0.5 },
    })
  })

  it('runs lose only the fields set', () => {
    expect(
      clearRunFields(
        [
          { text: 'a', size: 9, italic: true },
          { text: 'b', size: 12 },
        ],
        ['size'],
      ),
    ).toEqual([{ text: 'a', italic: true }, { text: 'b' }])
    const same = [{ text: 'x', bold: true }]
    expect(clearRunFields(same, ['size'])).toBe(same)
  })
})

describe('the format painter', () => {
  const graphsOf = (f: ReturnType<typeof fixture>) => (gid: NodeId) =>
    f.project().nodes[gid] as GraphNode | undefined

  it('copies the Y title’s text and pastes it onto the X title, runs following', () => {
    const f = fixture()
    const copied = copyFormat(f.targetOf(['axes', 'y', 'title']), graphsOf(f))!
    expect(copied.text).toMatchObject({ size: 13, font: theme.axisTitle.font })
    expect(copied.line).toBeUndefined()
    const targets = [f.targetOf(['axes', 'x', 'title']), f.targetOf(['title'])]
    const p = pasteCommands(copied, targets)
    expect(p.count).toBe(2)
    f.store.dispatch(p.commands, changeLabel('Paste format', p.count))
    expect(f.store.undoLabel).toBe('Paste format (2 elements)')
    expect(f.g().axes.x.title?.style).toMatchObject({ size: 13 })
    // The title's 20 pt run follows.
    expect(f.g().title?.content).toEqual([{ text: 'Big title' }])
  })

  it('a line onto lines only; nothing for targets without a place for it', () => {
    const f = fixture()
    const copied = copyFormat(f.targetOf(['annotations', 1]), graphsOf(f))!
    expect(canPaste(copied, [f.targetOf(['title'])])).toBe(false)
    const p = pasteCommands(copied, [f.targetOf(['axes', 'y']), f.targetOf(['title'])])
    expect(p.count).toBe(1)
    f.store.dispatch(p.commands)
    expect(f.g().axes.y.line).toEqual({ color: { rgb: '#ff0000' }, width: 2, dash: 'dash' })
  })

  it('data sets: everything but the colour, unless pasted with colour', () => {
    const f = fixture()
    const one = ['layers', f.points.id, 'series', f.ds[0]!] as StylePath
    const two = ['layers', f.points.id, 'series', f.ds[1]!] as StylePath
    f.store.dispatch([
      ...markCommands(markSlots([f.targetOf(one)]), { shape: 'triangle', size: 7 }),
      ...fillCommands(fillSlots([f.targetOf(one)]), { rgb: '#aa0000' }),
    ])
    const copied = copyFormat(f.targetOf(one), graphsOf(f))!
    expect(copied.dataSet?.color).toEqual({ rgb: '#aa0000' })
    f.store.dispatch(pasteCommands(copied, [f.targetOf(two)]).commands)
    const layer = () => f.g().layers.find((l) => l.id === f.points.id)!
    expect(layer().series?.[f.ds[1]!]?.style).toMatchObject({ shape: 'triangle', size: 7 })
    expect(f.g().seriesOverrides[f.ds[1]!]?.color).toBeUndefined()
    f.store.dispatch(pasteCommands(copied, [f.targetOf(two)], { color: true }).commands)
    expect(f.g().seriesOverrides[f.ds[1]!]?.color).toEqual({ rgb: '#aa0000' })
  })

  it('across graphs: a title’s format onto another graph’s axis title on a page', () => {
    const f = fixture()
    const L = f.layout.id
    const [src, dst] = selectionTargets(
      { project: f.project() },
      selectionOf([
        pageElementKey(L, 'ih' as LayoutItemId, ['title']),
        pageElementKey(L, 'ig' as LayoutItemId, ['axes', 'x', 'title']),
      ]),
    )
    const copied = copyFormat(src!, graphsOf(f))!
    f.store.dispatch(pasteCommands(copied, [dst!]).commands)
    expect(f.g().axes.x.title?.style).toMatchObject({ size: 14 })
  })
})

describe('keys and in-place edits', () => {
  type Mods = Partial<Record<'meta' | 'alt' | 'shift', boolean>>
  const press = (key: string, code: string, mods: Mods) => ({
    key,
    code,
    metaKey: !!mods.meta,
    ctrlKey: false,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
  })

  it('⌥⌘C matches by the key’s position (macOS types ç); other layouts keep their letters', () => {
    const copy = parseShortcut('Mod+Alt+C')
    expect(matchesShortcut(copy, press('ç', 'KeyC', { meta: true, alt: true }), true)).toBe(true)
    const grow = parseShortcut('Mod+Shift+>')
    expect(matchesShortcut(grow, press('.', 'Period', { meta: true, shift: true }), true)).toBe(
      true,
    )
    // AZERTY: the key at Z's place types w, and ⌘ with it is not Undo.
    const undo = parseShortcut('Mod+Z')
    expect(matchesShortcut(undo, press('w', 'KeyZ', { meta: true }), true)).toBe(false)
  })

  it('names the element an in-place edit opened, and its change', () => {
    expect(editedElement(['title', 'content'])).toEqual(['title'])
    expect(editedElement(['axes', 'y', 'title', 'content'])).toEqual(['axes', 'y', 'title'])
    expect(editedElement(['annotations', 2, 'content', 'content'])).toEqual(['annotations', 2])
    expect(editedElement(['legend'])).toBeNull()
    expect(patchLabel({ size: 10 })).toBe('Font size 10 pt')
    expect(patchLabel({ font: 'serif' })).toBe('Font Serif')
    expect(patchLabel({ color: undefined })).toBe('Text colour')
  })
})

/** The size after one grow step (Word's list). */
function stepSizeOf(n: number) {
  const sizes = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]
  return sizes.find((s) => s > n)
}
