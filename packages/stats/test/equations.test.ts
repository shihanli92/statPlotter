import { describe, expect, it } from 'vitest'
import { type CurveModel, EQUATIONS, equation, modelFor } from '../src/index.ts'
import { CASES, DESIGNS, DESIGNS20 } from './equationDesigns.ts'
import { withSpreadGuard } from './spreadGuard.ts'

describe('equation library', () => {
  it('every equation has one design, unique id, and complete paramInfo', () => {
    const ids = new Set(EQUATIONS.map((e) => e.id))
    expect(ids.size).toBe(EQUATIONS.length)
    for (const e of EQUATIONS) {
      expect(DESIGNS[e.id] ?? DESIGNS20[e.id], e.id).toBeDefined()
      expect(Object.keys(e.paramInfo).sort()).toEqual([...e.params].sort())
      expect(equation(e.id)).toBe(e)
    }
    expect(equation('nope')).toBeUndefined()
    expect(CASES.length).toBe(Object.keys(DESIGNS).length + Object.keys(DESIGNS20).length)
    expect(CASES.length).toBe(EQUATIONS.length)
  })

  it('the generated standard dose-response forms keep their ids, names, formulas and parameters', () => {
    const pinned: [string, string, string, string[]][] = [
      [
        'agonist-response',
        'log(agonist) vs. response (three parameters)',
        'Y = Bottom + (Top − Bottom)/(1 + 10^(LogEC50 − X))',
        ['Bottom', 'Top', 'LogEC50'],
      ],
      [
        'agonist-response-variable-slope',
        'log(agonist) vs. response — Variable slope (four parameters)',
        'Y = Bottom + (Top − Bottom)/(1 + 10^((LogEC50 − X)·HillSlope))',
        ['Bottom', 'Top', 'LogEC50', 'HillSlope'],
      ],
      [
        'agonist-normalized-response',
        'log(agonist) vs. normalized response',
        'Y = 100/(1 + 10^(LogEC50 − X))',
        ['LogEC50'],
      ],
      [
        'agonist-normalized-response-variable-slope',
        'log(agonist) vs. normalized response — Variable slope',
        'Y = 100/(1 + 10^((LogEC50 − X)·HillSlope))',
        ['LogEC50', 'HillSlope'],
      ],
      [
        'inhibitor-response',
        'log(inhibitor) vs. response (three parameters)',
        'Y = Bottom + (Top − Bottom)/(1 + 10^(X − LogIC50))',
        ['Bottom', 'Top', 'LogIC50'],
      ],
      [
        'inhibitor-response-variable-slope',
        'log(inhibitor) vs. response — Variable slope (four parameters)',
        'Y = Bottom + (Top − Bottom)/(1 + 10^((LogIC50 − X)·HillSlope))',
        ['Bottom', 'Top', 'LogIC50', 'HillSlope'],
      ],
      [
        'inhibitor-normalized-response',
        'log(inhibitor) vs. normalized response',
        'Y = 100/(1 + 10^(X − LogIC50))',
        ['LogIC50'],
      ],
      [
        'inhibitor-normalized-response-variable-slope',
        'log(inhibitor) vs. normalized response — Variable slope',
        'Y = 100/(1 + 10^((LogIC50 − X)·HillSlope))',
        ['LogIC50', 'HillSlope'],
      ],
      [
        'agonist-conc-response',
        '[Agonist] vs. response',
        'Y=Bottom + X·(Top-Bottom)/(EC50 + X)',
        ['Bottom', 'Top', 'EC50'],
      ],
      [
        'agonist-conc-response-variable-slope',
        '[Agonist] vs. response — Variable slope',
        'Y=Bottom + (X^HillSlope)·(Top-Bottom)/(X^HillSlope + EC50^HillSlope)',
        ['Bottom', 'Top', 'EC50', 'HillSlope'],
      ],
      [
        'agonist-conc-normalized-response',
        '[Agonist] vs. normalized response',
        'Y=100·X/(EC50+X)',
        ['EC50'],
      ],
      [
        'agonist-conc-normalized-response-variable-slope',
        '[Agonist] vs. normalized response — Variable slope',
        'Y=100·(X^HillSlope)/(EC50^HillSlope + (X^HillSlope))',
        ['EC50', 'HillSlope'],
      ],
      [
        'inhibitor-conc-response',
        '[Inhibitor] vs. response',
        'Y=Bottom + (Top-Bottom)/(1+(X/IC50))',
        ['Bottom', 'Top', 'IC50'],
      ],
      [
        'inhibitor-conc-response-variable-slope',
        '[Inhibitor] vs. response — Variable slope',
        'Y=Bottom + (Top-Bottom)/(1+(IC50/X)^HillSlope)',
        ['Bottom', 'Top', 'IC50', 'HillSlope'],
      ],
      [
        'inhibitor-conc-normalized-response',
        '[Inhibitor] vs. normalized response',
        'Y=100/(1+X/IC50)',
        ['IC50'],
      ],
      [
        'inhibitor-conc-normalized-response-variable-slope',
        '[Inhibitor] vs. normalized response — Variable slope',
        'Y=100/(1+(IC50/X)^HillSlope)',
        ['IC50', 'HillSlope'],
      ],
    ]
    for (const [id, name, formula, params] of pinned) {
      const e = equation(id)!
      expect([e.name, e.formula, e.params], id).toEqual([name, formula, params])
    }
  })

  it('analytic gradients match central differences (each data set’s own equation)', () => {
    const g = new Float64Array(10)
    for (const { e, d, g: group } of CASES) {
      const { inset, hFloor, scaleFloor, rtol } = group.grad
      for (let k = 0; k < (d.sets ?? 1); k++) {
        const m: CurveModel = modelFor(e, { dataSet: k })
        const p = d.truth(k)
        const n = d.x.length
        for (const xv of [d.x[inset]!, d.x[Math.floor(n / 2)]!, d.x[n - 1 - inset]!]) {
          m.grad!(xv, p, g)
          for (let j = 0; j < p.length; j++) {
            if (m.uses?.(j) === false) continue
            const h = 1e-6 * Math.max(Math.abs(p[j]!), hFloor)
            const up = [...p]
            const dn = [...p]
            up[j] = p[j]! + h
            dn[j] = p[j]! - h
            const num = (m.f(xv, up) - m.f(xv, dn)) / (2 * h)
            const scale = Math.max(
              Math.abs(num),
              Math.abs(m.f(xv, p)) / Math.max(Math.abs(p[j]!), scaleFloor),
            )
            expect(
              Math.abs(g[j]! - num),
              `${e.id}[${k}] ∂/∂${e.params[j]} at x=${xv}`,
            ).toBeLessThan(rtol * scale + 1e-9)
          }
        }
      }
    }
  })
})

describe('automatic initial values on large data sets', () => {
  // About 1 s alone; the 5 s default timed out under heavy load (every equation at n = 20 000).
  it('do not spread a data array into call arguments (overflows the call stack for large n)', {
    timeout: 30_000,
  }, () => {
    const n = 20_000
    const x = Array.from({ length: n }, (_, i) => 0.1 + i / 2_000)
    const y = x.map((v) => 2 + 3 * Math.exp(-0.5 * v) + 0.01 * Math.sin(v * 7919))
    withSpreadGuard(() => {
      for (const e of EQUATIONS) expect(() => e.initial(x, y), e.id).not.toThrow()
    })
  })
})
