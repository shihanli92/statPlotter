import {
  type AnalysisDef,
  type AnalysisResult,
  type Diagnostic,
  normalizeTable,
  type ResultBlock,
  type ResultValue,
  type TableKind,
} from '@ps/model'
import { maxOf, minOf, proportionCI, quantile, reportProgress, substream } from '@ps/stats'
import { z } from 'zod'
import {
  CONFIDENCE_FIELD,
  confidenceLevel,
  failure,
  int,
  interval,
  kv,
  labelTable,
  num,
  pct,
  result,
  resultsSheet,
  table,
  text,
} from './common.ts'
import { buildTable, stableId } from './resultTable.ts'
import { SIMULATIONS } from './simulate.ts'

// Monte Carlo analysis (Prism's "Monte Carlo analysis"; Statistics Guide, "How to: Monte Carlo
// analyses"): a simulation (Simulate XY / column data / contingency table) and an analysis of
// its table are rerun many times, each time with new random numbers, and chosen results of the
// analysis are tabulated, one row per simulation — the Monte Carlo's result table, which other
// analyses (descriptive statistics, frequency distribution) and graphs can use. As in Prism a
// simulation can be counted as a "hit" when one or both of two conditions on its results hold
// (e.g. P < 0.05, or a confidence interval containing the true value), and the fraction of hits
// is reported with its confidence interval (Wilson/Brown, Prism's method for a proportion), out
// of all simulations or of those where the results were determined. Summaries of each tabulated
// value (mean, SD, percentiles, and for P values the fraction below α) are added.
//
// Design: the simulation and the analysis are embedded in the parameters (their ids and
// parameters), so the Monte Carlo is a pure function like every analysis and its result is
// cached like theirs; the dialog copies them from, and lets you edit them like, the analyses
// themselves. Simulation i uses the seed `substream(seed, i)`, so results are deterministic and
// simulation i is the same whatever the number of simulations.

const Condition = z.object({
  /** A result value key of the analysis (e.g. 'p', 'LogEC50:<data set>'). */
  value: z.string(),
  op: z.enum(['<', '<=', '>', '>=', '=', '<>']).default('<'),
  than: z.number().default(0.05),
})
type McCondition = z.infer<typeof Condition>

const Params = z.object({
  simulation: z
    .object({
      analysisId: z
        .enum(['simulateXY', 'simulateColumn', 'simulateContingency'])
        .default('simulateColumn'),
      params: z.record(z.string(), z.unknown()).default({}),
    })
    .default({ analysisId: 'simulateColumn', params: {} }),
  analysis: z
    .object({
      analysisId: z.string().default('ttest'),
      params: z.record(z.string(), z.unknown()).default({}),
      /** Data sets of the simulated table to analyze (table ids); [] = all. */
      dataSets: z.array(z.string()).default([]),
    })
    .default({ analysisId: 'ttest', params: {}, dataSets: [] }),
  simulations: z.number().int().min(1).max(100_000).default(1000),
  seed: z.number().int().default(1),
  /** Result values to tabulate (keys of the analysis' `values`). */
  tabulate: z.array(z.string()).default(['p']),
  /** Hits: up to two conditions, both or either. */
  hits: z
    .object({
      combine: z.enum(['both', 'either']).default('both'),
      conditions: z.array(Condition).max(2).default([]),
    })
    .default({ combine: 'both', conditions: [{ value: 'p', op: '<', than: 0.05 }] }),
  /** Denominator of the fraction of hits. */
  hitDenominator: z.enum(['all', 'determined']).default('all'),
  /** Summaries: fraction of tabulated P values below this. */
  alpha: z.number().gt(0).lt(1).default(0.05),
  confidenceLevel,
})
export type MonteCarloParams = z.infer<typeof Params>

/** A result value as a number (P values and estimates; booleans 1/0; NaN otherwise). */
function valueNumber(v: ResultValue | undefined): number {
  if (!v) return Number.NaN
  switch (v.kind) {
    case 'number':
    case 'integer':
    case 'pvalue':
    case 'pSummary':
      return v.v
    case 'bool':
      return v.v ? 1 : 0
    default:
      return Number.NaN
  }
}

function holds(v: number, c: McCondition): boolean {
  if (Number.isNaN(v)) return false
  switch (c.op) {
    case '<':
      return v < c.than
    case '<=':
      return v <= c.than
    case '>':
      return v > c.than
    case '>=':
      return v >= c.than
    case '=':
      return v === c.than
    case '<>':
      return v !== c.than
  }
}

/** One simulation and its analysis. */
interface McRun {
  result: AnalysisResult | null
  error?: string
  /** Titles of the simulated table's data sets, by id (for labels of result keys). */
  titles?: Map<string, string>
}

/**
 * Runs simulation i of a Monte Carlo analysis: the simulation with its i-th seed, then the
 * analysis of its table. `lookup` finds the analysis plugin (the registry).
 */
export function runSimulation(
  p: MonteCarloParams,
  i: number,
  lookup: (id: string) => AnalysisDef<unknown> | undefined,
): McRun {
  const sim = SIMULATIONS[p.simulation.analysisId]!
  const def = lookup(p.analysis.analysisId)
  if (!def) return { result: null, error: `Unknown analysis “${p.analysis.analysisId}”.` }
  const sp = sim.def.params.safeParse({ ...p.simulation.params, seed: substream(p.seed, i) })
  if (!sp.success) return { result: null, error: 'The simulation’s settings are not valid.' }
  const simResult = sim.def.run([], sp.data, sim.context)
  const simTable = simResult.table
  if (!simTable)
    return { result: null, error: simResult.diagnostics.at(-1)?.message ?? 'No table.' }
  const all = normalizeTable(simTable)
  const input = p.analysis.dataSets.length
    ? all.filter((d) => p.analysis.dataSets.includes(d.ref.key))
    : all
  const ap = def.params.safeParse(p.analysis.params)
  if (!ap.success) return { result: null, error: 'The analysis’ settings are not valid.' }
  const titles = new Map(simTable.dataSets.map((d) => [d.id as string, d.title]))
  try {
    return {
      titles,
      result: def.run(input, ap.data, {
        tableKind: simTable.tableKind as TableKind,
        xTitle: simTable.x?.title ?? null,
      }),
    }
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Mean, SD, SEM and type-6 percentiles of the finite values. */
function summary(v: number[]) {
  const x = v.filter(Number.isFinite)
  const n = x.length
  const mean = x.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
  return {
    n,
    mean,
    sd,
    sem: sd / Math.sqrt(n),
    q025: quantile(x, 0.025),
    median: quantile(x, 0.5),
    q975: quantile(x, 0.975),
    min: n ? minOf(x) : Number.NaN,
    max: n ? maxOf(x) : Number.NaN,
  }
}

const ALL_KINDS: readonly TableKind[] = [
  'column',
  'xy',
  'grouped',
  'contingency',
  'survival',
  'partsOfWhole',
  'multipleVariables',
  'nested',
]

/**
 * Simulations between two progress reports: one makes a table and analyzes it (tens of
 * microseconds for a t test, milliseconds for a curve fit), so a report every few is free.
 */
const MC_STRIDE = 8

/** The Monte Carlo analysis plugin, given the registry to find the analysis it repeats. */
export function makeMonteCarloDef(
  lookup: (id: string) => AnalysisDef<unknown> | undefined,
): AnalysisDef<MonteCarloParams> {
  return {
    id: 'monteCarlo',
    version: 1,
    title: 'Monte Carlo analysis',
    category: 'Simulate and generate',
    description:
      'Repeat a simulation and an analysis of it many times and tabulate chosen results (best-fit values, P values…) with their distribution, and the fraction of simulations that are “hits” (e.g. P < 0.05: the power) with its confidence interval.',
    accepts: ALL_KINDS,
    inputs: { min: 0, max: 64 },
    // Its simulation makes the data it analyzes.
    usesData: () => false,
    producesTable: true,
    params: Params,
    form: [
      { path: ['simulation'], label: 'Simulation', kind: 'custom', component: 'mc.simulation' },
      { path: ['analysis'], label: 'Analysis to repeat', kind: 'custom', component: 'mc.analysis' },
      {
        path: ['tabulate'],
        label: 'Results to tabulate',
        kind: 'custom',
        component: 'mc.tabulate',
      },
      { path: ['hits'], label: 'Hits', kind: 'custom', component: 'mc.hits' },
      {
        path: ['hitDenominator'],
        label: 'Fraction of hits out of',
        kind: 'radio',
        options: [
          { value: 'all', label: 'The total number of simulations' },
          { value: 'determined', label: 'The simulations where the result was determined' },
        ],
      },
      { path: ['simulations'], label: 'Number of simulations', kind: 'number', min: 1 },
      { path: ['seed'], label: 'Random seed', kind: 'custom', component: 'sim.seed' },
      {
        path: ['alpha'],
        label: 'Summaries: fraction of P values below',
        kind: 'number',
        min: 0,
        max: 1,
      },
      CONFIDENCE_FIELD,
    ],
    run(_input, p, _context, progress) {
      const def = lookup(p.analysis.analysisId)
      if (!def) return failure(`Unknown analysis “${p.analysis.analysisId}”.`)
      if (def.id === 'monteCarlo') return failure('A Monte Carlo analysis can’t repeat itself.')
      const keys = p.tabulate
      const conds = p.hits.conditions
      if (!keys.length && !conds.length)
        return failure('Choose the results to tabulate (or define hits).')
      const N = p.simulations
      const cols = keys.map(() => new Float64Array(N))
      const hit = new Float64Array(N)
      const determined = new Uint8Array(N)
      let failed = 0
      let firstError = ''
      const kinds = new Map<string, ResultValue['kind']>()
      const labels = new Map<string, string>()
      let titles: Map<string, string> | undefined
      for (let i = 0; i < N; i++) {
        // Roadmap 42: every MC_STRIDE simulations (each makes a table and analyzes it).
        reportProgress(progress, i, N, MC_STRIDE)
        const r = runSimulation(p, i, lookup)
        titles ??= r.titles
        const res = r.result
        if (!res || res.status === 'error') {
          failed++
          if (!firstError)
            firstError =
              r.error ?? res?.diagnostics.find((d) => d.level === 'error')?.message ?? 'failed'
          keys.forEach((_, j) => {
            cols[j]![i] = Number.NaN
          })
          hit[i] = Number.NaN
          continue
        }
        keys.forEach((k, j) => {
          const v = res.values[k]
          if (v && !kinds.has(k)) kinds.set(k, v.kind)
          cols[j]![i] = valueNumber(v)
        })
        const cv = conds.map((c) => valueNumber(res.values[c.value]))
        const det = cv.every((v) => !Number.isNaN(v))
        determined[i] = det ? 1 : 0
        if (conds.length) {
          const ok = conds.map((c, j) => holds(cv[j]!, c))
          hit[i] = (p.hits.combine === 'both' ? ok.every(Boolean) : ok.some(Boolean)) ? 1 : 0
        }
      }
      for (const k of keys) labels.set(k, labelOf(k, titles))
      const diagnostics: Diagnostic[] = []
      if (failed === N)
        return failure(`Every simulation’s analysis failed: ${firstError}`, diagnostics)
      if (failed)
        diagnostics.push({
          level: 'warning',
          message: `The analysis failed for ${failed} of ${N} simulations (${firstError}); they are blank.`,
        })
      const blocks: ResultBlock[] = [
        kv('Monte Carlo', [
          ['Simulation', text(SIMULATIONS[p.simulation.analysisId]!.def.title)],
          ['Analysis', text(def.title)],
          ['Number of simulations', int(N)],
          ['Random seed', int(p.seed)],
        ]),
      ]
      const values: AnalysisResult['values'] = {}
      if (keys.length) {
        const S = keys.map((_, j) => summary(Array.from(cols[j]!)))
        const anyP = keys.some((k) => kinds.get(k) === 'pvalue')
        const row = (label: string, f: (j: number) => ResultValue): ResultValue[] => [
          text(label),
          ...keys.map((_, j) => f(j)),
        ]
        const rows: ResultValue[][] = [
          row('Number of values', (j) => int(S[j]!.n)),
          row('Mean', (j) => num(S[j]!.mean)),
          row('SD', (j) => num(S[j]!.sd)),
          row('SEM', (j) => num(S[j]!.sem)),
          row('2.5th percentile', (j) => num(S[j]!.q025)),
          row('Median', (j) => num(S[j]!.median)),
          row('97.5th percentile', (j) => num(S[j]!.q975)),
          row('Minimum', (j) => num(S[j]!.min)),
          row('Maximum', (j) => num(S[j]!.max)),
        ]
        if (anyP)
          rows.push(
            row(`Fraction with P < ${p.alpha}`, (j) => {
              if (kinds.get(keys[j]!) !== 'pvalue') return text('—')
              const x = Array.from(cols[j]!).filter(Number.isFinite)
              return num(x.filter((v) => v < p.alpha).length / x.length)
            }),
          )
        blocks.push(table('Tabulated results', ['', ...keys.map((k) => labels.get(k)!)], rows))
        keys.forEach((k, j) => {
          values[`mean:${k}`] = num(S[j]!.mean)
          values[`sd:${k}`] = num(S[j]!.sd)
        })
      }
      if (conds.length) {
        const denom = p.hitDenominator === 'all' ? N : determined.reduce((a, b) => a + b, 0)
        const nHits = hit.reduce((a, b) => a + (b === 1 ? 1 : 0), 0)
        const ci = proportionCI(nHits, denom, { confLevel: p.confidenceLevel })
        const nci = proportionCI(denom - nHits, denom, { confLevel: p.confidenceLevel })
        const level = pct(p.confidenceLevel)
        const condText = conds
          .map((c) => `${labelOf(c.value, titles)} ${c.op} ${c.than}`)
          .join(p.hits.combine === 'both' ? ' and ' : ' or ')
        blocks.push(
          labelTable(
            `Fraction of hits (${condText})`,
            ['Fraction', `${level} CI`, 'Count'],
            [
              [
                'Hits',
                [num(ci.value), interval(ci.lower, ci.upper, p.confidenceLevel), int(nHits)],
              ],
              [
                'Not hits',
                [
                  num(nci.value),
                  interval(nci.lower, nci.upper, p.confidenceLevel),
                  int(denom - nHits),
                ],
              ],
            ],
          ),
          {
            type: 'note',
            text: `Out of ${denom} ${p.hitDenominator === 'all' ? 'simulations' : 'simulations whose results were determined'}; CI by the Wilson/Brown method.`,
          },
        )
        values.hitFraction = num(ci.value)
        values.hits = int(nHits)
      }
      const dataSets = keys.map((k, j) => ({
        id: stableId('mc', k),
        title: labels.get(k)!,
        subcolumns: [cols[j]!],
      }))
      if (conds.length)
        dataSets.push({
          id: stableId('mc', '\u0000hit'),
          title: 'Hit (1 = yes)',
          subcolumns: [hit],
        })
      return result({
        diagnostics,
        sheets: [resultsSheet(blocks, 'Monte Carlo')],
        values,
        table: buildTable([], {
          name: 'Monte Carlo results',
          tableKind: 'column',
          rowCount: N,
          rowTitles: null,
          x: null,
          dataSets,
          notes: `One row per simulation (seed ${p.seed}).`,
        }),
      })
    },
  }
}

/**
 * A readable label of a result value key: 'LogEC50:<data set id>' → 'LogEC50 (Data Set A)'
 * with the simulated table's titles.
 */
export function labelOf(key: string, titles?: ReadonlyMap<string, string>): string {
  const i = key.indexOf(':')
  if (i < 0) return key
  const rest = key.slice(i + 1)
  return `${key.slice(0, i)} (${titles?.get(rest) ?? rest})`
}
