// The statistics of a single-cell dot plot (roadmap 34g): for each variable (gene) and group
// (cluster), the percent of the group's cells "expressing" it (value above a threshold) and its
// average expression, optionally scaled per variable across the groups — Seurat's `DotPlot`
// (Seurat 5, R. Satija lab; Hao et al., Nat. Biotechnol. 42 (2024) 293–304): `PercentAbove(x, 0)`
// = the share of values > 0; the average `mean(expm1(x))` for log-normalised data; scaled, the
// z-score across groups of log1p(average) (R's `scale`, SD with n − 1) clipped to [−2.5, 2.5]
// (`MinMax(col.min = −2.5, col.max = 2.5)`); unscaled, log1p(average). The app also offers the
// plain mean (for data that aren't log-normalised: arcsinh-transformed cytometry, scores), scaled
// the same way. Checked against R (oracle suite `dotplot`).

/** How a group's values are averaged. */
export type DotAverage = 'mean' | 'expm1'

export interface DotPlotOptions {
  /** A value counts as expressing when above this (Seurat's 0). */
  threshold?: number
  /** 'mean': the values' mean; 'expm1': Seurat's mean(expm1(x)), shown as log1p of it. */
  average?: DotAverage
  /** z-scores across the groups, clipped to ±`clip` (Seurat's default `scale = TRUE`). */
  scale?: boolean
  /** The clip of scaled averages (Seurat's col.min / col.max: 2.5). */
  clip?: number
}

/** One variable's dot plot statistics, by group. */
export interface DotPlotStats {
  /** Percent of the group's values above the threshold (0–100; NaN without values). */
  percent: Float64Array
  /** The average the colour shows: the mean, or log1p(mean(expm1)) ('expm1'), or scaled. */
  average: Float64Array
  /** Values counted per group. */
  n: Int32Array
}

/**
 * The dot plot statistics of one variable's `values` over `groups` (each row's group index,
 * −1 for none; rows with a value that isn't finite are left out), for `nGroups` groups.
 */
export function dotPlotStats(
  values: ArrayLike<number>,
  groups: ArrayLike<number>,
  nGroups: number,
  opts: DotPlotOptions = {},
): DotPlotStats {
  const threshold = opts.threshold ?? 0
  const expm1 = opts.average === 'expm1'
  const n = new Int32Array(nGroups)
  const above = new Int32Array(nGroups)
  const sum = new Float64Array(nGroups)
  const rows = Math.min(values.length, groups.length)
  for (let r = 0; r < rows; r++) {
    const g = groups[r]!
    const v = values[r]!
    if (g < 0 || g >= nGroups || !Number.isFinite(v)) continue
    n[g]!++
    if (v > threshold) above[g]!++
    sum[g]! += expm1 ? Math.expm1(v) : v
  }
  const percent = new Float64Array(nGroups)
  const raw = new Float64Array(nGroups)
  for (let g = 0; g < nGroups; g++) {
    const k = n[g]!
    percent[g] = k ? (above[g]! / k) * 100 : Number.NaN
    // Seurat's average is then shown on its log scale.
    raw[g] = k ? (expm1 ? Math.log1p(sum[g]! / k) : sum[g]! / k) : Number.NaN
  }
  // One group: nothing to scale against (Seurat leaves the values unscaled).
  const present = Array.from(raw).filter(Number.isFinite)
  const average = opts.scale && present.length > 1 ? scaled(raw, opts.clip ?? 2.5) : raw
  return { percent, average, n }
}

/** R's `scale()` of the finite values (mean, SD with n − 1), clipped to ±clip. */
function scaled(v: Float64Array, clip: number): Float64Array {
  let m = 0
  let k = 0
  for (const x of v)
    if (Number.isFinite(x)) {
      m += x
      k++
    }
  m /= k
  let ss = 0
  for (const x of v) if (Number.isFinite(x)) ss += (x - m) ** 2
  const sd = Math.sqrt(ss / (k - 1))
  return v.map((x) => {
    const z = (x - m) / sd
    return Number.isNaN(z) ? Number.NaN : Math.max(-clip, Math.min(clip, z))
  })
}
