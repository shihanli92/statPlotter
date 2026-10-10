// Kernel density estimates, as violin plots draw them (roadmap 33: moved from the graph package,
// oracle suite `graphstats`). The bandwidth is R's `bw.nrd0` (Silverman's rule of thumb, the
// default of R's `density()` and of ggplot2's violins); the Gaussian density is evaluated exactly
// (a direct sum, not R's binned FFT approximation).

import { quantileSorted7, sortAscending } from '../descriptive/quantile.ts'

/**
 * The sample standard deviation (n − 1) the bandwidth rules use (`bw.nrd0` here, `bandwidth.nrd`
 * in kde2d.ts): the plain two-pass sum, mean first. NaN for fewer than two values. (`sd` of
 * `descriptive/basic.ts` corrects the mean's rounding error and so can differ in the last bit,
 * which would move the bandwidths, and the violins and densities drawn, by as much.)
 */
export function bandwidthSd(x: ArrayLike<number>): number {
  const n = x.length
  if (n < 2) return Number.NaN
  let m = 0
  for (let i = 0; i < n; i++) m += x[i]!
  m /= n
  let s = 0
  for (let i = 0; i < n; i++) s += (x[i]! - m) ** 2
  return Math.sqrt(s / (n - 1))
}

/**
 * Silverman's rule-of-thumb bandwidth, as R's `bw.nrd0`: 0.9 · min(SD, IQR / 1.34) · n^−1/5,
 * falling back to the SD, then |x₁|, then 1 when the spread is zero.
 */
export function bandwidthNrd0(values: readonly number[]): number {
  const n = values.length
  if (n < 1) return Number.NaN
  const sorted = sortAscending(values)
  const sd = n > 1 ? bandwidthSd(sorted) : 0
  const iqr = n > 1 ? quantileSorted7(sorted, 0.75) - quantileSorted7(sorted, 0.25) : 0
  let lo = Math.min(sd, iqr / 1.34)
  if (!lo) lo = sd || Math.abs(values[0]!) || 1
  return 0.9 * lo * n ** -0.2
}

/** Gaussian kernel density of `values` with bandwidth `bw` at `at`. */
export function kernelDensity(values: readonly number[], bw: number, at: number): number {
  const n = values.length
  if (!n || !(bw > 0)) return 0
  let sum = 0
  for (const v of values) {
    const z = (at - v) / bw
    sum += Math.exp(-0.5 * z * z)
  }
  return sum / (n * bw * Math.sqrt(2 * Math.PI))
}
