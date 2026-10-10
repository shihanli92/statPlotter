import type { AnalysisDef, ResultBlock, ResultValue } from '@ps/model'
import { grubbs, rout } from '@ps/stats'
import { z } from 'zod'
import {
  exclusionNotes,
  failure,
  int,
  num,
  pval,
  result,
  rowCountOf,
  table,
  text,
  yesNo,
} from './common.ts'
import { buildTable, sourceKind, stableId } from './resultTable.ts'

// ---------------------------------------------------------------------------------------------
// Identify outliers (Statistics Guide, "How to: Identify outliers"): ROUT (Q, default 1%),
// Grubbs' test ("can only identify one outlier in each data set") or iterative Grubbs', each
// data set (column) on its own. Results: a summary per data set, the outliers, and the test
// details; the plugin also produces the cleaned data (outliers removed: their cells left empty,
// so rows stay aligned) as a table with the source's data set ids.
// ---------------------------------------------------------------------------------------------

const OutlierParams = z.object({
  method: z.enum(['rout', 'grubbs', 'grubbsIterative']).default('rout'),
  /** ROUT's Q, the maximum false discovery rate, in percent. */
  q: z.number().gt(0).lt(100).default(1),
  alpha: z.number().gt(0).lt(1).default(0.05),
})
type OutlierParams = z.infer<typeof OutlierParams>

export const outliersDef: AnalysisDef<OutlierParams> = {
  id: 'identifyOutliers',
  version: 1,
  title: 'Identify outliers',
  category: 'Column analyses',
  description:
    'Find outliers in each data set with the ROUT method or Grubbs’ test; lists them and makes a table of the data with the outliers removed.',
  accepts: ['column'],
  inputs: { min: 1, max: Number.POSITIVE_INFINITY },
  params: OutlierParams,
  producesTable: true,
  form: [
    {
      path: ['method'],
      label: 'Method',
      kind: 'radio',
      options: [
        { value: 'rout', label: 'ROUT method (recommended; finds one or more outliers)' },
        { value: 'grubbs', label: 'Grubbs’ method (finds one outlier at most)' },
        { value: 'grubbsIterative', label: 'Iterative Grubbs’' },
      ],
    },
    {
      path: ['q'],
      label: 'Q (maximum desired false discovery rate), %',
      kind: 'select',
      options: [
        { value: 0.1, label: '0.1%' },
        { value: 0.5, label: '0.5%' },
        { value: 1, label: '1% (recommended)' },
        { value: 5, label: '5%' },
        { value: 10, label: '10%' },
      ],
      showIf: { path: ['method'], in: ['rout'] },
    },
    {
      path: ['alpha'],
      label: 'Alpha',
      kind: 'select',
      options: [
        { value: 0.0001, label: '0.0001' },
        { value: 0.001, label: '0.001' },
        { value: 0.01, label: '0.01' },
        { value: 0.05, label: '0.05' },
        { value: 0.1, label: '0.1' },
      ],
      showIf: { path: ['method'], in: ['grubbs', 'grubbsIterative'] },
    },
  ],
  run(input, params, context) {
    const diagnostics = exclusionNotes(input)
    if (input.some((d) => d.data.shape !== 'replicates'))
      return failure('Identifying outliers needs raw values, not summary data.', diagnostics)
    const cols = input.map((d) => (d.data as { reps: Float64Array[] }).reps[0]!)
    const isRout = params.method === 'rout'
    const summaryRows: ResultValue[][] = []
    const outlierRows: ResultValue[][] = []
    const detailRows: ResultValue[][] = []
    const cleaned: Float64Array[] = []
    let total = 0
    input.forEach((ds, d) => {
      const c = cols[d]!
      const n = c.filter(Number.isFinite).length
      let found: number[] = []
      if (isRout) {
        const r = rout(c, params.q / 100)
        found = r.outliers
        detailRows.push([
          text(ds.title),
          int(n),
          n >= 3 ? num(r.center) : text(''),
          n >= 3 ? num(r.rsdr) : text(''),
          int(r.candidates),
        ])
        for (const i of found) {
          const v = r.values.find((x) => x.index === i)!
          outlierRows.push([text(ds.title), int(i + 1), num(v.value), num(v.t), pval(v.p)])
        }
      } else {
        const g = grubbs(c, params.alpha, params.method === 'grubbsIterative')
        found = g.outliers
        for (const s of g.steps)
          detailRows.push([
            text(ds.title),
            int(s.n),
            num(s.mean),
            num(s.sd),
            num(s.value),
            Number.isFinite(s.G) ? num(s.G) : text(''),
            num(s.critical),
            Number.isFinite(s.p) ? pval(s.p) : text(''),
            yesNo(s.outlier),
          ])
        if (!g.steps.length) detailRows.push([text(ds.title), int(n), ...Array(7).fill(text(''))])
        for (const i of found) outlierRows.push([text(ds.title), int(i + 1), num(c[i]!)])
      }
      if (n < 3)
        diagnostics.push({
          level: 'info',
          message: `“${ds.title}” has fewer than three values and was not tested.`,
        })
      total += found.length
      summaryRows.push([text(ds.title), int(n), int(found.length), int(n - found.length)])
      const out = Float64Array.from(c)
      for (const i of found) out[i] = Number.NaN
      cleaned.push(out)
    })
    const method = isRout
      ? `ROUT, Q = ${params.q}%`
      : `${params.method === 'grubbs' ? 'Grubbs' : 'Iterative Grubbs'}, alpha = ${params.alpha}`
    const blocks: ResultBlock[] = [
      table(
        `Outliers (${method})`,
        ['Data set', 'Values analyzed', 'Outliers', 'Values kept'],
        summaryRows,
      ),
    ]
    const sheets = [
      { key: 'summary', title: 'Summary', blocks },
      {
        key: 'outliers',
        title: 'Outliers',
        blocks: [
          outlierRows.length
            ? table(
                'Outliers',
                isRout
                  ? ['Data set', 'Row', 'Value', 't (|residual| / RSDR)', 'P value']
                  : ['Data set', 'Row', 'Value'],
                outlierRows,
              )
            : ({ type: 'note', text: 'No outliers were found.' } as ResultBlock),
        ],
      },
      {
        key: 'details',
        title: isRout ? 'ROUT' : 'Grubbs’ test',
        blocks: [
          isRout
            ? table(
                'Robust fit',
                ['Data set', 'N', 'Robust mean', 'RSDR', 'Values tested'],
                detailRows,
              )
            : table(
                'Grubbs’ test (two-sided)',
                [
                  'Data set',
                  'N',
                  'Mean',
                  'SD',
                  'Most extreme value',
                  'G',
                  'Critical G',
                  'P value',
                  'Outlier?',
                ],
                detailRows,
              ),
        ],
      },
    ]
    return result({
      sheets,
      diagnostics,
      values: { outliers: int(total) },
      table: buildTable(input, {
        name: 'Cleaned data',
        tableKind: sourceKind(input, context),
        rowCount: rowCountOf(input),
        rowTitles: input[0]?.rowTitles ?? null,
        x: null,
        dataSets: input.map((d, i) => ({
          id: stableId(d.ref.key),
          title: d.title,
          subcolumns: [cleaned[i]!],
        })),
      }),
    })
  },
}
