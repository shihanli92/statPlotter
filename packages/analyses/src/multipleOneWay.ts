import {
  type AnalysisDef,
  type Comparison,
  type NormalizedDataSet,
  type Problem,
  pinDefaults,
  type ResultSheet,
  type ResultValue,
} from '@ps/model'
import {
  brownForsytheAnova,
  correctFamily,
  type DunnRow,
  dunnComparisons,
  type GroupData,
  kruskalWallis,
  kruskalWallisExact,
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
  decided,
  dfText,
  exclusionNotes,
  failure,
  int,
  kv,
  num,
  problem,
  psum,
  pval,
  RANK_NEEDS_RAW,
  result,
  resultsSheet,
  significant,
  summaryProblem,
  table,
  testValue,
  text,
} from './common.ts'
import {
  cellGroup,
  cellHasData,
  FAMILY_FIELDS,
  FAMILY_TITLE,
  familyColumns,
  familyMethod,
  familyParams,
  rowTitleOf,
} from './grouped.ts'
import { DUNN_METHODS, dunnMethod, dunnTitle } from './nonparametric.ts'
import { P_METHOD_FIELD, pMethod } from './rank.ts'

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
  /** Roadmap 51c (S11): Kruskal-Wallis' exact P for small groups; Dunn's adjustment. */
  kwPMethod: pMethod,
  dunnMethod: dunnMethod.default('holm'),
  /**
   * Roadmap 51c (S9, the user's answer to §10.4 question 4): the rows' P values corrected for
   * their number — the false discovery rate by Benjamini-Hochberg at Q = 5% by default — with the
   * choices of multiple t tests. Comparisons within a row stay a family of their own.
   */
  ...familyParams,
  fdrMethod: z.enum(['bky', 'bh', 'by']).default('bh'),
  confidenceLevel,
})
type Params = z.infer<typeof Params>

/**
 * Version 1 (before 0.3.9): no correction across rows, Kruskal-Wallis' approximate P and Dunn's
 * comparisons by Bonferroni. Saved analyses keep them.
 */
const migrate = (raw: unknown, from: number): unknown =>
  from >= 2
    ? raw
    : pinDefaults(raw, [
        [['approach'], 'none'],
        [['kwPMethod'], 'approximate'],
        [['dunnMethod'], 'bonferroni'],
      ])

/** The rows' correction: multiple t tests' fields, worded for rows of ANOVAs. */
const ROW_FAMILY_FIELDS = FAMILY_FIELDS.map((f) =>
  f.path[0] === 'approach'
    ? {
        ...f,
        label: 'Correct the rows’ P values for their number',
        options: [
          { value: 'fdr', label: 'Control the false discovery rate (FDR) (recommended)' },
          {
            value: 'significance',
            label: 'Control the chance of any false positive among the rows',
          },
          { value: 'none', label: 'No correction across rows' },
        ],
      }
    : f,
)

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
  version: 2,
  title: 'Multiple one-way ANOVAs',
  category: 'Grouped analyses',
  description:
    'One one-way ANOVA per row (ordinary, Welch, Brown-Forsythe or Kruskal-Wallis), comparing the data sets within each row, with multiple comparisons in each row.',
  accepts: ['grouped'],
  inputs: { min: 3, max: Number.POSITIVE_INFINITY },
  params: Params,
  migrateParams: migrate,
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
    { ...P_METHOD_FIELD, path: ['kwPMethod'], showIf: { path: ['gaussian'], in: [false] } },
    {
      path: ['dunnMethod'],
      label: 'Adjust Dunn’s comparisons',
      kind: 'select',
      options: DUNN_METHODS,
      showIf: [
        { path: ['gaussian'], in: [false] },
        { path: ['comparisons'], in: ['allPairs', 'vsControl'] },
      ],
    },
    ...ROW_FAMILY_FIELDS,
    CONFIDENCE_FIELD,
  ],
  validate: validateMultipleOneWay,
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    const level = params.confidenceLevel
    const titles = input.map((d) => d.title)
    const rowCount = input[0]?.rowCount ?? 0
    const rowName = (r: number) => rowTitleOf(input, r)
    const nonparametric = !params.gaussian
    if (nonparametric && input.some((d) => d.data.shape !== 'replicates'))
      return failure(
        `The Kruskal-Wallis test needs raw values, not summary data.${RANK_NEEDS_RAW}`,
        diagnostics,
      )
    for (const ds of input)
      for (let r = 0; r < rowCount; r++) {
        const problem = summaryProblem(ds, r, 1, rowName(r))
        if (problem) return failure(problem, diagnostics)
      }

    const { control, pairs } = oneWayPairs(input, params.comparisons, params.control)
    const welch = params.gaussian && params.equalSD !== 'yes'
    const method = nonparametric
      ? params.dunnMethod
      : welch
        ? params.welchMethod
        : params.comparisons === 'vsControl'
          ? params.controlMethod
          : params.allPairsMethod

    const results: RowResult[] = []
    let exactRows = 0
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
        // S11: exact while the row's groups are small enough.
        const exact = params.kwPMethod === 'exactWhenPossible' ? kruskalWallisExact(vals) : null
        if (exact) exactRows++
        results.push({
          row: r,
          name,
          F: kw.H,
          dfn: groups.length - 1,
          dfd: Number.NaN,
          p: exact ? exact.p : kw.p,
          groups: vals.map((v, k) => ({ n: v.length, mean: kw.meanRanks[k]! })),
        })
        if (pairs.length) {
          const rows = dunnComparisons(vals, pairs, { adjust: params.dunnMethod })
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
    // S9: the rows' P values as one family (FDR or family-wise), when asked.
    const rowFamily = familyMethod(params)
    const fam =
      rowFamily === 'none'
        ? null
        : correctFamily(
            results.map((x) => x.p),
            { method: rowFamily, q: params.q / 100, alpha: params.alpha },
          )
    const cols = familyColumns(params)
    const mainTable = table(
      `${testName}, one per row`,
      [
        'Row',
        statName,
        nonparametric ? 'DF' : 'DFn, DFd',
        'P value',
        'P value summary',
        // With a correction across rows its decision replaces the uncorrected one.
        ...(fam && cols.adjusted ? [cols.adjusted, cols.flag] : [`Significant (P < ${ALPHA})?`]),
        ...(params.equalSD === 'yes' && !nonparametric ? ['R squared'] : []),
      ],
      results.map((x, i): ResultValue[] => [
        text(x.name),
        num(x.F),
        dfsText(x),
        pval(x.p),
        psum(x.p),
        ...(fam ? [pval(fam.adjusted[i]!), decided(fam.flagged[i]!, x.p)] : [significant(x.p)]),
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
        ...(nonparametric
          ? ([
              [
                'Exact or approximate P values?',
                text(
                  exactRows === results.length
                    ? 'Exact'
                    : exactRows === 0
                      ? 'Approximate'
                      : `Exact in ${exactRows} rows, approximate in ${results.length - exactRows}`,
                ),
              ],
            ] as [string, ResultValue][])
          : []),
        ['Correction across rows', text(FAMILY_TITLE[rowFamily])],
        ...(fam
          ? ([
              params.approach === 'fdr'
                ? ['Desired FDR (Q)', text(`${params.q}%`)]
                : ['Significance level (alpha)', text(`${+(params.alpha * 100).toPrecision(12)}%`)],
              [
                params.approach === 'fdr' ? 'Number of discoveries' : 'Number below threshold',
                int(fam.flagged.filter(Boolean).length),
              ],
            ] as [string, ResultValue][])
          : []),
      ]),
      mainTable,
      summaryTable,
      {
        type: 'note' as const,
        text: `${
          fam
            ? `Rows: ${FAMILY_TITLE[rowFamily].replace(/^[^:]*: /, '').replace(/^./, (c) => c.toLowerCase())} across the ${results.length} rows (${params.approach === 'fdr' ? 'q values' : 'adjusted P values'}).`
            : `Rows: each row’s P value is not corrected for the ${results.length} rows.`
        }${pairs.length ? ' Comparisons within a row are their own family, adjusted for that row’s comparisons only.' : ''}`,
      },
    ]
    if (skipped.length) blocks.push({ type: 'note', text: `Not analyzed: ${skipped.join(', ')}.` })
    const sheets: ResultSheet[] = [resultsSheet(blocks)]
    if (pairs.length) {
      const title = `${
        nonparametric ? dunnTitle(params.dunnMethod) : (METHOD_TITLE[method] ?? method)
      } — within each row (each row a family)`
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
    return result({
      sheets,
      diagnostics,
      values: { rows: int(results.length), ...testValue(testName) },
      comparisons,
    })
  },
}

/** Roadmap 51b (§4.6): multiple one-way ANOVAs' problems before computing. */
function validateMultipleOneWay(
  input: readonly NormalizedDataSet[],
  params: Params,
): Problem | null {
  const diagnostics = exclusionNotes(input)
  const rowCount = input[0]?.rowCount ?? 0
  if (!params.gaussian && input.some((d) => d.data.shape !== 'replicates'))
    return problem(
      `The Kruskal-Wallis test needs raw values, not summary data.${RANK_NEEDS_RAW}`,
      'table',
      diagnostics,
    )
  for (const ds of input)
    for (let r = 0; r < rowCount; r++) {
      const issue = summaryProblem(ds, r, 1, rowTitleOf(input, r))
      if (issue) return problem(issue, 'table', diagnostics)
    }
  return null
}
