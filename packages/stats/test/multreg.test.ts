import { describe, expect, it } from 'vitest'
import { linearRegression, multipleLinearRegression } from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { loadFixtures } from './oracle.ts'

interface Input {
  y: number[]
  X: number[][]
  names: string[]
}

interface Params {
  intercept?: boolean
  confLevel?: number
  interactions?: [number, number][]
}

describe('multiple linear regression vs R', () => {
  for (const f of loadFixtures<Input>('multreg')) {
    it(f.name, () => {
      const p = f.params as Params
      const fit = multipleLinearRegression(f.input.y, f.input.X, f.input.names, p)
      const { residuals, ...rest } = f.expected as { residuals: number[] }
      expectDeepClose(fit, rest, f.tol)
      // Residuals can be ~0: absolute tolerance relative to the scale of Y.
      const scale = Math.max(...f.input.y.map(Math.abs))
      expectDeepClose(fit.residuals, residuals, { rtol: 1e-10, atol: 1e-12 * scale }, 'residuals')
    })
  }
})

describe('multiple linear regression invariants', () => {
  const x = [1, 2, 3, 4, 5, 6, 7]
  const y = [1.1, 2.3, 2.8, 4.2, 4.9, 6.3, 6.8]

  it('one predictor equals simple linear regression', () => {
    const m = multipleLinearRegression(
      y,
      x.map((v) => [v]),
      ['X'],
    )
    const s = linearRegression(x, y)
    expect(m.coefficients[1]!.estimate).toBeCloseTo(s.slope, 13)
    expect(m.coefficients[0]!.estimate).toBeCloseTo(s.intercept, 13)
    expect(m.coefficients[1]!.se).toBeCloseTo(s.slopeSE, 13)
    expect(m.rSquared).toBeCloseTo(s.r2, 13)
    expect(m.coefficients[1]!.vif).toBeCloseTo(1, 14)
  })

  it('never throws on degenerate data', () => {
    const empty = multipleLinearRegression([], [], ['A'])
    expect(empty.n).toBe(0)
    const tiny = multipleLinearRegression([1, 2], [[1], [2]], ['A'])
    expect(tiny.df).toBe(0)
    expect(tiny.coefficients[1]!.se).toBeNaN()
    const constant = multipleLinearRegression(
      [1, 2, 3, 4],
      [
        [5, 1],
        [5, 2],
        [5, 3],
        [5, 5],
      ],
      ['C', 'D'],
    )
    expect(constant.status).toBe('singular')
    expect(constant.coefficients[1]!.estimate).toBeNaN()
    expect(constant.coefficients[2]!.estimate).not.toBeNaN()
  })

  it('throws for invalid shapes', () => {
    expect(() => multipleLinearRegression([1, 2], [[1]], ['A'])).toThrow(RangeError)
    expect(() => multipleLinearRegression([1], [[1, 2]], ['A'])).toThrow(RangeError)
    expect(() => multipleLinearRegression([1], [[1]], ['A'], { interactions: [[0, 1]] })).toThrow(
      RangeError,
    )
  })
})
