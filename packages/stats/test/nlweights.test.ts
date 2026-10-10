import { describe, expect, it } from 'vitest'
import {
  compareFits,
  equation,
  type FitOptions,
  hougaardSkewness,
  nonlinearFit,
  type ParamConstraint,
  weightingTest,
} from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { checkFit, type FitExpected } from './nls.ts'
import { arr, expectClose, loadFixtures } from './oracle.ts'

// Roadmap 18 R oracle (tools/oracle/r/nlweights.R): 1/Y^K, 1/X, 1/X², 1/SD² weighting,
// Hougaard's skewness of weighted fits, the test for appropriate weighting, and "is parameter P
// the same for every data set?". Fits start from R's starting values.

interface In {
  data: { x: number[]; y: number[] }[]
  weights?: number[][]
}
interface Params {
  equation: string
  constraints: { kind: 'fit' | 'shared' }[]
  weighting?: FitOptions['weighting']
  weightPower?: number
  start: number[][]
  compareShared?: string[]
}
interface Expected extends FitExpected {
  hougaard: { free: string | string[]; g1: number | number[] }
  weightingTest: { r: number; p: number; n: number }[]
  compare?: Record<string, number>
}

describe('nonlinear weighting, weighted Hougaard, weighting test, compare a parameter vs R', () => {
  for (const f of loadFixtures<In, Expected>('nlweights')) {
    it(f.name, () => {
      const p = f.params as unknown as Params
      const model = equation(p.equation)!
      const constraints: ParamConstraint[] = p.constraints.map((c) => ({ kind: c.kind }))
      const data = f.input.data
      const start = p.start.map((s) => arr(s))
      const pointWeights = f.input.weights?.map((w) => arr(w))
      const opts: FitOptions = {
        constraints,
        initial: data.map((_, k) => start[k] ?? start[0]!),
        ...(p.weighting ? { weighting: p.weighting } : {}),
        ...(p.weightPower !== undefined ? { weightPower: p.weightPower } : {}),
        ...(pointWeights ? { pointWeights } : {}),
      }
      const fit = nonlinearFit(model, data, opts)
      expect(fit.status, fit.message).toBe('converged')
      const e = f.expected
      checkFit(model, fit, e, f.tol, { atBound: true })
      // Hougaard: R names data set k's own parameters Name1, Name2 … and shared ones plainly.
      const g = hougaardSkewness(model, fit, data, pointWeights)
      const names = arr(e.hougaard.free)
      const g1 = arr(e.hougaard.g1)
      names.forEach((n, i) => {
        const m = /^(.*)(\d)$/.exec(n)
        const j = model.params.indexOf(m && !model.params.includes(n) ? m[1]! : n)
        const k = m && !model.params.includes(n) ? Number(m[2]) - 1 : 0
        // Second derivatives by central differences (~1e-10 relative), as curvefit's 1e-6.
        expectClose(g[k]![j]!, g1[i]!, { rtol: 1e-6 }, `hougaard ${n}`)
      })
      e.weightingTest.forEach((w, k) => {
        expectDeepClose(
          weightingTest(model, fit, data[k]!, k, pointWeights?.[k]),
          w,
          f.tol,
          `weightingTest[${k}]`,
        )
      })
      if (e.compare && p.compareShared) {
        const shared = constraints.map((c, j) =>
          p.compareShared!.includes(model.params[j]!) ? ({ kind: 'shared' } as const) : c,
        )
        const simpler = nonlinearFit(model, data, { ...opts, constraints: shared })
        expectDeepClose(compareFits(simpler, fit), e.compare, f.tol, 'compare')
      }
    })
  }
})
