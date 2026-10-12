import type { GuideAnswers, GuideEntry, GuideStep, TableFacts } from '@ps/model'
import { alt, answer, elsewhere, fixed, leaf, question } from './build.ts'

// Roadmap 51a: counts and proportions (design §3.5, "Counts and proportions"): contingency and
// parts-of-whole tables. The roles of a 2 × 2 (which row is exposed, which column the outcome)
// arrive with 51c's params; until then the first row and the first column are read as such.

const twoByTwo = (f: TableFacts) =>
  f.contingency
    ? f.contingency.rows === 2 && f.contingency.columns === 2
      ? 'twoByTwo'
      : 'larger'
    : null

const pairwiseParams = (f: TableFacts, a: GuideAnswers) => ({
  test: (f.contingency?.minExpected ?? 0) >= 5 ? 'chiSquare' : 'fisher',
  trend: false,
  pairwise: a.which === 'pairs' ? 'all' : 'none',
  pairwiseMethod: 'bonferroni',
})

const larger: GuideStep = question(
  'ordered',
  'Are the rows in a meaningful order (doses, ages)?',
  'A trend test uses the order; without one, the rows are just groups.',
  [
    answer(
      'yes',
      'Yes, and the outcome has two columns',
      leaf(
        'contingency',
        fixed({ test: 'chiSquare', trend: true }),
        'The chi-square test for trend asks whether the proportion changes steadily across the ordered rows.',
      ),
      {
        unavailable: (f) =>
          f.contingency && f.contingency.columns !== 2
            ? 'A trend needs two outcome columns.'
            : null,
      },
    ),
    answer(
      'no',
      'No',
      question(
        'which',
        'Do you want to know which groups (rows) differ?',
        'Each pair of rows is then tested, adjusted for the number of pairs.',
        [
          answer(
            'overall',
            'Only whether the outcome is related to the group',
            leaf(
              'contingency',
              pairwiseParams,
              'Chi-square works when every expected count is at least 5; otherwise Fisher’s exact test is used.',
            ),
          ),
          answer(
            'pairs',
            'Also which pairs of rows differ',
            leaf(
              'contingency',
              pairwiseParams,
              'The overall test, then each pair of rows, with Bonferroni’s adjustment (the pairs share rows).',
            ),
          ),
        ],
      ),
    ),
  ],
)

const outcomeGroup: GuideStep = question(
  'paired',
  'Were the same subjects counted twice (before and after, paired yes/no)?',
  'Paired yes/no data need a different test from independent groups.',
  [
    answer(
      'yes',
      'Yes',
      elsewhere(null, 'Paired yes/no data need McNemar’s test, which isn’t available yet.'),
    ),
    answer(
      'no',
      'No, each subject is counted once',
      question(
        'size',
        'Is the table 2 × 2?',
        'Counted from the table.',
        [
          answer(
            'twoByTwo',
            '2 × 2: two groups, two outcomes',
            question(
              'report',
              'What do you want to report?',
              'The design decides: risks need groups followed forward; case-control studies give odds.',
              [
                answer(
                  'risk',
                  'The risk in each group (a trial or cohort)',
                  leaf(
                    'contingency',
                    fixed({ test: 'fisher', trend: false, riskEstimates: true, oddsRatio: false }),
                    'Fisher’s exact test is exact for any sample size; report the relative risk with its CI (first row against second, first column the outcome).',
                    [
                      alt(
                        'contingency',
                        fixed({ test: 'chiSquare', trend: false }),
                        'large counts (chi-square)',
                      ),
                    ],
                  ),
                ),
                answer(
                  'odds',
                  'The odds (a case-control study)',
                  leaf(
                    'contingency',
                    fixed({ test: 'fisher', trend: false, riskEstimates: false, oddsRatio: true }),
                    'Fisher’s exact test is exact for any sample size; report the odds ratio with its CI.',
                  ),
                ),
              ],
            ),
          ),
          answer('larger', 'Larger', larger),
        ],
        { answeredBy: twoByTwo },
      ),
    ),
  ],
)

export const COUNT_ENTRIES: readonly GuideEntry[] = [
  {
    id: 'outcomeGroup',
    question: 'Is the outcome related to the group?',
    kinds: ['contingency'],
    keywords: [
      'chi-square',
      'fisher',
      'relative risk',
      'odds ratio',
      'proportions',
      'counts',
      'association',
    ],
    start: outcomeGroup,
  },
  {
    id: 'trendCounts',
    question: 'Is there a trend across ordered groups (counts)?',
    kinds: ['contingency'],
    keywords: ['trend', 'chi-square for trend', 'dose', 'ordered'],
    start: leaf(
      'contingency',
      fixed({ test: 'chiSquare', trend: true }),
      'The chi-square test for trend asks whether the proportion changes steadily across the ordered rows.',
    ),
  },
  {
    id: 'diagnosticTest',
    question: 'How good is a diagnostic test?',
    kinds: ['contingency'],
    keywords: ['sensitivity', 'specificity', 'predictive value', 'diagnostic', 'roc'],
    start: question(
      'result',
      'Is the test a yes/no result or a measurement?',
      'A yes/no result is a 2 × 2 table; a measurement needs a curve of cutoffs.',
      [
        answer(
          'yesNo',
          'A yes/no result (a 2 × 2 of test against the truth)',
          leaf(
            'contingency',
            fixed({ test: 'fisher', diagnostic: true, trend: false }),
            'Sensitivity, specificity and predictive values, with rows the truth and columns the test result.',
          ),
        ),
        answer(
          'measurement',
          'A measurement',
          elsewhere(
            'column',
            'A measurement’s ROC curve needs a column table: the values of controls and of patients.',
          ),
        ),
      ],
    ),
  },
  {
    id: 'expectedProportions',
    question: 'Do the counts match expected proportions?',
    kinds: ['partsOfWhole'],
    keywords: ['goodness of fit', 'expected', 'mendelian', '3:1', 'binomial', 'proportions'],
    start: leaf(
      'goodnessOfFit',
      fixed({}),
      'Compares your counts with the proportions you expect (e.g. 3 : 1); enter them in the options before you run it.',
    ),
  },
  {
    id: 'fractions',
    question: 'What fraction is each part?',
    kinds: ['partsOfWhole'],
    keywords: ['fraction', 'percentage', 'pie', 'share'],
    start: leaf(
      'fractionOfTotal',
      fixed({ display: 'percent' }),
      'Each value as a percentage of its column total.',
    ),
  },
]
