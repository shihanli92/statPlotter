import { describe, expect, it } from 'vitest'
import {
  type McCell,
  mean,
  multipleComparisons,
  sd,
  type TwoWayCell,
  twoWayAnova,
} from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'

interface In {
  cells: { row: number; col: number; values: number[] }[]
}

interface Expected {
  sources: Record<string, number[]>
  ssTotal: number
  mse: number
  dfResidual: number
  rowMeans: number[]
  colMeans: number[]
  balanced: boolean
  comparisons?: Record<string, number[]>
}

function toCells(input: In, summary: boolean): TwoWayCell[] {
  return input.cells.map((c) => {
    const v = [c.values].flat()
    return summary
      ? { row: c.row, col: c.col, mean: mean(v), sd: sd(v), n: v.length }
      : { row: c.row, col: c.col, values: v }
  })
}

/**
 * Simple-effects comparisons "compare columns within each row" as the analysis layer runs
 * them: multipleComparisons on the cell means with the ANOVA's MSE and residual df.
 *  - Tukey, one family per row: pairs of that row only, nMeans = number of columns.
 *  - Šidák, one family per row: familySize = C(C, 2) (the row's pairs).
 *  - Šidák, one family for all rows: all rows' pairs together (familySize = R·C(C, 2)).
 */
function simpleEffects(
  cellMeans: McCell[],
  R: number,
  C: number,
  mse: number,
  df: number,
): Record<string, number[]> {
  const idx = (r: number, c: number) => r * C + c
  const rowPairs = (r: number) => {
    const out: [number, number][] = []
    for (let a = 0; a < C; a++) for (let b = a + 1; b < C; b++) out.push([idx(r, a), idx(r, b)])
    return out
  }
  const tukey = []
  const sidakRow = []
  for (let r = 0; r < R; r++) {
    tukey.push(
      ...multipleComparisons(cellMeans, rowPairs(r), { method: 'tukey', mse, df, nMeans: C }),
    )
    sidakRow.push(...multipleComparisons(cellMeans, rowPairs(r), { method: 'sidak', mse, df }))
  }
  const all = Array.from({ length: R }, (_, r) => rowPairs(r)).flat()
  const sidakAll = multipleComparisons(cellMeans, all, { method: 'sidak', mse, df })
  return {
    diff: tukey.map((x) => x.diff),
    se: tukey.map((x) => x.se),
    t: sidakRow.map((x) => x.stat),
    df: tukey.map((x) => x.df),
    pTukeyRow: tukey.map((x) => x.p),
    loTukeyRow: tukey.map((x) => x.lo),
    hiTukeyRow: tukey.map((x) => x.hi),
    pSidakRow: sidakRow.map((x) => x.p),
    loSidakRow: sidakRow.map((x) => x.lo),
    hiSidakRow: sidakRow.map((x) => x.hi),
    pSidakAll: sidakAll.map((x) => x.p),
    loSidakAll: sidakAll.map((x) => x.lo),
    hiSidakAll: sidakAll.map((x) => x.hi),
  }
}

describe('two-way ANOVA vs R', () => {
  for (const f of loadFixtures<In, Expected>('twoway')) {
    it(f.name, () => {
      const summary = (f.params.summary as boolean | undefined) ?? false
      const interaction = (f.params.interaction as boolean | undefined) ?? true
      const res = twoWayAnova(toCells(f.input, summary), { interaction })
      expect(res.error).toBeUndefined()
      const e = f.expected
      const got: Record<string, number[]> = {}
      for (const k of Object.keys(e.sources)) {
        got[k] = res.sources.map((s) => s[k as keyof typeof s] as number)
      }
      expectDeepClose(got, e.sources, f.tol, 'sources')
      expect(res.sources.map((s) => s.source)).toEqual(
        interaction
          ? ['Interaction', 'Row factor', 'Column factor', 'Residual']
          : ['Row factor', 'Column factor', 'Residual'],
      )
      const { sources: _s, comparisons, ...rest } = e
      expectDeepClose(res, rest, f.tol)
      if (comparisons) {
        const R = res.rowMeans.length
        const C = res.colMeans.length
        const cm: McCell[] = new Array(R * C)
        for (const c of res.cells) cm[c.row * C + c.col] = { mean: c.mean, n: c.n }
        const { row: _r, c1: _a, c2: _b, ...cmp } = comparisons
        expectDeepClose(simpleEffects(cm, R, C, res.mse, res.dfResidual), cmp, f.tol, 'cmp')
      }
    })
  }
})

describe('two-way ANOVA behaviour', () => {
  const cells = (
    n: number[][],
    f = (r: number, c: number, i: number) => r + 2 * c + (i % 3) * 0.7,
  ) =>
    n.flatMap((row, r) =>
      row.map((k, c) => ({
        row: r,
        col: c,
        values: Array.from({ length: k }, (_, i) => f(r, c, i)),
      })),
    )

  it('summary input matches raw input', () => {
    const raw = cells([
      [3, 4, 2],
      [5, 3, 4],
    ])
    const sum = raw.map((c) => ({
      row: c.row,
      col: c.col,
      mean: mean(c.values),
      sd: sd(c.values),
      n: c.values.length,
    }))
    const a = twoWayAnova(raw)
    const b = twoWayAnova(sum)
    a.sources.forEach((s, i) => {
      expectClose(b.sources[i]!.ss, s.ss, { rtol: 1e-12, atol: 1e-14 }, s.source)
      expectClose(b.sources[i]!.p, s.p, { rtol: 1e-11, atol: 1e-14 }, s.source)
    })
  })

  it('empty cell with interaction: NaN sources and an error code', () => {
    const r = twoWayAnova(
      cells([
        [3, 3, 0],
        [3, 3, 3],
      ]),
    )
    expect(r.error).toBe('empty-cells')
    expect(r.sources.every((s) => Number.isNaN(s.ss))).toBe(true)
    const add = twoWayAnova(
      cells([
        [3, 3, 0],
        [3, 3, 3],
      ]),
      { interaction: false },
    )
    expect(add.error).toBeUndefined()
    expect(add.dfResidual).toBe(15 - 2 - 3 + 1)
  })

  it('zero residual variation: an effect that is zero within rounding has no F (audit 3, S2)', () => {
    // Additive cell means, every value of a cell equal: residual and interaction are zero, and
    // rounding left ~1e-31 of interaction SS, reported as F = ∞, P = 0.
    const n = [
      [3, 3, 3, 3],
      [3, 3, 3, 3],
      [3, 3, 3, 3],
    ]
    const flat = cells(n, (r, c) => 0.1 * r + 0.7 * c)
    const [inter, row, col, res] = twoWayAnova(flat).sources
    expect(res!.ss).toBe(0)
    expect(inter!.ss).toBe(0)
    expect(inter!.F).toBeNaN()
    expect(inter!.p).toBeNaN()
    // Real effects with no residual variation stay infinitely significant.
    expect(row!.F).toBe(Number.POSITIVE_INFINITY)
    expect(col!.p).toBe(0)
    // The additive model pools the interaction's rounding into the residual: zero too.
    const add = twoWayAnova(flat, { interaction: false })
    expect(add.sources.at(-1)!.ss).toBe(0)
    expect(add.mse).toBe(0)
    expect(add.sources[0]!.F).toBe(Number.POSITIVE_INFINITY)
    // With residual variation, a perfectly additive design's interaction is F = 0, P = 1.
    const spread = twoWayAnova(cells(n, (r, c, i) => 0.1 * r + 0.7 * c + (i - 1) * 0.3))
    expect(spread.sources[0]!.ss).toBe(0)
    expect(spread.sources[0]!.F).toBe(0)
    expect(spread.sources[0]!.p).toBe(1)
  })

  it('one value per cell needs the additive model', () => {
    const one = cells([
      [1, 1, 1],
      [1, 1, 1],
    ])
    expect(twoWayAnova(one).error).toBe('no-residual-df')
    const add = twoWayAnova(one, { interaction: false })
    expect(add.error).toBeUndefined()
    expect(add.dfResidual).toBe(2)
  })

  it('balanced data: Type III = classical SS that add up to the total', () => {
    const r = twoWayAnova(
      cells(
        [
          [3, 3, 3],
          [3, 3, 3],
        ],
        (r, c, i) =>
          r * 1.5 + c * c + i * 0.3 + (r === 1 && c === 2 ? 2 : 0) + ((i * 7 + c) % 5) * 0.1,
      ),
    )
    expect(r.balanced).toBe(true)
    const total = r.sources.reduce((s, x) => s + x.ss, 0)
    expectClose(total, r.ssTotal, { rtol: 1e-12 }, 'sum')
    expectClose(
      r.sources.reduce((s, x) => s + x.pctOfTotal, 0),
      100,
      { rtol: 1e-12 },
      'pct',
    )
  })

  it('duplicate cells throw; too few levels are not estimable', () => {
    expect(() =>
      twoWayAnova([
        { row: 0, col: 0, values: [1, 2] },
        { row: 0, col: 0, values: [3] },
      ]),
    ).toThrow(RangeError)
    expect(twoWayAnova(cells([[3, 3, 3]])).error).toBe('not-estimable')
  })
})
