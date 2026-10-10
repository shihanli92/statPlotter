import { sum } from '../summation.ts'
import { cholesky } from './cholesky.ts'
import { dot2 } from './eft.ts'
import { applyQt, qrFactor, qrRank, rtrInverse, solveR } from './qr.ts'

export interface LeastSquaresFit {
  /** Coefficients; NaN for columns aliased (linearly dependent) at the rank tolerance. */
  coef: Float64Array
  /** (XᵀWX)⁻¹, row-major nCols×nCols. Rows/columns of aliased coefficients are NaN. */
  covUnscaled: Float64Array
  /** Σ wᵢ (yᵢ − xᵢᵀβ)². */
  rss: number
  rank: number
}

export interface LeastSquaresOptions {
  /**
   * Rank tolerance: a pivot |r_kk| ≤ tol·|r_11| of the column-equilibrated R marks the column
   * as dependent. Default 1e-12 (R's lm() uses 1e-7, which declares NIST Filip rank-deficient).
   */
  tol?: number
  /** Iterative-refinement steps (default 2). */
  refine?: number
}

/**
 * Weighted linear least squares min Σ wᵢ(yᵢ − xᵢᵀβ)² by Householder QR with column pivoting on
 * the column-equilibrated √W·X (Golub & Van Loan §5.3.3, §5.4.2), followed by fixed-precision
 * iterative refinement of β with residuals accumulated in doubled precision (Björck,
 * Numerical Methods for Least Squares Problems, 1996, §2.9). The covariance factor comes from
 * R: (XᵀWX)⁻¹ = P R⁻¹R⁻ᵀ Pᵀ, never from forming XᵀWX.
 *
 * @param X row-major nRows×nCols design matrix
 * @param w optional non-negative weights
 */
export function leastSquares(
  X: ArrayLike<number>,
  nRows: number,
  nCols: number,
  y: ArrayLike<number>,
  w?: ArrayLike<number>,
  opts: LeastSquaresOptions = {},
): LeastSquaresFit {
  const m = nRows
  const n = nCols
  if (X.length !== m * n || y.length !== m) throw new RangeError('leastSquares: size mismatch')
  const tol = opts.tol ?? 1e-12
  const sw = new Float64Array(m)
  for (let i = 0; i < m; i++) sw[i] = w ? Math.sqrt(w[i]!) : 1
  // Column-major, equilibrated: A[:, j] = √W X[:, j] / scale[j].
  const A = new Float64Array(m * n)
  const scale = new Float64Array(n)
  for (let j = 0; j < n; j++) {
    let s = 0
    for (let i = 0; i < m; i++) {
      const v = sw[i]! * X[i * n + j]!
      A[j * m + i] = v
      s += v * v
    }
    s = Math.sqrt(s)
    scale[j] = s > 0 ? s : 1
    for (let i = 0; i < m; i++) A[j * m + i] = A[j * m + i]! / scale[j]!
  }
  const b = new Float64Array(m)
  for (let i = 0; i < m; i++) b[i] = sw[i]! * y[i]!

  const f = qrFactor(A, m, n, true)
  const rank = qrRank(f, tol)
  const solve = (rhs: Float64Array): Float64Array => {
    const c = Float64Array.from(rhs)
    applyQt(f, c)
    const z = solveR(f, c, rank)
    const out = new Float64Array(n)
    for (let k = 0; k < rank; k++) out[f.perm[k]!] = z[k]!
    return out
  }
  const beta = solve(b) // equilibrated coefficients
  const row = new Float64Array(n)
  const residual = (out: Float64Array): void => {
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) row[j] = -A[j * m + i]!
      out[i] = dot2(row, beta, n, b[i]!)
    }
  }
  const r = new Float64Array(m)
  const refine = rank === n ? (opts.refine ?? 2) : 0
  for (let it = 0; it < refine; it++) {
    residual(r)
    const d = solve(r)
    for (let j = 0; j < n; j++) beta[j] = beta[j]! + d[j]!
  }
  residual(r)
  for (let i = 0; i < m; i++) r[i] = r[i]! * r[i]!
  const rss = sum(r)

  const coef = new Float64Array(n).fill(Number.NaN)
  const covUnscaled = new Float64Array(n * n).fill(Number.NaN)
  const C = rtrInverse(f, rank)
  for (let a = 0; a < rank; a++) {
    const ja = f.perm[a]!
    coef[ja] = beta[ja]! / scale[ja]!
    for (let c = 0; c < rank; c++) {
      const jc = f.perm[c]!
      covUnscaled[ja * n + jc] = C[a * rank + c]! / (scale[ja]! * scale[jc]!)
    }
  }
  return { coef, covUnscaled, rss, rank }
}

/**
 * Inverse of a symmetric positive-definite matrix (row-major n×n) by Cholesky factorisation
 * (cholesky.ts). Returns null if the matrix is not numerically positive definite.
 */
export function symmetricInverse(S: ArrayLike<number>, n: number): Float64Array | null {
  const L = Float64Array.from(S)
  if (!cholesky(L, n)) return null
  // L⁻¹ (lower), then S⁻¹ = L⁻ᵀ L⁻¹.
  const Li = new Float64Array(n * n)
  for (let j = 0; j < n; j++) {
    Li[j * n + j] = 1 / L[j * n + j]!
    for (let i = j + 1; i < n; i++) {
      let s = 0
      for (let k = j; k < i; k++) s += L[i * n + k]! * Li[k * n + j]!
      Li[i * n + j] = -s / L[i * n + i]!
    }
  }
  const out = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = 0
      for (let k = i; k < n; k++) s += Li[k * n + i]! * Li[k * n + j]!
      out[i * n + j] = s
      out[j * n + i] = s
    }
  }
  return out
}
