import { describe, expect, it } from 'vitest'
import { equation, nonlinearFit, parseEquation, userCurveModel } from '../src/index.ts'

function ok(text: string) {
  const r = parseEquation(text)
  if (!r.ok) throw new Error(`${r.message} at ${r.line}:${r.column}`)
  return r
}

/** Central-difference check of the program's gradient. */
function numericGrad(f: (x: number, p: number[]) => number, x: number, p: number[]): number[] {
  return p.map((v, j) => {
    const h = 1e-6 * Math.max(1, Math.abs(v))
    const a = [...p]
    const b = [...p]
    a[j] = v + h
    b[j] = v - h
    return (f(x, a) - f(x, b)) / (2 * h)
  })
}

describe('parseEquation', () => {
  it('finds parameters in order, with intermediates and comments', () => {
    const r = ok(`; four-parameter logistic
Span = Top - Bottom   ; span
Y = Bottom + Span/(1 + 10^((LogEC50 - X)*HillSlope))`)
    expect(r.parameters).toEqual(['Top', 'Bottom', 'LogEC50', 'HillSlope'])
    expect(r.variables).toEqual(['Span'])
    const p = [100, 0, -6, 1]
    expect(r.program.f(-6, p)).toBeCloseTo(50, 12)
  })

  it('matches the built-in equation and its gradient', () => {
    const r = ok('Y = Bottom + (Top - Bottom)/(1 + 10^((LogEC50 - X)*HillSlope))')
    const eq = equation('agonist-response-variable-slope')!
    const p = [3, 97, -6.2, 1.3]
    const g = new Float64Array(4)
    const ge = new Float64Array(4)
    for (const x of [-9, -6.5, -6, -4]) {
      expect(r.program.f(x, p)).toBeCloseTo(eq.f(x, p), 12)
      r.program.grad(x, p, g)
      eq.grad!(x, p, ge)
      for (let j = 0; j < 4; j++) expect(g[j]).toBeCloseTo(ge[j]!, 10)
    }
  })

  it('operator precedence and functions follow the documented rules', () => {
    const y = (t: string, x = 2, p = [3]) => ok(t).program.f(x, p)
    expect(y('Y = -X^2 + A*0')).toBe(-4)
    expect(y('Y = 2^-X + A*0')).toBe(0.25)
    expect(y('Y = 2^3^2 + A*0')).toBe(512)
    expect(y('Y = A - X - 1')).toBe(0)
    expect(y('Y = A/X/2')).toBe(0.75)
    expect(y('Y = log(100) + ln(exp(A)) + sqrt(16) + abs(-1) + sqr(X)')).toBeCloseTo(14, 12)
    expect(y('Y = if(X < A, 1, 2)')).toBe(1)
    expect(y('Y = if(X >= A AND X > 0, 1, 2)')).toBe(2)
    expect(y('Y = if(NOT (X = 2) OR A <> 3, 1, 2)')).toBe(2)
    expect(y('Y = min(A, X, 7) + max(A, X)*10')).toBe(32)
    expect(y('Y = 7 mod A + int(-2.5) + pi*0')).toBe(-1)
    expect(y('y = a*X', 2, [3])).toBe(6)
    expect(y('Y = pow(A, X) + 1.5e1 + .5')).toBe(24.5)
    expect(y('Y = [A + {X*2}] \\ ; continued\n  * 2')).toBe(14)
    expect(y('Y = and(X > 1, A > 1, 1) + or(X > 5, A < 1) + not(X > 5)*10')).toBe(11)
    expect(y('Y = round(A/7, 3) + arcsinh(0)*A + round(-2.5)')).toBeCloseTo(-2.571, 12)
  })

  it('parses equations without parameters (plot a function)', () => {
    const r = parseEquation('Y = sin(X) + 2*X')
    if (!r.ok) throw new Error(r.message)
    expect(r.parameters).toEqual([])
    expect(r.program.f(Math.PI / 2, [])).toBeCloseTo(1 + Math.PI, 14)
    const g = new Float64Array(0)
    expect(r.program.grad(1, [], g)).toBeCloseTo(Math.sin(1) + 2, 14)
    const k = parseEquation('K = 3\nY = K*X^2')
    if (!k.ok) throw new Error(k.message)
    expect(k.parameters).toEqual([])
    expect(k.program.f(2, [])).toBe(12)
  })

  it('reports errors with a position', () => {
    const bad = (t: string) => {
      const r = parseEquation(t)
      if (r.ok) throw new Error('parsed')
      return r
    }
    expect(bad('Y = A +').message).toMatch(/ends too early/)
    expect(bad('Y = (A + X').message).toMatch(/Missing/)
    expect(bad('Z = A*X').message).toMatch(/must define Y/)
    expect(bad('Y = foo(X)*A').message).toMatch(/Unknown function/)
    expect(bad('Y = B*X\nB = 2').message).toMatch(/before the line/)
    expect(bad('X = 2\nY = A').message).toMatch(/X can/)
    expect(bad('Y = A # X').position).toBe(6)
    const r = bad('Y = A*X\nY = Y + $')
    expect([r.line, r.column]).toEqual([2, 9])
    expect(bad('Y = sin(A, X)').message).toMatch(/takes 1 argument/)
    expect(bad('Y = 1 < A < 3').message).toMatch(/chained/)
    expect(bad('<A>Z = A*X').message).toMatch(/must define Y/)
    expect(bad('<A!>Y = A*X').message).toMatch(/Unexpected/)
    expect(bad('Y = round(A, 1, 2)').message).toMatch(/takes 1 or 2 arguments/)
    expect(bad('Y = A.B*X').message).toMatch(/Unexpected/)
  })

  it('gives exact gradients through intermediates and branches', () => {
    const r = ok(`K = ln(2)/HalfLife
Z = if(X < X0, Y0, Y0*exp(-K*(X - X0)) + Plateau*(1 - exp(-K*(X - X0))))
Y = Z + 0*abs(X0) + sqrt(Plateau^2) - Plateau + atan2(Y0, 3)*0 + max(X0, 0)*0`)
    const p = [5, 1, 100, 10]
    const g = new Float64Array(4)
    for (const x of [0, 2, 3, 8]) {
      r.program.grad(x, p, g)
      const n = numericGrad(r.program.f, x, p)
      n.forEach((v, j) => {
        expect(g[j]).toBeCloseTo(v, 5)
      })
    }
  })

  it('fits a user equation from supplied initial values', () => {
    const r = ok('Y = Vmax*X/(Km + X)')
    const model = userCurveModel(r.program, () => [40, 2])
    const x = [0.5, 1, 2, 4, 8, 16, 32]
    const y = x.map((v, i) => (50 * v) / (4 + v) + [0.3, -0.2, 0.1, -0.4, 0.2, 0.1, -0.1][i]!)
    const fit = nonlinearFit(model, [{ x, y }])
    const ref = nonlinearFit(equation('michaelis-menten')!, [{ x, y }])
    expect(fit.status).toBe('converged')
    fit.params[0]!.forEach((e, j) => {
      expect(e.value).toBeCloseTo(ref.params[0]![j]!.value, 8)
      expect(e.se).toBeCloseTo(ref.params[0]![j]!.se, 8)
    })
  })
})
