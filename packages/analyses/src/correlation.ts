import { type AnalysisDef, type NormalizedDataSet, pairedRows, type ResultValue } from '@ps/model'
import { type CorrelationResult, pearsonCorrelation, spearmanCorrelation } from '@ps/stats'
import { z } from 'zod'
import {
  ALPHA,
  alternativeFor,
  CONFIDENCE_FIELD,
  confidenceLevel,
  exclusionNotes,
  failure,
  firstCol,
  int,
  interval,
  missingXNote,
  num,
  pct,
  psum,
  pval,
  result,
  significant,
  TAILS_FIELD,
  table,
  tails,
  text,
  xyPoints,
} from './common.ts'

const Params = z.object({
  method: z.enum(['pearson', 'spearman']).default('pearson'),
  tails,
  confidenceLevel,
})
type Params = z.infer<typeof Params>

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
  version: 1,
  title: 'Correlation',
  category: 'Column analyses',
  description:
    'Pearson or Spearman correlation between every pair of columns (values matched by row), or between X and each data set of an XY table.',
  accepts: ['column', 'xy'],
  inputs: { min: 1, max: 64 },
  params: Params,
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
    TAILS_FIELD,
    CONFIDENCE_FIELD,
  ],
  run(input, params) {
    const isXY = input.every((d) => d.x !== null)
    const diagnostics = [...exclusionNotes(input), ...(isXY ? missingXNote(input) : [])]
    if (!isXY && input.length < 2)
      return failure('Choose at least two columns to correlate.', diagnostics)
    const level = params.confidenceLevel
    const f = params.method === 'pearson' ? pearsonCorrelation : spearmanCorrelation
    const pairs = pairsOf(input, isXY)
    const results: (CorrelationResult | null)[] = pairs.map(({ x, y }) => {
      if (x.length < 3) return null
      const two = f(x, y, { confLevel: level })
      // Two-tailed: that is the result (computing it again doubled the time on large tables).
      if (params.tails === 'two') return two
      return f(x, y, { confLevel: level, alternative: alternativeFor(params.tails, two.r) })
    })
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
        // Prism shows no Spearman CI for n ≤ 10 (the Fisher z approximation is poor there).
        cell(r, (c) =>
          'ciValid' in c && c.ciValid === false ? text('—') : interval(c.lower, c.upper, level),
        ),
        cell(r, (c) => num(c.r2)),
        cell(r, (c) => pval(c.p)),
        cell(r, (c) => psum(c.p)),
        cell(r, (c) => significant(c.p)),
        int(p.x.length),
      ]
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
            'P value summary',
            `Significant (alpha = ${ALPHA})?`,
            'Number of XY pairs',
          ],
          rows,
        ),
      ],
      values:
        results.length === 1 && results[0] ? { r: num(results[0].r), p: pval(results[0].p) } : {},
    })
  },
}
