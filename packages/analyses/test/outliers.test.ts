import { grubbs, rout } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { arr, expectClose, loadFixtures } from '../../stats/test/oracle.ts'
import { outliersDef } from '../src/outliers.ts'
import {
  type Cell,
  makeTable,
  num,
  outTable,
  runWithContext as run,
  tableBlock,
} from './helpers.ts'

describe('outliers vs R', () => {
  for (const f of loadFixtures<{ values: Cell[] }>('outliers')) {
    it(f.name, () => {
      const p = f.params as { method: string; alpha?: number; q?: number }
      const vals = f.input.values.map(num)
      const e = f.expected as Record<string, number[] | number>
      const list = (k: string) => arr(e[k])
      if (p.method === 'rout') {
        const r = rout(vals, p.q)
        expectClose(r.center, e.center as number, f.tol, 'center')
        expectClose(r.rsdr, e.rsdr as number, f.tol, 'rsdr')
        expect(r.candidates).toBe(e.candidates)
        r.values.forEach((x, i) => {
          expectClose(x.p, list('p')[i]!, f.tol, `p ${i}`)
        })
        expect(r.outliers).toEqual(list('outliers'))
      } else {
        const g = grubbs(vals, p.alpha, p.method === 'grubbsIterative')
        expect(g.outliers).toEqual(list('outliers'))
        expect(g.steps.length).toBe(list('G').length)
        g.steps.forEach((s, i) => {
          for (const k of ['G', 'critical', 'p', 'mean', 'sd'] as const)
            expectClose(s[k], list(k)[i]!, f.tol, `step ${i} ${k}`)
          expect(s.index).toBe(list('index')[i])
        })
      }
    })
  }

  it('plugin: cleaned table keeps rows aligned; summary and outlier list', () => {
    const vals = [10.2, 9.8, 10.1, 9.9, 10.4, 9.7, 10, 10.3, 16, 16.2]
    const t = makeTable('column', [vals.map((x) => [x]), [[1], [2], [3]]])
    const r = run(outliersDef, t, {})
    const out = outTable(r)
    expect(out.dataSets[0]!.subcolumns[0]!.values).toEqual([...vals.slice(0, 8), null, null])
    expect(out.dataSets[1]!.subcolumns[0]!.values.slice(0, 3)).toEqual([1, 2, 3])
    expect(out.dataSets.map((d) => d.id)).toEqual(t.dataSets.map((d) => d.id))
    const s = tableBlock(r, 'summary')
    expect(s.rows[0]!.map((x) => (x as { v: unknown }).v)).toEqual(['Group A', 10, 2, 8])
    const g = run(outliersDef, t, { method: 'grubbsIterative' })
    expect(tableBlock(g, 'summary').rows[0]![2]).toEqual({ kind: 'integer', v: 0 })
  })
})
