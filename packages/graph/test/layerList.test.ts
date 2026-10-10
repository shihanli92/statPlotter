import { Geom, type Layer } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  canMoveLayer,
  canMoveLayers,
  frontFirst,
  frontFirstIds,
  GEOM_LAYER_KIND,
  hostsFirst,
  layerBlocks,
  layerMovedBy,
  layerMovedTo,
  layersBetween,
  layersMovedBy,
  layersMovedTo,
  newLayerIndex,
  newStyleLayer,
  plotStyle,
  rowToIndex,
  styleContext,
  withStyleLayer,
} from '../src/index.ts'
import { sampleTable } from './helpers.ts'

// The layer list as the UI edits it (roadmap 33e): documents back to front, lists front first;
// moves keep a layer's attached layers with it and in front of it.

type L = Pick<Layer, 'id' | 'on'>
/** Layers from a spec like 'bars error>bars points' (`a>b`: a attached to b). */
const list = (spec: string): L[] =>
  spec.split(' ').map((s) => {
    const [id, on] = s.split('>')
    return on ? { id: id!, on } : { id: id! }
  })
const ids = (layers: readonly L[]) => layers.map((l) => l.id).join(' ')

describe('the layer list', () => {
  it('shows the front first; rows map back to the document', () => {
    const l = list('bars error>bars points')
    expect(ids(frontFirst(l))).toBe('points error bars')
    expect([0, 1, 2].map((r) => rowToIndex(3, r))).toEqual([2, 1, 0])
  })

  it('keeps a host and the layers attached just in front of it together', () => {
    expect(layerBlocks(list('bars error>bars labels>bars points'))).toEqual([
      [0, 3],
      [3, 4],
    ])
    // Error bars over the points over their bars: a block of their own.
    expect(layerBlocks(list('bars points error>bars'))).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ])
  })

  it('moves a layer one step towards the front or the back', () => {
    const by = (spec: string, id: string, step: 1 | -1) => ids(layerMovedBy(list(spec), id, step))
    // Up (front): past the next layer, its attached layers going along.
    expect(by('bars error>bars points', 'bars', 1)).toBe('points bars error')
    expect(by('points bars error>bars', 'points', 1)).toBe('bars error points')
    // Down (back): the same, behind the previous layer and those attached to it.
    expect(by('points bars error>bars', 'bars', -1)).toBe('bars error points')
    expect(by('bars error>bars points', 'points', -1)).toBe('points bars error')
    // Bars with points: error bars over the points move past them, then join their bars.
    expect(by('bars points error>bars', 'error', -1)).toBe('bars error points')
    expect(by('bars points error>bars', 'bars', 1)).toBe('points bars error')
    // An attached layer never goes behind its host; at the ends nothing moves.
    expect(by('bars error>bars points', 'error', -1)).toBe('bars error points')
    expect(by('bars error>bars labels>bars', 'labels', -1)).toBe('bars labels error')
    expect(by('bars points', 'points', 1)).toBe('bars points')
    expect(by('bars points', 'bars', -1)).toBe('bars points')
    expect(canMoveLayer(list('bars error>bars points'), 'error', -1)).toBe(false)
    expect(canMoveLayer(list('bars error>bars points'), 'error', 1)).toBe(true)
    expect(canMoveLayer(list('points bars error>bars'), 'bars', 1)).toBe(false)
  })

  it('moves a layer to a place (dragging a row), its attached layers along', () => {
    const to = (spec: string, id: string, at: number) => ids(layerMovedTo(list(spec), id, at))
    expect(to('a b c', 'a', 2)).toBe('b c a')
    expect(to('a b c', 'c', 0)).toBe('c a b')
    expect(to('bars error>bars b c', 'bars', 3)).toBe('b c bars error')
    expect(to('bars error>bars b c', 'bars', 2)).toBe('b bars error c')
    expect(to('b c bars error>bars', 'bars', 0)).toBe('bars error b c')
    // Onto its own attached layer: nothing moves; an attached layer dragged behind its host
    // goes just in front of it.
    expect(to('bars error>bars b', 'bars', 1)).toBe('bars error b')
    expect(to('b bars error>bars', 'error', 0)).toBe('b bars error')
  })

  it('keeps every layer and every host behind its attached layers, whatever moves', () => {
    const start = list('a b>a c d>c e>a f')
    const hostsBehind = (l: readonly L[]) =>
      l.every((x, i) => x.on === undefined || l.findIndex((h) => h.id === x.on) < i)
    let checked = 0
    for (const x of start)
      for (let to = 0; to < start.length; to++) {
        for (const moved of [
          layerMovedTo(start, x.id, to),
          layerMovedBy(start, x.id, 1),
          layerMovedBy(start, x.id, -1),
        ]) {
          expect([...moved].map((l) => l.id).sort()).toEqual(start.map((l) => l.id).sort())
          expect(hostsBehind(moved), ids(moved)).toBe(true)
          expect(ids(hostsFirst(moved))).toBe(ids(moved))
          checked++
        }
      }
    expect(checked).toBe(108)
  })

  // Roadmap 47: several layers selected in the list.
  it('selects a range of rows front first, and lists ids in the rows order', () => {
    const l = list('a b c d')
    expect(layersBetween(l, 'b', 'd')).toEqual(['d', 'c', 'b'])
    expect(layersBetween(l, 'd', 'b')).toEqual(['d', 'c', 'b'])
    expect(layersBetween(l, 'c', 'c')).toEqual(['c'])
    expect(layersBetween(l, 'c', 'x')).toEqual([])
    expect(frontFirstIds(l, ['a', 'c', 'x'])).toEqual(['c', 'a'])
  })

  it('moves several layers one step together, keeping their order, stopping at the ends', () => {
    const by = (spec: string, chosen: string, step: 1 | -1) =>
      ids(layersMovedBy(list(spec), chosen.split(' '), step))
    // A block moves as one.
    expect(by('a b c d', 'b c', 1)).toBe('a d b c')
    expect(by('a b c d', 'b c', -1)).toBe('b c a d')
    // Apart: each a step; at the front the first stops and the next closes up behind it.
    expect(by('a b c d', 'a c', 1)).toBe('b a d c')
    expect(by('a b c d', 'b d', 1)).toBe('a c b d')
    expect(by('a b c d', 'c d', 1)).toBe('a b c d')
    expect(by('a b c d', 'a b', -1)).toBe('a b c d')
    expect(canMoveLayers(list('a b c d'), ['c', 'd'], 1)).toBe(false)
    expect(canMoveLayers(list('a b c d'), ['c', 'd'], -1)).toBe(true)
    // Attached layers go with their hosts, chosen or not, and never behind them.
    expect(by('bars error>bars p q', 'bars q', 1)).toBe('p bars error q')
    expect(by('bars error>bars p q', 'bars error', 1)).toBe('p bars error q')
    expect(by('p bars error>bars', 'p bars', 1)).toBe('p bars error')
    // One layer: as `layerMovedBy`.
    const start = list('a b>a c d>c e>a f')
    for (const x of start)
      for (const step of [1, -1] as const)
        expect(ids(layersMovedBy(start, [x.id], step))).toBe(ids(layerMovedBy(start, x.id, step)))
  })

  it('drags several layers together onto a place, in their order', () => {
    const to = (spec: string, chosen: string, dragged: string, at: number) =>
      ids(layersMovedTo(list(spec), chosen.split(' '), dragged, at))
    expect(to('a b c d e', 'a b', 'b', 3)).toBe('c d a b e')
    expect(to('a b c d e', 'a c', 'c', 4)).toBe('b d e a c')
    expect(to('a b c d e', 'd e', 'd', 0)).toBe('d e a b c')
    expect(to('a b c d e', 'b d', 'd', 0)).toBe('b d a c e')
    // Onto one of them: nothing moves; hosts take their attached layers along.
    expect(to('a b c d e', 'b d', 'd', 1)).toBe('a b c d e')
    expect(to('bars error>bars p q', 'bars q', 'bars', 2)).toBe('p bars error q')
    // One layer: as `layerMovedTo`.
    const start = list('a b>a c d>c e>a f')
    for (const x of start)
      for (let at = 0; at < start.length; at++)
        expect(ids(layersMovedTo(start, [x.id], x.id, at))).toBe(ids(layerMovedTo(start, x.id, at)))
  })

  it('keeps every layer and every host behind its attached layers when several move', () => {
    const start = list('a b>a c d>c e>a f')
    const hostsBehind = (l: readonly L[]) =>
      l.every((x, i) => x.on === undefined || l.findIndex((h) => h.id === x.on) < i)
    const all = start.map((l) => l.id)
    for (let mask = 1; mask < 1 << all.length; mask++) {
      const chosen = all.filter((_, i) => mask & (1 << i))
      const moved = [
        layersMovedBy(start, chosen, 1),
        layersMovedBy(start, chosen, -1),
        ...[0, 3, 5].map((at) => layersMovedTo(start, chosen, chosen[0]!, at)),
      ]
      for (const m of moved) {
        expect([...m].map((l) => l.id).sort()).toEqual([...all].sort())
        expect(hostsBehind(m), ids(m)).toBe(true)
      }
    }
  })

  it('sorts every geom into fills and marks', () => {
    for (const g of Geom.options) expect(GEOM_LAYER_KIND[g], g).toMatch(/^(fill|mark)$/)
    expect(Object.keys(GEOM_LAYER_KIND).sort()).toEqual([...Geom.options].sort())
  })

  it('adds a fill behind the marks (in front of the fills), a mark on top', () => {
    const fill = (g: Geom) => GEOM_LAYER_KIND[g] === 'fill'
    // Every pair: a layer there, another added.
    for (const there of Geom.options)
      for (const added of Geom.options) {
        const at = newLayerIndex([{ id: 'a', geom: there }], { id: 'b', geom: added })
        expect(at, `${added} added to ${there}`).toBe(fill(added) && !fill(there) ? 0 : 1)
      }
    const g = (spec: string) =>
      spec.split(' ').map((s) => {
        const [id, geom] = s.split(':')
        return { id: id!, geom: geom as Geom }
      })
    // A band goes in front of an area, behind points and lines.
    expect(newLayerIndex(g('a:area p:points l:line'), { id: 'b', geom: 'band' })).toBe(1)
    // Behind the back-most mark, even with fills in front of it.
    expect(newLayerIndex(g('p:points b:bar'), { id: 'v', geom: 'violin' })).toBe(0)
    expect(newLayerIndex(g('a:area b:bar'), { id: 'v', geom: 'violin' })).toBe(2)
    expect(newLayerIndex(g('a:area p:points'), { id: 'l', geom: 'line' })).toBe(2)
    expect(newLayerIndex([], { id: 'b', geom: 'bar' })).toBe(0)
  })

  it('adds an attached layer in front of its host and what is on it', () => {
    const l = list('bars error>bars points').map((x) => ({
      ...x,
      geom: (x.id === 'bars' ? 'bar' : x.id === 'error' ? 'errorbar' : 'points') as Geom,
    }))
    expect(newLayerIndex(l, { id: 'line', geom: 'line' })).toBe(3)
    expect(newLayerIndex(l, { id: 'labels', geom: 'label', on: 'bars' })).toBe(2)
    expect(newLayerIndex(l, { id: 'labels', geom: 'label', on: 'points' })).toBe(3)
  })

  it('adds plot styles: fills behind the marks, marks on top (a violin behind its box)', () => {
    const table = sampleTable('column')
    const add = (layers: Layer[], id: string) => {
      const c = styleContext(table, 'category', layers)
      return withStyleLayer(c, newStyleLayer(plotStyle(id)!, c))
    }
    const geoms = (layers: Layer[]) => layers.map((l) => l.geom).join(' ')
    expect(geoms(add(add([], 'points'), 'bars'))).toBe('bar points')
    expect(geoms(add(add([], 'bars'), 'points'))).toBe('bar points')
    expect(geoms(add(add(add([], 'points'), 'bars'), 'error'))).toBe('bar errorbar points')
    expect(geoms(add(add([], 'box'), 'violin'))).toBe('violin box')
    expect(geoms(add(add([], 'violin'), 'box'))).toBe('violin box')
    expect(geoms(add(add(add([], 'points'), 'violin'), 'box'))).toBe('violin box points')
  })
})
