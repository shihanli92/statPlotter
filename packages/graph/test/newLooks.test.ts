import type { GraphNode, Layer, NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  layoutGraph,
  NEW_BAR_FILL,
  NEW_LIGHT_BAR_FILL,
  newLayerLooks,
  presetGraph,
  type Scene,
  withLayers,
  withNewLayerLook,
} from '../src/index.ts'
import { flatten, fonts, projectOf, sampleTable } from './helpers.ts'

// Audit 3 (RFR-5, RTA-12; fix after 0.3.7, decisions 1272-1273): the looks new layers start
// with — solid bars, but light bars (the theme's outline in their colour) beside the table's
// points (the points keep their colour), lines through each replicate faded only beside a mean
// line — written into new graphs' layers and layers added; layers already there and graphs
// already made (v1 documents migrated, graphs saved before) keep drawing as they did.

const lay = (table: ReturnType<typeof sampleTable>, graph: GraphNode): Scene =>
  layoutGraph({ project: projectOf(table, graph), graph, fonts })

/** The outlines an element of the scene is drawn with, by id prefix. */
const outlines = (s: Scene, prefix: string) =>
  flatten(s.root)
    .filter((n) => n.id.startsWith(prefix) && n.prim)
    .map((n) => {
      const p = n.prim as { stroke?: { color: string; width: number } | null }
      return p.stroke ? `${p.stroke.color}/${p.stroke.width}` : 'none'
    })

/** The colours an element of the scene is drawn in, by id prefix. */
const fills = (s: Scene, prefix: string) =>
  flatten(s.root)
    .filter((n) => n.id.startsWith(prefix) && n.prim)
    .map((n) => {
      const p = n.prim as { fill?: { color: string; opacity?: number } | null }
      return p.fill ? `${p.fill.color}@${p.fill.opacity ?? 1}` : 'none'
    })
const strokes = (s: Scene, prefix: string) =>
  flatten(s.root)
    .filter((n) => n.id.startsWith(prefix) && n.prim?.type === 'polyline')
    .map((n) => (n.prim as { stroke: { color: string } }).stroke.color)

const blue = DEFAULT_THEME.palette[0]!

const bars: Layer = { id: 'bars', geom: 'bar', stat: { kind: 'summary', center: 'mean' } }
const points: Layer = { id: 'points', geom: 'points', stat: { kind: 'identity' } }
const styleOf = (layers: readonly Layer[], geom: Layer['geom']) =>
  layers.find((l) => l.geom === geom)?.style

describe('new graphs’ bars (RTA-12, decision 1272)', () => {
  it('with points: light bars outlined in their colour; the points keep their colour', () => {
    const table = sampleTable('column')
    const g = { ...presetGraph(table, 'barsPoints'), id: 'g' as NodeId }
    expect(styleOf(g.layers, 'bar')).toEqual({ fill: NEW_LIGHT_BAR_FILL })
    // The points as the preset makes them, nothing written into them.
    expect(styleOf(g.layers, 'points')).toBeUndefined()
    expect(NEW_LIGHT_BAR_FILL).toMatchObject({ color: { series: true }, opacity: 0.4 })
    const s = lay(table, g)
    expect(fills(s, 'series/a/bar')[0]).toBe(`${blue}@0.4`)
    expect(outlines(s, 'series/a/bar')[0]).toBe(`${blue}/1`)
    // The points in their data set's colour, as without bars.
    expect(new Set(fills(s, 'series/a/point'))).toEqual(new Set([`${blue}@1`]))
    expect(new Set(outlines(s, 'series/a/point'))).toEqual(new Set([`${blue}/0.75`]))
  })

  it('without points: solid in their data set’s colour', () => {
    const table = sampleTable('column')
    const g = { ...presetGraph(table, 'bars'), id: 'g' as NodeId }
    expect(styleOf(g.layers, 'bar')).toEqual({ fill: NEW_BAR_FILL })
    expect(fills(lay(table, g), 'series/a/bar')[0]).toBe(`${blue}@1`)
    // Hidden points draw nothing over the bars: solid.
    expect(styleOf(newLayerLooks([bars, { ...points, visible: false }]), 'bar')).toEqual({
      fill: NEW_BAR_FILL,
    })
    expect(styleOf(newLayerLooks([bars]), 'bar')).toEqual({ fill: NEW_BAR_FILL })
  })

  it('a fill or outline of the layer’s own is kept', () => {
    const own = {
      ...bars,
      style: { border: { color: { rgb: '#000000' }, width: 2, dash: 'solid' } },
    } as Layer
    expect(styleOf(newLayerLooks([own, points]), 'bar')).toEqual({
      fill: NEW_LIGHT_BAR_FILL,
      border: { color: { rgb: '#000000' }, width: 2, dash: 'solid' },
    })
    const filled = { ...bars, style: { fill: { type: 'none' } } } as Layer
    expect(styleOf(newLayerLooks([filled, points]), 'bar')).toEqual({ fill: { type: 'none' } })
  })

  it('adding a layer never restyles the layers already there', () => {
    // Points added to a graph of solid bars: the bars stay solid, the points keep their colour.
    const solid = newLayerLooks([bars])
    const after = newLayerLooks([...solid, points], solid)
    expect(after[0]).toBe(solid[0])
    expect(after[1]).toBe(points)
    expect(withNewLayerLook(solid, points)).toBe(points)
    // Bars added beside points: light and outlined; the points untouched.
    const added = withNewLayerLook([points], bars)
    expect(added.style).toEqual({ fill: NEW_LIGHT_BAR_FILL })
    const both = newLayerLooks([bars, points], [points])
    expect(both[1]).toBe(points)
    // A kept layer, whatever comes: as it was (white points of a graph made before stay white).
    const white = {
      ...points,
      style: { fill: { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 } },
    } as Layer
    expect(newLayerLooks([bars, white], [white])[1]).toBe(white)
  })

  it('a graph made before (no look of its own) keeps the theme’s pale bars', () => {
    const table = sampleTable('column')
    const g = presetGraph(table, 'barsPoints', undefined, { looks: 'theme' })
    expect(g.layers.find((l) => l.geom === 'bar')!.style?.fill).toBeUndefined()
    const s = lay(table, { ...g, id: 'g' as NodeId })
    expect(fills(s, 'series/a/bar')[0]).toBe(`${blue}@0.35`)
  })

  it('a bar layer kept by Change layers keeps its look; a new one takes the rule', () => {
    const table = sampleTable('column')
    const pale = presetGraph(table, 'barsPoints', undefined, { looks: 'theme' })
    const same = withLayers(pale, { frame: pale.frame, look: pale.look!, layers: pale.layers })
    expect(same.layers.find((l) => l.geom === 'bar')!.style?.fill).toBeUndefined()
    // Points, then bars with points: the new bars light (the points are drawn with them).
    const pts = presetGraph(table, 'points', undefined, { looks: 'theme' })
    const bp = presetGraph(table, 'barsPoints', undefined, { looks: 'theme' })
    const changed = withLayers(pts, { frame: bp.frame, look: bp.look!, layers: bp.layers })
    expect(styleOf(changed.layers, 'bar')).toEqual({ fill: NEW_LIGHT_BAR_FILL })
    expect(styleOf(changed.layers, 'points')).toBeUndefined()
    // Bars, then bars with points: the bars kept solid, the new points in their colour.
    const solid = presetGraph(table, 'bars')
    const more = withLayers(solid, { frame: bp.frame, look: bp.look!, layers: bp.layers })
    expect(styleOf(more.layers, 'bar')).toEqual({ fill: NEW_BAR_FILL })
    expect(styleOf(more.layers, 'points')).toBeUndefined()
  })
})

describe('lines through each replicate (RFR-5)', () => {
  const subjects: Layer = { id: 'subjects', geom: 'line', stat: { kind: 'identity' } }

  it('alone with the points: drawn in the data set’s colour, not faded', () => {
    const table = sampleTable('xy')
    const each = presetGraph(table, 'each')
    const g = withLayers(each, {
      frame: each.frame,
      look: each.look!,
      layers: [subjects, ...each.layers],
    })
    expect(new Set(strokes(lay(table, { ...g, id: 'g' as NodeId }), 'series/a/subject'))).toEqual(
      new Set([blue]),
    )
  })

  it('beside a mean line (the spaghetti preset): faded, as before; a mean line added fades them', () => {
    const table = sampleTable('xy')
    const spaghetti = { ...presetGraph(table, 'spaghetti'), id: 'g' as NodeId }
    const faded = strokes(lay(table, spaghetti), 'series/a/subject')
    expect(faded.length).toBeGreaterThan(0)
    expect(faded.every((c) => c !== blue)).toBe(true)
    // Lines alone, then the mean line added: the fade this set is taken back.
    const each = presetGraph(table, 'each')
    const alone = withLayers(each, {
      frame: each.frame,
      look: each.look!,
      layers: [subjects, ...each.layers],
    })
    const withMean = withLayers(alone, {
      frame: spaghetti.frame,
      look: spaghetti.look!,
      layers: spaghetti.layers,
    })
    expect(withMean.layers.find((l) => l.id === 'subjects')!.style).toBeUndefined()
    // A fade of the user's own stays.
    const own = withLayers(
      {
        ...alone,
        layers: alone.layers.map((l) =>
          l.id === 'subjects' ? ({ ...l, style: { fade: 0.3 } } as Layer) : l,
        ),
      },
      { frame: spaghetti.frame, look: spaghetti.look!, layers: spaghetti.layers },
    )
    expect(own.layers.find((l) => l.id === 'subjects')!.style).toEqual({ fade: 0.3 })
  })
})
