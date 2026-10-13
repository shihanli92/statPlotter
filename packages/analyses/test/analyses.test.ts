import type { AnalysisResult, DataTable } from '@ps/model'
import { tTestUnpaired } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { descriptive, mannWhitney, registry, ttest, wilcoxon } from '../src/index.ts'
import { columnTable, kvOf, runDef, summaryTable } from './helpers.ts'

/** The number labelled `label` in a keyValue block. */
const v = (r: AnalysisResult, label: string) => (kvOf(r, label) as { v: number }).v

const A = [34.1, 38.5, 29.8, 41.2, 35.6, 32.3]
const B = [45.2, 52.8, 48.1, 39.7, 50.3, 47.6]

describe('registry', () => {
  it('lists every analysis with parseable default params', () => {
    for (const def of registry.list()) {
      expect(() => def.params.parse({}), def.id).not.toThrow()
      for (const f of def.form) expect(f.path.length, `${def.id} form path`).toBeGreaterThan(0)
    }
  })
})

describe('t test', () => {
  const run = (t: DataTable, params: object = {}) => runDef(ttest, t, params)

  it('matches the stats layer, with the B − A sign convention (Welch by default, 51c)', () => {
    const r = run(columnTable([A, B]))
    const ref = tTestUnpaired(A, B, { equalVariance: false })
    expect(r.status).toBe('ok')
    expect(v(r, 'P value')).toBe(ref.p)
    expect(v(r, 'Difference between means (Group B − Group A)')).toBeGreaterThan(0)
    expect(r.comparisons).toHaveLength(1)
    expect(r.comparisons[0]!.p).toBe(ref.p)
    expect(kvOf(r, 'Significantly different (P < 0.05)?')).toEqual({ kind: 'bool', v: true })
  })

  it('one-tailed P is for the direction predicted before the experiment (51c, S1)', () => {
    const two = run(columnTable([A, B]))
    const p2 = v(two, 'P value')
    // B is higher than A: predicted higher, half the two-tailed P; predicted lower, the large P.
    const along = run(columnTable([A, B]), { tails: 'one', predicted: 'increase' })
    expect(v(along, 'P value')).toBeCloseTo(p2 / 2, 15)
    expect(along.diagnostics.some((d) => d.level === 'warning')).toBe(false)
    const against = run(columnTable([A, B]), { tails: 'one', predicted: 'decrease' })
    expect(v(against, 'P value')).toBeCloseTo(1 - p2 / 2, 12)
    expect(against.diagnostics.map((d) => d.message).join(' ')).toMatch(
      /went the opposite way to your prediction/,
    )
    // No direction stated: refused, with the dialog's message.
    const unset = run(columnTable([A, B]), { tails: 'one' })
    expect(unset.status).toBe('error')
    expect(unset.diagnostics.at(-1)!.message).toMatch(/Say which direction you predicted/)
    // Saved before 0.3.9 (`observed`): the data's direction, as decision 18 did, and a warning.
    const saved = run(columnTable([B, A]), { tails: 'one', predicted: 'observed' })
    expect(v(saved, 'P value')).toBeCloseTo(p2 / 2, 15)
    expect(saved.diagnostics.map((d) => d.message).join(' ')).toMatch(/Direction not stated/)
  })

  it('Welch drops the F test and reports fractional df', () => {
    const r = run(columnTable([A, [1, 2, 30, 4, 50]]), { unpaired: { assumeEqualSD: false } })
    expect(
      r.sheets[0]!.blocks.some((b) => b.type === 'keyValue' && b.title?.includes('Welch')),
    ).toBe(true)
    expect(
      r.sheets[0]!.blocks.some((b) => b.type === 'keyValue' && b.title?.startsWith('F test')),
    ).toBe(false)
    expect(Number.isInteger(v(r, 'df'))).toBe(false)
  })

  it('ignores excluded values and says so', () => {
    const r = run(columnTable([[...A, 999], B], { excluded: [[0, 6]] }))
    expect(v(r, 'Sample size, Group A')).toBe(6)
    expect(v(r, 'P value')).toBe(tTestUnpaired(A, B, { equalVariance: false }).p)
    expect(r.diagnostics.map((d) => d.message)).toContain('1 excluded value was not analyzed.')
  })

  it('accepts summary data (mean, SD, N) and matches raw data', () => {
    const m = (x: number[]) => x.reduce((s, y) => s + y, 0) / x.length
    const s = (x: number[]) =>
      Math.sqrt(x.reduce((acc, y) => acc + (y - m(x)) ** 2, 0) / (x.length - 1))
    const r = run(
      summaryTable('meanSdN', [
        [m(A), s(A), A.length],
        [m(B), s(B), B.length],
      ]),
    )
    expect(v(r, 'P value')).toBeCloseTo(tTestUnpaired(A, B, { equalVariance: false }).p, 12)
  })

  it('refuses summary data without N', () => {
    const r = run(
      summaryTable('meanSd', [
        [1, 1],
        [2, 1],
      ]),
    )
    expect(r.status).toBe('error')
    expect(r.diagnostics.at(-1)!.message).toMatch(/needs mean, SD/)
  })

  it('paired: pairs by row, drops incomplete rows, reports pairing effectiveness', () => {
    const a = [10, 12, 9, 14, null, 11]
    const b = [12, 15, 10, 17, 20, 13]
    const r = run(columnTable([a, b]), { design: 'paired' })
    expect(v(r, 'Number of pairs')).toBe(5)
    expect(v(r, 'Mean difference (Group B − Group A)')).toBeCloseTo((2 + 3 + 1 + 3 + 2) / 5, 12)
    expect(r.diagnostics.map((d) => d.message)).toContain(
      '1 row without a complete pair was ignored.',
    )
    expect(kvOf(r, 'Correlation coefficient (r)').kind).toBe('number')
  })

  it('ratio paired requires positive values', () => {
    expect(
      run(
        columnTable([
          [1, 2, 3],
          [2, 4, 6],
        ]),
        { design: 'paired', paired: { measure: 'ratio' } },
      ).status,
    ).toBe('ok')
    const bad = run(
      columnTable([
        [1, -2, 3],
        [2, 4, 6],
      ]),
      { design: 'paired', paired: { measure: 'ratio' } },
    )
    expect(bad.status).toBe('error')
  })

  it('needs two values per group', () => {
    expect(run(columnTable([[1], [2, 3]])).status).toBe('error')
  })
})

describe('rank tests', () => {
  it('Mann-Whitney reports an exact P for small samples and a live comparison', () => {
    const r = runDef(mannWhitney, columnTable([A, B]))
    expect(kvOf(r, 'Exact or approximate P value?')).toEqual({ kind: 'text', v: 'Exact' })
    // One (A, B) pair is out of order (41.2 > 39.7), so U = 1; P(U ≤ 1) = 2/C(12,6), two-sided ×2.
    expect(v(r, 'Mann-Whitney U')).toBe(1)
    expect(v(r, 'P value')).toBeCloseTo(4 / 924, 12)
    expect(r.comparisons[0]!.p).toBe(v(r, 'P value'))
  })

  it('Mann-Whitney approximate on request', () => {
    const r = runDef(mannWhitney, columnTable([A, B]), { pMethod: 'approximate' })
    expect(kvOf(r, 'Exact or approximate P value?')).toEqual({ kind: 'text', v: 'Approximate' })
  })

  it('Wilcoxon counts zero differences and pairs by row', () => {
    const r = runDef(
      wilcoxon,
      columnTable([
        [1, 2, 3, 4, 5, 6],
        [1, 3, 5, 7, 9, 12],
      ]),
    )
    expect(v(r, 'Number of pairs')).toBe(6)
    expect(v(r, 'Number of pairs with difference 0')).toBe(1)
    expect(v(r, 'Sum of negative ranks')).toBe(-0)
    expect(kvOf(r, 'Sum of positive ranks').kind).toBe('integer')
  })

  it('rank tests refuse summary data', () => {
    const t = summaryTable('meanSdN', [
      [1, 1, 3],
      [2, 1, 3],
    ])
    expect(runDef(mannWhitney, t).status).toBe('error')
    expect(runDef(wilcoxon, t).status).toBe('error')
  })
})

describe('descriptive statistics', () => {
  it('produces one column per data set with the requested rows', () => {
    const r = runDef(descriptive, columnTable([A, B]), { moments: true })
    const block = r.sheets[0]!.blocks[0]!
    if (block.type !== 'table') throw new Error('expected table')
    expect(block.columns).toEqual(['', 'Group A', 'Group B'])
    const labels = block.rows.map((row) => (row[0] as { v: string }).v)
    expect(labels).toContain('Median')
    expect(labels).toContain('Skewness')
    expect(labels).not.toContain('Geometric mean')
    const n = block.rows.find((row) => (row[0] as { v: string }).v === 'Number of values')!
    expect(n.slice(1)).toEqual([
      { kind: 'integer', v: 6 },
      { kind: 'integer', v: 6 },
    ])
  })

  it('handles summary data', () => {
    const r = runDef(descriptive, summaryTable('meanSemN', [[10, 1, 4]]))
    expect(r.status).toBe('ok')
    const block = r.sheets[0]!.blocks[0]!
    if (block.type !== 'table') throw new Error('expected table')
    const sd = block.rows.find((row) => (row[0] as { v: string }).v === 'Std. Deviation')!
    expect((sd[1] as { v: number }).v).toBe(2)
  })
})
