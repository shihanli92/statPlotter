import { type AnalysisDef, type Comparison, type ResultBlock, valueAt } from '@ps/model'
import {
  dunnFriedmanComparisons,
  friedmanTest,
  kolmogorovSmirnovTwoSample,
  median,
} from '@ps/stats'
import { z } from 'zod'
import { CONTROL_FIELD, NO_COMPARISONS, oneWayPairs, pairComparisons } from './anovaCommon.ts'
import {
  ALPHA,
  comparisonKey,
  exclusionNotes,
  failure,
  int,
  kv,
  labelTable,
  num,
  pRows,
  psum,
  pval,
  RANK_NEEDS_RAW,
  rawValues,
  result,
  resultsSheet,
  significant,
  table,
  testValue,
  text,
  tooFewDataSets,
} from './common.ts'
import { validateFriedman, validateKS } from './validators.ts'

/**
 * Roadmap 51c (S11): how Dunn's comparisons after a rank test are adjusted — Holm's step-down
 * (the default: more power than Bonferroni with the same protection), Šidák, Bonferroni, or not
 * at all. The same list after Kruskal-Wallis and Friedman.
 */
export const dunnMethod = z.enum(['holm', 'sidak', 'bonferroni', 'none'])
export type DunnMethod = z.infer<typeof dunnMethod>
export const DUNN_METHODS = [
  { value: 'holm', label: 'Holm (recommended)' },
  { value: 'sidak', label: 'Šidák' },
  { value: 'bonferroni', label: 'Bonferroni' },
  { value: 'none', label: 'No correction' },
] as const
/** The title of a Dunn's comparisons table: the test and its adjustment (S33). */
export const dunnTitle = (m: DunnMethod, friedman = false) =>
  `Dunn’s multiple comparisons test${friedman ? ' (Siegel-Castellan form)' : ''}, ${
    m === 'none' ? 'uncorrected' : m === 'holm' ? 'Holm' : m === 'sidak' ? 'Šidák' : 'Bonferroni'
  }`

// ---------------------------------------------------------------------------------------------
// Friedman test (matched / repeated measures, nonparametric)
// ---------------------------------------------------------------------------------------------

const FriedmanParams = z.object({
  comparisons: z.enum(['none', 'allPairs', 'vsControl']).default('allPairs'),
  /** Data set key of the control; empty = the first analyzed data set. */
  control: z.string().default(''),
  /** Roadmap 51c: Holm by default; before 0.3.9 'dunn' (Bonferroni) or 'none'. */
  correction: dunnMethod.default('holm'),
})
type FriedmanParams = z.infer<typeof FriedmanParams>

/** Version 1 (before 0.3.9): `correction` 'dunn' was Bonferroni (the default), 'none' none. */
const migrateFriedman = (raw: unknown, from: number): unknown => {
  if (from >= 2) return raw
  const c = valueAt(raw, ['correction'])
  const base = typeof raw === 'object' && raw !== null ? raw : {}
  return { ...base, correction: c === 'none' ? 'none' : 'bonferroni' }
}

export const friedmanDef: AnalysisDef<FriedmanParams> = {
  id: 'friedman',
  version: 2,
  title: 'Friedman test',
  category: 'Column analyses',
  description:
    'Nonparametric comparison of three or more matched groups (each row is one subject), with Dunn’s multiple comparisons.',
  accepts: ['column'],
  inputs: { min: 3, max: 64 },
  params: FriedmanParams,
  migrateParams: migrateFriedman,
  form: [
    {
      path: ['comparisons'],
      label: 'Multiple comparisons',
      kind: 'radio',
      options: [
        NO_COMPARISONS,
        { value: 'allPairs', label: 'Compare the mean rank of each column with every other' },
        { value: 'vsControl', label: 'Compare each column with a control column' },
      ],
    },
    CONTROL_FIELD,
    {
      path: ['correction'],
      label: 'Correction for multiple comparisons',
      kind: 'radio',
      options: DUNN_METHODS,
      showIf: { path: ['comparisons'], in: ['allPairs', 'vsControl'] },
    },
  ],
  validate: validateFriedman,
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    const titles = input.map((d) => d.title)
    if (input.some((d) => d.data.shape !== 'replicates'))
      return failure(
        `The Friedman test needs raw values, not summary data.${RANK_NEEDS_RAW}`,
        diagnostics,
      )
    const cols = input.map((d) => (d.data.shape === 'replicates' ? d.data.reps[0]! : null)!)
    const rowCount = Math.max(...cols.map((c) => c.length))
    const rows: number[][] = []
    let incomplete = 0
    for (let r = 0; r < rowCount; r++) {
      const vals = cols.map((c) => c[r] ?? Number.NaN)
      const filled = vals.filter((v) => !Number.isNaN(v)).length
      if (filled === vals.length) rows.push(vals)
      else if (filled > 0) incomplete++
    }
    if (incomplete > 0) {
      diagnostics.push({
        level: 'info',
        message: `${incomplete} row${incomplete > 1 ? 's' : ''} with missing values ${incomplete > 1 ? 'were' : 'was'} ignored (the Friedman test needs complete rows).`,
      })
    }
    if (rows.length < 2)
      return failure('The Friedman test needs at least two complete rows.', diagnostics)

    const fr = friedmanTest(rows)
    const exact = fr.pExact !== null
    const p = fr.pExact ?? fr.p
    const blocks: ResultBlock[] = [
      kv('Friedman test', [
        ['P value', pval(p)],
        ['Exact or approximate P value?', text(exact ? 'Exact' : 'Approximate')],
        ['P value summary', psum(p)],
        // S12: a rank test asks whether values tend to be larger in some groups.
        [`Do the values tend to differ between groups (P < ${ALPHA})?`, significant(p)],
        ['Number of groups', int(fr.k)],
        ['Number of subjects (rows)', int(fr.n)],
        ['Friedman statistic', num(fr.stat)],
      ]),
      labelTable('Data summary', titles, [
        ['Sum of ranks', fr.rankSums.map((v) => num(v))],
        ['Mean rank', fr.meanRanks.map((v) => num(v))],
      ]),
    ]
    const sheets = [resultsSheet(blocks)]

    const { pairs } = oneWayPairs(input, params.comparisons, params.control)
    let comparisons: Comparison[] = []
    if (pairs.length) {
      const cmp = dunnFriedmanComparisons(fr, pairs, { method: params.correction })
      sheets.push({
        key: 'comparisons',
        title: 'Multiple comparisons',
        blocks: [
          table(
            dunnTitle(params.correction, true),
            [
              'Comparison',
              'Rank sum diff.',
              'Significant?',
              'Summary',
              params.correction === 'none' ? 'P Value' : 'Adjusted P Value',
            ],
            cmp.map((c) => [
              text(`${titles[c.i]} vs. ${titles[c.j]}`),
              num(c.rankSumDiff),
              significant(c.pAdj),
              psum(c.pAdj),
              pval(c.pAdj),
            ]),
          ),
        ],
      })
      comparisons = pairComparisons(
        input,
        pairs,
        cmp.map((c) => c.pAdj),
      )
    }
    return result({
      diagnostics,
      sheets,
      values: {
        p: pval(p),
        stat: num(fr.stat),
        ...testValue('Friedman test'),
        ...(pairs.length
          ? {
              comparisonTest: text(
                `Dunn${params.correction === 'none' ? ', uncorrected' : `, ${params.correction === 'holm' ? 'Holm' : params.correction === 'sidak' ? 'Šidák' : 'Bonferroni'}`}`,
              ),
            }
          : {}),
      },
      comparisons,
    })
  },
}

// ---------------------------------------------------------------------------------------------
// Kolmogorov-Smirnov test (compare two cumulative distributions)
// ---------------------------------------------------------------------------------------------

const KSParams = z.object({})
type KSParams = z.infer<typeof KSParams>

export const kolmogorovSmirnovDef: AnalysisDef<KSParams> = {
  id: 'kolmogorovSmirnov',
  version: 1,
  title: 'Kolmogorov-Smirnov test',
  category: 'Column analyses',
  description: 'Nonparametric comparison of the cumulative distributions of two unpaired groups.',
  accepts: ['column'],
  inputs: { min: 2, max: 2 },
  params: KSParams,
  form: [],
  validate: validateKS,
  run(input) {
    const few = tooFewDataSets(input, 2, 'The Kolmogorov-Smirnov test compares two data sets.')
    if (few) return few
    const [A, B] = input as [(typeof input)[0], (typeof input)[0]]
    const diagnostics = exclusionNotes(input)
    const a = rawValues(A)
    const b = rawValues(B)
    if (!a || !b)
      return failure('The Kolmogorov-Smirnov test needs raw values, not summary data.', diagnostics)
    if (a.length < 1 || b.length < 1)
      return failure('Both groups need at least one value.', diagnostics)
    const r = kolmogorovSmirnovTwoSample(a, b)
    return result({
      diagnostics,
      blocks: [
        kv('Data sets', [['Compared', text(`${A.title} vs. ${B.title}`), 'compared']]),
        kv('Kolmogorov-Smirnov test', [
          ...pRows(r.p, 'two', r.exact),
          ['Kolmogorov-Smirnov D', num(r.d)],
        ]),
        kv('Data analyzed', [
          [`Sample size, ${A.title}`, int(a.length), 'nA'],
          [`Sample size, ${B.title}`, int(b.length), 'nB'],
          [`Median of ${A.title}`, num(median(a)), 'medianA'],
          [`Median of ${B.title}`, num(median(b)), 'medianB'],
        ]),
      ],
      values: { p: pval(r.p), d: num(r.d), ...testValue('Kolmogorov-Smirnov test') },
      comparisons: [{ key: comparisonKey(A, B), a: A.ref, b: B.ref, p: r.p }],
    })
  },
}
