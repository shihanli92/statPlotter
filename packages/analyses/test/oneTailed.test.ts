import type { AnalysisDef, DataTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { expectClose, loadFixtures } from '../../stats/test/oracle.ts'
import { registry } from '../src/index.ts'
import { columnTable, countsTable, makeTable, rowOf, runDef, v } from './helpers.ts'

// Roadmap 51c (S1, design §6.3): a one-tailed P is computed for the direction predicted before
// the experiment, through every analysis with tails — against R (suite `onetailed`): with the
// data going the predicted way the small P, against it the large one (never half the two-tailed P
// whichever way the data went), and the two-tailed P unchanged.

interface Input {
  a?: number[]
  b?: number[]
  x?: number[]
  y?: number[]
  mu?: number
  groups?: number[][][]
  table?: number[][]
}
interface Expected {
  two: number
  greater: number
  less: number
}

/** The table each case's analysis reads. */
function tableOf(analysis: string, input: Input): DataTable {
  if (analysis === 'contingency') return countsTable('contingency', input.table!)
  if (analysis === 'nestedT')
    // A data set per group, a subcolumn per subject, rows the replicates.
    return makeTable(
      'nested',
      input.groups!.map((g) =>
        Array.from({ length: g[0]!.length }, (_, r) => g.map((s) => s[r] ?? null)),
      ),
    )
  if (analysis === 'oneSample') return columnTable([input.x!])
  if (analysis === 'correlation') return columnTable([input.x!, input.y!])
  return columnTable([input.a!, input.b!])
}

/** The P value of a run (one sample: the first column's). */
function pOf(analysis: string, r: ReturnType<typeof runDef>): number {
  if (analysis === 'oneSample') return v(rowOf(r, 'P value')[0])
  return v(r.values.p)
}

describe('one-tailed P in the predicted direction vs R', () => {
  for (const f of loadFixtures<Input, Expected>('onetailed')) {
    it(f.name, () => {
      const p = f.params as unknown as { analysis: string; app: Record<string, unknown> }
      const def = registry.get(p.analysis) as AnalysisDef<unknown>
      const t = tableOf(p.analysis, f.input)
      const e = f.expected
      const run = (extra: object) => runDef(def, t, { ...p.app, ...extra })
      const two = run({})
      expect(two.status, JSON.stringify(two.diagnostics)).not.toBe('error')
      expectClose(pOf(p.analysis, two), e.two, f.tol, 'two-tailed')
      for (const [predicted, want] of [
        ['increase', e.greater],
        ['decrease', e.less],
      ] as const) {
        const r = run({ tails: 'one', predicted })
        expectClose(pOf(p.analysis, r), want, f.tol, predicted)
        // Against the data, the large P and a warning that says so.
        const against = want > 0.5
        expect(
          r.diagnostics.some((d) => /opposite way to your prediction/.test(d.message)),
          `${predicted}: warned`,
        ).toBe(against)
      }
      // No direction: refused, with the dialog's message.
      expect(run({ tails: 'one' }).status).toBe('error')
    })
  }
})
