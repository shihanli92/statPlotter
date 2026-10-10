import { describe, expect, it } from 'vitest'
import {
  type Alternative,
  mannWhitney,
  wilcoxonSignedRank,
  wilcoxonSignedRankOneSample,
} from '../src/index.ts'
import { expectClose, loadFixtures } from './oracle.ts'

interface Params {
  exact?: 'auto' | boolean
  correct?: boolean
  alternative?: Alternative
  confLevel?: number
  zeroMethod?: 'wilcoxon' | 'pratt'
}

function compare(got: Record<string, unknown>, expected: Record<string, unknown>, tol = {}): void {
  for (const [k, e] of Object.entries(expected)) {
    expect(got, k).toHaveProperty(k)
    if (typeof e === 'number') expectClose(got[k] as number, e, tol, k)
    else expect(got[k], k).toBe(e)
  }
}

describe('Mann-Whitney vs R', () => {
  for (const f of loadFixtures<{ a: number[]; b: number[] }>('mannwhitney')) {
    it(f.name, () => {
      const got = mannWhitney(f.input.a, f.input.b, f.params as Params)
      compare({ ...got }, f.expected, f.tol)
    })
  }
})

describe('Mann-Whitney invariants', () => {
  it('complete separation: exact P = 2 / C(16, 8), U = 0', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8]
    const b = [9, 10, 11, 12, 13, 14, 15, 16]
    const r = mannWhitney(a, b, { exact: true })
    expect(r.U).toBe(0)
    expect(r.uB).toBe(64)
    expectClose(r.p, 2 / 12870, { rtol: 1e-14 }, 'p')
    expectClose(mannWhitney(a, b, { exact: true, alternative: 'greater' }).p, 1 / 12870, {
      rtol: 1e-14,
    })
  })

  it('swapping groups mirrors U, the alternative and the HL shift', () => {
    const a = [1, 2, 2, 3, 4, 4]
    const b = [2, 3, 5, 5, 6]
    const ab = mannWhitney(a, b, { exact: true, alternative: 'greater' })
    const ba = mannWhitney(b, a, { exact: true, alternative: 'less' })
    expect(ba.p).toBe(ab.p)
    expect(ba.uA).toBe(ab.uB)
    const e1 = mannWhitney(a, b, { exact: true })
    const e2 = mannWhitney(b, a, { exact: true })
    expect(e2.p).toBeCloseTo(e1.p, 15)
  })

  it("'auto' switches to the normal approximation above 100 values", () => {
    const a = Array.from({ length: 50 }, (_, i) => i * 1.01)
    const b = Array.from({ length: 50 }, (_, i) => i * 1.03 + 0.5)
    expect(mannWhitney(a, b).method).toBe('exact')
    expect(mannWhitney(a, [...b, 99]).method).toBe('normal')
  })
})

describe('Wilcoxon signed-rank vs R', () => {
  for (const f of loadFixtures<{ a: number[]; b: number[]; x: number[]; mu: number }>('wilcoxon')) {
    it(f.name, () => {
      const p = f.params as Params
      const got = f.input.x
        ? wilcoxonSignedRankOneSample(f.input.x, f.input.mu, p)
        : wilcoxonSignedRank(f.input.a, f.input.b, p)
      compare({ ...got }, f.expected, f.tol)
    })
  }
})

describe('Wilcoxon invariants', () => {
  it('all differences positive: exact P = 2 / 2^n', () => {
    const a = [1, 2, 3, 4, 5, 6]
    const b = a.map((v, i) => v + 0.5 + i * 0.1)
    const r = wilcoxonSignedRank(a, b, { exact: true })
    expect(r.wPlus).toBe(21)
    expect(r.W).toBe(21)
    expectClose(r.p, 2 / 64, { rtol: 1e-15 }, 'p')
  })

  it('one-sample equals paired against a constant', () => {
    const x = [2.1, 3.4, 1.9, 5.5, 4.2, 2.8, 3.3]
    const one = wilcoxonSignedRankOneSample(x, 3, { exact: true })
    const paired = wilcoxonSignedRank(
      x.map(() => 3),
      x,
      { exact: true },
    )
    expect(one.p).toBe(paired.p)
    expect(one.wPlus).toBe(paired.wPlus)
  })

  it('all differences zero: P is NaN, not a throw', () => {
    const r = wilcoxonSignedRank([1, 2, 3], [1, 2, 3])
    expect(r.nNonZero).toBe(0)
    expect(r.p).toBeNaN()
    expect(r.W).toBe(0)
  })
})
