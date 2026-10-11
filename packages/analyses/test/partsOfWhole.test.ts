import { binomialTest, chiSquareGoodnessOfFit } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import { goodnessOfFitDef, registry } from '../src/index.ts'
import { countsTable, kvOf, runDef, tableBlock, v } from './helpers.ts'

const run = (t: ReturnType<typeof countsTable>, p: Record<string, unknown> = {}) =>
  runDef(goodnessOfFitDef, t, p)

describe('compare observed distribution with expected', () => {
  it('reproduces the guide’s Mendel example (chi-square, P = 0.93)', () => {
    // A statistics guide's "Compare observed and expected distributions" example: 556 peas,
    // expected 9:3:3:1 entered as counts (312.75, 104.25, 104.25, 34.75).
    const t = countsTable(
      'partsOfWhole',
      [[315], [108], [101], [32]],
      ['Round yellow', 'Round green', 'Wrinkled yellow', 'Wrinkled green'],
    )
    const r = run(t, { expectedAs: 'counts', expected: [312.75, 104.25, 104.25, 34.75] })
    expect(r.status).toBe('ok')
    const ref = chiSquareGoodnessOfFit([315, 108, 101, 32], [9, 3, 3, 1])
    expect(v(kvOf(r, 'Chi-square'))).toBeCloseTo(ref.chiSq, 12)
    expect(v(kvOf(r, 'df'))).toBe(3)
    expect(+v(kvOf(r, 'P value')).toFixed(2)).toBe(0.93)
    const b = tableBlock(r, 'results', 1)
    expect(b.rows[0]![0]).toEqual({ kind: 'text', v: 'Round yellow' })
  })

  it('ignores expected values held for empty rows; a row with counts needs one', () => {
    // Rows inserted since the expected values were entered hold null (roadmap 29).
    const t = countsTable('partsOfWhole', [[315], [null], [108], [101], [32]])
    const expected = [312.75, null, 104.25, 104.25, 34.75]
    const r = run(t, { expectedAs: 'counts', expected })
    const ref = chiSquareGoodnessOfFit([315, 108, 101, 32], [9, 3, 3, 1])
    expect(v(kvOf(r, 'Chi-square'))).toBeCloseTo(ref.chiSq, 12)
    const filled = countsTable('partsOfWhole', [[315], [5], [108], [101], [32]])
    expect(run(filled, { expectedAs: 'counts', expected }).status).not.toBe('ok')
  })

  it('reproduces the guide’s binomial example (7 of 100 at 20%)', () => {
    const t = countsTable('partsOfWhole', [[7], [93]])
    const r = run(t, { expected: [20, 80] })
    // Two-tailed by the method of small P values: 0.00061307; one-tailed 0.0002769.
    expect(v(kvOf(r, 'P value'))).toBeCloseTo(0.00061307, 8)
    expect(v(r.values.p)).toBe(binomialTest(7, 100, 0.2).p)
    const one = kvOf(r, 'One-tailed P value (that many or fewer in Row 1)')
    expect(Math.trunc(v(one) * 1e7)).toBe(2769) // printed truncated
  })

  it('uses chi-square with two categories when asked, and equal expectations by default', () => {
    const t = countsTable('column', [[30], [50]])
    const r = run(t, { test: 'chiSquare' })
    expect(v(kvOf(r, 'Chi-square'))).toBe(chiSquareGoodnessOfFit([30, 50], [1, 1]).chiSq)
    expect(r.sheets[0]!.blocks.at(-1)).toEqual({
      type: 'note',
      text: 'Every category was expected to be equally likely.',
    })
  })

  it('checks the expected totals and the counts', () => {
    const t = countsTable('partsOfWhole', [[10], [20], [30]])
    expect(run(t, { expected: [20, 30, 40] }).diagnostics.at(-1)!.message).toMatch(
      /add up to 90, not 100/,
    )
    expect(
      run(t, { expectedAs: 'counts', expected: [20, 20, 30] }).diagnostics.at(-1)!.message,
    ).toMatch(/has 60 observations/)
    expect(run(countsTable('partsOfWhole', [[1.5], [2]])).status).toBe('error')
    expect(run(t, { expected: [50, 50, 0] }).diagnostics.at(-1)!.message).toMatch(
      /expected value of zero/,
    )
  })

  it('is offered for parts-of-whole and column tables', () => {
    const offered = registry.list().filter((d) => d.accepts.includes('partsOfWhole'))
    expect(offered.map((d) => d.id)).toEqual(
      expect.arrayContaining(['goodnessOfFit', 'fractionOfTotal']),
    )
  })
})
