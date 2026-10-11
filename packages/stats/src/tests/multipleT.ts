import { mean, sd } from '../descriptive/basic.ts'
import { median } from '../descriptive/quantile.ts'
import { tPValue } from './common.ts'
import { kolmogorovSmirnovTwoSample } from './ksTwoSample.ts'
import { mannWhitney } from './mannWhitney.ts'
import {
  type SummaryStats,
  tTestFromSummary,
  tTestPaired,
  tTestRatioPaired,
  tTestUnpaired,
} from './ttest.ts'
import { wilcoxonSignedRank } from './wilcoxon.ts'

/**
 * Multiple t tests (and nonparametric tests), one per row of a grouped table (the "Multiple
 * t tests" analysis). Each row
 * compares data set A with data set B; the effect is B − A (the caller swaps the groups for
 * A − B). Tests:
 *
 * - 'welch': unpaired t test with Welch's correction, each row's own variances (the default).
 * - 'unpaired': Student's t test, pooling the two groups' variances within each row.
 * - 'pooled': Student's t test with one SD pooled from every tested row ("assume a consistent
 *   SD": one pooled SD, as two-way ANOVA would compute it): s² = Σ_rows Σ_groups
 *   (n − 1)·SD² / Σ_rows (nA + nB − 2), df = Σ_rows (nA + nB − 2) — the residual mean square of
 *   the two-way ANOVA (rows × the two data sets, with interaction). Every row with at least one
 *   value in each group is tested and contributes.
 * - 'paired': paired t test of the differences B − A (pairs are the values in the same
 *   subcolumn; incomplete pairs are dropped).
 * - 'mannWhitney', 'kolmogorovSmirnov' (unpaired), 'wilcoxon' (paired): the rank tests of this
 *   package, exact P when the samples are small enough (the same rules as the single tests).
 *
 * `lognormal` (t tests only) analyses log10 of the values: the "lognormal" choices, i.e. the
 * t tests on logs (unpaired) and the ratio paired t test (paired). Means are then geometric
 * means, `diff` is the difference of the log10 means and `ratio` = 10^diff (B/A). Values ≤ 0
 * (paired: the pairs holding one) have no logarithm and are left out of their row, counted in
 * `leftOut`; the row is tested when at least two values (pairs) per group remain — as
 * R's t.test of the positive values' log10 (audit 3, RTA-2; until then the whole row was
 * skipped).
 *
 * Rows that can't be tested get `p = NaN` and a `skip` reason (too few values, no variation —
 * rows whose SD is zero are left out — fewer than two values > 0 on a log scale, summary data
 * for a test that needs raw values).
 */

export type MultipleTTestMethod =
  | 'welch'
  | 'unpaired'
  | 'pooled'
  | 'paired'
  | 'mannWhitney'
  | 'kolmogorovSmirnov'
  | 'wilcoxon'

/**
 * One row: the two groups' values (NaN = empty; for paired tests value i of A pairs with value i
 * of B), or mean/SD/N summaries (unpaired t tests only).
 */
export interface MultipleTRowInput {
  a: ArrayLike<number> | SummaryStats
  b: ArrayLike<number> | SummaryStats
}

export interface MultipleTOptions {
  method: MultipleTTestMethod
  lognormal?: boolean
  /** Rank tests: exact P when possible ('auto', the default) or the normal approximation. */
  exact?: 'auto' | false
}

export type MultipleTSkip =
  | 'too-few-values'
  | 'no-variation'
  | 'not-positive'
  | 'summary-data'
  | 'no-pairs'

export interface MultipleTRow {
  skip?: MultipleTSkip
  /** Values (paired: complete pairs) analysed in each group. */
  nA: number
  nB: number
  /** Means (geometric means for lognormal; medians for the rank tests). */
  centerA: number
  centerB: number
  /** B − A: difference of means (log10 means for lognormal), or of medians (rank tests). */
  diff: number
  /** SE of diff (t tests). */
  se: number
  /** t ratio; Mann-Whitney U; Kolmogorov-Smirnov D; Wilcoxon W (sum of signed ranks). */
  stat: number
  df: number
  p: number
  /** Lognormal: 10^diff, the ratio of geometric means B/A. */
  ratio?: number
  /** Rank tests: whether P is exact. */
  exact?: boolean
  /** Lognormal: values ≤ 0 (paired: pairs holding one) left out of the test, when any. */
  leftOut?: number
}

export interface MultipleTResult {
  rows: MultipleTRow[]
  /** 'pooled': the pooled SD and its df. */
  pooled?: { sd: number; df: number }
}

const isSummary = (x: ArrayLike<number> | SummaryStats): x is SummaryStats =>
  typeof (x as SummaryStats).mean === 'number' && !('length' in x)

const finite = (x: ArrayLike<number>) => Float64Array.from(Array.from(x).filter(Number.isFinite))

function skipped(reason: MultipleTSkip, nA = 0, nB = 0): MultipleTRow {
  const n = Number.NaN
  return { skip: reason, nA, nB, centerA: n, centerB: n, diff: n, se: n, stat: n, df: n, p: n }
}

function log10All(x: Float64Array) {
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = Math.log10(x[i]!)
  return out
}

export function multipleTTests(
  input: readonly MultipleTRowInput[],
  opts: MultipleTOptions,
): MultipleTResult {
  const { method } = opts
  const lognormal = !!opts.lognormal && method !== 'mannWhitney' && method !== 'kolmogorovSmirnov'
  const rankExact = opts.exact ?? 'auto'

  if (method === 'paired' || method === 'wilcoxon') {
    return {
      rows: input.map(({ a, b }) => {
        if (isSummary(a) || isSummary(b)) return skipped('summary-data')
        const xa: number[] = []
        const xb: number[] = []
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
          if (Number.isFinite(a[i]!) && Number.isFinite(b[i]!)) {
            xa.push(a[i]!)
            xb.push(b[i]!)
          }
        }
        const n = xa.length
        if (method === 'wilcoxon') {
          if (n < 1) return skipped('no-pairs', n, n)
          const w = wilcoxonSignedRank(xa, xb, { exact: rankExact })
          if (Number.isNaN(w.p)) return skipped('no-variation', n, n)
          return {
            nA: n,
            nB: n,
            centerA: median(xa),
            centerB: median(xb),
            diff: w.medianDiff,
            se: Number.NaN,
            stat: w.W,
            df: Number.NaN,
            p: w.p,
            exact: w.method === 'exact',
          }
        }
        if (n < 2) return skipped('no-pairs', n, n)
        if (lognormal) {
          const keep = xa.map((v, i) => v > 0 && xb[i]! > 0)
          const [pa, pb] = [xa.filter((_, i) => keep[i]), xb.filter((_, i) => keep[i])]
          const k = pa.length
          if (k < 2) return skipped('not-positive', k, k)
          const r = tTestRatioPaired(pa, pb)
          if (!(r.se > 0)) return skipped('no-variation', k, k)
          return {
            nA: k,
            nB: k,
            centerA: 10 ** mean(log10All(Float64Array.from(pa))),
            centerB: 10 ** mean(log10All(Float64Array.from(pb))),
            diff: r.mean,
            se: r.se,
            stat: r.t,
            df: r.df,
            p: r.p,
            ratio: r.ratio,
            ...(k < n ? { leftOut: n - k } : {}),
          }
        }
        const r = tTestPaired(xa, xb)
        if (!(r.se > 0)) return skipped('no-variation', n, n)
        return {
          nA: n,
          nB: n,
          centerA: r.meanA,
          centerB: r.meanB,
          diff: r.mean,
          se: r.se,
          stat: r.t,
          df: r.df,
          p: r.p,
        }
      }),
    }
  }

  if (method === 'mannWhitney' || method === 'kolmogorovSmirnov') {
    return {
      rows: input.map(({ a, b }) => {
        if (isSummary(a) || isSummary(b)) return skipped('summary-data')
        const xa = finite(a)
        const xb = finite(b)
        const [nA, nB] = [xa.length, xb.length]
        if (nA < 1 || nB < 1 || nA + nB < 3) return skipped('too-few-values', nA, nB)
        const base = { nA, nB, centerA: median(xa), centerB: median(xb), se: Number.NaN }
        if (method === 'mannWhitney') {
          const r = mannWhitney(xa, xb, { exact: rankExact, correct: true })
          if (Number.isNaN(r.p)) return skipped('no-variation', nA, nB)
          return {
            ...base,
            diff: base.centerB - base.centerA,
            stat: r.U,
            df: Number.NaN,
            p: r.p,
            exact: r.method === 'exact',
          }
        }
        const r = kolmogorovSmirnovTwoSample(xa, xb, {
          exact: rankExact === 'auto' ? 'auto' : false,
        })
        return {
          ...base,
          diff: base.centerB - base.centerA,
          stat: r.d,
          df: Number.NaN,
          p: r.p,
          exact: r.exact,
        }
      }),
    }
  }

  // Unpaired t tests. Summary statistics per group (on log10 values for lognormal).
  type G = { raw: Float64Array | null; s: SummaryStats; leftOut: number }
  const group = (x: ArrayLike<number> | SummaryStats): G | 'summary-data' => {
    if (isSummary(x)) {
      if (lognormal) return 'summary-data'
      return { raw: null, s: x, leftOut: 0 }
    }
    let v = finite(x)
    let leftOut = 0
    if (lognormal) {
      const positive = v.filter((y) => y > 0)
      leftOut = v.length - positive.length
      v = log10All(positive)
    }
    return { raw: v, s: { mean: mean(v), sd: sd(v), n: v.length }, leftOut }
  }
  // A row whose values ≤ 0 leave fewer than two in a group isn't tested (nor pooled).
  const notPositive = (ga: G, gb: G) => ga.leftOut + gb.leftOut > 0 && (ga.s.n < 2 || gb.s.n < 2)
  const groups = input.map(({ a, b }) => [group(a), group(b)] as const)
  const count = (g: G | string) => (typeof g === 'string' ? 0 : g.s.n)

  let pooled: MultipleTResult['pooled']
  if (method === 'pooled') {
    let ss = 0
    let df = 0
    for (const [ga, gb] of groups) {
      if (typeof ga === 'string' || typeof gb === 'string' || notPositive(ga, gb)) continue
      if (ga.s.n < 1 || gb.s.n < 1) continue
      for (const g of [ga, gb]) if (g.s.n > 1) ss += (g.s.n - 1) * g.s.sd * g.s.sd
      df += ga.s.n + gb.s.n - 2
    }
    pooled = { sd: Math.sqrt(ss / df), df }
  }

  const rows = groups.map(([ga, gb]): MultipleTRow => {
    if (typeof ga === 'string' || typeof gb === 'string')
      return skipped('summary-data', count(ga), count(gb))
    const [nA, nB] = [ga.s.n, gb.s.n]
    if (notPositive(ga, gb)) return skipped('not-positive', nA, nB)
    const leftOut = ga.leftOut + gb.leftOut
    const minN = method === 'welch' ? 2 : 1
    if (nA < minN || nB < minN || nA + nB < 3) {
      if (!(method === 'pooled' && nA >= 1 && nB >= 1)) return skipped('too-few-values', nA, nB)
    }
    const r =
      ga.raw && gb.raw
        ? tTestUnpaired(ga.raw, gb.raw, { equalVariance: method !== 'welch' })
        : tTestFromSummary(ga.s, gb.s, { equalVariance: method !== 'welch' })
    let { seDiff: se, t, df, p } = r
    if (method === 'pooled') {
      se = pooled!.sd * Math.sqrt(1 / nA + 1 / nB)
      df = pooled!.df
      t = r.diff / se
      p = df > 0 ? tPValue(t, df, 'two-sided') : Number.NaN
    }
    if (!(se > 0) || !(df > 0)) return skipped('no-variation', nA, nB)
    const center = (s: SummaryStats) => (lognormal ? 10 ** s.mean : s.mean)
    return {
      nA,
      nB,
      centerA: center(ga.s),
      centerB: center(gb.s),
      diff: r.diff,
      se,
      stat: t,
      df,
      p,
      ...(lognormal ? { ratio: 10 ** r.diff } : {}),
      ...(leftOut ? { leftOut } : {}),
    }
  })
  return { rows, ...(pooled ? { pooled } : {}) }
}
