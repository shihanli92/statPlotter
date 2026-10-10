/**
 * Sample quantiles by R's type 6 definition (Hyndman & Fan 1996): position h = (n + 1) p in
 * the sorted data, linearly interpolated, clamped to the min / max outside [1, n]. This is
 * the definition of Excel's PERCENTILE.EXC and Minitab; with p = ½ it is the usual median.
 */

/** Numbers within this of an integer position count as exact (as R does, 4 ε). */
const FUZZ = 4 * Number.EPSILON

/** Ascending copy of x. */
export function sortAscending(x: ArrayLike<number>): Float64Array {
  return Float64Array.from(x).sort()
}

/** Type 6 quantile of already-sorted data. */
export function quantileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length
  if (n === 0 || !(p >= 0 && p <= 1)) return Number.NaN
  const nppm = p * (n + 1)
  const j = Math.floor(nppm + FUZZ)
  let h = nppm - j
  if (Math.abs(h) < FUZZ) h = 0
  // 1-based order statistic k, clamped to [1, n]
  const at = (k: number) => sorted[Math.min(Math.max(k, 1), n) - 1]!
  const lo = at(j)
  const hi = at(j + 1)
  if (h === 1) return hi
  // Same arithmetic as R, so results agree to the last bit.
  if (h > 0 && h < 1 && lo !== hi) return (1 - h) * lo + h * hi
  return lo
}

/**
 * Type 7 quantile of already-sorted data (R's default `quantile(type = 7)`, used by the bandwidth
 * rules and the density levels): position h = 1 + (n − 1) p, interpolated as R does,
 * (1 − g) x(j) + g x(j + 1) with j = ⌊h⌋ and g = h − j, and x(j) itself when g is 0 or the two
 * are equal. NaN for no values.
 */
export function quantileSorted7(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length
  if (n === 0) return Number.NaN
  const index = 1 + (n - 1) * p
  const lo = Math.floor(index)
  const hi = Math.ceil(index)
  const q = sorted[lo - 1]!
  const h = index - lo
  return index > lo && sorted[hi - 1] !== q ? (1 - h) * q + h * sorted[hi - 1]! : q
}

/** Type 6 sample quantile of x at probability p ∈ [0, 1]. */
export function quantile(x: ArrayLike<number>, p: number): number {
  return quantileSorted(sortAscending(x), p)
}

export function median(x: ArrayLike<number>): number {
  return quantile(x, 0.5)
}
