import { describe, expect, it } from 'vitest'
import {
  betaInc,
  betaIncComplement,
  chiSqCdf,
  chiSqSf,
  fCdf,
  fSf,
  gammaIncLower,
  gammaIncUpper,
  lbeta,
  lgamma,
  normalCdf,
  normalQuantile,
  normalSf,
  tCdf,
  tQuantile,
  tSf,
} from '../src/index.ts'
import { expectClose, loadFixture, loadFixtures, type Tolerance } from './oracle.ts'

type Arrays = Record<string, number[]>

/** Evaluates the fixture's function on its grid; returns name → values, like the R oracle. */
function evaluate(fn: string, x: Arrays): Arrays {
  const n = Object.values(x)[0]!.length
  const map = (f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i))
  switch (fn) {
    case 'normal':
      return { cdf: map((i) => normalCdf(x.z![i]!)), sf: map((i) => normalSf(x.z![i]!)) }
    case 'normal_quantile':
      return {
        lower: map((i) => normalQuantile(x.p![i]!)),
        upper: map((i) => normalQuantile(x.p![i]!, false)),
      }
    case 't':
      return {
        cdf: map((i) => tCdf(x.t![i]!, x.df![i]!)),
        sf: map((i) => tSf(x.t![i]!, x.df![i]!)),
      }
    case 't_quantile':
      return {
        lower: map((i) => tQuantile(x.p![i]!, x.df![i]!)),
        upper: map((i) => tQuantile(x.p![i]!, x.df![i]!, false)),
      }
    case 'f':
      return {
        cdf: map((i) => fCdf(x.x![i]!, x.df1![i]!, x.df2![i]!)),
        sf: map((i) => fSf(x.x![i]!, x.df1![i]!, x.df2![i]!)),
      }
    case 'chisq':
      return {
        cdf: map((i) => chiSqCdf(x.x![i]!, x.df![i]!)),
        sf: map((i) => chiSqSf(x.x![i]!, x.df![i]!)),
      }
    case 'beta':
      return {
        lower: map((i) => betaInc(x.x![i]!, x.a![i]!, x.b![i]!)),
        upper: map((i) => betaIncComplement(x.x![i]!, x.a![i]!, x.b![i]!)),
      }
    case 'lgamma':
      return { lgamma: map((i) => lgamma(x.x![i]!)) }
    default:
      throw new Error(`unknown fn ${fn}`)
  }
}

describe('distributions vs R', () => {
  for (const f of loadFixtures<Arrays, Arrays>('distributions')) {
    it(`${f.name} (${Object.values(f.input)[0]!.length} points)`, () => {
      const got = evaluate(f.params.fn as string, f.input)
      for (const [k, expected] of Object.entries(f.expected)) {
        expected.forEach((e, i) => {
          const at = Object.entries(f.input)
            .map(([name, v]) => `${name}=${v[i]}`)
            .join(', ')
          expectClose(got[k]![i]!, e, f.tol, `${k}(${at})`)
        })
      }
    })
  }
})

describe('tail accuracy (independent 50-digit references, mpmath)', () => {
  const tight: Partial<Tolerance> = { rtol: 1e-13 }

  it('deep tails keep relative accuracy', () => {
    expectClose(tSf(40, 10), 1.1404288715428774e-12, tight, 'tSf(40, 10)')
    expectClose(tCdf(-40, 10), 1.1404288715428774e-12, tight, 'tCdf(-40, 10)')
    expectClose(normalSf(20), 2.7536241186062337e-89, tight, 'normalSf(20)')
    expectClose(normalCdf(-20), 2.7536241186062337e-89, tight, 'normalCdf(-20)')
    expectClose(tSf(1000, 3), 1.1026538212882963e-9, tight, 'tSf(1000, 3)')
    // Large df, moderate t: the continued fraction in x ≈ 1 would lose ~7e−12 here.
    expectClose(tSf(2, 1e5), 0.022751481728753232, tight, 'tSf(2, 1e5)')
  })

  it('t quantiles far in the tail (where R qt() is off by up to 1e−8)', () => {
    const f = loadFixture<Arrays>('distributions', 't_quantile_extreme')
    const ref = [
      -6.709455400663484e66, -2.411253249559218e22, -40222.12836181788, -1.4457941326481907e43,
      -387862584049539.9, -1445.7919808114368, -2.564525718948198e30, -25645257189.48198,
      -256.4346993185262,
    ]
    ref.forEach((r, i) => {
      const p = f.input.p![i]!
      const df = f.input.df![i]!
      expectClose(tQuantile(p, df), r, tight, `tQuantile(${p}, ${df})`)
    })
  })

  it('t quantiles for df < 2 deep in the tail follow the tail asymptote, or are infinite', () => {
    // S(t) = df^(df/2 − 1) t^−df / B(df/2, ½) · (1 + O(df/t²)): exact to double precision here.
    const asym = (q: number, df: number) =>
      -Math.exp(-(Math.log(q) + Math.log(df) + lbeta(df / 2, 0.5)) / df + 0.5 * Math.log(df))
    for (const [q, df] of [
      [1e-200, 1.5],
      [1e-300, 1.5],
      [1e-300, 1.9],
      [1e-250, 1.2],
      [1e-60, 0.4],
    ] as const) {
      expectClose(tQuantile(q, df), asym(q, df), { rtol: 1e-12 }, `tQuantile(${q}, ${df})`)
      expectClose(tQuantile(q, df, false), -asym(q, df), { rtol: 1e-12 }, `upper ${q} ${df}`)
    }
    expect(tQuantile(1e-300, 0.1)).toBe(Number.NEGATIVE_INFINITY)
    expect(tQuantile(1e-300, 0.1, false)).toBe(Number.POSITIVE_INFINITY)
    expect(tQuantile(1e-310, 0.99)).toBe(Number.NEGATIVE_INFINITY)
    // Round trips at moderate q.
    for (const df of [0.2, 0.7, 1.3, 1.8]) {
      for (const q of [0.24, 0.05, 1e-3, 1e-12]) {
        expectClose(tCdf(tQuantile(q, df), df), q, { rtol: 1e-12 }, `round trip ${q} ${df}`)
      }
    }
  })

  it('lgamma keeps relative accuracy next to its zeros at 1 and 2', () => {
    const xs = [0.99999, 1.0000001, 1.001, 1.999, 1.9999, 2.0000001, 2.001]
    const ref = [
      0.00000577223889609309, -5.772155829918507e-8, -0.0005763935982833062, -0.0004224618006921073,
      -0.00004227520877215346, 4.227843666532498e-8, 0.000423106734800117,
    ]
    xs.forEach((x, i) => {
      expectClose(lgamma(x), ref[i]!, tight, `lgamma(${x})`)
    })
    expect(lgamma(1)).toBe(0)
    expect(lgamma(2)).toBe(0)
  })
})

describe('invariants', () => {
  const dfs = [1, 2, 3.5, 10, 57, 1000]
  const ts = [0, 0.3, 1, 2.2, 4, 12]

  it('t: cdf + sf = 1, symmetry, quantile ∘ cdf round trip', () => {
    for (const df of dfs) {
      for (const t of ts) {
        expectClose(tCdf(t, df) + tSf(t, df), 1, { rtol: 1e-15 }, `sum ${t} ${df}`)
        expect(tCdf(-t, df)).toBe(tSf(t, df))
        const p = tCdf(-t, df)
        if (t > 0) expectClose(tQuantile(p, df), -t, { rtol: 1e-12 }, `round trip ${t} ${df}`)
        expectClose(tQuantile(p, df, false), t, { rtol: 1e-12, atol: 1e-15 }, `upper ${t} ${df}`)
      }
    }
  })

  it('normal: cdf + sf = 1, quantile ∘ cdf round trip', () => {
    for (const z of [-8, -3, -1, -0.2, 0, 0.5, 2, 6]) {
      expectClose(normalCdf(z) + normalSf(z), 1, { rtol: 1e-15 }, `sum ${z}`)
      // Round trip through the smaller tail (the larger one cannot resolve z).
      const back = z <= 0 ? normalQuantile(normalCdf(z)) : normalQuantile(normalSf(z), false)
      expectClose(back, z, { rtol: 1e-13, atol: 1e-15 }, `rt ${z}`)
    }
    expect(normalQuantile(0.5)).toBe(0)
    expect(normalQuantile(0)).toBe(Number.NEGATIVE_INFINITY)
    expect(normalQuantile(1)).toBe(Number.POSITIVE_INFINITY)
    expect(normalQuantile(1.5)).toBeNaN()
  })

  it('F with df1 = 1 is t²; χ² with 2 df is exponential', () => {
    for (const t of [0.5, 1.7, 3]) {
      for (const df of [3, 20]) {
        expectClose(fSf(t * t, 1, df), 2 * tSf(t, df), { rtol: 1e-13 }, `F=t² ${t} ${df}`)
      }
    }
    for (const x of [0.1, 3, 40]) {
      expectClose(chiSqSf(x, 2), Math.exp(-x / 2), { rtol: 1e-14 }, `chisq2 ${x}`)
      expectClose(chiSqCdf(x, 2), -Math.expm1(-x / 2), { rtol: 1e-14 }, `chisq2 cdf ${x}`)
    }
  })

  it('incomplete beta / gamma: complements and closed forms', () => {
    // I_x(a, 1) = x^a; I_x(1, b) = 1 − (1 − x)^b
    for (const x of [1e-5, 0.2, 0.9]) {
      expectClose(betaInc(x, 3.5, 1), x ** 3.5, { rtol: 1e-14 }, `I_x(a,1) ${x}`)
      expectClose(betaIncComplement(x, 1, 4), (1 - x) ** 4, { rtol: 1e-13 }, `I_x(1,b) ${x}`)
      expectClose(betaInc(x, 2, 7) + betaIncComplement(x, 2, 7), 1, { rtol: 1e-15 }, 'sum')
    }
    // P(1, x) = 1 − e^−x
    expectClose(gammaIncUpper(1, 5), Math.exp(-5), { rtol: 1e-14 }, 'Q(1,5)')
    expectClose(gammaIncLower(1, 1e-3), -Math.expm1(-1e-3), { rtol: 1e-14 }, 'P(1,1e-3)')
    expectClose(lbeta(3, 4), Math.log(1 / 60), { rtol: 1e-15 }, 'lbeta(3,4)')
  })

  it('degenerate arguments give NaN or the limit, never throw', () => {
    expect(tSf(Number.NaN, 3)).toBeNaN()
    expect(tSf(1, 0)).toBeNaN()
    expect(tSf(Number.POSITIVE_INFINITY, 3)).toBe(0)
    expect(tCdf(Number.NEGATIVE_INFINITY, 3)).toBe(0)
    expect(tQuantile(0.5, 7)).toBe(0)
    expect(tQuantile(0, 7)).toBe(Number.NEGATIVE_INFINITY)
    expect(fSf(0, 2, 3)).toBe(1)
    expect(fSf(Number.POSITIVE_INFINITY, 2, 3)).toBe(0)
    expect(chiSqSf(0, 4)).toBe(1)
    expect(lgamma(0)).toBe(Number.POSITIVE_INFINITY)
    expect(lgamma(-1)).toBeNaN()
  })
})
