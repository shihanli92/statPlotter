import { createTable, type DataTable } from '@ps/model'
import { compareFits, equation, hougaardSkewness, nonlinearFit, weightingTest } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { nonlinearFitDef } from '../src/index.ts'
import { kvOf, rowOf, runDef, tableBlock, v, xyTable } from './helpers.ts'

const run = (t: DataTable, p: Record<string, unknown>) => runDef(nonlinearFitDef, t, p)

const X = [0.5, 1, 2, 3, 5, 8, 12, 20, 30, 50]
const mm = (x: number, vmax: number, km: number) => (vmax * x) / (km + x)
const noise = [0.03, -0.05, 0.02, 0.04, -0.03, 0.01, -0.02, 0.05, -0.04, 0.02]
const Y1 = X.map((x, i) => mm(x, 100, 5) * (1 + noise[i]!))
const Y2 = X.map((x, i) => mm(x, 80, 9) * (1 - noise[i]!))

describe('nonlinear regression: weighting choices', () => {
  const t = xyTable(X, [Y1])
  const model = equation('michaelis-menten')!
  const data = [{ x: X, y: Y1 }]

  it('weights by 1/X as fixed point weights', () => {
    const r = run(t, { equation: 'michaelis-menten', weighting: 'x', hougaard: true })
    const ref = nonlinearFit(model, data, { pointWeights: [X.map((x) => 1 / x)] })
    expect(v(rowOf(r, 'Vmax', /Best-fit/)[0]!)).toBeCloseTo(ref.params[0]![0]!.value, 8)
    // Hougaard is now computed for weighted fits too.
    const g = hougaardSkewness(model, ref, data, [X.map((x) => 1 / x)])
    expect(v(rowOf(r, 'Km', /Hougaard/)[0]!)).toBeCloseTo(g[0]![1]!, 6)
  })

  it('weights by 1/Y^K', () => {
    const r = run(t, { equation: 'michaelis-menten', weighting: 'power', weightPower: 1.5 })
    const ref = nonlinearFit(model, data, { weighting: 'power', weightPower: 1.5 })
    expect(v(rowOf(r, 'Km', /Best-fit/)[0]!)).toBeCloseTo(ref.params[0]![1]!.value, 8)
  })

  it('weights by 1/SD² of each row’s replicates, and refuses a zero SD', () => {
    const tr = createTable({
      tableKind: 'xy',
      columns: 1,
      rows: X.length,
      yFormat: { type: 'replicates', count: 2 },
    })
    tr.x!.subcolumns[0]!.values = X
    tr.dataSets[0]!.subcolumns[0]!.values = Y1.map((y) => y * 1.02)
    tr.dataSets[0]!.subcolumns[1]!.values = Y1.map((y) => y * 0.97)
    const r = run(tr, { equation: 'michaelis-menten', weighting: 'sd' })
    expect(r.status).toBe('ok')
    const sd = Y1.map((y) => Math.abs(y * 1.02 - y * 0.97) / Math.SQRT2)
    const xs = X.flatMap((x) => [x, x])
    const ys = Y1.flatMap((y) => [y * 1.02, y * 0.97])
    const w = sd.flatMap((s) => [1 / (s * s), 1 / (s * s)])
    const ref = nonlinearFit(model, [{ x: xs, y: ys }], { pointWeights: [w] })
    expect(v(rowOf(r, 'Vmax', /Best-fit/)[0]!)).toBeCloseTo(ref.params[0]![0]!.value, 8)
    // A fresh data set column (normalization is cached per column object).
    const col = tr.dataSets[0]!
    tr.dataSets[0] = {
      ...col,
      subcolumns: [
        col.subcolumns[0]!,
        {
          type: 'number',
          values: col.subcolumns[1]!.values.map((y, i) =>
            i === 3 ? col.subcolumns[0]!.values[3]! : y,
          ),
        },
      ],
    }
    expect(run(tr, { equation: 'michaelis-menten', weighting: 'sd' }).status).toBe('error')
  })

  it('fits the mean Y of each row when asked', () => {
    const tr = createTable({
      tableKind: 'xy',
      columns: 1,
      rows: X.length,
      yFormat: { type: 'replicates', count: 2 },
    })
    tr.x!.subcolumns[0]!.values = X
    tr.dataSets[0]!.subcolumns[0]!.values = Y1.map((y) => y + 1)
    tr.dataSets[0]!.subcolumns[1]!.values = Y1.map((y) => y - 1)
    const r = run(tr, { equation: 'michaelis-menten', replicates: 'mean' })
    const ref = nonlinearFit(model, data)
    expect(v(rowOf(r, 'Km', /Best-fit/)[0]!)).toBeCloseTo(ref.params[0]![1]!.value, 8)
    expect(v(rowOf(r, 'Number of points analyzed', /^Fit$/)[0]!)).toBe(X.length)
  })

  it('tests for appropriate weighting', () => {
    const r = run(t, { equation: 'michaelis-menten', weighting: 'relative', weightingTest: true })
    const fit = nonlinearFit(model, data, { weighting: 'relative' })
    const w = weightingTest(model, fit, data[0]!, 0)
    const b = tableBlock(r, 'diagnostics')
    expect(b.title).toBe('Test for appropriate weighting')
    expect(v(b.rows[0]![1])).toBeCloseTo(w.r, 10)
    expect(v(b.rows[0]![2])).toBeCloseTo(w.p, 10)
  })
})

describe('nonlinear regression: compare a parameter between data sets', () => {
  it('shares the parameter in the null model (F test and AICc)', () => {
    const t = xyTable(X, [Y1, Y2])
    const r = run(t, { equation: 'michaelis-menten', compareParams: ['Km'] })
    const model = equation('michaelis-menten')!
    const data = [
      { x: X, y: Y1 },
      { x: X, y: Y2 },
    ]
    const complex = nonlinearFit(model, data)
    const simpler = nonlinearFit(model, data, {
      constraints: [{ kind: 'fit' }, { kind: 'shared' }],
    })
    const c = compareFits(simpler, complex)
    expect(v(kvOf(r, 'F'))).toBeCloseTo(c.F, 8)
    expect(v(kvOf(r, 'P value'))).toBeCloseTo(c.p, 10)
    expect(v(kvOf(r, 'Km when shared'))).toBeCloseTo(simpler.params[0]![1]!.value, 8)
    expect(v(r.values.compareP)).toBeCloseTo(c.p, 10)
  })
})

describe('nonlinear regression: different equations for different data sets', () => {
  it('fits each group with its own equation', () => {
    const lin = X.map((x) => 3 + 2 * x + (x % 2 ? 0.3 : -0.3))
    const t = xyTable(X, [Y1, lin], ['Enzyme', 'Line'])
    const lineKey = t.dataSets[1]!.id
    const r = run(t, {
      equation: 'michaelis-menten',
      equationByDataSet: { [lineKey]: { equation: 'straight-line' } },
    })
    expect(r.status).toBe('ok')
    const notes = r.sheets[0]!.blocks.filter((b) => b.type === 'note').map((b) => b.text)
    expect(notes).toEqual(expect.arrayContaining(['Data sets “Enzyme”:', 'Data sets “Line”:']))
    expect(Object.keys(r.outputs).sort()).toEqual(
      [`curve:${t.dataSets[0]!.id}`, `curve:${lineKey}`].sort(),
    )
    expect(v(r.values[`Slope:${lineKey}`])).toBeCloseTo(
      nonlinearFit(equation('straight-line')!, [{ x: X, y: lin }]).params[0]![1]!.value,
      8,
    )
  })

  it('old parameter sets (no per-data-set equations) still parse', () => {
    const p = nonlinearFitDef.params.parse({ equation: 'michaelis-menten', weighting: 'relative' })
    expect(p.equationByDataSet).toEqual({})
    expect(p.compareParams).toEqual([])
    expect(p.replicates).toBe('each')
  })

  it('explains that a parameterless user equation has nothing to fit', () => {
    const r = run(xyTable(X, [Y1]), { equation: 'user', userEquation: 'Y = 2*X' })
    expect(r.status).toBe('error')
    expect(r.diagnostics.at(-1)!.message).toMatch(/no parameters to fit/)
  })
})
