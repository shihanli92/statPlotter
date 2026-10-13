import type { GuideEntry } from '@ps/model'
import { alt, answer, fixed, leaf, needsRaw, question } from './build.ts'

// Roadmap 51a: describing, checking, agreement, diagnosis and planning on column tables (design
// §3.5, "Describe, check, explore, plan").

export const DESCRIBE_ENTRIES: readonly GuideEntry[] = [
  {
    id: 'describe',
    question: 'Describe each group',
    kinds: ['column'],
    keywords: ['mean', 'sd', 'sem', 'median', 'summary', 'describe', 'quartiles'],
    draws: { layout: 'groups', measure: 'summary', comparisons: 'none' },
    start: leaf(
      'descriptive',
      fixed({ quartiles: true, ci: true }),
      'Mean, SD, SEM, median, quartiles and the CI of the mean for each group.',
      [alt('frequencyDistribution', fixed({}), 'you want a histogram of many values')],
    ),
  },
  {
    id: 'normalOdd',
    question: 'Is it normal, and are there odd values?',
    kinds: ['column'],
    keywords: [
      'normality',
      'normal distribution',
      'gaussian',
      'qq plot',
      'outliers',
      'grubbs',
      'rout',
    ],
    draws: { layout: 'groups', comparisons: 'none' },
    start: question(
      'look',
      'What do you want to look at?',
      'Neither should choose your test: the design of the experiment does.',
      [
        answer(
          'shape',
          'The shape of the distribution',
          leaf(
            'normality',
            fixed({
              dagostino: false,
              andersonDarling: false,
              shapiroWilk: true,
              kolmogorovSmirnov: false,
              qqPlot: true,
            }),
            'The QQ plot shows how values depart from normal; with few values the Shapiro-Wilk test has little power.',
          ),
          { unavailable: needsRaw },
        ),
        answer(
          'outliers',
          'Values far from the rest',
          leaf(
            'identifyOutliers',
            fixed({ method: 'rout', q: 1 }),
            'The ROUT method flags outliers. Remove a value only with a known cause, and report results with and without it.',
          ),
          { unavailable: needsRaw },
        ),
      ],
      { draws: { shape: { measure: 'shape' }, outliers: { measure: 'outliers' } } },
    ),
  },
  {
    id: 'methodsAgree',
    question: 'Do two methods agree?',
    kinds: ['column'],
    keywords: ['bland altman', 'agreement', 'method comparison', 'bias', 'limits of agreement'],
    draws: { layout: 'pair', measure: 'agreement', comparisons: 'together' },
    start: leaf(
      'blandAltman',
      fixed({ measure: 'difference', order: 'bMinusA' }),
      'Bland-Altman gives the bias and the limits of agreement between the methods, in your units.',
    ),
  },
  {
    id: 'roc',
    question: 'Can this measurement tell patients from controls?',
    kinds: ['column'],
    keywords: ['roc', 'auc', 'sensitivity', 'specificity', 'cutoff', 'biomarker', 'diagnostic'],
    draws: { layout: 'pair', measure: 'separation', comparisons: 'pair' },
    start: question(
      'direction',
      'Do patients have higher or lower values than controls?',
      'Say it from what you know about the marker: deciding from the data overstates a weak one.',
      [
        answer(
          'higher',
          'Higher',
          leaf(
            'roc',
            fixed({ direction: 'higher' }),
            'The ROC curve shows how well the value separates the groups at every cutoff; the first column is read as the controls.',
          ),
        ),
        answer(
          'lower',
          'Lower',
          leaf(
            'roc',
            fixed({ direction: 'lower' }),
            'The ROC curve shows how well the value separates the groups at every cutoff; the first column is read as the controls.',
          ),
        ),
      ],
      { draws: { higher: { direction: 'increase' }, lower: { direction: 'decrease' } } },
    ),
  },
  {
    id: 'plan',
    question: 'Plan an experiment: how many subjects?',
    kinds: ['column'],
    keywords: ['sample size', 'power', 'how many animals', 'plan'],
    draws: { layout: 'none', measure: 'plan' },
    start: leaf(
      'powerAnalysis',
      fixed({}),
      'Uses the smallest difference that matters biologically, not a pilot’s estimate (pilot effects are usually too large).',
    ),
  },
]
