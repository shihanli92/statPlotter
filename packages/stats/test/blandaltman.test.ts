import { describe, expect, it } from 'vitest'
import { type BlandAltmanOptions, blandAltman } from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'

describe('blandaltman vs R', () => {
  for (const f of loadFixtures<{ a: number[]; b: number[] }>('blandaltman')) {
    it(f.name, () => {
      const got = blandAltman(f.input.a, f.input.b, f.params as BlandAltmanOptions)
      expectDeepClose(got, f.expected, f.tol)
    })
  }
})

describe('blandaltman invariants', () => {
  it("reproduces Prism's sample limits from its bias and SD (z = 1.96 exactly)", () => {
    // Prism's sample output: bias 0.238095, SD of bias 6.96351, limits -13.4104 to 13.8866.
    const r = blandAltman([0.238095 + 6.96351, 0.238095 - 6.96351], [0, 0])
    expectClose(r.bias, 0.238095, { rtol: 1e-12 }, 'bias')
    expectClose(r.sd, 6.96351 * Math.SQRT2, { rtol: 1e-12 }, 'sd')
    expect(r.z).toBe(1.96)
    expect((0.238095 - 1.96 * 6.96351).toFixed(4)).toBe('-13.4104')
  })

  it('B − A mirrors A − B', () => {
    const a = [10, 12, 15, 9, 20]
    const b = [11, 11, 16, 10, 18]
    const ab = blandAltman(a, b)
    const ba = blandAltman(a, b, { order: 'bMinusA' })
    expect(ba.bias).toBeCloseTo(-ab.bias, 14)
    expect(ba.sd).toBeCloseTo(ab.sd, 14)
    expect(ba.x).toEqual(ab.x)
  })

  it('degenerate data never throw', () => {
    const one = blandAltman([1], [2])
    expect(one.bias).toBe(-1)
    expect(one.sd).toBeNaN()
    expect(one.lower).toBeNaN()
    expect(blandAltman([], []).bias).toBeNaN()
    const zero = blandAltman([1, 2], [0, 1], { measure: 'ratio' })
    expect(zero.y[0]).toBe(Number.POSITIVE_INFINITY)
    expect(Number.isFinite(zero.bias)).toBe(false)
    const pct = blandAltman([1, -1], [-1, 1], { measure: 'percent' })
    expect(pct.bias).toBeNaN()
    expect(() => blandAltman([1, 2], [1])).toThrow(RangeError)
  })
})
