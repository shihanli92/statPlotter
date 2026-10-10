import { dunnettP, dunnettQuantile } from '../dist/dunnett.ts'
import { tQuantile, tSf } from '../dist/t.ts'
import { ptukey, qtukey } from '../dist/tukey.ts'
import type { McMethod, McRow } from './comparisons.ts'
import { adjustP } from './padjust.ts'

/**
 * Multiple comparisons from estimated differences with their own SE and df — the general
 * form of multipleComparisons (comparisons.ts) needed after repeated-measures ANOVA without
 * sphericity (paired differences) and after mixed-effects models (model-based SEs, per-contrast
 * df). With one common df and SE² = MSE (1/n_i + 1/n_j) it reproduces multipleComparisons
 * exactly. Per method, with t = diff/SE on the row's df:
 * - tukey: q = √2 t, P = P(Q_{k,df} ≥ |q|), CI diff ± q_{conf; k, df}/√2 · SE;
 * - dunnett: Dunnett's many-to-one distribution with product correlation λ_iλ_j (`lambda`,
 *   one per row); λ_i = √(n_i/(n_i + n_0)) for independent means, fitted to the actual
 *   correlations otherwise (productLambdas);
 * - bonferroni / sidak / fisher: per-comparison t P values, adjusted; CI with t at α/m,
 *   1 − (1 − α)^{1/m} or α;
 * - holm / holm-sidak / bh / bky: adjusted P, no CI.
 */

export interface ContrastRow {
  i: number
  j: number
  diff: number
  se: number
  df: number
}

export interface ContrastMcOptions {
  method: McMethod
  confLevel?: number
  alpha?: number
  /** Tukey: number of means in the family (default: distinct indices referenced by rows). */
  nMeans?: number
  /** Comparisons in the family for Bonferroni/Šidák/Holm/FDR (default rows.length). */
  familySize?: number
  /** Dunnett: product-correlation factor λ of each row (default 1/√2, equal n). */
  lambda?: readonly number[]
}

function perComparisonAlpha(alpha: number, m: number, sidak: boolean): number {
  return sidak ? -Math.expm1(Math.log1p(-alpha) / m) : alpha / m
}

function twoSidedT(t: number, df: number): number {
  return Number.isNaN(t) || !(df > 0) ? Number.NaN : 2 * tSf(Math.abs(t), df)
}

/** The McRow of a contrast with test statistic `stat`, P value `p`, CI diff ± half·SE. */
export function mcRow(r: ContrastRow, stat: number, p: number, half: number, alpha: number): McRow {
  return {
    i: r.i,
    j: r.j,
    diff: r.diff,
    se: r.se,
    lo: r.diff - half * r.se,
    hi: r.diff + half * r.se,
    stat,
    df: r.df,
    p,
    significant: p < alpha,
  }
}

/** A critical value as a function of df, computed once per distinct df (NaN unless df > 0). */
function critByDf(f: (df: number) => number): (df: number) => number {
  const cache = new Map<number, number>()
  return (df) => {
    if (!(df > 0)) return Number.NaN
    let c = cache.get(df)
    if (c === undefined) {
      c = f(df)
      cache.set(df, c)
    }
    return c
  }
}

export function contrastComparisons(
  rows: readonly ContrastRow[],
  opts: ContrastMcOptions,
): McRow[] {
  const { method } = opts
  const confLevel = opts.confLevel ?? 0.95
  const alpha = opts.alpha ?? 0.05
  const aCI = 1 - confLevel
  const m = Math.max(opts.familySize ?? rows.length, rows.length)
  const out = (r: ContrastRow, stat: number, p: number, half: number) =>
    mcRow(r, stat, p, half, alpha)
  const tOf = (r: ContrastRow) => r.diff / r.se
  switch (method) {
    case 'tukey': {
      const k = opts.nMeans ?? new Set(rows.flatMap((r) => [r.i, r.j])).size
      const crit = critByDf((df) => qtukey(confLevel, k, df) / Math.SQRT2)
      return rows.map((r) => {
        const q = Math.SQRT2 * tOf(r)
        const ok = !Number.isNaN(q) && r.df > 0
        const p = ok ? ptukey(Math.abs(q), k, r.df, false) : Number.NaN
        return out(r, q, p, crit(r.df))
      })
    }
    case 'dunnett': {
      const lam = opts.lambda ?? rows.map(() => Math.SQRT1_2)
      // n_0 = 1, n_i = λ²/(1 − λ²) gives λ_i = √(n_i/(n_i + n_0)).
      const ns = lam.map((l) => {
        const c = Math.min(Math.max(l, 1e-6), 1 - 1e-9)
        return (c * c) / (1 - c * c)
      })
      const crit = critByDf((df) => dunnettQuantile(confLevel, df, 1, ns))
      return rows.map((r) => {
        const t = tOf(r)
        const p = r.df > 0 ? dunnettP(t, r.df, 1, ns) : Number.NaN
        return out(r, t, p, crit(r.df))
      })
    }
    case 'bonferroni':
    case 'sidak': {
      const a = perComparisonAlpha(aCI, m, method === 'sidak') / 2
      const crit = critByDf((df) => tQuantile(a, df, false))
      const p = adjustP(
        rows.map((r) => twoSidedT(tOf(r), r.df)),
        method,
        m,
      )
      return rows.map((r, k) => out(r, tOf(r), p[k]!, crit(r.df)))
    }
    case 'fisher': {
      const crit = critByDf((df) => tQuantile(aCI / 2, df, false))
      return rows.map((r) => out(r, tOf(r), twoSidedT(tOf(r), r.df), crit(r.df)))
    }
    case 'newman-keuls':
      throw new RangeError('contrastComparisons: Newman-Keuls needs a pooled error term')
    default: {
      // FDR q values (BH, two-stage step-up at Q = α: significant when q < α).
      const p = adjustP(
        rows.map((r) => twoSidedT(tOf(r), r.df)),
        method,
        m,
        alpha,
      )
      return rows.map((r, k) => out(r, tOf(r), p[k]!, Number.NaN))
    }
  }
}

/**
 * Product-correlation factors λ for Dunnett's distribution from the correlation matrix R of
 * k ≥ 2 control comparisons (row-major k×k): least squares on log R_ij = log λ_i + log λ_j,
 * i ≠ j, which is exact when R has product structure (independent means; any RM ANOVA with
 * complete data) and an approximation otherwise (mixed models, paired differences). Closed
 * form: with r_i = Σ_{j≠i} log R_ij and S = Σr/(2k − 2), log λ_i = (r_i − S)/(k − 2) for
 * k ≥ 3; λ = √R_12 for k = 2. Correlations ≤ 0 are floored at 1e-12 and λ is clamped to
 * [0.01, 0.99] (a fitted λ ≥ 1 means the correlations are far from product form).
 */
export function productLambdas(R: ArrayLike<number>, k: number): number[] {
  if (k === 1) return [Math.SQRT1_2]
  const clamp = (l: number) => Math.min(Math.max(l, 0.01), 0.99)
  const lg = (i: number, j: number) => Math.log(Math.max(R[i * k + j]!, 1e-12))
  if (k === 2) return [0, 1].map(() => clamp(Math.exp(0.5 * lg(0, 1))))
  const r = Array.from({ length: k }, (_, i) => {
    let s = 0
    for (let j = 0; j < k; j++) if (j !== i) s += lg(i, j)
    return s
  })
  const S = r.reduce((a, b) => a + b, 0) / (2 * k - 2)
  return r.map((ri) => clamp(Math.exp((ri - S) / (k - 2))))
}
