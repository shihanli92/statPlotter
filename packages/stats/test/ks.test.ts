import { describe, expect, it } from 'vitest'
import { kolmogorovSf, kolmogorovSmirnovTwoSample } from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'

interface Params {
  exact?: 'auto' | boolean
}

describe('two-sample Kolmogorov-Smirnov vs R', () => {
  for (const f of loadFixtures<{ a: number[]; b: number[] }>('ks')) {
    it(f.name, () => {
      const p = f.params as Params
      const got = kolmogorovSmirnovTwoSample(f.input.a, f.input.b, { exact: p.exact })
      expectDeepClose(got, f.expected, f.tol)
    })
  }
})

describe('Kolmogorov-Smirnov invariants', () => {
  it('complete separation: exact P = 2 / C(nA + nB, nA)', () => {
    const r = kolmogorovSmirnovTwoSample([1, 2, 3, 4], [5, 6, 7, 8, 9])
    expect(r.d).toBe(1)
    expect(r.exact).toBe(true)
    expectClose(r.p, 2 / 126, { rtol: 1e-15 }, 'p')
  })

  it('symmetric in the two groups', () => {
    const a = [1.2, 3.3, 2.2, 5.1, 2.2]
    const b = [2.2, 4.4, 6.1, 5.1, 7.0, 3.3]
    const ab = kolmogorovSmirnovTwoSample(a, b)
    const ba = kolmogorovSmirnovTwoSample(b, a)
    expect(ba.d).toBe(ab.d)
    expect(ba.p).toBeCloseTo(ab.p, 15)
  })

  it('both Q_KS series agree where they meet', () => {
    // λ just below / above the switch at 1.18.
    expectClose(kolmogorovSf(1.18 - 1e-12), kolmogorovSf(1.18), { rtol: 1e-11 }, 'Q')
    expect(kolmogorovSf(0)).toBe(1)
  })

  it('an empty group gives NaN', () => {
    expect(kolmogorovSmirnovTwoSample([], [1, 2]).p).toBeNaN()
  })
})
