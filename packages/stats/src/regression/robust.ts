import { valuesOf } from '../arrays.ts'
import { robustSD, routTest } from '../outliers/outliers.ts'
import {
  type CurveModel,
  type FitData,
  type FitOptions,
  modelFor,
  type NonlinearFit,
  nonlinearFit,
  sqrtWeight,
} from './nonlinear.ts'

/**
 * Robust curve fitting and ROUT outlier detection for curves (Motulsky & Brown 2006, "Detecting
 * outliers when fitting data with nonlinear regression – a new method based on robust nonlinear
 * regression and the false discovery rate", BMC Bioinformatics 7: 123).
 *
 * Robust fit: minimise the Lorentzian merit Σ ln(1 + (rᵢ/RSDR)²), RSDR = P68.27(|r|)·N/(N − K)
 * recomputed from the current fit, until the parameters and RSDR no longer change. Each step is a
 * weighted least-squares fit with weights 1/(1 + (rᵢ/RSDR)²) from the previous residuals
 * (iteratively reweighted least squares; its fixed point is a stationary point of the Lorentzian
 * merit at that RSDR), started from the ordinary least-squares fit. As in Prism the robust fit
 * ignores weighting (1/Y², 1/Y). Data sets are fitted one by one, or together when a parameter
 * is shared (then RSDR pools the data sets). The fixed point reached depends on the start when
 * the Lorentzian merit has several minima.
 *
 * ROUT: the robust fit's residuals — weighted by the chosen weighting at the robust curve, as
 * Prism judges outliers on weighted residuals, with RSDR recomputed from them — are tested with
 * `routTest` at the false discovery rate Q (the same test as for column data); the outliers are
 * then removed and the curve refitted by least squares with the usual options (by the caller).
 */

export interface RobustBlock {
  /** Data sets (indices) fitted together. */
  sets: number[]
  fit: NonlinearFit
  rsdr: number
  /** Number of fitted parameters (K in N − K). */
  nParams: number
  iterations: number
  converged: boolean
}

export interface RobustFit {
  blocks: RobustBlock[]
  /** Per data set: which block, the residuals and the final Lorentzian weights. */
  perDataSet: { block: number; residuals: Float64Array; weights: Float64Array }[]
}

const TOL = 1e-11

function weightedResiduals(
  model: CurveModel,
  fit: NonlinearFit,
  k: number,
  d: FitData,
  weighting: FitOptions['weighting'],
  power = 2,
  pointWeights?: ArrayLike<number>,
): Float64Array {
  const p = valuesOf(fit.params[k]!)
  const m = modelFor(model, d)
  const out = new Float64Array(d.x.length)
  for (let i = 0; i < out.length; i++) {
    const f = m.f(d.x[i]!, p)
    const w = sqrtWeight(weighting ?? 'none', f, power)[0]
    out[i] = (d.y[i]! - f) * w * (pointWeights ? Math.sqrt(pointWeights[i]!) : 1)
  }
  return out
}

/** Cauchy weights 1 / (1 + (r / s)²) of each data set's residuals. */
function cauchyWeights(res: readonly Float64Array[], s: number) {
  return res.map((r) => {
    const w = new Float64Array(r.length)
    for (let i = 0; i < r.length; i++) w[i] = 1 / (1 + (r[i]! / s) ** 2)
    return w
  })
}

function fitBlock(
  model: CurveModel,
  data: readonly FitData[],
  opts: FitOptions,
  maxIterations: number,
): Omit<RobustBlock, 'sets'> & { residuals: Float64Array[]; weights: Float64Array[] } {
  // Robust fitting ignores every weighting choice (Prism), fixed point weights included.
  const base: FitOptions = { ...opts, profileCI: false, weighting: 'none' }
  delete base.pointWeights
  let fit = nonlinearFit(model, data, base)
  const residualsOf = (f: NonlinearFit) =>
    data.map((d, k) => weightedResiduals(model, f, k, d, 'none'))
  let res = residualsOf(fit)
  const nParams = fit.nParams
  const all = () => Float64Array.from(res.flatMap((r) => [...r]))
  let s = robustSD(all(), nParams)
  let weights = data.map((d) => new Float64Array(d.x.length).fill(1))
  let converged = false
  let iterations = 0
  for (; iterations < maxIterations; iterations++) {
    if (fit.status === 'invalid' || !(s > 0)) break
    weights = cauchyWeights(res, s)
    const prev = fit.params.map((ps) => ps.map((e) => e.value))
    const next = nonlinearFit(model, data, { ...base, initial: prev, pointWeights: weights })
    if (next.status === 'invalid') break
    fit = next
    res = residualsOf(fit)
    const sNext = robustSD(all(), nParams)
    let moved = Math.abs(sNext - s) > TOL * s
    fit.params.forEach((ps, k) => {
      ps.forEach((e, j) => {
        if (Math.abs(e.value - prev[k]![j]!) > TOL * Math.max(Math.abs(e.value), 1e-300))
          moved = true
      })
    })
    s = sNext
    if (!moved) {
      converged = true
      break
    }
  }
  weights = cauchyWeights(res, s)
  return { fit, rsdr: s, nParams, iterations, converged, residuals: res, weights }
}

/** Robust (Lorentzian) fit of every data set; see the module comment. */
export function robustFit(
  model: CurveModel,
  data: readonly FitData[],
  opts: FitOptions = {},
  maxIterations = 500,
): RobustFit {
  const shared = (opts.constraints ?? []).some((c) => c?.kind === 'shared') && data.length > 1
  const groups = shared ? [data.map((_, k) => k)] : data.map((_, k) => [k])
  const blocks: RobustBlock[] = []
  const perDataSet: RobustFit['perDataSet'] = new Array(data.length)
  groups.forEach((sets, b) => {
    const sub: FitOptions = { ...opts }
    if (opts.initial) sub.initial = sets.map((k) => opts.initial![k]!)
    if (opts.pointWeights) sub.pointWeights = sets.map((k) => opts.pointWeights![k])
    if (opts.constraints)
      sub.constraints = opts.constraints.map((c) =>
        c?.kind === 'dataSetConstant'
          ? { kind: 'dataSetConstant', values: sets.map((k) => c.values[k] ?? Number.NaN) }
          : c,
      )
    const r = fitBlock(
      model,
      sets.map((k) => data[k]!),
      sub,
      maxIterations,
    )
    blocks.push({
      sets,
      fit: r.fit,
      rsdr: r.rsdr,
      nParams: r.nParams,
      iterations: r.iterations,
      converged: r.converged,
    })
    sets.forEach((k, local) => {
      perDataSet[k] = { block: b, residuals: r.residuals[local]!, weights: r.weights[local]! }
    })
  })
  return { blocks, perDataSet }
}

export interface CurveOutliers {
  robust: RobustFit
  /** Per data set: indices of the points identified as outliers. */
  outliers: number[][]
  /** Per data set: t = |residual|/RSDR and its P, per point. */
  t: Float64Array[]
  p: Float64Array[]
}

/** ROUT for curves: robust fit, then the FDR outlier test at `q` (a fraction, 0.01 = 1%). */
export function routCurve(
  model: CurveModel,
  data: readonly FitData[],
  q: number,
  opts: FitOptions = {},
): CurveOutliers {
  const robust = robustFit(model, data, opts)
  const outliers: number[][] = data.map(() => [])
  const t = data.map((d) => new Float64Array(d.x.length).fill(Number.NaN))
  const p = data.map((d) => new Float64Array(d.x.length).fill(Number.NaN))
  const weighted = (opts.weighting ?? 'none') !== 'none' || opts.pointWeights !== undefined
  for (const b of robust.blocks) {
    if (b.fit.status === 'invalid') continue
    const pos: [number, number][] = []
    const res: number[] = []
    b.sets.forEach((k, local) => {
      const r = weighted
        ? weightedResiduals(
            model,
            b.fit,
            local,
            data[k]!,
            opts.weighting,
            opts.weightPower,
            opts.pointWeights?.[k],
          )
        : robust.perDataSet[k]!.residuals
      r.forEach((v, i) => {
        pos.push([k, i])
        res.push(v)
      })
    })
    const rsdr = weighted ? robustSD(res, b.nParams) : b.rsdr
    const test = routTest(res, rsdr, res.length - b.nParams, q)
    test.values.forEach((v, j) => {
      const [k, i] = pos[j]!
      t[k]![i] = v.t
      p[k]![i] = v.p
    })
    for (const j of test.outliers) {
      const [k, i] = pos[j]!
      outliers[k]!.push(i)
    }
  }
  for (const o of outliers) o.sort((a, b) => a - b)
  return { robust, outliers, t, p }
}
