import { DOSE_FORMS, doseForm } from './doseForms.ts'
import type { EquationCategory, EquationDef, ParamInfo } from './equations.ts'
import { initialFromRule, maxOf, profile, rateFromHalfLife, xAtLevel } from './initialRules.ts'
import { type LabDef, lab } from './labEquations.ts'
import type { CurveModel } from './nonlinear.ts'
import { polynomialRegression } from './polynomial.ts'

/**
 * The rest of Prism's built-in equation library (roadmap 20), family by family as the GraphPad
 * Curve Fitting Guide lists them ("Models (equations) built-in to Prism"): the "X is
 * concentration" dose-response forms, the special dose-response models (operational model,
 * Gaddum/Schild, EC50 shift, allosteric EC50 shift, absolute IC50), binding with ligand
 * depletion, allosteric modulators, total and nonspecific binding together, homologous and
 * kinetic competition, the Morrison equation, three-phase decay, the remaining lines,
 * polynomials up to the sixth order (plain and centered), sums of Gaussians and Lorentzians,
 * lognormal and cumulative Gaussians, damped and sinc waves, the linear-quadratic radiation
 * models and the classic (Prism 1–3) forms that differ from the modern ones.
 *
 * Every equation is written in GraphPad's own text (typos in the guide fixed: EC50 shift's
 * "EC50Control + EC50Ratio" is EC50Control·EC50Ratio as its log form says; the damped sine's
 * missing parenthesis), so gradients are exact (automatic differentiation). Parameter names
 * follow the guide; constants the guide says to set ("you must constrain…") default to a
 * constant the user is expected to change, data set constants (antagonist or modulator
 * concentrations, hot ligand concentrations) come from the column titles, and parameters the
 * guide says are shared default to shared. The guide publishes no initial-value rules for
 * built-in equations (only that Hill slopes start at SIGN(YatXmax − YatXmin) and polynomials at
 * 1.0); ours are written in Prism's rule vocabulary (YMIN, YMAX, X at YMID…) where it suffices,
 * with "X is concentration" forms using the rules of their log forms on log10(X).
 */

type Initial = CurveModel['initial']
type Rule = number | string | ((x: ArrayLike<number>, y: ArrayLike<number>) => number)

/**
 * Initial values from rules per parameter: a number, a rule string ('ymax', '1.25*ymax',
 * '0.5/xmid', 'sign'…, see initialFromRule), or a function of the data. Constant parameters take
 * their fixed values.
 */
function ruled(params: readonly string[], spec: Record<string, Rule>): Initial {
  return (x, y, fixed) =>
    params.map((n, j) => {
      const f = fixed?.[j]
      if (f !== undefined) return f
      const r = spec[n]
      if (r === undefined) return 1
      if (typeof r === 'number') return r
      if (typeof r === 'function') return r(x, y)
      const m = /^\s*(-?[\d.]+(?:e-?\d+)?)?\s*([*/])?\s*([a-z]+)\s*$/i.exec(r)
      if (!m) throw new Error(`bad rule ${r}`)
      const k = m[1] ? Number(m[1]) : 1
      return initialFromRule({ value: k, rule: m[2] === '/' ? `/${m[3]}` : m[3]! }, x, y)
    })
}

/** The data with X > 0 as log10(X), for rules of "X is concentration" forms. */
function logX(x: ArrayLike<number>, y: ArrayLike<number>): [number[], number[]] {
  const lx: number[] = []
  const ly: number[] = []
  for (let i = 0; i < x.length; i++) {
    if (x[i]! > 0) {
      lx.push(Math.log10(x[i]!))
      ly.push(y[i]!)
    }
  }
  return lx.length ? [lx, ly] : [Array.from(x), Array.from(y)]
}

/** 10^(X at YMID) of the log-X data: an EC50-like concentration. */
const concAtYmid = (x: ArrayLike<number>, y: ArrayLike<number>) => {
  const [lx, ly] = logX(x, y)
  return 10 ** initialFromRule({ value: 1, rule: 'xatymid' }, lx, ly)
}

const info = (
  description: string,
  defaultConstraint?: ParamInfo['defaultConstraint'],
): ParamInfo =>
  defaultConstraint === undefined ? { description } : { description, defaultConstraint }
const shared = (description: string) => info(description, 'shared')
const constant = (description: string, value: number) => info(description, { constant: value })
const dsc = (description: string) => info(description, 'dataSetConstant')

const BOTTOM = info('Y value at the bottom plateau')
const TOP = info('Y value at the top plateau')
const HILL = info('Hill slope (steepness; negative for a falling curve)')

type Def = Omit<LabDef, 'initial'> & {
  /** Initial values: a function, or rules per parameter (see ruled). */
  initial: Initial | Record<string, Rule>
  /** Initial values for data set k's own program (equations with `<A>` lines). */
  initialByDataSet?: (k: number) => Initial
}

function def(d: Def): EquationDef {
  const { initialByDataSet, ...rest } = d
  const init = rest.initial
  const e = lab({ ...rest, initial: typeof init === 'function' ? init : ruled(d.params, init) })
  if (initialByDataSet && e.forDataSet) {
    const variant = e.forDataSet
    e.forDataSet = (k) => ({ ...variant(k), initial: initialByDataSet(k) })
  }
  return e
}

// ---- dose-response: X is concentration ----------------------------------------------------------

const SPECIAL_C: EquationCategory = 'Dose-response — Special, X is concentration'
const SPECIAL_L: EquationCategory = 'Dose-response — Special, X is log(concentration)'
const log10 = Math.log10

/** GraphPad's text of each standard form with X = concentration, in DOSE_FORMS order. */
const DOSE_CONC_TEXT = [
  'Y=Bottom + X*(Top-Bottom)/(EC50 + X)',
  'Y=Bottom + (X^HillSlope)*(Top-Bottom)/(X^HillSlope + EC50^HillSlope)',
  'Y=100*X/(EC50+X)',
  'Y=100*(X^HillSlope)/(EC50^HillSlope + (X^HillSlope))',
  'Y=Bottom + (Top-Bottom)/(1+(X/IC50))',
  'Y=Bottom + (Top-Bottom)/(1+(IC50/X)^HillSlope)',
  'Y=100/(1+X/IC50)',
  'Y=100/(1+(IC50/X)^HillSlope)',
]

const doseConc: EquationDef[] = DOSE_FORMS.map((d, i) => {
  const { id, name, category, params, mid, iMid } = doseForm(d, true)
  const who = d.kind === 'agonist' ? 'Agonist' : 'Inhibitor'
  const half = d.normalized
    ? 'a response of 50'
    : `half the ${d.kind === 'agonist' ? 'response' : 'effect'}`
  return def({
    id,
    name,
    category,
    text: DOSE_CONC_TEXT[i]!,
    params,
    paramInfo: {
      ...(d.normalized ? {} : { Bottom: BOTTOM, Top: TOP }),
      [mid]: info(`${who} concentration giving ${half} (X units)`),
      ...(d.hill ? { HillSlope: HILL } : {}),
    },
    initial: { Bottom: 'ymin', Top: 'ymax', [mid]: concAtYmid, HillSlope: 'sign' },
    derived: (p) => ({ [`Log${mid}`]: log10(p[iMid]!) }),
  })
})

// ---- dose-response: special -------------------------------------------------------------------------

/** Plateaus and midpoints of a bell-shaped curve on log X (as the log form's rule). */
function bellStart(lx: number[], ly: number[]) {
  const pr = profile(lx, ly)
  const first = pr.ys[0]!
  const last = pr.ys[pr.ys.length - 1]!
  let k = 0
  for (let i = 1; i < pr.ys.length; i++) if (pr.ys[i]! > pr.ys[k]!) k = i
  let kMin = 0
  for (let i = 1; i < pr.ys.length; i++) if (pr.ys[i]! < pr.ys[kMin]!) kMin = i
  const dMax = pr.ymax - Math.max(first, last)
  const dMin = Math.min(first, last) - pr.ymin
  const kk = dMax >= dMin ? k : kMin
  const peak = pr.ys[kk]!
  const rise = { ...pr, xs: pr.xs.slice(0, kk + 1), ys: pr.ys.slice(0, kk + 1) }
  const fall = { ...pr, xs: pr.xs.slice(kk), ys: pr.ys.slice(kk) }
  const l1 = xAtLevel(rise, (first + peak) / 2)
  let l2 = xAtLevel(fall, (peak + last) / 2)
  if (!(l2 > l1)) l2 = l1 + (pr.xmax - pr.xmin) / 4
  return { dip: last + first - peak, p1: last, p2: first, l1, l2 }
}

/** Remembered control (data set A) midpoint, for the EC50 shift's other data sets. */
let controlLogEC50 = Number.NaN

const doseSpecialConc: EquationDef[] = [
  def({
    id: 'asymmetric-5pl-conc',
    name: 'Asymmetric sigmoidal, 5PL, X is concentration',
    category: SPECIAL_C,
    text: `Denominator = (1+(2^(1/S)-1)*((EC50/X)^HillSlope))^S
Numerator = Top - Bottom
Y = Bottom + (Numerator/Denominator)`,
    params: ['Bottom', 'Top', 'EC50', 'HillSlope', 'S'],
    paramInfo: {
      Bottom: BOTTOM,
      Top: TOP,
      EC50: info('Concentration giving a response half-way between Bottom and Top'),
      HillSlope: HILL,
      S: info('Asymmetry factor (1 = symmetric four-parameter curve)'),
    },
    initial: {
      Bottom: 'ymin',
      Top: 'ymax',
      EC50: concAtYmid,
      HillSlope: 'sign',
      S: 1,
    },
    derived: (p) => ({ LogEC50: log10(p[2]!) }),
  }),
  def({
    id: 'biphasic-dose-response-conc',
    name: 'Biphasic dose-response, X is concentration',
    category: SPECIAL_C,
    text: `Span=Top-Bottom
Section1=Span*Frac/(1+(EC50_1/X)^nH1)
Section2=Span* (1-Frac)/(1+(EC50_2/X)^nH2)
Y=Bottom + Section1 +Section2`,
    params: ['Bottom', 'Top', 'Frac', 'EC50_1', 'nH1', 'EC50_2', 'nH2'],
    paramInfo: {
      Bottom: BOTTOM,
      Top: TOP,
      Frac: info('Fraction of the span due to the more potent phase'),
      EC50_1: info('EC50 of the first phase'),
      nH1: info('Hill slope of the first phase'),
      EC50_2: info('EC50 of the second phase'),
      nH2: info('Hill slope of the second phase'),
    },
    initial(x, y) {
      const [lx, ly] = logX(x, y)
      const pr = profile(lx, ly)
      const lo = pr.trend > 0 ? pr.ymin : pr.ymax
      const hi = pr.trend > 0 ? pr.ymax : pr.ymin
      const at = (f: number) => 10 ** xAtLevel(pr, lo + f * (hi - lo))
      return [pr.ymin, pr.ymax, 0.5, at(0.25), pr.trend, at(0.75), pr.trend]
    },
    derived: (p) => ({ LogEC50_1: log10(p[3]!), LogEC50_2: log10(p[5]!) }),
  }),
  def({
    id: 'bell-shaped-dose-response-conc',
    name: 'Bell-shaped dose-response, X is concentration',
    category: SPECIAL_C,
    text: `Span1=Plateau1-Dip
Span2=Plateau2-Dip
Section1=Span1/(1+(EC50_1/X)^nH1)
Section2=Span2/(1+(X/EC50_2)^nH2)
Y=Dip+Section1+Section2`,
    params: ['Dip', 'Plateau1', 'Plateau2', 'EC50_1', 'EC50_2', 'nH1', 'nH2'],
    paramInfo: {
      Dip: info('Plateau1 + Plateau2 − Dip is the Y value at the middle plateau'),
      Plateau1: info('Y value at the plateau at high X'),
      Plateau2: info('Y value at the plateau at low X'),
      EC50_1: info('EC50 of the rising phase'),
      EC50_2: info('EC50 of the falling phase'),
      nH1: info('Hill slope of the rising phase'),
      nH2: info('Hill slope of the falling phase'),
    },
    initial(x, y) {
      const b = bellStart(...logX(x, y))
      return [b.dip, b.p1, b.p2, 10 ** b.l1, 10 ** b.l2, 1, 1]
    },
  }),
  ...operationalModels(),
  ...gaddumSchild(),
  ...ec50Shift(),
  ...allostericShift(),
  def({
    id: 'agonist-conc-response-find-ecanything',
    name: 'ECanything, X is concentration',
    category: SPECIAL_C,
    text: `EC50=ECF / (F/(100-F))^(1/HillSlope)
Y=Bottom + (Top-Bottom)/(1+(EC50/X)^HillSlope)`,
    params: ['Bottom', 'Top', 'ECF', 'HillSlope', 'F'],
    paramInfo: {
      Bottom: BOTTOM,
      Top: TOP,
      ECF: info('Concentration giving F percent of the way from Bottom to Top'),
      HillSlope: HILL,
      F: constant('The percentage to find, 0–100 (set it; 50 gives the EC50)', 50),
    },
    initial(x, y, fixed) {
      const [lx, ly] = logX(x, y)
      const pr = profile(lx, ly)
      const F = fixed?.[4] ?? 50
      const lo = pr.trend > 0 ? pr.ymin : pr.ymax
      const hi = pr.trend > 0 ? pr.ymax : pr.ymin
      const h = initialFromRule({ value: 1, rule: 'sign' }, lx, ly)
      const ecf = 10 ** xAtLevel(pr, lo + (h > 0 ? F / 100 : 1 - F / 100) * (hi - lo))
      return [pr.ymin, pr.ymax, ecf, h, F]
    },
    derived: (p) => ({ LogECF: log10(p[2]!) }),
  }),
  def({
    id: 'absolute-ic50-conc',
    name: 'Absolute IC50, X is concentration',
    category: SPECIAL_C,
    text: `Fifty=(Top+Baseline)/2
Y= Bottom + (Top-Bottom)/(1+((Top-Bottom)/(Fifty-Bottom)-1)*(AbsoluteIC50/X)^HillSlope)`,
    params: ['Top', 'Bottom', 'HillSlope', 'AbsoluteIC50', 'Baseline'],
    paramInfo: {
      Top: TOP,
      Bottom: BOTTOM,
      HillSlope: HILL,
      AbsoluteIC50: info('Concentration giving a response half-way between Top and Baseline'),
      Baseline: constant('The response that defines 0% (set it, e.g. from controls)', 0),
    },
    initial(x, y, fixed) {
      const [lx, ly] = logX(x, y)
      const pr = profile(lx, ly)
      const base = fixed?.[4] ?? 0
      const h = initialFromRule({ value: 1, rule: 'sign' }, lx, ly)
      return [pr.ymax, pr.ymin, h, 10 ** xAtLevel(pr, (pr.ymax + base) / 2), base]
    },
    derived: (p) => ({ LogAbsoluteIC50: log10(p[3]!) }),
  }),
  def({
    id: 'absolute-ic50',
    name: 'Absolute IC50, X is log(concentration)',
    category: SPECIAL_L,
    text: `Fifty=(Top+Baseline)/2
Y= Bottom + (Top-Bottom)/(1+10^((LogAbsoluteIC50-X)*HillSlope + log((Top-Bottom)/(Fifty-Bottom)-1)))`,
    params: ['Top', 'Bottom', 'HillSlope', 'LogAbsoluteIC50', 'Baseline'],
    paramInfo: {
      Top: TOP,
      Bottom: BOTTOM,
      HillSlope: HILL,
      LogAbsoluteIC50: info(
        'log of the concentration giving a response half-way between Top and Baseline',
      ),
      Baseline: constant('The response that defines 0% (set it, e.g. from controls)', 0),
    },
    initial(x, y, fixed) {
      const pr = profile(x, y)
      const base = fixed?.[4] ?? 0
      const h = initialFromRule({ value: 1, rule: 'sign' }, x, y)
      return [pr.ymax, pr.ymin, h, xAtLevel(pr, (pr.ymax + base) / 2), base]
    },
    derived: (p) => ({ AbsoluteIC50: 10 ** p[3]! }),
  }),
]

/** Operational model (Black & Leff): depletion and partial agonist, X as concentration or log. */
function operationalModels(): EquationDef[] {
  const EMAX = shared('Maximum response of the system (shared)')
  const BASAL = shared('Response with no agonist (shared)')
  const N = shared('Transducer slope (shared; 1 for a hyperbolic transducer)')
  const start = (x: ArrayLike<number>, y: ArrayLike<number>, log: boolean) => {
    const [lx, ly] = log ? [Array.from(x), Array.from(y)] : logX(x, y)
    const pr = profile(lx, ly)
    return { emax: pr.ymax, basal: pr.ymin, mid: xAtLevel(pr, (pr.ymin + pr.ymax) / 2) }
  }
  return [
    def({
      id: 'operational-depletion-conc',
      name: 'Operational model — Depletion, X is concentration',
      category: SPECIAL_C,
      text: `operate= ((KA+X)/(tau*X))^n
Y=Basal + (Effectmax-Basal)/(1+operate)`,
      params: ['Effectmax', 'Basal', 'KA', 'tau', 'n'],
      paramInfo: {
        Effectmax: EMAX,
        Basal: BASAL,
        KA: shared('Agonist dissociation constant (X units, shared)'),
        tau: info('Transducer constant (efficacy) of each data set'),
        n: N,
      },
      initial(x, y) {
        const s = start(x, y, false)
        // With tau = 1 the curve's midpoint is KA/2.
        return [s.emax, s.basal, 2 * 10 ** s.mid, 1, 1]
      },
      derived: (p) => ({ LogKA: log10(p[2]!), LogTau: log10(p[3]!) }),
    }),
    def({
      id: 'operational-depletion',
      name: 'Operational model — Depletion, X is log(concentration)',
      category: SPECIAL_L,
      text: `operate= (((10^logKA)+(10^X))/(10^(logtau+X)))^n
Y=Basal + (Effectmax-Basal)/(1+operate)`,
      params: ['Effectmax', 'Basal', 'logKA', 'logtau', 'n'],
      paramInfo: {
        Effectmax: EMAX,
        Basal: BASAL,
        logKA: shared('log of the agonist dissociation constant (shared)'),
        logtau: info('log of the transducer constant of each data set'),
        n: N,
      },
      initial(x, y) {
        const s = start(x, y, true)
        return [s.emax, s.basal, s.mid + Math.log10(2), 0, 1]
      },
      derived: (p) => ({ KA: 10 ** p[2]!, tau: 10 ** p[3]! }),
    }),
    def({
      id: 'operational-partial-agonist-conc',
      name: 'Operational model — Partial agonist, X is concentration',
      category: SPECIAL_C,
      text: `operate= ((KA+X)/(tau*X))^n
<A> Y = Basal + (Effectmax-Basal)/(1+(EC50/X)^n)
<~A> Y = Basal + (Effectmax-Basal)/(1+operate)`,
      params: ['Effectmax', 'Basal', 'n', 'EC50', 'KA', 'tau'],
      paramInfo: {
        Effectmax: EMAX,
        Basal: BASAL,
        n: N,
        EC50: info('EC50 of the full agonist (data set A)'),
        KA: info('Dissociation constant of each partial agonist'),
        tau: info('Transducer constant of each partial agonist'),
      },
      initial(x, y) {
        const s = start(x, y, false)
        return [s.emax, s.basal, 1, 10 ** s.mid, 2 * 10 ** s.mid, 1]
      },
      initialByDataSet: (k) => (x, y) => {
        const s = start(x, y, false)
        return k === 0
          ? [s.emax, s.basal, 1, 10 ** s.mid, Number.NaN, Number.NaN]
          : [Number.NaN, s.basal, 1, Number.NaN, 2 * 10 ** s.mid, 1]
      },
      derived: (p) => ({ LogEC50: log10(p[3]!), LogKA: log10(p[4]!), LogTau: log10(p[5]!) }),
    }),
    def({
      id: 'operational-partial-agonist',
      name: 'Operational model — Partial agonist, X is log(concentration)',
      category: SPECIAL_L,
      text: `operate= (((10^logKA)+(10^X))/(10^(logtau+X)))^n
<A> Y = Basal + (Effectmax-Basal)/(1+10^((LogEC50-X)*n))
<~A> Y = Basal + (Effectmax-Basal)/(1+operate)`,
      params: ['Effectmax', 'Basal', 'n', 'LogEC50', 'logKA', 'logtau'],
      paramInfo: {
        Effectmax: EMAX,
        Basal: BASAL,
        n: N,
        LogEC50: info('log EC50 of the full agonist (data set A)'),
        logKA: info('log of the dissociation constant of each partial agonist'),
        logtau: info('log of the transducer constant of each partial agonist'),
      },
      initial(x, y) {
        const s = start(x, y, true)
        return [s.emax, s.basal, 1, s.mid, s.mid + Math.log10(2), 0]
      },
      initialByDataSet: (k) => (x, y) => {
        const s = start(x, y, true)
        return k === 0
          ? [s.emax, s.basal, 1, s.mid, Number.NaN, Number.NaN]
          : [Number.NaN, s.basal, 1, Number.NaN, s.mid + Math.log10(2), 0]
      },
      derived: (p) => ({ EC50: 10 ** p[3]!, KA: 10 ** p[4]!, tau: 10 ** p[5]! }),
    }),
  ]
}

/** Gaddum/Schild EC50 shift (antagonist concentration B from the column titles). */
function gaddumSchild(): EquationDef[] {
  const B = dsc('Antagonist concentration of each data set, from its title (0 for the control)')
  const pA2 = shared('pA2: −log of the antagonist concentration that doubles the EC50 (shared)')
  const SLOPE = shared('Schild slope (1 for competitive antagonism; shared)')
  const common = (log: boolean) => ({
    Bottom: shared('Y value at the bottom plateau (shared)'),
    Top: shared('Y value at the top plateau (shared)'),
    HillSlope: shared('Hill slope of the agonist curves (shared)'),
    ...(log
      ? { LogEC50: shared('log EC50 of the agonist alone (shared)') }
      : { EC50: shared('EC50 of the agonist alone (shared)') }),
  })
  /** Per data set: its midpoint (log) shifted back by a dose ratio of 2 when B > 0. */
  const start =
    (log: boolean, withSlope: boolean) =>
    (x: ArrayLike<number>, y: ArrayLike<number>, fixed?: readonly (number | undefined)[]) => {
      const [lx, ly] = log ? [Array.from(x), Array.from(y)] : logX(x, y)
      const pr = profile(lx, ly)
      const b = fixed?.[fixed.length - 1] ?? 0
      const mid = xAtLevel(pr, (pr.ymin + pr.ymax) / 2) - (b > 0 ? Math.log10(2) : 0)
      const h = initialFromRule({ value: 1, rule: 'sign' }, lx, ly)
      const pa2 = b > 0 ? -Math.log10(b) : Number.NaN
      const ec = log ? mid : 10 ** mid
      return withSlope ? [pr.ymin, pr.ymax, ec, h, pa2, 1, b] : [pr.ymin, pr.ymax, ec, h, pa2, b]
    }
  return [
    def({
      id: 'gaddum-schild-conc',
      name: 'Gaddum/Schild EC50 shift, X is concentration',
      category: SPECIAL_C,
      text: `Antag=1+(B/(10^(-1*pA2)))^SchildSlope
Y=Bottom + (Top-Bottom)/(1+(EC50*Antag/X)^HillSlope)`,
      params: ['Bottom', 'Top', 'EC50', 'HillSlope', 'pA2', 'SchildSlope', 'B'],
      paramInfo: { ...common(false), pA2, SchildSlope: SLOPE, B },
      initial: start(false, true),
      derived: (p) => ({ LogEC50: log10(p[2]!), A2: 10 ** -p[4]! }),
    }),
    def({
      id: 'gaddum-schild-slope1-conc',
      name: 'Gaddum/Schild EC50 shift (Schild slope = 1), X is concentration',
      category: SPECIAL_C,
      text: `Antag=1+(B/(10^(-1*pA2)))
Y=Bottom + (Top-Bottom)/(1+(EC50*Antag/X)^HillSlope)`,
      params: ['Bottom', 'Top', 'EC50', 'HillSlope', 'pA2', 'B'],
      paramInfo: { ...common(false), pA2: shared('pA2 = pKb (shared)'), B },
      initial: start(false, false),
      derived: (p) => ({ LogEC50: log10(p[2]!), Kb: 10 ** -p[4]!, LogKb: -p[4]! }),
    }),
    def({
      id: 'gaddum-schild',
      name: 'Gaddum/Schild EC50 shift, X is log(concentration)',
      category: SPECIAL_L,
      text: `EC50=10^LogEC50
Antag=1+(B/(10^(-1*pA2)))^SchildSlope
LogEC=Log(EC50*Antag)
Y=Bottom + (Top-Bottom)/(1+10^((LogEC-X)*HillSlope))`,
      params: ['Bottom', 'Top', 'LogEC50', 'HillSlope', 'pA2', 'SchildSlope', 'B'],
      paramInfo: { ...common(true), pA2, SchildSlope: SLOPE, B },
      initial: start(true, true),
      derived: (p) => ({ EC50: 10 ** p[2]!, A2: 10 ** -p[4]! }),
    }),
    def({
      id: 'gaddum-schild-slope1',
      name: 'Gaddum/Schild EC50 shift (Schild slope = 1), X is log(concentration)',
      category: SPECIAL_L,
      text: `EC50=10^LogEC50
Antag=1+(B/(10^(-1*pA2)))
LogEC=log(EC50*Antag)
Y=Bottom + (Top-Bottom)/(1+10^((LogEC-X)*HillSlope))`,
      params: ['Bottom', 'Top', 'LogEC50', 'HillSlope', 'pA2', 'B'],
      paramInfo: { ...common(true), pA2: shared('pA2 = pKb (shared)'), B },
      initial: start(true, false),
      derived: (p) => ({ EC50: 10 ** p[2]!, Kb: 10 ** -p[4]!, LogKb: -p[4]! }),
    }),
  ]
}

/** EC50 shift: data set A the control, the others shifted by EC50Ratio. */
function ec50Shift(): EquationDef[] {
  const pinfo = (log: boolean) => ({
    Bottom: shared('Y value at the bottom plateau (shared)'),
    Top: shared('Y value at the top plateau (shared)'),
    HillSlope: shared('Hill slope (shared)'),
    ...(log
      ? { LogEC50Control: shared('log EC50 of the control (data set A; shared)') }
      : { EC50Control: shared('EC50 of the control (data set A; shared)') }),
    EC50Ratio: info('EC50 of each data set divided by the control’s'),
  })
  const byDataSet =
    (log: boolean) =>
    (k: number): Initial =>
    (x, y) => {
      const [lx, ly] = log ? [Array.from(x), Array.from(y)] : logX(x, y)
      const pr = profile(lx, ly)
      const mid = xAtLevel(pr, (pr.ymin + pr.ymax) / 2)
      const h = initialFromRule({ value: 1, rule: 'sign' }, lx, ly)
      if (k === 0) controlLogEC50 = mid
      const ratio = k === 0 || !Number.isFinite(controlLogEC50) ? 1 : 10 ** (mid - controlLogEC50)
      const ctl = k === 0 ? (log ? mid : 10 ** mid) : Number.NaN
      return [pr.ymin, pr.ymax, ctl, k === 0 ? Number.NaN : ratio, h]
    }
  const single =
    (log: boolean): Initial =>
    (x, y) => {
      const v = byDataSet(log)(0)(x, y)
      v[3] = 1
      return v
    }
  return [
    def({
      id: 'ec50-shift-conc',
      name: 'EC50 shift, X is concentration',
      category: SPECIAL_C,
      text: `<A>EC=EC50Control
<~A>EC=EC50Control*EC50Ratio
Y=Bottom + (Top-Bottom)/(1+(EC/X)^HillSlope)`,
      params: ['Bottom', 'Top', 'EC50Control', 'EC50Ratio', 'HillSlope'],
      paramInfo: pinfo(false),
      initial: single(false),
      initialByDataSet: byDataSet(false),
      derived: (p) => ({ LogEC50Control: log10(p[2]!) }),
    }),
    def({
      id: 'ec50-shift',
      name: 'EC50 shift, X is log(concentration)',
      category: SPECIAL_L,
      text: `<A>LogEC=LogEC50Control
<~A>LogEC=LogEC50Control + log(EC50Ratio)
Y=Bottom + (Top-Bottom)/(1+10^((LogEC-X)*HillSlope))`,
      params: ['Bottom', 'Top', 'LogEC50Control', 'EC50Ratio', 'HillSlope'],
      paramInfo: pinfo(true),
      initial: single(true),
      initialByDataSet: byDataSet(true),
      derived: (p) => ({ EC50Control: 10 ** p[2]! }),
    }),
  ]
}

/** Allosteric EC50 shift (modulator concentration B from the column titles). */
function allostericShift(): EquationDef[] {
  const B = dsc('Modulator concentration of each data set, from its title (0 for the control)')
  const start =
    (log: boolean) =>
    (x: ArrayLike<number>, y: ArrayLike<number>, fixed?: readonly (number | undefined)[]) => {
      const [lx, ly] = log ? [Array.from(x), Array.from(y)] : logX(x, y)
      const pr = profile(lx, ly)
      const b = fixed?.[6] ?? 0
      const mid = xAtLevel(pr, (pr.ymin + pr.ymax) / 2)
      const h = initialFromRule({ value: 1, rule: 'sign' }, lx, ly)
      const kb = b > 0 ? b : Number.NaN
      return log
        ? [pr.ymin, pr.ymax, b > 0 ? Number.NaN : mid, h, Math.log10(kb), -1, b]
        : [pr.ymin, pr.ymax, b > 0 ? Number.NaN : 10 ** mid, h, kb, 0.1, b]
    }
  const sh = (d: string) => shared(`${d} (shared)`)
  return [
    def({
      id: 'allosteric-ec50-shift-conc',
      name: 'Allosteric EC50 shift, X is concentration',
      category: SPECIAL_C,
      text: `Antag=(1+B/KB)/(1+alpha*B/KB)
Y=Bottom+(Top-Bottom)/(1+(EC50*Antag/X)^HillSlope)`,
      params: ['Bottom', 'Top', 'EC50', 'HillSlope', 'KB', 'alpha', 'B'],
      paramInfo: {
        Bottom: sh('Y value at the bottom plateau'),
        Top: sh('Y value at the top plateau'),
        EC50: sh('EC50 of the agonist without modulator'),
        HillSlope: sh('Hill slope'),
        KB: sh('Dissociation constant of the modulator'),
        alpha: sh('Ternary complex constant (cooperativity factor)'),
        B,
      },
      initial: start(false),
      derived: (p) => ({ LogEC50: log10(p[2]!), LogKB: log10(p[4]!), LogAlpha: log10(p[5]!) }),
    }),
    def({
      id: 'allosteric-ec50-shift',
      name: 'Allosteric EC50 shift, X is log(concentration)',
      category: SPECIAL_L,
      text: `EC50=10^LogEC50
KB=10^LogKB
alpha=10^Logalpha
Antag=(1+B/KB)/(1+alpha*B/KB)
LogEC=Log(EC50*Antag)
Y=Bottom+(Top-Bottom)/(1+10^((LogEC-X)*HillSlope))`,
      params: ['Bottom', 'Top', 'LogEC50', 'HillSlope', 'LogKB', 'Logalpha', 'B'],
      paramInfo: {
        Bottom: sh('Y value at the bottom plateau'),
        Top: sh('Y value at the top plateau'),
        LogEC50: sh('log EC50 of the agonist without modulator'),
        HillSlope: sh('Hill slope'),
        LogKB: sh('log of the dissociation constant of the modulator'),
        Logalpha: sh('log of the ternary complex constant'),
        B,
      },
      initial: start(true),
      derived: (p) => ({ EC50: 10 ** p[2]!, KB: 10 ** p[4]!, alpha: 10 ** p[5]! }),
    }),
  ]
}

// ---- binding -----------------------------------------------------------------------------------

const BIND: EquationCategory = 'Binding'
const COMP: EquationCategory = 'Binding — Competitive'
const KIN: EquationCategory = 'Binding — Kinetics'

/** Least-squares line of the upper half of the X values: [intercept, slope]. */
function upperLine(x: ArrayLike<number>, y: ArrayLike<number>): [number, number] {
  const pr = profile(x, y)
  const h = Math.floor(pr.xs.length / 2)
  const xs = pr.xs.slice(h)
  const ys = pr.ys.slice(h)
  if (xs.length < 2) return [pr.ymin, 0]
  const c = polynomialRegression(xs, ys, 1).coef
  return [c[0]!, c[1]!]
}

/** Least-squares line of all points: [intercept, slope]. */
function line(x: ArrayLike<number>, y: ArrayLike<number>): [number, number] {
  const pr = profile(x, y)
  if (pr.xs.length < 2) return [pr.ymin, 0]
  const c = polynomialRegression(pr.xs, pr.ys, 1).coef
  return [c[0]!, c[1]!]
}

/**
 * Bmax and Kd of the specific part of total binding: total minus a nonspecific line whose slope
 * is that of the top half of the data (all of it when `full`, where specific binding has
 * saturated; half of it otherwise, for a narrower range of X).
 */
function specificStart(x: ArrayLike<number>, y: ArrayLike<number>, full = false) {
  const pr = profile(x, y)
  const ns = Math.max(0, upperLine(x, y)[1] / (full ? 1 : 2))
  const spec = pr.ys.map((v, i) => v - ns * pr.xs[i]! - pr.ymin)
  const bmax = maxOf(spec)
  const kd = xAtLevel({ ...pr, ys: spec }, bmax / 2)
  return { bmax, kd: kd > 0 ? kd : (pr.xmax - pr.xmin) / 4, ns, bg: pr.ymin }
}

const binding: EquationDef[] = [
  def({
    id: 'one-site-total-and-nonspecific',
    name: 'One site — Fit total and nonspecific binding',
    category: BIND,
    text: `specific=Bmax*X/(X+Kd)
nonspecific=NS*X + Background
<A>Y=specific+nonspecific
<B>Y=nonspecific`,
    params: ['Bmax', 'Kd', 'NS', 'Background'],
    paramInfo: {
      Bmax: info('Maximum specific binding'),
      Kd: info('Equilibrium dissociation constant (X units)'),
      NS: shared('Slope of nonspecific binding (shared by total and nonspecific)'),
      Background: shared('Binding with no radioligand (shared)'),
    },
    initial(x, y) {
      const s = specificStart(x, y)
      return [s.bmax, s.kd, s.ns, s.bg]
    },
    initialByDataSet: (k) => (x, y) => {
      if (k === 0) {
        const s = specificStart(x, y, true)
        return [s.bmax, s.kd, Number.NaN, Number.NaN]
      }
      const [b0, b1] = line(x, y)
      return [Number.NaN, Number.NaN, b1, b0]
    },
  }),
  def({
    id: 'one-site-total-depletion',
    name: 'One site — Total, accounting for ligand depletion',
    category: BIND,
    text: `KdCPM=KdnM * Vol * 1000 * SpecAct
; (nm/L * mL * 0.001 L/ml * 1000000 fmol/nmol * cpm/fmol)
a=-1-NS
b=KdCPM + NS*KdCPM + X + 2*X*NS + Bmax
c=-1*X*(NS*KdCPM + X*NS+Bmax)
Y=(-b+sqrt(b*b-4*a*c) )/(2*a) ;Y is in cpm`,
    params: ['Bmax', 'KdnM', 'NS', 'Vol', 'SpecAct'],
    paramInfo: {
      Bmax: info('Maximum binding, cpm'),
      KdnM: info('Equilibrium dissociation constant, nM'),
      NS: info('Fraction of free ligand that binds nonspecifically'),
      Vol: constant('Reaction volume, ml (set it)', 0.1),
      SpecAct: constant('Specific radioactivity, cpm/fmol (set it)', 100),
    },
    initial(x, y, fixed) {
      const vol = fixed?.[3] ?? 0.1
      const sa = fixed?.[4] ?? 100
      const s = specificStart(x, y)
      // Kd in cpm of free ligand → nM.
      return [s.bmax, s.kd / (vol * 1000 * sa), Math.max(s.ns, 1e-4), vol, sa]
    },
  }),
  def({
    id: 'two-sites-total-and-nonspecific',
    name: 'Two sites — Fit total and nonspecific binding',
    category: BIND,
    text: `Specific1=BmaxHi*X/(X+KdHi)
Specific2=BmaxLo*X/(X+KdLo)
Nonspecific=NS*X + Background
<A>Y=Specific1 + Specific2 + Nonspecific
<B>Y=Nonspecific`,
    params: ['BmaxHi', 'KdHi', 'BmaxLo', 'KdLo', 'NS', 'Background'],
    paramInfo: {
      BmaxHi: info('Maximum binding to the high-affinity site'),
      KdHi: info('Dissociation constant of the high-affinity site'),
      BmaxLo: info('Maximum binding to the low-affinity site'),
      KdLo: info('Dissociation constant of the low-affinity site'),
      NS: shared('Slope of nonspecific binding (shared)'),
      Background: shared('Binding with no radioligand (shared)'),
    },
    initial(x, y) {
      const s = specificStart(x, y)
      return [s.bmax / 2, s.kd / 10, s.bmax / 2, s.kd * 10, s.ns, s.bg]
    },
    initialByDataSet: (k) => (x, y) => {
      if (k === 0) {
        const s = specificStart(x, y, true)
        return [s.bmax / 2, s.kd / 10, s.bmax / 2, s.kd * 10, Number.NaN, Number.NaN]
      }
      const [b0, b1] = line(x, y)
      return [Number.NaN, Number.NaN, Number.NaN, Number.NaN, b1, b0]
    },
  }),
  def({
    id: 'one-site-allosteric-modulator',
    name: 'One site with allosteric modulator',
    category: BIND,
    text: `Hot=X
Alpha=10^logalpha
KB=10^logKB
KApp=KDHot*((1+Allo/KB)/(1+alpha*Allo/KB))
Y=Bmax*Hot/(Hot+KApp)`,
    params: ['Bmax', 'KDHot', 'logKB', 'logalpha', 'Allo'],
    paramInfo: {
      Bmax: shared('Maximum binding (shared)'),
      KDHot: shared('Dissociation constant of the radioligand without modulator (shared)'),
      logKB: shared('log of the modulator’s dissociation constant (shared)'),
      logalpha: shared('log of the cooperativity factor (shared)'),
      Allo: dsc('Modulator concentration of each data set, from its title'),
    },
    initial(x, y, fixed) {
      const pr = profile(x, y)
      const allo = fixed?.[4] ?? 0
      const kd = xAtLevel(pr, pr.ymax / 2)
      return [
        pr.ymax,
        allo > 0 ? Number.NaN : kd > 0 ? kd : 1,
        allo > 0 ? Math.log10(allo) : Number.NaN,
        0,
        allo,
      ]
    },
    derived: (p) => ({ KB: 10 ** p[2]!, alpha: 10 ** p[3]! }),
  }),
  def({
    id: 'two-sites-fit-ki',
    name: 'Two sites — Fit Ki',
    category: COMP,
    text: `logEC50Lo=log(10^logKiLo*(1+HotNM/HotKdNMLo))
logEC50Hi=log(10^logKiHi*(1+HotNM/HotKdNMHi))
Span=Top - Bottom
Part1=FractionHi*Span/(1+10^(X-LogEC50Hi) )
Part2=(1-FractionHi)*Span/(1+10^(X-LogEC50Lo) )
Y=Bottom + Part1 + Part2`,
    params: [
      'Top',
      'Bottom',
      'FractionHi',
      'logKiHi',
      'logKiLo',
      'HotNM',
      'HotKdNMHi',
      'HotKdNMLo',
    ],
    paramInfo: {
      Top: TOP,
      Bottom: BOTTOM,
      FractionHi: info('Fraction of the sites with high affinity for the competitor'),
      logKiHi: info('log Ki of the high-affinity site'),
      logKiLo: info('log Ki of the low-affinity site'),
      HotNM: constant('Radioligand concentration, nM (set it)', 1),
      HotKdNMHi: constant('Radioligand Kd at the high-affinity site, nM (set it)', 1),
      HotKdNMLo: constant('Radioligand Kd at the low-affinity site, nM (set it)', 1),
    },
    initial(x, y, fixed) {
      const pr = profile(x, y)
      const hot = fixed?.[5] ?? 1
      const at = (f: number) => xAtLevel(pr, pr.ymin + f * (pr.ymax - pr.ymin))
      const shiftHi = Math.log10(1 + hot / (fixed?.[6] ?? 1))
      const shiftLo = Math.log10(1 + hot / (fixed?.[7] ?? 1))
      return [
        pr.ymax,
        pr.ymin,
        0.5,
        at(0.75) - shiftHi,
        at(0.25) - shiftLo,
        hot,
        fixed?.[6] ?? 1,
        fixed?.[7] ?? 1,
      ]
    },
    derived: (p) => ({ KiHi: 10 ** p[3]!, KiLo: 10 ** p[4]! }),
  }),
  def({
    id: 'one-site-competitive-depletion',
    name: 'One site — Ligand depletion (competitive)',
    category: COMP,
    text: `KdCPM=KdnM*SpAct*vol*1000
; nmol/L *(cpm/fmol * ml * .001L/ml * 1000000fmol/nmol) = cpm
R=NS+1
S=[1+10^(X-LogKi)]*KdCPM+Hot
a=-1*R
b=R*S+NS*Hot + Bmax
c= -1*Hot*(S*NS + Bmax)
Y= (-1*b + sqrt(b*b-4*a*c))/(2*a)`,
    params: ['LogKi', 'Bmax', 'NS', 'Hot', 'KdnM', 'SpAct', 'Vol'],
    paramInfo: {
      LogKi: info('log of the competitor’s equilibrium dissociation constant (molar)'),
      Bmax: info('Maximum binding, cpm'),
      NS: info('Fraction of free radioligand that binds nonspecifically'),
      Hot: constant('Radioligand added, cpm (set it)', 50000),
      KdnM: constant('Radioligand Kd, nM (set it)', 1),
      SpAct: constant('Specific radioactivity, cpm/fmol (set it)', 100),
      Vol: constant('Reaction volume, ml (set it)', 0.1),
    },
    initial(x, y, fixed) {
      const pr = profile(x, y)
      const hot = fixed?.[3] ?? 50000
      // Top of the curve ≈ bound with no competitor: take Bmax as a few times it.
      return [
        xAtLevel(pr, (pr.ymin + pr.ymax) / 2),
        3 * pr.ymax,
        Math.max(1e-4, pr.ymin / hot),
        hot,
        fixed?.[4] ?? 1,
        fixed?.[5] ?? 100,
        fixed?.[6] ?? 0.1,
      ]
    },
    derived: (p) => ({ Ki: 10 ** p[0]! }),
  }),
  def({
    id: 'homologous-one-site',
    name: 'One site — Homologous',
    category: COMP,
    text: `ColdNM=10^(x+9) ;Cold concentration in nM
KdNM=10^(logKD+9) ;Kd in nM
Y=(Bmax*HotnM)/(HotnM + ColdNM + KdNM) + Bottom`,
    params: ['logKD', 'Bmax', 'Bottom', 'HotnM'],
    paramInfo: {
      logKD: shared('log of the ligand’s Kd, molar (shared)'),
      Bmax: shared('Maximum binding (shared)'),
      Bottom: shared('Nonspecific binding (bottom plateau, shared)'),
      HotnM: dsc('Radioligand concentration of each data set in nM, from its title'),
    },
    initial(x, y, fixed) {
      const pr = profile(x, y)
      const hot = fixed?.[3] ?? 1
      // IC50 = Kd + Hot (nM): X at YMID.
      const ic50 = 10 ** (xAtLevel(pr, (pr.ymin + pr.ymax) / 2) + 9)
      const kd = Math.max(ic50 - hot, ic50 / 10)
      return [Math.log10(kd) - 9, ((pr.ymax - pr.ymin) * (hot + kd)) / hot, pr.ymin, hot]
    },
    derived: (p) => ({ KdnM: 10 ** (p[0]! + 9) }),
  }),
  def({
    id: 'allosteric-modulator-competitive',
    name: 'Allosteric modulator (competitive binding)',
    category: COMP,
    text: `AlloNM=10^(X+9)
KbNM=10^(logKb +9)
alpha=10^logAlpha
KAppNM=HotKDnm*(((1+(AlloNM/KBNM))/(1+alpha*(AlloNM/KBNM))))
HotOccupancy = RadioligandNM/(RadioligandNM + HotKDnm)
Y=(Y0/HotOccupancy)*(RadioligandNM/(RadioligandNM + KAppNM))`,
    params: ['logKb', 'logAlpha', 'Y0', 'RadioligandNM', 'HotKDnm'],
    paramInfo: {
      logKb: info('log of the modulator’s dissociation constant, molar'),
      logAlpha: info('log of the cooperativity factor (negative: the modulator lowers binding)'),
      Y0: info('Binding without modulator'),
      RadioligandNM: constant('Radioligand concentration, nM (set it)', 1),
      HotKDnm: constant('Radioligand Kd, nM (set it)', 1),
    },
    initial(x, y, fixed) {
      const pr = profile(x, y)
      const first = pr.ys[0]!
      const last = pr.ys[pr.ys.length - 1]!
      // The plateau at high modulator concentration sets alpha (for a hot ligand at its Kd).
      const r = Math.max(1e-3, last / first)
      const hot = fixed?.[3] ?? 1
      const kd = fixed?.[4] ?? 1
      const occ = hot / (hot + kd)
      const alpha = Math.max(1e-3, (r * occ * (hot + kd / 1)) / hot / (1 - r * occ + 1e-12))
      return [xAtLevel(pr, (first + last) / 2), Math.log10(alpha), first, hot, kd]
    },
    derived: (p) => ({ Kb: 10 ** p[0]!, alpha: 10 ** p[1]! }),
  }),
  def({
    id: 'association-two-conc',
    name: 'Association kinetics — Two or more concentrations of hot ligand',
    category: KIN,
    text: `Kd=Koff/Kon
L=Hotnm*1e-9
Kob=Kon*L+Koff
Occupancy=L/(L+Kd)
Ymax=Occupancy*Bmax
Y=Ymax*(1 - exp(-1*kob*X))`,
    params: ['Kon', 'Koff', 'Bmax', 'Hotnm'],
    paramInfo: {
      Kon: shared('Association rate constant, M⁻¹ per X unit (shared)'),
      Koff: shared('Dissociation rate constant, per X unit (shared)'),
      Bmax: shared('Maximal binding at equilibrium with a saturating ligand (shared)'),
      Hotnm: dsc('Radioligand concentration of each data set in nM, from its title'),
    },
    initial(x, y, fixed) {
      const pr = profile(x, y)
      const hot = (fixed?.[3] ?? 1) * 1e-9
      const kob = rateFromHalfLife(pr)
      // Split kob between Kon·L and Koff evenly; occupancy ½.
      return [kob / 2 / hot, kob / 2, 2 * pr.ymax, fixed?.[3] ?? 1]
    },
    derived: (p) => ({ Kd: p[1]! / p[0]! }),
  }),
  def({
    id: 'association-then-dissociation',
    name: 'Association then dissociation',
    category: KIN,
    text: `Radioligand=HotNM*1e-9
Kob=[Radioligand]*Kon+Koff
Kd=Koff/Kon
Eq=Bmax*radioligand/(radioligand + Kd)
Association=Eq*(1-exp(-1*Kob*X))
YatTime0 = Eq*(1-exp(-1*Kob*Time0))
Dissociation= YatTime0*exp(-1*Koff*(X-Time0))
Y=IF(X<Time0, Association, Dissociation) + NS`,
    params: ['Koff', 'Kon', 'Bmax', 'NS', 'HotNM', 'Time0'],
    paramInfo: {
      Koff: info('Dissociation rate constant, per X unit'),
      Kon: info('Association rate constant, M⁻¹ per X unit'),
      Bmax: info('Maximal binding at equilibrium with a saturating ligand'),
      NS: constant('Nonspecific binding (0 when Y is specific binding)', 0),
      HotNM: constant('Radioligand concentration, nM (set it)', 1),
      Time0: constant('Time at which dissociation was initiated (set it)', 10),
    },
    initial(x, y, fixed) {
      const pr = profile(x, y)
      const hot = (fixed?.[4] ?? 1) * 1e-9
      const t0 = fixed?.[5] ?? (pr.xmin + pr.xmax) / 2
      const after = {
        ...pr,
        xs: pr.xs.filter((v) => v >= t0),
        ys: pr.ys.filter((_, i) => pr.xs[i]! >= t0),
      }
      const koff = after.xs.length >= 2 ? rateFromHalfLife(after) : 1 / (pr.xmax - pr.xmin)
      const before = {
        ...pr,
        xs: pr.xs.filter((v) => v < t0),
        ys: pr.ys.filter((_, i) => pr.xs[i]! < t0),
      }
      const kob = before.xs.length >= 2 ? rateFromHalfLife(before) : 2 * koff
      const kon = Math.max(kob - koff, koff) / hot
      const occ = hot / (hot + koff / kon)
      return [koff, kon, pr.ymax / occ, fixed?.[3] ?? 0, fixed?.[4] ?? 1, t0]
    },
    derived: (p) => ({ Kd: p[0]! / p[1]! }),
  }),
  def({
    id: 'kinetics-competitive-binding',
    name: 'Kinetics of competitive binding',
    category: KIN,
    text: `KA = K1*L*1E-9 + k2
KB = K3*I*1e-9 + K4
S=SQRT((KA-KB)^2+4*K1*K3*L*I*1e-18)
KF = 0.5 * (Ka + KB + S)
KS = 0.5 * (KA + KB - S)
DIFF=KF - KS
Q=Bmax*K1*L*1e-9/DIFF
Y=Q*(k4*DIFF/(KF*KS)+((K4-Kf)/KF)*exp(-KF*X)-((K4-KS)/KS)*exp(-KS*X))`,
    params: ['K3', 'K4', 'Bmax', 'K1', 'K2', 'L', 'I'],
    paramInfo: {
      K3: shared('Association rate constant of the unlabeled ligand, M⁻¹ per X unit (shared)'),
      K4: shared('Dissociation rate constant of the unlabeled ligand, per X unit (shared)'),
      Bmax: shared('Total binding sites (shared)'),
      K1: constant('Association rate constant of the radioligand, M⁻¹ per X unit (set it)', 1e8),
      K2: constant('Dissociation rate constant of the radioligand, per X unit (set it)', 0.1),
      L: constant('Radioligand concentration, nM (set it)', 1),
      I: dsc('Unlabeled ligand concentration of each data set in nM, from its title'),
    },
    initial(x, y, fixed) {
      const pr = profile(x, y)
      const k1 = fixed?.[3] ?? 1e8
      const k2 = fixed?.[4] ?? 0.1
      const l = (fixed?.[5] ?? 1) * 1e-9
      const occ = (k1 * l) / (k1 * l + k2)
      return [k1, k2, maxOf(pr.ys) / occ, k1, k2, fixed?.[5] ?? 1, fixed?.[6] ?? 0]
    },
    derived: (p) => ({ Ki: p[1]! / p[0]! }),
  }),
]

// ---- enzyme ------------------------------------------------------------------------------------

const enzyme: EquationDef[] = [
  def({
    id: 'morrison-ki',
    name: 'Morrison Ki (tight inhibition)',
    category: 'Enzyme kinetics — Inhibition',
    text: `Q=(Ki*(1+(S/Km)))
Y=Vo*(1-((((Et+X+Q)-(((Et+X+Q)^2)-4*Et*X)^0.5))/(2*Et)))`,
    params: ['Vo', 'Ki', 'Et', 'S', 'Km'],
    paramInfo: {
      Vo: info('Enzyme velocity with no inhibitor'),
      Ki: info('Inhibition constant (X units)'),
      Et: constant('Enzyme concentration, X units (set it)', 1),
      S: constant('Substrate concentration (set it)', 1),
      Km: constant('Michaelis-Menten constant of the substrate (set it)', 1),
    },
    initial(x, y, fixed) {
      const pr = profile(x, y)
      const et = fixed?.[2] ?? 1
      const s = fixed?.[3] ?? 1
      const km = fixed?.[4] ?? 1
      const ic50 = xAtLevel(pr, (pr.ymax + pr.ymin) / 2)
      const ki = Math.max(ic50 - et / 2, ic50 / 10) / (1 + s / km)
      return [pr.ymax, ki > 0 ? ki : 1, et, s, km]
    },
  }),
]

// ---- exponential -------------------------------------------------------------------------------

const EXP: EquationCategory = 'Exponential'

const exponential: EquationDef[] = [
  def({
    id: 'three-phase-decay',
    name: 'Three phase decay',
    category: EXP,
    text: `YFast=(Y0-Plateau)*PercentFast*.01*exp(-KFast*X)
YSlow=(Y0-Plateau)*PercentSlow*.01*exp(-KSlow*X)
YMedium=(Y0-Plateau)*(100-PercentFast - PercentSlow)*.01*exp(-Kmedium*X)
Y=Plateau + YFast + YMedium +YSlow`,
    params: ['Y0', 'Plateau', 'PercentFast', 'KFast', 'PercentSlow', 'KSlow', 'KMedium'],
    paramInfo: {
      Y0: info('Y value when X is zero'),
      Plateau: info('Y value at infinite times'),
      PercentFast: info('Percentage of the span due to the fast phase'),
      KFast: info('Rate constant of the fast phase'),
      PercentSlow: info('Percentage of the span due to the slow phase'),
      KSlow: info('Rate constant of the slow phase'),
      KMedium: info('Rate constant of the medium phase'),
    },
    initial(x, y) {
      const pr = profile(x, y)
      const k = rateFromHalfLife(pr)
      return [pr.ys[0]!, pr.ys[pr.ys.length - 1]!, 33, 10 * k, 33, k / 10, k]
    },
    derived: (p) => ({
      HalfLifeFast: Math.LN2 / p[3]!,
      HalfLifeMedium: Math.LN2 / p[6]!,
      HalfLifeSlow: Math.LN2 / p[5]!,
    }),
  }),
  def({
    id: 'plateau-one-phase-association',
    name: 'Plateau followed by one phase association',
    category: EXP,
    text: 'Y= IF( X<X0, Y0,Y0 + (Plateau-Y0)*(1 - exp(-K*(X-X0))))',
    params: ['X0', 'Y0', 'Plateau', 'K'],
    paramInfo: {
      X0: info('Time at which the association begins'),
      Y0: info('Y value before the association begins'),
      Plateau: info('Y value at infinite times'),
      K: info('Rate constant (inverse of X units)'),
    },
    initial(x, y) {
      // Same search as "Plateau followed by one phase decay": the model is linear in Y0 and
      // Plateau for fixed X0 and K.
      const full = profile(x, y)
      const n = full.xs.length
      const k0 = rateFromHalfLife(full)
      let best = [full.xs[0]!, full.ys[0]!, full.ys[n - 1]!, k0]
      let bestSS = Number.POSITIVE_INFINITY
      const step = Math.max(1, Math.ceil((n - 2) / 40))
      for (let c = 0; c < n - 2; c += step) {
        const x0 = c === 0 ? full.xs[0]! : (full.xs[c]! + full.xs[c + 1]!) / 2
        for (let g = -12; g <= 12; g++) {
          const k = k0 * 10 ** (g / 12)
          let saa = 0
          let sab = 0
          let sbb = 0
          let say = 0
          let sby = 0
          for (let i = 0; i < n; i++) {
            const e = full.xs[i]! < x0 ? 1 : Math.exp(-k * (full.xs[i]! - x0))
            const bb = 1 - e
            saa += e * e
            sab += e * bb
            sbb += bb * bb
            say += e * full.ys[i]!
            sby += bb * full.ys[i]!
          }
          const det = saa * sbb - sab * sab
          if (!(Math.abs(det) > 1e-12 * saa * sbb)) continue
          const y0 = (say * sbb - sby * sab) / det
          const pl = (sby * saa - say * sab) / det
          let ss = 0
          for (let i = 0; i < n; i++) {
            const xi = full.xs[i]!
            const f = xi < x0 ? y0 : y0 + (pl - y0) * (1 - Math.exp(-k * (xi - x0)))
            ss += (full.ys[i]! - f) ** 2
          }
          if (ss < bestSS) {
            bestSS = ss
            best = [x0, y0, pl, k]
          }
        }
      }
      return best
    },
    derived: (p) => ({ Tau: 1 / p[3]!, HalfTime: Math.LN2 / p[3]!, Span: p[2]! - p[1]! }),
  }),
]

// ---- lines and polynomials ------------------------------------------------------------------------

const LINES: EquationCategory = 'Lines and polynomials'
const ORDER = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth']

const lines: EquationDef[] = [
  def({
    id: 'horizontal-line',
    name: 'Horizontal line',
    category: LINES,
    text: 'Y = Mean + 0*X',
    params: ['Mean'],
    paramInfo: { Mean: info('The mean of all Y values') },
    initial: { Mean: 'ymid' },
  }),
  def({
    id: 'line-through-origin',
    name: 'Line through origin',
    category: LINES,
    text: 'Y= Slope*X',
    params: ['Slope'],
    paramInfo: { Slope: info('Change in Y per unit X') },
    initial(x, y) {
      let sxy = 0
      let sxx = 0
      for (let i = 0; i < x.length; i++) {
        sxy += x[i]! * y[i]!
        sxx += x[i]! * x[i]!
      }
      return [sxx > 0 ? sxy / sxx : 1]
    },
  }),
  def({
    id: 'hinge',
    name: 'Hinge function — segmental regression joined by a curve',
    category: LINES,
    text: 'Y= Intercept + Slope1*(X - X0) + (Slope2 - Slope1)*Delta*ln(1+exp((X-X0)/Delta))',
    params: ['Intercept', 'Slope1', 'Slope2', 'X0', 'Delta'],
    paramInfo: {
      Intercept: info('Y of the first line at X0'),
      Slope1: info('Slope of the first line'),
      Slope2: info('Slope of the second line'),
      X0: info('X value where the lines meet'),
      Delta: info('Sharpness of the bend (X units, > 0)', {
        bounds: [0, Number.POSITIVE_INFINITY],
      }),
    },
    initial(x, y) {
      const pr = profile(x, y)
      const n = pr.xs.length
      const h = Math.max(2, Math.floor(n / 2))
      const left =
        n >= 4 ? polynomialRegression(pr.xs.slice(0, h), pr.ys.slice(0, h), 1).coef : [pr.ys[0]!, 0]
      const right =
        n >= 4
          ? polynomialRegression(pr.xs.slice(h - 1), pr.ys.slice(h - 1), 1).coef
          : [pr.ys[0]!, 0]
      const x0 = (pr.xs[h - 1]! + pr.xs[Math.min(h, n - 1)]!) / 2
      return [left[0]! + left[1]! * x0, left[1]!, right[1]!, x0, (pr.xmax - pr.xmin) / 20]
    },
  }),
  def({
    id: 'semilog-x-log',
    name: 'Semilog line — X axis logarithmic, Y axis linear',
    category: LINES,
    text: 'Y=Yintercept + Slope*log(X)',
    params: ['Yintercept', 'Slope'],
    paramInfo: {
      Yintercept: info('Y value when X is 1'),
      Slope: info('Change in Y when X changes tenfold'),
    },
    initial(x, y) {
      const [lx, ly] = logX(x, y)
      return Array.from(polynomialRegression(lx, ly, 1).coef)
    },
  }),
  def({
    id: 'semilog-y-log',
    name: 'Semilog line — X axis linear, Y axis logarithmic',
    category: LINES,
    text: 'Y=10^(Slope*X + Yintercept)',
    params: ['Slope', 'Yintercept'],
    paramInfo: {
      Slope: info('Change in log(Y) per unit X'),
      Yintercept: info('log(Y) when X is 0'),
    },
    initial(x, y) {
      const xs: number[] = []
      const ly: number[] = []
      for (let i = 0; i < x.length; i++)
        if (y[i]! > 0) {
          xs.push(x[i]!)
          ly.push(Math.log10(y[i]!))
        }
      const c = polynomialRegression(xs, ly, 1).coef
      return [c[1]!, c[0]!]
    },
  }),
  def({
    id: 'log-log-line',
    name: 'Log-log line — both axes logarithmic',
    category: LINES,
    text: 'Y = 10^(slope*log(X) + Yintercept)',
    params: ['slope', 'Yintercept'],
    paramInfo: {
      slope: info('Change in log(Y) when X changes tenfold'),
      Yintercept: info('log(Y) when X is 1'),
    },
    initial(x, y) {
      const lx: number[] = []
      const ly: number[] = []
      for (let i = 0; i < x.length; i++)
        if (x[i]! > 0 && y[i]! > 0) {
          lx.push(Math.log10(x[i]!))
          ly.push(Math.log10(y[i]!))
        }
      const c = polynomialRegression(lx, ly, 1).coef
      return [c[1]!, c[0]!]
    },
  }),
  ...[1, 4, 5, 6].map((d) => polynomial(d, false)),
  ...[1, 2, 3, 4, 5, 6].map((d) => polynomial(d, true)),
]

/** Nth-order polynomial, plain or centered (X − XMean, XMean the data set's mean X). */
function polynomial(degree: number, centered: boolean): EquationDef {
  const bs = Array.from({ length: degree + 1 }, (_, k) => `B${k}`)
  const xv = centered ? 'XC' : 'X'
  const terms = bs.map((b, k) => (k === 0 ? b : k === 1 ? `${b}*${xv}` : `${b}*${xv}^${k}`))
  const text = `${centered ? 'XC = X - XMean\n' : ''}Y=${terms.join(' + ')}`
  const params = centered ? [...bs, 'XMean'] : bs
  const paramInfo: Record<string, ParamInfo> = Object.fromEntries(
    bs.map((b, k) => [
      b,
      info(
        k === 0
          ? `Y value when ${centered ? 'X is the mean X' : 'X is zero'}`
          : `Coefficient of ${xv}^${k}`,
      ),
    ]),
  )
  if (centered) paramInfo.XMean = info('The mean X of the data set (a data set constant)', 'meanX')
  return def({
    id: `${centered ? 'centered-' : ''}polynomial-${degree}`,
    name: centered
      ? `Centered ${ORDER[degree - 1]!.toLowerCase()} order polynomial`
      : `${ORDER[degree - 1]} order polynomial`,
    category: LINES,
    text,
    params,
    paramInfo,
    initial(x, y, fixed) {
      // Linear least squares gives the solution (Prism starts every coefficient at 1.0).
      const m = centered ? (fixed?.[degree + 1] ?? meanOfX(x)) : 0
      const xs = Array.from(x, (v) => v - m)
      const c = Array.from(polynomialRegression(xs, y, degree).coef)
      return centered ? [...c, m] : c
    },
  })
}

function meanOfX(x: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i]!
  return s / x.length
}

// ---- Gaussian, Lorentzian ----------------------------------------------------------------------

const GAUSS: EquationCategory = 'Gaussian'

/** Amplitude, center and width of the largest peak (and of a second one for sums). */
function peaks(x: ArrayLike<number>, y: ArrayLike<number>) {
  const pr = profile(x, y)
  const k = pr.ys.indexOf(pr.ymax)
  const amp = pr.ymax
  const halfLeft = xAtLevel(
    { ...pr, xs: pr.xs.slice(0, k + 1).reverse(), ys: pr.ys.slice(0, k + 1).reverse() },
    amp / 2,
  )
  const halfRight = xAtLevel({ ...pr, xs: pr.xs.slice(k), ys: pr.ys.slice(k) }, amp / 2)
  const fwhm = halfRight - halfLeft > 0 ? halfRight - halfLeft : (pr.xmax - pr.xmin) / 6
  // Second peak: the largest local maximum at least a width away.
  let k2 = -1
  for (let i = 1; i + 1 < pr.ys.length; i++) {
    if (Math.abs(pr.xs[i]! - pr.xs[k]!) < fwhm) continue
    if (
      pr.ys[i]! >= pr.ys[i - 1]! &&
      pr.ys[i]! >= pr.ys[i + 1]! &&
      (k2 < 0 || pr.ys[i]! > pr.ys[k2]!)
    )
      k2 = i
  }
  const second =
    k2 >= 0
      ? { amp: pr.ys[k2]!, center: pr.xs[k2]! }
      : {
          amp: amp / 2,
          center: pr.xs[k]! + (pr.xs[k]! - pr.xmin > pr.xmax - pr.xs[k]! ? -fwhm : fwhm),
        }
  return { amp, center: pr.xs[k]!, fwhm, second }
}

const gaussian: EquationDef[] = [
  def({
    id: 'gaussian-sum-two',
    name: 'Sum of two Gaussian distributions',
    category: GAUSS,
    text: `One=Amplitude1*exp(-0.5*((X-Mean1)/SD1)^2)
Two=Amplitude2*exp(-0.5*((X-Mean2)/SD2)^2)
Y= One + Two`,
    params: ['Amplitude1', 'Mean1', 'SD1', 'Amplitude2', 'Mean2', 'SD2'],
    paramInfo: {
      Amplitude1: info('Height of the first peak'),
      Mean1: info('X value at the first peak'),
      SD1: info('Width (SD) of the first peak'),
      Amplitude2: info('Height of the second peak'),
      Mean2: info('X value at the second peak'),
      SD2: info('Width (SD) of the second peak'),
    },
    initial(x, y) {
      const p = peaks(x, y)
      const sd = p.fwhm / 2.3548
      return [p.amp, p.center, sd, p.second.amp, p.second.center, sd]
    },
  }),
  def({
    id: 'lognormal',
    name: 'Lognormal',
    category: GAUSS,
    text: 'Y=(A/X)*exp(-0.5*(ln(X/GeoMean)/ln(GeoSD))^2)',
    params: ['A', 'GeoMean', 'GeoSD'],
    paramInfo: {
      A: info('Scale (area-related) factor'),
      GeoMean: info('Geometric mean (X units)'),
      GeoSD: info('Geometric SD factor (unitless, > 1)'),
    },
    initial(x, y) {
      // A Gaussian on ln X of X·Y.
      const lx: number[] = []
      const w: number[] = []
      for (let i = 0; i < x.length; i++)
        if (x[i]! > 0) {
          lx.push(Math.log(x[i]!))
          w.push(Math.max(0, x[i]! * y[i]!))
        }
      const p = peaks(lx, w)
      const sd = p.fwhm / 2.3548
      return [p.amp, Math.exp(p.center), Math.exp(sd > 0 ? sd : 0.5)]
    },
    derived: (p) => ({
      Amplitude: p[0]! / (p[1]! / Math.exp(0.5 * Math.log(p[2]!) ** 2)),
      Area: p[0]! * Math.sqrt(2 * Math.PI) * Math.log(p[2]!),
    }),
  }),
  def({
    id: 'cumulative-gaussian-percent',
    name: 'Cumulative Gaussian — Y values are percentages',
    category: GAUSS,
    text: `Top=100
z=(X-Mean)/SD
Y=Top * zdist(z)`,
    params: ['Mean', 'SD'],
    paramInfo: { Mean: info('Mean of the distribution'), SD: info('SD of the distribution') },
    initial: { Mean: 'xatymid', SD: '0.25*xrange' },
  }),
  def({
    id: 'cumulative-gaussian-fraction',
    name: 'Cumulative Gaussian — Y values are fractions',
    category: GAUSS,
    text: `Top=1.0
z=(X-Mean)/SD
Y=Top * zdist(z)`,
    params: ['Mean', 'SD'],
    paramInfo: { Mean: info('Mean of the distribution'), SD: info('SD of the distribution') },
    initial: { Mean: 'xatymid', SD: '0.25*xrange' },
  }),
  def({
    id: 'cumulative-gaussian-counts',
    name: 'Cumulative Gaussian — Y values are counts',
    category: GAUSS,
    text: `z=(X-Mean)/SD
Y=N * zdist(z)`,
    params: ['Mean', 'SD', 'N'],
    paramInfo: {
      Mean: info('Mean of the distribution'),
      SD: info('SD of the distribution'),
      N: constant('Number of observations (set it)', 100),
    },
    initial(x, y, fixed) {
      const n = fixed?.[2] ?? profile(x, y).ymax
      const pr = profile(x, y)
      return [xAtLevel(pr, n / 2), (pr.xmax - pr.xmin) / 4, n]
    },
  }),
  def({
    id: 'lorentzian-sum-two',
    name: 'Sum of two Lorentzian distributions',
    category: GAUSS,
    text: `One=Amplitude1/(1+((X-Center1)/Width1)^2)
Two=Amplitude2/(1+((X-Center2)/Width2)^2)
Y=One + Two`,
    params: ['Amplitude1', 'Center1', 'Width1', 'Amplitude2', 'Center2', 'Width2'],
    paramInfo: {
      Amplitude1: info('Height of the first peak'),
      Center1: info('X value at the first peak'),
      Width1: info('Half the width of the first peak at half its height'),
      Amplitude2: info('Height of the second peak'),
      Center2: info('X value at the second peak'),
      Width2: info('Half the width of the second peak at half its height'),
    },
    initial(x, y) {
      const p = peaks(x, y)
      return [p.amp, p.center, p.fwhm / 2, p.second.amp, p.second.center, p.fwhm / 2]
    },
  }),
]

// ---- sine waves --------------------------------------------------------------------------------

const SINE: EquationCategory = 'Sine waves and peaks'

/** Amplitude, wavelength and phase from upward crossings of the mean (as the standard sine). */
function sineStart(x: ArrayLike<number>, y: ArrayLike<number>) {
  const pr = profile(x, y)
  const mean = pr.ys.reduce((s, v) => s + v, 0) / pr.ys.length
  // Upward crossings of the mean, with hysteresis: a crossing counts only after Y has been at
  // least 30% of the half-range below the mean, so noise near the mean adds none.
  const band = 0.3 * ((pr.ymax - pr.ymin) / 2)
  const ups: number[] = []
  let armed = false
  for (let i = 0; i + 1 < pr.xs.length; i++) {
    const a = pr.ys[i]! - mean
    const b = pr.ys[i + 1]! - mean
    if (a < -band) armed = true
    if (armed && a < 0 && b >= 0) {
      ups.push(pr.xs[i]! + ((pr.xs[i + 1]! - pr.xs[i]!) * a) / (a - b))
      armed = false
    }
  }
  const wl =
    ups.length >= 2 ? (ups[ups.length - 1]! - ups[0]!) / (ups.length - 1) : pr.xmax - pr.xmin
  const x0 = ups[0] ?? pr.xmin
  const turn = 2 * Math.PI
  let phase = -((turn * x0) / wl) % turn
  if (phase > Math.PI) phase -= turn
  if (phase <= -Math.PI) phase += turn
  return { amp: Math.max(Math.abs(pr.ymax), Math.abs(pr.ymin)), wl, phase, mean, pr }
}

const sine: EquationDef[] = [
  def({
    id: 'damped-sine-wave',
    name: 'Damped sine wave',
    category: SINE,
    text: 'Y= Amplitude*exp(-K*X)*sin((2*pi*X/Wavelength)+PhaseShift)',
    params: ['Amplitude', 'Wavelength', 'PhaseShift', 'K'],
    paramInfo: {
      Amplitude: info('Height of the wave at X = 0 (before damping)'),
      Wavelength: info('Distance between peaks (X units)'),
      PhaseShift: info('Phase shift, in radians'),
      K: info('Damping rate constant (inverse of X units)'),
    },
    initial(x, y) {
      const s = sineStart(x, y)
      // Damping from the decline of the peaks: largest |Y| in the first and last thirds.
      const n = s.pr.xs.length
      const third = Math.max(1, Math.floor(n / 3))
      const a1 = maxOf(s.pr.ys.slice(0, third).map(Math.abs))
      const a2 = maxOf(s.pr.ys.slice(n - third).map(Math.abs))
      const dx = s.pr.xs[n - 1 - Math.floor(third / 2)]! - s.pr.xs[Math.floor(third / 2)]!
      const k = a2 > 0 && a1 > a2 && dx > 0 ? Math.log(a1 / a2) / dx : 0
      return [a1 * Math.exp(k * s.pr.xs[Math.floor(third / 2)]!), s.wl, s.phase, k]
    },
    derived: (p) => ({ Frequency: 1 / p[1]!, HalfLife: Math.LN2 / p[3]! }),
  }),
  def({
    id: 'sinc-wave',
    name: 'Sinc() function',
    category: SINE,
    text: 'Y=IF(X=0,Amplitude,Amplitude*sin(2*pi*X/Wavelength)/(2*pi*X/Wavelength) )',
    params: ['Amplitude', 'Wavelength'],
    paramInfo: {
      Amplitude: info('Y value at X = 0'),
      Wavelength: info('Distance between the zeros on each side of the peak, doubled (X units)'),
    },
    initial(x, y) {
      const pr = profile(x, y)
      // First zero crossing from the peak (at X = 0) is at Wavelength/2.
      let z = Number.NaN
      for (let i = 0; i + 1 < pr.xs.length; i++) {
        if (pr.xs[i]! >= 0 && pr.ys[i]! > 0 && pr.ys[i + 1]! <= 0) {
          z = pr.xs[i]! + ((pr.xs[i + 1]! - pr.xs[i]!) * pr.ys[i]!) / (pr.ys[i]! - pr.ys[i + 1]!)
          break
        }
      }
      return [pr.ymax, Number.isFinite(z) && z > 0 ? 2 * z : (pr.xmax - pr.xmin) / 2]
    },
    derived: (p) => ({ Frequency: 1 / p[1]! }),
  }),
]

// ---- growth ------------------------------------------------------------------------------------

const growth: EquationDef[] = [
  def({
    id: 'log-exponential-growth',
    name: 'Log of exponential growth',
    category: 'Growth and sigmoidal',
    text: 'Y=logY0 + k*X',
    params: ['logY0', 'k'],
    paramInfo: {
      logY0: info('Natural log of the population at X = 0'),
      k: info('Growth rate constant (inverse of X units)'),
    },
    initial: (x, y) => Array.from(polynomialRegression(x, y, 1).coef),
    derived: (p) => ({ DoublingTime: Math.LN2 / p[1]! }),
  }),
]

// ---- linear-quadratic model of cell death by radiation -----------------------------------------------

const LQ: EquationCategory = 'Linear-quadratic (radiation)'
const LQ_INFO = {
  A: info('Linear killing coefficient (per dose unit)'),
  B: info('Quadratic killing coefficient (per dose unit squared)'),
}

/** A and B from a log-quadratic fit of the surviving fraction (s = surviving at dose X). */
function lqStart(x: ArrayLike<number>, s: (i: number) => number): [number, number] {
  const xs: number[] = []
  const ls: number[] = []
  for (let i = 0; i < x.length; i++) {
    const v = s(i)
    if (v > 0 && v < 1) {
      xs.push(x[i]!)
      ls.push(-Math.log(v))
    }
  }
  if (xs.length < 3) return [0.1, 0.01]
  // −ln S = A·X + B·X² through the origin.
  let s11 = 0
  let s12 = 0
  let s22 = 0
  let t1 = 0
  let t2 = 0
  for (let i = 0; i < xs.length; i++) {
    const u = xs[i]!
    s11 += u * u
    s12 += u ** 3
    s22 += u ** 4
    t1 += u * ls[i]!
    t2 += u * u * ls[i]!
  }
  const det = s11 * s22 - s12 * s12
  const a = (t1 * s22 - t2 * s12) / det
  const b = (t2 * s11 - t1 * s12) / det
  return [Math.max(a, 1e-3), Math.max(b, 1e-4)]
}

const lq: EquationDef[] = [
  ['fs', 'Y is fraction surviving', 'Y = exp(-1*(A*X + B*X^2))', (v: number) => v],
  ['ps', 'Y is percent surviving', 'Y = 100 * exp(-1*(A*X + B*X^2))', (v: number) => v / 100],
  ['fd', 'Y is fraction dead', 'Y = 1.0 - exp(-1*(A*X + B*X^2))', (v: number) => 1 - v],
  [
    'pd',
    'Y is percentage dead',
    'Y = 100 * [ 1.0 -exp(-1*(A*X + B*X^2))]',
    (v: number) => 1 - v / 100,
  ],
].map(([id, name, text, surv]) =>
  def({
    id: `linear-quadratic-${id as string}`,
    name: `Linear quadratic: ${name as string}`,
    category: LQ,
    text: text as string,
    params: ['A', 'B'],
    paramInfo: LQ_INFO,
    initial: (x, y) => lqStart(x, (i) => (surv as (v: number) => number)(y[i]!)),
  }),
)
lq.push(
  def({
    id: 'linear-quadratic-ns',
    name: 'Linear quadratic: Y is number surviving',
    category: LQ,
    text: 'Y = Y0 * exp(-1*(A*X + B*X^2))',
    params: ['Y0', 'A', 'B'],
    paramInfo: { Y0: info('Number of cells at X = 0'), ...LQ_INFO },
    initial(x, y) {
      const y0 = profile(x, y).ys[0]!
      return [y0, ...lqStart(x, (i) => y[i]! / y0)]
    },
  }),
  def({
    id: 'linear-quadratic-nd',
    name: 'Linear quadratic: Y is number dead',
    category: LQ,
    text: 'Y = Y0 * [1.0 - exp(-1*(A*X + B*X^2))]',
    params: ['Y0', 'A', 'B'],
    paramInfo: { Y0: info('Number of cells alive at X = 0'), ...LQ_INFO },
    initial(x, y) {
      const y0 = profile(x, y).ymax * 1.1
      return [y0, ...lqStart(x, (i) => 1 - y[i]! / y0)]
    },
  }),
)

// ---- classic equations (Prism 1–3) whose form differs from the modern ones ------------------------

const CLASSIC: EquationCategory = 'Classic equations'

const classic: EquationDef[] = [
  def({
    id: 'classic-one-phase-decay',
    name: 'One phase exponential decay (classic)',
    category: CLASSIC,
    text: 'Y = Span*exp(-K*X) + Plateau',
    params: ['Span', 'K', 'Plateau'],
    paramInfo: {
      Span: info('Y at X = 0 minus the plateau'),
      K: info('Rate constant'),
      Plateau: info('Y value at infinite times'),
    },
    initial(x, y) {
      const pr = profile(x, y)
      const last = pr.ys[pr.ys.length - 1]!
      return [pr.ys[0]! - last, rateFromHalfLife(pr), last]
    },
    derived: (p) => ({ HalfLife: Math.LN2 / p[1]! }),
  }),
  def({
    id: 'classic-two-phase-decay',
    name: 'Two phase exponential decay (classic)',
    category: CLASSIC,
    text: 'Y = Span1*exp(-K1*X) + Span2*exp(-K2*X) + Plateau',
    params: ['Span1', 'K1', 'Span2', 'K2', 'Plateau'],
    paramInfo: {
      Span1: info('Span of the first phase'),
      K1: info('Rate constant of the first phase'),
      Span2: info('Span of the second phase'),
      K2: info('Rate constant of the second phase'),
      Plateau: info('Y value at infinite times'),
    },
    initial(x, y) {
      const pr = profile(x, y)
      const last = pr.ys[pr.ys.length - 1]!
      const span = pr.ys[0]! - last
      const k = rateFromHalfLife(pr)
      return [span / 2, 4 * k, span / 2, k / 4, last]
    },
  }),
  def({
    id: 'classic-one-phase-association',
    name: 'One phase exponential association (classic)',
    category: CLASSIC,
    text: 'Y = Ymax*(1 - exp(-K*X))',
    params: ['Ymax', 'K'],
    paramInfo: { Ymax: info('Y value at infinite times'), K: info('Rate constant') },
    initial(x, y) {
      const pr = profile(x, y)
      return [pr.ys[pr.ys.length - 1]!, rateFromHalfLife(pr)]
    },
  }),
  def({
    id: 'classic-two-phase-association',
    name: 'Two phase exponential association (classic)',
    category: CLASSIC,
    text: 'Y = Ymax1*(1 - exp(-K1*X)) + Ymax2*(1 - exp(-K2*X))',
    params: ['Ymax1', 'K1', 'Ymax2', 'K2'],
    paramInfo: {
      Ymax1: info('Plateau of the first phase'),
      K1: info('Rate constant of the first phase'),
      Ymax2: info('Plateau of the second phase'),
      K2: info('Rate constant of the second phase'),
    },
    initial(x, y) {
      const pr = profile(x, y)
      const top = pr.ys[pr.ys.length - 1]!
      const k = rateFromHalfLife(pr)
      return [top / 2, 4 * k, top / 2, k / 4]
    },
  }),
  def({
    id: 'classic-power-series',
    name: 'Power series (classic)',
    category: CLASSIC,
    text: 'Y = A*X^B + C*X^D',
    params: ['A', 'B', 'C', 'D'],
    paramInfo: {
      A: info('Coefficient of the first term'),
      B: info('Power of the first term'),
      C: info('Coefficient of the second term'),
      D: info('Power of the second term'),
    },
    // The guide: all four start at 1.0 ("not very helpful"). Ours: a log-log line through the
    // upper half of X for the term that dominates there, then one through what it leaves at
    // the lower half for the other term.
    initial(x, y) {
      const pr = profile(x, y)
      const pos = pr.xs.map((_, i) => i).filter((i) => pr.xs[i]! > 0)
      const logLine = (idx: number[], ys: number[]): [number, number] | null => {
        const lx: number[] = []
        const ly: number[] = []
        for (const i of idx)
          if (ys[i]! > 0) {
            lx.push(Math.log(pr.xs[i]!))
            ly.push(Math.log(ys[i]!))
          }
        if (lx.length < 2) return null
        const c = polynomialRegression(lx, ly, 1).coef
        return [Math.exp(c[0]!), c[1]!]
      }
      const h = Math.floor(pos.length / 2)
      const first = logLine(pos.slice(h), pr.ys)
      if (!first) return [1, 1, 1, 1]
      const rest = pr.ys.map((v, i) => v - first[0] * pr.xs[i]! ** first[1])
      const second = logLine(pos.slice(0, Math.max(2, h)), rest)
      return second
        ? [first[0], first[1], second[0], second[1]]
        : [first[0], first[1], first[0] / 10, first[1] - 1]
    },
  }),
  def({
    id: 'classic-sine-wave',
    name: 'Sine wave (classic)',
    category: CLASSIC,
    text: 'Y = Baseline + Amplitude*sin(Frequency*X + Offset)',
    params: ['Baseline', 'Amplitude', 'Frequency', 'Offset'],
    paramInfo: {
      Baseline: info('Average Y value'),
      Amplitude: info('Height of the peaks above the baseline'),
      Frequency: info('Angular frequency (radians per X unit)'),
      Offset: info('Phase offset, in radians'),
    },
    initial(x, y) {
      const s = sineStart(x, y)
      return [s.mean, (s.pr.ymax - s.pr.ymin) / 2, (2 * Math.PI) / s.wl, s.phase]
    },
  }),
]

/** The equations added in roadmap 20. */
export const MORE_EQUATIONS: readonly EquationDef[] = [
  ...doseConc,
  ...doseSpecialConc,
  ...binding,
  ...enzyme,
  ...exponential,
  ...lines,
  ...gaussian,
  ...sine,
  ...growth,
  ...lq,
  ...classic,
]
