import { describe, expect, it } from 'vitest'
import {
  type Alternative,
  pearsonCorrelation,
  permutationCorrelationP,
  spearmanCorrelation,
} from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'

interface Params {
  method: 'pearson' | 'spearman'
  alternative?: Alternative
  confLevel?: number
  exact?: 'auto' | boolean
  shift?: number
}

/** Exact P over all 18! pairings without ties: about 2 s alone, more under load. */
const SLOW = new Set(['spearman_n18_forced_exact'])

describe('correlation vs R', () => {
  for (const f of loadFixtures<{ x: number[]; y: number[] }>('correlation')) {
    it(f.name, { timeout: SLOW.has(f.name) ? 30_000 : undefined }, () => {
      const p = f.params as unknown as Params
      const opts = { alternative: p.alternative, confLevel: p.confLevel }
      const got =
        p.method === 'pearson'
          ? pearsonCorrelation(f.input.x, f.input.y, opts)
          : spearmanCorrelation(f.input.x, f.input.y, { ...opts, exact: p.exact })
      expectDeepClose(got, f.expected, f.tol)
    })
  }
})

/** All n! pairings, by brute force (small n). */
function brute(a: number[], b: number[], alternative: Alternative): number {
  const n = a.length
  const t0 = a.reduce((s, v, i) => s + v * b[i]!, 0)
  const nE = a.reduce((s, v) => s + v, 0) * b.reduce((s, v) => s + v, 0)
  let hit = 0
  let total = 0
  const perm = b.slice()
  const rec = (k: number) => {
    if (k === n) {
      const t = a.reduce((s, v, i) => s + v * perm[i]!, 0)
      total++
      const ok =
        alternative === 'greater'
          ? t >= t0
          : alternative === 'less'
            ? t <= t0
            : Math.abs(n * t - nE) >= Math.abs(n * t0 - nE)
      if (ok) hit++
      return
    }
    for (let i = k; i < n; i++) {
      ;[perm[k], perm[i]] = [perm[i]!, perm[k]!]
      rec(k + 1)
      ;[perm[k], perm[i]] = [perm[i]!, perm[k]!]
    }
  }
  rec(0)
  return hit / total
}

describe('correlation invariants', () => {
  it('permutation DP matches brute force with ties in both variables', () => {
    const a = [2, 2, 5, 8, 8, 8, 13, 16]
    const b = [4, 9, 9, 1, 12, 9, 7, 7]
    for (const alt of ['two-sided', 'greater', 'less'] as const) {
      expectClose(permutationCorrelationP(a, b, alt), brute(a, b, alt), { rtol: 1e-14 }, alt)
    }
  })

  it('Spearman exact P for perfect order is 2/n!', () => {
    const r = spearmanCorrelation([1, 2, 3, 4, 5, 6], [2, 4, 8, 16, 32, 64])
    expect(r.r).toBe(1)
    expectClose(r.p, 2 / 720, { rtol: 1e-15 }, 'p')
    expect(r.lower).toBe(1)
  })

  it('Spearman: 17 pairs exact, 18 pairs t approximation', () => {
    // Ties in y keep the exact distribution small (without them n = 17 takes a second).
    const x = Array.from({ length: 18 }, (_, i) => i)
    const y = x.map((v) => v % 3)
    expect(spearmanCorrelation(x.slice(0, 17), y.slice(0, 17)).exact).toBe(true)
    expect(spearmanCorrelation(x, y).exact).toBe(false)
  })

  it('the one- and two-sided P of the same data share one exact distribution', () => {
    const x = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]
    const y = [2, 7, 1, 8, 2, 8, 1, 8, 2, 8]
    // Built for 'less', reused for the others; a different data set in between replaces it.
    const less = spearmanCorrelation(x, y, { alternative: 'less' }).p
    const two = spearmanCorrelation(x, y).p
    spearmanCorrelation([1, 2, 3, 4], [4, 1, 3, 2])
    expect(spearmanCorrelation(x, y).p).toBe(two)
    expect(spearmanCorrelation(x, y, { alternative: 'less' }).p).toBe(less)
  })

  it('unequal lengths throw; tiny n gives NaN', () => {
    expect(() => pearsonCorrelation([1, 2], [1])).toThrow(RangeError)
    expect(pearsonCorrelation([1, 2], [3, 4]).p).toBeNaN()
    expect(spearmanCorrelation([1], [2]).r).toBeNaN()
  })
})
