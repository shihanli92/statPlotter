/**
 * Interpolating unknowns from a fitted standard curve ("Interpolate unknowns from standard
 * curve", for nonlinear and linear regression). Works on any curve y = f(x) with a
 * confidence band lo(x) ≤ f(x) ≤ hi(x).
 *
 * X from Y: search the curve from the smallest to
 * the largest X of the standards and stop at the first X where it reaches Y (so with two
 * crossings the lower X is reported); if there is none, search below the smallest X, then above
 * the largest, each within the curve's extended range — extrapolated by half the X range of
 * the standards in each direction. No crossing (Y beyond a plateau, or too far out) gives NaN
 * (a blank cell).
 * Crossings are found on a grid of 1000 steps per search interval, then refined to machine
 * precision (Illinois false position), so two crossings closer than a grid step can be missed;
 * a sign change across a pole is not taken for a crossing.
 *
 * Confidence interval of an interpolated X: where the curve's confidence band crosses the
 * horizontal line at Y ("interpolating the confidence bands of the regression curve"): moving
 * away from X̂ on each side, the first X where Y leaves [lo(x), hi(x)]. If the band doesn't cross
 * the line within the extended range, that limit is NaN (blank).
 *
 * Y from X: f(X) with the confidence band at X as its interval, for X within the extended range
 * (NaN outside it).
 */

import { valuesOf } from '../arrays.ts'
import { illinois } from '../numint/roots.ts'
import { type LinearFit, linearBand } from './linear.ts'
import { type CurveModel, curveBand, type NonlinearFit } from './nonlinear.ts'

export interface CurveWithBand {
  f(x: number): number
  /** The confidence band at x: [lower, upper]. */
  band(x: number): [number, number]
}

export interface InterpolatedX {
  x: number
  lo: number
  hi: number
  /** The X lies outside the standards' X range (extrapolated). */
  extrapolated: boolean
}

export interface InterpolatedY {
  y: number
  lo: number
  hi: number
  extrapolated: boolean
}

const GRID = 1000

/** The curve's extended X range: the standards' range plus `extend` × its length each side. */
function extendedRange(xmin: number, xmax: number, extend = 0.5): [number, number] {
  const w = xmax - xmin
  return [xmin - extend * w, xmax + extend * w]
}

/** Root of g on [a, b] with g(a), g(b) of opposite signs (Illinois false position). */
function refine(g: (x: number) => number, a: number, b: number, ga: number, gb: number): number {
  return illinois(g, a, ga, b, gb, {
    maxIter: 200,
    accept: (gc) => !Number.isFinite(gc),
    done: (a, b) =>
      Math.abs(b - a) <= 2 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), 1e-300),
    closer: true,
  })
}

/**
 * First X from `from` towards `to` where g changes sign (or is 0), on a grid of GRID steps;
 * NaN if none. g(from) itself counts only when it is exactly 0.
 */
function firstRoot(g: (x: number) => number, from: number, to: number): number {
  if (!(Number.isFinite(from) && Number.isFinite(to)) || from === to) return Number.NaN
  let xa = from
  let ga = g(xa)
  if (ga === 0) return xa
  for (let i = 1; i <= GRID; i++) {
    const xb = i === GRID ? to : from + ((to - from) * i) / GRID
    const gb = g(xb)
    if (gb === 0) return xb
    if (Number.isFinite(ga) && Number.isFinite(gb) && Math.sign(ga) !== Math.sign(gb)) {
      const r = refine(g, xa, xb, ga, gb)
      // A sign change across a pole (e.g. X = −Km of a hyperbola) is not a crossing.
      if (Math.abs(g(r)) <= 1e-6 * Math.max(Math.abs(ga), Math.abs(gb))) return r
    }
    xa = xb
    ga = gb
  }
  return Number.NaN
}

/** X at which the curve reaches `y`, with its confidence interval; see the module comment. */
export function interpolateX(
  curve: CurveWithBand,
  y: number,
  xmin: number,
  xmax: number,
  extend = 0.5,
): InterpolatedX {
  const none = { x: Number.NaN, lo: Number.NaN, hi: Number.NaN, extrapolated: false }
  if (!Number.isFinite(y)) return none
  const [lo, hi] = extendedRange(xmin, xmax, extend)
  const g = (x: number) => curve.f(x) - y
  let x = firstRoot(g, xmin, xmax)
  let extrapolated = false
  if (Number.isNaN(x)) {
    x = firstRoot(g, xmin, lo)
    if (Number.isNaN(x)) x = firstRoot(g, xmax, hi)
    extrapolated = !Number.isNaN(x)
  }
  if (Number.isNaN(x)) return none
  // Distance of Y outside the band (negative inside): its first sign change on each side.
  const outside = (t: number) => {
    const [l, h] = curve.band(t)
    return Math.max(l - y, y - h)
  }
  const cLo = firstRoot(outside, x, lo)
  const cHi = firstRoot(outside, x, hi)
  return { x, lo: cLo, hi: cHi, extrapolated }
}

/** Y of the curve at `x` with the confidence band there; NaN beyond the extended range. */
export function interpolateY(
  curve: CurveWithBand,
  x: number,
  xmin: number,
  xmax: number,
  extend = 0.5,
): InterpolatedY {
  const [lo, hi] = extendedRange(xmin, xmax, extend)
  if (!(x >= lo && x <= hi))
    return { y: Number.NaN, lo: Number.NaN, hi: Number.NaN, extrapolated: false }
  const [l, h] = curve.band(x)
  return { y: curve.f(x), lo: l, hi: h, extrapolated: x < xmin || x > xmax }
}

/** A fitted nonlinear curve (data set k of the fit) with its confidence band. */
export function fittedCurve(
  model: CurveModel,
  fit: NonlinearFit,
  k: number,
  confLevel = fit.confLevel,
): CurveWithBand {
  const p = valuesOf(fit.params[k]!)
  const xs = new Float64Array(1)
  return {
    f: (x) => model.f(x, p),
    band(x) {
      xs[0] = x
      const b = curveBand(model, fit, k, xs, { confLevel })
      return [b.lo[0]!, b.hi[0]!]
    },
  }
}

/** A fitted straight line with its confidence band. */
export function fittedLine(fit: LinearFit, confLevel = fit.confLevel): CurveWithBand {
  const xs = new Float64Array(1)
  return {
    f: (x) => fit.intercept + fit.slope * x,
    band(x) {
      xs[0] = x
      const b = linearBand(fit, xs, { confLevel })
      return [b.lo[0]!, b.hi[0]!]
    },
  }
}
