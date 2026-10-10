import { describe, expect, it } from 'vitest'
import { defaultFitOptions, modelFor, nonlinearFit } from '../src/index.ts'
import { CASES } from './equationDesigns.ts'
import { expectClose } from './oracle.ts'
import { boxMuller, mulberry32 } from './rng.ts'

// Simulated data sets are fit from the automatic initial values and must reach the same minimum
// as fits started from the true parameters (and land near the truth). Data set constants,
// per-data-set lines and centered polynomials use several data sets.

describe('equation library', () => {
  it.each(CASES.map((c) => [c.e.id, c] as const))(
    '%s: recovers simulated parameters from automatic initial values',
    (_, { e, d, g }) => {
      const K = d.sets ?? 1
      const reps = d.reps ?? 1
      const truths = Array.from({ length: K }, (_, k) => d.truth(k))
      const dscIndex = e.params.findIndex(
        (n) => e.paramInfo[n]?.defaultConstraint === 'dataSetConstant',
      )
      for (let seed = 0; seed < g.seeds; seed++) {
        const z = boxMuller(mulberry32(g.seed0 + 7919 * seed))
        const data = truths.map((p, k) => {
          const m = modelFor(e, { dataSet: k })
          const xs: number[] = []
          const ys: number[] = []
          for (const xv of d.x) {
            for (let r = 0; r < reps; r++) {
              xs.push(xv)
              ys.push(m.f(xv, p) + d.sd * z())
            }
          }
          return { x: xs, y: ys, dataSet: k }
        })
        const opts = defaultFitOptions(
          e,
          dscIndex >= 0 ? truths.map((p) => p[dscIndex]!) : undefined,
          data,
        )
        const fit = nonlinearFit(e, data, opts)
        expect(fit.status, `seed ${seed}: ${fit.message}`).toBe('converged')
        // Same minimum as a fit started from the true parameters.
        const ref = nonlinearFit(e, data, { ...opts, initial: truths })
        expect(ref.status, `seed ${seed} (from truth): ${ref.message}`).toBe('converged')
        const rtol = d.rtol ?? 1e-6
        expect(Math.abs(fit.ss - ref.ss), `seed ${seed}: SS`).toBeLessThanOrEqual(1e-9 * ref.ss)
        for (let k = 0; k < K; k++) {
          const m = modelFor(e, { dataSet: k })
          e.params.forEach((name, j) => {
            if (m.uses?.(j) === false) return
            const pe = fit.params[k]![j]!
            if (pe.status === 'constant' || pe.status === 'dataSetConstant') {
              expect(pe.value, name).toBe(truths[k]![j]!)
              return
            }
            const want = ref.params[k]![j]!.value
            expectClose(pe.value, want, { rtol, atol: rtol * pe.se }, `seed ${seed} [${k}] ${name}`)
            // Sanity: within 6 standard errors of the truth.
            expect(
              Math.abs(pe.value - truths[k]![j]!),
              `seed ${seed} [${k}] ${name}: ${pe.value} vs truth ${truths[k]![j]} (SE ${pe.se})`,
            ).toBeLessThan(6 * pe.se)
          })
        }
        if (g.minR2 !== undefined) expect(fit.perDataSet[0]!.r2).toBeGreaterThan(g.minR2)
        if (e.derived && !e.forDataSet) {
          for (const v of Object.values(e.derived(fit.params[0]!.map((q) => q.value)))) {
            expect(Number.isFinite(v)).toBe(true)
          }
        }
      }
    },
  )
})
