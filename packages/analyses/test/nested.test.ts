import type { DataTable } from '@ps/model'
import { type McMethod, nestedAnova, nestedComparisons, nestedTTest } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { arr, expectClose, loadFixtures } from '../../stats/test/oracle.ts'
import { nestedOneWayDef, nestedTDef } from '../src/nested.ts'
import { type Cell, kvOf, makeTable, num, runWithContext as run, tableBlock } from './helpers.ts'

interface NestedCase {
  y: Cell[]
  group: number[]
  subject: number[]
}

function nestedGroupsOf(c: NestedCase): number[][][] {
  const k = Math.max(...c.group) + 1
  const groups: number[][][] = Array.from({ length: k }, () => [])
  const seen = new Map<number, number[]>()
  c.y.forEach((y, i) => {
    let s = seen.get(c.subject[i]!)
    if (!s) {
      s = []
      seen.set(c.subject[i]!, s)
      groups[c.group[i]!]!.push(s)
    }
    if (typeof y === 'number') s.push(y)
  })
  return groups
}

/** Nested table: a data set per group, a subcolumn per subject, rows = replicates. */
function nestedTable(groups: number[][][]): DataTable {
  const reps = Math.max(...groups.map((g) => g.length))
  const rows = Math.max(...groups.flat().map((s) => s.length))
  return makeTable(
    'nested',
    groups.map((g) =>
      Array.from({ length: rows }, (_, r) =>
        Array.from({ length: reps }, (_, s) => g[s]?.[r] ?? null),
      ),
    ),
    null,
    { type: 'replicates', count: reps },
  )
}

describe('nested t test and nested one-way ANOVA vs R', () => {
  for (const f of loadFixtures<NestedCase>('nested')) {
    it(f.name, () => {
      const groups = nestedGroupsOf(f.input)
      const res = nestedAnova(groups)
      expect(res.error).toBeUndefined()
      const e = f.expected as Record<string, unknown>
      const tol = f.tol
      const close = (a: number, b: unknown, what: string) => {
        expectClose(a, num(b as Cell), tol, what)
      }
      ;(e.means as number[]).forEach((m, i) => {
        close(res.means[i]!, m, `mean ${i}`)
      })
      const tr = e.treatment as Record<string, number>
      close(res.treatment.F, tr.F, 'F')
      expect(res.treatment.dfd).toBe(tr.dfd)
      close(res.treatment.p, tr.p, 'P')
      const va = e.variances as Record<string, number>
      // atol: where R's estimate of the subcolumn variance (and so the ICC) is 0, at the boundary
      // (t_no_subject_effect), a relative tolerance would ask for exactly 0.
      expectClose(res.variances.subcolumn, va.subcolumn!, { ...tol, atol: 1e-12 }, 'var subcolumn')
      close(res.variances.residual, va.residual, 'var residual')
      expectClose(res.icc, e.icc as number, { ...tol, atol: 1e-12 }, 'ICC')
      const st = e.subcolumnTest as Record<string, number>
      close(res.subcolumnTest.F, st.F, 'subcolumn F')
      close(res.subcolumnTest.p, st.p, 'subcolumn P')
      expect([res.subcolumnTest.dfn, res.subcolumnTest.dfd]).toEqual([st.dfn, st.dfd])
      const lrt = e.lrt as Record<string, number>
      // atol: χ² is a difference of two log-likelihoods, so its error scales with them, not with
      // χ² (0 when the subcolumns don't differ).
      expectClose(res.lrt.chi2, lrt.chi2!, { ...tol, atol: 1e-9 }, 'chi2')
      expectClose(res.lrt.p, lrt.p!, { ...tol, atol: 1e-9 }, 'LRT P')
      close(res.logLik, e.logLik, 'logLik')
      expect(res.subjects).toEqual(e.subjects)
      if (e.ttest) {
        const tt = nestedTTest(res)
        for (const [k, w] of Object.entries(e.ttest as Record<string, number>))
          close(tt[k as 'diff'], w, `t test ${k}`)
      }
      for (const c of (e.comparisons ?? []) as Record<string, unknown>[]) {
        const i = arr(c.i)
        const j = arr(c.j)
        const rows = nestedComparisons(
          res,
          i.map((a, x) => [a, j[x]!] as [number, number]),
          c.method as McMethod,
        )
        rows.forEach((r, x) => {
          for (const k of ['diff', 'se', 'df', 'stat', 'p', 'lo', 'hi'] as const) {
            const w = arr(c[k])[x] as Cell
            expectClose(
              r[k],
              num(w),
              { ...tol, atol: k === 'p' ? 1e-10 : 0 },
              `${c.method} ${x} ${k}`,
            )
          }
        })
      }
    })
  }

  it('balanced data: the nested t test equals the t test of the subject means', () => {
    const groups = [
      [
        [10, 11, 12],
        [14, 15, 13],
        [9, 8, 10],
      ],
      [
        [16, 18, 17],
        [13, 12, 14],
        [19, 20, 18],
      ],
    ]
    const res = nestedAnova(groups)
    const tt = nestedTTest(res)
    const means = groups.map((g) => g.map((s) => s.reduce((a, b) => a + b, 0) / s.length))
    const m = means.map((g) => g.reduce((a, b) => a + b, 0) / g.length)
    const ss = means.reduce((acc, g, i) => acc + g.reduce((a, x) => a + (x - m[i]!) ** 2, 0), 0)
    const sp = Math.sqrt(ss / 4)
    const t = (m[1]! - m[0]!) / (sp * Math.sqrt(2 / 3))
    expect(tt.t).toBeCloseTo(t, 10)
    expect(tt.df).toBe(4)
  })

  it('plugins: result sheets, comparisons for brackets', () => {
    const groups = [
      [
        [10, 11, 12],
        [14, 15, 13],
      ],
      [
        [16, 18, 17],
        [13, 12, 14],
        [19, 20, 18],
      ],
      [
        [22, 21],
        [25, 24, 26],
        [20, 21, 19],
      ],
    ]
    const t = nestedTable(groups)
    const two = nestedTable(groups.slice(0, 2))
    const r = run(nestedTDef, two, {})
    expect(r.status).not.toBe('error')
    expect(kvOf(r, 'Difference between means (B − A)')).toBeDefined()
    expect(r.comparisons).toHaveLength(1)
    const a = run(nestedOneWayDef, t, {})
    expect(a.status).not.toBe('error')
    expect(tableBlock(a, 'comparisons').rows).toHaveLength(3)
    expect(a.comparisons).toHaveLength(3)
    const d = run(nestedOneWayDef, t, { comparisons: 'vsControl', control: t.dataSets[2]!.id })
    expect(d.comparisons.map((c) => c.a.key)).toEqual([t.dataSets[2]!.id, t.dataSets[2]!.id])
    const one = nestedTable(
      [
        [[1], [2], [3]],
        [[4], [6], [5]],
      ].map((g) => g.map((s) => s)),
    )
    const single = run(nestedTDef, one, {})
    expect(single.diagnostics.some((x) => x.level === 'warning')).toBe(true)
  })
})
