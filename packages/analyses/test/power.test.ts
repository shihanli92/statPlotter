import { normalizeTable } from '@ps/model'
import { powerAnova, powerT, solveSampleSize } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { powerAnalysisDef } from '../src/index.ts'
import { columnTable, kvOf, v } from './helpers.ts'

const run = (p: Record<string, unknown>, input = normalizeTable(columnTable([[1, 2]]))) =>
  powerAnalysisDef.run(input, powerAnalysisDef.params.parse(p))

describe('sample size and power', () => {
  it('finds the sample size per group of an unpaired t test', () => {
    const r = run({ difference: 5, sd: 8, power: 0.8 }, [])
    const exact = solveSampleSize((n) => powerT(n, 5, 8, 0.05, 'two'), 0.8)
    expect(v(kvOf(r, 'Sample size per group (exact)'))).toBe(exact)
    expect(v(kvOf(r, 'Sample size per group'))).toBe(Math.ceil(exact))
    expect(v(kvOf(r, 'Total sample size'))).toBe(2 * Math.ceil(exact))
    const curve = r.outputs.curve!
    expect(curve.y.every((p, i) => i === 0 || p >= curve.y[i - 1]!)).toBe(true)
  })

  it('computes power from Cohen’s f for one-way ANOVA', () => {
    const r = run(
      { design: 'anova', solveFor: 'power', n: 12, groups: 4, anovaInput: 'cohensF', cohensF: 0.4 },
      [],
    )
    expect(v(kvOf(r, 'Power'))).toBeCloseTo(powerAnova(12, 4, (0.16 * 4) / 3, 1, 0.05), 14)
  })

  it('estimates the effect from pilot data', () => {
    const t = normalizeTable(
      columnTable([
        [10, 12, 11, 13, 9],
        [14, 15, 13, 17, 16],
      ]),
    )
    const r = run({ fromData: true, solveFor: 'power', n: 5 }, t)
    expect(v(kvOf(r, 'Difference to detect'))).toBeCloseTo(4, 12)
    expect(r.status).toBe('ok')
  })

  it('refuses a zero effect', () => {
    expect(run({ difference: 0 }, []).status).toBe('error')
  })
})
