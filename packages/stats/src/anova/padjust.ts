/**
 * Multiplicity adjustment of a family of P values.
 *
 * - bonferroni: min(1, m·p).
 * - sidak: 1 − (1 − p)^m (Šidák 1967), computed as −expm1(m·log1p(−p)).
 * - holm: step-down Bonferroni (Holm 1979); adjusted p_(i) = max_{j ≤ i} min(1, (m − j + 1) p_(j)).
 * - holm-sidak: step-down Šidák (Holm 1979, §4; Prism's recommended step-down method):
 *   adjusted p_(i) = max_{j ≤ i} 1 − (1 − p_(j))^{m − j + 1}.
 * - bh: Benjamini & Hochberg (1995) step-up; adjusted p_(i) = min_{j ≥ i} min(1, m p_(j) / j).
 * - by: Benjamini & Yekutieli (2001): as bh with m·Σ_{j≤m} 1/j in place of m.
 * - bky: q values of the two-stage linear step-up procedure of Benjamini, Krieger & Yekutieli
 *   (2006, Biometrika 93, 491–507, Definition 6), which Prism calls "two-stage step-up". At FDR
 *   level Q it (1) runs BH at q′ = Q/(1 + Q), rejecting r₁; stops if r₁ = 0 (nothing rejected)
 *   or r₁ = m (everything rejected); otherwise (2) re-runs BH at q′·m/m̂₀ with m̂₀ = m − r₁.
 *   A hypothesis' q value is Prism's (audit 3, RTA-1; decision 1084): its BH-adjusted P p̃ times
 *   (1 + Q)·m̂₀/m, with m̂₀ = m − r₁ from the first stage at the given Q (`q`, the user's; Prism's
 *   default 1%). Then q ≤ Q exactly when the procedure at Q rejects it (stage two rejects p̃ ≤
 *   q′m/m̂₀). This reproduces all 36 q values of Tawk et al. 2026's source data; no R function
 *   computes it. When stage one rejects everything (m̂₀ = 0) m̂₀ is taken as 1, so q values stay
 *   positive (and at most Q/m). q values are capped at 1. (Until audit 3 the q value was the
 *   smallest Q at which the hypothesis is rejected, which no Prism output matches.)
 *
 * `n` is the family size m when it exceeds the number of P values supplied (as R's
 * p.adjust(p, n = …)): the missing P values are taken to be 1. NaN inputs give NaN and are
 * not counted.
 */
export type PAdjustMethod = 'bonferroni' | 'sidak' | 'holm' | 'holm-sidak' | 'bh' | 'by' | 'bky'

function sidak(p: number, m: number): number {
  return -Math.expm1(m * Math.log1p(-p))
}

/**
 * Hypotheses rejected by the step-up rule p_(i) ≤ i·level/m over ascending P values (the largest
 * such i; 0 for none).
 */
export function stepUpCount(sorted: readonly number[], level: number, m: number): number {
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i]! <= ((i + 1) * level) / m) return i + 1
  return 0
}

/** `q`: the FDR level Q of the two-stage step-up (bky) q values (default 0.05). */
export function adjustP(
  p: readonly number[],
  method: PAdjustMethod,
  n?: number,
  q = 0.05,
): number[] {
  const out = p.map(() => Number.NaN)
  const idx = p.map((_, i) => i).filter((i) => !Number.isNaN(p[i]!))
  const lp = idx.length
  const m = Math.max(n ?? lp, lp)
  if (lp === 0) return out
  if (method === 'bonferroni' || method === 'sidak') {
    for (const i of idx) out[i] = method === 'sidak' ? sidak(p[i]!, m) : Math.min(1, m * p[i]!)
    return out
  }
  // Ascending order (stable).
  const o = idx.slice().sort((a, b) => p[a]! - p[b]! || a - b)
  if (method === 'holm' || method === 'holm-sidak') {
    let run = 0
    o.forEach((i, j) => {
      const k = m - j // m − (j+1) + 1
      const v = method === 'holm' ? Math.min(1, k * p[i]!) : sidak(p[i]!, k)
      run = Math.max(run, v)
      out[i] = run
    })
    return out
  }
  if (method === 'bh' || method === 'by') {
    let c = 1
    if (method === 'by') {
      c = 0
      for (let j = m; j >= 1; j--) c += 1 / j
    }
    const adj = bhAdjusted(
      o.map((i) => p[i]!),
      m,
    )
    o.forEach((i, j) => {
      out[i] = Math.min(1, c * adj[j]!)
    })
    return out
  }
  // bky: pad with P = 1 to the family size; m̂₀ from the first stage at Q / (1 + Q).
  const sorted = o.map((i) => p[i]!)
  while (sorted.length < m) sorted.push(1)
  const pt = bhAdjusted(sorted, m) // p̃, ascending (at most 1: p̃_(m) = p_(m))
  const m0 = Math.max(1, m - stepUpCount(sorted, q / (1 + q), m))
  o.forEach((i, j) => {
    out[i] = Math.min(1, (pt[j]! * (1 + q) * m0) / m)
  })
  return out
}

/** BH-adjusted values (uncapped) of ascending P values with family size m: min_{j≥i} m p_j / j. */
function bhAdjusted(sorted: readonly number[], m: number): Float64Array {
  const n = sorted.length
  const adj = new Float64Array(n)
  let run = Number.POSITIVE_INFINITY
  for (let j = n - 1; j >= 0; j--) {
    run = Math.min(run, (m * sorted[j]!) / (j + 1))
    adj[j] = run
  }
  return adj
}
