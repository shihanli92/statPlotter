import { columnOf } from '../arrays.ts'
import { chiSqSf } from '../dist/chisq.ts'
import { fSf } from '../dist/f.ts'
import { normalQuantile } from '../dist/normal.ts'
import { tQuantile } from '../dist/t.ts'
import { sum } from '../summation.ts'
import { keptColumns } from './multipleDesign.ts'

const NaN_ = Number.NaN

/**
 * Categorical (and continuous) predictors for the regression models of multiple-variables
 * tables (multiple linear, logistic, Poisson and Cox regression), as Prism's multiple regression
 * dialogs: a categorical variable with L levels is dummy (indicator, "reference") coded as L − 1
 * columns, one per level other than the reference level (1 in rows at that level, else 0), named
 * `Name[level]`; an interaction of chosen variables is the product of their columns (every
 * combination), named with colons, e.g. `Age:Sex[M]` or `Sex[M]:Arm[B]` — "the interaction term
 * uses the categorical variable's non-reference level" (Prism Curve Fitting Guide, "Choosing a
 * model for multiple regression"). The same coding as R's `model.matrix` with `contr.treatment`
 * and the reference level first.
 *
 * Tests of a whole term (every column of a variable or interaction together, Prism's "ANOVA
 * table" of multiple regression):
 * - least squares: Type III F test, the rise in the residual SS when the term's columns are
 *   dropped from the full model (with the other columns as coded), over its df, divided by the
 *   full model's residual mean square (= car::Anova(type = 3) with contr.treatment);
 * - likelihood models: the likelihood-ratio χ² of the same nested pair of fits.
 * The df of a term is the rank it adds to the rest of the model (fewer than its columns when some
 * are aliased).
 */

/** A predictor: continuous values, or a categorical variable as level indices per row. */
export type DesignVariable =
  | { kind: 'numeric'; name: string; values: readonly number[] }
  | {
      kind: 'categorical'
      name: string
      /** Level labels, in display order. */
      levels: readonly string[]
      /** Level index of every row. */
      codes: readonly number[]
      /** Index of the reference level (no column). */
      reference: number
    }

export interface DesignTerm {
  /** e.g. 'Age', 'Sex', 'Age:Sex'. */
  name: string
  /** Variable indices (one for a main effect). */
  vars: number[]
  /** Indices of the term's columns in `X` (and `names`). */
  columns: number[]
}

export interface TermDesign {
  /** n rows × p columns (no intercept). */
  X: number[][]
  names: string[]
  terms: DesignTerm[]
}

interface VarColumn {
  label: string
  value: (row: number) => number
}

function variableColumns(v: DesignVariable): VarColumn[] {
  if (v.kind === 'numeric') return [{ label: v.name, value: (i) => v.values[i]! }]
  const out: VarColumn[] = []
  v.levels.forEach((level, l) => {
    if (l === v.reference) return
    out.push({ label: `${v.name}[${level}]`, value: (i) => (v.codes[i] === l ? 1 : 0) })
  })
  return out
}

/**
 * The design columns of the given terms (each a list of variable indices; a single index is a
 * main effect), in term order. Within an interaction the first variable's columns vary slowest.
 */
export function termDesign(
  vars: readonly DesignVariable[],
  terms: readonly (readonly number[])[],
): TermDesign {
  const n =
    vars.length === 0
      ? 0
      : vars[0]!.kind === 'numeric'
        ? vars[0]!.values.length
        : vars[0]!.codes.length
  for (const v of vars) {
    const len = v.kind === 'numeric' ? v.values.length : v.codes.length
    if (len !== n) throw new RangeError(`termDesign: ${v.name} has ${len} rows, expected ${n}`)
    if (v.kind === 'categorical' && !(v.reference >= 0 && v.reference < v.levels.length))
      throw new RangeError(`termDesign: reference level of ${v.name} out of range`)
  }
  const cols: VarColumn[] = []
  const out: DesignTerm[] = []
  for (const t of terms) {
    if (!t.length || t.some((j) => !(Number.isInteger(j) && j >= 0 && j < vars.length)))
      throw new RangeError(`termDesign: term [${t.join(', ')}] out of range`)
    let prod: VarColumn[] = [{ label: '', value: () => 1 }]
    for (const j of t) {
      const next: VarColumn[] = []
      for (const a of prod)
        for (const b of variableColumns(vars[j]!))
          next.push({
            label: a.label ? `${a.label}:${b.label}` : b.label,
            value: (i) => a.value(i) * b.value(i),
          })
      prod = next
    }
    const start = cols.length
    cols.push(...prod)
    out.push({
      name: t.map((j) => vars[j]!.name).join(':'),
      vars: [...t],
      columns: prod.map((_, k) => start + k),
    })
  }
  const X = Array.from({ length: n }, (_, i) => cols.map((c) => c.value(i)))
  return { X, names: cols.map((c) => c.label), terms: out }
}

/** A design row for given predictor values (the prediction of a new point). */
export function designRow(
  vars: readonly DesignVariable[],
  terms: readonly (readonly number[])[],
  values: readonly (number | { level: number })[],
): number[] {
  const one: DesignVariable[] = vars.map((v, j) => {
    const x = values[j]!
    if (v.kind === 'numeric') return { ...v, values: [typeof x === 'number' ? x : Number.NaN] }
    return { ...v, codes: [typeof x === 'number' ? x : x.level] }
  })
  return termDesign(one, terms).X[0]!
}

/** Rank of the columns (with a column of ones first when `intercept`). */
export function designRank(
  X: readonly (readonly number[])[],
  columns: readonly number[],
  intercept: boolean,
): number {
  const n = X.length
  const cols: Float64Array[] = []
  if (intercept) cols.push(new Float64Array(n).fill(1))
  for (const j of columns) cols.push(columnOf(X, j))
  return keptColumns(cols, false).filter(Boolean).length
}

export interface TermTest {
  name: string
  /** Sum of squares (least squares) or likelihood-ratio χ² (likelihood models). */
  stat: number
  df: number
  /** Least squares: SS/df. */
  ms?: number
  /** Least squares: F = MS / MS_residual. */
  F?: number
  p: number
}

export interface LinearAnovaTable {
  terms: TermTest[]
  /** Regression (model) row: SS_total − SS_residual. */
  model: { ss: number; df: number; ms: number; F: number; p: number }
  residual: { ss: number; df: number; ms: number }
  /** Corrected total (about the mean; uncorrected without an intercept, as R's summary.lm). */
  total: { ss: number; df: number }
}

/**
 * Prism's ANOVA table of a multiple linear regression (Type III sums of squares): a fit of the
 * full model and one per term without that term's columns. `rss(columns)` returns the residual
 * SS of a least-squares fit on those columns of X (plus the intercept when `intercept`).
 */
export function linearAnovaTable(
  y: readonly number[],
  design: TermDesign,
  intercept: boolean,
  rss: (columns: number[]) => number,
): LinearAnovaTable {
  const n = y.length
  const all = design.names.map((_, j) => j)
  const rankFull = designRank(design.X, all, intercept)
  const ssRes = rss(all)
  const dfRes = n - rankFull
  const msRes = ssRes / dfRes
  const terms = design.terms.map((t): TermTest => {
    const drop = new Set(t.columns)
    const rest = all.filter((j) => !drop.has(j))
    const df = rankFull - designRank(design.X, rest, intercept)
    const ss = df > 0 ? Math.max(0, rss(rest) - ssRes) : Number.NaN
    const ms = ss / df
    const F = ms / msRes
    return { name: t.name, stat: ss, df, ms, F, p: dfRes > 0 && df > 0 ? fSf(F, df, dfRes) : NaN_ }
  })
  const m = intercept ? sum(y) / n : 0
  const ssTot = sum(y.map((v) => (v - m) ** 2))
  const dfModel = intercept ? rankFull - 1 : rankFull
  const ssModel = ssTot - ssRes
  const msModel = ssModel / dfModel
  return {
    terms,
    model: {
      ss: ssModel,
      df: dfModel,
      ms: msModel,
      F: msModel / msRes,
      p: dfModel > 0 && dfRes > 0 ? fSf(msModel / msRes, dfModel, dfRes) : Number.NaN,
    },
    residual: { ss: ssRes, df: dfRes, ms: msRes },
    total: { ss: ssTot, df: intercept ? n - 1 : n },
  }
}

/**
 * Likelihood-ratio tests of every term: χ² = 2(ℓ_full − ℓ_without term) on the rank the term
 * adds. `logLik(columns)` fits the model on those columns of X (plus the intercept, if any, or
 * the baseline hazard for Cox) and returns its maximized log-likelihood. For Cox pass
 * `intercept` = true: a constant column is aliased with the baseline hazard.
 */
export function likelihoodRatioTerms(
  design: TermDesign,
  intercept: boolean,
  logLik: (columns: number[]) => number,
): TermTest[] {
  const all = design.names.map((_, j) => j)
  const rankFull = designRank(design.X, all, intercept)
  const llFull = logLik(all)
  return design.terms.map((t) => {
    const drop = new Set(t.columns)
    const rest = all.filter((j) => !drop.has(j))
    const df = rankFull - designRank(design.X, rest, intercept)
    const chi = df > 0 ? Math.max(0, 2 * (llFull - logLik(rest))) : NaN_
    return { name: t.name, stat: chi, df, p: df > 0 ? chiSqSf(chi, df) : NaN_ }
  })
}

export interface Prediction {
  /** Linear predictor x·β (aliased coefficients, NaN, contribute nothing). */
  eta: number
  /** √(x V xᵀ) over the estimated coefficients. */
  se: number
}

/**
 * The linear predictor at a design row `x` (same order as the coefficients, including the
 * intercept when the model has one) and its standard error from the coefficients' covariance
 * matrix. Aliased coefficients (NaN estimate) are left out, as R's predict for rank-deficient fits.
 */
export function linearPredictor(
  coef: readonly number[],
  cov: readonly (readonly number[])[],
  x: readonly number[],
): Prediction {
  if (x.length !== coef.length)
    throw new RangeError(`linearPredictor: ${x.length} values for ${coef.length} coefficients`)
  const idx = coef.map((_, j) => j).filter((j) => !Number.isNaN(coef[j]!))
  const t = idx.map((j) => coef[j]! * x[j]!)
  const eta = sum(t)
  let v = 0
  for (const a of idx) for (const b of idx) v += x[a]! * cov[a]![b]! * x[b]!
  return { eta, se: Math.sqrt(Math.max(0, v)) }
}

/** CI of a mean response on the model's scale: t (least squares, `df`) or z (likelihood). */
export function predictionInterval(
  p: Prediction,
  confLevel: number,
  df?: number,
): { lower: number; upper: number } {
  const a = (1 - confLevel) / 2
  const c = df === undefined ? normalQuantile(1 - a) : df > 0 ? tQuantile(a, df, false) : NaN_
  return { lower: p.eta - c * p.se, upper: p.eta + c * p.se }
}
