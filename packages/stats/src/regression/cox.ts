import { shifted } from '../arrays.ts'
import { chiSqSf } from '../dist/chisq.ts'
import { normalQuantile } from '../dist/normal.ts'
import { bilinear } from '../linalg/forms.ts'
import { symmetricInverse } from '../linalg/leastSquares.ts'
import { sum } from '../summation.ts'
import { glmCoefficients, newtonAscent, profileByOffset } from './glmCommon.ts'
import { buildDesign, expandCov, keptColumns, type RegCoefficient } from './multipleDesign.ts'

export interface CoxOptions {
  /** Tied event times: Efron's approximation (default) or Breslow's. */
  ties?: 'efron' | 'breslow'
  /** Default 0.95. */
  confLevel?: number
  /** CIs of coefficients and hazard ratios: profile likelihood (default, as Prism) or Wald. */
  ciMethod?: 'wald' | 'profile'
  /** Two-way interaction products X_i·X_j (predictor indices), named 'A:B'. */
  interactions?: readonly (readonly [number, number])[]
}

export interface CoxTest {
  chiSq: number
  df: number
  p: number
}

export interface CoxResult {
  /** stat = Wald z; CIs per `ciMethod`; hazard-ratio limits are the exponentiated limits. */
  coefficients: (RegCoefficient & { hazardRatio: number; hrLower: number; hrUpper: number })[]
  n: number
  nEvents: number
  /** Partial log-likelihood at the estimates. */
  logLik: number
  /** Partial log-likelihood at β = 0. */
  nullLogLik: number
  lrTest: CoxTest
  /** β̂ᵀ I(β̂) β̂. */
  waldTest: CoxTest
  /** U(0)ᵀ I(0)⁻¹ U(0), with the same tie handling. */
  scoreTest: CoxTest
  /** Harrell's C (pairs tied on the risk score count ½; pairs tied on an event time excluded). */
  concordance: number | null
  /** −2LL + 2k. */
  aic: number
  /** Inverse information (design order); NaN rows/columns for aliased terms. */
  covariance: number[][]
  iterations: number
  confLevel: number
  ciMethod: 'wald' | 'profile'
  ties: 'efron' | 'breslow'
  status: 'ok' | 'notConverged' | 'singular' | 'infinite'
}

const NaN_ = Number.NaN
const MAX_ITER = 100
const NAN_TEST: CoxTest = { chiSq: NaN_, df: NaN_, p: NaN_ }

interface Data {
  n: number
  /** Subjects sorted by time descending (events before censored at a tie, which is immaterial). */
  order: Int32Array
  time: Float64Array
  event: Uint8Array
}

interface Eval {
  ll: number
  /** Score vector U (length k). */
  u: Float64Array
  /** Information −∂²ℓ, row-major k×k. */
  info: Float64Array
}

/**
 * Partial log-likelihood, score and information (Cox 1972; Breslow 1974; Efron 1977; formulas as
 * in Therneau & Grambsch, Modeling Survival Data, 2000, §3.3). With d tied events at a time,
 * Efron's denominator for the r-th (r = 0 … d − 1) is S₀ − (r/d)·S₀ᴰ, S₀ᴰ summing over the tied
 * events only; Breslow's is S₀ for all d. Subjects are accumulated into the risk set from the
 * longest time down. `cols` are centred covariates; `offset` (for the profile likelihood) is added
 * to the linear predictor.
 */
function evaluate(
  d: Data,
  cols: readonly Float64Array[],
  beta: ArrayLike<number>,
  offset: Float64Array | null,
  efron: boolean,
): Eval {
  const k = cols.length
  const { n, order, time, event } = d
  const eta = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = offset ? offset[i]! : 0
    for (let j = 0; j < k; j++) s += cols[j]![i]! * beta[j]!
    eta[i] = s
  }
  // Scale exp(η) by exp(−max η) against overflow; ℓ is corrected below.
  let etaMax = Number.NEGATIVE_INFINITY
  for (let i = 0; i < n; i++) etaMax = Math.max(etaMax, eta[i]!)
  if (!Number.isFinite(etaMax)) etaMax = 0
  const llTerms: number[] = []
  const u = new Float64Array(k)
  const info = new Float64Array(k * k)
  let s0 = 0
  const s1 = new Float64Array(k)
  const s2 = new Float64Array(k * k)
  const d1 = new Float64Array(k)
  const d2 = new Float64Array(k * k)
  const a = new Float64Array(k)
  let pos = 0
  while (pos < n) {
    const t = time[order[pos]!]!
    let end = pos
    while (end < n && time[order[end]!] === t) end++
    // Add everyone at time t to the risk set; collect the tied events.
    let nd = 0
    let d0 = 0
    d1.fill(0)
    d2.fill(0)
    for (let r = pos; r < end; r++) {
      const i = order[r]!
      const w = Math.exp(eta[i]! - etaMax)
      s0 += w
      for (let j = 0; j < k; j++) {
        const xj = cols[j]![i]!
        s1[j] = s1[j]! + w * xj
        for (let l = 0; l <= j; l++) s2[j * k + l] = s2[j * k + l]! + w * xj * cols[l]![i]!
      }
      if (event[i]) {
        nd++
        d0 += w
        llTerms.push(eta[i]!)
        for (let j = 0; j < k; j++) {
          const xj = cols[j]![i]!
          u[j] = u[j]! + xj
          d1[j] = d1[j]! + w * xj
          for (let l = 0; l <= j; l++) d2[j * k + l] = d2[j * k + l]! + w * xj * cols[l]![i]!
        }
      }
    }
    for (let r = 0; r < nd; r++) {
      const f = efron ? r / nd : 0
      const den = s0 - f * d0
      llTerms.push(-(Math.log(den) + etaMax))
      for (let j = 0; j < k; j++) {
        a[j] = (s1[j]! - f * d1[j]!) / den
        u[j] = u[j]! - a[j]!
      }
      for (let j = 0; j < k; j++) {
        for (let l = 0; l <= j; l++) {
          const v = (s2[j * k + l]! - f * d2[j * k + l]!) / den - a[j]! * a[l]!
          info[j * k + l] = info[j * k + l]! + v
        }
      }
    }
    pos = end
  }
  for (let j = 0; j < k; j++) for (let l = 0; l < j; l++) info[l * k + j] = info[j * k + l]!
  return { ll: sum(llTerms), u, info }
}

interface CoxFit {
  beta: Float64Array
  ev: Eval
  /** I(β̂)⁻¹ or null when singular. */
  cov: Float64Array | null
  converged: boolean
  infinite: boolean
  iterations: number
}

/**
 * Newton–Raphson from `init` with step halving when ℓ falls. Converged when every Newton step
 * component |δⱼ| < 1e-10·(1 + |βⱼ|) (the step is then applied once more). A coefficient whose
 * step stays large while ℓ has stopped increasing is diverging — monotone likelihood, the Cox
 * analogue of separation (Bryson & Johnson 1981) — and marks the fit infinite.
 */
function newton(
  d: Data,
  cols: readonly Float64Array[],
  offset: Float64Array | null,
  init: Float64Array | null,
  efron: boolean,
): CoxFit {
  const k = cols.length
  const beta = init ? Float64Array.from(init) : new Float64Array(k)
  let ev = evaluate(d, cols, beta, offset, efron)
  if (k === 0) {
    return { beta, ev, cov: new Float64Array(0), converged: true, infinite: false, iterations: 0 }
  }
  let flat = 0
  const r = newtonAscent(
    beta,
    ev,
    (e) => {
      const inv = symmetricInverse(e.info, k)
      if (!inv) return null
      const delta = new Float64Array(k)
      for (let j = 0; j < k; j++) {
        let s = 0
        for (let l = 0; l < k; l++) s += inv[j * k + l]! * e.u[l]!
        delta[j] = s
      }
      return delta
    },
    (b) => evaluate(d, cols, b, offset, efron),
    {
      maxIter: MAX_ITER,
      maxHalvings: 40,
      // ℓ flat to rounding for several steps while β still moves: diverging.
      stop: (gain, e) => {
        flat = gain <= 1e-12 * Math.max(1, Math.abs(e.ll)) ? flat + 1 : 0
        return flat >= 3
      },
    },
  )
  ev = r.state
  const { converged, iterations } = r
  // Still moving after MAX_ITER: diverging if ℓ has levelled off.
  const infinite = r.stopped || (!converged && iterations >= MAX_ITER)
  const cov = symmetricInverse(ev.info, k)
  return { beta, ev, cov, converged, infinite, iterations }
}

/**
 * Harrell's C: over pairs where the shorter time is an event (a censored time equal to an event
 * time counts as longer), the fraction where the shorter time has the larger risk score η, with
 * ties in η counted ½; pairs of events at the same time are not comparable. Same as
 * survival::concordance for a coxph fit.
 */
function harrellC(time: readonly number[], event: readonly boolean[], eta: Float64Array): number {
  const n = time.length
  let conc = 0
  let disc = 0
  let tied = 0
  for (let i = 0; i < n; i++) {
    if (!event[i]) continue
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      if (time[j]! > time[i]! || (time[j] === time[i] && !event[j])) {
        if (eta[i]! > eta[j]!) conc++
        else if (eta[i]! < eta[j]!) disc++
        else tied++
      }
    }
  }
  return (conc + tied / 2) / (conc + disc + tied)
}

/**
 * Cox proportional-hazards regression by maximum partial likelihood (Prism's "Cox proportional
 * hazards regression"). Coefficient P values are Wald z; CIs profile likelihood by default
 * (Prism) or Wald. The global tests are the partial likelihood ratio, Wald and score tests of
 * β = 0 (Prism's three "hypothesis tests"), as R's summary.coxph.
 *
 * Covariates are centred before fitting (the estimates are unchanged). Degenerate data never
 * throw: no events or aliased covariates (including constant ones) give 'singular' (aliased
 * coefficients NaN; the rest is the reduced fit, as R's coxph); a diverging coefficient gives
 * 'infinite' with NaN coefficients and Wald test (the LR test uses ℓ at the last iterate, the
 * score test needs no estimates).
 */
export function coxRegression(
  time: readonly number[],
  event: readonly boolean[],
  X: readonly (readonly number[])[],
  names: readonly string[],
  opts: CoxOptions = {},
): CoxResult {
  const fn = 'coxRegression'
  const n = time.length
  if (event.length !== n || X.length !== n) {
    throw new RangeError(`${fn}: time, event and X differ in length`)
  }
  for (const t of time) if (!Number.isFinite(t)) throw new RangeError(`${fn}: non-finite time`)
  const ties = opts.ties ?? 'efron'
  const efron = ties === 'efron'
  const confLevel = opts.confLevel ?? 0.95
  const ciMethod = opts.ciMethod ?? 'profile'
  const design = buildDesign(fn, X, names, opts, false)
  const K = design.cols.length
  const nEvents = event.filter(Boolean).length
  const keep = nEvents > 0 ? keptColumns(design.cols, true) : design.cols.map(() => false)
  const cols: Float64Array[] = []
  design.cols.forEach((c, j) => {
    if (!keep[j]) return
    const m = sum(c) / n
    const v = shifted(c, m)
    const m2 = sum(v) / n
    cols.push(shifted(v, m2))
  })
  const k = cols.length

  const order = new Int32Array(n)
  const events = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    order[i] = i
    events[i] = event[i] ? 1 : 0
  }
  order.sort((a, b) => time[b]! - time[a]!)
  const data: Data = { n, order, time: Float64Array.from(time), event: events }

  const ev0 = evaluate(data, cols, new Float64Array(k), null, efron)
  const nullLogLik = ev0.ll
  const fit = newton(data, cols, null, null, efron)
  const status: CoxResult['status'] =
    nEvents === 0
      ? 'singular'
      : fit.infinite
        ? 'infinite'
        : !fit.converged
          ? 'notConverged'
          : k < K
            ? 'singular'
            : 'ok'
  const usable = nEvents > 0 && (status === 'ok' || status === 'singular') && fit.cov !== null
  const ll = fit.ev.ll

  const lrTest: CoxTest =
    nEvents > 0 && k > 0
      ? { chiSq: 2 * (ll - nullLogLik), df: k, p: chiSqSf(2 * (ll - nullLogLik), k) }
      : NAN_TEST
  let waldTest = NAN_TEST
  if (usable && k > 0) {
    const w = bilinear(fit.beta, fit.ev.info, fit.beta, k)
    waldTest = { chiSq: w, df: k, p: chiSqSf(w, k) }
  }
  let scoreTest = NAN_TEST
  const inv0 = k > 0 && nEvents > 0 ? symmetricInverse(ev0.info, k) : null
  if (inv0) {
    const s = bilinear(ev0.u, inv0, ev0.u, k)
    scoreTest = { chiSq: s, df: k, p: chiSqSf(s, k) }
  }

  const z = normalQuantile(1 - (1 - confLevel) / 2)
  const profile = profileByOffset(
    cols,
    fit.beta,
    (others, off, init) => newton(data, others, off, init, efron).ev.ll,
  )
  const coefficients: CoxResult['coefficients'] = glmCoefficients(
    design.names,
    keep,
    usable,
    fit.beta,
    fit.cov ?? [],
    z,
    { method: ciMethod, ll, profile },
  ).map((c) => ({
    ...c,
    hazardRatio: Math.exp(c.estimate),
    hrLower: Math.exp(c.lower),
    hrUpper: Math.exp(c.upper),
  }))

  let concordance: number | null = null
  if (usable && k > 0) {
    const eta = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let j = 0; j < k; j++) s += cols[j]![i]! * fit.beta[j]!
      eta[i] = s
    }
    const c = harrellC(time, event, eta)
    concordance = Number.isNaN(c) ? null : c
  }
  const covK = usable && fit.cov ? fit.cov : new Float64Array(k * k).fill(NaN_)
  return {
    coefficients,
    n,
    nEvents,
    logLik: ll,
    nullLogLik,
    lrTest,
    waldTest,
    scoreTest,
    concordance,
    aic: -2 * ll + 2 * k,
    covariance: expandCov(covK, keep),
    iterations: fit.iterations,
    confLevel,
    ciMethod,
    ties,
    status,
  }
}
