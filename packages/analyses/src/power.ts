import type { AnalysisDef, AnalysisResult, ResultBlock, ResultValue } from '@ps/model'
import {
  powerAnova,
  powerCorrelation,
  powerLogRank,
  powerProportions,
  powerT,
  solveSampleSize,
  type Tails,
} from '@ps/stats'
import { z } from 'zod'
import { failure, int, kv, num, rawValues, result, resultsSheet, table, text } from './common.ts'

// Sample size and power (the "Sample size and power" tool): for a planned experiment, the
// sample size that gives the wanted power, or the power of a given sample size, with a power
// curve. The inputs are typed in; for t tests and one-way ANOVA they can instead come from pilot
// data in the analyzed columns.

const Params = z.object({
  design: z
    .enum(['unpairedT', 'pairedT', 'oneSampleT', 'anova', 'proportions', 'correlation', 'logRank'])
    .default('unpairedT'),
  solveFor: z.enum(['n', 'power']).default('n'),
  alpha: z.number().gt(0).lt(1).default(0.05),
  tails: z.enum(['two', 'one']).default('two'),
  /** Target power (solveFor 'n'). */
  power: z.number().gt(0).lt(1).default(0.8),
  /** Sample size (solveFor 'power'): per group, pairs, values, or events for the log-rank test. */
  n: z.number().gt(1).default(10),
  /** t tests: the difference to detect and the SD (of the values, or of the differences). */
  difference: z.number().default(1),
  sd: z.number().gt(0).default(1),
  /** Use the analyzed columns as pilot data (t tests: first two columns; ANOVA: every column). */
  fromData: z.boolean().default(false),
  groups: z.number().int().min(2).default(3),
  anovaInput: z.enum(['variances', 'cohensF']).default('variances'),
  /** Variance of the group means (n − 1 divisor) and within-group variance. */
  betweenVar: z.number().min(0).default(1),
  withinVar: z.number().gt(0).default(1),
  cohensF: z.number().min(0).default(0.25),
  p1: z.number().gt(0).lt(1).default(0.5),
  p2: z.number().gt(0).lt(1).default(0.25),
  r: z.number().gt(-1).lt(1).default(0.3),
  hazardRatio: z.number().gt(0).default(0.5),
  /** Log-rank: the chance that a subject has the event during the study (subjects = events / p). */
  eventProbability: z.number().gt(0).max(1).default(0.5),
})
type Params = z.infer<typeof Params>

const DESIGN: Record<Params['design'], string> = {
  unpairedT: 'Unpaired t test',
  pairedT: 'Paired t test',
  oneSampleT: 'One-sample t test',
  anova: 'One-way ANOVA',
  proportions: 'Compare two proportions',
  correlation: 'Correlation',
  logRank: 'Log-rank test (survival)',
}

const UNIT: Record<Params['design'], string> = {
  unpairedT: 'Sample size per group',
  pairedT: 'Number of pairs',
  oneSampleT: 'Sample size',
  anova: 'Sample size per group',
  proportions: 'Sample size per group',
  correlation: 'Number of pairs (X, Y)',
  logRank: 'Number of events',
}

const show = (d: Params['design']) => ({ path: ['design'], in: [d] as unknown[] })

/** The effect is estimated from the analyzed columns (else everything is typed in). */
const usesPilotData = (p: Params) =>
  p.fromData && ['unpairedT', 'pairedT', 'anova'].includes(p.design)

export const powerAnalysisDef: AnalysisDef<Params> = {
  id: 'powerAnalysis',
  version: 1,
  title: 'Sample size and power',
  category: 'Sample size and power',
  description:
    'Plan an experiment: the sample size needed for a wanted power, or the power of a given sample size, for t tests, one-way ANOVA, two proportions, a correlation or a log-rank test, with a power curve.',
  accepts: [
    'column',
    'xy',
    'grouped',
    'contingency',
    'survival',
    'partsOfWhole',
    'multipleVariables',
    'nested',
  ],
  inputs: { min: 0, max: 64 },
  usesData: usesPilotData,
  params: Params,
  form: [
    {
      path: ['design'],
      label: 'Planned analysis',
      kind: 'select',
      options: Object.entries(DESIGN).map(([value, label]) => ({ value, label })),
    },
    {
      path: ['solveFor'],
      label: 'Compute',
      kind: 'radio',
      options: [
        { value: 'n', label: 'The sample size for a given power' },
        { value: 'power', label: 'The power of a given sample size' },
      ],
    },
    {
      path: ['power'],
      label: 'Power (a fraction, e.g. 0.8)',
      kind: 'number',
      min: 0.01,
      max: 0.999,
      step: 0.05,
      showIf: { path: ['solveFor'], in: ['n'] },
    },
    {
      path: ['n'],
      label: 'Sample size (per group, pairs, values or events)',
      kind: 'number',
      min: 2,
      step: 1,
      showIf: { path: ['solveFor'], in: ['power'] },
    },
    {
      path: ['alpha'],
      label: 'Significance level (alpha)',
      kind: 'number',
      min: 0.0001,
      max: 0.5,
      step: 0.01,
    },
    {
      path: ['tails'],
      label: 'P value',
      kind: 'radio',
      options: [
        { value: 'two', label: 'Two-tailed (recommended)' },
        { value: 'one', label: 'One-tailed' },
      ],
      showIf: {
        path: ['design'],
        in: ['unpairedT', 'pairedT', 'oneSampleT', 'proportions', 'correlation', 'logRank'],
      },
    },
    {
      path: ['fromData'],
      label: 'Estimate the effect from the analyzed columns (pilot data)',
      kind: 'checkbox',
      showIf: { path: ['design'], in: ['unpairedT', 'pairedT', 'anova'] },
    },
    {
      path: ['difference'],
      label: 'Difference to detect (between means, or mean difference)',
      kind: 'number',
      showIf: [
        { path: ['design'], in: ['unpairedT', 'pairedT', 'oneSampleT'] },
        { path: ['fromData'], in: [false] },
      ],
    },
    {
      path: ['sd'],
      label: 'Standard deviation (of the values; of the differences for paired data)',
      kind: 'number',
      min: 0,
      showIf: [
        { path: ['design'], in: ['unpairedT', 'pairedT', 'oneSampleT'] },
        { path: ['fromData'], in: [false] },
      ],
    },
    {
      path: ['groups'],
      label: 'Number of groups',
      kind: 'number',
      min: 2,
      step: 1,
      showIf: [show('anova'), { path: ['fromData'], in: [false] }],
    },
    {
      path: ['anovaInput'],
      label: 'Effect given as',
      kind: 'radio',
      options: [
        { value: 'variances', label: 'Between-group and within-group variances' },
        { value: 'cohensF', label: 'Cohen’s f' },
      ],
      showIf: [show('anova'), { path: ['fromData'], in: [false] }],
    },
    {
      path: ['betweenVar'],
      label: 'Variance of the group means',
      kind: 'number',
      min: 0,
      showIf: [
        show('anova'),
        { path: ['anovaInput'], in: ['variances'] },
        { path: ['fromData'], in: [false] },
      ],
    },
    {
      path: ['withinVar'],
      label: 'Variance within groups',
      kind: 'number',
      min: 0,
      showIf: [
        show('anova'),
        { path: ['anovaInput'], in: ['variances'] },
        { path: ['fromData'], in: [false] },
      ],
    },
    {
      path: ['cohensF'],
      label: 'Cohen’s f (0.1 small, 0.25 medium, 0.4 large)',
      kind: 'number',
      min: 0,
      step: 0.05,
      showIf: [
        show('anova'),
        { path: ['anovaInput'], in: ['cohensF'] },
        { path: ['fromData'], in: [false] },
      ],
    },
    {
      path: ['p1'],
      label: 'Proportion in group 1',
      kind: 'number',
      min: 0,
      max: 1,
      step: 0.05,
      showIf: show('proportions'),
    },
    {
      path: ['p2'],
      label: 'Proportion in group 2',
      kind: 'number',
      min: 0,
      max: 1,
      step: 0.05,
      showIf: show('proportions'),
    },
    {
      path: ['r'],
      label: 'Correlation coefficient to detect',
      kind: 'number',
      min: -0.99,
      max: 0.99,
      step: 0.05,
      showIf: show('correlation'),
    },
    {
      path: ['hazardRatio'],
      label: 'Hazard ratio to detect',
      kind: 'number',
      min: 0,
      step: 0.1,
      showIf: show('logRank'),
    },
    {
      path: ['eventProbability'],
      label: 'Probability that a subject has the event during the study',
      kind: 'number',
      min: 0.01,
      max: 1,
      step: 0.05,
      showIf: show('logRank'),
    },
  ],
  outputs: () => [
    {
      key: 'curve',
      graph: {
        id: 'power',
        name: 'Power curve',
        xTitle: 'Sample size',
        yTitle: 'Power',
        yRange: [0, 1],
      },
    },
  ],
  run(input, params): AnalysisResult {
    const tails: Tails = params.tails === 'one' ? 1 : 2
    const alpha = params.alpha
    const inputs: [string, ResultValue][] = [
      ['Planned analysis', text(DESIGN[params.design])],
      ['Alpha', num(alpha)],
      ['Tails', text(tails === 2 ? 'Two-tailed' : 'One-tailed')],
    ]
    let pw: (n: number) => number
    let lo = 2
    let perGroup = 1
    const pilot = usesPilotData(params)
    const samples = input.map(rawValues)
    const pilotError = (need: number) =>
      samples.length < need || samples.some((s) => !s || s.length < 2)
        ? `Pilot data need ${need} or more columns of raw values, each with at least two values.`
        : null
    switch (params.design) {
      case 'unpairedT':
      case 'pairedT':
      case 'oneSampleT': {
        let delta = params.difference
        let sd = params.sd
        if (pilot) {
          const e = pilotError(2)
          if (e) return failure(e)
          const [a, b] = [samples[0]!, samples[1]!]
          if (params.design === 'unpairedT') {
            const ma = mean(a)
            const mb = mean(b)
            delta = mb - ma
            sd = Math.sqrt(
              ((a.length - 1) * variance(a) + (b.length - 1) * variance(b)) /
                (a.length + b.length - 2),
            )
          } else {
            const m = Math.min(a.length, b.length)
            const d = Float64Array.from({ length: m }, (_, i) => b[i]! - a[i]!)
            delta = mean(d)
            sd = Math.sqrt(variance(d))
          }
          inputs.push(['Estimated from', text(`${input[0]!.title} and ${input[1]!.title}`)])
        }
        const kind =
          params.design === 'unpairedT' ? 'two' : params.design === 'pairedT' ? 'paired' : 'one'
        perGroup = kind === 'two' ? 2 : 1
        inputs.push(
          ['Difference to detect', num(delta)],
          ['Standard deviation', num(sd)],
          ['Effect size (difference / SD)', num(delta / sd)],
        )
        if (!(Math.abs(delta) > 0)) return failure('The difference to detect must not be zero.')
        pw = (n) => powerT(n, delta, sd, alpha, kind, tails)
        break
      }
      case 'anova': {
        let k = params.groups
        let bv: number
        let wv: number
        if (pilot) {
          const e = pilotError(2)
          if (e) return failure(e)
          k = samples.length
          const means = samples.map((s) => mean(s!))
          bv = variance(Float64Array.from(means))
          const df = samples.reduce((s, x) => s + x!.length - 1, 0)
          wv = samples.reduce((s, x) => s + (x!.length - 1) * variance(x!), 0) / df
          inputs.push(['Estimated from', text(input.map((d) => d.title).join(', '))])
        } else if (params.anovaInput === 'cohensF') {
          wv = 1
          bv = (params.cohensF ** 2 * k) / (k - 1)
        } else {
          bv = params.betweenVar
          wv = params.withinVar
        }
        inputs.push(
          ['Number of groups', int(k)],
          ['Variance of the group means', num(bv)],
          ['Variance within groups', num(wv)],
          ['Cohen’s f', num(Math.sqrt((bv * (k - 1)) / k / wv))],
        )
        if (!(bv > 0))
          return failure('The group means must differ (between-group variance above zero).')
        perGroup = k
        pw = (n) => powerAnova(n, k, bv, wv, alpha)
        break
      }
      case 'proportions':
        inputs.push(['Proportion 1', num(params.p1)], ['Proportion 2', num(params.p2)])
        if (params.p1 === params.p2) return failure('The two proportions must differ.')
        perGroup = 2
        pw = (n) => powerProportions(n, params.p1, params.p2, alpha, tails)
        break
      case 'correlation':
        inputs.push(['Correlation to detect', num(params.r)])
        if (params.r === 0) return failure('The correlation to detect must not be zero.')
        lo = 4
        pw = (n) => powerCorrelation(n, params.r, alpha, tails)
        break
      case 'logRank':
        inputs.push(
          ['Hazard ratio', num(params.hazardRatio)],
          ['Probability of an event', num(params.eventProbability)],
        )
        if (params.hazardRatio === 1) return failure('The hazard ratio must differ from 1.')
        lo = 1
        pw = (n) => powerLogRank(n, params.hazardRatio, alpha, tails)
        break
    }
    const unit = UNIT[params.design]
    const results: [string, ResultValue][] = []
    let nShown: number
    if (params.solveFor === 'n') {
      const exact = solveSampleSize(pw, params.power, lo)
      if (!Number.isFinite(exact))
        return failure('That power can’t be reached with a sample size below 10⁹.')
      nShown = Math.ceil(exact - 1e-9)
      results.push(
        ['Target power', num(params.power)],
        [unit, int(nShown)],
        [`${unit} (exact)`, num(exact)],
        ['Power with that sample size', num(pw(nShown))],
      )
    } else {
      nShown = params.n
      results.push([unit, num(nShown)], ['Power', num(pw(nShown))])
    }
    if (params.design === 'logRank')
      results.push([
        'Number of subjects (events / probability)',
        int(Math.ceil(nShown / params.eventProbability - 1e-9)),
      ])
    else if (perGroup > 1) results.push(['Total sample size', int(nShown * perGroup)])
    // Power curve up to twice the sample size shown.
    const hiN = Math.max(lo + 4, Math.ceil(2 * nShown))
    const step = Math.max(1, Math.ceil((hiN - lo) / 200))
    const xs: number[] = []
    for (let n = lo; n <= hiN; n += step) xs.push(n)
    const ys = xs.map(pw)
    const tableRows = [0.5, 0.75, 1, 1.5, 2]
      .map((f) => Math.max(lo, Math.round(nShown * f)))
      .filter((n, i, a) => a.indexOf(n) === i)
      .map((n) => [int(n), num(pw(n))])
    const blocks: ResultBlock[] = [
      kv('Inputs', inputs),
      kv(params.solveFor === 'n' ? 'Sample size' : 'Power', results),
      table('Power at other sample sizes', [unit, 'Power'], tableRows),
      {
        type: 'note',
        text:
          params.design === 'proportions'
            ? 'Two proportions: normal approximation without continuity correction (as R’s power.prop.test).'
            : params.design === 'logRank'
              ? 'Log-rank test: Schoenfeld’s formula with equal allocation to the two groups.'
              : params.design === 'correlation'
                ? 'Correlation: Fisher’s z approximation.'
                : `Exact power from the noncentral ${params.design === 'anova' ? 'F' : 't'} distribution${tails === 2 && params.design !== 'anova' ? ' (both tails counted)' : ''}.`,
      },
    ]
    return result({
      sheets: [resultsSheet(blocks, 'Sample size and power')],
      values: { n: num(nShown), power: num(pw(nShown)) },
      outputs: { curve: { title: 'Power', x: xs, y: ys } },
    })
  },
}

function mean(a: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]!
  return s / a.length
}

function variance(a: ArrayLike<number>): number {
  const m = mean(a)
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i]! - m) ** 2
  return s / (a.length - 1)
}
