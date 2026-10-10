import { describe, expect, it } from 'vitest'
import { binomPmf, kolmogorovSf, normalCdf, Random, substream, tCdf } from '../src/index.ts'

// Seeded random numbers for simulations (roadmap 20). No R oracle: R's generators differ, so
// the tests check reproducibility and the distributions (Kolmogorov-Smirnov and chi-square
// goodness of fit on large samples, at levels that a correct generator fails once in ~10⁴ runs;
// the seeds are fixed, so the tests are deterministic).

const N = 50_000

/** P value of the one-sample Kolmogorov-Smirnov test of the sample against a CDF. */
function ksP(sample: number[], cdf: (x: number) => number): number {
  const s = [...sample].sort((a, b) => a - b)
  let d = 0
  s.forEach((x, i) => {
    const f = cdf(x)
    d = Math.max(d, Math.abs(f - i / s.length), Math.abs(f - (i + 1) / s.length))
  })
  return kolmogorovSf(Math.sqrt(s.length) * d)
}

/** Chi-square goodness of fit of counts to a pmf (cells with expected < 5 pooled at the tails). */
function chiSqStat(sample: number[], pmf: (k: number) => number): { stat: number; df: number } {
  const counts = new Map<number, number>()
  for (const k of sample) counts.set(k, (counts.get(k) ?? 0) + 1)
  const ks = [...counts.keys()].sort((a, b) => a - b)
  const lo = ks[0]!
  const hi = ks[ks.length - 1]!
  let stat = 0
  let df = -1
  let obs = 0
  let exp = 0
  for (let k = lo; k <= hi; k++) {
    obs += counts.get(k) ?? 0
    exp += sample.length * pmf(k)
    if (exp >= 5) {
      stat += (obs - exp) ** 2 / exp
      df++
      obs = 0
      exp = 0
    }
  }
  return { stat, df }
}

describe('Random', () => {
  it('is reproducible from its seed and differs between seeds and substreams', () => {
    const a = new Random(42)
    const b = new Random(42)
    const c = new Random(43)
    const xa = Array.from({ length: 5 }, () => a.uniform())
    expect(Array.from({ length: 5 }, () => b.uniform())).toEqual(xa)
    expect(Array.from({ length: 5 }, () => c.uniform())).not.toEqual(xa)
    // Pinned: a change of generator must be deliberate (it changes every saved simulation).
    const p = new Random(1)
    expect([p.nextUint32(), p.nextUint32(), p.nextUint32()]).toEqual([
      813387329, 1693331366, 3865924968,
    ])
    expect(p.uniform()).toBe(0.6803831227179212)
    expect(p.normal()).toBe(0.39635750869561354)
    expect([substream(1, 0), substream(1, 1)]).toEqual([188589067, 1093966785])
    const seeds = new Set(Array.from({ length: 1000 }, (_, i) => substream(7, i)))
    expect(seeds.size).toBe(1000)
    expect(substream(7, 3)).toBe(substream(7, 3))
  })

  it('uniforms are uniform on (0, 1)', () => {
    const r = new Random(1)
    const u = Array.from({ length: N }, () => r.uniform())
    expect(Math.min(...u)).toBeGreaterThan(0)
    expect(Math.max(...u)).toBeLessThan(1)
    expect(ksP(u, (x) => x)).toBeGreaterThan(1e-4)
  })

  it('normal deviates are standard normal', () => {
    const r = new Random(2)
    const z = Array.from({ length: N }, () => r.normal())
    expect(ksP(z, normalCdf)).toBeGreaterThan(1e-4)
    const m = z.reduce((a, b) => a + b, 0) / N
    expect(Math.abs(m)).toBeLessThan(4 / Math.sqrt(N))
  })

  it('t deviates follow Student’s t (and df 1, the Cauchy)', () => {
    for (const df of [1, 4, 30]) {
      const r = new Random(3 + df)
      const t = Array.from({ length: N }, () => r.t(df))
      expect(
        ksP(t, (x) => tCdf(x, df)),
        `df ${df}`,
      ).toBeGreaterThan(1e-4)
    }
  })

  it('Poisson deviates follow the Poisson distribution', () => {
    for (const mean of [0.3, 4, 37.5, 900]) {
      const r = new Random(11)
      const x = Array.from({ length: N }, () => r.poisson(mean))
      expect(x.every(Number.isInteger)).toBe(true)
      const lf = (k: number) =>
        k < 0 ? 0 : Math.exp(-mean + k * Math.log(mean) - lgammaInt(k + 1))
      const { stat, df } = chiSqStat(x, lf)
      // chi-square P > 1e-4: stat below the 1 − 1e-4 quantile (≈ df + 3.7·√(2df) + 12).
      expect(stat, `mean ${mean}`).toBeLessThan(df + 3.7 * Math.sqrt(2 * df) + 12)
    }
    expect(new Random(1).poisson(0)).toBe(0)
  })

  it('binomial deviates follow the binomial distribution', () => {
    for (const [n, p] of [
      [10, 0.3],
      [200, 0.02],
      [1000, 0.6],
    ] as const) {
      const r = new Random(12)
      const x = Array.from({ length: N }, () => r.binomial(n, p))
      const { stat, df } = chiSqStat(x, (k) => (k < 0 || k > n ? 0 : binomPmf(k, n, p)))
      expect(stat, `${n}, ${p}`).toBeLessThan(df + 3.7 * Math.sqrt(2 * df) + 12)
    }
    expect(new Random(1).binomial(5, 0)).toBe(0)
    expect(new Random(1).binomial(5, 1)).toBe(5)
  })
})

function lgammaInt(n: number): number {
  let s = 0
  for (let k = 2; k < n; k++) s += Math.log(k)
  return s
}
