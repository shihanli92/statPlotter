import { type AnalysisResult, normalizeTable } from '@ps/model'
import {
  blandAltman,
  coxRegression,
  logisticRegression,
  multipleLinearRegression,
  pca,
  rocCurve,
} from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { minstd } from '../../stats/test/rng.ts'
import {
  blandAltmanDef,
  coxRegressionDef,
  logisticRegressionDef,
  multipleRegressionDef,
  pcaDef,
  rocDef,
} from '../src/index.ts'
import { columnTable, mvTable, runDef, v } from './helpers.ts'

function firstTable(r: AnalysisResult) {
  const b = r.sheets[0]!.blocks[0]!
  if (b.type !== 'table') throw new Error('table expected')
  return b
}

// Deterministic example data.
const n = 30
const u = minstd(5)
const age = Array.from({ length: n }, () => Math.round(40 + 30 * u()))
const bmi = Array.from({ length: n }, () => Math.round(200 + 100 * u()) / 10)
const sbp = age.map((a, i) => 60 + 0.7 * a + 1.1 * bmi[i]! + 10 * (u() - 0.5))
const resp = age.map((a) => (u() < 1 / (1 + Math.exp(-(-5 + 0.09 * a))) ? 1 : 0))
const days = age.map((a) => Math.round(-Math.log(1 - u()) / (0.01 * Math.exp(0.05 * (a - 55)))))
const died = days.map((_, i) => (i % 5 === 0 ? 0 : 1))

describe('multiple-variable plugins', () => {
  it('accept multiple-variables tables', () => {
    for (const d of [multipleRegressionDef, logisticRegressionDef, coxRegressionDef, pcaDef]) {
      expect(d.accepts).toEqual(['multipleVariables'])
    }
  })

  it('multiple linear regression: chosen Y, other variables as predictors, complete cases', () => {
    const t = mvTable({ Age: [...age, 50], SBP: [...sbp, null], BMI: [...bmi, 25] })
    const input = normalizeTable(t)
    const r = multipleRegressionDef.run(
      input,
      multipleRegressionDef.params.parse({ y: t.dataSets[1]!.id }),
    )
    const ref = multipleLinearRegression(
      sbp,
      age.map((a, i) => [a, bmi[i]!]),
      ['Age', 'BMI'],
    )
    expect(v(r.values.rSquared)).toBe(ref.rSquared)
    expect(firstTable(r).rows.map((row) => (row[0] as { v: string }).v)).toEqual(
      ref.coefficients.map((c) => c.name),
    )
    expect(r.diagnostics.some((d) => /1 row/.test(d.message))).toBe(true)
    expect(r.outputs.actualVsPredicted!.x).toEqual(ref.fitted)
  })

  it('logistic regression: odds ratios, 0/1 check, curve for one predictor', () => {
    const t = mvTable({ Responder: resp, Age: age })
    const r = runDef(logisticRegressionDef, t)
    const ref = logisticRegression(
      resp,
      age.map((a) => [a]),
      ['Age'],
    )
    expect(v(r.values.auc)).toBe(ref.auc.value)
    expect(r.outputs.curve!.y.every((p) => p > 0 && p < 1)).toBe(true)
    expect(
      logisticRegressionDef.outputs!(['a', 'b'], logisticRegressionDef.params.parse({})),
    ).toHaveLength(2)
    const bad = mvTable({ Responder: [...resp.slice(0, -1), 2], Age: age })
    expect(runDef(logisticRegressionDef, bad).status).toBe('error')
  })

  it('Cox regression: time and event pickers, the rest are predictors', () => {
    const t = mvTable({ Days: days, Died: died, Age: age, BMI: bmi })
    const r = runDef(coxRegressionDef, t)
    const ref = coxRegression(
      days,
      died.map((d) => d === 1),
      age.map((a, i) => [a, bmi[i]!]),
      ['Age', 'BMI'],
    )
    expect(v(r.values.p)).toBe(ref.lrTest.p)
    const same = runDef(coxRegressionDef, t, { time: t.dataSets[0]!.id, event: t.dataSets[0]!.id })
    expect(same.status).toBe('error')
  })

  it('PCA: eigenvalues table, retained components, scree and score outputs', () => {
    const t = mvTable({ Age: age, BMI: bmi, SBP: sbp })
    const params = pcaDef.params.parse({ select: 'kaiser' })
    const r = pcaDef.run(normalizeTable(t), params)
    const ref = pca(
      age.map((a, i) => [a, bmi[i]!, sbp[i]!]),
      { standardize: true, select: { method: 'kaiser' } },
    )
    expect(v(r.values.selected)).toBe(ref.selected)
    expect(r.outputs.scree!.y).toEqual(ref.eigenvalues)
    expect(pcaDef.outputs!([], params).map((o) => o.key)).toEqual(['scree', 'scores'])
  })

  it('PCA grouped: the score table has every variable its graph maps; one variable is refused', () => {
    const group = age.map((_, i) => (i % 2 ? 'a' : 'b'))
    const withGroup = (cols: Record<string, number[]>) => {
      const t = mvTable(cols)
      const g = t.dataSets[t.dataSets.length - 1]!
      g.title = 'Group'
      g.text = group
      return t
    }
    const t = withGroup({ Age: age, BMI: bmi, Group: [] })
    const key = (title: string) => t.dataSets.find((d) => d.title === title)!.id
    const params = { groupBy: key('Group'), select: 'kaiser' }
    const r = runDef(pcaDef, t, params)
    expect(r.status).not.toBe('error')
    const ids = r.table!.dataSets.map((d) => d.id)
    const g = pcaDef.outputs!([], pcaDef.params.parse(params)).find((o) => o.key === 'scores')!
    const vars = g.graph!.variables!
    for (const k of [vars.x, vars.y, vars.color!]) expect(ids).toContain(k)
    // One variable: PC1 only, so no PC2 for the grouped plot's Y: refused, with the reason.
    const one = withGroup({ Age: age, Group: [] })
    const r1 = runDef(pcaDef, one, {
      groupBy: one.dataSets.find((d) => d.title === 'Group')!.id,
      select: 'kaiser',
    })
    expect(r1.status).toBe('error')
    expect(r1.diagnostics.map((d) => d.message).join(' ')).toMatch(/two number variables.*PC2/)
    expect(r1.table).toBeUndefined()
  })
})

describe('column-table method comparisons', () => {
  const controls = [1.2, 2.3, 2.1, 3.4, 1.8, 2.9, 2.2, 1.5]
  const patients = [3.1, 4.2, 2.8, 5.0, 3.9, 2.4, 4.4, 3.6]

  it('ROC curve from controls vs patients, with its own graph', () => {
    // Roadmap 51c (S39): the direction is stated; none refuses, `auto` (saved) warns.
    const r = runDef(rocDef, columnTable([controls, patients]), { direction: 'higher' })
    const ref = rocCurve(controls, patients, { direction: 'higher' })
    expect(runDef(rocDef, columnTable([controls, patients])).status).toBe('error')
    const auto = runDef(rocDef, columnTable([controls, patients]), { direction: 'auto' })
    expect(auto.status).toBe('warning')
    expect(v(auto.values.auc)).toBe(rocCurve(controls, patients).auc)
    expect(v(r.values.auc)).toBe(ref.auc)
    const roc = r.outputs.roc!
    expect([roc.x[0], roc.y[0], roc.x.at(-1), roc.y.at(-1)]).toEqual([0, 0, 100, 100])
    expect(rocDef.outputs!([], rocDef.params.parse({}))[0]!.graph?.square).toBe(true)
  })

  it('Bland-Altman pairs rows and draws bias and limit lines', () => {
    const r = runDef(blandAltmanDef, columnTable([controls, patients]))
    const ref = blandAltman(controls, patients)
    expect(v(r.values.bias)).toBe(ref.bias)
    expect(r.outputs.upper!.y).toEqual([ref.upper, ref.upper])
    expect(r.outputs.pairs!.x).toEqual(ref.x)
  })
})
