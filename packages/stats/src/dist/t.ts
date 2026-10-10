import { ibeta } from '../special/beta.ts'
import { lbeta } from '../special/gamma.ts'
import { normalQuantile } from './normal.ts'

/**
 * I_x(df/2, ½) (upper) or I_y(½, df/2) (central), with x = df/(df + t²) and y = 1 − x =
 * t²/(df + t²) each formed without subtraction.
 */
function tBeta(t: number, df: number, upper: boolean): number {
  const r = (t * t) / df
  let x: number
  let y: number
  if (r < 1) {
    x = 1 / (1 + r)
    y = r / (1 + r)
  } else {
    const s = df / (t * t)
    x = s / (1 + s)
    y = 1 / (1 + s)
  }
  return upper ? ibeta(x, y, df / 2, 0.5)[0] : ibeta(y, x, 0.5, df / 2)[0]
}

/**
 * Upper tail P(T > t) for t ≥ 0: ½ I_x(df/2, ½) with x = df/(df + t²) (A&S 26.7.1). x and
 * 1 − x are both formed without subtraction. For t²/df > 1e100 the leading term of the series,
 * x^a / (a B(a, ½)) with ln x = ln df − 2 ln t, is exact to double precision and avoids
 * overflowing t².
 */
function upperTail(t: number, df: number): number {
  if (t === 0) return 0.5
  if (t === Number.POSITIVE_INFINITY) return 0
  const a = df / 2
  const logRatio = 2 * Math.log(t) - Math.log(df) // ln(t²/df)
  if (logRatio > 230) {
    const lx = -logRatio
    return 0.5 * Math.exp(a * lx - Math.log(a) - lbeta(a, 0.5))
  }
  return 0.5 * tBeta(t, df, true)
}

function valid(t: number, df: number): boolean {
  return !Number.isNaN(t) && df > 0
}

/** Student t CDF P(T ≤ t). Lower-tail values keep full relative accuracy. */
export function tCdf(t: number, df: number): number {
  if (!valid(t, df)) return Number.NaN
  return t <= 0 ? upperTail(-t, df) : 1 - upperTail(t, df)
}

/** Student t survival function P(T > t), computed directly. */
export function tSf(t: number, df: number): number {
  if (!valid(t, df)) return Number.NaN
  return t >= 0 ? upperTail(t, df) : 1 - upperTail(-t, df)
}

/** Student t density. */
export function tPdf(t: number, df: number): number {
  if (!valid(t, df)) return Number.NaN
  const at = Math.abs(t)
  if (at === Number.POSITIVE_INFINITY) return 0
  // ln(1 + t²/df), without overflowing t² for huge t
  const l =
    at * at < df
      ? Math.log1p((at * at) / df)
      : 2 * Math.log(at) - Math.log(df) + Math.log1p(df / at / at)
  return Math.exp(-0.5 * Math.log(df) - lbeta(df / 2, 0.5) - ((df + 1) / 2) * l)
}

/**
 * Quantile of Student's t. `p` is a lower-tail probability, or upper-tail when lowerTail is
 * false.
 *
 * df = 1 and 2 have closed forms. Otherwise: Cornish–Fisher start (A&S 26.7.5) — or, for
 * df < 2 in the tail, where that expansion is useless, the tail asymptote below — then Newton
 * on ln S(t) as a function of ln t, where S is the upper tail — close to linear in the tails
 * (S ~ C t^−df) — with a bisection fallback that keeps iterates inside the current bracket.
 * A quantile beyond the largest double is ±∞.
 */
export function tQuantile(p: number, df: number, lowerTail = true): number {
  if (Number.isNaN(p) || Number.isNaN(df) || p < 0 || p > 1 || !(df > 0)) return Number.NaN
  // Upper-tail probability q ≤ ½ of |t|, and the sign of the result.
  const upperP = !lowerTail
  let q: number
  let sign: number
  if (p < 0.5) {
    q = p
    sign = upperP ? 1 : -1
  } else {
    q = 1 - p // exact for p ≥ ½
    sign = upperP ? -1 : 1
  }
  if (q === 0.5) return 0
  if (q === 0) return sign * Number.POSITIVE_INFINITY
  if (df === Number.POSITIVE_INFINITY) return -sign * normalQuantile(q)
  // Cauchy: t = cot(πq); for q near ½ use tan(π(½ − q)) with ½ − q exact.
  if (df === 1) return sign * (q < 0.25 ? 1 / Math.tan(Math.PI * q) : Math.tan(Math.PI * (0.5 - q)))
  if (df === 2) return (sign * (1 - 2 * q)) / Math.sqrt(2 * q * (1 - q))
  return sign * solveUpper(q, df)
}

/** Cornish–Fisher expansion of t_q in powers of 1/df (A&S 26.7.5). */
function cornishFisher(z: number, df: number): number {
  const z2 = z * z
  const g1 = (z2 + 1) * z * 0.25
  const g2 = ((5 * z2 + 16) * z2 + 3) * z * (1 / 96)
  const g3 = (((3 * z2 + 19) * z2 + 17) * z2 - 15) * z * (1 / 384)
  const g4 = ((((79 * z2 + 776) * z2 + 1482) * z2 - 1920) * z2 - 945) * z * (1 / 92160)
  return z + (g1 + (g2 + (g3 + g4 / df) / df) / df) / df
}

/**
 * Solves S(t) = q for t > 0, q ∈ (0, ½), by safeguarded Newton. For q ≤ ¼ the unknown is
 * ln t and the residual ln S − ln q. For q > ¼ (t small) S ≈ ½ is ill-conditioned, so the
 * residual is the central probability C(t) = P(0 < T < t) − (½ − q), computed directly and
 * with ½ − q exact.
 */
function solveUpper(q: number, df: number): number {
  const z = -normalQuantile(q)
  const central = q > 0.25
  const target = central ? 0.5 - q : Math.log(q)
  let t: number
  if (!central && df < 2) {
    // Tail asymptote S(t) ≈ df^(df/2 − 1) t^−df / B(df/2, ½), i.e.
    //   t ≈ (q·df·B(df/2, ½))^(−1/df) · √df, taken in logs (t can exceed 1e300).
    const lt = -(target + Math.log(df) + lbeta(df / 2, 0.5)) / df + 0.5 * Math.log(df)
    if (lt > 700 && upperTail(Number.MAX_VALUE, df) > q) return Number.POSITIVE_INFINITY
    t = Math.min(Math.exp(lt), Number.MAX_VALUE)
  } else t = cornishFisher(z, df)
  if (!(t > 0) || !Number.isFinite(t)) t = z > 0 ? z : 1
  let lo = 0
  let hi = Number.POSITIVE_INFINITY
  for (let iter = 0; iter < 200; iter++) {
    const f = tPdf(t, df)
    let tNew: number
    if (central) {
      const c = centralProb(t, df)
      if (c < target) lo = t
      else if (c > target) hi = t
      else return t
      tNew = t - (c - target) / f
    } else {
      const s = upperTail(t, df)
      if (s > q) lo = t
      else if (s < q) hi = t
      else return t
      // g(u) = ln S − ln q with u = ln t; g'(u) = −t f / S.
      tNew = t * Math.exp(((Math.log(s) - target) * s) / (t * f))
    }
    if (!(tNew > lo && tNew < hi)) {
      if (hi === Number.POSITIVE_INFINITY) {
        // Grow fast (squaring beyond 2) but stay finite; past the largest double: ∞.
        if (lo === Number.MAX_VALUE) return Number.POSITIVE_INFINITY
        const m = Math.max(t, lo)
        tNew = Math.min(Number.MAX_VALUE, m > 2 ? m * m : 2 * m)
      } else tNew = lo > 0 ? Math.sqrt(lo) * Math.sqrt(hi) : hi / 2
    }
    if (Math.abs(tNew - t) <= 4e-16 * t) return tNew
    t = tNew
  }
  return t
}

/** P(0 < T < t) = ½ I_y(½, df/2), y = t²/(df + t²), for t ≥ 0. */
function centralProb(t: number, df: number): number {
  return 0.5 * tBeta(t, df, false)
}
