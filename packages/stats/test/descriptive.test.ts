import { describe, expect, it } from 'vitest'
import {
  cv,
  describe as describeStats,
  geometricMean,
  geometricMeanCI,
  geometricSdFactor,
  kurtosis,
  max,
  mean,
  meanCI,
  median,
  min,
  quantile,
  range,
  sd,
  sem,
  skewness,
  sum,
  variance,
} from '../src/index.ts'
import { expectClose, loadFixture, loadFixtures, lre } from './oracle.ts'

interface In {
  values: number[]
}

interface Expected extends Record<string, number | number[]> {
  n: number
  probs: number[]
  quantiles: number[]
}

/** Statistics where R's plain two-pass formulas limit agreement to ~1e-12 (mixed magnitudes). */
const LOOSE = new Set(['sd', 'sem', 'ciLo', 'ciHi', 'cv', 'geoSdFactor', 'geoCiLo', 'geoCiHi'])

describe('descriptive vs R', () => {
  const fixtures = loadFixtures<In, Expected>('descriptive')
  for (const f of fixtures) {
    it(f.name, () => {
      const x = f.input.values
      const level = (f.params.level as number | undefined) ?? 0.95
      expect(x.length).toBe(f.expected.n)
      const d = describeStats(x, level)
      for (const [k, v] of Object.entries(d)) {
        const tol = LOOSE.has(k) ? { rtol: 1e-12, ...f.tol } : f.tol
        expectClose(v, f.expected[k] as number, tol, k)
      }
      // The standalone functions agree with describe().
      expect(mean(x)).toBe(d.mean)
      expect(sd(x)).toBe(d.sd)
      expect(sem(x)).toBe(d.sem)
      expect(min(x)).toBe(d.min)
      expect(max(x)).toBe(d.max)
      expect(range(x)).toBe(d.range)
      expect(median(x)).toBe(d.median)
      expect(cv(x)).toBe(d.cv)
      expect(skewness(x)).toBe(d.skewness)
      expect(kurtosis(x)).toBe(d.kurtosis)
      expect(geometricMean(x)).toBe(d.geoMean)
      expect(geometricSdFactor(x)).toBe(d.geoSdFactor)
      expect(meanCI(x, level)).toEqual({ lo: d.ciLo, hi: d.ciHi })
      expect(geometricMeanCI(x, level)).toEqual({ lo: d.geoCiLo, hi: d.geoCiHi })
      f.expected.probs.forEach((p, i) => {
        expectClose(quantile(x, p), f.expected.quantiles[i]!, f.tol, `quantile(${p})`)
      })
    })
  }
})

/**
 * NIST StRD certified values have 15 significant digits. Minimum LRE (correct significant
 * digits) we require per statistic; NIST considers ≥ 9–10 good for the harder sets, and the
 * NumAcc3/4 inputs themselves are only representable to ~9–10 digits of their deviations.
 */
const MIN_LRE: Record<string, { mean: number; sd: number }> = {
  NumAcc3: { mean: 15, sd: 9 },
  NumAcc4: { mean: 15, sd: 8 },
}
const DEFAULT_MIN_LRE = { mean: 15, sd: 13 }

describe('descriptive vs NIST StRD univariate', () => {
  const fixtures = loadFixtures<In, { n: number; mean: number; sd: number }>('nist/univariate')
  for (const f of fixtures) {
    const min = MIN_LRE[f.name] ?? DEFAULT_MIN_LRE
    it(`${f.name} (mean LRE ≥ ${min.mean}, sd LRE ≥ ${min.sd})`, () => {
      const x = f.input.values
      expect(x.length).toBe(f.expected.n)
      expect(lre(mean(x), f.expected.mean)).toBeGreaterThanOrEqual(min.mean)
      expect(lre(sd(x), f.expected.sd)).toBeGreaterThanOrEqual(min.sd)
    })
  }
})

describe('edge cases', () => {
  it('empty and single-value inputs', () => {
    expect(mean([])).toBeNaN()
    expect(mean([3])).toBe(3)
    expect(variance([3])).toBeNaN()
    expect(sd([])).toBeNaN()
  })

  it('matches the exact SD where R loses precision (large offset, tiny spread)', () => {
    const f = loadFixture<In>('descriptive', 'gen_offset_1e9')
    // Exact SD of these doubles, computed with rational arithmetic (Python fractions, 40 digits):
    // 0.0008377068488122077672755703363571579197498
    expectClose(sd(f.input.values), 0.0008377068488122078, { rtol: 1e-15 }, 'sd')
  })

  it('SD and variance at extreme magnitudes: deviations scaled before squaring (audit 3, S4)', () => {
    const x = [1.5, 2.25, 4, 3.125, 0.75]
    const s = sd(x)
    const v = variance(x)
    for (const k of [2 ** -700, 1e-200, 1e-165, 1e160, 1e200, 2 ** 700]) {
      const y = x.map((a) => a * k)
      expectClose(sd(y), s * k, { rtol: 1e-15 }, `sd × ${k}`)
      // The variance itself is exact where representable (here: down to the subnormals).
      if (k >= 1e-150 && k <= 1e150)
        expectClose(variance(y), v * k * k, { rtol: 1e-15 }, `var × ${k}`)
    }
    expectClose(variance(x.map((a) => a * 1e150)), v * 1e300, { rtol: 1e-15 }, 'var × 1e150')
    expect(variance(x.map((a) => a * 1e160))).toBe(Number.POSITIVE_INFINITY)
  })

  it('skewness and kurtosis are shift-invariant to full precision (1e9 offset)', () => {
    const x = loadFixture<In>('descriptive', 'gen_offset_1e9').input.values
    const shifted = x.map((v) => v - 1e9) // exact (Sterbenz)
    expectClose(skewness(x), skewness(shifted), { rtol: 1e-12 }, 'skewness')
    expectClose(kurtosis(x), kurtosis(shifted), { rtol: 1e-12 }, 'kurtosis')
  })

  it('quantile clamps outside [1/(n+1), n/(n+1)] and handles tiny inputs', () => {
    expect(quantile([3, 1, 2], 0)).toBe(1)
    expect(quantile([3, 1, 2], 0.2)).toBe(1)
    expect(quantile([3, 1, 2], 0.8)).toBe(3)
    expect(quantile([3, 1, 2], 1)).toBe(3)
    expect(quantile([5], 0.3)).toBe(5)
    expect(quantile([], 0.5)).toBeNaN()
    expect(quantile([1, 2], 1.5)).toBeNaN()
  })

  it('geometric statistics are NaN with a non-positive value; moments NaN for small n', () => {
    expect(geometricMean([1, 0, 2])).toBeNaN()
    expect(geometricMeanCI([1, -1, 2]).lo).toBeNaN()
    expect(skewness([1, 2])).toBeNaN()
    expect(kurtosis([1, 2, 3])).toBeNaN()
    expect(skewness([4, 4, 4, 4])).toBeNaN()
  })

  it('constant values have exactly zero variance', () => {
    expect(variance([0.1, 0.1, 0.1, 0.1, 0.1])).toBe(0)
  })

  it('compensated sum survives catastrophic cancellation', () => {
    expect(sum([1e100, 1, -1e100])).toBe(1)
    expect(sum(Array.from({ length: 10 }, () => 0.1))).toBe(1)
  })
})
