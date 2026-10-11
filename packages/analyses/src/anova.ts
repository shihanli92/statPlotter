import type {
  AnalysisDef,
  AnalysisResult,
  Comparison,
  Diagnostic,
  NormalizedDataSet,
  ResultBlock,
  ResultValue,
} from '@ps/model'
import {
  brownForsytheAnova,
  dunnComparisons,
  effectSizes,
  type GroupData,
  kruskalWallis,
  linearTrend,
  type McRow,
  multipleComparisons,
  oneWayAnova,
  type TwoWayCell,
  twoWayAnova,
  welchAnova,
  welchComparisons,
} from '@ps/stats'
import { z } from 'zod'
import {
  ALL_PAIRS_METHODS,
  allPairsMethod,
  anovaSummaryTable,
  anovaTable,
  COMPARE_COLUMNS,
  CONTROL_FIELD,
  CONTROL_METHODS,
  comparisonTable,
  controlMethod,
  dunnTable,
  EQUAL_SD_FIELD,
  effectSizeTable,
  equalSD,
  groupData,
  METHOD_TITLE,
  magnitudeWarning,
  NO_COMPARISONS,
  noResidualWarning,
  oneWayPairs,
  pairComparisons,
  TWO_WAY_FAMILY_SUFFIX,
  twoWayComparison,
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
  labelTable,
  num,
  pSig,
  psum,
  pval,
  rawValues,
  result,
  resultsSheet,
  significant,
  statText,
  summaryProblem,
  table,
  text,
  yesNo,
} from './common.ts'
import { cellGroup, rowTitleOf } from './grouped.ts'
import { friedmanDef } from './nonparametric.ts'
import { runOneWayRM, runTwoWayRM } from './rmAnova.ts'

const NK_RM_MESSAGE =
  'Newman-Keuls comparisons are available without repeated measures. Choose Tukey or another test.'

// ---------------------------------------------------------------------------------------------
// One-way ANOVA / Kruskal-Wallis
// ---------------------------------------------------------------------------------------------

const OneWayParams = z.object({
  /** Each row is one subject measured under every treatment (repeated measures). */
  matched: z.boolean().default(false),
  sphericity: z.enum(['gg', 'assumed']).default('gg'),
  gaussian: z.boolean().default(true),
  equalSD: equalSD.default('yes'),
  /** 'trend': the post-test for linear trend (column order), in place of comparisons. */
  comparisons: z.enum(['none', 'allPairs', 'vsControl', 'trend']).default('allPairs'),
  /** Data set key of the control; empty = the first analyzed data set. */
  control: z.string().default(''),
  allPairsMethod: allPairsMethod.default('tukey'),
  controlMethod: controlMethod.default('dunnett'),
  welchMethod: welchMethod.default('dunnett-t3'),
  confidenceLevel,
})
type OneWayParams = z.infer<typeof OneWayParams>

const gaussianEqual = [
  { path: ['gaussian'], in: [true] },
  { path: ['equalSD'], in: ['yes'] },
  { path: ['matched'], in: [false] },
] as const
const gaussianMatched = [
  { path: ['gaussian'], in: [true] },
  { path: ['matched'], in: [true] },
] as const

const SPHERICITY_FIELD = {
  path: ['sphericity'],
  label: 'Assume sphericity (equal variability of differences)?',
  kind: 'radio',
  options: [
    { value: 'gg', label: 'No — use the Geisser-Greenhouse correction (recommended)' },
    { value: 'assumed', label: 'Yes — no correction' },
  ],
} as const

export const oneWayAnovaDef: AnalysisDef<OneWayParams> = {
  id: 'oneWayAnova',
  version: 1,
  title: 'One-way ANOVA (and nonparametric)',
  category: 'Column analyses',
  description:
    'Compare three or more groups: ordinary, Welch, Brown-Forsythe or repeated-measures ANOVA (mixed-effects model with missing values), Kruskal-Wallis or Friedman, with multiple comparisons.',
  accepts: ['column'],
  inputs: { min: 2, max: Number.POSITIVE_INFINITY },
  params: OneWayParams,
  form: [
    {
      path: ['matched'],
      label: 'Experimental design',
      kind: 'radio',
      options: [
        { value: false, label: 'No matching or pairing' },
        { value: true, label: 'Each row represents matched, or repeated measures, data' },
      ],
    },
    {
      path: ['gaussian'],
      label: 'Assume Gaussian distribution of residuals?',
      kind: 'radio',
      options: [
        { value: true, label: 'Yes — use ANOVA' },
        {
          value: false,
          label: 'No — use a nonparametric test (Kruskal-Wallis; Friedman if matched)',
        },
      ],
    },
    { ...SPHERICITY_FIELD, showIf: gaussianMatched },
    {
      ...EQUAL_SD_FIELD,
      showIf: [
        { path: ['gaussian'], in: [true] },
        { path: ['matched'], in: [false] },
      ],
    },
    {
      path: ['comparisons'],
      label: 'Multiple comparisons',
      kind: 'radio',
      options: [
        ...COMPARE_COLUMNS,
        { value: 'trend', label: 'Test for linear trend between column mean and column order' },
        NO_COMPARISONS,
      ],
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
      path: ['allPairsMethod'],
      label: 'Test',
      kind: 'select',
      options: ALL_PAIRS_METHODS,
      showIf: [...gaussianMatched, { path: ['comparisons'], in: ['allPairs'] }],
    },
    {
      path: ['controlMethod'],
      label: 'Test',
      kind: 'select',
      options: CONTROL_METHODS,
      showIf: [...gaussianEqual, { path: ['comparisons'], in: ['vsControl'] }],
    },
    {
      path: ['controlMethod'],
      label: 'Test',
      kind: 'select',
      options: CONTROL_METHODS,
      showIf: [...gaussianMatched, { path: ['comparisons'], in: ['vsControl'] }],
    },
    {
      path: ['welchMethod'],
      label: 'Test (unequal SDs)',
      kind: 'select',
      options: WELCH_METHODS,
      showIf: [
        { path: ['gaussian'], in: [true] },
        { path: ['equalSD'], in: ['welch', 'brownForsythe'] },
        { path: ['matched'], in: [false] },
        { path: ['comparisons'], in: ['allPairs', 'vsControl'] },
      ],
    },
    CONFIDENCE_FIELD,
  ],
  migrateParams: (raw) => raw,
  run(input, params) {
    if (input.length < 2)
      return failure('One-way ANOVA compares two or more data sets.', exclusionNotes(input))
    if (
      params.comparisons === 'trend' &&
      (params.matched || !params.gaussian || params.equalSD !== 'yes')
    ) {
      return failure(
        'The test for linear trend follows ordinary one-way ANOVA. Choose “No matching”, a Gaussian distribution and equal SDs, or other comparisons.',
        exclusionNotes(input),
      )
    }
    // (trend was refused above for these designs)
    const mcKind = params.comparisons === 'trend' ? 'none' : params.comparisons
    // Matched + nonparametric = Friedman with Dunn's comparisons.
    if (params.matched && !params.gaussian) {
      return friedmanDef.run(input, {
        comparisons: mcKind,
        control: params.control,
        correction: 'dunn',
      })
    }
    const diagnostics = exclusionNotes(input)
    if (params.matched) {
      if (params.comparisons === 'allPairs' && params.allPairsMethod === 'newman-keuls')
        return failure(NK_RM_MESSAGE, diagnostics)
      return runOneWayRM(input, { ...params, comparisons: mcKind }, diagnostics)
    }
    // Pairs: indices into `input`. "A vs. B" means diff = mean(A) − mean(B).
    const { control, pairs } = oneWayPairs(input, params.comparisons, params.control)
    if (!params.gaussian) return runKruskalWallis(input, pairs, diagnostics)

    // ---- ANOVA ---------------------------------------------------------------------------------
    const level = params.confidenceLevel
    const titles = input.map((d) => d.title)
    const sheets: AnalysisResult['sheets'] = []
    const values: AnalysisResult['values'] = {}
    const pairLabels = pairs.map(([i, j]) => `${titles[i]} vs. ${titles[j]}`)
    for (const ds of input) {
      const problem = summaryProblem(ds)
      if (problem) return failure(problem, diagnostics)
    }
    const groups = input.map(groupData)
    const missing = groups.findIndex((g) => !g)
    if (missing >= 0)
      return failure(`“${titles[missing]}” needs raw values or mean, SD and N.`, diagnostics)
    const g = groups as GroupData[]
    const aov = oneWayAnova(g)
    if (aov.groups.some((x) => x.n < 1))
      return failure('Every group needs at least one value.', diagnostics)
    if (aov.dfWithin < 1)
      return failure('There are too few values to estimate the residual variance.', diagnostics)
    if (params.equalSD !== 'yes') {
      // Welch and Brown-Forsythe weight each group by its own variance.
      const name = params.equalSD === 'welch' ? 'Welch ANOVA' : 'Brown-Forsythe ANOVA'
      const small = aov.groups.findIndex((x) => x.n < 2)
      if (small >= 0)
        return failure(
          `${name} needs at least two values in every group (“${titles[small]}”).`,
          diagnostics,
        )
      const flat = aov.groups.findIndex((x) => !(x.sd > 0))
      if (params.equalSD === 'welch' && flat >= 0)
        return failure(
          `Welch ANOVA needs variation within every group; the values of “${titles[flat]}” are all the same.`,
          diagnostics,
        )
    }

    diagnostics.push(...magnitudeWarning(aov.groups))
    if (params.equalSD === 'yes')
      diagnostics.push(...noResidualWarning(aov.ssWithin, aov.ssTotal, 'groups'))
    const main =
      params.equalSD === 'welch'
        ? { name: 'Welch ANOVA test', ...welchAnova(g) }
        : params.equalSD === 'brownForsythe'
          ? { name: 'Brown-Forsythe ANOVA test', ...brownForsytheAnova(g) }
          : {
              name: 'Ordinary one-way ANOVA',
              F: aov.F,
              dfn: aov.dfBetween,
              dfd: aov.dfWithin,
              p: aov.p,
            }

    const blocks: ResultBlock[] = [
      kv(main.name, [
        ['F', num(main.F)],
        ['DFn, DFd', text(`${dfText(main.dfn)}, ${dfText(main.dfd)}`)],
        ...pSig(main.p, 'Significant diff. among means'),
        ...(params.equalSD === 'yes'
          ? ([['R squared', num(aov.r2)]] as [string, ResultValue][])
          : []),
      ]),
    ]
    const equalSdRows: [string, ResultValue][] = []
    if (aov.brownForsythe) {
      const bf = aov.brownForsythe
      equalSdRows.push(
        [
          'Brown-Forsythe test: F (DFn, DFd)',
          text(`${statText(bf.F)} (${dfText(bf.dfn)}, ${dfText(bf.dfd)})`),
        ],
        ['Brown-Forsythe test: P value', pval(bf.p)],
        ['Brown-Forsythe test: SDs significantly different?', significant(bf.p)],
      )
    }
    if (aov.bartlett) {
      const b = aov.bartlett
      equalSdRows.push(
        ['Bartlett’s test: statistic (DFn)', text(`${statText(b.chi2)} (${dfText(b.df)})`)],
        ['Bartlett’s test: P value', pval(b.p)],
        ['Bartlett’s test: SDs significantly different?', significant(b.p)],
      )
    }
    if (equalSdRows.length) blocks.push(kv('Tests for equal SDs', equalSdRows))
    if (params.equalSD === 'yes') {
      const es = effectSizes(
        { ss: aov.ssBetween, df: aov.dfBetween },
        { ss: aov.ssWithin, df: aov.dfWithin },
        aov.ssTotal,
        aov.dfBetween + aov.dfWithin + 1,
      )
      blocks.push(
        kv('Effect size', [
          ['Eta squared (R squared)', num(es.etaSquared)],
          ['Omega squared', num(es.partialOmegaSquared)],
          ['Cohen’s f', num(es.cohensF)],
        ]),
      )
    }
    if (params.equalSD === 'yes' && aov.brownForsythe && aov.brownForsythe.p < ALPHA) {
      diagnostics.push({
        level: 'warning',
        message:
          'The SDs differ significantly (Brown-Forsythe test). Consider Welch or Brown-Forsythe ANOVA, which do not assume equal SDs.',
      })
    }
    blocks.push(
      table(
        'ANOVA table',
        ['Source of Variation', 'SS', 'DF', 'MS', 'F (DFn, DFd)', 'P value'],
        [
          [
            text('Treatment (between columns)'),
            num(aov.ssBetween),
            int(aov.dfBetween),
            num(aov.msBetween),
            text(`F (${dfText(aov.dfBetween)}, ${dfText(aov.dfWithin)}) = ${statText(aov.F)}`),
            pval(aov.p),
          ],
          [
            text('Residual (within columns)'),
            num(aov.ssWithin),
            int(aov.dfWithin),
            num(aov.msWithin),
            text(''),
            text(''),
          ],
          [
            text('Total'),
            num(aov.ssTotal),
            int(aov.dfBetween + aov.dfWithin),
            text(''),
            text(''),
            text(''),
          ],
        ],
      ),
      labelTable('Data summary', titles, [
        ['Number of values', aov.groups.map((x) => int(x.n))],
        ['Mean', aov.groups.map((x) => num(x.mean))],
        ['SD', aov.groups.map((x) => num(x.sd))],
        ['SEM', aov.groups.map((x) => num(x.sem))],
      ]),
    )
    sheets.push(resultsSheet(blocks))
    values.p = pval(main.p)
    values.F = num(main.F)

    if (params.comparisons === 'trend') {
      const tr = linearTrend(g)
      const rows: [string, ResultValue][] = [
        ['Slope', num(tr.slope)],
        ['R squared (effect size)', num(tr.r2Effect)],
        ['R squared (alerting)', num(tr.r2Alerting)],
        ['F', num(tr.F)],
        ['DFn, DFd', text(`${tr.dfn}, ${tr.dfd}`)],
        ...pSig(tr.p, 'Is there a significant linear trend'),
      ]
      const nl = tr.nonlinear
      const blocks: ResultBlock[] = [kv('Test for linear trend', rows)]
      if (input.length >= 4) {
        blocks.push(
          kv('Nonlinear variation', [
            ['F', num(nl.F)],
            ['DFn, DFd', text(`${nl.df}, ${tr.dfd}`)],
            ...pSig(nl.p, 'Significant nonlinear variation'),
          ]),
        )
      }
      sheets.push({ key: 'trend', title: 'Test for trend', blocks })
      values['p.trend'] = pval(tr.p)
      values.slope = num(tr.slope)
    }

    let comparisons: Comparison[] = []
    if (pairs.length) {
      let rows: McRow[]
      let method: string
      if (params.equalSD === 'yes') {
        method = params.comparisons === 'vsControl' ? params.controlMethod : params.allPairsMethod
        rows = multipleComparisons(
          aov.groups.map((x) => ({ mean: x.mean, n: x.n, sd: x.sd })),
          pairs,
          {
            method: method as never,
            mse: aov.msWithin,
            df: aov.dfWithin,
            confLevel: level,
            control: params.comparisons === 'vsControl' ? control : undefined,
            nMeans: input.length,
          },
        )
      } else {
        method = params.welchMethod
        rows = welchComparisons(
          aov.groups.map((x) => ({ mean: x.mean, n: x.n, sd: x.sd })),
          pairs,
          { method: params.welchMethod, confLevel: level },
        )
      }
      sheets.push({
        key: 'comparisons',
        title: 'Multiple comparisons',
        blocks: [comparisonTable(METHOD_TITLE[method] ?? method, pairLabels, rows, level, method)],
      })
      comparisons = pairComparisons(
        input,
        pairs,
        rows.map((r) => r.p),
      )
    }
    return result({ sheets, diagnostics, values, comparisons })
  },
}

/** The Kruskal-Wallis test (one-way ANOVA, not Gaussian), with Dunn's comparisons of `pairs`. */
function runKruskalWallis(
  input: readonly NormalizedDataSet[],
  pairs: [number, number][],
  diagnostics: Diagnostic[],
): AnalysisResult {
  const titles = input.map((d) => d.title)
  const raws = input.map(rawValues)
  if (raws.some((r) => !r))
    return failure('The Kruskal-Wallis test needs raw values, not summary data.', diagnostics)
  const groups = raws as Float64Array[]
  if (groups.some((g) => g.length === 0))
    return failure('Every group needs at least one value.', diagnostics)
  const kw = kruskalWallis(groups)
  const sheets = [
    resultsSheet([
      kv('Kruskal-Wallis test', [
        ['P value', pval(kw.p)],
        ['Exact or approximate P value?', text('Approximate')],
        ['P value summary', psum(kw.p)],
        [`Do the medians vary significantly (P < ${ALPHA})?`, significant(kw.p)],
        ['Number of groups', int(groups.length)],
        ['Kruskal-Wallis statistic', num(kw.H)],
      ]),
      labelTable('Data summary', titles, [
        ['Number of values', kw.n.map(int)],
        ['Mean rank', kw.meanRanks.map((v) => num(v))],
      ]),
    ]),
  ]
  let comparisons: Comparison[] = []
  if (pairs.length) {
    const rows = dunnComparisons(groups, pairs, { adjust: 'bonferroni' })
    const labels = pairs.map(([i, j]) => `${titles[i]} vs. ${titles[j]}`)
    sheets.push({
      key: 'comparisons',
      title: 'Multiple comparisons',
      blocks: [dunnTable(METHOD_TITLE.dunn!, labels, rows)],
    })
    comparisons = pairComparisons(
      input,
      pairs,
      rows.map((r) => r.p),
    )
  }
  return result({ sheets, diagnostics, values: { p: pval(kw.p) }, comparisons })
}

// ---------------------------------------------------------------------------------------------
// Two-way ANOVA (grouped tables: rows × data sets)
// ---------------------------------------------------------------------------------------------

const TwoWayParams = z.object({
  /** Which factor is repeated within subjects (subjects are the replicate subcolumns). */
  repeated: z.enum(['none', 'rows', 'columns', 'both']).default('none'),
  sphericity: z.enum(['gg', 'assumed']).default('gg'),
  interaction: z.boolean().default(true),
  comparisons: z
    .enum(['none', 'withinRows', 'withinColumns', 'allCells', 'mainColumns', 'mainRows'])
    .default('withinRows'),
  kind: z.enum(['allPairs', 'vsControl']).default('allPairs'),
  /** Each row (column) is a family (recommended), or all comparisons form one. */
  family: z.enum(['perBlock', 'all']).default('perBlock'),
  allPairsMethod: allPairsMethod.default('sidak'),
  controlMethod: controlMethod.default('dunnett'),
  confidenceLevel,
})
type TwoWayParams = z.infer<typeof TwoWayParams>

export const twoWayAnovaDef: AnalysisDef<TwoWayParams> = {
  id: 'twoWayAnova',
  version: 1,
  title: 'Two-way ANOVA',
  category: 'Grouped analyses',
  description:
    'Row factor × column factor: main effects, interaction, and multiple comparisons (simple effects).',
  accepts: ['grouped'],
  inputs: { min: 2, max: Number.POSITIVE_INFINITY },
  params: TwoWayParams,
  form: [
    {
      path: ['repeated'],
      label: 'Repeated measures (matching)',
      kind: 'radio',
      options: [
        { value: 'none', label: 'No matching' },
        {
          value: 'columns',
          label:
            'Each column is a time point: a subject’s values are spread across a row (Y1 with Y1…)',
        },
        {
          value: 'rows',
          label: 'Each row is a time point: a subject’s values are stacked in a subcolumn',
        },
        { value: 'both', label: 'Both factors are repeated' },
      ],
    },
    {
      ...SPHERICITY_FIELD,
      showIf: { path: ['repeated'], in: ['rows', 'columns', 'both'] },
    },
    {
      path: ['interaction'],
      label: 'Model',
      kind: 'radio',
      options: [
        { value: true, label: 'Full model: row effect, column effect, and interaction' },
        {
          value: false,
          label: 'Main effects only (assume no interaction; needed with one value per cell)',
        },
      ],
    },
    {
      path: ['comparisons'],
      label: 'Multiple comparisons',
      kind: 'radio',
      options: [
        {
          value: 'withinRows',
          label: 'Within each row, compare columns (simple effects within rows)',
        },
        {
          value: 'withinColumns',
          label: 'Within each column, compare rows (simple effects within columns)',
        },
        {
          value: 'allCells',
          label: 'Compare every cell mean with every other (regardless of rows and columns)',
        },
        { value: 'mainColumns', label: 'Compare column means (main column effect)' },
        { value: 'mainRows', label: 'Compare row means (main row effect)' },
        { value: 'none', label: 'No multiple comparisons' },
      ],
    },
    {
      path: ['kind'],
      label: 'Compare',
      kind: 'radio',
      options: [
        { value: 'allPairs', label: 'Every mean with every other mean' },
        { value: 'vsControl', label: 'Each mean with the first (control)' },
      ],
      showIf: {
        path: ['comparisons'],
        in: ['withinRows', 'withinColumns', 'allCells', 'mainColumns', 'mainRows'],
      },
    },
    {
      path: ['family'],
      label: 'Family of comparisons',
      kind: 'radio',
      options: [
        { value: 'perBlock', label: 'One family per row (or column) — recommended' },
        { value: 'all', label: 'One family for all comparisons (conservative)' },
      ],
      showIf: { path: ['comparisons'], in: ['withinRows', 'withinColumns'] },
    },
    {
      path: ['allPairsMethod'],
      label: 'Test',
      kind: 'select',
      options: ALL_PAIRS_METHODS,
      showIf: [
        { path: ['kind'], in: ['allPairs'] },
        {
          path: ['comparisons'],
          in: ['withinRows', 'withinColumns', 'allCells', 'mainColumns', 'mainRows'],
        },
      ],
    },
    {
      path: ['controlMethod'],
      label: 'Test',
      kind: 'select',
      options: CONTROL_METHODS,
      showIf: [
        { path: ['kind'], in: ['vsControl'] },
        {
          path: ['comparisons'],
          in: ['withinRows', 'withinColumns', 'allCells', 'mainColumns', 'mainRows'],
        },
      ],
    },
    CONFIDENCE_FIELD,
  ],
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    if (params.repeated !== 'none') {
      if (
        params.comparisons !== 'none' &&
        params.kind === 'allPairs' &&
        params.allPairsMethod === 'newman-keuls'
      )
        return failure(NK_RM_MESSAGE, diagnostics)
      if (params.comparisons === 'allCells') {
        return failure(
          'Comparing every cell with every other is available without repeated measures. Choose comparisons within rows or within columns.',
          diagnostics,
        )
      }
      return runTwoWayRM(
        input,
        {
          ...params,
          comparisons: params.comparisons,
          repeated: params.repeated,
          singleFamily: params.family === 'all',
        },
        diagnostics,
      )
    }
    const level = params.confidenceLevel
    const rowCount = input[0]?.rowCount ?? 0
    const rowTitle = (r: number) => rowTitleOf(input, r)

    // Cells: rows with any data, columns = data sets.
    for (const ds of input)
      for (let r = 0; r < rowCount; r++) {
        const problem = summaryProblem(ds, r, 1, rowTitle(r))
        if (problem) return failure(problem, diagnostics)
      }
    const rows = Array.from({ length: rowCount }, (_, r) => r).filter((r) =>
      input.some((ds) => cellGroup(ds, r)),
    )
    if (rows.length < 2)
      return failure('Two-way ANOVA needs at least two rows with data.', diagnostics)
    const cells: TwoWayCell[] = []
    rows.forEach((r, ri) => {
      input.forEach((ds, ci) => {
        const g = cellGroup(ds, r)
        if (g) cells.push({ row: ri, col: ci, ...g })
      })
    })
    if (cells.length < rows.length * input.length) {
      return failure('Every cell (row × column) needs at least one value.', diagnostics)
    }
    const maxN = Math.max(...cells.map((c) => ('values' in c ? c.values.length : c.n)))
    if (params.interaction && maxN < 2) {
      return failure(
        'With one value per cell, choose “Main effects only”: the interaction can’t be estimated.',
        diagnostics,
      )
    }

    const res = twoWayAnova(cells, { interaction: params.interaction })
    const effects = res.sources.filter((s) => s.source !== 'Residual')
    // Same keys as the repeated-measures path.
    const VALUE_KEY: Record<string, string> = {
      Interaction: 'interaction',
      'Row factor': 'row',
      'Column factor': 'column',
    }
    const residual = res.sources.at(-1)!
    diagnostics.push(...magnitudeWarning(res.cells))
    diagnostics.push(...noResidualWarning(residual.ss, res.ssTotal, 'cells'))
    const N = cells.reduce((t, c) => t + ('values' in c ? c.values.length : c.n), 0)
    const blocks: ResultBlock[] = [
      anovaSummaryTable(
        'Two-way ANOVA',
        effects.map((s) => ({ ...s, name: s.source })),
      ),
      anovaTable(
        effects.map((s) => ({ ...s, name: s.source })),
        residual,
        res.dfResidual,
      ),
      effectSizeTable(effects.map((s) => [s.source, effectSizes(s, residual, res.ssTotal, N)])),
      kv('Data summary', [
        ['Number of columns (column factor)', int(input.length)],
        ['Number of rows (row factor)', int(rows.length)],
        ['Number of values', int(N)],
        ['Balanced design?', yesNo(res.balanced)],
      ]),
    ]
    const sheets: AnalysisResult['sheets'] = [resultsSheet(blocks)]
    const values: AnalysisResult['values'] = Object.fromEntries(
      effects.map((s) => [`p.${VALUE_KEY[s.source]}`, pval(s.p)]),
    )

    // ---- Multiple comparisons ------------------------------------------------------------------
    if (params.comparisons === 'none') return result({ sheets, diagnostics, values })
    const method = params.kind === 'vsControl' ? params.controlMethod : params.allPairsMethod
    const vsControl = params.kind === 'vsControl'
    const R = rows.length
    const C = input.length
    const mcCells = res.cells.map((c) => ({ mean: c.mean, n: c.n, sd: c.sd }))
    const within = (
      outer: number,
      inner: number,
      pairIdx: (o: number, a: number, b: number) => [number, number],
    ) => {
      const pairs: [number, number][] = []
      const meta: { o: number; a: number; b: number }[] = []
      for (let o = 0; o < outer; o++) {
        const ps: [number, number][] = []
        if (vsControl) for (let b = 1; b < inner; b++) ps.push([0, b])
        else for (let a = 0; a < inner; a++) for (let b = a + 1; b < inner; b++) ps.push([a, b])
        for (const [a, b] of ps) {
          pairs.push(pairIdx(o, a, b))
          meta.push({ o, a, b })
        }
      }
      return { pairs, meta }
    }
    const cellAt = (ri: number, ci: number) =>
      res.cells.findIndex((c) => c.row === ri && c.col === ci)

    let mcRows: McRow[] = []
    const labels: string[] = []
    const comparisons: Comparison[] = []
    const add = (c: Parameters<typeof twoWayComparison>[3], p: number) => {
      const x = twoWayComparison(input, rows, params.comparisons, c, p)
      labels.push(x.label)
      if (x.comparison) comparisons.push(x.comparison)
    }

    if (params.comparisons === 'withinRows' || params.comparisons === 'withinColumns') {
      const byRow = params.comparisons === 'withinRows'
      const { pairs, meta } = byRow
        ? within(R, C, (o, a, b) => [cellAt(o, a), cellAt(o, b)])
        : within(C, R, (o, a, b) => [cellAt(a, o), cellAt(b, o)])
      // The default family is each row (or column), with Tukey's k = means per block and
      // Dunnett's control = the block's first cell. "One family for all comparisons" widens the
      // correction for Šidák/Bonferroni/Holm/Fisher/FDR; Tukey and Dunnett stay per block (how
      // to pool their distributions across rows is not settled).
      const opts = { method: method as never, mse: res.mse, df: res.dfResidual, confLevel: level }
      const blocks = byRow ? R : C
      const perBlock = pairs.length / blocks
      const distributional = method === 'tukey' || method === 'dunnett' || method === 'newman-keuls'
      if (params.family === 'all' && !distributional) {
        mcRows = multipleComparisons(mcCells, pairs, { ...opts, familySize: pairs.length })
      } else {
        if (params.family === 'all') {
          diagnostics.push({
            level: 'info',
            message: `${method === 'tukey' ? 'Tukey' : method === 'dunnett' ? 'Dunnett' : 'Newman-Keuls'} comparisons are corrected within each ${byRow ? 'row' : 'column'}; choose Šidák or Bonferroni to correct across all comparisons.`,
          })
        }
        mcRows = []
        for (let o = 0; o < blocks; o++) {
          const block = pairs.slice(o * perBlock, (o + 1) * perBlock)
          mcRows.push(
            ...multipleComparisons(mcCells, block, {
              ...opts,
              nMeans: byRow ? C : R,
              control: method === 'dunnett' ? block[0]![0] : undefined,
            }),
          )
        }
      }
      meta.forEach(({ o, a, b }, k) => {
        add(byRow ? { rowA: o, colA: a, colB: b } : { colA: o, rowA: a, rowB: b }, mcRows[k]!.p)
      })
    } else if (params.comparisons === 'allCells') {
      // "Compare cell means regardless of rows and columns": one family of all cells
      // (Tukey's k = number of cells), ordered row by row. Dunnett's control is the first cell.
      const order: number[] = []
      for (let ri = 0; ri < R; ri++) for (let ci = 0; ci < C; ci++) order.push(cellAt(ri, ci))
      const pairs: [number, number][] = []
      if (vsControl) for (let j = 1; j < order.length; j++) pairs.push([order[0]!, order[j]!])
      else
        for (let i = 0; i < order.length; i++)
          for (let j = i + 1; j < order.length; j++) pairs.push([order[i]!, order[j]!])
      mcRows = multipleComparisons(mcCells, pairs, {
        method: method as never,
        mse: res.mse,
        df: res.dfResidual,
        confLevel: level,
        nMeans: order.length,
        control: vsControl ? order[0] : undefined,
      })
      const name = (cell: number) => {
        const c = res.cells[cell]!
        return `${rowTitle(rows[c.row]!)}:${input[c.col]!.title}`
      }
      pairs.forEach(([i, j], k) => {
        const [a, b] = [res.cells[i]!, res.cells[j]!]
        labels.push(`${name(i)} vs. ${name(j)}`)
        comparisons.push({
          key: `cell${rows[a.row]}:${input[a.col]!.ref.key}|${rows[b.row]}:${input[b.col]!.ref.key}`,
          a: input[a.col]!.ref,
          b: input[b.col]!.ref,
          rowA: rows[a.row]!,
          rowB: rows[b.row]!,
          p: mcRows[k]!.p,
          pAdjusted: mcRows[k]!.p,
        })
      })
    } else {
      // Main effects: compare least-squares marginal means. With unequal n, the effective n of an
      // LS mean is k² / Σ(1/n) over its k cells, so SE = √(MSE·(1/nᵢ + 1/nⱼ)) is exact.
      const byCol = params.comparisons === 'mainColumns'
      const k = byCol ? C : R
      const means = byCol ? res.colMeans : res.rowMeans
      const effN = Array.from({ length: k }, (_, i) => {
        const ns = res.cells.filter((c) => (byCol ? c.col : c.row) === i).map((c) => c.n)
        const other = ns.length
        return (other * other) / ns.reduce((s, n) => s + 1 / n, 0)
      })
      const pairs: [number, number][] = []
      if (vsControl) for (let j = 1; j < k; j++) pairs.push([0, j])
      else for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs.push([i, j])
      mcRows = multipleComparisons(
        means.map((m, i) => ({ mean: m, n: effN[i]! })),
        pairs,
        {
          method: method as never,
          mse: res.mse,
          df: res.dfResidual,
          confLevel: level,
          nMeans: k,
          control: vsControl ? 0 : undefined,
        },
      )
      pairs.forEach(([i, j], idx) => {
        add(byCol ? { colA: i, colB: j } : { rowA: i, rowB: j }, mcRows[idx]!.p)
      })
    }
    const title = (METHOD_TITLE[method] ?? method) + TWO_WAY_FAMILY_SUFFIX[params.comparisons]
    sheets.push({
      key: 'comparisons',
      title: 'Multiple comparisons',
      blocks: [comparisonTable(title, labels, mcRows, level, method)],
    })
    return result({ sheets, diagnostics, values, comparisons })
  },
}
