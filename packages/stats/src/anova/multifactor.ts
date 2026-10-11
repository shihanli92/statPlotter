import { columnOf, shifted } from '../arrays.ts'
import { fSf } from '../dist/f.ts'
import { leastSquares } from '../linalg/leastSquares.ts'
import { keptColumns } from '../regression/multipleDesign.ts'
import { refinedMean, sum } from '../summation.ts'
import { termColumns, termWidth } from './coding.ts'
import type { McRow } from './comparisons.ts'
import { type ContrastRow, contrastComparisons } from './rmCompare.ts'

/**
 * Multifactor (N-way) ANOVA from raw data (the "Multifactor ANOVA" of a multiple-variables
 * table): a numeric response, any number of categorical factors, and a chosen set of terms (main
 * effects and interactions). Fixed effects, least squares on the rows.
 *
 * - Coding: effect (sum-to-zero, R's contr.sum) columns — level l < L − 1 is the unit vector
 *   e_l, the last level −1 in every column; an interaction's columns are the products of its
 *   factors' columns.
 * - Sums of squares are Type III (each effect is evaluated as if it were the last one entered):
 *   the rise in the residual
 *   SS when the term's columns are dropped from the full model, i.e. car::Anova(type = 3) with
 *   contr.sum. The residual is the full model's (not the within-cell SS unless the model is
 *   saturated), F = MS / MS_residual.
 * - Effect sizes: η² = SS/SS_total, partial η² = SS/(SS + SS_residual), Cohen's
 *   f = √(partial η²/(1 − partial η²)), % of total variation = 100·η² (corrected total).
 * - Estimated marginal means (least-squares means): the model's prediction averaged with equal
 *   weights over every combination of the levels of the other factors (emmeans' reference grid);
 *   their SEs and the SEs of their differences from the coefficient covariance MSE·(XᵀX)⁻¹, with
 *   the residual df.
 *
 * A model whose columns are linearly dependent — an interaction whose combinations of levels
 * don't all have data (empty cells) — has no unique Type III tests: `error` 'aliased' names the
 * terms concerned (as car::Anova refuses aliased coefficients).
 */

export interface MultifactorInput {
  y: readonly number[]
  /** Level index (0-based) of each factor for each row: factors[f][row]. */
  factors: readonly (readonly number[])[]
  nLevels: readonly number[]
  /** Terms as factor indices, e.g. [[0], [1], [0, 1]]. */
  terms: readonly (readonly number[])[]
}

export interface MultifactorSource {
  factors: number[]
  ss: number
  df: number
  ms: number
  F: number
  p: number
  pctOfTotal: number
  etaSquared: number
  partialEtaSquared: number
  cohensF: number
}

export interface MultifactorResult {
  sources: MultifactorSource[]
  residual: { ss: number; df: number; ms: number }
  total: { ss: number; df: number }
  N: number
  /** 1 − SS_residual/SS_total. */
  rSquared: number
  error?: 'aliased' | 'no-residual-df'
  /** Indices (into `terms`) of terms with a column aliased with earlier ones. */
  aliasedTerms: number[]
  /** For marginal means: coefficients (intercept first, y centred at `shift`) and (XᵀX)⁻¹. */
  fit: {
    coef: Float64Array
    covUnscaled: Float64Array
    shift: number
    nLevels: number[]
    terms: number[][]
  } | null
}

const NaN_ = Number.NaN

export function multifactorAnova(input: MultifactorInput): MultifactorResult {
  const { y, factors, nLevels } = input
  const terms = input.terms.map((t) => [...t])
  const N = y.length
  const k = nLevels.length
  if (factors.length !== k) throw new RangeError('multifactorAnova: factors and nLevels differ')
  for (const f of factors)
    if (f.length !== N) throw new RangeError('multifactorAnova: a factor has the wrong length')
  for (const t of terms)
    if (!t.length || t.some((f) => !(Number.isInteger(f) && f >= 0 && f < k)))
      throw new RangeError(`multifactorAnova: term [${t.join(', ')}] out of range`)

  // Centre y (two-pass mean) so the fit never sees a large offset.
  const shift = refinedMean(y)
  const yc = shifted(y, shift)
  const ssTotal = sum(Array.from(yc, (v) => v * v))
  const rowLevels = (i: number) => factors.map((f) => f[i]!)
  const offsets: number[] = []
  let p = 1
  for (const t of terms) {
    offsets.push(p)
    p += termWidth(t, nLevels)
  }
  const rows: number[][] = []
  for (let i = 0; i < N; i++) {
    const lv = rowLevels(i)
    rows.push([1, ...terms.flatMap((t) => termColumns(lv, t, nLevels))])
  }
  const colsOf = (keep: (j: number) => boolean) => {
    const idx: number[] = []
    for (let j = 0; j < p; j++) if (keep(j)) idx.push(j)
    return idx
  }
  const fitCols = (idx: readonly number[]) => {
    const X = new Float64Array(N * idx.length)
    rows.forEach((r, i) => {
      idx.forEach((j, c) => {
        X[i * idx.length + c] = r[j]!
      })
    })
    return leastSquares(X, N, idx.length, yc)
  }
  const termOf = (j: number) => {
    for (let t = terms.length - 1; t >= 0; t--) if (j >= offsets[t]!) return t
    return -1
  }

  // Aliasing, scanning columns left to right as R's lm.
  const keep = keptColumns(
    Array.from({ length: p }, (_, j) => columnOf(rows, j)),
    false,
  )
  const aliasedTerms = [
    ...new Set(
      keep
        .map((kp, j) => (kp ? -1 : termOf(j)))
        .filter((t) => t >= 0)
        .sort((a, b) => a - b),
    ),
  ]
  const nanSources = (): MultifactorSource[] =>
    terms.map((t) => ({
      factors: t,
      ss: NaN_,
      df: termWidth(t, nLevels),
      ms: NaN_,
      F: NaN_,
      p: NaN_,
      pctOfTotal: NaN_,
      etaSquared: NaN_,
      partialEtaSquared: NaN_,
      cohensF: NaN_,
    }))
  const dfRes = N - p
  const base = { N, total: { ss: ssTotal, df: N - 1 }, aliasedTerms }
  if (aliasedTerms.length || keep[0] === false)
    return {
      ...base,
      sources: nanSources(),
      residual: { ss: NaN_, df: NaN_, ms: NaN_ },
      rSquared: NaN_,
      error: 'aliased',
      fit: null,
    }
  const full = fitCols(colsOf(() => true))
  const ssRes = full.rss
  const msRes = ssRes / dfRes
  if (!(dfRes > 0))
    return {
      ...base,
      sources: nanSources(),
      residual: { ss: ssRes, df: dfRes, ms: NaN_ },
      rSquared: 1 - ssRes / ssTotal,
      error: 'no-residual-df',
      fit: null,
    }
  const sources = terms.map((t, ti): MultifactorSource => {
    const lo = offsets[ti]!
    const hi = lo + termWidth(t, nLevels)
    const ss = Math.max(0, fitCols(colsOf((j) => j < lo || j >= hi)).rss - ssRes)
    const df = hi - lo
    const ms = ss / df
    const F = ms / msRes
    const pe = ss / (ss + ssRes)
    return {
      factors: t,
      ss,
      df,
      ms,
      F,
      p: fSf(F, df, dfRes),
      pctOfTotal: (100 * ss) / ssTotal,
      etaSquared: ss / ssTotal,
      partialEtaSquared: pe,
      cohensF: Math.sqrt(pe / (1 - pe)),
    }
  })
  return {
    ...base,
    sources,
    residual: { ss: ssRes, df: dfRes, ms: msRes },
    rSquared: 1 - ssRes / ssTotal,
    fit: {
      coef: full.coef,
      covUnscaled: full.covUnscaled,
      shift,
      nLevels: [...nLevels],
      terms,
    },
  }
}

/**
 * The averaging vector of an estimated marginal mean: factors in `subset` at `levels` (by
 * position in `subset`), every other factor averaged over its levels with equal weights. With
 * effect coding a column involving an averaged factor averages to 0.
 */
function emmVector(
  fit: NonNullable<MultifactorResult['fit']>,
  subset: readonly number[],
  levels: readonly number[],
): number[] {
  const all = fit.nLevels.map(() => 0)
  subset.forEach((f, i) => {
    all[f] = levels[i]!
  })
  const inSubset = new Set(subset)
  return [
    1,
    ...fit.terms.flatMap((t) =>
      t.every((f) => inSubset.has(f))
        ? termColumns(all, t, fit.nLevels)
        : new Array<number>(termWidth(t, fit.nLevels)).fill(0),
    ),
  ]
}

function quad(fit: NonNullable<MultifactorResult['fit']>, v: readonly number[]): number {
  const p = v.length
  let s = 0
  for (let a = 0; a < p; a++) {
    if (v[a] === 0) continue
    for (let b = 0; b < p; b++) if (v[b] !== 0) s += v[a]! * fit.covUnscaled[a * p + b]! * v[b]!
  }
  return s
}

export interface MarginalMean {
  /** Level of each factor of the subset. */
  levels: number[]
  mean: number
  se: number
}

/** Every combination of levels of the factors in `subset` (first factor varying slowest). */
export function levelCombinations(nLevels: readonly number[], subset: readonly number[]) {
  let out: number[][] = [[]]
  for (const f of subset) {
    const next: number[][] = []
    for (const c of out) for (let l = 0; l < nLevels[f]!; l++) next.push([...c, l])
    out = next
  }
  return out
}

/** Estimated marginal means of every combination of levels of `subset` (emmeans). */
export function marginalMeans(res: MultifactorResult, subset: readonly number[]): MarginalMean[] {
  const fit = res.fit
  if (!fit) return []
  const mse = res.residual.ms
  return levelCombinations(fit.nLevels, subset).map((levels) => {
    const v = emmVector(fit, subset, levels)
    const t = v.map((c, j) => c * fit.coef[j]!)
    return { levels, mean: sum(t) + fit.shift, se: Math.sqrt(mse * quad(fit, v)) }
  })
}

export type EmmMethod = 'tukey' | 'bonferroni' | 'sidak' | 'holm-sidak' | 'fisher'

/**
 * A pairwise comparison of marginal means: `i`, `j` index the marginal means
 * (levelCombinations order); CI simultaneous (Tukey, Bonferroni, Šídák), per-comparison
 * (Fisher) or NaN (Holm-Šídák); `stat` is q = √2·t for Tukey, t otherwise.
 */
export type EmmComparison = McRow

export interface EmmComparisonOptions {
  method: EmmMethod
  confLevel?: number
  alpha?: number
  /** Tukey: number of means in the family (default: distinct means referenced by the pairs). */
  nMeans?: number
  /** Bonferroni/Šídák/Holm-Šídák: comparisons in the family (default: the number of pairs). */
  familySize?: number
}

/**
 * Pairwise differences of estimated marginal means of `subset`, t = diff/SE on the residual df
 * (emmeans' pairs()). Tukey: P(Q_{k,df} ≥ √2|t|) and CI diff ± q_{1−α;k,df}/√2·SE (emmeans'
 * "tukey", the Tukey–Kramer form for unbalanced data); Bonferroni and Šídák: adjusted P and
 * t-based simultaneous CIs; Holm-Šídák: step-down P, no CI; Fisher's LSD: unadjusted.
 */
export function compareMarginalMeans(
  res: MultifactorResult,
  subset: readonly number[],
  pairs: readonly (readonly [number, number])[],
  opts: EmmComparisonOptions,
): EmmComparison[] {
  const fit = res.fit
  if (!fit) return []
  const df = res.residual.df
  const mse = res.residual.ms
  const combos = levelCombinations(fit.nLevels, subset)
  const vecs = combos.map((l) => emmVector(fit, subset, l))
  const rows: ContrastRow[] = pairs.map(([i, j]) => {
    const v = vecs[i]!.map((c, q) => c - vecs[j]![q]!)
    const diff = sum(v.map((c, q) => c * fit.coef[q]!))
    return { i, j, diff, se: Math.sqrt(mse * quad(fit, v)), df }
  })
  return contrastComparisons(rows, opts)
}
