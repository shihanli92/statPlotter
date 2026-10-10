// Small array helpers shared by the statistics, the analyses and the graphs (audit 2, S10: one
// implementation each instead of copies in every package).

/**
 * R's `seq.int(from, to, length.out = n)`: from + i · (to − from) / (n − 1), the last exactly
 * `to`.
 */
export function seqLength(from: number, to: number, n: number): Float64Array {
  const out = new Float64Array(Math.max(0, n))
  if (n > 0) out[0] = from
  if (n > 1) out[n - 1] = to
  if (n > 2) {
    const by = (to - from) / (n - 1)
    for (let i = 1; i < n - 1; i++) out[i] = from + i * by
  }
  return out
}

/**
 * The smallest and largest of the first `n` values ([∞, −∞] when there are none). Missing values
 * (NaN) are skipped, and with `finiteOnly` ±∞ too.
 */
export function valueRange(
  v: ArrayLike<number>,
  finiteOnly = false,
  n = v.length,
): [number, number] {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let i = 0; i < n; i++) {
    const x = v[i]!
    if (finiteOnly && !Number.isFinite(x)) continue
    if (x < lo) lo = x
    if (x > hi) hi = x
  }
  return [lo, hi]
}

/**
 * The mean of each of the first `rows` rows across the columns `cols` (a data set's replicates),
 * NaN where a row has no value. Missing values (NaN) are skipped, and with `finiteOnly` ±∞ too.
 */
export function meanAcross(
  cols: readonly ArrayLike<number>[],
  rows: number,
  finiteOnly = false,
): Float64Array {
  const out = new Float64Array(rows)
  for (let r = 0; r < rows; r++) {
    let s = 0
    let n = 0
    for (const c of cols) {
      const v = c[r]!
      if (finiteOnly ? Number.isFinite(v) : !Number.isNaN(v)) {
        s += v
        n++
      }
    }
    out[r] = n ? s / n : Number.NaN
  }
  return out
}

// Typed arrays filled by loops, without a callback per element: `Float64Array.from(x, map)` runs
// tens of times slower in V8 (decision 131; lint rule tools/lint/typedArrayFromMap.grit).

/** x[i] − c. */
export function shifted(x: ArrayLike<number>, c: number): Float64Array {
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = x[i]! - c
  return out
}

/** b[i] − a[i] over the length of `a` (paired differences). */
export function differences(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = b[i]! - a[i]!
  return out
}

/** |x[i]|. */
export function absolutes(x: ArrayLike<number>): Float64Array {
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = Math.abs(x[i]!)
  return out
}

/** Column j of a matrix given by rows. */
export function columnOf(rows: readonly ArrayLike<number>[], j: number): Float64Array {
  const out = new Float64Array(rows.length)
  for (let i = 0; i < rows.length; i++) out[i] = rows[i]![j]!
  return out
}

/** The `value` of each entry (a fit's parameter estimates). */
export function valuesOf(entries: readonly { value: number }[]): Float64Array {
  const out = new Float64Array(entries.length)
  for (let i = 0; i < entries.length; i++) out[i] = entries[i]!.value
  return out
}
