/**
 * Simulation designs for the built-in equations: X values, the true parameters of each data set
 * (constants at the equation's default values, data set constants included), noise SD and
 * replicates. Used by equations.test.ts (gradients) and equationRecovery.test.ts.
 */

import { EQUATIONS } from '../src/index.ts'

export interface Design {
  x: number[]
  /** True parameters of data set k (the equation's parameter order). */
  truth: (k: number) => number[]
  sets?: number
  sd: number
  reps?: number
  /** Looser agreement between fits from automatic and from true initial values. */
  rtol?: number
}

/** Grid values rounded to 10 decimals (DESIGNS' dyadic steps are exact either way). */
const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = []
  for (let v = from; v <= to + 1e-9; v += step) out.push(+v.toFixed(10))
  return out
}
const geometric = (from: number, ratio: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => from * ratio ** i)

const one = (p: number[]) => () => p

const LOG_DOSE = range(-9, -4, 0.5)

/** The equations of equations.ts and labEquations.ts. */
export const DESIGNS: Record<string, Design> = {
  'agonist-response': { x: LOG_DOSE, truth: one([5, 95, -6.5]), sd: 3, reps: 3 },
  'agonist-response-variable-slope': {
    x: LOG_DOSE,
    truth: one([5, 95, -6.5, 1.4]),
    sd: 3,
    reps: 3,
  },
  'agonist-normalized-response': { x: LOG_DOSE, truth: one([-6.5]), sd: 3, reps: 2 },
  'agonist-normalized-response-variable-slope': {
    x: LOG_DOSE,
    truth: one([-6.5, 0.8]),
    sd: 3,
    reps: 2,
  },
  'inhibitor-response': { x: LOG_DOSE, truth: one([10, 100, -7]), sd: 3, reps: 3 },
  'inhibitor-response-variable-slope': {
    x: LOG_DOSE,
    truth: one([10, 100, -7, -1.2]),
    sd: 3,
    reps: 3,
  },
  'inhibitor-normalized-response': { x: LOG_DOSE, truth: one([-7]), sd: 3, reps: 2 },
  'inhibitor-normalized-response-variable-slope': {
    x: LOG_DOSE,
    truth: one([-7, -0.9]),
    sd: 3,
    reps: 2,
  },
  'asymmetric-5pl': { x: range(-10, -2, 0.5), truth: one([5, 100, -6, 1.2, 1.8]), sd: 1, reps: 3 },
  'one-site-specific': { x: geometric(0.5, 2, 8), truth: one([1200, 5]), sd: 30, reps: 2 },
  'one-site-total': { x: geometric(0.5, 2, 9), truth: one([1200, 5, 10, 0]), sd: 20, reps: 3 },
  'one-site-fit-logic50': { x: LOG_DOSE, truth: one([100, 2000, -7.5]), sd: 40, reps: 3 },
  'michaelis-menten': { x: geometric(0.5, 2, 8), truth: one([50, 4]), sd: 1, reps: 2 },
  'substrate-inhibition': {
    x: geometric(0.5, 1.6, 14),
    truth: one([100, 5, 60]),
    sd: 1.5,
    reps: 2,
  },
  'one-phase-decay': { x: range(0, 30, 2), truth: one([100, 10, 0.2]), sd: 2, reps: 2 },
  'one-phase-association': { x: range(0, 20, 1), truth: one([5, 80, 0.3]), sd: 2, reps: 2 },
  'two-phase-decay': { x: range(0, 40, 1), truth: one([100, 5, 1, 0.08, 60]), sd: 0.8, reps: 2 },
  'exponential-growth': { x: range(0, 10, 0.5), truth: one([10, 0.3]), sd: 0.5, reps: 2 },
  'straight-line': { x: range(0, 10, 1), truth: one([3, 2]), sd: 0.5 },
  'polynomial-2': { x: range(-5, 5, 0.5), truth: one([1, -2, 0.5]), sd: 0.3 },
  'polynomial-3': { x: range(-5, 5, 0.5), truth: one([1, -2, 0.5, 0.1]), sd: 0.3 },
  'boltzmann-sigmoidal': {
    x: range(-80, 40, 10),
    truth: one([0.02, 1, -20, 8]),
    sd: 0.02,
    reps: 2,
  },
  gompertz: { x: range(0, 20, 1), truth: one([100, 2, 0.3]), sd: 1, reps: 2 },
  'logistic-growth': { x: range(0, 20, 1), truth: one([100, 2, 0.5]), sd: 1, reps: 2 },
  gaussian: { x: range(-5, 15, 0.5), truth: one([50, 5, 2]), sd: 1 },
  // Phase 14
  'agonist-response-find-ecanything': {
    x: LOG_DOSE,
    truth: one([5, 95, -6.2, 1.2, 50]),
    sd: 3,
    reps: 3,
  },
  'biphasic-dose-response': {
    x: range(-11, -3, 0.25),
    truth: one([0, 100, 0.4, -9, 1.2, -5.5, 1]),
    sd: 1.5,
    reps: 2,
  },
  // The middle plateau (Dip) sits in a long shallow valley: two converged fits agree in SS to
  // 1e-9 but in Dip only to ~1e-5.
  'bell-shaped-dose-response': {
    x: range(-11, -1, 0.25),
    truth: one([-85, 10, 5, -8, -4, 1.3, 1.1]),
    sd: 1,
    reps: 2,
    rtol: 1e-4,
  },
  'one-site-specific-hill': {
    x: geometric(0.25, 1.6, 14),
    truth: one([1000, 5, 1.6]),
    sd: 15,
    reps: 2,
  },
  'two-sites-specific': {
    x: geometric(0.02, 2, 16),
    truth: one([400, 0.3, 800, 30]),
    sd: 8,
    reps: 3,
  },
  'one-site-fit-logki': { x: LOG_DOSE, truth: one([2000, 100, -8, 1, 1]), sd: 40, reps: 3 },
  'two-sites-fit-logic50': {
    x: range(-11, -3, 0.25),
    truth: one([2000, 100, 0.4, -9, -6]),
    sd: 25,
    reps: 2,
  },
  'dissociation-one-phase': { x: range(0, 60, 3), truth: one([1000, 100, 0.08]), sd: 20, reps: 2 },
  'association-one-conc': { x: range(0, 60, 3), truth: one([1e8, 1, 0.1, 2000]), sd: 20, reps: 2 },
  'allosteric-sigmoidal': { x: geometric(0.5, 1.5, 14), truth: one([100, 2.2, 8]), sd: 2, reps: 2 },
  kcat: { x: geometric(0.5, 2, 8), truth: one([1, 50, 4]), sd: 1, reps: 2 },
  'competitive-inhibition': {
    x: geometric(0.5, 2, 8),
    truth: (k) => [100, 4, 2, [0, 2, 5, 10][k]!],
    sets: 4,
    sd: 2,
  },
  'noncompetitive-inhibition': {
    x: geometric(0.5, 2, 8),
    truth: (k) => [100, 4, 3, [0, 2, 5, 10][k]!],
    sets: 4,
    sd: 2,
  },
  'uncompetitive-inhibition': {
    x: geometric(0.5, 2, 8),
    truth: (k) => [100, 4, 3, [0, 2, 5, 10][k]!],
    sets: 4,
    sd: 1.5,
  },
  'mixed-inhibition': {
    x: geometric(0.5, 2, 9),
    truth: (k) => [100, 4, 2, 3, [0, 2, 5, 10][k]!],
    sets: 4,
    sd: 1,
  },
  'plateau-one-phase-decay': { x: range(0, 40, 1), truth: one([8.5, 100, 10, 0.2]), sd: 2 },
  'two-phase-association': {
    x: range(0, 40, 1),
    truth: one([5, 100, 60, 1, 0.08]),
    sd: 0.8,
    reps: 2,
  },
  'exponential-plateau': { x: range(0, 20, 1), truth: one([5, 80, 0.25]), sd: 1.5, reps: 2 },
  'beta-growth-decline': { x: range(1, 40, 1.5), truth: one([50, 20, 10]), sd: 1, reps: 2 },
  'segmental-linear': { x: range(0, 20, 1), truth: one([2, 3, 8.5, 0.5]), sd: 0.6, reps: 2 },
  // Two data sets (the last parameter, Slope, per set) sharing the crossing point (7, 20).
  'two-lines-crossing': {
    x: range(0, 16, 1),
    truth: (k) => [7, 20, [2.5, -1.2][k]!],
    sets: 2,
    sd: 0.6,
  },
  'sine-wave': { x: range(0, 30, 0.5), truth: one([10, 8, 0.7]), sd: 1 },
  'sine-wave-baseline': { x: range(0, 30, 0.5), truth: one([10, 8, 0.7, 50]), sd: 1 },
  lorentzian: { x: range(-10, 20, 0.5), truth: one([50, 5, 2]), sd: 1 },
}

// ---- Roadmap 20 (equationsMore.ts) ----------------------------------------------------------

const CONC = geometric(1e-10, Math.sqrt(10), 15)
const WIDE = geometric(1e-11, 10 ** 0.25, 41)

export const DESIGNS20: Record<string, Design> = {
  'agonist-conc-response': { x: CONC, truth: one([5, 95, 3e-7]), sd: 3, reps: 3 },
  'agonist-conc-response-variable-slope': {
    x: CONC,
    truth: one([5, 95, 3e-7, 1.4]),
    sd: 3,
    reps: 3,
  },
  'agonist-conc-normalized-response': { x: CONC, truth: one([3e-7]), sd: 3, reps: 2 },
  'agonist-conc-normalized-response-variable-slope': {
    x: CONC,
    truth: one([3e-7, 0.8]),
    sd: 3,
    reps: 2,
  },
  'inhibitor-conc-response': { x: CONC, truth: one([10, 100, 1e-7]), sd: 3, reps: 3 },
  'inhibitor-conc-response-variable-slope': {
    x: CONC,
    truth: one([10, 100, 1e-7, -1.2]),
    sd: 3,
    reps: 3,
  },
  'inhibitor-conc-normalized-response': { x: CONC, truth: one([1e-7]), sd: 3, reps: 2 },
  'inhibitor-conc-normalized-response-variable-slope': {
    x: CONC,
    truth: one([1e-7, -0.9]),
    sd: 3,
    reps: 2,
  },
  'asymmetric-5pl-conc': {
    x: geometric(1e-10, Math.sqrt(10), 17),
    truth: one([5, 100, 1e-6, 1.2, 1.8]),
    sd: 1,
    reps: 3,
  },
  'biphasic-dose-response-conc': {
    x: geometric(1e-11, 10 ** 0.25, 33),
    truth: one([0, 100, 0.4, 1e-9, 1.2, 3e-6, 1]),
    sd: 1.5,
    reps: 2,
  },
  'bell-shaped-dose-response-conc': {
    x: WIDE,
    truth: one([-85, 10, 5, 1e-8, 1e-4, 1.3, 1.1]),
    sd: 1,
    reps: 2,
    rtol: 1e-4,
  },
  'operational-depletion-conc': {
    x: geometric(1e-10, Math.sqrt(10), 15),
    truth: (k) => [100, 0, 1e-6, [10, 3, 1, 0.3][k]!, 1],
    sets: 4,
    sd: 2,
  },
  'operational-depletion': {
    x: range(-10, -3, 0.5),
    truth: (k) => [100, 0, -6, Math.log10([10, 3, 1, 0.3][k]!), 1],
    sets: 4,
    sd: 2,
  },
  'operational-partial-agonist-conc': {
    x: geometric(1e-10, Math.sqrt(10), 15),
    truth: (k) => [100, 0, 1, 1e-7, [1e-6, 1e-6, 3e-6][k]!, [1, 0.5, 2][k]!],
    sets: 3,
    sd: 2,
  },
  'operational-partial-agonist': {
    x: range(-10, -3, 0.5),
    truth: (k) => [100, 0, 1, -7, [-6, -6, -5.5][k]!, Math.log10([1, 0.5, 2][k]!)],
    sets: 3,
    sd: 2,
  },
  'gaddum-schild-conc': {
    x: geometric(1e-11, Math.sqrt(10), 17),
    truth: (k) => [0, 100, 1e-8, 1, 8, 1, [0, 1e-8, 1e-7, 1e-6][k]!],
    sets: 4,
    sd: 3,
  },
  'gaddum-schild-slope1-conc': {
    x: geometric(1e-11, Math.sqrt(10), 17),
    truth: (k) => [0, 100, 1e-8, 1, 8, [0, 1e-8, 1e-7, 1e-6][k]!],
    sets: 4,
    sd: 3,
  },
  'gaddum-schild': {
    x: range(-11, -3, 0.5),
    truth: (k) => [0, 100, -8, 1, 8, 1, [0, 1e-8, 1e-7, 1e-6][k]!],
    sets: 4,
    sd: 3,
  },
  'gaddum-schild-slope1': {
    x: range(-11, -3, 0.5),
    truth: (k) => [0, 100, -8, 1, 8, [0, 1e-8, 1e-7, 1e-6][k]!],
    sets: 4,
    sd: 3,
  },
  'ec50-shift-conc': {
    x: geometric(1e-11, Math.sqrt(10), 15),
    truth: (k) => [0, 100, 1e-8, [1, 5, 30][k]!, 1],
    sets: 3,
    sd: 3,
  },
  'ec50-shift': {
    x: range(-11, -4, 0.5),
    truth: (k) => [0, 100, -8, [1, 5, 30][k]!, 1],
    sets: 3,
    sd: 3,
  },
  'allosteric-ec50-shift-conc': {
    x: geometric(1e-11, Math.sqrt(10), 15),
    truth: (k) => [0, 100, 1e-8, 1, 1e-6, 0.1, [0, 1e-7, 1e-6, 1e-5][k]!],
    sets: 4,
    sd: 2,
  },
  'allosteric-ec50-shift': {
    x: range(-11, -4, 0.5),
    truth: (k) => [0, 100, -8, 1, -6, -1, [0, 1e-7, 1e-6, 1e-5][k]!],
    sets: 4,
    sd: 2,
  },
  'agonist-conc-response-find-ecanything': {
    x: CONC,
    truth: one([5, 95, 4e-7, 1.2, 50]),
    sd: 3,
    reps: 3,
  },
  'absolute-ic50-conc': { x: CONC, truth: one([100, 10, -1, 1e-7, 0]), sd: 2, reps: 2 },
  'absolute-ic50': { x: range(-10, -3, 0.5), truth: one([100, 10, -1, -7, 0]), sd: 2, reps: 2 },
  'one-site-total-and-nonspecific': {
    x: geometric(0.5, 2, 8),
    truth: () => [1500, 4, 20, 30],
    sets: 2,
    sd: 30,
    reps: 2,
  },
  'one-site-total-depletion': {
    x: geometric(1000, 1.6, 12),
    truth: one([20000, 1, 0.02, 0.1, 100]),
    sd: 200,
    reps: 2,
  },
  'two-sites-total-and-nonspecific': {
    x: geometric(0.02, 2, 16),
    truth: () => [400, 0.3, 800, 30, 5, 30],
    sets: 2,
    sd: 8,
    reps: 3,
  },
  'one-site-allosteric-modulator': {
    x: geometric(0.1, 2, 10),
    truth: (k) => [1000, 2, -6, -1, [0, 1e-7, 1e-6, 1e-5][k]!],
    sets: 4,
    sd: 15,
  },
  'two-sites-fit-ki': {
    x: range(-11, -3, 0.25),
    truth: one([2000, 100, 0.4, -9, -6, 1, 1, 1]),
    sd: 25,
    reps: 2,
  },
  'one-site-competitive-depletion': {
    x: range(-11, -4, 0.5),
    truth: one([-8, 20000, 0.01, 50000, 1, 100, 0.1]),
    sd: 100,
    reps: 2,
  },
  'homologous-one-site': {
    x: range(-12, -5, 0.5),
    truth: (k) => [-9, 1000, 50, [1, 5][k]!],
    sets: 2,
    sd: 10,
    reps: 2,
  },
  'allosteric-modulator-competitive': {
    x: range(-10, -3, 0.5),
    truth: one([-6, -1, 1000, 1, 1]),
    sd: 10,
    reps: 2,
  },
  'association-two-conc': {
    x: range(0, 60, 3),
    truth: (k) => [1e8, 0.05, 2000, [1, 3, 10][k]!],
    sets: 3,
    sd: 20,
  },
  'association-then-dissociation': {
    x: range(0, 60, 2),
    truth: one([0.05, 1e8, 2000, 0, 1, 10]),
    sd: 20,
    reps: 2,
  },
  'kinetics-competitive-binding': {
    x: range(0, 120, 4),
    truth: (k) => [2e7, 0.02, 2000, 1e8, 0.1, 1, [10, 30, 100][k]!],
    sets: 3,
    sd: 10,
  },
  'morrison-ki': { x: geometric(0.1, 2, 12), truth: one([100, 0.5, 1, 1, 1]), sd: 1.5, reps: 2 },
  'three-phase-decay': {
    x: [0, ...geometric(0.05, 1.25, 36)],
    truth: one([100, 5, 40, 2, 30, 0.02, 0.2]),
    sd: 0.3,
    reps: 2,
    rtol: 1e-5,
  },
  'plateau-one-phase-association': { x: range(0, 40, 1), truth: one([8.5, 10, 100, 0.2]), sd: 2 },
  'horizontal-line': { x: range(0, 10, 1), truth: one([5]), sd: 1 },
  'line-through-origin': { x: range(1, 10, 1), truth: one([2]), sd: 0.5 },
  // Delta (the bend's sharpness) is poorly determined: two converged fits agree to ~1e-4.
  hinge: { x: range(0, 20, 0.5), truth: one([10, 1, 3, 10, 0.8]), sd: 0.3, rtol: 1e-3 },
  'semilog-x-log': { x: geometric(0.1, 2, 12), truth: one([2, 3]), sd: 0.3 },
  'semilog-y-log': { x: range(0, 20, 1), truth: one([0.1, 1]), sd: 5 },
  'log-log-line': { x: geometric(1, 1.5, 12), truth: one([1.5, 0.5]), sd: 1 },
  'polynomial-1': { x: range(-5, 5, 0.5), truth: one([1, -2]), sd: 0.3 },
  'polynomial-4': { x: range(-5, 5, 0.25), truth: one([1, -2, 0.5, 0.1, -0.05]), sd: 0.3 },
  'polynomial-5': { x: range(-5, 5, 0.25), truth: one([1, -2, 0.5, 0.1, -0.05, 0.01]), sd: 0.3 },
  'polynomial-6': {
    x: range(-5, 5, 0.25),
    truth: one([1, -2, 0.5, 0.1, -0.05, 0.01, 0.002]),
    sd: 0.3,
  },
  'centered-polynomial-1': { x: range(10, 20, 0.25), truth: one([3, 2, 15]), sd: 0.3 },
  'centered-polynomial-2': { x: range(10, 20, 0.25), truth: one([3, 2, -0.5, 15]), sd: 0.3 },
  'centered-polynomial-3': { x: range(10, 20, 0.25), truth: one([3, 2, -0.5, 0.1, 15]), sd: 0.3 },
  'centered-polynomial-4': {
    x: range(10, 20, 0.25),
    truth: one([3, 2, -0.5, 0.1, 0.02, 15]),
    sd: 0.3,
  },
  'centered-polynomial-5': {
    x: range(10, 20, 0.25),
    truth: one([3, 2, -0.5, 0.1, 0.02, -0.005, 15]),
    sd: 0.3,
  },
  'centered-polynomial-6': {
    x: range(10, 20, 0.25),
    truth: one([3, 2, -0.5, 0.1, 0.02, -0.005, 0.001, 15]),
    sd: 0.3,
  },
  'gaussian-sum-two': { x: range(-2, 20, 0.25), truth: one([50, 5, 1.5, 30, 12, 2]), sd: 1 },
  lognormal: { x: geometric(0.5, 1.15, 30), truth: one([200, 5, 1.8]), sd: 0.5 },
  'cumulative-gaussian-percent': { x: range(0, 20, 1), truth: one([10, 3]), sd: 2 },
  'cumulative-gaussian-fraction': { x: range(0, 20, 1), truth: one([10, 3]), sd: 0.02 },
  'cumulative-gaussian-counts': { x: range(0, 20, 1), truth: one([10, 3, 100]), sd: 2 },
  'lorentzian-sum-two': { x: range(-2, 20, 0.25), truth: one([50, 5, 1, 30, 12, 1.5]), sd: 1 },
  'damped-sine-wave': { x: range(0, 60, 0.5), truth: one([10, 8, 0.7, 0.05]), sd: 0.5 },
  'sinc-wave': { x: range(-12, 12, 0.25), truth: one([10, 4]), sd: 0.3 },
  'log-exponential-growth': { x: range(0, 10, 0.5), truth: one([2, 0.3]), sd: 0.1 },
  'linear-quadratic-fs': { x: range(0, 10, 1), truth: one([0.2, 0.03]), sd: 0.005, reps: 2 },
  'linear-quadratic-ps': { x: range(0, 10, 1), truth: one([0.2, 0.03]), sd: 0.5, reps: 2 },
  'linear-quadratic-fd': { x: range(0, 10, 1), truth: one([0.2, 0.03]), sd: 0.005, reps: 2 },
  'linear-quadratic-pd': { x: range(0, 10, 1), truth: one([0.2, 0.03]), sd: 0.5, reps: 2 },
  'linear-quadratic-ns': { x: range(0, 10, 1), truth: one([1000, 0.2, 0.03]), sd: 5, reps: 2 },
  'linear-quadratic-nd': { x: range(0, 10, 1), truth: one([1000, 0.2, 0.03]), sd: 5, reps: 2 },
  'classic-one-phase-decay': { x: range(0, 30, 2), truth: one([90, 0.2, 10]), sd: 2, reps: 2 },
  'classic-two-phase-decay': {
    x: range(0, 40, 1),
    truth: one([60, 1, 40, 0.08, 5]),
    sd: 0.8,
    reps: 2,
  },
  'classic-one-phase-association': { x: range(0, 20, 1), truth: one([80, 0.3]), sd: 2, reps: 2 },
  'classic-two-phase-association': {
    x: range(0, 40, 1),
    truth: one([40, 1, 60, 0.08]),
    sd: 0.8,
    reps: 2,
  },
  'classic-power-series': { x: geometric(0.5, 1.2, 20), truth: one([2, 1.5, 0.5, -1]), sd: 0.2 },
  'classic-sine-wave': { x: range(0, 30, 0.25), truth: one([50, 10, 0.8, 0.7]), sd: 1 },
}

// ---- groups -----------------------------------------------------------------------------------

/**
 * Each group of designs keeps the seeds and the checks it was written with. Gradients: at the X
 * points `inset` from the ends and the middle, step 1e-6·max(|p|, hFloor), error relative to
 * max(|numeric|, |f|/max(|p|, scaleFloor)).
 */
export interface Group {
  designs: Record<string, Design>
  seeds: number
  seed0: number
  /** R² of the first data set's fit at least this (DESIGNS20 has a horizontal line: R² = 0). */
  minR2?: number
  grad: { inset: number; hFloor: number; scaleFloor: number; rtol: number }
}
export const GROUPS: Group[] = [
  {
    designs: DESIGNS,
    seeds: 8,
    seed0: 20261003,
    minR2: 0.9,
    grad: { inset: 0, hFloor: 1e-2, scaleFloor: 1, rtol: 1e-6 },
  },
  {
    designs: DESIGNS20,
    seeds: 6,
    seed0: 20260929,
    grad: { inset: 1, hFloor: 1e-12, scaleFloor: 1e-12, rtol: 1e-5 },
  },
]
/** Every equation with its design and group. */
export const CASES = GROUPS.flatMap((g) =>
  EQUATIONS.filter((e) => g.designs[e.id]).map((e) => ({ e, d: g.designs[e.id]!, g })),
)
