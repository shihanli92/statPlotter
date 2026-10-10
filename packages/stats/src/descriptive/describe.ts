import { sum } from '../summation.ts'
import { mean, sd } from './basic.ts'
import { geometricMean, geometricMeanCI, geometricSdFactor, meanCI } from './interval.ts'
import { kurtosis, skewness } from './moments.ts'
import { quantileSorted, sortAscending } from './quantile.ts'

export interface Description {
  n: number
  min: number
  q1: number
  median: number
  q3: number
  max: number
  range: number
  mean: number
  sd: number
  sem: number
  ciLo: number
  ciHi: number
  /** sd / mean, as a fraction. */
  cv: number
  skewness: number
  /** Excess kurtosis. */
  kurtosis: number
  sum: number
  /** Geometric statistics are NaN if any value is ≤ 0. */
  geoMean: number
  geoSdFactor: number
  geoCiLo: number
  geoCiHi: number
}

/**
 * The column statistics table: every descriptive statistic for one set of values. Quartiles
 * are type 6 quantiles (see quantile.ts); the CI is two-sided at `level`.
 */
export function describe(x: ArrayLike<number>, level = 0.95): Description {
  const n = x.length
  const s = sortAscending(x)
  const m = mean(x)
  const sdev = sd(x)
  const ci = meanCI(x, level)
  const gci = geometricMeanCI(x, level)
  const lo = n > 0 ? s[0]! : Number.NaN
  const hi = n > 0 ? s[n - 1]! : Number.NaN
  return {
    n,
    min: lo,
    q1: quantileSorted(s, 0.25),
    median: quantileSorted(s, 0.5),
    q3: quantileSorted(s, 0.75),
    max: hi,
    range: hi - lo,
    mean: m,
    sd: sdev,
    sem: sdev / Math.sqrt(n),
    ciLo: ci.lo,
    ciHi: ci.hi,
    cv: sdev / m,
    skewness: skewness(x),
    kurtosis: kurtosis(x),
    sum: sum(x),
    geoMean: geometricMean(x),
    geoSdFactor: geometricSdFactor(x),
    geoCiLo: gci.lo,
    geoCiHi: gci.hi,
  }
}
