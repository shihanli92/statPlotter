import type { GraphNode, Layer, NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  layoutGraph,
  NEW_BAR_FILL,
  NEW_POINT_FILL,
  presetGraph,
  type Scene,
  withLayers,
} from '../src/index.ts'
import { flatten, fonts, projectOf, sampleTable } from './helpers.ts'

// Audit 3 (RFR-5, RTA-12): the looks new layers start with — solid bars, white points over them,
// lines through each replicate faded only beside a mean line — written into new graphs' layers;
// graphs already made (v1 documents migrated, graphs saved before) keep drawing as they did.

const lay = (table: ReturnType<typeof sampleTable>, graph: GraphNode): Scene =>
  layoutGraph({ project: projectOf(table, graph), graph, fonts })

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

describe('new graphs’ bars (RTA-12)', () => {
  it('are solid in their data set’s colour, with white points over them', () => {
    const table = sampleTable('column')
    const g = { ...presetGraph(table, 'barsPoints'), id: 'g' as NodeId }
    const bars = g.layers.find((l) => l.geom === 'bar')!
    const points = g.layers.find((l) => l.geom === 'points')!
    expect(bars.style).toMatchObject({ fill: NEW_BAR_FILL })
    expect(points.style).toMatchObject({ fill: NEW_POINT_FILL })
    const s = lay(table, g)
    expect(fills(s, 'series/a/bar')[0]).toBe(`${blue}@1`)
    expect(new Set(fills(s, 'series/a/point'))).toEqual(new Set(['#ffffff@1']))
  })

  it('a graph made before (no look of its own) keeps the theme’s pale bars', () => {
    const table = sampleTable('column')
    const g = presetGraph(table, 'barsPoints', undefined, { looks: 'theme' })
    expect(g.layers.find((l) => l.geom === 'bar')!.style?.fill).toBeUndefined()
    const s = lay(table, { ...g, id: 'g' as NodeId })
    expect(fills(s, 'series/a/bar')[0]).toBe(`${blue}@0.35`)
  })

  it('a bar layer kept by Change layers keeps its look; a new one starts solid', () => {
    const table = sampleTable('column')
    const pale = presetGraph(table, 'barsPoints', undefined, { looks: 'theme' })
    const same = withLayers(pale, { frame: pale.frame, look: pale.look!, layers: pale.layers })
    expect(same.layers.find((l) => l.geom === 'bar')!.style?.fill).toBeUndefined()
    const points = presetGraph(table, 'points', undefined, { looks: 'theme' })
    const bars = presetGraph(table, 'barsPoints', undefined, { looks: 'theme' })
    const changed = withLayers(points, { frame: bars.frame, look: bars.look!, layers: bars.layers })
    expect(changed.layers.find((l) => l.geom === 'bar')!.style).toMatchObject({
      fill: NEW_BAR_FILL,
    })
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
