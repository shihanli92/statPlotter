import { describe, expect, it } from 'vitest'
import { compareSurvival, coxRegression } from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { loadFixtures } from './oracle.ts'

interface Input {
  time: number[]
  event: number[]
  X: number[][]
  names: string[]
}

interface Params {
  ties?: 'efron' | 'breslow'
  confLevel?: number
  ciMethod?: 'wald' | 'profile'
  interactions?: [number, number][]
}

/**
 * Iterative fits: coxph converged with eps 1e-11 and restarted from its estimates (variance at the
 * maximum); our Newton steps to 1e-10 relative, then one more; profile limits solved to 1e-13 on
 * both sides. Documented tolerance 1e-9 relative (cases with a diverging coefficient carry their
 * own looser one).
 */
const TOL = { rtol: 1e-9, atol: 1e-12 }

describe('Cox regression vs R', () => {
  for (const f of loadFixtures<Input>('cox')) {
    it(f.name, () => {
      const fit = coxRegression(
        f.input.time,
        f.input.event.map((e) => e === 1),
        f.input.X,
        f.input.names,
        f.params as Params,
      )
      expectDeepClose(fit, f.expected, { ...TOL, ...f.tol })
    })
  }
})

describe('Cox regression details', () => {
  it('the score test of one binary covariate is the log-rank test (Breslow, no ties)', () => {
    const time = [3, 5, 7, 9, 11, 2, 4, 6, 8, 10, 12, 13]
    const event = [true, false, true, true, true, true, true, false, true, true, false, true]
    const g = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1]
    const fit = coxRegression(
      time,
      event,
      g.map((v) => [v]),
      ['G'],
      { ties: 'breslow' },
    )
    const groups = [0, 1].map((k) =>
      time.flatMap((t, i) => (g[i] === k ? [{ time: t, event: event[i]! }] : [])),
    )
    const lr = compareSurvival(groups).logRank
    expect(fit.scoreTest.chiSq).toBeCloseTo(lr.chiSq, 12)
  })

  it('never throws on degenerate data', () => {
    const none = coxRegression([1, 2, 3], [false, false, false], [[1], [2], [3]], ['X'])
    expect(none.status).toBe('singular')
    expect(none.coefficients[0]!.estimate).toBeNaN()
    const empty = coxRegression([], [], [], ['X'])
    expect(empty.n).toBe(0)
  })

  it('throws for invalid shapes', () => {
    expect(() => coxRegression([1, 2], [true], [[1], [2]], ['X'])).toThrow(RangeError)
    expect(() => coxRegression([1], [true], [[1, 2]], ['X'])).toThrow(RangeError)
  })
})
