/**
 * Helpers for automatic initial values (rules on the data), shared by the equation library.
 */

const LN2 = Math.LN2

export interface Profile {
  xs: number[]
  ys: number[]
  ymin: number
  ymax: number
  xmin: number
  xmax: number
  /** +1 if Y rises with X, −1 if it falls. */
  trend: 1 | -1
}

/** Mean Y per distinct X, sorted by X. */
export function profile(x: ArrayLike<number>, y: ArrayLike<number>): Profile {
  const idx = Array.from({ length: x.length }, (_, i) => i).sort((a, b) => x[a]! - x[b]!)
  const xs: number[] = []
  const ys: number[] = []
  for (let k = 0; k < idx.length; ) {
    const xv = x[idx[k]!]!
    let s = 0
    let c = 0
    while (k < idx.length && x[idx[k]!] === xv) {
      s += y[idx[k]!]!
      c++
      k++
    }
    xs.push(xv)
    ys.push(s / c)
  }
  if (xs.length === 0) throw new RangeError('no data')
  const n = xs.length
  let mx = 0
  let my = 0
  for (let i = 0; i < n; i++) {
    mx += xs[i]!
    my += ys[i]!
  }
  mx /= n
  my /= n
  let sxy = 0
  for (let i = 0; i < n; i++) sxy += (xs[i]! - mx) * (ys[i]! - my)
  return {
    xs,
    ys,
    ymin: minOf(ys),
    ymax: maxOf(ys),
    xmin: xs[0]!,
    xmax: xs[n - 1]!,
    trend: sxy < 0 ? -1 : 1,
  }
}

/**
 * Math.min / Math.max of an array without spreading it into arguments (which overflows the
 * call stack beyond ~10⁵ values); NaN if any value is NaN, ±∞ for an empty array, as they do.
 */
export function minOf(a: ArrayLike<number>): number {
  let m = Number.POSITIVE_INFINITY
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!
    if (Number.isNaN(v)) return Number.NaN
    if (v < m) m = v
  }
  return m
}

export function maxOf(a: ArrayLike<number>): number {
  let m = Number.NEGATIVE_INFINITY
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!
    if (Number.isNaN(v)) return Number.NaN
    if (v > m) m = v
  }
  return m
}

/** X where Y first crosses `level` (linear interpolation), else the X whose Y is closest. */
export function xAtLevel(pr: Profile, level: number, from = 0): number {
  const { xs, ys } = pr
  for (let i = from; i < xs.length - 1; i++) {
    const a = ys[i]! - level
    const b = ys[i + 1]! - level
    if (a === 0) return xs[i]!
    if (a * b < 0) return xs[i]! + ((xs[i + 1]! - xs[i]!) * a) / (a - b)
  }
  let best = from
  for (let i = from; i < xs.length; i++) {
    if (Math.abs(ys[i]! - level) < Math.abs(ys[best]! - level)) best = i
  }
  return xs[best]!
}

export function argmax(v: number[]): number {
  let k = 0
  for (let i = 1; i < v.length; i++) if (v[i]! > v[k]!) k = i
  return k
}

export function xRange(pr: Profile): number {
  const r = pr.xmax - pr.xmin
  return r > 0 ? r : 1
}

/** Rate constant from the half-way point between the first and last mean Y. */
export function rateFromHalfLife(pr: Profile): number {
  const first = pr.ys[0]!
  const last = pr.ys[pr.ys.length - 1]!
  const xh = xAtLevel(pr, (first + last) / 2)
  const dt = xh - pr.xmin
  return dt > 0 ? LN2 / dt : LN2 / (xRange(pr) / 4)
}

/** [s, 1 − s] with s = 1/(1 + 10^z), both without cancellation or overflow. */
export function logistic10(z: number): [number, number] {
  if (z > 0) {
    const t = 10 ** -z
    return [t / (1 + t), 1 / (1 + t)]
  }
  const t = 10 ** z
  return [1 / (1 + t), t / (1 + t)]
}

/** [s, 1 − s] with s = 1/(1 + e^z). */
export function logisticE(z: number): [number, number] {
  if (z > 0) {
    const t = Math.exp(-z)
    return [t / (1 + t), 1 / (1 + t)]
  }
  const t = Math.exp(z)
  return [1 / (1 + t), t / (1 + t)]
}

// ---- rules for initial values (user-defined equations) -------------------------------

/**
 * A rule for a parameter's initial value (the "Rules for initial values" tab): a number
 * times — or, for a rule written
 * with a leading '/', divided by — a quantity computed from each data set, or the number itself
 * ('value', "Initial value, to be fit"). The quantities, all from one mean Y per distinct X:
 *
 * - YMIN, YMAX, YMID = (YMIN + YMAX)/2; XMIN, XMAX, XMID = (XMIN + XMAX)/2;
 *   YMAX − YMIN and XMAX − XMIN;
 * - XatYMID: the X where straight lines connecting the points first reach YMID; YatXMID: the Y
 *   on the line between the point with the largest X below XMID and the one with the smallest X
 *   above it;
 * - SIGN(YatXmax − YatXmin): +1 if the curve goes up from left to right, −1 if it goes down;
 * - the slope at XMIN, XMID or XMAX: with 30 or more points the least-squares slope of the
 *   first, middle or last 10% of them (rounded down), otherwise of the first or last two points
 *   or the middle two (even count) or three (odd count).
 */
export interface InitialRule {
  rule: string
  value: number
}

export const INITIAL_RULES: readonly { id: string; label: string }[] = [
  { id: 'value', label: '(Initial value, to be fit)' },
  { id: 'ymin', label: '× YMIN' },
  { id: 'ymax', label: '× YMAX' },
  { id: 'ymid', label: '× YMID' },
  { id: 'xmin', label: '× XMIN' },
  { id: 'xmax', label: '× XMAX' },
  { id: 'xmid', label: '× XMID' },
  { id: 'xatymid', label: '× (Value of X at YMID)' },
  { id: 'yatxmid', label: '× (Value of Y at XMID)' },
  { id: 'yrange', label: '× (YMAX − YMIN)' },
  { id: 'xrange', label: '× (XMAX − XMIN)' },
  { id: 'sign', label: '× SIGN(YatXmax − YatXmin)' },
  { id: 'slopexmin', label: '× (Slope at XMIN)' },
  { id: 'slopexmid', label: '× (Slope at XMID)' },
  { id: 'slopexmax', label: '× (Slope at XMAX)' },
  { id: '/ymax', label: '÷ YMAX' },
  { id: '/xmid', label: '÷ XMID' },
  { id: '/xatymid', label: '÷ (Value of X at YMID)' },
  { id: '/slopexmin', label: '÷ (Slope at XMIN)' },
  { id: '/slopexmid', label: '÷ (Slope at XMID)' },
  { id: '/slopexmax', label: '÷ (Slope at XMAX)' },
]

/** Least-squares slope of points lo … hi − 1 of a profile. */
function slopeOf(xs: number[], ys: number[], lo: number, hi: number): number {
  const n = hi - lo
  if (n < 2) return Number.NaN
  let mx = 0
  let my = 0
  for (let i = lo; i < hi; i++) {
    mx += xs[i]!
    my += ys[i]!
  }
  mx /= n
  my /= n
  let sxy = 0
  let sxx = 0
  for (let i = lo; i < hi; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my)
    sxx += (xs[i]! - mx) ** 2
  }
  return sxx > 0 ? sxy / sxx : Number.NaN
}

/** The slope at the start, middle or end of the data (see InitialRule). */
function slopeAt(pr: Profile, where: 'min' | 'mid' | 'max'): number {
  const { xs, ys } = pr
  const n = xs.length
  if (n >= 30) {
    const k = Math.floor(n / 10)
    if (where === 'min') return slopeOf(xs, ys, 0, k)
    if (where === 'max') return slopeOf(xs, ys, n - k, n)
    const lo = Math.floor((n - k) / 2)
    return slopeOf(xs, ys, lo, lo + k)
  }
  if (where === 'min') return slopeOf(xs, ys, 0, 2)
  if (where === 'max') return slopeOf(xs, ys, n - 2, n)
  const m = n % 2 === 0 ? 2 : 3
  const lo = Math.floor((n - m) / 2)
  return slopeOf(xs, ys, lo, lo + m)
}

/** The quantity a rule id names, for one data set (NaN if unknown or not computable). */
function ruleQuantity(id: string, pr: Profile): number {
  const { xs, ys } = pr
  const n = xs.length
  switch (id) {
    case 'ymin':
      return pr.ymin
    case 'ymax':
      return pr.ymax
    case 'ymid':
      return (pr.ymin + pr.ymax) / 2
    case 'xmin':
      return pr.xmin
    case 'xmax':
      return pr.xmax
    case 'xmid':
      return (pr.xmin + pr.xmax) / 2
    case 'xatymid':
      return xAtLevel(pr, (pr.ymin + pr.ymax) / 2)
    case 'yatxmid': {
      const xm = (pr.xmin + pr.xmax) / 2
      let below = -1
      let above = -1
      for (let i = 0; i < n; i++) {
        if (xs[i]! < xm) below = i
        else if (xs[i]! > xm && above < 0) above = i
        else if (xs[i] === xm) return ys[i]!
      }
      if (below < 0 || above < 0) return ys[Math.floor(n / 2)]!
      const t = (xm - xs[below]!) / (xs[above]! - xs[below]!)
      return ys[below]! + t * (ys[above]! - ys[below]!)
    }
    case 'yrange':
      return pr.ymax - pr.ymin
    case 'xrange':
      return pr.xmax - pr.xmin
    case 'sign':
      return ys[n - 1]! >= ys[0]! ? 1 : -1
    case 'slopexmin':
      return slopeAt(pr, 'min')
    case 'slopexmid':
      return slopeAt(pr, 'mid')
    case 'slopexmax':
      return slopeAt(pr, 'max')
    // Internal (not a rule users write): Y at the smallest X, for Y[0] of differential equations.
    case 'yatxmin':
      return ys[0]!
    default:
      return Number.NaN
  }
}

/** The initial value a rule gives for one data set (NaN if the data can't provide it). */
export function initialFromRule(
  r: InitialRule,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): number {
  const raw = r.rule.trim().toLowerCase()
  const divide = raw.startsWith('/')
  const id = raw.replace(/[^a-z]/g, '')
  if (id === 'value' || id === '') return r.value
  let pr: Profile
  try {
    pr = profile(x, y)
  } catch {
    return Number.NaN
  }
  const q = ruleQuantity(id, pr)
  return divide ? r.value / q : r.value * q
}
