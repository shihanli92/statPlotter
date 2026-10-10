/**
 * The smallest and largest value, as `Math.min(...values)` and `Math.max(...values)` give them
 * (NaN if any value is NaN; [Infinity, −Infinity] when there are none) but without spreading the
 * values into arguments, which overflows the call stack beyond about 100k values.
 */
export function minMax(values: Iterable<number>): [number, number] {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const v of values) {
    if (Number.isNaN(v)) return [Number.NaN, Number.NaN]
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return [lo, hi]
}

/** Union of boxes as one box; null when there are none. */
export function boxesUnion(boxes: readonly { x: number; y: number; w: number; h: number }[]) {
  if (!boxes.length) return null
  let [x0, y0] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  let [x1, y1] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const b of boxes) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
