import { describe, expect, it } from 'vitest'
import { type Alternative, tTestOneSample, tTestPaired } from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { loadFixtures } from './oracle.ts'

interface Params {
  alternative?: Alternative
  confLevel?: number
  shift?: number
}

describe('one-sample t test vs R', () => {
  for (const f of loadFixtures<{ x: number[]; mu: number }>('onesample')) {
    it(f.name, () => {
      const p = f.params as Params
      const got = tTestOneSample(f.input.x, f.input.mu, {
        alternative: p.alternative,
        confLevel: p.confLevel,
      })
      expectDeepClose(got, f.expected, f.tol)
    })
  }
})

describe('one-sample t invariants', () => {
  it('equals the paired t test against a constant column', () => {
    const x = [2.1, 3.4, 1.9, 5.5, 4.2, 2.8, 3.3]
    const one = tTestOneSample(x, 3)
    const paired = tTestPaired(
      x.map(() => 3),
      x,
    )
    expect(one.t).toBeCloseTo(paired.t, 13)
    expect(one.p).toBeCloseTo(paired.p, 13)
    expect(one.diffLo).toBeCloseTo(paired.ciLo, 13)
  })

  it('SD = 0 gives t = ±Inf and P = 0, not a throw', () => {
    const r = tTestOneSample([5, 5, 5], 4)
    expect(r.t).toBe(Number.POSITIVE_INFINITY)
    expect(r.p).toBe(0)
    expect(r.rSquared).toBe(1)
  })
})
