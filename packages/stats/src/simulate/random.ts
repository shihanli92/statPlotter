import { binomCdf, binomPmf } from '../dist/binomial.ts'
import { normalQuantile } from '../dist/normal.ts'
import { tQuantile } from '../dist/t.ts'
import { lgamma } from '../special/gamma.ts'

/**
 * Seeded random numbers for simulations and Monte Carlo analyses: the same seed gives the same
 * numbers on every platform (only 32-bit integer arithmetic and correctly rounded operations).
 *
 * - Uniforms: xoshiro128** 1.1 (Blackman & Vigna, "Scrambled linear pseudorandom number
 *   generators", ACM TOMS 47, 2021; public domain reference code), state seeded from the integer
 *   seed by SplitMix32 (Steele, Lea & Flood 2014, the 32-bit variant of its finalizer). Each
 *   uniform takes two 32-bit outputs, giving 53 random bits in (0, 1).
 * - Normal deviates by inversion (AS 241, like R's default "Inversion"), t deviates by inversion
 *   of the t quantile, Poisson and binomial deviates by sequential-search inversion of the CDF
 *   started at the mode (exact in distribution for any mean; cost ∝ √mean).
 *
 * `substream(seed, i)` gives the seed of the i-th independent run (Monte Carlo) by hashing.
 */

/** SplitMix32-style mixer of a 32-bit value. */
function mix32(z: number): number {
  z = (z + 0x9e3779b9) | 0
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
  return (z ^ (z >>> 16)) >>> 0
}

/** The seed of the i-th run derived from a base seed (independent streams by hashing). */
export function substream(seed: number, i: number): number {
  return mix32(mix32(seed | 0) ^ Math.imul(i + 1, 0x632be5ab)) | 0
}

export class Random {
  private a: number
  private b: number
  private c: number
  private d: number

  constructor(seed: number) {
    if (!Number.isFinite(seed)) throw new RangeError('seed must be a finite number')
    let s = Math.trunc(seed) | 0
    const next = () => {
      s = (s + 0x9e3779b9) | 0
      return mix32(s)
    }
    this.a = next()
    this.b = next()
    this.c = next()
    this.d = next()
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1
  }

  /** xoshiro128**: the next 32-bit output. */
  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5), 7), 9) >>> 0
    const t = this.b << 9
    this.c ^= this.a
    this.d ^= this.b
    this.b ^= this.c
    this.a ^= this.d
    this.c ^= t
    this.d = rotl(this.d, 11)
    return result
  }

  /** A uniform in the open interval (0, 1) with 53 random bits. */
  uniform(): number {
    for (;;) {
      const hi = this.nextUint32() >>> 5 // 27 bits
      const lo = this.nextUint32() >>> 6 // 26 bits
      const u = (hi * 67108864 + lo) / 9007199254740992
      if (u > 0) return u
    }
  }

  /** Standard normal deviate by inversion. */
  normal(): number {
    return normalQuantile(this.uniform())
  }

  /** Student t deviate with df degrees of freedom, by inversion. */
  t(df: number): number {
    return tQuantile(this.uniform(), df)
  }

  /** Poisson deviate with the given mean, by inversion of the CDF (search from the mode). */
  poisson(mean: number): number {
    if (!(mean >= 0) || !Number.isFinite(mean)) return Number.NaN
    if (mean === 0) return 0
    const u = this.uniform()
    // CDF and pmf at the mode m = floor(mean).
    const m = Math.floor(mean)
    const pm = Math.exp(-mean + m * Math.log(mean) - lgamma(m + 1))
    let cdf = poissonCdf(m, mean)
    if (u <= cdf) {
      // Search down: P(X ≤ k − 1) = P(X ≤ k) − p(k).
      let k = m
      let p = pm
      while (k > 0) {
        const below = cdf - p
        if (u > below) return k
        cdf = below
        p *= k / mean
        k--
      }
      return 0
    }
    let k = m
    let p = pm
    for (;;) {
      k++
      p *= mean / k
      cdf += p
      if (u <= cdf || p === 0) return k
    }
  }

  /** Binomial deviate: successes in n trials with probability p each, by CDF inversion. */
  binomial(n: number, p: number): number {
    if (!Number.isInteger(n) || n < 0 || !(p >= 0 && p <= 1)) return Number.NaN
    if (p === 0 || n === 0) return 0
    if (p === 1) return n
    const u = this.uniform()
    const m = Math.min(n, Math.floor((n + 1) * p))
    let cdf = binomCdf(m, n, p)
    let pk = binomPmf(m, n, p)
    if (u <= cdf) {
      let k = m
      while (k > 0) {
        const below = cdf - pk
        if (u > below) return k
        cdf = below
        // p(k − 1) = p(k)·k(1 − p)/((n − k + 1)p)
        pk *= (k * (1 - p)) / ((n - k + 1) * p)
        k--
      }
      return 0
    }
    let k = m
    while (k < n) {
      pk *= ((n - k) * p) / ((k + 1) * (1 - p))
      k++
      cdf += pk
      if (u <= cdf) return k
    }
    return n
  }

  /** An index 0…weights.length − 1 with probability proportional to its weight. */
  categorical(weights: readonly number[]): number {
    let total = 0
    for (const w of weights) total += w
    const u = this.uniform() * total
    let s = 0
    for (let i = 0; i < weights.length; i++) {
      s += weights[i]!
      if (u < s) return i
    }
    return weights.length - 1
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k))
}

/** P(X ≤ k) for X ~ Poisson(mean), by summing the pmf up from 0 (k ≤ mean here). */
function poissonCdf(k: number, mean: number): number {
  // Q(k + 1, mean) through the pmf recursion from the mode downward (terms decrease away from
  // the mode, so summing from the smallest keeps the relative error at a few ulps).
  let p = Math.exp(-mean + k * Math.log(mean) - lgamma(k + 1))
  const terms: number[] = [p]
  for (let j = k; j > 0; j--) {
    p *= j / mean
    terms.push(p)
    if (p < 1e-17 * terms[0]! && j < k - 10) break
  }
  let s = 0
  for (let i = terms.length - 1; i >= 0; i--) s += terms[i]!
  return s
}
