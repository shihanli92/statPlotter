import { createTable } from '@ps/model'
import { correctFamily, tTestUnpaired } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { multipleTDef } from '../src/index.ts'
import { cellOf, groupedTable, kvOf, runDef, tableBlock, v } from './helpers.ts'

const run = (t: ReturnType<typeof groupedTable>, p: object = {}) => runDef(multipleTDef, t, p)

// Five genes (rows) × control / treated, three replicates.
const cells: (number | null)[][][] = [
  [
    [1.1, 1.3, 0.9],
    [3.2, 3.6, 3.1],
  ],
  [
    [5.0, 5.4, 4.7],
    [5.1, 5.3, 4.9],
  ],
  [
    [2.0, 2.4, 2.2],
    [2.9, 3.3, 3.0],
  ],
  [
    [7.1, null, null],
    [7.5, 7.9, 8.2],
  ],
  [
    [null, null, null],
    [null, null, null],
  ],
]
const titles = ['Gapdh', 'Actb', 'Il6', 'Tnf', 'empty']

describe('multiple t tests plugin', () => {
  it('has parseable defaults (Welch, FDR two-stage, Q = 1%)', () => {
    const p = multipleTDef.params.parse({})
    expect(p.variance).toBe('welch')
    expect(p.fdrMethod).toBe('bky')
    expect(p.q).toBe(1)
  })

  it('tests every row, reports A − B, skips untestable rows and leaves out empty ones', () => {
    const r = run(groupedTable(cells, titles), { approach: 'fdr', fdrMethod: 'bh', q: 5 })
    expect(r.status).toBe('ok')
    const b = tableBlock(r, 'tests')
    expect(b.rows.map((x) => (x[0] as { v: string }).v)).toEqual(['Gapdh', 'Actb', 'Il6'])
    const w = tTestUnpaired([3.2, 3.6, 3.1], [1.1, 1.3, 0.9], { equalVariance: false })
    expect(v(cellOf(b, 0, 'P value'))).toBeCloseTo(w.p, 14)
    expect(v(cellOf(b, 0, 'Difference (Group A − Group B)'))).toBeCloseTo(w.diff, 14)
    expect(v(cellOf(b, 0, 'Mean of Group A'))).toBeCloseTo(1.1, 14)
    const ps = b.rows.map((x) => v(x[2]))
    const q = correctFamily(ps, { method: 'bh', q: 0.05 })
    expect(b.rows.map((x) => v(x[b.columns.indexOf('q value')]))).toEqual(q.adjusted)
    expect(v(kvOf(r, 'Number of t tests'))).toBe(3)
    expect(v(kvOf(r, 'Number of rows not analyzed'))).toBe(1)
    // Brackets address cells in the same row.
    expect(r.comparisons[0]).toMatchObject({ rowA: 0, rowB: 0, p: w.p })
    // Volcano: every tested row is in exactly one of the two series.
    const vf = r.outputs['volcano:flagged']!
    const vo = r.outputs['volcano:other']!
    expect(vf.x.length + vo.x.length).toBe(3)
    // Each point knows its table row and row title (point labels of the volcano plot).
    const rowsOf = [...vf.rows!, ...vo.rows!]
    const titlesOf = [...vf.rowTitles!, ...vo.rowTitles!]
    expect([...rowsOf].sort()).toEqual([0, 1, 2])
    expect(rowsOf.map((row) => titlesOf[rowsOf.indexOf(row)])).toEqual(
      rowsOf.map((row) => titles[row]),
    )
    // The flagged points' graph labels them by row title (the 20 most extreme).
    expect(multipleTDef.outputs!([], multipleTDef.params.parse({}))[0]!.pointLabels).toEqual({
      source: 'rowTitle',
      which: 'all',
      max: 20,
    })
    expect([...vf.y, ...vo.y].sort()).toEqual(ps.map((p) => -Math.log10(p)).sort())
    expect(multipleTDef.outputs!([], multipleTDef.params.parse({})).map((o) => o.key)).toEqual([
      'volcano:flagged',
      'volcano:other',
    ])
  })

  it('lognormal: values ≤ 0 are left out of their row, with a note (audit 3, RTA-2)', () => {
    const t = groupedTable(
      [
        [
          [0, 2.1, 3.3, 4.2],
          [5.5, 6.1, 7.9, null],
        ],
        [
          [0, 0, 0, 2.2],
          [1, 2, 3, 4],
        ],
        ...cells.slice(0, 3),
      ],
      ['zero', 'zeros', ...titles.slice(0, 3)],
    )
    const r = run(t, { distribution: 'lognormal' })
    const tests = tableBlock(r, 'tests')
    const ref = tTestUnpaired([2.1, 3.3, 4.2].map(Math.log10), [5.5, 6.1, 7.9].map(Math.log10), {
      equalVariance: false,
    })
    expect(v(cellOf(tests, 0, 'P value'))).toBeCloseTo(ref.p, 14)
    expect(v(kvOf(r, 'Number of rows not analyzed'))).toBe(1)
    const notes = r.sheets[0]!.blocks.flatMap((b) => (b.type === 'note' ? [b.text] : []))
    expect(notes.join(' ')).toMatch(
      /Left out of the tests \(values ≤ 0: no logarithm\): zero \(1\)/,
    )
    expect(notes.join(' ')).toMatch(/zeros \(fewer than two values > 0/)
  })

  it('a P value that underflows to 0 is drawn on the volcano plot (audit 3, S5)', () => {
    const t = groupedTable(
      [
        [
          [0, 1, 2],
          [1e300, 1e300, 1e300],
        ],
        ...cells.slice(0, 3),
      ],
      ['huge', ...titles.slice(0, 3)],
    )
    const r = run(t, { reportLogP: true })
    const p0 = v(cellOf(tableBlock(r, 'tests'), 0, 'P value'))
    expect(p0).toBe(0)
    const vf = r.outputs['volcano:flagged']!
    const y = vf.y[vf.rows!.indexOf(0)]!
    // −log10 of the smallest double P (2^−1074): finite, so the point is drawn, at the top.
    expect(y).toBe(-Math.log10(Number.MIN_VALUE))
    expect(v(cellOf(tableBlock(r, 'tests'), 0, '−log10(P value)'))).toBe(y)
  })

  it('B − A flips the sign; the consistent-SD test pools the SD over rows', () => {
    const t = groupedTable(cells, titles)
    const ab = tableBlock(run(t), 'tests')
    const ba = tableBlock(run(t, { difference: 'bMinusA' }), 'tests')
    expect(v(ba.rows[0]![5])).toBeCloseTo(-v(ab.rows[0]![5]), 14)
    const pooled = run(t, { variance: 'consistent', approach: 'significance' })
    expect(v(kvOf(pooled, 'df of pooled SD'))).toBe(4 + 4 + 4 + 2)
    const pb = tableBlock(pooled, 'tests')
    expect(pb.columns).toContain('Adjusted P value')
    expect(pb.rows).toHaveLength(4) // Tnf (1 vs 3) is tested with the pooled SD
  })

  it('paired, nonparametric and lognormal choices', () => {
    const t = groupedTable(cells, titles)
    const paired = run(t, { design: 'paired' })
    expect(tableBlock(paired, 'tests').rows).toHaveLength(3)
    const wil = run(t, { design: 'paired', distribution: 'nonparametric' })
    expect(tableBlock(wil, 'tests').columns).toContain('Sum of signed ranks (W)')
    const mw = run(t, { distribution: 'nonparametric', approach: 'none' })
    expect(tableBlock(mw, 'tests').columns).toContain('Mann-Whitney U')
    const ks = run(t, { distribution: 'nonparametric', rankTest: 'kolmogorovSmirnov' })
    expect(tableBlock(ks, 'tests').columns).toContain('Kolmogorov-Smirnov D')
    const ln = run(t, { distribution: 'lognormal' })
    const lb = tableBlock(ln, 'tests')
    expect(lb.columns).toContain('Ratio of geometric means (Group A / Group B)')
    const w = tTestUnpaired([3.2, 3.6, 3.1].map(Math.log10), [1.1, 1.3, 0.9].map(Math.log10), {
      equalVariance: false,
    })
    expect(v(cellOf(lb, 0, 'P value'))).toBeCloseTo(w.p, 14)
    expect(v(cellOf(lb, 0, 'Ratio of geometric means (Group A / Group B)'))).toBeCloseTo(
      10 ** w.diff,
      12,
    )
  })

  it('works from mean/SD/N and refuses tests that need raw values', () => {
    const t = createTable({
      tableKind: 'grouped',
      yFormat: { type: 'summary', preset: 'meanSdN' },
      columns: 2,
      rows: 2,
    })
    const set = (c: number, r: number, m: number, s: number, n: number) => {
      t.dataSets[c]!.subcolumns[0]!.values[r] = m
      t.dataSets[c]!.subcolumns[1]!.values[r] = s
      t.dataSets[c]!.subcolumns[2]!.values[r] = n
    }
    set(0, 0, 10, 2, 5)
    set(1, 0, 14, 2.5, 6)
    set(0, 1, 3, 1, 4)
    set(1, 1, 3.2, 1.1, 4)
    const r = run(t)
    expect(tableBlock(r, 'tests').rows).toHaveLength(2)
    expect(run(t, { design: 'paired' }).status).toBe('error')
    expect(run(t, { distribution: 'nonparametric' }).status).toBe('error')
  })
})
