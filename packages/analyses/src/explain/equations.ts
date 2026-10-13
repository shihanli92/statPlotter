import { EQUATIONS, type EquationDef, equation } from '@ps/stats'

// Roadmap 51e (design §9.1, U10): what the curve-fit picker and its checks know about each built-in
// equation — the goals it serves, the X scale it expects, each parameter's meaning and unit, the
// midpoint and plateaus the dose-response warnings read, the models it is a special case of
// (nested, for the extra sum-of-squares F test), the same model on the other X scale, and typical
// values for its thumbnail. Words for people, in @ps/analyses (the equations' numbers stay in
// @ps/stats). A test asserts every equation of `EQUATIONS` is covered.

/** The goals of the picker (§9.1's table), in the order it lists them. */
export type ModelGoalId =
  | 'stimulation'
  | 'inhibition'
  | 'pharmacology'
  | 'saturation'
  | 'competition'
  | 'bindingKinetics'
  | 'enzyme'
  | 'decay'
  | 'growth'
  | 'standard'
  | 'lines'
  | 'peaks'
  | 'radiation'

export interface ModelGoal {
  id: ModelGoalId
  title: string
  /** One line under the title: what the experiment is. */
  description: string
  /** What X the goal's models expect, in words. */
  xExpected: string
  /** The goal's models, the usual choice first. */
  models: readonly string[]
  /** Params a model picked from this goal also sets (Standard curve: interpolate unknowns). */
  sets?: Readonly<Record<string, unknown>>
}

/**
 * The X a model expects: log(concentration), concentrations (or doses), time, or any values on a
 * linear scale (lines, peaks: no expectation to check).
 */
export type XScale = 'log' | 'concentration' | 'time' | 'linear'

/** A parameter's unit, in terms of the table's X and Y. */
export type ParamUnit =
  | 'y'
  | 'x'
  | 'logX'
  | 'perX'
  | 'perXSquared'
  | 'perMolarPerX'
  | 'yPerX'
  | 'yPerDecade'
  | 'logY'
  | 'logYPerX'
  | 'coefficient'
  | 'none'
  | 'percent'
  | 'fraction'
  | 'radians'
  /** A concentration typed in the data sets' titles (an inhibitor's, a modulator's). */
  | 'title'
  /** The log of such a concentration (molar). */
  | 'logTitle'
  /** A constant you set (its unit is in its meaning). */
  | 'given'

export interface ParamMeta {
  /** Plain words: "the concentration giving a response half-way between Bottom and Top". */
  meaning: string
  unit: ParamUnit
}

export interface EquationMeta {
  id: string
  /** The goals listing it (empty: only under All equations). */
  goals: readonly ModelGoalId[]
  xScale: XScale
  /** The shape in a few words ("S-shaped rise from Bottom to Top"). */
  shape: string
  params: Readonly<Record<string, ParamMeta>>
  /** The parameter on X's scale where the response is half-way (EC50, IC50, Kd, Km, V50…). */
  midpoint?: string
  /** The parameters giving the plateaus, on Y's scale. */
  top?: string
  bottom?: string
  /** This model is `model` with `when` (a special case: the two are nested). */
  specialCaseOf: readonly { model: string; when: string }[]
  /** The same model with X on the other scale (log(concentration) ⇄ concentration). */
  otherScale?: string
  /** Typical values for the thumbnail: X from `x[0]` to `x[1]`, spaced evenly or by ratio. */
  typical: { x: readonly [number, number]; spacing: 'lin' | 'log'; p: readonly number[] }
}

// ---- units ------------------------------------------------------------------------------------

const UNIT_WORDS: Record<ParamUnit, string> = {
  y: 'Y’s units',
  x: 'X’s units',
  logX: 'log of X’s units',
  perX: 'per unit of X (e.g. per minute)',
  perXSquared: 'per unit of X squared',
  perMolarPerX: 'M⁻¹ per unit of X',
  yPerX: 'Y’s units per unit of X',
  yPerDecade: 'Y’s units per tenfold change of X',
  logY: 'log of Y’s units',
  logYPerX: 'log of Y per unit of X',
  coefficient: 'Y’s units per power of X',
  none: 'no unit',
  percent: '%',
  fraction: 'a fraction (0 to 1)',
  radians: 'radians',
  title: 'the units of the data sets’ titles',
  logTitle: 'log of a molar concentration',
  given: 'you set it',
}

/** A unit in words. */
export const unitWords = (u: ParamUnit): string => UNIT_WORDS[u]

/** The unit of a parameter by its name, in most equations (equations override). */
const UNIT_BY_NAME: Readonly<Record<string, ParamUnit>> = {
  Bottom: 'y',
  Top: 'y',
  Plateau: 'y',
  Plateau1: 'y',
  Plateau2: 'y',
  Dip: 'y',
  Y0: 'y',
  YM: 'y',
  Ymax: 'y',
  Ymax1: 'y',
  Ymax2: 'y',
  Vmax: 'y',
  Vo: 'y',
  Bmax: 'y',
  BmaxHi: 'y',
  BmaxLo: 'y',
  Effectmax: 'y',
  Basal: 'y',
  Background: 'y',
  Baseline: 'y',
  Amplitude: 'y',
  Amplitude1: 'y',
  Amplitude2: 'y',
  Span: 'y',
  Span1: 'y',
  Span2: 'y',
  Intercept: 'y',
  Intercept1: 'y',
  YIntercept: 'y',
  Ycross: 'y',
  B0: 'y',
  EC50: 'x',
  IC50: 'x',
  EC50_1: 'x',
  EC50_2: 'x',
  ECF: 'x',
  AbsoluteIC50: 'x',
  EC50Control: 'x',
  Kd: 'x',
  KdHi: 'x',
  KdLo: 'x',
  Km: 'x',
  Khalf: 'x',
  KA: 'x',
  X0: 'x',
  Xcross: 'x',
  Center: 'x',
  Center1: 'x',
  Center2: 'x',
  Width: 'x',
  Width1: 'x',
  Width2: 'x',
  SD: 'x',
  SD1: 'x',
  SD2: 'x',
  Mean1: 'x',
  Mean2: 'x',
  Wavelength: 'x',
  V50: 'x',
  Te: 'x',
  Tm: 'x',
  GeoMean: 'x',
  Delta: 'x',
  XMean: 'x',
  LogEC50: 'logX',
  LogIC50: 'logX',
  LogEC50_1: 'logX',
  LogEC50_2: 'logX',
  LogECF: 'logX',
  LogAbsoluteIC50: 'logX',
  LogIC50Hi: 'logX',
  LogIC50Lo: 'logX',
  LogEC50Control: 'logX',
  logKi: 'logX',
  LogKi: 'logX',
  logKiHi: 'logX',
  logKiLo: 'logX',
  logKD: 'logX',
  logKA: 'logX',
  K: 'perX',
  k: 'perX',
  KFast: 'perX',
  KSlow: 'perX',
  KMedium: 'perX',
  K1: 'perX',
  K2: 'perX',
  Koff: 'perX',
  Kon: 'perMolarPerX',
  HillSlope: 'none',
  h: 'none',
  nH1: 'none',
  nH2: 'none',
  n: 'none',
  S: 'none',
  F: 'percent',
  Frac: 'fraction',
  FractionHi: 'fraction',
  PercentFast: 'percent',
  PercentSlow: 'percent',
  Slope: 'yPerX',
  Slope1: 'yPerX',
  Slope2: 'yPerX',
  B1: 'coefficient',
  B2: 'coefficient',
  B3: 'coefficient',
  B4: 'coefficient',
  B5: 'coefficient',
  B6: 'coefficient',
  PhaseShift: 'radians',
  Offset: 'radians',
  I: 'title',
  B: 'title',
  Allo: 'title',
  HotNM: 'given',
  HotKdNM: 'given',
  HotKdNMHi: 'given',
  HotKdNMLo: 'given',
  Hot: 'given',
  KdnM: 'given',
  SpAct: 'given',
  SpecAct: 'given',
  Vol: 'given',
  Et: 'given',
  Time0: 'given',
  RadioligandNM: 'given',
  HotKDnm: 'given',
  L: 'given',
  N: 'given',
  tau: 'none',
  logtau: 'none',
  alpha: 'none',
  Alpha: 'none',
  pA2: 'none',
  SchildSlope: 'none',
  EC50Ratio: 'none',
  GeoSD: 'none',
}

// ---- plain words for the parameters people read most --------------------------------------------

const BOTTOM = 'the response at the lowest doses (the bottom plateau)'
const TOP = 'the response at the highest doses (the top plateau)'
const HILL_UP = 'the steepness: 1 is a standard curve, larger is steeper'
const HILL_DOWN = 'the steepness, negative for a falling curve: −1 is a standard curve'

/** Meanings that read better than the equations' own descriptions, by equation then name. */
const MEANING: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'agonist-response': {
    Bottom: BOTTOM,
    Top: TOP,
    LogEC50: 'log of the EC50: the dose giving a response half-way between Bottom and Top',
  },
  'agonist-response-variable-slope': {
    Bottom: BOTTOM,
    Top: TOP,
    LogEC50: 'log of the EC50: the dose giving a response half-way between Bottom and Top',
    HillSlope: HILL_UP,
  },
  'agonist-normalized-response': {
    LogEC50: 'log of the EC50: the dose giving a response of 50% (Bottom 0, Top 100 fixed)',
  },
  'agonist-normalized-response-variable-slope': {
    LogEC50: 'log of the EC50: the dose giving a response of 50% (Bottom 0, Top 100 fixed)',
    HillSlope: HILL_UP,
  },
  'inhibitor-response': {
    Bottom: 'the response at the highest doses (the bottom plateau)',
    Top: 'the response without inhibitor (the top plateau)',
    LogIC50: 'log of the IC50: the dose giving a response half-way between Top and Bottom',
  },
  'inhibitor-response-variable-slope': {
    Bottom: 'the response at the highest doses (the bottom plateau)',
    Top: 'the response without inhibitor (the top plateau)',
    LogIC50: 'log of the IC50: the dose giving a response half-way between Top and Bottom',
    HillSlope: HILL_DOWN,
  },
  'inhibitor-normalized-response': {
    LogIC50: 'log of the IC50: the dose giving a response of 50% (Top 100, Bottom 0 fixed)',
  },
  'inhibitor-normalized-response-variable-slope': {
    LogIC50: 'log of the IC50: the dose giving a response of 50% (Top 100, Bottom 0 fixed)',
    HillSlope: HILL_DOWN,
  },
  'agonist-conc-response': {
    Bottom: BOTTOM,
    Top: TOP,
    EC50: 'the concentration giving a response half-way between Bottom and Top',
  },
  'agonist-conc-response-variable-slope': {
    Bottom: BOTTOM,
    Top: TOP,
    EC50: 'the concentration giving a response half-way between Bottom and Top',
    HillSlope: HILL_UP,
  },
  'inhibitor-conc-response': {
    Bottom: 'the response at the highest concentrations (the bottom plateau)',
    Top: 'the response without inhibitor (the top plateau)',
    IC50: 'the concentration giving a response half-way between Top and Bottom',
  },
  'inhibitor-conc-response-variable-slope': {
    Bottom: 'the response at the highest concentrations (the bottom plateau)',
    Top: 'the response without inhibitor (the top plateau)',
    IC50: 'the concentration giving a response half-way between Top and Bottom',
    HillSlope: HILL_DOWN,
  },
  'one-site-specific': {
    Bmax: 'the most binding: every site occupied (same units as Y)',
    Kd: 'the ligand concentration occupying half the sites',
  },
  'michaelis-menten': {
    Vmax: 'the highest velocity, with substrate saturating the enzyme',
    Km: 'the substrate concentration giving half of Vmax',
  },
  'one-phase-decay': {
    Y0: 'the value at time zero',
    Plateau: 'the value it decays to',
    K: 'the rate constant; the half-life is ln(2)/K',
  },
  'exponential-growth': {
    Y0: 'the value at time zero',
    K: 'the rate constant; the doubling time is ln(2)/K',
  },
  'logistic-growth': {
    YM: 'the maximum the population reaches',
    Y0: 'the population at time zero',
    K: 'the rate constant',
  },
  gaussian: {
    Amplitude: 'the height of the peak',
    Mean: 'the X value at the peak',
    SD: 'the width of the peak (its standard deviation)',
  },
  'straight-line': {
    YIntercept: 'the Y value where the line crosses X = 0',
    Slope: 'how much Y changes per unit of X',
  },
  'horizontal-line': { Mean: 'the level of the line: the mean Y' },
}

/** Units that differ from the name's usual one, by equation then name. */
const UNIT: Readonly<Record<string, Readonly<Record<string, ParamUnit>>>> = {
  'horizontal-line': { Mean: 'y' },
  gaussian: { Mean: 'x' },
  'cumulative-gaussian-percent': { Mean: 'x' },
  'cumulative-gaussian-fraction': { Mean: 'x' },
  'cumulative-gaussian-counts': { Mean: 'x' },
  'one-site-total': { NS: 'yPerX' },
  'one-site-total-and-nonspecific': { NS: 'yPerX' },
  'two-sites-total-and-nonspecific': { NS: 'yPerX' },
  'one-site-total-depletion': { NS: 'fraction', Bmax: 'y', KdnM: 'given' },
  'one-site-competitive-depletion': { NS: 'fraction' },
  'dissociation-one-phase': { NS: 'y' },
  'association-then-dissociation': { NS: 'y' },
  'boltzmann-sigmoidal': { Slope: 'x' },
  'semilog-x-log': { Yintercept: 'y', Slope: 'yPerDecade' },
  'semilog-y-log': { Yintercept: 'logY', Slope: 'logYPerX' },
  'log-log-line': { Yintercept: 'logY', slope: 'none' },
  'log-exponential-growth': { logY0: 'logY', k: 'perX' },
  'operational-depletion': { logKA: 'logX', logtau: 'none' },
  'operational-partial-agonist': { logKA: 'logX', logtau: 'none' },
  'operational-depletion-conc': { KA: 'x', tau: 'none' },
  'operational-partial-agonist-conc': { KA: 'x', tau: 'none' },
  'allosteric-ec50-shift': { LogKB: 'logTitle', Logalpha: 'none' },
  'allosteric-ec50-shift-conc': { KB: 'title', alpha: 'none' },
  'one-site-allosteric-modulator': { KDHot: 'x', logKB: 'logTitle', logalpha: 'none' },
  'allosteric-modulator-competitive': { logKb: 'logX', logAlpha: 'none', Y0: 'y' },
  'homologous-one-site': { HotnM: 'title', Bmax: 'y', Bottom: 'y' },
  'association-two-conc': { Hotnm: 'title' },
  'kinetics-competitive-binding': {
    K1: 'given',
    K2: 'given',
    K3: 'perMolarPerX',
    K4: 'perX',
    I: 'title',
  },
  'competitive-inhibition': { Ki: 'title' },
  'noncompetitive-inhibition': { Ki: 'title' },
  'mixed-inhibition': { Ki: 'title' },
  'uncompetitive-inhibition': { AlphaKi: 'title' },
  'substrate-inhibition': { Ki: 'x' },
  'morrison-ki': { Ki: 'x', S: 'given', Km: 'given' },
  kcat: { kcat: 'perX', Km: 'x' },
  'two-lines-crossing': { Slope: 'yPerX' },
  'gaddum-schild': { pA2: 'none' },
  lognormal: { A: 'y' },
  'linear-quadratic-fs': { A: 'perX', B: 'perXSquared' },
  'linear-quadratic-ps': { A: 'perX', B: 'perXSquared' },
  'linear-quadratic-fd': { A: 'perX', B: 'perXSquared' },
  'linear-quadratic-pd': { A: 'perX', B: 'perXSquared' },
  'linear-quadratic-ns': { A: 'perX', B: 'perXSquared' },
  'linear-quadratic-nd': { A: 'perX', B: 'perXSquared' },
  'classic-power-series': { A: 'y', B: 'none', C: 'y', D: 'none' },
  'classic-sine-wave': { Frequency: 'perX' },
}

// ---- per-equation facts ------------------------------------------------------------------------

type Typical = [number, number, 'lin' | 'log', number[]]

interface Spec {
  goals?: ModelGoalId[]
  x: XScale
  shape: string
  midpoint?: string
  top?: string
  bottom?: string
  /** [model, when]: this model is that model with `when`. */
  of?: [string, string][]
  other?: string
  t: Typical
}

const DOSE_UP = 'S-shaped rise from Bottom to Top'
const DOSE_DOWN = 'S-shaped fall from Top to Bottom'
const HYPERBOLA = 'rises steeply, then levels off at a plateau'

const SPECS: Readonly<Record<string, Spec>> = {
  // Dose-response: stimulation (X = log(concentration))
  'agonist-response': {
    goals: ['stimulation'],
    x: 'log',
    shape: `${DOSE_UP}, standard slope`,
    midpoint: 'LogEC50',
    top: 'Top',
    bottom: 'Bottom',
    of: [['agonist-response-variable-slope', 'HillSlope = 1']],
    other: 'agonist-conc-response',
    t: [-9, -4, 'lin', [5, 95, -6.5]],
  },
  'agonist-response-variable-slope': {
    goals: ['stimulation'],
    x: 'log',
    shape: `${DOSE_UP}, any steepness`,
    midpoint: 'LogEC50',
    top: 'Top',
    bottom: 'Bottom',
    of: [['asymmetric-5pl', 'S = 1']],
    other: 'agonist-conc-response-variable-slope',
    t: [-9, -4, 'lin', [5, 95, -6.5, 1.4]],
  },
  'agonist-normalized-response': {
    goals: ['stimulation'],
    x: 'log',
    shape: 'S-shaped rise from 0 to 100, standard slope',
    midpoint: 'LogEC50',
    of: [
      ['agonist-normalized-response-variable-slope', 'HillSlope = 1'],
      ['agonist-response', 'Bottom = 0 and Top = 100'],
    ],
    other: 'agonist-conc-normalized-response',
    t: [-9, -4, 'lin', [-6.5]],
  },
  'agonist-normalized-response-variable-slope': {
    goals: ['stimulation'],
    x: 'log',
    shape: 'S-shaped rise from 0 to 100, any steepness',
    midpoint: 'LogEC50',
    of: [['agonist-response-variable-slope', 'Bottom = 0 and Top = 100']],
    other: 'agonist-conc-normalized-response-variable-slope',
    t: [-9, -4, 'lin', [-6.5, 0.8]],
  },
  'asymmetric-5pl': {
    goals: ['stimulation', 'inhibition'],
    x: 'log',
    shape: 'S-shaped, one end steeper than the other',
    midpoint: 'LogEC50',
    top: 'Top',
    bottom: 'Bottom',
    other: 'asymmetric-5pl-conc',
    t: [-10, -2, 'lin', [5, 100, -6, 1.2, 1.8]],
  },
  'agonist-response-find-ecanything': {
    goals: ['stimulation'],
    x: 'log',
    shape: `${DOSE_UP}, reporting the dose at F% of the way`,
    top: 'Top',
    bottom: 'Bottom',
    other: 'agonist-conc-response-find-ecanything',
    t: [-9, -4, 'lin', [5, 95, -6.2, 1.2, 50]],
  },
  'biphasic-dose-response': {
    goals: ['stimulation'],
    x: 'log',
    shape: 'two rising phases at different doses',
    top: 'Top',
    bottom: 'Bottom',
    other: 'biphasic-dose-response-conc',
    t: [-11, -3, 'lin', [0, 100, 0.4, -9, 1.2, -5.5, 1]],
  },
  'bell-shaped-dose-response': {
    goals: ['stimulation'],
    x: 'log',
    shape: 'rises, then falls again at high doses',
    other: 'bell-shaped-dose-response-conc',
    t: [-11, -1, 'lin', [-85, 10, 5, -8, -4, 1.3, 1.1]],
  },
  // Dose-response: stimulation (X = concentration)
  'agonist-conc-response': {
    goals: ['stimulation'],
    x: 'concentration',
    shape: `${HYPERBOLA} (an S on a log axis), standard slope`,
    midpoint: 'EC50',
    top: 'Top',
    bottom: 'Bottom',
    of: [['agonist-conc-response-variable-slope', 'HillSlope = 1']],
    other: 'agonist-response',
    t: [1e-10, 1e-3, 'log', [5, 95, 3e-7]],
  },
  'agonist-conc-response-variable-slope': {
    goals: ['stimulation', 'standard'],
    x: 'concentration',
    shape: `${DOSE_UP} on a log axis, any steepness (4PL)`,
    midpoint: 'EC50',
    top: 'Top',
    bottom: 'Bottom',
    of: [['asymmetric-5pl-conc', 'S = 1']],
    other: 'agonist-response-variable-slope',
    t: [1e-10, 1e-3, 'log', [5, 95, 3e-7, 1.4]],
  },
  'agonist-conc-normalized-response': {
    goals: ['stimulation'],
    x: 'concentration',
    shape: 'rise from 0 to 100, standard slope',
    midpoint: 'EC50',
    of: [
      ['agonist-conc-normalized-response-variable-slope', 'HillSlope = 1'],
      ['agonist-conc-response', 'Bottom = 0 and Top = 100'],
    ],
    other: 'agonist-normalized-response',
    t: [1e-10, 1e-3, 'log', [3e-7]],
  },
  'agonist-conc-normalized-response-variable-slope': {
    goals: ['stimulation'],
    x: 'concentration',
    shape: 'rise from 0 to 100, any steepness',
    midpoint: 'EC50',
    of: [['agonist-conc-response-variable-slope', 'Bottom = 0 and Top = 100']],
    other: 'agonist-normalized-response-variable-slope',
    t: [1e-10, 1e-3, 'log', [3e-7, 0.8]],
  },
  // Dose-response: inhibition
  'inhibitor-response': {
    goals: ['inhibition'],
    x: 'log',
    shape: `${DOSE_DOWN}, standard slope`,
    midpoint: 'LogIC50',
    top: 'Top',
    bottom: 'Bottom',
    of: [['inhibitor-response-variable-slope', 'HillSlope = −1']],
    other: 'inhibitor-conc-response',
    t: [-9, -4, 'lin', [10, 100, -7]],
  },
  'inhibitor-response-variable-slope': {
    goals: ['inhibition'],
    x: 'log',
    shape: `${DOSE_DOWN}, any steepness`,
    midpoint: 'LogIC50',
    top: 'Top',
    bottom: 'Bottom',
    of: [['asymmetric-5pl', 'S = 1']],
    other: 'inhibitor-conc-response-variable-slope',
    t: [-9, -4, 'lin', [10, 100, -7, -1.2]],
  },
  'inhibitor-normalized-response': {
    goals: ['inhibition'],
    x: 'log',
    shape: 'S-shaped fall from 100 to 0, standard slope',
    midpoint: 'LogIC50',
    of: [
      ['inhibitor-normalized-response-variable-slope', 'HillSlope = −1'],
      ['inhibitor-response', 'Top = 100 and Bottom = 0'],
    ],
    other: 'inhibitor-conc-normalized-response',
    t: [-9, -4, 'lin', [-7]],
  },
  'inhibitor-normalized-response-variable-slope': {
    goals: ['inhibition'],
    x: 'log',
    shape: 'S-shaped fall from 100 to 0, any steepness',
    midpoint: 'LogIC50',
    of: [['inhibitor-response-variable-slope', 'Top = 100 and Bottom = 0']],
    other: 'inhibitor-conc-normalized-response-variable-slope',
    t: [-9, -4, 'lin', [-7, -0.9]],
  },
  'inhibitor-conc-response': {
    goals: ['inhibition'],
    x: 'concentration',
    shape: 'falls steeply, then levels off (an S on a log axis), standard slope',
    midpoint: 'IC50',
    top: 'Top',
    bottom: 'Bottom',
    of: [['inhibitor-conc-response-variable-slope', 'HillSlope = −1']],
    other: 'inhibitor-response',
    t: [1e-10, 1e-3, 'log', [10, 100, 1e-7]],
  },
  'inhibitor-conc-response-variable-slope': {
    goals: ['inhibition', 'standard'],
    x: 'concentration',
    shape: `${DOSE_DOWN} on a log axis, any steepness (4PL)`,
    midpoint: 'IC50',
    top: 'Top',
    bottom: 'Bottom',
    of: [['asymmetric-5pl-conc', 'S = 1']],
    other: 'inhibitor-response-variable-slope',
    t: [1e-10, 1e-3, 'log', [10, 100, 1e-7, -1.2]],
  },
  'inhibitor-conc-normalized-response': {
    goals: ['inhibition'],
    x: 'concentration',
    shape: 'fall from 100 to 0, standard slope',
    midpoint: 'IC50',
    of: [
      ['inhibitor-conc-normalized-response-variable-slope', 'HillSlope = −1'],
      ['inhibitor-conc-response', 'Top = 100 and Bottom = 0'],
    ],
    other: 'inhibitor-normalized-response',
    t: [1e-10, 1e-3, 'log', [1e-7]],
  },
  'inhibitor-conc-normalized-response-variable-slope': {
    goals: ['inhibition'],
    x: 'concentration',
    shape: 'fall from 100 to 0, any steepness',
    midpoint: 'IC50',
    of: [['inhibitor-conc-response-variable-slope', 'Top = 100 and Bottom = 0']],
    other: 'inhibitor-normalized-response-variable-slope',
    t: [1e-10, 1e-3, 'log', [1e-7, -0.9]],
  },
  'asymmetric-5pl-conc': {
    goals: ['stimulation', 'standard'],
    x: 'concentration',
    shape: 'S-shaped on a log axis, one end steeper (5PL)',
    midpoint: 'EC50',
    top: 'Top',
    bottom: 'Bottom',
    other: 'asymmetric-5pl',
    t: [1e-10, 1e-2, 'log', [5, 100, 1e-6, 1.2, 1.8]],
  },
  'biphasic-dose-response-conc': {
    goals: ['stimulation'],
    x: 'concentration',
    shape: 'two rising phases at different concentrations',
    top: 'Top',
    bottom: 'Bottom',
    other: 'biphasic-dose-response',
    t: [1e-11, 1e-3, 'log', [0, 100, 0.4, 1e-9, 1.2, 3e-6, 1]],
  },
  'bell-shaped-dose-response-conc': {
    goals: ['stimulation'],
    x: 'concentration',
    shape: 'rises, then falls again at high concentrations',
    other: 'bell-shaped-dose-response',
    t: [1e-11, 0.1, 'log', [-85, 10, 5, 1e-8, 1e-4, 1.3, 1.1]],
  },
  'operational-depletion-conc': {
    goals: ['pharmacology'],
    x: 'concentration',
    shape: 'agonist curves after receptor depletion, fit together',
    other: 'operational-depletion',
    t: [1e-10, 1e-3, 'log', [100, 0, 1e-6, 3, 1]],
  },
  'operational-partial-agonist-conc': {
    goals: ['pharmacology'],
    x: 'concentration',
    shape: 'a full agonist and partial agonists, fit together',
    other: 'operational-partial-agonist',
    t: [1e-10, 1e-3, 'log', [100, 0, 1, 1e-7, 1e-6, 0.5]],
  },
  'gaddum-schild-conc': {
    goals: ['pharmacology'],
    x: 'concentration',
    shape: 'agonist curves shifted right by an antagonist',
    of: [],
    other: 'gaddum-schild',
    t: [1e-11, 1e-3, 'log', [0, 100, 1e-8, 1, 8, 1, 1e-8]],
  },
  'gaddum-schild-slope1-conc': {
    goals: ['pharmacology'],
    x: 'concentration',
    shape: 'agonist curves shifted right by a competitive antagonist',
    of: [['gaddum-schild-conc', 'SchildSlope = 1']],
    other: 'gaddum-schild-slope1',
    t: [1e-11, 1e-3, 'log', [0, 100, 1e-8, 1, 8, 1e-8]],
  },
  'ec50-shift-conc': {
    goals: ['pharmacology'],
    x: 'concentration',
    shape: 'curves of one shape, each shifted by its own EC50 ratio',
    other: 'ec50-shift',
    t: [1e-11, 1e-4, 'log', [0, 100, 1e-8, 5, 1]],
  },
  'allosteric-ec50-shift-conc': {
    goals: ['pharmacology'],
    x: 'concentration',
    shape: 'agonist curves shifted by an allosteric modulator, to a limit',
    other: 'allosteric-ec50-shift',
    t: [1e-11, 1e-4, 'log', [0, 100, 1e-8, 1, 1e-6, 0.1, 1e-7]],
  },
  'agonist-conc-response-find-ecanything': {
    goals: ['stimulation'],
    x: 'concentration',
    shape: `${DOSE_UP} on a log axis, reporting the concentration at F%`,
    top: 'Top',
    bottom: 'Bottom',
    other: 'agonist-response-find-ecanything',
    t: [1e-10, 1e-3, 'log', [5, 95, 4e-7, 1.2, 50]],
  },
  'absolute-ic50-conc': {
    goals: ['inhibition'],
    x: 'concentration',
    shape: `${DOSE_DOWN} on a log axis, IC50 against a set 0% baseline`,
    top: 'Top',
    bottom: 'Bottom',
    other: 'absolute-ic50',
    t: [1e-10, 1e-3, 'log', [100, 10, -1, 1e-7, 0]],
  },
  'operational-depletion': {
    goals: ['pharmacology'],
    x: 'log',
    shape: 'agonist curves after receptor depletion, fit together',
    other: 'operational-depletion-conc',
    t: [-10, -3, 'lin', [100, 0, -6, 0.477121, 1]],
  },
  'operational-partial-agonist': {
    goals: ['pharmacology'],
    x: 'log',
    shape: 'a full agonist and partial agonists, fit together',
    other: 'operational-partial-agonist-conc',
    t: [-10, -3, 'lin', [100, 0, 1, -7, -6, -0.30103]],
  },
  'gaddum-schild': {
    goals: ['pharmacology'],
    x: 'log',
    shape: 'agonist curves shifted right by an antagonist',
    other: 'gaddum-schild-conc',
    t: [-11, -3, 'lin', [0, 100, -8, 1, 8, 1, 1e-8]],
  },
  'gaddum-schild-slope1': {
    goals: ['pharmacology'],
    x: 'log',
    shape: 'agonist curves shifted right by a competitive antagonist',
    of: [['gaddum-schild', 'SchildSlope = 1']],
    other: 'gaddum-schild-slope1-conc',
    t: [-11, -3, 'lin', [0, 100, -8, 1, 8, 1e-8]],
  },
  'ec50-shift': {
    goals: ['pharmacology'],
    x: 'log',
    shape: 'curves of one shape, each shifted by its own EC50 ratio',
    other: 'ec50-shift-conc',
    t: [-11, -4, 'lin', [0, 100, -8, 5, 1]],
  },
  'allosteric-ec50-shift': {
    goals: ['pharmacology'],
    x: 'log',
    shape: 'agonist curves shifted by an allosteric modulator, to a limit',
    other: 'allosteric-ec50-shift-conc',
    t: [-11, -4, 'lin', [0, 100, -8, 1, -6, -1, 1e-7]],
  },
  'absolute-ic50': {
    goals: ['inhibition'],
    x: 'log',
    shape: `${DOSE_DOWN}, IC50 against a set 0% baseline`,
    top: 'Top',
    bottom: 'Bottom',
    other: 'absolute-ic50-conc',
    t: [-10, -3, 'lin', [100, 10, -1, -7, 0]],
  },
  // Binding: saturation
  'one-site-specific': {
    goals: ['saturation'],
    x: 'concentration',
    shape: `${HYPERBOLA} (Bmax)`,
    midpoint: 'Kd',
    top: 'Bmax',
    of: [
      ['one-site-specific-hill', 'h = 1'],
      ['two-sites-specific', 'BmaxLo = 0'],
      ['one-site-total', 'NS = 0 and Background = 0'],
    ],
    t: [0.5, 64, 'log', [1200, 5]],
  },
  'one-site-total': {
    goals: ['saturation'],
    x: 'concentration',
    shape: 'a plateauing curve on a rising straight line (nonspecific binding)',
    midpoint: 'Kd',
    t: [0.5, 128, 'log', [1200, 5, 10, 0]],
  },
  'one-site-specific-hill': {
    goals: ['saturation'],
    x: 'concentration',
    shape: `${HYPERBOLA}, with a Hill slope`,
    midpoint: 'Kd',
    top: 'Bmax',
    t: [0.25, 112.59, 'log', [1000, 5, 1.6]],
  },
  'two-sites-specific': {
    goals: ['saturation'],
    x: 'concentration',
    shape: 'two binding sites of different affinity',
    t: [0.02, 655.36, 'log', [400, 0.3, 800, 30]],
  },
  'one-site-total-and-nonspecific': {
    goals: ['saturation'],
    x: 'concentration',
    shape: 'total and nonspecific binding, fit together',
    midpoint: 'Kd',
    of: [['two-sites-total-and-nonspecific', 'BmaxLo = 0']],
    t: [0.5, 64, 'log', [1500, 4, 20, 30]],
  },
  'one-site-total-depletion': {
    goals: ['saturation'],
    x: 'concentration',
    shape: 'total binding, allowing for ligand depletion',
    t: [1000, 175922, 'log', [20000, 1, 0.02, 0.1, 100]],
  },
  'two-sites-total-and-nonspecific': {
    goals: ['saturation'],
    x: 'concentration',
    shape: 'total (two sites) and nonspecific binding, fit together',
    t: [0.02, 655.36, 'log', [400, 0.3, 800, 30, 5, 30]],
  },
  'one-site-allosteric-modulator': {
    goals: ['saturation'],
    x: 'concentration',
    shape: 'saturation curves changed by a modulator, fit together',
    t: [0.1, 51.2, 'log', [1000, 2, -6, -1, 1e-7]],
  },
  // Binding: competition
  'one-site-fit-logic50': {
    goals: ['competition'],
    x: 'log',
    shape: 'S-shaped fall as the competitor displaces the label',
    midpoint: 'LogIC50',
    top: 'Top',
    bottom: 'Bottom',
    of: [['two-sites-fit-logic50', 'FractionHi = 1']],
    t: [-9, -4, 'lin', [100, 2000, -7.5]],
  },
  'one-site-fit-logki': {
    goals: ['competition'],
    x: 'log',
    shape: 'S-shaped fall, reported as the competitor’s Ki',
    top: 'Top',
    bottom: 'Bottom',
    t: [-9, -4, 'lin', [2000, 100, -8, 1, 1]],
  },
  'two-sites-fit-logic50': {
    goals: ['competition'],
    x: 'log',
    shape: 'a fall in two steps (two sites)',
    top: 'Top',
    bottom: 'Bottom',
    t: [-11, -3, 'lin', [2000, 100, 0.4, -9, -6]],
  },
  'two-sites-fit-ki': {
    goals: ['competition'],
    x: 'log',
    shape: 'a fall in two steps, reported as Ki values',
    top: 'Top',
    bottom: 'Bottom',
    t: [-11, -3, 'lin', [2000, 100, 0.4, -9, -6, 1, 1, 1]],
  },
  'one-site-competitive-depletion': {
    goals: ['competition'],
    x: 'log',
    shape: 'competition, allowing for ligand depletion',
    t: [-11, -4, 'lin', [-8, 20000, 0.01, 50000, 1, 100, 0.1]],
  },
  'homologous-one-site': {
    goals: ['competition'],
    x: 'log',
    shape: 'unlabelled ligand displacing its labelled self',
    t: [-12, -5, 'lin', [-9, 1000, 50, 5]],
  },
  'allosteric-modulator-competitive': {
    goals: ['competition'],
    x: 'log',
    shape: 'binding changed by a modulator’s log concentration',
    t: [-10, -3, 'lin', [-6, -1, 1000, 1, 1]],
  },
  // Binding: kinetics
  'dissociation-one-phase': {
    goals: ['bindingKinetics'],
    x: 'time',
    shape: 'binding falling over time to nonspecific binding',
    t: [0, 60, 'lin', [1000, 100, 0.08]],
  },
  'association-one-conc': {
    goals: ['bindingKinetics'],
    x: 'time',
    shape: 'binding rising over time to equilibrium',
    t: [0, 60, 'lin', [1e8, 1, 0.1, 2000]],
  },
  'association-two-conc': {
    goals: ['bindingKinetics'],
    x: 'time',
    shape: 'association at several ligand concentrations, fit together',
    t: [0, 60, 'lin', [1e8, 0.05, 2000, 3]],
  },
  'association-then-dissociation': {
    goals: ['bindingKinetics'],
    x: 'time',
    shape: 'rises, then falls after dissociation starts',
    t: [0, 60, 'lin', [0.05, 1e8, 2000, 0, 1, 10]],
  },
  'kinetics-competitive-binding': {
    goals: ['bindingKinetics'],
    x: 'time',
    shape: 'labelled binding over time with a competitor',
    t: [0, 120, 'lin', [2e7, 0.02, 2000, 1e8, 0.1, 1, 30]],
  },
  // Enzyme kinetics
  'michaelis-menten': {
    goals: ['enzyme'],
    x: 'concentration',
    shape: `${HYPERBOLA} (Vmax)`,
    midpoint: 'Km',
    top: 'Vmax',
    of: [['allosteric-sigmoidal', 'h = 1']],
    t: [0.5, 64, 'log', [50, 4]],
  },
  'substrate-inhibition': {
    goals: ['enzyme'],
    x: 'concentration',
    shape: 'rises, then falls at high substrate',
    t: [0.5, 225.18, 'log', [100, 5, 60]],
  },
  'allosteric-sigmoidal': {
    goals: ['enzyme'],
    x: 'concentration',
    shape: 'S-shaped rise to Vmax (cooperative)',
    midpoint: 'Khalf',
    top: 'Vmax',
    t: [0.5, 97.3098, 'log', [100, 2.2, 8]],
  },
  kcat: {
    goals: ['enzyme'],
    x: 'concentration',
    shape: `${HYPERBOLA}, reported as the turnover number`,
    midpoint: 'Km',
    t: [0.5, 64, 'log', [1, 50, 4]],
  },
  'competitive-inhibition': {
    goals: ['enzyme'],
    x: 'concentration',
    shape: 'Michaelis-Menten curves with Km raised by each inhibitor concentration',
    t: [0.5, 64, 'log', [100, 4, 2, 2]],
  },
  'noncompetitive-inhibition': {
    goals: ['enzyme'],
    x: 'concentration',
    shape: 'Michaelis-Menten curves with Vmax lowered by each inhibitor concentration',
    of: [['mixed-inhibition', 'Alpha = 1']],
    t: [0.5, 64, 'log', [100, 4, 3, 2]],
  },
  'uncompetitive-inhibition': {
    goals: ['enzyme'],
    x: 'concentration',
    shape: 'Michaelis-Menten curves with Vmax and Km lowered together',
    t: [0.5, 64, 'log', [100, 4, 3, 2]],
  },
  'mixed-inhibition': {
    goals: ['enzyme'],
    x: 'concentration',
    shape: 'Michaelis-Menten curves with Vmax and Km changed by the inhibitor',
    t: [0.5, 128, 'log', [100, 4, 2, 3, 2]],
  },
  'morrison-ki': {
    goals: ['enzyme'],
    x: 'concentration',
    shape: 'velocity falling with a tight-binding inhibitor',
    t: [0.1, 204.8, 'log', [100, 0.5, 1, 1, 1]],
  },
  // Decay and growth (exponential)
  'one-phase-decay': {
    goals: ['decay'],
    x: 'time',
    shape: 'falls from Y0 to a plateau',
    top: 'Y0',
    bottom: 'Plateau',
    of: [['two-phase-decay', 'PercentFast = 100 (one phase)']],
    t: [0, 30, 'lin', [100, 10, 0.2]],
  },
  'one-phase-association': {
    goals: ['decay'],
    x: 'time',
    shape: 'rises from Y0 to a plateau',
    of: [['two-phase-association', 'PercentFast = 100 (one phase)']],
    t: [0, 20, 'lin', [5, 80, 0.3]],
  },
  'two-phase-decay': {
    goals: ['decay'],
    x: 'time',
    shape: 'a fast then a slow fall to a plateau',
    of: [['three-phase-decay', 'PercentSlow = 0 (two phases)']],
    t: [0, 40, 'lin', [100, 5, 1, 0.08, 60]],
  },
  'exponential-growth': {
    goals: ['decay'],
    x: 'time',
    shape: 'grows faster and faster without limit',
    t: [0, 10, 'lin', [10, 0.3]],
  },
  'plateau-one-phase-decay': {
    goals: ['decay'],
    x: 'time',
    shape: 'flat until X0, then falls to a plateau',
    t: [0, 40, 'lin', [8.5, 100, 10, 0.2]],
  },
  'two-phase-association': {
    goals: ['decay'],
    x: 'time',
    shape: 'a fast then a slow rise to a plateau',
    t: [0, 40, 'lin', [5, 100, 60, 1, 0.08]],
  },
  'three-phase-decay': {
    goals: ['decay'],
    x: 'time',
    shape: 'a fall in three phases to a plateau',
    t: [0, 123.26, 'lin', [100, 5, 40, 2, 30, 0.02, 0.2]],
  },
  'plateau-one-phase-association': {
    goals: ['decay'],
    x: 'time',
    shape: 'flat until X0, then rises to a plateau',
    t: [0, 40, 'lin', [8.5, 10, 100, 0.2]],
  },
  // Lines and polynomials
  'straight-line': {
    goals: ['lines', 'standard'],
    x: 'linear',
    shape: 'a straight line',
    of: [['polynomial-2', 'B2 = 0']],
    t: [0, 10, 'lin', [3, 2]],
  },
  'polynomial-2': {
    goals: ['lines', 'standard'],
    x: 'linear',
    shape: 'a parabola (one bend)',
    of: [['polynomial-3', 'B3 = 0']],
    t: [-5, 5, 'lin', [1, -2, 0.5]],
  },
  'polynomial-3': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a cubic (up to two bends)',
    of: [['polynomial-4', 'B4 = 0']],
    t: [-5, 5, 'lin', [1, -2, 0.5, 0.1]],
  },
  'segmental-linear': {
    goals: ['lines'],
    x: 'linear',
    shape: 'two straight segments meeting at X0',
    t: [0, 20, 'lin', [2, 3, 8.5, 0.5]],
  },
  'two-lines-crossing': {
    goals: ['lines'],
    x: 'linear',
    shape: 'lines of several data sets through one shared point',
    t: [0, 16, 'lin', [7, 20, -1.2]],
  },
  'horizontal-line': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a flat line',
    of: [
      ['straight-line', 'Slope = 0'],
      ['polynomial-1', 'B1 = 0'],
    ],
    t: [0, 10, 'lin', [5]],
  },
  'line-through-origin': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a straight line through (0, 0)',
    of: [['straight-line', 'YIntercept = 0']],
    t: [1, 10, 'lin', [2]],
  },
  hinge: {
    goals: ['lines'],
    x: 'linear',
    shape: 'two lines joined by a smooth bend',
    t: [0, 20, 'lin', [10, 1, 3, 10, 0.8]],
  },
  'semilog-x-log': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a straight line when X is on a log axis',
    t: [0.1, 204.8, 'log', [2, 3]],
  },
  'semilog-y-log': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a straight line when Y is on a log axis',
    t: [0, 20, 'lin', [0.1, 1]],
  },
  'log-log-line': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a straight line when both axes are logarithmic',
    t: [1, 86.4976, 'log', [1.5, 0.5]],
  },
  'polynomial-1': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a straight line',
    of: [['polynomial-2', 'B2 = 0']],
    t: [-5, 5, 'lin', [1, -2]],
  },
  'polynomial-4': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a fourth-order polynomial',
    of: [['polynomial-5', 'B5 = 0']],
    t: [-5, 5, 'lin', [1, -2, 0.5, 0.1, -0.05]],
  },
  'polynomial-5': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a fifth-order polynomial',
    of: [['polynomial-6', 'B6 = 0']],
    t: [-5, 5, 'lin', [1, -2, 0.5, 0.1, -0.05, 0.01]],
  },
  'polynomial-6': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a sixth-order polynomial',
    t: [-5, 5, 'lin', [1, -2, 0.5, 0.1, -0.05, 0.01, 0.002]],
  },
  'centered-polynomial-1': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a straight line around the mean X',
    of: [['centered-polynomial-2', 'B2 = 0']],
    t: [10, 20, 'lin', [3, 2, 15]],
  },
  'centered-polynomial-2': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a parabola around the mean X',
    of: [['centered-polynomial-3', 'B3 = 0']],
    t: [10, 20, 'lin', [3, 2, -0.5, 15]],
  },
  'centered-polynomial-3': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a cubic around the mean X',
    of: [['centered-polynomial-4', 'B4 = 0']],
    t: [10, 20, 'lin', [3, 2, -0.5, 0.1, 15]],
  },
  'centered-polynomial-4': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a fourth-order polynomial around the mean X',
    of: [['centered-polynomial-5', 'B5 = 0']],
    t: [10, 20, 'lin', [3, 2, -0.5, 0.1, 0.02, 15]],
  },
  'centered-polynomial-5': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a fifth-order polynomial around the mean X',
    of: [['centered-polynomial-6', 'B6 = 0']],
    t: [10, 20, 'lin', [3, 2, -0.5, 0.1, 0.02, -0.005, 15]],
  },
  'centered-polynomial-6': {
    goals: ['lines'],
    x: 'linear',
    shape: 'a sixth-order polynomial around the mean X',
    t: [10, 20, 'lin', [3, 2, -0.5, 0.1, 0.02, -0.005, 0.001, 15]],
  },
  // Growth curves
  'boltzmann-sigmoidal': {
    goals: ['growth'],
    x: 'linear',
    shape: 'S-shaped rise on a linear X axis (e.g. voltage)',
    midpoint: 'V50',
    top: 'Top',
    bottom: 'Bottom',
    t: [-80, 40, 'lin', [0.02, 1, -20, 8]],
  },
  gompertz: {
    goals: ['growth'],
    x: 'time',
    shape: 'S-shaped growth, the late part slower',
    t: [0, 20, 'lin', [100, 2, 0.3]],
  },
  'logistic-growth': {
    goals: ['growth'],
    x: 'time',
    shape: 'S-shaped growth to a maximum',
    t: [0, 20, 'lin', [100, 2, 0.5]],
  },
  'exponential-plateau': {
    goals: ['growth'],
    x: 'time',
    shape: 'rises from Y0 to a maximum, fastest at first',
    t: [0, 20, 'lin', [5, 80, 0.25]],
  },
  'beta-growth-decline': {
    goals: ['growth'],
    x: 'time',
    shape: 'grows to a peak, then declines',
    t: [1, 40, 'lin', [50, 20, 10]],
  },
  'log-exponential-growth': {
    goals: ['growth'],
    x: 'time',
    shape: 'a straight line: log of exponential growth',
    t: [0, 10, 'lin', [2, 0.3]],
  },
  // Peaks, distributions and waves
  gaussian: {
    goals: ['peaks'],
    x: 'linear',
    shape: 'a bell-shaped peak',
    of: [['gaussian-sum-two', 'Amplitude2 = 0']],
    t: [-5, 15, 'lin', [50, 5, 2]],
  },
  'gaussian-sum-two': {
    goals: ['peaks'],
    x: 'linear',
    shape: 'two bell-shaped peaks',
    t: [-2, 20, 'lin', [50, 5, 1.5, 30, 12, 2]],
  },
  lognormal: {
    goals: ['peaks'],
    x: 'linear',
    shape: 'a peak with a long right tail',
    t: [0.5, 28.7877, 'log', [200, 5, 1.8]],
  },
  'cumulative-gaussian-percent': {
    goals: ['peaks'],
    x: 'linear',
    shape: 'S-shaped rise from 0 to 100%',
    t: [0, 20, 'lin', [10, 3]],
  },
  'cumulative-gaussian-fraction': {
    goals: ['peaks'],
    x: 'linear',
    shape: 'S-shaped rise from 0 to 1',
    t: [0, 20, 'lin', [10, 3]],
  },
  'cumulative-gaussian-counts': {
    goals: ['peaks'],
    x: 'linear',
    shape: 'S-shaped rise from 0 to N',
    t: [0, 20, 'lin', [10, 3, 100]],
  },
  'lorentzian-sum-two': {
    goals: ['peaks'],
    x: 'linear',
    shape: 'two sharp peaks with wide tails',
    t: [-2, 20, 'lin', [50, 5, 1, 30, 12, 1.5]],
  },
  'sine-wave': {
    goals: ['peaks'],
    x: 'linear',
    shape: 'a wave around zero',
    of: [
      ['sine-wave-baseline', 'Baseline = 0'],
      ['damped-sine-wave', 'K = 0'],
    ],
    t: [0, 30, 'lin', [10, 8, 0.7]],
  },
  'sine-wave-baseline': {
    goals: ['peaks'],
    x: 'linear',
    shape: 'a wave around a baseline',
    t: [0, 30, 'lin', [10, 8, 0.7, 50]],
  },
  lorentzian: {
    goals: ['peaks'],
    x: 'linear',
    shape: 'a sharp peak with wide tails',
    of: [['lorentzian-sum-two', 'Amplitude2 = 0']],
    t: [-10, 20, 'lin', [50, 5, 2]],
  },
  'damped-sine-wave': {
    goals: ['peaks'],
    x: 'linear',
    shape: 'a wave dying away',
    t: [0, 60, 'lin', [10, 8, 0.7, 0.05]],
  },
  'sinc-wave': {
    goals: ['peaks'],
    x: 'linear',
    shape: 'a central peak with ripples',
    t: [-12, 12, 'lin', [10, 4]],
  },
  // Radiation
  'linear-quadratic-fs': {
    goals: ['radiation'],
    x: 'linear',
    shape: 'the surviving fraction falling with dose',
    t: [0, 10, 'lin', [0.2, 0.03]],
  },
  'linear-quadratic-ps': {
    goals: ['radiation'],
    x: 'linear',
    shape: 'the percent surviving falling with dose',
    t: [0, 10, 'lin', [0.2, 0.03]],
  },
  'linear-quadratic-fd': {
    goals: ['radiation'],
    x: 'linear',
    shape: 'the fraction dead rising with dose',
    t: [0, 10, 'lin', [0.2, 0.03]],
  },
  'linear-quadratic-pd': {
    goals: ['radiation'],
    x: 'linear',
    shape: 'the percent dead rising with dose',
    t: [0, 10, 'lin', [0.2, 0.03]],
  },
  'linear-quadratic-ns': {
    goals: ['radiation'],
    x: 'linear',
    shape: 'the number surviving falling with dose',
    t: [0, 10, 'lin', [1000, 0.2, 0.03]],
  },
  'linear-quadratic-nd': {
    goals: ['radiation'],
    x: 'linear',
    shape: 'the number dead rising with dose',
    t: [0, 10, 'lin', [1000, 0.2, 0.03]],
  },
  // Classic forms: All equations only.
  'classic-one-phase-decay': {
    x: 'time',
    shape: 'falls to a plateau (span form)',
    of: [['classic-two-phase-decay', 'Span2 = 0']],
    t: [0, 30, 'lin', [90, 0.2, 10]],
  },
  'classic-two-phase-decay': {
    x: 'time',
    shape: 'a fast then a slow fall (span form)',
    t: [0, 40, 'lin', [60, 1, 40, 0.08, 5]],
  },
  'classic-one-phase-association': {
    x: 'time',
    shape: 'rises from 0 to a plateau',
    of: [['classic-two-phase-association', 'Ymax2 = 0']],
    t: [0, 20, 'lin', [80, 0.3]],
  },
  'classic-two-phase-association': {
    x: 'time',
    shape: 'a fast then a slow rise from 0',
    t: [0, 40, 'lin', [40, 1, 60, 0.08]],
  },
  'classic-power-series': {
    x: 'linear',
    shape: 'the sum of two powers of X',
    t: [0.5, 15.974, 'log', [2, 1.5, 0.5, -1]],
  },
  'classic-sine-wave': {
    x: 'linear',
    shape: 'a wave around a baseline (angular frequency)',
    t: [0, 30, 'lin', [50, 10, 0.8, 0.7]],
  },
}

// ---- goals -------------------------------------------------------------------------------------

const GOAL_TEXT: Readonly<
  Record<ModelGoalId, Omit<ModelGoal, 'id' | 'models'> & { first?: readonly string[] }>
> = {
  stimulation: {
    title: 'Dose-response: stimulation (EC50)',
    description: 'A response that rises with the dose of an agonist.',
    xExpected: 'log(dose) or the dose, per model',
    first: [
      'agonist-response-variable-slope',
      'agonist-response',
      'agonist-normalized-response-variable-slope',
      'agonist-conc-response-variable-slope',
    ],
  },
  inhibition: {
    title: 'Dose-response: inhibition (IC50)',
    description: 'A response that falls with the dose of an inhibitor.',
    xExpected: 'log(dose) or the dose, per model',
    first: [
      'inhibitor-response-variable-slope',
      'inhibitor-response',
      'inhibitor-normalized-response-variable-slope',
      'inhibitor-conc-response-variable-slope',
    ],
  },
  pharmacology: {
    title: 'Receptor pharmacology',
    description: 'Several agonist curves fit together: antagonists, partial agonists, modulators.',
    xExpected: 'log(dose) or the dose, per model',
  },
  saturation: {
    title: 'Binding: saturation',
    description: 'Binding against the concentration of a labelled ligand.',
    xExpected: 'the ligand’s concentration',
    first: ['one-site-specific', 'one-site-total-and-nonspecific'],
  },
  competition: {
    title: 'Binding: competition',
    description: 'An unlabelled competitor displacing a labelled ligand.',
    xExpected: 'log(the competitor’s concentration)',
  },
  bindingKinetics: {
    title: 'Binding: kinetics',
    description: 'Binding against time: association and dissociation.',
    xExpected: 'time',
  },
  enzyme: {
    title: 'Enzyme kinetics',
    description: 'Velocity against substrate; how an inhibitor acts.',
    xExpected: 'the substrate’s concentration',
  },
  decay: {
    title: 'Decay and growth',
    description: 'Exponential decay, association and growth over time.',
    xExpected: 'time',
  },
  growth: {
    title: 'Growth curves',
    description: 'S-shaped growth to a maximum (cultures, populations), Boltzmann curves.',
    xExpected: 'time (Boltzmann: any X)',
    first: ['logistic-growth', 'gompertz'],
  },
  standard: {
    title: 'Standard curve',
    description: 'Fit the standards, then read the unknowns off the curve.',
    xExpected: 'the standards’ concentrations',
    first: [
      'agonist-conc-response-variable-slope',
      'asymmetric-5pl-conc',
      'straight-line',
      'polynomial-2',
    ],
    sets: { interpolate: true },
  },
  lines: {
    title: 'Lines and polynomials',
    description: 'Straight lines, segments and polynomials (a spline is its own analysis).',
    xExpected: 'any values',
    first: ['straight-line', 'polynomial-2', 'polynomial-3'],
  },
  peaks: {
    title: 'Peaks, distributions and waves',
    description: 'Gaussian and Lorentzian peaks, cumulative distributions, sine waves.',
    xExpected: 'any values',
    first: ['gaussian', 'lorentzian'],
  },
  radiation: {
    title: 'Radiation survival',
    description: 'The linear-quadratic model of survival against dose.',
    xExpected: 'the dose',
  },
}

const GOAL_ORDER: readonly ModelGoalId[] = [
  'stimulation',
  'inhibition',
  'pharmacology',
  'saturation',
  'competition',
  'bindingKinetics',
  'enzyme',
  'decay',
  'growth',
  'standard',
  'lines',
  'peaks',
  'radiation',
]

// ---- built -------------------------------------------------------------------------------------

function build(e: EquationDef): EquationMeta {
  const s = SPECS[e.id]
  if (!s) throw new Error(`equation metadata: ${e.id} has none`)
  const params: Record<string, ParamMeta> = {}
  for (const name of e.params) {
    const unit = UNIT[e.id]?.[name] ?? UNIT_BY_NAME[name]
    if (!unit) throw new Error(`equation metadata: no unit for ${name} of ${e.id}`)
    params[name] = {
      meaning: MEANING[e.id]?.[name] ?? lowerFirst(e.paramInfo[name]?.description ?? ''),
      unit,
    }
  }
  return {
    id: e.id,
    goals: s.goals ?? [],
    xScale: s.x,
    shape: s.shape,
    params,
    ...(s.midpoint ? { midpoint: s.midpoint } : {}),
    ...(s.top ? { top: s.top } : {}),
    ...(s.bottom ? { bottom: s.bottom } : {}),
    specialCaseOf: (s.of ?? []).map(([model, when]) => ({ model, when })),
    ...(s.other ? { otherScale: s.other } : {}),
    typical: { x: [s.t[0], s.t[1]], spacing: s.t[2], p: s.t[3] },
  }
}

const lowerFirst = (t: string) =>
  /^[A-Z][a-z]/.test(t) && !/^(Hill|Michaelis|Gaussian|Ki|Kd)/.test(t)
    ? t.charAt(0).toLowerCase() + t.slice(1)
    : t

/** Every built-in equation's metadata, by id. */
export const EQUATION_META: ReadonlyMap<string, EquationMeta> = new Map(
  EQUATIONS.map((e) => [e.id, build(e)]),
)

/** The metadata of a built-in equation (undefined for a user-defined one). */
export const equationMeta = (id: string): EquationMeta | undefined => EQUATION_META.get(id)

/** The picker's goals, each with its models (the usual ones first, then library order). */
export const MODEL_GOALS: readonly ModelGoal[] = GOAL_ORDER.map((id) => {
  const { first = [], ...text } = GOAL_TEXT[id]
  const listed = EQUATIONS.filter((e) => EQUATION_META.get(e.id)!.goals.includes(id)).map(
    (e) => e.id,
  )
  return { id, ...text, models: [...first, ...listed.filter((m) => !first.includes(m))] }
})

/** The goal a model is usually picked from (its first), or null (All equations only). */
export function goalOf(id: string): ModelGoalId | null {
  return EQUATION_META.get(id)?.goals[0] ?? null
}

/** Pairs [simpler, complex] such that `simpler` is a special case of `complex`, transitively. */
const SPECIAL: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const direct = new Map<string, Set<string>>()
  for (const m of EQUATION_META.values())
    direct.set(m.id, new Set(m.specialCaseOf.map((r) => r.model)))
  const closed = new Map<string, Set<string>>()
  for (const id of direct.keys()) {
    const seen = new Set<string>()
    const stack = [...(direct.get(id) ?? [])]
    while (stack.length) {
      const n = stack.pop()!
      if (seen.has(n)) continue
      seen.add(n)
      stack.push(...(direct.get(n) ?? []))
    }
    closed.set(id, seen)
  }
  return closed
})()

/** Whether built-in model `simpler` is a special case of `complex` (nested in it). */
export const isSpecialCase = (simpler: string, complex: string): boolean =>
  SPECIAL.get(simpler)?.has(complex) ?? false

/**
 * Whether two built-in models are nested (one is a special case of the other), structurally from
 * the declared relatives. A user-defined equation is never declared nested: AICc only (§9.4).
 */
export const modelsNested = (a: string, b: string): boolean =>
  a !== b && (isSpecialCase(a, b) || isSpecialCase(b, a))

/** The built-in models nested with `id` (simpler and more complex), for the comparison list. */
export function nestedRelatives(id: string): string[] {
  return EQUATIONS.map((e) => e.id).filter((o) => modelsNested(id, o))
}

/** The equation behind an id, if built in. */
export const builtIn = (id: string): EquationDef | undefined => equation(id)
