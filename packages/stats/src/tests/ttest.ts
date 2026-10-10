import { differences, shifted } from '../arrays.ts'
import { mean, sd, squareScale } from '../descriptive/basic.ts'
import { tSf } from '../dist/t.ts'
import { type Alternative, tInterval, tOfEstimate, tPValue, tRSquared } from './common.ts'

/**
 * Student / Welch t tests.
 *
 * Sign convention (Prism's): the effect is B − A, where A is the first data set. So `diff` is
 * mean(B) − mean(A), t has the sign of diff, the CI brackets diff, and 'greater' means
 * mean(B) > mean(A). The R oracle therefore calls t.test(b, a).
 */

export interface TTestOptions {
  /** Pooled-variance Student t (true, the default) or Welch's unequal-variance test. */
  equalVariance?: boolean
  alternative?: Alternative
  confLevel?: number
}

export interface TTestResult {
  t: number
  df: number
  p: number
  meanA: number
  meanB: number
  sdA: number
  sdB: number
  nA: number
  nB: number
  /** mean(B) − mean(A) */
  diff: number
  /** Standard error of diff. */
  seDiff: number
  ciLo: number
  ciHi: number
  /** Effect size η² = t² / (t² + df). */
  rSquared: number
}

export interface SummaryStats {
  mean: number
  sd: number
  n: number
}

/**
 * Two-sample core from summary statistics. With SD = 0 in both groups the standard error is 0
 * and t = ±∞ (or NaN for equal means); these propagate by IEEE rules rather than throwing.
 */
function twoSample(
  A: SummaryStats,
  B: SummaryStats,
  diff: number,
  opts: TTestOptions,
): TTestResult {
  const equalVariance = opts.equalVariance ?? true
  const alternative = opts.alternative ?? 'two-sided'
  const confLevel = opts.confLevel ?? 0.95
  // SDs scaled by a power of two before squaring at extreme magnitudes (audit 3, S4).
  const k = squareScale(Math.max(A.sd, B.sd))
  const [a, b] = [A.sd / k, B.sd / k]
  const vA = a * a
  const vB = b * b
  let df: number
  let se: number
  if (equalVariance) {
    df = A.n + B.n - 2
    // As R: a group of one contributes no variance term (its sample variance is undefined).
    let ss = 0
    if (A.n > 1) ss += (A.n - 1) * vA
    if (B.n > 1) ss += (B.n - 1) * vB
    se = Math.sqrt((ss / df) * (1 / A.n + 1 / B.n))
  } else {
    // Welch–Satterthwaite
    const sA = vA / A.n
    const sB = vB / B.n
    se = Math.sqrt(sA + sB)
    df = (sA + sB) ** 2 / ((sA * sA) / (A.n - 1) + (sB * sB) / (B.n - 1))
  }
  se *= k
  const t = diff / se
  const [ciLo, ciHi] = tInterval(diff, se, df, alternative, confLevel)
  return {
    t,
    df,
    p: tPValue(t, df, alternative),
    meanA: A.mean,
    meanB: B.mean,
    sdA: A.sd,
    sdB: B.sd,
    nA: A.n,
    nB: B.n,
    diff,
    seDiff: se,
    ciLo,
    ciHi,
    rSquared: tRSquared(t, df),
  }
}

/**
 * mean(b) − mean(a), computed after shifting both samples by mean(a). For data with a large
 * common offset (1e9 + small noise) each mean is only good to ~1 ulp of 1e9, which would be
 * a large relative error in their small difference; the shifted values are exact (Sterbenz)
 * and their means keep full relative accuracy.
 */
function diffOfMeans(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const c = mean(a)
  const da = shifted(a, c)
  const db = shifted(b, c)
  return mean(db) - mean(da)
}

function summary(x: ArrayLike<number>): SummaryStats {
  return { mean: mean(x), sd: sd(x), n: x.length }
}

/** Unpaired t test (pooled Student, or Welch with equalVariance: false). */
export function tTestUnpaired(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  opts: TTestOptions = {},
): TTestResult {
  return twoSample(summary(a), summary(b), diffOfMeans(a, b), opts)
}

/** Unpaired t test from mean, SD and n of each group. */
export function tTestFromSummary(
  A: SummaryStats,
  B: SummaryStats,
  opts: TTestOptions = {},
): TTestResult {
  return twoSample(A, B, B.mean - A.mean, opts)
}

export interface PairedOptions {
  alternative?: Alternative
  confLevel?: number
}

export interface OneSampleT {
  t: number
  df: number
  p: number
  /** Mean of the analysed values (differences B − A, or log ratios). */
  mean: number
  sd: number
  se: number
  ciLo: number
  ciHi: number
  n: number
  rSquared: number
}

/** One-sample t test of mean(x) = 0. */
function oneSample(x: ArrayLike<number>, opts: PairedOptions): OneSampleT {
  const m = mean(x)
  const s = sd(x)
  const { t, df, p, se, ciLo, ciHi, rSquared } = tOfEstimate(m, s, x.length, opts)
  return { t, df, p, mean: m, sd: s, se, ciLo, ciHi, n: x.length, rSquared }
}

export interface PairedTTestResult extends OneSampleT {
  meanA: number
  meanB: number
  /** Pearson correlation of A and B ("was the pairing effective?"). */
  pairingR: number
  /** One-tailed P for pairingR > 0 (t = r √((n−2)/(1−r²)), df n − 2). */
  pairingP: number
}

/** Pearson correlation by the two-pass (centred) formula, clamped to [−1, 1]. */
export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length
  const ma = mean(a)
  const mb = mean(b)
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma
    const db = b[i]! - mb
    sab += da * db
    saa += da * da
    sbb += db * db
  }
  // √(saa·sbb) rather than √saa·√sbb: exactly 1 for exactly proportional deviations.
  const prod = saa * sbb
  const safe = prod > 1e-300 && prod < 1e300
  const r = sab / (safe ? Math.sqrt(prod) : Math.sqrt(saa) * Math.sqrt(sbb))
  return Math.max(-1, Math.min(1, r))
}

function requireSameLength(a: ArrayLike<number>, b: ArrayLike<number>): void {
  if (a.length !== b.length) throw new RangeError('paired data must have equal lengths')
}

/** Paired t test on the differences B − A. */
export function tTestPaired(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  opts: PairedOptions = {},
): PairedTTestResult {
  requireSameLength(a, b)
  const n = a.length
  const d = differences(a, b)
  const r = pearson(a, b)
  const dfr = n - 2
  const tr = (Math.sqrt(dfr) * r) / Math.sqrt(1 - r * r)
  return {
    ...oneSample(d, opts),
    meanA: mean(a),
    meanB: mean(b),
    pairingR: r,
    pairingP: dfr > 0 ? tSf(tr, dfr) : Number.NaN,
  }
}

export interface RatioPairedTTestResult extends OneSampleT {
  /** Geometric mean of B/A: 10^mean(log10(B/A)). */
  ratio: number
  ratioCiLo: number
  ratioCiHi: number
}

/**
 * Ratio paired t test: paired t test on log10(B/A). `mean`, `ciLo`, `ciHi` are on the log10
 * scale; `ratio*` are back-transformed. All results are NaN if any value is ≤ 0.
 */
export function tTestRatioPaired(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  opts: PairedOptions = {},
): RatioPairedTTestResult {
  requireSameLength(a, b)
  const n = a.length
  const lr = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    lr[i] = a[i]! > 0 && b[i]! > 0 ? Math.log10(b[i]! / a[i]!) : Number.NaN
  }
  const res = oneSample(lr, opts)
  return {
    ...res,
    ratio: 10 ** res.mean,
    ratioCiLo: 10 ** res.ciLo,
    ratioCiHi: 10 ** res.ciHi,
  }
}
