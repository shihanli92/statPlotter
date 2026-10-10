import { describe, expect, it } from 'vitest'
import {
  type Alternative,
  fTestVariances,
  type SummaryStats,
  tTestFromSummary,
  tTestPaired,
  tTestRatioPaired,
  tTestUnpaired,
} from '../src/index.ts'
import { expectClose, loadFixtures } from './oracle.ts'

interface In {
  a: number[]
  b: number[]
  A: SummaryStats
  B: SummaryStats
}

interface Params {
  test?: 'unpaired' | 'paired' | 'ratio' | 'summary'
  equalVariance?: boolean
  alternative?: Alternative
  confLevel?: number
}

/**
 * A case's values as the tests take them, complete: an empty cell (null; audit 3, S8) left out of
 * its group, or a paired test's pair holding one left out, as R and the analyses do (the cases
 * with empty cells also run through the analyses: analyses/test/oracleMissing.test.ts).
 */
function complete(input: In, paired: boolean): { a: number[]; b: number[] } {
  const a = input.a as (number | null)[]
  const b = input.b as (number | null)[]
  if (!paired) return { a: a.filter((x) => x !== null), b: b.filter((x) => x !== null) }
  const keep = a.map((x, i) => x !== null && b[i] !== null)
  return { a: a.filter((_, i) => keep[i]) as number[], b: b.filter((_, i) => keep[i]) as number[] }
}

function run(input: In, p: Params): Record<string, number> {
  const opts = { alternative: p.alternative, confLevel: p.confLevel }
  const test = p.test ?? 'unpaired'
  if (test !== 'summary') input = { ...input, ...complete(input, test !== 'unpaired') }
  switch (test) {
    case 'paired':
      return { ...tTestPaired(input.a, input.b, opts) }
    case 'ratio':
      return { ...tTestRatioPaired(input.a, input.b, opts) }
    case 'summary':
      return { ...tTestFromSummary(input.A, input.B, { ...opts, equalVariance: p.equalVariance }) }
    default:
      return { ...tTestUnpaired(input.a, input.b, { ...opts, equalVariance: p.equalVariance }) }
  }
}

describe('t tests vs R', () => {
  for (const f of loadFixtures<In, Record<string, number>>('ttest')) {
    it(f.name, () => {
      const got = run(f.input, f.params as Params)
      for (const [k, e] of Object.entries(f.expected)) {
        expect(got, k).toHaveProperty(k)
        expectClose(got[k]!, e, f.tol, k)
      }
    })
  }
})

describe('F test vs R', () => {
  for (const f of loadFixtures<In, Record<string, number>>('ftest')) {
    it(f.name, () => {
      const got: Record<string, number> = { ...fTestVariances(f.input.a, f.input.b) }
      for (const [k, e] of Object.entries(f.expected)) expectClose(got[k]!, e, f.tol, k)
    })
  }
})

describe('t test invariants', () => {
  const a = [3.2, 4.1, 5.0, 2.8, 3.9]
  const b = [5.1, 6.3, 4.8, 7.2, 5.9, 6.0]

  it('scale-invariant at extreme magnitudes (audit 3, S4)', () => {
    for (const equalVariance of [true, false]) {
      const ref = tTestUnpaired(a, b, { equalVariance })
      for (const k of [1e-200, 1e-170, 1e170, 1e200]) {
        const r = tTestUnpaired(
          a.map((x) => x * k),
          b.map((x) => x * k),
          { equalVariance },
        )
        expectClose(r.t, ref.t, { rtol: 1e-13 }, `t × ${k}`)
        expectClose(r.df, ref.df, { rtol: 1e-13 }, `df × ${k}`)
        expectClose(r.p, ref.p, { rtol: 1e-12 }, `p × ${k}`)
        expectClose(r.seDiff, ref.seDiff * k, { rtol: 1e-13 }, `se × ${k}`)
        expectClose(r.ciLo, ref.ciLo * k, { rtol: 1e-12 }, `ci × ${k}`)
      }
    }
    const paired = tTestPaired(a, b.slice(0, 5))
    const tiny = tTestPaired(
      a.map((x) => x * 1e-200),
      b.slice(0, 5).map((x) => x * 1e-200),
    )
    expectClose(tiny.t, paired.t, { rtol: 1e-13 }, 'paired t')
  })

  it('swapping groups flips the sign of t, diff and the CI', () => {
    const ab = tTestUnpaired(a, b)
    const ba = tTestUnpaired(b, a)
    expect(ba.t).toBeCloseTo(-ab.t, 13)
    expect(ba.diff).toBeCloseTo(-ab.diff, 13)
    expect(ba.ciLo).toBeCloseTo(-ab.ciHi, 13)
    expect(ba.p).toBeCloseTo(ab.p, 14)
  })

  it('one-sided P values: greater + less = 1, two-sided = 2·min', () => {
    const g = tTestUnpaired(a, b, { alternative: 'greater' }).p
    const l = tTestUnpaired(a, b, { alternative: 'less' }).p
    expect(g + l).toBeCloseTo(1, 14)
    expect(tTestUnpaired(a, b).p).toBeCloseTo(2 * Math.min(g, l), 14)
  })

  it('raw data and summary data give the same test', () => {
    const r = tTestUnpaired(a, b, { equalVariance: false })
    const s = tTestFromSummary(
      { mean: r.meanA, sd: r.sdA, n: r.nA },
      { mean: r.meanB, sd: r.sdB, n: r.nB },
      { equalVariance: false },
    )
    expectClose(s.t, r.t, { rtol: 1e-13 }, 't')
    expectClose(s.p, r.p, { rtol: 1e-13 }, 'p')
  })

  it('paired t equals a one-sample t on the differences; ratio t on log ratios', () => {
    const pa = [1, 2, 4, 8]
    const pb = [2, 3, 9, 15]
    const r = tTestRatioPaired(pa, pb)
    const logs = tTestPaired(
      [0, 0, 0, 0],
      pa.map((v, i) => Math.log10(pb[i]! / v)),
    )
    expect(r.t).toBe(logs.t)
    expectClose(r.ratio, 10 ** logs.mean, { rtol: 1e-15 }, 'ratio')
  })

  it('degenerate data never throw', () => {
    expect(tTestUnpaired([1], [2]).t).toBeNaN()
    expect(() => tTestPaired([1, 2], [1])).toThrow(RangeError)
    expect(tTestPaired([1, 2, 3], [1, 2, 3]).t).toBeNaN()
    expect(fTestVariances([1], [2, 3]).F).toBeNaN()
  })
})
