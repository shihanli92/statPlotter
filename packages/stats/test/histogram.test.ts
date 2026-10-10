import { describe, expect, it } from 'vitest'
import { type BinMeasure, histogram } from '../src/index.ts'
import { expectClose, loadFixtures } from './oracle.ts'

// The graphs' histogram bars (the `bin` stat, roadmap 33d) against R: the `frequency` suite bins
// every case a second time with cut() on left-closed breaks, giving each data set's counts and
// its percent and fraction of the values binned.

const FIELD: Record<BinMeasure, string> = {
  count: 'histCounts',
  percent: 'histPercent',
  fraction: 'histFraction',
}

describe('histogram bars vs R (cut)', () => {
  for (const f of loadFixtures<{ dataSets: number[][] | number[] }>('frequency'))
    for (const measure of ['count', 'percent', 'fraction'] as const)
      it(`${f.name}: ${measure}`, () => {
        const raw = f.input.dataSets
        const ds = (Array.isArray(raw[0]) ? raw : [raw]) as number[][]
        const got = histogram(ds, { ...f.params, measure })
        const want = f.expected[FIELD[measure]] as number[][]
        expect(got.values.length).toBe(want.length)
        got.values.forEach((row, d) => {
          expect(row.length).toBe(want[d]!.length)
          row.forEach((v, i) => {
            expectClose(v, want[d]![i]!, f.tol, `${measure} ${d}/${i}`)
          })
        })
      })

  it('without values: no bins', () => {
    const h = histogram([[], []], { measure: 'percent' })
    expect(h.error).toBe('no-values')
    expect(h.values).toEqual([[], []])
  })
})
