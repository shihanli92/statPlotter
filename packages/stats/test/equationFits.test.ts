import { describe, it } from 'vitest'
import {
  type CurveModel,
  equation,
  type FitData,
  type FitOptions,
  nonlinearFit,
  parseEquation,
  userCurveModel,
} from '../src/index.ts'
import { checkFit, constraintsOf, type FitExpected, type RawConstraint } from './nls.ts'
import { arr, expectClose, loadFixtures } from './oracle.ts'

// Roadmap 20 R oracle (tools/oracle/r/equations20.R): the special and distribution functions,
// user equations using them, implicit and differential equations (against the fits of their
// closed-form solutions), lines for particular data sets, and the built-in equations added in
// roadmap 20. Our fits start from automatic (or the case's) initial values; R's from the truth.

interface Params {
  task?: 'special' | 'fit' | 'mmdepletion'
  equation?: string
  text?: string
  /** R's parameter names, in R's order. */
  params?: string[]
  /** Our names of the same parameters (same order), when they differ (Y[0]). */
  ours?: string[]
  initial?: number[]
  constraints?: RawConstraint[]
  weighting?: FitOptions['weighting']
}

describe('special functions vs R', () => {
  for (const f of loadFixtures<
    { calls: { fn: string; args: number | number[]; tail?: string }[] },
    { values: number | number[] }
  >('equations20')) {
    if ((f.params as Params).task !== 'special') continue
    it(f.name, () => {
      const want = arr(f.expected.values)
      f.input.calls.forEach((c, i) => {
        const args = arr(c.args).map((v) => String(v))
        if (c.tail) args.push(`"${c.tail}"`)
        const text = `Y = ${c.fn}(${args.join(', ')})`
        const r = parseEquation(text)
        if (!r.ok) throw new Error(`${text}: ${r.message}`)
        expectClose(r.program.f(0, []), want[i]!, f.tol, text)
      })
    })
  }
})

/** The model and, for each of its parameters, the position of the same parameter in R's order. */
function modelOf(p: Params): { model: CurveModel; order: number[] } {
  if (p.equation && p.equation !== 'user' && p.task !== 'mmdepletion') {
    const model = equation(p.equation)!
    return { model, order: model.params.map((_, j) => j) }
  }
  const r = parseEquation(p.text!)
  if (!r.ok) throw new Error(r.message)
  const names = p.ours ?? p.params!
  const order = r.parameters.map((n) => names.indexOf(n))
  const model = userCurveModel(r.program, () => order.map((i) => p.initial![i]!))
  return { model, order }
}

describe('equation fits vs R (nls)', () => {
  for (const f of loadFixtures<{ data: FitData[] }, FitExpected>('equations20')) {
    const p = f.params as Params
    if (p.task === 'special') continue
    it(f.name, () => {
      const { model, order } = modelOf(p)
      const data = f.input.data.map((d, k) => ({ ...d, dataSet: k }))
      const opts: FitOptions = {}
      const c = constraintsOf(p.constraints)
      if (c) opts.constraints = order.map((i) => c[i]!)
      if (p.weighting) opts.weighting = p.weighting
      const fit = nonlinearFit(model, data, opts)
      checkFit(model, fit, f.expected, f.tol, { order, skipConstantSE: true })
    })
  }
})
