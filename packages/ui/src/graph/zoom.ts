/** Zoom levels of the graph view (1 = actual size: 1 pt on screen is 1/72 in). */
export const GRAPH_ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const

/** Zoom levels of the layout view (a whole page). */
export const LAYOUT_ZOOMS = [0.5, 0.75, 1, 1.25, 1.5] as const

/**
 * The next zoom level in or out from `current` (which may be between levels), or `current` at
 * the end of the list.
 */
export function stepZoom(zooms: readonly number[], current: number, dir: 1 | -1): number {
  const next =
    dir > 0 ? zooms.find((z) => z > current + 1e-9) : zooms.findLast((z) => z < current - 1e-9)
  return next ?? current
}
