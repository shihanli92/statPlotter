/**
 * Cholesky factorisation of symmetric positive-definite matrices (row-major n×n, Golub & Van Loan
 * Alg. 4.2.2) and the triangular solves built on it. Vectors may be strided views (`off`,
 * `stride`) into a larger array.
 */

/**
 * In-place Cholesky S = L Lᵀ: the lower triangle becomes L, the upper is zeroed. False if the
 * matrix is not numerically positive definite (a pivot ≤ 0, NaN or infinite).
 */
export function cholesky(a: Float64Array, n: number): boolean {
  for (let j = 0; j < n; j++) {
    let d = a[j * n + j]!
    for (let k = 0; k < j; k++) d -= a[j * n + k]! * a[j * n + k]!
    if (!(d > 0) || !Number.isFinite(d)) return false
    const l = Math.sqrt(d)
    a[j * n + j] = l
    for (let i = j + 1; i < n; i++) {
      let s = a[i * n + j]!
      for (let k = 0; k < j; k++) s -= a[i * n + k]! * a[j * n + k]!
      a[i * n + j] = s / l
    }
    for (let k = j + 1; k < n; k++) a[j * n + k] = 0
  }
  return true
}

/** Solves L x = b in place (L lower, from cholesky). */
export function forwardSolve(L: Float64Array, n: number, b: Float64Array, off = 0, stride = 1) {
  for (let i = 0; i < n; i++) {
    let s = b[off + i * stride]!
    for (let k = 0; k < i; k++) s -= L[i * n + k]! * b[off + k * stride]!
    b[off + i * stride] = s / L[i * n + i]!
  }
}

/** Solves L X = B in place for a row-major n × nc right-hand side (L lower, from cholesky). */
export function forwardSolveRows(L: Float64Array, n: number, b: Float64Array, nc: number) {
  for (let i = 0; i < n; i++) {
    const ri = i * nc
    for (let k = 0; k < i; k++) {
      const l = L[i * n + k]!
      if (l === 0) continue
      const rk = k * nc
      for (let a = 0; a < nc; a++) b[ri + a] = b[ri + a]! - l * b[rk + a]!
    }
    const d = L[i * n + i]!
    for (let a = 0; a < nc; a++) b[ri + a] = b[ri + a]! / d
  }
}

/** Solves Lᵀ x = b in place (L lower, from cholesky). */
export function backSolve(L: Float64Array, n: number, b: Float64Array, off = 0, stride = 1) {
  for (let i = n - 1; i >= 0; i--) {
    let s = b[off + i * stride]!
    for (let k = i + 1; k < n; k++) s -= L[k * n + i]! * b[off + k * stride]!
    b[off + i * stride] = s / L[i * n + i]!
  }
}

/** Solves L Lᵀ x = b in place (L from cholesky). */
export function cholSolve(L: Float64Array, n: number, b: Float64Array, off = 0, stride = 1): void {
  forwardSolve(L, n, b, off, stride)
  backSolve(L, n, b, off, stride)
}

/** Solves the symmetric system H x = b by Cholesky; null if H is not positive definite. */
export function spdSolve(H: Float64Array, n: number, b: Float64Array): Float64Array | null {
  const L = Float64Array.from(H)
  if (!cholesky(L, n)) return null
  const x = Float64Array.from(b)
  cholSolve(L, n, x)
  return x
}

/** S⁻¹ column by column from the Cholesky factor; null if S is not positive definite. */
export function spdInverse(S: Float64Array, n: number): Float64Array | null {
  const L = Float64Array.from(S)
  if (!cholesky(L, n)) return null
  const out = new Float64Array(n * n)
  for (let k = 0; k < n; k++) {
    const col = new Float64Array(n)
    col[k] = 1
    cholSolve(L, n, col)
    for (let a = 0; a < n; a++) out[a * n + k] = col[a]!
  }
  return out
}
