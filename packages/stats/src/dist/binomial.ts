import { ibeta } from '../special/beta.ts'
import { bd0, stirlerr } from '../special/gamma.ts'

/**
 * Binomial probability P(X = x), X ~ Bin(n, p), q = 1 − p passed separately. Loader's
 * saddle-point form (C. Loader, "Fast and accurate computation of binomial probabilities",
 * 2000): with the Stirling remainders δ and the deviance terms bd0,
 *   P = exp(δ(n) − δ(x) − δ(n−x) − bd0(x, np) − bd0(n−x, nq)) · √(n / (2π x (n−x))),
 * which keeps full relative accuracy for large n. x is not checked for integrality.
 */
function binomPmfRaw(x: number, n: number, p: number, q: number): number {
  return Math.exp(binomLogPmfRaw(x, n, p, q))
}

/** ln P(X = x) for X ~ Bin(n, p), q = 1 − p; see binomPmfRaw (−∞ outside the support). */
function binomLogPmfRaw(x: number, n: number, p: number, q: number): number {
  if (p === 0) return x === 0 ? 0 : Number.NEGATIVE_INFINITY
  if (q === 0) return x === n ? 0 : Number.NEGATIVE_INFINITY
  if (x < 0 || x > n) return Number.NEGATIVE_INFINITY
  if (x === 0) {
    if (n === 0) return 0
    return p < 0.1 ? -bd0(n, n * q) - n * p : n * Math.log(q)
  }
  if (x === n) return q < 0.1 ? -bd0(n, n * p) - n * q : n * Math.log(p)
  const lc = stirlerr(n) - stirlerr(x) - stirlerr(n - x) - bd0(x, n * p) - bd0(n - x, n * q)
  const lf = Math.log(2 * Math.PI) + Math.log(x) + Math.log1p(-x / n)
  return lc - 0.5 * lf
}

/** P(X = x) for X ~ Bin(n, p). */
export function binomPmf(x: number, n: number, p: number): number {
  return binomPmfRaw(x, n, p, 1 - p)
}

/** P(X ≤ k) for X ~ Bin(n, p), via I_{1−p}(n − k, k + 1). */
export function binomCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0
  if (k >= n) return 1
  return ibeta(1 - p, p, n - k, k + 1)[0]
}

/** P(X > k) for X ~ Bin(n, p), via I_p(k + 1, n − k), computed directly. */
export function binomSf(k: number, n: number, p: number): number {
  if (k < 0) return 1
  if (k >= n) return 0
  return ibeta(p, 1 - p, k + 1, n - k)[0]
}

/**
 * Hypergeometric probability P(X = x): x white balls in k draws from an urn of m white and
 * n black balls. As a ratio of binomial probabilities (Loader 2000),
 *   Bin(x; m, p) · Bin(k − x; n, p) / Bin(k; m + n, p),  p = k / (m + n),
 * which holds for any p; this p puts the denominator at its mode (≈ 1/√(m + n)), so nothing
 * underflows unless the result does (as R's dhyper). Each factor is accurate to a few ulps,
 * so the result keeps full relative accuracy.
 */
export function hyperPmf(x: number, m: number, n: number, k: number): number {
  if (x < 0 || x > m || k - x < 0 || k - x > n) return 0
  // Only one value of x is possible.
  if (k === 0 || k === m + n || m === 0 || n === 0) return 1
  const p = k / (m + n)
  const q = (m + n - k) / (m + n)
  return (binomPmfRaw(x, m, p, q) * binomPmfRaw(k - x, n, p, q)) / binomPmfRaw(k, m + n, p, q)
}

/** ln P(X = x) for the hypergeometric distribution of hyperPmf (−∞ outside the support). */
export function hyperLogPmf(x: number, m: number, n: number, k: number): number {
  if (x < 0 || x > m || k - x < 0 || k - x > n) return Number.NEGATIVE_INFINITY
  if (k === 0 || k === m + n || m === 0 || n === 0) return 0
  const p = k / (m + n)
  const q = (m + n - k) / (m + n)
  return (
    binomLogPmfRaw(x, m, p, q) + binomLogPmfRaw(k - x, n, p, q) - binomLogPmfRaw(k, m + n, p, q)
  )
}
