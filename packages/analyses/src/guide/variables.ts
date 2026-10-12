import type { GuideAnswers, GuideAsk, GuideEntry, GuideStep, TableFacts } from '@ps/model'
import { answer, fixed, leaf, question } from './build.ts'

// Roadmap 51a: survival tables and multiple-variables tables (design §3.5, "Survival" and
// "Relationships and regression"). Roadmap 51c: the survival questions of the design — ordered
// groups (trend), which pairs differ (pairwise log-rank, Holm), early weighting (the one test
// chosen) and the reference group of the hazard ratio.

/** The survival analysis' params from the answers (`analysisId`: on a table or on variables). */
const survivalParams =
  (variables: boolean) =>
  (f: TableFacts, a: GuideAnswers): Record<string, unknown> => ({
    ...(variables
      ? {
          time: f.variables?.numbers[0]?.key ?? '',
          status: f.variables?.binary[0]?.key ?? '',
        }
      : { control: a.control ?? '' }),
    test: a.weight === 'early' ? 'gehanBreslowWilcoxon' : 'logRank',
    trend: a.ordered === 'yes',
    pairwise: a.which === 'pairs' ? 'all' : 'none',
    pairwiseMethod: 'holm',
    hazardRatio: 'mantelHaenszel',
  })

const SURVIVAL_REASON =
  'Kaplan-Meier shows the curves; the test you chose compares them, once (log-rank: the whole follow-up; Gehan-Breslow-Wilcoxon: early deaths weigh more).'

/** "Which matters most?": the one test, chosen before the results. */
const weightQ = (variables: boolean): GuideStep => {
  const then = leaf(
    variables ? 'survivalFromVariables' : 'survival',
    survivalParams(variables),
    SURVIVAL_REASON,
  )
  return question(
    'weight',
    'Which part of the follow-up matters most to your question?',
    'Decide before looking: one test answers it (reading two and keeping the smaller P is test shopping).',
    [
      answer('whole', 'The whole follow-up (the usual choice)', then),
      answer('early', 'Early differences, decided in advance', then),
    ],
  )
}

/** The reference group of the hazard ratio (survival tables). */
const ASK_REFERENCE: GuideAsk = {
  id: 'control',
  kind: 'group',
  label: 'Reference group (hazard ratio = group ÷ this one)',
  initial: (f) => f.groups[0]?.key ?? '',
}

/** "Do the survival curves differ?": counting the groups, then the design questions. */
const curvesDiffer = (variables: boolean): GuideStep => {
  const weight = weightQ(variables)
  const which = question(
    'which',
    'Do you want to know which groups differ?',
    'Each pair of curves is then compared on its own, adjusted for the number of pairs (Holm).',
    [
      answer('overall', 'Only whether any curves differ', weight),
      answer('pairs', 'Also which pairs of groups differ', weight),
    ],
  )
  const ordered = question(
    'ordered',
    'Are the groups ordered (doses, ages)?',
    'A trend test uses the order; for unordered groups (genotypes) its P means nothing.',
    [
      answer('yes', 'Yes: also test for a steady change with the order', weight),
      answer('no', 'No', which),
    ],
  )
  return question(
    'groups',
    'How many groups?',
    'Counted from the table.',
    [
      answer('two', 'Two', weight, variables ? {} : { asks: [ASK_REFERENCE] }),
      answer('more', 'Three or more', ordered, variables ? {} : { asks: [ASK_REFERENCE] }),
    ],
    {
      answeredBy: (f) =>
        variables ? null : f.groups.length === 2 ? 'two' : f.groups.length > 2 ? 'more' : null,
    },
  )
}

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
    start: curvesDiffer(false),
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
    start: question(
      'groups',
      'Are there three or more groups (from a grouping variable)?',
      'Choose the grouping variable in the options; the questions about the groups follow.',
      [
        answer('two', 'One or two groups', weightQ(true)),
        answer(
          'more',
          'Three or more',
          question(
            'ordered',
            'Are the groups ordered (doses, ages)?',
            'A trend test uses the order; for unordered groups (genotypes) its P means nothing.',
            [
              answer('yes', 'Yes: also test for a steady change with the order', weightQ(true)),
              answer(
                'no',
                'No',
                question(
                  'which',
                  'Do you want to know which groups differ?',
                  'Each pair of curves is then compared on its own, adjusted for the number of pairs (Holm).',
                  [
                    answer('overall', 'Only whether any curves differ', weightQ(true)),
                    answer('pairs', 'Also which pairs of groups differ', weightQ(true)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
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
