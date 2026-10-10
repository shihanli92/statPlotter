import type { Scene } from '@ps/graph'
import type { GraphNode, GroupId, LayoutItem, LayoutItemId, LayoutItemOf, NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { arrangeGraphItems } from '../src/layout/figure.ts'

// Audit 2, U3: Arrange in a grid moves the page's graphs in place.

const graph = (id: string, x: number, extra: Partial<LayoutItemOf<'graph'>> = {}): LayoutItem => ({
  type: 'graph',
  id: `item-${id}` as LayoutItemId,
  graph: id as NodeId,
  x,
  y: 500,
  scale: 0.5,
  ...extra,
})
const rect: LayoutItem = {
  type: 'shape',
  id: 'rect' as LayoutItemId,
  shape: 'rect',
  x: 1,
  y: 2,
  w: 3,
  h: 4,
} as LayoutItem
const node = (id: string) => ({ kind: 'graph', id }) as unknown as GraphNode
const scene = () =>
  ({ width: 300, height: 200, plot: { x: 50, y: 20, w: 230, h: 150 } }) as unknown as Scene
const page = { width: 612, height: 792 }

describe('Arrange in a grid', () => {
  const items = [
    graph('a', 300, { group: 'g' as GroupId }),
    rect,
    graph('b', 10, { locked: true }),
    graph('c', 200),
  ]
  const out = arrangeGraphItems(items, (it) => node(it.graph), scene, page, { columns: 2 })

  it('keeps ids, groups and the stacking order', () => {
    expect(out.map((it) => it.id)).toEqual(items.map((it) => it.id))
    expect(out[0]).toMatchObject({ group: 'g' })
    expect(out[1]).toBe(rect)
  })
  it('leaves locked graphs where they are and puts the others on the grid', () => {
    expect(out[2]).toBe(items[2])
    const [a, c] = [out[0], out[3]] as LayoutItemOf<'graph'>[]
    expect(a!.y).toBe(c!.y)
    expect(a!.x).toBeLessThan(c!.x)
    expect(a!.x).not.toBe(300)
  })
})
