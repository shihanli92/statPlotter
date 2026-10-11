/**
 * Frequency distributions (with the usual algorithm for the automatic bin width):
 *
 * - Bins of equal width w, the first centred at c₀; bin i covers [c₀ + (i − ½)w, c₀ + (i + ½)w).
 *   "A point on the border goes with the bin holding the larger values"; values below the
 *   first bin are omitted (only possible with a first centre you set), as are values above an
 *   upper limit you set.
 * - Automatic width: per data set, (max − min)/(1 + log₂ n); the mean over the data
 *   sets; rounded down to a "nice" value; if every value is an integer, rounded down to an
 *   integer (1 if that would give 0). "Nice" is our reading of "a value whose last digit (in
 *   scientific notation) ends with 0, 2, or 5": two significant digits, the second one
 *   lowered to 0, 2 or 5 (3.7 → 3.5, 0.0461 → 0.045, 1.13 → 1.0).
 * - Automatic first centre: not documented. Here the multiple of w nearest the
 *   smallest value (c₀ = w·⌊min/w + ½⌋), so bin edges fall on odd multiples of w/2 and every
 *   value is in a bin.
 */

/** Largest "nice" number ≤ w: d₁.d₂ × 10^e with d₂ ∈ {0, 2, 5}. */
export function niceFloor(w: number): number {
  if (!(w > 0) || !Number.isFinite(w)) return Number.NaN
  let e = Math.floor(Math.log10(w))
  // log10 can be off by one ulp near powers of ten.
  if (10 ** e > w) e--
  else if (10 ** (e + 1) <= w) e++
  // Exact powers of ten on both sides, so 3.5 comes out as 3.5.
  const up = e - 1 >= 0 ? 10 ** (e - 1) : 1
  const down = e - 1 < 0 ? 10 ** (1 - e) : 1
  // Two significant digits, as an integer 10..99 (tolerating rounding just below an integer).
  let two = Math.floor((w * down) / up + 1e-9)
  if (two > 99) two = 99
  const d2 = two % 10
  const lowered = d2 >= 5 ? 5 : d2 >= 2 ? 2 : 0
  two = two - d2 + lowered
  return (two * up) / down
}

/** The automatic bin width for these data sets (values: finite numbers). */
export function autoBinWidth(dataSets: readonly (readonly number[])[]): number {
  const widths: number[] = []
  let integers = true
  for (const v of dataSets) {
    if (!v.length) continue
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const x of v) {
      if (x < lo) lo = x
      if (x > hi) hi = x
      if (!Number.isInteger(x)) integers = false
    }
    widths.push((hi - lo) / (1 + Math.log2(v.length)))
  }
  if (!widths.length) return Number.NaN
  const mean = widths.reduce((s, x) => s + x, 0) / widths.length
  let w = mean > 0 ? niceFloor(mean) : 1
  if (integers) w = Math.max(1, Math.floor(w))
  return w
}

export interface FrequencyOptions {
  /** Bin width (default automatic). */
  binWidth?: number
  /** Centre of the first bin (default: the multiple of the width nearest the smallest value). */
  firstCenter?: number
  /** Values above this are omitted. */
  upperLimit?: number
  /** At most this many bins (default 10 000). */
  maxBins?: number
}

export interface FrequencyResult {
  binWidth: number
  firstCenter: number
  centers: number[]
  /** counts[d][i]: values of data set d in bin i. */
  counts: number[][]
  /** Values of each data set placed in a bin. */
  tabulated: number[]
  /** Values below the first bin / above the upper limit, per data set. */
  below: number[]
  above: number[]
  error?: 'no-values' | 'bad-width' | 'too-many-bins'
}

/** Index of the bin holding x (edges go to the higher bin), bins starting at `lo`. */
export function binIndex(x: number, lo: number, w: number): number {
  let i = Math.floor((x - lo) / w)
  // Correct floating-point rounding at the edges.
  if (x >= lo + (i + 1) * w) i++
  else if (x < lo + i * w) i--
  return i
}

export function frequencyDistribution(
  dataSets: readonly (readonly number[])[],
  opts: FrequencyOptions = {},
): FrequencyResult {
  const all = dataSets.flat()
  const empty = (error: FrequencyResult['error']): FrequencyResult => ({
    binWidth: Number.NaN,
    firstCenter: Number.NaN,
    centers: [],
    counts: dataSets.map(() => []),
    tabulated: dataSets.map(() => 0),
    below: dataSets.map(() => 0),
    above: dataSets.map(() => 0),
    error,
  })
  if (!all.length) return empty('no-values')
  const w = opts.binWidth ?? autoBinWidth(dataSets)
  if (!(w > 0) || !Number.isFinite(w)) return empty('bad-width')
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const x of all) {
    if (x < min) min = x
    if (x > max) max = x
  }
  const c0 = opts.firstCenter ?? w * Math.floor(min / w + 0.5)
  const lo = c0 - w / 2
  const top = opts.upperLimit !== undefined ? Math.min(max, opts.upperLimit) : max
  const last = binIndex(top, lo, w)
  const nBins = Math.max(0, last + 1)
  if (nBins > (opts.maxBins ?? 10000))
    return { ...empty('too-many-bins'), binWidth: w, firstCenter: c0 }
  const counts = dataSets.map(() => new Array<number>(nBins).fill(0))
  const tabulated = dataSets.map(() => 0)
  const below = dataSets.map(() => 0)
  const above = dataSets.map(() => 0)
  dataSets.forEach((v, d) => {
    for (const x of v) {
      if (opts.upperLimit !== undefined && x > opts.upperLimit) {
        above[d]!++
        continue
      }
      const i = binIndex(x, lo, w)
      if (i < 0) below[d]!++
      else if (i >= nBins) above[d]!++
      else {
        counts[d]![i]!++
        tabulated[d]!++
      }
    }
  })
  const centers = Array.from({ length: nBins }, (_, i) => c0 + i * w)
  return { binWidth: w, firstCenter: c0, centers, counts, tabulated, below, above }
}

/** What a histogram's bars measure: the values in each bin, or their share of the data set's. */
export type BinMeasure = 'count' | 'percent' | 'fraction'

export interface HistogramResult extends FrequencyResult {
  /** values[d][i]: data set d's count in bin i, or its percent or fraction of the values binned. */
  values: number[][]
}

/**
 * A histogram's bars (the graphs' `bin` stat, roadmap 33d): the data sets in shared bins, as the
 * frequency distribution bins them (the automatic width unless one is given), each bin's
 * count or its share of the data set's values tabulated (as the analysis' relative frequencies).
 */
export function histogram(
  dataSets: readonly (readonly number[])[],
  opts: FrequencyOptions & { measure?: BinMeasure } = {},
): HistogramResult {
  const fd = frequencyDistribution(dataSets, opts)
  const measure = opts.measure ?? 'count'
  const scale = measure === 'percent' ? 100 : 1
  const values = fd.counts.map((c, d) => {
    if (measure === 'count') return [...c]
    const total = fd.tabulated[d]!
    return c.map((v) => (total > 0 ? (scale * v) / total : Number.NaN))
  })
  return { ...fd, values }
}

/** Running sums of each row of counts. */
export function cumulative(counts: readonly number[]): number[] {
  let s = 0
  return counts.map((c) => {
    s += c
    return s
  })
}
