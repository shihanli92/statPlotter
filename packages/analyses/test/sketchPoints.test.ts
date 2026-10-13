// Audit 4 (P6): the forms' dialog parts, explanations and sketches (as the dialog has them).
import '../src/dialogEntry.ts'
import { type DataTable, type NormalizedDataSet, normalizeTable, type SketchSpec } from '@ps/model'
import { midranks } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { registry } from '../src/index.ts'
import { SKETCH_MAX_POINTS, SKETCH_MAX_ROWS, valuesOf } from '../src/sketch/tables.ts'
import { ECDF_MAX_STEPS, ranksOf } from '../src/sketch/twoGroups.ts'
import { columnTable, groupedTable, mvTable, xyReplicatesTable } from './helpers.ts'

// Audit 4 (P3): a sketch draws a sample — at most SKETCH_MAX_POINTS values over all its groups
// (cumulative curves at most ECDF_MAX_STEPS steps each) — whatever the size of the table, while
// what it says (rank sums, sizes) counts every value. Before, rank and cumulative sketches drew
// every value (2 × 100,000 rows: 35 MB of image) and the cap was per group.

/** Deterministic values (no random draws), a few ties. */
const values = (n: number, k: number) =>
  Array.from({ length: n }, (_, i) => ((i * 7919 + k * 104729) % 9973) / 10 + k)

function sketch(id: string, t: DataTable, params: Record<string, unknown> = {}): SketchSpec {
  const def = registry.get(id)!
  const input = normalizeTable(t)
  return def.sketch!(input, def.params.parse(params), {
    tableKind: t.tableKind,
    xTitle: null,
    maxRows: SKETCH_MAX_ROWS,
  })!
}

/** Values drawn: every Y cell with a number, over the panels. */
function drawn(s: SketchSpec): number {
  let n = 0
  for (const p of s.panels)
    for (const d of p.table.dataSets)
      for (const sub of d.subcolumns) for (const v of sub.values) if (typeof v === 'number') n++
  return n
}

describe('sketches draw a bounded sample (audit 4 P3)', () => {
  const two = columnTable([values(30_000, 0), values(30_000, 1)])
  const four = columnTable([0, 1, 2, 3].map((k) => values(20_000, k)))
  const many = columnTable(Array.from({ length: 200 }, (_, k) => values(500, k)))

  it.each([
    ['mannWhitney', two, {}],
    ['ttest', two, {}],
    ['oneWayAnova', four, { gaussian: false }],
    ['oneWayAnova', many, {}],
    ['oneWayAnova', many, { gaussian: false }],
  ] as const)('%s: at most SKETCH_MAX_POINTS values', (id, t, p) => {
    const s = sketch(id, t, p)
    expect(drawn(s)).toBeGreaterThan(0)
    expect(drawn(s)).toBeLessThanOrEqual(SKETCH_MAX_POINTS)
    expect(s.sampled).toBeDefined()
  })

  it('Kolmogorov-Smirnov: each curve at most ECDF_MAX_STEPS steps, ending at 1', () => {
    const s = sketch('kolmogorovSmirnov', two)
    expect(drawn(s)).toBeLessThanOrEqual(2 * ECDF_MAX_STEPS)
    const sets = s.panels[0]!.table.dataSets
    for (const d of sets) {
      const ys = d.subcolumns[0]!.values.filter((v): v is number => typeof v === 'number')
      expect(ys.at(-1)).toBe(1)
      expect(ys.every((y, i) => i === 0 || y >= ys[i - 1]!)).toBe(true)
    }
    expect(s.counts).toMatch(/30,?000/)
  })

  it('grouped, XY and multiple-variables tables: at most SKETCH_MAX_POINTS values', () => {
    const rows = 3000
    const grouped = groupedTable(
      Array.from({ length: rows }, (_, r) =>
        [0, 1, 2].map((k) => [0, 1, 2].map((j) => ((r * 31 + k * 7 + j) % 50) + k)),
      ),
    )
    expect(drawn(sketch('twoWayAnova', grouped))).toBeLessThanOrEqual(SKETCH_MAX_POINTS)
    const xs = Array.from({ length: rows }, (_, r) => r)
    const xy = xyReplicatesTable(
      xs,
      [0, 1, 2, 3].map((k) => [0, 1, 2].map((j) => xs.map((x) => x * (k + 1) + j))),
    )
    expect(drawn(sketch('linearRegression', xy))).toBeLessThanOrEqual(SKETCH_MAX_POINTS)
    const cols: Record<string, number[]> = {}
    for (let k = 0; k < 8; k++) cols[`V${k}`] = values(rows, k)
    // Each panel's outcome and predictor.
    expect(drawn(sketch('multipleRegression', mvTable(cols)))).toBeLessThanOrEqual(
      SKETCH_MAX_POINTS,
    )
  })

  it('rank sketches rank every value: the rank sums and sizes are the whole data’s', () => {
    const t = columnTable([values(6000, 0), values(5000, 1)])
    const input: NormalizedDataSet[] = normalizeTable(t)
    const all = input.map((d) => valuesOf(d))
    const { ranks } = midranks(all.flat())
    const rows = [0, 3, 6, 4999, 5999]
    const r = ranksOf(input, rows)
    // As the stats rank them, summed in the same order.
    let at = 0
    all.forEach((v, g) => {
      const own = Array.from(ranks.subarray(at, at + v.length))
      at += v.length
      expect(r.sums[g]).toBe(own.reduce((s, x) => s + x, 0))
      expect(r.sizes[g]).toBe(v.length)
      expect(r.sets[g]!.reps[0]).toEqual(rows.filter((x) => x < v.length).map((x) => own[x]))
    })
    expect(r.n).toBe(11_000)
    const s = sketch('mannWhitney', t)
    expect(s.counts).toMatch(/6,?000/)
    expect(s.counts).toMatch(/5,?000/)
  })
})
