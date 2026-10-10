import { describe, expect, it } from 'vitest'
import {
  initialFromRule,
  nonlinearFit,
  parseEquation,
  solveOde,
  userCurveModel,
} from '../src/index.ts'

// Roadmap 20: the user-equation language — Prism's special and distribution functions, lines
// for particular data sets, implicit and differential equations, rules for initial values. The
// values of the functions and the fits are checked against R in equationFits.test.ts; this file
// checks the language itself, gradients and the solvers.

function ok(text: string) {
  const r = parseEquation(text)
  if (!r.ok) throw new Error(`${r.message} at ${r.line}:${r.column}`)
  return r
}

function bad(text: string) {
  const r = parseEquation(text)
  if (r.ok) throw new Error(`parsed: ${text}`)
  return r
}

/** Central differences of f in each parameter. */
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

function checkGrad(
  prog: {
    f: (x: number, p: number[]) => number
    grad: (x: number, p: number[], o: Float64Array) => number
  },
  xs: number[],
  p: number[],
  rtol = 1e-6,
) {
  const g = new Float64Array(p.length)
  for (const x of xs) {
    prog.grad(x, p, g)
    const n = numericGrad(prog.f, x, p)
    n.forEach((v, j) => {
      expect(Math.abs(g[j]! - v), `x=${x} ∂/∂p${j}: ${g[j]} vs ${v}`).toBeLessThanOrEqual(
        rtol * Math.max(1, Math.abs(v)),
      )
    })
  }
}

describe('special and distribution functions', () => {
  const y = (t: string, x = 0) => ok(`Y = ${t} + 0*A`).program.f(x, [1])

  it('computes the documented examples', () => {
    expect(y('zdist(1.96)')).toBeCloseTo(0.9750021048517795, 14)
    expect(y('zdist(1.96, "two")')).toBeCloseTo(0.04999579029644087, 14)
    expect(y('zdist(1.96, "right")')).toBeCloseTo(0.024997895148220435, 14)
    expect(y('zinv(0.975)')).toBeCloseTo(1.959963984540054, 12)
    expect(y('tdist(2.086, 20)')).toBeCloseTo(0.025, 3)
    expect(y('tdist(0, 10)')).toBe(0.5)
    expect(y('tinv(0.05, 20)')).toBeCloseTo(2.085963447265837, 10)
    expect(y('fdist(1, 10, 10)')).toBeCloseTo(0.5, 12)
    expect(y('finv(0.05, 5, 10)')).toBeCloseTo(3.325834530413011, 10)
    expect(y('chidist(3.841458820694124, 1)')).toBeCloseTo(0.05, 12)
    expect(y('chiinv(0.05, 5)')).toBeCloseTo(11.07049769351635, 10)
    expect(y('chisqc(3.841458820694124, 1)')).toBeCloseTo(0.95, 12)
    expect(y('binomial(3, 10, 0.5)')).toBeCloseTo(0.9453125, 14)
    expect(y('binomial(0, 5, 0.1)')).toBe(1)
    expect(y('fact(5) + fact(0)')).toBe(121)
    expect(y('perc(12.5)')).toBe(0.125)
    expect(y('logit(0.75)')).toBeCloseTo(Math.log(3), 14)
    expect(y('probit(0.5)')).toBe(5)
    expect(y('gamma(5)')).toBe(24)
    expect(y('gammaln(10) - ln(fact(9))')).toBeCloseTo(0, 12)
    expect(y('beta(2, 3)')).toBeCloseTo(1 / 12, 14)
    expect(y('erf(1) + erfc(1)')).toBeCloseTo(1, 15)
    expect(y('psi(1)')).toBeCloseTo(-0.5772156649015329, 13)
    expect(y('normdist(1, 1, 2)')).toBe(0.5)
    expect(y('norminv(0.975, 10, 2)')).toBeCloseTo(10 + 2 * 1.959963984540054, 11)
    expect(y('normpdf(0, 0, 1)')).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 15)
    expect(y('is_defined(X)', 3)).toBe(1)
    expect(y('igamma(2, 1) + igammac(2, 1)')).toBeCloseTo(1, 15)
    expect(y('ibeta(2, 3, 0.4)')).toBeCloseTo(0.5248, 13)
    expect(y('besselj(0, 0) + besseli(1, 0)')).toBe(1)
    expect(y('hypgeometricm(1, 2, 1)')).toBeCloseTo(Math.E - 1, 13)
    expect(y('hypgeometricf(1, 1, 2, 0.5)')).toBeCloseTo(2 * Math.log(2), 13)
  })

  it('checks arguments and tails', () => {
    expect(bad('Y = zdist(A, "both ways")').message).toMatch(/tail must be/)
    expect(bad('Y = gamma(A, 2)').message).toMatch(/takes 1 argument/)
    expect(bad('Y = sin("two")*A').message).toMatch(/only allowed as a distribution/)
    expect(bad('Y = besselj(A)').message).toMatch(/takes 2 arguments/)
    expect(bad('gamma = 2\nY = A').message).toMatch(/reserved/)
  })

  it('differentiates through every function with a parameter argument', () => {
    const cases: [string, number[], number[]][] = [
      ['A*gamma(B*X)', [2, 0.7], [0.5, 1.3, 3.1]],
      ['gammaln(A + X)', [2.5], [0.1, 4]],
      ['beta(A, B + X)', [1.5, 2], [0.2, 1]],
      ['ibeta(A, B, X/(1 + X))', [2, 3], [0.3, 1.2]],
      ['igamma(A, X*B) - igammac(A, X)', [1.7, 0.8], [0.4, 2.5]],
      ['erf(A*X) + erfc(B*X)', [0.8, 1.3], [-0.5, 0.2, 1.5]],
      ['psi(A + X)', [1.2], [0.1, 3]],
      [
        'besselj(1, A*X) + bessely(0, A*X) + besseli(2, B*X) + besselk(1, B*X)',
        [1.3, 0.6],
        [0.7, 3],
      ],
      [
        'hypgeometricm(A, B, X) + hypgeometricu(A, B, X) + hypgeometricf(A, 1, B + 1, X/4)',
        [0.8, 1.6],
        [0.5, 1.5],
      ],
      ['zdist((X - A)/B) + zdist(X*A, "two") + zinv(A/(A + X))', [1.2, 0.9], [0.3, 2]],
      ['normdist(X, A, B) + norminv(0.3, A, B) + normpdf(X, A, B)', [1, 2], [0.5, 3]],
      ['tdist(A*X, B) + tinv(0.1, B) + tpdf(X, B)', [1.1, 6.5], [0.5, 1.5]],
      ['fdist(A*X, B, 7) + finv(0.2, B, 7) + fpdf(X, 3, B)', [1.2, 4.5], [0.6, 2]],
      ['chidist(A*X, B) + chiinv(0.3, B) + chisqc(X, B)', [0.9, 3.5], [0.8, 4]],
      ['binomial(3, 10, A/(A + X))', [2], [1, 3]],
      ['logit(A/(A + X)) + probit(A/(A + X)) + perc(A*X)', [1.5], [0.5, 2]],
    ]
    for (const [expr, p, xs] of cases) {
      const r = ok(`Y = ${expr}`)
      checkGrad(r.program, xs, p, 2e-5)
    }
  })
})

describe('lines for particular data sets', () => {
  it('selects lines by position, ranges, steps and negation', () => {
    const r = ok(`<A>K = 1
<~A>K = 2
<C:E>K = K + 10
<~A:J,3>K = K + 100
<B,D>K = K + 1000
Y = K*X*Amp`)
    const at = (k: number) => r.program.forDataSet(k).f(1, [1])
    // A: 1; B: 2 + 100 + 1000; C: 2 + 10 + 100; D: 2 + 10 + 1000 (every third from A: A, D, G, J)
    expect([0, 1, 2, 3, 4, 6, 9, 10].map(at)).toEqual([1, 1102, 112, 1012, 112, 2, 2, 102])
    expect(r.parameters).toEqual(['Amp'])
  })

  it('gives each data set its own program and parameters (Prism’s total and nonspecific fit)', () => {
    const r = ok(`specific=Bmax*X/(X+Kd)
nonspecific=NS*X + Background
<A>Y=specific+nonspecific
<B>Y=nonspecific`)
    expect(r.parameters).toEqual(['Bmax', 'Kd', 'NS', 'Background'])
    const a = r.program.forDataSet(0)
    const b = r.program.forDataSet(1)
    const p = [100, 2, 3, 5]
    expect(a.f(2, p)).toBeCloseTo(50 + 6 + 5, 12)
    expect(b.f(2, p)).toBe(11)
    // B's Y doesn't depend on Bmax or Kd (its line for `specific` is computed but unused).
    expect([0, 1, 2, 3].map((j) => b.uses(j))).toEqual([false, false, true, true])
    // A third data set has no Y.
    expect(() => r.program.forDataSet(2)).toThrow(/No line defines Y for data set C/)
    const m = userCurveModel(r.program, () => [80, 1, 1, 1])
    expect(m.forDataSet!(1).uses!(0)).toBe(false)
    expect(m.forDataSet!(0).uses!(0)).toBe(true)
  })

  it('marks parameters a data set does not use, and fits them only where used', () => {
    const r = ok(`<A>Y = Top*X/(K + X)
<B>Y = Top*X/(K + X) + Offset`)
    expect(r.parameters).toEqual(['Top', 'K', 'Offset'])
    expect(r.program.forDataSet(0).uses(2)).toBe(false)
    expect(r.program.forDataSet(1).uses(2)).toBe(true)
    const model = userCurveModel(r.program, () => [80, 2, 0])
    const x = [0.5, 1, 2, 4, 8, 16, 32]
    const noise = [0.3, -0.2, 0.1, -0.4, 0.2, 0.1, -0.1]
    const ya = x.map((v, i) => (100 * v) / (3 + v) + noise[i]!)
    const yb = x.map((v, i) => (100 * v) / (3 + v) + 20 - noise[i]!)
    const fit = nonlinearFit(
      model,
      [
        { x, y: ya, dataSet: 0 },
        { x, y: yb, dataSet: 1 },
      ],
      { constraints: [{ kind: 'shared' }, { kind: 'shared' }, { kind: 'fit' }] },
    )
    expect(fit.status).toBe('converged')
    expect(fit.params[0]![2]!.se).toBeNaN()
    expect(fit.params[1]![2]!.value).toBeCloseTo(20, 0)
    // 14 points, parameters Top, K (shared) and Offset (B only).
    expect(fit.df).toBe(11)
  })

  it('rejects malformed selectors', () => {
    expect(bad('<A!>Y = A*X').line).toBe(1)
    expect(bad('<C:A>Y = A*X').message).toMatch(/doesn’t name data sets/)
    expect(bad('<A>\nY = A*X').message).toMatch(/needs a statement/)
  })
})

describe('implicit equations', () => {
  it('solves Y on both sides, with the implicit-function gradient', () => {
    const r = ok('Y = X + A*sin(Y)')
    expect(r.program.kind).toBe('implicit')
    for (const x of [0.2, 1, 3]) {
      const yv = r.program.f(x, [0.5])
      expect(yv - x - 0.5 * Math.sin(yv)).toBeCloseTo(0, 14)
    }
    checkGrad(r.program, [0.2, 1, 3], [0.5])
  })

  it('handles intermediates that use Y (Prism’s binding example)', () => {
    const r = ok(`Free = X - Y
Y = NS*Free + Bmax*Free/(Kd + Free)`)
    expect(r.parameters).toEqual(['NS', 'Bmax', 'Kd'])
    const p = [0.05, 800, 300]
    for (const x of [50, 400, 3000]) {
      const b = r.program.f(x, p)
      const free = x - b
      expect(b).toBeCloseTo(0.05 * free + (800 * free) / (300 + free), 9)
    }
    checkGrad(r.program, [50, 400, 3000], p)
  })
})

describe('differential equations', () => {
  it('parses Y′ with the parameter Y[0], X[0] and the dY/dX spelling', () => {
    const r = ok("Y' = -K*Y")
    expect(r.program.kind).toBe('differential')
    expect(r.parameters).toEqual(['Y[0]', 'K'])
    expect(ok('dY/dX = -K*Y').parameters).toEqual(['Y[0]', 'K'])
    expect(ok("X[0] = 2\nY' = -K*(Y - Y[0]/2)").parameters).toEqual(['Y[0]', 'K'])
    expect(bad("Y' = -K*Y\nY' = 2").message).toMatch(/Only one line/)
    expect(bad("Y' = -K*Y\nY = 2").message).toMatch(/can’t also be assigned/)
    expect(bad('Y = Y[0]*X').message).toMatch(/only for differential/)
    expect(bad("Y' = -K*Y*X[0]").message).toMatch(/before a line/)
  })

  it('matches the exact solution, forward, backward and between steps', () => {
    const r = ok("Y' = -K*Y")
    const p = [10, 0.3]
    const g = new Float64Array(2)
    for (const x of [0, 0.37, 1, 2.5, 5, 12, -2, -0.7]) {
      const exact = 10 * Math.exp(-0.3 * x)
      const v = r.program.grad(x, p, g)
      expect(Math.abs(v - exact)).toBeLessThanOrEqual(1e-10 * exact)
      expect(Math.abs(g[0]! - Math.exp(-0.3 * x))).toBeLessThanOrEqual(1e-10 * Math.exp(-0.3 * x))
      expect(Math.abs(g[1]! + x * exact)).toBeLessThanOrEqual(
        1e-9 * Math.max(1, Math.abs(x * exact)),
      )
    }
  })

  it('logistic growth from X[0], with gradients from the sensitivity equations', () => {
    const r = ok("X[0] = 1\nY' = K*Y*(1 - Y/YM)")
    expect(r.parameters).toEqual(['Y[0]', 'K', 'YM'])
    const [y0, k, ym] = [2, 0.6, 100]
    const exact = (x: number) => (ym * y0) / (y0 + (ym - y0) * Math.exp(-k * (x - 1)))
    for (const x of [1, 3.3, 8, 15, -1]) {
      expect(r.program.f(x, [y0, k, ym])).toBeCloseTo(exact(x), 8)
    }
    checkGrad(r.program, [2, 5, 9], [y0, k, ym], 1e-5)
  })

  it('falls back to the stiff solver', () => {
    // y' = −1000 (y − cos x): stiff; the solution follows cos x closely.
    const sol = solveOde(
      {
        dim: 1,
        rhs: (x, y, dy) => {
          dy[0] = -1000 * (y[0]! - Math.cos(x))
        },
      },
      0,
      [1],
      { maxSteps: 200 },
    )
    sol.extendTo(10)
    const out = new Float64Array(1)
    sol.at(10, out)
    expect(sol.stiff).toBe(true)
    // Exact: y = (1000² cos x + 1000 sin x)/(1000² + 1) + C e^{−1000x}.
    const yx = (1e6 * Math.cos(10) + 1000 * Math.sin(10)) / (1e6 + 1)
    expect(out[0]).toBeCloseTo(yx, 6)
  })

  it('fits an ODE model like its closed form', () => {
    const r = ok("Y' = -K*(Y - Plateau)")
    const model = userCurveModel(r.program, () => [90, 0.1, 5])
    const x = Array.from({ length: 16 }, (_, i) => i * 2)
    const noise = [
      0.9, -1.1, 0.4, -0.3, 1.2, -0.8, 0.1, 0.5, -0.6, 0.2, -0.2, 0.7, -0.9, 0.3, 0, -0.4,
    ]
    const y = x.map((v, i) => (100 - 10) * Math.exp(-0.2 * v) + 10 + noise[i]!)
    const fit = nonlinearFit(model, [{ x, y }])
    const closed = parseEquation('Y = (Y0 - Plateau)*exp(-K*X) + Plateau')
    if (!closed.ok) throw new Error()
    const ref = nonlinearFit(
      userCurveModel(closed.program, () => [90, 5, 0.1]),
      [{ x, y }],
    )
    expect(fit.status).toBe('converged')
    // Parameters: ODE [Y[0], K, Plateau]; closed form [Y0, Plateau, K].
    const map = [0, 2, 1]
    fit.params[0]!.forEach((e, j) => {
      const q = ref.params[0]![map[j]!]!
      expect(Math.abs(e.value - q.value)).toBeLessThanOrEqual(1e-8 * Math.abs(q.value))
      expect(Math.abs(e.se - q.se)).toBeLessThanOrEqual(1e-6 * q.se)
    })
  })
})

describe('rules for initial values', () => {
  const x = [1, 2, 3, 4, 5, 6]
  const y = [10, 12, 30, 70, 88, 90]
  it('computes Prism’s quantities', () => {
    const v = (rule: string, value = 1) => initialFromRule({ rule, value }, x, y)
    expect(v('value', 7)).toBe(7)
    expect(v('ymin')).toBe(10)
    expect(v('ymax', 1.25)).toBe(112.5)
    expect(v('ymid')).toBe(50)
    expect(v('xmid')).toBe(3.5)
    expect(v('xatymid')).toBeCloseTo(3.5, 14)
    expect(v('yatxmid')).toBe(50)
    expect(v('yrange')).toBe(80)
    expect(v('xrange')).toBe(5)
    expect(v('sign')).toBe(1)
    expect(v('slopexmin')).toBe(2)
    expect(v('slopexmax')).toBe(2)
    // Middle two points (even count): 30 → 70.
    expect(v('slopexmid')).toBe(40)
    expect(v('/xmid')).toBeCloseTo(1 / 3.5, 15)
    expect(v('nonsense')).toBeNaN()
  })
})
