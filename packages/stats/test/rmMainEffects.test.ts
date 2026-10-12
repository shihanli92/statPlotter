import { describe, expect, it } from 'vitest'
import { type McMethod, type RepeatedFactor, twoWayRM, twoWayRMComparisons } from '../src/index.ts'
import { loadFixtures } from './oracle.ts'
import { type CmpExpected, expectRows, toData } from './rmHelpers.ts'

// Roadmap 51c (S10): main-effect comparisons of a repeated factor without sphericity, each with
// its own error term, against R (suite `rm_main_effects`).

describe('two-way RM main effects of a repeated factor, per-contrast errors, vs R', () => {
  for (const f of loadFixtures<Parameters<typeof toData>[0]>('rm_main_effects')) {
    it(f.name, () => {
      const p = f.params as {
        repeated: RepeatedFactor
        family: 'mainRows' | 'mainColumns'
      }
      const data = toData(f.input)
      const res = twoWayRM(data, p.repeated, { sphericity: 'gg' })
      expect(res.kind).toBe('anova')
      const e = f.expected as { comparisons: (CmpExpected & { kind: string })[] }
      for (const c of e.comparisons) {
        const got = twoWayRMComparisons(data, res, {
          family: p.family,
          kind: c.kind as 'allPairs' | 'vsControl',
          method: c.method as McMethod,
          perContrast: true,
        })
        expectRows(got, c, f.tol ?? {}, `${c.kind} ${c.method}`)
      }
      // Without `perContrast` the pooled error term (sphericity assumed) differs.
      const pooled = twoWayRMComparisons(data, res, {
        family: p.family,
        kind: 'allPairs',
        method: 'sidak',
      })
      const per = twoWayRMComparisons(data, res, {
        family: p.family,
        kind: 'allPairs',
        method: 'sidak',
        perContrast: true,
      })
      per.forEach((r, k) => {
        expect(r.diff).toBeCloseTo(pooled[k]!.diff, 12)
      })
      expect(per.some((r, k) => Math.abs(r.se - pooled[k]!.se) > 1e-9)).toBe(true)
    })
  }
})
