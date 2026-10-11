import { normalQuantile } from '../dist/normal.ts'
import { maxOf, minOf } from '../regression/initialRules.ts'

/**
 * Area under the curve:
 *
 * - The trapezoid rule on the points (X ascending), ΔX·[(Y₁ + Y₂)/2 − baseline] per pair of
 *   adjacent points; no smoothing, no extrapolation beyond the data. Where the line between two
 *   points crosses the (horizontal) baseline, the crossing is found by linear interpolation and
 *   ends one region and starts the next. A point exactly on the baseline also ends a region.
 * - Regions above the baseline are peaks; with `direction: 'both'`, regions below it are peaks
 *   too ("peaks below the baseline"), their areas counted as positive magnitudes.
 * - A peak counts only if its height (largest |Y − baseline| in the region) is at least
 *   `minHeight` × (largest Y − smallest Y) ("ignores any peaks whose height is less than 10% of
 *   the distance from minimum to maximum Y value"), and it is defined by at least
 *   `minPoints` data points.
 * - Total area: every region considered (all heights and widths); total peak area: the peaks
 *   that count; net area (both directions): area of counted peaks above − below.
 * - SE of the total area (Gagnon & Peterson 1998, J. Pharmacokinet. Biopharm. 26: 87–102, the
 *   method): the trapezoid AUC is Σ wᵢȳᵢ with wᵢ = (x_{i+1} − x_{i−1})/2 (half
 *   intervals at the ends), so Var = Σ wᵢ² sᵢ²/nᵢ, with sᵢ²/nᵢ the squared SEM of the mean at
 *   each X. CI = AUC ± z·SE ("uses the z distribution … always 1.96"). This is exact when the
 *   curve does not cross the baseline; when it does, the same SE is reported (not documented).
 */

export interface AucOptions {
  baseline?: number
  /** Fraction of (max Y − min Y); default 0.1. */
  minHeight?: number
  /** Minimum number of data points in a peak; default 1. */
  minPoints?: number
  direction?: 'above' | 'both'
  confLevel?: number
}

export interface AucRegion {
  /** +1 above the baseline, −1 below. */
  sign: 1 | -1
  startX: number
  endX: number
  peakX: number
  peakY: number
  /** Area as a positive magnitude. */
  area: number
  /** Data points in the region (strictly off the baseline). */
  points: number
  /** Meets the height and width criteria. */
  counted: boolean
  /** Area / total peak area (NaN for regions that don't count). */
  fraction: number
}

export interface AucResult {
  totalArea: number
  totalPeakArea: number
  /** Only with direction 'both'. */
  netArea: number
  regions: AucRegion[]
  nPeaks: number
  se: number
  lo: number
  hi: number
  minY: number
  maxY: number
  error?: 'too-few-points'
}

/**
 * @param x X values (any order; sorted here, ties keep their order)
 * @param y mean Y at each X
 * @param semSq squared SEM of each mean (NaN when unknown → SE NaN)
 */
export function areaUnderCurve(
  x: readonly number[],
  y: readonly number[],
  semSq: readonly number[] | null,
  opts: AucOptions = {},
): AucResult {
  const base = opts.baseline ?? 0
  const minHeight = opts.minHeight ?? 0.1
  const minPoints = opts.minPoints ?? 1
  const both = opts.direction === 'both'
  const level = opts.confLevel ?? 0.95
  const order = x.map((_, i) => i).sort((a, b) => x[a]! - x[b]! || a - b)
  const X = order.map((i) => x[i]!)
  const Y = order.map((i) => y[i]!)
  const V = semSq ? order.map((i) => semSq[i]!) : null
  const n = X.length
  const nan = Number.NaN
  if (n < 2)
    return {
      totalArea: nan,
      totalPeakArea: nan,
      netArea: nan,
      regions: [],
      nPeaks: 0,
      se: nan,
      lo: nan,
      hi: nan,
      minY: nan,
      maxY: nan,
      error: 'too-few-points',
    }
  const minY = minOf(Y)
  const maxY = maxOf(Y)
  // Refined polyline: data vertices plus baseline crossings.
  const vx: number[] = []
  const vd: number[] = []
  const vy: number[] = []
  const isData: boolean[] = []
  for (let i = 0; i < n; i++) {
    const d = Y[i]! - base
    if (i > 0) {
      const dp = Y[i - 1]! - base
      if ((dp > 0 && d < 0) || (dp < 0 && d > 0)) {
        vx.push(X[i - 1]! + ((X[i]! - X[i - 1]!) * dp) / (dp - d))
        vd.push(0)
        vy.push(base)
        isData.push(false)
      }
    }
    vx.push(X[i]!)
    vd.push(d)
    vy.push(Y[i]!)
    isData.push(true)
  }
  interface Cur {
    sign: 1 | -1
    start: number
    end: number
    area: number
    peak: number
    points: number
  }
  const raw: Cur[] = []
  let cur: Cur | null = null
  const close = () => {
    if (cur) raw.push(cur)
    cur = null
  }
  const touch = (c: Cur, k: number) => {
    if (!isData[k] || vd[k] === 0) return
    c.points++
    if (Math.abs(vd[k]!) > Math.abs(vd[c.peak]!)) c.peak = k
  }
  for (let k = 0; k + 1 < vx.length; k++) {
    const s = vd[k]! + vd[k + 1]!
    if (s === 0) {
      close()
      continue
    }
    const sign: 1 | -1 = s > 0 ? 1 : -1
    const c0: Cur | null = cur
    if (!c0 || c0.sign !== sign || vd[k] === 0) {
      close()
      const c: Cur = { sign, start: k, end: k, area: 0, peak: k, points: 0 }
      touch(c, k)
      cur = c
    }
    const c = cur as unknown as Cur
    c.area += ((vx[k + 1]! - vx[k]!) * s) / 2
    c.end = k + 1
    touch(c, k + 1)
  }
  close()
  const threshold = minHeight * (maxY - minY)
  const regions: AucRegion[] = raw
    .filter((r) => both || r.sign === 1)
    .map((r) => ({
      sign: r.sign,
      startX: vx[r.start]!,
      endX: vx[r.end]!,
      peakX: vx[r.peak]!,
      peakY: vy[r.peak]!,
      area: Math.abs(r.area),
      points: r.points,
      counted: Math.abs(vd[r.peak]!) >= threshold && r.points >= minPoints,
      fraction: nan,
    }))
  const totalArea = regions.reduce((s, r) => s + r.area, 0)
  const counted = regions.filter((r) => r.counted)
  const totalPeakArea = counted.reduce((s, r) => s + r.area, 0)
  for (const r of counted) r.fraction = r.area / totalPeakArea
  const netArea = both ? counted.reduce((s, r) => s + r.sign * r.area, 0) : nan
  let se = nan
  if (V) {
    let v = 0
    for (let i = 0; i < n; i++) {
      const w = ((i + 1 < n ? X[i + 1]! : X[i]!) - (i > 0 ? X[i - 1]! : X[i]!)) / 2
      v += w * w * V[i]!
    }
    se = Math.sqrt(v)
  }
  const z = normalQuantile(1 - (1 - level) / 2)
  return {
    totalArea,
    totalPeakArea,
    netArea,
    regions,
    nPeaks: counted.length,
    se,
    lo: totalArea - z * se,
    hi: totalArea + z * se,
    minY,
    maxY,
  }
}
