import { integrate } from './quadrature.ts'

/**
 * E[g(S)] where S = χ_ν / √ν is the ratio of a sample SD to σ with ν degrees of freedom, for a
 * probability-valued g (0 ≤ g ≤ 1). This is the outer integral that turns a known-variance
 * (normal) probability into a studentized one: P(max |T| ≤ t) = E[P(max |Z| ≤ tS)] for the
 * studentized range (Hartley 1944; Copenhaver & Holland 1988, J. Stat. Comput. Simul. 30, 1–15)
 * and for Dunnett's statistics (Dunnett 1955, JASA 50, 1096–1121, eq. 2.2).
 *
 * The integral is taken over u = ln s, where the density of S is
 *   f(u) ∝ exp(ν(u − (e^{2u} − 1)/2)),
 * log-concave with its mode at u = 0 and SD ≈ 1/√(2ν). The normalising constant is not
 * evaluated in closed form (for large ν it is a difference of huge log-gamma values); instead
 * the same quadrature integrates f alone and the ratio is returned, so the constant and most
 * of the discretisation error cancel.
 *
 * Panels: width 1.5 SD across the mode, then — in the left tail, where ln f falls off only
 * linearly (≈ ν(u + ½)) — width max(1.5 SD, 8/ν). Where g makes the product peak far from the
 * mode (upper tails at large t and small ν), the adaptive quadrature refines there; if the
 * truncated tails could matter relative to the result, the range is extended and the extra
 * pieces added. `increasing` says whether g is non-decreasing in s (a lower-tail probability)
 * or non-increasing (an upper tail), which tightens those truncation bounds.
 */
export function chiMixture(
  g: (s: number) => number,
  df: number,
  increasing: boolean,
  relTol = 1e-13,
): number {
  const nu = df
  const sd = 1 / Math.sqrt(2 * nu)
  const logf = (u: number): number => nu * (u - 0.5 * Math.expm1(2 * u))
  const f = (u: number): number => Math.exp(logf(u))
  const h = 1.5 * sd
  const tailStep = Math.max(h, 8 / nu)
  const CUT = -50

  const breaks: number[] = []
  let u = -3 * h
  // Left: step out until ln f < CUT.
  const left: number[] = []
  while (logf(u) > CUT) {
    left.push(u)
    u -= u > -6 * h ? h : tailStep
  }
  left.push(u)
  for (let i = left.length - 1; i >= 0; i--) breaks.push(left[i]!)
  for (u = -2 * h; logf(u) > CUT; u += h) breaks.push(u)
  breaks.push(u)

  const product = (x: number): number => {
    const s = Math.exp(x)
    const fx = f(x)
    return fx === 0 ? 0 : fx * g(s)
  }
  const norm = integrate(f, breaks, { relTol: 1e-13 })
  let num = integrate(product, breaks, { relTol })

  // Tail mass beyond the range (bounded because g ≤ 1): ∫_{−∞}^{uL} f ≤ f(uL)/ν·(1 + …) in the
  // exponential left tail; the right tail decays like exp(−ν e^{2u}/2) and is far smaller.
  let uL = breaks[0]!
  const target = (v: number) => Math.max(v, Number.MIN_VALUE) * relTol * 1e-3
  let guard = 0
  const gAt = (x: number) => g(Math.exp(x))
  while ((f(uL) / nu) * (increasing ? gAt(uL) : 1) > target(num) && guard++ < 200) {
    const next = uL - tailStep
    num += integrate(product, [next, uL], { relTol })
    uL = next
    if (f(uL) === 0) break
  }
  let uR = breaks[breaks.length - 1]!
  guard = 0
  while (f(uR) * h * (increasing ? 1 : gAt(uR)) > target(num) && guard++ < 200) {
    const next = uR + h
    num += integrate(product, [uR, next], { relTol })
    uR = next
  }
  return num / norm
}
