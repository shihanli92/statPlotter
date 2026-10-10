import { tQuantile } from '../dist/t.ts'
import { mean, sd, sem } from './basic.ts'

export interface Interval {
  lo: number
  hi: number
}

/** Two-sided t critical value for a confidence level, as R's t.test forms it. */
export function tCritical(level: number, df: number): number {
  const alpha = 1 - level
  return tQuantile(1 - alpha / 2, df)
}

/** Two-sided confidence interval of the mean: mean ± t_{(1+level)/2, n−1} · SEM. */
export function meanCI(x: ArrayLike<number>, level = 0.95): Interval {
  const n = x.length
  if (n < 2) return { lo: Number.NaN, hi: Number.NaN }
  const m = mean(x)
  const h = tCritical(level, n - 1) * sem(x)
  return { lo: m - h, hi: m + h }
}

/** Natural logs, or null if any value is ≤ 0 (geometric statistics undefined). */
function logs(x: ArrayLike<number>): Float64Array | null {
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) {
    if (!(x[i]! > 0)) return null
    out[i] = Math.log(x[i]!)
  }
  return out
}

/** exp(mean(ln x)); NaN if any value ≤ 0. */
export function geometricMean(x: ArrayLike<number>): number {
  const l = logs(x)
  return l ? Math.exp(mean(l)) : Number.NaN
}

/** Geometric SD factor exp(sd(ln x)) (multiply/divide the geometric mean by it). */
export function geometricSdFactor(x: ArrayLike<number>): number {
  const l = logs(x)
  return l ? Math.exp(sd(l)) : Number.NaN
}

/** CI of the geometric mean: the t interval of mean(ln x), back-transformed. */
export function geometricMeanCI(x: ArrayLike<number>, level = 0.95): Interval {
  const l = logs(x)
  if (!l) return { lo: Number.NaN, hi: Number.NaN }
  const ci = meanCI(l, level)
  return { lo: Math.exp(ci.lo), hi: Math.exp(ci.hi) }
}
