import { fSf } from '../dist/f.ts'
import { centredStats, type GroupData, weightedGrandMean, withinSS } from './groups.ts'

/**
 * Post-test for linear trend after one-way ANOVA. Groups are in column order, scored 1, 2, …, k.
 *
 * - Slope: unweighted linear regression of the column means on the column number ("each column
 *   gets the same weight, even if you've entered more values into some columns").
 * - The between-groups variation is split into a linear part and the rest ("when calculating the
 *   P value and R², every value counts"): SS_linear is the regression SS of all the values on
 *   their column number, (Σ n_j (x_j − x̄)(ȳ_j))² / Σ n_j (x_j − x̄)², x̄ the n-weighted mean score.
 *   F = SS_linear / MS_within with (1, N − k) df.
 * - Effect size R² = SS_linear / SS_total; alerting R² = SS_linear / SS_between.
 * - Nonlinear variation: SS_between − SS_linear with k − 2 df, F = MS_nonlinear / MS_within
 *   (reported with four or more groups).
 *
 * Empty groups take no part (their score is still their column number).
 */
export interface LinearTrend {
  slope: number
  ssLinear: number
  F: number
  dfn: number
  dfd: number
  p: number
  r2Effect: number
  r2Alerting: number
  nonlinear: { ss: number; df: number; F: number; p: number }
}

export function linearTrend(groups: readonly GroupData[]): LinearTrend {
  const stats = centredStats(groups)
  const used = stats.map((g, j) => ({ ...g, x: j + 1 })).filter((g) => g.n > 0)
  const k = used.length
  const N = used.reduce((s, g) => s + g.n, 0)
  // Slope of means on column number, unweighted.
  const mx = used.reduce((s, g) => s + g.x, 0) / k
  const my = used.reduce((s, g) => s + g.mean, 0) / k
  let sxy = 0
  let sxx = 0
  for (const g of used) {
    sxy += (g.x - mx) * (g.mean - my)
    sxx += (g.x - mx) ** 2
  }
  const slope = sxy / sxx
  // Weighted (every value counts).
  const xw = used.reduce((s, g) => s + g.n * g.x, 0) / N
  const grand = weightedGrandMean(used)
  let num = 0
  let den = 0
  let ssBetween = 0
  let ssWithin = 0
  for (const g of used) {
    num += g.n * (g.x - xw) * (g.mean - grand)
    den += g.n * (g.x - xw) ** 2
    ssBetween += g.n * (g.mean - grand) ** 2
    ssWithin += withinSS(g)
  }
  const ssLinear = (num * num) / den
  const dfd = N - k
  const msWithin = ssWithin / dfd
  const F = ssLinear / msWithin
  const nlDf = k - 2
  const nlSS = nlDf > 0 ? Math.max(0, ssBetween - ssLinear) : 0
  const nlF = nlDf > 0 ? nlSS / nlDf / msWithin : Number.NaN
  return {
    slope,
    ssLinear,
    F,
    dfn: 1,
    dfd,
    p: fSf(F, 1, dfd),
    r2Effect: ssLinear / (ssBetween + ssWithin),
    r2Alerting: ssLinear / ssBetween,
    nonlinear: { ss: nlSS, df: nlDf, F: nlF, p: nlDf > 0 ? fSf(nlF, nlDf, dfd) : Number.NaN },
  }
}
