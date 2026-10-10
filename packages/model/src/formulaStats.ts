/*
 * Statistics the formula language computes over a whole column, or within the groups of other
 * columns (roadmap 38): the nine sample quantiles of Hyndman & Fan, ranks with R's tie methods,
 * means, medians, variances, and `cut()` intervals and labels. `@ps/model` depends on nothing
 * internal, so these are written here rather than taken from `@ps/stats`; they are written from
 * the published definitions (not translated from R's code), and every one is checked against R
 * (oracle suite `formula`: `quantile(type =)`, `rank(ties.method =)`, `ave()`, `cut()`).
 *
 * Missing values (NaN) are left out of every statistic (R's na.rm = TRUE).
 */

/** Ascending copy of the finite values. */
export function sortedFinite(values: ArrayLike<number>): Float64Array {
  let n = 0
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) n++
  const out = new Float64Array(n)
  let j = 0
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) out[j++] = values[i]!
  return out.sort()
}

/** Machine epsilon: the tolerance of the probability and of an index meant to be whole. */
const EPS = 2.220446049250313e-16

/**
 * The quantile definitions of Hyndman & Fan (1996), "Sample quantiles in statistical packages",
 * The American Statistician 50(4), 361–365 (R's `quantile(type =)` numbers them the same): for
 * the order statistics x(1) ≤ … ≤ x(n), Q(p) = (1 − γ)·x(j) + γ·x(j + 1), with j = ⌊np + m⌋ and
 * g = np + m − j. Types 1–3 step (γ from g); types 4–9 interpolate (γ = g) at the plotting
 * positions p(k) = (k − α)/(n + 1 − α − β), for which m = α + p(1 − α − β).
 */
const HF_CONTINUOUS: Readonly<Record<number, readonly [alpha: number, beta: number]>> = {
  4: [0, 1],
  5: [0.5, 0.5],
  6: [0, 0],
  7: [1, 1],
  8: [1 / 3, 1 / 3],
  9: [3 / 8, 3 / 8],
}

/**
 * Quantile `p` (0–1) of ascending values `x`, of Hyndman & Fan's type `type` (1–9, default 7,
 * as R's `quantile(x, p, type)`). NaN for no values, a probability outside [0, 1] or another
 * type.
 */
export function quantileOfSorted(x: ArrayLike<number>, p: number, type = 7): number {
  const n = x.length
  if (n === 0 || !Number.isFinite(p) || !Number.isInteger(type) || type < 1 || type > 9)
    return Number.NaN
  // A probability a rounding error outside [0, 1] counts as the end.
  if (p < -100 * EPS || p > 1 + 100 * EPS) return Number.NaN
  const prob = Math.min(1, Math.max(0, p))
  /** x(k), the order statistics beyond the ends being the ends. */
  const order = (k: number) => x[Math.min(n, Math.max(1, k)) - 1]!
  /** (1 − γ)·x(j) + γ·x(j + 1); x(j) itself when γ is 0 or the two are equal. */
  const between = (j: number, gamma: number) => {
    const lo = order(j)
    if (gamma <= 0) return lo
    const hi = order(j + 1)
    if (gamma >= 1) return hi
    return lo === hi ? lo : (1 - gamma) * lo + gamma * hi
  }
  const ab = HF_CONTINUOUS[type]
  if (ab) {
    const [alpha, beta] = ab
    // np + m = α + p(n + 1 − α − β): the (fractional) position of p among the plotting positions.
    const pos = alpha + prob * (n + 1 - alpha - beta)
    // A position a rounding error below a whole number is that number.
    const j = Math.floor(pos + 4 * EPS)
    const g = pos - j
    return between(j, Math.abs(g) < 4 * EPS ? 0 : g)
  }
  // Types 1–3: m = 0 (types 1 and 2) or −½ (type 3).
  const pos = type === 3 ? n * prob - 0.5 : n * prob
  const j = Math.floor(pos)
  const g = pos - j
  // Type 1: the inverse of the empirical distribution function; type 2: the same, averaged at
  // its discontinuities; type 3: the nearest order statistic, an even one at a tie.
  const gamma = g > 0 ? 1 : type === 1 ? 0 : type === 2 ? 0.5 : Math.abs(j % 2) === 1 ? 1 : 0
  return between(j, gamma)
}

export type TieMethod = 'average' | 'min' | 'max' | 'first'
export const TIE_METHODS: readonly TieMethod[] = ['average', 'min', 'max', 'first']

/**
 * Ranks (1 = smallest) of `values` at the rows `rows`, written into `out` at those rows; R's
 * `rank(x, ties.method =, na.last = "keep")`: missing values keep no rank.
 */
export function rankRows(
  values: ArrayLike<number>,
  rows: readonly number[],
  ties: TieMethod,
  out: Float64Array,
): void {
  const idx = rows.filter((r) => Number.isFinite(values[r]!))
  // Stable: equal values keep their row order ("first").
  idx.sort((a, b) => values[a]! - values[b]! || a - b)
  for (let i = 0; i < idx.length; ) {
    let j = i
    while (j + 1 < idx.length && values[idx[j + 1]!] === values[idx[i]!]) j++
    for (let m = i; m <= j; m++) {
      out[idx[m]!] =
        ties === 'average'
          ? (i + j) / 2 + 1
          : ties === 'min'
            ? i + 1
            : ties === 'max'
              ? j + 1
              : m + 1
    }
    i = j + 1
  }
}

/** Sum, mean, sample variance (n − 1) and count of the finite values at `rows` (two passes). */
export function moments(
  values: ArrayLike<number>,
  rows: readonly number[] | null,
): { n: number; sum: number; mean: number; variance: number } {
  // Each pass a plain loop over the rows (or all of them): no callback per value (decision 131).
  const m = rows ? rows.length : values.length
  let n = 0
  let sum = 0
  for (let k = 0; k < m; k++) {
    const v = values[rows ? rows[k]! : k]!
    if (Number.isFinite(v)) {
      n++
      sum += v
    }
  }
  const mean = n ? sum / n : Number.NaN
  let ss = 0
  let corr = 0
  for (let k = 0; k < m; k++) {
    const v = values[rows ? rows[k]! : k]!
    if (Number.isFinite(v)) {
      ss += (v - mean) * (v - mean)
      corr += v - mean
    }
  }
  // R's var: two-pass with the rounding-error correction of the mean.
  const variance = n > 1 ? (ss - (corr * corr) / n) / (n - 1) : Number.NaN
  return { n, sum, mean, variance }
}

/** The finite values at `rows`, ascending. */
export function sortedAt(values: ArrayLike<number>, rows: readonly number[]): Float64Array {
  const out: number[] = []
  for (const r of rows) {
    const v = values[r]!
    if (Number.isFinite(v)) out.push(v)
  }
  return Float64Array.from(out).sort()
}

// ---------------------------------------------------------------------------------------------
// cut(): intervals and their labels
// ---------------------------------------------------------------------------------------------

/**
 * The exact decimal value of a finite, non-zero double: its digits (no leading zeros) and the
 * power of ten of the first. A double is m·2^−q (m, q whole), which is m·5^q·10^−q exactly.
 */
function exactDecimal(x: number): { digits: string; exp: number } {
  let m = Math.abs(x)
  let q = 0
  // Doubling is exact (no double reaches overflow here: a whole number needs no doubling).
  while (!Number.isInteger(m)) {
    m *= 2
    q++
  }
  const digits = (BigInt(m) * 5n ** BigInt(q)).toString()
  return { digits, exp: digits.length - 1 - q }
}

/**
 * C's `%.{digits}g` (R's `formatC(x, digits, width = 1)`, format "g", as `cut()` labels its
 * breaks): `digits` significant digits rounded from the double's exact value, a tie (only an
 * exactly representable half: 1.125, 0.3125) to an even last digit as C's printf does (1.12,
 * 0.312); fixed notation when the exponent is from −4 to digits − 1, else d.ddde±XX; trailing
 * zeros dropped.
 */
export function formatG(x: number, digits: number): string {
  if (x === 0) return '0'
  if (!Number.isFinite(x)) return String(x)
  const p = Math.max(1, Math.trunc(digits))
  const exact = exactDecimal(x)
  let kept = exact.digits.slice(0, p)
  let exp = exact.exp
  const rest = exact.digits.slice(p)
  const half = rest.length ? rest.charCodeAt(0) - 48 : 0
  const past = /[1-9]/.test(rest.slice(1))
  const lastOdd = (kept.charCodeAt(kept.length - 1) - 48) % 2 === 1
  if (half > 5 || (half === 5 && (past || lastOdd))) {
    // Up by one in the last kept digit; 9…9 becomes 10…0, one place higher.
    const up = (BigInt(kept) + 1n).toString()
    if (up.length > kept.length) exp++
    kept = up.slice(0, p)
  }
  kept = kept.padEnd(p, '0')
  const trim = (s: string) => s.replace(/0+$/, '')
  const sign = x < 0 ? '-' : ''
  if (exp < -4 || exp >= p) {
    const frac = trim(kept.slice(1))
    const e = `${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`
    return `${sign}${kept[0]}${frac ? `.${frac}` : ''}e${e}`
  }
  if (exp < 0) return `${sign}0.${trim('0'.repeat(-exp - 1) + kept)}`
  const int = kept.slice(0, exp + 1)
  const frac = trim(kept.slice(exp + 1))
  return `${sign}${int}${frac ? `.${frac}` : ''}`
}

/** Labels need at least this many significant digits (R's `dig.lab = 3`), and at most 12. */
const LABEL_DIGITS = { min: 3, max: 12 } as const

/**
 * Labels of the intervals between ascending `breaks`, as `cut()` writes them: "(a, b]"
 * (right-closed) or "[a, b)" (left-closed), the lowest (right-closed) or highest (left-closed)
 * interval closed at both ends ("[a, b]", the end included). The breaks are written with the
 * fewest significant digits from 3 to 12 at which no two neighbouring breaks read the same;
 * when even 12 don't tell them apart, the intervals are "Range_1", "Range_2"…
 */
export function cutLabels(breaks: readonly number[], right: boolean): string[] {
  const intervals = breaks.length - 1
  let ends: string[] | null = null
  for (let d = LABEL_DIGITS.min; d <= LABEL_DIGITS.max && !ends; d++) {
    const w: string[] = []
    let distinct = true
    for (let i = 0; i < breaks.length; i++) {
      w.push(formatG(breaks[i]! + 0, d))
      if (i > 0 && w[i] === w[i - 1]) distinct = false
    }
    if (distinct) ends = w
  }
  if (!ends) return Array.from({ length: intervals }, (_, i) => `Range_${i + 1}`)
  const w = ends
  return Array.from({ length: intervals }, (_, i) => {
    const closedBoth = right ? i === 0 : i === intervals - 1
    const open = right && !closedBoth ? '(' : '['
    const close = !right && !closedBoth ? ')' : ']'
    return `${open}${w[i]}, ${w[i + 1]}${close}`
  })
}

/**
 * The interval of `x` among ascending `breaks` (0-based), R's `.bincode(x, breaks, right,
 * include.lowest = TRUE)`; -1 outside them or for a missing value.
 */
export function binIndex(x: number, breaks: readonly number[], right: boolean): number {
  const nb = breaks.length
  if (!Number.isFinite(x) || nb < 2) return -1
  if (x < breaks[0]! || x > breaks[nb - 1]!) return -1
  // Binary search for the interval.
  let lo = 0
  let hi = nb - 1
  if (right) {
    if (x === breaks[0]) return 0
    // Largest i with breaks[i] < x.
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (breaks[mid]! < x) lo = mid
      else hi = mid
    }
    return lo
  }
  if (x === breaks[nb - 1]) return nb - 2
  // Largest i with breaks[i] <= x.
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (breaks[mid]! <= x) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * R's breaks for `cut(x, breaks = n)`: n equal intervals over the range, the ends moved out by
 * a thousandth of it (a constant variable: by a thousandth of its value, or 0.001). Empty when
 * there are no values.
 */
export function equalWidthBreaks(values: ArrayLike<number>, n: number): number[] {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!(lo <= hi) || n < 1) return []
  const nb = Math.trunc(n) + 1
  let dx = hi - lo
  const seq = (a: number, b: number) =>
    // R's seq.int(from, to, length.out): from + (0:(n-1)) * by, the last exactly `to`.
    Array.from({ length: nb }, (_, i) => (i === nb - 1 ? b : a + i * ((b - a) / (nb - 1))))
  if (dx === 0) {
    dx = lo !== 0 ? Math.abs(lo) : 1
    return seq(lo - dx / 1000, hi + dx / 1000)
  }
  const out = seq(lo, hi)
  out[0] = lo - dx / 1000
  out[nb - 1] = hi + dx / 1000
  return out
}

/** Breaks at the quantiles 0, 1/n, …, 1 (type 7), as `cut(x, quantile(x, 0:n / n))`. */
export function quantileBreaks(values: ArrayLike<number>, n: number): number[] {
  const s = sortedFinite(values)
  if (!s.length || n < 1) return []
  const k = Math.trunc(n)
  // R's seq(0, 1, length.out = k + 1).
  return Array.from({ length: k + 1 }, (_, i) => quantileOfSorted(s, i === k ? 1 : i / k, 7))
}
