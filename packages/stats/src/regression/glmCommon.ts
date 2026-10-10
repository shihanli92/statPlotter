import { normalSf } from '../dist/normal.ts'
import { solveMonotone } from '../numint/roots.ts'
import type { RegCoefficient } from './multipleDesign.ts'

/**
 * Pieces shared by the maximum-likelihood regressions (logistic, Poisson, Cox): the Newton
 * ascent with step halving, profile-likelihood intervals and the Wald coefficient table.
 */

export interface NewtonAscent<S> {
  /** State (log-likelihood and whatever evaluate returns) at the final coefficients. */
  state: S
  /** Stopped at a small step, or where no step raises ℓ beyond rounding. */
  converged: boolean
  /** step returned null (a singular weighted problem or information matrix). */
  singular: boolean
  /** The `stop` hook ended the ascent. */
  stopped: boolean
  iterations: number
}

/**
 * Newton–Raphson ascent of a log-likelihood from `beta` (updated in place). Each iteration takes
 * the Newton step δ at the current state and halves it (at most maxHalvings times) until ℓ does
 * not fall beyond rounding (ℓ_trial ≥ ℓ − 1e-13|ℓ|); none such: converged (at the maximum to
 * working precision). The step is applied, and the ascent has converged when every
 * |δⱼ| < 1e-10·(1 + |βⱼ|) (so the final step is taken once more). `stop(gain, state)`, called
 * after each other accepted step, ends it early (separation, monotone likelihood).
 */
export function newtonAscent<S extends { ll: number }>(
  beta: Float64Array,
  start: S,
  step: (s: S) => Float64Array | null,
  evaluate: (b: Float64Array) => S,
  opts: { maxIter: number; maxHalvings: number; stop?: (gain: number, s: S) => boolean },
): NewtonAscent<S> {
  const k = beta.length
  const trial = new Float64Array(k)
  let state = start
  let converged = false
  let singular = false
  let stopped = false
  let iterations = 0
  for (let it = 0; it < opts.maxIter; it++) {
    iterations = it + 1
    const delta = step(state)
    if (!delta) {
      singular = true
      break
    }
    let small = true
    for (let j = 0; j < k; j++) {
      if (!(Math.abs(delta[j]!) < 1e-10 * (1 + Math.abs(beta[j]!)))) small = false
    }
    let scale = 1
    let next: S | null = null
    for (let h = 0; h < opts.maxHalvings; h++) {
      for (let j = 0; j < k; j++) trial[j] = beta[j]! + scale * delta[j]!
      const e = evaluate(trial)
      // Accept any step that does not lower ℓ beyond rounding.
      if (e.ll >= state.ll - 1e-13 * Math.abs(state.ll)) {
        next = e
        break
      }
      scale /= 2
    }
    if (!next) {
      // No ascent possible: at the maximum to working precision.
      converged = true
      break
    }
    const gain = next.ll - state.ll
    beta.set(trial)
    state = next
    if (small) {
      converged = true
      break
    }
    if (opts.stop?.(gain, state)) {
      stopped = true
      break
    }
  }
  return { state, converged, singular, stopped, iterations }
}

/**
 * The profile log-likelihood of coefficient j at b, from a refit of the other columns with
 * b·x_j as an offset (`fit` returns the refit's maximum), started at the other estimates.
 */
export function profileByOffset(
  cols: readonly Float64Array[],
  beta: Float64Array,
  fit: (others: Float64Array[], offset: Float64Array, init: Float64Array) => number,
): (j: number, b: number) => number {
  return (j, b) => {
    const others = cols.filter((_, c) => c !== j)
    const xj = cols[j]!
    const off = new Float64Array(xj.length)
    for (let i = 0; i < xj.length; i++) off[i] = b * xj[i]!
    const init = Float64Array.from(Array.from(beta).filter((_, c) => c !== j))
    return fit(others, off, init)
  }
}

/**
 * Profile-likelihood interval of coefficient j (Venzon & Moolgavkar 1988): the β_j where the
 * signed root r(b) = sign(b − β̂_j)·√(2(ℓ̂ − ℓ_j(b))) equals ∓z, ℓ_j(b) being the log-likelihood
 * maximised over the other coefficients with β_j fixed at b. r is monotone, so each end is found
 * by bracketing from the Wald end and Illinois regula falsi. An end the profile never reaches
 * is ±∞.
 */
export function profileInterval(
  j: number,
  bhat: number,
  se: number,
  z: number,
  llHat: number,
  profile: (j: number, b: number) => number,
): [number, number] {
  const r = (b: number): number => {
    const d = 2 * (llHat - profile(j, b))
    return Math.sign(b - bhat) * Math.sqrt(Math.max(0, d))
  }
  const step = Number.isFinite(se) && se > 0 ? se : 1
  const lo = solveMonotone((b) => r(b) + z, bhat - z * step, step / 2, 1e-13)
  const hi = solveMonotone((b) => r(b) - z, bhat + z * step, step / 2, 1e-13)
  return [Number.isNaN(lo) ? -Infinity : lo, Number.isNaN(hi) ? Infinity : hi]
}

/**
 * Coefficient rows in design order: Wald z = β/SE with two-sided normal P, CI Wald (β ± z·SE)
 * or profile likelihood; NaN rows for aliased columns (keep[j] false), or for all when the fit
 * is not usable. beta and cov (k×k) are over the kept columns.
 */
export function glmCoefficients(
  names: readonly string[],
  keep: readonly boolean[],
  usable: boolean,
  beta: Float64Array,
  cov: ArrayLike<number>,
  z: number,
  ci: { method: 'wald' | 'profile'; ll: number; profile: (j: number, b: number) => number },
): RegCoefficient[] {
  const k = beta.length
  const nan = Number.NaN
  const out: RegCoefficient[] = []
  let a = 0
  for (let j = 0; j < names.length; j++) {
    const name = names[j]!
    if (!keep[j] || !usable) {
      out.push({ name, estimate: nan, se: nan, lower: nan, upper: nan, stat: nan, p: nan })
      if (keep[j]) a++
      continue
    }
    const b = beta[a]!
    const se = Math.sqrt(cov[a * k + a]!)
    const zv = b / se
    const [lower, upper] =
      ci.method === 'profile'
        ? profileInterval(a, b, se, z, ci.ll, ci.profile)
        : [b - z * se, b + z * se]
    out.push({ name, estimate: b, se, lower, upper, stat: zv, p: 2 * normalSf(Math.abs(zv)) })
    a++
  }
  return out
}
