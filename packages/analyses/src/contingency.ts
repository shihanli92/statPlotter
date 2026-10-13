import {
  type AnalysisDef,
  type AnalysisResult,
  contingencyCounts,
  type Diagnostic,
  type NormalizedDataSet,
  type Problem,
  pinDefaults,
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
  directionIssue,
  directionProblem,
  exclusionNotes,
  failure,
  int,
  interval,
  kv,
  num,
  oneTailedNotes,
  pct,
  pinObservedDirection,
  pRows,
  predicted,
  predictedField,
  predictedRows,
  problem,
  psum,
  pval,
  result,
  resultsSheet,
  shortText,
  TAILS_FIELD,
  table,
  tails,
  testValue,
  text,
  yesNo,
} from './common.ts'
import { rowTitleOf } from './grouped.ts'

const Params = z.object({
  test: z.enum(['fisher', 'chiSquare']).default('fisher'),
  yates: z.boolean().default(false),
  /** Roadmap 51c (S21): off by default — only when the rows are in a meaningful order. */
  trend: z.boolean().default(false),
  tails,
  predicted,
  /**
   * Roadmap 51c (S22): a 2 × 2's roles — the row of the treated or exposed group (the others are
   * the comparison) and the column of the outcome. RR, OR, NNT and the diagnostic block are
   * computed for this orientation (default: the first row and the first column, as before).
   */
  exposedRow: z.number().int().min(0).max(1).default(0),
  outcomeColumn: z.number().int().min(0).max(1).default(0),
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

/**
 * Version 1 (before 0.3.9): the trend test on by default; one-tailed P in the observed direction.
 * Saved analyses keep them.
 */
const migrate = (raw: unknown, from: number): unknown =>
  from >= 2 ? raw : pinObservedDirection(pinDefaults(raw, [[['trend'], true]]))

/** A 2 × 2 table turned so the exposed row and the outcome column come first (S22). */
export function oriented(
  counts: readonly (readonly number[])[],
  exposedRow: number,
  outcomeColumn: number,
): number[][] {
  const rows = exposedRow === 1 ? [counts[1]!, counts[0]!] : [counts[0]!, counts[1]!]
  return rows.map((r) => (outcomeColumn === 1 ? [r[1]!, r[0]!] : [r[0]!, r[1]!]))
}

const estimateRows = (label: string, e: Estimate, level: number): [string, ResultValue][] => [
  [label, num(e.value)],
  [`${pct(level)} CI`, interval(e.lower, e.upper, level)],
]

/**
 * NNT = 1 / difference. When the CI of the difference includes zero, the NNT's CI runs through
 * infinity (lower > upper): it is NNT ≥ lower or NNT ≤ upper, shown as text.
 */
function nntRows(
  e: Estimate,
  level: number,
  outcome: string,
  exposed: string,
): [string, ResultValue, string][] {
  // Roadmap 51d (U26): a positive number, said as what treating (being in the exposed row) does:
  // one fewer or one more of the outcome. A negative NNT is the same number for one fewer.
  const fewer = e.value < 0
  const flip = (v: number) => (fewer ? -v : v)
  const ci: ResultValue =
    e.lower > e.upper
      ? fewer
        ? text(`${fmt(flip(e.upper))} to ∞ and −∞ to ${fmt(flip(e.lower))}`)
        : text(`${fmt(e.lower)} to ∞ and −∞ to ${fmt(e.upper)}`)
      : fewer
        ? interval(-e.upper, -e.lower, level)
        : interval(e.lower, e.upper, level)
  const label = `Number needed to treat (${exposed}) for one ${fewer ? 'fewer' : 'more'} “${outcome}”`
  return [
    [label, num(Math.abs(e.value)), 'nnt'],
    [`${pct(level)} CI of NNT`, ci, 'nntCi'],
  ]
}
const fmt = (v: number) => shortText(v)

const percentRows = (counts: number[][], denom: (i: number, j: number) => number) =>
  counts.map((row, i) => row.map((v, j) => num((100 * v) / denom(i, j))))

export const contingencyDef: AnalysisDef<Params> = {
  id: 'contingency',
  version: 2,
  title: 'Chi-square (and Fisher’s exact) test',
  category: 'Contingency table analyses',
  description:
    'Test association in a contingency table (Fisher’s exact or chi-square, chi-square for trend), with relative risk, odds ratio and sensitivity/specificity for 2×2 tables.',
  accepts: ['contingency'],
  inputs: { min: 2, max: 64 },
  params: Params,
  migrateParams: migrate,
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
      label:
        'The rows are in a meaningful order (doses, ages): test for a trend (two outcome columns, three or more rows)',
      kind: 'checkbox',
    },
    {
      path: ['exposedRow'],
      label: 'Which row is the treated or exposed group? (2×2)',
      kind: 'radio',
      options: [
        { value: 0, label: 'The first row' },
        { value: 1, label: 'The second row' },
      ],
    },
    {
      path: ['outcomeColumn'],
      label: 'Which column is the outcome? (2×2)',
      kind: 'radio',
      options: [
        { value: 0, label: 'The first column' },
        { value: 1, label: 'The second column' },
      ],
    },
    TAILS_FIELD,
    predictedField(
      'A higher risk of the outcome in the exposed group',
      'A lower risk of the outcome in the exposed group',
    ),
    {
      path: ['riskEstimates'],
      label: 'Relative risk, difference between proportions and NNT (2×2)',
      kind: 'checkbox',
    },
    { path: ['oddsRatio'], label: 'Odds ratio (2×2)', kind: 'checkbox' },
    {
      path: ['diagnostic'],
      label:
        'This table is a test result against the truth: sensitivity, specificity and predictive values (2×2)',
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
        { value: 'holm-sidak', label: 'Holm-Šidák' },
        { value: 'sidak', label: 'Šidák' },
        { value: 'none', label: 'None (Fisher’s LSD-like)' },
      ],
      showIf: { path: ['pairwise'], in: ['all', 'control'] },
    },
    CONFIDENCE_FIELD,
  ],
  validate: validateContingency,
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
    const oneTailed = is2x2 && params.tails === 'one'
    if (oneTailed) {
      const unset = directionProblem(params, diagnostics)
      if (unset) return unset
    }
    const chi = chiSquareTest(counts, { yates: is2x2 && params.yates })
    const blocks: ResultBlock[] = []
    const values: AnalysisResult['values'] = {}
    // S22: the 2 × 2 turned to its roles (exposed row, outcome column first).
    const turned = is2x2 ? oriented(counts, params.exposedRow, params.outcomeColumn) : counts
    const [[a, b], [c, d]] = (
      is2x2
        ? turned
        : [
            [0, 0],
            [0, 0],
          ]
    ) as [[number, number], [number, number]]
    // The risk of the outcome in the exposed row minus the other's (the S1 effect's sign).
    const riskDiff = a / (a + b) - c / (c + d)
    const tail = { ...params, tails: oneTailed ? ('one' as const) : ('two' as const) }
    const [g1, g2] = is2x2
      ? params.exposedRow === 1
        ? [rowNames[1]!, rowNames[0]!]
        : [rowNames[0]!, rowNames[1]!]
      : ['', '']
    const outcome = is2x2 ? colNames[params.outcomeColumn]! : ''
    const words = [
      `a higher risk of “${outcome}” in ${g1} than in ${g2}`,
      `a lower risk of “${outcome}” in ${g1} than in ${g2}`,
    ] as const

    let useFisher = params.test === 'fisher'
    let fisherP = Number.NaN
    if (useFisher) {
      try {
        const f = fisherExact(oneTailed ? turned : counts)
        if (oneTailed) {
          // S1: the direction predicted; saved analyses (observed) the data's, as before.
          const odds = a * d - b * c
          const greater =
            params.predicted === 'increase' || (params.predicted === 'observed' && odds >= 0)
          fisherP = greater ? f.pGreater : f.pLess
        } else fisherP = f.p
      } catch {
        useFisher = false
        // S42: a different test than chosen is a warning, and the block names the test used.
        diagnostics.push({
          level: 'warning',
          message:
            'Fisher’s exact test is too large to compute for this table; the chi-square test is reported instead.',
        })
      }
    }
    if (useFisher) {
      blocks.push(
        kv('Fisher’s exact test', [
          ...pRows(fisherP, oneTailed ? 'one' : 'two', true),
          ...predictedRows(tail, words),
        ]),
      )
      values.p = pval(fisherP)
      Object.assign(values, testValue('Fisher’s exact test'))
      diagnostics.push(...oneTailedNotes(tail, riskDiff, fisherP, words, 'The risk'))
    } else {
      // S1: one-tailed chi-square is the signed z test of the two proportions (P/2 in the
      // predicted direction, else 1 − P/2), as prop.test(alternative =) gives.
      const along =
        params.predicted === 'observed' ||
        (params.predicted === 'increase' ? riskDiff >= 0 : riskDiff <= 0)
      const p = oneTailed ? (along ? chi.p / 2 : 1 - chi.p / 2) : chi.p
      blocks.push(
        kv(is2x2 && params.yates ? 'Chi-square test with Yates’ correction' : 'Chi-square test', [
          ...pRows(p, oneTailed ? 'one' : 'two', false),
          ...predictedRows(tail, words),
          ['Chi-square', num(chi.chiSq)],
          ['df', int(chi.df)],
        ]),
      )
      values.p = pval(p)
      values.chiSq = num(chi.chiSq)
      Object.assign(values, testValue('Chi-square test'))
      diagnostics.push(...oneTailedNotes(tail, riskDiff, p, words, 'The risk'))
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
      const e = twoByTwo(turned, { confLevel: level })
      if (params.riskEstimates) {
        blocks.push(
          kv(`Relative risk of “${outcome}”, ${g1} vs. ${g2}`, [
            ...estimateRows('Relative risk', e.relativeRisk, level),
          ]),
          kv('Difference between proportions', [
            ...estimateRows('Difference', e.riskDifference, level),
            ...(e.nnt ? nntRows(e.nnt, level, outcome, g1) : []),
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
  'holm-sidak': 'Holm-Šidák',
  sidak: 'Šidák',
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
          // S42: a different test than chosen is a warning (the table's Test column names it).
          diagnostic: {
            level: 'warning',
            message:
              'Fisher’s exact test is too large for some pairs of rows; the chi-square test is reported for them (see the Test column).',
          },
        }
      : {}),
  }
}

/**
 * Roadmap 51b (§4.6): a contingency table's problems before computing — complete rows of whole
 * counts, two rows and two columns with nonzero totals, a stated direction (one-tailed 2 × 2).
 */
function validateContingency(input: readonly NormalizedDataSet[], params: Params): Problem | null {
  const diagnostics = exclusionNotes(input)
  const { counts, rows, incompleteRows } = contingencyCounts(input)
  const rowTitle = (r: number) => rowTitleOf(input, r)
  if (incompleteRows.length)
    return problem(
      `Every cell of a row needs a count; ${incompleteRows.map(rowTitle).join(', ')} ${incompleteRows.length > 1 ? 'are' : 'is'} incomplete.`,
      'table',
      diagnostics,
    )
  if (counts.flat().some((v) => v < 0 || !Number.isInteger(v)))
    return problem(
      'A contingency table holds counts: whole numbers, zero or more.',
      'table',
      diagnostics,
    )
  if (counts.length < 2)
    return problem('A contingency table needs at least two rows.', 'table', diagnostics)
  if (input.length < 2)
    return problem('A contingency table needs at least two columns.', 'table', diagnostics)
  const emptyRows = rows.filter((_, i) => counts[i]!.every((v) => v === 0)).map(rowTitle)
  const emptyCols = input.map((d) => d.title).filter((_, j) => counts.every((row) => row[j] === 0))
  if (emptyRows.length || emptyCols.length) {
    const names = [...emptyRows, ...emptyCols]
    return problem(
      `Every row and column needs a nonzero total; ${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} all zeros.`,
      'table',
      diagnostics,
    )
  }
  const is2x2 = counts.length === 2 && counts[0]!.length === 2
  return is2x2 ? directionIssue(params, diagnostics) : null
}
