/**
 * Seeded pseudo-random generators for test data (also imported by other packages' tests).
 * Tests depend on the exact sequences: never change an algorithm, only add new ones.
 */

/** Park–Miller "minimal standard" generator (s ← 16807 s mod 2³¹ − 1): uniform in (0, 1). */
export function minstd(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

/** Deterministic noise, uniform in [−a, a] (minstd). */
export function noise(seed: number, a: number): () => number {
  const u = minstd(seed)
  return () => (u() - 0.5) * 2 * a
}

/** Linear congruential generator (Numerical Recipes constants): uniform in [0, 1). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** mulberry32: small seeded PRNG (public domain, T. Ettinger), uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal deviates by Box–Muller (one per two uniforms). */
export function boxMuller(u: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u())
}
