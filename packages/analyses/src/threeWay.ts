import type {
  AnalysisDef,
  Comparison,
  NormalizedDataSet,
  ResultBlock,
  ResultSheet,
  ResultValue,
} from '@ps/model'
import {
  effectSizes,
  type FactorialInput,
  factorialAnova,
  type GroupData,
  type McRow,
  multipleComparisons,
  stratumName,
  threeWayRM,
} from '@ps/stats'
import { z } from 'zod'
import {
  ALL_PAIRS_METHODS,
  allPairsMethod,
  anovaSummaryTable,
  anovaTable,
  CONTROL_METHODS,
  comparisonTable,
  controlMethod,
  effectSizeTable,
  METHOD_TITLE,
  magnitudeWarning,
  noResidualWarning,
  totalSS,
} from './anovaCommon.ts'
import {
  CONFIDENCE_FIELD,
  confidenceLevel,
  dfText,
  exclusionNotes,
  failure,
  int,
  kv,
  num,
  pSig,
  psum,
  pval,
  result,
  resultsSheet,
  significant,
  statText,
  summaryProblem,
  table,
  text,
  tooFewDataSets,
  yesNo,
} from './common.ts'
import { cellGroup, cellHasData, rowTitleOf } from './grouped.ts'

// ---------------------------------------------------------------------------------------------
// Three-way ANOVA, Prism's 2 × 2 × k layout on a grouped table: the rows are one factor (k
// levels); data sets A–D are two two-level factors, A and B vs. C and D ("column factor 1") and
// A and C vs. B and D ("column factor 2"). Ordinary (not repeated measures) ANOVA.
// ---------------------------------------------------------------------------------------------

const oneFactorMethod = z.enum(['holm-sidak', 'sidak', 'bonferroni', 'fisher', 'bky'])

const Params = z.object({
  comparisons: z.enum(['none', 'allCells', 'vsControl', 'oneFactor']).default('none'),
  allPairsMethod: allPairsMethod.default('tukey'),
  controlMethod: controlMethod.default('dunnett'),
  oneFactorMethod: oneFactorMethod.default('holm-sidak'),
  confidenceLevel,
  /**
   * Repeated measures (Prism's three checkboxes): values of one subject are stacked in a
   * subcolumn down the rows (`repeatedRows`), spread across A/B vs. C/D (`repeatedCol1`: the same
   * subcolumn of A and C, of B and D) and/or A/C vs. B/D (`repeatedCol2`).
   */
  repeatedRows: z.boolean().default(false),
  repeatedCol1: z.boolean().default(false),
  repeatedCol2: z.boolean().default(false),
  sphericity: z.enum(['gg', 'assumed']).default('gg'),
  /** RM ANOVA when there are no missing values, else a mixed model; or always one of them. */
  rmMethod: z.enum(['auto', 'anova', 'mixed']).default('auto'),
})
type Params = z.infer<typeof Params>

const ONE_FACTOR_METHODS = ALL_PAIRS_METHODS.filter((m) => m.value !== 'tukey').map((m) =>
  m.value === 'holm-sidak' ? { ...m, label: 'Holm-Šidák (step-down, recommended)' } : m,
)

const FACTOR_NAMES = ['Row factor', 'Column factor 1', 'Column factor 2']
const nameOf = (f: readonly number[]) => f.map((i) => FACTOR_NAMES[i]!).join(' × ')
/** Keys of the effects' P values (`p.<key>`), in the order of the ANOVA's effects. */
const EFFECT_KEYS = ['row', 'col1', 'col2', 'row_col1', 'row_col2', 'col1_col2', 'row_col1_col2']

export const threeWayAnovaDef: AnalysisDef<Params> = {
  id: 'threeWayAnova',
  version: 1,
  title: 'Three-way ANOVA',
  category: 'Grouped analyses',
  description:
    'Three factors in a 2 × 2 × k design: the rows are one factor, data sets A–D two more (A, B vs. C, D and A, C vs. B, D). Main effects, two- and three-way interactions, effect sizes and multiple comparisons.',
  accepts: ['grouped'],
  inputs: { min: 4, max: 4 },
  params: Params,
  form: [
    {
      path: ['comparisons'],
      label: 'Multiple comparisons',
      kind: 'radio',
      options: [
        { value: 'none', label: 'No multiple comparisons' },
        { value: 'allCells', label: 'Compare each cell mean with every other cell mean' },
        { value: 'vsControl', label: 'Compare the control (first) cell mean with the others' },
        { value: 'oneFactor', label: 'Compare cell means that differ by only one factor' },
      ],
    },
    {
      path: ['allPairsMethod'],
      label: 'Test',
      kind: 'select',
      options: ALL_PAIRS_METHODS,
      showIf: { path: ['comparisons'], in: ['allCells'] },
    },
    {
      path: ['controlMethod'],
      label: 'Test',
      kind: 'select',
      options: CONTROL_METHODS,
      showIf: { path: ['comparisons'], in: ['vsControl'] },
    },
    {
      path: ['oneFactorMethod'],
      label: 'Test',
      kind: 'select',
      options: ONE_FACTOR_METHODS,
      showIf: { path: ['comparisons'], in: ['oneFactor'] },
    },
    CONFIDENCE_FIELD,
    {
      path: ['repeatedRows'],
      label: 'Repeated measures: each subcolumn is one subject measured in every row (row factor)',
      kind: 'checkbox',
    },
    {
      path: ['repeatedCol1'],
      label:
        'Repeated measures in column factor 1 (A, B vs. C, D): a subject in A is also in C, B in D',
      kind: 'checkbox',
    },
    {
      path: ['repeatedCol2'],
      label:
        'Repeated measures in column factor 2 (A, C vs. B, D): a subject in A is also in B, C in D',
      kind: 'checkbox',
    },
    {
      path: ['sphericity'],
      label: 'Sphericity',
      kind: 'radio',
      options: [
        {
          value: 'gg',
          label: 'Don’t assume sphericity: Geisser-Greenhouse correction (recommended)',
        },
        { value: 'assumed', label: 'Assume sphericity' },
      ],
      showIf: [{ path: ['repeatedRows'], in: [true] }],
    },
    {
      path: ['rmMethod'],
      label: 'Analyze repeated measures with',
      kind: 'radio',
      options: [
        {
          value: 'auto',
          label: 'Repeated measures ANOVA, or a mixed-effects model when values are missing',
        },
        { value: 'anova', label: 'Repeated measures ANOVA always' },
        { value: 'mixed', label: 'A mixed-effects model always' },
      ],
    },
  ],
  run(input, params) {
    const few = tooFewDataSets(
      input,
      4,
      'Three-way ANOVA needs four data sets (two levels of each of the two column factors).',
    )
    if (few) return few
    const diagnostics = exclusionNotes(input)
    const level = params.confidenceLevel
    const rowCount = input[0]?.rowCount ?? 0
    const rowName = (r: number) => rowTitleOf(input, r)
    const T = input.map((d) => d.title)
    for (const ds of input)
      for (let r = 0; r < rowCount; r++) {
        const problem = summaryProblem(ds, r, 1, rowName(r))
        if (problem) return failure(problem, diagnostics)
      }
    const rows = Array.from({ length: rowCount }, (_, r) => r).filter((r) =>
      input.some((ds) => cellHasData(ds, r)),
    )
    if (rows.length < 2)
      return failure('Three-way ANOVA needs at least two rows with data.', diagnostics)
    const repeated = [params.repeatedRows, params.repeatedCol1, params.repeatedCol2]
      .map((on, f) => (on ? f : -1))
      .filter((f) => f >= 0)
    if (repeated.length) return runRepeated(input, params, rows, repeated, diagnostics)
    const cells: FactorialInput[] = []
    const where: { row: number; ds: number }[] = []
    for (const [ri, r] of rows.entries()) {
      for (let d = 0; d < 4; d++) {
        const g = cellGroup(input[d]!, r)
        if (!g)
          return failure(
            `Every cell needs values: “${T[d]}” has none in ${rowName(r)}.`,
            diagnostics,
          )
        cells.push({ levels: [ri, d >> 1, d & 1], ...(g as GroupData) })
        where.push({ row: r, ds: d })
      }
    }
    const res = factorialAnova(cells, [rows.length, 2, 2])
    if (res.error === 'no-residual-df')
      return failure(
        'Three-way ANOVA needs more than one value in some cells (there is no residual variation to test against).',
        diagnostics,
      )

    const effects = res.sources.filter((s) => !s.residual)
    diagnostics.push(...magnitudeWarning(res.cells))
    diagnostics.push(...noResidualWarning(res.sources.at(-1)!.ss, res.ssTotal, 'cells'))
    const dfRes = res.dfResidual
    const blocks: ResultBlock[] = [
      kv('Factors', [
        ['Row factor', text(`${rows.length} rows (${rows.map(rowName).join(', ')})`)],
        [FACTOR_NAMES[1]!, text(`${T[0]}, ${T[1]} vs. ${T[2]}, ${T[3]}`)],
        [FACTOR_NAMES[2]!, text(`${T[0]}, ${T[2]} vs. ${T[1]}, ${T[3]}`)],
      ]),
      anovaSummaryTable(
        'Three-way ANOVA',
        effects.map((s) => ({ ...s, name: nameOf(s.factors) })),
      ),
      anovaTable(
        effects.map((s) => ({ ...s, name: nameOf(s.factors) })),
        res.sources.at(-1)!,
        dfRes,
      ),
      effectSizeTable(
        effects.map((s) => [
          nameOf(s.factors),
          effectSizes(s, { ss: res.sources.at(-1)!.ss, df: dfRes }, res.ssTotal, res.N),
        ]),
      ),
      kv('Data summary', [
        ['Number of rows (row factor levels)', int(rows.length)],
        ['Number of cells', int(cells.length)],
        ['Number of values', int(res.N)],
        ['Balanced design?', yesNo(res.balanced)],
      ]),
    ]
    const sheets: ResultSheet[] = [resultsSheet(blocks)]
    const values = Object.fromEntries(effects.map((s, i) => [`p.${EFFECT_KEYS[i]}`, pval(s.p)]))
    if (params.comparisons === 'none') return result({ sheets, diagnostics, values })

    // ---- Multiple comparisons of cell means (pooled MSE, residual df) --------------------------
    const K = cells.length
    const pairs: [number, number][] = []
    if (params.comparisons === 'vsControl') for (let j = 1; j < K; j++) pairs.push([0, j])
    else
      for (let i = 0; i < K; i++)
        for (let j = i + 1; j < K; j++) {
          const differ = [0, 1, 2].filter((f) => cells[i]!.levels[f] !== cells[j]!.levels[f])
          if (params.comparisons === 'allCells' || differ.length === 1) pairs.push([i, j])
        }
    const method =
      params.comparisons === 'allCells'
        ? params.allPairsMethod
        : params.comparisons === 'vsControl'
          ? params.controlMethod
          : params.oneFactorMethod
    const mc: McRow[] = multipleComparisons(
      res.cells.map((c) => ({ mean: c.mean, n: c.n, sd: c.sd })),
      pairs,
      {
        method: method as never,
        mse: res.mse,
        df: dfRes,
        confLevel: level,
        nMeans: K,
        control: params.comparisons === 'vsControl' ? 0 : undefined,
      },
    )
    const cellName = (i: number) => `${rowName(where[i]!.row)}:${T[where[i]!.ds]}`
    const labels = pairs.map(([i, j]) => `${cellName(i)} vs. ${cellName(j)}`)
    const comparisons: Comparison[] = pairs.map(([i, j], k) => {
      const [a, b] = [where[i]!, where[j]!]
      return {
        key: `cell${a.row}:${input[a.ds]!.ref.key}|${b.row}:${input[b.ds]!.ref.key}`,
        a: input[a.ds]!.ref,
        b: input[b.ds]!.ref,
        rowA: a.row,
        rowB: b.row,
        p: mc[k]!.p,
        pAdjusted: mc[k]!.p,
      }
    })
    const family =
      params.comparisons === 'allCells'
        ? 'every cell mean with every other'
        : params.comparisons === 'vsControl'
          ? 'the first cell (control) with every other'
          : 'cell means that differ by one factor'
    sheets.push({
      key: 'comparisons',
      title: 'Multiple comparisons',
      blocks: [
        comparisonTable(`${METHOD_TITLE[method] ?? method} — ${family}`, labels, mc, level, method),
      ],
    })
    return result({ sheets, diagnostics, values, comparisons })
  },
}

// ---------------------------------------------------------------------------------------------
// Repeated measures / mixed-effects three-way ANOVA (roadmap 18)
// ---------------------------------------------------------------------------------------------

function runRepeated(
  input: readonly NormalizedDataSet[],
  params: Params,
  rows: number[],
  repeated: number[],
  diagnostics: ReturnType<typeof exclusionNotes>,
) {
  if (input.some((d) => d.data.shape !== 'replicates'))
    return failure(
      'Repeated measures need raw values (one subject per subcolumn), not summary data.',
      diagnostics,
    )
  const y: number[] = []
  const row: number[] = []
  const col1: number[] = []
  const col2: number[] = []
  const subject: number[] = []
  const ids = new Map<string, number>()
  rows.forEach((r, ri) => {
    input.forEach((ds, d) => {
      if (ds.data.shape !== 'replicates') return
      ds.data.reps.forEach((rep, j) => {
        const l = [ri, d >> 1, d & 1]
        // A subject: the subcolumn and the levels of the factors that are not repeated.
        const key = [j, ...[0, 1, 2].map((f) => (repeated.includes(f) ? '*' : l[f]))].join('|')
        let s = ids.get(key)
        if (s === undefined) {
          s = ids.size
          ids.set(key, s)
        }
        y.push(rep[r] ?? Number.NaN)
        row.push(ri)
        col1.push(l[1]!)
        col2.push(l[2]!)
        subject.push(s)
      })
    })
  })
  const res = threeWayRM(
    { y, row, col1, col2, subject },
    { repeated, sphericity: params.sphericity, method: params.rmMethod },
  )
  const rmName = repeated.map((f) => FACTOR_NAMES[f]!).join(', ')
  if (res.error)
    return failure(
      res.error === 'empty-cells'
        ? 'Every cell needs values.'
        : res.error === 'incomplete'
          ? 'Repeated measures ANOVA needs every subject in every repeated cell; choose a mixed-effects model for data with missing values.'
          : 'The model can’t be fit to these data (too few subjects or values).',
      diagnostics,
    )
  if (params.comparisons !== 'none')
    diagnostics.push({
      level: 'info',
      message: 'Multiple comparisons aren’t available yet with repeated measures three-way ANOVA.',
    })
  const blocks: ResultBlock[] = [
    kv('Design', [
      ['Repeated measures in', text(rmName)],
      [
        'Analysis',
        text(res.kind === 'anova' ? 'Repeated measures ANOVA' : 'Mixed-effects model (REML)'),
      ],
      [
        'Sphericity',
        text(
          res.kind === 'mixed'
            ? 'Not corrected (mixed model)'
            : params.sphericity === 'gg'
              ? 'Not assumed: Geisser-Greenhouse correction'
              : 'Assumed',
        ),
      ],
      ['Number of subjects', int(res.nSubjects)],
    ]),
  ]
  const gg = res.kind === 'anova' && params.sphericity === 'gg'
  const pOf = (e: (typeof res.effects)[number]) =>
    gg && e.pCorrected !== undefined ? e.pCorrected : e.p
  blocks.push(
    table(
      res.kind === 'anova' ? 'Repeated measures three-way ANOVA' : 'Fixed effects (Type III)',
      [
        'Source of Variation',
        'P value',
        'P value summary',
        'Significant?',
        ...(gg ? ['Geisser-Greenhouse ε'] : []),
      ],
      res.effects.map((e) => [
        text(nameOf(e.factors)),
        pval(pOf(e)),
        psum(pOf(e)),
        significant(pOf(e)),
        ...(gg ? [e.epsilon === undefined ? text('') : num(e.epsilon)] : []),
      ]),
    ),
  )
  if (res.kind === 'anova') {
    const ssTotal = totalSS(y)
    const rowsAnova: ResultValue[][] = []
    for (const e of res.effects)
      rowsAnova.push([
        text(nameOf(e.factors)),
        num(e.ss),
        int(e.df),
        num(e.ms),
        text(`F (${dfText(e.df)}, ${dfText(e.dfd)}) = ${statText(e.F)}`),
        pval(e.p),
        text(stratumName(e.stratum, repeated)),
      ])
    for (const st of res.strata)
      rowsAnova.push([
        text(stratumName(st.within, repeated)),
        num(st.ss),
        int(st.df),
        num(st.ms),
        text(''),
        text(''),
        text(''),
      ])
    blocks.push(
      table(
        'ANOVA table',
        ['Source of Variation', 'SS', 'DF', 'MS', 'F (DFn, DFd)', 'P value', 'Tested against'],
        rowsAnova,
      ),
      table(
        'Effect sizes',
        ['Source of Variation', 'Eta squared', 'Partial eta squared', 'Cohen’s f'],
        res.effects.map((e) => {
          const st = res.strata.find((x) => x.within.join(',') === e.stratum.join(','))!
          const es = effectSizes(e, { ss: st.ss, df: st.df }, ssTotal)
          return [
            text(nameOf(e.factors)),
            num(es.etaSquared),
            num(es.partialEtaSquared),
            num(es.cohensF),
          ]
        }),
      ),
      {
        type: 'note',
        text: 'Partial eta squared uses the error term each effect is tested against (Keppel), so the variation between subjects is left out.',
      },
    )
  } else {
    const m = res.mixed!
    blocks.push(
      table(
        'Mixed-effects model: F tests',
        ['Source of Variation', 'F', 'DFn', 'DFd', 'P value'],
        res.effects.map((e) => [
          text(nameOf(e.factors)),
          num(e.F),
          int(e.df),
          num(e.dfd),
          pval(e.p),
        ]),
      ),
      table(
        'Random effects',
        ['Source', 'Variance', 'SD'],
        Object.entries(m.variances).map(([k, v]) => [text(k), num(v), num(Math.sqrt(v))]),
      ),
      kv('Was the matching effective?', [
        ['Chi-square', num(m.matching.chi2)],
        ['df', int(m.matching.df)],
        ...pSig(m.matching.p),
      ]),
      kv('Data summary', [
        ['Number of values analyzed', int(m.nObs)],
        ['REML log likelihood', num(m.logLik)],
      ]),
    )
  }
  const values = Object.fromEntries(
    res.effects.map((e, i) => [`p.${EFFECT_KEYS[i]}`, pval(pOf(e))]),
  )
  return result({ blocks, diagnostics, values })
}
