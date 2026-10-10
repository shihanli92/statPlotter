import { describe, it } from 'vitest'
import { effectSizes, oneWayRM, type RepeatedFactor, twoWayRM } from '../src/index.ts'
import { expectDeepClose } from './deep.ts'
import { loadFixtures } from './oracle.ts'

interface In {
  y: number[]
  row?: number[]
  col: number[]
  subject: number[]
}

const sst = (y: readonly number[]) => {
  const m = y.reduce((a, b) => a + b, 0) / y.length
  return y.reduce((a, b) => a + (b - m) ** 2, 0)
}

describe('effect sizes of repeated-measures ANOVA vs R (aov with Error strata)', () => {
  for (const f of loadFixtures<In>('rm_effect_sizes')) {
    it(f.name, () => {
      const rep = (f.params as { repeated: 'one' | RepeatedFactor }).repeated
      const { y, col, subject } = f.input
      if (rep === 'one') {
        const n = Math.max(...subject) + 1
        const k = Math.max(...col) + 1
        const rows = Array.from({ length: n }, (_, s) =>
          Array.from(
            { length: k },
            (_, c) => y[subject.findIndex((v, i) => v === s && col[i] === c)]!,
          ),
        )
        const r = oneWayRM(rows)
        const row = (name: string) => r.table!.find((x) => x.name === name)!
        expectDeepClose(row('Total').ss, sst(y), { rtol: 1e-12 })
        const got = effectSizes(row('Treatment'), row('Residual'), row('Total').ss)
        expectDeepClose({ treatment: got }, f.expected, f.tol)
        return
      }
      const r = twoWayRM({ y, row: f.input.row!, col, subject }, rep)
      const by = (k: string) => r.sources.find((s) => s.key === k)!
      const err: Record<string, string> =
        rep === 'both'
          ? { row: 'rowSubjects', column: 'columnSubjects', interaction: 'residual' }
          : rep === 'columns'
            ? { row: 'subjects', column: 'residual', interaction: 'residual' }
            : { row: 'residual', column: 'subjects', interaction: 'residual' }
      const got = Object.fromEntries(
        ['row', 'column', 'interaction'].map((k) => [k, effectSizes(by(k), by(err[k]!), sst(y))]),
      )
      expectDeepClose(got, f.expected, f.tol)
    })
  }
})
