import type { Alternative } from '../tests/common.ts'
import { gcd } from './rankExact.ts'

/** (v − min v)/g with g the gcd of the differences, and the sorted distinct values' counts. */
function reduce(v: ArrayLike<number>): number[] {
  let lo = Number.POSITIVE_INFINITY
  for (let i = 0; i < v.length; i++) lo = Math.min(lo, v[i]!)
  let g = 0
  for (let i = 0; i < v.length; i++) g = gcd(g, v[i]! - lo)
  return Array.from(v, (x) => (g > 0 ? (x - lo) / g : 0))
}

interface Dist {
  off: number
  arr: Float64Array
}

/**
 * The last distribution built, keyed by the sorted reduced scores it depends on: the one-sided
 * and two-sided P of the same data (both are reported) share it, and n = 17 takes a second.
 */
let last: { key: string; dist: Dist } | undefined

/**
 * Exact permutation P value of the linear statistic T = Σ a_i b_π(i) over all n! pairings,
 * for integer scores a, b (e.g. doubled mid-ranks; ties allowed). Spearman's r_s (Pearson on
 * mid-ranks) is increasing in T for fixed tie patterns, so this is the exact P of r_s
 * ('greater' = positive association: P(T ≥ t); two-sided: P(|T − E T| ≥ |t − E T|)).
 *
 * The distribution is built by dynamic programming over positions (sorted by a): the state is
 * the multiset of b values already used (so tied b values are merged), holding the
 * distribution of the partial sum; a transition uses one more of the c_v − used_v remaining
 * copies of value v. Scores are first reduced to (s − min)/gcd, which changes T only by an
 * increasing affine map. The partial sums' range for a state follows from the rearrangement
 * inequality, so each distribution is allocated once. Work is O(Σ_states range·distinct b);
 * n = 17 without ties (2^17 states) takes about a second. Counts are exact integers up to
 * n = 18 (n! < 2^53).
 */
export function permutationCorrelationP(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  alternative: Alternative,
): number {
  const n = a.length
  if (n !== b.length) throw new RangeError('permutation test: a and b must have equal lengths')
  if (n === 0) return Number.NaN
  const ra = reduce(a)
  const rb = reduce(b)
  // Observed statistic, and positions sorted by a.
  let tObs = 0
  let sa = 0
  let sb = 0
  for (let i = 0; i < n; i++) {
    tObs += ra[i]! * rb[i]!
    sa += ra[i]!
    sb += rb[i]!
  }
  const as = ra.slice().sort((x, y) => x - y)
  // Distinct b values ascending, with counts.
  const bs = rb.slice().sort((x, y) => x - y)
  const vals: number[] = []
  const cnt: number[] = []
  for (const v of bs) {
    if (vals.length > 0 && vals[vals.length - 1] === v) cnt[cnt.length - 1]!++
    else {
      vals.push(v)
      cnt.push(1)
    }
  }

  const key = `${as.join(',')}|${bs.join(',')}`
  if (last?.key !== key) last = { key, dist: distribution(as, vals, cnt) }
  const { off, arr } = last.dist
  let total = 0
  let hit = 0
  const nE = sa * sb // n·E[T]
  const dObs = Math.abs(n * tObs - nE)
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i]!
    if (c === 0) continue
    total += c
    const t = off + i
    const ok =
      alternative === 'greater'
        ? t >= tObs
        : alternative === 'less'
          ? t <= tObs
          : Math.abs(n * t - nE) >= dObs
    if (ok) hit += c
  }
  return Math.min(1, hit / total)
}

/** Distribution of T over all pairings of the sorted scores `as` with the multiset (vals, cnt). */
function distribution(as: number[], vals: number[], cnt: number[]): Dist {
  const n = as.length
  const D = vals.length
  const radix: number[] = []
  let r = 1
  for (let v = 0; v < D; v++) {
    radix.push(r)
    r *= cnt[v]! + 1
  }

  const used = new Array<number>(D).fill(0)
  const decode = (s: number) => {
    for (let v = 0; v < D; v++) {
      used[v] = Math.floor(s / radix[v]!) % (cnt[v]! + 1)
    }
  }
  // Range of Σ_{p<k} as[p]·(assigned b) for the multiset `used` (k = Σ used).
  const range = (k: number): [number, number] => {
    let lo = 0
    let hi = 0
    // min: ascending a with descending b; max: ascending with ascending.
    let p = 0
    for (let v = D - 1; v >= 0; v--) for (let c = 0; c < used[v]!; c++) lo += as[p++]! * vals[v]!
    p = 0
    for (let v = 0; v < D; v++) for (let c = 0; c < used[v]!; c++) hi += as[p++]! * vals[v]!
    if (p !== k) throw new Error('internal: layer mismatch')
    return [lo, hi]
  }

  let layer = new Map<number, Dist>([[0, { off: 0, arr: Float64Array.of(1) }]])
  for (let k = 0; k < n; k++) {
    const ak = as[k]!
    const next = new Map<number, Dist>()
    for (const [s, { off, arr }] of layer) {
      decode(s)
      for (let v = 0; v < D; v++) {
        const left = cnt[v]! - used[v]!
        if (left === 0) continue
        const ns = s + radix[v]!
        let e = next.get(ns)
        if (!e) {
          used[v]!++
          const [lo, hi] = range(k + 1)
          used[v]!--
          e = { off: lo, arr: new Float64Array(hi - lo + 1) }
          next.set(ns, e)
        }
        const base = off + ak * vals[v]! - e.off
        const dst = e.arr
        const len = arr.length
        if (left === 1) for (let t = 0; t < len; t++) dst[base + t]! += arr[t]!
        else for (let t = 0; t < len; t++) dst[base + t]! += left * arr[t]!
      }
    }
    layer = next
  }
  return layer.values().next().value as Dist
}
