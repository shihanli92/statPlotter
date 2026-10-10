import { describe, expect, it } from 'vitest'
import {
  aiccLeastSquares,
  type CurveModel,
  compareFits,
  curveBand,
  equation,
  type FitOptions,
  nonlinearFit,
  type ParamConstraint,
} from '../src/index.ts'
import { nistData, nistModel } from './nistModels.ts'
import { checkFit, type FitExpected } from './nls.ts'
import { expectClose, loadFixtures, lre } from './oracle.ts'

// ---- R oracle ------------------------------------------------------------------------------

interface NlIn {
  data: { x: number[]; y: number[] }[]
  bandX?: number[]
}
interface NlParams {
  equation: string
  constraints?: ParamConstraint[]
  bounds?: ([number, number] | null)[]
  weighting?: FitOptions['weighting']
  confLevel?: number
  profileCI?: boolean
  compare?: { equation: string; constraints?: ParamConstraint[]; bounds?: FitOptions['bounds'] }
}
interface NlExpected extends FitExpected {
  band?: Record<string, number[]>
  compare?: Record<string, number>
}

function fitOptions(p: NlParams): FitOptions {
  const o: FitOptions = {}
  if (p.constraints) o.constraints = p.constraints
  if (p.bounds) o.bounds = p.bounds
  if (p.weighting) o.weighting = p.weighting
  if (p.confLevel) o.confLevel = p.confLevel
  if (p.profileCI) o.profileCI = p.profileCI
  return o
}

describe('nonlinear regression vs R (nls), from automatic initial values', () => {
  for (const f of loadFixtures<NlIn, NlExpected>('nonlinear')) {
    it(f.name, () => {
      const p = f.params as unknown as NlParams
      const e = f.expected
      const model = equation(p.equation)!
      const fit = nonlinearFit(model, f.input.data, fitOptions(p))
      checkFit(model, fit, e, f.tol, { atBound: true })
      if (e.band) {
        const xs = f.input.bandX!
        const c = curveBand(model, fit, 0, xs)
        const pr = curveBand(model, fit, 0, xs, { kind: 'prediction' })
        const got = { y: c.y, confLo: c.lo, confHi: c.hi, predLo: pr.lo, predHi: pr.hi }
        // Band limits are ŷ ± h, so compare on the scale of the curve: a limit near 0 is a
        // difference of O(ŷ) terms and only has absolute accuracy.
        const scale = Math.max(...e.band.y!.map(Math.abs))
        const rtol = f.tol?.rtol ?? 1e-10
        for (const [key, v] of Object.entries(e.band)) {
          v.forEach((x, i) => {
            const tol = { rtol, atol: rtol * scale }
            expectClose(got[key as keyof typeof got][i]!, x, tol, `band.${key}[${i}]`)
          })
        }
      }
      if (e.compare) {
        const cp = p.compare!
        const simpler = nonlinearFit(equation(cp.equation)!, f.input.data, {
          ...fitOptions(p),
          constraints: cp.constraints,
          bounds: cp.bounds,
        })
        expect(simpler.status).toBe('converged')
        const cmp = compareFits(simpler, fit)
        for (const [key, v] of Object.entries(e.compare)) {
          expectClose(cmp[key as keyof typeof cmp], v, f.tol, `compare.${key}`)
        }
      }
    })
  }
})

// ---- NIST StRD nonlinear regression -----------------------------------------------------------

interface NistNlExp {
  n: number
  params: number[]
  se: number[]
  ssResidual: number
  residualSD: number
  df: number
}

/**
 * Minimum LRE from start 2 (certified values have 11 significant digits). Lanczos1 is a
 * zero-residual problem (SS = 1.4e-25): its residuals are below double-precision rounding of
 * the model values, so SS and the SEs (∝ √SS) keep only ~3 digits — a limit of evaluating the
 * model in double, not of the solver.
 */
const DEFAULT_LRE = { params: 9, se: 9, ss: 9.5 }
const MIN_LRE: Record<string, { params: number; se: number; ss: number }> = {
  Lanczos1: { params: 10, se: 2.5, ss: 2.5 },
  // Above the default for SS (audit 3, S7): a near-zero-residual fit (SS = 1.6e-8) whose SS is
  // still reached to 10.6 digits, so it is held there.
  Lanczos3: { params: 9, se: 9, ss: 10 },
  // Ill-conditioned (b2 and b3 nearly confounded; start 1 fails): its SS is held above the
  // default as reached (11.5 digits); params and SE at the default (8.5 until audit 3, S7: the
  // fit reaches 10.9 and 11.1).
  MGH10: { params: 9, se: 9, ss: 10 },
}

/** Datasets whose fit from NIST's start 1 does not reach the certified solution. */
const START1_FAILS: Record<string, string> = {
  MGH10: 'maxIterations',
  BoxBOD: 'converges to a spurious stationary point (b2 → ∞, flat model)',
}

describe('nonlinear regression vs NIST StRD', () => {
  for (const f of loadFixtures<Record<string, number[]>, NistNlExp>('nist/nonlinear')) {
    const e = f.expected
    const starts = f.params as unknown as { start1: number[]; start2: number[] }
    const model: CurveModel = nistModel(f.name, f.input)
    const data = [nistData(f.name, f.input)]
    const min = MIN_LRE[f.name] ?? DEFAULT_LRE

    it(`${f.name}, start 2 (LRE params ≥ ${min.params}, SE ≥ ${min.se}, SS ≥ ${min.ss})`, () => {
      const fit = nonlinearFit(model, data, { initial: [starts.start2] })
      expect(fit.status, fit.message).toBe('converged')
      expect(fit.n).toBe(e.n)
      // NIST's Rat43 file states 9 df, a typo: 15 − 4 = 11, which its certified residual SD
      // (√(SS/11)) confirms.
      expect(fit.df).toBe(e.n - e.params.length)
      const est = fit.params[0]!
      e.params.forEach((v, j) => {
        expect(lre(est[j]!.value, v), `b${j + 1}: ${est[j]!.value} vs ${v}`).toBeGreaterThanOrEqual(
          min.params,
        )
        expect(lre(est[j]!.se, e.se[j]!), `SE b${j + 1}`).toBeGreaterThanOrEqual(min.se)
      })
      expect(lre(fit.ss, e.ssResidual)).toBeGreaterThanOrEqual(min.ss)
      expect(lre(fit.perDataSet[0]!.syx, e.residualSD)).toBeGreaterThanOrEqual(min.ss - 0.5)
    })

    it(`${f.name}, start 1`, () => {
      const fit = nonlinearFit(model, data, { initial: [starts.start1] })
      const ok =
        fit.status === 'converged' &&
        Math.min(...e.params.map((v, j) => lre(fit.params[0]![j]!.value, v))) >= 6
      expect(ok, `${fit.status}: ${fit.params[0]!.map((q) => q.value)}`).toBe(
        !(f.name in START1_FAILS),
      )
    })
  }
})

// ---- behaviour -------------------------------------------------------------------------------

const hill = equation('agonist-response-variable-slope')!
const mm = equation('michaelis-menten')!
const X = [-9, -8.5, -8, -7.5, -7, -6.5, -6, -5.5, -5, -4.5, -4]
const Y = [4.1, 6.2, 9.8, 18.5, 33.9, 51.2, 70.3, 83.1, 90.8, 94.2, 95.9]

describe('nonlinear fit behaviour', () => {
  it('fits a clean curve and reports Prism-style summaries', () => {
    const fit = nonlinearFit(hill, [{ x: X, y: Y }])
    expect(fit.status).toBe('converged')
    expect(fit.nParams).toBe(4)
    expect(fit.df).toBe(7)
    expect(fit.aicc).toBeCloseTo(aiccLeastSquares(11, fit.ss, 4), 12)
    expect(fit.perDataSet[0]!.r2).toBeGreaterThan(0.99)
    expect(fit.freeIndex).toEqual([[0, 1, 2, 3]])
    expect(fit.cov.length).toBe(16)
  })

  it('a constant parameter is excluded from the covariance and keeps its value', () => {
    const fit = nonlinearFit(hill, [{ x: X, y: Y }], {
      constraints: [{ kind: 'constant', value: 0 }],
    })
    expect(fit.params[0]![0]).toMatchObject({ value: 0, status: 'constant' })
    expect(fit.params[0]![0]!.se).toBeNaN()
    expect(fit.freeIndex[0]![0]).toBe(-1)
    expect(fit.nParams).toBe(3)
  })

  it('independent data sets fit as separately; sharing a parameter pools s²', () => {
    const d2 = { x: X, y: Y.map((v, i) => v * 0.9 + (i % 2 ? 0.7 : -0.7)) }
    const both = nonlinearFit(hill, [{ x: X, y: Y }, d2])
    const one = nonlinearFit(hill, [{ x: X, y: Y }])
    const two = nonlinearFit(hill, [d2])
    expectClose(both.params[0]![2]!.value, one.params[0]![2]!.value, { rtol: 1e-9 }, 'LogEC50 1')
    expectClose(both.params[1]![2]!.se, two.params[0]![2]!.se, { rtol: 1e-7 }, 'SE 2')
    expectClose(both.ss, one.ss + two.ss, { rtol: 1e-9 }, 'SS')
    expect(both.df).toBe(one.df + two.df)
    const shared = nonlinearFit(hill, [{ x: X, y: Y }, d2], {
      constraints: [{ kind: 'fit' }, { kind: 'fit' }, { kind: 'fit' }, { kind: 'shared' }],
    })
    expect(shared.params[0]![3]).toEqual(shared.params[1]![3])
    expect(shared.params[0]![3]!.status).toBe('shared')
    expect(shared.freeIndex[0]![3]).toBe(shared.freeIndex[1]![3])
    expect(shared.nParams).toBe(7)
    const cmp = compareFits(shared, both)
    expect(cmp.dfn).toBe(1)
    expect(cmp.probSimpler).toBeGreaterThan(0)
    expect(cmp.probSimpler).toBeLessThan(1)
  })

  it('profile CIs are asymmetric and contain the estimate', () => {
    const x = [0.5, 1, 2, 4, 8, 16, 32]
    const y = [9.1, 16.4, 25.8, 33.1, 42.2, 45.0, 48.9]
    const fit = nonlinearFit(mm, [{ x, y }], { profileCI: true })
    const sym = nonlinearFit(mm, [{ x, y }])
    for (let j = 0; j < 2; j++) {
      const pe = fit.params[0]![j]!
      expect(pe.lo).toBeLessThan(pe.value)
      expect(pe.hi).toBeGreaterThan(pe.value)
      expect(pe.hi - pe.value).not.toBeCloseTo(pe.value - pe.lo, 6)
      expect(sym.params[0]![j]!.hi - sym.params[0]![j]!.value).toBeCloseTo(
        sym.params[0]![j]!.value - sym.params[0]![j]!.lo,
        10,
      )
    }
  })

  it('a bound that is hit fixes the parameter there', () => {
    const y = Y.map((v) => v - 8)
    const fit = nonlinearFit(hill, [{ x: X, y }], { bounds: [[0, Number.POSITIVE_INFINITY]] })
    expect(fit.status).toBe('converged')
    expect(fit.params[0]![0]).toMatchObject({ value: 0, atBound: true })
    expect(fit.params[0]![0]!.se).toBeNaN()
    expect(fit.nParams).toBe(3)
    expect(fit.message).toMatch(/Bottom/)
  })

  it('reports invalid, singular and maxIterations rather than throwing', () => {
    const bad = nonlinearFit(mm, [{ x: [1, 2, 3], y: [1, 2, 3] }], { initial: [[1, -2]] })
    expect(bad.status).toBe('invalid')
    expect(bad.message).toBeTruthy()
    const few = nonlinearFit(hill, [{ x: [1, 2, 3], y: [1, 2, 3] }])
    expect(few.status).toBe('invalid')
    // A redundant parameterisation: Y = A·B·X.
    const redundant: CurveModel = {
      id: 'ab',
      params: ['A', 'B'],
      f: (x, p) => p[0]! * p[1]! * x,
      initial: () => [1, 1],
    }
    const sing = nonlinearFit(redundant, [{ x: [1, 2, 3, 4], y: [2.1, 3.9, 6.2, 7.9] }])
    expect(sing.status).toBe('singular')
    expect(sing.params[0]![0]!.se).toBeNaN()
    const slow = nonlinearFit(hill, [{ x: X, y: Y }], { maxIterations: 2 })
    expect(slow.status).toBe('maxIterations')
  })

  it('numeric derivatives agree with analytic ones', () => {
    const { grad: _g, ...numeric } = hill
    const a = nonlinearFit(hill, [{ x: X, y: Y }])
    const b = nonlinearFit(numeric as CurveModel, [{ x: X, y: Y }])
    a.params[0]!.forEach((pe, j) => {
      expectClose(b.params[0]![j]!.value, pe.value, { rtol: 1e-8 }, 'value')
      expectClose(b.params[0]![j]!.se, pe.se, { rtol: 1e-6 }, 'se')
    })
  })

  it('bands: prediction wider than confidence; both collapse onto the curve', () => {
    const fit = nonlinearFit(hill, [{ x: X, y: Y }])
    const c = curveBand(hill, fit, 0, [-8, -6.5, -5])
    const p = curveBand(hill, fit, 0, [-8, -6.5, -5], { kind: 'prediction' })
    for (let i = 0; i < 3; i++) {
      expect(c.lo[i]!).toBeLessThan(c.y[i]!)
      expect(p.lo[i]!).toBeLessThan(c.lo[i]!)
      expect(p.y[i]).toBe(c.y[i])
    }
  })
})
