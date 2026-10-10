import { describe, expect, it } from 'vitest'
import { effectSizes, threeWayRM } from '../src/index.ts'
import { expectClose, loadFixture, loadFixtures } from './oracle.ts'

interface In {
  y: (number | null)[]
  row: number[]
  col1: number[]
  col2: number[]
  subject: number[]
}
interface Eff {
  ss?: number
  errorSs?: number
  etaSquared?: number
  partialEtaSquared?: number
  cohensF?: number
  df: number
  F: number
  p: number
  dfd: number
  epsilon?: number
  pCorrected?: number
}

describe('three-way ANOVA with repeated measures vs R (car::Anova, REML)', () => {
  for (const f of loadFixtures<In, { kind: string; effects: Eff[]; logLik?: number }>(
    'rmthreeway',
  )) {
    it(f.name, () => {
      const p = f.params as { repeated: number | number[]; method: 'anova' | 'mixed' }
      const r = threeWayRM(
        { ...f.input, y: f.input.y.map((v) => (v === null ? Number.NaN : v)) },
        { repeated: [p.repeated].flat(), method: p.method },
      )
      expect(r.error).toBeUndefined()
      expect(r.kind).toBe(f.expected.kind)
      f.expected.effects.forEach((e, i) => {
        const g = r.effects[i]!
        const at = `effect ${g.factors.join('×')}`
        if (e.ss !== undefined) expectClose(g.ss, e.ss, f.tol, `${at} ss`)
        expect(g.df, `${at} df`).toBe(e.df)
        expect(g.dfd, `${at} dfd`).toBe(e.dfd)
        expectClose(g.F, e.F, f.tol, `${at} F`)
        expectClose(g.p, e.p, f.tol, `${at} p`)
        if (e.etaSquared !== undefined) {
          const y = f.input.y.filter((x): x is number => x !== null)
          const m = y.reduce((a, b) => a + b, 0) / y.length
          const sst = y.reduce((a, b) => a + (b - m) ** 2, 0)
          const st = r.strata.find((s) => s.within.join() === g.stratum.join())!
          expectClose(st.ss, e.errorSs!, f.tol, `${at} error SS`)
          const es = effectSizes(g, st, sst)
          expectClose(es.etaSquared, e.etaSquared, f.tol, `${at} eta2`)
          expectClose(es.partialEtaSquared, e.partialEtaSquared!, f.tol, `${at} partial eta2`)
          expectClose(es.cohensF, e.cohensF!, f.tol, `${at} f`)
        }
        if (e.epsilon !== undefined) {
          expectClose(g.epsilon!, e.epsilon, f.tol, `${at} epsilon`)
          expectClose(g.pCorrected!, e.pCorrected!, f.tol, `${at} pCorrected`)
        }
      })
      if (f.expected.logLik !== undefined)
        expectClose(r.mixed!.logLik, f.expected.logLik, f.tol, 'logLik')
    })
  }

  it('the mixed model on complete data reproduces RM ANOVA (sphericity assumed)', () => {
    const f = loadFixture<In>('rmthreeway', 'mixed_complete_rows')
    const data = { ...f.input, y: f.input.y.map((v) => v ?? Number.NaN) }
    const a = threeWayRM(data, { repeated: [0], method: 'anova' })
    const m = threeWayRM(data, { repeated: [0], method: 'mixed' })
    a.effects.forEach((e, i) => {
      expectClose(m.effects[i]!.F, e.F, { rtol: 1e-8 }, `F ${i}`)
      expect(m.effects[i]!.dfd).toBe(e.dfd)
    })
  })

  it('refuses a subject in two levels of a between factor', () => {
    expect(() =>
      threeWayRM(
        { y: [1, 2], row: [0, 1], col1: [0, 1], col2: [0, 0], subject: [0, 0] },
        { repeated: [0] },
      ),
    ).toThrow(/between-subjects/)
  })
})
