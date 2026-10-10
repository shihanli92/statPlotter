import { type AnalysisResult, type DataTable, normalizeTable, type ResultValue } from '@ps/model'
import {
  equation,
  fittedCurve,
  interpolateX,
  linearRegression,
  nonlinearFit,
  parseEquation as statsParse,
} from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { noise } from '../../stats/test/rng.ts'
import {
  linearRegressionDef,
  nonlinearFitDef,
  parseEquation,
  resolveEquation,
  USER_EQUATION,
} from '../src/index.ts'
import { runDef, v, xyReplicatesTable } from './helpers.ts'

const runNl = (t: DataTable, p: object = {}) =>
  runDef(nonlinearFitDef, t, p, {
    tableKind: 'xy',
    xTitle: 'log[Agonist]',
  })
const runLin = (t: DataTable, p: object = {}) =>
  runDef(linearRegressionDef, t, p, {
    tableKind: 'xy',
    xTitle: 'Conc',
  })

function tableRows(r: AnalysisResult, sheet: string, title: string): ResultValue[][] {
  const s = r.sheets.find((x) => x.key === sheet)
  const b = s?.blocks.find((x) => x.type === 'table' && x.title === title)
  if (b?.type !== 'table') throw new Error(`no ${sheet} / ${title}`)
  return b.rows
}
const logistic = (x: number) => 2 + 96 / (1 + 10 ** ((-6.5 - x) * 1.1))
const DOSE = [-9, -8.5, -8, -7.5, -7, -6.5, -6, -5.5, -5, -4.5, -4]

/** Standards (two replicates) then unknowns: two Y-only rows and one X-only row. */
function standardCurve(): { table: DataTable; nStd: number } {
  const e = noise(11, 2)
  const r1 = DOSE.map((x) => logistic(x) + e())
  const r2 = DOSE.map((x) => logistic(x) + e())
  const table = xyReplicatesTable(
    [...DOSE, null, null, -6.8],
    [
      [
        [...r1, 30, 70, null],
        [...r2, 32, null, null],
      ],
    ],
  )
  table.rowTitles = [...DOSE.map(() => null), 'Sample A', 'Sample B', 'Probe']
  return { table, nStd: DOSE.length }
}

describe('interpolating unknowns from a standard curve', () => {
  it('nonlinear: X for each replicate of the Y unknowns, Y for X unknowns, and a result table', () => {
    const { table } = standardCurve()
    const r = runNl(table, { interpolate: true })
    expect(r.status).toBe('ok')
    // The same fit and interpolation straight from stats.
    const eq = equation('agonist-response-variable-slope')!
    const std = normalizeTable(table)[0]!
    const xs: number[] = []
    const ys: number[] = []
    for (let row = 0; row < DOSE.length; row++)
      for (const rep of (std.data as { reps: Float64Array[] }).reps) {
        xs.push(std.x![row]!)
        ys.push(rep[row]!)
      }
    const fit = nonlinearFit(eq, [{ x: xs, y: ys }])
    const curve = fittedCurve(eq, fit, 0)
    const want = (y: number) => interpolateX(curve, y, -9, -4)

    const rows = tableRows(r, 'interpolated', 'Interpolated X values')
    expect(rows.map((row) => [(row[1] as { v: string }).v, v(row[2]), v(row[3])])).toEqual([
      ['Sample A', 1, 30],
      ['Sample A', 2, 32],
      ['Sample B', 1, 70],
    ])
    expect(v(rows[0]![4])).toBeCloseTo(want(30).x, 12)
    const ci = rows[0]![5] as { lo: number; hi: number }
    expect(ci.lo).toBeCloseTo(want(30).lo, 12)
    expect(ci.hi).toBeCloseTo(want(30).hi, 12)
    const means = tableRows(r, 'interpolated', 'Interpolated mean X values')
    expect(v(means[0]![3])).toBeCloseTo((want(30).x + want(32).x) / 2, 12)
    expect(v(means[0]![4])).toBe(2)
    const yRows = tableRows(r, 'interpolated', 'Interpolated Y values')
    expect(v(yRows[0]![3])).toBeCloseTo(
      eq.f(
        -6.8,
        fit.params[0]!.map((p) => p.value),
      ),
      12,
    )

    // Result table: XY, stacked replicate rows then the X unknown; the source's data set id.
    const t = r.table!
    expect(t.tableKind).toBe('xy')
    expect(t.x!.title).toBe('log[Agonist]')
    expect(t.dataSets.map((d) => d.id)).toEqual([table.dataSets[0]!.id])
    expect(t.rowTitles).toEqual(['Sample A', 'Sample A', 'Sample B', 'Probe'])
    expect(t.x!.subcolumns[0]!.values[0]).toBeCloseTo(want(30).x, 12)
    expect(t.dataSets[0]!.subcolumns[0]!.values.slice(0, 3)).toEqual([30, 32, 70])
    expect(t.x!.subcolumns[0]!.values[3]).toBe(-6.8)
  })

  it('leaves out-of-range values blank and marks extrapolation', () => {
    const { table } = standardCurve()
    table.dataSets[0]!.subcolumns[0]!.values[DOSE.length] = 150 // above Top
    const r = runNl(table, { interpolate: true })
    const rows = tableRows(r, 'interpolated', 'Interpolated X values')
    expect(rows[0]![4]).toEqual({ kind: 'text', v: '' })
    expect(rows[0]![6]).toEqual({ kind: 'text', v: 'Out of range' })
    expect(r.table!.x!.subcolumns[0]!.values[0]).toBeNull()
  })

  it('rows with a missing X above the standards are not unknowns', () => {
    const { table } = standardCurve()
    table.x!.subcolumns[0]!.values[3] = null // a standard lost its X: ignored, not interpolated
    const r = runNl(table, { interpolate: true })
    expect(tableRows(r, 'interpolated', 'Interpolated X values')).toHaveLength(3)
  })

  it('without unknowns: a note and no table', () => {
    const e = noise(3, 1)
    const t = xyReplicatesTable(DOSE, [[DOSE.map((x) => logistic(x) + e())]])
    const r = runNl(t, { interpolate: true })
    expect(r.table).toBeUndefined()
    expect(r.sheets.find((s) => s.key === 'interpolated')!.blocks[0]!.type).toBe('note')
    expect(runNl(t).sheets.some((s) => s.key === 'interpolated')).toBe(false)
  })

  it('linear regression: X = (Y − intercept)/slope, with the band-crossing CI', () => {
    const x = [0, 5, 10, 20, 40, 80]
    const e = noise(5, 0.02)
    const y = x.map((v) => 0.05 + 0.02 * v + e())
    const t = xyReplicatesTable([...x, null, 30], [[[...y, 0.9, null]]])
    const r = runLin(t, { interpolate: true })
    const fit = linearRegression(x, y)
    const rows = tableRows(r, 'interpolated', 'Interpolated X values')
    expect(v(rows[0]![3])).toBeCloseTo((0.9 - fit.intercept) / fit.slope, 10)
    const ci = rows[0]![4] as { lo: number; hi: number }
    expect(ci.lo).toBeLessThan(v(rows[0]![3]))
    expect(ci.hi).toBeGreaterThan(v(rows[0]![3]))
    expect(r.table!.dataSets[0]!.id).toBe(t.dataSets[0]!.id)
    expect(v(tableRows(r, 'interpolated', 'Interpolated Y values')[0]![3])).toBeCloseTo(
      fit.intercept + 30 * fit.slope,
      12,
    )
  })
})

describe('user-defined equations in the nonlinear analysis', () => {
  const e = noise(7, 2)
  const t = xyReplicatesTable(DOSE, [
    [DOSE.map((x) => logistic(x) + e()), DOSE.map((x) => logistic(x) + e())],
  ])

  it('fits the same curve as the built-in equation', () => {
    const text = 'Span = Top - Bottom\nY = Bottom + Span/(1 + 10^((LogEC50 - X)*HillSlope))'
    const r = runNl(t, {
      equation: USER_EQUATION,
      userEquation: text,
      initialValues: { Top: 100, Bottom: 0, LogEC50: -6, HillSlope: 1 },
    })
    const b = runNl(t)
    expect(r.status).toBe('ok')
    const best = tableRows(r, 'results', 'Best-fit values')
    const ref = tableRows(b, 'results', 'Best-fit values')
    const val = (rows: ResultValue[][], name: string) =>
      v(rows.find((row) => (row[0] as { v: string }).v === name)![1])
    for (const n of ['Bottom', 'Top', 'LogEC50', 'HillSlope'])
      expect(val(best, n)).toBeCloseTo(val(ref, n), 7)
  })

  it('reports syntax errors with their position', () => {
    const r = runNl(t, { equation: USER_EQUATION, userEquation: 'Y = Bottom + (Top - X' })
    expect(r.status).toBe('error')
    expect(r.diagnostics.at(-1)!.message).toMatch(/line 1, column \d+\): Missing/)
    const parsed = parseEquation('Y = A*exp(-K*X) + B')
    expect(parsed.ok && parsed.parameters).toEqual(['A', 'K', 'B'])
    expect(resolveEquation({ equation: 'nope', userEquation: '', initialValues: {} }).ok).toBe(
      false,
    )
    expect(statsParse).toBe(parseEquation)
  })

  it('limits and initial values apply to built-in equations too', () => {
    const r = runNl(t, { limits: { Bottom: { min: 5 } }, initialValues: { HillSlope: 2 } })
    const best = tableRows(r, 'results', 'Best-fit values')
    expect(v(best[0]![1])).toBe(5) // the unconstrained Bottom is ~2
  })
})

describe('data set constants (enzyme inhibition)', () => {
  const S = [0.5, 1, 2, 4, 8, 16, 32, 64]
  const I = [0, 2, 5, 10]
  const e = noise(13, 1)
  const ys = I.map((i) => [S.map((s) => (100 * s) / (4 * (1 + i / 2) + s) + e())])
  it('reads the inhibitor concentration from each data set title and fits globally', () => {
    const t = xyReplicatesTable(S, ys, I.map(String))
    const r = runNl(t, { equation: 'competitive-inhibition' })
    expect(r.status).toBe('ok')
    const best = tableRows(r, 'results', 'Best-fit values')
    const row = (n: string) => best.find((x) => (x[0] as { v: string }).v === n)!
    expect(row('I').slice(1)).toEqual(I.map((i) => ({ kind: 'text', v: `= ${i}` })))
    // Shared: the same Ki in every column.
    const ki = row('Ki').slice(1).map(v)
    expect(new Set(ki).size).toBe(1)
    expect(ki[0]).toBeGreaterThan(1)
    expect(ki[0]).toBeLessThan(3)
  })
  it('needs numeric titles', () => {
    const t = xyReplicatesTable(S, ys, ['Control', '2', '5', '10'])
    const r = runNl(t, { equation: 'competitive-inhibition' })
    expect(r.status).toBe('error')
    expect(r.diagnostics.at(-1)!.message).toMatch(/“Control”/)
  })
})

describe('robust regression and ROUT', () => {
  const e = noise(17, 2)
  const y1 = DOSE.map((x) => logistic(x) + e())
  const y2 = DOSE.map((x) => logistic(x) + e())
  y1[3] = y1[3]! + 45
  const t = xyReplicatesTable(DOSE, [[y1, y2]])

  it('eliminates an outlier and refits the rest', () => {
    const r = runNl(t, { outliers: 'eliminate' })
    const fit = tableRows(r, 'results', 'Fit')
    expect(v(fit.find((x) => (x[0] as { v: string }).v === 'Number of outliers removed')![1])).toBe(
      1,
    )
    expect(v(fit.find((x) => (x[0] as { v: string }).v === 'Number of points analyzed')![1])).toBe(
      21,
    )
    const out = tableRows(r, 'outliers', 'Outliers (ROUT, Q = 1%)')
    expect(out).toHaveLength(1)
    expect(v(out[0]![2])).toBe(DOSE[3])
    expect(r.values[`outliers:${t.dataSets[0]!.id}`]).toEqual({ kind: 'integer', v: 1 })
  })

  it('identify: counts outliers but fits every point', () => {
    const r = runNl(t, { outliers: 'identify' })
    const fit = tableRows(r, 'results', 'Fit')
    expect(v(fit.find((x) => (x[0] as { v: string }).v === 'Number of outliers')![1])).toBe(1)
    expect(v(fit.find((x) => (x[0] as { v: string }).v === 'Number of points analyzed')![1])).toBe(
      22,
    )
  })

  it('robust regression reports best-fit values and RSDR only', () => {
    const r = runNl(t, { fitMethod: 'robust', interpolate: true })
    expect(() => tableRows(r, 'results', 'Std. Error')).toThrow()
    const g = tableRows(r, 'results', 'Goodness of Fit')
    expect((g[0]![0] as { v: string }).v).toMatch(/RSDR/)
    const top = v(tableRows(r, 'results', 'Best-fit values')[1]![1])
    expect(Math.abs(top - 98)).toBeLessThan(3) // not pulled up by the outlier
  })
})

describe('fit diagnostics', () => {
  const e = noise(19, 2)
  const t = xyReplicatesTable(DOSE, [
    [DOSE.map((x) => logistic(x) + e()), DOSE.map((x) => logistic(x) + e())],
  ])
  const single = xyReplicatesTable(DOSE, [[DOSE.map((x) => logistic(x) + e())]])

  it('runs, replicates and normality tests, Hougaard, correlation and residual outputs', () => {
    const p = {
      diagnostics: { residuals: true, runsTest: true, replicatesTest: true, normality: true },
      hougaard: true,
      covariance: true,
    }
    const r = runNl(t, p)
    expect(r.status).toBe('ok')
    const rep = tableRows(r, 'diagnostics', 'Replicates test for lack of fit')
    expect(v(rep[0]![1])).toBeGreaterThan(0)
    // Replicates: no runs test.
    expect(tableRows(r, 'diagnostics', 'Runs test')[2]![1]).toEqual({ kind: 'text', v: '—' })
    expect(tableRows(r, 'diagnostics', 'Shapiro-Wilk normality test').length).toBeGreaterThan(0)
    const corr = tableRows(
      r,
      'diagnostics',
      `Correlation matrix of the parameters (${t.dataSets[0]!.title})`,
    )
    expect(corr).toHaveLength(4)
    expect(v(corr[0]![1])).toBe(1)
    expect(tableRows(r, 'results', 'Hougaard’s skewness')).toHaveLength(4)
    const key = `residuals:${t.dataSets[0]!.id}`
    expect(r.outputs[key]!.y).toHaveLength(22)
    const decl = nonlinearFitDef.outputs!([t.dataSets[0]!.id], nonlinearFitDef.params.parse(p))
    expect(decl.find((o) => o.key === key)!.graph!.id).toBe('residuals')

    const s = runNl(single, p)
    const runs = tableRows(s, 'diagnostics', 'Runs test')
    expect(v(runs[0]![1]) + v(runs[1]![1])).toBe(DOSE.length)
    expect(
      () => tableRows(s, 'diagnostics', 'Replicates test for lack of fit')[0]![1],
    ).not.toThrow()
  })

  it('linear regression offers the runs test and residuals', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const y = x.map((v) => v * v) // curved: few runs
    const r = runLin(xyReplicatesTable(x, [[y]]), {
      diagnostics: { runsTest: true, residuals: true },
    })
    const runs = tableRows(r, 'diagnostics', 'Runs test')
    expect(v(runs[2]![1])).toBe(3)
    expect((runs[4]![1] as { v: string }).v).toBe('Significant')
  })
})

// The user-equation parser used by the analysis is the one in @ps/stats.
it('parseEquation is re-exported unchanged', () => {
  expect(statsParse('Y = A*X').ok).toBe(true)
})
