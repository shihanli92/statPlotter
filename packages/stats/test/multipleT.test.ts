import { describe, expect, it } from 'vitest'
import {
  correctFamily,
  type FamilyMethod,
  type MultipleTRowInput,
  type MultipleTTestMethod,
  mean,
  multipleTTests,
  sd,
} from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { loadFixtures } from './oracle.ts'

interface Input {
  rows: { a: number[]; b: number[] }[]
}
interface Params {
  method: MultipleTTestMethod
  lognormal?: boolean
  summary?: boolean
  family: FamilyMethod
  q?: number
  alpha?: number
}

const summarize = (x: number[]) => {
  const v = x.filter(Number.isFinite)
  return v.length ? { mean: mean(v), sd: v.length > 1 ? sd(v) : 0, n: v.length } : []
}

describe('multiple t tests vs R', () => {
  for (const f of loadFixtures<Input>('multiple_t')) {
    it(f.name, () => {
      const p = f.params as unknown as Params
      const rows: MultipleTRowInput[] = f.input.rows.map((r) =>
        p.summary ? { a: summarize(r.a), b: summarize(r.b) } : r,
      )
      const res = multipleTTests(rows, { method: p.method, lognormal: p.lognormal })
      const exp = f.expected as {
        rows: ({ skip: boolean } & Record<string, unknown>)[]
        pooled?: unknown
        family: unknown
      }
      res.rows.forEach((row, i) => {
        const { skip, ...rest } = exp.rows[i]!
        expect(!!row.skip, `row ${i + 1} skipped`).toBe(skip)
        if (!skip) expectDeepClose(row, rest, f.tol, `row ${i + 1}`)
      })
      if (exp.pooled) expectDeepClose(res.pooled, exp.pooled, f.tol, 'pooled')
      const fam = correctFamily(
        res.rows.map((r) => r.p),
        { method: p.family, q: p.q, alpha: p.alpha },
      )
      expectDeepClose(fam, exp.family, f.tol, 'family')
    })
  }
})

describe('multiple t tests', () => {
  it('pooled SD equals two-way ANOVA MSE and one row matches an ordinary t test', () => {
    const rows = [
      { a: [1, 2, 3.5], b: [4, 5, 6.2] },
      { a: [2, 2.5, 3], b: [2.1, 3.3, 4] },
    ]
    const pooled = multipleTTests(rows, { method: 'pooled' })
    expect(pooled.pooled!.df).toBe(8)
    const single = multipleTTests([rows[0]!], { method: 'unpaired' })
    const pooledOne = multipleTTests([rows[0]!], { method: 'pooled' })
    expect(pooledOne.rows[0]!.p).toBeCloseTo(single.rows[0]!.p, 14)
  })

  it('skips rows that cannot be tested and says why', () => {
    const r = multipleTTests(
      [
        { a: [1, 1, 1], b: [2, 2, 2] },
        { a: [1], b: [2, 3] },
        { a: [1, 2], b: [3, -4] },
        { a: { mean: 1, sd: 1, n: 3 }, b: [1, 2, 3] },
      ],
      { method: 'welch', lognormal: true },
    )
    expect(r.rows.map((x) => x.skip)).toEqual([
      'no-variation',
      'too-few-values',
      'not-positive',
      'summary-data',
    ])
    const mw = multipleTTests([{ a: { mean: 1, sd: 1, n: 3 }, b: [1, 2] }], {
      method: 'mannWhitney',
    })
    expect(mw.rows[0]!.skip).toBe('summary-data')
  })

  it('FDR discoveries match q values at the boundary', () => {
    const p = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, Number.NaN]
    for (const method of ['bh', 'bky', 'by'] as const) {
      for (const q of [0.01, 0.05, 0.1]) {
        const r = correctFamily(p, { method, q })
        expect(r.m).toBe(8)
        r.flagged.forEach((f, i) => {
          if (Number.isNaN(p[i]!)) expect(f).toBe(false)
          // Rejection is monotone in Q: flagged at Q ⇔ q value ≤ Q (up to rounding).
          else if (Math.abs(r.adjusted[i]! - q) > 1e-12) expect(f).toBe(r.adjusted[i]! <= q)
        })
      }
    }
    const none = correctFamily([0.04, 0.06], { method: 'none' })
    expect(none.flagged).toEqual([true, false])
  })

  it('two-stage step-up q values are the published ones: BH × (1 + Q)·m̂₀/m (audit 3, RTA-1)', () => {
    // Tawk et al. 2026 (CC BY 4.0), Fig. 3b's source data: published P and q values (Q = 1%).
    const p = [0.00021, 0.615665, 0.428412, 0.014977, 0.136817, 0.575996]
    const published = [0.001061, 0.518184, 0.518184, 0.037818, 0.230309, 0.518184]
    const r = correctFamily(p, { method: 'bky', q: 0.01 })
    expect(r.m0).toBe(5)
    // (The P values are given to six digits, so the q values agree to about 1e-6.)
    r.adjusted.forEach((x, i) => {
      expect(Math.abs(x - published[i]!)).toBeLessThan(1.5e-6)
    })
    // Stage one rejects nothing: m̂₀ = m, q = BH × (1 + Q); everything: m̂₀ taken as 1.
    const none = correctFamily([0.3, 0.6], { method: 'bky', q: 0.05 })
    expect(none.adjusted).toEqual([0.6 * 1.05, 0.6 * 1.05])
    const all = correctFamily([0.001, 0.002], { method: 'bky', q: 0.05 })
    expect(all.flagged).toEqual([true, true])
    expect(all.adjusted[1]).toBeCloseTo((0.002 * 1.05) / 2, 15)
  })
})
