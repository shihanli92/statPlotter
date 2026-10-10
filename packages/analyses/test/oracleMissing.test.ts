import { describe, expect, it } from 'vitest'
import { expectClose, loadFixtures } from '../../stats/test/oracle.ts'
import { oneWayAnovaDef, ttest } from '../src/index.ts'
import { columnTable, kvOf, runDef, v } from './helpers.ts'

// Audit 3 (S8): R oracle cases with empty cells (null in the case and its fixture, NA in R), run
// the way the app runs them: a column table with those cells empty, through the analysis. R
// leaves an empty cell out of its group (a paired test: its pair), as t.test() and lm() do.

type Cells = readonly (number | null)[]
const hasMissing = (xs: Cells) => xs.some((x) => x === null)

describe('t tests with empty cells vs R', () => {
  const cases = loadFixtures<{ a: Cells; b: Cells }, Record<string, number>>('ttest').filter(
    (f) => f.input.a && (hasMissing(f.input.a) || hasMissing(f.input.b)),
  )

  it('has cases', () => {
    expect(cases.map((f) => f.name)).toEqual([
      'missing_paired',
      'missing_unpaired',
      'missing_unpaired_welch',
    ])
  })

  for (const f of cases) {
    it(f.name, () => {
      const p = f.params as { test?: string; equalVariance?: boolean }
      const paired = p.test === 'paired'
      const r = runDef(ttest, columnTable([[...f.input.a], [...f.input.b]]), {
        design: paired ? 'paired' : 'unpaired',
        unpaired: { assumeEqualSD: p.equalVariance ?? true },
      })
      const e = f.expected
      expectClose(v(r.values.p), e.p!, f.tol, 'P')
      expectClose(v(r.values.t), e.t!, f.tol, 't')
      expectClose(v(r.values.df), e.df!, f.tol, 'df')
      expectClose(v(r.values.diff), paired ? e.mean! : e.diff!, f.tol, 'difference')
    })
  }
})

describe('one-way ANOVA with empty cells vs R', () => {
  const cases = loadFixtures<{ groups: Cells[] }, Record<string, unknown>>('oneway').filter((f) =>
    f.input.groups.some(hasMissing),
  )

  it('has cases', () => {
    expect(cases.map((f) => f.name)).toEqual(['missing_k3'])
  })

  for (const f of cases) {
    it(f.name, () => {
      const t = columnTable(f.input.groups.map((g) => [...g]))
      const e = f.expected as { F: number; p: number; kruskalWallis: { H: number; p: number } }
      const r = runDef(oneWayAnovaDef, t)
      expectClose(v(r.values.F), e.F, f.tol, 'F')
      expectClose(v(r.values.p), e.p, f.tol, 'P')
      const kw = runDef(oneWayAnovaDef, t, { gaussian: false })
      expectClose(v(kw.values.p), e.kruskalWallis.p, f.tol, 'Kruskal-Wallis P')
      expectClose(
        v(kvOf(kw, 'Kruskal-Wallis statistic')),
        e.kruskalWallis.H,
        f.tol,
        'Kruskal-Wallis H',
      )
    })
  }
})
