import { hyperLogPmf } from '../dist/binomial.ts'
import { normalQuantile } from '../dist/normal.ts'
import { type Estimate, type ProportionCiMethod, proportionCI } from './proportion.ts'
import { check2x2 } from './validate.ts'
import { wilsonLimits } from './wilson.ts'

export interface TwoByTwo {
  /** p1 / p2 with pᵢ = first-column count / row total; Koopman asymptotic score CI. */
  relativeRisk: Estimate
  /** p1 − p2; Newcombe hybrid score CI (with continuity correction by default). */
  riskDifference: Estimate
  /**
   * Number needed to treat, 1 / (p1 − p2), signed like the difference (positive: row 1 has
   * the higher proportion in column 1). Limits are the reciprocals of the difference's limits,
   * lower = 1 / diff.upper and upper = 1 / diff.lower (the reciprocal of both confidence
   * limits). When the difference's CI contains 0 the confidence set passes
   * through ±∞, and then lower > upper: it is NNT ≥ lower or NNT ≤ upper.
   * null when the difference is 0 or undefined.
   */
  nnt: Estimate | null
  /** ad / bc; Baptista–Pike exact conditional CI. */
  oddsRatio: Estimate
  /**
   * Diagnostic-test view (row 1 = has the condition, row 2 = does not; column 1 = test
   * positive): sensitivity a/(a+b), specificity d/(c+d), PPV a/(a+c), NPV d/(b+d); CIs by
   * proportionCI (Wilson/Brown by default).
   */
  sensitivity: Estimate
  specificity: Estimate
  ppv: Estimate
  npv: Estimate
  /** Sensitivity / (1 − specificity). */
  likelihoodRatio: number
}

export interface TwoByTwoOptions {
  /** Default 0.95. */
  confLevel?: number
  /** Newcombe's continuity correction for the difference (default true, the usual advice). */
  newcombeCorrection?: boolean
  /** CI method for sensitivity etc. (default 'wilsonBrown'). */
  proportionMethod?: ProportionCiMethod
}

/**
 * Effect sizes for a 2 × 2 table [[a, b], [c, d]] (rows = groups, row 1 = treated/exposed;
 * columns = outcome, column 1 = outcome present), with the recommended CI methods.
 *
 * Degenerate tables do not throw: a zero row total makes that row's proportion NaN and the
 * estimates that use it NaN (intervals as far as defined: e.g. RR = 0 has lower limit 0, an
 * infinite estimate has upper limit ∞, an undefined RR or OR has the interval [0, ∞]).
 */
export function twoByTwo(
  table: readonly (readonly number[])[],
  opts: TwoByTwoOptions = {},
): TwoByTwo {
  const t = check2x2(table, 'twoByTwo')
  const [[a, b], [c, d]] = t as [[number, number], [number, number]]
  const conf = opts.confLevel ?? 0.95
  const pm = { confLevel: conf, method: opts.proportionMethod ?? 'wilsonBrown' }
  const riskDifference = newcombe(a, a + b, c, c + d, conf, opts.newcombeCorrection ?? true)
  const rd = riskDifference.value
  const nnt =
    rd === 0 || Number.isNaN(rd)
      ? null
      : { value: 1 / rd, lower: 1 / riskDifference.upper, upper: 1 / riskDifference.lower }
  const sensitivity = proportionCI(a, a + b, pm)
  const specificity = proportionCI(d, c + d, pm)
  return {
    relativeRisk: koopman(a, a + b, c, c + d, conf),
    riskDifference,
    nnt,
    oddsRatio: baptistaPike(a, b, c, d, conf),
    sensitivity,
    specificity,
    ppv: proportionCI(a, a + c, pm),
    npv: proportionCI(d, b + d, pm),
    likelihoodRatio: sensitivity.value / (1 - specificity.value),
  }
}

// ---- root finding --------------------------------------------------------------------------

/**
 * Root of F on [lo, hi] where F(lo) and F(hi) have opposite signs (or one is 0): bisection
 * to a bracket of 1e−15 relative. Robust to discontinuities (returns the jump point) and to
 * infinite values of F.
 */
function bisect(F: (x: number) => number, lo: number, hi: number): number {
  let flo = F(lo)
  if (flo === 0) return lo
  for (let i = 0; i < 400; i++) {
    const mid = 0.5 * (lo + hi)
    if (mid === lo || mid === hi || hi - lo <= 1e-15 * Math.max(1, Math.abs(mid))) break
    const fm = F(mid)
    if (fm === 0) return mid
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid
      flo = fm
    } else hi = mid
  }
  return 0.5 * (lo + hi)
}

// ---- relative risk: Koopman asymptotic score -----------------------------------------------

/**
 * Koopman (1984) asymptotic score interval for p1/p2 (x1 of n1 vs x2 of n2), as in
 * Fagerland, Lydersen & Laake, Statistical Analysis of Contingency Tables (2017), §4.7:
 * the limits are the φ where the score statistic
 *   T(φ) = (p̂1 − φ p̂2) / √(p̃1(1 − p̃1)/n1 + φ² p̃2(1 − p̃2)/n2)
 * equals ±z, with p̃ the maximum-likelihood estimates under p1 = φ p2:
 *   p̃2 = (A − √(A² − 4φN(x1 + x2))) / (2φN),  A = φ(n1 + x2) + x1 + n2,  p̃1 = φ p̃2.
 * T decreases in φ; limits are found by bisection on ln φ.
 * x1 = 0 → lower 0; x2 = 0 → upper ∞; x1 = x2 = 0 → [0, ∞].
 */
function koopman(x1: number, n1: number, x2: number, n2: number, conf: number): Estimate {
  const value = x1 / n1 / (x2 / n2)
  if (n1 === 0 || n2 === 0) return { value, lower: Number.NaN, upper: Number.NaN }
  if (x1 === 0 && x2 === 0) return { value, lower: 0, upper: Number.POSITIVE_INFINITY }
  const z = normalQuantile(1 - (1 - conf) / 2)
  const N = n1 + n2
  const p1h = x1 / n1
  const p2h = x2 / n2
  const T = (lphi: number): number => {
    const phi = Math.exp(lphi)
    const A = phi * (n1 + x2) + x1 + n2
    const disc = Math.max(0, A * A - 4 * phi * N * (x1 + x2))
    // Smaller root of φN p² − A p + (x1 + x2) = 0, in the cancellation-free form.
    const p2 = (2 * (x1 + x2)) / (A + Math.sqrt(disc))
    const p1 = phi * p2
    const v = (p1 * (1 - p1)) / n1 + (phi * phi * p2 * (1 - p2)) / n2
    return (p1h - phi * p2h) / Math.sqrt(v)
  }
  let start = Number.isFinite(value) && value > 0 ? Math.log(value) : 0
  // T is 0/0 at φ = 1 when p̂1 = p̂2 = 1; any nearby start point will do.
  if (Number.isNaN(T(start))) start += 1e-3
  const lower = x1 === 0 ? 0 : Math.exp(decreasingRoot((u) => T(u) - z, start))
  const upper =
    x2 === 0 ? Number.POSITIVE_INFINITY : Math.exp(decreasingRoot((u) => T(u) + z, start))
  return { value, lower, upper }
}

/**
 * Root of a decreasing function G: steps from `start` (doubling) in the direction of the root
 * until the sign changes, then bisects. NaN if G is NaN on the way or no sign change is found.
 */
function decreasingRoot(G: (u: number) => number, start: number): number {
  const g0 = G(start)
  if (Number.isNaN(g0)) return Number.NaN
  if (g0 === 0) return start
  const dir = g0 > 0 ? 1 : -1
  let inner = start
  let step = 1
  for (let i = 0; i < 12; i++) {
    const outer = start + dir * step
    const g = G(outer)
    if (Number.isNaN(g)) return Number.NaN
    if (g === 0) return outer
    if (Math.sign(g) !== Math.sign(g0))
      return bisect(G, Math.min(inner, outer), Math.max(inner, outer))
    inner = outer
    step *= 2
  }
  return Number.NaN
}

// ---- difference: Newcombe hybrid score -----------------------------------------------------

/**
 * Newcombe (1998) hybrid score interval for p1 − p2 (method 10; method 11 with the continuity
 * correction): with Wilson limits (l_i, u_i),
 *   lower = D − √((p1 − l1)² + (u2 − p2)²),  upper = D + √((u1 − p1)² + (p2 − l2)²).
 */
function newcombe(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
  conf: number,
  cc: boolean,
): Estimate {
  const p1 = x1 / n1
  const p2 = x2 / n2
  const value = p1 - p2
  if (n1 === 0 || n2 === 0) return { value, lower: Number.NaN, upper: Number.NaN }
  const z = normalQuantile(1 - (1 - conf) / 2)
  const [l1, u1] = wilsonLimits(x1, n1, z, cc)
  const [l2, u2] = wilsonLimits(x2, n2, z, cc)
  const lower = value - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2)
  const upper = value + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)
  return { value, lower: Math.max(-1, lower), upper: Math.min(1, upper) }
}

// ---- odds ratio: Baptista–Pike -------------------------------------------------------------

/**
 * Baptista & Pike (1977) exact conditional interval for the odds ratio (Fagerland et al.
 * 2017, §4.8): the set of θ not rejected by Fisher's exact test with the two-sided P value by
 * summing small probabilities, under the non-central hypergeometric distribution of a given
 * the margins, f(x | θ) ∝ C(k, x) C(N − k, m − x) θˣ. With
 *   P(θ) = Σ_{x: f(x|θ) ≤ f(a|θ)(1 + 1e−7)} f(x | θ),
 * the limits are inf and sup of {θ : P(θ) > α}. P(θ) is piecewise continuous and not always
 * monotone, so each limit is located by going out from the estimate (doubling steps in ln θ)
 * until P ≪ α, scanning ln θ back inward in steps of 0.01 until P > α, and bisecting that step
 * to the crossing (a jump point if P is discontinuous there). The weights are handled in log
 * space (ln f from hyperLogPmf, normalized by log-sum-exp), so no term underflows; the scan
 * covers at most twice the distance out, and a P that is never finite or never exceeds α gives
 * NaN. a at the bottom (top) of its support gives lower 0 (upper ∞); a single-point support
 * gives [0, ∞].
 */
function baptistaPike(a: number, b: number, c: number, d: number, conf: number): Estimate {
  const value = (a * d) / (b * c)
  const alpha = 1 - conf
  const m = a + c // first column total
  const n = b + d
  const k = a + b // first row total
  const lo = Math.max(0, k - n)
  const hi = Math.min(k, m)
  if (lo === hi) return { value, lower: 0, upper: Number.POSITIVE_INFINITY }
  const K = hi - lo + 1
  const ia = a - lo
  const logc = new Float64Array(K)
  for (let i = 0; i < K; i++) logc[i] = hyperLogPmf(lo + i, m, n, k)
  const w = new Float64Array(K)
  // P(e^lt); the weights are taken relative to the observed x = a, which keeps x·ln θ small.
  const P = (lt: number): number => {
    let max = Number.NEGATIVE_INFINITY
    for (let i = 0; i < K; i++) {
      const v = logc[i]! + (i - ia) * lt
      w[i] = v
      if (v > max) max = v
    }
    if (!Number.isFinite(max) || !Number.isFinite(w[ia]!)) return Number.NaN
    const obs = Math.exp(w[ia]! - max) * (1 + 1e-7)
    let total = 0
    let s = 0
    for (let i = 0; i < K; i++) {
      const v = w[i]! - max
      if (v < -746) continue // exp underflows to 0
      const e = Math.exp(v)
      total += e
      if (e <= obs) s += e
    }
    return s / total
  }
  // Start from the sample odds ratio with ½ added to each cell (finite, and inside the
  // acceptance region in practice; the inward scan continues past it if it is not).
  const center = Math.log(((a + 0.5) * (d + 0.5)) / ((b + 0.5) * (c + 0.5)))
  if (Number.isNaN(P(center))) return { value, lower: Number.NaN, upper: Number.NaN }
  const h = 0.01
  const limit = (dir: number): number => {
    // An outside point where P is far below α, then scan inward until P > α.
    let step = 1
    let outer = center + dir * step
    for (let i = 0; i < 12 && P(outer) > alpha * 1e-3; i++) {
      step *= 2
      outer = center + dir * step
    }
    let prev = outer
    const steps = Math.ceil((2 * step) / h)
    for (let i = 1; i <= steps; i++) {
      const u = outer - dir * i * h
      const pu = P(u)
      if (Number.isNaN(pu)) return Number.NaN
      if (pu > alpha) {
        return Math.exp(
          bisect((v) => (P(v) > alpha ? 1 : -1), Math.min(prev, u), Math.max(prev, u)),
        )
      }
      prev = u
    }
    return Number.NaN
  }
  const lower = a === lo ? 0 : limit(-1)
  const upper = a === hi ? Number.POSITIVE_INFINITY : limit(1)
  return { value, lower, upper }
}
