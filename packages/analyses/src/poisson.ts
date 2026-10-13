import type { AnalysisDef, NormalizedDataSet, Problem, ResultBlock } from '@ps/model'
import { likelihoodRatioTerms, poissonRegression } from '@ps/stats'
import { z } from 'zod'
import {
  CONFIDENCE_FIELD,
  confidenceLevel,
  failure,
  int,
  interval,
  kv,
  num,
  pct,
  problem,
  pSig,
  pval,
  result,
  resultsSheet,
  table,
} from './common.ts'
import { addPredictions } from './mvPredict.ts'
import {
  categoricalFields,
  categoricalParams,
  constantOutcomeLevels,
  predictionFields,
  predictionParams,
  referenceNote,
} from './mvVariables.ts'
import {
  coefColumns,
  coefRows,
  hasTerms,
  lrTermBlock,
  model,
  resultProblem,
  roles,
  subset,
} from './regression.ts'

// Poisson regression on a multiple-variables table (the multiple regression dialog with
// "Poisson" chosen): Y is a count, log E[Y] = β0 + Σβⱼ Xⱼ, fit by maximum likelihood.

const Params = z.object({
  /** Data set key of the count (Y) variable; '' = the first analyzed variable. */
  y: z.string().default(''),
  intercept: z.boolean().default(true),
  ciMethod: z.enum(['wald', 'profile']).default('wald'),
  confidenceLevel,
  ...categoricalParams,
  ...predictionParams,
})
type Params = z.infer<typeof Params>

export const poissonRegressionDef: AnalysisDef<Params> = {
  id: 'poissonRegression',
  version: 1,
  title: 'Poisson regression',
  category: 'Multiple variable analyses',
  description:
    'Model a count (the number of objects or events actually counted) from one or more predictors: coefficients and rate ratios, likelihood-ratio test, pseudo R², deviance and dispersion.',
  accepts: ['multipleVariables'],
  inputs: { min: 2, max: 64 },
  params: Params,
  form: [
    {
      path: ['y'],
      label: 'Dependent variable (counts)',
      kind: 'custom',
      component: 'dataset.pick',
    },
    {
      path: ['intercept'],
      label: 'Include an intercept (constant term)',
      kind: 'checkbox',
    },
    ...categoricalFields('y=0'),
    {
      path: ['ciMethod'],
      label: 'Confidence intervals',
      kind: 'radio',
      options: [
        { value: 'wald', label: 'Wald (estimate ± z·SE)' },
        { value: 'profile', label: 'Profile likelihood' },
      ],
    },
    CONFIDENCE_FIELD,
    ...predictionFields('y=0', 'the count'),
  ],
  outputs: () => [
    {
      key: 'actualVsPredicted',
      graph: {
        id: 'avp',
        name: 'Actual vs. predicted',
        xTitle: 'Predicted count',
        yTitle: 'Actual count',
      },
      mark: 'points',
    },
  ],
  validate: validatePoisson,
  run(input, params) {
    const { outcome, predictors } = roles(input, [params.y])
    if (!predictors.length) return failure('Choose at least one predictor variable.')
    const prep = model(input, outcome, predictors, params)
    if ('fail' in prep) return prep.fail
    const { m, diagnostics } = prep
    const yi = outcome[0]!
    const y = m.outcomes[0]!
    const X = m.design.X
    const names = m.design.names
    const yName = input[yi]!.title
    if (y.some((v) => !(Number.isInteger(v) && v >= 0)))
      return failure(
        `“${yName}” must hold counts (whole numbers, zero or more) for Poisson regression.`,
        diagnostics,
      )
    if (!names.length) return failure('No predictor is left in the model.', diagnostics)
    const k = names.length + (params.intercept ? 1 : 0)
    if (y.length <= k)
      return failure(`Need more than ${k} complete rows (have ${y.length}).`, diagnostics)
    if (y.every((v) => v === 0)) return failure(`Every “${yName}” is 0.`, diagnostics)
    const level = params.confidenceLevel
    const res = poissonRegression(y, X, names, {
      intercept: params.intercept,
      confLevel: level,
      ciMethod: params.ciMethod,
    })
    if (res.status === 'singular')
      diagnostics.push({
        level: 'warning',
        message: 'The predictors are collinear; some parameters can’t be estimated.',
      })
    else if (res.status === 'notConverged')
      diagnostics.push({ level: 'warning', message: 'The fit did not converge.' })
    const zeros = constantOutcomeLevels(m, y, (v) => v.every((x) => x === 0))
    if (zeros.length)
      diagnostics.push({
        level: 'warning',
        message: `Every count with ${zeros.join(', with ')} is 0: the rate ratio of such a level is zero (its estimate diverges).`,
      })
    if (res.dispersion > 2)
      diagnostics.push({
        level: 'info',
        message: `The dispersion ratio is ${res.dispersion.toPrecision(3)}: the counts vary more than a Poisson distribution allows (overdispersion), so SEs and P values are too small.`,
      })
    const blocks: ResultBlock[] = [
      table(
        `Poisson regression: ${yName}`,
        coefColumns('|Z|', level, ['Rate ratio', `${pct(level)} CI of rate ratio`]),
        coefRows(res.coefficients, level, (c) => [
          num(c.rateRatio),
          interval(c.rrLower, c.rrUpper, level),
        ]),
      ),
      ...referenceNote(m),
      kv('Likelihood ratio test (vs. the intercept-only model)', [
        ['Chi square', num(res.lrChiSq)],
        ['df', int(res.lrDf)],
        ...pSig(res.lrP, 'Significant'),
      ]),
      ...(hasTerms(m)
        ? [
            lrTermBlock(
              likelihoodRatioTerms(
                m.design,
                params.intercept,
                (cols) =>
                  poissonRegression(
                    y,
                    subset(X, cols),
                    cols.map((j) => names[j]!),
                    { intercept: params.intercept },
                  ).logLik,
              ),
            ),
          ]
        : []),
      kv('Goodness of fit', [
        ['Pseudo R squared', num(res.pseudoR2)],
        ['Deviance (G²)', num(res.deviance)],
        ['Dispersion ratio (φ)', num(res.dispersion)],
        ['Negative log likelihood', num(-res.logLik)],
        ['AICc', num(res.aicc)],
      ]),
      kv('Data analyzed', [
        ['Number of rows analyzed', int(res.n)],
        ['Number of parameters', int(k)],
      ]),
      {
        type: 'note',
        text: 'A rate ratio is the factor by which the expected count is multiplied when the variable increases by 1.',
      },
    ]
    const predicted = addPredictions(
      input,
      m,
      params,
      diagnostics,
      res.status === 'notConverged'
        ? null
        : {
            coef: res.coefficients.map((c) => c.estimate),
            cov: res.covariance,
            intercept: params.intercept,
            confLevel: level,
            inverse: Math.exp,
          },
      yName,
      'count',
    )
    return result({
      diagnostics,
      sheets: [resultsSheet(blocks), ...(predicted ? [predicted.sheet] : [])],
      values: { p: pval(res.lrP), pseudoR2: num(res.pseudoR2) },
      outputs: { actualVsPredicted: { title: 'Actual vs. predicted', x: res.fitted, y } },
      table: predicted?.table,
    })
  },
}

/** Roadmap 51b (§4.6): Poisson regression's problems before computing. */
function validatePoisson(input: readonly NormalizedDataSet[], params: Params): Problem | null {
  const { outcome, predictors } = roles(input, [params.y])
  if (!predictors.length) return problem('Choose at least one predictor variable.', 'params')
  const prep = model(input, outcome, predictors, params)
  if ('fail' in prep) return resultProblem(prep.fail)
  const { m, diagnostics } = prep
  const y = m.outcomes[0]!
  const yName = input[outcome[0]!]!.title
  if (y.some((v) => !(Number.isInteger(v) && v >= 0)))
    return problem(
      `“${yName}” must hold counts (whole numbers, zero or more) for Poisson regression.`,
      'table',
      diagnostics,
    )
  if (!m.design.names.length)
    return problem('No predictor is left in the model.', 'params', diagnostics)
  const k = m.design.names.length + (params.intercept ? 1 : 0)
  if (y.length <= k)
    return problem(`Need more than ${k} complete rows (have ${y.length}).`, 'table', diagnostics)
  if (y.every((v) => v === 0)) return problem(`Every “${yName}” is 0.`, 'table', diagnostics)
  return null
}
