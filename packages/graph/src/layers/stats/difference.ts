import { tQuantile } from '@ps/stats'
import type { GraphSeries, PlotStats } from '../../data.ts'

// The `difference` stat (estimation plots): each data set's mean minus the first's (the
// control), with the CI of the unpaired t test or Welch's (`tQuantile`, oracle suite `ttest`).

/** One difference of an estimation plot: a data set's mean minus the control's, with its CI. */
export interface EstimationDiff {
  /** Index of the data set (in the graph's series) whose difference this is. */
  index: number
  key: string
  diff: number
  /** CI of the difference (NaN when it can't be computed, e.g. n < 2). */
  lo: number
  hi: number
  /** Means of the control (first data set) and of this data set. */
  control: number
  mean: number
}

/**
 * The differences an estimation plot shows: every data set's mean minus the first's (the
 * control), with the confidence interval of the unpaired t test (pooled SD) or Welch's
 * (unequal SDs). Works from raw values or entered mean/SD/N. Not adjusted for multiplicity.
 */
export function estimationDiffs(
  series: readonly { s: Pick<GraphSeries, 'key'>; stats: PlotStats }[],
  welch: boolean,
  conf: number,
): EstimationDiff[] {
  const c = series[0]
  if (!c) return []
  const a = c.stats
  return series.slice(1).map((p, j) => {
    const b = p.stats
    const diff = b.mean - a.mean
    const [va, vb] = [a.sd ** 2, b.sd ** 2]
    let se: number
    let df: number
    if (welch) {
      const [qa, qb] = [va / a.n, vb / b.n]
      se = Math.sqrt(qa + qb)
      df = (qa + qb) ** 2 / (qa ** 2 / (a.n - 1) + qb ** 2 / (b.n - 1))
    } else {
      df = a.n + b.n - 2
      se = Math.sqrt((((a.n - 1) * va + (b.n - 1) * vb) / df) * (1 / a.n + 1 / b.n))
    }
    const half = Number.isFinite(se) && df > 0 ? tQuantile((1 + conf) / 2, df) * se : Number.NaN
    return {
      index: j + 1,
      key: p.s.key,
      diff,
      lo: diff - half,
      hi: diff + half,
      control: a.mean,
      mean: b.mean,
    }
  })
}

/**
 * The grand mean of a column graph (roadmap 30): the mean of every value of its data sets, or,
 * for entered means, their mean weighted by N. NaN when there are none.
 */
export function grandMeanOf(series: readonly { stats: PlotStats }[]): number {
  let sum = 0
  let n = 0
  for (const { stats: s } of series) {
    if (s.raw) {
      for (const p of s.points) sum += p.value
      n += s.points.length
    } else if (Number.isFinite(s.mean) && s.n > 0) {
      sum += s.mean * s.n
      n += s.n
    }
  }
  return n > 0 ? sum / n : Number.NaN
}
