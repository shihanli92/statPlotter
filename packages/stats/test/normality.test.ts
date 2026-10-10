import { describe, expect, it } from 'vitest'
import {
  andersonDarling,
  dagostinoPearson,
  kolmogorovSmirnovNormality,
  qqPlot,
  shapiroWilk,
} from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'

interface Params {
  log?: boolean
  shift?: number
}

describe('normality tests vs R', () => {
  for (const f of loadFixtures<{ x: number[] }>('normality')) {
    it(f.name, () => {
      const p = f.params as Params
      // params.shift only applies on the R side (the tests are location-invariant).
      const x = p.log ? f.input.x.map(Math.log) : f.input.x
      const got = {
        dagostino: dagostinoPearson(x),
        shapiroWilk: shapiroWilk(x),
        andersonDarling: andersonDarling(x),
        ks: kolmogorovSmirnovNormality(x),
      }
      expectDeepClose(got, f.expected, f.tol)
    })
  }
})

describe('normality invariants', () => {
  const x = [4.1, 5.3, 2.2, 6.8, 5.0, 4.4, 3.9, 7.7, 5.6, 4.8, 6.1, 3.3]

  it('location and scale invariance', () => {
    const y = x.map((v) => 1e6 + 250 * v)
    for (const test of [dagostinoPearson, shapiroWilk, andersonDarling]) {
      const a = test(x)
      const b = test(y)
      expectClose(b.stat, a.stat, { rtol: 1e-9 }, 'stat')
      expectClose(b.p, a.p, { rtol: 1e-9 }, 'p')
    }
  })

  it('Shapiro-Wilk n = 3 at equal spacing: W = 1, P = 1', () => {
    const r = shapiroWilk([1, 2, 3])
    expectClose(r.stat, 1, { rtol: 1e-15 }, 'W')
    expectClose(r.p, 1, { rtol: 1e-14 }, 'p')
  })

  it('below the minimum n, or with zero spread, results are NaN (no throw)', () => {
    expect(dagostinoPearson(x.slice(0, 7)).p).toBeNaN()
    expect(andersonDarling(x.slice(0, 7)).stat).toBeNaN()
    expect(kolmogorovSmirnovNormality(x.slice(0, 4)).p).toBeNaN()
    expect(shapiroWilk([1, 2]).p).toBeNaN()
    expect(shapiroWilk([3, 3, 3, 3]).stat).toBeNaN()
    expect(dagostinoPearson(new Array(10).fill(1)).stat).toBeNaN()
  })
})

describe('QQ plot vs R', () => {
  for (const f of loadFixtures<{ values: number[] }>('qq')) {
    it(f.name, () => {
      const p = f.params as { lognormal?: boolean }
      expectDeepClose(qqPlot(f.input.values, p), f.expected, f.tol, f.name)
    })
  }
  it('gives NaN predictions for one value', () => {
    expect(qqPlot([3]).predicted[0]).toBeNaN()
  })
})
