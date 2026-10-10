import { describe, expect, it } from 'vitest'
import {
  type McMethod,
  type McRow,
  multipleComparisons,
  oneWayRM,
  type RepeatedFactor,
  rmComparisons,
  type TwoWayRMComparisonSpec,
  tTestPaired,
  twoWayRM,
  twoWayRMComparisons,
} from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'
import { arr, type CmpExpected, expectRows, nanRows, toData } from './rmHelpers.ts'

interface OwCmp extends CmpExpected {
  sphericity: 'assumed' | 'gg'
  i: number[]
  j: number[]
}

interface OwExpected {
  kind: string
  treatment: Record<string, number>
  epsilon: number
  corrected?: Record<string, number>
  table: Record<string, number[]>
  matching: Record<string, number | boolean>
  rSquared: number
  means: number[]
  n: number[]
  comparisons: OwCmp[]
}

describe('repeated-measures one-way ANOVA vs R', () => {
  for (const f of loadFixtures<{ rows: (number | null)[][] }, OwExpected>('rmanova')) {
    if (f.params.design !== 'oneway') continue
    it(f.name, () => {
      const rows = nanRows(f.input.rows)
      const sph = f.params.sphericity as 'assumed' | 'gg'
      const res = oneWayRM(rows, { sphericity: sph })
      const e = f.expected
      expect(res.kind).toBe('anova')
      expect(res.error).toBeUndefined()
      const { comparisons, table, ...rest } = e
      expectDeepClose(res, rest, f.tol)
      const got: Record<string, number[]> = {}
      for (const k of Object.keys(table)) got[k] = res.table!.map((s) => s[k as 'ss'] as number)
      expectDeepClose(got, table, f.tol, 'table')
      expect(res.table!.map((s) => s.name)).toEqual([
        'Treatment',
        'Individual',
        'Residual',
        'Total',
      ])
      for (const c of comparisons) {
        const r = c.sphericity === sph ? res : oneWayRM(rows, { sphericity: c.sphericity })
        const i = arr(c.i)
        const j = arr(c.j)
        const pairs = i.map((v, k) => [v, j[k]!] as [number, number])
        const mc = rmComparisons(rows, r, pairs, { method: c.method as McMethod })
        expectRows(mc, c, f.tol ?? {}, `${c.sphericity} ${c.method}`)
      }
    })
  }
})

interface TwExpected {
  kind: string
  sources: Record<string, unknown>[]
  cellMeans: number[][]
  cellN: number[][]
  comparisons: (CmpExpected & TwoWayRMComparisonSpec & { ddf: 'containment' | 'satterthwaite' })[]
}

describe('repeated-measures two-way ANOVA vs R', () => {
  for (const f of loadFixtures<Parameters<typeof toData>[0], TwExpected>('rmanova')) {
    if (f.params.design !== 'twoway') continue
    it(f.name, () => {
      const data = toData(f.input)
      const repeated = f.params.repeated as RepeatedFactor
      const sphericity = f.params.sphericity as 'assumed' | 'gg'
      const res = twoWayRM(data, repeated, { sphericity })
      expect(res.kind).toBe('anova')
      expect(res.error).toBeUndefined()
      const e = f.expected
      expect(res.sources.map((s) => s.key)).toEqual(e.sources.map((s) => s.key))
      e.sources.forEach((s, k) => {
        expectDeepClose(res.sources[k], s, f.tol, String(s.key))
        if (!('epsilon' in s)) expect(res.sources[k]!.epsilon).toBeUndefined()
      })
      expectDeepClose(res.cellMeans, e.cellMeans, f.tol, 'cellMeans')
      expect(res.cellN).toEqual(e.cellN)
      for (const c of e.comparisons) {
        const r = twoWayRM(data, repeated, { sphericity, ddf: c.ddf })
        const mc = twoWayRMComparisons(data, r, c)
        expectRows(mc, c, f.tol ?? {}, `${c.ddf} ${c.family} ${c.kind} ${c.method}`)
      }
    })
  }
})

describe('repeated-measures ANOVA behaviour', () => {
  const rows = [
    [12, 14, 15, 19],
    [10, 13, 13, 15],
    [9, 11, 14, 16],
    [13, 15, 17, 18],
    [8, 9, 12, 14],
    [11, 14, 13, 17],
  ]

  it('two treatments: F = paired t², ε = 1, GG changes nothing', () => {
    const two = rows.map((r) => [r[0]!, r[3]!])
    const res = oneWayRM(two, { sphericity: 'gg' })
    const t = tTestPaired(
      two.map((r) => r[0]!),
      two.map((r) => r[1]!),
    )
    expectClose(res.treatment.F, t.t ** 2, { rtol: 1e-12 })
    expectClose(res.treatment.p, t.p, { rtol: 1e-10 })
    expectClose(res.epsilon!, 1, { rtol: 1e-14 })
    expectClose(res.corrected!.p, res.treatment.p, { rtol: 1e-12 })
  })

  it('pooled comparisons equal multipleComparisons with MS_residual', () => {
    const res = oneWayRM(rows)
    const pairs: [number, number][] = [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ]
    const cells = res.means.map((mean) => ({ mean, n: rows.length }))
    const opts = { mse: res.table![2]!.ms, df: res.table![2]!.df }
    for (const method of ['tukey', 'sidak', 'holm-sidak', 'bky', 'fisher', 'bonferroni'] as const) {
      const a = rmComparisons(rows, res, pairs, { method, nMeans: 4 })
      const b = multipleComparisons(cells, pairs, { method, ...opts, nMeans: 4 })
      a.forEach((r, k) => {
        for (const key of ['diff', 'se', 'stat', 'p', 'lo', 'hi'] as const) {
          expectClose(r[key], b[k]![key], { rtol: 1e-12, atol: 1e-15 }, `${method} ${key}`)
        }
      })
    }
    const dp: [number, number][] = [
      [0, 1],
      [0, 2],
      [0, 3],
    ]
    const a = rmComparisons(rows, res, dp, { method: 'dunnett' })
    const b = multipleComparisons(cells, dp, { method: 'dunnett', control: 0, ...opts })
    a.forEach((r, k) => {
      expectClose(r.p, b[k]!.p, { rtol: 1e-10 }, 'dunnett p')
      expectClose(r.lo, b[k]!.lo, { rtol: 1e-10 }, 'dunnett lo')
    })
  })

  it('paired (GG) comparisons are paired t tests', () => {
    const res = oneWayRM(rows, { sphericity: 'gg' })
    const [row] = rmComparisons(rows, res, [[3, 1]], { method: 'fisher' }) as [McRow]
    // tTestPaired(a, b) tests b − a
    const t = tTestPaired(
      rows.map((r) => r[1]!),
      rows.map((r) => r[3]!),
    )
    expectClose(row.stat, t.t, { rtol: 1e-12 })
    expectClose(row.p, t.p, { rtol: 1e-10 })
    expectClose(row.lo, t.ciLo, { rtol: 1e-10 })
  })

  it('shape errors throw; degenerate data give NaN', () => {
    expect(() => oneWayRM([[1, 2], [3]])).toThrow(RangeError)
    const one = oneWayRM([[1, 2, 3]])
    expect(one.error).toBe('too-few')
    expect(Number.isNaN(one.treatment.p)).toBe(true)
    const flat = oneWayRM([
      [2, 2, 2],
      [3, 3, 3],
    ])
    expect(Number.isNaN(flat.treatment.F)).toBe(true)
    expect(oneWayRM([]).error).toBe('too-few')
    const empty = oneWayRM([
      [1, Number.NaN],
      [2, Number.NaN],
      [3, Number.NaN],
    ])
    expect(empty.kind).toBe('mixed')
    expect(empty.error).toBe('empty-treatment')
    expect(Number.isNaN(empty.treatment.p)).toBe(true)
    expect(empty.means[0]).toBe(2)
  })

  it('rows with no values are ignored', () => {
    const a = oneWayRM(rows)
    const b = oneWayRM([...rows, [Number.NaN, Number.NaN, Number.NaN, Number.NaN]])
    expect(b.kind).toBe('anova')
    expectClose(b.treatment.F, a.treatment.F, { rtol: 1e-15 })
  })

  const split = (() => {
    const d: { y: number[]; row: number[]; col: number[]; subject: number[] } = {
      y: [],
      row: [],
      col: [],
      subject: [],
    }
    let s = 0
    for (let g = 0; g < 2; g++) {
      for (let k = 0; k < 4; k++) {
        for (let t = 0; t < 3; t++) {
          d.y.push(10 + g + t * (1 + g) + ((s * 7) % 5) * 0.8 + ((s + t * 3) % 4) * 0.3)
          d.row.push(g)
          d.col.push(t)
          d.subject.push(s)
        }
        s++
      }
    }
    return d
  })()

  it('two-way: invalid shapes throw', () => {
    expect(() => twoWayRM({ ...split, y: split.y.slice(1) }, 'columns')).toThrow(RangeError)
    expect(() => twoWayRM({ ...split, row: split.row.map((r) => r - 0.5) }, 'columns')).toThrow(
      RangeError,
    )
    // subject 0 in two rows
    const bad = { ...split, row: split.row.map((r, i) => (i === 0 ? 1 : r)) }
    expect(() => twoWayRM(bad, 'columns')).toThrow(RangeError)
    const dup = { ...split, col: split.col.map((c, i) => (i === 1 ? 0 : c)) }
    expect(() => twoWayRM(dup, 'columns')).toThrow(RangeError)
  })

  it('two-way: repeated rows is repeated columns transposed', () => {
    const a = twoWayRM(split, 'columns')
    const b = twoWayRM({ ...split, row: split.col, col: split.row }, 'rows')
    const find = (r: typeof a, k: string) => r.sources.find((s) => s.key === k)!
    expectClose(find(b, 'row').F, find(a, 'column').F, { rtol: 1e-12 })
    expectClose(find(b, 'column').F, find(a, 'row').F, { rtol: 1e-12 })
    expectClose(find(b, 'interaction').p, find(a, 'interaction').p, { rtol: 1e-12 })
  })

  it('two-way: one subject per group gives NaN, not a throw', () => {
    const one = {
      y: [1, 2, 3, 2, 4, 5],
      row: [0, 0, 0, 1, 1, 1],
      col: [0, 1, 2, 0, 1, 2],
      subject: [0, 0, 0, 1, 1, 1],
    }
    const r = twoWayRM(one, 'columns')
    expect(r.error).toBe('no-residual-df')
    expect(r.sources.every((s) => Number.isNaN(s.p))).toBe(true)
    const c = twoWayRMComparisons(one, r, {
      family: 'withinRows',
      kind: 'allPairs',
      method: 'tukey',
    })
    expect(c.every((x) => Number.isNaN(x.p))).toBe(true)
  })

  it('two-way comparisons: vsControl orientation and single family', () => {
    const r = twoWayRM(split, 'columns')
    const c = twoWayRMComparisons(split, r, {
      family: 'withinRows',
      kind: 'vsControl',
      method: 'dunnett',
      control: 2,
    })
    expect(c.map((x) => [x.rowA, x.colA, x.colB])).toEqual([
      [0, 2, 0],
      [0, 2, 1],
      [1, 2, 0],
      [1, 2, 1],
    ])
    const per = twoWayRMComparisons(split, r, {
      family: 'withinRows',
      kind: 'allPairs',
      method: 'sidak',
    })
    const all = twoWayRMComparisons(split, r, {
      family: 'withinRows',
      kind: 'allPairs',
      method: 'sidak',
      singleFamily: true,
    })
    all.forEach((x, k) => {
      expect(x.p).toBeGreaterThanOrEqual(per[k]!.p)
    })
  })
})
