import { describe, expect, it } from 'vitest'
import {
  confidenceEllipse,
  convexHull,
  covTrob,
  type EllipseType,
  ellipseOutline,
  fQuantile2,
} from '../src/index.ts'
import { expectClose, loadFixtures } from './oracle.ts'
import { growthRatio } from './timing.ts'

// Roadmap 34c's group overlays against R: ellipses (ggplot2 stat_ellipse, car, MASS::cov.trob;
// tools/oracle/r/ellipse.R) and convex hulls (grDevices::chull; tools/oracle/r/hull.R).

interface In {
  x: number[]
  y: number[]
}
interface Expected {
  center: number[]
  shape: number[]
  radius: number
  x: number[]
  y: number[]
  iter?: number
}

describe('confidence ellipses vs R', () => {
  for (const f of loadFixtures<In, Expected>('ellipse')) {
    it(f.name, () => {
      const p = f.params as { type: EllipseType; level: number; segments: number }
      const r = confidenceEllipse(f.input.x, f.input.y, p.type, p.level)
      if (!r.ok) throw new Error(r.reason)
      const { fit } = r
      // Points 1e6 from the origin: deviations carry about 1e-10 of the values' digits.
      const tol = { rtol: 1e-10, ...f.tol }
      for (const [i, c] of fit.center.entries())
        expectClose(c, f.expected.center[i]!, tol, `center ${i}`)
      const scale = Math.max(...f.expected.shape.map(Math.abs))
      for (const [i, s] of fit.shape.entries())
        expectClose(s, f.expected.shape[i]!, { ...tol, atol: 1e-13 * scale }, `shape ${i}`)
      expectClose(fit.radius, f.expected.radius, tol, 'radius')
      if (f.expected.iter !== undefined) expect(fit.iterations).toBe(f.expected.iter)
      const outline = ellipseOutline(fit, p.segments)
      expect(outline).toHaveLength(f.expected.x.length)
      // Outline points near the centre's coordinate: absolute to the ellipse's own size.
      const size = fit.radius * Math.sqrt(Math.max(fit.shape[0], fit.shape[2]))
      outline.forEach(([x, y], i) => {
        expectClose(x, f.expected.x[i]!, { ...tol, atol: 1e-10 * size }, `x ${i}`)
        expectClose(y, f.expected.y[i]!, { ...tol, atol: 1e-10 * size }, `y ${i}`)
      })
    })
  }
})

describe('convex hulls vs R', () => {
  /** The same cycle, starting where R's does. */
  const rotated = (got: number[], first: number) => {
    const at = got.indexOf(first)
    return at < 0 ? got : [...got.slice(at), ...got.slice(0, at)]
  }
  for (const f of loadFixtures<In, { hull: number[] | number }>('hull')) {
    it(f.name, () => {
      const want = ([] as number[]).concat(f.expected.hull).map((i) => i - 1)
      const got = convexHull(f.input.x, f.input.y)
      expect(rotated(got, want[0]!)).toEqual(want)
    })
  }
})

describe('ellipses on degenerate input', () => {
  const types: EllipseType[] = ['norm', 'mean', 't']
  it.each(types)('%s: says why instead of throwing', (type) => {
    const cases: [number[], number[], RegExp][] = [
      [[], [], /needs 3/],
      [[1], [2], /one point/],
      [[1, 2], [2, 3], /needs 3/],
      [[1, 2, 3, 4], [2, 4, 6, 8], /line/],
      [[1, 1, 1], [1, 2, 3], /same X/],
      [[5, 5, 5], [5, 5, 5], /same/],
    ]
    for (const [x, y, why] of cases) {
      const r = confidenceEllipse(x, y, type)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(why)
    }
  })
  it('a level outside (0, 1) draws nothing', () => {
    expect(confidenceEllipse([1, 2, 4], [3, 1, 2], 'norm', 1).ok).toBe(false)
  })
  it('hulls of nothing and of repeated points', () => {
    expect(convexHull([], [])).toEqual([])
    expect(convexHull([2, 2, 2], [1, 1, 1])).toEqual([0])
    expect(convexHull([0, Number.NaN, 1, 0], [0, 1, 0, 1])).toEqual([2, 0, 3])
  })
  it('F(2, d) quantiles in closed form', () => {
    // R: qf(0.95, 2, 10), qf(0.5, 2, 1)
    expectClose(fQuantile2(0.95, 10), 4.1028210151304032, { rtol: 1e-14 }, 'qf 0.95')
    expectClose(fQuantile2(0.5, 1), 1.5, { rtol: 1e-14 }, 'qf 0.5')
  })
  it('cov.trob reports convergence', () => {
    const t = covTrob([1, 2, 3, 4, 5.5], [2, 1, 4, 3, 6])
    expect(t.converged).toBe(true)
  })
})

describe('performance', () => {
  it('ellipses and hulls grow linearly (n log n) with the points', () => {
    // The points are made once, outside the timing (audit 2, S12: making them took a third of
    // each timed call), and each size reads the first n.
    const N = 80_000
    const x = Float64Array.from({ length: N }, (_, i) => (Math.sin(i * 12.9898) * 43758.5453) % 1)
    const y = Float64Array.from({ length: N }, (_, i) => (Math.cos(i * 78.233) * 12345.678) % 1)
    const ratio = growthRatio((n) => {
      const [px, py] = [x.subarray(0, n), y.subarray(0, n)]
      confidenceEllipse(px, py, 't')
      convexHull(px, py)
    }, 20_000)
    expect(ratio).toBeLessThan(9)
  })
})
