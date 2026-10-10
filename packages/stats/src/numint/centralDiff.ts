/** ∛ε, the scale of central-difference steps. */
export const CBRT_EPS = 6.055454452393343e-6

/**
 * Central difference (f(aᵢ + h) − f(aᵢ − h))/(2h) of f in a[i], with step ∛ε·max(|aᵢ|, 1e−3)
 * rounded to the representable h = (aᵢ + h) − aᵢ. f reads a, which is restored afterwards.
 */
export function centralDiff(a: { [i: number]: number }, i: number, f: () => number): number {
  const v = a[i]!
  const h = v + CBRT_EPS * Math.max(Math.abs(v), 1e-3) - v
  a[i] = v + h
  const fp = f()
  a[i] = v - h
  const fm = f()
  a[i] = v
  return (fp - fm) / (2 * h)
}
