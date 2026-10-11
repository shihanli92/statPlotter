import { DocumentStore, DraftStore } from '@ps/engine'
import { createGraphFor, frontFirst, layoutGraph, type SceneNode, type StylePath } from '@ps/graph'
import { createTable, type DataSetKey, type GraphNode, newAnnotationId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import {
  ALL_SERIES,
  axisPlace,
  deselectTarget,
  dialogTitle,
  type FormatTarget,
  formatTargetFor,
  graphPlace,
  highlightOf,
  homeLayer,
  LEGEND_PLACE,
  layerPlace,
  layerView,
  placeName,
  pointPlace,
  seriesLayers,
  seriesTarget,
  TITLE_PLACE,
  tabsFor,
  withTab,
} from '../src/graph/format/route.ts'
import { styleCommands } from '../src/graph/inspector/layers.ts'
import { hitKey, legendEntryPath, sceneIndex } from '../src/selection/sceneKeys.ts'

function setup() {
  const table = createTable({ tableKind: 'column', columns: 2, rows: 3 })
  table.dataSets[0]!.subcolumns[0]!.values = [1, 4, 9]
  table.dataSets[1]!.subcolumns[0]!.values = [2, 3, 5]
  const [a, b] = table.dataSets.map((d) => d.id as unknown as DataSetKey)
  const base = createGraphFor(table)
  const graph: GraphNode = {
    ...base,
    title: { content: [{ text: 'Title' }] },
    legend: { ...base.legend, show: true },
    axes: { ...base.axes, y: { ...base.axes.y, title: { content: [{ text: 'Response' }] } } },
    annotations: [
      {
        type: 'bracket',
        id: newAnnotationId(),
        a: a!,
        b: b!,
        label: { source: 'manual', text: '*' },
        level: 'auto',
      },
      {
        type: 'text',
        id: newAnnotationId(),
        anchor: { space: 'plot', x: 0.1, y: 0.1 },
        content: { content: [{ text: 'Note' }] },
      },
      {
        type: 'line',
        id: newAnnotationId(),
        space: 'plot',
        from: { x: 0.1, y: 0.1 },
        to: { x: 0.5, y: 0.5 },
        stroke: { color: { rgb: '#000000' }, width: 1, dash: 'solid' },
        arrow: 'end',
      },
    ],
  }
  const project = projectOf(table, graph)
  return { project, table, graph, keys: [a!, b!] as string[] }
}

/** Every scene node with the style target it (or its nearest ancestor) carries. */
function hits(root: SceneNode): { id: string; target: StylePath | undefined }[] {
  const out: { id: string; target: StylePath | undefined }[] = []
  const walk = (n: SceneNode, inherited?: StylePath) => {
    const target = n.target ?? inherited
    out.push({ id: n.id, target })
    for (const c of n.children ?? []) walk(c, target)
  }
  walk(root)
  return out
}

describe('which place of the Format options an element opens (roadmap 46: by element)', () => {
  it('routes data, axes, titles, legend and annotations to their places', () => {
    const { graph, keys } = setup()
    const route = (t: StylePath | null) => formatTargetFor(t, graph)
    // Roadmap 49b: a layer's marks of a data set: that layer's view, the data set picked; a whole
    // layer: that layer for every data set; a data set's identity: its view in the front-most
    // layer drawing it.
    for (const layer of ['points', 'error', 'center'])
      expect(route(['layers', layer, 'series', keys[1]!])).toEqual({
        place: 'layer',
        layer,
        series: { dataSet: keys[1]! },
      })
    expect(route(['layers', 'error'])).toEqual(layerPlace('error'))
    expect(layerView('error', ALL_SERIES)).toEqual(layerPlace('error'))
    // Its home layer: the front-most drawing it of its own (not error bars attached to points).
    const front = homeLayer(graph, { dataSet: keys[1]! })!.id
    expect(graph.layers.find((l) => l.id === front)?.on).toBeUndefined()
    expect(seriesLayers(graph, { dataSet: keys[1]! }).map((l) => l.id)).toEqual(
      frontFirst(graph.layers).map((l) => l.id),
    )
    expect(route(['seriesOverrides', keys[1]!])).toEqual(layerView(front, { dataSet: keys[1]! }))
    // Axes and their parts: that axis; its title opens its Title section.
    expect(route(['axes', 'x'])).toEqual(axisPlace('x'))
    expect(route(['axes', 'y', 'tickLabel'])).toEqual(axisPlace('y'))
    expect(route(['axes', 'x', 'treatments'])).toEqual(axisPlace('x'))
    expect(route(['axes', 'x', 'spans'])).toEqual(axisPlace('x'))
    expect(route(['axes', 'y', 'scaleBar'])).toEqual(axisPlace('y'))
    expect(route(['axes', 'y', 'title'])).toEqual(axisPlace('y', 'title'))
    // The frame, plot area, background and corner arrows: the graph's Frame section.
    expect(route(['style', 'frame'])).toEqual(graphPlace('frame'))
    expect(route(['style', 'plotBackground'])).toEqual(graphPlace('frame'))
    expect(route(['style', 'arrows'])).toEqual(graphPlace('frame'))
    expect(route(['style', 'background'])).toEqual(graphPlace('frame'))
    // The graph title: its own place.
    expect(route(['title'])).toEqual(TITLE_PLACE)
    // The legend; roadmap 47b: an entry, its data set's place naming it (given its target), else
    // the legend's.
    expect(route(['legend'])).toEqual(LEGEND_PLACE)
    expect(route(legendEntryPath(keys[0]!))).toEqual({ ...LEGEND_PLACE, entry: keys[0] })
    expect(
      formatTargetFor(legendEntryPath(keys[0]!), graph, undefined, () => [
        'seriesOverrides',
        keys[0]!,
      ]),
    ).toEqual({ ...seriesTarget(graph, { dataSet: keys[0]! }), entry: keys[0] })
    // Brackets and objects.
    expect(route(['annotations', 0])).toEqual({ place: 'bracket', index: 0 })
    expect(route(['annotations', 1])).toEqual({ place: 'object', index: 1 })
    expect(route(['annotations', 2])).toEqual({ place: 'object', index: 2 })
    // Nothing in particular / something that no longer exists: the graph.
    expect(route(null)).toEqual(graphPlace())
    expect(route(['annotations', 9])).toEqual(graphPlace('annotations'))
    expect(route(['layers', 'gone', 'series', keys[0]!])).toEqual(graphPlace())
  })

  it('every element of a laid-out graph opens the place of what it is', () => {
    const { project, graph } = setup()
    const scene = layoutGraph({ project, graph, fonts })
    const seen = new Set<string>()
    const { entryOf } = sceneIndex(scene.root).nodes
    for (const { id, target } of hits(scene.root)) {
      const key = hitKey({ id }, target, entryOf)
      const t = formatTargetFor(key, graph)
      seen.add(t.place)
      if (id.startsWith('legend')) expect(t.place).toBe('legend')
      else if (id.startsWith('axis/')) expect(t.place).toBe('axis')
      else if (id.startsWith('series/')) {
        // Roadmap 49b: a mark opens the layer that drew it, its data set picked.
        expect(t.place).toBe('layer')
        expect(t.place === 'layer' && t.series).toBeTruthy()
      } else if (id === 'title') expect(t).toEqual(TITLE_PLACE)
    }
    expect([...seen].sort()).toEqual([
      'axis',
      'bracket',
      'graph',
      'layer',
      'legend',
      'object',
      'title',
    ])
  })

  it('names places by element, tabs only between the axes; highlights the target', () => {
    const { graph, keys } = setup()
    expect(tabsFor(graphPlace(), graph)).toEqual([])
    expect(tabsFor(layerView('points', { dataSet: keys[0]! }), graph)).toEqual([])
    expect(tabsFor(axisPlace('x'), graph).map((t) => t.label)).toEqual(['X axis', 'Y axis'])
    expect(tabsFor(LEGEND_PLACE, graph)).toEqual([])
    expect(withTab(axisPlace('x', 'title'), 'y')).toEqual(axisPlace('y'))
    expect(dialogTitle(graphPlace(), graph)).toBe('Format graph')
    expect(dialogTitle(layerView('points', { dataSet: keys[0]! }), graph)).toBe('Format graph')
    expect(dialogTitle(pointPlace(keys[0]!, 'r1s0'), graph)).toBe('Format graph')
    expect(dialogTitle(axisPlace('y'), graph)).toBe('Format axes')
    expect(dialogTitle(TITLE_PLACE, graph)).toBe('Format title')
    expect(dialogTitle({ place: 'object', index: 1 }, graph)).toBe('Format text')
    expect(dialogTitle({ place: 'object', index: 2 }, graph)).toBe('Format arrow')
    const title = (k: string) => (k === keys[0] ? 'Control' : undefined)
    expect(placeName(graphPlace(), graph)).toBe('Graph')
    expect(placeName(axisPlace('y'), graph)).toBe('Y axis')
    expect(placeName(TITLE_PLACE, graph)).toBe('Graph title')
    // Roadmap 49b: a layer's view is headed by the layer's name, whichever data set it picks.
    expect(placeName(layerView('points', { dataSet: keys[0]! }), graph, title)).toMatch(/^Points/)
    expect(placeName(pointPlace(keys[0]!, 'r1s0'), graph, title)).toBe('Data point of “Control”')
    expect(placeName(layerPlace('points'), graph)).toMatch(/^Points/)
    expect(placeName({ place: 'object', index: 1 }, graph)).toBe('Text box')
    const bracket: FormatTarget = { place: 'bracket', index: 0 }
    expect(highlightOf(layerView('points', { dataSet: keys[0]! }))).toEqual([
      'layers',
      'points',
      'series',
      keys[0],
    ])
    expect(highlightOf(pointPlace(keys[0]!, 'r1s0'))).toEqual(['pointOverrides', keys[0], 'r1s0'])
    expect(highlightOf(layerPlace('points'))).toEqual(['layers', 'points'])
    expect(highlightOf(graphPlace('dataSets'))).toBeNull()
    expect(highlightOf(axisPlace('y'))).toEqual(['axes', 'y'])
    expect(highlightOf(TITLE_PLACE)).toEqual(['title'])
    expect(highlightOf(bracket)).toEqual(['annotations', 0])
  })
})

describe('a click on empty space in the preview', () => {
  it('deselects, as on the canvas: the graph’s place, nothing highlighted', () => {
    const point = pointPlace('ds1', 'r2s0')
    for (const t of [
      point,
      layerView('points', { dataSet: 'ds1' }),
      layerPlace('points'),
      axisPlace('y'),
      TITLE_PLACE,
      LEGEND_PLACE,
      { place: 'object', index: 0 } as FormatTarget,
    ]) {
      expect(deselectTarget(t)).toEqual(graphPlace())
      expect(highlightOf(deselectTarget(t))).toBeNull()
    }
  })
})

describe('OK / Cancel in a Format dialog', () => {
  function stores() {
    const { project, graph, keys } = setup()
    const store = new DocumentStore(project)
    // Some prior history, so we can see the dialog adds exactly one step.
    store.dispatch({ type: 'node.set', id: graph.id, path: ['size', 'plotWidth'], value: 150 })
    const g = (s: DocumentStore) => s.getState().nodes[graph.id] as GraphNode
    return { store, graph, keys, g }
  }

  it('OK applies every change made in the dialog as one undo step', () => {
    const { store, graph, keys, g } = stores()
    const before = store.getState()
    const labelBefore = store.undoLabel
    const draft = new DraftStore(store)
    // What the Appearance tab does: one data set's symbols, then all data sets' error bars…
    const layer = (id: string) => g(draft).layers.find((l) => l.id === id)!
    draft.dispatch(styleCommands(g(draft), layer('points'), keys[0]!, [['size', 9]]), 'Format')
    draft.dispatch(styleCommands(g(draft), layer('error'), keys[1]!, [['direction', 'above']]))
    draft.dispatch(styleCommands(g(draft), layer('error'), null, [['direction', 'below']]))
    // …and the Frame tab.
    draft.dispatch({ type: 'node.set', id: graph.id, path: ['style', 'frame'], value: 'box' })
    // The preview shows it; the document doesn't yet.
    expect(g(draft).style.frame).toBe('box')
    expect(store.getState()).toBe(before)

    expect(draft.commit('Format graph')).toBe(true)
    const after = g(store)
    const own = (id: string) => after.layers.find((l) => l.id === id)!
    expect(store.undoLabel).toBe('Format graph')
    expect(after.style.frame).toBe('box')
    expect(own('points').series?.[keys[0]!]?.style).toEqual({ size: 9 })
    // "All data sets" set the layer's style and cleared the per-data-set choice it overrides.
    expect(own('error').style).toMatchObject({ direction: 'below' })
    expect(own('error').series?.[keys[1]!]).toBeUndefined()

    store.undo()
    expect(store.getState()).toEqual(before)
    expect(store.undoLabel).toBe(labelBefore)
    expect(g(store).size.plotWidth).toBe(150)
  })

  it('Cancel discards the draft: document and history untouched', () => {
    const { store, graph } = stores()
    const before = store.getState()
    const label = store.undoLabel
    const draft = new DraftStore(store)
    draft.dispatch({ type: 'node.set', id: graph.id, path: ['style', 'frame'], value: 'none' })
    draft.dispatch({ type: 'project.setSettings', settings: { pValueStyle: 'NEJM' } })
    // Cancel: the dialog just drops the draft.
    expect(store.getState()).toBe(before)
    expect(store.undoLabel).toBe(label)
  })
})
