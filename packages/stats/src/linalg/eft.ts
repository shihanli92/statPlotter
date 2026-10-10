/**
 * Error-free transformations and doubled-precision kernels built on them.
 *
 * TwoSum: Knuth, TAOCP vol. 2, §4.2.2. TwoProduct: Dekker (1971), "A floating-point technique for
 * extending the available precision", Numer. Math. 18 (Veltkamp splitting). Dot2: Ogita, Rump &
 * Oishi (2005), "Accurate sum and dot product", SIAM J. Sci. Comput. 26. Compensated Horner:
 * Graillat, Langlois & Louvet (2005), "Compensated Horner scheme".
 */

const SPLIT = 134217729 // 2^27 + 1

/** Error of the floating-point product p = fl(a·b), exactly: a·b = p + e. */
function twoProductError(a: number, b: number, p: number): number {
  let t = SPLIT * a
  const ah = t - (t - a)
  const al = a - ah
  t = SPLIT * b
  const bh = t - (t - b)
  const bl = b - bh
  return al * bl - (p - ah * bh - al * bh - ah * bl)
}

/** init + Σ a[i]·b[i], as accurate as if computed in twice the working precision. */
export function dot2(a: ArrayLike<number>, b: ArrayLike<number>, n: number, init = 0): number {
  let s = init
  let c = 0
  for (let i = 0; i < n; i++) {
    const x = a[i]!
    const y = b[i]!
    const p = x * y
    const pe = twoProductError(x, y, p)
    const t = s + p
    const z = t - s
    c += s - (t - z) + (p - z) + pe
    s = t
  }
  return s + c
}

/** Σ coef[k]·x^k (ascending powers) by compensated Horner. */
export function compHorner(coef: ArrayLike<number>, x: number): number {
  let s = coef[coef.length - 1]!
  let c = 0
  for (let k = coef.length - 2; k >= 0; k--) {
    const p = s * x
    const pe = twoProductError(s, x, p)
    const a = coef[k]!
    const t = p + a
    const z = t - p
    const se = p - (t - z) + (a - z)
    s = t
    c = c * x + (pe + se)
  }
  return s + c
}
