import { describe, expect, it } from 'vitest'
import {
  chiSquareTest,
  chiSquareTrend,
  FISHER_MAX_TABLES,
  fisherExact,
  hyperLogPmf,
  hyperPmf,
  mcNemar,
  twoByTwo,
} from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { loadFixtures } from './oracle.ts'
import { growthRatio } from './timing.ts'

interface Expected {
  chiSquare: unknown
  chiSquareYates?: unknown
  fisher: unknown
  trend?: unknown
  twoByTwo?: { riskDifferenceNoCC: unknown } & Record<string, unknown>
  mcNemar?: unknown
}

describe('contingency tables vs R', () => {
  for (const f of loadFixtures<{ table: number[][] }, Expected>('contingency')) {
    it(f.name, () => {
      const t = f.input.table
      const confLevel = (f.params as { confLevel?: number }).confLevel
      const e = f.expected
      expectDeepClose(chiSquareTest(t), e.chiSquare, f.tol, 'chiSquare')
      if (e.chiSquareYates) {
        expectDeepClose(chiSquareTest(t, { yates: true }), e.chiSquareYates, f.tol, 'yates')
      } else {
        // Yates applies to 2 × 2 tables only.
        expect(chiSquareTest(t, { yates: true }).chiSq).toBe(chiSquareTest(t).chiSq)
      }
      const fi = fisherExact(t)
      expectDeepClose(fi, e.fisher, f.tol, 'fisher')
      if (!e.twoByTwo) {
        expect(fi.pLess).toBeNaN()
        expect(fi.pGreater).toBeNaN()
      }
      if (e.trend) expectDeepClose(chiSquareTrend(t), e.trend, f.tol, 'trend')
      if (e.twoByTwo) {
        const { riskDifferenceNoCC, ...rest } = e.twoByTwo
        expectDeepClose(twoByTwo(t, { confLevel }), rest, f.tol, 'twoByTwo')
        expectDeepClose(
          twoByTwo(t, { confLevel, newcombeCorrection: false }).riskDifference,
          riskDifferenceNoCC,
          f.tol,
          'riskDifferenceNoCC',
        )
        expectDeepClose(mcNemar(t), e.mcNemar, f.tol, 'mcNemar')
      }
    })
  }
})

describe('contingency invariants', () => {
  it('validates tables', () => {
    expect(() => chiSquareTest([[1, 2]])).toThrow(/at least 2 × 2/)
    expect(() => chiSquareTest([[1, 2], [3]])).toThrow(/row 2/)
    expect(() =>
      fisherExact([
        [1, -2],
        [3, 4],
      ]),
    ).toThrow(/non-negative integer/)
    expect(() =>
      twoByTwo([
        [1.5, 2],
        [3, 4],
      ]),
    ).toThrow(/non-negative integer/)
    expect(() =>
      twoByTwo([
        [1, 2, 3],
        [3, 4, 5],
      ]),
    ).toThrow(/2 × 2/)
    expect(() =>
      chiSquareTrend([
        [1, 2, 3],
        [3, 4, 5],
      ]),
    ).toThrow(/2 columns/)
    expect(() =>
      mcNemar([
        [1, 2, 3],
        [3, 4, 5],
      ]),
    ).toThrow(/2 × 2/)
  })

  it('degenerate tables do not throw', () => {
    const zero = [
      [0, 0],
      [0, 0],
    ]
    expect(chiSquareTest(zero).chiSq).toBeNaN()
    expect(fisherExact(zero).p).toBe(1)
    expect(
      fisherExact([
        [0, 0, 0],
        [0, 0, 0],
      ]).p,
    ).toBe(1)
    const e = twoByTwo(zero)
    expect(e.relativeRisk.value).toBeNaN()
    expect(e.oddsRatio).toEqual({ value: Number.NaN, lower: 0, upper: Number.POSITIVE_INFINITY })
    expect(e.nnt).toBeNull()
    expect(e.sensitivity.value).toBeNaN()
    const m = mcNemar([
      [4, 0],
      [0, 5],
    ])
    expect(m.chiSq).toBeNaN()
    expect(m.pExact).toBe(1)
  })

  it('NNT limits are the reciprocals of the difference limits', () => {
    const e = twoByTwo([
      [30, 20],
      [15, 35],
    ])
    const d = e.riskDifference
    expect(d.lower).toBeGreaterThan(0)
    expect(e.nnt!.value).toBeCloseTo(1 / d.value, 14)
    expect(e.nnt!.lower).toBeCloseTo(1 / d.upper, 14)
    expect(e.nnt!.upper).toBeCloseTo(1 / d.lower, 14)
    // CI of the difference contains 0: the NNT set passes through infinity (lower > upper).
    const w = twoByTwo([
      [12, 10],
      [10, 12],
    ])
    expect(w.riskDifference.lower).toBeLessThan(0)
    expect(w.nnt!.lower).toBeGreaterThan(w.nnt!.upper)
  })

  it('hypergeometric probabilities do not underflow with unbalanced margins', () => {
    // R: dhyper(1, 4, 4000, 2001), dhyper(10, 20, 2000, 30)
    expect(hyperPmf(1, 4, 4000, 2001)).toBeCloseTo(0.25024989068745823, 15)
    expect(hyperPmf(10, 20, 2000, 30) / 1.6473373867523937e-14).toBeCloseTo(1, 13)
    expect(hyperLogPmf(1, 4, 4000, 2001)).toBeCloseTo(Math.log(0.25024989068745823), 14)
    // Far in the tail the probability underflows but its log does not.
    expect(hyperLogPmf(0, 2001, 2001, 2001)).toBeLessThan(-2000)
    expect(Number.isFinite(hyperLogPmf(0, 2001, 2001, 2001))).toBe(true)
  })

  it('Baptista–Pike stays finite and fast for large, strongly associated tables', () => {
    for (const t of [
      [
        [800, 50],
        [60, 900],
      ],
      [
        [20000, 1],
        [1, 20000],
      ],
    ]) {
      const or = twoByTwo(t).oddsRatio
      expect(or.lower).toBeGreaterThan(0)
      expect(or.lower).toBeLessThan(or.value)
      expect(or.upper).toBeGreaterThan(or.value)
      expect(Number.isFinite(or.upper)).toBe(true)
    }
    // Linear in the table total: 4× the total, about 4× the time (quadratic would be 16×).
    const ratio = growthRatio(
      (n) =>
        twoByTwo([
          [n, 1],
          [1, n],
        ]),
      2500,
    )
    expect(ratio).toBeLessThan(10)
  })

  it('refuses r × c tables too large to enumerate', () => {
    expect(FISHER_MAX_TABLES).toBe(20_000_000)
    const big = [
      [40, 35, 30, 25, 20],
      [22, 31, 28, 37, 30],
      [30, 25, 35, 20, 40],
    ]
    // The same work cap with a smaller limit (the default takes 2e7 steps to give up).
    expect(() => fisherExact(big, { maxWork: 1e4 })).toThrow(/more than 10000 steps.*too large/)
    const small = [
      [3, 1, 2],
      [1, 4, 0],
      [2, 0, 5],
    ]
    expect(fisherExact(small, { maxWork: 1e4 })).toEqual(fisherExact(small))
  })
})
