import { type AnalysisResult, normalizeTable } from '@ps/model'
import { equation, normalCdf, powerT, proportionCI, tCdf } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { registry, simulateColumnDef, simulateContingencyDef, simulateXYDef } from '../src/index.ts'

/** Unpaired t test with its defaults. */
const unpairedDefaults = {}

// Roadmap 20: Simulate XY / column data / contingency table and the Monte Carlo analysis.
// Simulations are checked for their shape, reproducibility and the distribution of their
// random error on large samples (seeds fixed, so deterministic); the Monte Carlo against exact
// power and confidence-interval coverage.

const simXY = (p: Record<string, unknown>) => simulateXYDef.run([], simulateXYDef.params.parse(p))
const cols = (r: AnalysisResult) => normalizeTable(r.table!)
const ys = (r: AnalysisResult, k = 0, rep = 0) =>
  Array.from((cols(r)[k]!.data as { reps: Float64Array[] }).reps[rep]!)

describe('Simulate XY data', () => {
  it('makes X as a series stopping once X reaches the end, Y from the equation', () => {
    const r = simXY({
      xStart: 0,
      xStep: 0.5,
      xEnd: 3,
      equation: 'straight-line',
      error: 'none',
      dataSets: [{ values: { YIntercept: 2, Slope: 3 } }],
    })
    expect(r.status).toBe('ok')
    expect(Array.from(cols(r)[0]!.x!)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3])
    expect(ys(r)).toEqual([2, 3.5, 5, 6.5, 8, 9.5, 11])
    const g = simXY({ xMode: 'geometric', xStart: 1e-9, xStep: 10, xEnd: 1e-5, error: 'none' })
    expect(cols(g)[0]!.x!.length).toBe(5)
    expect(simXY({ xMode: 'geometric', xStart: 0, xStep: 10 }).status).toBe('error')
  })

  it('is reproducible from its seed; data sets, replicates and titles', () => {
    const p = {
      replicates: 3,
      dataSets: [{}, { title: 'Treated', values: { LogEC50: -5 } }],
      seed: 7,
    }
    const a = simXY(p)
    const b = simXY(p)
    expect(a.table).toEqual(b.table)
    expect(simXY({ ...p, seed: 8 }).table).not.toEqual(a.table)
    const n = cols(a)
    expect(n.map((d) => d.title)).toEqual(['Data Set A', 'Treated'])
    expect((n[0]!.data as { reps: Float64Array[] }).reps.length).toBe(3)
  })

  const big = (error: Record<string, unknown>) =>
    simXY({
      xStart: 1,
      xStep: 1,
      xEnd: 20000,
      equation: 'straight-line',
      seed: 3,
      dataSets: [{ values: { YIntercept: 50, Slope: 0 } }],
      ...error,
    })
  const resid = (r: AnalysisResult) => ys(r).map((y) => y - 50)
  const sdOf = (x: number[]) => {
    const m = x.reduce((a, b) => a + b, 0) / x.length
    return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1))
  }
  const ks = (x: number[], cdf: (v: number) => number) => {
    const s = [...x].sort((a, b) => a - b)
    let d = 0
    s.forEach((v, i) => {
      d = Math.max(d, Math.abs(cdf(v) - i / s.length), Math.abs(cdf(v) - (i + 1) / s.length))
    })
    return d * Math.sqrt(s.length)
  }

  it('adds Gaussian, relative, double Gaussian, t and Lorentzian error with the stated spread', () => {
    const g = resid(big({ error: 'gaussian', sd: 2 }))
    expect(ks(g, (v) => normalCdf(v / 2))).toBeLessThan(1.95) // P > 0.001
    const rel = resid(big({ error: 'relative', percent: 10 }))
    expect(ks(rel, (v) => normalCdf(v / 5))).toBeLessThan(1.95)
    const dbl = resid(big({ error: 'doubleGaussian', sd: 1, sd2: 6, doublePercent: 80 }))
    const mix = (v: number) => 0.8 * normalCdf(v) + 0.2 * normalCdf(v / 6)
    expect(ks(dbl, mix)).toBeLessThan(1.95)
    const t = resid(big({ error: 't', sd: 3, df: 5 }))
    expect(ks(t, (v) => tCdf(v / 3, 5))).toBeLessThan(1.95)
    const l = resid(big({ error: 'lorentzian', sd: 0.5 }))
    expect(ks(l, (v) => tCdf(v / 0.5, 1))).toBeLessThan(1.95)
    expect(sdOf(g)).toBeCloseTo(2, 1)
  })

  it('adds Poisson error (integers with mean Y), blank below zero', () => {
    const r = simXY({
      xStart: 1,
      xStep: 1,
      xEnd: 20000,
      equation: 'straight-line',
      error: 'poisson',
      dataSets: [{ values: { YIntercept: 7.5, Slope: 0 } }],
    })
    const y = ys(r)
    expect(y.every(Number.isInteger)).toBe(true)
    const m = y.reduce((a, b) => a + b, 0) / y.length
    expect(Math.abs(m - 7.5)).toBeLessThan(4 * Math.sqrt(7.5 / y.length))
    const neg = simXY({
      error: 'poisson',
      equation: 'straight-line',
      dataSets: [{ values: { YIntercept: -1, Slope: 0 } }],
    })
    expect(ys(neg).every(Number.isNaN)).toBe(true)
    expect(neg.diagnostics.some((d) => /Poisson/.test(d.message))).toBe(true)
  })

  it('turns the chosen number of points into outliers, within the limits', () => {
    const p = {
      xStart: 1,
      xStep: 1,
      xEnd: 200,
      equation: 'straight-line',
      error: 'none',
      dataSets: [{ values: { YIntercept: 0, Slope: 1 } }],
      outlierLow: 10,
      outlierHigh: 20,
    }
    const clean = ys(simXY(p))
    const dirty = ys(simXY({ ...p, outliers: 7 }))
    const moved = dirty.map((y, i) => Math.abs(y - clean[i]!)).filter((d) => d > 0)
    expect(moved.length).toBe(7)
    expect(moved.every((d) => d >= 10 && d <= 20)).toBe(true)
  })

  it('simulates user equations with lines for particular data sets', () => {
    const r = simXY({
      equation: 'user',
      userEquation: '<A>Y = A1*X\n<B>Y = A1*X + 100',
      dataSets: [{ values: { A1: 2 } }, { values: { A1: 2 } }],
      error: 'none',
      xEnd: 3,
    })
    expect(ys(r, 0)).toEqual([0, 2, 4, 6])
    expect(ys(r, 1)).toEqual([100, 102, 104, 106])
  })
})

describe('Simulate column data', () => {
  it('draws n values per column around each column mean, or random means', () => {
    const p = simulateColumnDef.params.parse({
      columns: [
        { n: 5000, mean: 10 },
        { n: 3, mean: 100, title: 'B' },
      ],
      sd: 2,
      seed: 4,
    })
    const r = simulateColumnDef.run([], p)
    const n = normalizeTable(r.table!)
    expect(n.map((d) => d.title)).toEqual(['A', 'B'])
    const a = Array.from((n[0]!.data as { reps: Float64Array[] }).reps[0]!)
    expect(a.length).toBe(5000)
    const m = a.reduce((s, x) => s + x, 0) / a.length
    expect(Math.abs(m - 10)).toBeLessThan(4 * (2 / Math.sqrt(5000)))
    const b = Array.from((n[1]!.data as { reps: Float64Array[] }).reps[0]!)
    expect(b.filter(Number.isFinite).length).toBe(3)
    const rnd = simulateColumnDef.run(
      [],
      simulateColumnDef.params.parse({
        meanMode: 'random',
        meanOfMeans: 50,
        sdOfMeans: 10,
        error: 'none',
        columns: Array.from({ length: 400 }, () => ({ n: 1 })),
      }),
    )
    const means = normalizeTable(rnd.table!).map(
      (d) => (d.data as { reps: Float64Array[] }).reps[0]![0]!,
    )
    const mm = means.reduce((s, x) => s + x, 0) / means.length
    expect(Math.abs(mm - 50)).toBeLessThan(4 * (10 / Math.sqrt(400)))
  })
})

describe('Simulate contingency table', () => {
  const sim = (p: Record<string, unknown>, seed: number) => {
    const r = simulateContingencyDef.run([], simulateContingencyDef.params.parse({ ...p, seed }))
    const n = normalizeTable(r.table!)
    return [0, 1].map((row) => n.map((d) => (d.data as { reps: Float64Array[] }).reps[0]![row]!))
  }
  it('keeps the margins each design fixes, and the cell frequencies follow the probabilities', () => {
    const base = { total: 200, pRow1: 0.25, pOutcome1: 0.3, pOutcome2: 0.6 }
    const exp = sim({ ...base, design: 'experimental' }, 1)
    expect(exp[0]![0]! + exp[0]![1]!).toBe(50)
    expect(exp[1]![0]! + exp[1]![1]!).toBe(150)
    const cc = sim({ total: 100, design: 'caseControl', pCases: 0.4 }, 2)
    expect(cc[0]![0]! + cc[1]![0]!).toBe(40)
    let a = 0
    const reps = 2000
    for (let s = 0; s < reps; s++) {
      const t = sim({ ...base, design: 'crossSectional' }, s)
      expect(t.flat().reduce((x, y) => x + y, 0)).toBe(200)
      a += t[0]![0]!
    }
    // E[a] = 200·0.25·0.3 = 15; SD of the mean over 2000 tables ≈ √(15·0.925/2000).
    expect(Math.abs(a / reps - 15)).toBeLessThan(4 * Math.sqrt((15 * 0.925) / reps))
  })
})

describe('Monte Carlo analysis', () => {
  const mc = registry.get('monteCarlo')!

  it('estimates the power of an unpaired t test (hits: P < 0.05)', () => {
    const p = mc.params.parse({
      simulation: {
        analysisId: 'simulateColumn',
        params: {
          columns: [
            { n: 10, mean: 10 },
            { n: 10, mean: 12 },
          ],
          sd: 2,
        },
      },
      analysis: { analysisId: 'ttest', params: unpairedDefaults },
      simulations: 2000,
      seed: 5,
      tabulate: ['p', 'diff'],
      hits: { conditions: [{ value: 'p', op: '<', than: 0.05 }] },
    })
    const r = mc.run([], p)
    expect(r.status, r.diagnostics.map((d) => d.message).join()).toBe('ok')
    const power = powerT(10, 2, 2, 0.05, 'two')
    const f = (r.values.hitFraction as { v: number }).v
    expect(Math.abs(f - power)).toBeLessThan(4 * Math.sqrt((power * (1 - power)) / 2000))
    const ci = proportionCI(Math.round(f * 2000), 2000)
    expect(ci.lower).toBeLessThan(power)
    // The tabulated table: one row per simulation, one column per value, and the hits.
    const t = normalizeTable(r.table!)
    expect(t.map((d) => d.title)).toEqual(['p', 'diff', 'Hit (1 = yes)'])
    expect(t[0]!.rowCount).toBe(2000)
    // Mean difference (first − second?) is ±2.
    expect(Math.abs(Math.abs((r.values['mean:diff'] as { v: number }).v) - 2)).toBeLessThan(0.1)
    // Deterministic; simulation i is the same whatever the number of simulations.
    const again = mc.run([], mc.params.parse({ ...(p as object), simulations: 50 }))
    const p50 = Array.from(
      (normalizeTable(again.table!)[0]!.data as { reps: Float64Array[] }).reps[0]!,
    )
    const p2000 = Array.from((t[0]!.data as { reps: Float64Array[] }).reps[0]!).slice(0, 50)
    expect(p50).toEqual(p2000)
  })

  it('checks the coverage of a fit’s confidence interval (hit: both conditions)', () => {
    const r0 = registry.get('simulateXY')!.run(
      [],
      registry.get('simulateXY')!.params.parse({
        equation: 'straight-line',
        xEnd: 9,
        dataSets: [{ values: { YIntercept: 1, Slope: 2 } }],
      }),
    )
    const key = normalizeTable(r0.table!)[0]!.ref.key
    const r = mc.run(
      [],
      mc.params.parse({
        simulation: {
          analysisId: 'simulateXY',
          params: {
            equation: 'straight-line',
            xEnd: 9,
            sd: 1,
            dataSets: [{ values: { YIntercept: 1, Slope: 2 } }],
          },
        },
        analysis: { analysisId: 'nonlinearFit', params: { equation: 'straight-line' } },
        simulations: 600,
        tabulate: [`Slope:${key}`],
        hits: {
          combine: 'both',
          conditions: [
            { value: `Slope:${key}:lo`, op: '<=', than: 2 },
            { value: `Slope:${key}:hi`, op: '>=', than: 2 },
          ],
        },
      }),
    )
    expect(r.status).toBe('ok')
    const f = (r.values.hitFraction as { v: number }).v
    expect(Math.abs(f - 0.95)).toBeLessThan(4 * Math.sqrt((0.95 * 0.05) / 600))
    expect(equation('straight-line')).toBeDefined()
  })

  it('explains what’s missing', () => {
    expect(mc.run([], mc.params.parse({ tabulate: [], hits: { conditions: [] } })).status).toBe(
      'error',
    )
    expect(
      mc.run([], mc.params.parse({ analysis: { analysisId: 'nope' }, tabulate: ['p'] })).status,
    ).toBe('error')
  })
})
