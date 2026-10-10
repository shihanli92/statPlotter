import { seqLength, valueRange } from '../arrays.ts'
import { quantileSorted7 } from '../descriptive/quantile.ts'
import { normalPdf } from '../dist/normal.ts'
import { bandwidthNrd0, bandwidthSd } from './density.ts'

// Two-dimensional kernel density estimates on a grid (roadmap 34g: density contours, density
// images and points coloured by density), as ggplot2's `stat_density_2d` computes them with
// `MASS::kde2d`:
//
//   z[i, j] = Σ_k φ((gx_i − x_k) / h₁) φ((gy_j − y_k) / h₂) / (n h₁ h₂),   h = h_MASS / 4,
//
// over an n₁ × n₂ grid spanning `lims` (R's `seq.int(…, length.out)`), with the bandwidths of
// `MASS::bandwidth.nrd` (4 · 1.06 · min(SD, IQR / 1.34) · n^−1/5, quantiles of type 7) times
// ggplot2's `adjust` (ggplot2's `precompute_2d_bw`: R's `bw.nrd0` · 4 where that is 0). The sum is
// exact (a direct sum, the reference `kde2d` computes) while n · n₁ · n₂ is at most
// `KDE2D_EXACT_WORK`; above it (tens of thousands of points) the points are first linearly binned
// onto a grid four times finer than the output's (Wand & Jones 1995, Kernel Smoothing, App. D;
// `KernSmooth::linbin2D`'s rule: each point's weight shared among the four nodes around it) and
// the same Gaussian sum is taken over the nodes, weighted by their counts: O(n) plus the grid's
// cost, its error O(δ²) for a node spacing δ. Both are checked against R (oracle suite
// `density2d`).

/** Most n · n₁ · n₂ summed exactly (about a tenth of a second); beyond it the points are binned. */
const KDE2D_EXACT_WORK = 100_000_000
/** The binned estimate's node spacing: this many nodes between neighbouring grid points. */
const KDE2D_BIN_FACTOR = 4

/** `MASS::bandwidth.nrd`: 4 · 1.06 · min(SD, IQR / 1.34) · n^−1/5 (Scott's rule, for `kde2d`). */
function bandwidthNrd(x: ArrayLike<number>): number {
  const n = x.length
  if (n < 2) return Number.NaN
  const sorted = Float64Array.from(x).sort()
  const h = (quantileSorted7(sorted, 0.75) - quantileSorted7(sorted, 0.25)) / 1.34
  return 4 * 1.06 * Math.min(bandwidthSd(x), h) * n ** -0.2
}

/**
 * ggplot2's bandwidths of a 2D density (`precompute_2d_bw`): `bandwidth.nrd` of each variable,
 * `bw.nrd0` · 4 where that is 0, times `adjust`. NaN for fewer than two points.
 */
export function densityBandwidths(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  adjust: number | readonly [number, number] = 1,
): [number, number] {
  const [ax, ay] = typeof adjust === 'number' ? [adjust, adjust] : adjust
  const one = (v: ArrayLike<number>) => {
    let h = bandwidthNrd(v)
    if (h === 0 && v.length > 1) h = bandwidthNrd0(Array.from(v)) * 4
    return h
  }
  return [one(x) * ax, one(y) * ay]
}

/** A density on a grid: `z[i + j · nx]` at (x[i], y[j]) (column-major, as R's matrix). */
export interface Density2d {
  x: Float64Array
  y: Float64Array
  z: Float64Array
  /** The bandwidths used (MASS's h, four times the kernels' standard deviations). */
  h: [number, number]
  /** Points summed. */
  n: number
  /** Whether the points were binned first (see the module comment). */
  binned: boolean
}

export interface Kde2dOptions {
  /** MASS's bandwidths (absent: `densityBandwidths(x, y)`). */
  h?: readonly [number, number]
  /** Grid points along X and Y (default 100, ggplot2's; MASS's own default is 25). */
  n?: number | readonly [number, number]
  /** The grid's ends [x0, x1, y0, y1] (absent: the data's ranges). */
  lims?: readonly [number, number, number, number]
  /** 'exact' or 'binned' always; absent: exact up to `KDE2D_EXACT_WORK`. */
  method?: 'exact' | 'binned'
}

/** φ((g_i − x) / h) for each grid point g_i. */
function kernelRow(grid: Float64Array, x: number, h: number, out: Float64Array, at = 0) {
  for (let i = 0; i < grid.length; i++) out[at + i] = normalPdf((grid[i]! - x) / h)
}

/**
 * `MASS::kde2d` of the first `min(x.length, y.length)` points (x, y) (see the module comment).
 * No points, a bandwidth that isn't positive (NaN included), or grid ends that aren't finite give
 * a grid of NaN.
 *
 * The points should be finite (the graph's density stats pass only finite ones, with their own
 * bandwidths and limits). Nothing here filters them: without `h` a NaN or infinite point makes
 * the bandwidths NaN, and without `lims` an infinite one makes the ends infinite (a grid of NaN
 * either way); with both given, an infinite point adds nothing to the sums but still counts in
 * n, and a NaN one makes the exact sum NaN (the binned sum leaves it out).
 */
export function kde2d(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: Kde2dOptions = {},
): Density2d {
  const n = Math.min(x.length, y.length)
  const [n1, n2] = typeof opts.n === 'number' ? [opts.n, opts.n] : (opts.n ?? [100, 100])
  const [xr, yr] = [valueRange(x), valueRange(y)]
  const lims = opts.lims ?? [xr[0], xr[1], yr[0], yr[1]]
  const gx = seqLength(lims[0], lims[1], n1)
  const gy = seqLength(lims[2], lims[3], n2)
  const h = (opts.h ?? densityBandwidths(x, y)) as [number, number]
  const z = new Float64Array(n1 * n2)
  const binned = opts.method === 'binned' || (!opts.method && n * n1 * n2 > KDE2D_EXACT_WORK)
  const out: Density2d = { x: gx, y: gy, z, h: [h[0], h[1]], n, binned }
  if (!(n > 0) || !(h[0] > 0) || !(h[1] > 0) || !lims.every(Number.isFinite)) {
    z.fill(Number.NaN)
    return out
  }
  const [h1, h2] = [h[0] / 4, h[1] / 4]
  if (binned) binnedSum(x, y, n, gx, gy, h1, h2, z)
  else exactSum(x, y, n, gx, gy, h1, h2, z)
  const k = 1 / (n * h1 * h2)
  for (let i = 0; i < z.length; i++) z[i]! *= k
  return out
}

/** z += Σ_k a_k b_kᵀ over the points (the reference sum, unnormalised). */
function exactSum(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  n: number,
  gx: Float64Array,
  gy: Float64Array,
  h1: number,
  h2: number,
  z: Float64Array,
) {
  const [n1, n2] = [gx.length, gy.length]
  const a = new Float64Array(n1)
  const b = new Float64Array(n2)
  for (let k = 0; k < n; k++) {
    kernelRow(gx, x[k]!, h1, a)
    kernelRow(gy, y[k]!, h2, b)
    // Rows of a that underflowed to zero add nothing (as in R's sum).
    let i0 = 0
    let i1 = n1 - 1
    while (i0 <= i1 && a[i0] === 0) i0++
    while (i1 >= i0 && a[i1] === 0) i1--
    for (let j = 0; j < n2; j++) {
      const bj = b[j]!
      if (bj === 0) continue
      const col = j * n1
      for (let i = i0; i <= i1; i++) z[col + i]! += a[i]! * bj
    }
  }
}

/**
 * The binned sum: nodes `KDE2D_BIN_FACTOR` times as close as the grid's, spanning it (its points
 * among them), the counts W; z = Kx W Kyᵀ with Kx[i, m] = φ((gx_i − fx_m) / h₁).
 */
function binnedSum(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  n: number,
  gx: Float64Array,
  gy: Float64Array,
  h1: number,
  h2: number,
  z: Float64Array,
) {
  const [n1, n2] = [gx.length, gy.length]
  const fx = seqLength(gx[0]!, gx[n1 - 1]!, KDE2D_BIN_FACTOR * (n1 - 1) + 1)
  const fy = seqLength(gy[0]!, gy[n2 - 1]!, KDE2D_BIN_FACTOR * (n2 - 1) + 1)
  const w = linearBin2d(x, y, n, fx, fy)
  const [m1, m2] = [fx.length, fy.length]
  const kx = new Float64Array(n1 * m1)
  for (let m = 0; m < m1; m++)
    for (let i = 0; i < n1; i++) kx[i + m * n1] = normalPdf((gx[i]! - fx[m]!) / h1)
  const ky = new Float64Array(n2 * m2)
  for (let m = 0; m < m2; m++)
    for (let j = 0; j < n2; j++) ky[j + m * n2] = normalPdf((gy[j]! - fy[m]!) / h2)
  // t = Kx W (n1 × m2), then z = t Kyᵀ (n1 × n2).
  const t = new Float64Array(n1 * m2)
  for (let q = 0; q < m2; q++)
    for (let m = 0; m < m1; m++) {
      const c = w[m + q * m1]!
      if (c === 0) continue
      const col = m * n1
      const tc = q * n1
      for (let i = 0; i < n1; i++) t[tc + i]! += kx[col + i]! * c
    }
  for (let j = 0; j < n2; j++)
    for (let q = 0; q < m2; q++) {
      const k = ky[j + q * n2]!
      if (k === 0) continue
      const tc = q * n1
      const zc = j * n1
      for (let i = 0; i < n1; i++) z[zc + i]! += t[tc + i]! * k
    }
}

/**
 * The first `n` points linearly binned onto the nodes `fx` × `fy` (equally spaced, ascending):
 * each point's weight shared among the four nodes around it by its distance to them
 * (KernSmooth's `linbin2D` rule; points on the upper edges in the last cell, so a grid spanning
 * the data keeps every point; points outside it left out). Weights by `i + j · fx.length`.
 */
function linearBin2d(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  n: number,
  fx: ArrayLike<number>,
  fy: ArrayLike<number>,
): Float64Array {
  const [m1, m2] = [fx.length, fy.length]
  const w = new Float64Array(m1 * m2)
  const [a1, b1, a2, b2] = [fx[0]!, fx[m1 - 1]!, fy[0]!, fy[m2 - 1]!]
  const d1 = (b1 - a1) / (m1 - 1)
  const d2 = (b2 - a2) / (m2 - 1)
  for (let k = 0; k < n; k++) {
    const l1 = (x[k]! - a1) / d1
    const l2 = (y[k]! - a2) / d2
    if (!(l1 >= 0 && l1 <= m1 - 1 && l2 >= 0 && l2 <= m2 - 1)) continue
    const li1 = Math.min(Math.floor(l1), m1 - 2)
    const li2 = Math.min(Math.floor(l2), m2 - 2)
    const r1 = l1 - li1
    const r2 = l2 - li2
    const at = li1 + li2 * m1
    w[at]! += (1 - r1) * (1 - r2)
    w[at + 1]! += r1 * (1 - r2)
    w[at + m1]! += (1 - r1) * r2
    w[at + m1 + 1]! += r1 * r2
  }
  return w
}

/**
 * The density at (px, py) by bilinear interpolation of the grid (NaN outside it): each point's
 * local density for colouring points by density (roadmap 34g). R: the same formula on `kde2d`'s
 * grid (oracle suite `density2d`).
 */
export function densityAt(d: Density2d, px: number, py: number): number {
  const { x, y, z } = d
  const [n1, n2] = [x.length, y.length]
  if (n1 < 2 || n2 < 2) return Number.NaN
  const fx = ((px - x[0]!) / (x[n1 - 1]! - x[0]!)) * (n1 - 1)
  const fy = ((py - y[0]!) / (y[n2 - 1]! - y[0]!)) * (n2 - 1)
  if (!(fx >= 0 && fx <= n1 - 1 && fy >= 0 && fy <= n2 - 1)) return Number.NaN
  const i = Math.min(Math.floor(fx), n1 - 2)
  const j = Math.min(Math.floor(fy), n2 - 2)
  const u = fx - i
  const v = fy - j
  const at = i + j * n1
  return (
    (1 - u) * (1 - v) * z[at]! +
    u * (1 - v) * z[at + 1]! +
    (1 - u) * v * z[at + n1]! +
    u * v * z[at + n1 + 1]!
  )
}

/**
 * Levels of a density containing about these shares of the points (`probs`, e.g. 0.5 for the
 * level enclosing half of them): the (1 − p) sample quantile (type 7) of the density at the points
 * — the highest density region estimate of R. J. Hyndman, "Computing and graphing highest density
 * regions", The American Statistician 50 (1996) 120–126, with the density at the points by
 * `densityAt`. Points outside the grid don't count; NaN without points.
 */
export function hdrLevels(atPoints: ArrayLike<number>, probs: readonly number[]): number[] {
  const finite: number[] = []
  for (let i = 0; i < atPoints.length; i++) {
    const v = atPoints[i]!
    if (Number.isFinite(v)) finite.push(v)
  }
  if (!finite.length) return probs.map(() => Number.NaN)
  const sorted = Float64Array.from(finite).sort()
  return probs.map((p) => quantileSorted7(sorted, 1 - p))
}
