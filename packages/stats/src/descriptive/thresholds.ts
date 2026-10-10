// Roadmap 46b: points classed by cut-offs, a volcano plot's significance. A comparison of each
// point's two values with two numbers, not an estimate: there is nothing for R to agree with
// beyond `>=`, so its tests are exact unit tests (decision 942) rather than oracle fixtures.

/** A point's class: up, down or not significant. */
export type ThresholdClass = 'up' | 'down' | 'ns'

/** The cut-offs: |fold change| ≥ `fold` (its sign ignored) and significance ≥ `sig`. */
export interface ThresholdCuts {
  fold: number
  sig: number
}

/**
 * A point's class by its fold change and significance (−log10 P, larger is more significant):
 * up when fold ≥ c and sig ≥ s, down when fold ≤ −c and sig ≥ s, else not significant — a point
 * exactly at a cut-off counts as significant (≥). With c = 0 a fold change of 0 is up. A
 * significance of +∞ (−log10 of P = 0) is the most significant there is (audit 3, S5). Null when
 * a value is missing (the fold change not finite, the significance NaN or −∞) or a cut-off isn't
 * a number.
 */
export function thresholdClass(
  fold: number,
  sig: number,
  cuts: ThresholdCuts,
): ThresholdClass | null {
  if (!Number.isFinite(fold) || Number.isNaN(sig) || sig === Number.NEGATIVE_INFINITY) return null
  if (Number.isNaN(cuts.fold) || Number.isNaN(cuts.sig)) return null
  const c = Math.abs(cuts.fold)
  if (sig >= cuts.sig) {
    if (fold >= c) return 'up'
    if (fold <= -c) return 'down'
  }
  return 'ns'
}

/** How many points of each class, and how many were left out (a value missing). */
export interface ThresholdCounts {
  up: number
  down: number
  ns: number
  missing: number
}

/** Counts the classes of points given as fold changes and significances (same length). */
export function thresholdCounts(
  folds: ArrayLike<number>,
  sigs: ArrayLike<number>,
  cuts: ThresholdCuts,
): ThresholdCounts {
  const out: ThresholdCounts = { up: 0, down: 0, ns: 0, missing: 0 }
  const n = Math.min(folds.length, sigs.length)
  for (let i = 0; i < n; i++) {
    const k = thresholdClass(folds[i]!, sigs[i]!, cuts)
    if (k) out[k]++
    else out.missing++
  }
  out.missing += Math.max(folds.length, sigs.length) - n
  return out
}

/**
 * A P value as a volcano plot's significance: −log10 P for P in [0, 1], else NaN. P = 0 — a P
 * value that underflowed — counts as the smallest double, 2^−1074 (−log10 ≈ 323.3), so the most
 * significant points stay finite: classed, counted and drawn (audit 3, S5).
 */
export function negLog10P(p: number): number {
  return p >= 0 && p <= 1 ? -Math.log10(Math.max(p, Number.MIN_VALUE)) : Number.NaN
}

/** A volcano plot's significance back as a P value: 10^−s. */
export function pOfNegLog10(s: number): number {
  return Number.isFinite(s) ? 10 ** -s : Number.NaN
}
