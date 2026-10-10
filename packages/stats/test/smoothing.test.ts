import { describe, expect, it } from 'vitest'
import {
  akimaSpline,
  lowess,
  naturalCubicSpline,
  pointToPoint,
  regressionSpline,
} from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { loadFixtures } from './oracle.ts'

interface In {
  x: number[]
  y: number[]
  at: number[]
}
interface P {
  method: 'lowess' | 'natural' | 'akima' | 'regression' | 'p2p'
  f?: number
  iter?: number
  knots?: number
}

describe('LOWESS and splines vs R', () => {
  for (const f of loadFixtures<In>('smoothing')) {
    it(f.name, () => {
      const p = f.params as unknown as P
      const { x, y, at } = f.input
      const e = f.expected
      switch (p.method) {
        case 'lowess':
          expectDeepClose(lowess(x, y, { f: p.f, iter: p.iter }), e, f.tol, 'lowess')
          break
        case 'natural':
          expectDeepClose({ y: at.map(naturalCubicSpline(x, y)) }, e, f.tol, 'natural')
          break
        case 'akima':
          expectDeepClose({ y: at.map(akimaSpline(x, y)) }, e, f.tol, 'akima')
          break
        case 'p2p':
          expectDeepClose({ y: at.map(pointToPoint(x, y)) }, e, f.tol, 'p2p')
          break
        case 'regression': {
          const r = regressionSpline(x, y, p.knots!)
          expectDeepClose({ y: at.map(r.curve), ss: r.ss, df: r.df }, e, f.tol, 'regression')
          break
        }
      }
    })
  }
})

describe('spline invariants', () => {
  it('interpolating splines go through every point', () => {
    const x = [0, 1, 3, 4, 7]
    const y = [2, -1, 5, 5, 0]
    for (const s of [naturalCubicSpline(x, y), akimaSpline(x, y), pointToPoint(x, y)])
      x.forEach((v, i) => {
        expect(s(v)).toBeCloseTo(y[i]!, 12)
      })
  })
  it('two knots give the least-squares line', () => {
    const r = regressionSpline([0, 1, 2, 3], [1, 3, 2, 5], 2)
    expect(r.curve(1.5)).toBeCloseTo(2.75, 12)
  })
  it('refuses unsorted X for interpolation', () => {
    expect(() => akimaSpline([0, 2, 1], [1, 2, 3])).toThrow(/increasing/)
  })
})
