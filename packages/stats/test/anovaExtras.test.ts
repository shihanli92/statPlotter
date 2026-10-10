import { describe, expect, it } from 'vitest'
import {
  cohensD,
  cohensDz,
  effectSizes,
  factorialAnova,
  type GroupData,
  hedgesJ,
  linearTrend,
  mean,
  multipleComparisons,
  oneWayAnova,
  sd,
  twoWayAnova,
} from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'

const asGroups = (groups: number[][], summary = false): GroupData[] =>
  groups.map((v) => (summary ? { mean: mean(v), sd: sd(v), n: v.length } : { values: v }))

describe('test for linear trend vs R', () => {
  for (const f of loadFixtures<{ groups: number[][] }>('trend')) {
    it(f.name, () => {
      const summary = !!(f.params as { summary?: boolean }).summary
      expectDeepClose(linearTrend(asGroups(f.input.groups, summary)), f.expected, f.tol)
    })
  }
})

describe('Newman-Keuls vs R', () => {
  for (const f of loadFixtures<{ groups: number[][] }>('newman_keuls')) {
    it(f.name, () => {
      const g = f.input.groups
      const aov = oneWayAnova(asGroups(g))
      const pairs: [number, number][] = []
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) pairs.push([i, j])
      const rows = multipleComparisons(
        aov.groups.map((x) => ({ mean: x.mean, n: x.n })),
        pairs,
        { method: 'newman-keuls', mse: aov.msWithin, df: aov.dfWithin },
      )
      const e = f.expected as Record<string, unknown[]>
      rows.forEach((r, k) => {
        expect(r.df).toBe(e.df as unknown as number)
        for (const key of ['diff', 'se', 'stat', 'p'] as const)
          expectClose(r[key], e[key]![k] as number, f.tol, `${key}[${k}]`)
        expect(r.significant).toBe(e.significant![k])
        expect(r.lo).toBeNaN()
      })
    })
  }
})

describe('effect sizes vs R', () => {
  for (const f of loadFixtures<Record<string, unknown>>('effect_sizes')) {
    it(f.name, () => {
      const inp = f.input
      if (inp.groups) {
        const a = oneWayAnova(asGroups(inp.groups as number[][]))
        const got = effectSizes(
          { ss: a.ssBetween, df: a.dfBetween },
          { ss: a.ssWithin, df: a.dfWithin },
          a.ssTotal,
          a.dfBetween + a.dfWithin + 1,
        )
        expectDeepClose(got, f.expected, f.tol)
      } else if (inp.cells) {
        const cells = (inp.cells as { row: number; col: number; values: number[] }[]).map((c) => ({
          row: c.row,
          col: c.col,
          values: c.values,
        }))
        const r = twoWayAnova(cells)
        const res = r.sources.at(-1)!
        const N = cells.reduce((s, c) => s + c.values.length, 0)
        const got = r.sources
          .slice(0, -1)
          .map((s) => effectSizes(s, { ss: res.ss, df: res.df }, r.ssTotal, N))
        const e = f.expected as Record<string, number[]>
        got.forEach((g, i) => {
          for (const k of Object.keys(e)) expectClose(g[k as keyof typeof g], e[k]![i]!, f.tol, k)
        })
      } else {
        const a = inp.a as number[]
        const b = inp.b as number[]
        const paired = !!(f.params as { paired?: boolean }).paired
        const s = (x: number[]) => ({ mean: mean(x), sd: sd(x), n: x.length })
        const d = b.map((y, i) => y - a[i]!)
        const got = paired ? cohensDz(mean(d), sd(d), d.length) : cohensD(s(a), s(b))
        expectDeepClose(got, f.expected, f.tol)
      }
    })
  }

  it('Hedges J tends to 1 and matches 1 − 3/(4df − 1) roughly', () => {
    expect(hedgesJ(1000)).toBeCloseTo(1, 2)
    expect(Math.abs(hedgesJ(10) - (1 - 3 / 39))).toBeLessThan(1e-3)
  })
})

interface ThreeWayExpected {
  sources: Record<string, number[]>
  effectSizes: Record<string, number[]>
  ssTotal: number
  mse: number
  dfResidual: number
  marginalMeans: number[][]
}

describe('three-way (factorial) ANOVA vs R', () => {
  for (const f of loadFixtures<{ cells: { levels: number[]; values: number[] }[] }>('threeway')) {
    it(f.name, () => {
      const summary = !!(f.params as { summary?: boolean }).summary
      const cells = f.input.cells.map((c) => ({
        levels: c.levels,
        ...(summary
          ? { mean: mean(c.values), sd: sd(c.values), n: c.values.length }
          : { values: c.values }),
      }))
      const L = [0, 1, 2].map((i) => Math.max(...cells.map((c) => c.levels[i]!)) + 1)
      const r = factorialAnova(cells, L)
      expect(r.error).toBeUndefined()
      const e = f.expected as unknown as ThreeWayExpected
      expect(r.sources.map((s) => s.factors.join(''))).toEqual([
        '0',
        '1',
        '2',
        '01',
        '02',
        '12',
        '012',
        '',
      ])
      for (const key of ['ss', 'df', 'ms', 'F', 'p', 'pctOfTotal'] as const)
        r.sources.forEach((s, i) => {
          expectClose(s[key], e.sources[key]![i]!, f.tol, `${key}[${i}]`)
        })
      expectClose(r.ssTotal, e.ssTotal, f.tol, 'ssTotal')
      expectClose(r.mse, e.mse, f.tol, 'mse')
      expect(r.dfResidual).toBe(e.dfResidual)
      expectDeepClose(r.marginalMeans, e.marginalMeans, f.tol, 'marginalMeans')
      const res = r.sources.at(-1)!
      r.sources.slice(0, -1).forEach((s, i) => {
        const got = effectSizes(s, res, r.ssTotal, r.N)
        for (const k of Object.keys(e.effectSizes))
          expectClose(got[k as keyof typeof got], e.effectSizes[k]![i]!, f.tol, `${k}[${i}]`)
      })
    })
  }

  it('two factors agree with the two-way ANOVA', () => {
    const cells = [
      { row: 0, col: 0, values: [1, 2, 3.5] },
      { row: 0, col: 1, values: [4, 5.5] },
      { row: 1, col: 0, values: [2, 2.2, 3, 4] },
      { row: 1, col: 1, values: [7, 6, 8.1] },
    ]
    const two = twoWayAnova(cells)
    const f = factorialAnova(
      cells.map((c) => ({ levels: [c.row, c.col], values: c.values })),
      [2, 2],
    )
    // two-way order: Interaction, Row, Column, Residual; factorial: Row, Column, Interaction.
    expectClose(f.sources[2]!.ss, two.sources[0]!.ss, { rtol: 1e-12 })
    expectClose(f.sources[0]!.p, two.sources[1]!.p, { rtol: 1e-12 })
    expectClose(f.sources[1]!.F, two.sources[2]!.F, { rtol: 1e-12 })
    const empty = factorialAnova([{ levels: [0, 0], values: [1, 2] }], [2, 2])
    expect(empty.error).toBe('empty-cells')
  })

  it('zero residual variation: interactions zero within rounding have no F (audit 3, S2)', () => {
    const cells = []
    for (let a = 0; a < 2; a++)
      for (let b = 0; b < 2; b++)
        for (let c = 0; c < 3; c++) {
          const m = 0.3 * a + 0.11 * b + 0.7 * c
          cells.push({ levels: [a, b, c], values: [m, m, m] })
        }
    const r = factorialAnova(cells, [2, 2, 3])
    for (const s of r.sources.slice(0, 3)) expect(s.F).toBe(Number.POSITIVE_INFINITY)
    for (const s of r.sources.slice(3, -1)) {
      expect(s.ss).toBe(0)
      expect(s.F).toBeNaN()
      expect(s.p).toBeNaN()
    }
  })
})
