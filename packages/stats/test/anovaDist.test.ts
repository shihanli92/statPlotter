import { describe, expect, it } from 'vitest'
import { cdfFast, sfFast } from '../src/dist/normalFast.ts'
import {
  adjustP,
  dunnettP,
  dunnettQuantile,
  normalSf,
  type PAdjustMethod,
  ptukey,
  qtukey,
  smmP,
  smmQuantile,
  tQuantile,
  tSf,
} from '../src/index.ts'
import { gaussLegendre, WG, WGK, XGK } from '../src/numint/quadrature.ts'
import { expectClose, loadFixtures } from './oracle.ts'

type Arrays = Record<string, number[]>

describe('studentized range vs R', () => {
  for (const f of loadFixtures<Arrays, Arrays>('studentized_range')) {
    const n = f.input.k!.length
    it(`${f.name} (${n} points)`, () => {
      const { q, k, df, p } = f.input
      for (let i = 0; i < n; i++) {
        const at = `q=${q?.[i] ?? ''} p=${p?.[i] ?? ''} k=${k![i]} df=${df![i]}`
        if (f.params.fn === 'qtukey' || f.params.fn === 'qtukey_ref') {
          const got = qtukey(p![i]!, k![i]!, df![i]!)
          expectClose(got, f.expected.q![i]!, f.tol, `qtukey(${at})`)
          // R's own qtukey is documented as accurate to ~4 decimal places.
          if (f.expected.qR) expectClose(got, f.expected.qR[i]!, { atol: 1e-4 }, `qR(${at})`)
          // Round trip on the tail that was solved.
          const tail = p![i]! >= 0.5 ? 1 - p![i]! : p![i]!
          const back = ptukey(got, k![i]!, df![i]!, p![i]! < 0.5)
          expectClose(back, tail, { rtol: 1e-11 }, `round trip(${at})`)
        } else {
          expectClose(ptukey(q![i]!, k![i]!, df![i]!), f.expected.lower![i]!, f.tol, `lower(${at})`)
          expectClose(
            ptukey(q![i]!, k![i]!, df![i]!, false),
            f.expected.upper![i]!,
            f.tol,
            `upper(${at})`,
          )
        }
      }
    })
  }
})

describe('studentized range invariants', () => {
  it('k = 2 reduces to |T|√2', () => {
    for (const df of [3, 17.5, Number.POSITIVE_INFINITY]) {
      const x = 2.3
      const expected = df === Number.POSITIVE_INFINITY ? 2 * normalSf(x) : 2 * tSf(x, df)
      expectClose(ptukey(x * Math.SQRT2, 2, df, false), expected, { rtol: 1e-14 })
      expectClose(qtukey(0.95, 2, df), Math.SQRT2 * tQuantile(0.025, df, false), {
        rtol: 1e-13,
      })
    }
  })

  it('lower + upper = 1 and edge values', () => {
    for (const [q, k, df] of [
      [3.1, 4, 12],
      [0.7, 7, 3.5],
      [5, 30, 200],
    ] as const) {
      expectClose(ptukey(q, k, df) + ptukey(q, k, df, false), 1, { rtol: 1e-13 })
    }
    expect(ptukey(0, 3, 10)).toBe(0)
    expect(ptukey(-1, 3, 10, false)).toBe(1)
    expect(ptukey(Number.POSITIVE_INFINITY, 3, 10)).toBe(1)
    expect(ptukey(3, 1, 10)).toBeNaN()
    expect(ptukey(3, 3, 0)).toBeNaN()
    expect(qtukey(1, 3, 10)).toBe(Number.POSITIVE_INFINITY)
    expect(qtukey(0, 3, 10)).toBe(0)
    expect(qtukey(1.5, 3, 10)).toBeNaN()
  })

  it('non-integer df is continuous between integers', () => {
    const a = ptukey(3.5, 4, 10, false)
    const b = ptukey(3.5, 4, 10.5, false)
    const c = ptukey(3.5, 4, 11, false)
    expect(b).toBeLessThan(a)
    expect(b).toBeGreaterThan(c)
  })
})

describe('Dunnett vs R', () => {
  interface In {
    n0: number
    n: number[]
    df: number
    t: number[]
  }
  for (const f of loadFixtures<In, Arrays & { q95: number; q99: number }>('dunnett')) {
    it(f.name, () => {
      const { n0, n, df, t } = f.input
      const two = f.params.twoSided as boolean
      t.forEach((x, i) => {
        const got = dunnettP(x, df, n0, n, two)
        expectClose(got, f.expected.p![i]!, f.tol, `p(t=${x})`)
        const e = f.expected
        if (e.p![i]! > 1e-6) {
          expect(Math.abs(got - e.pMvt![i]!), `mvtnorm(t=${x})`).toBeLessThanOrEqual(
            5 * e.pMvtErr![i]! + 1e-12,
          )
        }
      })
      expectClose(dunnettQuantile(0.95, df, n0, n, two), f.expected.q95, f.tol, 'q95')
      expectClose(dunnettQuantile(0.99, df, n0, n, two), f.expected.q99, f.tol, 'q99')
    })
  }

  it('invariants', () => {
    // Order of the treatment groups does not matter; P decreases in t.
    const a = dunnettP(2.4, 15, 5, [4, 7, 5])
    expectClose(dunnettP(2.4, 15, 5, [7, 5, 4]), a, { rtol: 1e-13 })
    expect(dunnettP(2.6, 15, 5, [4, 7, 5])).toBeLessThan(a)
    expectClose(dunnettP(-2.4, 15, 5, [4, 7, 5]), a, { rtol: 0 })
    // Round trip.
    const c = dunnettQuantile(0.95, 15, 5, [4, 7, 5])
    expectClose(dunnettP(c, 15, 5, [4, 7, 5]), 0.05, { rtol: 1e-11 })
    expect(dunnettP(Number.NaN, 15, 5, [4])).toBeNaN()
    expect(dunnettP(2, 15, 5, [])).toBeNaN()
  })
})

describe('studentized maximum modulus', () => {
  it('k = 1 is the two-sided t; quantile round trip', () => {
    expectClose(smmP(2.2, 1, 9), 2 * tSf(2.2, 9), { rtol: 1e-12 })
    const m = smmQuantile(0.95, 6, 20)
    expectClose(smmP(m, 6, 20), 0.05, { rtol: 1e-11 })
    // Šidák bound: the SMM critical value lies between the Šidák and per-comparison t values
    // (Šidák's inequality is an equality only for k = 1).
    const sidak = tQuantile(-Math.expm1(Math.log1p(-0.05) / 6) / 2, 20, false)
    expect(m).toBeLessThan(sidak)
    expect(m).toBeGreaterThan(tQuantile(0.025, 20, false))
  })
})

describe('P value adjustment vs R', () => {
  const methods: [PAdjustMethod, string][] = [
    ['bonferroni', 'bonferroni'],
    ['sidak', 'sidak'],
    ['holm', 'holm'],
    ['holm-sidak', 'holmSidak'],
    ['bh', 'bh'],
    ['by', 'by'],
    ['bky', 'bky'],
  ]
  for (const f of loadFixtures<{ p: number[] }, Arrays>('padjust')) {
    it(f.name, () => {
      const n = f.params.n as number | undefined
      for (const [m, key] of methods) {
        const got = adjustP(f.input.p, m, n)
        // jsonlite unboxes length-1 results
        ;[f.expected[key]!].flat().forEach((e, i) => {
          expectClose(got[i]!, e, { rtol: 1e-12, atol: 1e-15, ...f.tol }, `${key}[${i}]`)
        })
      }
    })
  }

  it('NaN entries are skipped', () => {
    const r = adjustP([0.01, Number.NaN, 0.02], 'holm')
    expect(r[1]).toBeNaN()
    expectClose(r[0]!, 0.02, { rtol: 1e-15 })
    expect(adjustP([], 'bky')).toEqual([])
  })
})

describe('numerical building blocks', () => {
  it('QUADPACK 21-point Kronrod constants', () => {
    const g = gaussLegendre(10)
    for (let j = 0; j < 5; j++) {
      expectClose(XGK[2 * j + 1]!, g.x[9 - j]!, { atol: 1e-15 })
      expectClose(WG[j]!, g.w[9 - j]!, { atol: 1e-15 })
    }
    // Exact for polynomials up to degree 3n + 1 = 31.
    for (let d = 0; d <= 31; d += 2) {
      let s = WGK[10]! * (d === 0 ? 1 : 0)
      for (let j = 0; j < 10; j++) s += 2 * WGK[j]! * XGK[j]! ** d
      expectClose(s, 2 / (d + 1), { atol: 1e-15 }, `x^${d}`)
    }
  })

  it('fast normal tails agree with normalSf', () => {
    for (let x = -37; x <= 37; x += 0.0137) {
      const e = normalSf(x)
      expectClose(sfFast(x), e, { rtol: 5e-14 }, `sf(${x})`)
      expectClose(cdfFast(-x), e, { rtol: 5e-14 }, `cdf(${-x})`)
    }
  })
})
