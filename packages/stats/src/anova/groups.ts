import { shifted } from '../arrays.ts'
import { mean, sd as sdOf } from '../descriptive/basic.ts'
import { leastSquares } from '../linalg/leastSquares.ts'

/** Raw values, or summary statistics (for data entered as mean/SD/N). */
export type GroupData = { values: ArrayLike<number> } | { mean: number; sd: number; n: number }

export interface GroupStats {
  n: number
  mean: number
  /** Sample SD (NaN for n < 2 from raw data). */
  sd: number
  sem: number
}

/**
 * n, mean, SD and SEM of a group. Every ANOVA here works from these alone (plus the raw values
 * for rank- and median-based tests), so summary input gives exactly the results of raw data
 * with the same statistics.
 */
export function groupStats(g: GroupData): GroupStats {
  if ('values' in g) {
    const n = g.values.length
    const sd = sdOf(g.values)
    return { n, mean: mean(g.values), sd, sem: sd / Math.sqrt(n) }
  }
  return { n: g.n, mean: g.mean, sd: g.sd, sem: g.sd / Math.sqrt(g.n) }
}

/** (n − 1)·SD², the group's contribution to the within-group sum of squares (0 for n ≤ 1). */
export function withinSS(g: { n: number; sd: number }): number {
  return g.n > 1 ? (g.n - 1) * g.sd * g.sd : 0
}

/**
 * A sum of squares that is zero within rounding — at most ε · SS_total — as exactly 0 (audit 3,
 * S2). Effects fitted as differences of residual SS, and residuals of data with no variation
 * within cells, are left with ~1e-31 of noise; over a zero residual that read F = ∞, P = 0 for
 * an effect that is exactly zero, where 0 / 0 = NaN shows "—".
 */
export function roundedSS(ss: number, ssTotal: number): number {
  return ss <= Number.EPSILON * ssTotal ? 0 : ss
}

/**
 * n-weighted mean of group means, as an offset from the first mean so data with a large common
 * offset keep their precision.
 */
export function weightedGrandMean(groups: readonly { n: number; mean: number }[]): number {
  const used = groups.filter((g) => g.n > 0)
  if (used.length === 0) return Number.NaN
  const c = used[0]!.mean
  let s = 0
  let N = 0
  for (const g of used) {
    s += g.n * (g.mean - c)
    N += g.n
  }
  return c + s / N
}

/**
 * Group statistics of the data shifted by a common constant c (the first value of the first
 * non-empty group, or its mean for summary input). Every ANOVA quantity depends only on
 * differences of means, and for data with a large common offset (1e9 + small noise) each mean
 * is only good to ~1 ulp of the offset — a large relative error in their small differences.
 * The shifted values are exact (Sterbenz) and their means keep full relative accuracy. SDs are
 * unchanged. Summary means are shifted too (exact for nearby means; no precision to recover).
 */
export function centredStats(groups: readonly GroupData[], c = commonShift(groups)): GroupStats[] {
  return groups.map((g) => {
    if ('values' in g) return groupStats({ values: shifted(g.values, c) })
    return { ...groupStats(g), mean: g.mean - c }
  })
}

/** The shift used by centredStats. */
export function commonShift(groups: readonly GroupData[]): number {
  for (const g of groups) {
    if ('values' in g) {
      if (g.values.length > 0) return Number.isFinite(g.values[0]!) ? g.values[0]! : 0
    } else if (g.n > 0) return Number.isFinite(g.mean) ? g.mean : 0
  }
  return 0
}

/**
 * The cells of a factorial ANOVA fitted on data shifted by commonShift (centredStats): `used`
 * are the non-empty cells with their centred means (n, SD and the rest kept), with their total
 * N, n-weighted grand mean, pooled within-cell SS and corrected total SS.
 */
export function cellSummary<T extends { n: number; mean: number; sd: number }>(
  cells: readonly T[],
  input: readonly GroupData[],
) {
  const shift = commonShift(input)
  const centred = centredStats(input, shift)
  const used = cells.map((c, i) => ({ ...c, mean: centred[i]!.mean })).filter((c) => c.n > 0)
  const N = used.reduce((s, c) => s + c.n, 0)
  const grand = weightedGrandMean(used)
  let ssWithin = 0
  let ssBetween = 0
  for (const c of used) {
    ssWithin += withinSS(c)
    ssBetween += c.n * (c.mean - grand) ** 2
  }
  return { shift, used, N, grand, ssWithin, ssTotal: ssWithin + ssBetween }
}

/** Weighted least squares (weights n) of the cell means less `centre` on their design rows. */
export function fitCellMeans(
  rows: readonly number[][],
  cells: readonly { n: number; mean: number }[],
  centre: number,
) {
  const p = rows[0]!.length
  const X = new Float64Array(cells.length * p)
  rows.forEach((r, i) => {
    X.set(r, i * p)
  })
  const y = new Float64Array(cells.length)
  const w = new Float64Array(cells.length)
  for (let i = 0; i < cells.length; i++) {
    y[i] = cells[i]!.mean - centre
    w[i] = cells[i]!.n
  }
  return leastSquares(X, cells.length, p, y, w)
}
