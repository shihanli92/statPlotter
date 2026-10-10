import { chiSqSf } from '../dist/chisq.ts'
import { normalQuantile } from '../dist/normal.ts'
import { leastSquares } from '../linalg/leastSquares.ts'
import { lgamma } from '../special/gamma.ts'
import { sum } from '../summation.ts'
import { glmCoefficients, newtonAscent, profileByOffset } from './glmCommon.ts'
import {
  buildDesign,
  type Design,
  expandCov,
  keptColumns,
  type RegCoefficient,
  rowMajor,
} from './multipleDesign.ts'

export interface PoissonOptions {
  /** Include an intercept (default true). */
  intercept?: boolean
  /** Default 0.95. */
  confLevel?: number
  /** CIs of the coefficients: Wald (default; Prism: SE × critical ratio) or profile likelihood. */
  ciMethod?: 'wald' | 'profile'
  /** Two-way interaction products X_i·X_j (predictor indices), named 'A:B'. */
  interactions?: readonly (readonly [number, number])[]
}

export interface PoissonCoefficient extends RegCoefficient {
  /** exp(estimate): the factor by which the expected count changes per unit of the predictor. */
  rateRatio: number
  rrLower: number
  rrUpper: number
}

export interface PoissonResult {
  /** Intercept first when included; stat = Wald z (Prism reports |z|). */
  coefficients: PoissonCoefficient[]
  n: number
  /** Full log-likelihood Σ(y·log μ − μ − log y!) (R's logLik). */
  logLik: number
  /** Intercept-only model (μ = ȳ), or μ = 1 without an intercept (R's null deviance). */
  nullLogLik: number
  /** Saturated model (μ = y): the largest possible log-likelihood. */
  maxLogLik: number
  /** 2(LLmax − LLfit), Prism's "deviance or G²". */
  deviance: number
  nullDeviance: number
  /** Likelihood-ratio test against the null model. */
  lrChiSq: number
  lrDf: number
  lrP: number
  /** Prism's pseudo R² = (LLfit − LL0) / (LLmax − LL0) = 1 − deviance / null deviance. */
  pseudoR2: number
  /** Σ(y − μ)²/μ. */
  pearsonChiSq: number
  /** Dispersion φ = Pearson χ² / (n − k) (> 1 suggests overdispersion). */
  dispersion: number
  /** −2LL + 2K + 2K(K+1)/(n − K − 1). */
  aicc: number
  fitted: number[]
  covariance: number[][]
  iterations: number
  confLevel: number
  ciMethod: 'wald' | 'profile'
  status: 'ok' | 'notConverged' | 'singular'
}

const NaN_ = Number.NaN
const MAX_ITER = 100

function logLik(y: ArrayLike<number>, eta: Float64Array, lfact: Float64Array): number {
  const t = new Float64Array(eta.length)
  for (let i = 0; i < eta.length; i++) t[i] = y[i]! * eta[i]! - Math.exp(eta[i]!) - lfact[i]!
  return sum(t)
}

interface Fit {
  beta: Float64Array
  eta: Float64Array
  ll: number
  covUnscaled: Float64Array
  converged: boolean
  iterations: number
}

/**
 * Maximum likelihood by Newton–Raphson (= Fisher scoring for the canonical log link): each step
 * solves min Σ μᵢ((yᵢ − μᵢ)/μᵢ − xᵢᵀδ)² by Householder QR, with step halving if the
 * log-likelihood falls; converged when max|δⱼ|/(1 + |βⱼ|) < 1e-10 (the step is then applied).
 */
function irls(
  cols: readonly Float64Array[],
  y: ArrayLike<number>,
  lfact: Float64Array,
  offset: Float64Array | null,
  init: Float64Array,
): Fit {
  const n = y.length
  const k = cols.length
  const Xr = rowMajor(cols, n)
  const beta = Float64Array.from(init)
  const evaluate = (b: Float64Array) => {
    const eta = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let s = offset ? offset[i]! : 0
      for (let j = 0; j < k; j++) s += cols[j]![i]! * b[j]!
      eta[i] = s
    }
    return { eta, ll: logLik(y, eta, lfact) }
  }
  const start = evaluate(beta)
  const w = new Float64Array(n)
  const z = new Float64Array(n)
  let cov: Float64Array = new Float64Array(k * k).fill(NaN_)
  const step = ({ eta }: { eta: Float64Array }): Float64Array | null => {
    for (let i = 0; i < n; i++) {
      const mu = Math.exp(eta[i]!)
      w[i] = mu
      z[i] = (y[i]! - mu) / mu
    }
    const f = leastSquares(Xr, n, k, z, w)
    cov = f.covUnscaled
    return f.rank < k ? null : f.coef
  }
  if (k === 0) return { beta, ...start, covUnscaled: cov, converged: true, iterations: 0 }
  const r = newtonAscent(beta, start, step, evaluate, { maxIter: MAX_ITER, maxHalvings: 60 })
  if (r.converged) step(r.state)
  const { eta, ll } = r.state
  return { beta, eta, ll, covUnscaled: cov, converged: r.converged, iterations: r.iterations }
}

/**
 * Poisson regression (log link) by maximum likelihood, Prism's "multiple Poisson regression" on
 * a multiple-variables table: Y is a count, log E[Y] = Xβ. Coefficient P values are Wald z
 * tests; CIs Wald (default) or profile likelihood; rate ratios are the exponentiated
 * coefficients and limits. Goodness of fit as Prism's guide ("Goodness of fit with Poisson
 * regression"): pseudo R² from the fitted, intercept-only and saturated log-likelihoods,
 * deviance G², and the dispersion ratio φ (here Pearson χ²/(n − k), the quasi-Poisson estimate).
 * Aliased predictors give status 'singular' with NaN for those coefficients (the rest is the
 * reduced fit, as R's glm).
 *
 * @param y counts (non-negative integers)
 * @param X n rows × p predictors
 */
export function poissonRegression(
  y: readonly number[],
  X: readonly (readonly number[])[],
  names: readonly string[],
  opts: PoissonOptions = {},
): PoissonResult {
  const fn = 'poissonRegression'
  const n = y.length
  if (X.length !== n) throw new RangeError(`${fn}: y has ${n} rows, X has ${X.length}`)
  for (const v of y)
    if (!(Number.isInteger(v) && v >= 0))
      throw new RangeError(`${fn}: Y must be counts (whole numbers ≥ 0)`)
  const intercept = opts.intercept ?? true
  const confLevel = opts.confLevel ?? 0.95
  const ciMethod = opts.ciMethod ?? 'wald'
  const design: Design = buildDesign(fn, X, names, opts, intercept)
  const K = design.cols.length
  const keep = keptColumns(design.cols, false)
  const kept = design.cols.filter((_, j) => keep[j])
  const k = kept.length
  const lfact = new Float64Array(n)
  for (let i = 0; i < n; i++) lfact[i] = lgamma(y[i]! + 1)
  const ybar = sum(y) / n
  const init = new Float64Array(k)
  const hasInt = intercept && keep[0] === true
  if (hasInt && ybar > 0) init[0] = Math.log(ybar)
  const fit = irls(kept, y, lfact, null, init)
  const status: PoissonResult['status'] = !fit.converged
    ? 'notConverged'
    : k < K
      ? 'singular'
      : 'ok'
  const usable = status !== 'notConverged'
  const ll = fit.ll
  const lf = sum(lfact)
  const sy = sum(y)
  const terms = new Float64Array(n)
  for (let i = 0; i < n; i++) terms[i] = y[i]! > 0 ? y[i]! * Math.log(y[i]!) : 0
  const ylogy = sum(terms)
  const maxLogLik = ylogy - sy - lf
  const nullLogLik = intercept ? (sy > 0 ? sy * Math.log(ybar) : 0) - sy - lf : -n - lf
  const deviance = 2 * (maxLogLik - ll)
  const nullDeviance = 2 * (maxLogLik - nullLogLik)
  const lrChiSq = 2 * (ll - nullLogLik)
  const lrDf = hasInt ? k - 1 : k
  const fitted = Array.from(fit.eta, Math.exp)
  for (let i = 0; i < n; i++) terms[i] = (y[i]! - fitted[i]!) ** 2 / fitted[i]!
  const pearsonChiSq = sum(terms)
  const aicc = n - k - 1 > 0 ? -2 * ll + 2 * k + (2 * k * (k + 1)) / (n - k - 1) : NaN_

  const z = normalQuantile(1 - (1 - confLevel) / 2)
  const cov = fit.covUnscaled
  const profile = profileByOffset(
    kept,
    fit.beta,
    (others, off, start) => irls(others, y, lfact, off, start).ll,
  )
  const coefficients: PoissonCoefficient[] = glmCoefficients(
    design.names,
    keep,
    usable,
    fit.beta,
    cov,
    z,
    { method: ciMethod, ll, profile },
  ).map((c) => ({
    ...c,
    rateRatio: Math.exp(c.estimate),
    rrLower: Math.exp(c.lower),
    rrUpper: Math.exp(c.upper),
  }))
  const covScaled = new Float64Array(k * k)
  for (let i = 0; i < k * k; i++) covScaled[i] = usable ? cov[i]! : NaN_
  return {
    coefficients,
    n,
    logLik: ll,
    nullLogLik,
    maxLogLik,
    deviance,
    nullDeviance,
    lrChiSq,
    lrDf,
    lrP: lrDf > 0 ? chiSqSf(lrChiSq, lrDf) : NaN_,
    pseudoR2: (ll - nullLogLik) / (maxLogLik - nullLogLik),
    pearsonChiSq,
    dispersion: n - k > 0 ? pearsonChiSq / (n - k) : NaN_,
    aicc,
    fitted,
    covariance: expandCov(covScaled, keep),
    iterations: fit.iterations,
    confLevel,
    ciMethod,
    status,
  }
}
