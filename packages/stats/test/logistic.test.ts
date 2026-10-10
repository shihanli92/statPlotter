import { describe, expect, it } from 'vitest'
import { hosmerLemeshow, logisticRegression, rocCurve } from '../src/index.ts'
import { aucHanleyMcNeil } from '../src/regression/logistic.ts'
import { expectDeepClose } from './deep.ts'
import { loadFixtures } from './oracle.ts'
import { minstd } from './rng.ts'

interface Input {
  y: number[]
  X: number[][]
  names: string[]
}

interface Params {
  intercept?: boolean
  confLevel?: number
  ciMethod?: 'wald' | 'profile'
  cutoff?: number
  interactions?: [number, number][]
}

/**
 * Iterative fits: both sides converge to working precision (glm epsilon 1e-14 and restarted from
 * its estimates so vcov is at the maximum; our Newton steps to 1e-10 relative, then one more), and
 * profile limits are solved to 1e-13. Agreement is ≤ 1e-10 today; the documented tolerance is
 * 1e-9 relative (atol 1e-12 for fitted probabilities near 0).
 */
const TOL = { rtol: 1e-9, atol: 1e-12 }

describe('logistic regression vs R', () => {
  for (const f of loadFixtures<Input>('logistic')) {
    it(f.name, () => {
      const fit = logisticRegression(f.input.y, f.input.X, f.input.names, f.params as Params)
      expectDeepClose(fit, f.expected, { ...TOL, ...f.tol })
    })
  }
})

describe('logistic regression details', () => {
  it('Hanley–McNeil SE reproduces the paper (Radiology 1982, Table II)', () => {
    // Ratings 1..5: normals 33, 6, 6, 11, 2; abnormals 3, 2, 2, 11, 33.
    const y: number[] = []
    const s: number[] = []
    const add = (counts: number[], label: number) => {
      counts.forEach((c, k) => {
        for (let i = 0; i < c; i++) {
          y.push(label)
          s.push(k + 1)
        }
      })
    }
    add([33, 6, 6, 11, 2], 0)
    add([3, 2, 2, 11, 33], 1)
    const r = aucHanleyMcNeil(y, s)
    expect(r.value).toBeCloseTo(0.893, 3)
    expect(r.se).toBeCloseTo(0.032, 3)
    // Their totals: W = 2642 / (58·51); SE from Q1 = 0.8182, Q2 = 0.8313.
    expect(r.value).toBeCloseTo(2642 / (58 * 51), 12)
  })

  it('Hanley–McNeil AUC near perfect separation: finite SE ≥ 0, P ≤ 1, as the ROC curve', () => {
    const neg = [0.02, 0.05, 0.11, 0.18, 0.2, 0.31, 0.4, 0.52]
    const cases: [number[], number[]][] = [
      [neg, [0.6, 0.71, 0.8, 0.93, 0.97]], // perfect separation
      [neg, [0.52, 0.71, 0.8, 0.93, 0.97]], // one tie at the boundary
      [neg, [0.4, 0.71, 0.8, 0.93, 0.97]], // one overlap
      [
        [1, 2, 3],
        [1, 2, 3],
      ], // no discrimination
    ]
    for (const [controls, patients] of cases) {
      const y = [...controls.map(() => 0), ...patients.map(() => 1)]
      const r = aucHanleyMcNeil(y, [...controls, ...patients])
      const roc = rocCurve(controls, patients, { direction: 'higher' })
      expect(r.se).toBeGreaterThanOrEqual(0)
      expect(r.se).toBeCloseTo(roc.se, 14)
      expect(r.value).toBe(roc.auc)
      expect(r.p).toBeLessThanOrEqual(1)
      expect(r.p).toBeCloseTo(roc.p, 14)
      expect(r.upper).toBeLessThanOrEqual(1)
    }
    const perfect = aucHanleyMcNeil([0, 0, 1, 1], [1, 2, 3, 4])
    expect([perfect.value, perfect.se, perfect.lower, perfect.upper]).toEqual([1, 0, 1, 1])
  })

  it('Hosmer–Lemeshow uses equal-size groups in sorted order', () => {
    const p = Array.from({ length: 20 }, (_, i) => (i + 0.5) / 20)
    const y = p.map((v, i) => (i % 3 === 0 ? 1 : v > 0.5 ? 1 : 0))
    const hl = hosmerLemeshow(y, p)!
    expect(hl.df).toBe(8)
    let chi = 0
    for (let g = 0; g < 10; g++) {
      const o1 = y[2 * g]! + y[2 * g + 1]!
      const e1 = p[2 * g]! + p[2 * g + 1]!
      chi += (o1 - e1) ** 2 / e1 + (o1 - e1) ** 2 / (2 - e1)
    }
    expect(hl.chiSq).toBeCloseTo(chi, 12)
    expect(hosmerLemeshow([0, 1], [0.2, 0.8])).toBeNull()
  })

  it('profile and Wald intervals agree for a large sample', () => {
    const n = 2000
    const X: number[][] = []
    const y: number[] = []
    const rnd = minstd(7)
    for (let i = 0; i < n; i++) {
      const x = rnd() * 4 - 2
      X.push([x])
      y.push(rnd() < 1 / (1 + Math.exp(-(0.3 + 0.8 * x))) ? 1 : 0)
    }
    const pr = logisticRegression(y, X, ['X'])
    const wa = logisticRegression(y, X, ['X'], { ciMethod: 'wald' })
    const c = pr.coefficients[1]!
    const w = wa.coefficients[1]!
    expect(c.estimate).toBe(w.estimate)
    expect(Math.abs(c.lower - w.lower) / c.se).toBeLessThan(0.05)
    expect(Math.abs(c.upper - w.upper) / c.se).toBeLessThan(0.05)
    expect(c.oddsRatio).toBeCloseTo(Math.exp(c.estimate), 14)
  })

  it('never throws on degenerate data', () => {
    const none = logisticRegression([0, 0, 0, 0], [[1], [2], [3], [4]], ['X'])
    expect(none.status).toBe('separation')
    expect(none.nEvents).toBe(0)
    expect(none.auc.value).toBeNaN()
    const quasi = logisticRegression(
      [0, 0, 0, 1, 0, 1, 1, 1],
      [[1], [2], [3], [4], [4], [5], [6], [7]],
      ['X'],
    )
    expect(quasi.status).toBe('separation')
    expect(quasi.coefficients[1]!.estimate).toBeNaN()
    const empty = logisticRegression([], [], ['X'])
    expect(empty.n).toBe(0)
  })

  it('throws for invalid input', () => {
    expect(() => logisticRegression([0, 2], [[1], [2]], ['X'])).toThrow(RangeError)
    expect(() => logisticRegression([0, 1], [[1]], ['X'])).toThrow(RangeError)
  })
})
