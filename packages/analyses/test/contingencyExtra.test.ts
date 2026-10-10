import type { DataTable } from '@ps/model'
import { contingencyPairwise, cramersV, phiCoefficient } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { contingencyDef } from '../src/index.ts'
import { cellOf, countsTable, kvOf, runDef, tableBlock, v } from './helpers.ts'

const run = (t: DataTable, p: Record<string, unknown> = {}) => runDef(contingencyDef, t, p)

describe('contingency: effect sizes', () => {
  it('reports phi for 2 × 2 tables and Cramér’s V for larger ones', () => {
    const two = [
      [15, 85],
      [30, 70],
    ]
    const r2 = run(countsTable('contingency', two))
    expect(v(kvOf(r2, 'Phi (φ)'))).toBe(phiCoefficient(two))
    const three = [
      [10, 5, 3],
      [4, 12, 6],
      [2, 6, 14],
    ]
    const r3 = run(countsTable('contingency', three))
    expect(v(kvOf(r3, 'Cramér’s V'))).toBe(cramersV(three))
    expect(r3.values.cramersV).toBeDefined()
    expect(() =>
      kvOf(run(countsTable('contingency', three), { effectSize: false }), 'Cramér’s V'),
    ).toThrow()
  })
})

describe('contingency: comparisons of pairs of rows', () => {
  const counts = [
    [12, 18],
    [20, 10],
    [28, 4],
  ]
  const titles = ['Low', 'Mid', 'High']

  it('tests every pair with the chosen test and corrects the family', () => {
    const r = run(countsTable('contingency', counts, titles), {
      pairwise: 'all',
      pairwiseMethod: 'holm-sidak',
    })
    const b = tableBlock(r, 'pairwise')
    const ref = contingencyPairwise(counts, { test: 'fisher', method: 'holm-sidak' })
    expect(b.rows.map((row) => (row[0] as { v: string }).v)).toEqual([
      'Low vs. Mid',
      'Low vs. High',
      'Mid vs. High',
    ])
    ref.forEach((x, i) => {
      expect(v(cellOf(b, i, 'P value'))).toBe(x.p)
      expect(v(cellOf(b, i, 'Adjusted P value'))).toBe(x.adjusted)
    })
  })

  it('compares each row with the control row picked by table row', () => {
    const t = countsTable('contingency', [[5, 5], ...counts], ['Empty?', ...titles])
    // Row 0 is analyzed too; pick "Mid" (table row 2) as control.
    const r = run(t, { pairwise: 'control', pairwiseControl: '2', test: 'chiSquare' })
    const b = tableBlock(r, 'pairwise')
    expect(b.title).toMatch(/Each row vs\. Mid/)
    expect(b.rows).toHaveLength(3)
    expect((b.rows[0]![0] as { v: string }).v).toBe('Mid vs. Empty?')
    expect(b.rows.map((row) => (row[1] as { v: string }).v)).toEqual([
      'Chi-square',
      'Chi-square',
      'Chi-square',
    ])
  })

  it('offers no comparisons for 2-row tables', () => {
    const r = run(countsTable('contingency', counts.slice(0, 2)), { pairwise: 'all' })
    expect(r.sheets.find((s) => s.key === 'pairwise')).toBeUndefined()
  })
})
