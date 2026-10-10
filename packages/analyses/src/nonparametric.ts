import type { AnalysisDef, Comparison, ResultBlock } from '@ps/model'
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
  rawValues,
  result,
  resultsSheet,
  significant,
  table,
  text,
  tooFewDataSets,
} from './common.ts'

// ---------------------------------------------------------------------------------------------
// Friedman test (matched / repeated measures, nonparametric)
// ---------------------------------------------------------------------------------------------

const FriedmanParams = z.object({
  comparisons: z.enum(['none', 'allPairs', 'vsControl']).default('allPairs'),
  /** Data set key of the control; empty = the first analyzed data set. */
  control: z.string().default(''),
  correction: z.enum(['dunn', 'none']).default('dunn'),
})
type FriedmanParams = z.infer<typeof FriedmanParams>

export const friedmanDef: AnalysisDef<FriedmanParams> = {
  id: 'friedman',
  version: 1,
  title: 'Friedman test',
  category: 'Column analyses',
  description:
    'Nonparametric comparison of three or more matched groups (each row is one subject), with Dunn’s multiple comparisons.',
  accepts: ['column'],
  inputs: { min: 3, max: 64 },
  params: FriedmanParams,
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
      options: [
        { value: 'dunn', label: 'Dunn’s test (recommended)' },
        { value: 'none', label: 'Uncorrected Dunn’s test' },
      ],
      showIf: { path: ['comparisons'], in: ['allPairs', 'vsControl'] },
    },
  ],
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    const titles = input.map((d) => d.title)
    if (input.some((d) => d.data.shape !== 'replicates'))
      return failure('The Friedman test needs raw values, not summary data.', diagnostics)
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
        [`Are the medians significantly different (P < ${ALPHA})?`, significant(p)],
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
      const cmp = dunnFriedmanComparisons(fr, pairs, {
        method: params.correction === 'dunn' ? 'bonferroni' : 'none',
      })
      sheets.push({
        key: 'comparisons',
        title: 'Multiple comparisons',
        blocks: [
          table(
            params.correction === 'dunn'
              ? 'Dunn’s multiple comparisons test'
              : 'Uncorrected Dunn’s test',
            [
              'Comparison',
              'Rank sum diff.',
              'Significant?',
              'Summary',
              params.correction === 'dunn' ? 'Adjusted P Value' : 'P Value',
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
    return result({ diagnostics, sheets, values: { p: pval(p), stat: num(fr.stat) }, comparisons })
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
        kv('Data sets', [
          ['Column A', text(A.title)],
          ['Column B', text(B.title)],
        ]),
        kv('Kolmogorov-Smirnov test', [
          ...pRows(r.p, 'two', r.exact),
          ['Kolmogorov-Smirnov D', num(r.d)],
        ]),
        kv('Data analyzed', [
          ['Sample size, column A', int(a.length)],
          ['Sample size, column B', int(b.length)],
          ['Median of column A', num(median(a))],
          ['Median of column B', num(median(b))],
        ]),
      ],
      values: { p: pval(r.p), d: num(r.d) },
      comparisons: [{ key: comparisonKey(A, B), a: A.ref, b: B.ref, p: r.p }],
    })
  },
}
