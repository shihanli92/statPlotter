import { betaQuantile } from '../dist/betaGammaQuantile.ts'
import { normalCdf, normalQuantile } from '../dist/normal.ts'
import { tQuantile } from '../dist/t.ts'
import { noncentralTCdf } from '../gpl/noncentralT.ts'
import { illinois } from '../numint/roots.ts'
import { ibeta } from '../special/beta.ts'
import { lgamma } from '../special/gamma.ts'

/**
 * Power and sample size of common designs ("Sample size and power"; formulas as R's
 * power.t.test, power.anova.test and power.prop.test, and the usual closed forms for a
 * correlation and the log-rank test). Every power function is increasing in n, so the sample
 * size for a target power is the root of power(n) − target, found to ~1e−12 (a fractional n;
 * the analysis reports it rounded up).
 *
 * - t tests (unpaired: n per group, df 2(n − 1), ncp √(n/2)·δ/σ; paired / one sample: n pairs,
 *   df n − 1, ncp √n·δ/σ): power = P(T > t_crit) + P(T < −t_crit) two-sided (R's strict = TRUE),
 *   P(T > t_crit) one-sided, T noncentral t (R's pnt).
 * - One-way ANOVA (k groups of n): λ = (k − 1)·n·σ²_between/σ²_within with σ²_between the
 *   variance (n − 1 divisor) of the group means (power.anova.test), power = P(F′ > F_crit) for
 *   F′ ~ F(k − 1, k(n − 1), λ), by the Poisson mixture of incomplete beta upper tails summed to
 *   machine precision.
 * - Two proportions (n per group): power.prop.test's normal approximation
 *   Φ((√n·|p₁ − p₂| − z_{α/s}·√((p₁ + p₂)(1 − (p₁ + p₂)/2))) / √(p₁q₁ + p₂q₂)), s = sides.
 * - Correlation: Fisher's z, power = Φ(√(n − 3)·|atanh ρ| − z) (+ the other tail when
 *   two-sided).
 * - Log-rank (Schoenfeld 1981, equal allocation): with d events, power =
 *   Φ(√(d/4)·|ln HR| − z) (+ other tail); subjects = events / P(event).
 */

export type Tails = 1 | 2

function oneSided(alpha: number, tails: Tails): number {
  return normalQuantile(1 - alpha / tails)
}

/** t tests: 'two' (unpaired, n per group), 'paired' and 'one' (n pairs / values). */
export function powerT(
  n: number,
  delta: number,
  sd: number,
  alpha: number,
  kind: 'two' | 'paired' | 'one',
  tails: Tails = 2,
): number {
  const ts = kind === 'two' ? 2 : 1
  const nu = (n - 1) * ts
  if (!(nu > 0)) return Number.NaN
  const ncp = (Math.sqrt(n / ts) * Math.abs(delta)) / sd
  const qu = tQuantile(1 - alpha / tails, nu)
  const upper = noncentralTCdf(qu, nu, ncp, false)
  return tails === 2 ? upper + noncentralTCdf(-qu, nu, ncp, true) : upper
}

/** P(F′ > x) for F′ ~ F(d1, d2, λ): Σ_j Pois(j; λ/2)·(1 − I_z(d1/2 + j, d2/2)). */
function noncentralFSf(x: number, d1: number, d2: number, lambda: number): number {
  if (!(x > 0)) return 1
  const u = d1 * x
  const z = u / (u + d2)
  const w = d2 / (u + d2)
  const c = lambda / 2
  if (c === 0) return ibeta(z, w, d1 / 2, d2 / 2)[1]
  // Sum outward from the Poisson mode so large λ needs no underflowing start.
  const j0 = Math.floor(c)
  const logw = (j: number) => -c + j * Math.log(c) - lgamma(j + 1)
  let sum = 0
  let mass = 0
  for (let j = j0; ; j++) {
    const pw = Math.exp(logw(j))
    sum += pw * ibeta(z, w, d1 / 2 + j, d2 / 2)[1]
    mass += pw
    if (pw < 1e-18 * mass && j > c) break
  }
  for (let j = j0 - 1; j >= 0; j--) {
    const pw = Math.exp(logw(j))
    sum += pw * ibeta(z, w, d1 / 2 + j, d2 / 2)[1]
    mass += pw
    if (pw < 1e-18 * mass) break
  }
  return sum
}

/** Upper-α critical value of F(d1, d2), from the Beta(d1/2, d2/2) quantile. */
function fCritical(alpha: number, d1: number, d2: number): number {
  const b = betaQuantile(alpha, d1 / 2, d2 / 2, false)
  return (d2 / d1) * (b / (1 - b))
}

/** One-way ANOVA with k groups of n: power.anova.test. */
export function powerAnova(
  n: number,
  groups: number,
  betweenVar: number,
  withinVar: number,
  alpha: number,
): number {
  const d1 = groups - 1
  const d2 = (n - 1) * groups
  if (!(d2 > 0)) return Number.NaN
  const lambda = d1 * n * (betweenVar / withinVar)
  return noncentralFSf(fCritical(alpha, d1, d2), d1, d2, lambda)
}

/** Two proportions, n per group: power.prop.test (normal approximation). */
export function powerProportions(
  n: number,
  p1: number,
  p2: number,
  alpha: number,
  tails: Tails = 2,
): number {
  const z = oneSided(alpha, tails)
  const num = Math.sqrt(n * (p1 - p2) ** 2) - z * Math.sqrt((p1 + p2) * (1 - (p1 + p2) / 2))
  return normalCdf(num / Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)))
}

/** Correlation ρ ≠ 0 with n pairs (Fisher's z). */
export function powerCorrelation(n: number, rho: number, alpha: number, tails: Tails = 2): number {
  if (!(n > 3)) return Number.NaN
  const z = oneSided(alpha, tails)
  const e = Math.sqrt(n - 3) * Math.abs(Math.atanh(rho))
  return normalCdf(e - z) + (tails === 2 ? normalCdf(-e - z) : 0)
}

/** Log-rank test with `events` events, equal allocation (Schoenfeld). */
export function powerLogRank(
  events: number,
  hazardRatio: number,
  alpha: number,
  tails: Tails = 2,
): number {
  const z = oneSided(alpha, tails)
  const e = Math.sqrt(events / 4) * Math.abs(Math.log(hazardRatio))
  return normalCdf(e - z) + (tails === 2 ? normalCdf(-e - z) : 0)
}

/**
 * The (fractional) sample size at which an increasing power function reaches `target`: bracketed
 * from `lo` by doubling the upper end until the target is passed, then solved on that bracket by
 * Illinois regula falsi on n (bisection when a step leaves the bracket).
 * NaN if the target is unreachable (power stays below it up to 1e9).
 */
export function solveSampleSize(power: (n: number) => number, target: number, lo = 2): number {
  const g = (n: number) => power(n) - target
  let a = lo
  if (!(g(a) < 0)) return a
  let b = Math.max(2 * a, a + 1)
  while (g(b) < 0) {
    a = b
    b *= 2
    if (b > 1e9) return Number.NaN
  }
  // Illinois regula falsi on [a, b] (g(a) < 0).
  return illinois(g, a, g(a), b, g(b), {
    maxIter: 300,
    accept: (_, a, b) => b - a <= 1e-13 * b,
  })
}
