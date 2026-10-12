import { normalizeTable } from '@ps/model'
import { powerAnova, powerT, solveSampleSize } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { expectClose, loadFixtures } from '../../stats/test/oracle.ts'
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
    // Roadmap 51c (S29): power of the data at hand adds nothing to their P value.
    expect(r.status).toBe('warning')
    expect(r.diagnostics[0]!.message).toMatch(/adds nothing to the P value/)
    const n = run({ fromData: true, solveFor: 'n' }, t)
    expect(n.diagnostics[0]!.message).toMatch(/usually overestimates/)
    expect(() => kvOf(n, 'Sample size per group for the CI bound nearer zero')).not.toThrow()
  })

  // Roadmap 51c (S29): from pilot data, the effect's 95% CI and the n per group at its bound
  // nearer zero, against R (suite `power_pilot`: t.test's CI, power.t.test solved by uniroot).
  for (const f of loadFixtures<
    { a: number[]; b: number[] },
    Record<'delta' | 'sd' | 'ciLo' | 'ciHi' | 'nFor' | 'nBound' | 'nBoundCeiling', number>
  >('power_pilot')) {
    it(`pilot data: ${f.name}`, () => {
      const p = f.params as { type: 'two.sample' | 'paired'; alpha: number; target: number }
      const t = normalizeTable(columnTable([f.input.a, f.input.b]))
      const design = p.type === 'paired' ? 'pairedT' : 'unpairedT'
      const r = run({ design, fromData: true, solveFor: 'n', power: p.target, alpha: p.alpha }, t)
      const unit = p.type === 'paired' ? 'Number of pairs' : 'Sample size per group'
      expectClose(v(kvOf(r, `${unit} (exact)`)), f.expected.nFor, { rtol: 1e-8 }, 'n')
      const ci = kvOf(r, '95% CI of the pilot effect') as { lo: number; hi: number }
      expectClose(ci.lo, f.expected.ciLo, f.tol, 'CI lower')
      expectClose(ci.hi, f.expected.ciHi, f.tol, 'CI upper')
      const nb = kvOf(r, `${unit} for the CI bound nearer zero`)
      if (Number.isNaN(f.expected.nBoundCeiling)) expect(nb.kind).toBe('text')
      else expect(v(nb)).toBe(f.expected.nBoundCeiling)
    })
  }

  it('refuses a zero effect', () => {
    expect(run({ difference: 0 }, []).status).toBe('error')
  })
})
