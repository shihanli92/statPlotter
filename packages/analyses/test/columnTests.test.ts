import { createTable, type DataTable, normalizeTable, type ResultValue } from '@ps/model'
import {
  dagostinoPearson,
  friedmanTest,
  kolmogorovSmirnovTwoSample,
  pearsonCorrelation,
  shapiroWilk,
  spearmanCorrelation,
  tTestOneSample,
  wilcoxonSignedRankOneSample,
} from '@ps/stats'
import { describe, expect, it } from 'vitest'
import {
  correlationDef,
  friedmanDef,
  kolmogorovSmirnovDef,
  normalityDef,
  oneSampleDef,
} from '../src/index.ts'
import { columnTable, kvOf, rowOf, runDef, v } from './helpers.ts'

const kind = (x: ResultValue | undefined) => x?.kind

const X = [4.2, 5.1, 3.9, 4.8, 5.5, 4.4, 6.3, 4.9, 5.2, 4.1, 5.8, 4.6]
const Y = [6.1, 5.8, 7.2, 6.6, 5.9, 6.4, 7.9, 6.2, 6.9, 5.7, 7.4, 6.0]
const Z = [5.0, 4.6, 5.9, 5.3, 4.9, 5.6, 6.1, 5.2, 5.4, 4.8, 6.0, 5.1]

describe('normality plugin', () => {
  const run = (t: DataTable, p: object = {}) => runDef(normalityDef, t, p)

  it('runs every test on every column', () => {
    const r = run(columnTable([X, Y]))
    expect(r.status).toBe('ok')
    const p = rowOf(r, 'P value', 'D’Agostino-Pearson omnibus normality test')
    expect(v(p[0])).toBe(dagostinoPearson(Float64Array.from(X)).p)
    expect(v(rowOf(r, 'W', 'Shapiro-Wilk normality test')[1])).toBe(
      shapiroWilk(Float64Array.from(Y)).stat,
    )
  })

  it('marks columns too small for a test', () => {
    const r = run(columnTable([X.slice(0, 5)]))
    expect(kind(rowOf(r, 'K2', 'D’Agostino-Pearson omnibus normality test')[0])).toBe('text')
    expect(kind(rowOf(r, 'W', 'Shapiro-Wilk normality test')[0])).toBe('number')
  })

  it('lognormality tests the logs, and warns about non-positive values', () => {
    const r = run(columnTable([X]), { distribution: 'lognormal', dagostino: false })
    expect(v(rowOf(r, 'W', 'Shapiro-Wilk normality test (lognormal)')[0])).toBe(
      shapiroWilk(Float64Array.from(X, Math.log)).stat,
    )
    const bad = run(columnTable([[...X, -1]]), { distribution: 'both' })
    expect(bad.status).toBe('warning')
  })
})

describe('one-sample plugin', () => {
  const run = (t: DataTable, p: object = {}) => runDef(oneSampleDef, t, p)

  it('t test against a hypothetical mean', () => {
    const r = run(columnTable([X]), { hypothetical: 4.5 })
    const ref = tTestOneSample(Float64Array.from(X), 4.5)
    expect(v(rowOf(r, 'P value', 'One sample t test')[0])).toBe(ref.p)
    const mean = X.reduce((s, x) => s + x, 0) / X.length
    expect(
      v(rowOf(r, 'Discrepancy (actual − theoretical)', 'How big is the discrepancy?')[0]),
    ).toBeCloseTo(mean - 4.5, 12)
  })

  it('Wilcoxon signed-rank test against a hypothetical median', () => {
    const r = run(columnTable([X, Y]), { test: 'wilcoxon', hypothetical: 5 })
    const ref = wilcoxonSignedRankOneSample(Float64Array.from(Y), 5)
    expect(v(rowOf(r, 'P value', 'Wilcoxon signed-rank test')[1])).toBe(ref.p)
  })
})

describe('correlation plugin', () => {
  const run = (t: DataTable, p: object = {}) => runDef(correlationDef, t, p)

  it('every pair of columns, matched by row', () => {
    const r = run(columnTable([X, Y, Z]))
    const b = r.sheets[0]!.blocks[0]!
    if (b.type !== 'table') throw new Error('table expected')
    expect(b.rows).toHaveLength(3)
    expect(v(b.rows[0]![1])).toBe(pearsonCorrelation(Float64Array.from(X), Float64Array.from(Y)).r)
  })

  it('Spearman; rows with a missing value are dropped', () => {
    const r = run(
      columnTable([
        [...X, 1],
        [...Y, null],
      ]),
      { method: 'spearman' },
    )
    expect(v(r.values.r)).toBe(spearmanCorrelation(Float64Array.from(X), Float64Array.from(Y)).r)
  })

  it('XY tables correlate X with each data set', () => {
    const t = createTable({ tableKind: 'xy', columns: 1, rows: X.length })
    t.x!.subcolumns[0]!.values = [...X]
    t.dataSets[0]!.subcolumns[0]!.values = [...Y]
    const r = run(t)
    expect(v(r.values.r)).toBe(pearsonCorrelation(Float64Array.from(X), Float64Array.from(Y)).r)
  })
})

describe('Friedman and Kolmogorov-Smirnov plugins', () => {
  it('Friedman uses complete rows and reports Dunn’s comparisons', () => {
    const t = columnTable([
      [...X, 1],
      [...Y, null],
      [...Z, 2],
    ])
    const r = runDef(friedmanDef, t)
    const ref = friedmanTest(X.map((x, i) => [x, Y[i]!, Z[i]!]))
    expect(v(kvOf(r, 'Friedman statistic', 'Friedman test'))).toBe(ref.stat)
    expect(r.diagnostics.some((d) => /1 row/.test(d.message))).toBe(true)
    expect(r.comparisons).toHaveLength(3)
  })

  it('Kolmogorov-Smirnov compares two columns', () => {
    const r = kolmogorovSmirnovDef.run(normalizeTable(columnTable([X, Y])), {})
    expect(v(r.values.p)).toBe(
      kolmogorovSmirnovTwoSample(Float64Array.from(X), Float64Array.from(Y)).p,
    )
    expect(r.comparisons).toHaveLength(1)
  })
})
