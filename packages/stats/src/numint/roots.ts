/**
 * Root of a continuous function with a sign change, by the Illinois variant of regula falsi
 * (Dowell & Jarratt, BIT 11, 1971, 168–174): superlinear (order ≈ 1.44) and always bracketed.
 * The bracket is first found by stepping from x0 in the downhill direction with doubling steps.
 *
 * Intended for smooth monotone functions (quantiles by inverting a CDF on a log scale).
 * Returns NaN if no sign change is found within 200 expansions.
 */
export function solveMonotone(
  F: (x: number) => number,
  x0: number,
  step: number,
  xtol = 1e-15,
): number {
  let a = x0
  let fa = F(a)
  if (fa === 0) return a
  if (Number.isNaN(fa)) return Number.NaN
  // For an increasing F, fa > 0 means the root is below x0.
  let dir = 0
  let b = a
  let fb = fa
  let h = step
  for (let i = 0; i < 200; i++) {
    // Probe both directions first; then keep going in the one where |F| decreased.
    const x = a + (dir === 0 ? h : dir * h)
    const fx = F(x)
    if (Number.isNaN(fx)) return Number.NaN
    if (Math.sign(fx) !== Math.sign(fa)) {
      b = x
      fb = fx
      break
    }
    if (dir === 0) {
      dir = Math.abs(fx) < Math.abs(fa) ? 1 : -1
      if (dir === 1) {
        a = x
        fa = fx
      }
    } else {
      a = x
      fa = fx
    }
    h *= 2
    if (i === 199) return Number.NaN
  }
  // Passed as (b, a): the end whose F has the sign of F(c) is replaced (F(b) may be 0).
  let prev = Number.NaN
  return illinois(F, b, fb, a, fa, {
    maxIter: 300,
    accept: (fc) => Number.isNaN(fc),
    done: (a, b, c) => {
      const tol = xtol * Math.max(1, Math.abs(c))
      if (Math.abs(c - prev) <= tol || Math.abs(b - a) <= tol) return true
      prev = c
      return false
    },
  })
}

export interface IllinoisOptions {
  maxIter: number
  /** Return c at once when F(c) = 0 or accept(F(c), a, b) (a, b: the bracket before the step). */
  accept?: (fc: number, a: number, b: number) => boolean
  /** Stop when this holds after the bracket update (new a, b and the last iterate c). */
  done?: (a: number, b: number, c: number) => boolean
  /** End with the bracket end of smaller |F| (as halved) instead of the last iterate. */
  closer?: boolean
}

/**
 * Root of F on the bracket [a, b] (either order; fa = F(a), fb = F(b) of opposite signs) by the
 * Illinois variant of regula falsi (Dowell & Jarratt 1971): the false-position point, or the
 * midpoint when that leaves the bracket, replaces the end whose F has the sign of F(c) (a when
 * sign F(c) = sign fa, else b); the retained end's value is halved when the same end is kept
 * twice in a row. Returns the last iterate (see `closer`).
 */
export function illinois(
  F: (x: number) => number,
  a: number,
  fa: number,
  b: number,
  fb: number,
  opts: IllinoisOptions,
): number {
  let side = 0
  let c = b
  for (let it = 0; it < opts.maxIter; it++) {
    c = (a * fb - b * fa) / (fb - fa)
    if (!(c > Math.min(a, b) && c < Math.max(a, b))) c = (a + b) / 2
    const fc = F(c)
    if (fc === 0 || opts.accept?.(fc, a, b)) return c
    if (Math.sign(fc) === Math.sign(fa)) {
      a = c
      fa = fc
      if (side === -1) fb /= 2
      side = -1
    } else {
      b = c
      fb = fc
      if (side === 1) fa /= 2
      side = 1
    }
    if (opts.done?.(a, b, c)) break
  }
  if (opts.closer) return Math.abs(fa) < Math.abs(fb) ? a : b
  return c
}
