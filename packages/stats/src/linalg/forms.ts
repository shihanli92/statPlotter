/** c[0] + c[1] x + … + c[m] x^m by Horner's rule. */
export function poly(c: readonly number[], x: number): number {
  let s = 0
  for (let i = c.length - 1; i >= 0; i--) s = s * x + c[i]!
  return s
}

/** xᵀ A y for a row-major n×n A, summed term by term (row index outer). */
export function bilinear(
  x: ArrayLike<number>,
  A: ArrayLike<number>,
  y: ArrayLike<number>,
  n: number = x.length,
): number {
  let s = 0
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) s += x[a]! * A[a * n + b]! * y[b]!
  return s
}
