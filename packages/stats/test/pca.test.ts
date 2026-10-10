import { describe, expect, it } from 'vitest'
import { LecuyerRng } from '../src/gpl/rngLecuyer.ts'
import {
  multipleLinearRegression,
  type PcaOptions,
  pca,
  principalComponentRegression,
} from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { expectClose, loadFixture, loadFixtures } from './oracle.ts'
import { minstd } from './rng.ts'

interface Expected extends Record<string, unknown> {
  eigenvectors: number[][]
  loadings: number[][]
  scores: number[][]
  vectorsK: number
}

const firstCols = (M: number[][], k: number) => M.map((row) => row.slice(0, k))

describe('pca vs R', () => {
  for (const f of loadFixtures<{ X: number[][] }, Expected>('pca')) {
    it(f.name, () => {
      const got = pca(f.input.X, f.params as PcaOptions)
      const { eigenvectors, loadings, scores, vectorsK, ...rest } = f.expected
      // Eigenvalues are relative to the largest; zero eigenvalues are exact zeros.
      const scale = Math.max(...(f.expected.eigenvalues as number[]))
      expectDeepClose(got, rest, { rtol: 1e-10, atol: 1e-13 * scale, ...f.tol })
      const vt = { rtol: 1e-10, atol: 1e-13, ...f.tol }
      expectDeepClose(firstCols(got.eigenvectors, vectorsK), eigenvectors, vt, 'eigenvectors')
      const ls = Math.sqrt(scale)
      expectDeepClose(firstCols(got.loadings, vectorsK), loadings, { ...vt, atol: 1e-13 * ls })
      expectDeepClose(firstCols(got.scores, vectorsK), scores, { ...vt, atol: 1e-12 * ls })
    })
  }
})

describe('R-compatible RNG', () => {
  it('matches set.seed(42, kind = "L\'Ecuyer-CMRG"); rnorm(5) and set.seed(-7); runif(3)', () => {
    const r = new LecuyerRng(42)
    const normals = [
      -0.93907707864928736, -0.041679428023489604, 0.82941349301613676, -0.43935819856743974,
      -0.31403543477192009,
    ]
    for (const v of normals) expect(r.normal()).toBe(v)
    const u = new LecuyerRng(-7)
    for (const v of [0.16409968913829312, 0.49141329299052366, 0.70217821748300213]) {
      expect(u.uniform()).toBe(v)
    }
  })

  it('fillNormal is the normal() stream, and the state stays in step', () => {
    const a = new LecuyerRng(2026)
    const b = new LecuyerRng(2026)
    const out = new Float64Array(5000)
    for (let k = 0; k < 3; k++) {
      a.fillNormal(out, 1.5)
      for (let i = 0; i < out.length; i++) expect(out[i]).toBe(1.5 * b.normal())
      expect(a.uniform()).toBe(b.uniform())
    }
    expect(a.state()).toEqual(b.state())
  })

  it('parallel analysis stays fast for large n and for p > n', () => {
    const rnd = minstd(3)
    for (const [n, p] of [
      [300, 12],
      [15, 40],
    ] as const) {
      const X = Array.from({ length: n }, () => Array.from({ length: p }, () => rnd()))
      const c0 = process.threadCpuUsage()
      const r = pca(X)
      const cpu = process.threadCpuUsage(c0)
      // A generous bound on this thread's CPU time (typically 0.1–0.3 s; unaffected by machine
      // load, unlike the clock): 1000 simulated data sets of this size.
      expect((cpu.user + cpu.system) / 1000).toBeLessThan(5000)
      expect(r.parallel!.percentile).toHaveLength(p)
      // Beyond the rank (n − 1 after centering) the simulated eigenvalues are exactly 0.
      if (p > n) expect(r.parallel!.percentile.slice(n - 1).every((v) => v === 0)).toBe(true)
    }
  })

  it('seeds as R does (.Random.seed after set.seed(1))', () => {
    expect(new LecuyerRng(1).state()).toEqual([
      1280795612, -169270483, -442010614, -603558397, -222347416, 1489374793,
    ])
  })
})

describe('pca invariants', () => {
  const X = [
    [5.1, 3.5, 1.4, 0.2],
    [4.9, 3, 1.4, 0.2],
    [7, 3.2, 4.7, 1.4],
    [6.4, 3.2, 4.5, 1.5],
    [6.3, 3.3, 6, 2.5],
    [5.8, 2.7, 5.1, 1.9],
    [5.5, 2.3, 4, 1.3],
    [4.6, 3.4, 1.4, 0.3],
  ]

  it('standardized eigenvalues sum to p; eigenvectors orthonormal; scores uncorrelated', () => {
    const r = pca(X, { select: { method: 'all' } })
    expectClose(
      r.eigenvalues.reduce((s, v) => s + v, 0),
      4,
      { rtol: 1e-14 },
      'sum',
    )
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        let d = 0
        for (let j = 0; j < 4; j++) d += r.eigenvectors[j]![a]! * r.eigenvectors[j]![b]!
        expect(Math.abs(d - (a === b ? 1 : 0))).toBeLessThan(1e-14)
        let c = 0
        for (let i = 0; i < X.length; i++) c += r.scores[i]![a]! * r.scores[i]![b]!
        const want = a === b ? r.eigenvalues[a]! * (X.length - 1) : 0
        expect(Math.abs(c - want)).toBeLessThan(1e-12)
      }
    }
    expect(r.selected).toBe(4)
  })

  it('signs: every eigenvector sums to a positive number', () => {
    const r = pca(X, { select: { method: 'all' } })
    for (let k = 0; k < 4; k++) {
      expect(r.eigenvectors.reduce((s, row) => s + row[k]!, 0)).toBeGreaterThan(0)
    }
  })

  it('parallel analysis is deterministic and seed-dependent', () => {
    const opts: PcaOptions = { select: { method: 'parallel', simulations: 200, seed: 7 } }
    const a = pca(X, opts)
    expect(pca(X, opts).parallel).toEqual(a.parallel)
    const b = pca(X, { select: { method: 'parallel', simulations: 200, seed: 8 } })
    expect(b.parallel!.mean).not.toEqual(a.parallel!.mean)
    // Stability: 1000 simulations with different seeds agree to about 2%.
    const c = pca(X, { select: { method: 'parallel', seed: 1 } }).parallel!
    const d = pca(X, { select: { method: 'parallel', seed: 2 } }).parallel!
    for (let k = 0; k < 4; k++) {
      expect(Math.abs(c.mean[k]! - d.mean[k]!) / c.mean[k]!).toBeLessThan(0.05)
    }
    expect(c.percentile.every((v, k) => v > c.mean[k]! && c.lower[k]! < c.mean[k]!)).toBe(true)
  })

  it('selection rules', () => {
    const ev = pca(X, { select: { method: 'all' } }).eigenvalues
    expect(pca(X, { select: { method: 'kaiser' } }).selected).toBe(ev.filter((v) => v > 1).length)
    expect(pca(X, { select: { method: 'kaiser', value: 0.2 } }).selected).toBe(
      ev.filter((v) => v > 0.2).length,
    )
    expect(pca(X, { select: { method: 'fixed', value: 3 } }).selected).toBe(3)
    expect(pca(X, { select: { method: 'fixed', value: 9 } }).selected).toBe(4)
    expect(pca(X, { select: { method: 'variance', value: 100 } }).selected).toBe(4)
    expect(pca(X, { select: { method: 'variance', value: 1 } }).selected).toBe(1)
  })

  it('degenerate data give NaN; bad shapes throw', () => {
    const c = pca(
      [
        [1, 2],
        [1, 3],
        [1, 5],
      ],
      { select: { method: 'kaiser' } },
    )
    expect(c.eigenvalues.every(Number.isNaN)).toBe(true)
    expect(c.selected).toBe(0)
    // A constant column is fine when only centering (eigenvalue 0).
    const cc = pca(
      [
        [1, 2],
        [1, 3],
        [1, 5],
      ],
      { standardize: false, select: { method: 'all' } },
    )
    expect(cc.eigenvalues[1]).toBe(0)
    expect(cc.rank).toBe(1)
    expect(pca([[1, 2]]).eigenvalues.every(Number.isNaN)).toBe(true)
    expect(pca([]).n).toBe(0)
    expect(() => pca([[1, 2], [3]])).toThrow(RangeError)
    expect(() => pca([[1, Number.NaN]])).toThrow(RangeError)
  })
})

describe('principal component regression vs R', () => {
  for (const f of loadFixtures<{ y: number[]; X: number[][] }>('pcr')) {
    it(f.name, () => {
      const p = f.params as { k: number; standardize?: boolean; confLevel?: number }
      const names = ['A', 'B', 'C', 'D', 'E']
      const r = principalComponentRegression(f.input.y, f.input.X, names, {
        standardize: p.standardize ?? true,
        select: { method: 'fixed', value: p.k },
        confLevel: p.confLevel,
      })
      expectDeepClose(r, f.expected, f.tol, f.name)
    })
  }
  it('with every component equals ordinary multiple regression', () => {
    const f = loadFixture<{ y: number[]; X: number[][] }>('pcr', 'all_components')
    const names = ['A', 'B', 'C', 'D', 'E']
    const r = principalComponentRegression(f.input.y, f.input.X, names, {
      select: { method: 'fixed', value: 5 },
    })
    const m = multipleLinearRegression(f.input.y, f.input.X, names)
    r.original.forEach((c, i) => {
      expect(c.estimate).toBeCloseTo(m.coefficients[i]!.estimate, 9)
      expect(c.se).toBeCloseTo(m.coefficients[i]!.se, 9)
    })
  })
})
