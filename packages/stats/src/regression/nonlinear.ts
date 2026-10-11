import { valuesOf } from '../arrays.ts'
import { fSf } from '../dist/f.ts'
import { tQuantile } from '../dist/t.ts'
import { norm2, qrFactor, qrRank, rtrInverse } from '../linalg/qr.ts'
import { centralDiff } from '../numint/centralDiff.ts'
import { illinois } from '../numint/roots.ts'
import type { Band, BandOptions, ModelFTest } from './linear.ts'
import { type LsqProblem, levenbergMarquardt } from './lm.ts'

/**
 * Nonlinear least-squares curve fitting ("Nonlinear regression (curve fit)").
 *
 * Fitting: Levenberg–Marquardt with Moré scaling and projected box constraints (see lm.ts).
 *
 * Global fits: each parameter is fitted per data set, held constant, or shared by all data sets.
 * With no shared parameter the data sets are independent, and are fitted (and their SEs scaled
 * by their own s²) one by one; the global SS / df / AICc are then sums over the
 * separate fits, which is what a "shared vs separate" comparison needs. With a shared parameter
 * all data sets are fitted together and every SE uses the pooled s² = SS/df.
 *
 * Weighting ("relative" = 1/Y², "poisson" = 1/Y, "power" = 1/|Y|^K, "general weighting"): the
 * weight uses the Y of the curve, not of the data point. Weights that don't depend on the curve
 * (1/X, 1/X², 1/SD²) are fixed
 * `pointWeights`. The quantity minimised is
 * SS = Σ ((y − ŷ)·√w(ŷ))², i.e. Σ((y − ŷ)/ŷ)² for relative weighting, and the Jacobian includes
 * the derivative of the weight (so SEs are those of that objective, as R's nls on the same
 * residual function). SS, Sy.x and AICc are reported on this weighted scale. Weighted R² is
 * 1 − SS_w / Σ w(ŷᵢ)(yᵢ − ȳ_w)², with ȳ_w the mean weighted by the same w(ŷᵢ).
 *
 * Standard errors: Cov = s²·(JᵀJ)⁻¹ with J the Jacobian of the weighted residuals at the
 * solution and s² = SS/df, df = N − (number of fitted parameters). (JᵀJ)⁻¹ comes from a pivoted
 * QR of the column-equilibrated J; the fit is flagged 'singular' ("ambiguous") when that
 * R has a pivot below 1e-10 of the largest, i.e. the parameters are not identifiable. A parameter
 * that ends on a bound with the gradient pushing outward is treated as fixed there: no SE/CI,
 * excluded from the covariance and from df / nParams.
 *
 * Confidence intervals: value ± t(df)·SE, or (profileCI) the profile-likelihood interval
 * {θⱼ : SSprofile(θⱼ) ≤ SSmin·(1 + F(1, df)/df)} with F(1, df) = t(df)², found by bracketing and
 * Illinois false position (Dowell & Jarratt 1971) on the profile SS, each point a constrained
 * refit. An endpoint that never crosses reports the bound (±Infinity if unbounded).
 *
 * AICc (least squares; Burnham & Anderson 2002 §2.4 with K = parameters + 1 for σ):
 * N·ln(SS/N) + 2K + 2K(K + 1)/(N − K − 1).
 */

export interface CurveModel {
  id: string
  params: readonly string[]
  f(x: number, p: ArrayLike<number>): number
  /** Optional analytic partial derivatives into out[0..params.length); else central differences. */
  grad?(x: number, p: ArrayLike<number>, out: Float64Array): void
  /**
   * Automatic initial values from one data set (rules on the data). `fixed[j]` is the value of
   * parameter j when it is held constant for this data set (a constant or data set constant),
   * which some rules use (e.g. an inhibitor concentration).
   */
  initial(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    fixed?: readonly (number | undefined)[],
  ): number[]
  /**
   * For equations that differ between data sets (user equations with lines for particular data
   * sets, `<A>…`): the model of data set k (0 = A, the order of the analyzed data sets), with
   * the same parameters. Used for data that carry `FitData.dataSet`.
   */
  forDataSet?(k: number): CurveModel
  /**
   * False for a parameter this model doesn't use (another data set's own parameter): a fitted
   * one is then held at its initial value for this data set (no SE, not counted in df).
   */
  uses?(j: number): boolean
}

/** Replicates already flattened to points. */
export interface FitData {
  x: ArrayLike<number>
  y: ArrayLike<number>
  /** Which data set's model applies (CurveModel.forDataSet), when the model has variants. */
  dataSet?: number
}

/** The model that applies to a data set (its own variant for per-data-set equations). */
export function modelFor(model: CurveModel, d: { dataSet?: number | undefined }): CurveModel {
  return model.forDataSet && d.dataSet !== undefined ? model.forDataSet(d.dataSet) : model
}

export type ParamConstraint =
  | { kind: 'fit' }
  | { kind: 'constant'; value: number }
  | { kind: 'shared' }
  /** A constant that differs between data sets (a "data set constant"): values[k]. */
  | { kind: 'dataSetConstant'; values: readonly number[] }

export type Weighting = 'none' | 'relative' | 'poisson' | 'power'

export interface FitOptions {
  /** Per parameter: 'fit' (default), a constant, or shared across data sets (global fit). */
  constraints?: readonly ParamConstraint[]
  /** Box constraints per parameter, e.g. [0, Infinity]; null = unbounded. */
  bounds?: readonly ([number, number] | null)[]
  /** Initial values per data set; default model.initial. */
  initial?: readonly (readonly number[])[]
  /** 1, 1/Ŷ², 1/|Ŷ| ("1/Y^2", "1/Y"), 1/|Ŷ|^K ("1/Y^K"), Ŷ from the curve. */
  weighting?: Weighting
  /** K of 'power' weighting (default 2). */
  weightPower?: number
  /** Default 1000. */
  maxIterations?: number
  /** Default 0.95. */
  confLevel?: number
  /** Asymmetric profile-likelihood CIs (default false → symmetric asymptotic). */
  profileCI?: boolean
  /**
   * Fixed weights per point (per data set), multiplying the curve-based weighting; used by the
   * robust (Lorentzian) fit, which reweights iteratively. Default: all 1.
   */
  pointWeights?: readonly (ArrayLike<number> | undefined)[]
}

export interface ParamEstimate {
  value: number
  se: number
  lo: number
  hi: number
  status: 'fit' | 'constant' | 'shared' | 'dataSetConstant'
  /** The fit ended on this parameter's bound; it is then treated as fixed (se, lo, hi NaN). */
  atBound?: boolean
}

export interface DataSetStats {
  n: number
  ss: number
  df: number
  syx: number
  r2: number
}

export type FitStatus = 'converged' | 'maxIterations' | 'singular' | 'invalid'

export interface NonlinearFit {
  /** 'singular' ≈ "ambiguous". */
  status: FitStatus
  message?: string
  iterations: number
  /** [dataSet][param]; shared params repeat the same estimate. */
  params: ParamEstimate[][]
  /**
   * Per data set. df = n minus the fitted parameters the data set uses (a shared parameter counts
   * fully for each data set).
   */
  perDataSet: DataSetStats[]
  ss: number
  df: number
  nParams: number
  n: number
  aicc: number
  /** Covariance of the fitted parameters, row-major q×q. */
  cov: Float64Array
  /** (dataSet, param) → index into cov; −1 if constant or fixed on a bound. */
  freeIndex: number[][]
  weighting: Weighting
  /** K of 'power' weighting (2 otherwise). */
  weightPower: number
  confLevel: number
}

const NaN_ = Number.NaN
const SINGULAR_TOL = 1e-10

// ---- weights --------------------------------------------------------------------------------

/** √w(ŷ) and its derivative with respect to ŷ (k: the power of 'power' weighting). */
export function sqrtWeight(weighting: Weighting, f: number, k = 2): [number, number] {
  switch (weighting) {
    case 'power': {
      const a = Math.abs(f)
      const s = a ** (-k / 2)
      return [s, ((-k / 2) * Math.sign(f) * s) / a]
    }
    case 'relative': {
      const a = Math.abs(f)
      return [1 / a, -Math.sign(f) / (f * f)]
    }
    case 'poisson': {
      const a = Math.abs(f)
      const s = 1 / Math.sqrt(a)
      return [s, (-0.5 * Math.sign(f) * s) / a]
    }
    default:
      return [1, 0]
  }
}

/**
 * Model gradient: analytic if provided, else central differences with step ∛ε·max(|p|, 1e-3),
 * rounded to the representable step h = (v + h) − v.
 */
export function modelGrad(
  model: CurveModel,
  x: number,
  p: Float64Array,
  out: Float64Array,
  need?: (j: number) => boolean,
): void {
  if (model.grad) {
    model.grad(x, p, out)
    return
  }
  for (let j = 0; j < p.length; j++) {
    if (need && !need(j)) {
      out[j] = 0
      continue
    }
    out[j] = centralDiff(p, j, () => model.f(x, p))
  }
}

// ---- parameter layout -------------------------------------------------------------------------

interface Layout {
  K: number
  P: number
  /** [k·P + j] → free index, or −1 if constant. */
  index: Int32Array
  /** [k·P + j] → value used when index is −1. */
  fixed: Float64Array
  nFree: number
  lower: Float64Array
  upper: Float64Array
  theta0: Float64Array
  /** Per data set initial values (all params). */
  init: number[][]
}

function buildLayout(
  model: CurveModel,
  data: readonly FitData[],
  opts: FitOptions,
): Layout | string {
  const K = data.length
  const P = model.params.length
  const cons = opts.constraints ?? []
  const init: number[][] = []
  for (let k = 0; k < K; k++) {
    const given = opts.initial?.[k]
    let v: number[]
    if (given) v = [...given]
    else {
      const fixedK = model.params.map((_, j) => {
        const c = cons[j]
        return c?.kind === 'constant'
          ? c.value
          : c?.kind === 'dataSetConstant'
            ? c.values[k]
            : undefined
      })
      try {
        v = modelFor(model, data[k]!).initial(data[k]!.x, data[k]!.y, fixedK)
      } catch {
        return 'Automatic initial values could not be computed.'
      }
    }
    if (v.length !== P) return `Expected ${P} initial values, got ${v.length}.`
    init.push(v)
  }
  const index = new Int32Array(K * P).fill(-1)
  const fixed = new Float64Array(K * P)
  const models = data.map((d) => modelFor(model, d))
  /** Data set k's model doesn't use parameter j: it stays at its initial value there. */
  const unused = (k: number, j: number) => models[k]!.uses?.(j) === false
  const lower: number[] = []
  const upper: number[] = []
  const theta0: number[] = []
  for (let j = 0; j < P; j++) {
    const c = cons[j] ?? { kind: 'fit' }
    const b = opts.bounds?.[j] ?? null
    const lo = b ? b[0] : Number.NEGATIVE_INFINITY
    const hi = b ? b[1] : Number.POSITIVE_INFINITY
    if (!(lo <= hi)) return `Invalid bounds for ${model.params[j]}.`
    if (c.kind === 'constant') {
      if (!Number.isFinite(c.value))
        return `The constant value of ${model.params[j]} is not finite.`
      for (let k = 0; k < K; k++) fixed[k * P + j] = c.value
    } else if (c.kind === 'dataSetConstant') {
      for (let k = 0; k < K; k++) {
        const v = c.values[k]
        if (v === undefined || !Number.isFinite(v))
          return `The value of ${model.params[j]} for data set ${k + 1} is not a finite number.`
        fixed[k * P + j] = v
      }
    } else if (c.kind === 'shared') {
      // Mean of the data sets' finite initial values (a rule may have none for some data sets).
      let s = 0
      let cnt = 0
      for (let k = 0; k < K; k++) {
        const v = init[k]![j]!
        if (Number.isFinite(v)) {
          s += v
          cnt++
        }
      }
      if (data.every((_, k) => unused(k, j))) {
        for (let k = 0; k < K; k++) fixed[k * P + j] = init[k]![j]!
        continue
      }
      const idx = theta0.length
      theta0.push(cnt > 0 ? s / cnt : Number.NaN)
      lower.push(lo)
      upper.push(hi)
      for (let k = 0; k < K; k++) index[k * P + j] = idx
    } else {
      for (let k = 0; k < K; k++) {
        if (unused(k, j)) {
          fixed[k * P + j] = init[k]![j]!
          continue
        }
        index[k * P + j] = theta0.length
        theta0.push(init[k]![j]!)
        lower.push(lo)
        upper.push(hi)
      }
    }
  }
  for (let i = 0; i < theta0.length; i++) {
    if (!Number.isFinite(theta0[i]!)) return 'The initial values are not all finite.'
  }
  return {
    K,
    P,
    index,
    fixed,
    nFree: theta0.length,
    lower: Float64Array.from(lower),
    upper: Float64Array.from(upper),
    theta0: Float64Array.from(theta0),
    init,
  }
}

function paramsOf(L: Layout, theta: ArrayLike<number>, k: number, out: Float64Array): void {
  for (let j = 0; j < L.P; j++) {
    const idx = L.index[k * L.P + j]!
    out[j] = idx >= 0 ? theta[idx]! : L.fixed[k * L.P + j]!
  }
}

function makeProblem(
  model: CurveModel,
  data: readonly FitData[],
  L: Layout,
  weighting: Weighting,
  pointWeights?: FitOptions['pointWeights'],
  power = 2,
): LsqProblem {
  const pw = data.map((d, k) => {
    const w = pointWeights?.[k]
    if (!w) return null
    const out = new Float64Array(d.x.length)
    for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(w[i]!)
    return out
  })
  let m = 0
  for (const d of data) m += d.x.length
  const p = new Float64Array(L.P)
  const g = new Float64Array(L.P)
  const models = data.map((d) => modelFor(model, d))
  return {
    m,
    n: L.nFree,
    lower: L.lower,
    upper: L.upper,
    residuals(theta, r) {
      let row = 0
      for (let k = 0; k < L.K; k++) {
        paramsOf(L, theta, k, p)
        const { x, y } = data[k]!
        const sp = pw[k]
        const mk = models[k]!
        for (let i = 0; i < x.length; i++, row++) {
          const f = mk.f(x[i]!, p)
          const e = (y[i]! - f) * sqrtWeight(weighting, f, power)[0] * (sp ? sp[i]! : 1)
          if (!Number.isFinite(e)) return false
          r[row] = e
        }
      }
      return true
    },
    jacobian(theta, _r, J) {
      J.fill(0)
      let row = 0
      for (let k = 0; k < L.K; k++) {
        paramsOf(L, theta, k, p)
        const { x, y } = data[k]!
        const need = (j: number): boolean => L.index[k * L.P + j]! >= 0
        const sp = pw[k]
        const mk = models[k]!
        for (let i = 0; i < x.length; i++, row++) {
          const xi = x[i]!
          modelGrad(mk, xi, p, g, need)
          let fac = -1
          if (weighting !== 'none') {
            const f = mk.f(xi, p)
            const [sw, dsw] = sqrtWeight(weighting, f, power)
            fac = -sw + (y[i]! - f) * dsw
          }
          if (sp) fac *= sp[i]!
          for (let j = 0; j < L.P; j++) {
            const idx = L.index[k * L.P + j]!
            if (idx < 0) continue
            const v = fac * g[j]!
            if (!Number.isFinite(v)) return false
            J[idx * m + row] = v
          }
        }
      }
      return true
    },
  }
}

// ---- covariance ------------------------------------------------------------------------------

/**
 * (JᵀJ)⁻¹ over the given columns (row-major q×q), or null if J is rank-deficient at
 * SINGULAR_TOL after equilibrating the columns.
 */
function unscaledCovariance(J: Float64Array, m: number, cols: number[]): Float64Array | null {
  const q = cols.length
  const A = new Float64Array(m * q)
  const scale = new Float64Array(q)
  for (let c = 0; c < q; c++) {
    const j = cols[c]!
    const s = norm2(J, j * m, j * m + m)
    if (!(s > 0)) return null
    scale[c] = s
    for (let i = 0; i < m; i++) A[c * m + i] = J[j * m + i]! / s
  }
  const f = qrFactor(A, m, q, true)
  if (qrRank(f, SINGULAR_TOL) < q) return null
  const C = rtrInverse(f, q)
  const out = new Float64Array(q * q)
  for (let a = 0; a < q; a++) {
    const ca = f.perm[a]!
    for (let b = 0; b < q; b++) {
      const cb = f.perm[b]!
      out[ca * q + cb] = C[a * q + b]! / (scale[ca]! * scale[cb]!)
    }
  }
  return out
}

// ---- profile likelihood ------------------------------------------------------------------------

/** The problem with parameter `fix` held at a value. */
function fixOne(prob: LsqProblem, fix: number) {
  const { m, n } = prob
  const full = new Float64Array(n)
  const Jfull = new Float64Array(m * n)
  const lower = new Float64Array(n - 1)
  const upper = new Float64Array(n - 1)
  for (let j = 0, c = 0; j < n; j++) {
    if (j === fix) continue
    lower[c] = prob.lower[j]!
    upper[c] = prob.upper[j]!
    c++
  }
  const expand = (z: ArrayLike<number>): void => {
    for (let j = 0, c = 0; j < n; j++) if (j !== fix) full[j] = z[c++]!
  }
  const sub: LsqProblem & { set(v: number): void } = {
    m,
    n: n - 1,
    lower,
    upper,
    set(v: number) {
      full[fix] = v
    },
    residuals(z, r) {
      expand(z)
      return prob.residuals(full, r)
    },
    jacobian(z, r, J) {
      expand(z)
      if (!prob.jacobian(full, r, Jfull)) return false
      for (let j = 0, c = 0; j < n; j++) {
        if (j === fix) continue
        J.set(Jfull.subarray(j * m, j * m + m), c * m)
        c++
      }
      return true
    },
  }
  return sub
}

function without(theta: ArrayLike<number>, fix: number): Float64Array {
  const z = new Float64Array(theta.length - 1)
  for (let j = 0, c = 0; j < theta.length; j++) if (j !== fix) z[c++] = theta[j]!
  return z
}

/**
 * Profile-likelihood interval of parameter `idx`: where the profile SS crosses `target`.
 */
function profileInterval(
  prob: LsqProblem,
  theta: Float64Array,
  ss: number,
  idx: number,
  target: number,
  step0: number,
  maxIterations: number,
): [number, number] {
  const sub = fixOne(prob, idx)
  const evalAt = (v: number, z0: Float64Array): { g: number; z: Float64Array } => {
    sub.set(v)
    const res = levenbergMarquardt(sub, z0, { maxIterations })
    if (res.status === 'invalid') return { g: Number.POSITIVE_INFINITY, z: z0 }
    return { g: res.ss - target, z: res.x }
  }
  const endpoint = (dir: -1 | 1): number => {
    const bound = dir < 0 ? prob.lower[idx]! : prob.upper[idx]!
    let vIn = theta[idx]!
    let gIn = ss - target
    let zIn = without(theta, idx)
    let step = step0
    let vOut = Number.NaN
    let gOut = Number.NaN
    let bracketed = false
    for (let it = 0; it < 60; it++) {
      let v = vIn + dir * step
      if ((dir < 0 && v <= bound) || (dir > 0 && v >= bound)) v = bound
      if (!Number.isFinite(v)) return v
      const e = evalAt(v, zIn)
      if (e.g >= 0) {
        vOut = v
        gOut = e.g
        bracketed = true
        break
      }
      vIn = v
      gIn = e.g
      zIn = e.z
      if (v === bound) return bound
      step *= 2
    }
    if (!bracketed) return dir * Number.POSITIVE_INFINITY
    // Illinois false position on [vIn (g < 0), vOut (g ≥ 0)]; a NaN g at vIn is taken as −∞
    // (bisection until that end is replaced).
    let z = zIn
    const F = (v: number) => {
      const e = evalAt(v, z)
      if (Number.isFinite(e.g)) z = e.z
      return e.g
    }
    return illinois(F, vIn, Number.isNaN(gIn) ? Number.NEGATIVE_INFINITY : gIn, vOut, gOut, {
      maxIter: 100,
      accept: (fc) => Math.abs(fc) <= 1e-13 * target,
      done: (a, b) => Math.abs(b - a) <= 4 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b)),
    })
  }
  return [endpoint(-1), endpoint(1)]
}

// ---- fitting ------------------------------------------------------------------------------------

interface CoreFit {
  status: FitStatus
  message?: string
  iterations: number
  values: number[][]
  se: number[][]
  lo: number[][]
  hi: number[][]
  atBound: boolean[][]
  perDataSet: DataSetStats[]
  ss: number
  df: number
  nParams: number
  n: number
  /** q×q, scaled by s². */
  cov: Float64Array
  /** [k][j] → cov index or −1. */
  covIndex: number[][]
}

function invalidCore(
  model: CurveModel,
  data: readonly FitData[],
  message: string,
  init?: number[][],
): CoreFit {
  const P = model.params.length
  const K = data.length
  const nan = (): number[][] => data.map(() => new Array(P).fill(NaN_))
  let n = 0
  for (const d of data) n += d.x.length
  return {
    status: 'invalid',
    message,
    iterations: 0,
    values: init ?? nan(),
    se: nan(),
    lo: nan(),
    hi: nan(),
    atBound: data.map(() => new Array(P).fill(false)),
    perDataSet: data.map((d) => ({ n: d.x.length, ss: NaN_, df: NaN_, syx: NaN_, r2: NaN_ })),
    ss: NaN_,
    df: NaN_,
    nParams: 0,
    n,
    cov: new Float64Array(0),
    covIndex: Array.from({ length: K }, () => new Array(P).fill(-1)),
  }
}

function fitCore(
  model: CurveModel,
  data: readonly FitData[],
  opts: FitOptions,
  weighting: Weighting,
): CoreFit {
  const P = model.params.length
  const K = data.length
  const confLevel = opts.confLevel ?? 0.95
  const maxIterations = opts.maxIterations ?? 1000
  for (const d of data) {
    if (d.x.length !== d.y.length) throw new RangeError('nonlinearFit: x and y differ in length')
  }
  const L = buildLayout(model, data, opts)
  if (typeof L === 'string') return invalidCore(model, data, L)
  const K_ = opts.weightPower ?? 2
  const prob = makeProblem(model, data, L, weighting, opts.pointWeights, K_)
  const N = prob.m
  if (N < L.nFree) {
    return invalidCore(model, data, 'Fewer data points than parameters to fit.', L.init)
  }
  const lm = levenbergMarquardt(prob, L.theta0, { maxIterations })
  if (lm.status === 'invalid') {
    return invalidCore(model, data, lm.message ?? 'The fit failed.', L.init)
  }
  let status: FitStatus = lm.status
  let message = lm.message
  const theta = lm.x
  const ss = lm.ss

  // Parameters used for inference: free and not stuck on a bound.
  const cols: number[] = []
  const covPos = new Int32Array(L.nFree).fill(-1)
  for (let j = 0; j < L.nFree; j++) {
    if (!lm.active[j]) {
      covPos[j] = cols.length
      cols.push(j)
    }
  }
  const q = cols.length
  const df = N - q
  const s2 = df > 0 ? ss / df : NaN_
  let covU = unscaledCovariance(lm.J, N, cols)
  if (!covU) {
    covU = new Float64Array(q * q).fill(NaN_)
    if (status === 'converged') {
      status = 'singular'
      message = 'The fit is ambiguous: the parameters are not all identifiable from these data.'
    }
  }
  const cov = covU.map((v) => v * s2)
  const t = df > 0 ? tQuantile(1 - (1 - confLevel) / 2, df) : NaN_

  // Profile CIs, per free parameter.
  const prof = new Map<number, [number, number]>()
  if (opts.profileCI && status === 'converged' && df > 0) {
    const target = ss * (1 + (t * t) / df)
    for (const j of cols) {
      const se = Math.sqrt(cov[covPos[j]! * q + covPos[j]!]!)
      const step0 =
        Number.isFinite(se) && se > 0 ? t * se : Math.max(Math.abs(theta[j]!) * 0.1, 1e-3)
      prof.set(j, profileInterval(prob, theta, ss, j, target, step0, maxIterations))
    }
  }

  const values: number[][] = []
  const seOut: number[][] = []
  const loOut: number[][] = []
  const hiOut: number[][] = []
  const atBound: boolean[][] = []
  const covIndex: number[][] = []
  const perDataSet: DataSetStats[] = []
  const p = new Float64Array(P)
  let row = 0
  for (let k = 0; k < K; k++) {
    paramsOf(L, theta, k, p)
    values.push(Array.from(p))
    const se: number[] = []
    const lo: number[] = []
    const hi: number[] = []
    const ab: boolean[] = []
    const ci: number[] = []
    let used = 0
    for (let j = 0; j < P; j++) {
      const idx = L.index[k * P + j]!
      const pos = idx >= 0 ? covPos[idx]! : -1
      ci.push(pos)
      ab.push(idx >= 0 && pos < 0)
      if (pos < 0) {
        se.push(NaN_)
        lo.push(NaN_)
        hi.push(NaN_)
        continue
      }
      used++
      const s = Math.sqrt(cov[pos * q + pos]!)
      se.push(s)
      const pr = prof.get(idx)
      if (pr) {
        lo.push(pr[0])
        hi.push(pr[1])
      } else {
        lo.push(p[j]! - t * s)
        hi.push(p[j]! + t * s)
      }
    }
    seOut.push(se)
    loOut.push(lo)
    hiOut.push(hi)
    atBound.push(ab)
    covIndex.push(ci)

    // Per data set SS and R² (weights at the fitted curve).
    const { x, y } = data[k]!
    const nk = x.length
    let ssk = 0
    let sw = 0
    let swy = 0
    const w = new Float64Array(nk)
    const mk = modelFor(model, data[k]!)
    for (let i = 0; i < nk; i++) {
      const e = lm.r[row + i]!
      ssk += e * e
      const sq = sqrtWeight(weighting, mk.f(x[i]!, p), K_)[0]
      w[i] = sq * sq * (opts.pointWeights?.[k]?.[i] ?? 1)
      sw += w[i]!
      swy += w[i]! * y[i]!
    }
    const ybar = swy / sw
    let sst = 0
    for (let i = 0; i < nk; i++) sst += w[i]! * (y[i]! - ybar) ** 2
    row += nk
    const dfk = nk - used
    perDataSet.push({
      n: nk,
      ss: ssk,
      df: dfk,
      syx: dfk > 0 ? Math.sqrt(ssk / dfk) : NaN_,
      r2: 1 - ssk / sst,
    })
  }
  if (lm.active.some((a) => a === 1) && !message) {
    const names = new Set<string>()
    for (let k = 0; k < K; k++) {
      for (let j = 0; j < P; j++) if (atBound[k]![j]) names.add(model.params[j]!)
    }
    message = `Hit a constraint: ${[...names].join(', ')}.`
  }
  const out: CoreFit = {
    status,
    iterations: lm.iterations,
    values,
    se: seOut,
    lo: loOut,
    hi: hiOut,
    atBound,
    perDataSet,
    ss,
    df,
    nParams: q,
    n: N,
    cov,
    covIndex,
  }
  if (message) out.message = message
  return out
}

/** AICc for least squares, K = nParams + 1. */
export function aiccLeastSquares(n: number, ss: number, nParams: number): number {
  const K = nParams + 1
  if (n - K - 1 <= 0) return NaN_
  return n * Math.log(ss / n) + 2 * K + (2 * K * (K + 1)) / (n - K - 1)
}

const SEVERITY: Record<FitStatus, number> = {
  converged: 0,
  maxIterations: 1,
  singular: 2,
  invalid: 3,
}

export function nonlinearFit(
  model: CurveModel,
  data: readonly FitData[],
  opts: FitOptions = {},
): NonlinearFit {
  const weighting = opts.weighting ?? 'none'
  const confLevel = opts.confLevel ?? 0.95
  const K = data.length
  if (K === 0) throw new RangeError('nonlinearFit: no data sets')
  const shared = (opts.constraints ?? []).some((c) => c?.kind === 'shared')
  const cores: { core: CoreFit; sets: number[] }[] = []
  if (shared || K === 1) {
    cores.push({ core: fitCore(model, data, opts, weighting), sets: data.map((_, k) => k) })
  } else {
    for (let k = 0; k < K; k++) {
      const sub: FitOptions = { ...opts }
      if (opts.constraints)
        sub.constraints = opts.constraints.map((c) =>
          c?.kind === 'dataSetConstant' ? { kind: 'constant', value: c.values[k] ?? NaN_ } : c,
        )
      if (opts.initial) sub.initial = [opts.initial[k]!]
      if (opts.pointWeights) sub.pointWeights = [opts.pointWeights[k]]
      cores.push({ core: fitCore(model, [data[k]!], sub, weighting), sets: [k] })
    }
  }
  const constraints = opts.constraints ?? []
  const params: ParamEstimate[][] = new Array(K)
  const perDataSet: DataSetStats[] = new Array(K)
  const freeIndex: number[][] = new Array(K)
  let q = 0
  for (const { core } of cores) q += core.nParams
  const cov = new Float64Array(q * q)
  let offset = 0
  let status: FitStatus = 'converged'
  let message: string | undefined
  let iterations = 0
  let ss = 0
  let df = 0
  let n = 0
  let nParams = 0
  for (const { core, sets } of cores) {
    iterations += core.iterations
    ss += core.ss
    df += core.df
    n += core.n
    nParams += core.nParams
    if (SEVERITY[core.status] > SEVERITY[status]) status = core.status
    if (core.message && !message) {
      message = cores.length > 1 ? `Data set ${sets[0]! + 1}: ${core.message}` : core.message
    }
    const cq = core.nParams
    for (let a = 0; a < cq; a++) {
      for (let b = 0; b < cq; b++) cov[(offset + a) * q + offset + b] = core.cov[a * cq + b]!
    }
    sets.forEach((k, local) => {
      perDataSet[k] = core.perDataSet[local]!
      freeIndex[k] = core.covIndex[local]!.map((i) => (i >= 0 ? i + offset : -1))
      params[k] = model.params.map((_, j) => {
        const c = constraints[j]?.kind ?? 'fit'
        const est: ParamEstimate = {
          value: core.values[local]![j]!,
          se: core.se[local]![j]!,
          lo: core.lo[local]![j]!,
          hi: core.hi[local]![j]!,
          status: c,
        }
        if (core.atBound[local]![j]) est.atBound = true
        return est
      })
    })
    offset += cq
  }
  const fit: NonlinearFit = {
    status,
    iterations,
    params,
    perDataSet,
    ss,
    df,
    nParams,
    n,
    aicc: aiccLeastSquares(n, ss, nParams),
    cov,
    freeIndex,
    weighting,
    weightPower: opts.weightPower ?? 2,
    confLevel,
  }
  if (message) fit.message = message
  return fit
}

/**
 * Confidence or prediction band of a fitted curve at xs, by the delta method:
 * var ŷ = gᵀ Cov g with g = ∂f/∂θ (fitted parameters only); the prediction band adds s²/w(ŷ)
 * (the residual variance on the data scale, for weighted fits). t has the fit's df — the pooled
 * df for a global (shared) fit, the data set's own df otherwise.
 */
export function curveBand(
  model: CurveModel,
  fit: NonlinearFit,
  dataSetIndex: number,
  xs: ArrayLike<number>,
  opts: BandOptions & {
    /** Fixed weight of a new observation at x (1/X, 1/X² weighting); default 1. */
    pointWeightAt?: (x: number) => number
  } = {},
): Band {
  const level = opts.confLevel ?? fit.confLevel ?? 0.95
  const est = fit.params[dataSetIndex]!
  const idx = fit.freeIndex[dataSetIndex]!
  const shared = fit.params.some((ds) => ds.some((e) => e.status === 'shared'))
  const ds = fit.perDataSet[dataSetIndex]!
  const df = shared ? fit.df : ds.df
  const s2 = shared ? fit.ss / fit.df : ds.ss / ds.df
  const t = df > 0 ? tQuantile(1 - (1 - level) / 2, df) : NaN_
  const q = Math.round(Math.sqrt(fit.cov.length))
  const P = model.params.length
  const p = valuesOf(est)
  const g = new Float64Array(P)
  const m = xs.length
  const out = { y: new Float64Array(m), lo: new Float64Array(m), hi: new Float64Array(m) }
  for (let i = 0; i < m; i++) {
    const x = xs[i]!
    const y = model.f(x, p)
    modelGrad(model, x, p, g, (j) => idx[j]! >= 0)
    let v = 0
    for (let a = 0; a < P; a++) {
      const ia = idx[a]!
      if (ia < 0) continue
      for (let b = 0; b < P; b++) {
        const ib = idx[b]!
        if (ib < 0) continue
        v += g[a]! * g[b]! * fit.cov[ia * q + ib]!
      }
    }
    if (opts.kind === 'prediction') {
      const sw = sqrtWeight(fit.weighting, y, fit.weightPower)[0]
      v += s2 / (sw * sw * (opts.pointWeightAt ? opts.pointWeightAt(x) : 1))
    }
    const h = t * Math.sqrt(v)
    out.y[i] = y
    out.lo[i] = y - h
    out.hi[i] = y + h
  }
  return out
}

export interface FitComparison extends ModelFTest {
  aiccSimpler: number
  aiccComplex: number
  /** Akaike weight of the simpler model: 1/(1 + exp((AICc_simpler − AICc_complex)/2)). */
  probSimpler: number
}

/**
 * Compares two nested fits to the same data: extra-sum-of-squares F test
 * F = ((SS₁ − SS₂)/(df₁ − df₂)) / (SS₂/df₂), and the AICc difference as Akaike weights.
 */
export function compareFits(simpler: NonlinearFit, complex: NonlinearFit): FitComparison {
  const dfn = simpler.df - complex.df
  const dfd = complex.df
  const F = (simpler.ss - complex.ss) / dfn / (complex.ss / dfd)
  const p = dfn > 0 && dfd > 0 ? fSf(Math.max(F, 0), dfn, dfd) : NaN_
  const d = simpler.aicc - complex.aicc
  return {
    F: dfn > 0 ? F : NaN_,
    dfn,
    dfd,
    p,
    aiccSimpler: simpler.aicc,
    aiccComplex: complex.aicc,
    probSimpler: 1 / (1 + Math.exp(d / 2)),
  }
}
