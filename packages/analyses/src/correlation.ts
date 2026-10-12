import {
  type AnalysisDef,
  type NormalizedDataSet,
  pairedRows,
  pinDefaults,
  type ResultBlock,
  type ResultValue,
} from '@ps/model'
import { adjustP, type CorrelationResult, pearsonCorrelation, spearmanCorrelation } from '@ps/stats'
import { z } from 'zod'
import {
  ALPHA,
  alternativeFor,
  CONFIDENCE_FIELD,
  confidenceLevel,
  decided,
  directionProblem,
  exclusionNotes,
  failure,
  firstCol,
  int,
  interval,
  missingXNote,
  num,
  oneTailedNotes,
  pct,
  pinObservedDirection,
  predicted,
  predictedField,
  psum,
  pval,
  result,
  significant,
  TAILS_FIELD,
  table,
  tails,
  testValue,
  text,
  xyPoints,
} from './common.ts'

const Params = z.object({
  method: z.enum(['pearson', 'spearman']).default('pearson'),
  tails,
  predicted,
  /**
   * Roadmap 51c (S30): P values corrected across the pairs when more than one pair is tested —
   * the false discovery rate (Benjamini-Hochberg, the default), Holm, or none.
   */
  correction: z.enum(['fdr', 'holm', 'none']).default('fdr'),
  confidenceLevel,
})
type Params = z.infer<typeof Params>

/** Version 1 (before 0.3.9): no correction across pairs; one-tailed in the observed direction. */
const migrate = (raw: unknown, from: number): unknown =>
  from >= 2 ? raw : pinObservedDirection(pinDefaults(raw, [[['correction'], 'none']]))

const CORRECTION_NAME = { fdr: 'q value (Benjamini-Hochberg)', holm: 'Holm-adjusted P value' }

interface Pair {
  label: string
  x: Float64Array
  y: Float64Array
}

/** Column tables: every pair of columns, matched by row. XY tables: X against each data set. */
function pairsOf(input: readonly NormalizedDataSet[], isXY: boolean): Pair[] {
  if (isXY) return input.map((ds) => ({ label: `X vs. ${ds.title}`, ...xyPoints(ds) }))
  const out: Pair[] = []
  for (let i = 0; i < input.length; i++) {
    for (let j = i + 1; j < input.length; j++) {
      const p = pairedRows(firstCol(input[i]!), firstCol(input[j]!))
      out.push({ label: `${input[i]!.title} vs. ${input[j]!.title}`, x: p.a, y: p.b })
    }
  }
  return out
}

export const correlationDef: AnalysisDef<Params> = {
  id: 'correlation',
  version: 2,
  title: 'Correlation',
  category: 'Column analyses',
  description:
    'Pearson or Spearman correlation between every pair of columns (values matched by row), or between X and each data set of an XY table.',
  accepts: ['column', 'xy'],
  inputs: { min: 1, max: 64 },
  params: Params,
  migrateParams: migrate,
  form: [
    {
      path: ['method'],
      label: 'Correlation coefficient',
      kind: 'radio',
      options: [
        { value: 'pearson', label: 'Pearson (assume Gaussian distributions)' },
        { value: 'spearman', label: 'Spearman (nonparametric)' },
      ],
    },
    {
      path: ['correction'],
      label: 'With several pairs, correct the P values for their number',
      kind: 'radio',
      options: [
        { value: 'fdr', label: 'False discovery rate, Benjamini-Hochberg (recommended)' },
        { value: 'holm', label: 'Chance of any false positive (Holm)' },
        { value: 'none', label: 'No correction' },
      ],
    },
    TAILS_FIELD,
    predictedField('A positive correlation (rising together)', 'A negative correlation'),
    CONFIDENCE_FIELD,
  ],
  run(input, params) {
    const isXY = input.every((d) => d.x !== null)
    const diagnostics = [...exclusionNotes(input), ...(isXY ? missingXNote(input) : [])]
    if (!isXY && input.length < 2)
      return failure('Choose at least two columns to correlate.', diagnostics)
    const unset = directionProblem(params, diagnostics)
    if (unset) return unset
    const level = params.confidenceLevel
    const f = params.method === 'pearson' ? pearsonCorrelation : spearmanCorrelation
    const pairs = pairsOf(input, isXY)
    const results: (CorrelationResult | null)[] = pairs.map(({ x, y }) => {
      if (x.length < 3) return null
      const two = f(x, y, { confLevel: level })
      // Two-tailed: that is the result (computing it again doubled the time on large tables).
      if (params.tails === 'two') return two
      const one = f(x, y, {
        confLevel: level,
        alternative: alternativeFor(params.tails, params.predicted, two.r),
      })
      return one
    })
    // S1: a warning per pair whose r went against the prediction (once when not stated).
    const words = ['a positive correlation', 'a negative correlation'] as const
    results.forEach((r, k) => {
      if (!r || (params.predicted === 'observed' && k > 0)) return
      diagnostics.push(...oneTailedNotes(params, r.r, r.p, words, `r of ${pairs[k]!.label}`))
    })
    // S30: P values corrected across the pairs (none to correct with one pair).
    const tested = results.filter((r) => r && !Number.isNaN(r.p)).length
    const corrected = params.correction !== 'none' && tested > 1 ? params.correction : null
    const adjusted = corrected
      ? adjustP(
          results.map((r) => r?.p ?? Number.NaN),
          corrected === 'fdr' ? 'bh' : 'holm',
        )
      : null
    const small = pairs.filter((_, k) => !results[k]).map((p) => p.label)
    if (small.length) {
      diagnostics.push({
        level: 'warning',
        message: `Correlation needs at least three pairs of values: ${small.join(', ')}.`,
      })
    }
    const flat = pairs
      .filter((_, k) => results[k] && Number.isNaN(results[k].r))
      .map((p) => p.label)
    if (flat.length) {
      diagnostics.push({
        level: 'warning',
        message: `r can’t be computed when a variable has the same value in every pair: ${flat.join(', ')}.`,
      })
    }
    const rName = params.method === 'pearson' ? 'Pearson r' : 'Spearman r'
    const cell = (r: CorrelationResult | null, v: (r: CorrelationResult) => ResultValue) =>
      r ? v(r) : text('—')
    const rows = pairs.map((p, k) => {
      const r = results[k]!
      return [
        text(p.label),
        cell(r, (c) => num(c.r)),
        // No Spearman CI for n ≤ 10 (the Fisher z approximation is poor there).
        cell(r, (c) =>
          'ciValid' in c && c.ciValid === false ? text('—') : interval(c.lower, c.upper, level),
        ),
        cell(r, (c) => num(c.r2)),
        cell(r, (c) => pval(c.p)),
        ...(adjusted ? [cell(r, () => pval(adjusted[k]!))] : []),
        cell(r, (c) => psum(adjusted ? adjusted[k]! : c.p)),
        cell(r, (c) => (adjusted ? decided(adjusted[k]! < ALPHA, adjusted[k]!) : significant(c.p))),
        int(p.x.length),
      ]
    })
    const notes: ResultBlock[] = [
      {
        type: 'note',
        text: 'r describes how closely the values rise or fall together (association), not whether two methods agree; Bland-Altman checks agreement.',
      },
    ]
    if (corrected)
      notes.unshift({
        type: 'note',
        text:
          corrected === 'fdr'
            ? `The ${tested} pairs are one family: q values (Benjamini-Hochberg) control the false discovery rate; of the pairs called significant (q < ${ALPHA}), about ${ALPHA * 100}% are expected to be false.`
            : `The ${tested} pairs are one family: Holm-adjusted P values keep the chance of any false positive among them at ${ALPHA * 100}%.`,
      })
    return result({
      diagnostics,
      blocks: [
        table(
          params.method === 'pearson' ? 'Pearson correlation' : 'Spearman correlation',
          [
            '',
            rName,
            `${pct(level)} CI`,
            'R squared',
            `P value (${params.tails === 'two' ? 'two-tailed' : 'one-tailed'})`,
            ...(corrected ? [CORRECTION_NAME[corrected]] : []),
            'P value summary',
            `Significant (alpha = ${ALPHA})?`,
            'Number of XY pairs',
          ],
          rows,
        ),
        ...notes,
      ],
      values: {
        ...(results.length === 1 && results[0]
          ? { r: num(results[0].r), p: pval(results[0].p) }
          : {}),
        ...testValue(params.method === 'pearson' ? 'Pearson correlation' : 'Spearman correlation'),
      },
    })
  },
}
