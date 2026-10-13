// Audit 4 (P6): the forms' dialog parts, explanations and sketches (as the dialog has them).
import '../src/dialogEntry.ts'
/**
 * Regression tests for degenerate and edge-case inputs: preconditions that must fail with a clear
 * message, results that must be flagged, and display rules for values that can't be computed.
 */
import {
  type AnalysisDef,
  type AnalysisResult,
  createTable,
  type DataTable,
  type ResultValue,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { minstd } from '../../stats/test/rng.ts'
import {
  blandAltmanDef,
  contingencyDef,
  correlationDef,
  coxRegressionDef,
  descriptive,
  linearRegressionDef,
  logisticRegressionDef,
  mannWhitney,
  multipleRegressionDef,
  nonlinearFitDef,
  normalityDef,
  oneSampleDef,
  oneWayAnovaDef,
  pcaDef,
  survivalDef,
  ttest,
  twoWayAnovaDef,
  wilcoxon,
} from '../src/index.ts'
import { columnTable, countsTable, find, runDef, summaryTable, xyTable } from './helpers.ts'

// ---- helpers --------------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: each test passes its plugin's own params
type AnyDef = AnalysisDef<any>

const errors = (r: AnalysisResult) =>
  r.diagnostics.filter((d) => d.level === 'error').map((d) => d.message)
const messages = (r: AnalysisResult, level: 'error' | 'info' | 'warning') =>
  r.diagnostics.filter((d) => d.level === level).map((d) => d.message)
const dash = { kind: 'text', v: '—' }

const X9 = [-9, -8.5, -8, -7.5, -7, -6.5, -6, -5.5, -5]
const Y9 = [0, 3, 8, 22, 50, 77, 91, 97, 99]

// ---- contingency ----------------------------------------------------------------------------

describe('contingency: empty rows and columns', () => {
  for (const params of [{}, { test: 'chiSquare' }, { test: 'chiSquare', yates: true }]) {
    it(`fails on a zero row total ${JSON.stringify(params)}`, () => {
      const r = runDef(
        contingencyDef,
        countsTable('contingency', [
          [0, 0],
          [5, 3],
        ]),
        params,
      )
      expect(r.status).toBe('error')
      expect(errors(r)[0]).toMatch(/Row 1/)
    })
  }
  it('fails on a zero column total, naming the column', () => {
    const t = countsTable('contingency', [
      [0, 4],
      [0, 3],
    ])
    const r = runDef(contingencyDef, t, { test: 'chiSquare' })
    expect(r.status).toBe('error')
    expect(errors(r)[0]).toContain(t.dataSets[0]!.title)
  })
  it('still analyzes a table with a zero cell', () => {
    expect(
      runDef(
        contingencyDef,
        countsTable('contingency', [
          [0, 4],
          [5, 3],
        ]),
      ).status,
    ).toBe('ok')
  })
})

// ---- nonlinear regression -------------------------------------------------------------------

describe('nonlinear regression: shared parameters and failed fits', () => {
  const shared = { kind: 'shared' } as const
  it('counts shared parameters when a single data set is fit', () => {
    const r = runDef(nonlinearFitDef, xyTable([-8, -7], [[10, 50]]), {
      constraints: { Bottom: shared, Top: shared, LogEC50: shared, HillSlope: shared },
    })
    expect(r.status).toBe('error')
  })
  it('fails a global fit with fewer points than parameters', () => {
    // Two points each; 1 LogEC50 per data set + 3 shared = 5 parameters for 4 points.
    const r = runDef(
      nonlinearFitDef,
      xyTable(
        [-8, -7],
        [
          [10, 50],
          [12, 60],
        ],
      ),
      {
        constraints: { Bottom: shared, Top: shared, HillSlope: shared },
      },
    )
    expect(r.status).toBe('error')
    expect(errors(r)[0]).toMatch(/global fit has too few points \(4\) to fit 5 parameters/)
  })
  it('shows dashes, not starting values, for a fit that failed', () => {
    const r = runDef(nonlinearFitDef, xyTable(X9.slice(0, 5), [[0, 0, 0, 0, 0]]), {
      weighting: 'relative',
    })
    expect(r.status).toBe('warning')
    expect(messages(r, 'warning')[0]).not.toMatch(/\.\.$/)
    for (const name of ['Bottom', 'Top', 'LogEC50', 'HillSlope', 'R squared'])
      expect(find(r, name)[0], name).toEqual(dash)
    expect(r.values).toEqual({})
    expect(r.outputs).toEqual({})
  })
  it('turns off model comparison when a parameter is shared', () => {
    const t = xyTable(X9, [Y9, Y9.map((y) => y * 0.9 + 3)])
    const params = { compareWith: 'agonist-response', constraints: { HillSlope: shared } }
    const r = runDef(nonlinearFitDef, t, params)
    expect(r.sheets.some((s) => s.key === 'compare')).toBe(false)
    expect(messages(r, 'info')).toContain(
      'Model comparison isn’t available with shared parameters yet.',
    )
    const plain = runDef(nonlinearFitDef, t, { compareWith: 'agonist-response' })
    expect(plain.sheets.some((s) => s.key === 'compare')).toBe(true)
  })
})

// ---- PCA ------------------------------------------------------------------------------------

describe('PCA', () => {
  it('with no component selected, shows PC1 marked as not retained', () => {
    // Parallel analysis keeps nothing for uncorrelated noise.
    const rnd = minstd(7)
    const cols = Array.from({ length: 6 }, () => Array.from({ length: 12 }, rnd))
    const r = runDef(pcaDef, columnTable(cols, { kind: 'multipleVariables' }), { simulations: 200 })
    expect(r.values.selected).toEqual({ kind: 'integer', v: 0 })
    expect(find(r, 'Components retained')[0]).toEqual({ kind: 'integer', v: 0 })
    const retained = (r.sheets[0]!.blocks[0] as { rows: ResultValue[][] }).rows.map((row) =>
      row.at(-1),
    )
    expect(retained.every((x) => (x as { v: boolean }).v === false)).toBe(true)
    expect((r.sheets[0]!.blocks[1] as { columns: string[] }).columns).toEqual(['Variable', 'PC1'])
    expect(messages(r, 'info')).toContain(
      'No component passed the selection rule; showing the first component.',
    )
  })
  it('fails when a standardized variable is constant', () => {
    const t = columnTable(
      [
        [1, 2, 3, 4, 5, 6, 7, 8],
        [5, 5, 5, 5, 5, 5, 5, 5],
        [2, 1, 4, 3, 6, 5, 8, 7],
      ],
      { kind: 'multipleVariables' },
    )
    const r = runDef(pcaDef, t, { select: 'kaiser' })
    expect(r.status).toBe('error')
    expect(errors(r)[0]).toContain(t.dataSets[1]!.title)
    expect(runDef(pcaDef, t, { select: 'kaiser', standardize: false }).status).toBe('ok')
  })
})

// ---- ANOVA ----------------------------------------------------------------------------------

describe('one-way ANOVA: Welch and Brown-Forsythe', () => {
  it('need two values in every group', () => {
    const t = columnTable([[5], [1, 2, 3], [4, 6, 8]])
    for (const equalSD of ['welch', 'brownForsythe']) {
      const r = runDef(oneWayAnovaDef, t, { equalSD })
      expect(r.status).toBe('error')
      expect(errors(r)[0]).toMatch(/at least two values in every group/)
      expect(errors(r)[0]).toContain(t.dataSets[0]!.title)
    }
  })
})

describe('summary data validation', () => {
  it('one-way ANOVA: negative SD fails, naming the column', () => {
    const t = summaryTable('meanSdN', [
      [10, 2, 5],
      [12, 3, 5],
      [14, -3, 5],
    ])
    const r = runDef(oneWayAnovaDef, t)
    expect(r.status).toBe('error')
    expect(errors(r)[0]).toContain(t.dataSets[2]!.title)
  })
  it('two-way ANOVA: non-integer N fails; repeated measures say raw values are needed', () => {
    const grouped = (n2: number[]) => {
      const t = createTable({
        tableKind: 'grouped',
        columns: 2,
        rows: 3,
        yFormat: { type: 'summary', preset: 'meanSdN' },
      })
      t.dataSets.forEach((ds, c) => {
        ds.subcolumns[0]!.values = [1 + c, 2, 3]
        ds.subcolumns[1]!.values = [1, 1, 1]
        ds.subcolumns[2]!.values = c === 1 ? n2 : [5, 5, 5]
      })
      return t
    }
    expect(runDef(twoWayAnovaDef, grouped([5, 5, 5])).status).toBe('ok')
    const rm = runDef(twoWayAnovaDef, grouped([5, 5, 5]), { repeated: 'rows' })
    expect(errors(rm)[0]).toMatch(/raw values/)
    const r = runDef(twoWayAnovaDef, grouped([5, 4.5, 5]))
    expect(errors(r)[0]).toMatch(/N of .*Row 2.* must be a whole number/)
  })
})

it('two-way ANOVA uses the same value keys with and without repeated measures', () => {
  const t = createTable({
    tableKind: 'grouped',
    columns: 2,
    rows: 3,
    yFormat: { type: 'replicates', count: 3 },
  })
  const d = [
    [
      [10, 11, 12],
      [20, 21, 23],
      [30, 33, 31],
    ],
    [
      [12, 14, 13],
      [25, 24, 27],
      [29, 30, 32],
    ],
  ]
  d.forEach((ds, c) => {
    ds.forEach((row, r) => {
      row.forEach((v, j) => {
        t.dataSets[c]!.subcolumns[j]!.values[r] = v
      })
    })
  })
  const keys = ['comparisonTest', 'p.column', 'p.interaction', 'p.row', 'test']
  expect(Object.keys(runDef(twoWayAnovaDef, t).values).sort()).toEqual(keys)
  expect(Object.keys(runDef(twoWayAnovaDef, t, { repeated: 'rows' }).values).sort()).toEqual(keys)
})

// ---- paired rows ----------------------------------------------------------------------------

describe('paired analyses count rows missing one side', () => {
  // Row 1 lacks B, row 5 lacks A: two incomplete rows.
  const t = columnTable([
    [1, 2, 3, 4, null],
    [null, 2.5, 3.1, 4.6, 5],
  ])
  const note = '2 rows without a complete pair were ignored.'
  it('paired t test', () => {
    expect(messages(runDef(ttest, t, { design: 'paired' }), 'info')).toContain(note)
  })
  it('Wilcoxon', () => {
    expect(messages(runDef(wilcoxon, t), 'info')).toContain(note)
  })
  it('Bland-Altman', () => {
    expect(messages(runDef(blandAltmanDef, t), 'info')).toContain(note)
  })
})

// ---- normality ------------------------------------------------------------------------------

it('normality: identical values show dashes, not "passed"', () => {
  const r = runDef(normalityDef, columnTable([[5, 5, 5, 5, 5, 5, 5, 5, 5]]))
  for (const label of [
    'P value',
    'Evidence against a normal distribution (P < 0.05)?',
    'P value summary',
  ])
    for (const cell of find(r, label)) expect(cell, label).toEqual(dash)
})

// ---- descriptive ----------------------------------------------------------------------------

describe('descriptive statistics of summary data', () => {
  it('reports the entered SEM', () => {
    const r = runDef(descriptive, summaryTable('meanSem', [[10, 2]]))
    expect(find(r, 'Std. Error of Mean')[0]).toEqual({ kind: 'number', v: 2 })
  })
  it('reports the CV and the CI of the mean when N is known', () => {
    const r = runDef(descriptive, summaryTable('meanSdN', [[10, 2, 5]]))
    expect(find(r, 'Coefficient of variation')[0]).toEqual({ kind: 'text', v: '20.00%' })
    // t(0.975, 4) = 2.776445105; SEM = 2/√5.
    const h = (2.7764451051977987 * 2) / Math.sqrt(5)
    expect((find(r, 'Lower 95% CI of mean')[0] as { v: number }).v).toBeCloseTo(10 - h, 12)
    expect((find(r, 'Upper 95% CI of mean')[0] as { v: number }).v).toBeCloseTo(10 + h, 12)
  })
})

// ---- one-tailed P keeps a two-sided CI ------------------------------------------------------

describe('one-tailed P values keep the two-sided CI', () => {
  const t = columnTable([
    [1, 2, 3, 4, 5],
    [3, 4, 5, 6, 8],
  ])
  const same = (def: AnyDef, params: object, label: string) => {
    const two = runDef(def, t, params)
    // The data rise from A to B, as predicted (roadmap 51c, S1).
    const one = runDef(def, t, { ...params, tails: 'one', predicted: 'increase' })
    expect(find(one, label)).toEqual(find(two, label))
    const ci = find(one, label)[0] as { lo: number; hi: number }
    expect(Number.isFinite(ci.lo) && Number.isFinite(ci.hi)).toBe(true)
    expect((find(one, 'P value')[0] as { v: number }).v).toBeLessThan(
      (find(two, 'P value')[0] as { v: number }).v,
    )
    if (one.comparisons[0]?.estimate)
      expect(one.comparisons[0].estimate).toEqual(two.comparisons[0]!.estimate)
  }
  it('unpaired and paired t tests', () => {
    same(ttest, {}, '95% confidence interval')
    same(ttest, { design: 'paired' }, '95% confidence interval')
    same(ttest, { design: 'paired', paired: { measure: 'ratio' } }, '95% CI of ratio')
  })
  it('Mann-Whitney and Wilcoxon', () => {
    same(mannWhitney, { pMethod: 'approximate' }, '95% CI of the shift')
    same(wilcoxon, { pMethod: 'approximate' }, '95% CI of Hodges-Lehmann estimate')
  })
  it('one-sample tests', () => {
    const one = columnTable([[11, 12, 13, 14.5, 16]])
    for (const [test, label] of [
      ['t', '95% CI of discrepancy'],
      ['wilcoxon', '95% CI of Hodges-Lehmann estimate'],
    ] as const) {
      const a = runDef(oneSampleDef, one, { test, hypothetical: 10, pMethod: 'approximate' })
      const b = runDef(oneSampleDef, one, {
        test,
        hypothetical: 10,
        pMethod: 'approximate',
        tails: 'one',
        predicted: 'increase',
      })
      expect(find(b, label)).toEqual(find(a, label))
    }
  })
})

// ---- XY rows without X ----------------------------------------------------------------------

describe('XY rows with Y but no X are reported', () => {
  const t = xyTable([1, 2, 3, 4, 5, null], [[1.1, 2.3, 30, 3.9, 5.2, 6]])
  t.x!.subcolumns[0]!.excluded = [false, false, true, false, false, false]
  const note = '2 rows with Y values but no X were left out.'
  it('linear regression', () => {
    const r = runDef(linearRegressionDef, t)
    expect(messages(r, 'info')).toContain(note)
    expect(find(r, 'Number of points analyzed')[0]).toEqual({ kind: 'integer', v: 4 })
  })
  it('nonlinear regression and correlation', () => {
    expect(messages(runDef(nonlinearFitDef, t, { equation: 'straight-line' }), 'info')).toContain(
      note,
    )
    expect(messages(runDef(correlationDef, t), 'info')).toContain(note)
  })
})

// ---- degenerate data warnings ---------------------------------------------------------------

describe('degenerate data is flagged, not reported as ok', () => {
  it('linear regression with no data set of enough points', () => {
    const r = runDef(linearRegressionDef, xyTable([1, 2], [[1, 2]]))
    expect(r.status).toBe('error')
    expect(errors(r)).toEqual(['No data set has enough points for a line (at least 3).'])
    expect(messages(r, 'warning')[0]).toMatch(/fewer than 3 points/)
  })
})

// ---- preconditions and degenerate data ------------------------------------------------------

/** Survival table: [time, data set, code] per subject. */
function survivalTable(subjects: [number, number, number][]): DataTable {
  const t = createTable({ tableKind: 'survival', columns: 2, rows: subjects.length })
  subjects.forEach(([time, group, code], r) => {
    t.x!.subcolumns[0]!.values[r] = time
    t.dataSets[group]!.subcolumns[0]!.values[r] = code
  })
  return t
}

const mv = (cols: (number | null)[][]) => columnTable(cols, { kind: 'multipleVariables' })
const x6 = [1, 2, 3, 4, 5, 6]
const same5 = columnTable([
  [5, 5, 5],
  [5, 5, 5],
])

describe('preconditions fail and degenerate data is flagged, not reported as ok', () => {
  it.each<[string, AnyDef, DataTable, object, 'error' | 'warning', RegExp?]>([
    [
      'logistic: needs more rows than parameters',
      logisticRegressionDef,
      mv([
        [0, 1],
        [1, 2],
      ]),
      {},
      'error',
      /Need more than 2 complete rows/,
    ],
    [
      'logistic: the outcome needs both 0 and 1',
      logisticRegressionDef,
      mv([[0, 0, 0, 0, 0, 0], x6]),
      {},
      'error',
      /The outcome has only one value/,
    ],
    [
      'Cox: needs at least one event',
      coxRegressionDef,
      mv([x6, [0, 0, 0, 0, 0, 0], [2, 1, 4, 3, 6, 5]]),
      {},
      'error',
      /No events: every subject is censored/,
    ],
    [
      'Cox: needs more rows than predictors',
      coxRegressionDef,
      mv([[1], [1], [2]]),
      {},
      'error',
      /Need more than 1 complete rows/,
    ],
    [
      'multiple regression: warns when Y is constant',
      multipleRegressionDef,
      mv([[5, 5, 5, 5, 5, 5], x6, [2, 1, 4, 3, 6, 5]]),
      {},
      'warning',
      /same value in every row/,
    ],
    [
      'one-way ANOVA: Welch needs variation within every group',
      oneWayAnovaDef,
      columnTable([
        [5, 5, 5],
        [1, 2, 3],
        [4, 6, 8],
      ]),
      { equalSD: 'welch' },
      'error',
      /variation/,
    ],
    [
      't test of summary data: N must be a whole number of at least 2',
      ttest,
      summaryTable('meanSdN', [
        [10, 2, 2.5],
        [12, 3, 5],
      ]),
      {},
      'error',
      /N of .* must be a whole number, 2 or more/,
    ],
    [
      't test of summary data: negative N fails',
      ttest,
      summaryTable('meanSdN', [
        [10, 2, 5],
        [12, 3, -5],
      ]),
      {},
      'error',
    ],
    [
      't test of summary data: negative SD fails',
      ttest,
      summaryTable('meanSdN', [
        [10, -2, 5],
        [12, 3, 5],
      ]),
      {},
      'error',
      /can’t be negative/,
    ],
    ['t test with identical values', ttest, same5, {}, 'warning'],
    ['paired t test with identical values', ttest, same5, { design: 'paired' }, 'warning'],
    [
      'correlation with a constant column',
      correlationDef,
      columnTable([
        [5, 5, 5, 5, 5],
        [1, 2, 3, 4, 5],
      ]),
      {},
      'warning',
    ],
    [
      'linear regression with every X equal',
      linearRegressionDef,
      xyTable([2, 2, 2, 2], [[1, 2, 3, 4]]),
      {},
      'warning',
      /Every X .* is the same/,
    ],
    [
      'survival with every subject censored',
      survivalDef,
      survivalTable([
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
        [1, 1, 0],
        [4, 1, 0],
      ]),
      {},
      'warning',
      /every subject is censored/,
    ],
  ])('%s', (_, def, t, params, status, message) => {
    const r = runDef(def, t, params)
    expect(r.status).toBe(status)
    if (message) expect(messages(r, status)[0]).toMatch(message)
  })
})

// ---- form fields ----------------------------------------------------------------------------

it('hides form fields the chosen options ignore', () => {
  const showIf = (def: AnyDef, path: string) =>
    [def.form.find((f) => f.path.join('.') === path)!.showIf].flat()
  expect(showIf(ttest, 'reportFTestVariances')).toContainEqual({
    path: ['design'],
    in: ['unpaired'],
  })
  expect(showIf(ttest, 'predicted')).toContainEqual({ path: ['tails'], in: ['one'] })
  expect(showIf(linearRegressionDef, 'compare')).toContainEqual({
    path: ['throughOrigin'],
    in: [false],
  })
})
