import { fSf } from '../dist/f.ts'
import { tQuantile, tSf } from '../dist/t.ts'
import { dot2 } from '../linalg/eft.ts'
import { refinedMean, sum } from '../summation.ts'
import {
  buildDesign,
  centredLeastSquares,
  expandCov,
  keptColumns,
  type RegCoefficient,
  vifs,
} from './multipleDesign.ts'
import { aiccLeastSquares } from './nonlinear.ts'

export type { RegCoefficient } from './multipleDesign.ts'

export interface MultipleLinearOptions {
  /** Include an intercept (default true). */
  intercept?: boolean
  /** Default 0.95. */
  confLevel?: number
  /** Two-way interaction products X_i·X_j (predictor indices), named 'A:B'. */
  interactions?: readonly (readonly [number, number])[]
}

export interface MultipleLinearResult {
  /** Intercept first when included (vif null). Aliased columns: all NaN. */
  coefficients: (RegCoefficient & { vif: number | null })[]
  n: number
  /** n − number of estimated coefficients. */
  df: number
  /** 1 − SS/SStot, SStot about the mean of Y also without an intercept (Prism's convention). */
  rSquared: number
  /** 1 − (SS/df)/(SStot/(n − 1)). */
  adjRSquared: number
  /** √(SS/df). */
  syx: number
  /** Residual sum of squares. */
  ss: number
  /** n·ln(SS/n) + 2K + 2K(K+1)/(n − K − 1), K = coefficients + 1 (Prism's least-squares AICc). */
  aicc: number
  /**
   * Overall F test, H₀: every coefficient except the intercept is 0 (with an intercept); without
   * an intercept H₀ is Y = 0 (all coefficients 0), as R's summary.lm.
   */
  F: number
  dfn: number
  dfd: number
  p: number
  fitted: number[]
  residuals: number[]
  /** Covariance of the coefficients (design order); NaN rows/columns for aliased terms. */
  covariance: number[][]
  confLevel: number
  status: 'ok' | 'singular'
}

const NaN_ = Number.NaN

/**
 * Multiple linear least-squares regression Y = β₀ + Σ βⱼXⱼ (+ interaction products), as Prism's
 * "Multiple linear regression" with least squares.
 *
 * The fit is by Householder QR on the centred design with iterative refinement in the original
 * basis (`centredLeastSquares`), so it never forms XᵀX and is unaffected by large offsets.
 * Aliased columns (exactly or numerically collinear, see `keptColumns`) are dropped like R's lm:
 * their coefficients are NaN and the status is 'singular'; fitted values, SS, R² and the F test
 * are those of the reduced model (unique). CIs are estimate ± t(df)·SE.
 *
 * @param X n rows × p predictors
 */
export function multipleLinearRegression(
  y: readonly number[],
  X: readonly (readonly number[])[],
  names: readonly string[],
  opts: MultipleLinearOptions = {},
): MultipleLinearResult {
  const fn = 'multipleLinearRegression'
  const n = y.length
  if (X.length !== n) throw new RangeError(`${fn}: y has ${n} rows, X has ${X.length}`)
  for (const v of y) if (!Number.isFinite(v)) throw new RangeError(`${fn}: non-finite Y`)
  const intercept = opts.intercept ?? true
  const confLevel = opts.confLevel ?? 0.95
  const design = buildDesign(fn, X, names, opts, intercept)
  const K = design.cols.length
  const keep = keptColumns(design.cols, false)
  const kept = design.cols.filter((_, j) => keep[j])
  const k = kept.length
  const singular = k < K

  const hasInt = intercept && keep[0] === true
  const fit =
    n > 0 && k > 0
      ? centredLeastSquares(kept, y, hasInt)
      : { coef: new Float64Array(0), covUnscaled: new Float64Array(0) }
  const coef = fit.coef
  const fitted: number[] = []
  const residuals: number[] = []
  const row = new Float64Array(k)
  const r2 = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) row[j] = -kept[j]![i]!
    const r = dot2(row, coef, k, y[i]!)
    residuals.push(r)
    fitted.push(y[i]! - r)
    r2[i] = r * r
  }
  const ss = sum(r2)
  const df = n - k
  const s2 = df > 0 ? ss / df : NaN_

  // Centred total SS (two-pass mean).
  const my = refinedMean(y)
  const dev = new Float64Array(n)
  for (let i = 0; i < n; i++) dev[i] = (y[i]! - my) ** 2
  const ssTot = sum(dev)
  const rSquared = 1 - ss / ssTot
  const adjRSquared = df > 0 && n > 1 ? 1 - ss / df / (ssTot / (n - 1)) : NaN_

  // Overall F from the regression SS computed from the fitted values (no cancellation).
  const dfn = hasInt ? k - 1 : k
  for (let i = 0; i < n; i++) dev[i] = (hasInt ? fitted[i]! - my : fitted[i]!) ** 2
  const ssReg = sum(dev)
  const F = dfn > 0 && df > 0 ? ssReg / dfn / s2 : NaN_
  const p = dfn > 0 && df > 0 ? fSf(F, dfn, df) : NaN_

  const t = df > 0 ? tQuantile(1 - (1 - confLevel) / 2, df) : NaN_
  const covK = new Float64Array(k * k)
  for (let i = 0; i < k * k; i++) covK[i] = s2 * fit.covUnscaled[i]!
  const vif = singular
    ? design.cols.map((_, j) => (intercept && j === 0 ? null : NaN_))
    : vifs(design, keep, fit.covUnscaled)
  const coefficients: MultipleLinearResult['coefficients'] = []
  let a = 0
  for (let j = 0; j < K; j++) {
    const name = design.names[j]!
    if (!keep[j]) {
      coefficients.push({
        name,
        estimate: NaN_,
        se: NaN_,
        lower: NaN_,
        upper: NaN_,
        stat: NaN_,
        p: NaN_,
        vif: vif[j]!,
      })
      continue
    }
    const b = coef[a]!
    const se = Math.sqrt(covK[a * k + a]!)
    const tv = b / se
    coefficients.push({
      name,
      estimate: b,
      se,
      lower: b - t * se,
      upper: b + t * se,
      stat: tv,
      p: df > 0 ? 2 * tSf(Math.abs(tv), df) : NaN_,
      vif: vif[j]!,
    })
    a++
  }
  return {
    coefficients,
    n,
    df,
    rSquared,
    adjRSquared,
    syx: Math.sqrt(s2),
    ss,
    aicc: ss > 0 ? aiccLeastSquares(n, ss, k) : NaN_,
    F,
    dfn,
    dfd: df,
    p,
    fitted,
    residuals,
    covariance: expandCov(covK, keep),
    confLevel,
    status: singular ? 'singular' : 'ok',
  }
}
