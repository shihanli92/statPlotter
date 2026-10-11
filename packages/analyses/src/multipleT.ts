import type { AnalysisDef, Comparison, GraphableDataSet, ResultBlock, ResultValue } from '@ps/model'
import {
  correctFamily,
  type MultipleTRowInput,
  type MultipleTSkip,
  type MultipleTTestMethod,
  multipleTTests,
  negLog10P,
} from '@ps/stats'
import { z } from 'zod'
import {
  decided,
  exclusionNotes,
  failure,
  int,
  kv,
  num,
  pval,
  result,
  table,
  text,
  tooFewDataSets,
} from './common.ts'
import {
  cellGroup,
  cellHasData,
  cellReps,
  FAMILY_FIELDS,
  FAMILY_TITLE,
  familyColumns,
  familyLevel,
  familyMethod,
  familyParams,
  rowTitleOf,
} from './grouped.ts'

// ---------------------------------------------------------------------------------------------
// Multiple t tests (and nonparametric tests), one per row of a grouped table
// ---------------------------------------------------------------------------------------------

const Params = z.object({
  design: z.enum(['unpaired', 'paired']).default('unpaired'),
  distribution: z.enum(['gaussian', 'lognormal', 'nonparametric']).default('gaussian'),
  /** Unpaired parametric tests: Welch (the default), per-row pooled SD, or one SD for all. */
  variance: z.enum(['welch', 'individual', 'consistent']).default('welch'),
  /** Unpaired nonparametric test. */
  rankTest: z.enum(['mannWhitney', 'kolmogorovSmirnov']).default('mannWhitney'),
  ...familyParams,
  /** "Compute the difference as": first data set − second, or second − first. */
  difference: z.enum(['aMinusB', 'bMinusA']).default('aMinusB'),
  /** Add a −log10(P) column (the volcano plot's Y). */
  reportLogP: z.boolean().default(false),
})
type Params = z.infer<typeof Params>

const parametric = [
  { path: ['distribution'], in: ['gaussian', 'lognormal'] },
  { path: ['design'], in: ['unpaired'] },
] as const

function testMethod(p: Params): MultipleTTestMethod {
  if (p.design === 'paired') return p.distribution === 'nonparametric' ? 'wilcoxon' : 'paired'
  if (p.distribution === 'nonparametric') return p.rankTest
  return p.variance === 'welch' ? 'welch' : p.variance === 'consistent' ? 'pooled' : 'unpaired'
}

const TEST_NAME: Record<MultipleTTestMethod, string> = {
  welch: 'Unpaired t test with Welch’s correction (individual variance for each row)',
  unpaired: 'Unpaired t test (pooled variance within each row)',
  pooled: 'Unpaired t test, assuming a consistent SD across all rows',
  paired: 'Paired t test',
  mannWhitney: 'Mann-Whitney test',
  kolmogorovSmirnov: 'Kolmogorov-Smirnov test',
  wilcoxon: 'Wilcoxon matched-pairs signed rank test',
}
const LOG_TEST_NAME: Partial<Record<MultipleTTestMethod, string>> = {
  welch: 'Lognormal t test with Welch’s correction (t test on log10 values)',
  unpaired: 'Lognormal t test (t test on log10 values, pooled variance within each row)',
  pooled: 'Lognormal t test (t test on log10 values), assuming a consistent SD across all rows',
  paired: 'Ratio paired t test (paired t test on log10 of the ratios)',
}
const SKIP_TEXT: Record<MultipleTSkip, string> = {
  'too-few-values': 'too few values',
  'no-variation': 'no variation',
  'not-positive': 'fewer than two values > 0 in a group: values ≤ 0 can’t be log-transformed',
  'summary-data': 'needs raw values, not mean/SD/N',
  'no-pairs': 'too few complete pairs',
}

export const multipleTDef: AnalysisDef<Params> = {
  id: 'multipleT',
  version: 1,
  title: 'Multiple t tests (and nonparametric tests)',
  category: 'Grouped analyses',
  description:
    'Compare two data sets at each row (one t test, Mann-Whitney, Kolmogorov-Smirnov or Wilcoxon test per row), controlling the false discovery rate or the family-wise error rate; volcano plot.',
  accepts: ['grouped'],
  inputs: { min: 2, max: 2 },
  params: Params,
  form: [
    {
      path: ['design'],
      label: 'Experimental design',
      kind: 'radio',
      options: [
        { value: 'unpaired', label: 'Unpaired' },
        { value: 'paired', label: 'Paired (values in the same subcolumn are matched)' },
      ],
    },
    {
      path: ['distribution'],
      label: 'Assume Gaussian distribution?',
      kind: 'radio',
      options: [
        { value: 'gaussian', label: 'Normal (Gaussian) distribution' },
        { value: 'lognormal', label: 'Lognormal distribution (analyze the logarithms)' },
        { value: 'nonparametric', label: 'Nonparametric test' },
      ],
    },
    {
      path: ['variance'],
      label: 'Assume equal SDs?',
      kind: 'radio',
      options: [
        {
          value: 'welch',
          label: 'No — Welch’s correction, an individual variance for each row (recommended)',
        },
        { value: 'individual', label: 'Yes — equal SDs within each row, estimated per row' },
        {
          value: 'consistent',
          label: 'Yes — one SD for all rows (more power; assumes every row has the same scatter)',
        },
      ],
      showIf: parametric,
    },
    {
      path: ['rankTest'],
      label: 'Nonparametric test',
      kind: 'radio',
      options: [
        { value: 'mannWhitney', label: 'Mann-Whitney test (compare ranks)' },
        { value: 'kolmogorovSmirnov', label: 'Kolmogorov-Smirnov test (compare distributions)' },
      ],
      showIf: [
        { path: ['distribution'], in: ['nonparametric'] },
        { path: ['design'], in: ['unpaired'] },
      ],
    },
    ...FAMILY_FIELDS,
    {
      path: ['difference'],
      label: 'Compute the difference as',
      kind: 'radio',
      options: [
        { value: 'aMinusB', label: 'First data set − second' },
        { value: 'bMinusA', label: 'Second data set − first' },
      ],
    },
    { path: ['reportLogP'], label: 'Report −log10(P value)', kind: 'checkbox' },
  ],
  // Volcano plot (drawn by default): difference vs −log10(P), the flagged rows (discoveries
  // or below threshold) as one series and the rest as another.
  outputs: (_keys, params) => {
    const graph = {
      id: 'volcano',
      name: 'Volcano plot',
      xTitle:
        params.distribution === 'lognormal'
          ? 'Difference of log10 means'
          : params.distribution === 'nonparametric'
            ? 'Difference of medians'
            : 'Difference',
      yTitle: '−log10(P value)',
    }
    return [
      // The flagged rows are labelled by row title (the most extreme 20; none without titles).
      {
        key: 'volcano:flagged',
        graph,
        mark: 'points' as const,
        pointLabels: { source: 'rowTitle' as const, which: 'all' as const, max: 20 },
      },
      { key: 'volcano:other', graph, mark: 'points' as const },
    ]
  },
  run(input, params) {
    const few = tooFewDataSets(input, 2, 'Multiple t tests compare two data sets.')
    if (few) return few
    const diagnostics = exclusionNotes(input)
    const [A, B] = input as [(typeof input)[0], (typeof input)[0]]
    const method = testMethod(params)
    const lognormal = params.distribution === 'lognormal'
    // "First − second" is A − B: the stats kernel reports B − A, so hand it (B, A).
    const [first, second] = params.difference === 'aMinusB' ? [B, A] : [A, B]
    const summary = A.data.shape === 'summary' || B.data.shape === 'summary'
    if (summary && method !== 'welch' && method !== 'unpaired' && method !== 'pooled')
      return failure(`The ${TEST_NAME[method]} needs raw values, not mean/SD/N.`, diagnostics)
    if (summary && lognormal)
      return failure('Lognormal t tests need raw values, not mean/SD/N.', diagnostics)

    const rowCount = A.rowCount
    const rows = Array.from({ length: rowCount }, (_, r) => r).filter(
      (r) => cellHasData(A, r) || cellHasData(B, r),
    )
    if (!rows.length) return failure('There are no values to compare.', diagnostics)
    const paired = method === 'paired' || method === 'wilcoxon'
    const cell = (ds: typeof A, r: number): MultipleTRowInput['a'] => {
      if (paired) return cellReps(ds, r) ?? []
      const g = cellGroup(ds, r)
      if (!g) return []
      return 'values' in g ? g.values : g
    }
    const res = multipleTTests(
      rows.map((r) => ({ a: cell(first, r), b: cell(second, r) })),
      { method, lognormal },
    )
    const fam = correctFamily(
      res.rows.map((x) => x.p),
      { method: familyMethod(params), q: params.q / 100, alpha: params.alpha },
    )
    const tested = res.rows.map((x, i) => (x.skip ? -1 : i)).filter((i) => i >= 0)
    if (!tested.length)
      return failure(
        `No row could be tested (${[...new Set(res.rows.map((x) => SKIP_TEXT[x.skip!]))].join('; ')}).`,
        diagnostics,
      )
    const skipped = res.rows.map((x, i) => (x.skip ? i : -1)).filter((i) => i >= 0)

    // ---- Tables ---------------------------------------------------------------------------------
    const t = (r: number) => rowTitleOf(input, r)
    const cols = familyColumns(params)
    const rank = method === 'mannWhitney' || method === 'kolmogorovSmirnov' || method === 'wilcoxon'
    const [nameA, nameB] = [A.title, B.title]
    const center = rank ? 'Median' : lognormal ? 'Geometric mean' : 'Mean'
    const diffLabel =
      params.difference === 'aMinusB' ? `${nameA} − ${nameB}` : `${nameB} − ${nameA}`
    const statLabel: Record<MultipleTTestMethod, string> = {
      welch: 't ratio',
      unpaired: 't ratio',
      pooled: 't ratio',
      paired: 't ratio',
      mannWhitney: 'Mann-Whitney U',
      kolmogorovSmirnov: 'Kolmogorov-Smirnov D',
      wilcoxon: 'Sum of signed ranks (W)',
    }
    const columns = [
      'Row',
      cols.flag,
      'P value',
      ...(params.reportLogP ? ['−log10(P value)'] : []),
      `${center} of ${nameA}`,
      `${center} of ${nameB}`,
      rank
        ? `Difference of medians (${diffLabel})`
        : lognormal
          ? `Difference of log10 means (${diffLabel})`
          : `Difference (${diffLabel})`,
      ...(lognormal ? [`Ratio of geometric means (${diffLabel.replace(' − ', ' / ')})`] : []),
      ...(rank ? [] : ['SE of difference']),
      statLabel[method],
      ...(rank ? [] : ['df']),
      ...(cols.adjusted ? [cols.adjusted] : []),
    ]
    // Centres are reported per data set (A, B), whatever the order of subtraction.
    const flip = params.difference === 'aMinusB'
    const rowValues = (i: number): ResultValue[] => {
      const x = res.rows[i]!
      const [cA, cB] = flip ? [x.centerB, x.centerA] : [x.centerA, x.centerB]
      return [
        text(t(rows[i]!)),
        decided(fam.flagged[i]!, x.p),
        pval(x.p),
        ...(params.reportLogP ? [num(negLog10P(x.p))] : []),
        num(cA),
        num(cB),
        num(x.diff),
        ...(lognormal ? [num(x.ratio!)] : []),
        ...(rank ? [] : [num(x.se)]),
        rank && Number.isInteger(x.stat) ? int(x.stat) : num(x.stat),
        ...(rank ? [] : [method === 'welch' ? num(x.df) : int(x.df)]),
        ...(cols.adjusted ? [pval(fam.adjusted[i]!)] : []),
      ]
    }
    const flaggedIdx = tested.filter((i) => fam.flagged[i])
    const sorted = [...flaggedIdx].sort((i, j) => res.rows[i]!.p - res.rows[j]!.p || i - j)
    const fdr = params.approach === 'fdr'
    const level = familyLevel(params)
    const testWord = rank ? 'tests' : 't tests'

    const summaryRows: [string, ResultValue][] = [
      ['Column A', text(nameA)],
      ['Column B', text(nameB)],
      ['Test', text((lognormal && LOG_TEST_NAME[method]) || TEST_NAME[method])],
      ['Multiple comparisons', text(FAMILY_TITLE[familyMethod(params)])],
      fdr
        ? ['Desired FDR (Q)', text(`${params.q}%`)]
        : ['Significance level (alpha)', num(params.alpha)],
      [`Number of ${testWord}`, int(tested.length)],
      ['Number of rows not analyzed', int(skipped.length)],
      [fdr ? 'Number of discoveries' : 'Number below threshold', int(flaggedIdx.length)],
    ]
    if (res.pooled) {
      summaryRows.push(
        ['Pooled SD (all rows)', num(res.pooled.sd)],
        ['df of pooled SD', int(res.pooled.df)],
      )
    }
    if (fam.m0 !== undefined)
      summaryRows.push(['Estimated number of true null hypotheses', int(fam.m0)])
    const blocks: ResultBlock[] = [kv('Analysis summary', summaryRows)]
    // Audit 3 (RTA-2): values ≤ 0 left out of a lognormal test, the row tested with the rest.
    const leftOut = tested.filter((i) => res.rows[i]!.leftOut)
    if (leftOut.length) {
      const what = method === 'paired' ? 'pairs holding a value ≤ 0' : 'values ≤ 0'
      blocks.push({
        type: 'note',
        text: `Left out of the tests (${what}: no logarithm): ${leftOut.map((i) => `${t(rows[i]!)} (${res.rows[i]!.leftOut})`).join(', ')}.`,
      })
    }
    if (skipped.length) {
      blocks.push({
        type: 'note',
        text: `Not analyzed: ${skipped.map((i) => `${t(rows[i]!)} (${SKIP_TEXT[res.rows[i]!.skip!]})`).join(', ')}.`,
      })
    }
    const sheets = [
      { key: 'summary', title: 'Analysis summary', blocks },
      {
        key: 'tests',
        title: rank ? 'Tests' : 't tests',
        blocks: [table(rank ? 'Tests' : 't tests', columns, tested.map(rowValues))],
      },
      {
        key: 'flagged',
        title: fdr ? 'Discoveries' : 'Below threshold',
        blocks: sorted.length
          ? [
              table(
                fdr
                  ? `Discoveries (Q = ${params.q}%)`
                  : `P value below threshold (alpha = ${level})`,
                columns,
                sorted.map(rowValues),
              ),
            ]
          : [
              {
                type: 'note' as const,
                text: fdr ? 'No discoveries.' : 'No row is below the threshold.',
              },
            ],
      },
    ]

    // ---- Brackets and volcano plot --------------------------------------------------------------
    const comparisons: Comparison[] = tested.map((i) => ({
      key: `row${rows[i]}:${A.ref.key}|${B.ref.key}`,
      a: A.ref,
      b: B.ref,
      rowA: rows[i]!,
      rowB: rows[i]!,
      p: res.rows[i]!.p,
      pAdjusted: fam.adjusted[i]!,
    }))
    const volcano = (pick: boolean): GraphableDataSet => {
      const idx = tested.filter((i) => fam.flagged[i] === pick)
      return {
        title: pick
          ? fdr
            ? 'Discovery'
            : 'Below threshold'
          : fdr
            ? 'Not a discovery'
            : 'Not below threshold',
        x: idx.map((i) => res.rows[i]!.diff),
        // P values that underflowed to 0 at the smallest double's −log10 (audit 3, S5).
        y: idx.map((i) => negLog10P(res.rows[i]!.p)),
        // The analyzed rows, so the points can be labelled by row title.
        rows: idx.map((i) => rows[i]!),
        rowTitles: idx.map((i) => A.rowTitles?.[rows[i]!] ?? null),
      }
    }
    const values = {
      tests: int(tested.length),
      flagged: int(flaggedIdx.length),
    }
    return result({
      sheets,
      diagnostics,
      values,
      comparisons,
      outputs: { 'volcano:flagged': volcano(true), 'volcano:other': volcano(false) },
    })
  },
}
