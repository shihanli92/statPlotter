import type { LayerOf } from '@ps/model'
import {
  type Density2d,
  densityAt,
  densityBandwidths,
  type HexBins,
  hdrLevels,
  hexbin,
  kde2d,
  pretty,
  valueRange,
} from '@ps/stats'
import { WeakCache } from '../../lru.ts'
import type { Transform } from '../../transform.ts'

// The density stats of a graph of variables' points (roadmap 34g): hexagonal bins (`hexbin`),
// 2D kernel densities on a grid and their contour levels (`density2d`), and each point's local
// density (points coloured by density). All computed in the axes' transformed coordinates (a
// logicle or arcsinh axis bins and smooths what it shows), with the numbers from `@ps/stats`
// (oracle suites `hexbin`, `density2d`); this module only reshapes and caches them. Results are
// kept per table object (an edit is a new table) and what they depend on, so a drag or a format
// change doesn't recompute a million points' density.

/** Points in transformed coordinates (rows that can't be shown left out), with their rows. */
export interface PlotPoints {
  tx: Float64Array
  ty: Float64Array
  rows: Int32Array
  /** The transformed range of every point drawn (densities' grids span it, as ggplot2's). */
  lims: [number, number, number, number]
}

/** Raw (x, y) of rows → transformed points (finite, and positive on a log axis). */
export function plotPoints(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  rows: ArrayLike<number>,
  tx: Transform,
  ty: Transform,
): PlotPoints {
  const n = Math.min(xs.length, ys.length, rows.length)
  const ox = new Float64Array(n)
  const oy = new Float64Array(n)
  const or = new Int32Array(n)
  let k = 0
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity]
  for (let i = 0; i < n; i++) {
    const a = tx.forward(xs[i]!)
    const b = ty.forward(ys[i]!)
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    ox[k] = a
    oy[k] = b
    or[k] = rows[i]!
    if (a < x0) x0 = a
    if (a > x1) x1 = a
    if (b < y0) y0 = b
    if (b > y1) y1 = b
    k++
  }
  return {
    tx: ox.subarray(0, k),
    ty: oy.subarray(0, k),
    rows: or.subarray(0, k),
    lims: [x0, x1, y0, y1],
  }
}

/**
 * Cached results per the objects they depend on by identity — the table (an edit is a new
 * table), the rows a graph shows (`graphRows`' arrays), the plot points a density is computed of
 * — then a short key of their parameters, the 12 used last kept per objects (audit 2, G8: a set
 * of split graphs keeps each graph's own entries, where 12 per table thrashed past 12 levels and
 * keys held the graph's rows as text).
 */
const cache = new WeakCache(12)

export function cached<T>(
  owners: readonly (object | null | undefined)[],
  key: string,
  make: () => T,
): T {
  if (!owners.length || owners.some((o) => !o)) return make()
  return cache.get(owners as readonly object[], key, make)
}

/** Hexagons across the X range unless set (hexbin's default). */
export const HEX_BINS = 30
/** The density grid's points per side unless set (ggplot2's `n`). */
export const DENSITY_GRID = 100
/** Shares of the points the contours enclose unless set (50, 75, 90 and 95%). */
export const DENSITY_SHARES = [0.5, 0.75, 0.9, 0.95]
/** About this many contour levels unless set (ggplot2's `pretty(range, 10)`). */
export const DENSITY_BINS = 10

/** The hexagons of points (`hexbin`; `shape`: the plot's height over its width in their span). */
export function hexCellsOf(p: PlotPoints, bins: number, shape: number): HexBins | null {
  if (p.tx.length < 1) return null
  const [x0, x1, y0, y1] = p.lims
  // One value along an axis: a unit range round it (hexbin refuses an empty range).
  const xb: [number, number] = x1 > x0 ? [x0, x1] : [x0 - 0.5, x0 + 0.5]
  const yb: [number, number] = y1 > y0 ? [y0, y1] : [y0 - 0.5, y0 + 0.5]
  return hexbin(p.tx, p.ty, { xbins: bins, shape, xbnds: xb, ybnds: yb })
}

/** A density stat's grid of these points over `lims` (null for fewer than two points). */
export function densityGrid(
  tx: ArrayLike<number>,
  ty: ArrayLike<number>,
  lims: readonly [number, number, number, number],
  stat: { adjust?: number; n?: number },
): Density2d | null {
  if (tx.length < 2) return null
  const h = densityBandwidths(tx, ty, stat.adjust ?? 1)
  if (!(h[0]! > 0) || !(h[1]! > 0)) return null
  const [x0, x1, y0, y1] = lims
  const span = (a: number, b: number) => (b > a ? [a, b] : [a - 0.5, a + 0.5])
  const [a, b] = span(x0, x1)
  const [c, d] = span(y0, y1)
  return kde2d(tx, ty, { h, n: stat.n ?? DENSITY_GRID, lims: [a!, b!, c!, d!] })
}

/** Each point's density on the grid (bilinear interpolation). */
export function pointDensities(
  grid: Density2d,
  tx: ArrayLike<number>,
  ty: ArrayLike<number>,
): Float64Array {
  const out = new Float64Array(tx.length)
  for (let i = 0; i < tx.length; i++) out[i] = densityAt(grid, tx[i]!, ty[i]!)
  return out
}

/**
 * A contour layer's levels for each group's grid: ggplot2's (`pretty` of every group's densities'
 * range, about `bins` levels; the same levels for every group), or each group's levels enclosing
 * the shares of its points (Hyndman 1996: the density at its points' quantiles), highest share
 * (lowest level) first.
 */
export function contourLevels(
  stat: Extract<LayerOf<'contour'>['stat'], { kind: 'density2d' }>,
  grids: readonly (Density2d | null)[],
  atPoints: readonly (Float64Array | null)[],
): number[][] {
  if (stat.levels === 'shares') {
    const shares = [...(stat.shares ?? DENSITY_SHARES)].sort((a, b) => b - a)
    return atPoints.map((at) => (at ? hdrLevels(at, shares).filter(Number.isFinite) : []))
  }
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const g of grids) {
    if (!g) continue
    const [a, b] = valueRange(g.z, true)
    lo = Math.min(lo, a)
    hi = Math.max(hi, b)
  }
  const breaks = hi >= lo ? pretty(lo, hi, stat.bins ?? DENSITY_BINS) : []
  return grids.map(() => breaks)
}
