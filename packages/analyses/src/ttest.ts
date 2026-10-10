import {
  type AnalysisDef,
  type AnalysisResult,
  pairedRows,
  type ResultBlock,
  type ResultValue,
} from '@ps/model'
import {
  cohensD,
  cohensDz,
  fTestVariances,
  mean,
  type StandardizedDifference,
  sd,
  tTestFromSummary,
  tTestPaired,
  tTestRatioPaired,
  tTestUnpaired,
} from '@ps/stats'
import { z } from 'zod'
import {
  ALPHA,
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
  pSig,
  psum,
  pval,
  rawValues,
  result,
  significant,
  summaryOf,
  summaryProblem,
  TAILS_FIELD,
  tails,
  text,
  tooFewDataSets,
  unpairedRowsNote,
} from './common.ts'

const Params = z.object({
  design: z.enum(['unpaired', 'paired']).default('unpaired'),
  unpaired: z.object({ assumeEqualSD: z.boolean().default(true) }).prefault({}),
  paired: z.object({ measure: z.enum(['difference', 'ratio']).default('difference') }).prefault({}),
  tails,
  confidenceLevel,
  reportFTestVariances: z.boolean().default(true),
})
type Params = z.infer<typeof Params>

export const ttest: AnalysisDef<Params> = {
  id: 'ttest',
  version: 1,
  title: 't test',
  category: 'Column analyses',
  description: 'Compare the means of two groups (unpaired, Welch, paired, or ratio paired t test).',
  accepts: ['column'],
  inputs: { min: 2, max: 2 },
  params: Params,
  form: [
    {
      path: ['design'],
      label: 'Experimental design',
      kind: 'radio',
      options: [
        { value: 'unpaired', label: 'Unpaired' },
        { value: 'paired', label: 'Paired (values in the same row are matched)' },
      ],
    },
    {
      path: ['unpaired', 'assumeEqualSD'],
      label: 'Assume both populations have the same SD (uncheck for Welch’s t test)',
      kind: 'checkbox',
      showIf: { path: ['design'], in: ['unpaired'] },
    },
    {
      path: ['paired', 'measure'],
      label: 'Paired effect',
      kind: 'radio',
      options: [
        { value: 'difference', label: 'Differences between pairs are consistent' },
        { value: 'ratio', label: 'Ratios between pairs are consistent (ratio paired t test)' },
      ],
      showIf: { path: ['design'], in: ['paired'] },
    },
    TAILS_FIELD,
    CONFIDENCE_FIELD,
    {
      path: ['reportFTestVariances'],
      label: 'Report F test comparing variances',
      kind: 'checkbox',
      showIf: [
        { path: ['design'], in: ['unpaired'] },
        { path: ['unpaired', 'assumeEqualSD'], in: [true] },
      ],
    },
  ],
  run(input, params) {
    const few = tooFewDataSets(input, 2, 'A t test compares two data sets.')
    if (few) return few
    const [A, B] = input as [(typeof input)[0], (typeof input)[0]]
    const notes = exclusionNotes(input)
    const level = pct(params.confidenceLevel)
    const columnsBlock = kv('Data sets', [
      ['Column A', text(A.title)],
      ['Column B', text(B.title)],
    ])
    const comparison = (p: number, value: number, lo: number, hi: number, label: string) => ({
      key: comparisonKey(A, B),
      a: A.ref,
      b: B.ref,
      p,
      estimate: { value, lo, hi, label },
    })

    if (params.design === 'paired') {
      const a = A.data.shape === 'replicates' ? A.data.reps[0]! : null
      const b = B.data.shape === 'replicates' ? B.data.reps[0]! : null
      if (!a || !b) return failure('A paired t test needs raw values, not summary data.', notes)
      const pairs = pairedRows(a, b)
      notes.push(...unpairedRowsNote(a, b))
      if (pairs.a.length < 2)
        return failure('A paired t test needs at least two complete pairs.', notes)

      if (params.paired.measure === 'ratio') {
        if ([...pairs.a, ...pairs.b].some((v) => v <= 0)) {
          return failure('A ratio paired t test needs all values to be positive.', notes)
        }
        const two = tTestRatioPaired(pairs.a, pairs.b, { confLevel: params.confidenceLevel })
        const r = tTestRatioPaired(pairs.a, pairs.b, {
          confLevel: params.confidenceLevel,
          alternative: alternativeFor(params.tails, two.mean),
        })
        noVariation(notes, r.p, 'the ratios are all identical')
        const blocks: ResultBlock[] = [
          columnsBlock,
          kv('Ratio paired t test', [
            ...pRows(r.p, params.tails),
            ['t', num(r.t)],
            ['df', int(r.df)],
            ['Number of pairs', int(r.n)],
          ]),
          kv('How big is the difference?', [
            ['Mean of log10(B/A)', num(r.mean)],
            [`${level} CI of log10(B/A)`, interval(two.ciLo, two.ciHi, params.confidenceLevel)],
            ['Geometric mean of ratios (B/A)', num(r.ratio)],
            [
              `${level} CI of ratio`,
              interval(two.ratioCiLo, two.ratioCiHi, params.confidenceLevel),
            ],
          ]),
        ]
        return result({
          blocks,
          diagnostics: notes,
          values: { p: pval(r.p), t: num(r.t), df: int(r.df), ratio: num(r.ratio) },
          comparisons: [
            comparison(r.p, r.ratio, two.ratioCiLo, two.ratioCiHi, 'Geometric mean ratio B/A'),
          ],
        })
      }

      const two = tTestPaired(pairs.a, pairs.b, { confLevel: params.confidenceLevel })
      const r = tTestPaired(pairs.a, pairs.b, {
        confLevel: params.confidenceLevel,
        alternative: alternativeFor(params.tails, two.mean),
      })
      noVariation(notes, r.p, 'the differences are all identical')
      const blocks: ResultBlock[] = [
        columnsBlock,
        kv('Paired t test', [
          ...pRows(r.p, params.tails),
          ['t', num(r.t)],
          ['df', int(r.df)],
          ['Number of pairs', int(r.n)],
        ]),
        kv('How big is the difference?', [
          ['Mean difference (B − A)', num(r.mean)],
          ['SD of differences', num(r.sd)],
          ['SEM of differences', num(r.se)],
          [`${level} confidence interval`, interval(two.ciLo, two.ciHi, params.confidenceLevel)],
          ['R squared (partial eta squared)', num(r.rSquared)],
          ...effectRows(cohensDz(r.mean, r.sd, r.n), true),
        ]),
      ]
      if (r.n >= 3) {
        blocks.push(
          kv('How effective was the pairing?', [
            ['Correlation coefficient (r)', num(r.pairingR)],
            ['P value (one-tailed)', pval(r.pairingP)],
            ['P value summary', psum(r.pairingP)],
            [`Was the pairing significantly effective (P < ${ALPHA})?`, significant(r.pairingP)],
          ]),
        )
      }
      return result({
        blocks,
        diagnostics: notes,
        values: { p: pval(r.p), t: num(r.t), df: int(r.df), diff: num(r.mean) },
        comparisons: [comparison(r.p, r.mean, two.ciLo, two.ciHi, 'Mean difference B − A')],
      })
    }

    // Unpaired: raw values, or summary data (mean, SD, N) for either column.
    const welch = !params.unpaired.assumeEqualSD
    const rawA = rawValues(A)
    const rawB = rawValues(B)
    const sumA = rawA ? null : summaryOf(A)
    const sumB = rawB ? null : summaryOf(B)
    for (const [ds, s] of [
      [A, sumA],
      [B, sumB],
    ] as const) {
      const problem = s && summaryProblem(ds, 0, 2)
      if (problem) return failure(problem, notes)
      if (s && (!Number.isFinite(s.sd) || !Number.isFinite(s.n))) {
        return failure(`“${ds.title}” needs mean, SD (or SEM) and N for a t test.`, notes)
      }
    }
    const nA = rawA ? rawA.length : sumA!.n
    const nB = rawB ? rawB.length : sumB!.n
    if (nA < 2 || nB < 2) return failure('Each group needs at least two values.', notes)

    const run = (alternative: 'two-sided' | 'less' | 'greater') => {
      const opts = { equalVariance: !welch, alternative, confLevel: params.confidenceLevel }
      if (rawA && rawB) return tTestUnpaired(rawA, rawB, opts)
      const s = (raw: Float64Array | null, sum: typeof sumA) =>
        raw ? { mean: mean(raw), sd: sd(raw), n: raw.length } : sum!
      return tTestFromSummary(s(rawA, sumA), s(rawB, sumB), opts)
    }
    const two = run('two-sided')
    const r = run(alternativeFor(params.tails, two.diff))
    noVariation(notes, r.p, 'both groups have the same mean and no variation')

    const blocks: ResultBlock[] = [
      columnsBlock,
      kv(welch ? 'Unpaired t test with Welch’s correction' : 'Unpaired t test', [
        ...pRows(r.p, params.tails),
        [welch ? 'Welch-corrected t' : 't', num(r.t)],
        ['df', welch ? num(r.df) : int(r.df)],
      ]),
      kv('How big is the difference?', [
        ['Mean of column A', num(r.meanA)],
        ['Mean of column B', num(r.meanB)],
        ['Difference between means (B − A)', num(r.diff)],
        ['SE of difference', num(r.seDiff)],
        [`${level} confidence interval`, interval(two.ciLo, two.ciHi, params.confidenceLevel)],
        ['R squared (eta squared)', num(r.rSquared)],
        ...effectRows(
          cohensD(
            { mean: r.meanA, sd: r.sdA, n: r.nA },
            { mean: r.meanB, sd: r.sdB, n: r.nB },
            r.diff,
          ),
          false,
        ),
      ]),
    ]
    if (params.reportFTestVariances && !welch && rawA && rawB) {
      const f = fTestVariances(rawA, rawB)
      blocks.push(
        kv('F test to compare variances', [
          ['F', num(f.F)],
          ['DFn, DFd', text(`${f.dfn}, ${f.dfd}`)],
          ...pSig(f.p, 'Significantly different'),
        ]),
      )
      if (f.p < ALPHA) {
        notes.push({
          level: 'warning',
          message:
            'The variances differ significantly (F test). Consider Welch’s t test, which does not assume equal SDs.',
        })
      }
    }
    blocks.push(
      kv('Data analyzed', [
        ['Sample size, column A', int(nA)],
        ['Sample size, column B', int(nB)],
      ]),
    )
    return result({
      blocks,
      diagnostics: notes,
      values: { p: pval(r.p), t: num(r.t), df: num(r.df), diff: num(r.diff) },
      comparisons: [comparison(r.p, r.diff, two.ciLo, two.ciHi, 'Difference between means B − A')],
    })
  },
}

/**
 * Standardized effect sizes (Prism 11 reports Cohen's d, Hedges' g and, unpaired, Glass's Δ):
 * paired designs use d_z (mean difference / SD of the differences).
 */
function effectRows(e: StandardizedDifference, paired: boolean): [string, ResultValue][] {
  return paired
    ? [
        ['Cohen’s d (d_z: mean difference / SD of differences)', num(e.cohensD)],
        ['Hedges’ g (g_z)', num(e.hedgesG)],
      ]
    : [
        ['Cohen’s d', num(e.cohensD)],
        ['Hedges’ g', num(e.hedgesG)],
        ['Glass’s delta (SD of column A)', num(e.glassDelta!)],
      ]
}

/** Degenerate data leave t = 0/0: keep the results but say why P is missing. */
function noVariation(notes: AnalysisResult['diagnostics'], p: number, why: string) {
  if (Number.isNaN(p))
    notes.push({ level: 'warning', message: `The t ratio can’t be computed: ${why}.` })
}
