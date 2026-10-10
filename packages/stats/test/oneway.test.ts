import { describe, expect, it } from 'vitest'
import {
  brownForsytheAnova,
  type GroupData,
  kruskalWallis,
  mean,
  oneWayAnova,
  sd,
  tTestUnpaired,
  welchAnova,
} from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'

interface Params {
  summary?: boolean
  shift?: number
}

function asGroups(groups: number[][], summary: boolean): GroupData[] {
  return groups.map((v) => (summary ? { mean: mean(v), sd: sd(v), n: v.length } : { values: v }))
}

describe('one-way ANOVA vs R', () => {
  for (const f of loadFixtures<{ groups: (number | null)[][] }>('oneway')) {
    it(f.name, () => {
      const p = f.params as Params
      // An empty cell (null; audit 3, S8) is left out of its group, as R and the analyses do
      // (analyses/test/oracleMissing.test.ts runs those cases through the analysis).
      const groups = f.input.groups.map((v) => v.filter((x) => x !== null))
      const g = asGroups(groups, p.summary ?? false)
      const a = oneWayAnova(g)
      const {
        welch,
        brownForsytheAnova: bf,
        kruskalWallis: kw,
        brownForsythe,
        ...rest
      } = f.expected as Record<string, unknown>
      // Raw data only for the Levene-type test.
      expectDeepClose(a, rest, f.tol)
      if (p.summary) expect(a.brownForsythe).toBeNull()
      else expectDeepClose(a.brownForsythe, brownForsythe, f.tol, 'brownForsythe')
      expectDeepClose(welchAnova(g), welch, f.tol, 'welch')
      expectDeepClose(brownForsytheAnova(g), bf, f.tol, 'brownForsytheAnova')
      expectDeepClose(kruskalWallis(groups), kw, f.tol, 'kruskalWallis')
    })
  }
})

describe('one-way ANOVA invariants', () => {
  const a = [3.1, 4.2, 5.0, 2.8, 3.9]
  const b = [5.1, 6.3, 4.8, 7.2, 5.9, 6.0]

  it('two groups: F = t², same P', () => {
    const r = oneWayAnova([{ values: a }, { values: b }])
    const t = tTestUnpaired(a, b)
    expectClose(r.F, t.t * t.t, { rtol: 1e-13 }, 'F')
    expectClose(r.p, t.p, { rtol: 1e-12 }, 'p')
  })

  it('summary input gives the same results as raw data', () => {
    const groups = [a, b, [1, 2, 3.5, 2.2]]
    const raw = oneWayAnova(groups.map((v) => ({ values: v })))
    const sum = oneWayAnova(groups.map((v) => ({ mean: mean(v), sd: sd(v), n: v.length })))
    expectClose(sum.F, raw.F, { rtol: 1e-13 }, 'F')
    expectClose(sum.p, raw.p, { rtol: 1e-13 }, 'p')
    expectClose(sum.bartlett!.chi2, raw.bartlett!.chi2, { rtol: 1e-13 }, 'chi2')
    expect(sum.brownForsythe).toBeNull()
  })

  it('rounding noise is no variation (audit 3, S2)', () => {
    // 0.1 + 0.2 ≠ 0.3 in binary: a within-group SS of ~1e-33 gave F ≈ 1e32.
    const r = oneWayAnova([{ values: [0.1 + 0.2, 0.3] }, { values: [1, 1] }])
    expect(r.ssWithin).toBe(0)
    expect(r.F).toBe(Number.POSITIVE_INFINITY)
    expect(r.p).toBe(0)
  })

  it('degenerate input does not throw', () => {
    const r = oneWayAnova([{ values: [1, 1] }, { values: [2, 2] }])
    expect(r.F).toBe(Number.POSITIVE_INFINITY)
    expect(r.p).toBe(0)
    expect(r.bartlett).toBeNull()
    const one = oneWayAnova([{ values: [1, 2, 3] }])
    expect(one.F).toBeNaN()
    const empty = oneWayAnova([{ values: [1, 2, 3] }, { values: [] }, { values: [4, 5] }])
    expect(empty.dfBetween).toBe(1)
    expect(Number.isNaN(empty.groups[1]!.mean)).toBe(true)
    expect(
      kruskalWallis([
        [1, 1],
        [1, 1],
      ]).H,
    ).toBeNaN()
  })
})
