import { threeWayRM } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { minstd } from '../../stats/test/rng.ts'
import { oneWayAnovaDef, threeWayAnovaDef } from '../src/index.ts'
import { cellOf, columnTable, groupedTable, kvOf, runDef, tableBlock, v } from './helpers.ts'

/** 3 rows × 4 data sets × 4 subcolumns, deterministic "random" values. */
function data(): (number | null)[][][] {
  const u = minstd(7)
  const rnd = () => u() - 0.5
  const subj = Array.from({ length: 16 }, () => 4 * rnd())
  return Array.from({ length: 3 }, (_, r) =>
    Array.from({ length: 4 }, (_, d) =>
      Array.from(
        { length: 4 },
        (_, j) => 20 + 2 * r + 3 * (d >> 1) - (d & 1) + subj[d * 4 + j]! + rnd(),
      ),
    ),
  )
}

const run = (cells: (number | null)[][][], p: Record<string, unknown>) =>
  runDef(threeWayAnovaDef, groupedTable(cells), p)

describe('three-way ANOVA with repeated measures (plugin)', () => {
  it('stacks each subcolumn down the rows as one subject', () => {
    const cells = data()
    const r = run(cells, { repeatedRows: true })
    expect(r.status).toBe('ok')
    // The same data in long form.
    const y: number[] = []
    const row: number[] = []
    const col1: number[] = []
    const col2: number[] = []
    const subject: number[] = []
    cells.forEach((rw, ri) => {
      rw.forEach((vals, d) => {
        vals.forEach((val, j) => {
          y.push(val!)
          row.push(ri)
          col1.push(d >> 1)
          col2.push(d & 1)
          subject.push(d * 4 + j)
        })
      })
    })
    const ref = threeWayRM({ y, row, col1, col2, subject }, { repeated: [0] })
    const b = tableBlock(r, 'results', 1)
    expect(v(cellOf(b, 0, 'P value'))).toBe(ref.effects[0]!.pCorrected)
    expect(v(cellOf(b, 1, 'P value'))).toBe(ref.effects[1]!.p)
    const anova = tableBlock(r, 'results', 2)
    expect(anova.rows.map((x) => (x[0] as { v: string }).v).slice(-2)).toEqual([
      'Subject',
      'Residual',
    ])
    const es = tableBlock(r, 'results', 3)
    const e0 = ref.effects[0]!
    const st = ref.strata.find((s) => s.within.join() === e0.stratum.join())!
    expect(v(cellOf(es, 0, 'Partial eta squared'))).toBeCloseTo(e0.ss / (e0.ss + st.ss), 14)
  })

  it('fits a mixed model when a value is missing', () => {
    const cells = data()
    cells[1]![2]![3] = null
    const r = run(cells, { repeatedRows: true })
    expect(r.status).toBe('ok')
    expect(tableBlock(r, 'results', 2).title).toBe('Mixed-effects model: F tests')
    const anova = run(cells, { repeatedRows: true, rmMethod: 'anova' })
    expect(anova.status).toBe('error')
  })

  it('matches subjects across column factor 1 (A with C, B with D)', () => {
    const r = run(data(), { repeatedCol1: true, repeatedCol2: true })
    expect(r.status).toBe('ok')
    const design = r.sheets[0]!.blocks[0]!
    expect(design.type === 'keyValue' && design.rows[3]!.value).toEqual({ kind: 'integer', v: 12 })
  })
})

describe('effect sizes of repeated-measures one-way ANOVA', () => {
  it('reports partial eta squared equal to the R squared of the treatment effect', () => {
    const t = columnTable([
      [10, 12, 9, 14, 11],
      [12, 15, 10, 16, 13],
      [15, 16, 12, 19, 15],
    ])
    const r = runDef(oneWayAnovaDef, t, { matched: true })
    expect(v(kvOf(r, 'Partial eta squared'))).toBeCloseTo(v(kvOf(r, 'R squared')), 14)
    expect(v(kvOf(r, 'Eta squared'))).toBeLessThan(v(kvOf(r, 'Partial eta squared')))
  })
})
