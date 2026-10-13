import {
  type AnalysisDef,
  type AnalysisResult,
  type Diagnostic,
  type FormField,
  type NormalizedDataSet,
  type Problem,
  pinDefaults,
  type ResultBlock,
  type ResultSheet,
  type ResultValue,
  survivalData,
} from '@ps/model'
import {
  adjustP,
  compareSurvival,
  type HazardRatio,
  type KaplanMeier,
  kaplanMeier,
  type SurvivalSubject,
  type SurvivalTest,
} from '@ps/stats'
import { z } from 'zod'
import {
  ALPHA,
  CONFIDENCE_FIELD,
  confidenceLevel,
  decided,
  exclusionNotes,
  failure,
  int,
  interval,
  kv,
  labelTable,
  num,
  pct,
  pick,
  problem,
  pSig,
  psum,
  pval,
  result,
  statText,
  table,
  testValue,
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

/**
 * Roadmap 51c (S16): one test chosen before the results — log-rank (the default) or
 * Gehan-Breslow-Wilcoxon (`all`: the three tests of analyses saved before 0.3.9, not offered);
 * the trend test only when asked for (ordered groups); pairwise log-rank (or GBW) tests with a
 * correction for three or more groups; one hazard ratio method, as group / control.
 */
export const survivalParams = {
  test: z.enum(['logRank', 'gehanBreslowWilcoxon', 'all']).default('logRank'),
  trend: z.boolean().default(false),
  pairwise: z.enum(['none', 'all', 'control']).default('none'),
  pairwiseMethod: z.enum(['holm', 'bonferroni', 'sidak', 'none']).default('holm'),
  /** The reference group of the hazard ratio and of pairwise comparisons ('' = the first). */
  control: z.string().default(''),
  hazardRatio: z.enum(['mantelHaenszel', 'logRank', 'both']).default('mantelHaenszel'),
}
export type SurvivalChoices = {
  test: 'logRank' | 'gehanBreslowWilcoxon' | 'all'
  trend: boolean
  pairwise: 'none' | 'all' | 'control'
  pairwiseMethod: 'holm' | 'bonferroni' | 'sidak' | 'none'
  control: string
  hazardRatio: 'mantelHaenszel' | 'logRank' | 'both'
}

/** Version 1 (before 0.3.9): every test, trend and both hazard ratios reported; kept. */
export const migrateSurvival = (raw: unknown, from: number): unknown =>
  from >= 2
    ? raw
    : pinDefaults(raw, [
        [['test'], 'all'],
        [['trend'], true],
        [['hazardRatio'], 'both'],
      ])

/** The fields of the test choices (`controlComponent`: the picker of the reference group). */
export const survivalFields = (controlComponent: string | null): readonly FormField[] =>
  [
    {
      path: ['test'],
      label: 'Compare the curves with',
      kind: 'radio',
      options: [
        { value: 'logRank', label: 'Log-rank (Mantel-Cox) test (recommended)' },
        { value: 'gehanBreslowWilcoxon', label: 'Gehan-Breslow-Wilcoxon test' },
      ],
    },
    {
      path: ['trend'],
      label: 'The groups are ordered (doses): also test for a trend (three or more groups)',
      kind: 'checkbox',
    },
    {
      path: ['pairwise'],
      label: 'Which groups differ? (three or more groups)',
      kind: 'radio',
      options: [
        { value: 'none', label: 'Only whether any curves differ' },
        { value: 'all', label: 'Compare every pair of groups' },
        { value: 'control', label: 'Compare each group with the reference group' },
      ],
    },
    {
      path: ['pairwiseMethod'],
      label: 'Correct the pairs’ P values',
      kind: 'select',
      options: [
        { value: 'holm', label: 'Holm (recommended)' },
        { value: 'bonferroni', label: 'Bonferroni' },
        { value: 'sidak', label: 'Šidák' },
        { value: 'none', label: 'No correction' },
      ],
      showIf: { path: ['pairwise'], in: ['all', 'control'] },
    },
    ...(controlComponent
      ? [
          {
            path: ['control'],
            label: 'Reference group (the hazard ratio is each group ÷ this one)',
            kind: 'custom',
            component: controlComponent,
          } as const,
        ]
      : []),
    {
      path: ['hazardRatio'],
      label: 'Hazard ratio',
      kind: 'radio',
      options: [
        { value: 'mantelHaenszel', label: 'Mantel-Haenszel (recommended)' },
        { value: 'logRank', label: 'Log-rank (observed / expected)' },
      ],
    },
  ] as const

const Params = z.object({
  eventCode: z.number().default(1),
  censoredCode: z.number().default(0),
  ciMethod,
  ...survivalParams,
  confidenceLevel,
})
type Params = z.infer<typeof Params>

/** Undefined values (a ratio that can't be computed) are shown as text. */
const maybe = (v: number, digits?: number): ResultValue =>
  Number.isFinite(v) ? num(v, digits) : text('Undefined')

/**
 * Roadmap 51d (U26): a median the curve never reaches (it never drops to 50%) is "Not reached",
 * and so is the open upper limit of its CI.
 */
const median = (v: number): ResultValue => (Number.isFinite(v) ? num(v) : text('Not reached'))
const medianCi = (lo: number, hi: number, level: number): ResultValue =>
  Number.isFinite(lo) && hi === Number.POSITIVE_INFINITY
    ? text(`${statText(lo)} to not reached`)
    : interval(lo, hi, level)

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
  version: 2,
  title: 'Survival curves',
  category: 'Survival analyses',
  description:
    'Kaplan-Meier survival curves with median survival, compared by the log-rank (Mantel-Cox), trend and Gehan-Breslow-Wilcoxon tests and the hazard ratio.',
  accepts: ['survival'],
  inputs: { min: 1, max: 64 },
  params: Params,
  migrateParams: migrateSurvival,
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
    ...survivalFields('dataset.control'),
    CONFIDENCE_FIELD,
  ],
  validate: validateSurvival,
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    if (params.eventCode === params.censoredCode)
      return failure('The event and censored codes must differ.', diagnostics)
    const titles = input.map((d) => d.title)
    const groups = input.map((ds) => subjectsOf(ds, params, diagnostics))
    return survivalResult(
      titles,
      groups,
      { ...params, control: pick(input, params.control) },
      diagnostics,
    )
  },
}

const TEST_TITLE = {
  logRank: 'Log-rank (Mantel-Cox) test',
  gehanBreslowWilcoxon: 'Gehan-Breslow-Wilcoxon test',
} as const
const PAIR_METHOD = {
  holm: 'Holm',
  bonferroni: 'Bonferroni',
  sidak: 'Šidák',
  none: 'no correction',
}

/**
 * Kaplan-Meier curves of the groups and their comparison (log-rank, trend, Gehan-Breslow-
 * Wilcoxon, hazard ratios), as sheets. Shared by survival tables and multiple-variables tables.
 */
export function survivalResult(
  titles: readonly string[],
  groups: readonly SurvivalSubject[][],
  params: { ciMethod: 'asymmetric' | 'symmetric'; confidenceLevel: number } & Omit<
    SurvivalChoices,
    'control'
  > & {
      /** Index of the reference group. */
      control: number
    },
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
    const all = params.test === 'all'
    const blocks: ResultBlock[] = []
    // S16: the test chosen in advance (all three only for analyses saved before 0.3.9).
    if (all || params.test === 'logRank') blocks.push(kv(TEST_TITLE.logRank, testRows(cmp.logRank)))
    if (cmp.logRankTrend && (all || params.trend))
      blocks.push(kv('Log-rank test for trend', testRows(cmp.logRankTrend)))
    if (all || params.test === 'gehanBreslowWilcoxon')
      blocks.push(kv(TEST_TITLE.gehanBreslowWilcoxon, testRows(cmp.gehanBreslowWilcoxon)))
    blocks.push(
      table(
        'Median survival',
        ['Group', 'Median survival', `${pct(level)} CI`],
        curves.map((c, i) => [
          text(titles[i]!),
          median(c.median.value),
          medianCi(c.median.lower, c.median.upper, level),
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
      if (params.hazardRatio === 'both') {
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
      } else {
        // S16: one method, one direction: the other group ÷ the reference group.
        const r = params.hazardRatio === 'logRank' ? lr : mh
        const flip = params.control === 1
        const [ref, other] = flip ? [b, a] : [a, b]
        blocks.push(
          kv(
            `Hazard ratio (${params.hazardRatio === 'logRank' ? 'log-rank' : 'Mantel-Haenszel'})`,
            [...ratioRows(`Ratio (${other}/${ref})`, flip ? recip(r) : r, level)],
          ),
        )
      }
      if (cmp.medianRatio) {
        // S16: its CI assumes exponential survival (said in the title).
        blocks.push(
          kv('Ratio of median survival times (CI assumes exponential survival)', [
            ...ratioRows(`Ratio (${b}/${a})`, cmp.medianRatio, level),
          ]),
        )
      }
      const shown = params.hazardRatio === 'logRank' ? lr : mh
      values.hazardRatio = num(
        params.hazardRatio !== 'both' && params.control === 1 ? 1 / shown.value : mh.value,
      )
    }
    sheets.push({ key: 'comparison', title: 'Curve comparison', blocks })
    const chosen = params.test === 'gehanBreslowWilcoxon' ? cmp.gehanBreslowWilcoxon : cmp.logRank
    values.p = pval(chosen.p)
    values.chiSq = num(chosen.chiSq)
    Object.assign(
      values,
      testValue(
        params.test === 'gehanBreslowWilcoxon'
          ? TEST_TITLE.gehanBreslowWilcoxon
          : TEST_TITLE.logRank,
      ),
    )
    // S16: which groups differ: the chosen test on each pair, corrected for the pairs.
    if (params.pairwise !== 'none' && groups.length >= 3)
      sheets.push(pairwiseSurvival(titles, groups, params))
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
        ['Median survival', curves.map((c) => median(c.median.value))],
      ]),
    ],
  })

  return result({ diagnostics, sheets, values })
}

/**
 * S16: pairwise comparisons of three or more curves — the chosen test (log-rank, or
 * Gehan-Breslow-Wilcoxon) on each pair's subjects alone, its P values corrected as one family
 * (as `survdiff` on each pair and `p.adjust`).
 */
function pairwiseSurvival(
  titles: readonly string[],
  groups: readonly SurvivalSubject[][],
  params: Pick<SurvivalChoices, 'test' | 'pairwise' | 'pairwiseMethod'> & { control: number },
): ResultSheet {
  const k = groups.length
  const pairs: [number, number][] = []
  if (params.pairwise === 'control') {
    for (let j = 0; j < k; j++) if (j !== params.control) pairs.push([params.control, j])
  } else for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs.push([i, j])
  const gbw = params.test === 'gehanBreslowWilcoxon'
  const tests = pairs.map(([i, j]) => {
    const c = compareSurvival([groups[i]!, groups[j]!])
    return gbw ? c.gehanBreslowWilcoxon : c.logRank
  })
  const raw = tests.map((t) => t.p)
  const adjusted = params.pairwiseMethod === 'none' ? raw : adjustP(raw, params.pairwiseMethod)
  const name = gbw ? 'Gehan-Breslow-Wilcoxon' : 'Log-rank'
  return {
    key: 'pairwise',
    title: 'Pairwise comparisons',
    blocks: [
      table(
        `${name} test of each pair (${PAIR_METHOD[params.pairwiseMethod]})`,
        [
          'Comparison',
          'Chi square',
          'P value',
          ...(params.pairwiseMethod === 'none' ? [] : ['Adjusted P value']),
          'Summary',
          `Significant (P < ${ALPHA})?`,
        ],
        pairs.map(([i, j], m) => [
          text(`${titles[j]} vs. ${titles[i]}`),
          num(tests[m]!.chiSq),
          pval(raw[m]!),
          ...(params.pairwiseMethod === 'none' ? [] : [pval(adjusted[m]!)]),
          psum(adjusted[m]!),
          decided(adjusted[m]! < ALPHA, adjusted[m]!),
        ]),
      ),
      {
        type: 'note',
        text: `Each pair is compared on its own subjects; the ${pairs.length} P values are one family${params.pairwiseMethod === 'none' ? ', not corrected' : `, corrected by ${PAIR_METHOD[params.pairwiseMethod]}`}.`,
      },
    ],
  }
}

/** Roadmap 51b (§4.6): survival curves' problems before computing — codes, subjects per group. */
function validateSurvival(input: readonly NormalizedDataSet[], params: Params): Problem | null {
  const diagnostics = exclusionNotes(input)
  if (params.eventCode === params.censoredCode)
    return problem('The event and censored codes must differ.', 'params', diagnostics)
  const groups = input.map((ds) => subjectsOf(ds, params, diagnostics))
  const empty = groups.findIndex((g) => g.length === 0)
  if (empty >= 0) return problem(`“${input[empty]!.title}” has no subjects.`, 'table', diagnostics)
  return null
}
