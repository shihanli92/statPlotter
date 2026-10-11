import { describe, expect, it } from 'vitest'
import {
  compareLinear,
  leastSquares,
  linearBand,
  linearRegression,
  polynomialRegression,
  symmetricInverse,
} from '../src/index.ts'
import { expectClose, loadFixtures, lre, type Tolerance } from './oracle.ts'

type Num = number | number[]

function compareAll(
  got: Record<string, unknown>,
  expected: Record<string, unknown>,
  tol: Partial<Tolerance> | undefined,
  prefix = '',
): void {
  for (const [k, e] of Object.entries(expected)) {
    const g = got[k]
    const label = `${prefix}${k}`
    expect(g, label).toBeDefined()
    if (e === null) {
      expect(g, label).toBeNull()
    } else if (typeof e === 'number') {
      expectClose(g as number, e, tol, label)
    } else if (Array.isArray(e)) {
      const ga = Array.from(g as ArrayLike<number>)
      expect(ga.length, label).toBe(e.length)
      e.forEach((v, i) => {
        expectClose(ga[i]!, v as number, tol, `${label}[${i}]`)
      })
    } else {
      compareAll(g as Record<string, unknown>, e as Record<string, unknown>, tol, `${label}.`)
    }
  }
}

interface LinearIn {
  x: number[]
  y: number[]
  weights?: number[]
  bandX?: number[]
}

describe('linear regression vs R', () => {
  for (const f of loadFixtures<LinearIn, Record<string, Num | Record<string, number[]>>>(
    'linear',
  )) {
    it(f.name, () => {
      const p = f.params as {
        throughOrigin?: boolean
        throughPoint?: [number, number]
        confLevel?: number
      }
      const fit = linearRegression(f.input.x, f.input.y, {
        throughOrigin: p.throughOrigin,
        ...(p.throughPoint ? { throughPoint: { x: p.throughPoint[0], y: p.throughPoint[1] } } : {}),
        weights: f.input.weights,
        confLevel: p.confLevel,
      })
      const { band, ...scalars } = f.expected
      compareAll({ ...fit }, scalars, f.tol)
      if (band) {
        const b = band as Record<string, number[]>
        const conf = linearBand(fit, f.input.bandX!)
        const pred = linearBand(fit, f.input.bandX!, { kind: 'prediction' })
        compareAll(
          { y: conf.y, confLo: conf.lo, confHi: conf.hi, predLo: pred.lo, predHi: pred.hi },
          b,
          f.tol,
          'band.',
        )
      }
    })
  }
})

describe('compare linear regressions vs R', () => {
  for (const f of loadFixtures<{ datasets: { x: number[]; y: number[] }[] }>('compare_linear')) {
    it(f.name, () => {
      compareAll({ ...compareLinear(f.input.datasets) }, f.expected, f.tol)
    })
  }
})

describe('polynomial regression vs R', () => {
  for (const f of loadFixtures<LinearIn & { degree: number }>('polynomial')) {
    it(f.name, () => {
      const p = f.params as { confLevel?: number }
      const fit = polynomialRegression(f.input.x, f.input.y, f.input.degree, {
        weights: f.input.weights,
        confLevel: p.confLevel,
      })
      compareAll({ ...fit }, f.expected, f.tol)
    })
  }
})

describe('linear regression invariants and edge cases', () => {
  it('matches polynomialRegression of degree 1 and leastSquares', () => {
    const x = [1, 2, 3, 5, 8, 13]
    const y = [2.1, 3.9, 6.2, 9.8, 16.5, 25.1]
    const a = linearRegression(x, y)
    const b = polynomialRegression(x, y, 1)
    const X = new Float64Array(x.flatMap((v) => [1, v]))
    const c = leastSquares(X, 6, 2, y)
    expectClose(b.coef[0]!, a.intercept, { rtol: 1e-13 }, 'intercept')
    expectClose(b.coef[1]!, a.slope, { rtol: 1e-13 }, 'slope')
    expectClose(c.coef[1]!, a.slope, { rtol: 1e-13 }, 'slope (QR)')
    expectClose(b.se[1]!, a.slopeSE, { rtol: 1e-12 }, 'slopeSE')
    expectClose(c.rss, a.ssResidual, { rtol: 1e-12 }, 'rss')
    const s2 = a.ssResidual / a.df
    expectClose(s2 * c.covUnscaled[3]!, a.cov[0], { rtol: 1e-12 }, 'var(slope)')
  })

  it('the Fieller interval brackets the X intercept', () => {
    const x = [0, 1, 2, 3, 4, 5, 6]
    const y = [-2.9, -2.1, -0.8, 0.2, 1.1, 1.9, 3.2]
    const fit = linearRegression(x, y)
    expect(fit.xInterceptLo).toBeLessThan(fit.xIntercept)
    expect(fit.xInterceptHi).toBeGreaterThan(fit.xIntercept)
  })

  it('the band is narrowest at the mean of X, and the prediction band is wider', () => {
    const x = [1, 2, 3, 4, 5]
    const fit = linearRegression(x, [1.2, 1.9, 3.2, 3.8, 5.1])
    const c = linearBand(fit, [1, 3, 5])
    const p = linearBand(fit, [3], { kind: 'prediction' })
    expect(c.hi[1]! - c.lo[1]!).toBeLessThan(c.hi[0]! - c.lo[0]!)
    expect(p.hi[0]! - p.lo[0]!).toBeGreaterThan(c.hi[1]! - c.lo[1]!)
  })

  it('degenerate inputs give NaN, not throws', () => {
    const two = linearRegression([1, 2], [3, 5])
    expect(two.slope).toBeCloseTo(2, 14)
    expect(two.df).toBe(0)
    expect(two.slopeSE).toBeNaN()
    const flatX = linearRegression([2, 2, 2], [1, 2, 3])
    expect(flatX.slope).toBeNaN()
    expect(() => linearRegression([1, 2], [1])).toThrow(RangeError)
  })

  it('perfect fit: zero SS, infinite F, P = 0', () => {
    const fit = linearRegression([1, 2, 3, 4], [3, 5, 7, 9])
    expect(fit.ssResidual).toBe(0)
    expect(fit.r2).toBe(1)
    expect(fit.F).toBe(Number.POSITIVE_INFINITY)
    expect(fit.p).toBe(0)
  })
})

describe('linear algebra', () => {
  it('leastSquares flags a rank-deficient design and returns NaN for the aliased column', () => {
    // Third column = first + second.
    const X = new Float64Array([1, 0, 1, 1, 1, 2, 1, 2, 3, 1, 3, 4, 1, 4, 5])
    const r = leastSquares(X, 5, 3, [1, 2, 2.9, 4.2, 5])
    expect(r.rank).toBe(2)
    expect(r.coef.filter(Number.isNaN).length).toBe(1)
  })

  it('symmetricInverse inverts SPD matrices and rejects indefinite ones', () => {
    const S = [4, 2, 0.6, 2, 5, 1.5, 0.6, 1.5, 3]
    const inv = symmetricInverse(S, 3)!
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let s = 0
        for (let k = 0; k < 3; k++) s += S[i * 3 + k]! * inv[k * 3 + j]!
        expect(s).toBeCloseTo(i === j ? 1 : 0, 14)
      }
    }
    expect(symmetricInverse([1, 2, 2, 1], 2)).toBeNull()
  })
})

// ---- NIST StRD linear least squares ----------------------------------------------------------

interface NistLinIn {
  y: number[]
  x?: number[]
  xs?: number[][]
}
interface NistLinExp {
  n: number
  coef: number[]
  se: number[]
  residualSD: number
  r2: number
  ssResidual: number
}

/**
 * Minimum LRE (correct significant digits) per dataset for coefficients, SEs, residual SD.
 * Certified values have 15 digits. Wampler1/2 are exact fits (certified SEs 0; LRE then counts
 * absolute digits). Wampler5's coefficients are limited by the κ²·‖r‖ term of a large-residual
 * least-squares problem (Björck §2.9); the achieved 8.2 is typical of QR solvers.
 */
const MIN_LRE: Record<string, { coef: number; se: number; sd: number }> = {
  Norris: { coef: 13, se: 13, sd: 13 },
  Pontius: { coef: 13, se: 12, sd: 12 },
  NoInt1: { coef: 14, se: 14, sd: 14 },
  NoInt2: { coef: 14, se: 14, sd: 14 },
  Filip: { coef: 12, se: 13, sd: 13 },
  Longley: { coef: 11, se: 12, sd: 12 },
  Wampler1: { coef: 10, se: 10, sd: 10 },
  Wampler2: { coef: 12, se: 14, sd: 15 },
  Wampler3: { coef: 10, se: 13, sd: 13 },
  Wampler4: { coef: 9.5, se: 13, sd: 13 },
  Wampler5: { coef: 8, se: 13, sd: 13 },
}

describe('linear regression vs NIST StRD', () => {
  for (const f of loadFixtures<NistLinIn, NistLinExp>('nist/linear')) {
    const min = MIN_LRE[f.name]!
    it(`${f.name} (LRE coef ≥ ${min.coef}, SE ≥ ${min.se}, s ≥ ${min.sd})`, () => {
      const p = f.params as { intercept: boolean; degree: number }
      const e = f.expected
      const n = f.input.y.length
      expect(n).toBe(e.n)
      let coef: ArrayLike<number>
      let se: ArrayLike<number>
      let sd: number
      let r2: number
      if (f.input.xs) {
        // Longley: multiple regression through leastSquares.
        const k = f.input.xs.length + 1
        const X = new Float64Array(n * k)
        for (let i = 0; i < n; i++) {
          X[i * k] = 1
          for (let j = 1; j < k; j++) X[i * k + j] = f.input.xs[j - 1]![i]!
        }
        const r = leastSquares(X, n, k, f.input.y)
        expect(r.rank).toBe(k)
        const s2 = r.rss / (n - k)
        coef = r.coef
        se = Array.from({ length: k }, (_, j) => Math.sqrt(s2 * r.covUnscaled[j * k + j]!))
        sd = Math.sqrt(s2)
        const my = f.input.y.reduce((a, b) => a + b) / n
        r2 = 1 - r.rss / f.input.y.reduce((a, v) => a + (v - my) ** 2, 0)
      } else if (p.degree === 1) {
        const r = linearRegression(f.input.x!, f.input.y, { throughOrigin: !p.intercept })
        coef = p.intercept ? [r.intercept, r.slope] : [r.slope]
        se = p.intercept ? [r.interceptSE, r.slopeSE] : [r.slopeSE]
        sd = r.syx
        // NIST's R² through the origin is the uncentred 1 − SS/Σy²; ours is centred.
        r2 = p.intercept ? r.r2 : 1 - r.ssResidual / f.input.y.reduce((a, v) => a + v * v, 0)
      } else {
        const r = polynomialRegression(f.input.x!, f.input.y, p.degree)
        coef = r.coef
        se = r.se
        sd = r.syx
        r2 = r.r2
      }
      e.coef.forEach((v, j) => {
        expect(lre(coef[j]!, v), `B${j}: ${coef[j]} vs ${v}`).toBeGreaterThanOrEqual(min.coef)
      })
      e.se.forEach((v, j) => {
        expect(lre(se[j]!, v), `SE B${j}: ${se[j]} vs ${v}`).toBeGreaterThanOrEqual(min.se)
      })
      expect(lre(sd, e.residualSD)).toBeGreaterThanOrEqual(min.sd)
      expect(lre(r2, e.r2)).toBeGreaterThanOrEqual(Math.min(min.sd, 12))
    })
  }
})
