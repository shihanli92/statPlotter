/**
 * Effect (sum-to-zero, R's contr.sum) coding of factorial designs: level l < L − 1 of a factor is
 * the unit vector e_l, the last level −1 in every column; an interaction's columns are the
 * products of its factors' columns (first factor varying slowest).
 */

/** Effect code of level `lv` in column `i` of a factor with L levels. */
const effectCode = (lv: number, i: number, L: number): number =>
  lv === i ? 1 : lv === L - 1 ? -1 : 0

/** A term's columns at the given levels of every factor (`levels[f]` for factor f). */
export function termColumns(
  levels: readonly number[],
  term: readonly number[],
  L: readonly number[],
): number[] {
  let cols = [1]
  for (const f of term) {
    const next: number[] = []
    for (const c of cols)
      for (let i = 0; i < L[f]! - 1; i++) next.push(c * effectCode(levels[f]!, i, L[f]!))
    cols = next
  }
  return cols
}

/** Number of columns (df) of a term: Π (L_f − 1). */
export const termWidth = (term: readonly number[], L: readonly number[]): number =>
  term.reduce((s, f) => s * (L[f]! - 1), 1)

/** Design row [1, columns of each term in order] at the given levels. */
export function designRow(
  levels: readonly number[],
  L: readonly number[],
  terms: readonly (readonly number[])[],
): number[] {
  const out = [1]
  for (const t of terms) out.push(...termColumns(levels, t, L))
  return out
}

/** Design row [1, c_1..c_{k−1}] of level g of a single factor with k levels. */
export const levelRow = (g: number, k: number): number[] => designRow([g], [k], [[0]])

/** levelRow(i, k) − levelRow(j, k): the contrast of level i's mean minus level j's. */
export function levelDiff(i: number, j: number, k: number): number[] {
  const b = levelRow(j, k)
  return levelRow(i, k).map((v, c) => v - b[c]!)
}

/** Every subset of s (the empty one first), by bit mask: element i is in subset m if bit i is. */
export function subsets(s: readonly number[]): number[][] {
  const out: number[][] = []
  for (let m = 0; m < 1 << s.length; m++) out.push(s.filter((_, i) => m & (1 << i)))
  return out
}
