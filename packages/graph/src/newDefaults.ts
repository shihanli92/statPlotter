import type { FillStyle, Layer, StrokeStyle } from '@ps/model'

// Audit 3 (RFR-5, RTA-12): the looks new layers start with, written into them as they are made
// (`newGraphNode`, `withLayers`: presets, the graph builder, Change layers, Duplicate as…), not
// theme defaults: a graph migrated from v1, or saved before, draws as it did (its layers have
// none of these, and the theme's defaults are unchanged).
//
// - Bars are filled solid in their data set's colour (the theme's are pale: 35%), as journals
//   draw them.
// - Points drawn over bars are white with a black border, so they stay visible on any bar (in
//   the bar's own colour they vanish into a solid one).
// - Lines through each replicate (XY) are faded towards white only beside a line at the mean
//   (they are the background then); alone, they are the data, drawn in its colour.

/** Which looks a new graph's layers start with: these ('new') or the theme's ('theme'). */
export type NewLooks = 'new' | 'theme'

/** A bar's fill in its data set's colour, solid. */
export const NEW_BAR_FILL: FillStyle = { type: 'solid', color: { series: true }, opacity: 1 }
/** Points over bars: white, black border. */
export const NEW_POINT_FILL: FillStyle = { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 }
export const NEW_POINT_BORDER: StrokeStyle = {
  color: { rgb: '#000000' },
  width: 0.75,
  dash: 'solid',
}

const table = (l: Layer) => !l.data || l.data.from === 'table'
const own = (l: Layer, field: string) =>
  !!l.style &&
  Object.hasOwn(l.style as object, field) &&
  (l.style as Record<string, unknown>)[field] !== undefined
const withStyle = (l: Layer, patch: Record<string, unknown>): Layer =>
  ({ ...l, style: { ...(l.style as object | undefined), ...patch } }) as Layer

/** Bars of the table's data (a mean, counts in bins) the theme fills pale. */
const isBar = (l: Layer) =>
  l.geom === 'bar' && table(l) && l.stat.kind !== 'fraction' && l.visible !== false
/** The table's points every value or mean draws (not a graph of variables' mapped ones). */
const isPoints = (l: Layer) =>
  l.geom === 'points' && table(l) && !l.aes && l.stat.kind !== 'threshold'
/** A line through each replicate of the table's data sets ("spaghetti"). */
const isSubjects = (l: Layer) =>
  l.geom === 'line' && table(l) && l.stat.kind === 'identity' && !l.aes
/** A line at the mean of the table's data sets. */
const isMeanLine = (l: Layer) =>
  l.geom === 'line' && table(l) && l.stat.kind === 'summary' && l.visible !== false

/**
 * New layers' looks (see above). `before`: the graph's layers when these replace them — a layer
 * kept (its id and geom) keeps its look, but for its lines through each replicate when a mean
 * line comes or goes (a fade this set is taken back when one comes).
 */
export function newLayerLooks(layers: readonly Layer[], before?: readonly Layer[]): Layer[] {
  const kept = (l: Layer) => !!before?.some((b) => b.id === l.id && b.geom === l.geom)
  const fresh = (l: Layer) => !kept(l)
  const newBars = layers.some((l) => isBar(l) && fresh(l))
  const bars = layers.some(isBar)
  const mean = layers.some(isMeanLine)
  const meanBefore = !!before?.some(isMeanLine)
  return layers.map((l) => {
    if (isBar(l) && fresh(l) && !own(l, 'fill')) return withStyle(l, { fill: NEW_BAR_FILL })
    if (isPoints(l) && bars && (fresh(l) || newBars) && !own(l, 'fill'))
      return withStyle(l, {
        fill: NEW_POINT_FILL,
        ...(own(l, 'border') ? {} : { border: NEW_POINT_BORDER }),
      })
    if (isSubjects(l)) {
      const fade = (l.style as { fade?: number } | undefined)?.fade
      if (!mean && fade === undefined && (fresh(l) || meanBefore)) return withStyle(l, { fade: 0 })
      if (mean && !meanBefore && kept(l) && fade === 0) {
        const { fade: _, ...rest } = l.style as Record<string, unknown>
        const { style: __, ...bare } = l
        return (Object.keys(rest).length ? { ...l, style: rest } : bare) as Layer
      }
    }
    return l
  })
}
