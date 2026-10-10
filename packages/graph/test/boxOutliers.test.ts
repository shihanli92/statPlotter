import { createTable, type DataTable, type GraphNode, type Layer, type NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { boxMuller, mulberry32 } from '../../stats/test/rng.ts'
import {
  hitTest,
  layoutLayers,
  type PointsPrim,
  presetGraph,
  type Scene,
  sceneToPdf,
  sceneToSvg,
} from '../src/index.ts'
import { fonts, projectOf } from './helpers.ts'

// Audit 2 (G6): boxes' outliers on graphs of many rows. Exports of them were pinned (their SVG
// without ids, hashed) before outliers went through the points' screen sample and clouds.

/** FNV-1a (32-bit) of a string, as hex. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

/** Heavy-tailed values (a normal deviate cubed): about 28% of them Tukey outliers. */
function heavy(n: number, seed: number, shift: number): number[] {
  const g = boxMuller(mulberry32(seed))
  return Array.from({ length: n }, () => shift + g() ** 3)
}

/** A column table of `cols` data sets of `rows` heavy-tailed values each. */
function columnTable(rows: number, cols: number): DataTable {
  const t = createTable({ tableKind: 'column', columns: cols, rows })
  t.id = 't1' as NodeId
  t.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = heavy(rows, i + 1, 10 + i)
  })
  return t
}

/** A grouped table of 2 data sets × `rows` rows of `reps` heavy-tailed replicates each. */
function groupedTable(rows: number, reps: number): DataTable {
  const t = createTable({
    tableKind: 'grouped',
    yFormat: { type: 'replicates', count: reps },
    columns: 2,
    rows,
  })
  t.id = 't1' as NodeId
  t.dataSets.forEach((d, i) => {
    d.subcolumns.forEach((s, j) => {
      s.values = heavy(rows, 10 * i + j + 1, 10 + i)
    })
  })
  return t
}

/** A preset's graph of the table, its boxes' whiskers Tukey's (outliers past 1.5 IQR). */
function tukey(t: DataTable, preset: string): GraphNode {
  const g = presetGraph(t, preset)
  const layers = g.layers.map((l) =>
    l.geom === 'box' ? ({ ...l, stat: { kind: 'boxplot', whiskers: 'tukey' } } as Layer) : l,
  )
  return { ...g, id: 'g1' as NodeId, layers }
}

const layout = (t: DataTable, preset: string, screen = false): Scene =>
  layoutLayers({
    project: projectOf(t),
    graph: tukey(t, preset),
    fonts,
    ...(screen ? { screen: { points: 1000 } } : {}),
  })

/** Outlier symbols a scene draws: symbol nodes and clouds' points under an outlier id. */
function outliers(scene: Scene): number {
  let k = 0
  const walk = (n: Scene['root']) => {
    if (n.id.includes('/outlier')) {
      if (n.prim?.type === 'symbol') k++
      else if (n.prim?.type === 'points') k += n.prim.n
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(scene.root)
  return k
}

describe('box outliers of many rows: exports (characterised)', () => {
  it('a column graph of boxes, 2 × 40,000 rows', () => {
    const scene = layout(columnTable(40_000, 2), 'box')
    expect(outliers(scene)).toBe(22_850)
    expect(hash(sceneToSvg(scene))).toBe('58a21c8a')
    const pdf = sceneToPdf(scene, fonts, { date: new Date('2026-01-01T00:00:00Z') })
    expect(hash(new TextDecoder('latin1').decode(pdf))).toBe('54d2d48c')
  })

  it('a grouped graph of boxes, 2 data sets × 1,000 rows × 12 replicates', () => {
    const t = groupedTable(1000, 12)
    // Every value a replicate of a cell: the grouped box is a cell's 12 values.
    const scene = layout(t, 'box')
    expect(outliers(scene)).toBe(3742)
    expect(hash(sceneToSvg(scene))).toBe('b4c37ba0')
  })
})

describe('box outliers of many rows (audit 2, G6)', () => {
  const t = columnTable(40_000, 2)

  it('export them all as clouds when there are many: one primitive per box', () => {
    const scene = layout(t, 'box')
    const clouds: Scene['root'][] = []
    const walk = (n: Scene['root']) => {
      if (n.prim?.type === 'points') clouds.push(n)
      for (const c of n.children ?? []) walk(c)
    }
    walk(scene.root)
    expect(clouds).toHaveLength(2)
    expect(clouds.every((n) => n.id.includes('/outlier/'))).toBe(true)
    expect(outliers(scene)).toBe(22_850)
    // An outlier of a cloud found under the pointer stands for no point (as its node did not).
    const p = clouds[0]!.prim as PointsPrim
    const hit = hitTest(scene.root, p.x[0]!, p.y[0]!, 0)
    expect(hit?.node.cloud).toBeDefined()
    expect(hit?.node.point).toBeUndefined()
    expect(hit?.node.id).toMatch(/\/outlier\//)
  })

  it('draw at most the screen’s cap of them per box on screen, noted', () => {
    const scene = layout(t, 'box', true)
    expect(outliers(scene)).toBe(2000)
    expect(scene.sampled).toMatchObject({ shown: 1000, per: 'column' })
    // A few outliers: all of them, no note.
    const small = columnTable(400, 2)
    expect(outliers(layout(small, 'box', true))).toBe(outliers(layout(small, 'box')))
    expect(layout(small, 'box', true).sampled).toBeUndefined()
  })
})
