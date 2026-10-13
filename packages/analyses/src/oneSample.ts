import type { AnalysisDef, ResultBlock } from '@ps/model'
import { median, tTestOneSample, wilcoxonSignedRankOneSample } from '@ps/stats'
import { z } from 'zod'
import {
  ALPHA,
  alternativeFor,
  CONFIDENCE_FIELD,
  confidenceLevel,
  directionProblem,
  exclusionNotes,
  failure,
  int,
  interval,
  labelTable,
  num,
  oneTailedNotes,
  pct,
  predicted,
  predictedField,
  psum,
  pval,
  rawValues,
  result,
  significant,
  TAILS_FIELD,
  tails,
  testValue,
  text,
} from './common.ts'
import { migrateTails, P_METHOD_FIELD, pMethod } from './rank.ts'
import { validateOneSample } from './validators.ts'

const Params = z.object({
  test: z.enum(['t', 'wilcoxon']).default('t'),
  hypothetical: z.number().default(0),
  tails,
  predicted,
  pMethod,
  confidenceLevel,
})
type Params = z.infer<typeof Params>

export const oneSampleDef: AnalysisDef<Params> = {
  id: 'oneSample',
  version: 2,
  title: 'One sample t and Wilcoxon test',
  category: 'Column analyses',
  description:
    'Compare the mean (t test) or median (Wilcoxon signed-rank test) of each column with a hypothetical value.',
  accepts: ['column'],
  inputs: { min: 1, max: 64 },
  params: Params,
  migrateParams: migrateTails,
  form: [
    {
      path: ['test'],
      label: 'Test',
      kind: 'radio',
      options: [
        { value: 't', label: 'One sample t test (compare the mean)' },
        { value: 'wilcoxon', label: 'Wilcoxon signed-rank test (compare the median)' },
      ],
    },
    { path: ['hypothetical'], label: 'Hypothetical value', kind: 'number' },
    TAILS_FIELD,
    predictedField('Above the hypothetical value', 'Below the hypothetical value'),
    { ...P_METHOD_FIELD, showIf: { path: ['test'], in: ['wilcoxon'] } },
    CONFIDENCE_FIELD,
  ],
  validate: validateOneSample,
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    const unset = directionProblem(params, diagnostics)
    if (unset) return unset
    const titles = input.map((d) => d.title)
    const samples = input.map(rawValues)
    if (samples.some((s) => !s))
      return failure('This test needs raw values, not summary data.', diagnostics)
    const xs = samples as Float64Array[]
    const mu = params.hypothetical
    const level = params.confidenceLevel
    const tooSmall = xs.findIndex((x) => x.length < 2)
    if (tooSmall >= 0)
      return failure(`“${titles[tooSmall]}” needs at least two values.`, diagnostics)
    const sig = `Significant (P < ${ALPHA})?`
    const tailText = text(
      params.tails === 'two'
        ? 'Two-tailed'
        : params.predicted === 'observed'
          ? 'One-tailed (direction not stated)'
          : `One-tailed (predicted ${params.predicted === 'increase' ? 'above' : 'below'} ${mu})`,
    )
    // S1: one-tailed P in the direction stated; a warning when a data set went the other way.
    const words = [`above ${mu}`, `below ${mu}`] as const
    const against = (effect: number, p: number, title: string) =>
      oneTailedNotes(params, effect, p, words, `“${title}”`)

    let blocks: ResultBlock[]
    if (params.test === 't') {
      const rs = xs.map((x, k) => {
        const two = tTestOneSample(x, mu, { confLevel: level })
        const r = tTestOneSample(x, mu, {
          confLevel: level,
          alternative: alternativeFor(params.tails, params.predicted, two.mean - mu),
        })
        if (params.predicted !== 'observed' || k === 0)
          diagnostics.push(...against(two.mean - mu, r.p, titles[k]!))
        // One-tailed P, but the usual two-sided CI.
        return { ...r, diffLo: two.diffLo, diffHi: two.diffHi }
      })
      blocks = [
        labelTable('One sample t test', titles, [
          ['Theoretical mean', rs.map(() => num(mu))],
          ['Actual mean', rs.map((r) => num(r.mean))],
          ['Number of values', rs.map((r) => int(r.n))],
          ['t', rs.map((r) => num(r.t))],
          ['df', rs.map((r) => int(r.df))],
          ['P value', rs.map((r) => pval(r.p))],
          ['P value summary', rs.map((r) => psum(r.p))],
          [sig, rs.map((r) => significant(r.p))],
          ['One- or two-tailed P value?', rs.map(() => tailText)],
        ]),
        labelTable('How big is the discrepancy?', titles, [
          ['Discrepancy (actual − theoretical)', rs.map((r) => num(r.diff))],
          [`${pct(level)} CI of discrepancy`, rs.map((r) => interval(r.diffLo, r.diffHi, level))],
          ['R squared (partial eta squared)', rs.map((r) => num(r.rSquared))],
        ]),
      ]
    } else {
      const exact = params.pMethod === 'exactWhenPossible' ? 'auto' : false
      const rs = xs.map((x, k) => {
        const two = wilcoxonSignedRankOneSample(x, mu, { exact, confLevel: level })
        const r = wilcoxonSignedRankOneSample(x, mu, {
          exact,
          confLevel: level,
          alternative: alternativeFor(params.tails, params.predicted, two.hlEstimate - mu),
        })
        if (params.predicted !== 'observed' || k === 0)
          diagnostics.push(...against(two.hlEstimate - mu, r.p, titles[k]!))
        return { ...r, hlEstimate: two.hlEstimate, hlLo: two.hlLo, hlHi: two.hlHi }
      })
      blocks = [
        labelTable('Wilcoxon signed-rank test', titles, [
          ['Theoretical median', rs.map(() => num(mu))],
          ['Actual median', xs.map((x) => num(median(x)))],
          ['Number of values', rs.map((r) => int(r.n))],
          ['Sum of signed ranks (W)', rs.map((r) => num(r.W))],
          ['Sum of positive ranks', rs.map((r) => num(r.wPlus))],
          ['Sum of negative ranks', rs.map((r) => num(-r.wMinus))],
          ['P value', rs.map((r) => pval(r.p))],
          ['Exact or estimate?', rs.map((r) => text(r.method === 'exact' ? 'Exact' : 'Estimate'))],
          ['P value summary', rs.map((r) => psum(r.p))],
          [sig, rs.map((r) => significant(r.p))],
          ['One- or two-tailed P value?', rs.map(() => tailText)],
        ]),
        labelTable('How big is the discrepancy?', titles, [
          ['Discrepancy (actual median − theoretical)', xs.map((x) => num(median(x) - mu))],
          ['Hodges-Lehmann estimate of the discrepancy', rs.map((r) => num(r.hlEstimate - mu))],
          [
            `${pct(level)} CI of Hodges-Lehmann estimate`,
            rs.map((r) => interval(r.hlLo - mu, r.hlHi - mu, level)),
          ],
        ]),
      ]
    }
    return result({
      blocks,
      diagnostics,
      values: testValue(params.test === 't' ? 'One sample t test' : 'Wilcoxon signed-rank test'),
    })
  },
}
