import {
  type AnalysisDef,
  type AnalysisResult,
  contingencyCounts,
  type Diagnostic,
  type ResultBlock,
  type ResultSheet,
  type ResultValue,
} from '@ps/model'
import {
  chiSquareTest,
  chiSquareTrend,
  contingencyPairwise,
  cramersV,
  type Estimate,
  fisherExact,
  phiCoefficient,
  twoByTwo,
} from '@ps/stats'
import { z } from 'zod'
import {
  ALPHA,
  CONFIDENCE_FIELD,
  confidenceLevel,
  exclusionNotes,
  failure,
  int,
  interval,
  kv,
  num,
  pct,
  pRows,
  psum,
  pval,
  result,
  resultsSheet,
  shortText,
  TAILS_FIELD,
  table,
  tails,
  text,
  yesNo,
} from './common.ts'
import { rowTitleOf } from './grouped.ts'

const Params = z.object({
  test: z.enum(['fisher', 'chiSquare']).default('fisher'),
  yates: z.boolean().default(false),
  trend: z.boolean().default(true),
  tails,
  riskEstimates: z.boolean().default(true),
  oddsRatio: z.boolean().default(true),
  diagnostic: z.boolean().default(false),
  /** Phi (2 × 2) or Cramér's V (larger tables). */
  effectSize: z.boolean().default(true),
  /** Compare pairs of rows (groups), each pair's sub-table tested on its own. */
  pairwise: z.enum(['none', 'all', 'control']).default('none'),
  /** Control row index for pairwise = 'control' (as a string, from the row picker). */
  pairwiseControl: z.string().default('0'),
  pairwiseMethod: z.enum(['bonferroni', 'holm-sidak', 'sidak', 'none']).default('bonferroni'),
  confidenceLevel,
})
type Params = z.infer<typeof Params>

const estimateRows = (label: string, e: Estimate, level: number): [string, ResultValue][] => [
  [label, num(e.value)],
  [`${pct(level)} CI`, interval(e.lower, e.upper, level)],
]

/**
 * NNT = 1 / difference. When the CI of the difference includes zero, the NNT's CI runs through
 * infinity (lower > upper): it is NNT ≥ lower or NNT ≤ upper, shown as text.
 */
function nntRows(e: Estimate, level: number): [string, ResultValue][] {
  const ci: ResultValue =
    e.lower > e.upper
      ? text(`${fmt(e.lower)} to ∞ and −∞ to ${fmt(e.upper)}`)
      : interval(e.lower, e.upper, level)
  return [
    ['Number needed to treat (NNT)', num(e.value)],
    [`${pct(level)} CI of NNT`, ci],
  ]
}
const fmt = (v: number) => shortText(v)

const percentRows = (counts: number[][], denom: (i: number, j: number) => number) =>
  counts.map((row, i) => row.map((v, j) => num((100 * v) / denom(i, j))))

export const contingencyDef: AnalysisDef<Params> = {
  id: 'contingency',
  version: 1,
  title: 'Chi-square (and Fisher’s exact) test',
  category: 'Contingency table analyses',
  description:
    'Test association in a contingency table (Fisher’s exact or chi-square, chi-square for trend), with relative risk, odds ratio and sensitivity/specificity for 2×2 tables.',
  accepts: ['contingency'],
  inputs: { min: 2, max: 64 },
  params: Params,
  form: [
    {
      path: ['test'],
      label: 'Test',
      kind: 'radio',
      options: [
        { value: 'fisher', label: 'Fisher’s exact test (recommended)' },
        { value: 'chiSquare', label: 'Chi-square test' },
      ],
    },
    {
      path: ['yates'],
      label: 'Yates’ continuity correction (2×2 tables)',
      kind: 'checkbox',
      showIf: { path: ['test'], in: ['chiSquare'] },
    },
    {
      path: ['trend'],
      label: 'Chi-square test for trend (tables with two outcome columns and three or more rows)',
      kind: 'checkbox',
    },
    { ...TAILS_FIELD, help: 'Applies to 2×2 tables.' },
    {
      path: ['riskEstimates'],
      label: 'Relative risk, difference between proportions and NNT (2×2)',
      kind: 'checkbox',
    },
    { path: ['oddsRatio'], label: 'Odds ratio (2×2)', kind: 'checkbox' },
    {
      path: ['diagnostic'],
      label:
        'Sensitivity, specificity and predictive values (2×2: rows = with / without the condition, columns = test positive / negative)',
      kind: 'checkbox',
    },
    {
      path: ['effectSize'],
      label: 'Effect size: phi (2×2) or Cramér’s V (larger tables)',
      kind: 'checkbox',
    },
    {
      path: ['pairwise'],
      label: 'Multiple comparisons (tables with three or more rows)',
      kind: 'radio',
      options: [
        { value: 'none', label: 'No comparisons' },
        { value: 'all', label: 'Compare every pair of rows' },
        { value: 'control', label: 'Compare each row with a control row' },
      ],
      help: 'Each pair of rows is tested on its own with the test chosen above.',
    },
    {
      path: ['pairwiseControl'],
      label: 'Control row',
      kind: 'custom',
      component: 'row.pick',
      showIf: { path: ['pairwise'], in: ['control'] },
    },
    {
      path: ['pairwiseMethod'],
      label: 'Correction for multiple comparisons',
      kind: 'select',
      options: [
        { value: 'bonferroni', label: 'Bonferroni (recommended: the comparisons share rows)' },
        { value: 'holm-sidak', label: 'Holm-Šídák' },
        { value: 'sidak', label: 'Šídák' },
        { value: 'none', label: 'None (Fisher’s LSD-like)' },
      ],
      showIf: { path: ['pairwise'], in: ['all', 'control'] },
    },
    CONFIDENCE_FIELD,
  ],
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    const { counts, rows, incompleteRows } = contingencyCounts(input)
    const rowTitle = (r: number) => rowTitleOf(input, r)
    const rowNames = rows.map(rowTitle)
    const colNames = input.map((d) => d.title)
    if (incompleteRows.length) {
      return failure(
        `Every cell of a row needs a count; ${incompleteRows.map(rowTitle).join(', ')} ${incompleteRows.length > 1 ? 'are' : 'is'} incomplete.`,
        diagnostics,
      )
    }
    if (counts.flat().some((v) => v < 0 || !Number.isInteger(v)))
      return failure('A contingency table holds counts: whole numbers, zero or more.', diagnostics)
    if (counts.length < 2)
      return failure('A contingency table needs at least two rows.', diagnostics)
    if (input.length < 2)
      return failure('A contingency table needs at least two columns.', diagnostics)
    const emptyRows = rows.filter((_, i) => counts[i]!.every((v) => v === 0)).map(rowTitle)
    const emptyCols = colNames.filter((_, j) => counts.every((row) => row[j] === 0))
    if (emptyRows.length || emptyCols.length) {
      const names = [...emptyRows, ...emptyCols]
      return failure(
        `Every row and column needs a nonzero total; ${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} all zeros.`,
        diagnostics,
      )
    }

    const level = params.confidenceLevel
    const is2x2 = counts.length === 2 && counts[0]!.length === 2
    const chi = chiSquareTest(counts, { yates: is2x2 && params.yates })
    const blocks: ResultBlock[] = []
    const values: AnalysisResult['values'] = {}

    let useFisher = params.test === 'fisher'
    let fisherP = Number.NaN
    if (useFisher) {
      try {
        const f = fisherExact(counts)
        if (is2x2 && params.tails === 'one') {
          const odds = counts[0]![0]! * counts[1]![1]! - counts[0]![1]! * counts[1]![0]!
          fisherP = odds >= 0 ? f.pGreater : f.pLess
        } else fisherP = f.p
      } catch {
        useFisher = false
        diagnostics.push({
          level: 'info',
          message:
            'Fisher’s exact test is not available for this table; a chi-square test is shown.',
        })
      }
    }
    if (useFisher) {
      blocks.push(kv('Fisher’s exact test', pRows(fisherP, is2x2 ? params.tails : 'two', true)))
      values.p = pval(fisherP)
    } else {
      const oneTailed = is2x2 && params.tails === 'one'
      const p = oneTailed ? chi.p / 2 : chi.p
      blocks.push(
        kv(is2x2 && params.yates ? 'Chi-square test with Yates’ correction' : 'Chi-square test', [
          ...pRows(p, oneTailed ? 'one' : 'two', false),
          ['Chi-square', num(chi.chiSq)],
          ['df', int(chi.df)],
        ]),
      )
      values.p = pval(p)
      values.chiSq = num(chi.chiSq)
      if (chi.expected.flat().some((e) => e < 5)) {
        diagnostics.push({
          level: 'info',
          message: 'Some expected counts are below 5, so the chi-square P value may be inaccurate.',
        })
      }
    }

    if (params.trend && counts.length >= 3 && counts[0]!.length === 2) {
      const t = chiSquareTrend(counts)
      blocks.push(
        kv('Chi-square test for trend', [
          ...pRows(t.p, 'two', false),
          ['Chi-square', num(t.chiSq)],
          ['df', int(t.df)],
        ]),
      )
    }

    if (params.effectSize) {
      if (is2x2) {
        const phi = phiCoefficient(counts)
        blocks.push(kv('Effect size', [['Phi (φ)', num(phi)]]))
        values.phi = num(phi)
      } else {
        const v = cramersV(counts)
        blocks.push(kv('Effect size', [['Cramér’s V', num(v)]]))
        values.cramersV = num(v)
      }
    }

    if (is2x2 && (params.riskEstimates || params.oddsRatio || params.diagnostic)) {
      const e = twoByTwo(counts, { confLevel: level })
      const [g1, g2] = rowNames
      const outcome = colNames[0]
      if (params.riskEstimates) {
        blocks.push(
          kv(`Relative risk of “${outcome}”, ${g1} vs. ${g2}`, [
            ...estimateRows('Relative risk', e.relativeRisk, level),
          ]),
          kv('Difference between proportions', [
            ...estimateRows('Difference', e.riskDifference, level),
            ...(e.nnt ? nntRows(e.nnt, level) : []),
          ]),
        )
        values.relativeRisk = num(e.relativeRisk.value)
      }
      if (params.oddsRatio) {
        blocks.push(
          kv(`Odds ratio, ${g1} vs. ${g2}`, estimateRows('Odds ratio', e.oddsRatio, level)),
        )
        values.oddsRatio = num(e.oddsRatio.value)
      }
      if (params.diagnostic) {
        blocks.push(
          kv(`Sensitivity and specificity (condition: ${g1} vs. ${g2}; test result: ${outcome})`, [
            ...estimateRows('Sensitivity', e.sensitivity, level),
            ...estimateRows('Specificity', e.specificity, level),
            ...estimateRows('Positive predictive value', e.ppv, level),
            ...estimateRows('Negative predictive value', e.npv, level),
            ['Likelihood ratio', num(e.likelihoodRatio)],
          ]),
        )
      }
    }

    const rowTotals = counts.map((r) => r.reduce((s, v) => s + v, 0))
    const colTotals = colNames.map((_, j) => counts.reduce((s, r) => s + r[j]!, 0))
    const total = rowTotals.reduce((s, v) => s + v, 0)
    blocks.push(
      kv('Data analyzed', [
        ['Number of rows', int(counts.length)],
        ['Number of columns', int(colNames.length)],
        ['Total', int(total)],
      ]),
    )

    const withTitles = (vals: ResultValue[][]) => vals.map((r, i) => [text(rowNames[i]!), ...r])
    const heads = ['', ...colNames]
    const pairwiseSheet = pairwiseComparisons(counts, rows, rowNames, params, useFisher)
    if (pairwiseSheet?.diagnostic) diagnostics.push(pairwiseSheet.diagnostic)
    return result({
      diagnostics,
      sheets: [
        resultsSheet(blocks),
        {
          key: 'expected',
          title: 'Expected counts',
          blocks: [
            table(
              `Expected counts if rows and columns were independent (P < ${ALPHA} suggests they are not)`,
              heads,
              withTitles(chi.expected.map((r) => r.map((v) => num(v)))),
            ),
          ],
        },
        {
          key: 'percentages',
          title: 'Percentages',
          blocks: [
            table(
              'Percent of row total',
              heads,
              withTitles(percentRows(counts, (i) => rowTotals[i]!)),
            ),
            table(
              'Percent of column total',
              heads,
              withTitles(percentRows(counts, (_, j) => colTotals[j]!)),
            ),
            table('Percent of grand total', heads, withTitles(percentRows(counts, () => total))),
          ],
        },
        ...(pairwiseSheet ? [pairwiseSheet.sheet] : []),
      ],
      values,
    })
  },
}

const METHOD_TITLE: Record<Params['pairwiseMethod'], string> = {
  bonferroni: 'Bonferroni',
  'holm-sidak': 'Holm-Šídák',
  sidak: 'Šídák',
  none: 'no correction',
}

/**
 * Comparisons of pairs of rows (roadmap 18): each pair's 2 × c table is tested with the test of
 * the main analysis (Fisher's exact, or chi-square with Yates for 2 × 2 pairs when chosen), and
 * the P values are corrected as one family. `rows` maps the analyzed rows to table rows (the
 * control is picked by table row).
 */
function pairwiseComparisons(
  counts: number[][],
  rows: readonly number[],
  rowNames: readonly string[],
  params: Params,
  useFisher: boolean,
): { sheet: ResultSheet; diagnostic?: Diagnostic } | null {
  if (params.pairwise === 'none' || counts.length < 3) return null
  const controlRow = Number.parseInt(params.pairwiseControl, 10)
  const found = rows.indexOf(Number.isFinite(controlRow) ? controlRow : 0)
  const control = found >= 0 ? found : 0
  const pairs = contingencyPairwise(counts, {
    test: useFisher ? 'fisher' : 'chiSquare',
    yates: params.yates,
    compare: params.pairwise,
    control,
    method: params.pairwiseMethod,
    alpha: ALPHA,
  })
  const fellBack = useFisher && pairs.some((r) => r.test === 'chiSquare')
  const adjusted = params.pairwiseMethod !== 'none'
  const columns = [
    'Comparison',
    'Test',
    'Chi-square',
    'df',
    'P value',
    ...(adjusted ? ['Adjusted P value'] : []),
    'Summary',
    `Significant (P < ${ALPHA})?`,
  ]
  const tableRows = pairs.map((r) => {
    const shown = r.adjusted
    return [
      text(`${rowNames[r.rowA]} vs. ${rowNames[r.rowB]}`),
      text(r.test === 'fisher' ? 'Fisher’s exact' : 'Chi-square'),
      num(r.chiSq),
      int(r.df),
      pval(r.p),
      ...(adjusted ? [pval(r.adjusted)] : []),
      psum(shown),
      Number.isNaN(shown) ? text('') : yesNo(r.flagged),
    ]
  })
  return {
    sheet: {
      key: 'pairwise',
      title: 'Multiple comparisons',
      blocks: [
        table(
          `${params.pairwise === 'control' ? `Each row vs. ${rowNames[control]}` : 'Every pair of rows'} (${METHOD_TITLE[params.pairwiseMethod]})`,
          columns,
          tableRows,
        ),
        {
          type: 'note',
          text: 'Each comparison tests the two rows’ table on its own (outcomes neither row has are left out). Chi-square and df are shown for every pair.',
        },
      ],
    },
    ...(fellBack
      ? {
          diagnostic: {
            level: 'info',
            message:
              'Fisher’s exact test is too large for some pairs of rows; chi-square is used for them.',
          },
        }
      : {}),
  }
}
