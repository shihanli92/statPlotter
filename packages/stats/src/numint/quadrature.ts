/**
 * Globally adaptive Gauss–Kronrod quadrature for smooth integrands: QUADPACK's QAG strategy
 * (Piessens, de Doncker-Kapenga, Überhuber & Kahaner, QUADPACK, Springer 1983, §2.2 and routine
 * QK21). Each panel gets the 21-point Kronrod value K and the embedded 10-point Gauss value G;
 * the error estimate is QUADPACK's resasc·min(1, (200|K − G|/resasc)^1.5). The panel with the
 * largest estimate is bisected until the summed estimates fall below max(relTol·|total|, absTol).
 *
 * The Kronrod abscissae and weights are QUADPACK's (public domain, as published in the book and
 * netlib qk21.f); the tests check them against Gauss–Legendre nodes computed here and against
 * exact integration of polynomials up to degree 31. Plain Gauss–Legendre nodes are computed by
 * Newton's method on the Legendre recurrence (Press et al., Numerical Recipes, 3rd ed., §4.6.1).
 */

interface Rule {
  x: Float64Array
  w: Float64Array
}

/** P_n(z) and P'_n(z) by the three-term recurrence. */
function legendre(n: number, z: number): [number, number] {
  let p1 = 1
  let p2 = 0
  for (let j = 1; j <= n; j++) {
    const p3 = p2
    p2 = p1
    p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j
  }
  return [p1, (n * (z * p1 - p2)) / (z * z - 1)]
}

/** Plain n-point Gauss–Legendre nodes and weights on [−1, 1]. */
export function gaussLegendre(n: number): Rule {
  const x = new Float64Array(n)
  const w = new Float64Array(n)
  const m = (n + 1) >> 1
  for (let i = 0; i < m; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5))
    let pp = 0
    for (let it = 0; it < 100; it++) {
      const [p1, d] = legendre(n, z)
      pp = d
      const dz = p1 / pp
      z -= dz
      if (Math.abs(dz) < 1e-17) break
    }
    // Recompute P'_n at the converged node for the weight.
    pp = legendre(n, z)[1]
    x[i] = -z
    x[n - 1 - i] = z
    w[i] = 2 / ((1 - z * z) * pp * pp)
    w[n - 1 - i] = w[i]!
  }
  return { x, w }
}

const G10 = gaussLegendre(10)

/** QK21 abscissae (descending, last = 0) and Kronrod weights; Gauss weights for xgk[1], [3], …. */
export const XGK = [
  0.9956571630258081, 0.9739065285171717, 0.9301574913557082, 0.8650633666889845,
  0.7808177265864169, 0.6794095682990244, 0.5627571346686047, 0.4333953941292472,
  0.2943928627014602, 0.14887433898163122, 0,
]
export const WGK = [
  0.011694638867371874, 0.032558162307964725, 0.054755896574351995, 0.07503967481091996,
  0.0931254545836976, 0.10938715880229764, 0.12349197626206584, 0.13470921731147334,
  0.14277593857706009, 0.14773910490133849, 0.1494455540029169,
]
export const WG = [
  0.06667134430868814, 0.1494513491505806, 0.21908636251598204, 0.26926671930999635,
  0.29552422471475287,
]

/** ∫_a^b f by the n-point Gauss–Legendre rule. */
function apply(rule: Rule, f: (x: number) => number, a: number, b: number): number {
  const c = 0.5 * (a + b)
  const h = 0.5 * (b - a)
  let s = 0
  for (let i = 0; i < rule.x.length; i++) s += rule.w[i]! * f(c + h * rule.x[i]!)
  return s * h
}

/** ∫_a^b f with the fixed 10-point Gauss–Legendre rule (for short intervals of analytic f). */
export function gauss10(f: (x: number) => number, a: number, b: number): number {
  return apply(G10, f, a, b)
}

export interface QuadOptions {
  /** Relative tolerance on the total (default 1e-13). */
  relTol?: number
  /** Absolute tolerance (default 0). */
  absTol?: number
  /** Maximum number of panels (default 2000). */
  maxPanels?: number
}

interface Panel {
  a: number
  b: number
  value: number
  err: number
}

const fv1 = new Float64Array(10)
const fv2 = new Float64Array(10)

/** QUADPACK qk21 on [a, b]. */
function panel(f: (x: number) => number, a: number, b: number): Panel {
  const c = 0.5 * (a + b)
  const h = 0.5 * (b - a)
  const fc = f(c)
  let resg = 0
  let resk = WGK[10]! * fc
  let resabs = Math.abs(resk)
  for (let j = 0; j < 10; j++) {
    const dx = h * XGK[j]!
    const f1 = f(c - dx)
    const f2 = f(c + dx)
    fv1[j] = f1
    fv2[j] = f2
    const s = f1 + f2
    resk += WGK[j]! * s
    resabs += WGK[j]! * (Math.abs(f1) + Math.abs(f2))
    if (j % 2 === 1) resg += WG[(j - 1) / 2]! * s
  }
  const reskh = resk * 0.5
  let resasc = WGK[10]! * Math.abs(fc - reskh)
  for (let j = 0; j < 10; j++) {
    resasc += WGK[j]! * (Math.abs(fv1[j]! - reskh) + Math.abs(fv2[j]! - reskh))
  }
  const result = resk * h
  resasc *= Math.abs(h)
  let err = Math.abs((resk - resg) * h)
  if (resasc !== 0 && err !== 0) err = resasc * Math.min(1, ((200 * err) / resasc) ** 1.5)
  // QUADPACK also floors the estimate at 50·ε·resabs (round-off level).
  err = Math.max(err, 50 * Number.EPSILON * resabs * Math.abs(h))
  return { a, b, value: result, err }
}

/**
 * ∫ f over [breaks[0], breaks[last]], starting from the panels given by consecutive
 * breakpoints. The integrand should be smooth on each initial panel; peaks narrower than about
 * a twentieth of their panel may go unnoticed, so callers choose breakpoints on the scale of the
 * integrand's features.
 */
export function integrate(
  f: (x: number) => number,
  breaks: readonly number[],
  opts: QuadOptions = {},
): number {
  const relTol = opts.relTol ?? 1e-13
  const absTol = opts.absTol ?? 0
  const maxPanels = opts.maxPanels ?? 2000
  const panels: Panel[] = []
  for (let i = 0; i + 1 < breaks.length; i++) {
    if (breaks[i + 1]! > breaks[i]!) panels.push(panel(f, breaks[i]!, breaks[i + 1]!))
  }
  for (;;) {
    let total = 0
    let errSum = 0
    let worst = 0
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i]!
      total += p.value
      errSum += p.err
      if (p.err > panels[worst]!.err) worst = i
    }
    if (panels.length === 0) return 0
    if (!(errSum > Math.max(relTol * Math.abs(total), absTol)) || panels.length >= maxPanels) {
      // Sum smallest first for a little extra accuracy.
      const vals = panels.map((p) => p.value).sort((x, y) => Math.abs(x) - Math.abs(y))
      let s = 0
      for (const v of vals) s += v
      return s
    }
    const p = panels[worst]!
    const mid = 0.5 * (p.a + p.b)
    if (!(mid > p.a && mid < p.b)) {
      p.err = 0 // cannot split further
      continue
    }
    panels[worst] = panel(f, p.a, mid)
    panels.push(panel(f, mid, p.b))
  }
}

/**
 * Breakpoints covering the effective support of a non-negative integrand on [lo, hi]: scans
 * outward from `center` in steps of `step` and stops on each side once f falls below
 * `cut`·max(f seen) (and stays there for two steps) or the limit is reached. Returns the
 * uniform grid between the two stopping points, which is also the initial panel partition.
 */
export function supportBreaks(
  f: (x: number) => number,
  center: number,
  step: number,
  lo: number,
  hi: number,
  cut = 1e-18,
): number[] {
  const c = Math.min(Math.max(center, lo), hi)
  let peak = f(c)
  let left = c
  let right = c
  let below = 0
  for (let x = c - step; ; x -= step) {
    if (x <= lo) {
      left = lo
      break
    }
    const v = f(x)
    if (v > peak) peak = v
    left = x
    below = peak > 0 && v <= cut * peak ? below + 1 : 0
    if (below >= 2) break
  }
  below = 0
  for (let x = c + step; ; x += step) {
    if (x >= hi) {
      right = hi
      break
    }
    const v = f(x)
    if (v > peak) peak = v
    right = x
    below = peak > 0 && v <= cut * peak ? below + 1 : 0
    if (below >= 2) break
  }
  const n = Math.max(1, Math.round((right - left) / step))
  const out: number[] = []
  for (let i = 0; i <= n; i++) out.push(left + ((right - left) * i) / n)
  return out
}
