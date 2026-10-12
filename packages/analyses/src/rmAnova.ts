import type {
  AnalysisResult,
  Comparison,
  Diagnostic,
  NormalizedDataSet,
  ResultBlock,
  ResultValue,
} from '@ps/model'
import {
  effectSizes,
  type OneWayRMResult,
  oneWayRM,
  type RepeatedFactor,
  rmComparisons,
  type TwoWayRMData,
  twoWayRM,
  twoWayRMComparisons,
} from '@ps/stats'
import { z } from 'zod'
import {
  type allPairsMethod,
  comparisonTable,
  comparisonTestValue,
  type controlMethod,
  type DifferenceAs,
  interactionNote,
  METHOD_TITLE,
  oneWayPairs,
  pairComparisons,
  pairLabel,
  signedRows,
  TWO_WAY_FAMILY_SUFFIX,
  totalSS,
  twoWayComparison,
} from './anovaCommon.ts'
import {
  ALPHA,
  decided,
  failure,
  int,
  kv,
  labelTable,
  num,
  PAIRED_NEEDS_RAW,
  pSig,
  psum,
  pval,
  result,
  resultsSheet,
  rowCountOf,
  shortText,
  significant,
  table,
  testValue,
  text,
} from './common.ts'

type Sphericity = 'gg' | 'assumed'
// Newman-Keuls is refused before these run (it needs a pooled error term).
type AllPairs = z.infer<typeof allPairsMethod>
type VsControl = z.infer<typeof controlMethod>

const fTest = (F: number, dfn: number, dfd: number, p: number): [string, ResultValue][] => [
  ['F (DFn, DFd)', text(`F (${fmt(dfn)}, ${fmt(dfd)}) = ${fmt(F, 4)}`)],
  ...pSig(p, 'Statistically significant'),
]
const fmt = (v: number, sig = 4) => (Number.isInteger(v) ? String(v) : shortText(v, sig))

const RM_ERRORS: Record<string, string> = {
  'too-few': 'Need at least two subjects with values.',
  'empty-treatment': 'Every treatment (column) needs at least one value.',
  'empty-cells':
    'Some cells (row × column) have no values; choose “Main effects only” to fit without the interaction.',
  'no-residual-df': 'There are too few values to estimate the residual variance.',
  'not-estimable': 'The design can’t be estimated from these data (too few levels or subjects).',
  degenerate: 'The data have no variability to analyze.',
}

/**
 * Roadmap 51c (S5): how matched values are analyzed — repeated-measures ANOVA with complete
 * data and a mixed-effects model when values are missing ('auto'), ANOVA of the complete
 * subjects only, or the mixed-effects model always.
 */
export const rmMethod = z.enum(['auto', 'anova', 'mixed']).default('auto')
export type RMMethod = z.infer<typeof rmMethod>
export const RM_METHOD_FIELD = {
  path: ['rmMethod'],
  label: 'Analyze the matched values with',
  kind: 'radio',
  options: [
    {
      value: 'auto',
      label: 'Repeated-measures ANOVA, or a mixed-effects model when values are missing',
    },
    { value: 'anova', label: 'Repeated-measures ANOVA of the complete subjects only' },
    { value: 'mixed', label: 'A mixed-effects model always' },
  ],
} as const

const DDF_NAME = { satterthwaite: 'Satterthwaite', containment: 'Containment' } as const

/**
 * S5: what a mixed-effects fit changes, said as a warning when values were missing (the user
 * chose repeated measures, and got a model with other assumptions), as information when chosen.
 */
function mixedNote(diagnostics: Diagnostic[], chosen: boolean, ddf: RMDdfName) {
  const what = `It assumes equal correlation between all pairs of conditions (sphericity); the Geisser-Greenhouse correction does not apply. Denominator df: ${DDF_NAME[ddf]}.`
  diagnostics.push(
    chosen
      ? { level: 'info', message: `A mixed-effects model (REML) was fit, as chosen. ${what}` }
      : {
          level: 'warning',
          message: `Some values are missing, so a mixed-effects model (REML) was fit instead of repeated-measures ANOVA. ${what}`,
        },
  )
}

type RMDdfName = 'satterthwaite' | 'containment'

/** S5: complete subjects only ('anova' with missing values): how many were left out. */
function droppedSubjectsNote(diagnostics: Diagnostic[], dropped: number) {
  if (dropped > 0)
    diagnostics.push({
      level: 'warning',
      message: `${dropped} subject${dropped > 1 ? 's' : ''} with a missing value ${dropped > 1 ? 'were' : 'was'} left out: repeated-measures ANOVA analyzes complete subjects only.`,
    })
}

// ---------------------------------------------------------------------------------------------
// One-way, matched rows
// ---------------------------------------------------------------------------------------------

interface OneWayRMParams {
  sphericity: Sphericity
  comparisons: 'none' | 'allPairs' | 'vsControl'
  control: string
  allPairsMethod: AllPairs
  controlMethod: VsControl
  confidenceLevel: number
  rmMethod: RMMethod
  ddf: RMDdfName
  differenceAs: DifferenceAs
}

/** Rows (subjects) × columns (treatments), NaN where missing; rows with no values dropped. */
function subjectRows(input: readonly NormalizedDataSet[]): number[][] | null {
  if (input.some((d) => d.data.shape !== 'replicates')) return null
  const cols = input.map((d) => (d.data.shape === 'replicates' ? d.data.reps[0]! : null)!)
  const n = rowCountOf(input)
  const rows: number[][] = []
  for (let r = 0; r < n; r++) {
    const vals = cols.map((c) => c[r] ?? Number.NaN)
    if (vals.some((v) => !Number.isNaN(v))) rows.push(vals)
  }
  return rows
}

function oneWayBlocks(res: OneWayRMResult, titles: string[]): ResultBlock[] {
  const blocks: ResultBlock[] = []
  if (res.kind === 'anova') {
    const main = res.corrected ?? {
      dfn: res.treatment.dfn,
      dfd: res.treatment.dfd,
      p: res.treatment.p,
    }
    blocks.push(
      kv('Repeated measures ANOVA summary', [
        [
          'Assume sphericity (equal variability of differences)?',
          text(res.sphericity === 'assumed' ? 'Yes' : 'No'),
        ],
        ...fTest(res.treatment.F, main.dfn, main.dfd, main.p),
        ...(res.epsilon === null
          ? []
          : ([['Geisser-Greenhouse’s epsilon', num(res.epsilon)]] as [string, ResultValue][])),
        ...(res.rSquared === null
          ? []
          : ([['R squared', num(res.rSquared)]] as [string, ResultValue][])),
      ]),
    )
    if (res.matching) {
      blocks.push(
        kv('Was the matching effective?', [
          ['F', num(res.matching.F)],
          ...pSig(res.matching.p),
          [
            `Is there significant matching (P < ${ALPHA})?`,
            decided(res.matching.effective, res.matching.p),
          ],
        ]),
      )
    }
    if (res.table) {
      // Effect sizes for RM designs: partial η² against the residual (Keppel's R²).
      const row = (name: string) => res.table!.find((x) => x.name === name)!
      const es = effectSizes(row('Treatment'), row('Residual'), row('Total').ss)
      blocks.push(
        kv('Effect size', [
          ['Eta squared', num(es.etaSquared)],
          ['Partial eta squared', num(es.partialEtaSquared)],
          ['Cohen’s f', num(es.cohensF)],
        ]),
      )
      blocks.push(
        table(
          'ANOVA table',
          ['Source of variation', 'SS', 'DF', 'MS', 'F (DFn, DFd)', 'P value'],
          res.table.map((s) => [
            text(s.name),
            num(s.ss),
            int(s.df),
            num(s.ms),
            Number.isFinite(s.F) ? num(s.F) : text(''),
            Number.isFinite(s.p) ? pval(s.p) : text(''),
          ]),
        ),
      )
    }
  } else {
    const m = res.mixed!
    blocks.push(
      kv('Mixed-effects model (REML) — fixed effect (type III)', [
        ...fTest(res.treatment.F, res.treatment.dfn, res.treatment.dfd, res.treatment.p),
        ['Sphericity', text('Assumed (equal correlations); no Geisser-Greenhouse correction')],
        ['Denominator df', text(DDF_NAME[res.ddf])],
      ]),
      kv('Was the matching effective? (likelihood ratio)', [
        ['Chi square', num(m.matching.chi2)],
        ['df', int(m.matching.df)],
        ['P value', pval(m.matching.p)],
        [`Is there significant matching (P < ${ALPHA})?`, significant(m.matching.p)],
      ]),
      kv('Random effects', [
        ['SD of subjects', num(Math.sqrt(m.subjectVariance))],
        ['Variance of subjects', num(m.subjectVariance)],
        ['SD of residual', num(Math.sqrt(m.residualVariance))],
        ['Variance of residual', num(m.residualVariance)],
      ]),
      kv('Data analyzed', [
        ['Number of subjects', int(m.nSubjects)],
        ['Number of values', int(m.nObs)],
        ['Log likelihood (REML)', num(m.logLik)],
      ]),
    )
  }
  blocks.push(
    labelTable('Data summary', titles, [
      [res.kind === 'mixed' ? 'Mean (least squares)' : 'Mean', res.means.map((v) => num(v))],
      ['Number of values', res.n.map(int)],
    ]),
  )
  return blocks
}

export function runOneWayRM(
  input: readonly NormalizedDataSet[],
  params: OneWayRMParams,
  diagnostics: Diagnostic[],
): AnalysisResult {
  const all = subjectRows(input)
  if (!all)
    return failure(
      `Repeated measures ANOVA needs raw values, not summary data.${PAIRED_NEEDS_RAW}`,
      diagnostics,
    )
  // S5: ANOVA of the complete subjects only, when chosen.
  const rows =
    params.rmMethod === 'anova' ? all.filter((r) => r.every((v) => !Number.isNaN(v))) : all
  droppedSubjectsNote(diagnostics, all.length - rows.length)
  if (rows.length < 2) return failure('Need at least two subjects (rows).', diagnostics)
  const titles = input.map((d) => d.title)
  const res = oneWayRM(rows, {
    sphericity: params.sphericity,
    ddf: params.ddf,
    method: params.rmMethod === 'mixed' ? 'mixed' : 'auto',
  })
  if (res.error) return failure(RM_ERRORS[res.error] ?? res.error, diagnostics)
  if (res.kind === 'mixed') mixedNote(diagnostics, params.rmMethod === 'mixed', params.ddf)
  const sheets: AnalysisResult['sheets'] = [
    { key: 'results', title: 'Table of results', blocks: oneWayBlocks(res, titles) },
  ]
  const p = res.corrected?.p ?? res.treatment.p
  // The df of the test (Geisser-Greenhouse corrected when it is), as the sheet's F row shows them.
  const values: AnalysisResult['values'] = {
    p: pval(p),
    F: num(res.treatment.F),
    dfn: num(res.corrected?.dfn ?? res.treatment.dfn),
    dfd: num(res.corrected?.dfd ?? res.treatment.dfd),
    ...testValue(res.kind === 'mixed' ? 'Mixed-effects model' : 'Repeated-measures ANOVA'),
  }

  const { pairs } = oneWayPairs(input, params.comparisons, params.control)
  let comparisons: Comparison[] = []
  if (pairs.length) {
    const method = params.comparisons === 'vsControl' ? params.controlMethod : params.allPairsMethod
    const mc = rmComparisons(rows, res, pairs, { method, confLevel: params.confidenceLevel })
    const labels = pairs.map(([i, j]) => pairLabel(titles[i]!, titles[j]!, params.differenceAs))
    sheets.push({
      key: 'comparisons',
      title: 'Multiple comparisons',
      blocks: [
        comparisonTable(
          METHOD_TITLE[method] ?? method,
          labels,
          signedRows(mc, params.differenceAs),
          params.confidenceLevel,
          method,
        ),
      ],
    })
    comparisons = pairComparisons(
      input,
      pairs,
      mc.map((r) => r.p),
    )
    Object.assign(values, comparisonTestValue(method))
  }
  return result({ sheets, diagnostics, values, comparisons })
}

// ---------------------------------------------------------------------------------------------
// Two-way with repeated measures
// ---------------------------------------------------------------------------------------------

interface TwoWayRMParams {
  repeated: RepeatedFactor
  sphericity: Sphericity
  interaction: boolean
  comparisons: 'withinRows' | 'withinColumns' | 'mainColumns' | 'mainRows' | 'none'
  kind: 'allPairs' | 'vsControl'
  /** One family for all simple-effect comparisons (instead of one per row / column). */
  singleFamily: boolean
  allPairsMethod: AllPairs
  controlMethod: VsControl
  confidenceLevel: number
  rmMethod: RMMethod
  ddf: RMDdfName
  differenceAs: DifferenceAs
}

const VARIANCE_NAMES: Record<string, string> = {
  subject: 'Subject',
  subjectRow: 'Subject × Row factor',
  subjectColumn: 'Subject × Column factor',
  residual: 'Residual',
}

const SOURCE_NAMES: Record<string, string> = {
  interaction: 'Interaction',
  row: 'Row factor',
  column: 'Column factor',
  subjects: 'Subjects (matching)',
  rowSubjects: 'Row factor × Subjects',
  columnSubjects: 'Column factor × Subjects',
  residual: 'Residual',
}

/**
 * Grouped table → long format. Subjects are the replicate subcolumns: with rows repeated, subject
 * j of data set c is the same across rows ("matched values are stacked into a subcolumn"); with
 * columns repeated, subject j of row r is the same across data sets ("spread across a row"); with
 * both, subject j is the same everywhere.
 */
function longFormat(
  input: readonly NormalizedDataSet[],
  rows: readonly number[],
  repeated: RepeatedFactor,
): TwoWayRMData {
  const reps = Math.max(
    ...input.map((d) => (d.data.shape === 'replicates' ? d.data.reps.length : 0)),
  )
  const data: TwoWayRMData = { y: [], row: [], col: [], subject: [] }
  rows.forEach((r, ri) => {
    input.forEach((ds, ci) => {
      if (ds.data.shape !== 'replicates') return
      ds.data.reps.forEach((rep, j) => {
        const v = rep[r]!
        if (Number.isNaN(v)) return
        data.y.push(v)
        data.row.push(ri)
        data.col.push(ci)
        data.subject.push(
          repeated === 'rows' ? ci * reps + j : repeated === 'columns' ? ri * reps + j : j,
        )
      })
    })
  })
  return data
}

export function runTwoWayRM(
  input: readonly NormalizedDataSet[],
  params: TwoWayRMParams,
  diagnostics: Diagnostic[],
): AnalysisResult {
  if (input.some((d) => d.data.shape !== 'replicates'))
    return failure(
      `Repeated measures need raw values, not summary data.${PAIRED_NEEDS_RAW}`,
      diagnostics,
    )
  const rowCount = input[0]?.rowCount ?? 0
  const rows = Array.from({ length: rowCount }, (_, r) => r).filter((r) =>
    input.some(
      (ds) => ds.data.shape === 'replicates' && ds.data.reps.some((rep) => !Number.isNaN(rep[r]!)),
    ),
  )
  if (rows.length < 2)
    return failure('Two-way ANOVA needs at least two rows with data.', diagnostics)
  const long = longFormat(input, rows, params.repeated)
  // S5: ANOVA of the complete subjects only, when chosen.
  const { data, dropped } =
    params.rmMethod === 'anova'
      ? completeSubjects(long, params.repeated, rows.length, input.length)
      : { data: long, dropped: 0 }
  droppedSubjectsNote(diagnostics, dropped)
  const res = twoWayRM(data, params.repeated, {
    sphericity: params.sphericity,
    interaction: params.interaction,
    ddf: params.ddf,
    method: params.rmMethod === 'mixed' ? 'mixed' : 'auto',
  })
  if (res.error) return failure(RM_ERRORS[res.error] ?? res.error, diagnostics)
  const missing = data.y.length < neededValues(data, params.repeated, rows.length, input.length)
  if (res.kind === 'mixed' && params.interaction && (missing || params.rmMethod === 'mixed'))
    mixedNote(diagnostics, !missing, params.ddf)
  else if (res.kind === 'mixed') {
    diagnostics.push({
      level: 'info',
      message: `The main-effects-only model is fit as a mixed-effects model (REML). Denominator df: ${DDF_NAME[params.ddf]}.`,
    })
  }
  const level = params.confidenceLevel
  const main = res.sources.filter((s) => ['interaction', 'row', 'column'].includes(s.key))
  const blocks: ResultBlock[] = [
    table(
      res.kind === 'mixed' ? 'Mixed-effects model (REML): fixed effects (type III)' : 'ANOVA table',
      [
        'Source of variation',
        ...(res.kind === 'anova' ? ['SS', 'DF', 'MS'] : ['DFn, DFd']),
        'F',
        'P value',
        'P value summary',
        'Significant?',
        ...(res.sphericity === 'gg' ? ['Geisser-Greenhouse’s epsilon'] : []),
      ],
      res.sources.map((s) => {
        const p = s.pCorrected ?? s.p
        const tested = Number.isFinite(s.F)
        return [
          text(SOURCE_NAMES[s.key] ?? s.name),
          ...(res.kind === 'anova'
            ? [num(s.ss), num(s.df), Number.isFinite(s.ms) ? num(s.ms) : text('')]
            : [text(tested ? `${fmt(s.df)}, ${fmt(s.dfd ?? Number.NaN)}` : '')]),
          tested ? num(s.F) : text(''),
          tested ? pval(p) : text(''),
          tested ? psum(p) : text(''),
          tested ? significant(p) : text(''),
          ...(res.sphericity === 'gg' ? [s.epsilon === undefined ? text('') : num(s.epsilon)] : []),
        ]
      }),
    ),
    kv('Design', [
      [
        'Matched (repeated) factor',
        text(
          params.repeated === 'rows'
            ? 'Row factor (each subcolumn is one subject across rows)'
            : params.repeated === 'columns'
              ? 'Column factor (each subject spans the columns of a row)'
              : 'Both factors',
        ),
      ],
      [
        'Assume sphericity?',
        text(
          res.kind === 'mixed'
            ? 'Yes (mixed-effects model: the Geisser-Greenhouse correction does not apply)'
            : res.sphericity === 'assumed'
              ? 'Yes'
              : 'No (Geisser-Greenhouse)',
        ),
      ],
      ...(res.kind === 'mixed'
        ? ([['Denominator df', text(DDF_NAME[res.ddf])]] as [string, ResultValue][])
        : []),
    ]),
  ]
  if (res.kind === 'anova') {
    // Effect sizes for RM designs: partial η² against each effect's own error term.
    const ssTotal = totalSS(data.y)
    const by = (k: string) => res.sources.find((x) => x.key === k)
    const errorOf: Record<string, string> =
      params.repeated === 'both'
        ? { row: 'rowSubjects', column: 'columnSubjects', interaction: 'residual' }
        : params.repeated === 'columns'
          ? { row: 'subjects', column: 'residual', interaction: 'residual' }
          : { row: 'residual', column: 'subjects', interaction: 'residual' }
    blocks.push(
      table(
        'Effect sizes',
        ['Source of variation', 'Eta squared', 'Partial eta squared', 'Cohen’s f'],
        main.map((s) => {
          const err = by(errorOf[s.key]!)!
          const e = effectSizes(s, err, ssTotal)
          return [
            text(SOURCE_NAMES[s.key] ?? s.name),
            num(e.etaSquared),
            num(e.partialEtaSquared),
            num(e.cohensF),
          ]
        }),
      ),
    )
  }
  if (res.mixed) {
    blocks.push(
      kv(
        'Random effects (variances)',
        Object.entries(res.mixed.variances).map(
          ([k, v]) => [VARIANCE_NAMES[k] ?? k, num(v)] as [string, ResultValue],
        ),
      ),
    )
  }
  const sheets: AnalysisResult['sheets'] = [resultsSheet(blocks)]
  const values: AnalysisResult['values'] = {}
  for (const s of main) values[`p.${s.key}`] = pval(s.pCorrected ?? s.p)
  Object.assign(
    values,
    testValue(res.kind === 'mixed' ? 'Mixed-effects model' : 'Two-way repeated-measures ANOVA'),
  )

  if (params.comparisons === 'none') return result({ sheets, diagnostics, values })
  // S10: main-effect means of a repeated factor without sphericity: each comparison with its
  // own error term (per-contrast), so no refusal and no prompt to assume sphericity.
  const perContrast =
    res.kind === 'anova' &&
    params.sphericity === 'gg' &&
    ((params.comparisons === 'mainRows' && params.repeated !== 'columns') ||
      (params.comparisons === 'mainColumns' && params.repeated !== 'rows'))
  const method = params.kind === 'vsControl' ? params.controlMethod : params.allPairsMethod
  const mc = twoWayRMComparisons(data, res, {
    family: params.comparisons,
    kind: params.kind,
    method,
    confLevel: level,
    singleFamily: params.singleFamily,
    perContrast,
  })
  if (perContrast)
    diagnostics.push({
      level: 'info',
      message:
        'Sphericity isn’t assumed, so each comparison of the repeated factor’s means uses its own error term (the differences between those two levels in each subject).',
    })
  const labels: string[] = []
  const comparisons: Comparison[] = []
  for (const r of mc) {
    const x = twoWayComparison(input, rows, params.comparisons, r, r.p, params.differenceAs)
    labels.push(x.label)
    if (x.comparison) comparisons.push(x.comparison)
  }
  sheets.push({
    key: 'comparisons',
    title: 'Multiple comparisons',
    blocks: [
      comparisonTable(
        (METHOD_TITLE[method] ?? method) + TWO_WAY_FAMILY_SUFFIX[params.comparisons],
        labels,
        signedRows(mc, params.differenceAs),
        level,
        method,
      ),
    ],
  })
  diagnostics.push(...interactionNote(params.comparisons, values['p.interaction']))
  Object.assign(values, comparisonTestValue(method))
  return result({ sheets, diagnostics, values, comparisons })
}

/** Values a complete design has: each subject in every cell of its repeated factors. */
function neededValues(data: TwoWayRMData, repeated: RepeatedFactor, R: number, C: number): number {
  const subjects = new Set(data.subject).size
  return subjects * (repeated === 'both' ? R * C : repeated === 'columns' ? C : R)
}

/** S5: the subjects with a value in every cell of their repeated factors, and how many weren't. */
function completeSubjects(
  data: TwoWayRMData,
  repeated: RepeatedFactor,
  R: number,
  C: number,
): { data: TwoWayRMData; dropped: number } {
  const need = repeated === 'both' ? R * C : repeated === 'columns' ? C : R
  const count = new Map<number, number>()
  for (const s of data.subject) count.set(s, (count.get(s) ?? 0) + 1)
  const keep = new Set([...count].filter(([, k]) => k === need).map(([s]) => s))
  const out: TwoWayRMData = { y: [], row: [], col: [], subject: [] }
  data.subject.forEach((s, i) => {
    if (!keep.has(s)) return
    out.y.push(data.y[i]!)
    out.row.push(data.row[i]!)
    out.col.push(data.col[i]!)
    out.subject.push(s)
  })
  return { data: out, dropped: count.size - keep.size }
}
