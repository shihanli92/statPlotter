import { describe, expect, it } from 'vitest'
import type { ResultBlock } from '../src/analysis.ts'
import { numberWithUnit, readableNumber, summaryFirst, summaryText } from '../src/summary.ts'

// Roadmap 51d (design §8.2, U26): summary sentences as text — numbers a reader can use, P values
// in the project's style after "P =" or "P <", intervals with their level and unit.

const GP = { pValueStyle: 'GP', pValueDigits: 4 } as const
const APA = { pValueStyle: 'APA', pValueDigits: 3 } as const

describe('readable numbers', () => {
  it('three significant digits, no trailing zeros, a unit prefix for the scale', () => {
    expect(readableNumber(11.8)).toBe('11.8')
    expect(readableNumber(4.3)).toBe('4.3')
    expect(readableNumber(-0.06957)).toBe('−0.0696')
    expect(readableNumber(12345)).toBe('12345')
    expect(readableNumber(1.2e-7)).toBe('1.2 × 10⁻⁷')
    expect(readableNumber(Number.NaN)).toBe('—')
    expect(readableNumber(Number.POSITIVE_INFINITY)).toBe('∞')
    expect(numberWithUnit(7.999e-9, 'M')).toBe('8 nM')
    expect(numberWithUnit(4.27e-8, 'M')).toBe('42.7 nM')
    expect(numberWithUnit(0.0025, 'g')).toBe('2.5 mg')
    expect(numberWithUnit(12, 'U/mg')).toBe('12 U/mg')
    expect(numberWithUnit(3, 'days')).toBe('3 days')
  })
})

describe('summary text', () => {
  const block: Extract<ResultBlock, { type: 'summary' }> = {
    type: 'summary',
    parts: [
      'Treated is higher than Control by ',
      { value: { kind: 'number', v: 11.8, digits: 3 }, role: 'estimate', unit: 'U/mg' },
      ' (',
      { value: { kind: 'interval', lo: 5.209, hi: 18.39, level: 0.95 }, role: 'ci', unit: 'U/mg' },
      '); ',
      { value: { kind: 'pvalue', v: 0.001428 }, role: 'p' },
      ', Welch’s t test; ',
      { value: { kind: 'pvalue', v: 0.00001 }, role: 'q' },
      '.',
    ],
  }
  it('follows the project’s P style', () => {
    expect(summaryText(block, GP)).toBe(
      'Treated is higher than Control by 11.8 U/mg (95% CI 5.21 to 18.4 U/mg); P = 0.0014, Welch’s t test; q < 0.0001.',
    )
    expect(summaryText(block, APA)).toBe(
      'Treated is higher than Control by 11.8 U/mg (95% CI 5.21 to 18.4 U/mg); P = .001, Welch’s t test; q < .001.',
    )
  })
  it('is read first, wherever it is stored', () => {
    const note: ResultBlock = { type: 'note', text: 'n' }
    expect(summaryFirst([note, block]).map((b) => b.type)).toEqual(['summary', 'note'])
  })
})
