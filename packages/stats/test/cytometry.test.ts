import { describe, expect, it } from 'vitest'
import {
  arcsinh,
  arcsinhInverse,
  LOGICLE_DEFAULTS,
  type LogicleParams,
  logicle,
  logicleProblem,
} from '../src/index.ts'
import { arr, expectClose, loadFixtures } from './oracle.ts'

// Roadmap 34g's cytometry transforms against R: arcsinh (asinh(x / cofactor)) and logicle
// (flowCore::logicleTransform and its inverse; tools/oracle/r/cytometry.R), rtol 1e-10.

interface In {
  x: number[]
  s: number[]
}
interface Expected {
  scale: number[]
  inverse: number[]
  zero?: number
}

describe('cytometry transforms vs R', () => {
  for (const f of loadFixtures<In, Expected>('cytometry')) {
    it(f.name, () => {
      const p = f.params as unknown as {
        kind: 'arcsinh' | 'logicle'
        cofactor?: number
      } & LogicleParams
      const x = arr(f.input.x)
      const s = arr(f.input.s)
      if (p.kind === 'arcsinh') {
        x.forEach((v, i) => {
          expectClose(arcsinh(v, p.cofactor!), arr(f.expected.scale)[i]!, {}, `asinh ${v}`)
        })
        s.forEach((v, i) => {
          expectClose(arcsinhInverse(v, p.cofactor!), arr(f.expected.inverse)[i]!, {}, `sinh ${v}`)
        })
        return
      }
      const lg = logicle({ T: p.T, W: p.W, M: p.M, A: p.A })
      // Values near data zero sit near the scale's zero: relative to the scale's length.
      const tol = { rtol: 1e-10, atol: 1e-12 * p.M }
      x.forEach((v, i) => {
        expectClose(lg.scale(v), arr(f.expected.scale)[i]!, tol, `scale ${v}`)
      })
      s.forEach((v, i) => {
        const want = arr(f.expected.inverse)[i]!
        // Data values near zero: relative to the top of the scale. The largest error measured
        // (rtol aside) is 1.8e-15 T (logicle_a1); 1e-14 T leaves about five times that.
        expectClose(lg.inverse(v), want, { rtol: 1e-10, atol: 1e-14 * p.T }, `inverse ${v}`)
      })
      expectClose(lg.zero, f.expected.zero!, {}, 'zero')
    })
  }
})

describe('logicle', () => {
  it('round-trips data values through the scale and back', () => {
    const lg = logicle(LOGICLE_DEFAULTS)
    for (const v of [-5e4, -300, -1, 0, 0.001, 2, 77, 1500, 262144, 9e5])
      expectClose(lg.inverse(lg.scale(v)), v, { rtol: 1e-9, atol: 1e-9 }, `${v}`)
  })
  it('is monotone and odd about data zero', () => {
    const lg = logicle({ T: 1e5, W: 1, M: 5, A: 0 })
    let last = Number.NEGATIVE_INFINITY
    for (let v = -1e4; v <= 1e5; v += 97.3) {
      const s = lg.scale(v)
      expect(s).toBeGreaterThan(last)
      last = s
      expectClose(lg.scale(-v) - lg.zero, -(s - lg.zero), { rtol: 1e-9, atol: 1e-12 })
    }
  })
  it('refuses parameters that make no scale', () => {
    expect(logicleProblem({ ...LOGICLE_DEFAULTS, T: 0 })).toMatch(/T/)
    expect(logicleProblem({ ...LOGICLE_DEFAULTS, W: 3 })).toMatch(/W/)
    expect(logicleProblem({ ...LOGICLE_DEFAULTS, A: -1 })).toMatch(/A/)
    expect(logicleProblem(LOGICLE_DEFAULTS)).toBeNull()
    expect(() => logicle({ ...LOGICLE_DEFAULTS, M: -1 })).toThrow()
  })
  it('keeps NaN and infinities', () => {
    const lg = logicle(LOGICLE_DEFAULTS)
    expect(lg.scale(Number.NaN)).toBeNaN()
    expect(lg.scale(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
    expect(lg.scale(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY)
  })
})
