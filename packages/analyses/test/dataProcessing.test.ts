import { createTable, normalizeTable, type ResultValue } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { expectClose, loadFixtures } from '../../stats/test/oracle.ts'
import {
  fractionOfTotal,
  fractionOfTotalDef,
  type RowSummary,
  rowStatsDef,
  rowSummary,
} from '../src/dataProcessing.ts'
import { pStackDef } from '../src/index.ts'
import { columnTable, countsTable, groupedTable, kvOf, runDef, tableBlock, v } from './helpers.ts'

const mean = (x: number[]) => x.reduce((s, y) => s + y, 0) / x.length
const sd = (x: number[]) => {
  const m = mean(x)
  return Math.sqrt(x.reduce((s, y) => s + (y - m) ** 2, 0) / (x.length - 1))
}
const finite = (x: (number | string)[]) =>
  x.map((y) => (typeof y === 'number' ? y : Number.NaN)).filter(Number.isFinite)

describe('row statistics vs R', () => {
  for (const f of loadFixtures<{ rows: (number | string)[][][] }>('row_stats')) {
    it(f.name, () => {
      const p = f.params as { scope: string; summary?: boolean; confLevel?: number }
      const level = p.confLevel ?? 0.95
      const part = (x: (number | string)[]) => {
        const vals = finite(x)
        return p.summary
          ? { mean: mean(vals), sd: vals.length > 1 ? sd(vals) : 0, n: vals.length }
          : { values: vals }
      }
      const cmp = (got: RowSummary, e: Record<string, number>, where: string) => {
        for (const k of Object.keys(e)) {
          if (p.summary && ['min', 'max', 'median'].includes(k)) continue
          const tol = k === 'sum' && p.summary ? { rtol: 1e-12 } : f.tol
          expectClose(got[k as keyof RowSummary], e[k]!, tol, `${where}.${k}`)
        }
      }
      if (p.scope === 'allDataSets') {
        const e = f.expected as unknown as Record<string, number>[]
        f.input.rows.forEach((row, r) => {
          cmp(rowSummary(row.map(part), level), e[r]!, `row ${r}`)
        })
      } else {
        const e = f.expected as unknown as Record<string, number>[][]
        f.input.rows.forEach((row, r) => {
          row.forEach((cell, d) => {
            cmp(rowSummary([part(cell)], level), e[r]![d]!, `row ${r} ds ${d}`)
          })
        })
      }
    })
  }

  it('plugin tables: per data set and across data sets', () => {
    const t = groupedTable(
      [
        [
          [1, 2, 3],
          [4, 6, null],
        ],
        [[5], [7, 8, 9]],
      ],
      ['a', 'b'],
    )
    const per = runDef(rowStatsDef, t, { ci: true })
    const b = tableBlock(per, 'rows')
    expect(b.columns.slice(0, 6)).toEqual([
      'Row',
      'Group A: Mean',
      'Group A: SD',
      'Group A: SEM',
      'Group A: N',
      'Group A: 95% CI of mean',
    ])
    expect(v(b.rows[0]![1])).toBe(2)
    const all = runDef(rowStatsDef, t, { scope: 'allDataSets', sum: true })
    const a = tableBlock(all, 'rows')
    expect(a.rows[1]!.map((x) => (x as { v: number }).v)).toEqual([
      'b',
      7.25,
      sd([5, 7, 8, 9]),
      sd([5, 7, 8, 9]) / 2,
      4,
      29,
    ])
  })
})

describe('fraction of total vs R', () => {
  for (const f of loadFixtures<{ grid: (number | string)[][] }>('fraction_total')) {
    it(f.name, () => {
      const grid = f.input.grid.map((r) => r.map((x) => (typeof x === 'number' ? x : Number.NaN)))
      const by = (f.params as { divideBy: 'column' | 'row' | 'grand' }).divideBy
      const got = fractionOfTotal(grid, by)
      const e = f.expected as { fractions: number[][]; totals: number[] | number }
      got.fractions.forEach((row, r) => {
        row.forEach((x, c) => {
          expectClose(x, e.fractions[r]![c]!, f.tol, `[${r}][${c}]`)
        })
      })
      const totals = Array.isArray(e.totals) ? e.totals : [e.totals]
      got.totals.forEach((t, i) => {
        expectClose(t, totals[i]!, f.tol, `total ${i}`)
      })
    })
  }

  it('plugin: percentages of the column total, one column per replicate', () => {
    const t = groupedTable([
      [
        [1, 3],
        [2, 2],
      ],
      [
        [3, 1],
        [6, null],
      ],
    ])
    const r = runDef(fractionOfTotalDef, t, { display: 'percent' })
    const b = tableBlock(r, 'fractions')
    expect(b.columns).toEqual(['Row', 'Group A (1)', 'Group A (2)', 'Group B (1)', 'Group B (2)'])
    expect(b.rows[0]!.slice(1).map((x) => v(x))).toEqual([25, 75, 25, 100])
    expect(b.rows[1]![4]).toEqual({ kind: 'text', v: '' })
  })
})

describe('stack of P values vs R', () => {
  for (const f of loadFixtures<{ p: number[] }>('pstack')) {
    it(f.name, () => {
      const pr = f.params as { family: string; q?: number; alpha?: number }
      const fdr = ['bky', 'bh', 'by'].includes(pr.family)
      const params = pStackDef.params.parse(
        fdr
          ? { approach: 'fdr', fdrMethod: pr.family, q: (pr.q ?? 0.01) * 100 }
          : pr.family === 'none'
            ? { approach: 'none', alpha: pr.alpha }
            : { approach: 'significance', sigMethod: pr.family, alpha: pr.alpha },
      )
      const r = pStackDef.run(normalizeTable(columnTable([f.input.p])), params)
      const b = tableBlock(r, 'results', 1)
      const e = f.expected as { adjusted: number[]; flagged: boolean[]; m0?: number }
      b.rows.forEach((row: ResultValue[], i) => {
        expect((row[1] as { v: boolean }).v, `flag ${i}`).toBe(e.flagged[i])
        if (row.length > 3) expectClose(v(row[3]), e.adjusted[i]!, f.tol, `adjusted ${i}`)
      })
      if (e.m0 !== undefined)
        expect(v(kvOf(r, 'Estimated number of true null hypotheses'))).toBe(e.m0)
      const ranked = r.outputs.ranked!
      expect(ranked.y).toEqual([...f.input.p].sort((a, b) => a - b))
    })
  }

  it('refuses values that are not P values and summary tables', () => {
    const r = runDef(pStackDef, columnTable([[0.2, 1.5]]))
    expect(r.status).toBe('error')
    const s = createTable({ columns: 1, yFormat: { type: 'summary', preset: 'meanSdN' } })
    expect(runDef(pStackDef, s).status).toBe('error')
  })
})

describe('fraction of total on parts-of-whole tables', () => {
  it('divides each category by the column total', () => {
    const t = countsTable('partsOfWhole', [[30], [50], [20]], ['A', 'B', 'C'])
    const r = runDef(fractionOfTotalDef, t, { display: 'percent' })
    expect(r.status).toBe('ok')
    const b = tableBlock(r, r.sheets[0]!.key)
    const values = b.rows.map((row) => v(row[1]))
    expect(values).toEqual([30, 50, 20])
  })
})
