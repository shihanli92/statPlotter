import { createTable, type DataSetKey, type GraphNode, type PointStyle } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { createGraphFor, layoutGraph, type Prim } from '../src/index.ts'
import { flatten, fonts, projectOf } from './helpers.ts'

type Symbol = Extract<Prim, { type: 'symbol' }>

function setup(tableKind: 'column' | 'xy' | 'grouped', points: Record<string, PointStyle> = {}) {
  const table = createTable({ tableKind, columns: 2, rows: 3 })
  if (tableKind === 'xy') table.x!.subcolumns[0]!.values = [1, 2, 3]
  table.dataSets[0]!.subcolumns[0]!.values = [1, 4, 9]
  table.dataSets[1]!.subcolumns[0]!.values = [2, 3, 5]
  const ds = table.dataSets[0]!.id as unknown as DataSetKey
  const base = createGraphFor(table)
  const graph: GraphNode = { ...base, pointOverrides: { [ds]: points } }
  const project = projectOf(table, graph)
  const scene = layoutGraph({ project, graph, fonts })
  const marks = flatten(scene.root).filter((n) => n.point !== undefined)
  const of = (key: string) =>
    marks.filter((n) => n.target?.[3] === ds && n.point === key && n.prim?.type === 'symbol')
  return { ds: ds as string, marks, of, scene, other: table.dataSets[1]!.id as string }
}

describe('single-point formats in the layout', () => {
  it('scene marks carry their point identity (table row and replicate)', () => {
    const { marks, ds } = setup('column')
    const mine = marks.filter((n) => n.target?.[3] === ds).map((n) => n.point)
    expect(mine.sort()).toEqual(['r0s0', 'r1s0', 'r2s0'])
  })

  it('a point format changes exactly one mark', () => {
    const plain = setup('column')
    const styled = setup('column', {
      r1s0: { shape: 'square', size: 12, color: { rgb: '#000000' } },
    })
    // Same table contents, new ids: compare marks in drawing order.
    expect(styled.marks).toHaveLength(plain.marks.length)
    const changed = styled.marks.filter(
      (n, i) => JSON.stringify(plain.marks[i]?.prim) !== JSON.stringify(n.prim),
    )
    expect(changed.map((n) => [n.target?.[3], n.point])).toEqual([[styled.ds, 'r1s0']])
    const p = changed[0]!.prim as Symbol
    expect([p.shape, p.size, p.fill?.color]).toEqual(['square', 12, '#000000'])
  })

  it('hides a point (the rest stay) and draws a label beside one', () => {
    const { of } = setup('column', { r0s0: { hide: true }, r2s0: { label: 'outlier' } })
    expect(of('r0s0')).toHaveLength(0)
    expect(of('r1s0')).toHaveLength(1)
    const withLabel = setup('column', { r2s0: { label: 'outlier' } })
    const label = withLabel.marks.find((n) => n.prim?.type === 'text' && n.point === 'r2s0')
    expect(label?.prim?.type === 'text' && label.prim.layout.runs.map((r) => r.text).join('')).toBe(
      'outlier',
    )
  })

  it('XY means and grouped means are keyed by row alone', () => {
    const xy = setup('xy', { r2: { size: 11 } })
    expect((xy.of('r2')[0]!.prim as Symbol).size).toBe(11)
    expect(xy.of('r1')).toHaveLength(1)
    const grouped = setup('grouped')
    const keys = grouped.marks.filter((n) => n.target?.[3] === grouped.ds).map((n) => n.point)
    expect(keys.every((k) => /^r\d+(s\d+)?$/.test(k!))).toBe(true)
  })
})
