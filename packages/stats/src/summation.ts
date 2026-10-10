/**
 * Neumaier (improved Kahan–Babuška) compensated summation. Error is O(ε) independent of n,
 * versus O(nε) for naive summation.
 */
export function sum(x: ArrayLike<number>): number {
  let s = 0
  let c = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!
    const t = s + v
    c += Math.abs(s) >= Math.abs(v) ? s - t + v : v - t + s
    s = t
  }
  return s + c
}

/**
 * Mean by the refined two-pass method: m = Σx/n, then m + Σ(x − m)/n, both sums compensated
 * (NaN for no values).
 */
export function refinedMean(x: ArrayLike<number>): number {
  const n = x.length
  const m = sum(x) / n
  const d = new Float64Array(n)
  for (let i = 0; i < n; i++) d[i] = x[i]! - m
  return m + sum(d) / n
}
