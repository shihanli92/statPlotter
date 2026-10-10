import { sum } from '../summation.ts'

/**
 * Inputs to every function here are finite values only; callers drop empty/excluded cells first
 * (see finiteValues in @ps/model).
 */

/** Arithmetic mean, refined with a second pass so large offsets don't cost precision. */
export function mean(x: ArrayLike<number>): number {
  const n = x.length
  if (n === 0) return Number.NaN
  const m = sum(x) / n
  let r = 0
  for (let i = 0; i < n; i++) r += x[i]! - m
  return m + r / n
}

/** Magnitudes whose squares (and sums of a few million squares) keep full precision. */
const SQUARE_SAFE_LO = 2 ** -480
const SQUARE_SAFE_HI = 2 ** 480

/**
 * Audit 3 (S4): a power of two to divide values of this largest magnitude by before squaring
 * them — 1 (no scaling, so results are bit-identical) unless it is below ~1e-144 or above
 * ~1e144, where squares lose precision in the subnormals or overflow. Dividing by a power of
 * two is exact.
 */
export function squareScale(maxAbs: number): number {
  if (!(maxAbs > 0) || !Number.isFinite(maxAbs)) return 1
  if (maxAbs >= SQUARE_SAFE_LO && maxAbs <= SQUARE_SAFE_HI) return 1
  return 2 ** Math.round(Math.log2(maxAbs))
}

/**
 * The sample variance of x / k and the scale k (`squareScale` of the largest deviation): the
 * corrected two-pass algorithm (Chan, Golub & LeVeque 1983), Σd² − (Σd)²/n over n − 1 with
 * d = x − mean. The correction term cancels the rounding error left in the mean.
 */
function scaledVariance(x: ArrayLike<number>): { v: number; k: number } {
  const n = x.length
  if (n < 2) return { v: Number.NaN, k: 1 }
  const m = mean(x)
  let ss = 0
  let s = 0
  let big = 0
  for (let i = 0; i < n; i++) {
    const d = x[i]! - m
    ss += d * d
    s += d
    if (Math.abs(d) > big) big = Math.abs(d)
  }
  const k = squareScale(big)
  if (k !== 1) {
    ss = 0
    s = 0
    for (let i = 0; i < n; i++) {
      const d = (x[i]! - m) / k
      ss += d * d
      s += d
    }
  }
  return { v: Math.max(0, (ss - (s * s) / n) / (n - 1)), k }
}

/**
 * Sample variance (denominator n − 1), deviations scaled before squaring at extreme magnitudes
 * (so it is exact wherever the variance itself is representable).
 */
export function variance(x: ArrayLike<number>): number {
  const { v, k } = scaledVariance(x)
  return v * k * k
}

/** Sample SD: √ of the scaled variance, times the scale (finite for any finite data). */
export function sd(x: ArrayLike<number>): number {
  const { v, k } = scaledVariance(x)
  return Math.sqrt(v) * k
}

export function sem(x: ArrayLike<number>): number {
  return sd(x) / Math.sqrt(x.length)
}

export function min(x: ArrayLike<number>): number {
  if (x.length === 0) return Number.NaN
  let m = x[0]!
  for (let i = 1; i < x.length; i++) if (x[i]! < m) m = x[i]!
  return m
}

export function max(x: ArrayLike<number>): number {
  if (x.length === 0) return Number.NaN
  let m = x[0]!
  for (let i = 1; i < x.length; i++) if (x[i]! > m) m = x[i]!
  return m
}

/** max − min. */
export function range(x: ArrayLike<number>): number {
  return max(x) - min(x)
}

/** Coefficient of variation sd / mean, as a fraction (not a percentage). */
export function cv(x: ArrayLike<number>): number {
  return sd(x) / mean(x)
}
