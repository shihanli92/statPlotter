import { normalizeTable, type ResultValue } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { arr, expectClose, loadFixtures } from '../../stats/test/oracle.ts'
import { multipleOneWayDef } from '../src/index.ts'
import { groupedTable, runDef, tableBlock, v } from './helpers.ts'

interface Params {
  test: 'ordinary' | 'welch' | 'brownForsythe' | 'kruskalWallis'
  method: string
  control?: number
}
type Anova = Record<string, unknown> & {
  F: number
  p: number
  r2: number
  welch: { F: number; dfd: number; p: number }
  brownForsytheAnova: { F: number; dfd: number; p: number }
  kruskalWallis: { H: number; p: number; meanRanks: number[] }
  groups: { mean: number }[]
}
type Cmp = { diff?: number; meanRankDiff?: number; lo?: number[]; hi?: number[]; p: number[] }

describe('multiple one-way ANOVAs vs R (oneway and multcomp oracles, row by row)', () => {
  for (const f of loadFixtures<{ rows: number[][][] }>('multiple_oneway')) {
    it(f.name, () => {
      const p = f.params as unknown as Params
      const table = groupedTable(f.input.rows)
      const input = normalizeTable(table)
      const params = multipleOneWayDef.params.parse({
        gaussian: p.test !== 'kruskalWallis',
        equalSD:
          p.test === 'welch' ? 'welch' : p.test === 'brownForsythe' ? 'brownForsythe' : 'yes',
        comparisons: p.control !== undefined ? 'vsControl' : 'allPairs',
        control: p.control !== undefined ? input[p.control]!.ref.key : '',
        // The rows uncorrected, Kruskal-Wallis' chi-square P and Dunn by Bonferroni, as these
        // cases were computed (the settings before 0.3.9; 51c's are tested below).
        approach: 'none',
        kwPMethod: 'approximate',
        dunnMethod: 'bonferroni',
        ...(p.test === 'welch' || p.test === 'brownForsythe'
          ? { welchMethod: p.method }
          : p.test === 'kruskalWallis'
            ? {}
            : p.control !== undefined
              ? { controlMethod: p.method }
              : { allPairsMethod: p.method }),
      })
      const r = multipleOneWayDef.run(input, params)
      expect(r.status, r.diagnostics.map((d) => d.message).join()).toBe('ok')
      const main = tableBlock(r, 'results', 1)
      const cmp = tableBlock(r, 'comparisons')
      const exp = f.expected as unknown as { anova: Anova; comparisons: Cmp }[]
      let k = 0
      exp.forEach((row, ri) => {
        const a = row.anova
        const [F, P] =
          p.test === 'welch'
            ? [a.welch.F, a.welch.p]
            : p.test === 'brownForsythe'
              ? [a.brownForsytheAnova.F, a.brownForsytheAnova.p]
              : p.test === 'kruskalWallis'
                ? [a.kruskalWallis.H, a.kruskalWallis.p]
                : [a.F, a.p]
        const line = main.rows[ri]!
        expectClose(v(line[1]), F, f.tol, `row ${ri + 1} F`)
        expectClose(v(line[3]), P, f.tol, `row ${ri + 1} P`)
        if (p.test === 'ordinary') expectClose(v(line[6]), a.r2, f.tol, `row ${ri + 1} R2`)
        const c = row.comparisons
        const ps = arr(c.p)
        const diffs = arr((c.diff ?? c.meanRankDiff) as number | number[])
        ps.forEach((pe, j) => {
          const got = cmp.rows[k++]!
          const col = (name: string) => got[cmp.columns.findIndex((x) => x.startsWith(name))]!
          expectClose(v(got[1]), diffs[j]!, f.tol, `row ${ri + 1} diff ${j}`)
          expectClose(
            v(col(p.method === 'bky' ? 'q value' : 'Adjusted P')),
            pe,
            f.tol,
            `row ${ri + 1} P ${j}`,
          )
          if (c.lo && Number.isFinite(arr(c.lo)[j]!)) {
            const ci = col('95%') as ResultValue & { lo: number; hi: number }
            expectClose(ci.lo, arr(c.lo)[j]!, f.tol, `row ${ri + 1} lo ${j}`)
            expectClose(ci.hi, arr(c.hi!)[j]!, f.tol, `row ${ri + 1} hi ${j}`)
          }
        })
      })
      expect(k).toBe(cmp.rows.length)
    })
  }
})

describe('multiple one-way ANOVAs plugin', () => {
  it('skips rows it cannot analyze', () => {
    const t = groupedTable(
      [
        [
          [1, 2, 3],
          [4, 5, 6.5],
          [2, 3, 3.5],
        ],
        [[1, 2], [], [3, 4]],
        [[], [], []],
      ],
      ['a', 'b', 'c'],
    )
    const r = runDef(multipleOneWayDef, t)
    expect(r.status).toBe('ok')
    expect(tableBlock(r, 'results', 1).rows).toHaveLength(1)
    expect(r.comparisons.map((c) => c.key.startsWith('row0:'))).toEqual([true, true, true])
    const notes = r.sheets.find((s) => s.key === 'results')!.blocks.filter((b) => b.type === 'note')
    expect(notes).toContainEqual({
      type: 'note',
      text: 'Not analyzed: b (a data set has no values).',
    })
    // Roadmap 51c (S9): the rows' P values are corrected across rows, and the result says so.
    expect(notes.map((n) => (n as { text: string }).text).join(' ')).toMatch(/^Rows: /)
  })
})

// Roadmap 51c (S9): the rows' P values corrected for their number, against R (suite
// `multiple_oneway_rows`): every FDR and family-wise method, at the case's Q.
describe('multiple one-way ANOVAs: the rows corrected vs R', () => {
  type Rows = Record<'p' | 'bh' | 'by' | 'bky' | 'holmSidak' | 'sidak' | 'bonferroni', number[]>
  for (const f of loadFixtures<{ rows: number[][][] }, Rows>('multiple_oneway_rows')) {
    it(f.name, () => {
      const p = f.params as { test: 'ordinary' | 'kruskalWallis'; Q: number }
      const table = groupedTable(f.input.rows)
      const base = {
        gaussian: p.test === 'ordinary',
        kwPMethod: 'approximate',
        comparisons: 'none',
        q: p.Q * 100,
      }
      const cases: [object, keyof Rows, string][] = [
        [{ approach: 'fdr', fdrMethod: 'bh' }, 'bh', 'q value'],
        [{ approach: 'fdr', fdrMethod: 'by' }, 'by', 'q value'],
        [{ approach: 'fdr', fdrMethod: 'bky' }, 'bky', 'q value'],
        [{ approach: 'significance', sigMethod: 'holm-sidak' }, 'holmSidak', 'Adjusted P value'],
        [{ approach: 'significance', sigMethod: 'sidak' }, 'sidak', 'Adjusted P value'],
        [{ approach: 'significance', sigMethod: 'bonferroni' }, 'bonferroni', 'Adjusted P value'],
      ]
      for (const [extra, key, column] of cases) {
        const r = runDef(multipleOneWayDef, table, { ...base, ...extra })
        const main = tableBlock(r, 'results', 1)
        const pc = main.columns.indexOf('P value')
        const ac = main.columns.indexOf(column)
        expect(ac, `${key}: ${main.columns.join()}`).toBeGreaterThan(0)
        main.rows.forEach((row, i) => {
          expectClose(v(row[pc]), arr(f.expected.p)[i]!, f.tol, `${key} row ${i} P`)
          expectClose(v(row[ac]), arr(f.expected[key])[i]!, f.tol, `${key} row ${i}`)
        })
      }
      const none = runDef(multipleOneWayDef, table, { ...base, approach: 'none' })
      expect(tableBlock(none, 'results', 1).columns).not.toContain('q value')
    })
  }
})
