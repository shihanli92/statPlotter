import type { GuideAsk, GuideEntry, GuideStep } from '@ps/model'
import { answer, fixed, leaf, question } from './build.ts'

// Roadmap 51a: survival tables and multiple-variables tables (design §3.5, "Survival" and
// "Relationships and regression"). The survival questions of the design (trend, pairs, early
// weighting, the reference group) need 51c's params; until then the survival results list every
// test, and the reason says to read the one planned.

const SURVIVAL_REASON =
  'Kaplan-Meier shows the curves; the log-rank test compares them over the whole follow-up. The results list other tests too: read the one you planned.'

const variable = (id: string, label: string, pick: 'numbers' | 'binary' | 'any'): GuideAsk => ({
  id,
  kind: 'group',
  label,
  initial: (f) =>
    (pick === 'binary'
      ? (f.variables?.binary[0] ?? f.variables?.numbers[0])
      : (f.variables?.numbers[0] ?? f.variables?.binary[0])
    )?.key ?? '',
})

const outcomeAnswer = (
  id: string,
  text: string,
  analysisId: string,
  reason: string,
  pick: 'numbers' | 'binary',
) =>
  answer(
    id,
    text,
    leaf(
      analysisId,
      (_f, a) => ({
        y: a.outcome ?? '',
        ...(analysisId === 'logisticRegression' ? { ciMethod: 'profile' } : {}),
      }),
      reason,
    ),
    { asks: [variable('outcome', 'Outcome variable', pick)] },
  )

const predict: GuideStep = question(
  'outcomeKind',
  'What kind of outcome do you want to predict?',
  'The kind of outcome decides the model; the other variables chosen are the predictors.',
  [
    outcomeAnswer(
      'measurement',
      'A measurement (blood pressure, weight)',
      'multipleRegression',
      'Multiple regression: how the outcome changes with each predictor, the others held fixed.',
      'numbers',
    ),
    outcomeAnswer(
      'yesNo',
      'Yes/no, coded 0 and 1 (responded, died)',
      'logisticRegression',
      'Logistic regression: how each predictor changes the odds of “yes”, the others held fixed.',
      'binary',
    ),
    outcomeAnswer(
      'count',
      'A count (colonies, events)',
      'poissonRegression',
      'Poisson regression: how each predictor changes the rate of the counted event.',
      'numbers',
    ),
    answer(
      'time',
      'Time to an event, with censoring',
      leaf(
        'coxRegression',
        (_f, a) => ({ time: a.time ?? '', event: a.event ?? '' }),
        'Cox regression: how each predictor changes the hazard of the event, from time and event variables.',
      ),
      {
        asks: [
          variable('time', 'Time variable', 'numbers'),
          variable('event', 'Event variable (1 = event, 0 = censored)', 'binary'),
        ],
      },
    ),
  ],
)

export const SURVIVAL_ENTRIES: readonly GuideEntry[] = [
  {
    id: 'curvesDiffer',
    question: 'Do the survival curves differ?',
    kinds: ['survival'],
    keywords: [
      'survival',
      'kaplan meier',
      'log-rank',
      'hazard ratio',
      'time to event',
      'mortality',
    ],
    start: leaf('survival', fixed({}), SURVIVAL_REASON),
  },
  {
    id: 'medianSurvival',
    question: 'Median survival in each group',
    kinds: ['survival'],
    keywords: ['median survival', 'kaplan meier'],
    start: leaf(
      'survival',
      fixed({}),
      'Kaplan-Meier curves give each group’s median survival with its CI (undefined while more than half are event-free).',
    ),
  },
]

export const VARIABLE_ENTRIES: readonly GuideEntry[] = [
  {
    id: 'predictOutcome',
    question: 'Predict an outcome from several variables',
    kinds: ['multipleVariables'],
    keywords: [
      'multiple regression',
      'logistic regression',
      'poisson',
      'predictors',
      'covariates',
      'adjust for',
    ],
    start: predict,
  },
  {
    id: 'factorsAffect',
    question: 'Which factors affect the response?',
    kinds: ['multipleVariables'],
    keywords: ['multifactor anova', 'factors', 'anova', 'n-way'],
    start: leaf(
      'multifactorAnova',
      (f) => ({
        y: f.variables?.numbers[0]?.key ?? '',
        factors: (f.variables?.texts ?? []).map((v) => v.key),
      }),
      'Multifactor ANOVA tests each factor (the text variables chosen) and their interactions on the response.',
    ),
  },
  {
    id: 'pca',
    question: 'Summarize many variables (PCA)',
    kinds: ['multipleVariables'],
    keywords: [
      'pca',
      'principal components',
      'dimension reduction',
      'clusters',
      'scores',
      'loadings',
    ],
    start: leaf(
      'pca',
      fixed({ standardize: true, select: 'parallel' }),
      'PCA finds the combinations of variables that explain most of their variation; parallel analysis keeps those above noise.',
    ),
  },
  {
    id: 'coxCovariates',
    question: 'Time to event with covariates',
    kinds: ['multipleVariables'],
    keywords: ['cox', 'hazard', 'survival', 'covariates', 'time to event'],
    start: leaf(
      'coxRegression',
      (f) => ({
        time: f.variables?.numbers[0]?.key ?? '',
        event: f.variables?.binary[0]?.key ?? '',
      }),
      'Cox regression: how each covariate changes the hazard of the event; choose the time and event variables.',
    ),
  },
  {
    id: 'kmFromRows',
    question: 'Kaplan-Meier from one row per subject',
    kinds: ['multipleVariables'],
    keywords: ['kaplan meier', 'survival', 'log-rank', 'one row per subject'],
    start: leaf(
      'survivalFromVariables',
      (f) => ({
        time: f.variables?.numbers[0]?.key ?? '',
        status: f.variables?.binary[0]?.key ?? '',
      }),
      'Kaplan-Meier curves from a time and a status variable, one curve per group of a grouping variable.',
    ),
  },
  {
    id: 'curvePerGroup',
    question: 'Fit a curve per group',
    kinds: ['multipleVariables'],
    keywords: ['curve fit', 'nonlinear', 'per group', 'dose response'],
    start: leaf(
      'nonlinearFitMV',
      (f) => ({
        x: f.variables?.numbers[0]?.key ?? '',
        y: f.variables?.numbers[1]?.key ?? '',
        group: f.variables?.texts[0]?.key ?? '',
      }),
      'One curve of Y against X per value of a grouping variable; choose the model in the options.',
    ),
  },
]
