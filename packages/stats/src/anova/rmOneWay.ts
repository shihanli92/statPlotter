import { chiSqSf } from '../dist/chisq.ts'
import { fSf } from '../dist/f.ts'
import { levelDiff, levelRow } from './coding.ts'
import type { McMethod, McRow } from './comparisons.ts'
import {
  containmentDf,
  contrastCov,
  contrastEstimate,
  fitReml,
  satterthwaiteDf,
  unitRows,
  type VcDesign,
  type VcFit,
  waldF,
} from './mixedModel.ts'
import { type ContrastRow, contrastComparisons, productLambdas } from './rmCompare.ts'

/**
 * Repeated-measures one-way ANOVA, and the mixed-effects model Prism fits instead when values
 * are missing (Prism Statistics Guide, "Repeated measures tab": "Report the fit to a mixed
 * effects model only when there are missing values … When there are no missing values, report
 * the familiar repeated measures ANOVA results").
 *
 * Data: one row per subject, one column per treatment, NaN = missing. Rows that are entirely
 * missing are ignored. Everything is computed on the data shifted by the first value (exact
 * for nearby values), so 1e9 + small effects keep their precision.
 *
 * Complete data — RM ANOVA (Prism, "Interpreting results: Repeated measures one-way ANOVA"):
 *   SS_treatment = n Σ_j (ȳ_·j − ȳ)², SS_individual = k Σ_i (ȳ_i· − ȳ)²,
 *   SS_residual = Σ (y_ij − ȳ_i· − ȳ_·j + ȳ)², df k − 1, n − 1, (k − 1)(n − 1);
 *   F = MS_treatment/MS_residual; "was the matching effective?" F = MS_individual/MS_residual;
 *   R² = SS_treatment/(SS_treatment + SS_residual) (Keppel; partial η²).
 *   Geisser–Greenhouse ε̂ = (Σλ)²/((k − 1)Σλ²) over the eigenvalues λ of the double-centred
 *   sample covariance matrix of the treatments (Greenhouse & Geisser 1959; Maxwell & Delaney
 *   2004 p. 545), computed as tr(D)²/((k − 1)‖D‖²_F). With 'gg' the P value uses
 *   F(ε(k − 1), ε(k − 1)(n − 1)) ("Prism uses the Geisser and Greenhouse epsilon hat method";
 *   Huynh–Feldt and the lower bound are not computed). ε is always reported for ANOVA fits.
 *
 * Missing values — mixed model (Prism, "The mixed model approach…", "How to report the methods
 * used for the mixed model analysis"; FAQ 2103: SAS PROC MIXED METHOD=REML with RANDOM Int /
 * SUBJECT=Subject, lme4 lmer(y ~ Type + (1|Subject)) with contr.sum): y = μ_j + b_i + e, b_i ~
 * N(0, σ_s²), σ_s² ≥ 0, REML (mixedModel.ts). The treatment test is the Wald F of the
 * contr.sum treatment coefficients (Type III), with denominator df by
 *   - 'containment' (default): SAS's default for that code, here N − rank([X Z]) = N − k − s + 1
 *     (s subjects with data) — the RM ANOVA df when nothing is missing;
 *   - 'satterthwaite': lmerTest's method.
 * Prism does not document which it uses (see tools/oracle/r/mixed.R). Treatment means are the
 * model's least-squares means. "Was the matching effective?" is the likelihood-ratio χ² of the
 * REML fits with and without the subject effect (df 1, Prism's "chi-square statistic … comparing
 * the fit of the full mixed effects model to a simpler model"). Prism applies the GG correction
 * to mixed models too, but does not document how ε is estimated with missing values; it is not
 * computed here (epsilon/corrected are null for mixed fits).
 *
 * Degenerate data (one subject, a treatment without values, no residual variation) give NaN
 * results and `error`; only rows of unequal length throw.
 */

export interface RMSource {
  name: string
  ss: number
  df: number
  ms: number
  F: number
  p: number
}

export type RMDdf = 'containment' | 'satterthwaite'

export interface OneWayRMOptions {
  sphericity?: 'assumed' | 'gg'
  /** Denominator df for the mixed model's F test and comparisons (default 'containment'). */
  ddf?: RMDdf
}

export interface OneWayRMResult {
  kind: 'anova' | 'mixed'
  treatment: { F: number; dfn: number; dfd: number; p: number }
  sphericity: 'assumed' | 'gg'
  ddf: RMDdf
  /** Geisser–Greenhouse ε̂ (ANOVA only). */
  epsilon: number | null
  /** GG-corrected test (ANOVA with sphericity 'gg'). */
  corrected: { dfn: number; dfd: number; p: number } | null
  /** ANOVA table: Treatment, Individual, Residual, Total (null for mixed fits). */
  table: RMSource[] | null
  /** "Was the matching effective?" (ANOVA): F = MS_individual/MS_residual; effective = P < 0.05. */
  matching: { F: number; p: number; effective: boolean } | null
  rSquared: number | null
  mixed: {
    subjectVariance: number
    residualVariance: number
    /** REML log-likelihood (lme4's, contr.sum coding). */
    logLik: number
    nObs: number
    nSubjects: number
    /** Likelihood-ratio test of the subject variance (χ², df 1). */
    matching: { chi2: number; df: number; p: number }
  } | null
  /** Treatment means (least-squares means for mixed fits). */
  means: number[]
  /** Values per treatment. */
  n: number[]
  error?: 'too-few' | 'empty-treatment' | 'no-residual-df' | 'not-estimable' | 'degenerate'
}

interface Prepared {
  k: number
  /** Rows with at least one value. */
  rows: (readonly number[])[]
  shift: number
  n: number[]
  complete: boolean
}

function prepare(rows: readonly (readonly number[])[]): Prepared {
  const k = rows.length > 0 ? rows[0]!.length : 0
  for (const r of rows) {
    if (r.length !== k) throw new RangeError('oneWayRM: all rows must have the same length')
  }
  const used = rows.filter((r) => r.some((v) => !Number.isNaN(v)))
  let shift = 0
  outer: for (const r of used) {
    for (const v of r) {
      if (Number.isFinite(v)) {
        shift = v
        break outer
      }
    }
  }
  const n = new Array<number>(k).fill(0)
  for (const r of used) {
    r.forEach((v, j) => {
      if (!Number.isNaN(v)) n[j]!++
    })
  }
  const complete = used.every((r) => r.every((v) => !Number.isNaN(v)))
  return { k, rows: used, shift, n, complete }
}

function rawMeans(p: Prepared): number[] {
  return Array.from({ length: p.k }, (_, j) => {
    let s = 0
    let c = 0
    for (const r of p.rows) {
      if (!Number.isNaN(r[j]!)) {
        s += r[j]! - p.shift
        c++
      }
    }
    return c > 0 ? p.shift + s / c : Number.NaN
  })
}

const NAN_TEST = { F: Number.NaN, dfn: Number.NaN, dfd: Number.NaN, p: Number.NaN }

export function oneWayRM(
  rows: readonly (readonly number[])[],
  opts: OneWayRMOptions = {},
): OneWayRMResult {
  const sphericity = opts.sphericity ?? 'assumed'
  const ddf = opts.ddf ?? 'containment'
  const P = prepare(rows)
  const base = {
    sphericity,
    ddf,
    n: P.n,
    epsilon: null,
    corrected: null,
    table: null,
    matching: null,
    rSquared: null,
    mixed: null,
  }
  if (P.complete) return anova(P, sphericity, ddf)
  if (P.k < 2)
    return { ...base, kind: 'mixed', treatment: NAN_TEST, means: rawMeans(P), error: 'too-few' }
  if (P.n.some((c) => c === 0)) {
    return {
      ...base,
      kind: 'mixed',
      treatment: NAN_TEST,
      means: rawMeans(P),
      error: 'empty-treatment',
    }
  }
  const m = mixedFit(P)
  if (!m.fit.ok) {
    return { ...base, kind: 'mixed', treatment: NAN_TEST, means: rawMeans(P), error: m.fit.reason }
  }
  const fit = m.fit
  const w = waldF(fit, unitRows(P.k, 1, P.k))
  const dfd = ddf === 'satterthwaite' ? w.dfdSatterthwaite() : containmentDf(m.design, [])
  const chi2 = Math.max(0, 2 * (fit.logLik - fit.logLik0))
  return {
    ...base,
    kind: 'mixed',
    treatment: { F: w.F, dfn: w.dfn, dfd, p: fSf(w.F, w.dfn, dfd) },
    mixed: {
      subjectVariance: fit.variances[0]!,
      residualVariance: fit.sigma2,
      logLik: fit.logLik,
      nObs: fit.nObs,
      nSubjects: P.rows.length,
      matching: { chi2, df: 1, p: chiSqSf(chi2, 1) },
    },
    means: Array.from(
      { length: P.k },
      (_, j) => P.shift + contrastEstimate(fit, levelRow(j, P.k)).est,
    ),
    ...(dfd > 0 ? {} : { error: 'no-residual-df' as const }),
  }
}

function mixedFit(P: Prepared): { design: VcDesign; fit: ReturnType<typeof fitReml> } {
  const y: number[] = []
  const X: number[] = []
  const block: number[] = []
  P.rows.forEach((r, i) => {
    r.forEach((v, j) => {
      if (Number.isNaN(v)) return
      y.push(v - P.shift)
      X.push(...levelRow(j, P.k))
      block.push(i)
    })
  })
  const blk = Int32Array.from(block)
  const design: VcDesign = {
    y: Float64Array.from(y),
    X: Float64Array.from(X),
    p: P.k,
    block: blk,
    nBlocks: P.rows.length,
    terms: [{ name: 'subject', level: blk, nLevels: P.rows.length }],
  }
  return { design, fit: fitReml(design) }
}

function anova(P: Prepared, sphericity: 'assumed' | 'gg', ddf: RMDdf): OneWayRMResult {
  const { k } = P
  const n = P.rows.length
  const y = P.rows.map((r) => r.map((v) => v - P.shift))
  const colMean = Array.from({ length: k }, (_, j) => y.reduce((s, r) => s + r[j]!, 0) / n)
  const rowMean = y.map((r) => r.reduce((s, v) => s + v, 0) / k)
  const grand = colMean.reduce((s, v) => s + v, 0) / k
  let ssT = 0
  let ssS = 0
  let ssR = 0
  let ssTot = 0
  for (let j = 0; j < k; j++) ssT += n * (colMean[j]! - grand) ** 2
  for (let i = 0; i < n; i++) {
    ssS += k * (rowMean[i]! - grand) ** 2
    for (let j = 0; j < k; j++) {
      ssR += (y[i]![j]! - rowMean[i]! - colMean[j]! + grand) ** 2
      ssTot += (y[i]![j]! - grand) ** 2
    }
  }
  const dfT = k - 1
  const dfS = n - 1
  const dfR = dfT * dfS
  const msT = ssT / dfT
  const msS = ssS / dfS
  const msR = ssR / dfR
  const ok = k >= 2 && n >= 2
  const F = ok ? msT / msR : Number.NaN
  const p = fSf(F, dfT, dfR)
  const Fm = ok ? msS / msR : Number.NaN
  const pm = fSf(Fm, dfS, dfR)
  // Geisser–Greenhouse ε̂ from the double-centred covariance (SSP) matrix.
  const e = y.map((r, i) => r.map((v, j) => v - rowMean[i]! - colMean[j]! + grand))
  const ssp = new Float64Array(k * k)
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) {
      let s = 0
      for (let i = 0; i < n; i++) s += e[i]![a]! * e[i]![b]!
      ssp[a * k + b] = s
    }
  }
  const epsilon = ok ? ggEpsilon(ssp, k, dfT) : Number.NaN
  const corrected =
    sphericity === 'gg'
      ? {
          dfn: epsilon * dfT,
          dfd: epsilon * dfR,
          p: fSf(F, epsilon * dfT, epsilon * dfR),
        }
      : null
  const table: RMSource[] = [
    { name: 'Treatment', ss: ssT, df: dfT, ms: msT, F, p },
    { name: 'Individual', ss: ssS, df: dfS, ms: msS, F: Fm, p: pm },
    { name: 'Residual', ss: ssR, df: dfR, ms: msR, F: Number.NaN, p: Number.NaN },
    { name: 'Total', ss: ssTot, df: n * k - 1, ms: Number.NaN, F: Number.NaN, p: Number.NaN },
  ]
  const out: OneWayRMResult = {
    kind: 'anova',
    treatment: { F, dfn: dfT, dfd: dfR, p },
    sphericity,
    ddf,
    epsilon,
    corrected,
    table,
    matching: { F: Fm, p: pm, effective: pm < 0.05 },
    rSquared: ssT / (ssT + ssR),
    mixed: null,
    means: colMean.map((m) => m + P.shift),
    n: P.n,
  }
  if (!ok) out.error = 'too-few'
  else if (!(dfR > 0)) out.error = 'no-residual-df'
  return out
}

export interface RMComparisonOptions {
  method: McMethod
  confLevel?: number
  alpha?: number
  /** Dunnett: the control treatment (default: the index common to every pair). */
  control?: number
  /** Tukey: means in the family (default: distinct treatments in `pairs`). */
  nMeans?: number
  /** Comparisons in the family (default pairs.length). */
  familySize?: number
}

/**
 * Multiple comparisons after oneWayRM (Prism, "Multiple comparisons after repeated measures
 * one-way ANOVA", following Maxwell & Delaney 2004 pp. 552–555), diff = mean_i − mean_j:
 * - ANOVA, sphericity assumed: pooled MS_residual, SE = √(2 MS_res/n), df (k − 1)(n − 1);
 * - ANOVA, 'gg': "for each comparison of two groups, it uses only the data in those two groups
 *   (essentially performing a paired t test)": SE = SD(y_i − y_j)/√n, df n − 1;
 * - mixed model: model-based SE of the difference of least-squares means ("based on matrix
 *   algebra"), df = the containment df of the F test or Satterthwaite's df per comparison.
 * Tukey refers √2·t to the studentized range with that comparison's df. Dunnett: pooled —
 * Dunnett's distribution with correlation ½ (exact); paired — the same equal-n distribution
 * with df n − 1 (the paired differences' own correlations are ignored, an approximation that
 * Prism's guide does not settle); mixed — the product-correlation distribution fitted to the
 * model-based correlations of the comparisons (productLambdas).
 */
export function rmComparisons(
  rows: readonly (readonly number[])[],
  res: OneWayRMResult,
  pairs: readonly (readonly [number, number])[],
  opts: RMComparisonOptions,
): McRow[] {
  const P = prepare(rows)
  const k = P.k
  for (const [i, j] of pairs) {
    if (!(i >= 0 && i < k && j >= 0 && j < k)) throw new RangeError('rmComparisons: bad pair')
  }
  // Differences from the shifted data (res.means carry the shift back).
  const means =
    res.kind === 'anova'
      ? Array.from(
          { length: k },
          (_, j) => P.rows.reduce((s, r) => s + (r[j]! - P.shift), 0) / P.rows.length,
        )
      : res.means
  let cr: ContrastRow[]
  let cov: (a: number, b: number) => number // covariance of two comparisons' estimates
  if (res.kind === 'anova') {
    const n = P.rows.length
    if (res.sphericity === 'gg') {
      const d = (i: number, j: number) => P.rows.map((r) => r[i]! - r[j]!)
      const diffs = pairs.map(([i, j]) => d(i, j))
      const centred = diffs.map((x) => {
        const m = x.reduce((s, v) => s + v, 0) / n
        return x.map((v) => v - m)
      })
      const c = (a: number, b: number) =>
        centred[a]!.reduce((s, v, t) => s + v * centred[b]![t]!, 0) / ((n - 1) * n)
      cov = c
      cr = pairs.map(([i, j], a) => ({
        i,
        j,
        diff: diffs[a]!.reduce((s, v) => s + v, 0) / n,
        se: Math.sqrt(c(a, a)),
        df: n - 1,
      }))
    } else {
      const msR = res.table![2]!.ms
      const dfR = res.table![2]!.df
      // Independent means with variance MS_res/n (compound symmetry).
      const v = msR / n
      cov = (a, b) => {
        const [i1, j1] = pairs[a]!
        const [i2, j2] = pairs[b]!
        return (
          v *
          ((i1 === i2 ? 1 : 0) - (i1 === j2 ? 1 : 0) - (j1 === i2 ? 1 : 0) + (j1 === j2 ? 1 : 0))
        )
      }
      cr = pairs.map(([i, j]) => ({
        i,
        j,
        diff: means[i]! - means[j]!,
        se: Math.sqrt(2 * v),
        df: dfR,
      }))
    }
  } else {
    const m = P.n.some((c) => c === 0) || k < 2 ? null : mixedFit(P)
    if (!m?.fit.ok) {
      cr = pairs.map(([i, j]) => ({ i, j, diff: Number.NaN, se: Number.NaN, df: Number.NaN }))
      cov = () => Number.NaN
    } else {
      const fit: VcFit = m.fit
      const ls = pairs.map(([i, j]) => levelDiff(i, j, k))
      const dfs =
        res.ddf === 'satterthwaite'
          ? satterthwaiteDf(fit, ls)
          : ls.map(() => containmentDf(m.design, []))
      cov = contrastCov(fit, ls)
      cr = pairs.map(([i, j], a) => {
        const e = contrastEstimate(fit, ls[a]!)
        return { i, j, diff: e.est, se: e.se, df: dfs[a]! }
      })
    }
  }
  let lambda: number[] | undefined
  if (opts.method === 'dunnett') {
    const control = opts.control ?? commonIndex(pairs)
    for (const [i, j] of pairs) {
      if (i !== control && j !== control) {
        throw new RangeError('dunnett: every pair must involve the control')
      }
    }
    // Paired (GG) comparisons: the equal-n Dunnett distribution (correlation ½) with df n − 1;
    // the paired differences' own correlations are not a product structure in general.
    lambda =
      res.kind === 'anova' && res.sphericity === 'gg'
        ? pairs.map(() => Math.SQRT1_2)
        : dunnettLambdas(pairs.length, cov!)
  }
  return contrastComparisons(cr, {
    method: opts.method,
    confLevel: opts.confLevel,
    alpha: opts.alpha,
    nMeans: opts.nMeans,
    familySize: opts.familySize,
    lambda,
  })
}

/**
 * Geisser–Greenhouse ε̂ = tr(E)²/(df·‖E‖²_F) of an m×m (row-major) error SSP matrix E; NaN
 * unless tr(E) > 0.
 */
export function ggEpsilon(E: ArrayLike<number>, m: number, df: number): number {
  let tr = 0
  let fro = 0
  for (let a = 0; a < m; a++) {
    tr += E[a * m + a]!
    for (let b = 0; b < m; b++) {
      const v = E[a * m + b]!
      fro += v * v
    }
  }
  return tr > 0 ? (tr * tr) / (df * fro) : Number.NaN
}

function commonIndex(pairs: readonly (readonly [number, number])[]): number {
  if (pairs.length === 0) return 0
  const [a, b] = pairs[0]!
  if (pairs.every(([i, j]) => i === a || j === a)) return a
  if (pairs.every(([i, j]) => i === b || j === b)) return b
  throw new RangeError('dunnett: pairs do not share a control')
}

/** λ's from the correlation matrix of the comparisons (orientation-free: |corr|). */
export function dunnettLambdas(m: number, cov: (a: number, b: number) => number): number[] {
  const R = new Float64Array(m * m)
  for (let a = 0; a < m; a++) {
    for (let b = 0; b < m; b++) {
      R[a * m + b] = Math.abs(cov(a, b)) / Math.sqrt(cov(a, a) * cov(b, b))
    }
  }
  return productLambdas(R, m)
}
