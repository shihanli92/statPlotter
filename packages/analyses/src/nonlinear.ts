import type {
  AnalysisDef,
  AnalysisResult,
  Diagnostic,
  GraphableDataSet,
  NormalizedDataSet,
  Progress,
  ResultBlock,
  ResultSheet,
  ResultValue,
  RunContext,
} from '@ps/model'
import { pinDefaults } from '@ps/model'
import {
  type CurveModel,
  compareFits,
  curveBand,
  EQUATIONS,
  type EquationDef,
  equation,
  type FitOptions,
  fitResiduals,
  fittedCurve,
  hougaardSkewness,
  type InitialRule,
  initialFromRule,
  meanOf,
  modelFor,
  type NonlinearFit,
  nonlinearFit,
  type ParamConstraint,
  type ParamInfo,
  parseEquation,
  robustFit,
  routCurve,
  userCurveModel,
  valueRange,
  weightingTest,
} from '@ps/stats'
import { z } from 'zod'
import {
  ALPHA,
  CONFIDENCE_FIELD,
  confidenceLevel,
  curveXs,
  exclusionNotes,
  failure,
  int,
  interval,
  kv,
  labelTable,
  missingXNote,
  num,
  pct,
  pSig,
  psum,
  pval,
  result,
  resultsSheet,
  statusOf,
  table,
  text,
} from './common.ts'
import {
  covarianceBlocks,
  DIAGNOSTIC_FIELDS,
  Diagnostics,
  diagnosticBlocks,
  INTERPOLATE_FIELD,
  interpolation,
  meanPointRows,
  type ResidualSet,
  residualOutputs,
  residualsSheet,
  type XYPoint,
  xyPointRows,
} from './curveTools.ts'
import { rowName } from './grouped.ts'

const Constraint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fit') }),
  z.object({ kind: z.literal('constant'), value: z.number() }),
  z.object({ kind: z.literal('shared') }),
  /** A "data set constant": the value is each data set's title (a number). */
  z.object({ kind: z.literal('dataSetConstant') }),
  /** "Data set constant (= Mean X)": the mean X of each data set (centered polynomials). */
  z.object({ kind: z.literal('meanX') }),
])
export type Constraint = z.infer<typeof Constraint>

/** `params.equation` for a user-defined equation (its text is `params.userEquation`). */
export const USER_EQUATION = 'user'

/** 4-parameter log(agonist) vs. response, the most common dose-response fit. */
export function defaultEquationId(): string {
  const eq =
    EQUATIONS.find(
      (e) =>
        e.category === 'Dose-response — Stimulation' &&
        /variable slope/i.test(e.name) &&
        !/normalized/i.test(e.name),
    ) ?? EQUATIONS[0]!
  return eq.id
}

const Limit = z.object({ min: z.number().optional(), max: z.number().optional() })

export const NonlinearParamsSchema = z.object({
  equation: z.string().default(() => defaultEquationId()),
  /** The text of a user-defined equation (used when `equation` is 'user'); see parseEquation. */
  userEquation: z.string().default(''),
  /** Per parameter name; parameters not listed use the equation's default constraint. */
  constraints: z.record(z.string(), Constraint).default({}),
  /**
   * Initial values per parameter name. Built-in equations use their automatic rules for the
   * others; a user-defined equation starts them at 1.
   */
  initialValues: z.record(z.string(), z.number()).default({}),
  /**
   * Rules for initial values (user equations): per parameter a number and a multiplier
   * ('value' = the number itself, else number × YMIN, YMAX, YMID, XATYMID…, from each data set).
   * Initial values typed in `initialValues` take precedence.
   */
  initialRules: z
    .record(z.string(), z.object({ value: z.number(), rule: z.string().default('value') }))
    .default({}),
  /** "Must be greater than / less than" limits per parameter (with the equation's own). */
  limits: z.record(z.string(), Limit).default({}),
  /** Least squares, or robust regression (Lorentzian; best-fit values only). */
  fitMethod: z.enum(['leastSquares', 'robust']).default('leastSquares'),
  /** ROUT: count the outliers, or remove them and fit the rest. */
  outliers: z.enum(['none', 'identify', 'eliminate']).default('none'),
  /** ROUT's Q, in percent. */
  routQ: z.number().gt(0).lt(100).default(1),
  /**
   * Weighting choices: none, 1/Y² (relative), 1/Y (Poisson), 1/Y^K (power, K =
   * weightPower), 1/X, 1/X², 1/SD² (the SD of each row's replicates, or the entered SD).
   */
  weighting: z.enum(['none', 'relative', 'poisson', 'power', 'x', 'x2', 'sd']).default('none'),
  /** K of 1/Y^K weighting. */
  weightPower: z.number().default(2),
  /** Fit every replicate Y as its own point (default), or only the mean Y of each row. */
  replicates: z.enum(['each', 'mean']).default('each'),
  /**
   * "Do the best-fit values of these parameters differ between data sets?": each is shared by
   * every data set in the null model (extra sum-of-squares F test and AICc).
   */
  compareParams: z.array(z.string()).default([]),
  /** The test for appropriate weighting (homoscedasticity when unweighted). */
  weightingTest: z.boolean().default(false),
  /**
   * A different equation for some data sets (data set key → built-in id, or 'user' with its
   * text). Data sets not listed use `equation`. Constraints, initial values, limits and model
   * comparisons apply to the data sets fit with `equation`; the others use their equation's
   * defaults.
   */
  equationByDataSet: z
    .record(z.string(), z.object({ equation: z.string(), userEquation: z.string().default('') }))
    .default({}),
  ciMethod: z.enum(['symmetric', 'profile']).default('symmetric'),
  band: z.enum(['none', 'confidence', 'prediction']).default('none'),
  compareWith: z.string().default('none'),
  /**
   * Roadmap 51c (S18): how models (or a parameter shared against one per data set) are
   * compared, chosen before the results, one verdict reported: the extra sum-of-squares F test
   * (nested models; the default) or AICc. `both`: analyses saved before 0.3.9, which showed both
   * verdicts (kept, not offered).
   */
  compareBy: z.enum(['fTest', 'aicc', 'both']).default('fTest'),
  interpolate: z.boolean().default(false),
  diagnostics: Diagnostics,
  /** Hougaard's skewness of each parameter. */
  hougaard: z.boolean().default(false),
  /** Correlation matrix and dependency of the parameters. */
  covariance: z.boolean().default(false),
  confidenceLevel,
})
type NonlinearParams = z.infer<typeof NonlinearParamsSchema>

/** A model the analysis can fit: a built-in equation or a parsed user-defined one. */
export type FitModel = CurveModel &
  Pick<EquationDef, 'name' | 'formula' | 'paramInfo'> & {
    derived?: EquationDef['derived']
  }

type ResolvedEquation =
  | { ok: true; model: FitModel; user: boolean }
  | { ok: false; message: string; position?: number }

/**
 * The model of `params`: the built-in equation, or the user-defined equation parsed from
 * `params.userEquation` (an error carries the parser's message and position). Initial values
 * from `params.initialValues` override the automatic ones.
 */
export function resolveEquation(
  params: Pick<NonlinearParams, 'equation' | 'userEquation' | 'initialValues'> &
    Partial<Pick<NonlinearParams, 'initialRules'>>,
): ResolvedEquation {
  const init = params.initialValues ?? {}
  const rules = params.initialRules ?? {}
  /** A typed initial value, else the parameter's rule applied to the data set, else undefined. */
  const given = (n: string, x: ArrayLike<number>, y: ArrayLike<number>): number | undefined => {
    if (init[n] !== undefined) return init[n]
    const r = rules[n]
    return r ? initialFromRule(r as InitialRule, x, y) : undefined
  }
  if (params.equation === USER_EQUATION) {
    const r = parseEquation(params.userEquation ?? '')
    if (!r.ok)
      return {
        ok: false,
        message: `The equation has an error (line ${r.line}, column ${r.column}): ${r.message}`,
        position: r.position,
      }
    const names = r.parameters
    const kind = r.program.kind
    const model = userCurveModel(r.program, (x, y) =>
      names.map((n) => given(n, x, y) ?? userDefault(n, kind, x, y)),
    )
    return {
      ok: true,
      user: true,
      model: {
        ...model,
        name:
          kind === 'differential'
            ? 'User-defined differential equation'
            : kind === 'implicit'
              ? 'User-defined implicit equation'
              : 'User-defined equation',
        formula: (params.userEquation ?? '').trim(),
        paramInfo: Object.fromEntries(names.map((n) => [n, { description: '' }])),
      },
    }
  }
  const eq = equation(params.equation)
  if (!eq) return { ok: false, message: `Unknown model “${params.equation}”.` }
  if (!Object.keys({ ...init, ...rules }).some((n) => eq.params.includes(n)))
    return { ok: true, user: false, model: eq }
  const initial: CurveModel['initial'] = (x, y, fixed) => {
    const auto = eq.initial(x, y, fixed)
    return eq.params.map((n, j) => given(n, x, y) ?? auto[j]!)
  }
  return { ok: true, user: false, model: { ...eq, initial } }
}

/**
 * Starting value of a user-equation parameter without a typed value or rule: 1, except Y0 of a
 * differential equation, which starts at the mean Y of the smallest X.
 */
function userDefault(
  name: string,
  kind: string,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): number {
  if (kind === 'differential' && name.toLowerCase() === 'y0') {
    const v = initialFromRule({ rule: 'yatxmin', value: 1 }, x, y)
    return Number.isFinite(v) ? v : 1
  }
  return 1
}

/** The constraint actually applied to a parameter (user choice, else the equation default). */
export function effectiveConstraint(
  eq: Pick<EquationDef, 'paramInfo'>,
  name: string,
  params: Pick<NonlinearParams, 'constraints'>,
): Constraint {
  const user = params.constraints[name]
  if (user) return user
  const d = eq.paramInfo[name]?.defaultConstraint
  if (d === 'shared') return { kind: 'shared' }
  if (d === 'dataSetConstant') return { kind: 'dataSetConstant' }
  if (d === 'meanX') return { kind: 'meanX' }
  return d && typeof d === 'object' && 'constant' in d
    ? { kind: 'constant', value: d.constant }
    : { kind: 'fit' }
}

/** The equation's bounds intersected with the user's limits. */
function boundsFor(
  eq: Pick<FitModel, 'params' | 'paramInfo'>,
  limits: NonlinearParams['limits'],
): ([number, number] | null)[] {
  return eq.params.map((name) => {
    const d: ParamInfo['defaultConstraint'] = eq.paramInfo[name]?.defaultConstraint
    let lo = Number.NEGATIVE_INFINITY
    let hi = Number.POSITIVE_INFINITY
    if (d && typeof d === 'object' && 'bounds' in d) [lo, hi] = d.bounds
    const l = limits[name]
    if (l?.min !== undefined) lo = Math.max(lo, l.min)
    if (l?.max !== undefined) hi = Math.min(hi, l.max)
    return lo === Number.NEGATIVE_INFINITY && hi === Number.POSITIVE_INFINITY ? null : [lo, hi]
  })
}

/** Each fitted data set's title as a number (for data set constants). */
function titleValue(ds: NormalizedDataSet): number {
  const t = ds.title.trim()
  return t === '' ? Number.NaN : Number(t)
}

interface Data {
  ds: NormalizedDataSet
  pts: XYPoint[]
  x: Float64Array
  y: Float64Array
  /** Position among the analyzed data sets (0 = A), for lines for particular data sets. */
  dataSet: number
}

type Weights = NonlinearParams['weighting']

/** The curve-based weighting passed to the fitter (1/X, 1/X², 1/SD² are fixed point weights). */
const curveWeighting = (w: Weights): FitOptions['weighting'] =>
  w === 'x' || w === 'x2' || w === 'sd' ? 'none' : w

/** SD of a row's values (the entered SD for summary data), NaN if not computable. */
function rowSD(ds: NormalizedDataSet, row: number): number {
  if (ds.data.shape === 'summary') return ds.data.sd[row] ?? Number.NaN
  const v = ds.data.reps.map((r) => r[row]!).filter((y) => !Number.isNaN(y))
  if (v.length < 2) return Number.NaN
  const m = v.reduce((a, b) => a + b, 0) / v.length
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1))
}

/**
 * Fixed point weights of a data set for 1/X, 1/X² and 1/SD² weighting (null for the
 * other choices), or a message when they can't be computed.
 */
function pointWeightsOf(d: Data, w: Weights): Float64Array | null | string {
  if (w === 'x' || w === 'x2') {
    if (d.pts.some((p) => !(p.x > 0)))
      return `Weighting by 1/X${w === 'x2' ? '²' : ''} needs every X of “${d.ds.title}” to be positive.`
    return Float64Array.from(d.pts, (p) => (w === 'x' ? 1 / p.x : 1 / (p.x * p.x)))
  }
  if (w === 'sd') {
    const sd = d.pts.map((p) => rowSD(d.ds, p.row))
    if (sd.some((v) => !(v > 0)))
      return `Weighting by 1/SD² needs an SD above zero at every X of “${d.ds.title}” (two or more different replicates, or an entered SD).`
    return Float64Array.from(sd, (v) => 1 / (v * v))
  }
  return null
}

interface Fitted extends Data {
  fit: NonlinearFit
  /** Index of this data set within `fit` (global fits hold several). */
  i: number
}

const dataOf = (ds: NormalizedDataSet, pts: XYPoint[], dataSet: number): Data => ({
  ds,
  pts,
  x: Float64Array.from(pts, (p) => p.x),
  y: Float64Array.from(pts, (p) => p.y),
  dataSet,
})

const STATUS_TEXT: Record<NonlinearFit['status'], string> = {
  converged: 'Converged',
  maxIterations: 'Did not converge',
  singular: 'Ambiguous',
  invalid: 'Not fit',
}

/** Stats-level constraints: data set constants take the fitted data sets' titles. */
function statsConstraints(constraints: Constraint[], data: readonly Data[]): ParamConstraint[] {
  return constraints.map((c) =>
    c.kind === 'dataSetConstant'
      ? { kind: 'dataSetConstant', values: data.map((d) => titleValue(d.ds)) }
      : c.kind === 'meanX'
        ? { kind: 'dataSetConstant', values: data.map((d) => meanOf(d.x)) }
        : c,
  )
}

/** Fit options for these data sets: constraints and fixed point weights (1/X, 1/X², 1/SD²). */
function optionsFor(
  data: readonly Data[],
  opts: FitOptions,
  constraints: Constraint[],
  weights: Weights,
): FitOptions {
  const o: FitOptions = { ...opts, constraints: statsConstraints(constraints, data) }
  const pw = data.map((d) => pointWeightsOf(d, weights))
  if (pw.some((w) => w instanceof Float64Array))
    o.pointWeights = pw.map((w) => (w instanceof Float64Array ? w : undefined))
  return o
}

/**
 * Roadmap 42: a run's progress counts data sets fitted, over every fit it makes (ROUT's, the
 * fit, the comparisons'), each fit of all the data sets at once counting as one per data set.
 */
interface FitSteps {
  done: number
  readonly total: number
  readonly progress: Progress
}

/** `n` more data sets fitted. One report per fit: a fit is thousands of operations at least. */
function advance(steps: FitSteps | undefined, n: number) {
  if (!steps) return
  steps.done += n
  steps.progress(steps.done, steps.total)
}

/** Fits every data set, globally when any parameter is shared. */
function fitAll(
  eq: CurveModel,
  data: readonly Data[],
  opts: FitOptions,
  constraints: Constraint[],
  weights: Weights = 'none',
  steps?: FitSteps,
): Fitted[] {
  if (constraints.some((c) => c.kind === 'shared') && data.length > 1) {
    const fit = nonlinearFit(eq, data, optionsFor(data, opts, constraints, weights))
    advance(steps, data.length)
    return data.map((d, i) => ({ ...d, fit, i }))
  }
  return data.map((d) => {
    const fit = nonlinearFit(eq, [d], optionsFor([d], opts, constraints, weights))
    advance(steps, 1)
    return { ...d, fit, i: 0 }
  })
}

/** Version 1 (before 0.3.9, S18): both the F test and AICc verdicts were reported; kept. */
export const migrateNonlinear = (raw: unknown, from: number): unknown =>
  from >= 2 ? raw : pinDefaults(raw, [[['compareBy'], 'both']])

export const nonlinearFitDef: AnalysisDef<NonlinearParams> = {
  id: 'nonlinearFit',
  version: 2,
  title: 'Nonlinear regression (curve fit)',
  category: 'XY analyses',
  description:
    'Fit a model — dose-response, binding, kinetics, exponential, your own equation and more — by least squares or robust regression, with automatic initial values, constraints, shared (global) parameters, outlier detection (ROUT), diagnostics and interpolation of unknowns from a standard curve.',
  accepts: ['xy'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: NonlinearParamsSchema,
  migrateParams: migrateNonlinear,
  form: [
    { path: ['equation'], label: 'Model', kind: 'custom', component: 'nlfit.equation' },
    {
      path: ['userEquation'],
      label: 'Equation',
      kind: 'custom',
      component: 'nlfit.userEquation',
      showIf: { path: ['equation'], in: [USER_EQUATION] },
    },
    {
      path: ['equationByDataSet'],
      label: 'A different equation for some data sets',
      kind: 'custom',
      component: 'nlfit.equationByDataSet',
    },
    { path: ['constraints'], label: 'Parameters', kind: 'custom', component: 'nlfit.constraints' },
    {
      path: ['initialValues'],
      label: 'Initial values',
      kind: 'custom',
      component: 'nlfit.initialValues',
    },
    {
      path: ['initialRules'],
      label: 'Rules for initial values',
      kind: 'custom',
      component: 'nlfit.initialRules',
      showIf: { path: ['equation'], in: [USER_EQUATION] },
    },
    { path: ['limits'], label: 'Limits', kind: 'custom', component: 'nlfit.limits' },
    INTERPOLATE_FIELD,
    {
      path: ['fitMethod'],
      label: 'Fitting method',
      kind: 'radio',
      options: [
        { value: 'leastSquares', label: 'Least squares regression' },
        { value: 'robust', label: 'Robust regression (best-fit values only)' },
      ],
    },
    {
      path: ['outliers'],
      label: 'Outliers (ROUT method)',
      kind: 'radio',
      options: [
        { value: 'none', label: 'No special handling of outliers' },
        { value: 'identify', label: 'Detect and count outliers, but fit all the data' },
        { value: 'eliminate', label: 'Detect and eliminate outliers' },
      ],
      showIf: { path: ['fitMethod'], in: ['leastSquares'] },
    },
    {
      path: ['routQ'],
      label: 'ROUT coefficient Q (maximum false discovery rate), %',
      kind: 'select',
      options: [
        { value: 0.1, label: '0.1%' },
        { value: 0.5, label: '0.5%' },
        { value: 1, label: '1% (recommended)' },
        { value: 5, label: '5%' },
        { value: 10, label: '10%' },
      ],
      showIf: [
        { path: ['fitMethod'], in: ['leastSquares'] },
        { path: ['outliers'], in: ['identify', 'eliminate'] },
      ],
    },
    {
      path: ['weighting'],
      label: 'Weighting',
      kind: 'select',
      options: [
        { value: 'none', label: 'No weighting (least squares)' },
        { value: 'relative', label: 'Weight by 1/Y² (relative)' },
        { value: 'poisson', label: 'Weight by 1/Y (Poisson)' },
        { value: 'power', label: 'Weight by 1/Y^K (general)' },
        { value: 'x', label: 'Weight by 1/X' },
        { value: 'x2', label: 'Weight by 1/X²' },
        { value: 'sd', label: 'Weight by 1/SD²' },
      ],
    },
    {
      path: ['weightPower'],
      label: 'K',
      kind: 'number',
      showIf: { path: ['weighting'], in: ['power'] },
    },
    {
      path: ['replicates'],
      label: 'Replicates',
      kind: 'radio',
      options: [
        { value: 'each', label: 'Consider each replicate Y value as an individual point' },
        { value: 'mean', label: 'Only consider the mean Y value of each point' },
      ],
    },
    {
      path: ['ciMethod'],
      label: 'Confidence intervals of parameters',
      kind: 'radio',
      options: [
        { value: 'symmetric', label: 'Symmetrical (asymptotic)' },
        { value: 'profile', label: 'Asymmetrical (profile likelihood)' },
      ],
    },
    {
      path: ['band'],
      label: 'Show on graph',
      kind: 'radio',
      options: [
        { value: 'none', label: 'Curve only' },
        { value: 'confidence', label: 'Confidence band' },
        { value: 'prediction', label: 'Prediction band' },
      ],
    },
    {
      path: ['compareWith'],
      label: 'Compare with another model',
      kind: 'custom',
      component: 'nlfit.compare',
    },
    {
      path: ['compareParams'],
      label: 'Do the best-fit values of these parameters differ between data sets?',
      kind: 'custom',
      component: 'nlfit.compareParams',
    },
    {
      path: ['compareBy'],
      label: 'Decide the comparison by (chosen before the results)',
      kind: 'radio',
      options: [
        {
          value: 'fTest',
          label: 'Extra sum-of-squares F test (recommended for nested models)',
        },
        { value: 'aicc', label: 'AICc (models that aren’t nested too)' },
      ],
    },
    ...DIAGNOSTIC_FIELDS,
    {
      path: ['weightingTest'],
      label: 'Test for appropriate weighting (homoscedasticity)',
      kind: 'checkbox',
    },
    { path: ['hougaard'], label: 'Hougaard’s skewness of each parameter', kind: 'checkbox' },
    {
      path: ['covariance'],
      label: 'Correlation matrix and dependency of the parameters',
      kind: 'checkbox',
    },
    CONFIDENCE_FIELD,
  ],
  outputs: (keys, params) => [
    ...keys.map((k) => ({ key: `curve:${k}`, forDataSet: k })),
    ...(params.diagnostics?.residuals ? residualOutputs(keys) : []),
  ],
  run: (input, params, context, progress) => runNonlinear(input, params, context, progress),
}

/**
 * Data sets fit with different equations (`equationByDataSet`) are fit group by group, one group
 * per equation, and the results put side by side: each sheet lists every group's blocks under
 * a note naming its data sets.
 */
export function runNonlinear(
  input: readonly NormalizedDataSet[],
  params: NonlinearParams,
  context?: RunContext,
  progress?: Progress,
): AnalysisResult {
  const main = { equation: params.equation, userEquation: params.userEquation }
  const keyOf = (e: typeof main) =>
    e.equation === USER_EQUATION ? `user:${e.userEquation.trim()}` : e.equation
  const groups: { key: string; eq: typeof main; input: NormalizedDataSet[] }[] = []
  for (const ds of input) {
    const e = params.equationByDataSet[ds.ref.key] ?? main
    const key = keyOf(e)
    const g = groups.find((x) => x.key === key)
    if (g) g.input.push(ds)
    else groups.push({ key, eq: e, input: [ds] })
  }
  const mainKey = keyOf(main)
  const order = new Map(input.map((d, i) => [d.ref.key, i]))
  if (groups.length <= 1)
    return runFit(input, { ...params, ...(groups[0]?.eq ?? main) }, context, order, progress)
  // Progress: each group's share of the data sets.
  let before = 0
  const results = groups.map((g) => {
    const from = before
    before += g.input.length
    return runFit(
      g.input,
      g.key === mainKey
        ? { ...params, interpolate: false }
        : {
            ...params,
            ...g.eq,
            constraints: {},
            initialValues: {},
            limits: {},
            compareWith: 'none',
            compareParams: [],
            interpolate: false,
          },
      context,
      order,
      progress && ((done, total) => progress(from + (done / total) * g.input.length, input.length)),
    )
  })
  const diagnostics: Diagnostic[] = []
  const add = (d: Diagnostic) => {
    if (!diagnostics.some((x) => x.message === d.message && x.level === d.level))
      diagnostics.push(d)
  }
  const sheets: ResultSheet[] = []
  const outputs: AnalysisResult['outputs'] = {}
  const values: AnalysisResult['values'] = {}
  results.forEach((r, gi) => {
    const names = groups[gi]!.input.map((d) => `“${d.title}”`).join(', ')
    for (const d of r.diagnostics)
      add(d.level === 'error' ? { level: 'warning', message: `${names}: ${d.message}` } : d)
    for (const sh of r.sheets) {
      let t = sheets.find((x) => x.key === sh.key)
      if (!t) {
        t = { key: sh.key, title: sh.title, blocks: [] }
        sheets.push(t)
      }
      t.blocks.push({ type: 'note', text: `Data sets ${names}:` }, ...sh.blocks)
    }
    Object.assign(outputs, r.outputs)
    Object.assign(values, r.values)
  })
  if (params.interpolate)
    add({
      level: 'info',
      message: 'Interpolation isn’t available when data sets are fit with different equations.',
    })
  // Errors of a group became warnings above; the result fails only when every group failed.
  const allFailed = results.every((r) => r.status === 'error')
  return result({
    status: allFailed ? 'error' : statusOf(diagnostics),
    diagnostics,
    sheets,
    values,
    outputs,
  })
}

/** A fit of the analyzed data sets, as the sections of its result read it. */
interface FitRun {
  eq: FitModel
  params: NonlinearParams
  constraints: Constraint[]
  /** Numbers of free and of shared parameters. */
  nFree: number
  nShared: number
  robust: boolean
  opts: FitOptions
  /** The data sets fitted (after ROUT's "eliminate", without the outliers). */
  fitData: Data[]
  fits: Fitted[]
  /** A global fit: some parameter is shared by several data sets. */
  shared: boolean
  diagnostics: Diagnostic[]
  /** The run's progress (roadmap 42), when reported. */
  steps: FitSteps | undefined
}

/** The ROUT outliers of each data set (by `data` index) and their t and P values. */
interface Outliers {
  data: Data[]
  points: XYPoint[][]
  t: Float64Array[]
  p: Float64Array[]
}

// An invalid fit holds only its starting values: show a dash, not numbers.
const NONE = text('—')
const NOT_USED = text('(not used)')
const isFit = (f: Fitted) => f.fit.status !== 'invalid'
const shown = (f: Fitted, v: () => ResultValue) => (isFit(f) ? v() : NONE)
/** Parameter k's estimate in data set f. */
const estimate = (f: Fitted, k: number) => f.fit.params[f.i]![k]!
const isFixed = (c: Constraint) =>
  c.kind === 'constant' || c.kind === 'dataSetConstant' || c.kind === 'meanX'
/** Data set f's own equation (lines for particular data sets) doesn't use parameter k. */
const unused = (eq: FitModel, f: Fitted, k: number) => modelFor(eq, f).uses?.(k) === false

function runFit(
  input: readonly NormalizedDataSet[],
  params: NonlinearParams,
  context: RunContext | undefined,
  order: ReadonlyMap<string, number>,
  progress?: Progress,
): AnalysisResult {
  const diagnostics: Diagnostic[] = [...exclusionNotes(input), ...missingXNote(input)]
  const resolved = resolveEquation(params)
  if (!resolved.ok) return failure(resolved.message, diagnostics)
  const eq = resolved.model
  if (eq.params.length === 0)
    return failure(
      'The equation has no parameters to fit (every name in it is X, Y or an intermediate variable).',
      diagnostics,
    )
  const robust = params.fitMethod === 'robust'

  const constraints = eq.params.map((name) => effectiveConstraint(eq, name, params))
  const nFree = constraints.filter((c) => c.kind === 'fit').length
  const nShared = constraints.filter((c) => c.kind === 'shared').length
  const dsc = eq.params.filter((_, j) => constraints[j]!.kind === 'dataSetConstant')
  if (dsc.length) {
    const bad = input.filter((d) => !Number.isFinite(titleValue(d)))
    if (bad.length)
      return failure(
        `${dsc.join(', ')} ${dsc.length > 1 ? 'take' : 'takes'} each data set’s title as its value, so the titles must be numbers (${bad.map((d) => `“${d.title}”`).join(', ')} ${bad.length > 1 ? 'are' : 'is'} not).`,
        diagnostics,
      )
  }
  // In a global fit each data set needs more points than its own parameters (the shared ones
  // are fit once, from all of them); fit alone, a data set fits the shared parameters too.
  const enough = (d: Data, need: number) => {
    if (d.x.length > need) return true
    diagnostics.push({
      level: 'warning',
      message: `“${d.ds.title}” has too few points (${d.x.length}) to fit ${need} parameter${need === 1 ? '' : 's'}.`,
    })
    return false
  }
  const pointsOf = params.replicates === 'mean' ? meanPointRows : xyPointRows
  // Each data set's own program (lines for particular data sets): one without a Y is an error.
  for (const ds of input) {
    try {
      modelFor(eq, { dataSet: order.get(ds.ref.key) ?? 0 })
    } catch (e) {
      return failure(`“${ds.title}”: ${e instanceof Error ? e.message : String(e)}`, diagnostics)
    }
  }
  let data = input
    .map((ds) => dataOf(ds, pointsOf(ds), order.get(ds.ref.key) ?? 0))
    .filter((d) => enough(d, nFree))
  if (nShared > 0 && data.length === 1) data = data.filter((d) => enough(d, nFree + nShared))
  if (!data.length) return failure('No data set has enough points to fit.', diagnostics)
  if (nShared > 0) {
    const nPoints = data.reduce((s, d) => s + d.x.length, 0)
    const nParams = data.length * nFree + nShared
    if (nPoints <= nParams)
      return failure(
        `The global fit has too few points (${nPoints}) to fit ${nParams} parameters.`,
        diagnostics,
      )
  }

  for (const d of data) {
    const w = pointWeightsOf(d, params.weighting)
    if (typeof w === 'string') return failure(w, diagnostics)
  }
  const opts: FitOptions = {
    bounds: boundsFor(eq, params.limits),
    weighting: curveWeighting(params.weighting),
    weightPower: params.weightPower,
    confLevel: params.confidenceLevel,
    profileCI: params.ciMethod === 'profile' && !robust,
  }
  if (params.band === 'prediction' && params.weighting === 'sd')
    diagnostics.push({
      level: 'info',
      message: 'With 1/SD² weighting a new point has no weight, so the confidence band is shown.',
    })

  // Roadmap 42: the fits this run makes, counted in data sets (FitSteps): ROUT's robust fit,
  // the fit, the other model's and the two fits comparing parameters between data sets.
  const rout = !robust && params.outliers !== 'none'
  const comparesModels = params.compareWith !== 'none' && nShared === 0 && !robust
  const comparesParams =
    !robust && data.length > 1 && params.compareParams.some((n) => eq.params.includes(n))
  const steps: FitSteps | undefined = progress && {
    done: 0,
    total: data.length * ((rout ? 1 : 0) + 1 + (comparesModels ? 1 : 0) + (comparesParams ? 2 : 0)),
    progress,
  }

  // ROUT (least squares only): outliers from a robust fit; "eliminate" refits without them.
  let outliers: Outliers | null = null
  if (rout) {
    const r = routCurve(
      eq,
      data,
      params.routQ / 100,
      optionsFor(data, { ...opts, profileCI: false }, constraints, params.weighting),
    )
    advance(steps, data.length)
    outliers = {
      data,
      points: data.map((d, k) => r.outliers[k]!.map((i) => d.pts[i]!)),
      t: r.t,
      p: r.p,
    }
    if (r.robust.blocks.some((b) => !b.converged))
      diagnostics.push({
        level: 'info',
        message: 'The robust fit used to find outliers did not fully converge.',
      })
  }
  const fitData =
    outliers && params.outliers === 'eliminate'
      ? data.map((d, k) =>
          dataOf(
            d.ds,
            d.pts.filter((p) => !outliers!.points[k]!.includes(p)),
            d.dataSet,
          ),
        )
      : data

  let fits: Fitted[]
  let rsdr: number[] | null = null
  if (robust) {
    const rf = robustFit(eq, fitData, {
      ...opts,
      constraints: statsConstraints(constraints, fitData),
    })
    fits = fitData.map((d, k) => {
      const block = rf.blocks[rf.perDataSet[k]!.block]!
      return { ...d, fit: block.fit, i: block.sets.indexOf(k) }
    })
    rsdr = fitData.map((_, k) => rf.blocks[rf.perDataSet[k]!.block]!.rsdr)
    advance(steps, fitData.length)
    if (rf.blocks.some((b) => !b.converged))
      diagnostics.push({ level: 'warning', message: 'The robust fit did not converge.' })
  } else {
    fits = fitAll(eq, fitData, opts, constraints, params.weighting, steps)
  }
  const shared = constraints.some((c) => c.kind === 'shared') && fits.length > 1
  for (const f of fits) {
    if (f.fit.status === 'singular') {
      diagnostics.push({
        level: 'warning',
        message: `The fit of “${f.ds.title}” is ambiguous: some parameters can’t be determined from these data. Consider constraining one.`,
      })
    } else if (f.fit.status !== 'converged') {
      diagnostics.push({
        level: 'warning',
        message: `The fit of “${f.ds.title}” ${f.fit.status === 'maxIterations' ? 'did not converge' : 'failed'}${f.fit.message ? `: ${f.fit.message.replace(/\.+$/, '')}` : ''}.`,
      })
    }
    if (shared) break // one global status
  }

  const run: FitRun = {
    eq,
    params,
    constraints,
    nFree,
    nShared,
    robust,
    opts,
    fitData,
    fits,
    shared,
    diagnostics,
    steps,
  }
  const sheets: ResultSheet[] = [resultsSheet(fitBlocks(run, rsdr, outliers))]
  const comparison = comparisonSheet(run)
  if (comparison) sheets.push(comparison)
  const compared = compareParamsSheet(run)
  if (compared) sheets.push(compared.sheet)
  if (outliers) sheets.push(outliersSheet(outliers, params))
  const outputs: Record<string, GraphableDataSet> = {}
  sheets.push(...diagnosticSheets(run, outputs))
  curveOutputs(run, outputs)

  let resultTable: AnalysisResult['table']
  if (params.interpolate) {
    const r = interpolation(
      input,
      fits,
      (f) => (isFit(f) ? fittedCurve(modelFor(eq, f), f.fit, f.i, params.confidenceLevel) : null),
      params.confidenceLevel,
      context,
      robust || fits.some((f) => f.fit.status === 'singular'),
    )
    sheets.push(r.sheet)
    resultTable = r.table
  }

  return result({
    diagnostics,
    sheets,
    values: Object.fromEntries([
      ...fits.filter(isFit).flatMap((f) =>
        eq.params.flatMap((name, k) => {
          if (unused(eq, f, k)) return []
          const key = `${name}:${f.ds.ref.key}`
          const e = estimate(f, k)
          // SE and CI of fitted parameters too (for Monte Carlo coverage of the CI).
          return isFixed(constraints[k]!) || robust
            ? [[key, num(e.value)]]
            : [
                [key, num(e.value)],
                [`${key}:se`, num(e.se)],
                [`${key}:lo`, num(e.lo)],
                [`${key}:hi`, num(e.hi)],
              ]
        }),
      ),
      ...(outliers
        ? outliers.data.map((d, k) => [
            `outliers:${d.ds.ref.key}`,
            int(outliers!.points[k]!.length),
          ])
        : []),
      ...(compared ? [['compareP', pval(compared.p)]] : []),
    ]),
    outputs,
    table: resultTable,
  })
}

/** The weights of a data set's points (1/X, 1/X², 1/SD² weighting), if any. */
function weightsOf(d: Data, w: Weights): Float64Array | undefined {
  const pw = pointWeightsOf(d, w)
  return pw instanceof Float64Array ? pw : undefined
}

/**
 * The results sheet: best-fit values (and derived ones), their SEs and CIs, goodness of fit,
 * the fits' status, Hougaard's skewness, the constraints and the global fit.
 */
function fitBlocks(run: FitRun, rsdr: number[] | null, outliers: Outliers | null): ResultBlock[] {
  const { eq, params, constraints, fits, robust, shared, fitData, diagnostics } = run
  const level = pct(params.confidenceLevel)
  const cols = fits.map((f) => f.ds.title)
  const fixedValue = (f: Fitted, k: number) => {
    const c = constraints[k]!
    return c.kind === 'constant' ? c.value : c.kind === 'meanX' ? meanOf(f.x) : titleValue(f.ds)
  }
  const free = eq.params.map((_, k) => k).filter((k) => !isFixed(constraints[k]!))
  const values = (f: Fitted) => f.fit.params[f.i]!.map((p) => p.value)
  const derivedNames =
    eq.derived && isFit(fits[0]!) ? Object.keys(eq.derived(values(fits[0]!))) : []
  const blocks: ResultBlock[] = [
    { type: 'note', text: `${eq.name}: ${eq.formula}` },
    labelTable('Best-fit values', cols, [
      ...eq.params.map((name, k): [string, ResultValue[]] => [
        name,
        fits.map((f) =>
          unused(eq, f, k)
            ? NOT_USED
            : isFixed(constraints[k]!)
              ? text(`= ${fixedValue(f, k)}`)
              : shown(f, () => num(estimate(f, k).value)),
        ),
      ]),
      ...derivedNames.map((name): [string, ResultValue[]] => [
        name,
        fits.map((f) => shown(f, () => num(eq.derived!(values(f))[name]!))),
      ]),
    ]),
  ]
  if (!robust)
    blocks.push(
      labelTable(
        'Std. Error',
        cols,
        free.map((k): [string, ResultValue[]] => [
          eq.params[k]!,
          fits.map((f) => (unused(eq, f, k) ? NOT_USED : shown(f, () => num(estimate(f, k).se)))),
        ]),
      ),
      labelTable(
        `${level} CI (${params.ciMethod === 'profile' ? 'profile likelihood' : 'asymptotic'})`,
        cols,
        free.map((k): [string, ResultValue[]] => [
          eq.params[k]!,
          fits.map((f) =>
            unused(eq, f, k)
              ? NOT_USED
              : shown(f, () =>
                  interval(estimate(f, k).lo, estimate(f, k).hi, params.confidenceLevel),
                ),
          ),
        ]),
      ),
      labelTable('Goodness of Fit', cols, [
        ['Degrees of Freedom', fits.map((f) => shown(f, () => int(f.fit.perDataSet[f.i]!.df)))],
        ['R squared', fits.map((f) => shown(f, () => num(f.fit.perDataSet[f.i]!.r2)))],
        ['Sum of Squares', fits.map((f) => shown(f, () => num(f.fit.perDataSet[f.i]!.ss)))],
        ['Sy.x', fits.map((f) => shown(f, () => num(f.fit.perDataSet[f.i]!.syx)))],
      ]),
    )
  else
    blocks.push(
      labelTable('Goodness of Fit', cols, [
        ['Robust SD of residuals (RSDR)', fits.map((f, k) => shown(f, () => num(rsdr![k]!)))],
      ]),
      {
        type: 'note',
        text: 'Robust regression (Lorentzian): standard errors, confidence intervals, bands and model comparison aren’t available, and weighting is ignored.',
      },
    )
  const fitRows: [string, ResultValue[]][] = [
    ['Status', fits.map((f) => text(STATUS_TEXT[f.fit.status]))],
    ['Number of points analyzed', fits.map((f) => int(f.x.length))],
  ]
  if (outliers)
    fitRows.push([
      params.outliers === 'eliminate' ? 'Number of outliers removed' : 'Number of outliers',
      outliers.points.map((o) => int(o.length)),
    ])
  blocks.push(labelTable('Fit', cols, fitRows))
  if (params.hougaard && !robust) {
    const weights = (d: Data) => weightsOf(d, params.weighting)
    // A global fit holds every data set in one fit; otherwise each data set has its own.
    const gs =
      shared && isFit(fits[0]!)
        ? hougaardSkewness(eq, fits[0]!.fit, fitData, fitData.map(weights))
        : null
    const g = fits.map((f) =>
      !shared && isFit(f) ? hougaardSkewness(eq, f.fit, [f], [weights(f)])[0]! : null,
    )
    const at = (k: number, j: number) => (gs ? gs[k]![j]! : (g[k]?.[j] ?? Number.NaN))
    blocks.push(
      labelTable(
        'Hougaard’s skewness',
        cols,
        free.map((j): [string, ResultValue[]] => [
          eq.params[j]!,
          fits.map((_, k) => {
            const v = at(k, j)
            return Number.isFinite(v) ? num(v) : NONE
          }),
        ]),
      ),
      {
        type: 'note',
        text: `|Skewness| below 0.1: the estimate behaves almost linearly and its symmetric CI is accurate; 0.1–0.25 adequate; 0.25–1 noticeable; above 1 considerable (Ratkowsky).${params.weighting !== 'none' ? ' Weighted fits: the weights are held at their values at the best fit.' : ''}`,
      },
    )
    const worst = fits.flatMap((_, k) => free.map((j) => at(k, j))).filter(Number.isFinite)
    if (worst.some((v) => Math.abs(v) >= 1))
      diagnostics.push({
        level: 'info',
        message:
          'Some parameters are considerably skewed (Hougaard’s |skewness| ≥ 1): their symmetric confidence intervals are unreliable; profile-likelihood intervals are better.',
      })
  }
  const constrained = eq.params
    .map((name, k) => [name, constraints[k]!] as const)
    .filter(([, c]) => c.kind !== 'fit')
  if (constrained.length) {
    blocks.push(
      kv(
        'Constraints',
        constrained.map(([name, c]) => [
          name,
          text(
            c.kind === 'constant'
              ? `Constant equal to ${c.value}`
              : c.kind === 'dataSetConstant'
                ? 'Data set constant (the data set’s title)'
                : c.kind === 'meanX'
                  ? 'Data set constant (= mean X)'
                  : 'Shared value for all data sets',
          ),
        ]),
      ),
    )
  }
  if (shared) {
    const g = fits[0]!.fit
    blocks.push(
      kv('Global (shared) fit', [
        ['Degrees of Freedom', shown(fits[0]!, () => int(g.df))],
        ['Sum of Squares', shown(fits[0]!, () => num(g.ss))],
        ['Number of points analyzed', int(g.n)],
      ]),
    )
  }
  return blocks
}

/**
 * Comparison with another model: simpler (fewer free parameters) vs. more complex, per data
 * set. A global fit would be compared with per-data-set fits of the other model, which isn't a
 * like-for-like comparison, so it's off until the alternative can be fit globally too.
 */
function comparisonSheet(run: FitRun): ResultSheet | null {
  const { eq, params, fits, fitData, opts, nFree, nShared, robust, diagnostics, steps } = run
  if (params.compareWith === 'none') return null
  const compareShared = nShared > 0
  if (compareShared)
    diagnostics.push({
      level: 'info',
      message: 'Model comparison isn’t available with shared parameters yet.',
    })
  if (robust)
    diagnostics.push({
      level: 'info',
      message: 'Model comparison isn’t available with robust regression.',
    })
  const alt = !compareShared && !robust ? equation(params.compareWith) : undefined
  if (!compareShared && !robust && !alt)
    diagnostics.push({
      level: 'warning',
      message: `Unknown comparison model “${params.compareWith}”.`,
    })
  if (!alt || alt.id === params.equation) return null
  const altConstraints = alt.params.map((name) =>
    effectiveConstraint(alt, name, { constraints: {} }),
  )
  const aFree = altConstraints.filter((c) => c.kind === 'fit').length
  const altFits = fitAll(
    alt,
    fitData,
    { ...opts, bounds: boundsFor(alt, {}) },
    altConstraints,
    params.weighting,
    steps,
  )
  const comps = fits.map((f, j) => {
    const a = altFits[j]!
    const simplerIsMain = nFree <= aFree
    const simpler = simplerIsMain ? f.fit : a.fit
    const complex = simplerIsMain ? a.fit : f.fit
    return {
      c: compareFits(simpler, complex),
      simplerName: simplerIsMain ? eq.name : alt.name,
      complexName: simplerIsMain ? alt.name : eq.name,
      nested: nFree !== aFree,
    }
  })
  // S18: one verdict, by the method chosen in advance (both for analyses saved before 0.3.9).
  // Models with the same number of free parameters aren't nested: no F test.
  const byF = params.compareBy !== 'aicc'
  const byAICc = params.compareBy !== 'fTest' || comps.every((c) => !c.nested)
  if (params.compareBy === 'fTest' && comps.every((c) => !c.nested))
    diagnostics.push({
      level: 'warning',
      message:
        'These models aren’t nested (the same number of free parameters), so the F test doesn’t apply; they are compared by AICc.',
    })
  const fRows: [string, ResultValue[]][] = [
    ['F', comps.map((c) => (c.nested ? num(c.c.F) : text('—')))],
    ['DFn, DFd', comps.map((c) => text(c.nested ? `${c.c.dfn}, ${c.c.dfd}` : '—'))],
    ['P value', comps.map((c) => (c.nested ? pval(c.c.p) : text('—')))],
    ['P value summary', comps.map((c) => (c.nested ? psum(c.c.p) : text('—')))],
    [
      'Preferred model (F test)',
      comps.map((c) =>
        text(!c.nested ? 'Not nested' : c.c.p < ALPHA ? c.complexName : c.simplerName),
      ),
    ],
  ]
  const aRows: [string, ResultValue[]][] = [
    ['AICc of simpler model', comps.map((c) => num(c.c.aiccSimpler))],
    ['AICc of alternative model', comps.map((c) => num(c.c.aiccComplex))],
    [
      'Probability simpler model is correct',
      comps.map((c) => text(`${(c.c.probSimpler * 100).toFixed(2)}%`)),
    ],
    [
      'Preferred model (AICc)',
      comps.map((c) => text(c.c.probSimpler >= 0.5 ? c.simplerName : c.complexName)),
    ],
  ]
  const rows: [string, ResultValue[]][] = [
    ['Null hypothesis (simpler model)', comps.map((c) => text(c.simplerName))],
    ['Alternative hypothesis', comps.map((c) => text(c.complexName))],
    ...(byF && !(params.compareBy === 'fTest' && byAICc) ? fRows : []),
    ...(byAICc ? aRows : []),
  ]
  const title =
    byF && byAICc && params.compareBy === 'both'
      ? 'Extra sum-of-squares F test and AICc'
      : byAICc
        ? 'AICc'
        : 'Extra sum-of-squares F test'
  return {
    key: 'compare',
    title: 'Comparison of fits',
    blocks: [
      labelTable(
        title,
        fits.map((f) => f.ds.title),
        rows,
      ),
      {
        type: 'note',
        text: 'The F test is valid only when the simpler model is a special case of the other (nested models); AICc compares any two models fitted to the same data.',
      },
    ],
  }
}

/**
 * "Do the best-fit values of the chosen parameters differ between data sets?" (the Compare
 * tab): the null model shares them across the data sets. Its sheet and P value, if compared.
 */
function compareParamsSheet(run: FitRun): { sheet: ResultSheet; p: number } | null {
  const { eq, params, constraints, fits, fitData, opts, robust, shared, diagnostics, steps } = run
  const toCompare = params.compareParams.filter((n) => eq.params.includes(n))
  if (!toCompare.length) return null
  if (robust) {
    diagnostics.push({
      level: 'info',
      message: 'Comparing parameters between data sets isn’t available with robust regression.',
    })
    return null
  }
  if (fitData.length < 2) {
    diagnostics.push({
      level: 'info',
      message: 'Comparing a parameter between data sets needs two or more data sets.',
    })
    return null
  }
  const share = toCompare
    .map((n) => eq.params.indexOf(n))
    .filter((j) => constraints[j]!.kind === 'fit')
  if (!share.length) {
    diagnostics.push({
      level: 'info',
      message: `${toCompare.join(', ')} ${toCompare.length > 1 ? 'are' : 'is'} already shared or constant, so there is nothing to compare.`,
    })
    return null
  }
  const plain = { ...opts, profileCI: false }
  const nullCons = constraints.map(
    (c, j): Constraint => (share.includes(j) ? { kind: 'shared' } : c),
  )
  const complex = shared
    ? fits[0]!.fit
    : nonlinearFit(eq, fitData, optionsFor(fitData, plain, constraints, params.weighting))
  advance(steps, fitData.length)
  const simpler = nonlinearFit(eq, fitData, optionsFor(fitData, plain, nullCons, params.weighting))
  advance(steps, fitData.length)
  const names = share.map((j) => eq.params[j]!).join(', ')
  if (simpler.status === 'invalid' || complex.status === 'invalid') {
    diagnostics.push({
      level: 'warning',
      message: `The fits needed to compare ${names} between data sets could not be done.`,
    })
    return null
  }
  const c = compareFits(simpler, complex)
  const one = share.length === 1
  // S18: one verdict, by the method chosen in advance (both for analyses saved before 0.3.9).
  const byF = params.compareBy !== 'aicc'
  const byAICc = params.compareBy !== 'fTest'
  const sheet: ResultSheet = {
    key: 'compareParams',
    title: 'Compare parameters',
    blocks: [
      kv(`Do the best-fit values of ${names} differ between data sets?`, [
        ['Null hypothesis', text(`${names} ${one ? 'is' : 'are'} the same for all data sets`)],
        [
          'Alternative hypothesis',
          text(`${names} ${one ? 'differs' : 'differ'} between data sets`),
        ],
        ...(byF
          ? ([
              ['F', num(c.F)],
              ['DFn, DFd', text(`${c.dfn}, ${c.dfd}`)],
              ...pSig(c.p),
              [
                `Conclusion (alpha = ${ALPHA})`,
                text(
                  c.p < ALPHA
                    ? `Reject the null hypothesis: ${names} ${one ? 'differs' : 'differ'}`
                    : 'Do not reject the null hypothesis',
                ),
              ],
            ] as [string, ResultValue][])
          : []),
        ...(byAICc
          ? ([
              ['AICc of the null model (shared)', num(c.aiccSimpler)],
              ['AICc of the alternative model', num(c.aiccComplex)],
              [
                'Probability the null model is correct',
                text(`${(c.probSimpler * 100).toFixed(2)}%`),
              ],
              ...(byF
                ? []
                : ([
                    [
                      'Preferred model (AICc)',
                      text(
                        c.probSimpler >= 0.5
                          ? `${names} shared`
                          : `${names} different between data sets`,
                      ),
                    ],
                  ] as [string, ResultValue][])),
            ] as [string, ResultValue][])
          : []),
        ...share.map((j): [string, ResultValue] => [
          `${eq.params[j]} when shared`,
          num(simpler.params[0]![j]!.value),
        ]),
      ]),
      {
        type: 'note',
        text:
          params.compareBy === 'both'
            ? 'Extra sum-of-squares F test: the fit with the parameter shared by all data sets against the fit with a value per data set; AICc compares the same two fits.'
            : params.compareBy === 'fTest'
              ? 'Extra sum-of-squares F test: the fit with the parameter shared by all data sets against the fit with a value per data set.'
              : 'AICc: the fit with the parameter shared by all data sets against the fit with a value per data set.',
      },
    ],
  }
  return { sheet, p: byF ? c.p : Number.NaN }
}

/** The outliers ROUT found. */
function outliersSheet(outliers: Outliers, params: NonlinearParams): ResultSheet {
  const rows: ResultValue[][] = []
  outliers.data.forEach((d, k) => {
    outliers.points[k]!.forEach((p) => {
      const i = d.pts.indexOf(p)
      rows.push([
        text(d.ds.title),
        text(rowName(d.ds, p.row)),
        num(p.x),
        num(p.y),
        num(outliers.t[k]![i]!),
        pval(outliers.p[k]![i]!),
      ])
    })
  })
  return {
    key: 'outliers',
    title: 'Outliers',
    blocks: [
      rows.length
        ? table(
            `Outliers (ROUT, Q = ${params.routQ}%)`,
            ['Data set', 'Row', 'X', 'Y', 't (|residual| / RSDR)', 'P value'],
            rows,
          )
        : { type: 'note', text: `No outliers were found (ROUT, Q = ${params.routQ}%).` },
      {
        type: 'note',
        text:
          params.outliers === 'eliminate'
            ? 'The curve was fit by least squares to the remaining points.'
            : 'Outliers were identified, but the curve was fit to all the points.',
      },
    ],
  }
}

/**
 * The diagnostics sheet (runs, replicates and normality tests of the residuals, the test for
 * appropriate weighting, the parameters' correlation and dependency) and the residuals sheet,
 * whose residual plots go to `outputs`.
 */
function diagnosticSheets(run: FitRun, outputs: Record<string, GraphableDataSet>): ResultSheet[] {
  const { eq, params, fits, robust, shared, diagnostics } = run
  const sheets: ResultSheet[] = []
  const residualSets: ResidualSet[] = fits.filter(isFit).map((f) => {
    const residuals = fitResiduals(eq, f.fit, f, f.i)
    const st = f.fit.perDataSet[f.i]!
    return { ds: f.ds, points: f.pts, residuals, ss: st.ss, df: st.df }
  })
  const diagBlocks: ResultBlock[] = []
  const dg = params.diagnostics
  if ((dg.runsTest || dg.replicatesTest || dg.normality) && residualSets.length) {
    if (dg.replicatesTest && params.weighting !== 'none')
      diagnostics.push({
        level: 'info',
        message: 'The replicates test is shown for unweighted fits only.',
      })
    diagBlocks.push(
      ...diagnosticBlocks(residualSets, {
        ...dg,
        replicatesTest: dg.replicatesTest && params.weighting === 'none' && !robust && !shared,
      }),
    )
  }
  if (params.weightingTest && !robust) {
    const rows = fits.filter(isFit).map((f): ResultValue[] => {
      const t = weightingTest(eq, f.fit, f, f.i, weightsOf(f, params.weighting))
      return [text(f.ds.title), num(t.r), pval(t.p), psum(t.p), int(t.n)]
    })
    diagBlocks.push(
      table(
        params.weighting === 'none'
          ? 'Test for homoscedasticity (appropriate weighting)'
          : 'Test for appropriate weighting',
        [
          'Data set',
          'Spearman r (|weighted residual| vs. Y of curve)',
          'P value',
          'P value summary',
          'N',
        ],
        rows,
      ),
      {
        type: 'note',
        text: 'A small P value means the size of the weighted residuals changes with Y: the weighting (or equal weighting) may not suit these data.',
      },
    )
  }
  if (params.covariance && !robust) {
    for (const f of fits.filter(isFit)) {
      const idx = f.fit.freeIndex[f.i]!
      const js = idx.map((v, j) => (v >= 0 ? j : -1)).filter((j) => j >= 0)
      const q = Math.round(Math.sqrt(f.fit.cov.length))
      const sub = js.flatMap((a) => js.map((b) => f.fit.cov[idx[a]! * q + idx[b]!]!))
      diagBlocks.push(
        ...covarianceBlocks(
          js.map((j) => eq.params[j]!),
          sub,
          f.ds.title,
        ),
      )
      if (shared) break
    }
  }
  if (diagBlocks.length)
    sheets.push({ key: 'diagnostics', title: 'Diagnostics', blocks: diagBlocks })
  if (dg.residuals) sheets.push(residualsSheet(residualSets, 'curve', outputs))
  return sheets
}

/** Each fitted curve (with its confidence or prediction band) as an output. */
function curveOutputs(run: FitRun, outputs: Record<string, GraphableDataSet>) {
  const { eq, params, fits, robust } = run
  // A prediction band needs the weight of a new point: there is none with 1/SD² weighting.
  const bandKind = robust
    ? 'none'
    : params.band === 'prediction' && params.weighting === 'sd'
      ? 'confidence'
      : params.band
  for (const f of fits) {
    if (f.fit.status === 'invalid') continue
    const [lo, hi] = valueRange(f.x)
    const xs = curveXs(lo, hi)
    const band = curveBand(modelFor(eq, f), f.fit, f.i, xs, {
      confLevel: params.confidenceLevel,
      kind: bandKind === 'prediction' ? 'prediction' : 'confidence',
      ...(params.weighting === 'x'
        ? { pointWeightAt: (x: number) => 1 / x }
        : params.weighting === 'x2'
          ? { pointWeightAt: (x: number) => 1 / (x * x) }
          : {}),
    })
    outputs[`curve:${f.ds.ref.key}`] = {
      title: `${f.ds.title} (fit)`,
      x: [...xs],
      y: [...band.y],
      ...(bandKind === 'none' ? {} : { lo: [...band.lo], hi: [...band.hi] }),
    }
  }
}

export { EQUATIONS, equation }
