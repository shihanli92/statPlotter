import { describe, expect, it } from 'vitest'
import {
  type ClusterDistance,
  type ClusterLinkage,
  hclust,
  rowDistances,
  zScores,
} from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { arr, expectClose, loadFixtures } from './oracle.ts'
import { minstd } from './rng.ts'
import { growthRatio } from './timing.ts'

interface Input {
  rows: (number | null)[][]
}

interface Expected {
  dist: number | number[]
  zRow: number[][]
  zCol: number[][]
  /** null when a distance is NaN (hclust refuses it). */
  merge: [number, number][] | null
  height: number | number[] | null
  /** 1-based, as R's hc$order. */
  order: number[] | null
}

const toNaN = (rows: (number | null)[][]) => rows.map((r) => r.map((v) => v ?? Number.NaN))

describe('clustering vs R', () => {
  for (const f of loadFixtures<Input, Expected>('cluster')) {
    it(f.name, () => {
      const rows = toNaN(f.input.rows)
      const distance = f.params.distance as ClusterDistance
      const linkage = f.params.linkage as ClusterLinkage
      const d = rowDistances(rows, distance)
      const e = f.expected
      const dist = arr(e.dist)
      expect(d.length).toBe(dist.length)
      dist.forEach((v, i) => {
        expectClose(d[i]!, v, f.tol, `dist[${i}]`)
      })
      expectDeepClose(zScores(rows, 'row'), e.zRow, f.tol, 'zRow')
      expectDeepClose(zScores(rows, 'column'), e.zCol, f.tol, 'zCol')
      if (e.merge === null || e.height === null || e.order === null) {
        expect(() => hclust(d, rows.length, linkage)).toThrow(RangeError)
        return
      }
      const hc = hclust(d, rows.length, linkage)
      expect(hc.merge).toEqual(e.merge)
      expect(hc.order).toEqual(arr(e.order).map((i) => i - 1))
      const height = arr(e.height)
      expect(hc.height).toHaveLength(height.length)
      height.forEach((v, i) => {
        expectClose(hc.height[i]!, v, f.tol, `height[${i}]`)
      })
    })
  }
})

function randomRows(n: number, p: number, seed: number): number[][] {
  const rnd = minstd(seed)
  return Array.from({ length: n }, () => Array.from({ length: p }, () => rnd()))
}

describe('hclust properties', () => {
  it('n = 0, 1 and 2', () => {
    expect(hclust(new Float64Array(0), 0, 'complete')).toEqual({ merge: [], height: [], order: [] })
    expect(hclust(new Float64Array(0), 1, 'ward')).toEqual({ merge: [], height: [], order: [0] })
    expect(hclust([3], 2, 'average')).toEqual({ merge: [[-1, -2]], height: [3], order: [0, 1] })
    expect(hclust([3], 2, 'ward').height).toEqual([3])
    expect(rowDistances([], 'euclidean')).toHaveLength(0)
    expect(rowDistances([[1, 2]], 'pearson')).toHaveLength(0)
    expect(zScores([], 'row')).toEqual([])
    expect(zScores([], 'column')).toEqual([])
  })

  it('rejects non-finite distances and a wrong length', () => {
    expect(() => hclust([1, Number.NaN, 2], 3, 'complete')).toThrow(RangeError)
    expect(() => hclust([1, Number.POSITIVE_INFINITY, 2], 3, 'ward')).toThrow(RangeError)
    expect(() => hclust([1, 2], 3, 'average')).toThrow(RangeError)
  })

  it('does not modify the distances', () => {
    const d = rowDistances(randomRows(10, 3, 7), 'euclidean')
    const copy = Float64Array.from(d)
    hclust(d, 10, 'ward')
    expect(d).toEqual(copy)
  })

  for (const linkage of ['complete', 'average', 'ward'] as const) {
    for (const distance of ['euclidean', 'pearson'] as const) {
      it(`${linkage} / ${distance}: monotone heights, a permutation order, a valid merge`, () => {
        const n = 60
        const hc = hclust(rowDistances(randomRows(n, 5, 11), distance), n, linkage)
        for (let i = 1; i < hc.height.length; i++) {
          expect(hc.height[i]!).toBeGreaterThanOrEqual(hc.height[i - 1]!)
        }
        expect([...hc.order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i))
        // Each singleton and each earlier step is used exactly once.
        const used = new Set<number>()
        hc.merge.forEach(([a, b], step) => {
          for (const x of [a, b]) {
            expect(x < 0 ? -x <= n : x <= step).toBe(true)
            expect(used.has(x)).toBe(false)
            used.add(x)
          }
        })
        expect(used.size).toBe(2 * (n - 1))
      })
    }
  }

  it('stays quadratic', () => {
    const rows = randomRows(1600, 4, 5)
    const run = (n: number) => {
      const d = rowDistances(rows.slice(0, n), 'euclidean')
      hclust(d, n, 'average')
    }
    // Quadratic work gives about 16 for a 4-fold size; cubic would give 64.
    expect(growthRatio(run, 400)).toBeLessThan(32)
  })
})

describe('zScores', () => {
  it('standardizes over the non-missing values; constant lines are NaN', () => {
    const z = zScores(
      [
        [1, 2, 3],
        [5, Number.NaN, 7],
        [4, 4, 4],
      ],
      'row',
    )
    expect(z[0]).toEqual([-1, 0, 1])
    expect(z[1]![1]).toBeNaN()
    expectClose(z[1]![0]!, -Math.SQRT1_2)
    expect(z[2]!.every(Number.isNaN)).toBe(true)
    const c = zScores([[1, 2], [3]], 'column')
    expect(c[0]![0]).toBeCloseTo(-Math.SQRT1_2, 15)
    expect(c[0]![1]).toBeNaN()
    expect(c[1]![1]).toBeNaN()
  })
})
