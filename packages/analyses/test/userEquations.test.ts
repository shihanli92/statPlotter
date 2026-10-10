import { type DataTable, normalizeTable } from '@ps/model'
import { equation, nonlinearFit, parseEquation, userCurveModel } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { nonlinearFitDef, nonlinearFitMVDef, resolveEquation } from '../src/index.ts'
import { mvTable, runDef, v, xyTable } from './helpers.ts'

// Roadmap 20 in the nonlinear regression analysis: lines for particular data sets, rules for
// initial values, differential and implicit equations, centered polynomials (mean X as a data
// set constant), SE/CI values, and fits from multiple-variables tables.

const run = (t: DataTable, p: Record<string, unknown>) =>
  runDef(nonlinearFitDef, t, p, {
    tableKind: 'xy',
    xTitle: 'X',
  })

function bestFit(r: ReturnType<typeof run>, label: string, col = 0) {
  for (const s of r.sheets)
    for (const b of s.blocks)
      if (b.type === 'table' && /Best-fit/.test(b.title ?? '')) {
        const row = b.rows.find((x) => (x[0] as { v: string }).v === label)
        if (row) return row[col + 1]!
      }
  throw new Error(`no ${label}: ${r.diagnostics.map((d) => d.message).join('; ')}`)
}

const X = [0.5, 1, 2, 4, 8, 16, 32]
const noise = [0.3, -0.2, 0.1, -0.4, 0.2, 0.1, -0.1]

describe('user equations in the analysis', () => {
  it('fits lines for particular data sets and marks parameters a data set doesn’t use', () => {
    const total = X.map((x, i) => (1500 * x) / (x + 4) + 20 * x + 30 + 10 * noise[i]!)
    const ns = X.map((x, i) => 20 * x + 30 - 10 * noise[i]!)
    const t = xyTable(X, [total, ns], ['Total', 'Nonspecific'])
    const text = `specific=Bmax*X/(X+Kd)
nonspecific=NS*X + Background
<A>Y=specific+nonspecific
<B>Y=nonspecific`
    const r = run(t, {
      equation: 'user',
      userEquation: text,
      constraints: { NS: { kind: 'shared' }, Background: { kind: 'shared' } },
      initialValues: { Bmax: 1000, Kd: 2, NS: 10, Background: 10 },
    })
    expect(r.status, r.diagnostics.map((d) => d.message).join()).toBe('ok')
    expect((bestFit(r, 'Bmax', 1) as { v: string }).v).toBe('(not used)')
    const prog = parseEquation(text)
    if (!prog.ok) throw new Error()
    const ref = nonlinearFit(
      userCurveModel(prog.program, () => [1000, 2, 10, 10]),
      [
        { x: X, y: total, dataSet: 0 },
        { x: X, y: ns, dataSet: 1 },
      ],
      { constraints: [{ kind: 'fit' }, { kind: 'fit' }, { kind: 'shared' }, { kind: 'shared' }] },
    )
    expect(v(bestFit(r, 'Bmax'))).toBeCloseTo(ref.params[0]![0]!.value, 8)
    expect(v(bestFit(r, 'NS', 1))).toBeCloseTo(ref.params[1]![2]!.value, 8)
  })

  it('uses rules for initial values', () => {
    // A steep curve far from X = 1: starting every parameter at 1 fails, the rules work.
    const x = [100, 200, 400, 800, 1600, 3200, 6400]
    const y = x.map((xv, i) => (500 * xv) / (900 + xv) + noise[i]!)
    const t = xyTable(x, [y])
    const text = 'Y = Top*X/(Half + X)'
    const plain = run(t, { equation: 'user', userEquation: text })
    const ruled = run(t, {
      equation: 'user',
      userEquation: text,
      initialRules: { Top: { value: 1, rule: 'ymax' }, Half: { value: 1, rule: 'xatymid' } },
    })
    expect(ruled.status).toBe('ok')
    expect(v(bestFit(ruled, 'Half'))).toBeCloseTo(900, -1)
    const ref = nonlinearFit(equation('michaelis-menten')!, [{ x, y }])
    expect(v(bestFit(ruled, 'Top'))).toBeCloseTo(ref.params[0]![0]!.value, 7)
    // The rules give the starting values: YMAX and the X at YMID of each data set.
    const m = resolveEquation({
      equation: 'user',
      userEquation: text,
      initialValues: {},
      initialRules: { Top: { value: 1, rule: 'ymax' }, Half: { value: 2, rule: 'xatymid' } },
    })
    if (!m.ok) throw new Error()
    const start = m.model.initial(x, y)
    expect(start[0]).toBe(Math.max(...y))
    expect(start[1]).toBeGreaterThan(2 * 400)
    expect(plain.status).toBe('ok')
  })

  it('fits a differential equation (Y[0] starts at the first Y) with a curve output', () => {
    const x = [0, 2, 4, 6, 8, 10, 14, 18, 24, 30]
    const y = x.map((xv, i) => 90 * Math.exp(-0.2 * xv) + 10 + noise[i % 7]! * 3)
    const t = xyTable(x, [y])
    const r = run(t, {
      equation: 'user',
      userEquation: "Y' = -K*(Y - Plateau)",
      initialValues: { K: 0.1, Plateau: 5 },
    })
    expect(r.status).toBe('ok')
    const closed = run(t, { equation: 'one-phase-decay' })
    expect(v(bestFit(r, 'K'))).toBeCloseTo(v(bestFit(closed, 'K')), 7)
    expect(v(bestFit(r, 'Y[0]'))).toBeCloseTo(v(bestFit(closed, 'Y0')), 6)
    const curve = Object.values(r.outputs)[0]!
    expect(curve.y.length).toBeGreaterThan(50)
    expect(r.sheets[0]!.blocks[0]).toMatchObject({ type: 'note' })
    expect((r.sheets[0]!.blocks[0] as { text: string }).text).toMatch(/differential/)
  })

  it('fits an implicit equation', () => {
    const x = [50, 100, 200, 400, 800, 1600, 3200, 6400]
    // Bound B solves B = NS·(X − B) + Bmax·(X − B)/(Kd + X − B).
    const bound = (xv: number) => {
      const [ns, bmax, kd] = [0.05, 800, 300]
      const b = xv - (1 + ns) * kd - bmax
      const f = (b + Math.sqrt(b * b + 4 * (1 + ns) * xv * kd)) / (2 * (1 + ns))
      return xv - f
    }
    const y = x.map((xv, i) => bound(xv) + 5 * noise[i % 7]!)
    const r = run(xyTable(x, [y]), {
      equation: 'user',
      userEquation: 'Free = X - Y\nY = NS*Free + Bmax*Free/(Kd + Free)',
      initialValues: { NS: 0.1, Bmax: 1000, Kd: 200 },
    })
    expect(r.status).toBe('ok')
    expect(v(bestFit(r, 'Bmax'))).toBeCloseTo(800, -2)
  })

  it('reports SE and CI limits of fitted parameters as values', () => {
    const y = X.map((x, i) => (50 * x) / (4 + x) + noise[i]!)
    const t = xyTable(X, [y])
    const r = run(t, { equation: 'michaelis-menten' })
    const key = normalizeTable(t)[0]!.ref.key
    const vm = v(r.values[`Vmax:${key}`])
    const se = v(r.values[`Vmax:${key}:se`])
    expect(v(r.values[`Vmax:${key}:lo`])).toBeLessThan(vm)
    expect(v(r.values[`Vmax:${key}:hi`]) - vm).toBeCloseTo(vm - v(r.values[`Vmax:${key}:lo`]), 10)
    expect(se).toBeGreaterThan(0)
  })

  it('holds XMean at each data set’s mean X for centered polynomials', () => {
    const x = Array.from({ length: 21 }, (_, i) => 10 + i / 2)
    const y = x.map((xv, i) => 3 + 2 * (xv - 15) - 0.5 * (xv - 15) ** 2 + noise[i % 7]!)
    const r = run(xyTable(x, [y]), { equation: 'centered-polynomial-2' })
    expect(r.status).toBe('ok')
    expect((bestFit(r, 'XMean') as { v: string }).v).toBe('= 15')
    expect(v(bestFit(r, 'B2'))).toBeCloseTo(-0.5, 1)
  })
})

describe('nonlinear regression from a multiple-variables table', () => {
  const dose = [0.5, 1, 2, 4, 8, 16, 32, 0.5, 1, 2, 4, 8, 16, 32]
  const grp = [0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5]
  const resp = dose.map(
    (d, i) => ((grp[i] ? 80 : 100) * d) / ((grp[i] ? 9 : 4) + d) + noise[i % 7]!,
  )
  const runMV = (t: DataTable, p: Record<string, unknown>) =>
    runDef(nonlinearFitMVDef, t, p, {
      tableKind: 'multipleVariables',
      xTitle: null,
    })

  it('fits Y against X per group of a numeric grouping variable', () => {
    const t = mvTable({ Dose: dose, Group: grp, Response: resp })
    const keys = normalizeTable(t).map((d) => d.ref.key)
    const r = runMV(t, { x: keys[0], y: keys[2], group: keys[1], equation: 'michaelis-menten' })
    expect(r.status).toBe('ok')
    const ref0 = nonlinearFit(equation('michaelis-menten')!, [
      { x: dose.slice(0, 7), y: resp.slice(0, 7) },
    ])
    expect(v(bestFit(r, 'Km', 0))).toBeCloseTo(ref0.params[0]![1]!.value, 8)
    // Group titles are the values; a numeric group value can be a data set constant.
    const res = r.sheets[0]!.blocks.find((b) => b.type === 'table') as { columns: string[] }
    expect(res.columns).toEqual(['', '0', '5'])
    expect(Object.keys(r.outputs).sort()).toEqual([
      'mv:curve:0',
      'mv:curve:1',
      'mv:points:0',
      'mv:points:1',
    ])
    expect(
      nonlinearFitMVDef.outputs!([], nonlinearFitMVDef.params.parse({ group: 'g' })).length,
    ).toBe(24)
  })

  it('gives each group’s fit its level, and draws it on graphs of the variables too (roadmap 35)', () => {
    const t = mvTable({ Dose: dose, Response: resp, Drug: grp.map(() => null) })
    t.dataSets[2]!.text = grp.map((g) => (g ? 'Drug B' : 'Drug A'))
    const keys = normalizeTable(t).map((d) => d.ref.key)
    const p = { x: keys[0], y: keys[1], group: keys[2], equation: 'michaelis-menten' }
    const r = runMV(t, p)
    expect(r.outputs['mv:curve:0']?.group).toBe('Drug A')
    expect(r.outputs['mv:curve:1']?.group).toBe('Drug B')
    const decls = nonlinearFitMVDef.outputs!([], nonlinearFitMVDef.params.parse(p))
    expect(decls.find((d) => d.key === 'mv:curve:0')?.onGraphsOf).toEqual({
      x: keys[0],
      y: keys[1],
    })
    expect(decls.find((d) => d.key === 'mv:points:0')?.onGraphsOf).toBeUndefined()
    // Without a group: one fit, of no group.
    expect(runMV(t, { ...p, group: '' }).outputs['mv:curve:0']?.group).toBeUndefined()
  })

  it('groups by a text variable and fits a shared parameter across groups', () => {
    const t = mvTable({ Dose: dose, Response: resp, Drug: grp.map(() => null) })
    t.dataSets[2]!.text = grp.map((g) => (g ? 'Drug B' : 'Drug A'))
    const keys = normalizeTable(t).map((d) => d.ref.key)
    const r = runMV(t, {
      x: keys[0],
      y: keys[1],
      group: keys[2],
      equation: 'michaelis-menten',
      constraints: { Vmax: { kind: 'shared' } },
    })
    expect(r.status).toBe('ok')
    const res = r.sheets[0]!.blocks.find((b) => b.type === 'table') as { columns: string[] }
    expect(res.columns).toEqual(['', 'Drug A', 'Drug B'])
    expect(v(bestFit(r, 'Vmax', 0))).toBe(v(bestFit(r, 'Vmax', 1)))
  })

  it('without a grouping variable fits all rows, and refuses text X or Y', () => {
    const t = mvTable({ Dose: dose.slice(0, 7), Response: resp.slice(0, 7) })
    const r = runMV(t, { equation: 'michaelis-menten' })
    expect(r.status).toBe('ok')
    const tt = mvTable({ Dose: dose, Response: resp })
    tt.dataSets[1]!.text = resp.map(String)
    expect(runMV(tt, {}).status).toBe('error')
  })
})
