import { bandwidthNrd0, kernelDensity } from '@ps/stats'
import type { PlotStats } from './data.ts'

// Violin plots: a Gaussian kernel density estimate of a group's values, drawn mirrored. The
// bandwidth is R's `bw.nrd0` times a smoothing factor; the density is evaluated exactly (both in
// `@ps/stats`, oracle suite `graphstats`). The `density` stat of the layer engine.

export { bandwidthNrd0, kernelDensity }

export interface ViolinStats {
  /** Values where the density is evaluated, ascending (the violin's outline). */
  ys: number[]
  /** Density at each of `ys`. */
  density: number[]
  /** Largest density (the violin's widest point). */
  maxDensity: number
  bandwidth: number
  q1: number
  median: number
  q3: number
  mean: number
  /** The density at any value (for the width of the lines across the violin). */
  densityAt: (v: number) => number
}

/** Points along the violin's outline. */
const STEPS = 128
/** 'extended' tails reach this many bandwidths past the data (R's `density(cut = 3)`). */
const CUT = 3

/**
 * The violin of a group's values: its density from the smallest to the largest value
 * ('truncated', the usual default) or with the tails out to 3 bandwidths ('extended'). Null
 * without raw values.
 */
export function violinOf(
  s: PlotStats,
  opts: { extent: 'truncated' | 'extended'; smoothing: number },
): ViolinStats | null {
  if (!s.raw || s.n === 0) return null
  // Kept per statistics object (themselves kept per data set): a graph laid out again, or its
  // extent and its drawing, evaluate each density once (decision 454).
  const key = `${opts.extent}|${opts.smoothing}`
  let byOpts = violins.get(s)
  const hit = byOpts?.get(key)
  if (hit) return hit
  const out = computeViolin(s, opts)
  if (!byOpts) {
    byOpts = new Map()
    violins.set(s, byOpts)
  }
  byOpts.set(key, out)
  return out
}

const violins = new WeakMap<PlotStats, Map<string, ViolinStats>>()

function computeViolin(
  s: PlotStats,
  opts: { extent: 'truncated' | 'extended'; smoothing: number },
): ViolinStats {
  const values = s.points.map((p) => p.value)
  const bw = bandwidthNrd0(values) * (opts.smoothing > 0 ? opts.smoothing : 1)
  const lo = opts.extent === 'extended' ? s.min - CUT * bw : s.min
  const hi = opts.extent === 'extended' ? s.max + CUT * bw : s.max
  const ys: number[] = []
  const density: number[] = []
  const steps = lo === hi ? 0 : STEPS
  for (let i = 0; i <= steps; i++) {
    const y = steps ? lo + ((hi - lo) * i) / steps : lo
    ys.push(y)
    density.push(kernelDensity(values, bw, y))
  }
  return {
    ys,
    density,
    maxDensity: Math.max(...density),
    bandwidth: bw,
    q1: s.q1,
    median: s.median,
    q3: s.q3,
    mean: s.mean,
    densityAt: (v) => kernelDensity(values, bw, v),
  }
}
