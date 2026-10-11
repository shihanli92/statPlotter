import { describe, expect, it } from 'vitest'
import {
  type ClusterDistance,
  type ClusterLinkage,
  cutCount,
  cutree,
  hclust,
  rowDistances,
} from '../src/index.ts'
import { arr, expectClose, loadFixtures } from './oracle.ts'

// Roadmap 49c: a dendrogram layer's cut — R's cutree by k and by h, against suite `cutree`.

interface Input {
  rows: (number | null)[][]
}

interface Expected {
  merge: [number, number][]
  height: number | number[]
  order: number | number[]
  byK: number[][]
  h: number | number[]
  kOfH: number | number[]
  byH: number[][]
}

const toNaN = (rows: (number | null)[][]) => rows.map((r) => r.map((v) => v ?? Number.NaN))

describe('cutree vs R', () => {
  for (const f of loadFixtures<Input, Expected>('cutree')) {
    it(f.name, () => {
      const rows = toNaN(f.input.rows)
      const d = rowDistances(rows, f.params.distance as ClusterDistance)
      const hc = hclust(d, rows.length, f.params.linkage as ClusterLinkage)
      const e = f.expected
      // The same tree as R's.
      expect(hc.merge).toEqual(e.merge)
      expect(hc.order).toEqual(arr(e.order).map((i) => i - 1))
      const height = arr(e.height)
      height.forEach((v, i) => {
        expectClose(hc.height[i]!, v, f.tol, `height[${i}]`)
      })
      // By k: every row's cluster, numbered as R numbers them.
      const ks = arr(f.params.k as number | number[])
      expect(e.byK).toHaveLength(ks.length)
      ks.forEach((k, i) => {
        expect(cutree(hc, { k }), `k = ${k}`).toEqual(arr(e.byK[i]!))
        expect(cutCount(hc, { k })).toBe(k)
      })
      // By h: given heights as R had them; merge heights as our own tree has them (ties).
      const given = arr(f.params.h as number | number[])
      const at = arr(f.params.hAtMerge as number | number[])
      const hs = [...given, ...at.map((m) => hc.height[m - 1]!)]
      const rh = arr(e.h)
      expect(hs).toHaveLength(rh.length)
      hs.forEach((h, i) => {
        expectClose(h, rh[i]!, f.tol, `h[${i}]`)
        expect(cutCount(hc, { h }), `k at h = ${h}`).toBe(arr(e.kOfH)[i])
        expect(cutree(hc, { h }), `h = ${h}`).toEqual(arr(e.byH[i]!))
      })
    })
  }
})

describe('cutree', () => {
  it('refuses a k outside 1…n, as R stops', () => {
    const hc = hclust([1, 2, 3], 3, 'complete')
    expect(() => cutree(hc, { k: 0 })).toThrow(RangeError)
    expect(() => cutree(hc, { k: 4 })).toThrow(RangeError)
    expect(() => cutree(hc, { k: 1.5 })).toThrow(RangeError)
  })

  it('cuts trees of one object and of none', () => {
    expect(cutree(hclust([], 1, 'average'), { k: 1 })).toEqual([1])
    expect(cutree(hclust([], 1, 'average'), { h: 0 })).toEqual([1])
    expect(cutree(hclust([], 0, 'average'), { h: 0 })).toEqual([])
    expect(cutCount(hclust([], 0, 'average'), { h: 0 })).toBe(0)
  })

  it('a height below every merge leaves each object alone; above them, one cluster', () => {
    const hc = hclust([1, 4, 2], 3, 'complete')
    expect(cutree(hc, { h: 0.5 })).toEqual([1, 2, 3])
    expect(cutree(hc, { h: 10 })).toEqual([1, 1, 1])
  })
})
