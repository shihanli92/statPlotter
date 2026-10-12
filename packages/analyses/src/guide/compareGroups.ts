import type { GuideAnswers, GuideEntry, GuideLeaf, GuideStep, TableFacts } from '@ps/model'
import {
  alt,
  answer,
  fixed,
  leaf,
  meanN,
  needsRaw,
  pairingHint,
  question,
  sizesHint,
  valuesHint,
} from './build.ts'

// Roadmap 51a: "Are the groups different?" and its relatives on column and nested tables (design
// §3.5, "Compare groups"). Roadmap 51c: the leaves set its options explicitly (exact
// Kruskal-Wallis P, Dunn's comparisons by Holm, the RM method and Satterthwaite's df).

const WHY_MATCHED = 'Pairing is decided by how the experiment was done, not by the data.'
const WHY_VALUES = 'Measurements, values that change by a factor, and scores need different tests.'

const comparisonsOf = (a: GuideAnswers) => ({
  comparisons: a.comparisons ?? 'allPairs',
  control: a.comparisons === 'vsControl' ? (a.control ?? '') : '',
})

/**
 * "Which comparisons answer your question?" for three or more groups, then `then` (a leaf that
 * reads the answer). `trend`: why a trend test can't follow (null: it can); `fixedTo`: the
 * answer given by the entry ("Is each group different from a control?").
 */
function comparisonsQ(
  then: GuideLeaf,
  opts: { trend: string | null; noTrend?: boolean; fixedTo?: string },
): GuideStep {
  return question(
    'comparisons',
    'Which comparisons answer your question?',
    'Decide before the experiment: fewer comparisons, more power.',
    [
      answer('allPairs', 'Every pair of groups', then),
      answer('vsControl', 'Each group with a control', then, {
        asks: [
          {
            id: 'control',
            kind: 'group',
            label: 'Control group',
            initial: (f) => f.groups[0]?.key ?? '',
          },
        ],
      }),
      ...(opts.noTrend
        ? []
        : [
            answer('trend', 'A steady rise or fall across the groups, in their order', then, {
              unavailable: () => opts.trend,
            }),
          ]),
      answer('none', 'Only whether any group differs', then),
    ],
    opts.fixedTo ? { answeredBy: () => opts.fixedTo! } : {},
  )
}

// ---- Two groups ------------------------------------------------------------------------------

const welch = fixed({ design: 'unpaired', unpaired: { assumeEqualSD: false } })
const student = fixed({ design: 'unpaired', unpaired: { assumeEqualSD: true } })
const pairedDiff = fixed({ design: 'paired', paired: { measure: 'difference' } })
const pairedRatio = fixed({ design: 'paired', paired: { measure: 'ratio' } })
const mw = fixed({ pMethod: 'exactWhenPossible' })
const wilcoxonParams = fixed({ pMethod: 'exactWhenPossible', zeroHandling: 'wilcoxon' })

const LOG_FIRST =
  'Take logarithms first (Transform, Y = log10(Y)): on a log scale the difference becomes a ratio you can report (B is 2.3 times A).'

const unpairedValues = question(
  'values',
  'What kind of values?',
  WHY_VALUES,
  [
    answer(
      'measure',
      'Measurements (activity, area, the concentration of one analyte)',
      question(
        'scatter',
        'Can the groups vary by different amounts?',
        'A treatment often changes how much values vary, not only their mean.',
        [
          answer(
            'yes',
            'Yes, or not sure',
            leaf(
              'ttest',
              welch,
              'Welch’s t test compares two means without assuming the groups vary equally; it loses almost nothing when they do.',
              [
                alt(
                  'mannWhitney',
                  mw,
                  'the values are scores, or have clear outliers you can’t explain',
                ),
              ],
            ),
          ),
          answer(
            'no',
            'No, equal scatter is known from the method',
            leaf(
              'ttest',
              student,
              'Student’s t test pools the two SDs, as your method’s scatter is known to be constant.',
              [alt('ttest', welch, 'the scatter may differ after all (Welch’s t test)')],
            ),
          ),
        ],
      ),
    ),
    answer(
      'factor',
      'Measurements that change by a factor (concentrations over orders of magnitude, fold changes, cell counts)',
      leaf(
        'transform',
        fixed({ y: 'log10' }),
        LOG_FIRST,
        [alt('mannWhitney', mw, 'you would rather compare ranks than logarithms')],
        'Then analyze the transformed table: Guide me › Are the groups different? › Measurements (Welch’s t test).',
      ),
      {
        unavailable: (f) =>
          needsRaw(f) ?? (f.allPositive ? null : 'Logarithms need values above zero.'),
      },
    ),
    answer(
      'scores',
      'Scores or ranks (a 0–4 histology score, a rating)',
      leaf(
        'mannWhitney',
        mw,
        'The Mann-Whitney test compares whether values in one group tend to be larger, using only their order.',
        [alt('ttest', welch, 'the values are measurements after all (Welch’s t test)')],
      ),
      { unavailable: needsRaw },
    ),
    answer(
      'shape',
      'Whether the whole distributions differ (shape, not only level)',
      leaf(
        'kolmogorovSmirnov',
        fixed({}),
        'The Kolmogorov-Smirnov test detects any difference between the two distributions; it has little power for a simple shift.',
        [alt('mannWhitney', mw, 'you expect one group to be shifted')],
      ),
      { unavailable: needsRaw },
    ),
  ],
  { hint: valuesHint },
)

const pairedValues = question(
  'values',
  'What kind of values?',
  WHY_VALUES,
  [
    answer(
      'measure',
      'Measurements',
      leaf(
        'ttest',
        pairedDiff,
        'The paired t test compares each pair’s difference, which removes subject-to-subject variation.',
        [
          alt('ttest', pairedRatio, 'the effect is proportional (ratio paired t test)'),
          alt('wilcoxon', wilcoxonParams, 'the differences are scores or very skewed'),
        ],
      ),
    ),
    answer(
      'factor',
      'Measurements that change by a factor (each subject’s value is multiplied)',
      leaf(
        'ttest',
        pairedRatio,
        'When each subject’s value is multiplied (×2), the ratio paired t test compares ratios, not differences.',
        [alt('ttest', pairedDiff, 'the change is a difference of similar size in every pair')],
      ),
      { unavailable: (f) => (f.allPositive ? null : 'Ratios need values above zero.') },
    ),
    answer(
      'scores',
      'Scores or ranks',
      leaf(
        'wilcoxon',
        wilcoxonParams,
        'The Wilcoxon matched-pairs test uses the signs and ranks of each pair’s difference.',
        [alt('ttest', pairedDiff, 'the differences are measurements (paired t test)')],
      ),
    ),
  ],
  { hint: valuesHint },
)

const twoGroups = question(
  'matched',
  'Were the same subjects measured in both groups?',
  WHY_MATCHED,
  [
    answer('no', 'No, different subjects in each group', unpairedValues),
    answer('yes', 'Yes, each row is one subject, plate or day', pairedValues, {
      unavailable: (f) => (f.raw ? null : 'Pairing needs the raw values, not mean/SD/N.'),
    }),
  ],
  { hint: pairingHint },
)

// ---- Three or more groups ----------------------------------------------------------------------

const ANOVA_BASE = { allPairsMethod: 'tukey', controlMethod: 'dunnett' }
const welchMethod = (f: TableFacts) => (meanN(f) < 50 ? 'dunnett-t3' : 'games-howell')

const NO_TREND_MATCHED =
  'Not with matched subjects: the trend test uses the ordinary ANOVA’s error.'
const NO_TREND_RANKS = 'Not with ranks: the trend test follows ordinary ANOVA.'
const NO_TREND_WELCH = 'Needs similar scatter (ordinary ANOVA).'

function manyGroups(fixedTo?: string): GuideStep {
  const ordinary = leaf(
    'oneWayAnova',
    (_f, a) => ({
      matched: false,
      gaussian: true,
      equalSD: 'yes',
      ...ANOVA_BASE,
      ...comparisonsOf(a),
    }),
    'One-way ANOVA tests all groups at once; the comparisons you chose are adjusted for their number (Tukey, Dunnett).',
    [
      alt(
        'oneWayAnova',
        (f, a) => ({
          matched: false,
          gaussian: true,
          equalSD: 'welch',
          welchMethod: welchMethod(f),
          ...comparisonsOf(a),
          ...(a.comparisons === 'trend' ? { comparisons: 'allPairs' } : {}),
        }),
        'a treatment may change the scatter (Welch ANOVA)',
      ),
    ],
  )
  const welchLeaf = leaf(
    'oneWayAnova',
    (f, a) => ({
      matched: false,
      gaussian: true,
      equalSD: 'welch',
      welchMethod: welchMethod(f),
      ...ANOVA_BASE,
      ...comparisonsOf(a),
    }),
    'Welch ANOVA and its comparisons (Dunnett’s T3 or Games-Howell) don’t assume the groups vary equally.',
    [
      alt(
        'oneWayAnova',
        (_f, a) => ({
          matched: false,
          gaussian: true,
          equalSD: 'yes',
          ...ANOVA_BASE,
          ...comparisonsOf(a),
        }),
        'the groups are balanced with similar scatter (ordinary ANOVA)',
      ),
    ],
  )
  const ranks = leaf(
    'oneWayAnova',
    (_f, a) => ({
      matched: false,
      gaussian: false,
      kwPMethod: 'exactWhenPossible',
      dunnMethod: 'holm',
      ...ANOVA_BASE,
      ...comparisonsOf(a),
    }),
    'The Kruskal-Wallis test compares several groups by ranks (exact P for small groups); Dunn’s test (Holm) says which pairs differ.',
    [
      alt(
        'oneWayAnova',
        (_f, a) => ({
          matched: false,
          gaussian: true,
          equalSD: 'yes',
          ...ANOVA_BASE,
          ...comparisonsOf(a),
        }),
        'the values are measurements (one-way ANOVA)',
      ),
    ],
  )
  const rm = leaf(
    'oneWayAnova',
    (_f, a) => ({
      matched: true,
      gaussian: true,
      sphericity: 'gg',
      rmMethod: 'auto',
      ddf: 'satterthwaite',
      ...ANOVA_BASE,
      ...comparisonsOf(a),
    }),
    'Each subject is its own control; the Geisser-Greenhouse correction keeps P honest when conditions correlate unequally (time courses).',
    [
      alt(
        'oneWayAnova',
        (_f, a) => ({ matched: true, gaussian: false, ...ANOVA_BASE, ...comparisonsOf(a) }),
        'the values are scores (Friedman test)',
      ),
    ],
  )
  const friedman = leaf(
    'oneWayAnova',
    (_f, a) => ({
      matched: true,
      gaussian: false,
      dunnMethod: 'holm',
      ...ANOVA_BASE,
      ...comparisonsOf(a),
    }),
    'The Friedman test ranks each subject’s values; Dunn’s test says which pairs differ.',
    [
      alt(
        'oneWayAnova',
        (_f, a) => ({
          matched: true,
          gaussian: true,
          sphericity: 'gg',
          ...ANOVA_BASE,
          ...comparisonsOf(a),
        }),
        'the values are measurements (repeated-measures ANOVA)',
      ),
    ],
  )
  const c = (then: GuideLeaf, trend: string | null) => comparisonsQ(then, { trend, fixedTo })
  return question(
    'matched',
    'Were the same subjects measured in every group?',
    WHY_MATCHED,
    [
      answer(
        'no',
        'No, different subjects in each group',
        question(
          'values',
          'What kind of values?',
          WHY_VALUES,
          [
            answer(
              'measure',
              'Measurements',
              question(
                'scatter',
                'Could a treatment change how much values vary, or do group sizes differ a lot?',
                'Ordinary ANOVA pools the scatter of all groups; Welch ANOVA doesn’t.',
                [
                  answer('yes', 'Yes', c(welchLeaf, NO_TREND_WELCH)),
                  answer('no', 'No, similar scatter is expected', c(ordinary, null)),
                  answer('unsure', 'Not sure', c(welchLeaf, NO_TREND_WELCH), {
                    explain:
                      'Welch ANOVA protects P if the scatter differs and costs little if not.',
                  }),
                ],
                { hint: sizesHint },
              ),
            ),
            answer(
              'factor',
              'Measurements that change by a factor',
              leaf(
                'transform',
                fixed({ y: 'log10' }),
                LOG_FIRST,
                [],
                'Then analyze the transformed table: Guide me › Are the groups different? › Measurements.',
              ),
              {
                unavailable: (f) =>
                  needsRaw(f) ?? (f.allPositive ? null : 'Logarithms need values above zero.'),
              },
            ),
            answer('scores', 'Scores or ranks', c(ranks, NO_TREND_RANKS), {
              unavailable: needsRaw,
            }),
          ],
          { hint: valuesHint },
        ),
      ),
      answer(
        'yes',
        'Yes, each row is one subject',
        question('values', 'What kind of values?', WHY_VALUES, [
          answer('measure', 'Measurements', c(rm, NO_TREND_MATCHED)),
          answer('scores', 'Scores or ranks', c(friedman, NO_TREND_MATCHED)),
        ]),
        { unavailable: (f) => (f.raw ? null : 'Matching needs the raw values, not mean/SD/N.') },
      ),
    ],
    { hint: pairingHint },
  )
}

// ---- One group -----------------------------------------------------------------------------

const ASK_VALUE = [
  {
    id: 'hypothetical',
    kind: 'number' as const,
    label: 'Compare with',
    initial: () => '100',
  },
]
const hypothetical = (a: GuideAnswers) => {
  const v = Number(a.hypothetical)
  return Number.isFinite(v) ? v : 0
}

const setValue: GuideStep = question(
  'values',
  'What kind of values? (Then enter the value you compare with, e.g. 100 for % of control.)',
  'Choose the value before the experiment: 100 for % of control, 1 for a ratio.',
  [
    answer(
      'measure',
      'Measurements',
      leaf(
        'oneSample',
        (_f, a) => ({ test: 't', hypothetical: hypothetical(a) }),
        'The one-sample t test asks whether the mean differs from the value you expect.',
        [
          alt(
            'oneSample',
            (_f, a) => ({ test: 'wilcoxon', hypothetical: hypothetical(a) }),
            'the values are scores or very skewed',
          ),
        ],
      ),
      { asks: ASK_VALUE },
    ),
    answer(
      'scores',
      'Scores or very skewed values',
      leaf(
        'oneSample',
        (_f, a) => ({ test: 'wilcoxon', hypothetical: hypothetical(a) }),
        'The Wilcoxon signed-rank test asks whether the values tend to lie above or below the value you expect.',
        [
          alt(
            'oneSample',
            (_f, a) => ({ test: 't', hypothetical: hypothetical(a) }),
            'the values are measurements',
          ),
        ],
      ),
      { asks: ASK_VALUE, unavailable: needsRaw },
    ),
  ],
  {
    hint: () =>
      'A control normalized to exactly 100 has no variation: compare the other groups with 100 instead.',
  },
)

/** How many groups (a counting question the facts answer). */
function groupsQ(one: GuideStep, two: GuideStep, many: GuideStep): GuideStep {
  return question(
    'groups',
    'How many groups do you compare?',
    'Counted from the data sets chosen.',
    [
      answer('one', 'One group, against a set value', one),
      answer('two', 'Two groups', two),
      answer('many', 'Three or more groups', many),
    ],
    {
      answeredBy: (f) =>
        f.groups.length >= 3
          ? 'many'
          : f.groups.length === 2
            ? 'two'
            : f.groups.length === 1
              ? 'one'
              : null,
    },
  )
}

export const COMPARE_ENTRIES: readonly GuideEntry[] = [
  {
    id: 'groupsDiffer',
    question: 'Are the groups different?',
    kinds: ['column'],
    keywords: [
      'compare groups',
      'compare two groups',
      'significant difference',
      'difference between groups',
      't test',
      'anova',
      'before and after',
      'same animals',
      'paired',
      'unpaired',
      'nonparametric',
      'treated vs control',
    ],
    start: groupsQ(setValue, twoGroups, manyGroups()),
  },
  {
    id: 'vsControl',
    question: 'Is each group different from a control?',
    kinds: ['column'],
    keywords: ['control', 'vehicle', 'dunnett', 'compare with control', 'versus control'],
    start: groupsQ(setValue, twoGroups, manyGroups('vsControl')),
  },
  {
    id: 'trend',
    question: 'Is there a trend across ordered groups?',
    kinds: ['column'],
    keywords: ['trend', 'dose', 'ordered groups', 'increase with dose', 'linear trend'],
    start: question(
      'matched',
      'Were the same subjects measured in every group?',
      WHY_MATCHED,
      [
        answer(
          'no',
          'No, different subjects in each group',
          leaf(
            'oneWayAnova',
            fixed({ matched: false, gaussian: true, equalSD: 'yes', comparisons: 'trend' }),
            'The test for linear trend asks whether the means rise or fall steadily across the groups, in the order of the table.',
            [
              alt(
                'oneWayAnova',
                fixed({ matched: false, gaussian: true, equalSD: 'yes', comparisons: 'allPairs' }),
                'you want to know which groups differ, not whether there is a trend',
              ),
            ],
          ),
        ),
        answer(
          'yes',
          'Yes, each row is one subject',
          leaf(
            'oneWayAnova',
            fixed({ matched: true, gaussian: true, sphericity: 'gg', comparisons: 'allPairs' }),
            'The trend test needs different subjects in each group; repeated-measures ANOVA with comparisons of every pair is the closest here.',
          ),
          { unavailable: (f) => (f.raw ? null : 'Matching needs the raw values, not mean/SD/N.') },
        ),
      ],
      { hint: pairingHint },
    ),
  },
  {
    id: 'setValue',
    question: 'Is the average different from a set value?',
    kinds: ['column'],
    keywords: [
      'hypothetical value',
      'one sample',
      'compare with 100',
      'percent of control',
      'set value',
    ],
    start: setValue,
  },
  {
    id: 'distributions',
    question: 'Do the whole distributions differ?',
    kinds: ['column'],
    keywords: ['distribution', 'shape', 'kolmogorov', 'cumulative'],
    start: leaf(
      'kolmogorovSmirnov',
      fixed({}),
      'The Kolmogorov-Smirnov test detects any difference between two distributions; it has little power for a simple shift.',
      [alt('mannWhitney', mw, 'you expect one group to be shifted')],
    ),
  },
  {
    id: 'nestedGroups',
    question: 'Are the groups different (several measurements per subject)?',
    kinds: ['nested'],
    keywords: [
      'nested',
      'technical replicates',
      'wells per animal',
      'cells per mouse',
      'hierarchical',
    ],
    start: question(
      'groups',
      'How many groups do you compare?',
      'Counted from the data sets chosen.',
      [
        answer(
          'two',
          'Two groups',
          leaf(
            'nestedT',
            fixed({ ddf: 'satterthwaite' }),
            'Your independent units are the subjects, not the wells; the nested t test counts them correctly.',
          ),
        ),
        answer(
          'many',
          'Three or more groups',
          comparisonsQ(
            leaf(
              'nestedOneWay',
              (_f, a) => ({ ...ANOVA_BASE, ddf: 'satterthwaite', ...comparisonsOf(a) }),
              'Your independent units are the subjects, not the wells; nested one-way ANOVA counts them correctly.',
            ),
            { trend: null, noTrend: true },
          ),
        ),
      ],
      { answeredBy: (f) => (f.groups.length >= 3 ? 'many' : f.groups.length === 2 ? 'two' : null) },
    ),
  },
]
