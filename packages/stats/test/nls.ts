import { expect } from 'vitest'
import type { CurveModel, NonlinearFit, ParamConstraint } from '../src/index.ts'
import { arr, expectClose, type Tolerance } from './oracle.ts'

/**
 * Comparison of our nonlinear fits with R's nls, shared by the curve-fitting oracle tests
 * (nonlinear, curvefit, nlweights, equationFits).
 */

/** A parameter constraint as the oracle writes it (jsonlite unboxes one data set's values). */
export interface RawConstraint {
  kind: string
  value?: number
  values?: number | number[]
}

/** R's fit: per data set, per parameter in R's order. */
export interface FitExpected {
  status: string
  value: number[][]
  se: number[][]
  lo: number[][]
  hi: number[][]
  atBound?: boolean[][]
  ss: number
  df: number
  n: number
  nParams: number
  aicc: number
  perDataSet: Record<string, number | number[]>
}

export function constraintsOf(raw: RawConstraint[] | undefined): ParamConstraint[] | undefined {
  return raw?.map((c): ParamConstraint => {
    if (c.kind === 'constant') return { kind: 'constant', value: c.value! }
    if (c.kind === 'dataSetConstant') return { kind: 'dataSetConstant', values: arr(c.values!) }
    return { kind: c.kind as 'fit' | 'shared' }
  })
}

export interface CheckFitOptions {
  /** Position in R's order of each of the model's parameters (default: the same order). */
  order?: number[]
  /** Constants and data set constants: compare the value only (R has no SE for them). */
  skipConstantSE?: boolean
  /** Also compare which parameters stopped on a bound. */
  atBound?: boolean
}

/**
 * Compares a fit with R's: status, every data set's estimates, SEs and CI limits, SS, df, n,
 * the number of fitted parameters, AICc and the per-data-set summaries.
 */
export function checkFit(
  model: CurveModel,
  fit: NonlinearFit,
  e: FitExpected,
  tol: Partial<Tolerance> | undefined,
  opts: CheckFitOptions = {},
): void {
  const order = opts.order ?? model.params.map((_, j) => j)
  expect(fit.status, fit.message).toBe(e.status)
  expect(fit.params.length, 'data sets').toBe(e.value.length)
  fit.params.forEach((ests, k) => {
    expect(ests.length, `parameters of data set ${k}`).toBe(e.value[k]!.length)
    ests.forEach((est, jj) => {
      const j = order[jj]!
      const at = `[${k}][${model.params[jj]}]`
      expectClose(est.value, e.value[k]![j]!, tol, `value${at}`)
      if (opts.atBound) expect(est.atBound ?? false, `atBound${at}`).toBe(e.atBound![k]![j])
      const constant = est.status === 'constant' || est.status === 'dataSetConstant'
      if (opts.skipConstantSE && constant) return
      expectClose(est.se, e.se[k]![j]!, tol, `se${at}`)
      expectClose(est.lo, e.lo[k]![j]!, tol, `lo${at}`)
      expectClose(est.hi, e.hi[k]![j]!, tol, `hi${at}`)
    })
  })
  expectClose(fit.ss, e.ss, tol, 'ss')
  expect(fit.df).toBe(e.df)
  expect(fit.n).toBe(e.n)
  expect(fit.nParams).toBe(e.nParams)
  expectClose(fit.aicc, e.aicc, tol, 'aicc')
  for (const [key, v] of Object.entries(e.perDataSet)) {
    arr(v).forEach((x, k) => {
      const got = fit.perDataSet[k]![key as keyof NonlinearFit['perDataSet'][number]]
      expectClose(got, x, tol, `perDataSet[${k}].${key}`)
    })
  }
}
