import { describe, expect, it } from 'vitest'
import { dunnFriedmanComparisons, friedmanTest } from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'

interface Params {
  exact?: 'auto' | boolean
}

function allPairs(k: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) out.push([i, j])
  return out
}

describe('Friedman test vs R', () => {
  for (const f of loadFixtures<{ rows: number[][] }>('friedman')) {
    it(f.name, () => {
      const p = f.params as Params
      const res = friedmanTest(f.input.rows, { exact: p.exact })
      const pairs = allPairs(res.k)
      const dunn = {
        none: dunnFriedmanComparisons(res, pairs, { method: 'none' }),
        bonferroni: dunnFriedmanComparisons(res, pairs, { method: 'bonferroni' }),
        sidak: dunnFriedmanComparisons(res, pairs, { method: 'sidak' }),
      }
      expectDeepClose({ ...res, dunn }, f.expected, f.tol)
    })
  }
})

describe('Friedman invariants', () => {
  it('k = 2: exact P is the two-sided sign test', () => {
    // 7 of 8 rows favour column 2: P = 2·(1 + 8)/2^8.
    const rows = [
      [1, 2],
      [3, 5],
      [2, 2.5],
      [4, 4.1],
      [6, 7],
      [1, 3],
      [5, 4],
      [2, 9],
    ]
    const r = friedmanTest(rows)
    expectClose(r.pExact!, (2 * 9) / 256, { rtol: 1e-15 }, 'pExact')
  })

  it('the (k!)^n ≤ 1e9 rule', () => {
    const rows = (n: number, k: number) =>
      Array.from({ length: n }, (_, i) => Array.from({ length: k }, (_, j) => (i * 7 + j * 3) % 5))
    expect(friedmanTest(rows(11, 3)).pExact).not.toBeNull()
    expect(friedmanTest(rows(12, 3)).pExact).toBeNull()
    expect(friedmanTest(rows(1, 12)).pExact).toBe(1)
  })

  it('family size widens the Bonferroni adjustment', () => {
    const res = friedmanTest([
      [1, 2, 3],
      [1, 3, 2],
      [1, 2, 3],
      [2, 1, 3],
    ])
    const [a] = dunnFriedmanComparisons(res, [[0, 2]], { method: 'bonferroni', family: 3 })
    expectClose(a!.pAdj, Math.min(1, 3 * a!.p), { rtol: 1e-15 }, 'pAdj')
  })

  it('ragged rows throw; empty and single-column designs give NaN', () => {
    expect(() => friedmanTest([[1, 2], [3]])).toThrow(RangeError)
    expect(friedmanTest([]).stat).toBeNaN()
    expect(friedmanTest([[1], [2]]).p).toBeNaN()
  })
})
