import {
  type AnalysisDef,
  type AnalysisResult,
  type Check,
  type NormalizedDataSet,
  type Problem,
  pairedRows,
  pinDefaults,
  type ResultBlock,
  type ResultValue,
  valueAt,
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
  directionIssue,
  directionProblem,
  exclusionNotes,
  failure,
  int,
  interval,
  keyed,
  kv,
  minus,
  num,
  oneTailedNotes,
  PAIRED_NEEDS_RAW,
  PREDICTED_FIELD,
  pct,
  pinObservedDirection,
  pRows,
  predicted,
  predictedRows,
  problem,
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
  testValue,
  text,
  tooFewDataSets,
  unpairedRowsNote,
} from './common.ts'

const Params = z.object({
  design: z.enum(['unpaired', 'paired']).default('unpaired'),
  /** Roadmap 51c (S2): Welch's t test by default (version 2; saved analyses keep Student's). */
  unpaired: z.object({ assumeEqualSD: z.boolean().default(false) }).prefault({}),
  paired: z.object({ measure: z.enum(['difference', 'ratio']).default('difference') }).prefault({}),
  tails,
  predicted,
  confidenceLevel,
  /** Roadmap 51c (S2): the F test of variances only when asked for (an extra, not a pre-test). */
  reportFTestVariances: z.boolean().default(false),
})
type Params = z.infer<typeof Params>

/**
 * Version 1 (before 0.3.9): Student's t test and the F test of variances by default; one-tailed P
 * in the observed direction. Saved analyses keep them. A Welch analysis never showed the F test,
 * whatever its box said, so it stays off for those.
 */
export function migrateTTest(raw: unknown, from: number): unknown {
  if (from >= 2) return raw
  const welch =
    valueAt(raw, ['design']) !== 'paired' && valueAt(raw, ['unpaired', 'assumeEqualSD']) === false
  const pinned = pinDefaults(raw, [
    [['unpaired', 'assumeEqualSD'], true],
    [['reportFTestVariances'], true],
  ])
  if (welch) pinned.reportFTestVariances = false
  return pinObservedDirection(pinned)
}

/**
 * Roadmap 51b (§4.6): the t test's problems before computing — two data sets, a stated direction,
 * raw values and two complete pairs (paired), positive values (ratio), mean/SD/N and two values
 * per group (unpaired) — `run`'s failures, shown by the dialog before Analyze.
 */
export function validateTTest(input: readonly NormalizedDataSet[], params: Params): Problem | null {
  if (input.length < 2) return problem('A t test compares two data sets.', 'table')
  const [A, B] = input as [NormalizedDataSet, NormalizedDataSet]
  const notes = exclusionNotes(input)
  const unset = directionIssue(params, notes)
  if (unset) return unset
  if (params.design === 'paired') {
    const a = A.data.shape === 'replicates' ? A.data.reps[0]! : null
    const b = B.data.shape === 'replicates' ? B.data.reps[0]! : null
    if (!a || !b)
      return problem(
        `A paired t test needs raw values, not summary data.${PAIRED_NEEDS_RAW}`,
        'table',
        notes,
      )
    const pairs = pairedRows(a, b)
    const withPairs = [...notes, ...unpairedRowsNote(a, b)]
    if (pairs.a.length < 2)
      return problem('A paired t test needs at least two complete pairs.', 'table', withPairs)
    if (params.paired.measure === 'ratio' && [...pairs.a, ...pairs.b].some((v) => v <= 0))
      return problem('A ratio paired t test needs all values to be positive.', 'table', withPairs)
    return null
  }
  const rawA = rawValues(A)
  const rawB = rawValues(B)
  for (const ds of [A, B]) {
    const s = rawValues(ds) ? null : summaryOf(ds)
    const issue = s && summaryProblem(ds, 0, 2)
    if (issue) return problem(issue, 'table', notes)
    if (s && (!Number.isFinite(s.sd) || !Number.isFinite(s.n)))
      return problem(`“${ds.title}” needs mean, SD (or SEM) and N for a t test.`, 'table', notes)
  }
  const nA = rawA ? rawA.length : summaryOf(A)!.n
  const nB = rawB ? rawB.length : summaryOf(B)!.n
  if (nA < 2 || nB < 2) return problem('Each group needs at least two values.', 'table', notes)
  return null
}

/**
 * Roadmap 51b (§4.4 row 20): the values a ratio paired t test can't take, named (a note beside
 * the block, so the data can be edited).
 */
function ratioNotes(input: readonly NormalizedDataSet[], params: Params): Check[] {
  if (params.design !== 'paired' || params.paired.measure !== 'ratio' || input.length < 2) return []
  const out: string[] = []
  for (const d of input.slice(0, 2)) {
    if (d.data.shape !== 'replicates') continue
    const v = d.data.reps[0]!
    for (let r = 0; r < v.length && out.length < 4; r++)
      if (v[r]! <= 0) out.push(`row ${r + 1} of “${d.title}” is ${v[r]}`)
  }
  return out.length
    ? [{ level: 'note', message: `Not positive: ${out.join('; ')}.`, where: 'table' }]
    : []
}

export const ttest: AnalysisDef<Params> = {
  id: 'ttest',
  version: 2,
  title: 't test',
  category: 'Column analyses',
  description: 'Compare the means of two groups (unpaired, Welch, paired, or ratio paired t test).',
  accepts: ['column'],
  inputs: { min: 2, max: 2 },
  params: Params,
  migrateParams: migrateTTest,
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
      label: 'Can the groups vary by different amounts?',
      kind: 'radio',
      options: [
        { value: false, label: 'Yes, or not sure: Welch’s t test (recommended)' },
        { value: true, label: 'No, equal scatter is known: Student’s t test' },
      ],
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
    PREDICTED_FIELD,
    CONFIDENCE_FIELD,
    {
      path: ['reportFTestVariances'],
      label: 'Also report the F test comparing the variances',
      kind: 'checkbox',
      showIf: [{ path: ['design'], in: ['unpaired'] }],
    },
  ],
  validate: validateTTest,
  check: ratioNotes,
  run(input, params) {
    const few = tooFewDataSets(input, 2, 'A t test compares two data sets.')
    if (few) return few
    const [A, B] = input as [(typeof input)[0], (typeof input)[0]]
    const notes = exclusionNotes(input)
    const unset = directionProblem(params, notes)
    if (unset) return unset
    const level = pct(params.confidenceLevel)
    // S1: the direction stated before the experiment, in the data sets' names (B − A).
    const words = [`${B.title} higher than ${A.title}`, `${B.title} lower than ${A.title}`] as const
    const tailRows = (p: number) => [...pRows(p, params.tails), ...predictedRows(params, words)]
    // Roadmap 51d (U19, U20): the groups in their names, the sign spelled out.
    const [nameA, nameB] = [A.title, B.title]
    const columnsBlock = kv('Data sets', [['Difference', text(minus(nameB, nameA)), 'compared']])
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
      if (!a || !b)
        return failure(
          `A paired t test needs raw values, not summary data.${PAIRED_NEEDS_RAW}`,
          notes,
        )
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
          alternative: alternativeFor(params.tails, params.predicted, two.mean),
        })
        noVariation(notes, r.p, 'the ratios are all identical')
        notes.push(...oneTailedNotes(params, two.mean, r.p, words, 'The ratio'))
        const blocks: ResultBlock[] = [
          columnsBlock,
          kv('Ratio paired t test', [
            ...tailRows(r.p),
            ['t', num(r.t)],
            ['df', int(r.df)],
            ['Number of pairs', int(r.n), 'pairs'],
          ]),
          keyed(
            kv('How big is the difference?', [
              [`Mean of log10(${nameB}/${nameA})`, num(r.mean), 'logRatio'],
              [
                `${level} CI of log10(${nameB}/${nameA})`,
                interval(two.ciLo, two.ciHi, params.confidenceLevel),
                'logRatioCi',
              ],
              [`Geometric mean of ratios (${nameB}/${nameA})`, num(r.ratio), 'ratio'],
              [
                `${level} CI of ratio`,
                interval(two.ratioCiLo, two.ratioCiHi, params.confidenceLevel),
                'ratioCi',
              ],
            ]),
            'effect',
          ),
        ]
        return result({
          blocks,
          diagnostics: notes,
          values: {
            p: pval(r.p),
            t: num(r.t),
            df: int(r.df),
            ratio: num(r.ratio),
            ...testValue('Ratio paired t test'),
          },
          comparisons: [
            comparison(r.p, r.ratio, two.ratioCiLo, two.ratioCiHi, 'Geometric mean ratio B/A'),
          ],
        })
      }

      const two = tTestPaired(pairs.a, pairs.b, { confLevel: params.confidenceLevel })
      const r = tTestPaired(pairs.a, pairs.b, {
        confLevel: params.confidenceLevel,
        alternative: alternativeFor(params.tails, params.predicted, two.mean),
      })
      noVariation(notes, r.p, 'the differences are all identical')
      notes.push(...oneTailedNotes(params, two.mean, r.p, words))
      const blocks: ResultBlock[] = [
        columnsBlock,
        kv('Paired t test', [
          ...tailRows(r.p),
          ['t', num(r.t)],
          ['df', int(r.df)],
          ['Number of pairs', int(r.n), 'pairs'],
        ]),
        keyed(
          kv('How big is the difference?', [
            [`Mean difference (${minus(nameB, nameA)})`, num(r.mean), 'diff'],
            ['SD of differences', num(r.sd)],
            ['SEM of differences', num(r.se)],
            [
              `${level} confidence interval`,
              interval(two.ciLo, two.ciHi, params.confidenceLevel),
              'ci',
            ],
            ['R squared (partial eta squared)', num(r.rSquared)],
            ...effectRows(cohensDz(r.mean, r.sd, r.n), true, nameA),
          ]),
          'effect',
        ),
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
        values: {
          p: pval(r.p),
          t: num(r.t),
          df: int(r.df),
          diff: num(r.mean),
          ...testValue('Paired t test'),
        },
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
    const r = run(alternativeFor(params.tails, params.predicted, two.diff))
    noVariation(notes, r.p, 'both groups have the same mean and no variation')
    notes.push(...oneTailedNotes(params, two.diff, r.p, words))

    const blocks: ResultBlock[] = [
      columnsBlock,
      kv(welch ? 'Unpaired t test with Welch’s correction' : 'Unpaired t test', [
        ...tailRows(r.p),
        [welch ? 'Welch-corrected t' : 't', num(r.t)],
        ['df', welch ? num(r.df) : int(r.df)],
      ]),
      keyed(
        kv('How big is the difference?', [
          [`Mean of ${nameA}`, num(r.meanA), 'meanA'],
          [`Mean of ${nameB}`, num(r.meanB), 'meanB'],
          [`Difference between means (${minus(nameB, nameA)})`, num(r.diff), 'diff'],
          ['SE of difference', num(r.seDiff)],
          [
            `${level} confidence interval`,
            interval(two.ciLo, two.ciHi, params.confidenceLevel),
            'ci',
          ],
          ['R squared (eta squared)', num(r.rSquared)],
          ...effectRows(
            cohensD(
              { mean: r.meanA, sd: r.sdA, n: r.nA },
              { mean: r.meanB, sd: r.sdB, n: r.nB },
              r.diff,
            ),
            false,
            nameA,
          ),
        ]),
        'effect',
      ),
    ]
    // S2: the scatter of each group, described (not a test that picks one); the F test only
    // when asked for, and never a prompt to switch tests after the result.
    const [big, small] = r.sdA >= r.sdB ? [r.sdA, r.sdB] : [r.sdB, r.sdA]
    blocks.push(
      kv('Scatter in each group', [
        [`SD of ${A.title}`, num(r.sdA)],
        [`SD of ${B.title}`, num(r.sdB)],
        ['Ratio of SDs (larger / smaller)', num(big / small)],
      ]),
      {
        type: 'note',
        text: welch
          ? 'Welch’s t test doesn’t assume the two groups vary by the same amount. The ratio of SDs describes the data; it doesn’t choose the test.'
          : 'Student’s t test assumes the two groups vary by the same amount (chosen before the analysis). The ratio of SDs describes the data; it doesn’t choose the test.',
      },
    )
    if (params.reportFTestVariances && rawA && rawB) {
      const f = fTestVariances(rawA, rawB)
      blocks.push(
        kv('F test to compare variances', [
          ['F', num(f.F)],
          ['DFn, DFd', text(`${f.dfn}, ${f.dfd}`)],
          ...pSig(f.p, 'Significantly different'),
        ]),
      )
    }
    blocks.push(
      kv('Data analyzed', [
        [`Sample size, ${nameA}`, int(nA), 'nA'],
        [`Sample size, ${nameB}`, int(nB), 'nB'],
      ]),
    )
    return result({
      blocks,
      diagnostics: notes,
      values: {
        p: pval(r.p),
        t: num(r.t),
        df: num(r.df),
        diff: num(r.diff),
        ...testValue(welch ? 'Welch’s t test' : 'Student’s t test'),
      },
      comparisons: [comparison(r.p, r.diff, two.ciLo, two.ciHi, 'Difference between means B − A')],
    })
  },
}

/**
 * Standardized effect sizes (Cohen's d, Hedges' g and, unpaired, Glass's Δ):
 * paired designs use d_z (mean difference / SD of the differences).
 */
function effectRows(
  e: StandardizedDifference,
  paired: boolean,
  nameA: string,
): [string, ResultValue, string][] {
  return paired
    ? [
        ['Cohen’s d (d_z: mean difference / SD of differences)', num(e.cohensD), 'cohensD'],
        ['Hedges’ g (g_z)', num(e.hedgesG), 'hedgesG'],
      ]
    : [
        // S43: d standardizes by the pooled SD whichever test was run (decision 54).
        ['Cohen’s d (pooled SD)', num(e.cohensD), 'cohensD'],
        ['Hedges’ g (pooled SD)', num(e.hedgesG), 'hedgesG'],
        [`Glass’s delta (SD of ${nameA})`, num(e.glassDelta!), 'glassDelta'],
      ]
}

/** Degenerate data leave t = 0/0: keep the results but say why P is missing. */
function noVariation(notes: AnalysisResult['diagnostics'], p: number, why: string) {
  if (Number.isNaN(p))
    notes.push({ level: 'warning', message: `The t ratio can’t be computed: ${why}.` })
}
