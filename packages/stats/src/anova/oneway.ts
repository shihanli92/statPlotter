import { shifted } from '../arrays.ts'
import { median } from '../descriptive/quantile.ts'
import { chiSqSf } from '../dist/chisq.ts'
import { fSf } from '../dist/f.ts'
import { pooledRanks } from '../tests/ranks.ts'
import {
  centredStats,
  commonShift,
  type GroupData,
  type GroupStats,
  groupStats,
  roundedSS,
  weightedGrandMean,
  withinSS,
} from './groups.ts'

/**
 * One-way ANOVA and its companions (Welch and Brown–Forsythe ANOVA, Bartlett's and the
 * Brown–Forsythe tests for equal SDs, Kruskal–Wallis).
 *
 * Groups with n = 0 are reported (with NaN mean/SD) but take no part in the tests: they add no
 * degrees of freedom.
 */

export interface OneWayResult {
  groups: GroupStats[]
  ssBetween: number
  ssWithin: number
  ssTotal: number
  dfBetween: number
  dfWithin: number
  msBetween: number
  msWithin: number
  F: number
  p: number
  /** R² = SS_between / SS_total (η²). */
  r2: number
  /** Bartlett's test for equal variances; null unless every group has n ≥ 2 and SD > 0. */
  bartlett: { chi2: number; df: number; p: number } | null
  /**
   * Brown–Forsythe test for equal SDs: ANOVA of |x − group median| (Levene's test centred at the
   * median, as car::leveneTest(center = median)). Raw data only; null for summary input.
   */
  brownForsythe: FTest | null
}

export interface FTest {
  F: number
  dfn: number
  dfd: number
  p: number
}

function nonEmpty(stats: readonly GroupStats[]): GroupStats[] {
  return stats.filter((g) => g.n > 0)
}

/** Ordinary one-way ANOVA (pooled variance). */
export function oneWayAnova(groups: readonly GroupData[]): OneWayResult {
  const stats = groups.map(groupStats)
  const used = nonEmpty(centredStats(groups))
  const core = anovaCore(used)
  const raw = groups.every((g) => 'values' in g)
  return {
    groups: stats,
    ...core,
    bartlett: bartlett(used),
    brownForsythe: raw ? levene(groups as { values: ArrayLike<number> }[]) : null,
  }
}

type Core = Omit<OneWayResult, 'groups' | 'bartlett' | 'brownForsythe'>

function anovaCore(used: readonly GroupStats[]): Core {
  const k = used.length
  const N = used.reduce((s, g) => s + g.n, 0)
  const grand = weightedGrandMean(used)
  let ssBetween = 0
  let ssWithin = 0
  for (const g of used) {
    ssBetween += g.n * (g.mean - grand) ** 2
    ssWithin += withinSS(g)
  }
  const ssTotal = ssBetween + ssWithin
  ssBetween = roundedSS(ssBetween, ssTotal)
  ssWithin = roundedSS(ssWithin, ssTotal)
  const dfBetween = k - 1
  const dfWithin = N - k
  const msBetween = ssBetween / dfBetween
  const msWithin = ssWithin / dfWithin
  const F = msBetween / msWithin
  return {
    ssBetween,
    ssWithin,
    ssTotal,
    dfBetween,
    dfWithin,
    msBetween,
    msWithin,
    F,
    p: fSf(F, dfBetween, dfWithin),
    r2: ssBetween / ssTotal,
  }
}

/**
 * Bartlett (1937): χ² = [(N − k) ln s_p² − Σ (n_i − 1) ln s_i²] / C,
 * C = 1 + (Σ 1/(n_i − 1) − 1/(N − k)) / (3(k − 1)), df k − 1 (as R's bartlett.test).
 */
function bartlett(used: readonly GroupStats[]): OneWayResult['bartlett'] {
  const k = used.length
  if (k < 2 || used.some((g) => !(g.n >= 2) || !(g.sd > 0) || !Number.isFinite(g.sd))) return null
  let N = 0
  let ss = 0
  let sumLog = 0
  let sumInv = 0
  for (const g of used) {
    N += g.n
    ss += withinSS(g)
    sumLog += (g.n - 1) * Math.log(g.sd * g.sd)
    sumInv += 1 / (g.n - 1)
  }
  const dfw = N - k
  const chi2 = (dfw * Math.log(ss / dfw) - sumLog) / (1 + (sumInv - 1 / dfw) / (3 * (k - 1)))
  return { chi2, df: k - 1, p: chiSqSf(chi2, k - 1) }
}

/** ANOVA F on |x − median| (Brown & Forsythe 1974a, JASA 69, 364–367). */
function levene(groups: readonly { values: ArrayLike<number> }[]): FTest | null {
  const used = groups.filter((g) => g.values.length > 0)
  if (used.length < 2) return null
  const c = commonShift(used) // exact shift, so medians of offset data stay accurate
  const dev = used.map((g) => {
    const x = shifted(g.values, c)
    const med = median(x)
    return groupStats({ values: x.map((v) => Math.abs(v - med)) })
  })
  const a = anovaCore(dev)
  if (!(a.dfWithin > 0)) return null
  return { F: a.F, dfn: a.dfBetween, dfd: a.dfWithin, p: a.p }
}

/**
 * Welch's (1951) heteroscedastic ANOVA, as R's oneway.test(var.equal = FALSE):
 * w_i = n_i/s_i², m′ = Σw_i m_i / Σw_i, λ = Σ(1 − w_i/W)²/(n_i − 1),
 * F = [Σ w_i (m_i − m′)² / (k − 1)] / [1 + 2(k − 2)λ/(k² − 1)], df (k − 1, (k² − 1)/(3λ)).
 * Needs n ≥ 2 and SD > 0 in every group (NaN otherwise).
 */
export function welchAnova(groups: readonly GroupData[]): FTest {
  const used = nonEmpty(centredStats(groups))
  const k = used.length
  const w = used.map((g) => g.n / (g.sd * g.sd))
  const W = w.reduce((s, x) => s + x, 0)
  const c = used[0]?.mean ?? Number.NaN
  let mw = 0
  used.forEach((g, i) => {
    mw += w[i]! * (g.mean - c)
  })
  mw = c + mw / W
  let a = 0
  let lam = 0
  used.forEach((g, i) => {
    a += w[i]! * (g.mean - mw) ** 2
    lam += (1 - w[i]! / W) ** 2 / (g.n - 1)
  })
  const F = a / (k - 1) / (1 + (2 * (k - 2) * lam) / (k * k - 1))
  const dfn = k - 1
  const dfd = (k * k - 1) / (3 * lam)
  const ok = used.every((g) => g.n >= 2 && g.sd > 0) && k >= 2
  if (!ok) return { F: Number.NaN, dfn, dfd: Number.NaN, p: Number.NaN }
  return { F, dfn, dfd, p: fSf(F, dfn, dfd) }
}

/**
 * Brown & Forsythe's (1974b, Technometrics 16, 129–132) ANOVA of means for unequal variances:
 * F* = Σ n_i (m_i − m)² / Σ (1 − n_i/N) s_i², df (k − 1, f) with Satterthwaite's
 * f = 1 / Σ c_i²/(n_i − 1), c_i = (1 − n_i/N) s_i² / Σ_j (1 − n_j/N) s_j².
 * (The original numerator df k − 1, not Mehrotra's 1997 modification.)
 */
export function brownForsytheAnova(groups: readonly GroupData[]): FTest {
  const used = nonEmpty(centredStats(groups))
  const k = used.length
  const N = used.reduce((s, g) => s + g.n, 0)
  const grand = weightedGrandMean(used)
  let num = 0
  let den = 0
  for (const g of used) {
    num += g.n * (g.mean - grand) ** 2
    den += (1 - g.n / N) * g.sd * g.sd
  }
  let inv = 0
  for (const g of used) {
    const c = ((1 - g.n / N) * g.sd * g.sd) / den
    inv += (c * c) / (g.n - 1)
  }
  const F = num / den
  const dfn = k - 1
  const dfd = 1 / inv
  const ok = used.every((g) => g.n >= 2) && k >= 2 && den > 0
  if (!ok) return { F: ok ? F : Number.NaN, dfn, dfd: Number.NaN, p: Number.NaN }
  return { F, dfn, dfd, p: fSf(F, dfn, dfd) }
}

export interface KruskalWallisResult {
  /** Tie-corrected H. */
  H: number
  df: number
  /** Chi-square approximation (as R's kruskal.test). */
  p: number
  /** Mean rank of each group in the pooled ranking (NaN for an empty group). */
  meanRanks: number[]
  n: number[]
}

/**
 * Kruskal–Wallis test with the tie correction, in the equivalent form
 * H = (N − 1) Σ n_i (R̄_i − R̄)² / Σ (r − R̄)², R̄ = (N + 1)/2 (Kruskal & Wallis 1952, eq. 1.1 with
 * the correction of §1.3), which equals R's [12/(N(N+1)) Σ R_i²/n_i − 3(N + 1)] / (1 − Σ(t³ − t)/(N³ − N)).
 * P from χ²(k − 1).
 */
export function kruskalWallis(groups: readonly ArrayLike<number>[]): KruskalWallisResult {
  const { n, N, ranks, meanRanks } = pooledRanks(groups)
  const rbar = (N + 1) / 2
  let between = 0
  meanRanks.forEach((m, g) => {
    if (n[g]! > 0) between += n[g]! * (m - rbar) ** 2
  })
  let total = 0
  for (let i = 0; i < N; i++) total += (ranks[i]! - rbar) ** 2
  const H = ((N - 1) * between) / total
  const df = n.filter((x) => x > 0).length - 1
  return { H, df, p: chiSqSf(H, df), meanRanks, n }
}
