import { adjustP, stepUpCount } from './padjust.ts'

/**
 * Decisions for a family of P values (multiple t tests, a stack of P values), as Prism's
 * "Multiple comparisons" choices for these analyses:
 *
 * - False discovery rate at level Q (a fraction here; Prism's dialog takes a percentage):
 *   'bky' two-stage step-up (Benjamini, Krieger & Yekutieli 2006, Definition 6; Prism's
 *   recommended default), 'bh' (Benjamini & Hochberg 1995), 'by' (Benjamini & Yekutieli 2001).
 *   A P value is a discovery when the procedure run at Q rejects it (a step-up procedure rejects
 *   p_(i) ≤ i·Q/m', so a P value on the boundary is a discovery). The adjusted value is its q
 *   value (adjustP; BKY's at this Q, as Prism's: a discovery has q ≤ Q).
 * - Statistical significance at level α: 'holm-sidak' (Prism's recommendation), 'sidak'
 *   (Prism's "Šídák-Bonferroni") and 'bonferroni' ("Bonferroni-Dunn"); a P value is "below
 *   threshold" when its multiplicity-adjusted P is < α.
 * - 'none': each P value is compared with α on its own.
 *
 * NaN P values (tests that could not be computed) are not counted in the family and are never
 * flagged.
 */
export type FamilyMethod = 'bky' | 'bh' | 'by' | 'holm-sidak' | 'sidak' | 'bonferroni' | 'none'

export interface FamilyOptions {
  method: FamilyMethod
  /** FDR level Q as a fraction (FDR methods). Default 0.01. */
  q?: number
  /** Significance level α (other methods). Default 0.05. */
  alpha?: number
}

export interface FamilyResult {
  /** q values (FDR methods), multiplicity-adjusted P values, or the P values themselves. */
  adjusted: number[]
  /** Discovery (FDR) or "below threshold" (significance). */
  flagged: boolean[]
  /** Number of P values in the family (non-NaN). */
  m: number
  /** BKY: the estimated number of true null hypotheses, m − r₁ from stage one at Q/(1 + Q). */
  m0?: number
}

const isFdrMethod = (m: FamilyMethod): m is 'bky' | 'bh' | 'by' =>
  m === 'bky' || m === 'bh' || m === 'by'

export function correctFamily(p: readonly number[], opts: FamilyOptions): FamilyResult {
  const q = opts.q ?? 0.01
  const alpha = opts.alpha ?? 0.05
  const idx = p.map((_, i) => i).filter((i) => !Number.isNaN(p[i]!))
  const m = idx.length
  const flagged = p.map(() => false)
  if (opts.method === 'none') {
    for (const i of idx) flagged[i] = p[i]! < alpha
    return { adjusted: p.map((v) => v), flagged, m }
  }
  const adjusted = adjustP(p, opts.method, undefined, q)
  if (!isFdrMethod(opts.method)) {
    for (const i of idx) flagged[i] = adjusted[i]! < alpha
    return { adjusted, flagged, m }
  }
  // Order ascending (stable) and run the procedure at Q.
  const o = idx.slice().sort((a, b) => p[a]! - p[b]! || a - b)
  const sorted = o.map((i) => p[i]!)
  let r = 0
  let m0: number | undefined
  if (opts.method === 'bh') r = stepUpCount(sorted, q, m)
  else if (opts.method === 'by') {
    let c = 0
    for (let j = 1; j <= m; j++) c += 1 / j
    r = stepUpCount(sorted, q / c, m)
  } else {
    const q1 = q / (1 + q)
    const r1 = stepUpCount(sorted, q1, m)
    if (r1 === 0) {
      r = 0
      m0 = m
    } else if (r1 === m) {
      r = m
      m0 = 0
    } else {
      m0 = m - r1
      r = stepUpCount(sorted, (q1 * m) / m0, m)
    }
  }
  for (let j = 0; j < r; j++) flagged[o[j]!] = true
  return { adjusted, flagged, m, ...(m0 !== undefined ? { m0 } : {}) }
}
