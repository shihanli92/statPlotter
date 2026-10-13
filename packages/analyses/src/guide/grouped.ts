import type { GuideAnswers, GuideEntry, GuideStep } from '@ps/model'
import {
  alt,
  answer,
  elsewhere,
  fixed,
  leaf,
  needsRaw,
  pairingHint,
  question,
  sizesHint,
} from './build.ts'

// Roadmap 51a: the grouped tables' questions (design §3.5, "Grouped tables"): rows are one
// factor, data sets (columns) the other. Roadmap 51c: the leaves set its defaults explicitly (the
// RM method, Satterthwaite's df; FDR across the rows of multiple one-way ANOVAs, Q = 5%).

const twoWay = (a: GuideAnswers, repeated: string) => {
  const comparisons = a.comparisons ?? 'withinRows'
  return {
    repeated,
    interaction: true,
    sphericity: 'gg',
    comparisons,
    kind: a.kind ?? 'allPairs',
    family: 'perBlock',
    allPairsMethod: comparisons === 'allCells' || comparisons === 'mainColumns' ? 'tukey' : 'sidak',
    controlMethod: 'dunnett',
    ...(repeated === 'none' ? {} : { rmMethod: 'auto', ddf: 'satterthwaite' }),
  }
}

const TWO_WAY_REASON =
  'Two-way ANOVA tests each factor and whether one changes the effect of the other; comparisons within each row are adjusted for that row’s comparisons.'

function kindQ(repeated: (a: GuideAnswers) => string): GuideStep {
  const then = leaf('twoWayAnova', (_f, a) => twoWay(a, repeated(a)), TWO_WAY_REASON)
  return question(
    'kind',
    'Every pair, or each with a control?',
    'Comparing each with one control makes fewer comparisons, so it has more power.',
    [
      answer('allPairs', 'Every pair', then),
      answer('vsControl', 'Each with a control (the first column or row)', then),
    ],
    { draws: { allPairs: { kind: 'allPairs' }, vsControl: { kind: 'vsControl' } } },
  )
}

const NO_RM_CELLS = 'Not with repeated measures: comparing every cell needs one pooled error term.'
const NO_RM_MAIN = 'Not yet with repeated measures (a later version computes them).'

function comparisonsQ(repeated: (a: GuideAnswers) => string, rm: boolean): GuideStep {
  const k = kindQ(repeated)
  const none = leaf('twoWayAnova', (_f, a) => twoWay(a, repeated(a)), TWO_WAY_REASON)
  return question(
    'comparisons',
    'Which comparisons answer your question?',
    'Main effects average over the other factor, which misleads when the factors interact.',
    [
      answer('withinRows', 'At each row, compare the columns (simple effects)', k),
      answer('withinColumns', 'In each column, compare the rows', k),
      answer('allCells', 'Every cell with every other', k, {
        unavailable: () => (rm ? NO_RM_CELLS : null),
      }),
      answer(
        'mainColumns',
        'The columns overall, averaged over the rows (only if you expect no interaction)',
        k,
        { unavailable: () => (rm ? NO_RM_MAIN : null) },
      ),
      answer('none', 'Only the overall effects', none),
    ],
    {
      draws: {
        withinRows: { comparisons: 'withinRows' },
        withinColumns: { comparisons: 'withinColumns' },
        allCells: { comparisons: 'allCells' },
        mainColumns: { comparisons: 'mainColumns' },
        none: { comparisons: 'none' },
      },
    },
  )
}

const repeatedOf = (a: GuideAnswers) => a.repeated ?? 'none'

const twoFactors: GuideStep = question(
  'repeated',
  'Were the same subjects measured across one of the factors?',
  'Decided by the design: repeated measures link a subject’s values.',
  [
    answer('none', 'No, a different subject in every cell', comparisonsQ(repeatedOf, false)),
    answer(
      'columns',
      'Yes, across the columns: subject i is replicate i of every column',
      comparisonsQ(repeatedOf, true),
      { unavailable: needsRaw },
    ),
    answer(
      'rows',
      'Yes, across the rows (a time course down the rows)',
      comparisonsQ(repeatedOf, true),
      { unavailable: needsRaw },
    ),
    answer('both', 'Both factors', comparisonsQ(repeatedOf, true), { unavailable: needsRaw }),
  ],
  {
    hint: pairingHint,
    draws: {
      none: { matched: 'no' },
      columns: { matched: 'columns' },
      rows: { matched: 'rows' },
      both: { matched: 'both' },
    },
  },
)

const multipleT = (design: string, distribution: string) =>
  fixed({ design, distribution, variance: 'welch', approach: 'fdr', fdrMethod: 'bky', q: 5 })

const rowsValues = (design: string): GuideStep =>
  question(
    'values',
    'What kind of values?',
    'Measurements, values that change by a factor, and scores need different tests.',
    [
      answer(
        'measure',
        'Measurements',
        leaf(
          'multipleT',
          multipleT(design, 'gaussian'),
          'One t test per row, with a false discovery rate so that most discoveries are real.',
          [
            alt(
              'twoWayAnova',
              fixed({ repeated: 'none', comparisons: 'withinRows' }),
              'the rows are levels of a factor you care about (doses, times)',
            ),
          ],
        ),
      ),
      answer(
        'factor',
        'Measurements that change by a factor (expression, concentrations)',
        leaf(
          'multipleT',
          multipleT(design, 'lognormal'),
          'One t test of the logarithms per row, with a false discovery rate: differences become ratios.',
        ),
      ),
      answer(
        'scores',
        'Scores or skewed values',
        leaf(
          'multipleT',
          multipleT(design, 'nonparametric'),
          'One rank test per row, with a false discovery rate so that most discoveries are real.',
        ),
      ),
    ],
    {
      draws: {
        measure: { measure: 'mean' },
        factor: { measure: 'logMean' },
        scores: { measure: 'ranks' },
      },
    },
  )

const ROWS_ANOVA =
  'One ANOVA per row with a false discovery rate across the rows (most discoveries real); each row’s comparisons adjusted within the row.'
const ROWS_WELCH =
  'One Welch ANOVA per row (it doesn’t pool the groups’ scatter), with a false discovery rate across the rows; each row’s comparisons (Dunnett’s T3) adjusted within the row.'

const multipleOneWay = (equalSD: 'yes' | 'welch') =>
  fixed({
    gaussian: true,
    equalSD,
    comparisons: 'allPairs',
    ...(equalSD === 'welch' ? { welchMethod: 'dunnett-t3' } : {}),
    approach: 'fdr',
    fdrMethod: 'bh',
    q: 5,
  })

/** Three or more groups at each row, different subjects: what kind of values, the scatter. */
const rowsManyValues: GuideStep = question(
  'values',
  'What kind of values?',
  'Measurements and scores need different tests.',
  [
    answer(
      'measure',
      'Measurements',
      question(
        'scatter',
        'Could a treatment change how much values vary, or do group sizes differ a lot?',
        'Ordinary ANOVA pools the scatter of all groups; Welch ANOVA doesn’t.',
        [
          answer('yes', 'Yes', leaf('multipleOneWay', multipleOneWay('welch'), ROWS_WELCH)),
          answer(
            'no',
            'No, similar scatter is expected',
            leaf('multipleOneWay', multipleOneWay('yes'), ROWS_ANOVA),
          ),
          answer(
            'unsure',
            'Not sure',
            leaf('multipleOneWay', multipleOneWay('welch'), ROWS_WELCH),
            {
              explain: 'Welch ANOVA protects P if the scatter differs and costs little if not.',
            },
          ),
        ],
        {
          hint: sizesHint,
          draws: {
            yes: { scatter: 'own' },
            no: { scatter: 'pooled' },
            unsure: { scatter: 'own' },
          },
        },
      ),
    ),
    answer(
      'scores',
      'Scores or ranks',
      leaf(
        'multipleOneWay',
        fixed({
          gaussian: false,
          comparisons: 'allPairs',
          kwPMethod: 'exactWhenPossible',
          dunnMethod: 'holm',
          approach: 'fdr',
          fdrMethod: 'bh',
          q: 5,
        }),
        'One Kruskal-Wallis test per row, with a false discovery rate across the rows and Dunn’s comparisons (Holm) within each row.',
      ),
      { unavailable: needsRaw },
    ),
  ],
  { draws: { measure: { measure: 'mean' }, scores: { measure: 'ranks' } } },
)

export const GROUPED_ENTRIES: readonly GuideEntry[] = [
  {
    id: 'twoFactors',
    question: 'How do two factors affect the response (and do they interact)?',
    kinds: ['grouped'],
    keywords: ['two-way anova', 'two factors', 'interaction', 'genotype treatment', 'factorial'],
    draws: { layout: 'grid', measure: 'mean' },
    start: twoFactors,
  },
  {
    id: 'timeCourse',
    question: 'A time course in the same subjects',
    kinds: ['grouped'],
    keywords: ['time course', 'repeated measures', 'over time', 'same animals'],
    draws: { layout: 'grid', measure: 'mean' },
    start: question(
      'second',
      'Are the groups in the columns and the times down the rows?',
      'A time course is a grouped table: times as rows, groups as columns, subjects as replicates.',
      [
        answer(
          'yes',
          'Yes: rows are times, columns are groups',
          comparisonsQ(() => 'rows', true),
          {
            unavailable: needsRaw,
          },
        ),
        answer(
          'one',
          'There is only one group, measured at every time',
          elsewhere(
            'column',
            'One group over time: a column table with one column per time, then “Are the groups different?” with the same subjects in every group.',
          ),
        ),
      ],
      {
        hint: (f) =>
          f.numericRowTitles >= 2 ? 'The row titles are numbers: the rows look like times.' : null,
        draws: { yes: { matched: 'rows' } },
      },
    ),
  },
  {
    id: 'rowsTwo',
    question: 'Compare two groups at each row (many genes)',
    kinds: ['grouped'],
    keywords: [
      'multiple t tests',
      'genes',
      'proteins',
      'volcano',
      'each row',
      'false discovery rate',
    ],
    draws: { layout: 'grid', comparisons: 'perRow' },
    start: question(
      'matched',
      'Were the same subjects measured in both groups?',
      'Pairing is decided by how the experiment was done, not by the data.',
      [
        answer('no', 'No, different subjects in each group', rowsValues('unpaired')),
        answer('yes', 'Yes: replicate i of both groups is the same subject', rowsValues('paired'), {
          unavailable: needsRaw,
        }),
      ],
      { draws: { no: { matched: 'no' }, yes: { matched: 'columns' } } },
    ),
  },
  {
    id: 'rowsMany',
    question: 'Compare three or more groups at each row',
    kinds: ['grouped'],
    keywords: ['multiple anova', 'each row', 'per row'],
    draws: { layout: 'grid', comparisons: 'perRow' },
    // Audit 4 S14 (Q5): asked whether the groups are the same subjects (matched: two-way
    // repeated-measures ANOVA, groups compared within each row) and, for measurements, about
    // the scatter (Welch ANOVA in each row, as the column tree's three or more groups).
    start: question(
      'matched',
      'Were the same subjects measured in every group?',
      'Pairing is decided by how the experiment was done, not by the data.',
      [
        answer('no', 'No, different subjects in each group', rowsManyValues),
        answer(
          'yes',
          'Yes: replicate i of every group is the same subject',
          leaf(
            'twoWayAnova',
            (_f, a) => twoWay(a, 'columns'),
            'The same subjects in every group: two-way repeated-measures ANOVA (subjects across the columns) compares the groups within each row, adjusted for that row’s comparisons.',
          ),
          { unavailable: needsRaw },
        ),
      ],
      { hint: pairingHint, draws: { no: { matched: 'no' }, yes: { matched: 'columns' } } },
    ),
  },
  {
    id: 'threeFactors',
    question: 'Three factors (2 × 2 × k)',
    kinds: ['grouped'],
    keywords: ['three-way anova', 'three factors'],
    draws: { layout: 'grid', measure: 'mean', comparisons: 'none' },
    start: question(
      'groups',
      'How many data sets?',
      'Three-way ANOVA here reads four data sets as two factors of two levels.',
      [
        answer(
          'four',
          'Four (A–D: two factors of two levels)',
          leaf(
            'threeWayAnova',
            fixed({}),
            'Tests the rows and two column factors, and their interactions; read the highest interaction first.',
          ),
        ),
        answer(
          'other',
          'Another number',
          elsewhere(
            'multipleVariables',
            'Factors with more levels need a multiple-variables table (multifactor ANOVA).',
          ),
        ),
      ],
      { answeredBy: (f) => (f.groups.length === 4 ? 'four' : 'other') },
    ),
  },
  {
    id: 'describeRows',
    question: 'Describe each row',
    kinds: ['grouped'],
    keywords: ['row means', 'row statistics', 'mean sd'],
    draws: { layout: 'grid', measure: 'summary', comparisons: 'none' },
    start: leaf('rowStats', fixed({}), 'The mean, SD, SEM and n of each row, for each data set.'),
  },
]
