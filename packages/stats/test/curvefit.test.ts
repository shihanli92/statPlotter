import { describe, expect, it } from 'vitest'
import {
  type CurveModel,
  correlationMatrix,
  curveBand,
  dependency,
  equation,
  type FitOptions,
  fitResiduals,
  fittedCurve,
  fittedLine,
  hougaardSkewness,
  interpolateX,
  interpolateY,
  linearRegression,
  nonlinearFit,
  parseEquation,
  replicatesTest,
  routCurve,
  runsTest,
  userCurveModel,
} from '../src/index.ts'
import { checkFit, constraintsOf, type FitExpected, type RawConstraint } from './nls.ts'
import { arr, expectClose, loadFixtures } from './oracle.ts'

// Phase 14 R oracle (tools/oracle/r/curvefit.R): new built-in equations, user-defined equations,
// interpolation, diagnostics and ROUT for curves. Fits start from our automatic initial values
// (user equations: the case's `initial`), R's from the simulation's true parameters.

interface In {
  data: { x: number[]; y: number[] }[]
  bandX?: number[]
  interpolate?: { y: number[]; x: number[] }
}
interface Params {
  task?: 'fit' | 'rout' | 'linear'
  equation: string
  constraints?: RawConstraint[]
  weighting?: FitOptions['weighting']
  confLevel?: number
  text?: string
  /** User equations: R's parameter order (ours is the order of first appearance). */
  params?: string[]
  initial?: number[]
  q?: number
}
interface CurveExpected extends FitExpected {
  band?: Record<string, number[]>
  interp?: {
    x: { x: number; lo: number; hi: number; extrapolated: boolean }[]
    y: { y: number; lo: number; hi: number }[]
  }
  diagnostics?: {
    residuals: number[][]
    runs: { runs: number; nAbove: number; nBelow: number; p: number }[]
    replicates: Record<string, number> | null
    correlation: number[][]
    dependency: number[]
    hougaard: number[]
  }
}

/** Position in R's parameter order of each of the model's parameters. */
function rOrder(model: CurveModel, p: Params): number[] {
  return model.params.map((n, j) => (p.params ? p.params.indexOf(n) : j))
}

function modelOf(p: Params): CurveModel {
  if (p.equation !== 'user') return equation(p.equation)!
  const r = parseEquation(p.text!)
  if (!r.ok) throw new Error(r.message)
  return userCurveModel(r.program, () => r.parameters.map((n) => p.initial![p.params!.indexOf(n)]!))
}

function optionsOf(p: Params): FitOptions {
  const o: FitOptions = {}
  const c = constraintsOf(p.constraints)
  if (c) o.constraints = c
  if (p.weighting) o.weighting = p.weighting
  if (p.confLevel) o.confLevel = p.confLevel
  return o
}

describe('curve fitting for lab assays vs R (nls)', () => {
  for (const f of loadFixtures<In, CurveExpected>('curvefit')) {
    const p = f.params as unknown as Params
    if (p.task === 'rout' || p.task === 'linear') continue
    it(f.name, () => {
      const e = f.expected
      const model = modelOf(p)
      const data = f.input.data
      const fit = nonlinearFit(model, data, optionsOf(p))
      checkFit(model, fit, e, f.tol, { order: rOrder(model, p), atBound: true })
      const rtol = f.tol?.rtol ?? 1e-10
      if (e.band) {
        const xs = f.input.bandX!
        const c = curveBand(model, fit, 0, xs)
        const pr = curveBand(model, fit, 0, xs, { kind: 'prediction' })
        const got = { y: c.y, confLo: c.lo, confHi: c.hi, predLo: pr.lo, predHi: pr.hi }
        const scale = Math.max(...e.band.y!.map(Math.abs))
        for (const [key, v] of Object.entries(e.band))
          v.forEach((x, i) => {
            expectClose(got[key as keyof typeof got][i]!, x, { rtol, atol: rtol * scale }, key)
          })
      }
      if (e.interp) {
        const curve = fittedCurve(model, fit, 0)
        const xs = data[0]!.x
        const [lo, hi] = [Math.min(...xs), Math.max(...xs)]
        // Interpolated X: the root and band crossings are refined to machine precision, but
        // they inherit the fit's own accuracy through a slope (1e-9 relative here).
        const itol = { rtol: 1e-9, atol: 1e-9 }
        arr(f.input.interpolate!.y).forEach((y, i) => {
          const got = interpolateX(curve, y, lo, hi)
          const want = e.interp!.x[i]!
          expectClose(got.x, want.x, itol, `X at Y = ${y}`)
          expectClose(got.lo, want.lo, itol, `X lo at Y = ${y}`)
          expectClose(got.hi, want.hi, itol, `X hi at Y = ${y}`)
          if (!Number.isNaN(want.x)) expect(got.extrapolated, `Y = ${y}`).toBe(want.extrapolated)
        })
        arr(f.input.interpolate!.x).forEach((x, i) => {
          const got = interpolateY(curve, x, lo, hi)
          const want = e.interp!.y[i]!
          expectClose(got.y, want.y, { rtol }, `Y at X = ${x}`)
          expectClose(got.lo, want.lo, { rtol }, `Y lo at X = ${x}`)
          expectClose(got.hi, want.hi, { rtol }, `Y hi at X = ${x}`)
        })
      }
      const dg = e.diagnostics
      if (dg) {
        data.forEach((d, k) => {
          const r = fitResiduals(model, fit, d, k)
          const scale = Math.max(...d.y.map(Math.abs))
          dg.residuals[k]!.forEach((v, i) => {
            expectClose(r[i]!, v, { rtol, atol: rtol * scale }, `residual ${i}`)
          })
          const want = dg.runs[k]
          if (want) {
            const order = d.x.map((_, i) => i).sort((a, b) => d.x[a]! - d.x[b]!)
            const got = runsTest(order.map((i) => r[i]!))
            expect([got.runs, got.nAbove, got.nBelow]).toEqual([
              want.runs,
              want.nAbove,
              want.nBelow,
            ])
            expectClose(got.p, want.p, { rtol: 1e-12 }, 'runs P')
          }
        })
        if (dg.replicates) {
          const d = data[0]!
          const got = replicatesTest(d.x, d.y, fit.perDataSet[0]!.ss, fit.perDataSet[0]!.df)!
          for (const [key, v] of Object.entries(dg.replicates))
            expectClose(got[key as keyof typeof got], v, {}, `replicates.${key}`)
        } else {
          const d = data[0]!
          expect(replicatesTest(d.x, d.y, fit.perDataSet[0]!.ss, fit.perDataSet[0]!.df)).toBeNull()
        }
        const q = fit.nParams
        const R = correlationMatrix(fit.cov, q)
        dg.correlation.forEach((row, a) => {
          row.forEach((v, b) => {
            expectClose(R[a * q + b]!, v, { rtol, atol: rtol }, `R[${a}][${b}]`)
          })
        })
        dependency(fit.cov, q).forEach((v, i) => {
          expectClose(v, dg.dependency[i]!, {}, `dependency ${i}`)
        })
        // Second derivatives are central differences of the analytic gradient in our code
        // (deriv3 in R): ~1e-7 relative.
        const g = hougaardSkewness(model, fit, data)[0]!.filter((v) => !Number.isNaN(v))
        g.forEach((v, i) => {
          expectClose(v, dg.hougaard[i]!, { rtol: 1e-6, atol: 1e-9 }, `Hougaard ${i}`)
        })
      }
    })
  }
})

describe('Hougaard skewness without an analytic gradient', () => {
  it('is exactly 0 for a model linear in its parameters (representable difference steps)', () => {
    // Each point is one parameter, so every gradient is exactly 0 or 1 when the central
    // difference divides by the step actually taken; a nominal step gave ~1e-7 spurious skewness.
    const model: CurveModel = {
      id: 'two-levels',
      params: ['Low', 'High'],
      f: (x, p) => (x < 0 ? p[0]! : p[1]!),
      initial: () => [1, 1],
    }
    const data = [
      {
        x: Float64Array.from([-3, -2, -1, 1, 2, 3, 4]),
        y: Float64Array.from([0.31, 0.29, 0.37, 7.1, 6.9, 7.3, 7.05]),
      },
    ]
    const fit = nonlinearFit(model, data)
    expect(fit.status).toBe('converged')
    expect(hougaardSkewness(model, fit, data)[0]!.map(Math.abs)).toEqual([0, 0])
  })
})

interface RoutExpected {
  robust: number[]
  rsdr: number
  t: number[]
  p: number[]
  outliers: number[]
  final: FitExpected
}

describe('ROUT for curves vs R', () => {
  for (const f of loadFixtures<In, RoutExpected>('curvefit')) {
    const p = f.params as unknown as Params
    if (p.task !== 'rout') continue
    it(f.name, () => {
      const e = f.expected
      const model = modelOf(p)
      const d = f.input.data[0]!
      const r = routCurve(model, [d], p.q!, optionsOf(p))
      expect(r.robust.blocks[0]!.converged).toBe(true)
      expect(r.outliers[0]).toEqual(arr(e.outliers))
      r.robust.blocks[0]!.fit.params[0]!.forEach((est, j) => {
        expectClose(est.value, e.robust[j]!, f.tol, `robust ${model.params[j]}`)
      })
      expectClose(r.robust.blocks[0]!.rsdr, e.rsdr, f.tol, 'RSDR')
      e.t.forEach((v, i) => {
        expectClose(r.t[0]![i]!, v, { rtol: 1e-8 }, `t ${i}`)
      })
      e.p.forEach((v, i) => {
        expectClose(r.p[0]![i]!, v, { rtol: 1e-8 }, `P ${i}`)
      })
      const keep = d.x.map((_, i) => i).filter((i) => !r.outliers[0]!.includes(i))
      const clean = { x: keep.map((i) => d.x[i]!), y: keep.map((i) => d.y[i]!) }
      const fit = nonlinearFit(model, [clean], optionsOf(p))
      checkFit(model, fit, e.final, undefined, { atBound: true })
    })
  }
})

describe('interpolation from a standard line vs R (lm)', () => {
  for (const f of loadFixtures<
    In,
    { slope: number; intercept: number; interp: CurveExpected['interp'] }
  >('curvefit')) {
    const p = f.params as unknown as Params
    if (p.task !== 'linear') continue
    it(f.name, () => {
      const d = f.input.data[0]!
      const fit = linearRegression(d.x, d.y)
      expectClose(fit.slope, f.expected.slope, {}, 'slope')
      const line = fittedLine(fit)
      const [lo, hi] = [Math.min(...d.x), Math.max(...d.x)]
      const itol = { rtol: 1e-9, atol: 1e-9 }
      arr(f.input.interpolate!.y).forEach((y, i) => {
        const got = interpolateX(line, y, lo, hi)
        const want = f.expected.interp!.x[i]!
        expectClose(got.x, want.x, itol, `X at Y = ${y}`)
        expectClose(got.lo, want.lo, itol, `X lo at Y = ${y}`)
        expectClose(got.hi, want.hi, itol, `X hi at Y = ${y}`)
      })
      arr(f.input.interpolate!.x).forEach((x, i) => {
        const got = interpolateY(line, x, lo, hi)
        const want = f.expected.interp!.y[i]!
        expectClose(got.y, want.y, {}, `Y at X = ${x}`)
        expectClose(got.lo, want.lo, {}, `Y lo at X = ${x}`)
        expectClose(got.hi, want.hi, {}, `Y hi at X = ${x}`)
      })
    })
  }
})
