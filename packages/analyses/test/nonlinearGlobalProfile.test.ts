import { normalizeTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { cpuRatio } from '../../stats/test/timing.ts'
import { nonlinearFitDef, PROFILE_ALL_MAX_DATA_SETS } from '../src/nonlinear.ts'
import { xyTable } from './helpers.ts'

// Audit 4 (P1, Q1): a global fit of more than 10 data sets profiles its shared parameters only;
// each data set's own parameters get asymptotic CIs, with a note.

const X = [-9, -8.5, -8, -7.5, -7, -6.5, -6, -5.5, -5, -4.5, -4]
function table(K: number) {
  return xyTable(
    X,
    Array.from({ length: K }, (_, k) =>
      X.map((x, i) => {
        const mid = -7 + (k % 7) * 0.3
        const noise = (((i * 7 + k * 13) % 11) - 5) * 0.6
        return 5 + 95 / (1 + 10 ** (mid - x)) + noise
      }),
    ),
  )
}
const SHARED = { constraints: { HillSlope: { kind: 'shared' } } }
const NOTE = /the confidence intervals of the shared parameters are profile likelihood/

function run(K: number, p: Record<string, unknown>, progress?: (d: number, t: number) => void) {
  const input = normalizeTable(table(K))
  const r = nonlinearFitDef.run(input, nonlinearFitDef.params.parse(p), undefined, progress)
  const ci = (name: string, k: number) => {
    const at = (s: string) => (r.values[`${name}:${input[k]!.ref.key}:${s}`] as { v: number }).v
    const v = (r.values[`${name}:${input[k]!.ref.key}`] as { v: number }).v
    return { lo: at('lo'), v, hi: at('hi') }
  }
  const titles = r.sheets[0]!.blocks.flatMap((b) => (b.type === 'table' ? [b.title] : []))
  const notes = r.diagnostics.map((d) => d.message)
  return { r, ci, titles, notes }
}
/** Whether an interval is symmetric about the estimate (asymptotic). */
const symmetric = (c: { lo: number; v: number; hi: number }) =>
  Math.abs(c.hi - c.v - (c.v - c.lo)) <= 1e-9 * (c.hi - c.lo)

describe('global fits of many data sets (audit 4 P1)', () => {
  it('more than 10 data sets: the shared slope profiled, the rest asymptotic, with a note', () => {
    const K = PROFILE_ALL_MAX_DATA_SETS + 1
    const { r, ci, titles, notes } = run(K, SHARED)
    expect(r.status).toBe('ok')
    expect(notes.some((m) => NOTE.test(m))).toBe(true)
    expect(titles).toContain('95% CI (profile likelihood when shared, else asymptotic)')
    expect(symmetric(ci('HillSlope', 0))).toBe(false)
    for (let k = 0; k < K; k++) {
      expect(symmetric(ci('LogEC50', k))).toBe(true)
      expect(symmetric(ci('Top', k))).toBe(true)
    }
    // As the asymptotic fit gives them.
    const sym = run(K, { ...SHARED, ciMethod: 'symmetric' })
    expect(ci('LogEC50', 3)).toEqual(sym.ci('LogEC50', 3))
  })

  it('10 data sets or fewer: every parameter profiled', () => {
    const few = run(3, SHARED)
    expect(few.notes.some((m) => NOTE.test(m))).toBe(false)
    expect(few.titles).toContain('95% CI (profile likelihood)')
    expect(symmetric(few.ci('LogEC50', 1))).toBe(false)
  })

  it('separate fits of many data sets profile every parameter (no note)', () => {
    const { notes, ci } = run(PROFILE_ALL_MAX_DATA_SETS + 1, {})
    expect(notes.some((m) => NOTE.test(m))).toBe(false)
    expect(symmetric(ci('LogEC50', 1))).toBe(false)
  })

  it('reports progress as each parameter is profiled', () => {
    const calls: number[] = []
    let total = 0
    run(3, SHARED, (d, t) => {
      calls.push(d)
      total = t
    })
    // The fit, then each of the 10 parameters, then the end of the fit.
    expect(calls.length).toBeGreaterThanOrEqual(11)
    expect(calls.every((d, i) => i === 0 || d >= calls[i - 1]!)).toBe(true)
    expect(calls.at(-1)).toBe(total)
  })

  it('the profile of 12 data sets costs a few fits, not one per parameter', () => {
    // Before: every one of 37 parameters profiled, ≈ 300 times the asymptotic fit (growing as K).
    const input = normalizeTable(table(12))
    const fit = (p: Record<string, unknown>) => () =>
      nonlinearFitDef.run(input, nonlinearFitDef.params.parse({ ...SHARED, ...p }))
    expect(cpuRatio(fit({ ciMethod: 'symmetric' }), fit({}), 3)).toBeLessThan(40)
  })
})
