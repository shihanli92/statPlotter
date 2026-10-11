import type {
  AnalysisDef,
  AnalysisResult,
  Comparison,
  Diagnostic,
  NormalizedDataSet,
  ResultBlock,
} from '@ps/model'
import { type NestedResult, nestedAnova, nestedComparisons, nestedTTest } from '@ps/stats'
import { z } from 'zod'
import {
  ALL_PAIRS_METHODS,
  allPairsMethod,
  COMPARE_COLUMNS,
  CONTROL_FIELD,
  CONTROL_METHODS,
  comparisonTable,
  controlMethod,
  METHOD_TITLE,
  NO_COMPARISONS,
  oneWayPairs,
  pairComparisons,
} from './anovaCommon.ts'
import {
  ALPHA,
  CONFIDENCE_FIELD,
  confidenceLevel,
  dfText,
  exclusionNotes,
  failure,
  int,
  interval,
  kv,
  labelTable,
  num,
  pct,
  pRows,
  pSig,
  pval,
  result,
  statText,
  TAILS_FIELD,
  table,
  tails,
  text,
} from './common.ts'

// ---------------------------------------------------------------------------------------------
// Nested t test and nested one-way ANOVA (nested tables: a data set = a treatment group, its
// subcolumns = the subjects in it, rows = replicate measurements). See stats/anova/nested.ts
// for the model. Results are laid out as: the test, the size of the difference (t test) or
// the means (ANOVA), random effects as SD and variance, whether the subcolumns differ, and a
// data summary; the one-way ANOVA adds multiple comparisons "as they are for one-way ANOVA".
// ---------------------------------------------------------------------------------------------

/** groups[g][s]: the values of subcolumn s of data set g (empty/excluded left out). */
function nestedGroups(input: readonly NormalizedDataSet[]): number[][][] | null {
  if (input.some((d) => d.data.shape !== 'replicates')) return null
  return input.map((d) =>
    (d.data as { reps: Float64Array[] }).reps.map((c) => Array.from(c).filter(Number.isFinite)),
  )
}

const ERRORS: Record<NonNullable<NestedResult['error']>, string> = {
  'too-few-groups': 'Choose at least two data sets (groups).',
  'empty-group': 'Every data set needs at least one subcolumn with values.',
  'no-df': 'There must be more subcolumns (subjects) with values than data sets.',
  'not-estimable': 'The model could not be fitted to these data.',
  degenerate: 'There is no variation left to estimate (all values equal within the model).',
}

function commonBlocks(input: readonly NormalizedDataSet[], res: NestedResult): ResultBlock[] {
  const sd = (v: number) => (Number.isFinite(v) ? num(Math.sqrt(v)) : text(''))
  const vv = (v: number) => (Number.isFinite(v) ? num(v) : text(''))
  const hasRandom = Number.isFinite(res.variances.subcolumn)
  const blocks: ResultBlock[] = [
    table(
      'Random effects',
      ['', 'SD', 'Variance'],
      [
        [text('Subcolumn (nested)'), sd(res.variances.subcolumn), vv(res.variances.subcolumn)],
        [text('Residual'), sd(res.variances.residual), vv(res.variances.residual)],
      ],
    ),
    kv('Intraclass correlation', [
      ['ICC (subcolumn variance / total variance)', hasRandom ? num(res.icc) : text('')],
    ]),
  ]
  const st = res.subcolumnTest
  if (Number.isFinite(st.F))
    blocks.push(
      kv('Do the subcolumns differ? (F test of subcolumns within data sets)', [
        [
          'F, DFn, DFd',
          text(`F = ${statText(st.F)}, DFn = ${dfText(st.dfn)}, DFd = ${dfText(st.dfd)}`),
        ],
        ...pSig(st.p, 'Significant variation among subcolumns'),
      ]),
    )
  if (hasRandom)
    blocks.push(
      kv('Likelihood ratio test of the nested factor', [
        ['Chi-square, df', text(`${statText(res.lrt.chi2)}, ${dfText(res.lrt.df)}`)],
        ...pSig(res.lrt.p),
      ]),
      kv('Goodness of fit', [
        ['REML log-likelihood', num(res.logLik)],
        ['REML criterion (−2 log-likelihood)', num(-2 * res.logLik)],
      ]),
    )
  blocks.push(
    labelTable(
      'Data summary',
      input.map((d) => d.title),
      [
        ['Number of subcolumns (with values)', res.subjects.map(int)],
        ['Number of values', res.n.map(int)],
        ['Mean (least squares)', res.means.map((m) => num(m))],
      ],
    ),
  )
  return blocks
}

function nestedDiagnostics(input: readonly NormalizedDataSet[], res: NestedResult): Diagnostic[] {
  const out = exclusionNotes(input)
  if (!Number.isFinite(res.variances.subcolumn) && !res.error)
    out.push({
      level: 'warning',
      message:
        'Every subcolumn has a single value, so the nested variation can’t be separated from the residual; the test compares the values directly.',
    })
  else if (res.variances.subcolumn === 0)
    out.push({
      level: 'info',
      message:
        'The subcolumn variance is estimated as zero (no variation among subcolumns beyond the residual).',
    })
  return out
}

// ---- Nested t test ----------------------------------------------------------------------------

const NestedTParams = z.object({ tails, confidenceLevel })
type NestedTParams = z.infer<typeof NestedTParams>

export const nestedTDef: AnalysisDef<NestedTParams> = {
  id: 'nestedT',
  version: 1,
  title: 'Nested t test',
  category: 'Nested analyses',
  description:
    'Compare two groups whose values are replicate measurements of subjects (subcolumns), with a mixed-effects model (subjects random).',
  accepts: ['nested'],
  inputs: { min: 2, max: 2 },
  params: NestedTParams,
  form: [TAILS_FIELD, CONFIDENCE_FIELD],
  run(input, params) {
    const groups = nestedGroups(input)
    if (!groups) return failure('Nested analyses need raw values.', exclusionNotes(input))
    const res = nestedAnova(groups)
    const diagnostics = nestedDiagnostics(input, res)
    if (res.error) return failure(ERRORS[res.error], diagnostics)
    const level = params.confidenceLevel
    const t = nestedTTest(res, level, params.tails)
    const [a, b] = input as [NormalizedDataSet, NormalizedDataSet]
    const blocks: ResultBlock[] = [
      kv('Nested t test', [
        ...pRows(t.p, params.tails),
        ['t, df', text(`t = ${statText(Math.abs(t.t))}, df = ${dfText(t.df)}`)],
        ['F, DFn, DFd', text(`F = ${statText(t.t * t.t)}, DFn = 1, DFd = ${dfText(t.df)}`)],
      ]),
      kv('How big is the difference?', [
        [`Mean of ${a.title}`, num(res.means[0]!)],
        [`Mean of ${b.title}`, num(res.means[1]!)],
        ['Difference between means (B − A)', num(t.diff)],
        ['SE of difference', num(t.se)],
        [`${pct(level)} confidence interval`, interval(t.lo, t.hi, level)],
      ]),
      ...commonBlocks(input, res),
    ]
    const comparisons: Comparison[] = [
      { key: `${a.ref.key}|${b.ref.key}`, a: a.ref, b: b.ref, p: t.p },
    ]
    return result({
      sheets: [{ key: 'results', title: 'Nested t test', blocks }],
      diagnostics,
      values: {
        p: pval(t.p),
        t: num(t.t),
        df: num(t.df),
        diff: num(t.diff),
        icc: num(res.icc),
      },
      comparisons,
    })
  },
}

// ---- Nested one-way ANOVA -----------------------------------------------------------------------

/** Newman-Keuls isn't offered: it needs the pooled error term of ordinary ANOVA. */
const allPairsNested = allPairsMethod.exclude(['newman-keuls'])

const NestedOneWayParams = z.object({
  comparisons: z.enum(['none', 'allPairs', 'vsControl']).default('allPairs'),
  /** Data set key of the control; empty = the first data set. */
  control: z.string().default(''),
  allPairsMethod: allPairsNested.default('tukey'),
  controlMethod: controlMethod.default('dunnett'),
  confidenceLevel,
})
type NestedOneWayParams = z.infer<typeof NestedOneWayParams>

export const nestedOneWayDef: AnalysisDef<NestedOneWayParams> = {
  id: 'nestedOneWay',
  version: 1,
  title: 'Nested one-way ANOVA',
  category: 'Nested analyses',
  description:
    'Compare three or more groups whose values are replicate measurements of subjects (subcolumns), with a mixed-effects model, and multiple comparisons.',
  accepts: ['nested'],
  inputs: { min: 2, max: Number.POSITIVE_INFINITY },
  params: NestedOneWayParams,
  form: [
    {
      path: ['comparisons'],
      label: 'Multiple comparisons',
      kind: 'radio',
      options: [...COMPARE_COLUMNS, NO_COMPARISONS],
    },
    CONTROL_FIELD,
    {
      path: ['allPairsMethod'],
      label: 'Test',
      kind: 'select',
      options: ALL_PAIRS_METHODS.filter((m) => m.value !== 'newman-keuls'),
      showIf: { path: ['comparisons'], in: ['allPairs'] },
    },
    {
      path: ['controlMethod'],
      label: 'Test',
      kind: 'select',
      options: CONTROL_METHODS,
      showIf: { path: ['comparisons'], in: ['vsControl'] },
    },
    CONFIDENCE_FIELD,
  ],
  run(input, params) {
    const groups = nestedGroups(input)
    if (!groups) return failure('Nested analyses need raw values.', exclusionNotes(input))
    const res = nestedAnova(groups)
    const diagnostics = nestedDiagnostics(input, res)
    if (res.error) return failure(ERRORS[res.error], diagnostics)
    const level = params.confidenceLevel
    const tr = res.treatment
    const blocks: ResultBlock[] = [
      kv('Nested one-way ANOVA', [
        ['F', num(tr.F)],
        ['DFn, DFd', text(`${dfText(tr.dfn)}, ${dfText(tr.dfd)}`)],
        ...pSig(tr.p, 'Significant diff. among means'),
      ]),
      ...commonBlocks(input, res),
    ]
    const sheets: AnalysisResult['sheets'] = [
      { key: 'results', title: 'Nested one-way ANOVA', blocks },
    ]
    const { pairs } = oneWayPairs(input, params.comparisons, params.control)
    let comparisons: Comparison[] = []
    if (pairs.length) {
      const method =
        params.comparisons === 'allPairs' ? params.allPairsMethod : params.controlMethod
      const rows = nestedComparisons(res, pairs, method, { confLevel: level, alpha: ALPHA })
      const labels = pairs.map(([i, j]) => `${input[i]!.title} vs. ${input[j]!.title}`)
      sheets.push({
        key: 'comparisons',
        title: 'Multiple comparisons',
        blocks: [
          comparisonTable(METHOD_TITLE[method] ?? method, labels, rows, level, method),
          table(
            'Details',
            [
              'Comparison',
              'Mean 1',
              'Mean 2',
              'Mean Diff.',
              'SE of diff.',
              method === 'tukey' ? 'q' : 't',
              'DF',
            ],
            rows.map((r, k) => [
              text(labels[k]!),
              num(res.means[r.i]!),
              num(res.means[r.j]!),
              num(r.diff),
              num(r.se),
              num(r.stat),
              num(r.df),
            ]),
          ),
        ],
      })
      comparisons = pairComparisons(
        input,
        pairs,
        rows.map((r) => r.p),
      )
    }
    return result({
      sheets,
      diagnostics,
      values: { p: pval(tr.p), F: num(tr.F), icc: num(res.icc) },
      comparisons,
    })
  },
}
