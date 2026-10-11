import { type AnalysisDef, pairedRows, type ResultBlock } from '@ps/model'
import { mannWhitney as mannWhitneyTest, wilcoxonSignedRank } from '@ps/stats'
import { z } from 'zod'
import {
  alternativeFor,
  CONFIDENCE_FIELD,
  comparisonKey,
  confidenceLevel,
  exclusionNotes,
  failure,
  int,
  interval,
  kv,
  num,
  pct,
  pRows,
  pval,
  rawValues,
  result,
  TAILS_FIELD,
  tails,
  text,
  tooFewDataSets,
  unpairedRowsNote,
} from './common.ts'

export const P_METHOD_FIELD = {
  path: ['pMethod'],
  label: 'Calculate P value',
  kind: 'radio',
  options: [
    { value: 'exactWhenPossible', label: 'Exact (when samples are small enough)' },
    { value: 'approximate', label: 'Approximate (normal approximation)' },
  ],
} as const

/** Rank sums and U/W are whole numbers unless ties give halves; show whole values plainly. */
const rankValue = (v: number) => (Number.isInteger(v) ? int(v) : num(v))

export const pMethod = z.enum(['exactWhenPossible', 'approximate']).default('exactWhenPossible')

// ---------------------------------------------------------------------------------------------

const MWParams = z.object({ tails, pMethod, confidenceLevel })
type MWParams = z.infer<typeof MWParams>

export const mannWhitney: AnalysisDef<MWParams> = {
  id: 'mannWhitney',
  version: 1,
  title: 'Mann-Whitney test',
  category: 'Column analyses',
  description:
    'Nonparametric comparison of two unpaired groups by ranks, with the Hodges-Lehmann estimate of the difference.',
  accepts: ['column'],
  inputs: { min: 2, max: 2 },
  params: MWParams,
  form: [TAILS_FIELD, P_METHOD_FIELD, CONFIDENCE_FIELD],
  run(input, params) {
    const few = tooFewDataSets(input, 2, 'The Mann-Whitney test compares two data sets.')
    if (few) return few
    const [A, B] = input as [(typeof input)[0], (typeof input)[0]]
    const notes = exclusionNotes(input)
    const a = rawValues(A)
    const b = rawValues(B)
    if (!a || !b) return failure('The Mann-Whitney test needs raw values, not summary data.', notes)
    if (a.length < 1 || b.length < 1 || a.length + b.length < 3) {
      return failure(
        'The Mann-Whitney test needs values in both groups (at least three in total).',
        notes,
      )
    }
    const exact = params.pMethod === 'exactWhenPossible' ? 'auto' : false
    const two = mannWhitneyTest(a, b, { exact, correct: true, confLevel: params.confidenceLevel })
    const oneSided = mannWhitneyTest(a, b, {
      exact,
      correct: true,
      confLevel: params.confidenceLevel,
      alternative: alternativeFor(params.tails, two.hlEstimate),
    })
    // One-tailed P, but the usual two-sided Hodges-Lehmann estimate and CI.
    const r = { ...oneSided, hlEstimate: two.hlEstimate, hlLo: two.hlLo, hlHi: two.hlHi }
    if (r.method === 'normal' && params.pMethod === 'exactWhenPossible') {
      notes.push({
        level: 'info',
        message: 'Samples are too large for an exact P value; the normal approximation was used.',
      })
    }
    const level = pct(params.confidenceLevel)
    const blocks: ResultBlock[] = [
      kv('Data sets', [
        ['Column A', text(A.title)],
        ['Column B', text(B.title)],
      ]),
      kv('Mann-Whitney test', [...pRows(r.p, params.tails, r.method === 'exact')]),
      kv('Ranks', [
        ['Sum of ranks in column A', rankValue(r.sumRanksA)],
        ['Sum of ranks in column B', rankValue(r.sumRanksB)],
        ['Mann-Whitney U', rankValue(r.U)],
      ]),
      kv('Difference between medians', [
        ['Median of column A', num(r.medianA)],
        ['Median of column B', num(r.medianB)],
        ['Difference: actual (B − A)', num(r.medianB - r.medianA)],
        ['Difference: Hodges-Lehmann', num(r.hlEstimate)],
        [
          `${level} CI of Hodges-Lehmann difference`,
          interval(r.hlLo, r.hlHi, params.confidenceLevel),
        ],
      ]),
      kv('Data analyzed', [
        ['Sample size, column A', int(a.length)],
        ['Sample size, column B', int(b.length)],
      ]),
    ]
    return result({
      blocks,
      diagnostics: notes,
      values: { p: pval(r.p), U: rankValue(r.U), hl: num(r.hlEstimate) },
      comparisons: [
        {
          key: comparisonKey(A, B),
          a: A.ref,
          b: B.ref,
          p: r.p,
          estimate: {
            value: r.hlEstimate,
            lo: r.hlLo,
            hi: r.hlHi,
            label: 'Hodges-Lehmann difference B − A',
          },
        },
      ],
    })
  },
}

// ---------------------------------------------------------------------------------------------

const WParams = z.object({
  tails,
  pMethod,
  zeroHandling: z.enum(['wilcoxon', 'pratt']).default('wilcoxon'),
  confidenceLevel,
})
type WParams = z.infer<typeof WParams>

export const wilcoxon: AnalysisDef<WParams> = {
  id: 'wilcoxon',
  version: 1,
  title: 'Wilcoxon matched-pairs signed rank test',
  category: 'Column analyses',
  description:
    'Nonparametric comparison of two paired groups (values in the same row are matched).',
  accepts: ['column'],
  inputs: { min: 2, max: 2 },
  params: WParams,
  form: [
    TAILS_FIELD,
    P_METHOD_FIELD,
    {
      path: ['zeroHandling'],
      label: 'Rows where the difference is zero',
      kind: 'radio',
      options: [
        { value: 'wilcoxon', label: 'Wilcoxon: ignore them' },
        { value: 'pratt', label: 'Pratt: include them when ranking' },
      ],
    },
    CONFIDENCE_FIELD,
  ],
  run(input, params) {
    const few = tooFewDataSets(input, 2, 'The Wilcoxon test compares two paired data sets.')
    if (few) return few
    const [A, B] = input as [(typeof input)[0], (typeof input)[0]]
    const notes = exclusionNotes(input)
    if (A.data.shape !== 'replicates' || B.data.shape !== 'replicates') {
      return failure('The Wilcoxon test needs raw paired values, not summary data.', notes)
    }
    const pairs = pairedRows(A.data.reps[0]!, B.data.reps[0]!)
    notes.push(...unpairedRowsNote(A.data.reps[0]!, B.data.reps[0]!))
    if (pairs.a.length < 2)
      return failure('The Wilcoxon test needs at least two complete pairs.', notes)

    const exact = params.pMethod === 'exactWhenPossible' ? 'auto' : false
    const opts = {
      zeroMethod: params.zeroHandling,
      exact,
      correct: true,
      confLevel: params.confidenceLevel,
    } as const
    const two = wilcoxonSignedRank(pairs.a, pairs.b, opts)
    const oneSided = wilcoxonSignedRank(pairs.a, pairs.b, {
      ...opts,
      alternative: alternativeFor(params.tails, two.hlEstimate),
    })
    const r = { ...oneSided, hlEstimate: two.hlEstimate, hlLo: two.hlLo, hlHi: two.hlHi }
    const zeros = pairs.a.length - r.nNonZero
    const level = pct(params.confidenceLevel)
    const blocks: ResultBlock[] = [
      kv('Data sets', [
        ['Column A', text(A.title)],
        ['Column B', text(B.title)],
      ]),
      kv('Wilcoxon matched-pairs signed rank test', [
        ...pRows(r.p, params.tails, r.method === 'exact'),
      ]),
      kv('Ranks', [
        ['Sum of positive ranks', rankValue(r.wPlus)],
        ['Sum of negative ranks', rankValue(-r.wMinus)],
        ['Sum of signed ranks (W)', rankValue(r.W)],
      ]),
      kv('Median of differences', [
        ['Median of differences (B − A)', num(r.medianDiff)],
        ['Hodges-Lehmann estimate', num(r.hlEstimate)],
        [
          `${level} CI of Hodges-Lehmann estimate`,
          interval(r.hlLo, r.hlHi, params.confidenceLevel),
        ],
      ]),
      kv('Data analyzed', [
        ['Number of pairs', int(pairs.a.length)],
        ['Number of pairs with difference 0', int(zeros)],
      ]),
    ]
    return result({
      blocks,
      diagnostics: notes,
      values: { p: pval(r.p), W: rankValue(r.W) },
      comparisons: [
        {
          key: comparisonKey(A, B),
          a: A.ref,
          b: B.ref,
          p: r.p,
          estimate: {
            value: r.hlEstimate,
            lo: r.hlLo,
            hi: r.hlHi,
            label: 'Hodges-Lehmann median difference B − A',
          },
        },
      ],
    })
  },
}
