/**
 * Kolmogorov's limiting distribution of √n·D: survival function
 *   Q_KS(λ) = 2 Σ_{j≥1} (−1)^{j−1} exp(−2j²λ²),
 * evaluated for small λ from the Jacobi-theta dual form
 *   1 − Q_KS(λ) = (√(2π)/λ) Σ_{j≥1} exp(−(2j − 1)²π²/(8λ²))
 * (Numerical Recipes 3rd ed. §6.14.12, which switches at λ = 1.18). Both series are summed to
 * convergence rather than truncated at NR's four terms.
 */
export function kolmogorovSf(lambda: number): number {
  if (Number.isNaN(lambda)) return Number.NaN
  if (lambda <= 0) return 1
  if (lambda < 1.18) {
    const c = (Math.PI * Math.PI) / (8 * lambda * lambda)
    let s = 0
    for (let j = 1; j < 100; j++) {
      const t = Math.exp(-(2 * j - 1) * (2 * j - 1) * c)
      s += t
      if (t < s * 1e-17) break
    }
    return 1 - (Math.sqrt(2 * Math.PI) / lambda) * s
  }
  const x = -2 * lambda * lambda
  let s = 0
  for (let j = 1; j < 100; j++) {
    const t = Math.exp(x * j * j)
    s += j % 2 === 1 ? t : -t
    if (t < Math.abs(s) * 1e-17) break
  }
  return Math.min(1, 2 * s)
}
