// Roadmap 47: the format bar's overflow. When the bar is narrower than its groups (the docked
// Format panel open in a 1,400 px window, a 1,024 px window, a page's inspector), the groups that
// don't fit fold into a "More ▾" menu at its right end, in a fixed order: the actions first
// (Format…, the painter, Reset position), then the legend's Layout (roadmap 47b), Symbols, Line,
// Fill and Text last. The selection's
// name never folds. Widths are measured by a ResizeObserver (the last width a group had in the
// bar stands for it while folded), so deciding is this pure function of numbers.

/** The bar's groups that can fold, by id. */
export type FoldId =
  | 'text'
  | 'fill'
  | 'line'
  | 'symbols'
  | 'layout'
  | 'reset'
  | 'painter'
  | 'format'

/** The order groups fold in: the first folds first. */
export const FOLD_ORDER: readonly FoldId[] = [
  'format',
  'painter',
  'reset',
  // Roadmap 47b: the legend's Layout (also in the Format panel's Common).
  'layout',
  'symbols',
  'line',
  'fill',
  'text',
]

export interface FoldUnit {
  id: FoldId
  /** Its width in the bar, with the gap after it (px). */
  width: number
}

/**
 * The groups to fold so the bar fits `available` px: none when everything fits beside `fixed`
 * (the name, the bar's padding); else groups in `FOLD_ORDER` until the rest and the More button
 * (`more` px) fit, or all of them.
 */
export function foldedGroups(
  available: number,
  fixed: number,
  units: readonly FoldUnit[],
  more: number,
): ReadonlySet<FoldId> {
  const total = units.reduce((n, u) => n + u.width, fixed)
  const folded = new Set<FoldId>()
  if (total <= available) return folded
  let width = total + more
  for (const id of FOLD_ORDER) {
    if (width <= available) break
    const u = units.find((x) => x.id === id)
    if (!u) continue
    folded.add(id)
    width -= u.width
  }
  return folded
}

/** Two sets of folded groups alike (no re-render for the same answer). */
export const sameFolded = (a: ReadonlySet<FoldId>, b: ReadonlySet<FoldId>): boolean =>
  a.size === b.size && [...a].every((id) => b.has(id))
