import type { GuideAnswers, GuideEntry, GuideStep, TableFacts } from '@ps/model'
import { alt, answer, elsewhere, fixed, leaf, question } from './build.ts'

// Roadmap 51a: counts and proportions (design §3.5, "Counts and proportions"): contingency and
// parts-of-whole tables. Roadmap 51c (S22): a 2 × 2's roles asked — which row is the treated or
// exposed group, which column the outcome — and the trend test only for ordered rows.

const twoByTwo = (f: TableFacts) =>
  f.contingency
    ? f.contingency.rows === 2 && f.contingency.columns === 2
      ? 'twoByTwo'
      : 'larger'
    : null

/** S22: a 2 × 2's roles from the answers (the first row and column unless said). */
const roles = (a: GuideAnswers) => ({
  exposedRow: a.exposed === 'second' ? 1 : 0,
  outcomeColumn: a.outcome === 'second' ? 1 : 0,
})

// Roadmap 51f: a table of counts' roles, for "What will be tested".
const EXPOSED_DRAWS = { first: { exposedRow: 0 }, second: { exposedRow: 1 } } as const
const OUTCOME_DRAWS = { first: { outcomeColumn: 0 }, second: { outcomeColumn: 1 } } as const

/** "Which row is the treated or exposed group?" then "Which column is the outcome?", then `then`. */
const rolesQ = (then: GuideStep): GuideStep =>
  question(
    'exposed',
    'Which row is the treated or exposed group?',
    'Relative risk = the risk of the outcome in this row ÷ the risk in the other: swapping them inverts it.',
    [
      answer(
        'first',
        'The first row',
        question(
          'outcome',
          'Which column is the outcome (Died, Responded)?',
          'The risk is the share of each row in this column.',
          [answer('first', 'The first column', then), answer('second', 'The second column', then)],
          { draws: OUTCOME_DRAWS },
        ),
      ),
      answer(
        'second',
        'The second row',
        question(
          'outcome',
          'Which column is the outcome (Died, Responded)?',
          'The risk is the share of each row in this column.',
          [answer('first', 'The first column', then), answer('second', 'The second column', then)],
          { draws: OUTCOME_DRAWS },
        ),
      ),
    ],
    { draws: EXPOSED_DRAWS },
  )

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
        {
          draws: {
            overall: { comparisons: 'none' },
            pairs: { comparisons: 'allPairs', correction: 'Bonferroni' },
          },
        },
      ),
    ),
  ],
  { draws: { yes: { comparisons: 'trend' } } },
)

const diagnosticLeaf = leaf(
  'contingency',
  (_f, a) => ({ test: 'fisher', diagnostic: true, trend: false, ...roles(a) }),
  'Sensitivity, specificity and predictive values: rows the truth (the condition’s row as chosen), columns the test result.',
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
                  rolesQ(
                    leaf(
                      'contingency',
                      (_f, a) => ({
                        test: 'fisher',
                        trend: false,
                        riskEstimates: true,
                        oddsRatio: false,
                        ...roles(a),
                      }),
                      'Fisher’s exact test is exact for any sample size; report the relative risk (the exposed row ÷ the other, for the outcome column) with its CI.',
                      [
                        alt(
                          'contingency',
                          (_f, a) => ({ test: 'chiSquare', trend: false, ...roles(a) }),
                          'large counts (chi-square)',
                        ),
                      ],
                    ),
                  ),
                ),
                answer(
                  'odds',
                  'The odds (a case-control study)',
                  rolesQ(
                    leaf(
                      'contingency',
                      (_f, a) => ({
                        test: 'fisher',
                        trend: false,
                        riskEstimates: false,
                        oddsRatio: true,
                        ...roles(a),
                      }),
                      'Fisher’s exact test is exact for any sample size; report the odds ratio (the exposed row against the other) with its CI.',
                    ),
                  ),
                ),
              ],
              { draws: { risk: { measure: 'risk' }, odds: { measure: 'odds' } } },
            ),
          ),
          answer('larger', 'Larger', larger),
        ],
        { answeredBy: twoByTwo, draws: { twoByTwo: { comparisons: 'pair' } } },
      ),
    ),
  ],
  { draws: { yes: { matched: 'yes' } } },
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
    draws: { layout: 'rows', measure: 'proportion' },
    start: outcomeGroup,
  },
  {
    id: 'trendCounts',
    question: 'Is there a trend across ordered groups (counts)?',
    kinds: ['contingency'],
    keywords: ['trend', 'chi-square for trend', 'dose', 'ordered'],
    draws: { layout: 'rows', measure: 'proportion', comparisons: 'trend' },
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
    draws: { layout: 'rows', measure: 'diagnostic', comparisons: 'none' },
    start: question(
      'result',
      'Is the test a yes/no result or a measurement?',
      'A yes/no result is a 2 × 2 table; a measurement needs a curve of cutoffs.',
      [
        answer(
          'yesNo',
          'A yes/no result (a 2 × 2 of test against the truth)',
          question(
            'exposed',
            'Which row holds the subjects with the condition?',
            'Sensitivity is the share of them the test calls positive.',
            [
              answer(
                'first',
                'The first row',
                question(
                  'outcome',
                  'Which column is a positive test result?',
                  'Specificity is the share of the others in the other column.',
                  [
                    answer('first', 'The first column', diagnosticLeaf),
                    answer('second', 'The second column', diagnosticLeaf),
                  ],
                  { draws: OUTCOME_DRAWS },
                ),
              ),
              answer(
                'second',
                'The second row',
                question(
                  'outcome',
                  'Which column is a positive test result?',
                  'Specificity is the share of the others in the other column.',
                  [
                    answer('first', 'The first column', diagnosticLeaf),
                    answer('second', 'The second column', diagnosticLeaf),
                  ],
                  { draws: OUTCOME_DRAWS },
                ),
              ),
            ],
            { draws: EXPOSED_DRAWS },
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
    draws: { layout: 'rows', measure: 'counts', comparisons: 'shared' },
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
    draws: { layout: 'rows', measure: 'fraction', comparisons: 'none' },
    start: leaf(
      'fractionOfTotal',
      fixed({ display: 'percent' }),
      'Each value as a percentage of its column total.',
    ),
  },
]
