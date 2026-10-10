import { describe, expect, it } from 'vitest'
import { demingRegression, linearRegression, poissonRegression } from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { loadFixtures } from './oracle.ts'

describe('Deming regression vs R', () => {
  for (const f of loadFixtures<{ x: number[]; y: number[] }>('deming')) {
    it(f.name, () => {
      const p = f.params as { lambda?: number; confLevel?: number; xForY?: number }
      expectDeepClose(demingRegression(f.input.x, f.input.y, p), f.expected, f.tol, f.name)
    })
  }
})

describe('Deming regression invariants', () => {
  const x = [1, 2, 3, 4, 5, 6, 7, 8]
  const y = [1.2, 1.9, 3.3, 3.8, 5.4, 5.8, 7.1, 8.3]
  it('approaches ordinary regression as the X error vanishes', () => {
    const d = demingRegression(x, y, { lambda: 1e-12 })
    const l = linearRegression(x, y)
    expect(d.slope).toBeCloseTo(l.slope, 9)
    expect(d.intercept).toBeCloseTo(l.intercept, 9)
  })
  it('swapping X and Y inverts the orthogonal line', () => {
    const a = demingRegression(x, y)
    const b = demingRegression(y, x)
    expect(a.slope * b.slope).toBeCloseTo(1, 12)
  })
  it('rejects a non-positive λ', () => {
    expect(() => demingRegression(x, y, { lambda: 0 })).toThrow(/λ/)
  })
})

describe('Poisson regression vs R', () => {
  for (const f of loadFixtures<{ y: number[]; X: number[][]; names: string[] }>('poisson')) {
    it(f.name, () => {
      const p = f.params as {
        intercept?: boolean
        confLevel?: number
        ciMethod?: 'wald' | 'profile'
      }
      const X = f.input.X.map((r) => (Array.isArray(r) ? r : [r]))
      const res = poissonRegression(f.input.y, X, f.input.names, p)
      expect(res.status).toBe('ok')
      expectDeepClose(res, f.expected, f.tol, f.name)
    })
  }
})

describe('Poisson regression invariants', () => {
  it('reports aliased predictors as singular', () => {
    const res = poissonRegression(
      [1, 3, 2, 5, 4, 6],
      [
        [1, 2],
        [2, 4],
        [3, 6],
        [4, 8],
        [5, 10],
        [6, 12],
      ],
      ['A', 'B'],
    )
    expect(res.status).toBe('singular')
    expect(res.coefficients[2]!.estimate).toBeNaN()
    expect(Number.isFinite(res.coefficients[1]!.estimate)).toBe(true)
  })
  it('rejects non-count outcomes', () => {
    expect(() => poissonRegression([1.5, 2], [[1], [2]], ['A'])).toThrow(/counts/)
  })
})
