import { describe, expect, it } from 'vitest'
import { coxBaseline, coxRegression, coxSurvivalAt } from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'

interface In {
  time: number[]
  event: number[]
  X: number[][]
  names: string[]
  newdata: number[][]
}
interface Expected {
  beta: number[]
  baseline: Record<string, number[]>
  curves: number[][]
}

describe('Cox estimated survival curves vs R (survfit stype = 1)', () => {
  for (const f of loadFixtures<In, Expected>('coxcurves')) {
    it(f.name, () => {
      const ev = f.input.event.map((e) => e === 1)
      const ties = (f.params as { ties?: 'efron' | 'breslow' }).ties ?? 'efron'
      // Our own fit agrees with coxph (the cox suite checks it in depth).
      const fit = coxRegression(f.input.time, ev, f.input.X, f.input.names, {
        ties,
        ciMethod: 'wald',
      })
      fit.coefficients.forEach((c, j) => {
        expectClose(c.estimate, f.expected.beta[j]!, {}, `beta ${j}`)
      })
      // Curves from R's coefficients, to test the survival code on its own.
      const base = coxBaseline(f.input.time, ev, f.input.X, f.expected.beta)
      expectDeepClose(base, f.expected.baseline, f.tol, 'baseline')
      f.input.newdata.forEach((x, i) => {
        expectDeepClose(
          coxSurvivalAt(base, f.expected.beta, x),
          f.expected.curves[i],
          f.tol,
          `curve ${i}`,
        )
      })
    })
  }
})

describe('Cox baseline invariants', () => {
  it('is 0 once everyone at risk has the event', () => {
    const b = coxBaseline([1, 2, 2], [true, true, true], [[0], [1], [0]], [0.5])
    expect(b.survival.at(-1)).toBe(0)
  })
})
