import type { AnalysisDef, ResultValue } from '@ps/model'
import { describe, tCritical } from '@ps/stats'
import { z } from 'zod'
import {
  CONFIDENCE_FIELD,
  confidenceLevel,
  exclusionNotes,
  int,
  num,
  pct,
  rawValues,
  result,
  summaryOf,
  text,
} from './common.ts'

const Params = z.object({
  quartiles: z.boolean().default(true),
  ci: z.boolean().default(true),
  cv: z.boolean().default(true),
  geometric: z.boolean().default(false),
  moments: z.boolean().default(false),
  sum: z.boolean().default(false),
  confidenceLevel,
})
type Params = z.infer<typeof Params>

type Row = [label: string, value: (d: ReturnType<typeof describe>) => ResultValue]

export const descriptive: AnalysisDef<Params> = {
  id: 'descriptive',
  version: 1,
  title: 'Descriptive statistics',
  category: 'Column analyses',
  description:
    'Summarize each data set: sample size, range, quartiles, mean, SD, SEM, and confidence intervals.',
  accepts: ['column'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: Params,
  form: [
    { path: ['quartiles'], label: 'Minimum, quartiles, maximum, range', kind: 'checkbox' },
    { path: ['ci'], label: 'Confidence interval of the mean', kind: 'checkbox' },
    { path: ['cv'], label: 'Coefficient of variation', kind: 'checkbox' },
    {
      path: ['geometric'],
      label: 'Geometric mean, geometric SD factor, and their CI',
      kind: 'checkbox',
    },
    { path: ['moments'], label: 'Skewness and kurtosis', kind: 'checkbox' },
    { path: ['sum'], label: 'Sum', kind: 'checkbox' },
    CONFIDENCE_FIELD,
  ],
  run(input, params) {
    const level = pct(params.confidenceLevel)
    const rows: Row[] = [['Number of values', (d) => int(d.n)]]
    if (params.quartiles) {
      rows.push(
        ['Minimum', (d) => num(d.min)],
        ['25% Percentile', (d) => num(d.q1)],
        ['Median', (d) => num(d.median)],
        ['75% Percentile', (d) => num(d.q3)],
        ['Maximum', (d) => num(d.max)],
        ['Range', (d) => num(d.range)],
      )
    }
    rows.push(
      ['Mean', (d) => num(d.mean)],
      ['Std. Deviation', (d) => num(d.sd)],
      ['Std. Error of Mean', (d) => num(d.sem)],
    )
    if (params.ci) {
      rows.push(
        [`Lower ${level} CI of mean`, (d) => num(d.ciLo)],
        [`Upper ${level} CI of mean`, (d) => num(d.ciHi)],
      )
    }
    if (params.cv)
      rows.push([
        'Coefficient of variation',
        (d) => text(Number.isFinite(d.cv) ? `${(d.cv * 100).toFixed(2)}%` : '—'),
      ])
    if (params.geometric) {
      rows.push(
        ['Geometric mean', (d) => num(d.geoMean)],
        ['Geometric SD factor', (d) => num(d.geoSdFactor)],
        [`Lower ${level} CI of geo. mean`, (d) => num(d.geoCiLo)],
        [`Upper ${level} CI of geo. mean`, (d) => num(d.geoCiHi)],
      )
    }
    if (params.moments)
      rows.push(['Skewness', (d) => num(d.skewness)], ['Kurtosis', (d) => num(d.kurtosis)])
    if (params.sum) rows.push(['Sum', (d) => num(d.sum)])

    const columns: ResultValue[][] = []
    const notes = exclusionNotes(input)
    const described = input.map((ds) => {
      const raw = rawValues(ds)
      if (raw) return describe(raw, params.confidenceLevel)
      // Summary data: mean, SD, the entered SEM and N, and what follows from them.
      const s = summaryOf(ds)!
      const d = describe([], params.confidenceLevel)
      const sem = ds.data.shape === 'summary' ? (ds.data.sem[0] ?? Number.NaN) : Number.NaN
      const h = s.n >= 2 ? tCritical(params.confidenceLevel, s.n - 1) * sem : Number.NaN
      return {
        ...d,
        n: s.n,
        mean: s.mean,
        sd: s.sd,
        sem,
        ciLo: s.mean - h,
        ciHi: s.mean + h,
        cv: s.sd / s.mean,
      }
    })
    if (input.some((ds) => ds.data.shape === 'summary')) {
      notes.push({
        level: 'info',
        message:
          'Data were entered as summaries; only mean, SD, SEM, N, the CV and the CI of the mean are available.',
      })
    }
    for (const [label, f] of rows) columns.push([text(label), ...described.map(f)])

    return result({
      diagnostics: notes,
      sheets: [
        {
          key: 'descriptive',
          title: 'Descriptive statistics',
          blocks: [{ type: 'table', columns: ['', ...input.map((d) => d.title)], rows: columns }],
        },
      ],
      values: Object.fromEntries(
        input.flatMap((ds, i) => [
          [`mean:${ds.ref.key}`, num(described[i]!.mean)],
          [`sd:${ds.ref.key}`, num(described[i]!.sd)],
        ]),
      ),
    })
  },
}
