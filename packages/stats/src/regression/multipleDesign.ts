import { dot2 } from '../linalg/eft.ts'
import { leastSquares } from '../linalg/leastSquares.ts'
import { norm2 } from '../linalg/qr.ts'
import { refinedMean, sum } from '../summation.ts'

/**
 * Shared pieces of multiple linear, logistic and Cox regression: the coefficient row type, the
 * design matrix (intercept, main effects, two-way interaction products) and detection of aliased
 * (linearly dependent) columns.
 */

/** One row of a coefficient table. `stat` is t (linear) or z (logistic, Cox). */
export interface RegCoefficient {
  name: string
  estimate: number
  se: number
  lower: number
  upper: number
  stat: number
  p: number
}

export interface DesignOptions {
  /** Prepend a column of ones named 'Intercept' (default true). */
  intercept?: boolean
  /** Two-way interaction products X_i·X_j appended after the main effects, named 'A:B'. */
  interactions?: readonly (readonly [number, number])[]
}

export interface Design {
  /** Number of rows. */
  n: number
  /** Columns (each length n). */
  cols: Float64Array[]
  names: string[]
  intercept: boolean
}

/**
 * Builds the design columns: [Intercept], X_1 … X_p, then the interaction products in the order
 * given. Throws RangeError for inconsistent shapes or non-finite values.
 */
export function buildDesign(
  fn: string,
  X: readonly (readonly number[])[],
  names: readonly string[],
  opts: DesignOptions,
  intercept: boolean,
): Design {
  const n = X.length
  const p = names.length
  for (let i = 0; i < n; i++) {
    const row = X[i]!
    if (row.length !== p) {
      throw new RangeError(`${fn}: row ${i} has ${row.length} values, expected ${p}`)
    }
    for (let j = 0; j < p; j++) {
      if (!Number.isFinite(row[j]!)) throw new RangeError(`${fn}: non-finite X at row ${i}`)
    }
  }
  const cols: Float64Array[] = []
  const outNames: string[] = []
  if (intercept) {
    cols.push(new Float64Array(n).fill(1))
    outNames.push('Intercept')
  }
  for (let j = 0; j < p; j++) {
    const c = new Float64Array(n)
    for (let i = 0; i < n; i++) c[i] = X[i]![j]!
    cols.push(c)
    outNames.push(names[j]!)
  }
  for (const [a, b] of opts.interactions ?? []) {
    if (!(Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a < p && b < p)) {
      throw new RangeError(`${fn}: interaction [${a}, ${b}] out of range`)
    }
    const c = new Float64Array(n)
    for (let i = 0; i < n; i++) c[i] = X[i]![a]! * X[i]![b]!
    cols.push(c)
    outNames.push(`${names[a]}:${names[b]}`)
  }
  return { n, cols, names: outNames, intercept }
}

/** Default relative tolerance for declaring a column aliased (see `keptColumns`). */
const ALIAS_TOL = 1e-9

/**
 * Which columns to keep, scanning left to right: a column is aliased (dropped) when the part of
 * it orthogonal to the columns already kept has norm ≤ tol·(its own norm) — the same rule as the
 * limited-pivoting QR of R's lm/glm (LINPACK dqrdc2), so the last column of a dependent set is
 * the one dropped. Implemented as modified Gram–Schmidt with one reorthogonalisation pass
 * (Björck 1996, §2.4.5). With `center`, columns are centred first (Cox: a constant column is
 * aliased with the baseline hazard). An all-zero column is always aliased.
 */
export function keptColumns(cols: readonly Float64Array[], center: boolean, tol = ALIAS_TOL) {
  const basis: Float64Array[] = []
  const keep: boolean[] = []
  for (const col of cols) {
    const v = Float64Array.from(col)
    if (center && v.length > 0) {
      const m = sum(v) / v.length
      for (let i = 0; i < v.length; i++) v[i] = v[i]! - m
    }
    const norm0 = norm2(v, 0, v.length)
    if (!(norm0 > 0)) {
      keep.push(false)
      continue
    }
    for (let pass = 0; pass < 2; pass++) {
      for (const q of basis) {
        let d = 0
        for (let i = 0; i < v.length; i++) d += q[i]! * v[i]!
        for (let i = 0; i < v.length; i++) v[i] = v[i]! - d * q[i]!
      }
    }
    const norm = norm2(v, 0, v.length)
    if (norm <= tol * norm0) {
      keep.push(false)
      continue
    }
    for (let i = 0; i < v.length; i++) v[i] = v[i]! / norm
    basis.push(v)
    keep.push(true)
  }
  return keep
}

/** Row-major n×k matrix of the given columns. */
export function rowMajor(cols: readonly Float64Array[], n: number): Float64Array {
  const k = cols.length
  const out = new Float64Array(n * k)
  for (let j = 0; j < k; j++) {
    const c = cols[j]!
    for (let i = 0; i < n; i++) out[i * k + j] = c[i]!
  }
  return out
}

/**
 * Expands a covariance over kept columns (row-major kk×kk) to all K columns, NaN for aliased.
 */
export function expandCov(cov: ArrayLike<number>, keep: readonly boolean[]): number[][] {
  const K = keep.length
  const idx: number[] = []
  keep.forEach((k, j) => {
    if (k) idx.push(j)
  })
  const kk = idx.length
  const out: number[][] = Array.from({ length: K }, () => new Array<number>(K).fill(Number.NaN))
  for (let a = 0; a < kk; a++) {
    for (let b = 0; b < kk; b++) out[idx[a]!]![idx[b]!] = cov[a * kk + b]!
  }
  return out
}

/**
 * Variance inflation factors from the predictors alone (Prism: "how well each X variable can be
 * predicted from the other X variables … VIF = 1/(1 − R²)"). For kept column j,
 * VIF_j = S_jj · [(XᵀX)⁻¹]_jj, where S_jj is the centred (with an intercept) or raw (without)
 * sum of squares; with an intercept this is 1/(1 − R²_j) from regressing X_j on the other
 * columns plus intercept, and equals car::vif. `covUnscaled` is (XᵀX)⁻¹ over the kept columns
 * (row-major). Null for the intercept.
 */
export function vifs(
  design: Design,
  keep: readonly boolean[],
  covUnscaled: ArrayLike<number>,
): (number | null)[] {
  const kk = keep.filter(Boolean).length
  const out: (number | null)[] = []
  let a = 0
  design.cols.forEach((col, j) => {
    if (design.intercept && j === 0) {
      out.push(null)
      if (keep[j]) a++
      return
    }
    if (!keep[j]) {
      out.push(Number.NaN)
      return
    }
    const m = design.intercept ? refinedMean(col) : 0
    const t = new Float64Array(col.length)
    for (let i = 0; i < t.length; i++) t[i] = (col[i]! - m) ** 2
    out.push(sum(t) * covUnscaled[a * kk + a]!)
    a++
  })
  return out
}

/**
 * Least squares on design columns whose first column is the intercept (when `hasIntercept`),
 * fitted with the other columns centred — which removes the ill-conditioning a large offset
 * causes — and mapped back: β₀ = a − Σ mⱼbⱼ, Cov = T·Cov_c·Tᵀ with T = [[1, −mᵀ], [0, I]].
 * The estimates are then refined in the original basis (Björck 1996, §2.9): residuals
 * y − Xβ in doubled precision (dot2), corrections from the centred factorisation.
 * `cols` must be full rank.
 */
export function centredLeastSquares(
  cols: readonly Float64Array[],
  y: ArrayLike<number>,
  hasIntercept: boolean,
): { coef: Float64Array; covUnscaled: Float64Array } {
  const k = cols.length
  const n = y.length
  const m = new Float64Array(k)
  const work: Float64Array[] = cols.map((c, j) => {
    if (!hasIntercept || j === 0 || n === 0) return c
    const mj = refinedMean(c)
    m[j] = mj
    const t = new Float64Array(n)
    for (let i = 0; i < n; i++) t[i] = c[i]! - mj
    return t
  })
  const A = rowMajor(work, n)
  const toOriginal = (b: Float64Array): Float64Array => {
    if (!hasIntercept) return b
    const out = Float64Array.from(b)
    const t = new Float64Array(k)
    t[0] = b[0]!
    for (let j = 1; j < k; j++) t[j] = -m[j]! * b[j]!
    out[0] = sum(t)
    return out
  }
  const first = leastSquares(A, n, k, y)
  const coef = toOriginal(first.coef)
  const r = new Float64Array(n)
  const row = new Float64Array(k)
  for (let it = 0; it < 2; it++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < k; j++) row[j] = -cols[j]![i]!
      r[i] = dot2(row, coef, k, y[i]!)
    }
    const d = toOriginal(leastSquares(A, n, k, r, undefined, { refine: 0 }).coef)
    for (let j = 0; j < k; j++) coef[j] = coef[j]! + d[j]!
  }
  const C = first.covUnscaled
  if (!hasIntercept) return { coef, covUnscaled: C }
  // T·C·Tᵀ, T = I except row 0 = [1, −m₁, …, −m_{k−1}].
  const TC = Float64Array.from(C)
  for (let c = 0; c < k; c++) {
    let s = C[c]!
    for (let j = 1; j < k; j++) s -= m[j]! * C[j * k + c]!
    TC[c] = s
  }
  const out = Float64Array.from(TC)
  for (let rI = 0; rI < k; rI++) {
    let s = TC[rI * k]!
    for (let j = 1; j < k; j++) s -= TC[rI * k + j]! * m[j]!
    out[rI * k] = s
  }
  return { coef, covUnscaled: out }
}
