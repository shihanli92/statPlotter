import type { AnalysisDef, AnalysisResult, OutputDecl, ResultBlock, ResultValue } from '@ps/model'
import {
  andersonDarling,
  dagostinoPearson,
  kolmogorovSmirnovNormality,
  type NormalityTest,
  qqPlot,
  shapiroWilk,
} from '@ps/stats'
import { z } from 'zod'
import {
  ALPHA,
  decided,
  exclusionNotes,
  failure,
  int,
  labelTable,
  num,
  psum,
  pval,
  rawValues,
  result,
  text,
} from './common.ts'

const Params = z.object({
  distribution: z.enum(['normal', 'lognormal', 'both']).default('normal'),
  dagostino: z.boolean().default(true),
  andersonDarling: z.boolean().default(true),
  shapiroWilk: z.boolean().default(true),
  kolmogorovSmirnov: z.boolean().default(true),
  /**
   * A QQ plot on a graph of its own (Prism: actual values on X, the values a Gaussian sample
   * would have at the same ranks on Y, with the line of identity). Lognormal when only
   * lognormality is tested. Off by default here, so existing projects gain no graph.
   */
  qqPlot: z.boolean().default(false),
})
type Params = z.infer<typeof Params>

interface TestDef {
  key: 'dagostino' | 'andersonDarling' | 'shapiroWilk' | 'kolmogorovSmirnov'
  title: string
  stat: string
  /** Smallest n the method is defined for. */
  minN: number
  run: (x: Float64Array) => NormalityTest & { pAbove010?: boolean }
}

export const TESTS: readonly TestDef[] = [
  {
    key: 'dagostino',
    title: 'D’Agostino-Pearson omnibus normality test',
    stat: 'K2',
    minN: 8,
    run: dagostinoPearson,
  },
  {
    key: 'andersonDarling',
    title: 'Anderson-Darling test',
    stat: 'A2*',
    minN: 8,
    run: andersonDarling,
  },
  {
    key: 'shapiroWilk',
    title: 'Shapiro-Wilk normality test',
    stat: 'W',
    minN: 3,
    run: shapiroWilk,
  },
  {
    key: 'kolmogorovSmirnov',
    title: 'Kolmogorov-Smirnov normality test',
    stat: 'KS distance',
    minN: 5,
    run: kolmogorovSmirnovNormality,
  },
]

const na = text('N too small')
const NONE = text('—')

export function testBlock(
  t: TestDef,
  samples: (Float64Array | null)[],
  titles: string[],
  dist: string,
) {
  const results = samples.map((x) => (x && x.length >= t.minN ? t.run(x) : null))
  const passed = `Passed ${dist} test (alpha = ${ALPHA})?`
  // No P (e.g. every value identical): a dash rather than "passed".
  type Res = ReturnType<TestDef['run']>
  const cell = (r: Res | null, v: (r: Res) => ResultValue) =>
    !r ? na : r.pAbove010 || Number.isFinite(r.p) ? v(r) : NONE
  return labelTable(`${t.title}${dist === 'normality' ? '' : ' (lognormal)'}`, titles, [
    [t.stat, results.map((r) => cell(r, (r) => num(r.stat)))],
    // Lilliefors P is only accurate below 0.10; Prism then shows just "> 0.10".
    ['P value', results.map((r) => cell(r, (r) => (r.pAbove010 ? text('> 0.10') : pval(r.p))))],
    [passed, results.map((r) => cell(r, (r) => decided(!(r.p < ALPHA), r.p)))],
    ['P value summary', results.map((r) => cell(r, (r) => psum(r.p)))],
  ])
}

export const normalityDef: AnalysisDef<Params> = {
  id: 'normality',
  version: 1,
  title: 'Normality and lognormality tests',
  category: 'Column analyses',
  description:
    'Test whether each column was sampled from a Gaussian (or lognormal) distribution: D’Agostino-Pearson, Anderson-Darling, Shapiro-Wilk and Kolmogorov-Smirnov.',
  accepts: ['column'],
  inputs: { min: 1, max: 64 },
  params: Params,
  form: [
    {
      path: ['distribution'],
      label: 'Which distribution to test',
      kind: 'radio',
      options: [
        { value: 'normal', label: 'Normal (Gaussian)' },
        { value: 'lognormal', label: 'Lognormal' },
        { value: 'both', label: 'Both' },
      ],
    },
    {
      path: ['dagostino'],
      label: 'D’Agostino-Pearson omnibus test (recommended)',
      kind: 'checkbox',
    },
    { path: ['andersonDarling'], label: 'Anderson-Darling test', kind: 'checkbox' },
    { path: ['shapiroWilk'], label: 'Shapiro-Wilk test', kind: 'checkbox' },
    { path: ['kolmogorovSmirnov'], label: 'Kolmogorov-Smirnov test', kind: 'checkbox' },
    { path: ['qqPlot'], label: 'Create a QQ plot', kind: 'checkbox' },
  ],
  outputs: (keys, params) => {
    if (!params.qqPlot) return []
    const graph = {
      id: 'qq',
      name: 'QQ plot',
      xTitle: 'Actual',
      yTitle: params.distribution === 'lognormal' ? 'Predicted (lognormal)' : 'Predicted',
    }
    return [
      ...keys.map((k): OutputDecl => ({ key: `qq:${k}`, forDataSet: k, graph, mark: 'points' })),
      { key: 'qq:identity', graph },
    ]
  },
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    const titles = input.map((d) => d.title)
    const samples = input.map(rawValues)
    if (samples.some((s) => !s))
      return failure('Normality tests need raw values, not summary data.', diagnostics)
    const tests = TESTS.filter((t) => params[t.key])
    if (!tests.length) return failure('Choose at least one normality test.', diagnostics)

    const logSamples = samples.map((x) => {
      if (!x || x.some((v) => v <= 0)) return null
      return Float64Array.from(x, Math.log)
    })
    const wantLog = params.distribution !== 'normal'
    const nonPositive = samples.findIndex((x, i) => x && !logSamples[i])
    if (wantLog && nonPositive >= 0) {
      diagnostics.push({
        level: 'warning',
        message: `Lognormality can’t be tested for columns with zero or negative values (${titles[nonPositive]}).`,
      })
    }

    const blocks: ResultBlock[] = []
    if (params.distribution !== 'lognormal')
      for (const t of tests) blocks.push(testBlock(t, samples, titles, 'normality'))
    if (wantLog)
      for (const t of tests) blocks.push(testBlock(t, logSamples, titles, 'lognormality'))
    blocks.push(
      labelTable('Data analyzed', titles, [
        ['Number of values', samples.map((x) => int(x!.length))],
      ]),
    )
    const small = tests.filter((t) => samples.some((x) => x!.length < t.minN))
    if (small.length) {
      diagnostics.push({
        level: 'info',
        message: small.map((t) => `${t.title} needs n ≥ ${t.minN}.`).join(' '),
      })
    }
    const outputs: AnalysisResult['outputs'] = {}
    if (params.qqPlot) {
      const lognormal = params.distribution === 'lognormal'
      let lo = Number.POSITIVE_INFINITY
      let hi = Number.NEGATIVE_INFINITY
      input.forEach((ds, i) => {
        const x = samples[i]!
        if (x.length < 2 || (lognormal && !logSamples[i])) return
        const q = qqPlot(x, { lognormal })
        outputs[`qq:${ds.ref.key}`] = { title: ds.title, x: q.actual, y: q.predicted }
        for (const v of [...q.actual, ...q.predicted])
          if (Number.isFinite(v)) {
            lo = Math.min(lo, v)
            hi = Math.max(hi, v)
          }
      })
      if (lo <= hi) outputs['qq:identity'] = { title: 'Line of identity', x: [lo, hi], y: [lo, hi] }
    }
    return result({ blocks, diagnostics, outputs })
  },
}
