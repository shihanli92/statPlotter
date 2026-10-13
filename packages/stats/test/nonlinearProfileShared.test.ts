import { describe, expect, it } from 'vitest'
import { equation, type FitData, nonlinearFit, type ParamConstraint } from '../src/index.ts'
import { cpuRatio } from './timing.ts'

// Audit 4 (P1, Q1): a global fit can profile its shared parameters only (each data set's own
// parameters asymptotic), so its cost no longer grows as K⁴; progress is reported per parameter.

const hill = equation('agonist-response-variable-slope')!
const X = [-9, -8.5, -8, -7.5, -7, -6.5, -6, -5.5, -5, -4.5, -4]
/** K data sets of a 4PL curve, EC50s apart, with deterministic noise (no random draws). */
function sets(K: number): FitData[] {
  return Array.from({ length: K }, (_, k) => ({
    x: X,
    y: X.map((x, i) => {
      const mid = -7 + (k % 7) * 0.3
      const noise = (((i * 7 + k * 13) % 11) - 5) * 0.6
      return 5 + 95 / (1 + 10 ** (mid - x)) + noise
    }),
  }))
}
const sharedHill: ParamConstraint[] = [
  { kind: 'fit' },
  { kind: 'fit' },
  { kind: 'fit' },
  { kind: 'shared' },
]

describe('profile CIs of the shared parameters only (audit 4 P1)', () => {
  it('shared parameters as when every one is profiled; the others asymptotic', () => {
    const data = sets(3)
    const all = nonlinearFit(hill, data, { constraints: sharedHill, profileCI: true })
    const shared = nonlinearFit(hill, data, { constraints: sharedHill, profileCI: 'shared' })
    const sym = nonlinearFit(hill, data, { constraints: sharedHill })
    expect(shared.status).toBe('converged')
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < 4; j++) {
        const got = shared.params[k]![j]!
        const want = (j === 3 ? all : sym).params[k]![j]!
        expect([got.value, got.se, got.lo, got.hi]).toEqual([want.value, want.se, want.lo, want.hi])
      }
    }
    // The profiled interval of the shared slope is not the symmetric one.
    const h = shared.params[0]![3]!
    expect(Math.abs(h.hi - h.value - (h.value - h.lo))).toBeGreaterThan(1e-6)
  })

  it('separate fits with profileCI shared profile nothing', () => {
    const data = sets(2)
    const shared = nonlinearFit(hill, data, { profileCI: 'shared' })
    const sym = nonlinearFit(hill, data)
    expect(shared.params).toEqual(sym.params)
  })

  it('reports progress once fitted and after each parameter profiled', () => {
    const calls: [number, number][] = []
    nonlinearFit(hill, sets(3), {
      constraints: sharedHill,
      profileCI: true,
      onProfile: (done, total) => calls.push([done, total]),
    })
    expect(calls).toEqual(Array.from({ length: 11 }, (_, i) => [i, 10]))
    const shared: [number, number][] = []
    nonlinearFit(hill, sets(3), {
      constraints: sharedHill,
      profileCI: 'shared',
      onProfile: (done, total) => shared.push([done, total]),
    })
    expect(shared).toEqual([
      [0, 1],
      [1, 1],
    ])
  })

  it('profiling the shared parameter of 12 data sets costs a few fits, not one per parameter', () => {
    // Every parameter profiled: 37 parameters × two ends × several refits of the whole problem
    // (≈ 200 times the fit itself at 12 data sets, growing as K); the shared one only: ≈ 10.
    const data = sets(12)
    const fit = () => nonlinearFit(hill, data, { constraints: sharedHill })
    const prof = () => nonlinearFit(hill, data, { constraints: sharedHill, profileCI: 'shared' })
    expect(cpuRatio(fit, prof, 3)).toBeLessThan(40)
  })
})
