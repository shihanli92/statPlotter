import { createTable } from '@ps/model'
import {
  demingRegression,
  linearRegression,
  logisticRegression,
  poissonRegression,
} from '@ps/stats'
import { describe, expect, it } from 'vitest'
import {
  demingDef,
  linearRegressionDef,
  poissonRegressionDef,
  registry,
  simpleLogisticDef,
} from '../src/index.ts'
import { mvTable, rowOf, runDef, tableBlock, v, xyTable } from './helpers.ts'

const X = [1.2, 2.5, 3.1, 4.8, 5.0, 6.7, 7.2, 8.9, 9.4, 10.8]
const Y = [1.9, 2.6, 3.9, 4.6, 5.8, 6.9, 7.4, 9.6, 9.9, 11.9]

describe('Deming regression (XY)', () => {
  it('fits each data set with λ from the entered SDs', () => {
    const t = xyTable(X, [Y, Y.map((y) => 2 * y)], ['A', 'B'])
    const r = runDef(demingDef, t, { errors: 'sd', sdX: 0.5, sdY: 1, xForY: 5 })
    const ref = demingRegression(X, Y, { lambda: 0.25, xForY: 5 })
    expect(v(rowOf(r, 'Slope', /Best-fit/)[0]!)).toBe(ref.slope)
    expect(v(rowOf(r, 'Y', /Y when X = 5/)[0]!)).toBe(ref.yAtX.y)
    expect(v(rowOf(r, 'Std. Error', /Y when X = 5/)[0]!)).toBe(ref.yAtX.se)
    expect(r.outputs[`line:${t.dataSets[1]!.id}`]!.y).toHaveLength(2)
    expect(demingDef.outputs!([t.dataSets[0]!.id], demingDef.params.parse({}))).toEqual([
      { key: `line:${t.dataSets[0]!.id}`, forDataSet: t.dataSets[0]!.id },
    ])
  })

  it('skips data sets without enough points', () => {
    const t = xyTable(X, [Y, [1, 2, null, null, null, null, null, null, null, null]])
    const r = runDef(demingDef, t)
    expect(r.status).toBe('warning')
    expect(Object.keys(r.outputs)).toHaveLength(1)
  })
})

describe('simple logistic regression (XY)', () => {
  const hours = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 4, 4.25]
  const pass = [0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1]
  it('reports β, X at 50% and the curve, as multiple logistic regression with one X', () => {
    const t = xyTable([...hours, 5.7], [[...pass, null]])
    const r = runDef(simpleLogisticDef, t)
    const ref = logisticRegression(
      pass,
      hours.map((h) => [h]),
      ['X'],
    )
    const [b0, b1] = ref.coefficients.map((c) => c.estimate) as [number, number]
    expect(v(rowOf(r, 'β1', /Best-fit/)[0]!)).toBe(b1)
    expect(v(rowOf(r, 'X at 50%', /Best-fit/)[0]!)).toBe(-b0 / b1)
    expect(v(rowOf(r, 'P value', /Likelihood ratio/)[0]!)).toBe(ref.lrP)
    const curve = r.outputs[`curve:${t.dataSets[0]!.id}`]!
    expect(curve.x[0]).toBe(0.5)
    expect(curve.x.at(-1)).toBe(4.25)
    // Row prediction includes the X-only row (Prism predicts it).
    const rows = tableBlock(r, 'rows')
    expect(rows.rows).toHaveLength(17)
    expect(v(rows.rows[16]![3])).toBeCloseTo(1 / (1 + Math.exp(-(b0 + b1 * 5.7))), 14)
    expect(r.outputs[`roc:${t.dataSets[0]!.id}`]!.x[0]).toBe(0)
  })

  it('refuses Y values other than 0 and 1', () => {
    const r = runDef(simpleLogisticDef, xyTable([1, 2, 3], [[0, 2, 1]]))
    expect(r.status).toBe('error')
  })

  it('is offered for XY tables', () => {
    const ids = registry
      .list()
      .filter((d) => d.accepts.includes('xy'))
      .map((d) => d.id)
    expect(ids).toEqual(expect.arrayContaining(['deming', 'simpleLogistic']))
  })
})

describe('Poisson regression (multiple variables)', () => {
  const dose = [0, 0, 1, 1, 2, 2, 3, 3, 0, 1, 2, 3]
  const age = [30, 45, 50, 38, 60, 41, 55, 33, 62, 47, 36, 58]
  const count = [1, 2, 2, 1, 4, 3, 7, 5, 3, 2, 3, 9]
  it('matches the stats fit and names the rate ratios', () => {
    const t = mvTable({ Count: count, Dose: dose, Age: age })
    const r = runDef(poissonRegressionDef, t)
    const ref = poissonRegression(
      count,
      dose.map((d, i) => [d, age[i]!]),
      ['Dose', 'Age'],
    )
    const b = tableBlock(r, 'results')
    expect(b.rows.map((row) => (row[0] as { v: string }).v)).toEqual(['Intercept', 'Dose', 'Age'])
    expect(v(b.rows[1]![1])).toBe(ref.coefficients[1]!.estimate)
    expect(v(b.rows[1]![7])).toBe(ref.coefficients[1]!.rateRatio)
    expect(r.outputs.actualVsPredicted!.x).toEqual(ref.fitted)
  })

  it('refuses outcomes that are not counts', () => {
    const r = runDef(poissonRegressionDef, mvTable({ Y: [1.5, 2, 3, 4], X: [1, 2, 3, 4] }))
    expect(r.status).toBe('error')
  })
})

describe('linear regression additions', () => {
  it('forces the line through a point and reports no R²', () => {
    const t = xyTable(X, [Y])
    const r = runDef(linearRegressionDef, t, { throughPoint: true, pointX: 4, pointY: 5 })
    const ref = linearRegression(X, Y, { throughPoint: { x: 4, y: 5 } })
    expect(v(rowOf(r, 'Slope', /Best-fit/)[0]!)).toBe(ref.slope)
    expect(v(rowOf(r, 'Y-intercept', /Best-fit/)[0]!)).toBe(5 - 4 * ref.slope)
    expect(() => rowOf(r, 'R squared', /Goodness/)[0]!).toThrow()
    const line = r.outputs[`line:${t.dataSets[0]!.id}`]!
    const i = line.x.indexOf(Math.min(...X))
    expect(line.y[i]).toBeCloseTo(5 + ref.slope * (line.x[i]! - 4), 12)
  })

  it('fits the mean Y of each row when asked', () => {
    const t = createTable({
      tableKind: 'xy',
      columns: 1,
      rows: 4,
      yFormat: { type: 'replicates', count: 2 },
    })
    t.x!.subcolumns[0]!.values = [1, 2, 3, 4]
    t.dataSets[0]!.subcolumns[0]!.values = [1, 2.5, 2.9, 4.4]
    t.dataSets[0]!.subcolumns[1]!.values = [1.4, null, 3.3, 3.8]
    const each = runDef(linearRegressionDef, t)
    const mean = runDef(linearRegressionDef, t, { replicates: 'mean' })
    const ref = linearRegression([1, 2, 3, 4], [1.2, 2.5, 3.1, 4.1])
    expect(v(rowOf(mean, 'Slope', /Best-fit/)[0]!)).toBeCloseTo(ref.slope, 14)
    expect(v(rowOf(mean, 'Number of points analyzed', /^Data$/)[0]!)).toBe(4)
    expect(v(rowOf(each, 'Number of points analyzed', /^Data$/)[0]!)).toBe(7)
  })

  it('gives the intersection of two lines whose slopes differ', () => {
    const t = xyTable(X, [Y, X.map((x, i) => 20 - 1.5 * x + (i % 2 ? 0.2 : -0.2))])
    const r = runDef(linearRegressionDef, t)
    const a = linearRegression(X, Y)
    const b = linearRegression(
      X,
      X.map((x, i) => 20 - 1.5 * x + (i % 2 ? 0.2 : -0.2)),
    )
    const xc = (b.intercept - a.intercept) / (a.slope - b.slope)
    const block = r.sheets
      .find((s) => s.key === 'compare')!
      .blocks.find((x) => x.type === 'keyValue' && x.title === 'Intersection of the two lines')
    expect(block).toBeDefined()
    if (block?.type === 'keyValue') expect(v(block.rows[0]!.value)).toBeCloseTo(xc, 12)
  })
})
