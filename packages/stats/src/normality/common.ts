/**
 * Shared pieces of the normality tests.
 *
 * Every test here is location- and scale-invariant, so the data are first sorted and shifted by
 * their middle value (exact for clustered data such as 1e9 + small noise, by Sterbenz's lemma).
 * The deviations from the mean are then computed from the shifted values with the rounding
 * error left in their mean corrected, so the tests keep full accuracy when the spread is tiny
 * relative to the mean.
 *
 * Lognormality tests are the same functions applied to log(x) (any base: the tests are
 * scale-invariant); the caller drops x ≤ 0.
 */

export interface NormalityTest {
  stat: number
  p: number
}

export const NAN_TEST: NormalityTest = { stat: Number.NaN, p: Number.NaN }

/**
 * Sorted deviations from the mean, d_i = x_(i) − x̄ (ascending), with Σd = 0 to rounding.
 * `ss` = Σd², corrected (Chan, Golub & LeVeque 1983). Non-finite input gives NaN deviations.
 */
export function sortedDeviations(x: ArrayLike<number>): { d: Float64Array; ss: number } {
  const n = x.length
  const s = Float64Array.from(x).sort()
  const shift = n > 0 ? s[n >> 1]! : 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    s[i] = s[i]! - shift
    sum += s[i]!
  }
  let m = sum / n
  let r = 0
  for (let i = 0; i < n; i++) r += s[i]! - m
  m += r / n
  let ss = 0
  let c = 0
  for (let i = 0; i < n; i++) {
    s[i] = s[i]! - m
    ss += s[i]! * s[i]!
    c += s[i]!
  }
  return { d: s, ss: Math.max(0, ss - (c * c) / n) }
}
