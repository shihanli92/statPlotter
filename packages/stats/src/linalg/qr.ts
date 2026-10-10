/**
 * Dense Householder QR with optional column pivoting, on small column-major matrices.
 *
 * Algorithm: Businger & Golub (1965), "Linear least squares solutions by Householder
 * transformations", Numer. Math. 7; Golub & Van Loan, Matrix Computations (4th ed.), Alg. 5.2.1
 * and §5.4.2 (QR with column pivoting). Reflectors are normalised as in LINPACK's DQRDC
 * (Dongarra et al., LINPACK Users' Guide, 1979, ch. 9): v = x/σ + e₁ with σ = ±‖x‖, so v₁ ∈ [1, 2]
 * and H = I − v vᵀ / v₁.
 *
 * Pivoting picks, at step k, the remaining column with the largest norm below row k. The norms
 * are recomputed from scratch at each step rather than downdated, which costs O(mn²) — the same
 * order as the factorisation — and avoids the cancellation that downdating suffers (the problem
 * LAPACK's xGEQP3 guards against with Drmač–Bujanović's recomputation test).
 */

export interface QRFactorization {
  m: number
  n: number
  /** Column-major m×n. Strict upper triangle: R. On and below the diagonal: the reflectors v. */
  qr: Float64Array
  /** Diagonal of R. */
  rdiag: Float64Array
  /** Column k of R is column perm[k] of the input. */
  perm: Int32Array
}

/** ‖x[from..to)‖ with scaling against overflow / underflow (as LAPACK's DNRM2). */
export function norm2(a: Float64Array, from: number, to: number): number {
  let scale = 0
  let ssq = 1
  for (let i = from; i < to; i++) {
    const v = a[i]!
    if (v !== 0) {
      const av = Math.abs(v)
      if (scale < av) {
        const r = scale / av
        ssq = 1 + ssq * r * r
        scale = av
      } else {
        const r = av / scale
        ssq += r * r
      }
    }
  }
  return scale * Math.sqrt(ssq)
}

/**
 * Factorises A·P = Q·R. `a` is column-major m×n and is copied. With `pivot` false the columns
 * keep their order (perm is the identity).
 */
export function qrFactor(a: Float64Array, m: number, n: number, pivot = true): QRFactorization {
  const qr = Float64Array.from(a)
  const rdiag = new Float64Array(n)
  const perm = new Int32Array(n)
  for (let j = 0; j < n; j++) perm[j] = j
  const steps = Math.min(m, n)
  for (let k = 0; k < steps; k++) {
    if (pivot) {
      let best = k
      let bestNorm = -1
      for (let j = k; j < n; j++) {
        const nj = norm2(qr, j * m + k, j * m + m)
        if (nj > bestNorm) {
          bestNorm = nj
          best = j
        }
      }
      if (best !== k) {
        for (let i = 0; i < m; i++) {
          const t = qr[k * m + i]!
          qr[k * m + i] = qr[best * m + i]!
          qr[best * m + i] = t
        }
        const t = perm[k]!
        perm[k] = perm[best]!
        perm[best] = t
      }
    }
    const ck = k * m
    let nrm = norm2(qr, ck + k, ck + m)
    if (nrm === 0) {
      rdiag[k] = 0
      continue
    }
    if (qr[ck + k]! < 0) nrm = -nrm
    for (let i = k; i < m; i++) qr[ck + i] = qr[ck + i]! / nrm
    qr[ck + k] = qr[ck + k]! + 1
    const vk = qr[ck + k]!
    for (let j = k + 1; j < n; j++) {
      const cj = j * m
      let s = 0
      for (let i = k; i < m; i++) s += qr[ck + i]! * qr[cj + i]!
      const t = -s / vk
      for (let i = k; i < m; i++) qr[cj + i] = qr[cj + i]! + t * qr[ck + i]!
    }
    rdiag[k] = -nrm
  }
  return { m, n, qr, rdiag, perm }
}

/** y ← Qᵀ y (in place, length m). */
export function applyQt(f: QRFactorization, y: Float64Array): void {
  const { m, n, qr } = f
  const steps = Math.min(m, n)
  for (let k = 0; k < steps; k++) {
    const ck = k * m
    const vk = qr[ck + k]!
    if (f.rdiag[k] === 0 || vk === 0) continue
    let s = 0
    for (let i = k; i < m; i++) s += qr[ck + i]! * y[i]!
    const t = -s / vk
    for (let i = k; i < m; i++) y[i] = y[i]! + t * qr[ck + i]!
  }
}

/** y ← Q y (in place, length m). */
export function applyQ(f: QRFactorization, y: Float64Array): void {
  const { m, n, qr } = f
  for (let k = Math.min(m, n) - 1; k >= 0; k--) {
    const ck = k * m
    const vk = qr[ck + k]!
    if (f.rdiag[k] === 0 || vk === 0) continue
    let s = 0
    for (let i = k; i < m; i++) s += qr[ck + i]! * y[i]!
    const t = -s / vk
    for (let i = k; i < m; i++) y[i] = y[i]! + t * qr[ck + i]!
  }
}

/** R[i][j] for i ≤ j (in pivoted column order). */
function rAt(f: QRFactorization, i: number, j: number): number {
  return i === j ? f.rdiag[i]! : f.qr[j * f.m + i]!
}

/**
 * Numerical rank: the number of leading diagonal entries of R with |r_kk| > tol·|r_11|. Only
 * meaningful with pivoting (|r_kk| is then non-increasing) and with columns of comparable scale.
 */
export function qrRank(f: QRFactorization, tol: number): number {
  const k = Math.min(f.m, f.n)
  if (k === 0) return 0
  const r11 = Math.abs(f.rdiag[0]!)
  if (!(r11 > 0)) return 0
  let rank = 0
  while (rank < k && Math.abs(f.rdiag[rank]!) > tol * r11) rank++
  return rank
}

/**
 * Solves the leading r×r triangle R₁₁ z = c[0..r) by back substitution (pivoted order).
 */
export function solveR(f: QRFactorization, c: ArrayLike<number>, r: number): Float64Array {
  const z = new Float64Array(r)
  for (let i = r - 1; i >= 0; i--) {
    let s = c[i]!
    for (let j = i + 1; j < r; j++) s -= rAt(f, i, j) * z[j]!
    z[i] = s / f.rdiag[i]!
  }
  return z
}

/**
 * (R₁₁ᵀR₁₁)⁻¹ = R₁₁⁻¹R₁₁⁻ᵀ for the leading r×r triangle, row-major r×r, pivoted order.
 * Computed from the explicit triangular inverse (Golub & Van Loan §3.1).
 */
export function rtrInverse(f: QRFactorization, r: number): Float64Array {
  // Upper-triangular inverse, row-major.
  const inv = new Float64Array(r * r)
  for (let j = 0; j < r; j++) {
    inv[j * r + j] = 1 / f.rdiag[j]!
    for (let i = j - 1; i >= 0; i--) {
      let s = 0
      for (let k = i + 1; k <= j; k++) s += rAt(f, i, k) * inv[k * r + j]!
      inv[i * r + j] = -s / f.rdiag[i]!
    }
  }
  const out = new Float64Array(r * r)
  for (let i = 0; i < r; i++) {
    for (let j = i; j < r; j++) {
      let s = 0
      for (let k = j; k < r; k++) s += inv[i * r + k]! * inv[j * r + k]!
      out[i * r + j] = s
      out[j * r + i] = s
    }
  }
  return out
}
