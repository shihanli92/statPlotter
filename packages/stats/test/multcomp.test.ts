import { describe, expect, it } from 'vitest'
import {
  dunnComparisons,
  type McMethod,
  type McRow,
  mean,
  multipleComparisons,
  oneWayAnova,
  sd,
  tTestUnpaired,
  type WelchMcMethod,
  welchComparisons,
} from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'

interface Params {
  method: McMethod | WelchMcMethod | 'dunn'
  confLevel?: number
  control?: number
  pairs?: [number, number][]
  familySize?: number
  adjust?: 'bonferroni' | 'sidak' | 'none'
}

function allPairs(k: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) out.push([i, j])
  return out
}

/** Rows → columns, as the fixtures store them. */
function columns<T extends object>(rows: T[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      out[k] ??= []
      out[k].push(v)
    }
  }
  return out
}

describe('multiple comparisons vs R', () => {
  for (const f of loadFixtures<{ groups: number[][] }>('multcomp')) {
    it(f.name, () => {
      const p = f.params as unknown as Params
      const groups = f.input.groups
      const k = groups.length
      const pairs =
        p.pairs ??
        (p.method === 'dunnett'
          ? groups.map((_, j) => [p.control!, j] as [number, number]).filter(([c, j]) => c !== j)
          : allPairs(k))
      let got: Record<string, unknown[]>
      if (p.method === 'dunn') {
        got = columns(
          dunnComparisons(groups, pairs, { adjust: p.adjust, familySize: p.familySize }),
        )
      } else if (['games-howell', 'dunnett-t3', 'tamhane-t2'].includes(p.method)) {
        const cells = groups.map((v) => ({ mean: mean(v), sd: sd(v), n: v.length }))
        got = columns(
          welchComparisons(cells, pairs, {
            method: p.method as WelchMcMethod,
            confLevel: p.confLevel,
            familySize: p.familySize,
          }),
        )
      } else {
        const a = oneWayAnova(groups.map((v) => ({ values: v })))
        const cells = a.groups.map((g) => ({ mean: g.mean, n: g.n }))
        got = columns(
          multipleComparisons(cells, pairs, {
            method: p.method as McMethod,
            mse: a.msWithin,
            df: a.dfWithin,
            confLevel: p.confLevel,
            control: p.control,
            familySize: p.familySize,
          }),
        )
      }
      // jsonlite unboxes the columns of a single comparison
      const expected = Object.fromEntries(
        Object.entries(f.expected).map(([k, v]) => [k, [v].flat()]),
      )
      expectDeepClose(got, expected, f.tol)
    })
  }
})

describe('multiple comparison behaviour', () => {
  const g = [
    [4.1, 5.2, 3.9, 4.8, 5.0],
    [6.3, 5.9, 7.1, 6.6],
    [5.0, 5.4, 4.7, 5.9, 6.1, 5.5],
  ]
  const a = oneWayAnova(g.map((v) => ({ values: v })))
  const cells = a.groups.map((x) => ({ mean: x.mean, n: x.n }))
  const opts = { mse: a.msWithin, df: a.dfWithin }
  const pairs = allPairs(3)

  it('summary cells give the same rows as raw-data cells', () => {
    const s = oneWayAnova(g.map((v) => ({ mean: mean(v), sd: sd(v), n: v.length })))
    const r1 = multipleComparisons(cells, pairs, { method: 'tukey', ...opts })
    const r2 = multipleComparisons(
      s.groups.map((x) => ({ mean: x.mean, n: x.n })),
      pairs,
      { method: 'tukey', mse: s.msWithin, df: s.dfWithin },
    )
    r1.forEach((r, i) => {
      expectClose(r2[i]!.p, r.p, { rtol: 1e-12 })
      expectClose(r2[i]!.lo, r.lo, { rtol: 1e-12 })
    })
  })

  it('Fisher LSD with two groups is the pooled t test; Bonferroni ≥ Šidák ≥ LSD', () => {
    const two = [g[0]!, g[1]!]
    const b = oneWayAnova(two.map((v) => ({ values: v })))
    const [row] = multipleComparisons(
      b.groups.map((x) => ({ mean: x.mean, n: x.n })),
      [[1, 0]],
      { method: 'fisher', mse: b.msWithin, df: b.dfWithin },
    ) as [McRow]
    const t = tTestUnpaired(g[0]!, g[1]!)
    expectClose(row.stat, t.t, { rtol: 1e-12 })
    expectClose(row.p, t.p, { rtol: 1e-12 })
    expectClose(row.lo, t.ciLo, { rtol: 1e-12 })
    const p = (m: McMethod) => multipleComparisons(cells, pairs, { method: m, ...opts })
    const bon = p('bonferroni')
    const sid = p('sidak')
    const lsd = p('fisher')
    bon.forEach((r, i) => {
      expect(r.p).toBeGreaterThanOrEqual(sid[i]!.p)
      expect(sid[i]!.p).toBeGreaterThanOrEqual(lsd[i]!.p)
      expect(r.hi - r.lo).toBeGreaterThan(sid[i]!.hi - sid[i]!.lo)
    })
    for (const m of ['holm', 'holm-sidak', 'bh', 'bky'] as const) {
      expect(p(m).every((r) => Number.isNaN(r.lo) && Number.isNaN(r.hi))).toBe(true)
    }
  })

  it('Tukey q = √2·t and swapping a pair flips diff and the CI', () => {
    const [ab, ba] = multipleComparisons(
      cells,
      [
        [0, 1],
        [1, 0],
      ],
      { method: 'tukey', ...opts },
    )
    expectClose(ab!.stat, (Math.SQRT2 * ab!.diff) / ab!.se, { rtol: 1e-15 })
    expect(ba!.diff).toBe(-ab!.diff)
    expectClose(ba!.lo, -ab!.hi, { rtol: 1e-14 })
    expect(ba!.p).toBe(ab!.p)
  })

  it('Dunnett requires a control in every pair', () => {
    expect(() =>
      multipleComparisons(cells, [[1, 2]], { method: 'dunnett', control: 0, ...opts }),
    ).toThrow(RangeError)
    expect(() => multipleComparisons(cells, [[0, 2]], { method: 'dunnett', ...opts })).toThrow(
      RangeError,
    )
  })

  it('Games–Howell with equal SDs and n is close to Tukey', () => {
    const eq = [
      [1, 2, 3, 4, 5],
      [3, 4, 5, 6, 7],
      [2, 3, 4, 5, 6],
    ]
    const gh = welchComparisons(
      eq.map((v) => ({ mean: mean(v), sd: sd(v), n: 5 })),
      pairs,
      { method: 'games-howell' },
    )
    const b = oneWayAnova(eq.map((v) => ({ values: v })))
    const tk = multipleComparisons(
      b.groups.map((x) => ({ mean: x.mean, n: x.n })),
      pairs,
      { method: 'tukey', mse: b.msWithin, df: b.dfWithin },
    )
    gh.forEach((r, i) => {
      expectClose(Math.SQRT2 * r.stat, tk[i]!.stat, { rtol: 1e-14 })
      expect(r.df).toBe(8) // Welch df with equal variances and n: 2(n − 1)
      expect(r.p).toBeGreaterThan(tk[i]!.p) // fewer df
    })
  })
})
