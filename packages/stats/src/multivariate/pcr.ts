import { tQuantile, tSf } from '../dist/t.ts'
import { type MultipleLinearResult, multipleLinearRegression } from '../regression/multiple.ts'
import type { RegCoefficient } from '../regression/multipleDesign.ts'
import { type PcaOptions, type PcaResult, pca } from './pca.ts'

/**
 * Principal component regression, as Prism describes it (Statistics Guide, "Principal Component
 * Regression (PCR)"): (1) PCA of the predictors, (2) keep the components chosen by the selection
 * rule, (3) multiple linear regression of Y on their scores with an intercept, (4) the
 * coefficients converted back to the scale of the original variables.
 *
 * With scores sᶜ = Σⱼ Vⱼc (xⱼ − mⱼ)/dⱼ (d = the SDs when standardized, else 1), the fitted
 * Y = γ₀ + Σc γc sᶜ is Y = β₀ + Σⱼ βⱼ xⱼ with βⱼ = Σc Vⱼc γc / dⱼ and β₀ = γ₀ − Σⱼ βⱼ mⱼ. Their
 * SEs come from the covariance of γ through that linear map (T Cov(γ) Tᵀ), with CIs and t tests
 * on the regression's df (n − k − 1).
 */
export interface PcrOptions extends PcaOptions {
  /** Default 0.95. */
  confLevel?: number
}

export interface PcrResult {
  pca: PcaResult
  /** Number of components used as predictors. */
  k: number
  /** Regression on the scores: intercept, then PC1 … PCk. */
  regression: MultipleLinearResult
  /** Back on the original variables: intercept, then one per predictor (stat = t). */
  original: RegCoefficient[]
}

export function principalComponentRegression(
  y: readonly number[],
  X: readonly (readonly number[])[],
  names: readonly string[],
  opts: PcrOptions = {},
): PcrResult {
  const n = y.length
  if (X.length !== n) throw new RangeError('principalComponentRegression: y and X differ in rows')
  const res = pca(X, opts)
  const p = names.length
  const k = Math.max(1, Math.min(res.selected, res.rank))
  const scores = res.scores.map((row) => row.slice(0, k))
  const pcNames = Array.from({ length: k }, (_, c) => `PC${c + 1}`)
  const confLevel = opts.confLevel ?? 0.95
  const regression = multipleLinearRegression(y, scores, pcNames, { confLevel })
  const d = res.standardized ? res.sds : res.means.map(() => 1)
  // T maps (γ₀, γ₁ … γk) to (β₀, β₁ … βp).
  const A = Array.from({ length: p }, (_, j) =>
    Array.from({ length: k }, (_, c) => res.eigenvectors[j]![c]! / d[j]!),
  )
  const T: number[][] = [
    [
      1,
      ...Array.from(
        { length: k },
        (_, c) => -A.reduce((s, row, j) => s + row[c]! * res.means[j]!, 0),
      ),
    ],
    ...A.map((row) => [0, ...row]),
  ]
  const g = regression.coefficients.map((c) => c.estimate)
  const S = regression.covariance
  const df = regression.df
  const t = df > 0 ? tQuantile(1 - (1 - confLevel) / 2, df) : Number.NaN
  const original = T.map((row, i): RegCoefficient => {
    const estimate = row.reduce((s, v, c) => s + v * g[c]!, 0)
    let v = 0
    for (let a = 0; a <= k; a++) for (let b = 0; b <= k; b++) v += row[a]! * S[a]![b]! * row[b]!
    const se = Math.sqrt(v)
    const stat = estimate / se
    return {
      name: i === 0 ? 'Intercept' : names[i - 1]!,
      estimate,
      se,
      lower: estimate - t * se,
      upper: estimate + t * se,
      stat,
      p: df > 0 ? 2 * tSf(Math.abs(stat), df) : Number.NaN,
    }
  })
  return { pca: res, k, regression, original }
}
