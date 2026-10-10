import {
  type AnalysisDef,
  type AnalysisResult,
  type Diagnostic,
  type NormalizedDataSet,
  type ResultBlock,
  type ResultSheet,
  type ResultValue,
  survivalData,
} from '@ps/model'
import {
  compareSurvival,
  type HazardRatio,
  type KaplanMeier,
  kaplanMeier,
  type SurvivalSubject,
  type SurvivalTest,
} from '@ps/stats'
import { z } from 'zod'
import {
  CONFIDENCE_FIELD,
  confidenceLevel,
  exclusionNotes,
  failure,
  int,
  interval,
  kv,
  labelTable,
  num,
  pct,
  pSig,
  pval,
  result,
  table,
  text,
} from './common.ts'

/** How the CIs of the survival curves are computed. */
export const ciMethod = z.enum(['asymmetric', 'symmetric']).default('asymmetric')
export const CI_METHOD_FIELD = {
  path: ['ciMethod'],
  label: 'Confidence intervals of survival',
  kind: 'radio',
  options: [
    { value: 'asymmetric', label: 'Asymmetrical (transformed; recommended)' },
    { value: 'symmetric', label: 'Symmetrical' },
  ],
} as const

const Params = z.object({
  eventCode: z.number().default(1),
  censoredCode: z.number().default(0),
  ciMethod,
  confidenceLevel,
})
type Params = z.infer<typeof Params>

/** Undefined medians (the curve never drops to 50%) are shown as text, as Prism does. */
const maybe = (v: number, digits?: number): ResultValue =>
  Number.isFinite(v) ? num(v, digits) : text('Undefined')

function testRows(t: SurvivalTest): [string, ResultValue][] {
  return [
    ['Chi square', num(t.chiSq)],
    ['df', int(t.df)],
    ...pSig(t.p, 'Are the survival curves significantly different'),
  ]
}

function ratioRows(label: string, r: HazardRatio, level: number): [string, ResultValue][] {
  return [
    [label, maybe(r.value)],
    [`${pct(level)} CI of ratio`, interval(r.lower, r.upper, level)],
  ]
}

function survivalTable(title: string, km: KaplanMeier, level: number): ResultBlock {
  return table(
    title,
    [
      'Time',
      'Number at risk',
      'Events',
      'Censored',
      'Percent survival',
      'Standard error',
      `${pct(level)} CI`,
    ],
    km.steps.map((s) => [
      num(s.time),
      int(s.atRisk),
      int(s.events),
      int(s.censored),
      num(100 * s.survival),
      num(100 * s.se),
      interval(100 * s.lower, 100 * s.upper, level),
    ]),
  )
}

function subjectsOf(
  ds: NormalizedDataSet,
  params: Params,
  diagnostics: Diagnostic[],
): SurvivalSubject[] {
  const d = survivalData(ds, { event: params.eventCode, censored: params.censoredCode })
  if (d.missingTime > 0) {
    diagnostics.push({
      level: 'warning',
      message: `${ds.title}: ${d.missingTime} subject${d.missingTime > 1 ? 's have' : ' has'} no valid time (X) and ${d.missingTime > 1 ? 'were' : 'was'} ignored.`,
    })
  }
  if (d.invalidCode > 0) {
    diagnostics.push({
      level: 'warning',
      message: `${ds.title}: ${d.invalidCode} value${d.invalidCode > 1 ? 's are' : ' is'} neither ${params.eventCode} (event) nor ${params.censoredCode} (censored) and ${d.invalidCode > 1 ? 'were' : 'was'} ignored.`,
    })
  }
  return d.subjects.map(({ time, event }) => ({ time, event }))
}

export const survivalDef: AnalysisDef<Params> = {
  id: 'survival',
  version: 1,
  title: 'Survival curves',
  category: 'Survival analyses',
  description:
    'Kaplan-Meier survival curves with median survival, compared by the log-rank (Mantel-Cox), trend and Gehan-Breslow-Wilcoxon tests and the hazard ratio.',
  accepts: ['survival'],
  inputs: { min: 1, max: 64 },
  params: Params,
  form: [
    {
      path: ['eventCode'],
      label: 'Code for an event (death)',
      kind: 'number',
      step: 1,
    },
    {
      path: ['censoredCode'],
      label: 'Code for a censored subject',
      kind: 'number',
      step: 1,
    },
    CI_METHOD_FIELD,
    CONFIDENCE_FIELD,
  ],
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    if (params.eventCode === params.censoredCode)
      return failure('The event and censored codes must differ.', diagnostics)
    const titles = input.map((d) => d.title)
    const groups = input.map((ds) => subjectsOf(ds, params, diagnostics))
    return survivalResult(titles, groups, params, diagnostics)
  },
}

/**
 * Kaplan-Meier curves of the groups and their comparison (log-rank, trend, Gehan-Breslow-
 * Wilcoxon, hazard ratios), as sheets. Shared by survival tables and multiple-variables tables.
 */
export function survivalResult(
  titles: readonly string[],
  groups: readonly SurvivalSubject[][],
  params: { ciMethod: 'asymmetric' | 'symmetric'; confidenceLevel: number },
  diagnostics: Diagnostic[],
): AnalysisResult {
  const level = params.confidenceLevel
  const empty = groups.findIndex((g) => g.length === 0)
  if (empty >= 0) return failure(`“${titles[empty]}” has no subjects.`, diagnostics)

  const curves = groups.map((g) => kaplanMeier(g, { confLevel: level, ciMethod: params.ciMethod }))
  if (groups.length >= 2 && groups.every((g) => g.every((s) => !s.event)))
    diagnostics.push({
      level: 'warning',
      message: 'No events: every subject is censored, so the curves can’t be compared.',
    })
  const sheets: ResultSheet[] = []
  const values: AnalysisResult['values'] = {}

  if (groups.length >= 2) {
    const cmp = compareSurvival(groups, { confLevel: level })
    const blocks: ResultBlock[] = [kv('Log-rank (Mantel-Cox) test', testRows(cmp.logRank))]
    if (cmp.logRankTrend) blocks.push(kv('Log-rank test for trend', testRows(cmp.logRankTrend)))
    blocks.push(kv('Gehan-Breslow-Wilcoxon test', testRows(cmp.gehanBreslowWilcoxon)))
    blocks.push(
      table(
        'Median survival',
        ['Group', 'Median survival', `${pct(level)} CI`],
        curves.map((c, i) => [
          text(titles[i]!),
          maybe(c.median.value),
          interval(c.median.lower, c.median.upper, level),
        ]),
      ),
    )
    if (cmp.hazardRatio) {
      const [a, b] = titles
      const mh = cmp.hazardRatio.mantelHaenszel
      const lr = cmp.hazardRatio.logRank
      const recip = (r: HazardRatio): HazardRatio => ({
        value: 1 / r.value,
        lower: 1 / r.upper,
        upper: 1 / r.lower,
      })
      blocks.push(
        kv('Hazard ratio (Mantel-Haenszel)', [
          ...ratioRows(`Ratio (${b}/${a})`, mh, level),
          ...ratioRows(`Ratio (${a}/${b})`, recip(mh), level),
        ]),
        kv('Hazard ratio (log-rank)', [
          ...ratioRows(`Ratio (${b}/${a})`, lr, level),
          ...ratioRows(`Ratio (${a}/${b})`, recip(lr), level),
        ]),
      )
      if (cmp.medianRatio) {
        blocks.push(
          kv('Ratio of median survival times', [
            ...ratioRows(`Ratio (${b}/${a})`, cmp.medianRatio, level),
          ]),
        )
      }
      values.hazardRatio = num(mh.value)
    }
    sheets.push({ key: 'comparison', title: 'Curve comparison', blocks })
    values.p = pval(cmp.logRank.p)
    values.chiSq = num(cmp.logRank.chiSq)
  }

  sheets.push({
    key: 'survival',
    title: 'Survival proportions',
    blocks: curves.map((c, i) => survivalTable(titles[i]!, c, level)),
  })
  sheets.push({
    key: 'summary',
    title: 'Data summary',
    blocks: [
      labelTable('Data summary', titles, [
        ['Number of subjects', curves.map((c) => int(c.n))],
        ['Number of events', curves.map((c) => int(c.events))],
        ['Number censored', curves.map((c) => int(c.censored))],
        ['Median survival', curves.map((c) => maybe(c.median.value))],
      ]),
    ],
  })

  return result({ diagnostics, sheets, values })
}
