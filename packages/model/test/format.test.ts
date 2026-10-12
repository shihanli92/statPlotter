import { describe, expect, it } from 'vitest'
import { formatNumber, formatP, formatResultValue, pSummary } from '../src/index.ts'

const GP = { pValueStyle: 'GP' as const, pValueDigits: 4 }

describe('formatP', () => {
  it('GP style', () => {
    expect(formatP(0.03456, GP)).toBe('0.0346')
    expect(formatP(0.00001, GP)).toBe('<0.0001')
    expect(formatP(0.0001, GP)).toBe('0.0001')
    // Rounding up to 1 would overstate it: ">0.9999".
    expect(formatP(0.99996, GP)).toBe('>0.9999')
    expect(formatP(1, GP)).toBe('>0.9999')
    expect(formatP(0.99994, GP)).toBe('0.9999')
    expect(formatP(0.9996, { pValueStyle: 'APA', pValueDigits: 4 })).toBe('>.999')
    expect(formatP(0.996, { pValueStyle: 'NEJM', pValueDigits: 4 })).toBe('>0.99')
    expect(formatP(0.5, { ...GP, pValueDigits: 3 })).toBe('0.500')
  })

  it('APA and NEJM styles', () => {
    expect(formatP(0.0456, { pValueStyle: 'APA', pValueDigits: 4 })).toBe('.046')
    expect(formatP(0.0004, { pValueStyle: 'APA', pValueDigits: 4 })).toBe('<.001')
    expect(formatP(0.0456, { pValueStyle: 'NEJM', pValueDigits: 4 })).toBe('0.05')
    expect(formatP(0.0056, { pValueStyle: 'NEJM', pValueDigits: 4 })).toBe('0.006')
    expect(formatP(0.0002, { pValueStyle: 'NEJM', pValueDigits: 4 })).toBe('<0.001')
  })
})

describe('pSummary', () => {
  it('uses strict thresholds, as “Significant (P < 0.05)?” does (51c, S35)', () => {
    expect([0.2, 0.049, 0.0099, 0.00099, 0.000099, 1e-9].map((p) => pSummary(p, 'GP'))).toEqual([
      'ns',
      '*',
      '**',
      '***',
      '****',
      '****',
    ])
    expect(pSummary(1e-9, 'APA')).toBe('***')
    // At a threshold exactly: the weaker summary (P = 0.05 is not below 0.05).
    expect([0.05, 0.01, 0.001, 0.0001].map((p) => pSummary(p, 'GP'))).toEqual([
      'ns',
      '*',
      '**',
      '***',
    ])
  })
})

describe('formatNumber', () => {
  it('keeps ~4 significant digits without dropping integer digits', () => {
    expect(formatNumber(12.345678)).toBe('12.35')
    expect(formatNumber(0.012345)).toBe('0.01235')
    expect(formatNumber(1234.56)).toBe('1235')
    expect(formatNumber(-2)).toBe('-2.000')
    expect(formatNumber(0)).toBe('0')
  })

  it('uses scientific notation at extremes and symbols for non-finite', () => {
    expect(formatNumber(1.5e-7)).toBe('1.500e-7')
    expect(formatNumber(2.5e12)).toBe('2.500e+12')
    expect(formatNumber(Number.NaN)).toBe('—')
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('∞')
  })
})

describe('formatResultValue', () => {
  it('formats each kind', () => {
    expect(formatResultValue({ kind: 'interval', lo: -1.5, hi: 2.25, level: 0.95 }, GP)).toBe(
      '-1.500 to 2.250',
    )
    expect(formatResultValue({ kind: 'bool', v: true }, GP)).toBe('Yes')
    expect(formatResultValue({ kind: 'pSummary', v: 0.004 }, GP)).toBe('**')
    expect(formatResultValue({ kind: 'integer', v: 12 }, GP)).toBe('12')
  })
})
