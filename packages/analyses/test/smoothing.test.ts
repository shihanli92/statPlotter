import { akimaSpline, lowess, regressionSpline } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { smoothingDef } from '../src/index.ts'
import { LOWESS_SPAN } from '../src/smoothing.ts'
import { runDef, xyTable } from './helpers.ts'

const X = Array.from({ length: 30 }, (_, i) => i * 0.5)
const Y = X.map((x, i) => 3 + Math.sin(x) * 4 + (i % 3) * 0.3)
const run = (p: Record<string, unknown>, t = xyTable(X, [Y])) =>
  runDef(smoothingDef, t, p, {
    tableKind: 'xy',
    xTitle: 'Time',
  })

describe('Fit spline/LOWESS', () => {
  it('draws the LOWESS fitted values as the curve', () => {
    const t = xyTable(X, [Y])
    const r = run({ lowess: 'fine' }, t)
    const ref = lowess(X, Y, { f: LOWESS_SPAN.fine })
    const c = r.outputs[`curve:${t.dataSets[0]!.id}`]!
    expect(c.x).toEqual(ref.x)
    expect(c.y).toEqual(ref.y)
    expect(smoothingDef.outputs!([t.dataSets[0]!.id], smoothingDef.params.parse({}))).toEqual([
      { key: `curve:${t.dataSets[0]!.id}`, forDataSet: t.dataSets[0]!.id },
    ])
  })

  it('evaluates splines on at least four segments per point', () => {
    const t = xyTable(X, [Y])
    const r = run({ method: 'akima', segments: 20 }, t)
    const c = r.outputs[`curve:${t.dataSets[0]!.id}`]!
    expect(c.x).toHaveLength(4 * X.length + 1)
    const s = akimaSpline(X, Y)
    expect(c.y[7]).toBe(s(c.x[7]!))
    const k = run({ method: 'smoothingSpline', knots: 4 }, t)
    const ks = regressionSpline(X, Y, 4)
    const kc = k.outputs[`curve:${t.dataSets[0]!.id}`]!
    expect(kc.y[50]).toBe(ks.curve(kc.x[50]!))
  })

  it('makes a table of the curves’ coordinates when asked', () => {
    const t = xyTable(X, [Y, Y.map((y) => y * 2)])
    const r = run({ method: 'pointToPoint', segments: 200, table: true }, t)
    expect(r.table?.tableKind).toBe('xy')
    expect(r.table?.x?.title).toBe('Time')
    expect(r.table?.rowCount).toBe(2 * 201)
    expect(r.table?.dataSets.map((d) => d.id)).toEqual(t.dataSets.map((d) => d.id))
    expect(r.table!.dataSets[1]!.subcolumns[0]!.values[0]).toBeNull()
  })

  it('warns about data sets it cannot smooth', () => {
    const r = run({}, xyTable([1, 1, 1], [[2, 3, 4]]))
    expect(r.status).toBe('error')
  })
})
