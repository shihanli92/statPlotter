import { describe, expect, it } from 'vitest'
import { negLog10P, pOfNegLog10, thresholdClass, thresholdCounts } from '../src/index.ts'

// Roadmap 46b: a volcano plot's classes. Comparisons, not estimates: no R oracle (decision 942);
// exact checks of every branch, ties at the cut-offs and missing values.

const cuts = { fold: 1, sig: 2 }

describe('thresholdClass', () => {
  it('up, down and not significant', () => {
    expect(thresholdClass(1.5, 3, cuts)).toBe('up')
    expect(thresholdClass(-1.5, 3, cuts)).toBe('down')
    expect(thresholdClass(0.5, 3, cuts)).toBe('ns')
    expect(thresholdClass(-0.5, 3, cuts)).toBe('ns')
    expect(thresholdClass(1.5, 1, cuts)).toBe('ns')
    expect(thresholdClass(-1.5, 1, cuts)).toBe('ns')
  })

  it('a point at a cut-off is significant (≥)', () => {
    expect(thresholdClass(1, 2, cuts)).toBe('up')
    expect(thresholdClass(-1, 2, cuts)).toBe('down')
    expect(thresholdClass(1, 1.999999, cuts)).toBe('ns')
    expect(thresholdClass(0.999999, 2, cuts)).toBe('ns')
  })

  it('the fold change cut-off’s sign is ignored; 0 makes every significant point up or down', () => {
    expect(thresholdClass(1.5, 3, { fold: -1, sig: 2 })).toBe('up')
    expect(thresholdClass(-1.5, 3, { fold: -1, sig: 2 })).toBe('down')
    expect(thresholdClass(0, 3, { fold: 0, sig: 2 })).toBe('up')
    expect(thresholdClass(-0.1, 3, { fold: 0, sig: 2 })).toBe('down')
  })

  it('missing values are not classed', () => {
    expect(thresholdClass(Number.NaN, 3, cuts)).toBeNull()
    expect(thresholdClass(1.5, Number.NaN, cuts)).toBeNull()
    expect(thresholdClass(Number.POSITIVE_INFINITY, 3, cuts)).toBeNull()
    expect(thresholdClass(1.5, 3, { fold: Number.NaN, sig: 2 })).toBeNull()
  })

  it('an infinite significance (−log10 of P = 0) is the most significant (audit 3, S5)', () => {
    expect(thresholdClass(1.5, Number.POSITIVE_INFINITY, cuts)).toBe('up')
    expect(thresholdClass(-1.5, Number.POSITIVE_INFINITY, cuts)).toBe('down')
    expect(thresholdClass(0.5, Number.POSITIVE_INFINITY, cuts)).toBe('ns')
    expect(thresholdClass(1.5, Number.NEGATIVE_INFINITY, cuts)).toBeNull()
    expect(thresholdCounts([2, -2], [Number.POSITIVE_INFINITY, 3], cuts)).toEqual({
      up: 1,
      down: 1,
      ns: 0,
      missing: 0,
    })
  })

  it('infinite cut-offs: nothing up or down', () => {
    expect(thresholdClass(5, 3, { fold: Number.POSITIVE_INFINITY, sig: 2 })).toBe('ns')
    expect(thresholdClass(5, 3, { fold: 1, sig: Number.POSITIVE_INFINITY })).toBe('ns')
  })
})

describe('thresholdCounts', () => {
  it('counts each class and the points left out', () => {
    const folds = [2, -2, 1, -1, 0, 3, Number.NaN, 2]
    const sigs = [3, 3, 2, 2, 5, 1, 4, Number.NaN]
    expect(thresholdCounts(folds, sigs, cuts)).toEqual({ up: 2, down: 2, ns: 2, missing: 2 })
  })

  it('unequal lengths: the extra values are missing', () => {
    expect(thresholdCounts([2, 2, 2], [3], cuts)).toEqual({ up: 1, down: 0, ns: 0, missing: 2 })
  })

  it('typed arrays', () => {
    const got = thresholdCounts(Float64Array.of(-3, 0.5), Float64Array.of(9, 9), cuts)
    expect(got).toEqual({ up: 0, down: 1, ns: 1, missing: 0 })
  })
})

describe('P values and −log10 P', () => {
  it('converts both ways', () => {
    expect(negLog10P(0.01)).toBe(2)
    expect(negLog10P(1)).toBe(-0)
    expect(negLog10P(0.05)).toBeCloseTo(1.3010299956639813, 15)
    expect(pOfNegLog10(2)).toBeCloseTo(0.01, 17)
    expect(pOfNegLog10(negLog10P(0.05))).toBeCloseTo(0.05, 15)
  })

  it('P = 0 (underflowed) as the smallest double P: −log10 of 2^−1074 (audit 3, S5)', () => {
    expect(negLog10P(0)).toBe(-Math.log10(Number.MIN_VALUE))
    expect(negLog10P(0)).toBeCloseTo(323.3062153431158, 10)
    expect(negLog10P(Number.MIN_VALUE)).toBe(negLog10P(0))
  })

  it('NaN outside [0, 1]', () => {
    expect(negLog10P(-0.1)).toBeNaN()
    expect(negLog10P(1.5)).toBeNaN()
    expect(pOfNegLog10(Number.NaN)).toBeNaN()
  })
})
