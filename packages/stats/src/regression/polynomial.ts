import { tQuantile } from '../dist/t.ts'
import { compHorner } from '../linalg/eft.ts'
import { leastSquares } from '../linalg/leastSquares.ts'
import { sum } from '../summation.ts'

export interface PolynomialOptions {
  /** Per-point weights (≥ 0). */
  weights?: ArrayLike<number>
  /** Default 0.95. */
  confLevel?: number
}

export interface PolynomialFit {
  n: number
  degree: number
  /** Coefficients in ascending powers of X: Y = coef[0] + coef[1]·X + … */
  coef: Float64Array
  se: Float64Array
  lo: Float64Array
  hi: Float64Array
  r2: number
  syx: number
  ssResidual: number
  df: number
  /** Covariance of coef, row-major (degree+1)². */
  cov: Float64Array
  confLevel: number
}

/**
 * Least-squares polynomial of the given degree.
 *
 * The monomial basis in raw X is badly conditioned (NIST Filip, degree 10: κ ≈ 1e15), so the fit
 * is done in the shifted and scaled variable t = (X − c)/s, t ∈ [−1, 1], by Householder QR
 * (leastSquares), then mapped back to powers of X by the binomial expansion. The mapped
 * coefficients are then improved by iterative refinement in the X basis: residuals are evaluated
 * with compensated Horner (Graillat, Langlois & Louvet 2005), so each correction step solves for
 * an accurately known right-hand side (Björck 1996, §2.9).
 *
 * The covariance is mapped the same way: Cov_X = M·Cov_t·Mᵀ with M the (upper-triangular)
 * change-of-basis matrix.
 */
export function polynomialRegression(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  degree: number,
  opts: PolynomialOptions = {},
): PolynomialFit {
  const n = x.length
  if (y.length !== n) throw new RangeError('polynomialRegression: x and y differ in length')
  if (!Number.isInteger(degree) || degree < 0) throw new RangeError('degree must be an integer ≥ 0')
  const w = opts.weights
  const confLevel = opts.confLevel ?? 0.95
  const p = degree + 1

  let xmin = Number.POSITIVE_INFINITY
  let xmax = Number.NEGATIVE_INFINITY
  for (let i = 0; i < n; i++) {
    xmin = Math.min(xmin, x[i]!)
    xmax = Math.max(xmax, x[i]!)
  }
  const c = n > 0 ? (xmin + xmax) / 2 : 0
  const half = (xmax - xmin) / 2
  const s = half > 0 ? half : 1
  const T = new Float64Array(n * p)
  for (let i = 0; i < n; i++) {
    const t = (x[i]! - c) / s
    let v = 1
    for (let k = 0; k < p; k++) {
      T[i * p + k] = v
      v *= t
    }
  }
  // M[i][k] = C(k, i)·(−c)^(k−i) / s^k: coefficient of X^i in ((X − c)/s)^k.
  const M = new Float64Array(p * p)
  for (let k = 0; k < p; k++) {
    let binom = 1
    for (let i = k; i >= 0; i--) {
      // binom = C(k, i), built from C(k, k) = 1 downwards.
      M[i * p + k] = (binom * (-c) ** (k - i)) / s ** k
      binom = (binom * i) / (k - i + 1)
    }
  }
  const toX = (a: ArrayLike<number>): Float64Array => {
    const out = new Float64Array(p)
    for (let i = 0; i < p; i++) {
      let v = 0
      for (let k = i; k < p; k++) v += M[i * p + k]! * a[k]!
      out[i] = v
    }
    return out
  }

  const first = leastSquares(T, n, p, y, w)
  const coef = toX(first.coef)
  const r = new Float64Array(n)
  const residuals = (): void => {
    for (let i = 0; i < n; i++) r[i] = y[i]! - compHorner(coef, x[i]!)
  }
  if (first.rank === p) {
    for (let it = 0; it < 3; it++) {
      residuals()
      const d = toX(leastSquares(T, n, p, r, w, { refine: 0 }).coef)
      for (let k = 0; k < p; k++) coef[k] = coef[k]! + d[k]!
    }
  }
  residuals()
  const sq = new Float64Array(n)
  for (let i = 0; i < n; i++) sq[i] = (w ? w[i]! : 1) * r[i]! * r[i]!
  const ssResidual = sum(sq)
  const sw = w ? sum(w) : n
  let my = 0
  for (let i = 0; i < n; i++) sq[i] = (w ? w[i]! : 1) * y[i]!
  my = sum(sq) / sw
  for (let i = 0; i < n; i++) sq[i] = (w ? w[i]! : 1) * (y[i]! - my) ** 2
  const ssTotal = sum(sq)
  const df = n - p
  const s2 = df > 0 ? ssResidual / df : Number.NaN

  // Cov_X = s²·M·C_t·Mᵀ
  const Ct = first.covUnscaled
  const MC = new Float64Array(p * p)
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      let v = 0
      for (let k = i; k < p; k++) v += M[i * p + k]! * Ct[k * p + j]!
      MC[i * p + j] = v
    }
  }
  const cov = new Float64Array(p * p)
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      let v = 0
      for (let k = j; k < p; k++) v += MC[i * p + k]! * M[j * p + k]!
      cov[i * p + j] = s2 * v
    }
  }
  const t = df > 0 ? tQuantile(1 - (1 - confLevel) / 2, df) : Number.NaN
  const se = new Float64Array(p)
  const lo = new Float64Array(p)
  const hi = new Float64Array(p)
  for (let k = 0; k < p; k++) {
    se[k] = Math.sqrt(cov[k * p + k]!)
    lo[k] = coef[k]! - t * se[k]!
    hi[k] = coef[k]! + t * se[k]!
  }
  return {
    n,
    degree,
    coef,
    se,
    lo,
    hi,
    r2: 1 - ssResidual / ssTotal,
    syx: Math.sqrt(s2),
    ssResidual,
    df,
    cov,
    confLevel,
  }
}
