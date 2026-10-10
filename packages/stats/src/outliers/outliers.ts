import { absolutes } from '../arrays.ts'
import { quantileSorted } from '../descriptive/quantile.ts'
import { tQuantile, tSf } from '../dist/t.ts'

/**
 * Outlier identification for a column of values, as Prism's "Identify outliers" analysis.
 *
 * Grubbs' test (Prism Statistics Guide, "How it works: Grubbs' test"; Grubbs 1969,
 * Technometrics 11: 1–21), two-sided: G = max |xᵢ − x̄| / s over all values (s with n − 1),
 * compared with the critical value
 *   G_crit = (n − 1)/√n · √(t² / (n − 2 + t²)),  t = t_{α/(2n); n−2} (upper quantile).
 * The P value is the matching Bonferroni bound P = min(1, 2n·P(T_{n−2} > t_G)) with
 * t_G = √(n(n − 2)G² / ((n − 1)² − nG²)), so P < α exactly when G > G_crit. "Iterative Grubbs"
 * removes the outlier and tests the remaining values again, until none is found (or n < 3).
 *
 * ROUT (Motulsky & Brown 2006, BMC Bioinformatics 7: 123; Prism "How it works: ROUT method"),
 * with the model a single location (K = 1 parameter), as for column data:
 * 1. Robust fit: minimise Σ ln(1 + (rᵢ/RSDR)²) (the Lorentzian merit function), where
 *    RSDR = P68.27(|rᵢ|) · N/(N − K) is the robust SD of the residuals, recomputed from the
 *    current fit until the fit and RSDR no longer change. The location for a fixed RSDR is found
 *    by iteratively reweighted means (weights 1/(1 + (r/RSDR)²), a descent method), starting at
 *    the median. The 68.27th percentile is Prism's percentile definition (type 6).
 * 2. Outlier test (false discovery rate): tᵢ = |rᵢ|/RSDR, two-tailed P from t with N − K df.
 *    Only the 30% of values with the largest residuals are candidates (at least one): ranked
 *    from the largest residual (j = 1), the Benjamini-Hochberg threshold is Q·j/N (the paper's
 *    Q(N − (i − 1))/N with i ranked from the smallest); the largest j among the candidates with
 *    P_j < Q·j/N makes values 1..j outliers.
 * GraphPad does not publish a numeric worked example of ROUT for column data; the rounding of
 * "30%" and the percentile definition are our choices (see DATA_MODEL.md, "to verify").
 */

export interface GrubbsStep {
  /** Index into the original values. */
  index: number
  value: number
  n: number
  mean: number
  sd: number
  G: number
  critical: number
  p: number
  outlier: boolean
}

export interface GrubbsResult {
  steps: GrubbsStep[]
  /** Indices (into the input) of the outliers, in the order found. */
  outliers: number[]
}

/** One two-sided Grubbs test of the finite values at `indices`. */
function grubbsStep(
  values: ArrayLike<number>,
  indices: readonly number[],
  alpha: number,
): GrubbsStep | null {
  const n = indices.length
  if (n < 3) return null
  let s = 0
  for (const i of indices) s += values[i]!
  const mean = s / n
  let ss = 0
  let far = -1
  let dmax = -1
  for (const i of indices) {
    const d = values[i]! - mean
    ss += d * d
    if (Math.abs(d) > dmax) {
      dmax = Math.abs(d)
      far = i
    }
  }
  const sd = Math.sqrt(ss / (n - 1))
  const tc = tQuantile(alpha / (2 * n), n - 2, false)
  const critical = ((n - 1) / Math.sqrt(n)) * Math.sqrt((tc * tc) / (n - 2 + tc * tc))
  if (!(sd > 0))
    return {
      index: far,
      value: values[far]!,
      n,
      mean,
      sd,
      G: Number.NaN,
      critical,
      p: Number.NaN,
      outlier: false,
    }
  const G = dmax / sd
  const den = (n - 1) ** 2 - n * G * G
  const tG = den > 0 ? Math.sqrt((n * (n - 2) * G * G) / den) : Number.POSITIVE_INFINITY
  const p = Math.min(1, 2 * n * tSf(tG, n - 2))
  return { index: far, value: values[far]!, n, mean, sd, G, critical, p, outlier: G > critical }
}

/** Grubbs' test on the finite values; `iterative` repeats it after removing each outlier. */
export function grubbs(values: ArrayLike<number>, alpha = 0.05, iterative = false): GrubbsResult {
  let idx: number[] = []
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) idx.push(i)
  const steps: GrubbsStep[] = []
  const outliers: number[] = []
  for (;;) {
    const st = grubbsStep(values, idx, alpha)
    if (!st) break
    steps.push(st)
    if (!st.outlier) break
    outliers.push(st.index)
    idx = idx.filter((i) => i !== st.index)
    if (!iterative) break
  }
  return { steps, outliers }
}

export interface RoutValue {
  index: number
  value: number
  residual: number
  t: number
  p: number
  /** Rank by |residual| (1 = largest). */
  rank: number
  /** BH threshold Q·rank/N (candidates only; NaN otherwise). */
  threshold: number
  outlier: boolean
}

export interface RoutResult {
  /** Robust location (the robust fit of a constant). */
  center: number
  rsdr: number
  n: number
  df: number
  candidates: number
  values: RoutValue[]
  /** Indices of the outliers (largest residual first). */
  outliers: number[]
  iterations: number
  converged: boolean
}

const P6827 = 0.6827

function rsdrOf(y: readonly number[], mu: number, k: number): number {
  return robustSD(
    y.map((v) => v - mu),
    k,
  )
}

/**
 * RSDR, the robust standard deviation of residuals (Motulsky & Brown 2006): the 68.27th
 * percentile of |residuals| (type 6) × N/(N − K) for K fitted parameters.
 */
export function robustSD(residuals: ArrayLike<number>, k: number): number {
  const n = residuals.length
  const a = absolutes(residuals).sort()
  return (quantileSorted(a, P6827) * n) / (n - k)
}

export interface RoutTest {
  /** Per residual, in input order (`index` and `value` are the residual's position and 0). */
  values: RoutValue[]
  candidates: number
  /** Positions of the outliers, largest residual first. */
  outliers: number[]
}

/**
 * ROUT's outlier test on residuals from a robust fit: tᵢ = |rᵢ|/RSDR with a two-tailed P from t
 * on `df` = N − K; the 30% largest residuals (at least one) are candidates, tested with
 * Benjamini-Hochberg thresholds Q·j/N from the largest (j = 1).
 */
export function routTest(
  residuals: ArrayLike<number>,
  rsdr: number,
  df: number,
  q: number,
): RoutTest {
  const n = residuals.length
  const r = Array.from(residuals)
  const order = r.map((_, i) => i).sort((a, b) => Math.abs(r[b]!) - Math.abs(r[a]!) || a - b)
  const m = Math.max(1, Math.floor(0.3 * n))
  const rows: RoutValue[] = r.map((v, i) => {
    const t = rsdr > 0 ? Math.abs(v) / rsdr : v === 0 ? 0 : Number.POSITIVE_INFINITY
    return {
      index: i,
      value: 0,
      residual: v,
      t,
      p: 2 * tSf(t, df),
      rank: 0,
      threshold: Number.NaN,
      outlier: false,
    }
  })
  order.forEach((i, j) => {
    rows[i]!.rank = j + 1
    if (j < m) rows[i]!.threshold = (q * (j + 1)) / n
  })
  let last = 0
  for (let j = 1; j <= Math.min(m, n); j++) {
    const row = rows[order[j - 1]!]!
    if (row.p < row.threshold) last = j
  }
  const outliers: number[] = []
  for (let j = 0; j < last; j++) {
    rows[order[j]!]!.outlier = true
    outliers.push(order[j]!)
  }
  return { values: rows, candidates: Math.min(m, n), outliers }
}

/** Location minimising Σ ln(1 + ((y − μ)/s)²) from `start` (reweighted means). */
function lorentzianLocation(y: readonly number[], s: number, start: number): number {
  let mu = start
  for (let it = 0; it < 10000; it++) {
    let sw = 0
    let swy = 0
    for (const v of y) {
      const r = (v - mu) / s
      const w = 1 / (1 + r * r)
      sw += w
      swy += w * (v - mu)
    }
    const next = mu + swy / sw
    if (Math.abs(next - mu) <= 1e-15 * (Math.abs(mu) + s) || next === mu) return next
    mu = next
  }
  return mu
}

/** ROUT on the finite values with a constant model; `q` is the FDR as a fraction (0.01 = 1%). */
export function rout(values: ArrayLike<number>, q = 0.01): RoutResult {
  const idx: number[] = []
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) idx.push(i)
  const y = idx.map((i) => values[i]!)
  const n = y.length
  const K = 1
  const df = n - K
  const empty: RoutResult = {
    center: Number.NaN,
    rsdr: Number.NaN,
    n,
    df,
    candidates: 0,
    values: [],
    outliers: [],
    iterations: 0,
    converged: false,
  }
  if (n < 3) return empty
  const sorted = Float64Array.from(y).sort()
  let mu = quantileSorted(sorted, 0.5)
  let s = rsdrOf(y, mu, K)
  let iterations = 0
  let converged = false
  for (; iterations < 1000; iterations++) {
    if (!(s > 0)) break
    const next = lorentzianLocation(y, s, mu)
    const sNext = rsdrOf(y, next, K)
    const done =
      Math.abs(next - mu) <= 1e-14 * (Math.abs(mu) + s) && Math.abs(sNext - s) <= 1e-14 * s
    mu = next
    s = sNext
    if (done) {
      converged = true
      break
    }
  }
  const t = routTest(
    y.map((v) => v - mu),
    s,
    df,
    q,
  )
  const rows: RoutValue[] = t.values.map((r, i) => ({ ...r, index: idx[i]!, value: y[i]! }))
  const outliers = t.outliers.map((i) => idx[i]!)
  const m = t.candidates
  return {
    center: mu,
    rsdr: s,
    n,
    df,
    candidates: m,
    values: rows,
    outliers,
    iterations,
    converged,
  }
}
