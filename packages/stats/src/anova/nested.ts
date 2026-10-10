import { chiSqSf } from '../dist/chisq.ts'
import { fSf } from '../dist/f.ts'
import { tQuantile, tSf } from '../dist/t.ts'
import { levelDiff, levelRow } from './coding.ts'
import type { McMethod, McRow } from './comparisons.ts'
import {
  containmentDf,
  contrastCov,
  contrastEstimate,
  fitReml,
  unitRows,
  type VcDesign,
  type VcFit,
  waldF,
} from './mixedModel.ts'
import { type ContrastRow, contrastComparisons } from './rmCompare.ts'
import { dunnettLambdas } from './rmOneWay.ts'

/**
 * Nested t test and nested one-way ANOVA (Prism Statistics Guide, "How Prism performs the nested
 * t test and one-way ANOVA": "Prism fits a mixed effects model. It treats the main factor (that
 * defines the data set columns) as a fixed factor, and the nested factor as a random factor";
 * FAQ 2105: SAS PROC MIXED METHOD=REML; MODEL y = Condition; RANDOM Room*Condition, and
 * lmer(y ~ Condition + (1 | Room:Condition), REML = TRUE)).
 *
 *   y_gsr = μ_g + b_gs + e_gsr,  b ~ N(0, σ²_subcolumn),  e ~ N(0, σ²_residual),
 *
 * fitted by REML (mixedModel.ts, variances ≥ 0) with sum-to-zero coded groups. The treatment
 * test is the Wald F of the group effects with containment denominator df (SAS's default for
 * the published code): the number of subcolumns (subjects) with data minus the number of
 * groups. With no missing values and equal numbers of replicates this is the ordinary one-way
 * ANOVA / unpaired t test of the subcolumn means ("identical results … when there are no
 * missing values"). Group means are the model's (least-squares) means; comparisons use the
 * model covariance with the same df, through the general contrast code (rmCompare.ts).
 *
 * Also reported:
 * - variance components and the intraclass correlation σ²_sub / (σ²_sub + σ²_res);
 * - whether the subcolumns differ: the F test of subcolumns within groups (MS of subcolumn
 *   means within groups / MS residual, df S − k and N − S; the classical nested-ANOVA test of
 *   σ²_sub = 0) and the likelihood-ratio χ² of the REML fits with and without the random
 *   effect (df 1), as Prism reports for "was the matching effective?" in mixed models;
 * - the REML log-likelihood (lme4's, contr.sum coding).
 * Values are shifted by the first value before fitting (exact for nearby values).
 */

export interface NestedResult {
  k: number
  /** Subcolumns (subjects) with data, per group. */
  subjects: number[]
  /** Values per group. */
  n: number[]
  nValues: number
  /** Least-squares group means. */
  means: number[]
  treatment: { F: number; dfn: number; dfd: number; p: number }
  variances: { subcolumn: number; residual: number }
  icc: number
  subcolumnTest: { F: number; dfn: number; dfd: number; p: number }
  lrt: { chi2: number; df: number; p: number }
  logLik: number
  /** Internal: the fit and contrast helpers. */
  fit: VcFit | null
  shift: number
  error?: 'too-few-groups' | 'empty-group' | 'no-df' | 'not-estimable' | 'degenerate'
}

/** groups[g][s] = the values (finite) of subcolumn s of group g. Empty subcolumns are dropped. */
export function nestedAnova(groups: readonly (readonly (readonly number[])[])[]): NestedResult {
  const k = groups.length
  const subs = groups.map((g) => g.filter((s) => s.length > 0))
  const subjects = subs.map((g) => g.length)
  const n = subs.map((g) => g.reduce((a, s) => a + s.length, 0))
  const nValues = n.reduce((a, b) => a + b, 0)
  const S = subjects.reduce((a, b) => a + b, 0)
  const nan = Number.NaN
  const base: NestedResult = {
    k,
    subjects,
    n,
    nValues,
    means: subs.map(() => nan),
    treatment: { F: nan, dfn: k - 1, dfd: nan, p: nan },
    variances: { subcolumn: nan, residual: nan },
    icc: nan,
    subcolumnTest: { F: nan, dfn: S - k, dfd: nValues - S, p: nan },
    lrt: { chi2: nan, df: 1, p: nan },
    logLik: nan,
    fit: null,
    shift: 0,
  }
  if (k < 2) return { ...base, error: 'too-few-groups' }
  if (subjects.some((c) => c === 0)) return { ...base, error: 'empty-group' }
  if (S - k < 1) return { ...base, error: 'no-df' }
  const shift = subs[0]![0]![0]!
  const y: number[] = []
  const X: number[] = []
  const block: number[] = []
  let subject = 0
  subs.forEach((g, gi) => {
    for (const s of g) {
      for (const v of s) {
        y.push(v - shift)
        X.push(1)
        for (let j = 0; j < k - 1; j++) X.push(gi === j ? 1 : gi === k - 1 ? -1 : 0)
        block.push(subject)
      }
      subject++
    }
  })
  const blockArr = Int32Array.from(block)
  const design: VcDesign = {
    y: Float64Array.from(y),
    X: Float64Array.from(X),
    p: k,
    block: blockArr,
    nBlocks: S,
    // One value per subcolumn: the two variances can't be told apart; fit without the
    // random effect (the treatment test is then the t test / ANOVA of the values).
    terms: nValues > S ? [{ name: 'subcolumn', level: blockArr, nLevels: S }] : [],
  }
  // Classical test of the subcolumns (least squares, needs no fit).
  let ssSub = 0
  let ssRes = 0
  subs.forEach((g) => {
    const all = g.flat().map((v) => v - shift)
    const gm = all.reduce((a, b) => a + b, 0) / all.length
    for (const s of g) {
      const sv = s.map((v) => v - shift)
      const sm = sv.reduce((a, b) => a + b, 0) / sv.length
      ssSub += sv.length * (sm - gm) ** 2
      for (const v of sv) ssRes += (v - sm) ** 2
    }
  })
  const dfSub = S - k
  const dfRes = nValues - S
  const Fsub = dfRes > 0 ? ssSub / dfSub / (ssRes / dfRes) : nan
  const subcolumnTest = {
    F: Fsub,
    dfn: dfSub,
    dfd: dfRes,
    p: dfRes > 0 ? fSf(Fsub, dfSub, dfRes) : nan,
  }
  const fit = fitReml(design)
  if (!fit.ok)
    return { ...base, subcolumnTest, error: fit.reason === 'no-residual-df' ? 'no-df' : fit.reason }
  const wf = waldF(fit, unitRows(k, 1, k))
  const nested = design.terms.length > 0
  const dfd = containmentDf(design, nested ? [0] : [])
  const means = Array.from(
    { length: k },
    (_, g) => contrastEstimate(fit, levelRow(g, k)).est + shift,
  )
  const vs = nested ? fit.variances[0]! : nan
  const vr = nested ? fit.sigma2 : nan
  const chi2 = nested ? Math.max(0, 2 * (fit.logLik - fit.logLik0)) : nan
  return {
    ...base,
    means,
    treatment: { F: wf.F, dfn: k - 1, dfd, p: fSf(wf.F, k - 1, dfd) },
    variances: { subcolumn: vs, residual: vr },
    icc: vs / (vs + vr),
    subcolumnTest,
    lrt: { chi2, df: 1, p: chiSqSf(chi2, 1) },
    logLik: fit.logLik,
    fit,
    shift,
  }
}

/** mean_i − mean_j with its SE, on the containment df. */
function nestedContrast(
  res: NestedResult,
  i: number,
  j: number,
): { diff: number; se: number; df: number } {
  if (!res.fit) return { diff: Number.NaN, se: Number.NaN, df: Number.NaN }
  const e = contrastEstimate(res.fit, levelDiff(i, j, res.k))
  return { diff: e.est, se: e.se, df: res.treatment.dfd }
}

export interface NestedTTest {
  /** mean[1] − mean[0] (Prism's B − A). */
  diff: number
  se: number
  t: number
  df: number
  p: number
  lo: number
  hi: number
}

/** Two groups: t test of B − A from the nested fit (t² = the treatment F). */
export function nestedTTest(
  res: NestedResult,
  confLevel = 0.95,
  tails: 'two' | 'one' = 'two',
): NestedTTest {
  const c = nestedContrast(res, 1, 0)
  const t = c.diff / c.se
  const p2 = 2 * tSf(Math.abs(t), c.df)
  const h = tQuantile(1 - (1 - confLevel) / 2, c.df) * c.se
  return {
    diff: c.diff,
    se: c.se,
    t,
    df: c.df,
    p: tails === 'two' ? p2 : p2 / 2,
    lo: c.diff - h,
    hi: c.diff + h,
  }
}

/** Multiple comparisons of group means after the nested fit (pairs as [i, j], diff = i − j). */
export function nestedComparisons(
  res: NestedResult,
  pairs: readonly (readonly [number, number])[],
  method: McMethod,
  opts: { confLevel?: number; alpha?: number } = {},
): McRow[] {
  const rows: ContrastRow[] = pairs.map(([i, j]) => ({ i, j, ...nestedContrast(res, i, j) }))
  let lambda: number[] | undefined
  if (method === 'dunnett' && res.fit) {
    const ls = pairs.map(([i, j]) => levelDiff(i, j, res.k))
    lambda = dunnettLambdas(pairs.length, contrastCov(res.fit, ls))
  }
  return contrastComparisons(rows, {
    method,
    confLevel: opts.confLevel ?? 0.95,
    alpha: opts.alpha ?? 0.05,
    nMeans: res.k,
    ...(lambda ? { lambda } : {}),
  })
}
