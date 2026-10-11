/**
 * Estimated survival curves from a Cox model: the baseline cumulative survival is that
 * of an individual whose predictors are all zero, the product of one α per event time; the
 * curve for predictors x is S₀(t)^exp(x·β); the baseline cumulative hazard is −ln S₀(t).
 *
 * α is the Kalbfleisch–Prentice product-limit factor (Kalbfleisch & Prentice 2002, §4.3; R's
 * survfit.coxph(stype = 1)): with risk scores rᵢ = exp(xᵢ·β), D the subjects with the event at
 * time t and R those at risk, α solves Σ_D rᵢ / (1 − α^{rᵢ}) = Σ_R rⱼ; with one event
 * α = (1 − rᵢ/Σ_R r)^{1/rᵢ}. It is 1 at times with only censoring (those times are not listed),
 * and 0 when everyone at risk has the event. Ties are solved in u = ln α by safeguarded Newton
 * to machine precision.
 */
export interface CoxBaseline {
  /** Distinct event times, ascending. */
  time: number[]
  atRisk: number[]
  events: number[]
  alpha: number[]
  /** Baseline cumulative survival S₀(t) (all predictors 0). */
  survival: number[]
  /** −ln S₀(t). */
  cumHazard: number[]
}

function solveAlpha(rD: readonly number[], sumR: number): number {
  const sumD = rD.reduce((s, v) => s + v, 0)
  if (sumD >= sumR * (1 - 1e-15)) return 0
  if (rD.length === 1) {
    const r = rD[0]!
    return Math.exp(Math.log1p(-r / sumR) / r)
  }
  // g(u) = Σ r/(1 − e^{r u}) − ΣR, increasing in u < 0 from ΣD − ΣR (u → −∞) to +∞ (u → 0).
  const g = (u: number) => {
    let s = 0
    for (const r of rD) s += r / -Math.expm1(r * u)
    return s - sumR
  }
  const dg = (u: number) => {
    let s = 0
    for (const r of rD) {
      const e = Math.exp(r * u)
      const den = -Math.expm1(r * u)
      s += (r * r * e) / (den * den)
    }
    return s
  }
  // Bracket: start from the single-event approximation with the total score.
  let hi = 0
  let lo = Math.log1p(-sumD / sumR) / (sumD / rD.length)
  while (g(lo) > 0) lo *= 2
  let u = lo
  for (let it = 0; it < 200; it++) {
    const gu = g(u)
    if (gu === 0) break
    if (gu < 0) lo = u
    else hi = u
    let next = u - gu / dg(u)
    if (!(next > lo && next < hi)) next = (lo + hi) / 2
    if (Math.abs(next - u) <= 1e-16 * Math.abs(u)) {
      u = next
      break
    }
    u = next
  }
  return Math.exp(u)
}

export function coxBaseline(
  time: readonly number[],
  event: readonly boolean[],
  X: readonly (readonly number[])[],
  beta: readonly number[],
): CoxBaseline {
  const n = time.length
  const r = X.map((row) => {
    let s = 0
    row.forEach((v, j) => {
      const b = beta[j]!
      if (Number.isFinite(b)) s += v * b
    })
    return Math.exp(s)
  })
  const times = [...new Set(time.filter((_, i) => event[i]))].sort((a, b) => a - b)
  const out: CoxBaseline = {
    time: [],
    atRisk: [],
    events: [],
    alpha: [],
    survival: [],
    cumHazard: [],
  }
  let S = 1
  for (const t of times) {
    let sumR = 0
    let nRisk = 0
    const rD: number[] = []
    for (let i = 0; i < n; i++) {
      if (time[i]! >= t) {
        sumR += r[i]!
        nRisk++
        if (time[i] === t && event[i]) rD.push(r[i]!)
      }
    }
    const a = solveAlpha(rD, sumR)
    S *= a
    out.time.push(t)
    out.atRisk.push(nRisk)
    out.events.push(rD.length)
    out.alpha.push(a)
    out.survival.push(S)
    out.cumHazard.push(-Math.log(S))
  }
  return out
}

/** S(t | x) = S₀(t)^exp(x·β) at the baseline's event times (aliased NaN coefficients count 0). */
export function coxSurvivalAt(
  base: CoxBaseline,
  beta: readonly number[],
  x: readonly number[],
): number[] {
  let xb = 0
  x.forEach((v, j) => {
    const b = beta[j]!
    if (Number.isFinite(b)) xb += v * b
  })
  const e = Math.exp(xb)
  return base.survival.map((s) => s ** e)
}
