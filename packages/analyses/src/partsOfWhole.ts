import type { AnalysisDef, AnalysisResult, NormalizedDataSet, ResultBlock } from '@ps/model'
import { binomialTest, chiSquareGoodnessOfFit } from '@ps/stats'
import { z } from 'zod'
import {
  exclusionNotes,
  failure,
  firstCol,
  int,
  kv,
  num,
  pRows,
  pval,
  result,
  table,
  text,
} from './common.ts'
import { rowName } from './grouped.ts'

// "Compare observed distribution with expected" (Prism's parts-of-whole analysis; Statistics
// Guide, "Compare observed and expected distributions"): each data set's rows are categories of
// counts, compared with expected counts or percentages entered in the dialog by the chi-square
// goodness-of-fit test (no Yates correction, as Prism) or, with exactly two categories, the exact
// binomial test (Prism "strongly recommends" it there; both one- and two-tailed P, the two-tailed
// by the method of small P values).

const Params = z.object({
  /** Expected values entered as counts or as percentages. */
  expectedAs: z.enum(['percentages', 'counts']).default('percentages'),
  /**
   * Expected value of each category, by table row (null: none entered, e.g. a row inserted
   * since); empty = equal for every category. Follows its rows (`ROW_PARAMS`).
   */
  expected: z.array(z.number().min(0).nullable()).default([]),
  /** With two categories: the binomial test (recommended) or chi-square. */
  test: z.enum(['binomial', 'chiSquare']).default('binomial'),
})
type Params = z.infer<typeof Params>

/** Relative tolerance on the expected total (percentages to 100, counts to the observed N). */
const TOTAL_TOL = 1e-3

function analyzeDataSet(
  ds: NormalizedDataSet,
  params: Params,
): { blocks: ResultBlock[]; p: number; chiSq?: number } | string {
  const col = firstCol(ds)
  const rows: number[] = []
  for (let r = 0; r < ds.rowCount; r++) if (!Number.isNaN(col[r] ?? Number.NaN)) rows.push(r)
  const name = `“${ds.title}”`
  if (rows.length < 2) return `${name} needs counts in at least two categories (rows).`
  const observed = rows.map((r) => col[r]!)
  if (observed.some((o) => !(Number.isInteger(o) && o >= 0)))
    return `${name} must hold counts: whole numbers, zero or more.`
  const N = observed.reduce((s, x) => s + x, 0)
  if (N === 0) return `${name} has no counts.`

  const entered = params.expected.length > 0
  const raw = rows.map((r) => (entered ? (params.expected[r] ?? Number.NaN) : 1))
  if (raw.some((e) => !(Number.isFinite(e) && e >= 0)))
    return `Enter an expected value for every category of ${name}.`
  const sumRaw = raw.reduce((s, x) => s + x, 0)
  if (!(sumRaw > 0)) return 'The expected values add up to zero.'
  if (entered) {
    const target = params.expectedAs === 'percentages' ? 100 : N
    if (Math.abs(sumRaw - target) > TOTAL_TOL * target) {
      return params.expectedAs === 'percentages'
        ? `The expected percentages add up to ${+sumRaw.toPrecision(8)}, not 100.`
        : `The expected counts add up to ${+sumRaw.toPrecision(8)}, but ${name} has ${N} observations.`
    }
  }
  const expected = raw.map((e) => (N * e) / sumRaw)
  if (expected.some((e, i) => e === 0 && observed[i]! > 0))
    return `A category of ${name} has observations but an expected value of zero.`

  const blocks: ResultBlock[] = []
  let p: number
  let chiSq: number | undefined
  if (rows.length === 2 && params.test === 'binomial') {
    const p0 = expected[0]! / N
    const b = binomialTest(observed[0]!, N, p0)
    const fewer = observed[0]! < expected[0]!
    p = b.p
    blocks.push(
      kv(`Binomial test, ${ds.title}`, [
        ...pRows(b.p, 'two', true),
        [
          `One-tailed P value (${fewer ? 'that many or fewer' : 'that many or more'} in ${rowName(ds, rows[0]!)})`,
          pval(fewer ? b.pLess : b.pGreater),
        ],
        ['Observed proportion', num(observed[0]! / N)],
        ['Expected proportion', num(p0)],
      ]),
    )
  } else {
    const g = chiSquareGoodnessOfFit(observed, expected)
    p = g.p
    chiSq = g.chiSq
    blocks.push(
      kv(`Chi-square goodness of fit, ${ds.title}`, [
        ...pRows(g.p, 'two', false).filter(([label]) => label !== 'One- or two-tailed P value?'),
        ['Chi-square', num(g.chiSq)],
        ['df', int(g.df)],
      ]),
    )
  }
  blocks.push(
    table(
      `Observed and expected, ${ds.title}`,
      ['Category', 'Observed', 'Expected', 'Observed %', 'Expected %', '(O − E)² / E'],
      rows.map((r, i) => {
        const o = observed[i]!
        const e = expected[i]!
        return [
          text(rowName(ds, r)),
          int(o),
          num(e),
          num((100 * o) / N),
          num((100 * e) / N),
          num(((o - e) * (o - e)) / e),
        ]
      }),
    ),
  )
  blocks.push(
    kv(`Data analyzed, ${ds.title}`, [
      ['Number of categories', int(rows.length)],
      ['Total', int(N)],
    ]),
  )
  return { blocks, p, ...(chiSq !== undefined ? { chiSq } : {}) }
}

export const goodnessOfFitDef: AnalysisDef<Params> = {
  id: 'goodnessOfFit',
  version: 1,
  title: 'Compare observed distribution with expected',
  category: 'Parts of whole analyses',
  description:
    'Compare counts in categories (rows) with expected counts or percentages: chi-square goodness of fit, or the exact binomial test with two categories.',
  accepts: ['partsOfWhole', 'column'],
  inputs: { min: 1, max: 64 },
  params: Params,
  form: [
    {
      path: ['expectedAs'],
      label: 'Enter the expected values as',
      kind: 'radio',
      options: [
        { value: 'percentages', label: 'Percentages (must total 100)' },
        { value: 'counts', label: 'Numbers of objects or events (must total the observed N)' },
      ],
    },
    {
      path: ['expected'],
      label: 'Expected values',
      kind: 'custom',
      component: 'gof.expected',
    },
    {
      path: ['test'],
      label: 'Test (two categories)',
      kind: 'radio',
      options: [
        { value: 'binomial', label: 'Binomial test (recommended)' },
        { value: 'chiSquare', label: 'Chi-square test' },
      ],
      help: 'With more than two categories the chi-square test is used.',
    },
  ],
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    const blocks: ResultBlock[] = []
    const values: AnalysisResult['values'] = {}
    for (const ds of input) {
      const r = analyzeDataSet(ds, params)
      if (typeof r === 'string') return failure(r, diagnostics)
      blocks.push(...r.blocks)
      if (input.length === 1) {
        values.p = pval(r.p)
        if (r.chiSq !== undefined) values.chiSq = num(r.chiSq)
      }
    }
    if (params.expected.length === 0)
      blocks.push({ type: 'note', text: 'Every category was expected to be equally likely.' })
    return result({ blocks, diagnostics, values })
  },
}
