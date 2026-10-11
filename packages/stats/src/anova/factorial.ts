import { fSf } from '../dist/f.ts'
import { designRow, subsets, termWidth } from './coding.ts'
import { cellSummary, fitCellMeans, type GroupData, groupStats, roundedSS } from './groups.ts'

/**
 * Full-factorial ANOVA (ordinary, between-subjects factors) for any number of factors, from cells
 * that may have unequal n; used for the three-way ANOVA (2 × 2 × k).
 *
 * As `twoWayAnova`: every cell is reduced to (n, mean, SD) — raw and summary input give the same
 * results — the residual SS is the pooled within-cell Σ (n − 1)·SD² with df N − (number of
 * cells), and the effects are fitted by weighted least squares on the cell means (weights n) with
 * effect (sum-to-zero) coding. Sums of squares are Type III: the increase in the residual SS when
 * one term's columns are dropped from the full model (car::Anova(type = 3) with contr.sum; Type
 * III is the usual choice for unbalanced data). Every combination of levels must have data.
 *
 * Terms are listed main effects first, then two-way interactions, …, the full interaction last,
 * each in factor order (for three factors: A, B, C, A×B, A×C, B×C, A×B×C), then Residual.
 * Percent of total variation = 100·SS / SS_total (corrected total).
 */

/** A cell: the level index of each factor (0-based) and its data. */
export type FactorialInput = { levels: readonly number[] } & GroupData

export interface FactorialSource {
  /** Factor indices in the term (empty for Residual). */
  factors: number[]
  residual: boolean
  ss: number
  df: number
  ms: number
  F: number
  p: number
  pctOfTotal: number
}

export interface FactorialResult {
  sources: FactorialSource[]
  ssTotal: number
  N: number
  mse: number
  dfResidual: number
  /** Cells in input order, with their statistics. */
  cells: { levels: number[]; n: number; mean: number; sd: number }[]
  /** Least-squares marginal means of each factor's levels. */
  marginalMeans: number[][]
  balanced: boolean
  error?: 'empty-cells' | 'no-residual-df'
}

/** All non-empty subsets of {0..k−1}, ordered by size, then lexicographically. */
function factorialTerms(k: number): number[][] {
  return subsets(Array.from({ length: k }, (_, f) => f))
    .slice(1)
    .sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()))
}

export function factorialAnova(
  input: readonly FactorialInput[],
  nLevels: readonly number[],
): FactorialResult {
  const k = nLevels.length
  const terms = factorialTerms(k)
  const cells = input.map((c) => {
    const s = groupStats(c)
    return { levels: [...c.levels], n: s.n, mean: s.mean, sd: s.sd }
  })
  const summary = cellSummary(cells, input)
  const { shift, used, N, grand, ssTotal } = summary
  const ssWithin = roundedSS(summary.ssWithin, ssTotal)
  const nCells = nLevels.reduce((a, b) => a * b, 1)
  const seen = new Set(used.map((c) => c.levels.join(',')))
  const full = seen.size === nCells && used.length === nCells
  const balanced = full && used.every((c) => c.n === used[0]!.n)
  const dfRes = N - nCells
  const mse = ssWithin / dfRes
  const nan = Number.NaN
  const marginalMeans = nLevels.map((L) => new Array<number>(L).fill(nan))
  const emptySources = (): FactorialSource[] => [
    ...terms.map((factors) => ({
      factors,
      residual: false,
      ss: nan,
      df: nan,
      ms: nan,
      F: nan,
      p: nan,
      pctOfTotal: nan,
    })),
    {
      factors: [],
      residual: true,
      ss: ssWithin,
      df: dfRes,
      ms: mse,
      F: nan,
      p: nan,
      pctOfTotal: (100 * ssWithin) / ssTotal,
    },
  ]
  const base = { ssTotal, N, mse, dfResidual: dfRes, cells, marginalMeans, balanced }
  if (!full) return { ...base, sources: emptySources(), error: 'empty-cells' }
  if (!(dfRes > 0)) return { ...base, sources: emptySources(), error: 'no-residual-df' }

  const fit = (drop: number) => {
    const kept = terms.filter((_, ti) => ti !== drop)
    return fitCellMeans(
      used.map((c) => designRow(c.levels, nLevels, kept)),
      used,
      grand,
    )
  }
  const fFull = fit(-1)
  // LS marginal means: μ + main effect (effect coding sums to zero over levels).
  const mu = fFull.coef[0]! + grand + shift
  let offset = 1
  terms.forEach((t) => {
    if (t.length === 1) {
      const f = t[0]!
      const L = nLevels[f]!
      const eff = Array.from({ length: L - 1 }, (_, i) => fFull.coef[offset + i]!)
      for (let lv = 0; lv < L; lv++)
        marginalMeans[f]![lv] = mu + (lv < L - 1 ? eff[lv]! : -eff.reduce((a, b) => a + b, 0))
    }
    offset += termWidth(t, nLevels)
  })
  const sources: FactorialSource[] = terms.map((factors, ti) => {
    const df = termWidth(factors, nLevels)
    const ss = roundedSS(Math.max(0, fit(ti).rss - fFull.rss), ssTotal)
    const ms = ss / df
    const F = ms / mse
    return {
      factors,
      residual: false,
      ss,
      df,
      ms,
      F,
      p: fSf(F, df, dfRes),
      pctOfTotal: (100 * ss) / ssTotal,
    }
  })
  sources.push({
    factors: [],
    residual: true,
    ss: ssWithin,
    df: dfRes,
    ms: mse,
    F: nan,
    p: nan,
    pctOfTotal: (100 * ssWithin) / ssTotal,
  })
  return { ...base, sources }
}
