import type { AnalysisDef, NormalizedDataSet, ResultValue } from '@ps/model'
import { areaUnderCurve, cumulative, frequencyDistribution } from '@ps/stats'
import { z } from 'zod'
import {
  CONFIDENCE_FIELD,
  confidenceLevel,
  exclusionNotes,
  failure,
  int,
  interval,
  kv,
  labelTable,
  num,
  pct,
  result,
  rowMeans,
  table,
  text,
} from './common.ts'
import { buildTable, stableId } from './resultTable.ts'

// ---------------------------------------------------------------------------------------------
// Frequency distribution (Statistics Guide, "How to: Frequency distribution"). The result is an
// XY table: X = bin centre, one data set per analyzed data set (same id), counts, relative
// frequencies (fraction or %) or their cumulative sums. Every data set uses the same bins.
// Relative frequencies are of the values tabulated (values outside the bins don't count).
// ---------------------------------------------------------------------------------------------

const FreqParams = z.object({
  tabulate: z.enum(['counts', 'relativePercent', 'relativeFraction']).default('counts'),
  cumulative: z.boolean().default(false),
  autoBinWidth: z.boolean().default(true),
  binWidth: z.number().positive().default(1),
  autoFirstCenter: z.boolean().default(true),
  firstCenter: z.number().default(0),
  useUpperLimit: z.boolean().default(false),
  upperLimit: z.number().default(100),
  /** Replicates: each value in its bin, or only the mean of each row. */
  replicates: z.enum(['each', 'mean']).default('each'),
})
type FreqParams = z.infer<typeof FreqParams>

function valuesOf(ds: NormalizedDataSet, mode: FreqParams['replicates']): number[] {
  if (ds.data.shape === 'summary' || mode === 'mean')
    return Array.from(rowMeans(ds)).filter(Number.isFinite)
  const out: number[] = []
  for (let r = 0; r < ds.rowCount; r++)
    for (const c of ds.data.reps) if (Number.isFinite(c[r]!)) out.push(c[r]!)
  return out
}

export const frequencyDef: AnalysisDef<FreqParams> = {
  id: 'frequencyDistribution',
  version: 1,
  title: 'Frequency distribution',
  category: 'Column analyses',
  description:
    'Count the values in bins (automatic or chosen width and centre): counts, relative frequencies or cumulative; the result is an XY table of bin centres, ready for a histogram.',
  accepts: ['column', 'grouped', 'xy', 'nested'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: FreqParams,
  producesTable: true,
  form: [
    {
      path: ['tabulate'],
      label: 'Tabulate',
      kind: 'radio',
      options: [
        { value: 'counts', label: 'Number of data points' },
        { value: 'relativePercent', label: 'Relative frequencies as percentages' },
        { value: 'relativeFraction', label: 'Relative frequencies as fractions' },
      ],
    },
    { path: ['cumulative'], label: 'Cumulative', kind: 'checkbox' },
    { path: ['autoBinWidth'], label: 'Automatic bin width', kind: 'checkbox' },
    {
      path: ['binWidth'],
      label: 'Bin width',
      kind: 'number',
      showIf: { path: ['autoBinWidth'], in: [false] },
    },
    { path: ['autoFirstCenter'], label: 'Automatic centre of the first bin', kind: 'checkbox' },
    {
      path: ['firstCenter'],
      label: 'Centre of the first bin',
      kind: 'number',
      showIf: { path: ['autoFirstCenter'], in: [false] },
    },
    { path: ['useUpperLimit'], label: 'Omit values above an upper limit', kind: 'checkbox' },
    {
      path: ['upperLimit'],
      label: 'Upper limit',
      kind: 'number',
      showIf: { path: ['useUpperLimit'], in: [true] },
    },
    {
      path: ['replicates'],
      label: 'Replicates',
      kind: 'radio',
      options: [
        { value: 'each', label: 'Place each replicate into its bin' },
        { value: 'mean', label: 'Average the replicates in each row; bin only the means' },
      ],
    },
  ],
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    const vals = input.map((d) => valuesOf(d, params.replicates))
    const fd = frequencyDistribution(vals, {
      ...(params.autoBinWidth ? {} : { binWidth: params.binWidth }),
      ...(params.autoFirstCenter ? {} : { firstCenter: params.firstCenter }),
      ...(params.useUpperLimit ? { upperLimit: params.upperLimit } : {}),
    })
    if (fd.error === 'no-values') return failure('There are no values.', diagnostics)
    if (fd.error === 'too-many-bins')
      return failure(
        `A bin width of ${fd.binWidth} makes more than 10 000 bins. Choose a wider bin.`,
        diagnostics,
      )
    if (fd.error) return failure('Choose a bin width greater than zero.', diagnostics)
    const scale = params.tabulate === 'relativePercent' ? 100 : 1
    const series = fd.counts.map((c, d) => {
      const base = params.cumulative ? cumulative(c) : c
      if (params.tabulate === 'counts') return base
      const tot = fd.tabulated[d]!
      return base.map((v) => (tot > 0 ? (scale * v) / tot : Number.NaN))
    })
    const omitted = input.map((_, d) => fd.below[d]! + fd.above[d]!)
    const nOmitted = omitted.reduce((a, b) => a + b, 0)
    if (nOmitted > 0)
      diagnostics.push({
        level: 'info',
        message: `${nOmitted} value${nOmitted > 1 ? 's' : ''} outside the bins ${nOmitted > 1 ? 'were' : 'was'} not tabulated.`,
      })
    const what = `${params.cumulative ? 'Cumulative ' : ''}${
      params.tabulate === 'counts'
        ? params.cumulative
          ? 'number of values'
          : 'Number of values'
        : params.tabulate === 'relativePercent'
          ? params.cumulative
            ? 'percentage'
            : 'Percentage'
          : params.cumulative
            ? 'fraction'
            : 'Fraction'
    }`
    const cell = (v: number): ResultValue =>
      params.tabulate === 'counts' ? int(v) : Number.isFinite(v) ? num(v) : text('')
    return result({
      sheets: [
        {
          key: 'bins',
          title: 'Frequency distribution',
          blocks: [
            table(
              what,
              ['Bin center', ...input.map((d) => d.title)],
              fd.centers.map((c, i) => [num(c), ...series.map((s) => cell(s[i]!))]),
            ),
          ],
        },
        {
          key: 'summary',
          title: 'Summary',
          blocks: [
            kv('Bins', [
              ['Bin width', num(fd.binWidth)],
              ['Center of first bin', num(fd.firstCenter)],
              ['Number of bins', int(fd.centers.length)],
            ]),
            labelTable(
              'Values',
              input.map((d) => d.title),
              [
                ['Values tabulated', fd.tabulated.map(int)],
                ['Values not tabulated', omitted.map(int)],
              ],
            ),
          ],
        },
      ],
      diagnostics,
      values: { binWidth: num(fd.binWidth), bins: int(fd.centers.length) },
      table: buildTable(input, {
        name: 'Frequency distribution',
        tableKind: 'xy',
        rowCount: fd.centers.length,
        rowTitles: null,
        x: { title: 'Bin center', values: fd.centers },
        dataSets: input.map((d, i) => ({
          id: stableId(d.ref.key),
          title: d.title,
          subcolumns: [series[i]!],
        })),
      }),
    })
  },
}

// ---------------------------------------------------------------------------------------------
// Area under the curve (XY), per data set: the trapezoid rule on the row means, baseline, peaks
// (regions) that meet the height and width criteria, SE and CI of the total area (Gagnon &
// Peterson; see stats/processing/auc.ts). Results only (no table).
// ---------------------------------------------------------------------------------------------

const AucParams = z.object({
  baseline: z.number().default(0),
  /** Ignore peaks lower than this percentage of the distance from minimum to maximum Y. */
  minPeakHeight: z.number().min(0).max(100).default(10),
  /** Ignore peaks defined by fewer than this many adjacent points. */
  minPeakPoints: z.number().int().min(1).default(1),
  direction: z.enum(['above', 'both']).default('above'),
  confidenceLevel,
})
type AucParams = z.infer<typeof AucParams>

/** X, mean Y and squared SEM of each row with an X and a Y. */
export function aucPoints(ds: NormalizedDataSet): { x: number[]; y: number[]; semSq: number[] } {
  const x: number[] = []
  const y: number[] = []
  const semSq: number[] = []
  if (!ds.x) return { x, y, semSq }
  for (let r = 0; r < ds.rowCount; r++) {
    const xv = ds.x[r]!
    if (!Number.isFinite(xv)) continue
    if (ds.data.shape === 'summary') {
      const m = ds.data.mean[r]!
      if (!Number.isFinite(m)) continue
      x.push(xv)
      y.push(m)
      const se = ds.data.sem[r]!
      semSq.push(Number.isFinite(se) ? se * se : Number.NaN)
    } else {
      const v = ds.data.reps.map((c) => c[r]!).filter(Number.isFinite)
      if (!v.length) continue
      const m = v.reduce((a, b) => a + b, 0) / v.length
      const ss = v.reduce((a, b) => a + (b - m) ** 2, 0)
      x.push(xv)
      y.push(m)
      semSq.push(v.length > 1 ? ss / (v.length - 1) / v.length : Number.NaN)
    }
  }
  return { x, y, semSq }
}

export const aucDef: AnalysisDef<AucParams> = {
  id: 'areaUnderCurve',
  version: 1,
  title: 'Area under curve',
  category: 'XY analyses',
  description:
    'Area under each curve by the trapezoid rule, above a baseline; lists the peaks and, with replicates or SD/SEM, the SE and confidence interval of the area.',
  accepts: ['xy'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: AucParams,
  form: [
    { path: ['baseline'], label: 'Baseline: Y =', kind: 'number' },
    {
      path: ['minPeakHeight'],
      label: 'Ignore peaks less than this % of the distance from minimum to maximum Y',
      kind: 'number',
      min: 0,
      max: 100,
    },
    {
      path: ['minPeakPoints'],
      label: 'Ignore peaks defined by fewer than this many adjacent points',
      kind: 'number',
      min: 1,
      step: 1,
    },
    {
      path: ['direction'],
      label: 'Peak direction',
      kind: 'radio',
      options: [
        { value: 'above', label: 'Only peaks above the baseline' },
        { value: 'both', label: 'Peaks above and below the baseline' },
      ],
    },
    CONFIDENCE_FIELD,
  ],
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    const level = params.confidenceLevel
    const results = input.map((ds) => {
      const p = aucPoints(ds)
      return areaUnderCurve(p.x, p.y, p.semSq, {
        baseline: params.baseline,
        minHeight: params.minPeakHeight / 100,
        minPoints: params.minPeakPoints,
        direction: params.direction,
        confLevel: level,
      })
    })
    const bad = results.findIndex((r) => r.error)
    if (bad >= 0)
      return failure(
        `“${input[bad]!.title}” needs at least two points with X and Y values.`,
        diagnostics,
      )
    const both = params.direction === 'both'
    const col = (f: (r: (typeof results)[number]) => ResultValue) => results.map(f)
    const maybe = (v: number) => (Number.isFinite(v) ? num(v) : text(''))
    const rows: ResultValue[][] = [
      [text('Baseline'), ...col(() => num(params.baseline))],
      [text('Total Area'), ...col((r) => num(r.totalArea))],
      [text('Std. Error'), ...col((r) => maybe(r.se))],
      [
        text(`${pct(level)} Confidence Interval`),
        ...col((r) => (Number.isFinite(r.se) ? interval(r.lo, r.hi, level) : text(''))),
      ],
      [text('Total Peak Area'), ...col((r) => num(r.totalPeakArea))],
      ...(both ? [[text('Net Area'), ...col((r) => num(r.netArea))]] : []),
      [text('Number of Peaks'), ...col((r) => int(r.nPeaks))],
      [text('Minimum Y'), ...col((r) => num(r.minY))],
      [text('Maximum Y'), ...col((r) => num(r.maxY))],
    ]
    const peakBlocks = results.map((r, d) =>
      table(
        `Peaks of ${input[d]!.title}`,
        [
          'Peak',
          ...(both ? ['Direction'] : []),
          'First X',
          'Last X',
          'Peak X',
          'Peak Y',
          'Area',
          'Percentage of area',
        ],
        r.regions
          .filter((g) => g.counted)
          .map((g, i) => [
            int(i + 1),
            ...(both ? [text(g.sign > 0 ? 'Above' : 'Below')] : []),
            num(g.startX),
            num(g.endX),
            num(g.peakX),
            num(g.peakY),
            num(g.area),
            num(100 * g.fraction),
          ]),
      ),
    )
    if (results.some((r) => !Number.isFinite(r.se)))
      diagnostics.push({
        level: 'info',
        message:
          'The SE and confidence interval need replicates (or SD/SEM with N) at every X; they are left blank otherwise.',
      })
    const values: Record<string, ResultValue> = {}
    input.forEach((ds, d) => {
      values[`auc:${ds.ref.key}`] = num(results[d]!.totalArea)
    })
    return result({
      sheets: [
        {
          key: 'results',
          title: 'Area under curve',
          blocks: [table('Area under curve', ['', ...input.map((d) => d.title)], rows)],
        },
        { key: 'peaks', title: 'Peaks', blocks: peakBlocks },
      ],
      diagnostics,
      values,
    })
  },
}
