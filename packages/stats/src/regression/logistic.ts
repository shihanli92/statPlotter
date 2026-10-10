import { hanleyMcNeil } from '../diagnostic/roc.ts'
import { chiSqSf } from '../dist/chisq.ts'
import { normalQuantile, normalSf } from '../dist/normal.ts'
import { leastSquares } from '../linalg/leastSquares.ts'
import { sum } from '../summation.ts'
import { glmCoefficients, newtonAscent, profileByOffset } from './glmCommon.ts'
import {
  buildDesign,
  type Design,
  expandCov,
  keptColumns,
  type RegCoefficient,
  rowMajor,
  vifs,
} from './multipleDesign.ts'

export interface LogisticOptions {
  /** Include an intercept (default true). */
  intercept?: boolean
  /** Default 0.95. */
  confLevel?: number
  /** CIs of the coefficients and odds ratios: profile likelihood (default, as Prism) or Wald. */
  ciMethod?: 'wald' | 'profile'
  /** Classification cutoff: predicted positive when the probability is > cutoff. Default 0.5. */
  cutoff?: number
  /** Two-way interaction products X_i·X_j (predictor indices), named 'A:B'. */
  interactions?: readonly (readonly [number, number])[]
}

export interface LogisticCoefficient extends RegCoefficient {
  oddsRatio: number
  orLower: number
  orUpper: number
  /** Variance inflation factor from the predictors alone (null for the intercept). */
  vif: number | null
}

export interface LogisticResult {
  /** Intercept first when included. stat = Wald z; CIs per `ciMethod`. */
  coefficients: LogisticCoefficient[]
  n: number
  /** Number of Y = 1. */
  nEvents: number
  logLik: number
  /**
   * Log-likelihood of the intercept-only model (with an intercept), or of the model with every
   * coefficient 0, i.e. p = ½ (without one; R's glm null deviance does the same).
   */
  nullLogLik: number
  /** Likelihood-ratio test against the null model above. */
  lrChiSq: number
  lrDf: number
  lrP: number
  /** −2LL + 2K + 2K(K+1)/(n − K − 1), K = number of coefficients. */
  aicc: number
  pseudoR2: { tjur: number; mcFadden: number; coxSnell: number; nagelkerke: number }
  /** Hosmer–Lemeshow with 10 groups of equal size (see `hosmerLemeshow`); null when n < 10. */
  hosmerLemeshow: { chiSq: number; df: number; p: number } | null
  /**
   * Area under the ROC curve of the fitted probabilities; SE by Hanley & McNeil (1982) with Q1,
   * Q2 computed from the data; CI = area ± z·SE clipped to [0, 1]; P from z = (area − ½)/SE₀
   * with SE₀ the Hanley–McNeil SE at area ½ (Prism's ROC calculation).
   */
  auc: { value: number; se: number; lower: number; upper: number; p: number }
  /** Positive = predicted probability > cutoff; tp = observed 1 predicted positive. */
  classification: {
    cutoff: number
    tp: number
    fp: number
    tn: number
    fn: number
    /** tp / (tp + fp) */
    positivePredictivePower: number
    /** tn / (tn + fn) */
    negativePredictivePower: number
    /** (tp + tn) / n */
    fractionCorrect: number
  }
  /** Predicted probabilities. */
  fitted: number[]
  /** Inverse Fisher information (design order); NaN rows/columns for aliased terms. */
  covariance: number[][]
  iterations: number
  confLevel: number
  ciMethod: 'wald' | 'profile'
  status: 'ok' | 'separation' | 'notConverged' | 'singular'
}

const NaN_ = Number.NaN
/** glm's "fitted probabilities numerically 0 or 1" threshold (10·ε). */
const EPS01 = 10 * 2.220446049250313e-16
const MAX_ITER = 100

/** log(1 + e^x) without overflow or cancellation. */
function softplus(x: number): number {
  return x > 0 ? x + Math.log1p(Math.exp(-x)) : Math.log1p(Math.exp(x))
}

/** 1/(1 + e^−x). */
function expit(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x))
  const e = Math.exp(x)
  return e / (1 + e)
}

interface IrlsFit {
  beta: Float64Array
  eta: Float64Array
  ll: number
  /** (XᵀWX)⁻¹ row-major k×k. */
  covUnscaled: Float64Array
  converged: boolean
  /** Some fitted probability is numerically 0 or 1 and the fit could not improve further. */
  separated: boolean
  iterations: number
}

function logLik(y: ArrayLike<number>, eta: Float64Array): number {
  const t = new Float64Array(eta.length)
  for (let i = 0; i < eta.length; i++) t[i] = y[i]! === 1 ? -softplus(-eta[i]!) : -softplus(eta[i]!)
  return sum(t)
}

/**
 * Maximum likelihood by Newton–Raphson (= IRLS / Fisher scoring for the canonical logit link;
 * McCullagh & Nelder, Generalized Linear Models, 2nd ed., §4.4). Each step solves the weighted
 * least-squares problem min Σ wᵢ(rᵢ/wᵢ − xᵢᵀδ)², wᵢ = pᵢ(1 − pᵢ), rᵢ = yᵢ − pᵢ, by Householder
 * QR (never forming XᵀWX), with step halving if the log-likelihood falls. Converged when
 * max|δⱼ|/(1 + |βⱼ|) < 1e-10; the step is then applied once more, so the result is at the
 * maximum to working precision (Newton converges quadratically).
 */
function irls(
  cols: readonly Float64Array[],
  y: ArrayLike<number>,
  offset: Float64Array | null,
  init: Float64Array | null,
): IrlsFit {
  const n = y.length
  const k = cols.length
  const Xr = rowMajor(cols, n)
  const beta = init ? Float64Array.from(init) : new Float64Array(k)
  const evaluate = (b: Float64Array) => {
    const eta = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let s = offset ? offset[i]! : 0
      for (let j = 0; j < k; j++) s += cols[j]![i]! * b[j]!
      eta[i] = s
    }
    return { eta, ll: logLik(y, eta) }
  }
  const start = evaluate(beta)
  const w = new Float64Array(n)
  const z = new Float64Array(n)
  let cov: Float64Array = new Float64Array(k * k).fill(NaN_)
  const extreme = (eta: Float64Array): boolean => {
    for (let i = 0; i < n; i++) {
      if (expit(eta[i]!) < EPS01 || expit(-eta[i]!) < EPS01) return true
    }
    return false
  }
  /** Newton step at eta; returns null when the weighted problem is rank deficient. */
  const step = ({ eta }: { eta: Float64Array }): Float64Array | null => {
    for (let i = 0; i < n; i++) {
      const p = expit(eta[i]!)
      const q = expit(-eta[i]!)
      const wi = p * q
      if (wi > 1e-300) {
        w[i] = wi
        z[i] = (y[i] === 1 ? q : -p) / wi
      } else {
        w[i] = 0
        z[i] = 0
      }
    }
    if (k === 0) return new Float64Array(0)
    const f = leastSquares(Xr, n, k, z, w)
    cov = f.covUnscaled
    if (f.rank < k) return null
    return f.coef
  }
  if (k === 0) {
    const { eta, ll } = start
    return { beta, eta, ll, covUnscaled: cov, converged: true, separated: false, iterations: 0 }
  }
  const r = newtonAscent(beta, start, step, evaluate, {
    maxIter: MAX_ITER,
    maxHalvings: 40,
    // ℓ no longer rising while some fitted probability is numerically 0 or 1: separation.
    stop: (gain, s) => gain <= 1e-13 * Math.max(1, Math.abs(s.ll)) && extreme(s.eta),
  })
  const { eta, ll } = r.state
  const { converged, iterations } = r
  const separated = r.stopped || (!converged && extreme(eta))
  if (converged) step(r.state) // covariance at the final estimates
  return { beta, eta, ll, covUnscaled: cov, converged, separated, iterations }
}

/**
 * Hosmer–Lemeshow statistic as Prism describes it: observations sorted by predicted probability
 * (ties in the original row order) and split into `groups` groups of (as nearly as possible)
 * equal size — group g holds sorted positions ⌊g·n/G⌋ … ⌊(g+1)·n/G⌋ − 1. Per group, expected 1s
 * = Σp, expected 0s = N − Σp; χ² = Σ (O − E)²/E over both cells of every group; df = G − 2.
 */
export function hosmerLemeshow(
  y: ArrayLike<number>,
  p: ArrayLike<number>,
  groups = 10,
): { chiSq: number; df: number; p: number } | null {
  const n = y.length
  if (n < groups || groups < 3) return null
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => p[a]! - p[b]! || a - b)
  let chiSq = 0
  for (let g = 0; g < groups; g++) {
    const lo = Math.floor((g * n) / groups)
    const hi = Math.floor(((g + 1) * n) / groups)
    let o1 = 0
    const ps: number[] = []
    for (let r = lo; r < hi; r++) {
      o1 += y[order[r]!]!
      ps.push(p[order[r]!]!)
    }
    const e1 = sum(ps)
    const e0 = hi - lo - e1
    const o0 = hi - lo - o1
    chiSq += (o1 - e1) ** 2 / e1 + (o0 - e0) ** 2 / e0
  }
  const df = groups - 2
  return { chiSq, df, p: chiSqSf(chiSq, df) }
}

/**
 * Area under the empirical ROC curve of scores for positives (y = 1) vs negatives (ties count ½),
 * with the Hanley & McNeil (1982, Radiology 143:29, Table II) standard error, Q1 and Q2 computed
 * from the data (hanleyMcNeil, as rocCurve). P: z = (A − ½)/SE₀ (Prism, "Calculation details for
 * ROC curves").
 */
export function aucHanleyMcNeil(
  y: ArrayLike<number>,
  score: ArrayLike<number>,
  confLevel = 0.95,
): { value: number; se: number; lower: number; upper: number; p: number } {
  const pos: number[] = []
  const neg: number[] = []
  for (let i = 0; i < y.length; i++) (y[i] === 1 ? pos : neg).push(score[i]!)
  if (pos.length === 0 || neg.length === 0)
    return { value: NaN_, se: NaN_, lower: NaN_, upper: NaN_, p: NaN_ }
  const { area: A, se, se0 } = hanleyMcNeil(neg, pos)
  const z = normalQuantile(1 - (1 - confLevel) / 2)
  return {
    value: A,
    se,
    lower: Math.max(0, A - z * se),
    upper: Math.min(1, A + z * se),
    p: Math.min(1, 2 * normalSf(Math.abs(A - 0.5) / se0)),
  }
}

/**
 * Multiple logistic regression by maximum likelihood (Prism's "Multiple logistic regression").
 *
 * Coefficient P values are Wald z tests (Prism: "|Z| = estimate / SE"); CIs are profile
 * likelihood by default ("Prism actually calculates … profile likelihood confidence intervals"),
 * or Wald on request; odds-ratio limits are the exponentiated coefficient limits.
 *
 * Degenerate data never throw: complete or quasi-complete separation (some fitted probability
 * numerically 0 or 1 while the likelihood can still only creep upward — glm's 10ε rule) gives
 * status 'separation' with NaN coefficients (log-likelihood, tests and classification are those
 * at the last iterate); aliased predictors give 'singular' with NaN for those coefficients (the
 * rest is the reduced fit, as R's glm).
 *
 * @param y 0/1 outcomes
 * @param X n rows × p predictors
 */
export function logisticRegression(
  y: readonly number[],
  X: readonly (readonly number[])[],
  names: readonly string[],
  opts: LogisticOptions = {},
): LogisticResult {
  const fn = 'logisticRegression'
  const n = y.length
  if (X.length !== n) throw new RangeError(`${fn}: y has ${n} rows, X has ${X.length}`)
  for (const v of y) if (v !== 0 && v !== 1) throw new RangeError(`${fn}: Y must be 0 or 1`)
  const intercept = opts.intercept ?? true
  const confLevel = opts.confLevel ?? 0.95
  const ciMethod = opts.ciMethod ?? 'profile'
  const cutoff = opts.cutoff ?? 0.5
  const design: Design = buildDesign(fn, X, names, opts, intercept)
  const K = design.cols.length
  const keep = keptColumns(design.cols, false)
  const kept = design.cols.filter((_, j) => keep[j])
  const k = kept.length
  const nEvents = sum(y)

  const fit = irls(kept, y, null, null)
  const fitted = Array.from(fit.eta, expit)
  const status: LogisticResult['status'] = fit.separated
    ? 'separation'
    : !fit.converged
      ? 'notConverged'
      : k < K
        ? 'singular'
        : 'ok'
  const usable = status === 'ok' || status === 'singular'

  const n0 = n - nEvents
  const nullLogLik = intercept
    ? (nEvents > 0 ? nEvents * Math.log(nEvents / n) : 0) + (n0 > 0 ? n0 * Math.log(n0 / n) : 0)
    : n * Math.log(0.5)
  const ll = fit.ll
  const lrChiSq = 2 * (ll - nullLogLik)
  const hasInt = intercept && keep[0] === true
  const lrDf = hasInt ? k - 1 : k
  const aicc = n - k - 1 > 0 ? -2 * ll + 2 * k + (2 * k * (k + 1)) / (n - k - 1) : NaN_

  const z = normalQuantile(1 - (1 - confLevel) / 2)
  const cov = fit.covUnscaled
  const profile = profileByOffset(
    kept,
    fit.beta,
    (others, off, init) => irls(others, y, off, init).ll,
  )
  const vif =
    usable && k === K
      ? vifsOf(design, keep, kept)
      : design.cols.map((_, j) => (intercept && j === 0 ? null : NaN_))
  const coefficients: LogisticCoefficient[] = glmCoefficients(
    design.names,
    keep,
    usable,
    fit.beta,
    cov,
    z,
    { method: ciMethod, ll, profile },
  ).map((c, j) => ({
    ...c,
    oddsRatio: Math.exp(c.estimate),
    orLower: Math.exp(c.lower),
    orUpper: Math.exp(c.upper),
    vif: vif[j]!,
  }))

  // Pseudo R².
  const p1: number[] = []
  const p0: number[] = []
  fitted.forEach((p, i) => {
    ;(y[i] === 1 ? p1 : p0).push(p)
  })
  const tjur = Math.abs(sum(p1) / p1.length - sum(p0) / p0.length)
  const mcFadden = 1 - ll / nullLogLik
  const coxSnell = -Math.expm1((2 * (nullLogLik - ll)) / n)
  const nagelkerke = coxSnell / -Math.expm1((2 * nullLogLik) / n)

  let tp = 0
  let fp = 0
  let tn = 0
  let fnn = 0
  fitted.forEach((p, i) => {
    const pos = p > cutoff
    if (y[i] === 1) {
      if (pos) tp++
      else fnn++
    } else if (pos) fp++
    else tn++
  })

  const covScaled = new Float64Array(k * k)
  for (let i = 0; i < k * k; i++) covScaled[i] = usable ? cov[i]! : NaN_
  return {
    coefficients,
    n,
    nEvents,
    logLik: ll,
    nullLogLik,
    lrChiSq,
    lrDf,
    lrP: lrDf > 0 ? chiSqSf(lrChiSq, lrDf) : NaN_,
    aicc,
    pseudoR2: { tjur, mcFadden, coxSnell, nagelkerke },
    hosmerLemeshow: hosmerLemeshow(y, fitted),
    auc: aucHanleyMcNeil(y, fitted, confLevel),
    classification: {
      cutoff,
      tp,
      fp,
      tn,
      fn: fnn,
      positivePredictivePower: tp / (tp + fp),
      negativePredictivePower: tn / (tn + fnn),
      fractionCorrect: (tp + tn) / n,
    },
    fitted,
    covariance: expandCov(covScaled, keep),
    iterations: fit.iterations,
    confLevel,
    ciMethod,
    status,
  }
}

/** Predictor-only VIFs (as multiple linear regression) from an unweighted QR of the design. */
function vifsOf(design: Design, keep: readonly boolean[], kept: readonly Float64Array[]) {
  const n = design.n
  const k = kept.length
  const y = new Float64Array(n)
  const f = leastSquares(rowMajor(kept, n), n, k, y)
  return vifs(design, keep, f.covUnscaled)
}
