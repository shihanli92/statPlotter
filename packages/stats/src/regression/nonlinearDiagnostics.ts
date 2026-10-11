import { valuesOf } from '../arrays.ts'
import { spearmanCorrelation } from '../correlation/spearman.ts'
import { symmetricInverse } from '../linalg/leastSquares.ts'
import { CBRT_EPS } from '../numint/centralDiff.ts'
import {
  type CurveModel,
  type FitData,
  modelFor,
  modelGrad,
  type NonlinearFit,
  sqrtWeight,
} from './nonlinear.ts'

/**
 * Diagnostics of a nonlinear fit that need the model: residuals and Hougaard's measure of
 * skewness.
 *
 * Hougaard's skewness (Hougaard 1985, "The appropriateness of the asymptotic distribution in a
 * nonlinear regression model in relation to curvature", JRSS B 47: 103–114; in the form of
 * Ratkowsky 1990, Handbook of Nonlinear Regression Models, §2.5), for parameter i:
 *
 *   γ₁ᵢ = −(s²)² Σⱼₖₗ Lᵢⱼ Lᵢₖ Lᵢₗ (Wⱼₖₗ + Wₖⱼₗ + Wₗⱼₖ) / (s²·Lᵢᵢ)^{3/2}
 *
 * with L = (FᵀF)⁻¹, F the Jacobian of the model (∂f/∂θ at each point), Wⱼₖₗ = Σᵤ Fᵤⱼ Hᵤₖₗ,
 * H the second derivatives ∂²f/∂θₖ∂θₗ, and s² = SS/df. |γ₁| < 0.1 means the estimate behaves
 * close to linearly (its symmetric CI is reliable); above 0.25 the skewness is apparent, and
 * above 1 considerable. Second derivatives are central differences of the model's analytic
 * gradient (relative accuracy ~1e-10). Computed per data set, or over all data sets together for
 * a global fit with shared parameters.
 *
 * Weighted fits (as SAS PROC NLIN with a _WEIGHT_ variable): the weights are held at their values
 * at the solution, wᵤ = w(ŷᵤ)·(fixed point weight), and F, H are those of the weighted model
 * √wᵤ·f, so L = (F̃ᵀF̃)⁻¹ and s² is the weighted SS / df. (For weights that depend on the curve
 * this is the fixed point of iteratively reweighted least squares, not the Jacobian of the
 * minimised objective, which also carries the derivative of the weight.)
 */

/** Residuals y − ŷ of data set k (on the data's scale, unweighted). */
export function fitResiduals(
  model: CurveModel,
  fit: NonlinearFit,
  data: FitData,
  k: number,
): Float64Array {
  const p = valuesOf(fit.params[k]!)
  const m = modelFor(model, data)
  const out = new Float64Array(data.x.length)
  for (let i = 0; i < out.length; i++) out[i] = data.y[i]! - m.f(data.x[i]!, p)
  return out
}

/** Hougaard's skewness per data set and parameter (NaN for constants and bound-fixed ones). */
export function hougaardSkewness(
  baseModel: CurveModel,
  fit: NonlinearFit,
  data: readonly FitData[],
  pointWeights?: readonly (ArrayLike<number> | undefined)[],
): number[][] {
  const P = baseModel.params.length
  const out = data.map(() => new Array<number>(P).fill(Number.NaN))
  if (fit.status === 'invalid') return out
  const weighted = fit.weighting !== 'none' || (pointWeights?.some((w) => w) ?? false)
  const shared = fit.params.some((ds) => ds.some((e) => e.status === 'shared'))
  const blocks = shared ? [data.map((_, k) => k)] : data.map((_, k) => [k])
  const qAll = Math.round(Math.sqrt(fit.cov.length))
  for (const sets of blocks) {
    // Free indices (into fit.cov) used by this block, and their local positions.
    const idx: number[] = []
    for (const k of sets)
      for (const i of fit.freeIndex[k]!) if (i >= 0 && !idx.includes(i)) idx.push(i)
    idx.sort((a, b) => a - b)
    const q = idx.length
    if (q === 0) continue
    const ss = shared ? fit.ss : fit.perDataSet[sets[0]!]!.ss
    const df = shared ? fit.df : fit.perDataSet[sets[0]!]!.df
    const s2 = ss / df
    if (!(df > 0) || !(s2 > 0)) continue
    let L: Float64Array<ArrayBufferLike> = new Float64Array(q * q)
    for (let a = 0; a < q; a++)
      for (let b = 0; b < q; b++) L[a * q + b] = fit.cov[idx[a]! * qAll + idx[b]!]! / s2
    const FtF = new Float64Array(q * q)
    // W[j][k][l] = Σ_u F_uj H_ukl.
    const W = new Float64Array(q * q * q)
    const g = new Float64Array(P)
    const gp = new Float64Array(P)
    const gm = new Float64Array(P)
    const F = new Float64Array(q)
    const H = new Float64Array(q * q)
    for (const k of sets) {
      const model = modelFor(baseModel, data[k]!)
      const p = valuesOf(fit.params[k]!)
      const local = fit.freeIndex[k]!.map((i) => (i >= 0 ? idx.indexOf(i) : -1))
      const { x } = data[k]!
      const pw = pointWeights?.[k]
      for (let u = 0; u < x.length; u++) {
        const xu = x[u]!
        const sw = weighted
          ? sqrtWeight(fit.weighting, model.f(xu, p), fit.weightPower)[0] *
            (pw ? Math.sqrt(pw[u]!) : 1)
          : 1
        modelGrad(model, xu, p, g)
        F.fill(0)
        H.fill(0)
        for (let j = 0; j < P; j++) {
          const a = local[j]!
          if (a >= 0) F[a] = F[a]! + sw * g[j]!
        }
        if (weighted)
          for (let a = 0; a < q; a++)
            for (let b = 0; b < q; b++) FtF[a * q + b] = FtF[a * q + b]! + F[a]! * F[b]!
        for (let l = 0; l < P; l++) {
          const b = local[l]!
          if (b < 0) continue
          const v = p[l]!
          const h = CBRT_EPS * Math.max(Math.abs(v), 1e-3)
          p[l] = v + h
          modelGrad(model, xu, p, gp)
          p[l] = v - h
          modelGrad(model, xu, p, gm)
          p[l] = v
          const h2 = v + h - (v - h)
          for (let j = 0; j < P; j++) {
            const a = local[j]!
            if (a >= 0) H[a * q + b] = H[a * q + b]! + (sw * (gp[j]! - gm[j]!)) / h2
          }
        }
        for (let j = 0; j < q; j++) {
          const fj = F[j]!
          if (fj === 0) continue
          for (let kk = 0; kk < q; kk++)
            for (let l = 0; l < q; l++) {
              const o = (j * q + kk) * q + l
              W[o] = W[o]! + fj * H[kk * q + l]!
            }
        }
      }
    }
    if (weighted) {
      const inv = symmetricInverse(FtF, q)
      if (!inv) continue
      L = inv
    }
    for (let i = 0; i < q; i++) {
      let s = 0
      for (let j = 0; j < q; j++)
        for (let kk = 0; kk < q; kk++)
          for (let l = 0; l < q; l++) {
            const w = W[(j * q + kk) * q + l]! + W[(kk * q + j) * q + l]! + W[(l * q + j) * q + kk]!
            s += L[i * q + j]! * L[i * q + kk]! * L[i * q + l]! * w
          }
      const gamma = (-(s2 * s2) * s) / (s2 * L[i * q + i]!) ** 1.5
      for (const k of sets)
        fit.freeIndex[k]!.forEach((fi, j) => {
          if (fi === idx[i]) out[k]![j] = gamma
        })
    }
  }
  return out
}

export interface WeightingTest {
  /** Spearman r between |weighted residual| and the curve's Y. */
  r: number
  p: number
  n: number
  exact: boolean
}

/**
 * The "test for appropriate weighting" (homoscedasticity when unweighted): each residual
 * y − ŷ is weighted as
 * the fit weights it (divided by ŷ for relative weighting: the square root of the weight on the
 * squared residual, here times √(fixed point weight)), and the Spearman rank correlation between
 * the absolute weighted residuals and ŷ is tested (P as `spearmanCorrelation`: exact for n ≤ 17,
 * t approximation above). A small P suggests the weighting is wrong. Data set k of the fit.
 */
export function weightingTest(
  model: CurveModel,
  fit: NonlinearFit,
  data: FitData,
  k: number,
  pointWeights?: ArrayLike<number>,
): WeightingTest {
  const p = valuesOf(fit.params[k]!)
  const n = data.x.length
  const yhat = new Float64Array(n)
  const absRes = new Float64Array(n)
  const m = modelFor(model, data)
  for (let i = 0; i < n; i++) {
    const f = m.f(data.x[i]!, p)
    yhat[i] = f
    const sw = sqrtWeight(fit.weighting, f, fit.weightPower)[0]
    absRes[i] = Math.abs((data.y[i]! - f) * sw * (pointWeights ? Math.sqrt(pointWeights[i]!) : 1))
  }
  const sp = spearmanCorrelation(absRes, yhat)
  return { r: sp.r, p: sp.p, n, exact: sp.exact }
}
