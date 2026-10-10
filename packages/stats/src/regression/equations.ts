import { DOSE_FORMS, doseForm } from './doseForms.ts'
import { MORE_EQUATIONS } from './equationsMore.ts'
import {
  argmax,
  logistic10,
  logisticE,
  maxOf,
  minOf,
  profile,
  rateFromHalfLife,
  xAtLevel,
  xRange,
} from './initialRules.ts'
import { LAB_EQUATIONS } from './labEquations.ts'
import type { CurveModel, FitOptions, ParamConstraint } from './nonlinear.ts'
import { polynomialRegression } from './polynomial.ts'

/**
 * Prism's built-in equation library (names and parameterisations as in the GraphPad Curve
 * Fitting Guide), with analytic gradients and Prism-style automatic initial values.
 *
 * Initial-value rules work on the data reduced to one mean Y per distinct X, sorted by X:
 * Bottom/Top = min/max Y, a "half-way" X from linear interpolation where Y first crosses the
 * midpoint, and slope signs from the direction of the overall trend (sign of the least-squares
 * slope). Rate constants come from the half-way X (K = ln 2 / (X½ − X_first)).
 */

export type EquationCategory =
  | 'Dose-response — Stimulation'
  | 'Dose-response — Inhibition'
  | 'Dose-response — Special, X is concentration'
  | 'Dose-response — Special, X is log(concentration)'
  | 'Binding'
  | 'Binding — Competitive'
  | 'Binding — Kinetics'
  | 'Enzyme kinetics'
  | 'Enzyme kinetics — Inhibition'
  | 'Exponential'
  | 'Lines and polynomials'
  | 'Growth and sigmoidal'
  | 'Gaussian'
  | 'Sine waves and peaks'
  | 'Linear-quadratic (radiation)'
  | 'Classic equations'

export interface ParamInfo {
  description: string
  /**
   * 'shared': one value for all data sets (a global fit); 'dataSetConstant': a constant that
   * differs between data sets, read from each data set's title (e.g. an inhibitor
   * concentration). 'meanX': a data set constant equal to the mean X of each data set (Prism's
   * "Data set constant (= Mean X)", centered polynomials).
   */
  defaultConstraint?:
    | 'fit'
    | 'shared'
    | 'dataSetConstant'
    | 'meanX'
    | { constant: number }
    | { bounds: [number, number] }
}

export interface EquationDef extends CurveModel {
  name: string
  category: EquationCategory
  /** Human-readable. */
  formula: string
  paramInfo: Record<string, ParamInfo>
  /** Derived quantities from the full parameter vector, e.g. EC50 = 10^LogEC50. */
  derived?: (p: number[]) => Record<string, number>
}

const LN10 = Math.LN10
const LN2 = Math.LN2

// ---- dose-response ---------------------------------------------------------------------------

/**
 * Y = Bottom + (Top − Bottom)·s, s = 1/(1 + 10^z), z = sign·(X − Log50)·Hill, where sign = −1
 * for the agonist form (LogEC50 − X) and +1 for the inhibitor form (X − LogIC50).
 */
function doseResponse(
  sign: 1 | -1,
  opts: { bottom?: number; top?: number; hill?: boolean },
): Pick<CurveModel, 'f' | 'grad'> {
  // Parameter positions: [Bottom, Top,] Log50[, HillSlope]
  const fixedBT = opts.bottom !== undefined
  const iL = fixedBT ? 0 : 2
  const iH = iL + 1
  const bt = (p: ArrayLike<number>): [number, number] =>
    fixedBT ? [opts.bottom!, opts.top!] : [p[0]!, p[1]!]
  return {
    f(x, p) {
      const [B, T] = bt(p)
      const H = opts.hill ? p[iH]! : 1
      return B + (T - B) * logistic10(sign * (x - p[iL]!) * H)[0]
    },
    grad(x, p, g) {
      const [B, T] = bt(p)
      const H = opts.hill ? p[iH]! : 1
      const d = sign * (x - p[iL]!)
      const [s, c] = logistic10(d * H)
      const k = -(T - B) * LN10 * s * c // ∂f/∂z
      if (!fixedBT) {
        g[0] = c
        g[1] = s
      }
      g[iL] = k * H * -sign
      if (opts.hill) g[iH] = k * d
    },
  }
}

function doseInitial(
  kind: 'agonist' | 'inhibitor',
  shape: 'full' | 'normalized',
  hill: boolean,
): (x: ArrayLike<number>, y: ArrayLike<number>) => number[] {
  return (x, y) => {
    const pr = profile(x, y)
    const lo = shape === 'normalized' ? 0 : pr.ymin
    const hi = shape === 'normalized' ? 100 : pr.ymax
    const log50 = xAtLevel(pr, (lo + hi) / 2)
    // Agonist form rises with X for Hill > 0; the inhibitor form falls.
    const h = kind === 'agonist' ? pr.trend : -pr.trend
    const out = shape === 'normalized' ? [log50] : [pr.ymin, pr.ymax, log50]
    if (hill) out.push(h)
    return out
  }
}

const BOTTOM: ParamInfo = { description: 'Y value at the bottom plateau' }
const TOP: ParamInfo = { description: 'Y value at the top plateau' }
const HILL: ParamInfo = { description: 'Hill slope (steepness of the curve)' }
const HILL_INHIBITION: ParamInfo = { description: 'Hill slope (negative for a falling curve)' }

function asymmetric5PL(): Pick<CurveModel, 'f' | 'grad'> {
  // LogXb = LogEC50 + log10(2^(1/S) − 1)/HillSlope;  Y = B + (T − B)/(1 + 10^((LogXb − X)·H))^S
  const parts = (x: number, p: ArrayLike<number>) => {
    const [B, T, L, H, S] = [p[0]!, p[1]!, p[2]!, p[3]!, p[4]!]
    const c = Math.log10(2 ** (1 / S) - 1)
    const z = (L - x) * H + c
    // ln v = ln(1 + 10^z), and w = 10^z / (1 + 10^z)
    const w = logistic10(z)[1]
    const lnv = z > 0 ? z * LN10 + Math.log1p(10 ** -z) : Math.log1p(10 ** z)
    return { B, T, L, H, S, lnv, w, vS: Math.exp(-S * lnv) }
  }
  return {
    f(x, p) {
      const { B, T, vS } = parts(x, p)
      return B + (T - B) * vS
    },
    grad(x, p, g) {
      const { B, T, L, H, S, lnv, w, vS } = parts(x, p)
      const dz = -(T - B) * S * vS * w * LN10 // ∂f/∂z
      const a = 2 ** (1 / S)
      const dcdS = (a * LN2 * (-1 / (S * S))) / ((a - 1) * LN10)
      g[0] = 1 - vS
      g[1] = vS
      g[2] = dz * H
      g[3] = dz * (L - x)
      g[4] = dz * dcdS - (T - B) * vS * lnv
    },
  }
}

// ---- hyperbolas --------------------------------------------------------------------------------

/** Y = Max·X/(K + X). */
const hyperbola: Pick<CurveModel, 'f' | 'grad'> = {
  f: (x, p) => (p[0]! * x) / (p[1]! + x),
  grad(x, p, g) {
    const d = p[1]! + x
    g[0] = x / d
    g[1] = (-p[0]! * x) / (d * d)
  },
}

function hyperbolaInitial(x: ArrayLike<number>, y: ArrayLike<number>): number[] {
  const pr = profile(x, y)
  const kd = xAtLevel(pr, pr.ymax / 2)
  return [pr.ymax, kd > 0 ? kd : xRange(pr) / 4]
}

// ---- exponentials -------------------------------------------------------------------------------

function decayInitial(x: ArrayLike<number>, y: ArrayLike<number>): number[] {
  const pr = profile(x, y)
  const k = rateFromHalfLife(pr)
  const plateau = pr.ys[pr.ys.length - 1]!
  const first = pr.ys[0]!
  const back = k * pr.xmin
  const y0 = Math.abs(back) < 5 ? plateau + (first - plateau) * Math.exp(back) : first
  return [y0, plateau, k]
}

const halfLife = (k: number) => ({ HalfLife: LN2 / k, Tau: 1 / k })

// ---- the library -----------------------------------------------------------------------------

/** The eight standard dose-response forms with X = log(concentration) (doseForms.ts). */
const DOSE_LOG: EquationDef[] = DOSE_FORMS.map((d) => {
  const { id, name, category, params, mid, iMid } = doseForm(d, false)
  const agonist = d.kind === 'agonist'
  // Prism's inhibitor variable slope has the agonist's form, so inhibition gives HillSlope < 0.
  const sign = agonist || d.hill ? -1 : 1
  const z = d.hill ? `((${mid} − X)·HillSlope)` : sign < 0 ? `(${mid} − X)` : `(X − ${mid})`
  const half = d.normalized
    ? 'giving a response of 50'
    : `giving a half-maximal ${agonist ? 'response' : 'effect'}`
  return {
    id,
    name,
    category,
    formula: `Y = ${d.normalized ? '100' : 'Bottom + (Top − Bottom)'}/(1 + 10^${z})`,
    params,
    paramInfo: {
      ...(d.normalized ? {} : { Bottom: BOTTOM, Top: TOP }),
      [mid]: { description: `log of the ${d.kind} concentration ${half}` },
      ...(d.hill ? { HillSlope: agonist ? HILL : HILL_INHIBITION } : {}),
    },
    ...doseResponse(sign, {
      ...(d.normalized ? { bottom: 0, top: 100 } : {}),
      ...(d.hill ? { hill: true } : {}),
    }),
    initial: doseInitial(
      sign < 0 ? 'agonist' : 'inhibitor',
      d.normalized ? 'normalized' : 'full',
      d.hill,
    ),
    derived: d.normalized
      ? (p) => ({ [mid.slice(3)]: 10 ** p[iMid]! })
      : (p) => ({ [mid.slice(3)]: 10 ** p[iMid]!, Span: p[1]! - p[0]! }),
  }
})

const BASE_EQUATIONS: readonly EquationDef[] = [
  ...DOSE_LOG,
  {
    id: 'asymmetric-5pl',
    name: 'Asymmetric sigmoidal, 5PL, X is log(concentration)',
    category: 'Dose-response — Stimulation',
    formula:
      'LogXb = LogEC50 + (1/HillSlope)·log10(2^(1/S) − 1); ' +
      'Y = Bottom + (Top − Bottom)/(1 + 10^((LogXb − X)·HillSlope))^S',
    params: ['Bottom', 'Top', 'LogEC50', 'HillSlope', 'S'],
    paramInfo: {
      Bottom: BOTTOM,
      Top: TOP,
      LogEC50: {
        description: 'log of the concentration giving a response half-way between Bottom and Top',
      },
      HillSlope: HILL,
      S: { description: 'Asymmetry factor (1 = symmetric four-parameter curve)' },
    },
    ...asymmetric5PL(),
    initial: (x, y) => [...doseInitial('agonist', 'full', true)(x, y), 1],
    derived: (p) => ({
      EC50: 10 ** p[2]!,
      LogXb: p[2]! + Math.log10(2 ** (1 / p[4]!) - 1) / p[3]!,
    }),
  },
  // Binding
  {
    id: 'one-site-specific',
    name: 'One site — Specific binding',
    category: 'Binding',
    formula: 'Y = Bmax·X/(Kd + X)',
    params: ['Bmax', 'Kd'],
    paramInfo: {
      Bmax: { description: 'Maximum specific binding' },
      Kd: { description: 'Equilibrium dissociation constant (X units)' },
    },
    ...hyperbola,
    initial: hyperbolaInitial,
  },
  {
    id: 'one-site-total',
    name: 'One site — Total',
    category: 'Binding',
    formula: 'Y = Bmax·X/(Kd + X) + NS·X + Background',
    params: ['Bmax', 'Kd', 'NS', 'Background'],
    paramInfo: {
      Bmax: { description: 'Maximum specific binding' },
      Kd: { description: 'Equilibrium dissociation constant (X units)' },
      NS: { description: 'Slope of nonspecific binding' },
      Background: {
        description: 'Binding with no radioligand',
        defaultConstraint: { constant: 0 },
      },
    },
    f: (x, p) => (p[0]! * x) / (p[1]! + x) + p[2]! * x + p[3]!,
    grad(x, p, g) {
      const d = p[1]! + x
      g[0] = x / d
      g[1] = (-p[0]! * x) / (d * d)
      g[2] = x
      g[3] = 1
    },
    initial(x, y) {
      const pr = profile(x, y)
      // Nonspecific slope from the upper half of X, where specific binding has saturated.
      const h = Math.floor(pr.xs.length / 2)
      const xs = pr.xs.slice(h)
      const ys = pr.ys.slice(h)
      let ns = 0
      if (xs.length >= 2) {
        const lin = polynomialRegression(xs, ys, 1)
        ns = Math.max(0, lin.coef[1]! / 2)
      }
      const spec = pr.ys.map((v, i) => v - ns * pr.xs[i]!)
      const bmax = maxOf(spec)
      const kd = xAtLevel({ ...pr, ys: spec }, bmax / 2)
      return [bmax, kd > 0 ? kd : xRange(pr) / 4, ns, 0]
    },
  },
  {
    id: 'one-site-fit-logic50',
    name: 'One site — Fit logIC50',
    category: 'Binding — Competitive',
    formula: 'Y = Bottom + (Top − Bottom)/(1 + 10^(X − LogIC50))',
    params: ['Bottom', 'Top', 'LogIC50'],
    paramInfo: {
      Bottom: BOTTOM,
      Top: TOP,
      LogIC50: { description: 'log of the competitor concentration displacing half the binding' },
    },
    ...doseResponse(1, {}),
    initial: doseInitial('inhibitor', 'full', false),
    derived: (p) => ({ IC50: 10 ** p[2]! }),
  },
  // Enzyme kinetics
  {
    id: 'michaelis-menten',
    name: 'Michaelis-Menten',
    category: 'Enzyme kinetics',
    formula: 'Y = Vmax·X/(Km + X)',
    params: ['Vmax', 'Km'],
    paramInfo: {
      Vmax: { description: 'Maximum enzyme velocity' },
      Km: { description: 'Michaelis-Menten constant (substrate giving half-maximal velocity)' },
    },
    ...hyperbola,
    initial: hyperbolaInitial,
  },
  {
    id: 'substrate-inhibition',
    name: 'Substrate inhibition',
    category: 'Enzyme kinetics',
    formula: 'Y = Vmax·X/(Km + X·(1 + X/Ki))',
    params: ['Vmax', 'Km', 'Ki'],
    paramInfo: {
      Vmax: { description: 'Maximum enzyme velocity without substrate inhibition' },
      Km: { description: 'Michaelis-Menten constant' },
      Ki: { description: 'Dissociation constant for substrate binding the inhibitory site' },
    },
    f: (x, p) => (p[0]! * x) / (p[1]! + x * (1 + x / p[2]!)),
    grad(x, p, g) {
      const d = p[1]! + x * (1 + x / p[2]!)
      g[0] = x / d
      g[1] = (-p[0]! * x) / (d * d)
      g[2] = (p[0]! * x * ((x * x) / (p[2]! * p[2]!))) / (d * d)
    },
    initial(x, y) {
      const pr = profile(x, y)
      const k = argmax(pr.ys)
      const xpeak = pr.xs[k]! > 0 ? pr.xs[k]! : xRange(pr) / 2
      let km = xAtLevel(
        { ...pr, xs: pr.xs.slice(0, k + 1), ys: pr.ys.slice(0, k + 1) },
        pr.ymax / 2,
      )
      if (!(km > 0) || km >= xpeak) km = xpeak / 4
      const ki = (xpeak * xpeak) / km
      return [pr.ymax * (1 + 2 * Math.sqrt(km / ki)), km, ki]
    },
  },
  // Exponential
  {
    id: 'one-phase-decay',
    name: 'One phase decay',
    category: 'Exponential',
    formula: 'Y = (Y0 − Plateau)·exp(−K·X) + Plateau',
    params: ['Y0', 'Plateau', 'K'],
    paramInfo: {
      Y0: { description: 'Y value when X is zero' },
      Plateau: { description: 'Y value at infinite times' },
      K: { description: 'Rate constant (inverse of X units)' },
    },
    f: (x, p) => (p[0]! - p[1]!) * Math.exp(-p[2]! * x) + p[1]!,
    grad(x, p, g) {
      const e = Math.exp(-p[2]! * x)
      g[0] = e
      g[1] = 1 - e
      g[2] = -x * (p[0]! - p[1]!) * e
    },
    initial: decayInitial,
    derived: (p) => ({ ...halfLife(p[2]!), Span: p[0]! - p[1]! }),
  },
  {
    id: 'one-phase-association',
    name: 'One phase association',
    category: 'Exponential',
    formula: 'Y = Y0 + (Plateau − Y0)·(1 − exp(−K·X))',
    params: ['Y0', 'Plateau', 'K'],
    paramInfo: {
      Y0: { description: 'Y value when X is zero' },
      Plateau: { description: 'Y value at infinite times' },
      K: { description: 'Rate constant (inverse of X units)' },
    },
    f: (x, p) => p[0]! + (p[1]! - p[0]!) * -Math.expm1(-p[2]! * x),
    grad(x, p, g) {
      const e = Math.exp(-p[2]! * x)
      g[0] = e
      g[1] = 1 - e
      g[2] = (p[1]! - p[0]!) * x * e
    },
    initial: decayInitial,
    derived: (p) => ({ ...halfLife(p[2]!), Span: p[1]! - p[0]! }),
  },
  {
    id: 'two-phase-decay',
    name: 'Two phase decay',
    category: 'Exponential',
    formula:
      'Y = Plateau + SpanFast·exp(−KFast·X) + SpanSlow·exp(−KSlow·X); ' +
      'SpanFast = (Y0 − Plateau)·PercentFast/100, SpanSlow = (Y0 − Plateau)·(100 − PercentFast)/100',
    params: ['Y0', 'Plateau', 'KFast', 'KSlow', 'PercentFast'],
    paramInfo: {
      Y0: { description: 'Y value when X is zero' },
      Plateau: { description: 'Y value at infinite times' },
      KFast: { description: 'Rate constant of the fast phase' },
      KSlow: { description: 'Rate constant of the slow phase' },
      PercentFast: {
        description: 'Percentage of the span due to the fast phase',
        defaultConstraint: { bounds: [0, 100] },
      },
    },
    f(x, p) {
      const pf = p[4]! / 100
      return p[1]! + (p[0]! - p[1]!) * (pf * Math.exp(-p[2]! * x) + (1 - pf) * Math.exp(-p[3]! * x))
    },
    grad(x, p, g) {
      const s = p[0]! - p[1]!
      const pf = p[4]! / 100
      const eF = Math.exp(-p[2]! * x)
      const eS = Math.exp(-p[3]! * x)
      const m = pf * eF + (1 - pf) * eS
      g[0] = m
      g[1] = 1 - m
      g[2] = -s * pf * x * eF
      g[3] = -s * (1 - pf) * x * eS
      g[4] = (s * (eF - eS)) / 100
    },
    initial(x, y) {
      const [y0, plateau, k] = decayInitial(x, y) as [number, number, number]
      return [y0, plateau, 4 * k, k / 4, 50]
    },
    derived: (p) => ({
      HalfLifeFast: LN2 / p[2]!,
      HalfLifeSlow: LN2 / p[3]!,
      SpanFast: ((p[0]! - p[1]!) * p[4]!) / 100,
      SpanSlow: ((p[0]! - p[1]!) * (100 - p[4]!)) / 100,
    }),
  },
  {
    id: 'exponential-growth',
    name: 'Exponential growth',
    category: 'Exponential',
    formula: 'Y = Y0·exp(K·X)',
    params: ['Y0', 'K'],
    paramInfo: {
      Y0: { description: 'Y value when X is zero' },
      K: { description: 'Rate constant (inverse of X units)' },
    },
    f: (x, p) => p[0]! * Math.exp(p[1]! * x),
    grad(x, p, g) {
      const e = Math.exp(p[1]! * x)
      g[0] = e
      g[1] = p[0]! * x * e
    },
    initial(x, y) {
      // Log-linear regression on the positive Ys.
      const xs: number[] = []
      const ls: number[] = []
      for (let i = 0; i < x.length; i++) {
        if (y[i]! > 0) {
          xs.push(x[i]!)
          ls.push(Math.log(y[i]!))
        }
      }
      if (xs.length >= 2 && maxOf(xs) > minOf(xs)) {
        const lin = polynomialRegression(xs, ls, 1)
        return [Math.exp(lin.coef[0]!), lin.coef[1]!]
      }
      const pr = profile(x, y)
      return [pr.ys[0]!, 1 / xRange(pr)]
    },
    derived: (p) => ({ DoublingTime: LN2 / p[1]! }),
  },
  // Lines and polynomials
  {
    id: 'straight-line',
    name: 'Straight line',
    category: 'Lines and polynomials',
    formula: 'Y = YIntercept + Slope·X',
    params: ['YIntercept', 'Slope'],
    paramInfo: {
      YIntercept: { description: 'Y value when X is zero' },
      Slope: { description: 'Change in Y per unit X' },
    },
    f: (x, p) => p[0]! + p[1]! * x,
    grad(x, _p, g) {
      g[0] = 1
      g[1] = x
    },
    initial: (x, y) => Array.from(polynomialRegression(x, y, 1).coef),
  },
  polynomialEquation(2, 'Second order polynomial (quadratic)'),
  polynomialEquation(3, 'Third order polynomial (cubic)'),
  // Growth and sigmoidal
  {
    id: 'boltzmann-sigmoidal',
    name: 'Boltzmann sigmoidal',
    category: 'Growth and sigmoidal',
    formula: 'Y = Bottom + (Top − Bottom)/(1 + exp((V50 − X)/Slope))',
    params: ['Bottom', 'Top', 'V50', 'Slope'],
    paramInfo: {
      Bottom: BOTTOM,
      Top: TOP,
      V50: { description: 'X value half-way between Bottom and Top' },
      Slope: { description: 'Steepness of the curve (X units)' },
    },
    f(x, p) {
      return p[0]! + (p[1]! - p[0]!) * logisticE((p[2]! - x) / p[3]!)[0]
    },
    grad(x, p, g) {
      const z = (p[2]! - x) / p[3]!
      const [s, c] = logisticE(z)
      const span = p[1]! - p[0]!
      g[0] = c
      g[1] = s
      g[2] = (-span * s * c) / p[3]!
      g[3] = (span * s * c * z) / p[3]!
    },
    initial(x, y) {
      const pr = profile(x, y)
      return [pr.ymin, pr.ymax, xAtLevel(pr, (pr.ymin + pr.ymax) / 2), (pr.trend * xRange(pr)) / 10]
    },
  },
  {
    id: 'gompertz',
    name: 'Gompertz growth',
    category: 'Growth and sigmoidal',
    formula: 'Y = YM·(Y0/YM)^exp(−K·X)',
    params: ['YM', 'Y0', 'K'],
    paramInfo: {
      YM: { description: 'Maximum population (plateau)' },
      Y0: { description: 'Starting population (Y at X = 0)' },
      K: { description: 'Rate constant (inverse of X units)' },
    },
    f(x, p) {
      return p[0]! * Math.exp(Math.exp(-p[2]! * x) * Math.log(p[1]! / p[0]!))
    },
    grad(x, p, g) {
      const E = Math.exp(-p[2]! * x)
      const lr = Math.log(p[1]! / p[0]!)
      const f = p[0]! * Math.exp(E * lr)
      g[0] = ((1 - E) * f) / p[0]!
      g[1] = (E * f) / p[1]!
      g[2] = -f * lr * x * E
    },
    initial(x, y) {
      const [ym, y0, xi] = growthStart(x, y)
      const q = Math.log(ym / y0)
      // Inflection at Y = YM/e, where exp(−K·X) = 1/ln(YM/Y0).
      const k = q > 1 && xi > 0 ? Math.log(q) / xi : 3 / xRange(profile(x, y))
      return [ym, y0, k]
    },
  },
  {
    id: 'logistic-growth',
    name: 'Logistic growth',
    category: 'Growth and sigmoidal',
    formula: 'Y = YM·Y0/((YM − Y0)·exp(−K·X) + Y0)',
    params: ['YM', 'Y0', 'K'],
    paramInfo: {
      YM: { description: 'Maximum population (plateau)' },
      Y0: { description: 'Starting population (Y at X = 0)' },
      K: { description: 'Rate constant (inverse of X units)' },
    },
    f(x, p) {
      return (p[0]! * p[1]!) / ((p[0]! - p[1]!) * Math.exp(-p[2]! * x) + p[1]!)
    },
    grad(x, p, g) {
      const [ym, y0, k] = [p[0]!, p[1]!, p[2]!]
      const E = Math.exp(-k * x)
      const d = (ym - y0) * E + y0
      const d2 = d * d
      g[0] = (y0 * y0 * (1 - E)) / d2
      g[1] = (ym * ym * E) / d2
      g[2] = (ym * y0 * (ym - y0) * x * E) / d2
    },
    initial(x, y) {
      const [ym, y0, xi] = growthStart(x, y)
      // Inflection at Y = YM/2, where exp(−K·X) = Y0/(YM − Y0).
      const q = (ym - y0) / y0
      const k = q > 1 && xi > 0 ? Math.log(q) / xi : 3 / xRange(profile(x, y))
      return [ym, y0, k]
    },
  },
  // Gaussian
  {
    id: 'gaussian',
    name: 'Gaussian',
    category: 'Gaussian',
    formula: 'Y = Amplitude·exp(−0.5·((X − Mean)/SD)²)',
    params: ['Amplitude', 'Mean', 'SD'],
    paramInfo: {
      Amplitude: { description: 'Height of the peak' },
      Mean: { description: 'X value at the peak' },
      SD: { description: 'Width of the peak (standard deviation)' },
    },
    f(x, p) {
      const z = (x - p[1]!) / p[2]!
      return p[0]! * Math.exp(-0.5 * z * z)
    },
    grad(x, p, g) {
      const z = (x - p[1]!) / p[2]!
      const e = Math.exp(-0.5 * z * z)
      g[0] = e
      g[1] = (p[0]! * e * z) / p[2]!
      g[2] = (p[0]! * e * z * z) / p[2]!
    },
    initial(x, y) {
      const pr = profile(x, y)
      const k = argmax(pr.ys)
      const amp = pr.ys[k]!
      const mean = pr.xs[k]!
      // Full width at half maximum from the half-height crossings on each side.
      const left = xAtLevel(
        { ...pr, xs: pr.xs.slice(0, k + 1).reverse(), ys: pr.ys.slice(0, k + 1).reverse() },
        amp / 2,
      )
      const right = xAtLevel({ ...pr, xs: pr.xs.slice(k), ys: pr.ys.slice(k) }, amp / 2)
      const fwhm = right - left
      const sd = fwhm > 0 ? fwhm / (2 * Math.sqrt(2 * LN2)) : xRange(pr) / 6
      return [amp, mean, sd]
    },
    derived: (p) => ({ FWHM: 2 * Math.sqrt(2 * LN2) * Math.abs(p[2]!) }),
  },
]

/** YM, Y0 (both > 0) and the X at which Y is half-way, for growth curves. */
function growthStart(x: ArrayLike<number>, y: ArrayLike<number>): [number, number, number] {
  const pr = profile(x, y)
  const ym = pr.ymax > 0 ? pr.ymax * 1.05 : 1
  let y0 = pr.ys[0]!
  if (!(y0 > 0) || y0 >= ym) y0 = Math.min(ym / 100, pr.ymin > 0 ? pr.ymin : ym / 100)
  const xi = xAtLevel(pr, (y0 + ym) / 2)
  return [ym, y0, xi]
}

function polynomialEquation(degree: 2 | 3, name: string): EquationDef {
  const params = Array.from({ length: degree + 1 }, (_, k) => `B${k}`)
  return {
    id: `polynomial-${degree}`,
    name,
    category: 'Lines and polynomials',
    formula: `Y = ${params.map((b, k) => (k === 0 ? b : k === 1 ? `${b}·X` : `${b}·X^${k}`)).join(' + ')}`,
    params,
    paramInfo: Object.fromEntries(
      params.map((b, k) => [
        b,
        { description: k === 0 ? 'Y value when X is zero' : `Coefficient of X^${k}` },
      ]),
    ),
    f(x, p) {
      let v = 0
      for (let k = degree; k >= 0; k--) v = v * x + p[k]!
      return v
    },
    grad(x, _p, g) {
      let v = 1
      for (let k = 0; k <= degree; k++, v *= x) g[k] = v
    },
    initial: (x, y) => Array.from(polynomialRegression(x, y, degree).coef),
  }
}

/** Order of the categories in pickers. */
const CATEGORY_ORDER: readonly EquationCategory[] = [
  'Dose-response — Stimulation',
  'Dose-response — Inhibition',
  'Dose-response — Special, X is concentration',
  'Dose-response — Special, X is log(concentration)',
  'Binding',
  'Binding — Competitive',
  'Binding — Kinetics',
  'Enzyme kinetics',
  'Enzyme kinetics — Inhibition',
  'Exponential',
  'Lines and polynomials',
  'Growth and sigmoidal',
  'Gaussian',
  'Sine waves and peaks',
  'Linear-quadratic (radiation)',
  'Classic equations',
]

/** Every built-in equation, grouped by category (stable within a category). */
export const EQUATIONS: readonly EquationDef[] = [
  ...BASE_EQUATIONS,
  ...LAB_EQUATIONS,
  ...MORE_EQUATIONS,
]
  .map((e, i) => ({ e, i }))
  .sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.e.category) - CATEGORY_ORDER.indexOf(b.e.category) || a.i - b.i,
  )
  .map((x) => x.e)

const BY_ID = new Map(EQUATIONS.map((e) => [e.id, e]))

/** Looks up a built-in equation by id. */
export function equation(id: string): EquationDef | undefined {
  return BY_ID.get(id)
}

/**
 * FitOptions constraints and bounds from an equation's paramInfo defaults. A data set constant
 * takes `dataSetValues` (one value per data set); without them it is fitted. A 'meanX' constant
 * takes the mean X of each of `data`.
 */
export function defaultFitOptions(
  eq: EquationDef,
  dataSetValues?: readonly number[],
  data?: readonly { x: ArrayLike<number> }[],
): Pick<FitOptions, 'constraints' | 'bounds'> {
  const constraints: ParamConstraint[] = []
  const bounds: ([number, number] | null)[] = []
  for (const name of eq.params) {
    const d = eq.paramInfo[name]?.defaultConstraint
    if (typeof d === 'object' && 'constant' in d)
      constraints.push({ kind: 'constant', value: d.constant })
    else if (d === 'shared') constraints.push({ kind: 'shared' })
    else if (d === 'dataSetConstant' && dataSetValues)
      constraints.push({ kind: 'dataSetConstant', values: dataSetValues })
    else if (d === 'meanX' && data)
      constraints.push({ kind: 'dataSetConstant', values: data.map((q) => meanOf(q.x)) })
    else constraints.push({ kind: 'fit' })
    bounds.push(typeof d === 'object' && 'bounds' in d ? d.bounds : null)
  }
  return { constraints, bounds }
}

/** Mean of the finite values (Prism's "Mean X" of the rows with Y values). */
export function meanOf(a: ArrayLike<number>): number {
  let s = 0
  let n = 0
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!
    if (Number.isFinite(v)) {
      s += v
      n++
    }
  }
  return n ? s / n : Number.NaN
}
