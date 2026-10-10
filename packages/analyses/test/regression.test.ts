import type { AnalysisResult, DataTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { noise } from '../../stats/test/rng.ts'
import { EQUATIONS, equation, linearRegressionDef, nonlinearFitDef } from '../src/index.ts'
import { find, runDef, xyReplicatesTable } from './helpers.ts'

/** The number in row `row` (column `col` of a table) of the block titled `block`. */
const v = (r: AnalysisResult, block: string, row: string, col = 0) =>
  (find(r, row, block)[col] as { v: number }).v

describe('linear regression', () => {
  const xs = [0, 1, 2, 3, 4, 5]
  const run = (t: DataTable, p: object = {}) => runDef(linearRegressionDef, t, p)

  it('recovers an exact line and emits a line output per data set', () => {
    const t = xyReplicatesTable(xs, [[xs.map((x) => 2 * x + 1)]])
    const r = run(t)
    expect(v(r, 'Best-fit values', 'Slope')).toBeCloseTo(2, 12)
    expect(v(r, 'Best-fit values', 'Y-intercept')).toBeCloseTo(1, 12)
    expect(v(r, 'Goodness of Fit', 'R squared')).toBeCloseTo(1, 12)
    const key = `line:${t.dataSets[0]!.id}`
    expect(r.outputs[key]!.x).toEqual([0, 5])
    expect(
      linearRegressionDef.outputs!([t.dataSets[0]!.id], linearRegressionDef.params.parse({})),
    ).toEqual([{ key, forDataSet: t.dataSets[0]!.id }])
  })

  it('treats replicates as separate points and bands add lo/hi', () => {
    const e = noise(3, 0.3)
    const t = xyReplicatesTable(xs, [
      [xs.map((x) => x + e()), xs.map((x) => x + e()), xs.map(() => null)],
    ])
    const r = run(t, { band: 'confidence' })
    expect(v(r, 'Data', 'Number of points analyzed')).toBe(12)
    const out = r.outputs[`line:${t.dataSets[0]!.id}`]!
    expect(out.lo).toHaveLength(out.x.length)
    expect(out.lo!.every((lo, i) => lo <= out.y[i]! && out.y[i]! <= out.hi![i]!)).toBe(true)
  })

  it('compares slopes of two data sets and hides intercepts through the origin', () => {
    const e = noise(5, 0.2)
    const t = xyReplicatesTable(xs, [[xs.map((x) => x + e())], [xs.map((x) => 3 * x + e())]])
    const r = run(t)
    expect(r.sheets.map((s) => s.key)).toEqual(['results', 'compare'])
    expect(v(r, 'Are the slopes equal?', 'P value')).toBeLessThan(1e-6)
    const origin = run(t, { throughOrigin: true })
    expect(() => find(origin, 'Y-intercept', 'Best-fit values')[0]!).toThrow()
  })

  it('warns about data sets with too few points', () => {
    const t = xyReplicatesTable([0, 1], [[[1, 2]]])
    expect(run(t).status).toBe('error')
  })
})

describe('nonlinear regression', () => {
  const xs = Array.from({ length: 11 }, (_, i) => -9 + i * 0.5)
  const fourPL = (x: number, bottom: number, top: number, logEC50: number, hill: number) =>
    bottom + (top - bottom) / (1 + 10 ** ((logEC50 - x) * hill))

  function doseResponse(sets: { logEC50: number; hill: number }[], seed = 11) {
    const e = noise(seed, 3)
    return xyReplicatesTable(
      xs,
      sets.map((s) =>
        [0, 1, 2].map(() => xs.map((x) => fourPL(x, 5, 100, s.logEC50, s.hill) + e())),
      ),
    )
  }
  const run = (t: DataTable, p: object = {}) => runDef(nonlinearFitDef, t, p)

  it('defaults to the 4-parameter log(agonist) model with every parameter fitted', () => {
    const eq = equation(nonlinearFitDef.params.parse({}).equation)!
    expect(eq.params).toHaveLength(4)
    expect(eq.category).toBe('Dose-response — Stimulation')
    expect(EQUATIONS.length).toBeGreaterThan(15)
  })

  it('recovers parameters from automatic initial values and outputs a curve', () => {
    const t = doseResponse([{ logEC50: -6.5, hill: 1 }])
    const r = run(t, { band: 'confidence' })
    expect(r.status).toBe('ok')
    const eq = equation(nonlinearFitDef.params.parse({}).equation)!
    const logEC50Name = eq.params.find((p) => /logec50/i.test(p))!
    expect(v(r, 'Best-fit values', logEC50Name)).toBeCloseTo(-6.5, 1)
    expect(find(r, 'Status', 'Fit')[0]!).toEqual({ kind: 'text', v: 'Converged' })
    const curve = r.outputs[`curve:${t.dataSets[0]!.id}`]!
    expect(curve.x).toHaveLength(200)
    expect(curve.lo).toHaveLength(200)
  })

  it('holds constants fixed and reports them', () => {
    const t = doseResponse([{ logEC50: -6.5, hill: 1 }])
    const eq = equation(nonlinearFitDef.params.parse({}).equation)!
    const hill = eq.params.find((p) => /hill/i.test(p))!
    const r = run(t, { constraints: { [hill]: { kind: 'constant', value: 1 } } })
    expect(find(r, hill, 'Best-fit values')[0]!).toEqual({ kind: 'text', v: '= 1' })
    expect(() => find(r, hill, 'Std. Error')[0]!).toThrow()
    expect(find(r, hill, 'Constraints')[0]!).toEqual({ kind: 'text', v: 'Constant equal to 1' })
  })

  it('shares a parameter across data sets (global fit)', () => {
    const t = doseResponse([
      { logEC50: -7, hill: 1 },
      { logEC50: -6, hill: 1 },
    ])
    const eq = equation(nonlinearFitDef.params.parse({}).equation)!
    const hill = eq.params.find((p) => /hill/i.test(p))!
    const r = run(t, { constraints: { [hill]: { kind: 'shared' } } })
    expect(v(r, 'Best-fit values', hill, 0)).toBe(v(r, 'Best-fit values', hill, 1))
    expect(v(r, 'Global (shared) fit', 'Number of points analyzed')).toBe(66)
  })

  it('compares against another model', () => {
    const t = doseResponse([{ logEC50: -6.5, hill: 1 }])
    const three = EQUATIONS.find(
      (e) => e.category === 'Dose-response — Stimulation' && e.params.length === 3,
    )!
    const r = run(t, { compareWith: three.id })
    expect(r.sheets.map((s) => s.key)).toContain('compare')
  })

  it('rejects unknown models and too-small data sets', () => {
    const t = doseResponse([{ logEC50: -6.5, hill: 1 }])
    expect(run(t, { equation: 'nope' }).status).toBe('error')
    expect(run(xyReplicatesTable([1, 2, 3], [[[1, 2, 3]]])).status).toBe('error')
  })
})
