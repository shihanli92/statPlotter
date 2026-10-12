import { describe, expect, it } from 'vitest'
import { arrangements, KW_EXACT_LIMIT, kruskalWallis, kruskalWallisExact } from '../src/index.ts'
import { expectClose, loadFixtures } from './oracle.ts'
import { cpuRatio } from './timing.ts'

// Roadmap 51c (S11): the Kruskal-Wallis test's exact P, against R's enumeration (suite
// `kw_exact`, cross-checked there with coin's Monte Carlo).

describe('exact Kruskal-Wallis P vs R', () => {
  for (const f of loadFixtures<
    { groups: number[][] },
    { p: number; arrangements: number; pApprox: number }
  >('kw_exact')) {
    it(f.name, () => {
      const r = kruskalWallisExact(f.input.groups)!
      expect(r).not.toBeNull()
      expect(r.arrangements).toBe(f.expected.arrangements)
      expectClose(r.p, f.expected.p, f.tol, 'exact P')
      expectClose(kruskalWallis(f.input.groups).p, f.expected.pApprox, f.tol, 'chi-square P')
    })
  }
})

describe('exact Kruskal-Wallis P: limits', () => {
  it('counts the arrangements, and declines above the limit', () => {
    expect(arrangements([3, 3, 3])).toBe(1680)
    expect(arrangements([5, 5, 6])).toBe(2018016)
    const big = [0, 1, 2].map((j) => Array.from({ length: 7 }, (_, i) => i * 3 + j))
    expect(arrangements([7, 7, 7])).toBeGreaterThan(KW_EXACT_LIMIT)
    expect(kruskalWallisExact(big)).toBeNull()
    // Empty groups are left out; one group has no test.
    expect(kruskalWallisExact([[1, 2], [], [3, 4]])!.arrangements).toBe(6)
    expect(kruskalWallisExact([[1, 2, 3]])).toBeNull()
  })

  it('is P = 1 when every value ties, and 1/arrangements-ish at full separation', () => {
    expect(
      kruskalWallisExact([
        [5, 5],
        [5, 5],
        [5, 5],
      ])!.p,
    ).toBe(1)
    // Fully separated groups of 3: only the 3! orderings of the groups reach the maximum.
    const r = kruskalWallisExact([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ])!
    expect(r.p).toBeCloseTo(6 / 1680, 15)
  })

  it('costs about the same per arrangement at 2e6 and 1.7e7 arrangements (timing guard)', () => {
    const g = (sizes: number[]) =>
      sizes.map((n, j) => Array.from({ length: n }, (_, i) => Math.sin(7 * j + 3 * i)))
    const small = g([5, 5, 6])
    const large = g([6, 6, 6])
    const per = arrangements([6, 6, 6]) / arrangements([5, 5, 6])
    const ratio = cpuRatio(
      () => kruskalWallisExact(small),
      () => kruskalWallisExact(large),
      2,
    )
    expect(ratio / per).toBeLessThan(2)
  }, 60_000)
})
