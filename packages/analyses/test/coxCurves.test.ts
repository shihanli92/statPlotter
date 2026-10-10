import { normalizeTable } from '@ps/model'
import { coxBaseline, coxRegression, coxSurvivalAt } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { coxRegressionDef } from '../src/index.ts'
import { mvTable, runDef, tableBlock } from './helpers.ts'

const time = [5, 8, 12, 3, 15, 20, 7, 9, 30, 11, 14, 2, 25, 18, 6]
const event = [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1]
const age = [60, 55, 40, 70, 45, 35, 65, 50, 30, 58, 48, 72, 38, 44, 66]
const trt = [0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0]

describe('Cox regression: estimated survival curves', () => {
  it('draws S0(t)^exp(xβ) as steps for each chosen set of values', () => {
    const t = mvTable({ Time: time, Event: event, Age: age, Treated: trt })
    const [, , kAge, kTrt] = t.dataSets.map((d) => d.id)
    const params = coxRegressionDef.params.parse({
      survivalCurves: [{ [kAge!]: 50, [kTrt!]: 1 }, { [kAge!]: 50 }],
      baseline: true,
    })
    const decl = coxRegressionDef.outputs!(
      t.dataSets.map((d) => d.id),
      params,
    )
    expect(decl.map((d) => d.key)).toEqual(['survival:0', 'survival:1', 'survival:baseline'])
    const r = coxRegressionDef.run(normalizeTable(t), params)
    expect(r.status).toBe('ok')
    const ev = event.map((e) => e === 1)
    const X = age.map((a, i) => [a, trt[i]!])
    const fit = coxRegression(time, ev, X, ['Age', 'Treated'])
    const beta = fit.coefficients.map((c) => c.estimate)
    const base = coxBaseline(time, ev, X, beta)
    const s = coxSurvivalAt(base, beta, [50, 1])
    const c0 = r.outputs['survival:0']!
    expect(c0.title).toBe('Age = 50, Treated = 1')
    expect(c0.x.slice(0, 3)).toEqual([0, base.time[0], base.time[0]])
    expect(c0.y.slice(0, 3)).toEqual([1, 1, s[0]])
    expect(c0.x.at(-1)).toBe(30)
    expect(r.outputs['survival:1']!.title).toBe('Age = 50')
    const b = tableBlock(r, 'baseline')
    expect(b.rows).toHaveLength(base.time.length)
  })

  it('adds nothing when no curve is asked for', () => {
    const t = mvTable({ Time: time, Event: event, Age: age })
    const r = runDef(coxRegressionDef, t)
    expect(r.outputs).toEqual({})
    expect(r.sheets.map((s) => s.key)).toEqual(['results'])
  })
})
