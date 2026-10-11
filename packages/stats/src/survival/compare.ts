import { chiSqSf } from '../dist/chisq.ts'
import { normalQuantile } from '../dist/normal.ts'
import { checkSubjects, kaplanMeier, type SurvivalSubject } from './kaplanMeier.ts'

export interface SurvivalTest {
  chiSq: number
  df: number
  p: number
}

/** A ratio with its confidence interval. */
export interface HazardRatio {
  value: number
  lower: number
  upper: number
}

export interface SurvivalComparison {
  /** Log-rank (Mantel–Cox) test, R's survdiff(rho = 0). */
  logRank: SurvivalTest
  /** Gehan–Breslow–Wilcoxon: the same test with weights = number at risk. */
  gehanBreslowWilcoxon: SurvivalTest
  /** ≥ 3 groups only: log-rank test for trend with scores 1..k in group order (df 1). */
  logRankTrend: SurvivalTest | null
  /** 2 groups only: hazard ratio of group 2 vs group 1 (the reciprocal is group 1 vs 2). */
  hazardRatio: { mantelHaenszel: HazardRatio; logRank: HazardRatio } | null
  /** 2 groups only: median 2 / median 1; null when a median is undefined or 0. */
  medianRatio: HazardRatio | null
  /** Observed events per group. */
  observed: number[]
  /** Expected events per group under H0 (log-rank). */
  expected: number[]
}

/**
 * Compares survival curves (the "Survival" analysis).
 *
 * At each distinct event time t, with nⱼ at risk and dⱼ events in group j (N, D in total),
 * a weighted log-rank statistic has
 *   Uⱼ = Σ_t w_t (dⱼ − D nⱼ/N),
 *   Vⱼₖ = Σ_t w_t² D (N − D)/(N − 1) · (nⱼ/N)(δⱼₖ − nₖ/N)
 * and chi-square U'V⁻¹U over the groups with a positive expected count, less one
 * (df = that number − 1), as R's survdiff (the "match SAS and SPSS" method, the default
 * for ≥ 3 groups).
 * - Log-rank (Mantel–Cox): w = 1.
 * - Gehan–Breslow–Wilcoxon: w = N (Gehan's generalized Wilcoxon, Breslow's k-sample form;
 *   SAS LIFETEST's "Wilcoxon" test).
 * - Log-rank for trend: (Σ cⱼUⱼ)² / (c'Vc) with w = 1 and cⱼ = 1..k (the column order as
 *   equally spaced scores); the "match SAS/SPSS" form with the full covariance.
 * - Hazard ratio, group 2 vs group 1, both (Machin, Cheung & Parmar
 *   2006, ch. 3): Mantel–Haenszel L = (O₂ − E₂)/V, HR = e^L, CI e^(L ± z/√V), V the log-rank
 *   variance; log-rank HR = (O₂/E₂)/(O₁/E₁), CI e^(ln HR ± z√(1/E₁ + 1/E₂)).
 * - Median ratio: M₂/M₁ with CI e^(ln ratio ± z√(1/O₁ + 1/O₂)), which assumes
 *   exponential survival.
 *
 * Degenerate input does not throw: fewer than two groups with expected events give NaN
 * statistics (df = the number of such groups − 1, at least 0); empty groups are allowed.
 */
export function compareSurvival(
  groups: readonly (readonly SurvivalSubject[])[],
  opts: { confLevel?: number } = {},
): SurvivalComparison {
  groups.forEach((g, j) => {
    checkSubjects(g, `compareSurvival: group ${j + 1}`)
  })
  const conf = opts.confLevel ?? 0.95
  const z = normalQuantile(1 - (1 - conf) / 2)
  const k = groups.length

  // All subjects, sorted by time, tagged with their group.
  const all: { time: number; event: boolean; g: number }[] = []
  groups.forEach((g, j) => {
    for (const s of g) all.push({ time: s.time, event: s.event, g: j })
  })
  all.sort((a, b) => a.time - b.time)
  const atRisk = groups.map((g) => g.length)

  const observed = new Array<number>(k).fill(0)
  const expected = new Array<number>(k).fill(0)
  const U1 = new Array<number>(k).fill(0)
  const Uw = new Array<number>(k).fill(0)
  const V1 = Array.from({ length: k }, () => new Array<number>(k).fill(0))
  const Vw = Array.from({ length: k }, () => new Array<number>(k).fill(0))
  const d = new Array<number>(k)
  let i = 0
  while (i < all.length) {
    const t = all[i]!.time
    d.fill(0)
    let D = 0
    let j0 = i
    for (; j0 < all.length && all[j0]!.time === t; j0++) {
      if (all[j0]!.event) {
        d[all[j0]!.g]!++
        D++
      }
    }
    const N = all.length - i
    if (D > 0) {
      const f = N > 1 ? (D * (N - D)) / (N - 1) : 0
      for (let a = 0; a < k; a++) {
        const e = (D * atRisk[a]!) / N
        observed[a]! += d[a]!
        expected[a]! += e
        U1[a]! += d[a]! - e
        Uw[a]! += N * (d[a]! - e)
        const pa = atRisk[a]! / N
        for (let b = 0; b < k; b++) {
          const v = f * pa * ((a === b ? 1 : 0) - atRisk[b]! / N)
          V1[a]![b]! += v
          Vw[a]![b]! += N * N * v
        }
      }
    }
    for (; i < j0; i++) atRisk[all[i]!.g]!--
  }

  const keep = expected.map((e, j) => (e > 0 ? j : -1)).filter((j) => j >= 0)
  const logRank = quadTest(U1, V1, keep)
  const gehanBreslowWilcoxon = quadTest(Uw, Vw, keep)

  let logRankTrend: SurvivalTest | null = null
  if (k >= 3) {
    let num = 0
    let den = 0
    for (let a = 0; a < k; a++) {
      num += (a + 1) * U1[a]!
      for (let b = 0; b < k; b++) den += (a + 1) * (b + 1) * V1[a]![b]!
    }
    const chiSq = den > 0 ? (num * num) / den : Number.NaN
    logRankTrend = { chiSq, df: 1, p: chiSqSf(chiSq, 1) }
  }

  let hazardRatio: SurvivalComparison['hazardRatio'] = null
  let medianRatio: HazardRatio | null = null
  if (k === 2) {
    const [O1, O2] = observed as [number, number]
    const [E1, E2] = expected as [number, number]
    const V = V1[1]![1]!
    const L = (O2 - E2) / V
    const hMH = z / Math.sqrt(V)
    const hr = O2 / E2 / (O1 / E1)
    const hLR = z * Math.sqrt(1 / E1 + 1 / E2)
    hazardRatio = {
      mantelHaenszel: { value: Math.exp(L), lower: Math.exp(L - hMH), upper: Math.exp(L + hMH) },
      logRank: {
        value: hr,
        lower: Math.exp(Math.log(hr) - hLR),
        upper: Math.exp(Math.log(hr) + hLR),
      },
    }
    const m1 = kaplanMeier(groups[0]!).median.value
    const m2 = kaplanMeier(groups[1]!).median.value
    if (m1 > 0 && m2 > 0 && Number.isFinite(m1) && Number.isFinite(m2) && O1 > 0 && O2 > 0) {
      const r = m2 / m1
      const h = z * Math.sqrt(1 / O1 + 1 / O2)
      medianRatio = { value: r, lower: r * Math.exp(-h), upper: r * Math.exp(h) }
    }
  }

  return {
    logRank,
    gehanBreslowWilcoxon,
    logRankTrend,
    hazardRatio,
    medianRatio,
    observed,
    expected,
  }
}

/** U'V⁻¹U over the kept groups less the first (the full V is singular). */
function quadTest(U: number[], V: number[][], keep: number[]): SurvivalTest {
  const m = keep.length - 1
  if (m < 1) return { chiSq: Number.NaN, df: Math.max(0, m), p: Number.NaN }
  const idx = keep.slice(1)
  const A = idx.map((a) => idx.map((b) => V[a]![b]!))
  const x = idx.map((a) => U[a]!)
  const sol = solve(A, x)
  let chiSq = 0
  for (let r = 0; r < m; r++) chiSq += x[r]! * sol[r]!
  return { chiSq, df: m, p: chiSqSf(chiSq, m) }
}

/** Solves A y = b by Gaussian elimination with partial pivoting; NaN if singular. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, r) => [...row, b[r]!])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r
    if (!(Math.abs(M[piv]![c]!) > 0)) return new Array<number>(n).fill(Number.NaN)
    ;[M[c], M[piv]] = [M[piv]!, M[c]!]
    for (let r = c + 1; r < n; r++) {
      const f = M[r]![c]! / M[c]![c]!
      for (let cc = c; cc <= n; cc++) M[r]![cc]! -= f * M[c]![cc]!
    }
  }
  const y = new Array<number>(n)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!
    for (let cc = r + 1; cc < n; cc++) s -= M[r]![cc]! * y[cc]!
    y[r] = s / M[r]![r]!
  }
  return y
}
