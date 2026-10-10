// Points on screen (decisions 450–452): the canvas, layout pages and the Format and builder
// previews draw at most `SCREEN_POINTS` of a data set's per-row points in its column or group —
// an evenly spread sample, the same every time — so a graph of 48 variables of 16,000 cells each
// draws 48,000 points, not 770,000. Statistics (boxes, violins, means, error bars, fits) are
// computed from every row, and exports (files, copies, prints) lay the graph out without the cap:
// every point. XY graphs keep every point on screen (a UMAP needs every cell; many points draw as
// one image, decision 403) except in the builder's preview, which samples the rows anyway.

/** Most per-row points a data set draws in its column or group on screen. */
export const SCREEN_POINTS = 1000

/** A layout for the screen: how many per-row points each data set draws. */
export interface ScreenSample {
  /** Most per-row points a data set draws (in its column, group or cell). */
  points: number
  /** XY graphs' per-row points sampled too (builder previews); otherwise drawn every one. */
  xy?: boolean
}

/** The canvas's, pages' and the Format dialog's sample. */
export const SCREEN_SAMPLE: ScreenSample = { points: SCREEN_POINTS }

/** What the points are counted per in the note (a heat map's rows are counted themselves). */
export type SampleUnit = 'column' | 'group' | 'data set' | 'row'

/** The points a screen layout left out: the largest data set's, for the graph view's note. */
export interface SampledPoints {
  /** Points drawn per data set (the cap). */
  shown: number
  /** Of how many (the largest data set sampled). */
  of: number
  per: SampleUnit
}

/**
 * The indices of `max` of `n` items spread evenly over them in order, the first among them (all
 * when `n` ≤ `max`): item ⌊i·n / max⌋ for i < max. Deterministic, and the same rows for every
 * data set of the same rows.
 */
export function evenIndices(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i)
  const m = Math.max(0, Math.floor(max))
  return Array.from({ length: m }, (_, i) => Math.floor((i * n) / m))
}

/** `max` of `items` spread evenly over them, in their order (all of them when no more). */
export function evenSample<T>(items: readonly T[], max: number): readonly T[] {
  if (items.length <= max) return items
  return evenIndices(items.length, max).map((i) => items[i]!)
}

/** The graph view's note: "Showing 1,000 of 16,171 points per column on screen; …". */
export function sampledNote(s: SampledPoints): string {
  const n = (v: number) => v.toLocaleString('en-US')
  const what = s.per === 'row' ? 'rows' : `points per ${s.per}`
  return `Showing ${n(s.shown)} of ${n(s.of)} ${what} on screen; exports and statistics use all`
}

/** Two notes' larger (pages: a note for every graph on them). */
export function largerSample(
  a: SampledPoints | undefined,
  b: SampledPoints | undefined,
): SampledPoints | undefined {
  if (!a) return b
  if (!b) return a
  return b.of > a.of ? b : a
}
