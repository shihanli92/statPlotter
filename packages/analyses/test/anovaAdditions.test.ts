import {
  cohensD,
  effectSizes,
  linearTrend,
  multipleComparisons,
  oneWayAnova,
  twoWayAnova,
} from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { oneWayAnovaDef, ttest, twoWayAnovaDef } from '../src/index.ts'
import { columnTable, groupedTable, kvOf, runDef, tableBlock, v } from './helpers.ts'

const A = [4.2, 5.1, 3.9, 4.8, 5.5, 4.4]
const B = [6.1, 5.8, 7.2, 6.6, 5.9, 6.4]
const C = [5.0, 4.6, 5.9, 5.3, 4.9, 5.6]
const D = [7.0, 7.4, 6.8, 8.1]

const oneWay = (p: object, cols = [A, B, C, D]) => runDef(oneWayAnovaDef, columnTable(cols), p)

describe('one-way ANOVA additions', () => {
  it('reports eta squared, omega squared and Cohen’s f', () => {
    const r = oneWay({})
    const a = oneWayAnova([A, B, C, D].map((values) => ({ values })))
    const e = effectSizes(
      { ss: a.ssBetween, df: a.dfBetween },
      { ss: a.ssWithin, df: a.dfWithin },
      a.ssTotal,
      22,
    )
    expect(v(kvOf(r, 'Eta squared (R squared)'))).toBeCloseTo(a.r2, 14)
    expect(v(kvOf(r, 'Omega squared'))).toBeCloseTo(e.partialOmegaSquared, 14)
    expect(v(kvOf(r, 'Cohen’s f'))).toBeCloseTo(e.cohensF, 14)
  })

  it('test for linear trend (and nonlinear variation with four groups)', () => {
    const r = oneWay({ comparisons: 'trend' })
    expect(r.status).not.toBe('error')
    const t = linearTrend([A, B, C, D].map((values) => ({ values })))
    expect(v(kvOf(r, 'Slope'))).toBeCloseTo(t.slope, 14)
    expect(v(r.values['p.trend'])).toBeCloseTo(t.p, 14)
    expect(r.sheets.find((s) => s.key === 'trend')!.blocks).toHaveLength(2)
    expect(oneWay({ comparisons: 'trend' }, [A, B, C]).sheets.at(-1)!.blocks).toHaveLength(1)
    expect(oneWay({ comparisons: 'trend', equalSD: 'welch' }).status).toBe('error')
    expect(oneWay({ comparisons: 'trend', matched: true }).status).toBe('error')
  })

  it('Newman-Keuls: q, step-down P, no CI; refused with repeated measures', () => {
    const r = oneWay({ allPairsMethod: 'newman-keuls' })
    const b = tableBlock(r, 'comparisons')
    expect(b.columns).toEqual([
      'Comparison',
      'Mean Diff.',
      'q',
      'Significant?',
      'Summary',
      'Step-down P value',
    ])
    const a = oneWayAnova([A, B, C, D].map((values) => ({ values })))
    const pairs: [number, number][] = []
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) pairs.push([i, j])
    const mc = multipleComparisons(a.groups, pairs, {
      method: 'newman-keuls',
      mse: a.msWithin,
      df: a.dfWithin,
    })
    expect(b.rows.map((x) => v(x[5]))).toEqual(mc.map((m) => m.p))
    // Step-down: never less strict than Fisher's LSD, never stricter than Tukey.
    const tukey = multipleComparisons(a.groups, pairs, {
      method: 'tukey',
      mse: a.msWithin,
      df: a.dfWithin,
    })
    mc.forEach((m, k) => {
      expect(m.p).toBeLessThanOrEqual(tukey[k]!.p + 1e-12)
    })
    expect(oneWay({ allPairsMethod: 'newman-keuls', matched: true }).status).toBe('error')
  })
})

describe('two-way ANOVA effect sizes', () => {
  it('one row per source, from the Type III sums of squares', () => {
    const cells = [
      [
        [1, 2, 3.5],
        [4, 5.5, 6],
      ],
      [
        [2, 2.2, 3, 4],
        [7, 6, 8.1],
      ],
    ]
    const r = runDef(twoWayAnovaDef, groupedTable(cells))
    const b = r.sheets
      .find((s) => s.key === 'results')!
      .blocks.find((x) => x.type === 'table' && x.title === 'Effect sizes')!
    if (b.type !== 'table') throw new Error()
    const tw = twoWayAnova(
      cells.flatMap((row, ri) => row.map((values, ci) => ({ row: ri, col: ci, values }))),
    )
    const res = tw.sources.at(-1)!
    tw.sources.slice(0, -1).forEach((s, i) => {
      const e = effectSizes(s, res, tw.ssTotal, 13)
      expect(v(b.rows[i]![2])).toBeCloseTo(e.partialEtaSquared, 14)
      expect(v(b.rows[i]![3])).toBeCloseTo(e.partialOmegaSquared, 14)
    })
  })
})

describe('t test effect sizes', () => {
  it('unpaired: Cohen’s d, Hedges’ g, Glass’s delta; paired: d_z', () => {
    const t = columnTable([A, B])
    const r = runDef(ttest, t)
    const s = (x: number[]) => {
      const m = x.reduce((a, b) => a + b, 0) / x.length
      return {
        mean: m,
        sd: Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1)),
        n: x.length,
      }
    }
    const e = cohensD(s(A), s(B))
    // Roadmap 51c (S43): labelled with their standardizer, the pooled SD, under Welch too.
    expect(v(kvOf(r, 'Cohen’s d (pooled SD)'))).toBeCloseTo(e.cohensD, 12)
    expect(v(kvOf(r, 'Hedges’ g (pooled SD)'))).toBeCloseTo(e.hedgesG, 12)
    expect(v(kvOf(r, 'Glass’s delta (SD of Group A)'))).toBeCloseTo(e.glassDelta!, 12)
    const p = runDef(ttest, t, { design: 'paired' })
    const d = B.map((y, i) => y - A[i]!)
    const sdD = s(d)
    expect(v(kvOf(p, 'Cohen’s d (d_z: mean difference / SD of differences)'))).toBeCloseTo(
      sdD.mean / sdD.sd,
      12,
    )
  })
})
