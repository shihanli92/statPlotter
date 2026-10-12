import type { FillStyle, Layer } from '@ps/model'

// Audit 3 (RFR-5, RTA-12; fix after 0.3.7, decisions 1272-1273): the looks new layers start
// with, written into them as they are made (`newGraphNode`, `withLayers`, `withNewLayerLook`:
// presets, the graph builder, Change layers, Duplicate as…, Add layer), not theme defaults: a
// graph migrated from v1, or saved before, draws as it did (its layers have none of these, and
// the theme's defaults are unchanged). A layer already on a graph is never restyled by one added.
//
// - Bars are filled solid in their data set's colour (the theme's are pale: 35%), as journals
//   draw them; bars made together with the table's points (the same data sets), or added beside
//   them, are a lighter version of their colour (40%), so the points stay visible on them, with
//   the theme's outline in that colour (1 pt; a style's bar outline width applies: written into
//   the layer, it would override it).
// - Points are never restyled because bars are there: they keep the theme's look (their data
//   set's colour), as they would without bars.
// - Lines through each replicate (XY) are faded towards white only beside a line at the mean
//   (they are the background then); alone, they are the data, drawn in its colour.

/** Which looks a new graph's layers start with: these ('new') or the theme's ('theme'). */
export type NewLooks = 'new' | 'theme'

/** A bar's fill in its data set's colour, solid. */
export const NEW_BAR_FILL: FillStyle = { type: 'solid', color: { series: true }, opacity: 1 }
/** Bars drawn with points: their data set's colour, lighter (decision 1272: 40%). */
export const NEW_LIGHT_BAR_FILL: FillStyle = {
  type: 'solid',
  color: { series: true },
  opacity: 0.4,
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
  // Bars drawn together with points of the same data sets (the table's, shown).
  const withPoints = layers.some((l) => isPoints(l) && l.visible !== false)
  const mean = layers.some(isMeanLine)
  const meanBefore = !!before?.some(isMeanLine)
  return layers.map((l) => {
    if (isBar(l) && fresh(l) && !own(l, 'fill'))
      return withStyle(l, { fill: withPoints ? NEW_LIGHT_BAR_FILL : NEW_BAR_FILL })
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

/**
 * A layer added to a graph whose layers are `layers` (Add layer), with the look a new layer
 * starts with by the same rule (`newLayerLooks`); the layers already there are left as they are.
 */
export function withNewLayerLook(layers: readonly Layer[], layer: Layer): Layer {
  return newLayerLooks([...layers, layer], layers).at(-1) ?? layer
}
