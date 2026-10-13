import { describe, expect, it } from 'vitest'
import { EQUATION_LIMITS, parseEquation } from '../src/index.ts'
import { PATHOLOGICAL_EQUATIONS } from './pathologicalEquations.ts'

// Audit 4 (T1): the user-equation parser has limits — selector letters up to ZZ (ranges kept as
// ranges), nesting at most EQUATION_LIMITS.depth deep, at most EQUATION_LIMITS.length
// characters — so a few characters can't hang the app or overflow the stack: each of these is
// an error with a message and a position, returned (never thrown) and quickly.

describe('user-equation limits (audit 4 T1)', () => {
  for (const { label, text } of PATHOLOGICAL_EQUATIONS)
    it(`answers “${label}” quickly, without throwing`, () => {
      const t0 = performance.now()
      const r = parseEquation(text)
      expect(performance.now() - t0).toBeLessThan(3000)
      if (!r.ok) {
        expect(r.message.length).toBeGreaterThan(0)
        expect(r.position).toBeGreaterThanOrEqual(0)
      }
    })

  it('says which limit was reached', () => {
    const bad = (t: string) => {
      const r = parseEquation(t)
      if (r.ok) throw new Error(`parsed: ${t.slice(0, 40)}`)
      return r
    }
    expect(bad('<A:ZZZZ> Y = X').message).toMatch(/letters go up to ZZ/)
    expect(bad(`Y = ${'('.repeat(1000)}X${')'.repeat(1000)}`).message).toMatch(/nested too deeply/)
    expect(bad(`Y = ${'-'.repeat(15000)}X`).message).toMatch(/nested too deeply/)
    expect(bad(`Y = X ;${'x'.repeat(EQUATION_LIMITS.length)}`).message).toMatch(/too long/)
  })

  it('keeps what the limits allow', () => {
    // 150 levels of parentheses, ZZ, steps and lists still parse.
    expect(parseEquation(`Y = ${'('.repeat(150)}A*X${')'.repeat(150)}`).ok).toBe(true)
    const r = parseEquation('<A:ZZ,2> Y = A*X\n<~A:ZZ,2> Y = B*X')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.program.forDataSet(0).parameters).toEqual(['A', 'B'])
    expect(r.program.forDataSet(0).f(2, [3, 5])).toBe(6)
    expect(r.program.forDataSet(1).f(2, [3, 5])).toBe(10)
    expect(r.program.forDataSet(700).f(2, [3, 5])).toBe(6)
    expect(r.program.forDataSet(701).f(2, [3, 5])).toBe(10)
    const list = parseEquation('<A,C> Y = A*X\n<B> Y = B*X')
    expect(list.ok).toBe(true)
    if (!list.ok) return
    expect(list.program.forDataSet(2).f(1, [3, 5])).toBe(3)
    expect(list.program.forDataSet(1).f(1, [3, 5])).toBe(5)
  })
})
