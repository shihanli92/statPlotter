import type { AnalysisDef, Comparison, ResultSheet, ResultValue } from '@ps/model'
import {
  brownForsytheAnova,
  type DunnRow,
  dunnComparisons,
  type GroupData,
  kruskalWallis,
  type McRow,
  multipleComparisons,
  oneWayAnova,
  welchAnova,
  welchComparisons,
} from '@ps/stats'
import { z } from 'zod'
import {
  ALL_PAIRS_METHODS,
  allPairsMethod,
  COMPARE_COLUMNS,
  CONTROL_FIELD,
  CONTROL_METHODS,
  comparisonTable,
  controlMethod,
  dunnTable,
  EQUAL_SD_FIELD,
  equalSD,
  METHOD_TITLE,
  NO_COMPARISONS,
  oneWayPairs,
  pairComparisons,
  WELCH_METHODS,
  welchMethod,
} from './anovaCommon.ts'
import {
  ALPHA,
  CONFIDENCE_FIELD,
  confidenceLevel,
  dfText,
  exclusionNotes,
  failure,
  int,
  kv,
  num,
  psum,
  pval,
  result,
  resultsSheet,
  significant,
  summaryProblem,
  table,
  text,
} from './common.ts'
import { cellGroup, cellHasData, rowTitleOf } from './grouped.ts'

// ---------------------------------------------------------------------------------------------
// Multiple one-way ANOVAs: one ANOVA (or Kruskal-Wallis test) per row of a grouped table, each
// row's data sets being the groups; multiple comparisons within each row (each row is a family).
// ---------------------------------------------------------------------------------------------

const Params = z.object({
  gaussian: z.boolean().default(true),
  equalSD: equalSD.default('yes'),
  comparisons: z.enum(['none', 'allPairs', 'vsControl']).default('allPairs'),
  /** Data set key of the control; empty = the first analyzed data set. */
  control: z.string().default(''),
  allPairsMethod: allPairsMethod.default('tukey'),
  controlMethod: controlMethod.default('dunnett'),
  welchMethod: welchMethod.default('dunnett-t3'),
  confidenceLevel,
})
type Params = z.infer<typeof Params>

const gaussianEqual = [
  { path: ['gaussian'], in: [true] },
  { path: ['equalSD'], in: ['yes'] },
] as const

type RowResult = {
  row: number
  name: string
  F: number
  dfn: number
  dfd: number
  p: number
  r2?: number
  groups: { n: number; mean: number }[]
}

export const multipleOneWayDef: AnalysisDef<Params> = {
  id: 'multipleOneWay',
  version: 1,
  title: 'Multiple one-way ANOVAs',
  category: 'Grouped analyses',
  description:
    'One one-way ANOVA per row (ordinary, Welch, Brown-Forsythe or Kruskal-Wallis), comparing the data sets within each row, with multiple comparisons in each row.',
  accepts: ['grouped'],
  inputs: { min: 3, max: Number.POSITIVE_INFINITY },
  params: Params,
  form: [
    {
      path: ['gaussian'],
      label: 'Assume Gaussian distribution of residuals?',
      kind: 'radio',
      options: [
        { value: true, label: 'Yes — use ANOVA' },
        { value: false, label: 'No — use a nonparametric test (Kruskal-Wallis)' },
      ],
    },
    { ...EQUAL_SD_FIELD, showIf: { path: ['gaussian'], in: [true] } },
    {
      path: ['comparisons'],
      label: 'Multiple comparisons (within each row)',
      kind: 'radio',
      options: [...COMPARE_COLUMNS, NO_COMPARISONS],
    },
    CONTROL_FIELD,
    {
      path: ['allPairsMethod'],
      label: 'Test',
      kind: 'select',
      options: ALL_PAIRS_METHODS,
      showIf: [...gaussianEqual, { path: ['comparisons'], in: ['allPairs'] }],
    },
    {
      path: ['controlMethod'],
      label: 'Test',
      kind: 'select',
      options: CONTROL_METHODS,
      showIf: [...gaussianEqual, { path: ['comparisons'], in: ['vsControl'] }],
    },
    {
      path: ['welchMethod'],
      label: 'Test (unequal SDs)',
      kind: 'select',
      options: WELCH_METHODS,
      showIf: [
        { path: ['gaussian'], in: [true] },
        { path: ['equalSD'], in: ['welch', 'brownForsythe'] },
        { path: ['comparisons'], in: ['allPairs', 'vsControl'] },
      ],
    },
    CONFIDENCE_FIELD,
  ],
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    const level = params.confidenceLevel
    const titles = input.map((d) => d.title)
    const rowCount = input[0]?.rowCount ?? 0
    const rowName = (r: number) => rowTitleOf(input, r)
    const nonparametric = !params.gaussian
    if (nonparametric && input.some((d) => d.data.shape !== 'replicates'))
      return failure('The Kruskal-Wallis test needs raw values, not summary data.', diagnostics)
    for (const ds of input)
      for (let r = 0; r < rowCount; r++) {
        const problem = summaryProblem(ds, r, 1, rowName(r))
        if (problem) return failure(problem, diagnostics)
      }

    const { control, pairs } = oneWayPairs(input, params.comparisons, params.control)
    const welch = params.gaussian && params.equalSD !== 'yes'
    const method = nonparametric
      ? 'dunn'
      : welch
        ? params.welchMethod
        : params.comparisons === 'vsControl'
          ? params.controlMethod
          : params.allPairsMethod

    const results: RowResult[] = []
    const skipped: string[] = []
    const mcLabels: string[] = []
    const mcRows: McRow[] = []
    const dunnRows: DunnRow[] = []
    const comparisons: Comparison[] = []
    const addComparisons = (r: number, rows: { p: number }[]) => {
      comparisons.push(
        ...pairComparisons(
          input,
          pairs,
          rows.map((x) => x.p),
          r,
        ),
      )
    }

    for (let r = 0; r < rowCount; r++) {
      if (!input.some((ds) => cellHasData(ds, r))) continue
      const gs = input.map((ds) => cellGroup(ds, r))
      const name = rowName(r)
      if (gs.some((g) => !g)) {
        skipped.push(`${name} (a data set has no values)`)
        continue
      }
      const groups = gs as GroupData[]
      const labels = pairs.map(([i, j]) => `${name}: ${titles[i]} vs. ${titles[j]}`)
      if (nonparametric) {
        const vals = groups.map((g) => (g as { values: number[] }).values)
        const kw = kruskalWallis(vals)
        if (Number.isNaN(kw.p)) {
          skipped.push(`${name} (no variation)`)
          continue
        }
        results.push({
          row: r,
          name,
          F: kw.H,
          dfn: groups.length - 1,
          dfd: Number.NaN,
          p: kw.p,
          groups: vals.map((v, k) => ({ n: v.length, mean: kw.meanRanks[k]! })),
        })
        if (pairs.length) {
          const rows = dunnComparisons(vals, pairs, { adjust: 'bonferroni' })
          dunnRows.push(...rows)
          mcLabels.push(...labels)
          addComparisons(r, rows)
        }
        continue
      }
      const aov = oneWayAnova(groups)
      if (!(aov.dfWithin >= 1)) {
        skipped.push(`${name} (too few values)`)
        continue
      }
      if (welch && aov.groups.some((g) => g.n < 2 || !(g.sd > 0))) {
        skipped.push(
          `${name} (${params.equalSD === 'welch' ? 'Welch' : 'Brown-Forsythe'} ANOVA needs two or more varying values per group)`,
        )
        continue
      }
      const main =
        params.equalSD === 'welch'
          ? welchAnova(groups)
          : params.equalSD === 'brownForsythe'
            ? brownForsytheAnova(groups)
            : { F: aov.F, dfn: aov.dfBetween, dfd: aov.dfWithin, p: aov.p }
      if (Number.isNaN(main.p)) {
        skipped.push(`${name} (no variation)`)
        continue
      }
      results.push({
        row: r,
        name,
        ...main,
        ...(params.equalSD === 'yes' ? { r2: aov.r2 } : {}),
        groups: aov.groups.map((g) => ({ n: g.n, mean: g.mean })),
      })
      if (!pairs.length) continue
      const cells = aov.groups.map((g) => ({ mean: g.mean, n: g.n, sd: g.sd }))
      const rows = welch
        ? welchComparisons(cells, pairs, { method: params.welchMethod, confLevel: level })
        : multipleComparisons(cells, pairs, {
            method: method as never,
            mse: aov.msWithin,
            df: aov.dfWithin,
            confLevel: level,
            control: params.comparisons === 'vsControl' ? control : undefined,
            nMeans: input.length,
          })
      mcRows.push(...rows)
      mcLabels.push(...labels)
      addComparisons(r, rows)
    }
    if (!results.length)
      return failure(
        `No row could be analyzed${skipped.length ? `: ${skipped.join(', ')}` : ''}.`,
        diagnostics,
      )

    const testName = nonparametric
      ? 'Kruskal-Wallis test'
      : params.equalSD === 'welch'
        ? 'Welch ANOVA'
        : params.equalSD === 'brownForsythe'
          ? 'Brown-Forsythe ANOVA'
          : 'Ordinary one-way ANOVA'
    const statName = nonparametric ? 'Kruskal-Wallis statistic' : 'F'
    const dfsText = (x: RowResult) =>
      nonparametric ? text(dfText(x.dfn)) : text(`${dfText(x.dfn)}, ${dfText(x.dfd)}`)
    const mainTable = table(
      `${testName}, one per row`,
      [
        'Row',
        statName,
        nonparametric ? 'DF' : 'DFn, DFd',
        'P value',
        'P value summary',
        `Significant (P < ${ALPHA})?`,
        ...(params.equalSD === 'yes' && !nonparametric ? ['R squared'] : []),
      ],
      results.map((x): ResultValue[] => [
        text(x.name),
        num(x.F),
        dfsText(x),
        pval(x.p),
        psum(x.p),
        significant(x.p),
        ...(x.r2 !== undefined ? [num(x.r2)] : []),
      ]),
    )
    const summaryTable = table(
      nonparametric ? 'Mean ranks' : 'Means',
      ['Row', ...titles],
      results.map((x) => [text(x.name), ...x.groups.map((g) => num(g.mean))]),
    )
    const blocks = [
      kv('Analysis', [
        ['Test', text(testName)],
        ['Number of rows analyzed', int(results.length)],
        ['Number of rows not analyzed', int(skipped.length)],
        ['Number of groups (data sets) per row', int(input.length)],
      ]),
      mainTable,
      summaryTable,
    ]
    if (skipped.length) blocks.push({ type: 'note', text: `Not analyzed: ${skipped.join(', ')}.` })
    const sheets: ResultSheet[] = [resultsSheet(blocks)]
    if (pairs.length) {
      const title = `${METHOD_TITLE[method] ?? method} — within each row (each row a family)`
      sheets.push({
        key: 'comparisons',
        title: 'Multiple comparisons',
        blocks: [
          nonparametric
            ? dunnTable(title, mcLabels, dunnRows)
            : comparisonTable(title, mcLabels, mcRows, level, method),
        ],
      })
    }
    return result({ sheets, diagnostics, values: { rows: int(results.length) }, comparisons })
  },
}
