import { describe, expect, it } from 'vitest'
import { containmentDf, fitReml, type VcDesign, waldF } from '../src/anova/mixedModel.ts'
import {
  type McMethod,
  nestedAnova,
  oneWayRM,
  type RepeatedFactor,
  rmComparisons,
  type TwoWayRMComparisonSpec,
  twoWayRM,
  twoWayRMComparisons,
} from '../src/index.ts'
import { qrFactor, qrRank } from '../src/linalg/qr.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixtures } from './oracle.ts'
import { arr, type CmpExpected, expectRows, nanRows, toData } from './rmHelpers.ts'
import { minstd } from './rng.ts'
import { growthRatio } from './timing.ts'

/**
 * REML optima: the TS Newton iterations and the R reference (dense Newton polish of lme4's
 * optimum, tools/oracle/r/mixed.R) agree to ~1e-14 relative, so fixtures are compared at the
 * suite default rtol 1e-10.
 */
const MIXED_TOL = { rtol: 1e-10 }

type FTest = { F: number; dfn: number; dfd: number; p: number }

interface OwExpected {
  treatment: FTest
  treatmentSatterthwaite: FTest
  mixed: Record<string, unknown>
  means: number[]
  n: number[]
  boundary: boolean
  comparisons: (CmpExpected & { ddf: 'containment' | 'satterthwaite'; i: number[]; j: number[] })[]
}

describe('one-way mixed-effects model vs R', () => {
  for (const f of loadFixtures<{ rows: (number | null)[][] }, OwExpected>('mixed')) {
    if (f.params.design !== 'oneway') continue
    it(f.name, () => {
      const tol = f.tol ?? MIXED_TOL
      const rows = nanRows(f.input.rows)
      const e = f.expected
      const res = oneWayRM(rows)
      expect(res.kind).toBe('mixed')
      expect(res.error).toBeUndefined()
      expect(res.table).toBeNull()
      expect(res.epsilon).toBeNull()
      expectDeepClose(res.treatment, e.treatment, tol, 'treatment')
      expectDeepClose(res.mixed, e.mixed, { ...tol, atol: 1e-12 }, 'mixed')
      expectDeepClose(res.means, e.means, tol, 'means')
      expect(res.n).toEqual(arr(e.n))
      if (e.boundary) expect(res.mixed!.subjectVariance).toBe(0)
      const sat = oneWayRM(rows, { ddf: 'satterthwaite' })
      expectDeepClose(sat.treatment, e.treatmentSatterthwaite, tol, 'satterthwaite')
      for (const c of e.comparisons) {
        const r = c.ddf === 'satterthwaite' ? sat : res
        const i = arr(c.i)
        const j = arr(c.j)
        const mc = rmComparisons(
          rows,
          r,
          i.map((v, k) => [v, j[k]!] as [number, number]),
          { method: c.method as McMethod },
        )
        expectRows(mc, c, tol, `${c.ddf} ${c.method}`)
      }
    })
  }
})

interface TwExpected {
  sources: (FTest & { key: string; satterthwaite: FTest })[]
  cellMeans: number[][]
  cellN: number[][]
  mixed: Record<string, unknown>
  boundary: boolean
  comparisons: (CmpExpected & TwoWayRMComparisonSpec & { ddf: 'containment' | 'satterthwaite' })[]
}

describe('two-way mixed-effects model vs R', () => {
  for (const f of loadFixtures<Parameters<typeof toData>[0], TwExpected>('mixed')) {
    if (f.params.design !== 'twoway') continue
    it(f.name, () => {
      const tol = f.tol ?? MIXED_TOL
      const data = toData(f.input)
      const repeated = f.params.repeated as RepeatedFactor
      const interaction = f.params.interaction as boolean
      const e = f.expected
      const res = twoWayRM(data, repeated, { interaction })
      const sat = twoWayRM(data, repeated, { interaction, ddf: 'satterthwaite' })
      expect(res.kind).toBe('mixed')
      expect(res.error).toBeUndefined()
      expect(res.sources.map((s) => s.key)).toEqual(e.sources.map((s) => s.key))
      e.sources.forEach((s, k) => {
        const g = res.sources[k]!
        const gs = sat.sources[k]!
        expectDeepClose(
          { F: g.F, dfn: g.df, dfd: g.dfd, p: g.p },
          { F: s.F, dfn: s.dfn, dfd: s.dfd, p: s.p },
          tol,
          s.key,
        )
        const ss = s.satterthwaite
        expectDeepClose(
          { F: gs.F, dfn: gs.df, dfd: gs.dfd, p: gs.p },
          { F: ss.F, dfn: ss.dfn, dfd: ss.dfd, p: ss.p },
          tol,
          `${s.key} satterthwaite`,
        )
      })
      expectDeepClose(res.cellMeans, e.cellMeans, tol, 'cellMeans')
      expect(res.cellN).toEqual(e.cellN)
      expectDeepClose(res.mixed, e.mixed, { ...tol, atol: 1e-12 }, 'mixed')
      for (const c of e.comparisons) {
        const r = c.ddf === 'satterthwaite' ? sat : res
        expectRows(twoWayRMComparisons(data, r, c), c, tol, `${c.ddf} ${c.family} ${c.method}`)
      }
    })
  }
})

describe('mixed-effects model behaviour', () => {
  const rows = [
    [12, 14, 15, 19],
    [10, 13, 13, 15],
    [9, 11, 14, 16],
    [13, 15, 17, 18],
    [8, 9, 12, 14],
    [11, 14, 13, 17],
  ]

  it('REML on complete data reproduces RM ANOVA when the subject variance is positive', () => {
    const k = 4
    const y: number[] = []
    const X: number[] = []
    const block: number[] = []
    rows.forEach((r, i) => {
      r.forEach((v, j) => {
        y.push(v)
        X.push(1, ...[0, 1, 2].map((a) => (j === a ? 1 : j === k - 1 ? -1 : 0)))
        block.push(i)
      })
    })
    const b = Int32Array.from(block)
    const design = {
      y: Float64Array.from(y),
      X: Float64Array.from(X),
      p: k,
      block: b,
      nBlocks: rows.length,
      terms: [{ name: 'subject', level: b, nLevels: rows.length }],
    }
    const fit = fitReml(design)
    if (!fit.ok) throw new Error('fit failed')
    const anova = oneWayRM(rows)
    const tab = anova.table!
    expectClose(fit.sigma2, tab[2]!.ms, { rtol: 1e-10 }, 'sigma2')
    expectClose(fit.variances[0]!, (tab[1]!.ms - tab[2]!.ms) / k, { rtol: 1e-9 }, 'subject var')
    const L = [1, 2, 3].map((a) => [0, 1, 2, 3].map((c) => (c === a ? 1 : 0)))
    const w = waldF(fit, L)
    expectClose(w.F, anova.treatment.F, { rtol: 1e-10 }, 'F')
    expectClose(w.dfdSatterthwaite(), anova.treatment.dfd, { rtol: 1e-8 }, 'Satterthwaite df')
    expect(containmentDf(design, [])).toBe(anova.treatment.dfd)
  })

  it('containment df from the subject blocks matches a dense QR of [X Z]', () => {
    // Reference: rank of the dense N × (p + q) matrix (the previous implementation).
    const denseRank = (d: VcDesign, drop: number[]): number => {
      const N = d.y.length
      const cols: Float64Array[] = []
      for (let k = 0; k < d.p; k++)
        cols.push(Float64Array.from({ length: N }, (_, i) => d.X[i * d.p + k]!))
      d.terms.forEach((t, k) => {
        if (drop.includes(k)) return
        const base = cols.length
        for (let l = 0; l < t.nLevels; l++) cols.push(new Float64Array(N))
        for (let i = 0; i < N; i++) cols[base + t.level[i]!]![i] = 1
      })
      const a = new Float64Array(N * cols.length)
      cols.forEach((c, j) => {
        a.set(c, j * N)
      })
      return qrRank(qrFactor(a, N, cols.length, true), 1e-9)
    }
    const denseDf = (d: VcDesign, containing: number[]): number => {
      const full = denseRank(d, [])
      if (containing.length === 0) return d.y.length - full
      return Math.min(...containing.map((t) => full - denseRank(d, [t])))
    }
    const rnd = minstd(11)
    for (const [nS, R, C, miss] of [
      [6, 2, 3, 0.2],
      [9, 3, 4, 0.15],
      [5, 2, 5, 0.3],
    ] as const) {
      const y: number[] = []
      const X: number[] = []
      const block: number[] = []
      const sr: number[] = []
      const sc: number[] = []
      for (let s = 0; s < nS; s++) {
        for (let r = 0; r < R; r++) {
          for (let c = 0; c < C; c++) {
            if (rnd() < miss) continue
            y.push(rnd())
            // Intercept, row and column dummies and cell dummies: rank-deficient on purpose.
            X.push(1)
            for (let a = 0; a < R; a++) X.push(a === r ? 1 : 0)
            for (let a = 0; a < C; a++) X.push(a === c ? 1 : 0)
            for (let a = 0; a < R * C; a++) X.push(a === r * C + c ? 1 : 0)
            block.push(s)
            sr.push(s * R + r)
            sc.push(s * C + c)
          }
        }
      }
      const compact = (v: number[]) => {
        const ids = [...new Set(v)].sort((a, b) => a - b)
        return { level: Int32Array.from(v, (x) => ids.indexOf(x)), nLevels: ids.length }
      }
      const b = Int32Array.from(block)
      const d: VcDesign = {
        y: Float64Array.from(y),
        X: Float64Array.from(X),
        p: 1 + R + C + R * C,
        block: b,
        nBlocks: nS,
        terms: [
          { name: 'subject', level: b, nLevels: nS },
          { name: 'subject:row', ...compact(sr) },
          { name: 'subject:col', ...compact(sc) },
        ],
      }
      for (const containing of [[], [0], [1], [2], [1, 2], [0, 1, 2]]) {
        expect(containmentDf(d, containing), JSON.stringify(containing)).toBe(
          denseDf(d, containing),
        )
      }
    }
  })

  it('containment df is fast for many subjects', () => {
    const rnd = minstd(5)
    const big = Array.from({ length: 1500 }, () => {
      const u = rnd()
      return Array.from({ length: 5 }, (_, c) => (rnd() < 0.05 ? Number.NaN : u + c * 0.1 + rnd()))
    })
    const r = oneWayRM(big)
    expect(r.kind).toBe('mixed')
    // About linear in the subjects: 4× the subjects, about 4× the time (a dense rank would be
    // cubic: 64×).
    expect(growthRatio((n) => oneWayRM(big.slice(0, n)), 375, 4, 2)).toBeLessThan(12)
    // N − rank([X Z]) = N − (subjects + columns − 1).
    const N = big.flat().filter((v) => !Number.isNaN(v)).length
    expect(r.treatment.dfd).toBe(N - (1500 + 5 - 1))
  })

  it('a nested fit is linear in the replicates per subcolumn (audit 3, S1)', () => {
    // A dense W per subcolumn made it cubic: 4× the replicates, 64× the time.
    const rnd = minstd(11)
    const groups = (reps: number) =>
      [0, 1].map((g) =>
        [0, 1, 2].map((s) => {
          const b = (s - 1) * 3
          return Array.from({ length: reps }, () => 20 + g + b + rnd())
        }),
      )
    const data = new Map([100, 400].map((n) => [n, groups(n)]))
    expect(nestedAnova(data.get(400)!).error).toBeUndefined()
    expect(growthRatio((n) => nestedAnova(data.get(n)!), 100, 4, 2)).toBeLessThan(12)
  })

  describe('Satterthwaite df only when asked, block by block (audit 3, S3)', () => {
    // One-way mixed model (subjects × 4 columns, a few values missing), fitted once per size.
    const fitOf = (n: number) => {
      const rnd = minstd(7)
      const y: number[] = []
      const X: number[] = []
      const block: number[] = []
      for (let s = 0; s < n; s++) {
        const u = rnd()
        for (let c = 0; c < 4; c++) {
          if (rnd() < 0.05) continue
          y.push(u + c * 0.1 + rnd())
          X.push(1, ...[0, 1, 2].map((j) => (c === j ? 1 : c === 3 ? -1 : 0)))
          block.push(s)
        }
      }
      const blk = Int32Array.from(block)
      const fit = fitReml({
        y: Float64Array.from(y),
        X: Float64Array.from(X),
        p: 4,
        block: blk,
        nBlocks: n,
        terms: [{ name: 'subject', level: blk, nLevels: n }],
      })
      if (!fit.ok) throw new Error('fit failed')
      return fit
    }
    const fits = new Map([1000, 4000].map((n) => [n, fitOf(n)]))
    const L = [1, 2, 3].map((a) => [0, 1, 2, 3].map((c) => (c === a ? 1 : 0)))

    it('the F test alone does no Satterthwaite work', () => {
      // Formerly the q × q matrix ZᵀPZ was formed for every F test (1.2 GB at 12,000
      // subjects): quadratic. Without the df, the work doesn't depend on the subjects.
      expect(growthRatio((n) => waldF(fits.get(n)!, L), 1000, 4, 3)).toBeLessThan(2.5)
    })

    it('the Satterthwaite df are linear in the subjects', () => {
      const ratio = growthRatio(
        (n) => {
          const w = waldF(fits.get(n)!, L)
          if (!(w.dfdSatterthwaite() > 0)) throw new Error('no df')
        },
        1000,
        4,
        2,
      )
      expect(ratio).toBeLessThan(8)
    })
  })

  it('a large common offset does not change the fit', () => {
    const miss = rows.map((r) => r.slice())
    miss[1]![2] = Number.NaN
    miss[4]![0] = Number.NaN
    const a = oneWayRM(miss)
    const b = oneWayRM(miss.map((r) => r.map((v) => v + 1e9)))
    expectClose(b.treatment.F, a.treatment.F, { rtol: 1e-7 }, 'F')
    expectClose(b.mixed!.subjectVariance, a.mixed!.subjectVariance, { rtol: 1e-6 }, 'var')
    expectClose(b.means[0]! - 1e9, a.means[0]!, { rtol: 1e-6 }, 'mean')
  })

  it('one subject with missing values: NaN, no throw', () => {
    const r = oneWayRM([[1, Number.NaN, 3]])
    expect(r.kind).toBe('mixed')
    expect(r.error).toBeDefined()
    expect(Number.isNaN(r.treatment.p)).toBe(true)
    const c = rmComparisons([[1, Number.NaN, 3]], r, [[0, 2]], { method: 'tukey' })
    expect(Number.isNaN(c[0]!.p)).toBe(true)
  })

  it('two-way: an empty cell with the interaction model is reported, the additive model fits', () => {
    const data = {
      y: [] as number[],
      row: [] as number[],
      col: [] as number[],
      subject: [] as number[],
    }
    let s = 0
    for (let g = 0; g < 2; g++) {
      for (let k = 0; k < 4; k++) {
        for (let t = 0; t < 3; t++) {
          const empty = g === 1 && t === 2
          data.y.push(empty ? Number.NaN : 5 + g + t + ((s * 3 + t) % 4) * 0.4 + (s % 3) * 0.7)
          data.row.push(g)
          data.col.push(t)
          data.subject.push(s)
        }
        s++
      }
    }
    const full = twoWayRM(data, 'columns')
    expect(full.error).toBe('empty-cells')
    expect(full.sources.every((x) => Number.isNaN(x.p))).toBe(true)
    const add = twoWayRM(data, 'columns', { interaction: false })
    expect(add.error).toBeUndefined()
    expect(add.sources.map((x) => x.key)).toEqual(['row', 'column'])
    expect(add.sources.every((x) => x.p > 0 && x.p < 1)).toBe(true)
  })
})
