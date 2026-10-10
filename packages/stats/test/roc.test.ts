import { describe, expect, it } from 'vitest'
import { proportionCI, type RocOptions, rocCurve } from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'

describe('roc vs R', () => {
  for (const f of loadFixtures<{ controls: number[]; patients: number[] }>('roc')) {
    it(f.name, () => {
      const got = rocCurve(f.input.controls, f.input.patients, f.params as RocOptions)
      expectDeepClose(got, f.expected, f.tol)
    })
  }
})

/** Trapezoidal area under a polyline. */
function trapezoid(curve: { x: number; y: number }[]): number {
  let a = 0
  for (let i = 1; i < curve.length; i++) {
    a += ((curve[i]!.x - curve[i - 1]!.x) * (curve[i]!.y + curve[i - 1]!.y)) / 2
  }
  return a
}

describe('roc invariants', () => {
  const controls = [1, 2, 2, 3, 3, 3, 4, 5, 7.5]
  const patients = [2, 3, 3, 4, 4, 5, 6, 6, 7]

  it('the area is the trapezoidal area of the curve, which runs (0,0) → (1,1)', () => {
    for (const direction of ['higher', 'lower'] as const) {
      const r = rocCurve(controls, patients, { direction })
      expect(r.curve[0]).toEqual({ x: 0, y: 0 })
      expect(r.curve.at(-1)).toEqual({ x: 1, y: 1 })
      for (let i = 1; i < r.curve.length; i++) {
        expect(r.curve[i]!.x).toBeGreaterThanOrEqual(r.curve[i - 1]!.x)
        expect(r.curve[i]!.y).toBeGreaterThanOrEqual(r.curve[i - 1]!.y)
      }
      expectClose(trapezoid(r.curve), r.auc, { rtol: 1e-14 }, direction)
    }
  })

  it('auto direction flips a sub-½ area; SE and P do not depend on direction', () => {
    const hi = rocCurve(patients, controls, { direction: 'higher' })
    const auto = rocCurve(patients, controls)
    expect(hi.auc).toBeLessThan(0.5)
    expect(auto.direction).toBe('lower')
    expectClose(auto.auc, 1 - hi.auc, { rtol: 1e-15 }, 'auc')
    expectClose(auto.se, hi.se, { rtol: 1e-15 }, 'se')
    expectClose(auto.p, hi.p, { rtol: 1e-13 }, 'p')
  })

  it('Wilson/Brown intervals come from proportionCI', () => {
    const r = rocCurve(controls, patients, { ciMethod: 'wilsonBrown', confLevel: 0.9 })
    const pt = r.points[3]!
    const s = proportionCI(Math.round(pt.sensitivity * 9), 9, { confLevel: 0.9 })
    expect([pt.sensLower, pt.sensUpper]).toEqual([s.lower, s.upper])
  })

  it('degenerate inputs', () => {
    const e = rocCurve([], [1, 2])
    expect(e.auc).toBeNaN()
    expect(e.points).toEqual([])
    const perfect = rocCurve([1, 2], [3, 4])
    expect(perfect.auc).toBe(1)
    expect(perfect.se).toBe(0)
    expect(perfect.upper).toBe(1)
    expect(() => rocCurve([1, Number.NaN], [2])).toThrow(RangeError)
  })
})
