/**
 * Adaptive piecewise Chebyshev interpolation of a smooth function on [a, b], in the manner of
 * Chebfun's splitting (Trefethen, Approximation Theory and Approximation Practice, SIAM 2013,
 * ch. 3–4 and 18; Battles & Trefethen 2004): each panel is sampled at N Chebyshev points of the
 * first kind; if the trailing coefficients are not below the tolerance the panel is halved.
 * The magnitude of the trailing coefficients is the standard estimate of the interpolation
 * error for analytic functions, whose coefficients decay geometrically.
 *
 * Used to tabulate expensive smooth one-dimensional functions (known-variance range and
 * Dunnett probabilities, on a log scale) that an outer integral then evaluates many times.
 */

const N = 24

export interface ChebTable {
  breaks: Float64Array
  coefs: Float64Array[]
}

/** Chebyshev coefficients of f on [a, b] from its values at N points of the first kind. */
export function chebFit(f: (x: number) => number, a: number, b: number): Float64Array {
  const v = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    const t = Math.cos((Math.PI * (k + 0.5)) / N)
    v[k] = f(0.5 * (a + b) + 0.5 * (b - a) * t)
  }
  const c = new Float64Array(N)
  for (let j = 0; j < N; j++) {
    let s = 0
    for (let k = 0; k < N; k++) s += v[k]! * Math.cos((Math.PI * j * (k + 0.5)) / N)
    c[j] = (2 / N) * s
  }
  c[0] = c[0]! / 2
  return c
}

/**
 * Tabulates f on [a, b] to about absTol + relTol·max|f| per panel. Panels narrower than
 * minWidth are accepted as they are.
 */
export function chebTable(
  f: (x: number) => number,
  a: number,
  b: number,
  absTol = 1e-15,
  relTol = 1e-15,
  minWidth = 1e-3,
): ChebTable {
  const breaks: number[] = []
  const coefs: Float64Array[] = []
  const stack: [number, number][] = [[a, b]]
  const done: { a: number; b: number; c: Float64Array }[] = []
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!
    const c = chebFit(f, lo, hi)
    let scale = 0
    for (let j = 0; j < N; j++) scale += Math.abs(c[j]!)
    const tail = Math.max(Math.abs(c[N - 1]!), Math.abs(c[N - 2]!), Math.abs(c[N - 3]!))
    const ok = tail <= absTol + relTol * scale || !Number.isFinite(scale)
    if (ok || hi - lo <= minWidth) done.push({ a: lo, b: hi, c })
    else {
      const mid = 0.5 * (lo + hi)
      stack.push([mid, hi], [lo, mid])
    }
  }
  done.sort((x, y) => x.a - y.a)
  for (const d of done) {
    breaks.push(d.a)
    coefs.push(d.c)
  }
  breaks.push(b)
  return { breaks: Float64Array.from(breaks), coefs }
}

/** Evaluates a table at x (clamped to its range) by Clenshaw's recurrence. */
export function chebEval(t: ChebTable, x: number): number {
  const br = t.breaks
  const n = t.coefs.length
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (x >= br[mid]!) lo = mid
    else hi = mid - 1
  }
  const a = br[lo]!
  const b = br[lo + 1]!
  const u = Math.max(-1, Math.min(1, (2 * x - a - b) / (b - a)))
  const c = t.coefs[lo]!
  let b1 = 0
  let b2 = 0
  for (let j = N - 1; j >= 1; j--) {
    const tmp = 2 * u * b1 - b2 + c[j]!
    b2 = b1
    b1 = tmp
  }
  return u * b1 - b2 + c[0]!
}
