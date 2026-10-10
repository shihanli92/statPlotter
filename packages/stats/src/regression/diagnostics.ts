import { fSf } from '../dist/f.ts'
import { symmetricInverse } from '../linalg/leastSquares.ts'
import { lgamma } from '../special/gamma.ts'

/**
 * Diagnostics of a least-squares fit (Prism's "Diagnostics" tab of nonlinear and linear
 * regression): the runs test, the replicates test, parameter correlation and dependency, and
 * Hougaard's skewness (in nonlinearDiagnostics.ts, which needs the model).
 */

// ---- runs test -----------------------------------------------------------------------------------

export interface RunsTest {
  /** Points above (+) and below (−) the curve; residuals of exactly 0 are not counted. */
  nAbove: number
  nBelow: number
  runs: number
  /** Expected number of runs, 1 + 2·n₊·n₋/(n₊ + n₋). */
  expected: number
  /**
   * One-tailed P: the probability of this few runs or fewer if points scatter randomly around
   * the curve (exact, from the distribution of runs given n₊ and n₋). NaN with no point on one
   * side.
   */
  p: number
}

function lchoose(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1)
}

/** log P(R = r) for n1 and n2 points of each kind in random order (Swed & Eisenhart 1943). */
function logRunsPmf(r: number, n1: number, n2: number): number {
  const total = lchoose(n1 + n2, n1)
  if (r % 2 === 0) {
    const k = r / 2
    return Math.LN2 + lchoose(n1 - 1, k - 1) + lchoose(n2 - 1, k - 1) - total
  }
  const k = (r - 1) / 2
  const a = lchoose(n1 - 1, k) + lchoose(n2 - 1, k - 1)
  const b = lchoose(n1 - 1, k - 1) + lchoose(n2 - 1, k)
  const m = Math.max(a, b)
  if (m === Number.NEGATIVE_INFINITY) return m
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m)) - total
}

/** Runs test on residuals in X order (Wald-Wolfowitz; exact one-tailed P of ≤ runs). */
export function runsTest(residuals: ArrayLike<number>): RunsTest {
  let n1 = 0
  let n2 = 0
  let runs = 0
  let last = 0
  for (let i = 0; i < residuals.length; i++) {
    const s = Math.sign(residuals[i]!)
    if (!(s !== 0)) continue
    if (s > 0) n1++
    else n2++
    if (s !== last) runs++
    last = s
  }
  const n = n1 + n2
  const expected = n > 0 ? 1 + (2 * n1 * n2) / n : Number.NaN
  let p = Number.NaN
  if (n1 > 0 && n2 > 0) {
    p = 0
    for (let r = 2; r <= runs; r++) p += Math.exp(logRunsPmf(r, n1, n2))
    p = Math.min(1, p)
  }
  return { nAbove: n1, nBelow: n2, runs, expected, p }
}

// ---- replicates test -----------------------------------------------------------------------------

export interface ReplicatesTest {
  /** SD of replicates, √(SS_pure/df_pure): scatter among replicates at each X. */
  sdReplicates: number
  dfReplicates: number
  /** √(SS_lack/df_lack): scatter of the means around the curve beyond what replicates show. */
  sdLackOfFit: number
  dfLackOfFit: number
  /** (SD lack of fit / SD replicates)². */
  F: number
  /** P(F(df_lack, df_pure) ≥ F). */
  p: number
}

/**
 * Replicates test for lack of fit (Prism's "replicates test"; Draper & Smith, Applied Regression
 * Analysis, §2.1): the fit's (weighted) residual SS is split into pure error — the scatter of
 * replicates around their mean at each X — and lack of fit. `w` are the fit's weights (at the
 * curve; replicates at one X share one weight). Null when no X has replicates or no df remain
 * for lack of fit.
 */
export function replicatesTest(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  ssResidual: number,
  dfResidual: number,
  w?: ArrayLike<number>,
): ReplicatesTest | null {
  const groups = new Map<number, number[]>()
  for (let i = 0; i < x.length; i++) {
    const g = groups.get(x[i]!)
    if (g) g.push(i)
    else groups.set(x[i]!, [i])
  }
  let ssPure = 0
  let dfPure = 0
  for (const idx of groups.values()) {
    if (idx.length < 2) continue
    let sw = 0
    let swy = 0
    for (const i of idx) {
      const wi = w ? w[i]! : 1
      sw += wi
      swy += wi * y[i]!
    }
    const m = swy / sw
    for (const i of idx) ssPure += (w ? w[i]! : 1) * (y[i]! - m) ** 2
    dfPure += idx.length - 1
  }
  const dfLack = dfResidual - dfPure
  if (dfPure <= 0 || dfLack <= 0) return null
  const ssLack = Math.max(0, ssResidual - ssPure)
  const F = ssLack / dfLack / (ssPure / dfPure)
  return {
    sdReplicates: Math.sqrt(ssPure / dfPure),
    dfReplicates: dfPure,
    sdLackOfFit: Math.sqrt(ssLack / dfLack),
    dfLackOfFit: dfLack,
    F,
    p: fSf(F, dfLack, dfPure),
  }
}

// ---- covariance ----------------------------------------------------------------------------------

/** Correlation matrix (row-major q×q) of a covariance matrix. */
export function correlationMatrix(cov: ArrayLike<number>, q: number): Float64Array {
  const out = new Float64Array(q * q)
  for (let i = 0; i < q; i++) {
    for (let j = 0; j < q; j++) {
      out[i * q + j] = i === j ? 1 : cov[i * q + j]! / Math.sqrt(cov[i * q + i]! * cov[j * q + j]!)
    }
  }
  return out
}

/**
 * Dependency of each parameter (Prism): 1 − 1/(Cᵢᵢ·(C⁻¹)ᵢᵢ), i.e. the R² of that parameter
 * regressed on the others in the covariance structure — near 1 when the others can compensate
 * for a change in it. Computed from the correlation matrix R (Cᵢᵢ·(C⁻¹)ᵢᵢ = (R⁻¹)ᵢᵢ); NaN if
 * it is singular. A single parameter has dependency 0.
 */
export function dependency(cov: ArrayLike<number>, q: number): number[] {
  if (q === 1) return [0]
  const R = correlationMatrix(cov, q)
  const Ri = symmetricInverse(R, q)
  return Array.from({ length: q }, (_, i) => (Ri ? 1 - 1 / Ri[i * q + i]! : Number.NaN))
}
