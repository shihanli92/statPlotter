import type {
  AnalysisDef,
  AnalysisResult,
  Diagnostic,
  NormalizedDataSet,
  ResultBlock,
  ResultSheet,
  ResultValue,
} from '@ps/model'
import {
  coxBaseline,
  coxRegression,
  coxSurvivalAt,
  designRow,
  likelihoodRatioTerms,
  linearAnovaTable,
  logisticRegression,
  maxOf,
  minOf,
  multipleLinearRegression,
  type RegCoefficient,
  type TermTest,
  valueRange,
} from '@ps/stats'
import { z } from 'zod'
import {
  ALPHA,
  CONFIDENCE_FIELD,
  confidenceLevel,
  curveXs,
  exclusionNotes,
  expit,
  failure,
  int,
  interval,
  kv,
  num,
  pct,
  pick,
  pSig,
  psum,
  pval,
  result,
  resultsSheet,
  significant,
  table,
  text,
} from './common.ts'
import { addPredictions } from './mvPredict.ts'
import {
  categoricalFields,
  categoricalParams,
  constantOutcomeLevels,
  type PreparedModel,
  predictionFields,
  predictionParams,
  prepareModel,
  referenceNote,
} from './mvVariables.ts'

const INTERCEPT_FIELD = {
  path: ['intercept'],
  label: 'Include an intercept (constant term)',
  kind: 'checkbox',
} as const

/** Splits the analyzed variables into the chosen outcome(s) and the predictors. */
export function roles(input: readonly NormalizedDataSet[], outcomeKeys: readonly string[]) {
  const outcome = outcomeKeys.map((k) => pick(input, k))
  const predictors = input.map((_, i) => i).filter((i) => !outcome.includes(i))
  return { outcome, predictors }
}

type CategoricalP = {
  categorical: string[]
  referenceRule: 'first' | 'last' | 'mostFrequent' | 'leastFrequent'
  referenceLevels: Record<string, string>
  interactions: string[][]
}

/** The model's variables and design, or a failure result. */
export function model(
  input: readonly NormalizedDataSet[],
  outcomes: readonly number[],
  predictors: readonly number[],
  p: CategoricalP,
): { m: PreparedModel; diagnostics: Diagnostic[] } | { fail: AnalysisResult } {
  const m = prepareModel(input, {
    outcomes,
    predictors,
    categorical: p.categorical,
    referenceRule: p.referenceRule,
    referenceLevels: p.referenceLevels,
    interactions: p.interactions,
  })
  if ('error' in m) return { fail: failure(m.error, [...exclusionNotes(input), ...m.diagnostics]) }
  return { m, diagnostics: [...exclusionNotes(input), ...m.diagnostics] }
}

/** Whether a model needs term tests: a categorical variable or an interaction. */
export const hasTerms = (m: PreparedModel) =>
  m.predictors.some((p) => p.categorical) || m.terms.some((t) => t.length > 1)

/** Columns of X (rows) restricted to `cols`. */
export const subset = (X: readonly (readonly number[])[], cols: readonly number[]) =>
  X.map((r) => cols.map((j) => r[j]!))

/** The coefficients' fields shown in a coefficient table. */
type Coefficient = Pick<
  RegCoefficient,
  'name' | 'estimate' | 'se' | 'lower' | 'upper' | 'stat' | 'p'
>

export function coefRows<C extends Coefficient>(
  coefs: readonly C[],
  level: number,
  extra: (c: C, i: number) => ResultValue[] = () => [],
): ResultValue[][] {
  return coefs.map((c, i) => [
    text(c.name),
    num(c.estimate),
    num(c.se),
    interval(c.lower, c.upper, level),
    num(Math.abs(c.stat)),
    pval(c.p),
    psum(c.p),
    ...extra(c, i),
  ])
}

export const coefColumns = (stat: string, level: number, extra: string[] = []) => [
  'Variable',
  'Estimate',
  'Standard error',
  `${pct(level)} CI`,
  stat,
  'P value',
  'P value summary',
  ...extra,
]

/** Likelihood-ratio test of each variable or interaction (every level at once). */
export function lrTermBlock(tests: readonly TermTest[]): ResultBlock {
  return table(
    'Effect of each variable (likelihood ratio test)',
    ['Variable', 'Chi square', 'df', 'P value', 'P value summary', `Significant (P < ${ALPHA})?`],
    tests.map((t) => [
      text(t.name),
      num(t.stat),
      int(t.df),
      pval(t.p),
      psum(t.p),
      significant(t.p),
    ]),
  )
}

// ---------------------------------------------------------------------------------------------
// Multiple linear regression
// ---------------------------------------------------------------------------------------------

const MLRParams = z.object({
  /** Data set key of the dependent variable; '' = the first analyzed variable. */
  y: z.string().default(''),
  intercept: z.boolean().default(true),
  confidenceLevel,
  ...categoricalParams,
  ...predictionParams,
})
type MLRParams = z.infer<typeof MLRParams>

export const multipleRegressionDef: AnalysisDef<MLRParams> = {
  id: 'multipleRegression',
  version: 1,
  title: 'Multiple linear regression',
  category: 'Multiple variable analyses',
  description:
    'Fit Y as a linear combination of several predictor variables — continuous or categorical (text), with interactions — with parameter CIs, R², AICc, an ANOVA table (Type III), multicollinearity (VIF) and predicted Y.',
  accepts: ['multipleVariables'],
  inputs: { min: 2, max: 64 },
  params: MLRParams,
  form: [
    { path: ['y'], label: 'Dependent (Y) variable', kind: 'custom', component: 'dataset.pick' },
    INTERCEPT_FIELD,
    ...categoricalFields('y=0'),
    CONFIDENCE_FIELD,
    ...predictionFields('y=0', 'Y'),
  ],
  outputs: () => [
    {
      key: 'actualVsPredicted',
      graph: { id: 'avp', name: 'Actual vs. predicted', xTitle: 'Predicted Y', yTitle: 'Actual Y' },
      mark: 'points',
    },
  ],
  run(input, params) {
    const { outcome, predictors } = roles(input, [params.y])
    const prep = model(input, outcome, predictors, params)
    if ('fail' in prep) return prep.fail
    const { m, diagnostics } = prep
    const y = m.outcomes[0]!
    const X = m.design.X
    const names = m.design.names
    const n = y.length
    const p = names.length + (params.intercept ? 1 : 0)
    if (!names.length) return failure('No predictor is left in the model.', diagnostics)
    if (n <= p) return failure(`Need more than ${p} complete rows (have ${n}).`, diagnostics)
    const fit = (cols: number[]) =>
      multipleLinearRegression(
        y,
        subset(X, cols),
        cols.map((j) => names[j]!),
        { intercept: params.intercept, confLevel: params.confidenceLevel },
      )
    const res = multipleLinearRegression(y, X, names, {
      intercept: params.intercept,
      confLevel: params.confidenceLevel,
    })
    if (res.status === 'singular') {
      diagnostics.push({
        level: 'warning',
        message:
          'The predictors are collinear (one is a combination of others); some parameters can’t be estimated.',
      })
    }
    if (y.every((v) => v === y[0]))
      diagnostics.push({
        level: 'warning',
        message: `“${input[outcome[0]!]!.title}” has the same value in every row, so R² and the F test can’t be computed.`,
      })
    const high = res.coefficients.filter((c) => c.vif !== null && c.vif > 10)
    if (high.length) {
      diagnostics.push({
        level: 'info',
        message: `High multicollinearity (VIF > 10): ${high.map((c) => c.name).join(', ')}.`,
      })
    }
    const level = params.confidenceLevel
    const anova = linearAnovaTable(y, m.design, params.intercept, (cols) => fit(cols).ss)
    const dfRes = anova.residual.df
    const fText = (F: number, dfn: number) =>
      text(Number.isFinite(F) ? `F (${dfn}, ${dfRes}) = ${F.toPrecision(4)}` : '')
    const blocks: ResultBlock[] = [
      table(
        `Multiple linear regression: ${input[outcome[0]!]!.title}`,
        coefColumns('|t|', level, ['VIF']),
        coefRows(res.coefficients, level, (_, i) => {
          const v = res.coefficients[i]!.vif
          return [v === null ? text('') : num(v)]
        }),
      ),
      ...referenceNote(m),
      kv('Goodness of fit', [
        ['R squared', num(res.rSquared)],
        ['Adjusted R squared', num(res.adjRSquared)],
        ['Sy.x', num(res.syx)],
        ['Sum of squares', num(res.ss)],
        ['AICc', num(res.aicc)],
      ]),
      kv('Is the regression significant? (ANOVA)', [
        ['F', num(res.F)],
        ['DFn, DFd', text(`${res.dfn}, ${res.dfd}`)],
        ...pSig(res.p, 'Significant'),
      ]),
      table(
        'ANOVA table (Type III sums of squares)',
        ['Source of Variation', 'SS', 'DF', 'MS', 'F (DFn, DFd)', 'P value', 'P value summary'],
        [
          [
            text('Regression'),
            num(anova.model.ss),
            int(anova.model.df),
            num(anova.model.ms),
            fText(anova.model.F, anova.model.df),
            pval(anova.model.p),
            psum(anova.model.p),
          ],
          ...anova.terms.map((t) => [
            text(t.name),
            num(t.stat),
            int(t.df),
            num(t.ms!),
            fText(t.F!, t.df),
            pval(t.p),
            psum(t.p),
          ]),
          [
            text('Residual'),
            num(anova.residual.ss),
            int(anova.residual.df),
            num(anova.residual.ms),
            text(''),
            text(''),
            text(''),
          ],
          [
            text('Total'),
            num(anova.total.ss),
            int(anova.total.df),
            text(''),
            text(''),
            text(''),
            text(''),
          ],
        ],
      ),
      kv('Data analyzed', [
        ['Number of rows analyzed', int(n)],
        ['Number of parameters', int(p)],
        ['Degrees of freedom', int(res.df)],
      ]),
    ]
    const predicted = addPredictions(
      input,
      m,
      params,
      diagnostics,
      {
        coef: res.coefficients.map((c) => c.estimate),
        cov: res.covariance,
        intercept: params.intercept,
        confLevel: level,
        df: res.df,
      },
      input[outcome[0]!]!.title,
      'Y',
      { empty: 'No rows or points to interpolate.' },
    )
    return result({
      diagnostics,
      sheets: [resultsSheet(blocks), ...(predicted ? [predicted.sheet] : [])],
      values: { rSquared: num(res.rSquared), p: pval(res.p) },
      outputs: { actualVsPredicted: { title: 'Actual vs. predicted', x: res.fitted, y } },
      table: predicted?.table,
    })
  },
}

// ---------------------------------------------------------------------------------------------
// Logistic regression
// ---------------------------------------------------------------------------------------------

const LogisticParams = z.object({
  y: z.string().default(''),
  intercept: z.boolean().default(true),
  ciMethod: z.enum(['profile', 'wald']).default('profile'),
  cutoff: z.number().gt(0).lt(1).default(0.5),
  confidenceLevel,
  ...categoricalParams,
  ...predictionParams,
})
type LogisticParams = z.infer<typeof LogisticParams>

export const logisticRegressionDef: AnalysisDef<LogisticParams> = {
  id: 'logisticRegression',
  version: 1,
  title: 'Logistic regression',
  category: 'Multiple variable analyses',
  description:
    'Model the probability of a binary outcome (coded 0/1) from one or more predictors, continuous or categorical: odds ratios, likelihood-ratio tests, pseudo R², Hosmer-Lemeshow, ROC area, predicted probabilities.',
  accepts: ['multipleVariables'],
  inputs: { min: 2, max: 64 },
  params: LogisticParams,
  form: [
    {
      path: ['y'],
      label: 'Outcome variable (0 = no, 1 = yes)',
      kind: 'custom',
      component: 'dataset.pick',
    },
    INTERCEPT_FIELD,
    ...categoricalFields('y=0'),
    {
      path: ['ciMethod'],
      label: 'Confidence intervals',
      kind: 'radio',
      options: [
        { value: 'profile', label: 'Profile likelihood (recommended)' },
        { value: 'wald', label: 'Wald' },
      ],
    },
    {
      path: ['cutoff'],
      label: 'Classification cutoff',
      kind: 'number',
      min: 0.01,
      max: 0.99,
      step: 0.05,
    },
    CONFIDENCE_FIELD,
    ...predictionFields('y=0', 'the probability'),
  ],
  outputs: (keys) =>
    keys.length === 2
      ? [
          {
            key: 'data',
            graph: {
              id: 'logistic',
              name: 'Logistic curve',
              yTitle: 'Probability',
              yRange: [0, 1],
            },
            mark: 'points',
          },
          { key: 'curve', graph: { id: 'logistic', name: 'Logistic curve' } },
        ]
      : [],
  run(input, params) {
    const { outcome, predictors } = roles(input, [params.y])
    const prep = model(input, outcome, predictors, params)
    if ('fail' in prep) return prep.fail
    const { m, diagnostics } = prep
    const y = m.outcomes[0]!
    const X = m.design.X
    const names = m.design.names
    const yName = input[outcome[0]!]!.title
    if (y.some((v) => v !== 0 && v !== 1))
      return failure(`The outcome “${yName}” must be coded 0 or 1.`, diagnostics)
    if (!names.length) return failure('No predictor is left in the model.', diagnostics)
    const nParams = names.length + (params.intercept ? 1 : 0)
    if (y.length <= nParams)
      return failure(`Need more than ${nParams} complete rows (have ${y.length}).`, diagnostics)
    if (y.every((v) => v === y[0]))
      return failure(
        `The outcome has only one value: every “${yName}” is ${y[0]}. Logistic regression needs both 0s and 1s.`,
        diagnostics,
      )
    const level = params.confidenceLevel
    const res = logisticRegression(y, X, names, {
      intercept: params.intercept,
      confLevel: level,
      ciMethod: params.ciMethod,
      cutoff: params.cutoff,
    })
    const STATUS: Record<string, string> = {
      separation:
        'The outcome is perfectly (or nearly) predicted by the predictors (separation); estimates are unreliable.',
      notConverged: 'The fit did not converge.',
      singular: 'The predictors are collinear; some parameters can’t be estimated.',
    }
    if (res.status !== 'ok') diagnostics.push({ level: 'warning', message: STATUS[res.status]! })
    const pure = constantOutcomeLevels(m, y, (v) => v.every((x) => x === v[0]))
    if (pure.length)
      diagnostics.push({
        level: 'warning',
        message: `Every row with ${pure.join(', with ')} has the same outcome (separation): the odds ratio of such a level is infinite or zero.`,
      })
    const c = res.classification
    const blocks: ResultBlock[] = [
      table(
        `Logistic regression: ${yName}`,
        coefColumns('|z|', level, ['Odds ratio', `${pct(level)} CI of odds ratio`]),
        coefRows(res.coefficients, level, (_, i) => {
          const k = res.coefficients[i]!
          return [num(k.oddsRatio), interval(k.orLower, k.orUpper, level)]
        }),
      ),
      ...referenceNote(m),
      kv('Likelihood ratio test (vs. intercept-only model)', [
        ['Chi square', num(res.lrChiSq)],
        ['df', int(res.lrDf)],
        ...pSig(res.lrP),
      ]),
    ]
    if (hasTerms(m) && res.status !== 'separation')
      blocks.push(
        lrTermBlock(
          likelihoodRatioTerms(
            m.design,
            params.intercept,
            (cols) =>
              logisticRegression(
                y,
                subset(X, cols),
                cols.map((j) => names[j]!),
                { intercept: params.intercept, ciMethod: 'wald' },
              ).logLik,
          ),
        ),
      )
    blocks.push(
      kv('Goodness of fit', [
        ['Tjur’s R squared', num(res.pseudoR2.tjur)],
        ['McFadden’s R squared', num(res.pseudoR2.mcFadden)],
        ['Cox-Snell R squared', num(res.pseudoR2.coxSnell)],
        ['Nagelkerke R squared', num(res.pseudoR2.nagelkerke)],
        ['AICc', num(res.aicc)],
        ['Log likelihood', num(res.logLik)],
        ...(res.hosmerLemeshow
          ? ([
              ['Hosmer-Lemeshow chi square', num(res.hosmerLemeshow.chiSq)],
              ['Hosmer-Lemeshow P value', pval(res.hosmerLemeshow.p)],
            ] as [string, ResultValue][])
          : []),
      ]),
      kv('Area under the ROC curve', [
        ['Area', num(res.auc.value)],
        ['Standard error', num(res.auc.se)],
        [`${pct(level)} CI`, interval(res.auc.lower, res.auc.upper, level)],
        ['P value', pval(res.auc.p)],
      ]),
      table(
        `Classification (cutoff ${c.cutoff})`,
        ['', 'Predicted 0', 'Predicted 1', 'Total'],
        [
          [text('Observed 0'), int(c.tn), int(c.fp), int(c.tn + c.fp)],
          [text('Observed 1'), int(c.fn), int(c.tp), int(c.fn + c.tp)],
        ],
      ),
      kv('Classification summary', [
        ['Positive predictive power', num(c.positivePredictivePower)],
        ['Negative predictive power', num(c.negativePredictivePower)],
        ['Fraction classified correctly', num(c.fractionCorrect)],
      ]),
      kv('Data analyzed', [
        ['Number of rows analyzed', int(res.n)],
        ['Number of 1s (events)', int(res.nEvents)],
        ['Number of 0s', int(res.n - res.nEvents)],
      ]),
    )
    const outputs: AnalysisResult['outputs'] = {}
    if (names.length === 1 && !m.predictors[0]!.categorical) {
      const x = X.map((r) => r[0]!)
      const [lo, hi] = valueRange(x)
      const [b0, b1] = params.intercept
        ? [res.coefficients[0]!.estimate, res.coefficients[1]!.estimate]
        : [0, res.coefficients[0]!.estimate]
      const cx = [...curveXs(lo, hi)]
      outputs.data = { title: yName, x, y }
      outputs.curve = {
        title: 'Fitted probability',
        x: cx,
        y: cx.map((v) => 1 / (1 + Math.exp(-(b0 + b1 * v)))),
      }
    }
    const usable = res.status === 'ok' || res.status === 'singular'
    const predicted = addPredictions(
      input,
      m,
      params,
      diagnostics,
      usable
        ? {
            coef: res.coefficients.map((k) => k.estimate),
            cov: res.covariance,
            intercept: params.intercept,
            confLevel: level,
            inverse: expit,
          }
        : null,
      yName,
      'probability',
      { unusable: 'No predictions: the fit has no estimates.' },
    )
    return result({
      diagnostics,
      sheets: [resultsSheet(blocks), ...(predicted ? [predicted.sheet] : [])],
      values: { p: pval(res.lrP), auc: num(res.auc.value) },
      outputs,
      table: predicted?.table,
    })
  },
}

// ---------------------------------------------------------------------------------------------
// Cox proportional hazards regression
// ---------------------------------------------------------------------------------------------

const CoxParams = z.object({
  time: z.string().default(''),
  event: z.string().default(''),
  ties: z.enum(['efron', 'breslow']).default('efron'),
  ciMethod: z.enum(['profile', 'wald']).default('profile'),
  confidenceLevel,
  ...categoricalParams,
  /**
   * Estimated survival curves (Prism's Graphs tab): each curve gives predictor values by data
   * set key — a number, or a level of a categorical predictor; numeric predictors not given are
   * 0 and categorical ones take their reference level.
   */
  survivalCurves: z.array(z.record(z.string(), z.union([z.number(), z.string()]))).default([]),
  /** The baseline functions sheet and the baseline survival curve (every predictor 0). */
  baseline: z.boolean().default(false),
})
type CoxParams = z.infer<typeof CoxParams>

const COX_GRAPH = {
  id: 'coxSurvival',
  name: 'Estimated survival',
  xTitle: 'Time',
  yTitle: 'Probability of survival',
  yRange: [0, 1] as [number, number],
}

/** A survival curve as a step function from time 0 (or the first time) to the last follow-up. */
function steps(times: readonly number[], surv: readonly number[], start: number, end: number) {
  const x = [start]
  const y = [1]
  let prev = 1
  times.forEach((t, k) => {
    x.push(t, t)
    y.push(prev, surv[k]!)
    prev = surv[k]!
  })
  if (end > (times.at(-1) ?? start)) {
    x.push(end)
    y.push(prev)
  }
  return { x, y }
}

export const coxRegressionDef: AnalysisDef<CoxParams> = {
  id: 'coxRegression',
  version: 1,
  title: 'Cox proportional hazards regression',
  category: 'Multiple variable analyses',
  description:
    'Model how predictors (continuous or categorical) change the hazard of an event over time (hazard ratios), from a time variable and an event variable (1 = event, 0 = censored).',
  accepts: ['multipleVariables'],
  inputs: { min: 3, max: 64 },
  params: CoxParams,
  form: [
    { path: ['time'], label: 'Elapsed time variable', kind: 'custom', component: 'dataset.pick' },
    {
      path: ['event'],
      label: 'Event variable (1 = event, 0 = censored)',
      kind: 'custom',
      component: 'dataset.pick:1',
    },
    ...categoricalFields('time=0,event=1'),
    {
      path: ['ties'],
      label: 'Tied times',
      kind: 'radio',
      options: [
        { value: 'efron', label: 'Efron (recommended)' },
        { value: 'breslow', label: 'Breslow' },
      ],
    },
    {
      path: ['ciMethod'],
      label: 'Confidence intervals',
      kind: 'radio',
      options: [
        { value: 'profile', label: 'Profile likelihood (recommended)' },
        { value: 'wald', label: 'Wald' },
      ],
    },
    CONFIDENCE_FIELD,
    {
      path: ['survivalCurves'],
      label: 'Estimated survival curves for these predictor values',
      kind: 'custom',
      component: 'mv.predictions:time=0,event=1',
    },
    {
      path: ['baseline'],
      label: 'Baseline survival (every predictor 0) and baseline functions',
      kind: 'checkbox',
    },
  ],
  outputs: (_keys, params) => [
    ...params.survivalCurves.map((_, i) => ({ key: `survival:${i}`, graph: COX_GRAPH })),
    ...(params.baseline ? [{ key: 'survival:baseline', graph: COX_GRAPH }] : []),
  ],
  run(input, params) {
    const ti = pick(input, params.time)
    const ei = pick(input, params.event, 1)
    if (ti === ei) return failure('Choose different variables for time and event.')
    const { predictors } = roles(input, [input[ti]!.ref.key, input[ei]!.ref.key])
    if (!predictors.length) return failure('Choose at least one predictor variable.')
    const prep = model(input, [ti, ei], predictors, params)
    if ('fail' in prep) return prep.fail
    const { m, diagnostics } = prep
    const [time, event] = m.outcomes as [number[], number[]]
    const X = m.design.X
    const names = m.design.names
    if (event.some((v) => v !== 0 && v !== 1))
      return failure(
        `The event variable “${input[ei]!.title}” must be coded 1 (event) or 0.`,
        diagnostics,
      )
    if (time.some((v) => v < 0)) return failure('Times must not be negative.', diagnostics)
    if (!names.length) return failure('No predictor is left in the model.', diagnostics)
    if (time.length <= names.length)
      return failure(
        `Need more than ${names.length} complete rows (have ${time.length}).`,
        diagnostics,
      )
    if (!event.includes(1))
      return failure('No events: every subject is censored (event = 0).', diagnostics)
    const level = params.confidenceLevel
    const died = event.map((v) => v === 1)
    const res = coxRegression(time, died, X, names, {
      ties: params.ties,
      confLevel: level,
      ciMethod: params.ciMethod,
    })
    if (res.status !== 'ok') {
      diagnostics.push({
        level: 'warning',
        message:
          res.status === 'infinite'
            ? 'Some hazard ratios are infinite (a predictor perfectly separates events); estimates are unreliable.'
            : res.status === 'singular'
              ? 'The predictors are collinear; some parameters can’t be estimated.'
              : 'The fit did not converge.',
      })
    }
    const noEvents = constantOutcomeLevels(m, event, (v) => v.every((x) => x === 0))
    if (noEvents.length)
      diagnostics.push({
        level: 'warning',
        message: `No events among the rows with ${noEvents.join(', or with ')}: the hazard ratio of such a level is zero or infinite.`,
      })
    const test = (t: { chiSq: number; df: number; p: number }): [string, ResultValue][] => [
      ['Chi square', num(t.chiSq)],
      ['df', int(t.df)],
      ...pSig(t.p),
    ]
    const blocks: ResultBlock[] = [
      table(
        'Cox proportional hazards regression',
        coefColumns('|z|', level, ['Hazard ratio', `${pct(level)} CI of hazard ratio`]),
        coefRows(res.coefficients, level, (_, i) => {
          const k = res.coefficients[i]!
          return [num(k.hazardRatio), interval(k.hrLower, k.hrUpper, level)]
        }),
      ),
      ...referenceNote(m),
      kv('Likelihood ratio test', test(res.lrTest)),
      kv('Wald test', test(res.waldTest)),
      kv('Score (log-rank) test', test(res.scoreTest)),
    ]
    if (hasTerms(m) && res.status !== 'infinite')
      blocks.push(
        lrTermBlock(
          likelihoodRatioTerms(m.design, true, (cols) =>
            cols.length
              ? coxRegression(
                  time,
                  died,
                  subset(X, cols),
                  cols.map((j) => names[j]!),
                  { ties: params.ties, ciMethod: 'wald' },
                ).logLik
              : res.nullLogLik,
          ),
        ),
      )
    blocks.push(
      kv('Model', [
        ['Log likelihood', num(res.logLik)],
        ...(res.concordance === null
          ? []
          : ([['Concordance', num(res.concordance)]] as [string, ResultValue][])),
        ['Number of subjects', int(res.n)],
        ['Number of events', int(res.nEvents)],
      ]),
    )
    const sheets: ResultSheet[] = [resultsSheet(blocks)]
    const outputs: AnalysisResult['outputs'] = {}
    const usable = res.status === 'ok' || res.status === 'singular'
    if (usable && (params.survivalCurves.length || params.baseline)) {
      const beta = res.coefficients.map((c) => c.estimate)
      const base = coxBaseline(time, died, X, beta)
      const start = Math.min(0, minOf(time))
      const end = maxOf(time)
      params.survivalCurves.forEach((values, i) => {
        const given: string[] = []
        let bad = false
        const x = designRow(
          m.designVars,
          m.terms,
          m.predictors.map((p) => {
            const v = values[p.key]
            if (v !== undefined && v !== '') given.push(`${p.title} = ${v}`)
            if (!p.categorical) {
              const num = v === undefined || v === '' ? 0 : Number(v)
              if (!Number.isFinite(num)) bad = true
              return num
            }
            const l = v === undefined || v === '' ? p.reference : p.levels.indexOf(String(v))
            if (l < 0) bad = true
            return { level: l }
          }),
        )
        if (bad) {
          diagnostics.push({
            level: 'warning',
            message: `Survival curve ${i + 1} has a value the model doesn’t know; it was not drawn.`,
          })
          return
        }
        outputs[`survival:${i}`] = {
          title: given.length ? given.join(', ') : 'Every predictor 0',
          ...steps(base.time, coxSurvivalAt(base, beta, x), start, end),
        }
      })
      if (params.baseline) {
        outputs['survival:baseline'] = {
          title: 'Baseline (every predictor 0)',
          ...steps(base.time, base.survival, start, end),
        }
        sheets.push({
          key: 'baseline',
          title: 'Baseline functions',
          blocks: [
            table(
              'Baseline functions (every predictor 0; Kalbfleisch-Prentice)',
              [
                'Time',
                'Number at risk',
                'Number of events',
                'Alpha',
                'Baseline cumulative survival',
                'Baseline cumulative hazard',
              ],
              base.time.map((t, k) => [
                num(t),
                int(base.atRisk[k]!),
                int(base.events[k]!),
                num(base.alpha[k]!),
                num(base.survival[k]!),
                num(base.cumHazard[k]!),
              ]),
            ),
          ],
        })
      }
    }
    return result({ diagnostics, sheets, values: { p: pval(res.lrTest.p) }, outputs })
  },
}
