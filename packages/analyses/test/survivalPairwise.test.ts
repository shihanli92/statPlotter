import { createTable, type DataTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { arr, expectClose, loadFixtures } from '../../stats/test/oracle.ts'
import { survivalDef } from '../src/survival.ts'
import { runDef, tableBlock, v } from './helpers.ts'

// Roadmap 51c (S16): pairwise comparisons of three or more survival curves — the chosen test on
// each pair, corrected for the pairs — against R (suite `survival_pairwise`).

function survivalTable(time: number[][], event: number[][]): DataTable {
  const rows = time.reduce((s, g) => s + g.length, 0)
  const t = createTable({ tableKind: 'survival', columns: time.length, rows })
  let r = 0
  time.forEach((g, c) => {
    g.forEach((x, i) => {
      t.x!.subcolumns[0]!.values[r] = x
      t.dataSets[c]!.subcolumns[0]!.values[r] = event[c]![i]!
      r++
    })
  })
  return t
}

type Family = Record<'chiSq' | 'p' | 'holm' | 'bonferroni' | 'sidak' | 'none', number[]>

describe('pairwise survival comparisons vs R', () => {
  for (const f of loadFixtures<
    { time: number[][]; event: number[][] },
    { i: number[]; j: number[]; logRank: Family; gehanBreslowWilcoxon: Family }
  >('survival_pairwise')) {
    it(f.name, () => {
      const p = f.params as { pairs: 'all' | 'control'; control?: number }
      const t = survivalTable(f.input.time, f.input.event)
      const control = p.pairs === 'control' ? t.dataSets[p.control!]!.id : ''
      for (const test of ['logRank', 'gehanBreslowWilcoxon'] as const)
        for (const method of ['holm', 'bonferroni', 'sidak', 'none'] as const) {
          const r = runDef(survivalDef, t, {
            test,
            pairwise: p.pairs,
            pairwiseMethod: method,
            control,
          })
          const b = tableBlock(r, 'pairwise')
          const e = f.expected[test]
          expect(b.rows.length).toBe(arr(e.p).length)
          const col = (name: string) => b.columns.indexOf(name)
          b.rows.forEach((row, k) => {
            const at = `${test} ${method} ${k}`
            expectClose(v(row[col('Chi square')]), arr(e.chiSq)[k]!, f.tol, `${at} chi2`)
            expectClose(v(row[col('P value')]), arr(e.p)[k]!, f.tol, `${at} P`)
            if (method !== 'none')
              expectClose(v(row[col('Adjusted P value')]), arr(e[method])[k]!, f.tol, `${at} adj`)
          })
        }
    })
  }

  it('only with three or more groups and when asked', () => {
    const f = loadFixtures<{ time: number[][]; event: number[][] }>('survival_pairwise')[0]!
    const t = survivalTable(f.input.time, f.input.event)
    expect(runDef(survivalDef, t).sheets.map((s) => s.key)).not.toContain('pairwise')
    const two = survivalTable(f.input.time.slice(0, 2), f.input.event.slice(0, 2))
    expect(runDef(survivalDef, two, { pairwise: 'all' }).sheets.map((s) => s.key)).not.toContain(
      'pairwise',
    )
  })
})
