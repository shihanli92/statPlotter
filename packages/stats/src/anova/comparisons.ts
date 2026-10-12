import { dunnettP, dunnettQuantile, smmP, smmQuantile } from '../dist/dunnett.ts'
import { normalSf } from '../dist/normal.ts'
import { ptukey } from '../dist/tukey.ts'
import { pooledRanks } from '../tests/ranks.ts'
import { adjustP } from './padjust.ts'
import { type ContrastRow, contrastComparisons, mcRow } from './rmCompare.ts'

/**
 * Multiple comparisons after ANOVA:
 *
 * - All methods use the pooled residual mean square and its df from the ANOVA (`mse`, `df`):
 *   SE = √(MSE (1/n_i + 1/n_j)), t = diff / SE, with diff = mean_i − mean_j.
 * - Tukey (Tukey–Kramer for unequal n): q = √2·diff/SE (the studentized range statistic,
 *   q = √2·D/SED); P = P(Q_{k,df} ≥ |q|); simultaneous CI
 *   diff ± q_{conf; k, df}/√2 · SE.
 * - Dunnett (single-step, Dunnett 1955): stat = t (Dunnett's "q" is D/SED); P and the
 *   simultaneous CI from the many-to-one distribution with the actual group sizes.
 * - Bonferroni / Šidák: P from the per-comparison t test, multiplied / Šidák-adjusted for the
 *   family size m; simultaneous CI with t at α/m (Bonferroni) or 1 − (1 − α)^{1/m} (Šidák),
 *   α = 1 − confLevel.
 * - Holm / Holm–Šidák: step-down adjusted P values; no CI (NaN).
 * - Fisher's LSD: unadjusted P and per-comparison CI.
 * - bh / bky: FDR q values (see adjustP); no CI. `significant` means q < alpha.
 * - Newman-Keuls (Student-Newman-Keuls; offered but not recommended): the means of
 *   the family are ranked; a pair spanning r ranked means (r = |rank_i − rank_j| + 1) is tested
 *   with q = √2·|diff|/SE (the Tukey-Kramer SE) against the studentized range with r means;
 *   step-down, so a pair can only be significant when every pair whose range contains it is.
 *   The test has no P values or CIs of its own; the P reported here is the step-down
 *   equivalent max over the containing ranges (itself included) of P(Q_{r,df} ≥ q), so that
 *   P < α exactly when the procedure at α declares the pair significant. No CI (NaN). Every
 *   pair of the family's means must be compared (all pairs).
 *
 * Two-way ANOVA: the caller compares cell (or marginal) means with the two-way result's `mse`
 * and `dfResidual`. For "compare columns within each row" (simple effects):
 * - "one family per row" (the recommended default): call once per row with that row's
 *   pairs; Tukey nMeans = number of columns, Šidák/Bonferroni/Holm familySize = C(C, 2) (the
 *   default, pairs.length), Dunnett = the row's C − 1 comparisons with its control cell.
 * - "one family for all comparisons": one call with every row's pairs; Šidák/Bonferroni/Holm/
 *   FDR familySize = R·C(C, 2) (again the default). For Tukey which k to use here is not
 *   settled; nMeans = R·C (all cell means) is the conservative reading.
 * Rows within columns are the same with rows and columns swapped. Main-effect comparisons
 * (row means) use the least-squares marginal means with n_eff = C² / Σ_j 1/n_ij, so that
 * MSE/n_eff is the variance of a row's LS mean (Σ n_ij for balanced data). The oracle (twoway suite) checks per-row Tukey and Šidák and all-rows Šidák
 * against emmeans' simple effects with the pooled error.
 */

export type McMethod =
  | 'tukey'
  | 'newman-keuls'
  | 'dunnett'
  | 'bonferroni'
  | 'sidak'
  | 'holm-sidak'
  | 'holm'
  | 'fisher'
  | 'bh'
  | 'bky'

export interface McCell {
  mean: number
  n: number
  sd?: number
}

export interface McRow {
  i: number
  j: number
  /** mean[i] − mean[j] ("Mean Diff."). */
  diff: number
  se: number
  /** CI of diff: simultaneous for tukey/dunnett/bonferroni/sidak (and the Welch methods),
   *  per-comparison for fisher, NaN for step-down and FDR methods. */
  lo: number
  hi: number
  /** q for Tukey (√2·diff/SE), t otherwise (also for Games–Howell). */
  stat: number
  df: number
  /** Multiplicity-adjusted P (q value for bh / bky; unadjusted for fisher). */
  p: number
  significant: boolean
}

export interface McOptions {
  method: McMethod
  /** Pooled residual mean square and its df, from the ANOVA. */
  mse: number
  df: number
  confLevel?: number
  alpha?: number
  /** Tukey: number of means in the family (default: distinct cells referenced by pairs). */
  nMeans?: number
  /** Dunnett: index of the control cell; every pair must involve it. */
  control?: number
  /** Bonferroni/Šidák/Holm/Holm–Šidák/BH/BKY: comparisons in the family (default pairs.length). */
  familySize?: number
}

type Pair = readonly [number, number]

function distinct(pairs: readonly Pair[]): number[] {
  const s = new Set<number>()
  for (const [i, j] of pairs) {
    s.add(i)
    s.add(j)
  }
  return [...s]
}

export function multipleComparisons(
  cells: readonly McCell[],
  pairs: readonly Pair[],
  opts: McOptions,
): McRow[] {
  const { method, mse, df } = opts
  const alpha = opts.alpha ?? 0.05
  const rows: ContrastRow[] = pairs.map(([i, j]) => {
    const a = cells[i]!
    const b = cells[j]!
    return { i, j, diff: a.mean - b.mean, se: Math.sqrt(mse * (1 / a.n + 1 / b.n)), df }
  })
  switch (method) {
    case 'newman-keuls': {
      // Rank the family's means (ties broken by index); step P over each pair's range.
      const ids = distinct(pairs).sort((a, b) => cells[a]!.mean - cells[b]!.mean || a - b)
      const rank = new Map(ids.map((id, r) => [id, r]))
      const span = rows.map((r) => {
        const [lo, hi] = [rank.get(r.i)!, rank.get(r.j)!].sort((x, y) => x - y)
        return { lo: lo!, hi: hi! }
      })
      const stepP = rows.map((r, k) => {
        const q = Math.SQRT2 * Math.abs(r.diff / r.se)
        return Number.isNaN(q) ? Number.NaN : ptukey(q, span[k]!.hi - span[k]!.lo + 1, df, false)
      })
      return rows.map((r, k) => {
        let p = stepP[k]!
        span.forEach((s, l) => {
          if (s.lo <= span[k]!.lo && s.hi >= span[k]!.hi) p = Math.max(p, stepP[l]!)
        })
        return mcRow(r, Math.SQRT2 * (r.diff / r.se), p, Number.NaN, alpha)
      })
    }
    case 'dunnett': {
      const c = opts.control
      if (c === undefined) throw new RangeError('dunnett: opts.control is required')
      const treated: number[] = []
      for (const [i, j] of pairs) {
        if (i !== c && j !== c) throw new RangeError('dunnett: every pair must involve the control')
        const other = i === c ? j : i
        if (!treated.includes(other)) treated.push(other)
      }
      const nC = cells[c]!.n
      const ns = treated.map((x) => cells[x]!.n)
      const crit = dunnettQuantile(opts.confLevel ?? 0.95, df, nC, ns)
      return rows.map((r) => {
        const t = r.diff / r.se
        return mcRow(r, t, dunnettP(t, df, nC, ns), crit, alpha)
      })
    }
    default:
      // With one pooled df and SE² = MSE (1/n_i + 1/n_j) this is the general contrast code.
      return contrastComparisons(rows, opts)
  }
}

export type WelchMcMethod = 'games-howell' | 'dunnett-t3' | 'tamhane-t2'

export interface WelchMcOptions {
  method: WelchMcMethod
  confLevel?: number
  alpha?: number
  /** Games–Howell: number of means (default: distinct cells referenced by pairs). */
  nMeans?: number
  /** T3 / T2: number of comparisons in the family (default pairs.length). */
  familySize?: number
}

/**
 * Comparisons without assuming equal SDs (after Welch or Brown–Forsythe ANOVA). Each pair uses
 * its own SE = √(s_i²/n_i + s_j²/n_j) and Welch–Satterthwaite df (which is what `df` reports):
 * - games-howell (Games & Howell 1976): q = √2·|t| referred to the studentized range with k means;
 * - dunnett-t3 (Dunnett 1980, JASA 75, 796–800): |t| referred to the studentized maximum modulus
 *   with m = number of comparisons;
 * - tamhane-t2 (Tamhane 1979, JASA 74, 471–480): Šidák adjustment of the Welch t tests.
 * All CIs are simultaneous: diff ± crit·SE with the corresponding critical value. `stat` is t for
 * all three (the three tests compute the same t ratio and the same df values; they differ in
 * how they compute the P value).
 */
export function welchComparisons(
  cells: readonly Required<McCell>[],
  pairs: readonly Pair[],
  opts: WelchMcOptions,
): McRow[] {
  const rows: ContrastRow[] = pairs.map(([i, j]) => {
    const a = cells[i]!
    const b = cells[j]!
    const va = (a.sd * a.sd) / a.n
    const vb = (b.sd * b.sd) / b.n
    const df = (va + vb) ** 2 / ((va * va) / (a.n - 1) + (vb * vb) / (b.n - 1))
    return { i, j, diff: a.mean - b.mean, se: Math.sqrt(va + vb), df }
  })
  switch (opts.method) {
    case 'games-howell':
      // Tukey on each pair's own SE and df; the reported statistic is t, not q.
      return contrastComparisons(rows, { ...opts, method: 'tukey' }).map((r) => ({
        ...r,
        stat: r.diff / r.se,
      }))
    case 'tamhane-t2':
      return contrastComparisons(rows, { ...opts, method: 'sidak' })
    default: {
      const confLevel = opts.confLevel ?? 0.95
      const alpha = opts.alpha ?? 0.05
      const m = Math.max(opts.familySize ?? pairs.length, pairs.length)
      return rows.map((r) => {
        const t = r.diff / r.se
        const p = Number.isNaN(t) ? Number.NaN : smmP(t, m, r.df)
        return mcRow(r, t, p, smmQuantile(confLevel, m, r.df), alpha)
      })
    }
  }
}

export interface DunnRow {
  i: number
  j: number
  /** Mean rank of group i − mean rank of group j (ranks from all groups pooled). */
  meanRankDiff: number
  z: number
  /** Adjusted two-sided P. */
  p: number
  significant: boolean
}

export interface DunnOptions {
  /** Roadmap 51c (S11): Holm's step-down too. */
  adjust?: 'bonferroni' | 'sidak' | 'holm' | 'none'
  alpha?: number
  /** Comparisons in the family (default pairs.length). */
  familySize?: number
}

/**
 * Dunn's (1964, Technometrics 6, 241–252) test after Kruskal–Wallis: all groups are ranked
 * together; z = (R̄_i − R̄_j) / √([N(N+1)/12 − Σ(t³ − t)/(12(N − 1))] (1/n_i + 1/n_j)), with the
 * tie correction of Glantz / dunn.test; two-sided P = 2(1 − Φ(|z|)), multiplied by the number of
 * comparisons (Bonferroni, the default) or Šidák-adjusted.
 */
export function dunnComparisons(
  groups: readonly ArrayLike<number>[],
  pairs: readonly Pair[],
  opts: DunnOptions = {},
): DunnRow[] {
  const adjust = opts.adjust ?? 'bonferroni'
  const alpha = opts.alpha ?? 0.05
  const m = Math.max(opts.familySize ?? pairs.length, pairs.length)
  const { n, N, tieSum, meanRanks: meanRank } = pooledRanks(groups)
  const S = (N * (N + 1)) / 12 - tieSum / (12 * (N - 1))
  const raw = pairs.map(([i, j]) => {
    const d = meanRank[i]! - meanRank[j]!
    const z = d / Math.sqrt(S * (1 / n[i]! + 1 / n[j]!))
    return { i, j, d, z, p: Number.isNaN(z) ? Number.NaN : 2 * normalSf(Math.abs(z)) }
  })
  const p =
    adjust === 'none'
      ? raw.map((r) => r.p)
      : adjustP(
          raw.map((r) => r.p),
          adjust,
          m,
        )
  return raw.map((r, k) => ({
    i: r.i,
    j: r.j,
    meanRankDiff: r.d,
    z: r.z,
    p: p[k]!,
    significant: p[k]! < alpha,
  }))
}
