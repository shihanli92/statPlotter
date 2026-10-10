/**
 * Wilson score limits for x/n, with (Newcombe 1998, method 4) or without the continuity
 * correction; exactly 0 at x = 0 and 1 at x = n.
 */
export function wilsonLimits(x: number, n: number, z: number, cc: boolean): [number, number] {
  const p = x / n
  const z2 = z * z
  if (!cc) {
    const center = (x + z2 / 2) / (n + z2)
    const half = ((z * Math.sqrt(n)) / (n + z2)) * Math.sqrt(p * (1 - p) + z2 / (4 * n))
    return [x === 0 ? 0 : center - half, x === n ? 1 : center + half]
  }
  const q = 1 - p
  const den = 2 * (n + z2)
  const lower =
    x === 0 ? 0 : (2 * n * p + z2 - 1 - z * Math.sqrt(z2 - 2 - 1 / n + 4 * p * (n * q + 1))) / den
  const upper =
    x === n ? 1 : (2 * n * p + z2 + 1 + z * Math.sqrt(z2 + 2 - 1 / n + 4 * p * (n * q - 1))) / den
  return [Math.max(0, lower), Math.min(1, upper)]
}
