import type {
  AnalysisNode,
  AnalysisResult,
  AnnotationId,
  DataTable,
  DocNode,
  GraphableDataSet,
  GraphNode,
  Layer,
  NodeId,
  ResultBlock,
  ResultValue,
  RichText,
} from '@ps/model'
import { graphOf } from './graphs.ts'
import { fixedTable, sampleTable } from './helpers.ts'

// Results on graphs (roadmap 35): analyses' results as the plugins write them (their sheets'
// keys, blocks' titles, rows' labels and columns as `@ps/analyses` makes them; the numbers fixed
// here, the analyses' own being checked against R), and graphs of labels, lines, bands, brackets,
// number-at-risk tables and inset tables drawing them — the goldens' cases and the unit tests'.

const num = (v: number, digits?: number): ResultValue =>
  digits === undefined ? { kind: 'number', v } : { kind: 'number', v, digits }
const text = (v: string): ResultValue => ({ kind: 'text', v })
const pval = (v: number): ResultValue => ({ kind: 'pvalue', v })
const ci = (lo: number, hi: number): ResultValue => ({ kind: 'interval', lo, hi, level: 0.95 })
/** A table with its row labels first (analyses' `labelTable`). */
const labelTable = (
  title: string,
  columns: readonly string[],
  rows: [string, ResultValue[]][],
): ResultBlock => ({
  type: 'table',
  title,
  columns: ['', ...columns],
  rows: rows.map(([l, vs]) => [text(l), ...vs]),
})

export const result = (r: Partial<AnalysisResult>): AnalysisResult => ({
  status: 'ok',
  diagnostics: [],
  sheets: [],
  values: {},
  comparisons: [],
  outputs: {},
  ...r,
})

/** An analysis node of a table's data sets. */
export const analysisNode = (
  id: string,
  analysisId: string,
  table: DataTable,
  dataSets: readonly string[],
  input: Partial<AnalysisNode['input']> = {},
  name = analysisId,
): AnalysisNode => ({
  kind: 'analysis',
  id: id as NodeId,
  name,
  analysisId,
  pluginVersion: 1,
  input: { source: table.id, dataSets: [...dataSets], ...input },
  params: {},
})

/** A result layer (label, line or band) reading an analysis. */
export const resultLayer = (
  id: string,
  geom: 'label' | 'refline' | 'band',
  analysis: string,
  stat: Omit<Extract<Layer['stat'], { kind: 'result' }>, 'kind'>,
  more: Partial<Layer> = {},
): Layer =>
  ({
    id,
    geom,
    stat: { kind: 'result', ...stat },
    data: { from: 'analysis', analysis: analysis as NodeId },
    ...more,
  }) as Layer

/** A curves layer drawing outputs of an analysis, each in its data set's colour. */
export const curvesLayer = (
  analysis: string,
  keys: readonly string[],
  prefix = 'curve',
): Layer => ({
  id: 'curves',
  geom: 'line',
  stat: { kind: 'identity' },
  data: {
    from: 'outputs',
    series: keys.map((k) => ({
      id: `${prefix}${k}` as never,
      ref: { node: analysis as NodeId, key: `${prefix}:${k}` },
      colorOf: k,
    })),
  },
})

// --- Tables ----------------------------------------------------------------------------------

/** An XY table of one data set: score by age. */
export function correlationTable(): DataTable {
  const t = fixedTable(
    'xy',
    { type: 'replicates', count: 1 },
    [[[12, 15, 14, 19, 22, 21, 26, 25, 30, 29]]],
    { titles: ['Score'], x: [21, 25, 30, 34, 38, 41, 47, 52, 58, 63] },
  )
  t.x!.title = 'Age'
  return t
}

/** Concentrations (µM) and responses of two data sets falling as a 4-parameter logistic. */
export const DOSES = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100]
const logistic = (x: number, ic50: number, hill: number) => 5 + 95 / (1 + (x / ic50) ** hill)

export function doseTable(): DataTable {
  const noise = [1.5, -2, 0.8, -1.2, 2.1, -0.6, 1.1, -1.4, 0.4]
  const t = fixedTable(
    'xy',
    { type: 'replicates', count: 1 },
    [
      [DOSES.map((x, i) => +(logistic(x, 1.2, 1) + noise[i]!).toFixed(2))],
      [DOSES.map((x, i) => +(logistic(x, 8.5, 1.3) - noise[i]!).toFixed(2))],
    ],
    { titles: ['Control', 'Treated'], x: DOSES },
  )
  t.x!.title = 'Concentration (µM)'
  return t
}

/** A fitted curve's output: 60 points from the first dose to the last (log spaced). */
function curve(title: string, ic50: number, hill: number): GraphableDataSet {
  const xs = Array.from({ length: 60 }, (_, i) => 10 ** (-2 + (4 * i) / 59))
  return { title, x: xs, y: xs.map((x) => logistic(x, ic50, hill)) }
}

// --- Results, as the plugins write them -------------------------------------------------------

/** Pearson correlation of X with Score (one pair: values `r` and `p`). */
export const CORRELATION = result({
  values: { r: num(0.9761), p: pval(1.4e-6) },
  sheets: [
    {
      key: 'results',
      title: 'Table of results',
      blocks: [
        labelTable(
          'Pearson correlation',
          [
            'Pearson r',
            '95% CI',
            'R squared',
            'P value (two-tailed)',
            'P value summary',
            'Significant (alpha = 0.05)?',
            'Number of XY pairs',
          ],
          [
            [
              'X vs. Score',
              [
                num(0.9761),
                ci(0.8992, 0.9945),
                num(0.9528),
                pval(1.4e-6),
                { kind: 'pSummary', v: 1.4e-6 },
                text('Yes'),
                { kind: 'integer', v: 10 },
              ],
            ],
          ],
        ),
      ],
    },
  ],
})

/** A straight line through Score by age: its line output and the equation. */
export const REGRESSION = result({
  values: { 'slope:a': num(0.4135), 'intercept:a': num(3.712) },
  outputs: {
    'line:a': { title: 'Score (fit)', x: [21, 63], y: [3.712 + 0.4135 * 21, 3.712 + 0.4135 * 63] },
  },
  sheets: [
    {
      key: 'results',
      title: 'Table of results',
      blocks: [
        labelTable(
          'Best-fit values',
          ['Score'],
          [
            ['Slope', [num(0.4135)]],
            ['Y-intercept', [num(3.712)]],
          ],
        ),
        labelTable('Std. Error', ['Score'], [['Slope', [num(0.0301)]]]),
        labelTable('Goodness of Fit', ['Score'], [['R squared', [num(0.9593)]]]),
        labelTable('Is slope significantly non-zero?', ['Score'], [['P value', [pval(7.9e-7)]]]),
        labelTable('Equation', ['Score'], [['', [text('Y = 0.4135*X + 3.712')]]]),
      ],
    },
  ],
})

/** A dose-response fit of both data sets (IC50 per data set, its CI). */
export const DOSE_FIT = result({
  outputs: {
    'curve:a': curve('Control (fit)', 1.2, 1),
    'curve:b': curve('Treated (fit)', 8.5, 1.3),
  },
  values: {
    'IC50:a': num(1.214),
    'IC50:b': num(8.43),
    'HillSlope:a': num(1.01),
    'HillSlope:b': num(1.32),
  },
  sheets: [
    {
      key: 'results',
      title: 'Table of results',
      blocks: [
        { type: 'note', text: '[Inhibitor] vs. response (variable slope)' },
        labelTable(
          'Best-fit values',
          ['Control', 'Treated'],
          [
            ['Bottom', [num(5.2), num(4.6)]],
            ['Top', [num(99.4), num(100.8)]],
            ['IC50', [num(1.214), num(8.43)]],
            ['HillSlope', [num(1.01), num(1.32)]],
          ],
        ),
        labelTable(
          '95% CI (profile likelihood)',
          ['Control', 'Treated'],
          [['IC50', [ci(0.98, 1.51), ci(6.9, 10.4)]]],
        ),
        labelTable(
          'Goodness of Fit',
          ['Control', 'Treated'],
          [['R squared', [num(0.9961), num(0.9947)]]],
        ),
      ],
    },
  ],
})

/** Descriptive statistics of a column table's data sets (mean and its 95% CI). */
export const DESCRIPTIVE = result({
  sheets: [
    {
      key: 'descriptive',
      title: 'Descriptive statistics',
      blocks: [
        {
          type: 'table',
          columns: ['', 'Control', 'Drug A', 'Drug B'],
          rows: [
            [text('Number of values'), ...[6, 6, 5].map((v) => ({ kind: 'integer' as const, v }))],
            [text('Mean'), num(13.5), num(19.5), num(10)],
            [text('Lower 95% CI of mean'), num(11.54), num(17.54), num(8.037)],
            [text('Upper 95% CI of mean'), num(15.46), num(21.46), num(11.96)],
          ],
        },
      ],
    },
  ],
  values: { 'mean:a': num(13.5), 'mean:b': num(19.5), 'mean:c': num(10) },
})

/** An unpaired t test (its comparison for a bracket, its sheet). */
export const TTEST = (a: string, b: string, p: number) =>
  result({
    values: { p: pval(p), t: num(3.21) },
    comparisons: [
      {
        key: `${a}|${b}`,
        a: { node: 't1' as NodeId, key: a },
        b: { node: 't1' as NodeId, key: b },
        p,
      },
    ],
    sheets: [
      {
        key: 'results',
        title: 'Table of results',
        blocks: [
          {
            type: 'keyValue',
            title: 'Unpaired t test',
            rows: [
              { label: 'P value', value: pval(p) },
              { label: 't', value: num(3.21) },
              { label: 'df', value: num(10) },
            ],
          },
          {
            type: 'keyValue',
            title: 'How big is the difference?',
            rows: [
              { label: 'Difference between means (B − A)', value: num(6) },
              { label: '95% confidence interval', value: ci(1.9, 10.1) },
              { label: 'Cohen’s d', value: num(1.85) },
            ],
          },
        ],
      },
    ],
  })

// --- The goldens' cases ------------------------------------------------------------------------

/** A golden graph drawing analyses' results: its nodes, graph and the analyses' results. */
export type ResultCase = [
  name: string,
  nodes: DocNode[],
  graph: GraphNode,
  results: Record<string, AnalysisResult>,
]

const P_TEMPLATE: RichText = [
  { text: 'r', italic: true },
  { text: ' = {r}, ' },
  { text: 'P', italic: true },
  { text: ' = {P}' },
]

const IC50: RichText = [{ text: 'IC' }, { text: '50', sub: true }, { text: ' = {IC50}' }]

/** XY graphs: points (and curves) of a table, with result layers over them. */
const xyGraph = (table: DataTable, layers: Layer[], patch: Partial<GraphNode> = {}) =>
  graphOf(table, 'pointsOnly', (g) => ({ layers: [...g.layers, ...layers], ...patch }))

export function resultCases(): ResultCase[] {
  const corr = correlationTable()
  const dose = doseTable()
  const column = sampleTable('column')
  const survival = sampleTable('survival')
  const corrNode = analysisNode('corr', 'correlation', corr, ['a'], {}, 'Correlation')
  const lineNode = analysisNode('line', 'linearRegression', corr, ['a'], {}, 'Linear regression')
  const fitNode = analysisNode('fit', 'nonlinearFit', dose, ['a', 'b'], {}, 'Nonlinear fit')
  const descNode = analysisNode('desc', 'descriptive', column, ['a', 'b', 'c'], {}, 'Descriptive')
  const four = fixedTable(
    'column',
    { type: 'replicates', count: 1 },
    [[[10, 12, 11]], [[11, 13, 12]], [[9, 12, 10]], [[18, 21, 20]]],
    { titles: ['HC1', 'HC2', 'HC3', 'P1'] },
  )
  const pooled = analysisNode('pooled', 'ttest', four, ['a', 'b', 'c', 'd'], {
    pools: [['a', 'b', 'c']],
  })
  const xyTwo = sampleTable('xy')
  const atX = analysisNode('atx', 'ttest', xyTwo, ['a', 'b'], { atX: 5 })
  const survivalNode = analysisNode('surv', 'survival', survival, ['a', 'b'], {}, 'Survival')

  const fitLayers = [
    curvesLayer('fit', ['a', 'b']),
    resultLayer(
      'drops',
      'refline',
      'fit',
      {
        fields: {
          IC50: {
            ref: {
              from: 'cell',
              sheet: 'results',
              block: 'Best-fit values',
              row: 'IC50',
              column: '{dataSet}',
            },
          },
        },
        at: 'IC50',
        axis: 'x',
        drop: 'both',
        per: 'dataSet',
      },
      { legend: 'hide' },
    ),
  ]
  const ic50Label = (show?: 'legend') =>
    resultLayer('ic50', 'label', 'fit', {
      fields: {
        IC50: {
          ref: {
            from: 'cell',
            sheet: 'results',
            block: 'Best-fit values',
            row: 'IC50',
            column: '{dataSet}',
          },
          format: { digits: 3, axisUnit: 'x' },
        },
      },
      template: IC50,
      per: 'dataSet',
      ...(show ? { show } : { place: { at: 'curve' } }),
    })
  const logX = (g: GraphNode): Partial<GraphNode> => ({
    axes: { ...g.axes, x: { ...g.axes.x, scale: 'log10' } as GraphNode['axes']['x'] },
  })

  return [
    [
      'result-correlation-label',
      [corr, corrNode],
      xyGraph(corr, [
        resultLayer('rp', 'label', 'corr', {
          fields: {
            r: { ref: { from: 'value', key: 'r' }, format: { digits: 2 } },
            P: {
              ref: {
                from: 'cell',
                sheet: 'results',
                block: 'Pearson correlation',
                row: 'X vs. Score',
                column: 'P value (two-tailed)',
              },
              format: { p: 'below' },
            },
          },
          template: P_TEMPLATE,
          place: { at: 'corner', corner: 'topLeft' },
        }),
      ]),
      { corr: CORRELATION },
    ],
    [
      'result-regression-equation',
      [corr, lineNode],
      xyGraph(corr, [
        curvesLayer('line', ['a'], 'line'),
        resultLayer('eq', 'label', 'line', {
          fields: {
            eq: {
              ref: {
                from: 'cell',
                sheet: 'results',
                block: 'Equation',
                row: '',
                column: '{dataSet}',
              },
            },
            R2: {
              ref: {
                from: 'cell',
                sheet: 'results',
                block: 'Goodness of Fit',
                row: 'R squared',
                column: '{dataSet}',
              },
            },
            slope: {
              ref: {
                from: 'cell',
                sheet: 'results',
                block: 'Best-fit values',
                row: 'Slope',
                column: '{dataSet}',
              },
            },
            se: {
              ref: {
                from: 'cell',
                sheet: 'results',
                block: 'Std. Error',
                row: 'Slope',
                column: '{dataSet}',
              },
            },
            P: {
              ref: {
                from: 'cell',
                sheet: 'results',
                block: 'Is slope significantly non-zero?',
                row: 'P value',
                column: '{dataSet}',
              },
            },
          },
          template: [
            { text: '{eq}\n' },
            { text: 'R', italic: true },
            { text: '2', sup: true },
            { text: ' = {R2}, slope = {slope} ± {se}, ' },
            { text: 'P', italic: true },
            { text: ' = {P}' },
          ],
          per: 'dataSet',
          place: { at: 'corner', corner: 'bottomRight' },
        }),
      ]),
      { line: REGRESSION },
    ],
    [
      'result-ic50-drop-lines',
      [dose, fitNode],
      { ...xyGraph(dose, [...fitLayers, ic50Label()]), ...logX(xyGraph(dose, [])) },
      { fit: DOSE_FIT },
    ],
    [
      'result-fits-per-group',
      [dose, fitNode],
      {
        ...xyGraph(dose, [
          curvesLayer('fit', ['a', 'b']),
          resultLayer(
            'fits',
            'label',
            'fit',
            {
              fields: {
                hill: { ref: { from: 'value', key: 'HillSlope:{key}' }, format: { digits: 2 } },
                R2: {
                  ref: {
                    from: 'cell',
                    sheet: 'results',
                    block: 'Goodness of Fit',
                    row: 'R squared',
                    column: '{dataSet}',
                  },
                  format: { digits: 4 },
                },
              },
              template: [
                { text: 'Hill slope {hill}, ' },
                { text: 'R', italic: true },
                { text: '2', sup: true },
                { text: ' = {R2}' },
              ],
              per: 'dataSet',
              place: { at: 'corner', corner: 'topRight' },
            },
            { style: { background: 'box' } },
          ),
        ]),
        ...logX(xyGraph(dose, [])),
      },
      { fit: DOSE_FIT },
    ],
    [
      'result-refline-band',
      [column, descNode],
      graphOf(column, 'pointsOnly', (g) => ({
        layers: [
          resultLayer(
            'ci',
            'band',
            'desc',
            {
              fields: {
                lo: {
                  ref: {
                    from: 'cell',
                    sheet: 'descriptive',
                    row: 'Lower 95% CI of mean',
                    column: 'Control',
                  },
                },
                hi: {
                  ref: {
                    from: 'cell',
                    sheet: 'descriptive',
                    row: 'Upper 95% CI of mean',
                    column: 'Control',
                  },
                },
              },
              lo: 'lo',
              hi: 'hi',
            },
            { name: '95% CI of the control mean' },
          ),
          ...g.layers,
          resultLayer(
            'mean',
            'refline',
            'desc',
            {
              fields: { mean: { ref: { from: 'value', key: 'mean:a' } } },
              at: 'mean',
            },
            { name: 'Control mean' },
          ),
        ],
        legend: { ...g.legend, show: true },
      })),
      { desc: DESCRIPTIVE },
    ],
    [
      'result-xy-bracket',
      [xyTwo, atX],
      graphOf(xyTwo, 'meanSd', (g) => ({
        annotations: [
          {
            type: 'bracket',
            id: 'n1' as AnnotationId,
            a: 'a',
            b: 'b',
            x: 5,
            label: {
              source: 'analysis',
              analysis: 'atx' as NodeId,
              comparison: 'a|b',
              show: 'both',
            },
            level: 'auto',
          },
          {
            type: 'bracket',
            id: 'n2' as AnnotationId,
            a: 'a',
            b: 'b',
            x: 2,
            label: { source: 'manual', text: 'ns' },
            level: 'auto',
          },
        ],
        legend: { ...g.legend, show: true },
      })),
      { atx: TTEST('a', 'b', 0.0021) },
    ],
    [
      'result-group-bracket',
      [four, pooled],
      graphOf(four, 'barsPoints', () => ({
        annotations: [
          {
            type: 'bracket',
            id: 'n1' as AnnotationId,
            a: 'a',
            b: 'd',
            group: ['b', 'c'],
            label: {
              source: 'analysis',
              analysis: 'pooled' as NodeId,
              comparison: 'a|d',
              show: 'p',
            },
            level: 'auto',
          },
        ],
      })),
      { pooled: TTEST('a', 'd', 0.0004) },
    ],
    [
      'result-risk-table',
      [survival, survivalNode],
      graphOf(survival, 'survival', (g) => ({
        riskTable: { show: true },
        legend: { ...g.legend, show: true },
      })),
      {},
    ],
    [
      'result-inset-table',
      [column, descNode],
      graphOf(column, 'bars', () => ({
        annotations: [
          {
            type: 'table',
            id: 'n1' as AnnotationId,
            analysis: 'desc' as NodeId,
            sheet: 'descriptive',
            rows: { from: 1, to: 1 },
            place: 'right',
            digits: 3,
          },
        ],
      })),
      { desc: DESCRIPTIVE },
    ],
    [
      'result-legend-label',
      [dose, fitNode],
      {
        ...xyGraph(dose, [curvesLayer('fit', ['a', 'b']), ic50Label('legend')]),
        ...logX(xyGraph(dose, [])),
        legend: { ...xyGraph(dose, []).legend, show: true },
      },
      { fit: DOSE_FIT },
    ],
  ]
}
