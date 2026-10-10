import { describe, expect, it } from 'vitest'
import {
  betaQuantile,
  binomialTest,
  chiSqQuantile,
  chiSquareGoodnessOfFit,
  type ProportionCiMethod,
  proportionCI,
} from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'

interface Input {
  k?: number
  n?: number
  p0?: number
  observed?: number[]
  expected?: number[]
}

describe('binomial / proportion / goodness of fit vs R', () => {
  for (const f of loadFixtures<Input>('binomial')) {
    it(f.name, () => {
      const p = f.params as { fn: string; confLevel?: number }
      const x = f.input
      if (p.fn === 'gof') {
        expectDeepClose(chiSquareGoodnessOfFit(x.observed!, x.expected!), f.expected, f.tol)
        return
      }
      const e = f.expected as {
        binomialTest: unknown
        proportionCI: Record<ProportionCiMethod, unknown>
      }
      expectDeepClose(binomialTest(x.k!, x.n!, x.p0!), e.binomialTest, f.tol, 'binomialTest')
      for (const method of ['wilsonBrown', 'wilson', 'clopperPearson'] as const) {
        expectDeepClose(
          proportionCI(x.k!, x.n!, { confLevel: p.confLevel, method }),
          e.proportionCI[method],
          f.tol,
          method,
        )
      }
    })
  }
})

describe('binomial invariants', () => {
  it('Prism example: 7 of 100 at 0.2', () => {
    expectClose(binomialTest(7, 100, 0.2).p, 0.00061307, { rtol: 1e-4 }, 'p')
  })

  it('Brown et al. example: x = 2 gives a lower limit of 0.355 / n', () => {
    expectClose(proportionCI(2, 40).lower * 40, 0.3553615, { rtol: 1e-6 }, 'lower')
  })

  it('quantile helpers invert the distributions', () => {
    expectClose(chiSqQuantile(0.05, 4), 0.7107230213973241, { rtol: 1e-13 }, 'qchisq')
    expectClose(chiSqQuantile(0.05, 2), -2 * Math.log(0.95), { rtol: 1e-14 }, 'qchisq df 2')
    expectClose(betaQuantile(0.025, 3, 8), 0.066739511177734467, { rtol: 1e-12 }, 'qbeta')
    expectClose(betaQuantile(0.025, 8, 3, false), 1 - 0.066739511177734467, { rtol: 1e-12 }, 'up')
  })

  it('degenerate input', () => {
    expect(binomialTest(0, 0, 0.3)).toEqual({ p: 1, pLess: 1, pGreater: 1 })
    expect(proportionCI(0, 0).value).toBeNaN()
    expect(() => proportionCI(5, 3)).toThrow(/exceeds/)
    expect(() => binomialTest(1.5, 3, 0.5)).toThrow(/integer/)
    expect(() => binomialTest(1, 3, 1.5)).toThrow(/p0/)
    expect(() => chiSquareGoodnessOfFit([1], [1])).toThrow(/2 categories/)
    expect(() => chiSquareGoodnessOfFit([1, 2], [0, 0])).toThrow(/sum to 0/)
  })
})
