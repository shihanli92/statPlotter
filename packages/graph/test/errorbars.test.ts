import { createTable, type GraphNode } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  centerOf,
  errorBounds,
  layoutGraph,
  MAD_TO_SD,
  type Prim,
  type SceneNode,
  statsOfPoints,
} from '../src/index.ts'
import { graphOf, layerOf, PRESET_OF_LOOK, withLayer } from './graphs.ts'
import { fonts, projectOf, sampleTable } from './helpers.ts'

const flat = (n: SceneNode, out: SceneNode[] = []): SceneNode[] => {
  out.push(n)
  for (const c of n.children ?? []) flat(c, out)
  return out
}

const pts = (vs: number[]) => vs.map((value, row) => ({ value, row }))

describe('MAD error bars', () => {
  it('computes the median absolute deviation and its normal-consistent scaling', () => {
    // Median 5; |deviations| 4 2 0 1 5 → median 2.
    const s = statsOfPoints(pts([1, 3, 5, 6, 10]))
    expect(s.median).toBe(5)
    expect(s.mad).toBe(2)
    expect(errorBounds(s, 'MAD', s.median)).toEqual([3, 7])
    const [lo, hi] = errorBounds(s, 'MADn', s.median)!
    expect(lo).toBeCloseTo(5 - 2 * 1.4826, 4)
    expect(hi).toBeCloseTo(5 + 2 * 1.4826, 4)
    // 1 / qnorm(0.75)
    expect(MAD_TO_SD).toBeCloseTo(1 / 0.6744897501960817, 14)
  })

  it('the centre is the median when chosen, else the mean (and the mean for summary data)', () => {
    const s = statsOfPoints(pts([1, 2, 9]))
    expect(centerOf(s, 'median')).toBe(2)
    expect(centerOf(s, 'mean')).toBe(4)
    expect(centerOf({ ...s, raw: false }, 'median')).toBe(4)
  })
})

describe('grouped graphs follow the chosen centre', () => {
  function setup(center: 'mean' | 'median', stat: 'SD' | 'MAD') {
    const table = createTable({
      tableKind: 'grouped',
      yFormat: { type: 'replicates', count: 3 },
      columns: 1,
      rows: 1,
    })
    // One cell: 1, 2, 9 → mean 4, median 2, MAD 1.
    table.dataSets[0]!.subcolumns.forEach((sub, j) => {
      sub.values = [[1, 2, 9][j]!]
    })
    // The default grouped graph (bars with error bars), its centre and error bars as chosen.
    const base = withLayer(
      withLayer(graphOf(table, 'bars'), 'bars', { stat: { kind: 'summary', center } }),
      'error',
      { stat: { kind: 'summary', center, error: stat } },
    )
    const graph: GraphNode = {
      ...base,
      axes: {
        ...base.axes,
        y:
          base.axes.y.type === 'continuous'
            ? { ...base.axes.y, range: { min: 0, max: 10 } }
            : base.axes.y,
      },
    }
    const project = projectOf(table, graph)
    const scene = layoutGraph({ project, graph, fonts })
    const all: SceneNode[] = []
    const walk = (n: SceneNode) => {
      all.push(n)
      for (const c of n.children ?? []) walk(c)
    }
    walk(scene.root)
    const key = table.dataSets[0]!.id
    const bar = all.find((n) => n.id === `series/${key}/bar/0`)!.prim as Extract<
      Prim,
      { type: 'rect' }
    >
    const errs = all.filter((n) => n.id.startsWith(`series/${key}/error/0/`))
    const y = scene.axes!.y
    return { bar, errs, y }
  }

  it('bar height is the median with median chosen, and MAD bars sit around it', () => {
    const { bar, errs, y } = setup('median', 'MAD')
    expect(bar.y).toBeCloseTo(y.toPx(2), 9)
    // Grouped bars draw error bars upwards by default: from the median (2) to median + MAD (3).
    const stem = errs[0]!.prim as Extract<Prim, { type: 'line' }>
    expect([stem.y1, stem.y2].sort((a, b) => a - b)).toEqual([
      expect.closeTo(y.toPx(3), 9),
      expect.closeTo(y.toPx(2), 9),
    ])
  })

  it('bar height stays the mean by default', () => {
    const { bar, y } = setup('mean', 'SD')
    expect(bar.y).toBeCloseTo(y.toPx(4), 9)
  })
})

describe('error bar caps', () => {
  it.each([
    ['column', 'column.bar'],
    ['column', 'column.scatter'],
    ['column', 'column.box'],
    ['grouped', 'grouped.bar'],
    ['grouped', 'grouped.box'],
  ] as const)('a cap width of 0 draws no zero-length cap lines (%s %s)', (kind, type) => {
    const table = sampleTable(kind)
    // SD error bars with no caps; boxes take the cap width for their whiskers.
    const base = graphOf(table, PRESET_OF_LOOK[type])
    const error = base.layers.some((l) => l.id === 'error')
    const graph = error
      ? withLayer(base, 'error', {
          stat: { ...layerOf<'errorbar'>(base, 'error').stat, error: 'SD' },
          style: { capWidth: 0 },
        })
      : withLayer(base, 'box', { style: { capWidth: 0 } })
    const lines = flat(layoutGraph({ project: projectOf(table, graph), graph, fonts }).root)
      .map((n) => n.prim)
      .filter((p): p is Extract<Prim, { type: 'line' }> => p?.type === 'line')
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.filter((l) => l.x1 === l.x2 && l.y1 === l.y2)).toEqual([])
  })
})
