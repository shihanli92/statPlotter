import type { EquationDef, ParamInfo } from './equations.ts'
import { displayFormula, formulaModel } from './formulaModel.ts'
import { argmax, maxOf, profile, rateFromHalfLife, xAtLevel, xRange } from './initialRules.ts'
import { polynomialRegression } from './polynomial.ts'

/**
 * More of the built-in equations (Phase 14), each written in its published form and evaluated
 * through the user-equation language, which gives exact gradients by automatic
 * differentiation. Parameter names and order follow the published form. Initial-value rules
 * are ours, in the same style as the others (plateaus from the smallest and
 * largest Y, half-way X from where Y crosses a level, rates from the half-life).
 */

const LN2 = Math.LN2

export type LabDef = Omit<EquationDef, 'f' | 'grad' | 'formula'> & { text: string }

/**
 * An equation from its formula in the user-equation language. Formulas with lines for
 * particular data sets (`<A>…`) get per-data-set models (`forDataSet`).
 */
export function lab(d: LabDef): EquationDef {
  const { text, ...rest } = d
  const fm = formulaModel(text, d.params)
  const def: EquationDef = { ...rest, formula: displayFormula(text), f: fm.f, grad: fm.grad }
  const variant = fm.variant
  if (variant) def.forDataSet = (k) => ({ ...rest, formula: def.formula, ...variant(k) })
  return def
}

const BOTTOM: ParamInfo = { description: 'Y value at the bottom plateau' }
const TOP: ParamInfo = { description: 'Y value at the top plateau' }
const HILL: ParamInfo = { description: 'Hill slope (steepness of the curve)' }

/** X where Y crosses Bottom + frac·(Top − Bottom) for a curve from ymin/ymax in trend direction. */
function levelX(x: ArrayLike<number>, y: ArrayLike<number>, frac: number): number {
  const pr = profile(x, y)
  const lo = pr.trend > 0 ? pr.ymin : pr.ymax
  const hi = pr.trend > 0 ? pr.ymax : pr.ymin
  return xAtLevel(pr, lo + frac * (hi - lo))
}

/** Positive half-saturation X (where Y first reaches half of its maximum). */
function halfMaxX(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const pr = profile(x, y)
  const kd = xAtLevel(pr, pr.ymax / 2)
  return kd > 0 ? kd : xRange(pr) / 4
}

const positive = (v: number | undefined, fallback: number) =>
  v !== undefined && v > 0 ? v : fallback

const SINE_INFO: Record<string, ParamInfo> = {
  Amplitude: { description: 'Height of the peaks above the baseline' },
  Wavelength: { description: 'Distance between peaks (X units)' },
  PhaseShift: { description: 'Phase shift, in radians' },
}

/**
 * [Amplitude, Wavelength, PhaseShift, Baseline] for a sine wave: amplitude from the Y range,
 * wavelength from the mean spacing of upward crossings of the baseline (the mean Y, or 0), phase
 * so that the curve crosses the baseline upward at the first such crossing, in (−π, π].
 */
function sineStart(x: ArrayLike<number>, y: ArrayLike<number>, baseline: boolean): number[] {
  const pr = profile(x, y)
  const mean = baseline ? pr.ys.reduce((s, v) => s + v, 0) / pr.ys.length : 0
  const amp = baseline ? (pr.ymax - pr.ymin) / 2 : Math.max(Math.abs(pr.ymax), Math.abs(pr.ymin))
  const ups: number[] = []
  for (let i = 0; i + 1 < pr.xs.length; i++) {
    const a = pr.ys[i]! - mean
    const b = pr.ys[i + 1]! - mean
    if (a < 0 && b >= 0) ups.push(pr.xs[i]! + ((pr.xs[i + 1]! - pr.xs[i]!) * a) / (a - b))
  }
  const wl = ups.length >= 2 ? (ups[ups.length - 1]! - ups[0]!) / (ups.length - 1) : xRange(pr)
  const x0 = ups[0] ?? pr.xmin
  const turn = 2 * Math.PI
  let phase = -((turn * x0) / wl) % turn
  if (phase > Math.PI) phase -= turn
  if (phase <= -Math.PI) phase += turn
  return [amp, wl, phase, mean]
}

export const LAB_EQUATIONS: readonly EquationDef[] = [
  // ---- dose-response ----------------------------------------------------------------------
  lab({
    id: 'agonist-response-find-ecanything',
    name: 'log(agonist) vs. response — Find ECanything',
    category: 'Dose-response — Stimulation',
    text: `LogEC50 = LogECF - (1/HillSlope)*log(F/(100 - F))
Y = Bottom + (Top - Bottom)/(1 + 10^((LogEC50 - X)*HillSlope))`,
    params: ['Bottom', 'Top', 'LogECF', 'HillSlope', 'F'],
    paramInfo: {
      Bottom: BOTTOM,
      Top: TOP,
      LogECF: { description: 'log of the concentration giving F percent of the response' },
      HillSlope: HILL,
      F: {
        description: 'The percentage of the response to find (set it; 50 gives the EC50)',
        defaultConstraint: { constant: 50 },
      },
    },
    initial(x, y, fixed) {
      const pr = profile(x, y)
      const F = positive(fixed?.[4], 50)
      const h = pr.trend
      return [pr.ymin, pr.ymax, levelX(x, y, h > 0 ? F / 100 : 1 - F / 100), h, F]
    },
    derived: (p) => ({
      ECF: 10 ** p[2]!,
      LogEC50: p[2]! - Math.log10(p[4]! / (100 - p[4]!)) / p[3]!,
    }),
  }),
  lab({
    id: 'biphasic-dose-response',
    name: 'Biphasic dose-response',
    category: 'Dose-response — Stimulation',
    text: `Span = Top - Bottom
Section1 = Span*Frac/(1 + 10^((LogEC50_1 - X)*nH1))
Section2 = Span*(1 - Frac)/(1 + 10^((LogEC50_2 - X)*nH2))
Y = Bottom + Section1 + Section2`,
    params: ['Bottom', 'Top', 'Frac', 'LogEC50_1', 'nH1', 'LogEC50_2', 'nH2'],
    paramInfo: {
      Bottom: BOTTOM,
      Top: TOP,
      Frac: { description: 'Fraction of the span due to the first (more potent) phase' },
      LogEC50_1: { description: 'log EC50 of the first phase' },
      nH1: { description: 'Hill slope of the first phase' },
      LogEC50_2: { description: 'log EC50 of the second phase' },
      nH2: { description: 'Hill slope of the second phase' },
    },
    initial(x, y) {
      const pr = profile(x, y)
      return [pr.ymin, pr.ymax, 0.5, levelX(x, y, 0.25), pr.trend, levelX(x, y, 0.75), pr.trend]
    },
    derived: (p) => ({ EC50_1: 10 ** p[3]!, EC50_2: 10 ** p[5]! }),
  }),
  lab({
    id: 'bell-shaped-dose-response',
    name: 'Bell-shaped dose-response',
    category: 'Dose-response — Stimulation',
    text: `Span1 = Plateau1 - Dip
Span2 = Plateau2 - Dip
Section1 = Span1/(1 + 10^((LogEC50_1 - X)*nH1))
Section2 = Span2/(1 + 10^((X - LogEC50_2)*nH2))
Y = Dip + Section1 + Section2`,
    params: ['Dip', 'Plateau1', 'Plateau2', 'LogEC50_1', 'LogEC50_2', 'nH1', 'nH2'],
    paramInfo: {
      Dip: { description: 'Plateau1 + Plateau2 − Dip is the Y value at the middle plateau' },
      Plateau1: { description: 'Y value at the plateau at high X' },
      Plateau2: { description: 'Y value at the plateau at low X' },
      LogEC50_1: { description: 'log EC50 of the rising phase' },
      LogEC50_2: { description: 'log EC50 of the falling phase' },
      nH1: { description: 'Hill slope of the rising phase' },
      nH2: { description: 'Hill slope of the falling phase' },
    },
    initial(x, y) {
      const pr = profile(x, y)
      const first = pr.ys[0]!
      const last = pr.ys[pr.ys.length - 1]!
      // The peak is the extreme farther from the two ends.
      const kMax = argmax(pr.ys)
      const kMin = argmax(pr.ys.map((v) => -v))
      const dMax = pr.ymax - Math.max(first, last)
      const dMin = Math.min(first, last) - pr.ymin
      const k = dMax >= dMin ? kMax : kMin
      const peak = pr.ys[k]!
      const rise = { ...pr, xs: pr.xs.slice(0, k + 1), ys: pr.ys.slice(0, k + 1) }
      const fall = { ...pr, xs: pr.xs.slice(k), ys: pr.ys.slice(k) }
      const l1 = xAtLevel(rise, (first + peak) / 2)
      const l2 = xAtLevel(fall, (peak + last) / 2)
      return [last + first - peak, last, first, l1, l2 > l1 ? l2 : l1 + xRange(pr) / 4, 1, 1]
    },
  }),
  // ---- binding: saturation -------------------------------------------------------------------
  lab({
    id: 'one-site-specific-hill',
    name: 'Specific binding with Hill slope',
    category: 'Binding',
    text: 'Y = Bmax*X^h/(Kd^h + X^h)',
    params: ['Bmax', 'Kd', 'h'],
    paramInfo: {
      Bmax: { description: 'Maximum specific binding' },
      Kd: { description: 'Ligand concentration giving half-maximal binding (X units)' },
      h: { description: 'Hill slope' },
    },
    initial: (x, y) => [profile(x, y).ymax, halfMaxX(x, y), 1],
  }),
  lab({
    id: 'two-sites-specific',
    name: 'Two sites — Specific binding',
    category: 'Binding',
    text: `Site1 = BmaxHi*X/(KdHi + X)
Site2 = BmaxLo*X/(KdLo + X)
Y = Site1 + Site2`,
    params: ['BmaxHi', 'KdHi', 'BmaxLo', 'KdLo'],
    paramInfo: {
      BmaxHi: { description: 'Maximum binding to the high-affinity site' },
      KdHi: { description: 'Dissociation constant of the high-affinity site' },
      BmaxLo: { description: 'Maximum binding to the low-affinity site' },
      KdLo: { description: 'Dissociation constant of the low-affinity site' },
    },
    initial(x, y) {
      const ymax = profile(x, y).ymax
      const kd = halfMaxX(x, y)
      return [ymax / 2, kd / 10, ymax / 2, kd * 10]
    },
  }),
  // ---- binding: competitive ------------------------------------------------------------------
  lab({
    id: 'one-site-fit-logki',
    name: 'One site — Fit Ki',
    category: 'Binding — Competitive',
    text: `logEC50 = log(10^logKi*(1 + HotNM/HotKdNM))
Y = (Top - Bottom)/(1 + 10^(X - logEC50)) + Bottom`,
    params: ['Top', 'Bottom', 'logKi', 'HotNM', 'HotKdNM'],
    paramInfo: {
      Top: TOP,
      Bottom: BOTTOM,
      logKi: { description: 'log of the unlabeled ligand’s equilibrium dissociation constant' },
      HotNM: {
        description: 'Concentration of the labeled ligand, nM (set it)',
        defaultConstraint: { constant: 1 },
      },
      HotKdNM: {
        description: 'Kd of the labeled ligand, nM (set it)',
        defaultConstraint: { constant: 1 },
      },
    },
    initial(x, y, fixed) {
      const pr = profile(x, y)
      const ratio = positive(fixed?.[3], 1) / positive(fixed?.[4], 1)
      return [
        pr.ymax,
        pr.ymin,
        levelX(x, y, 0.5) - Math.log10(1 + ratio),
        fixed?.[3] ?? 1,
        fixed?.[4] ?? 1,
      ]
    },
    derived: (p) => ({ Ki: 10 ** p[2]!, IC50: 10 ** p[2]! * (1 + p[3]! / p[4]!) }),
  }),
  lab({
    id: 'two-sites-fit-logic50',
    name: 'Two sites — Fit logIC50',
    category: 'Binding — Competitive',
    text: `Span = Top - Bottom
Section1 = Span*FractionHi/(1 + 10^(X - LogIC50Hi))
Section2 = Span*(1 - FractionHi)/(1 + 10^(X - LogIC50Lo))
Y = Bottom + Section1 + Section2`,
    params: ['Top', 'Bottom', 'FractionHi', 'LogIC50Hi', 'LogIC50Lo'],
    paramInfo: {
      Top: TOP,
      Bottom: BOTTOM,
      FractionHi: { description: 'Fraction of the binding to the high-affinity site' },
      LogIC50Hi: { description: 'log IC50 of the high-affinity site' },
      LogIC50Lo: { description: 'log IC50 of the low-affinity site' },
    },
    initial(x, y) {
      const pr = profile(x, y)
      // A falling curve: a quarter of the span is gone at the first site's IC50.
      const at = (frac: number) => xAtLevel(pr, pr.ymin + frac * (pr.ymax - pr.ymin))
      return [pr.ymax, pr.ymin, 0.5, at(0.75), at(0.25)]
    },
    derived: (p) => ({ IC50Hi: 10 ** p[3]!, IC50Lo: 10 ** p[4]! }),
  }),
  // ---- binding: kinetics ---------------------------------------------------------------------
  lab({
    id: 'dissociation-one-phase',
    name: 'Dissociation — One phase exponential decay',
    category: 'Binding — Kinetics',
    text: 'Y = (Y0 - NS)*exp(-K*X) + NS',
    params: ['Y0', 'NS', 'K'],
    paramInfo: {
      Y0: { description: 'Binding at time zero' },
      NS: { description: 'Nonspecific binding (binding at infinite time)' },
      K: { description: 'Dissociation rate constant (koff), inverse of X units' },
    },
    initial(x, y) {
      const pr = profile(x, y)
      return [pr.ys[0]!, pr.ys[pr.ys.length - 1]!, rateFromHalfLife(pr)]
    },
    derived: (p) => ({ HalfLife: LN2 / p[2]! }),
  }),
  lab({
    id: 'association-one-conc',
    name: 'Association kinetics — One concentration of hot ligand',
    category: 'Binding — Kinetics',
    text: `Kd = Koff/Kon
L = HotNM*1e-9
Kob = Kon*L + Koff
Occupancy = L/(L + Kd)
Ymax = Occupancy*Bmax
Y = Ymax*(1 - exp(-1*Kob*X))`,
    params: ['Kon', 'HotNM', 'Koff', 'Bmax'],
    paramInfo: {
      Kon: { description: 'Association rate constant, M⁻¹ per X unit' },
      HotNM: {
        description: 'Concentration of the labeled ligand, nM (set it)',
        defaultConstraint: { constant: 1 },
      },
      Koff: {
        description:
          'Dissociation rate constant, per X unit (set it from a dissociation experiment)',
        defaultConstraint: { constant: 0.1 },
      },
      Bmax: { description: 'Maximal binding at equilibrium with a saturating ligand' },
    },
    initial(x, y, fixed) {
      const pr = profile(x, y)
      const hot = positive(fixed?.[1], 1) * 1e-9
      const kob = rateFromHalfLife(pr)
      const koff = fixed?.[2] !== undefined && fixed[2] > 0 && fixed[2] < kob ? fixed[2] : kob / 2
      const kon = (kob - koff) / hot
      const occ = hot / (hot + koff / kon)
      return [kon, fixed?.[1] ?? 1, koff, pr.ymax / occ]
    },
    derived: (p) => ({ Kd: p[2]! / p[0]!, Kob: p[0]! * p[1]! * 1e-9 + p[2]! }),
  }),
  // ---- enzyme kinetics -------------------------------------------------------------------------
  lab({
    id: 'allosteric-sigmoidal',
    name: 'Allosteric sigmoidal',
    category: 'Enzyme kinetics',
    text: 'Y = Vmax*X^h/(Khalf^h + X^h)',
    params: ['Vmax', 'h', 'Khalf'],
    paramInfo: {
      Vmax: { description: 'Maximum enzyme velocity' },
      h: { description: 'Hill slope' },
      Khalf: { description: 'Substrate concentration giving half-maximal velocity' },
    },
    initial: (x, y) => [profile(x, y).ymax, 1, halfMaxX(x, y)],
    derived: (p) => ({ Kprime: p[2]! ** p[1]! }),
  }),
  lab({
    id: 'kcat',
    name: 'kcat (Michaelis-Menten with enzyme concentration)',
    category: 'Enzyme kinetics',
    text: 'Y = Et*kcat*X/(Km + X)',
    params: ['Et', 'kcat', 'Km'],
    paramInfo: {
      Et: {
        description: 'Concentration of enzyme sites, in the units of Y ÷ time (set it)',
        defaultConstraint: { constant: 1 },
      },
      kcat: { description: 'Turnover number (inverse time units)' },
      Km: { description: 'Michaelis-Menten constant' },
    },
    initial(x, y, fixed) {
      const et = positive(fixed?.[0], 1)
      return [fixed?.[0] ?? 1, profile(x, y).ymax / et, halfMaxX(x, y)]
    },
    derived: (p) => ({ Vmax: p[0]! * p[1]! }),
  }),
  ...inhibitionModels(),
  // ---- exponential -------------------------------------------------------------------------
  lab({
    id: 'plateau-one-phase-decay',
    name: 'Plateau followed by one phase decay',
    category: 'Exponential',
    text: 'Y = IF(X < X0, Y0, Plateau + (Y0 - Plateau)*exp(-K*(X - X0)))',
    params: ['X0', 'Y0', 'Plateau', 'K'],
    paramInfo: {
      X0: { description: 'Time at which the decay begins' },
      Y0: { description: 'Y value before the decay begins' },
      Plateau: { description: 'Y value at infinite times' },
      K: { description: 'Rate constant (inverse of X units)' },
    },
    initial(x, y) {
      // Grid search: X0 in the gaps between distinct X values (at most ~40, evenly spread)
      // and K on a log grid around the half-life estimate; for each pair Y0 and Plateau enter
      // linearly and are solved by least squares. Large data sets are thinned for the search.
      const full = profile(x, y)
      const thin = Math.max(1, Math.ceil(full.xs.length / 500))
      const xs = full.xs.filter((_, i) => i % thin === 0)
      const ys = full.ys.filter((_, i) => i % thin === 0)
      const n = xs.length
      const k0 = rateFromHalfLife(full)
      let best: number[] = [xs[0]!, ys[0]!, ys[n - 1]!, k0]
      let bestSS = Number.POSITIVE_INFINITY
      const step = Math.max(1, Math.ceil((n - 2) / 40))
      for (let c = 0; c < n - 2; c += step) {
        const x0 = c === 0 ? xs[0]! : (xs[c]! + xs[c + 1]!) / 2
        for (let g = -12; g <= 12; g++) {
          const k = k0 * 10 ** (g / 12)
          // Y = Y0·a + Plateau·b with a = e, b = 1 − e after X0 (a = 1, b = 0 before).
          let saa = 0
          let sab = 0
          let sbb = 0
          let say = 0
          let sby = 0
          for (let i = 0; i < n; i++) {
            const e = xs[i]! < x0 ? 1 : Math.exp(-k * (xs[i]! - x0))
            const bb = 1 - e
            saa += e * e
            sab += e * bb
            sbb += bb * bb
            say += e * ys[i]!
            sby += bb * ys[i]!
          }
          const det = saa * sbb - sab * sab
          if (!(Math.abs(det) > 1e-12 * saa * sbb)) continue
          const y0 = (say * sbb - sby * sab) / det
          const plateau = (sby * saa - say * sab) / det
          let ss = 0
          for (let i = 0; i < n; i++) {
            const xi = xs[i]!
            const f = xi < x0 ? y0 : plateau + (y0 - plateau) * Math.exp(-k * (xi - x0))
            ss += (ys[i]! - f) ** 2
          }
          if (ss < bestSS) {
            bestSS = ss
            best = [x0, y0, plateau, k]
          }
        }
      }
      return best
    },
    derived: (p) => ({ Tau: 1 / p[3]!, HalfLife: LN2 / p[3]!, Span: p[1]! - p[2]! }),
  }),
  lab({
    id: 'two-phase-association',
    name: 'Two phase association',
    category: 'Exponential',
    text: `SpanFast = (Plateau - Y0)*PercentFast*0.01
SpanSlow = (Plateau - Y0)*(100 - PercentFast)*0.01
Y = Y0 + SpanFast*(1 - exp(-KFast*X)) + SpanSlow*(1 - exp(-KSlow*X))`,
    params: ['Y0', 'Plateau', 'PercentFast', 'KFast', 'KSlow'],
    paramInfo: {
      Y0: { description: 'Y value when X is zero' },
      Plateau: { description: 'Y value at infinite times' },
      PercentFast: {
        description: 'Percentage of the span due to the fast phase',
        defaultConstraint: { bounds: [0, 100] },
      },
      KFast: { description: 'Rate constant of the fast phase' },
      KSlow: { description: 'Rate constant of the slow phase' },
    },
    initial(x, y) {
      const pr = profile(x, y)
      const k = rateFromHalfLife(pr)
      return [pr.ys[0]!, pr.ys[pr.ys.length - 1]!, 50, 4 * k, k / 4]
    },
    derived: (p) => ({
      TauFast: 1 / p[3]!,
      TauSlow: 1 / p[4]!,
      HalfTimeFast: LN2 / p[3]!,
      HalfTimeSlow: LN2 / p[4]!,
    }),
  }),
  // ---- growth --------------------------------------------------------------------------------
  lab({
    id: 'exponential-plateau',
    name: 'Exponential plateau',
    category: 'Growth and sigmoidal',
    text: 'Y = YM - (YM - Y0)*exp(-k*X)',
    params: ['Y0', 'YM', 'k'],
    paramInfo: {
      Y0: { description: 'Y value when X is zero' },
      YM: { description: 'Maximum Y value (the plateau)' },
      k: { description: 'Rate constant (inverse of X units)' },
    },
    initial(x, y) {
      const pr = profile(x, y)
      return [pr.ys[0]!, pr.ys[pr.ys.length - 1]!, rateFromHalfLife(pr)]
    },
    derived: (p) => ({ Tau: 1 / p[2]!, HalfTime: LN2 / p[2]! }),
  }),
  lab({
    id: 'beta-growth-decline',
    name: 'Beta growth and decline',
    category: 'Growth and sigmoidal',
    text: 'Y = YM*(1 + (Te - X)/(Te - Tm))*(X/Te)^(Te/(Te - Tm))',
    params: ['YM', 'Te', 'Tm'],
    paramInfo: {
      YM: { description: 'Maximum Y value (the peak)' },
      Te: { description: 'X value at the peak' },
      Tm: { description: 'X value at the inflection point of the rise' },
    },
    initial(x, y) {
      const pr = profile(x, y)
      const k = argmax(pr.ys)
      const te = pr.xs[k]! > 0 ? pr.xs[k]! : xRange(pr) / 2
      // The rise's half-way point approximates the inflection.
      const rise = { ...pr, xs: pr.xs.slice(0, k + 1), ys: pr.ys.slice(0, k + 1) }
      const tm = xAtLevel(rise, pr.ymax / 2)
      return [pr.ymax, te, tm > 0 && tm < te ? tm : te / 2]
    },
  }),
  // ---- lines ---------------------------------------------------------------------------------
  lab({
    id: 'segmental-linear',
    name: 'Segmental linear regression',
    category: 'Lines and polynomials',
    text: `Y1 = Intercept1 + Slope1*X
YatX0 = Slope1*X0 + Intercept1
Y2 = YatX0 + Slope2*(X - X0)
Y = IF(X < X0, Y1, Y2)`,
    params: ['Intercept1', 'Slope1', 'X0', 'Slope2'],
    paramInfo: {
      Intercept1: { description: 'Y intercept of the first segment' },
      Slope1: { description: 'Slope of the first segment' },
      X0: { description: 'X value where the two segments meet' },
      Slope2: { description: 'Slope of the second segment' },
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
      return [left[0]!, left[1]!, (pr.xs[h - 1]! + pr.xs[Math.min(h, n - 1)]!) / 2, right[1]!]
    },
    derived: (p) => ({ Intercept2: p[0]! + (p[1]! - p[3]!) * p[2]! }),
  }),
  lab({
    // Finding the crossing point of two lines: one
    // line per data set, the crossing point shared, each data set its own slope.
    id: 'two-lines-crossing',
    name: 'Two intersecting lines — fit the crossing point',
    category: 'Lines and polynomials',
    text: 'Y = Ycross + (X - Xcross)*Slope',
    params: ['Xcross', 'Ycross', 'Slope'],
    paramInfo: {
      Xcross: {
        description: 'X coordinate of the crossing point (shared by the data sets)',
        defaultConstraint: 'shared',
      },
      Ycross: {
        description: 'Y coordinate of the crossing point (shared by the data sets)',
        defaultConstraint: 'shared',
      },
      Slope: { description: 'Slope of each data set’s line' },
    },
    initial(x, y) {
      // The rules take the middle of the X and Y ranges for the crossing point; the slope is
      // each data set's own least-squares slope (its sign matters for crossing lines).
      const pr = profile(x, y)
      const slope =
        pr.xs.length >= 2 && pr.xmax > pr.xmin
          ? polynomialRegression(pr.xs, pr.ys, 1).coef[1]!
          : (pr.ymax - pr.ymin) / (xRange(pr) || 1)
      return [(pr.xmin + pr.xmax) / 2, (pr.ymin + pr.ymax) / 2, slope]
    },
    derived: (p) => ({ Intercept: p[1]! - p[0]! * p[2]! }),
  }),
  // ---- periodic and peaks ----------------------------------------------------------------------
  lab({
    id: 'sine-wave',
    name: 'Standard sine wave',
    category: 'Sine waves and peaks',
    text: 'Y = Amplitude*sin((2*pi*X/Wavelength) + PhaseShift)',
    params: ['Amplitude', 'Wavelength', 'PhaseShift'],
    paramInfo: SINE_INFO,
    initial: (x, y) => sineStart(x, y, false).slice(0, 3),
    derived: (p) => ({ Frequency: 1 / p[1]! }),
  }),
  lab({
    id: 'sine-wave-baseline',
    name: 'Sine wave with nonzero baseline',
    category: 'Sine waves and peaks',
    text: 'Y = Amplitude*sin((2*pi*X/Wavelength) + PhaseShift) + Baseline',
    params: ['Amplitude', 'Wavelength', 'PhaseShift', 'Baseline'],
    paramInfo: { ...SINE_INFO, Baseline: { description: 'Average Y value' } },
    initial: (x, y) => sineStart(x, y, true),
    derived: (p) => ({ Frequency: 1 / p[1]! }),
  }),
  lab({
    id: 'lorentzian',
    name: 'Lorentzian',
    category: 'Sine waves and peaks',
    text: 'Y = Amplitude/(1 + ((X - Center)/Width)^2)',
    params: ['Amplitude', 'Center', 'Width'],
    paramInfo: {
      Amplitude: { description: 'Height of the peak' },
      Center: { description: 'X value at the peak' },
      Width: { description: 'Half the width of the peak at half its height' },
    },
    initial(x, y) {
      const pr = profile(x, y)
      const k = argmax(pr.ys)
      const amp = pr.ys[k]!
      const left = xAtLevel(
        { ...pr, xs: pr.xs.slice(0, k + 1).reverse(), ys: pr.ys.slice(0, k + 1).reverse() },
        amp / 2,
      )
      const right = xAtLevel({ ...pr, xs: pr.xs.slice(k), ys: pr.ys.slice(k) }, amp / 2)
      const w = (right - left) / 2
      return [amp, pr.xs[k]!, w > 0 ? w : xRange(pr) / 6]
    },
  }),
]

/**
 * Enzyme inhibition (competitive, noncompetitive, uncompetitive and mixed models): one data
 * set per inhibitor concentration, whose value `I` is a data set constant (read from the
 * column title); the kinetic constants are shared by default (a global fit).
 */
function inhibitionModels(): EquationDef[] {
  const I: ParamInfo = {
    description: 'Inhibitor concentration of each data set (from its title)',
    defaultConstraint: 'dataSetConstant',
  }
  const shared = (description: string): ParamInfo => ({ description, defaultConstraint: 'shared' })
  const VMAX = shared('Maximum enzyme velocity without inhibitor')
  const KM = shared('Michaelis-Menten constant without inhibitor')
  /** Vmax, Km from the data; Ki (or AlphaKi) of the order of the inhibitor concentration. */
  const start = (x: ArrayLike<number>, y: ArrayLike<number>, inh: number | undefined) => ({
    vmax: maxOf(Array.from(y)),
    km: halfMaxX(x, y),
    ki: inh !== undefined && inh > 0 ? inh : Number.NaN,
  })
  return [
    lab({
      id: 'competitive-inhibition',
      name: 'Competitive inhibition',
      category: 'Enzyme kinetics — Inhibition',
      text: `KmObs = Km*(1 + I/Ki)
Y = Vmax*X/(KmObs + X)`,
      params: ['Vmax', 'Km', 'Ki', 'I'],
      paramInfo: { Vmax: VMAX, Km: KM, Ki: shared('Inhibition constant'), I },
      initial(x, y, fixed) {
        const s = start(x, y, fixed?.[3])
        return [s.vmax, s.km, s.ki, fixed?.[3] ?? 0]
      },
    }),
    lab({
      id: 'noncompetitive-inhibition',
      name: 'Noncompetitive inhibition',
      category: 'Enzyme kinetics — Inhibition',
      text: `VmaxInh = Vmax/(1 + I/Ki)
Y = VmaxInh*X/(Km + X)`,
      params: ['Vmax', 'Km', 'Ki', 'I'],
      paramInfo: { Vmax: VMAX, Km: KM, Ki: shared('Inhibition constant'), I },
      initial(x, y, fixed) {
        const s = start(x, y, fixed?.[3])
        return [s.vmax, s.km, s.ki, fixed?.[3] ?? 0]
      },
    }),
    lab({
      id: 'uncompetitive-inhibition',
      name: 'Uncompetitive inhibition',
      category: 'Enzyme kinetics — Inhibition',
      text: `VmaxApp = Vmax/(1 + I/AlphaKi)
KmApp = Km/(1 + I/AlphaKi)
Y = VmaxApp*X/(KmApp + X)`,
      params: ['Vmax', 'Km', 'AlphaKi', 'I'],
      paramInfo: { Vmax: VMAX, Km: KM, AlphaKi: shared('Alpha × Ki (inhibition constant)'), I },
      initial(x, y, fixed) {
        const s = start(x, y, fixed?.[3])
        return [s.vmax, s.km, s.ki, fixed?.[3] ?? 0]
      },
    }),
    lab({
      id: 'mixed-inhibition',
      name: 'Mixed model inhibition',
      category: 'Enzyme kinetics — Inhibition',
      text: `VmaxApp = Vmax/(1 + I/(Alpha*Ki))
KmApp = Km*(1 + I/Ki)/(1 + I/(Alpha*Ki))
Y = VmaxApp*X/(KmApp + X)`,
      params: ['Vmax', 'Km', 'Ki', 'Alpha', 'I'],
      paramInfo: {
        Vmax: VMAX,
        Km: KM,
        Ki: shared('Inhibition constant'),
        Alpha: shared('Relative affinity of the inhibitor for enzyme–substrate vs. free enzyme'),
        I,
      },
      initial(x, y, fixed) {
        const s = start(x, y, fixed?.[4])
        return [s.vmax, s.km, s.ki, 1, fixed?.[4] ?? 0]
      },
    }),
  ]
}
