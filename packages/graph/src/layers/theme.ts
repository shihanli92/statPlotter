import {
  type GraphNode,
  isBySeries,
  type Layer,
  type LayerData,
  type Stat,
  type StrokeStyle,
  type StyleSection,
  styleSections,
} from '@ps/model'
import {
  DEFAULT_THEME,
  graphDashes,
  graphShapes,
  markDefaults,
  type ResolvedSeriesStyle,
  type Theme,
} from '../theme.ts'

// The theme for layers: a layer's style for one data set is the per-geom defaults of the graph's
// context under its style (`markDefaults`, roadmap 37), then the layer's style, the data set's
// own and its stat. No module of the layer engine reads `look` (decision 536).

/**
 * Pies and donuts: hole, first slice's angle, direction (the context's hole: a donut's is half
 * the radius).
 */
export function polarStyle(graph: GraphNode, theme: Theme = DEFAULT_THEME) {
  const p = graph.style.polar ?? {}
  return {
    hole: p.hole ?? markDefaults(theme, graph).hole ?? 0,
    startAngle: p.startAngle ?? 0,
    clockwise: p.clockwise ?? true,
  }
}

/** A layer's data, following layers that draw another layer's series. */
export function dataOf(graph: GraphNode, layer: Pick<Layer, 'data'>): LayerData {
  let d = layer.data ?? { from: 'table' }
  for (let i = 0; d.from === 'layer' && i < graph.layers.length; i++) {
    const id: string = d.layer
    d = graph.layers.find((l) => l.id === id)?.data ?? { from: 'table' }
  }
  return d.from === 'layer' ? { from: 'table' } : d
}

const has = (o: unknown, k: string): o is Record<string, unknown> =>
  typeof o === 'object' && o !== null && Object.hasOwn(o, k)

const sectionsOf = new WeakMap<Layer, ReturnType<typeof styleSections>>()

/**
 * A data set's identity (colour, Y axis, point labels) over the theme's defaults: the graph's
 * defaults, then the data set's own. Outputs and functions (`curve`) have their own alone.
 */
export function identityStyle(
  theme: Theme,
  graph: GraphNode,
  key: string,
  curve = false,
): ResolvedSeriesStyle {
  const d = curve ? theme.curve : markDefaults(theme, graph)
  const chain = curve
    ? [graph.seriesOverrides[key]]
    : [graph.style.seriesDefaults, graph.seriesOverrides[key]]
  const last = <K extends 'color' | 'fill' | 'yAxis' | 'pointLabels'>(k: K) =>
    chain.reduce<NonNullable<(typeof chain)[0]>[K]>((v, s) => s?.[k] ?? v, undefined)
  const pointLabels = last('pointLabels')
  const fill = last('fill')
  return {
    ...d,
    color: last('color') ?? d.color,
    yAxis: last('yAxis') ?? d.yAxis,
    ...(pointLabels ? { pointLabels } : {}),
    ...(fill ? { fill } : {}),
  }
}

/**
 * A data set's (or output's, or function's) look in one layer, as the drawing code reads it:
 * theme → identity (colour, Y axis, point labels) → the layer's style → the data set's own →
 * the stat. Outputs and functions take the theme's curve defaults and their identity alone.
 * Roadmap 49a: a shape or line pattern that is the data set's (`{ series: true }`) is the graph's
 * cycle's entry at the data set's place, `index` (its colour's; a function asked only then).
 */
export function layerStyle(
  theme: Theme,
  graph: GraphNode,
  layer: Layer,
  key: string,
  stat: Stat,
  index: number | (() => number) = 0,
): ResolvedSeriesStyle {
  const table = dataOf(graph, layer).from === 'table'
  const out = identityStyle(theme, graph, key, !table)
  // Fields by section, each section then copied once.
  const patch = new Map<StyleSection, Record<string, unknown>>()
  const set = (section: StyleSection, field: string, v: unknown) => {
    const p = patch.get(section)
    if (p) p[field] = v
    else patch.set(section, { [field]: v })
  }
  let map = sectionsOf.get(layer)
  if (!map) {
    map = styleSections(layer)
    sectionsOf.set(layer, map)
  }
  for (const src of [layer.style, layer.series?.[key]?.style] as unknown[])
    for (const name of Object.keys(src ?? {})) {
      const at = map[name]
      if (at && has(src, name)) set(at[0], at[1], src[name])
    }
  switch (stat.kind) {
    case 'summary':
      set('center', 'stat', stat.center)
      set('error', 'stat', stat.error ?? 'none')
      set('points', 'replicates', 'mean')
      break
    case 'identity':
      set('points', 'replicates', 'each')
      break
    case 'boxplot':
      set('box', 'kind', 'box')
      set('box', 'whiskers', stat.whiskers)
      break
    case 'range':
      set('box', 'kind', 'floating')
      set('center', 'stat', stat.center ?? 'mean')
      break
    case 'density':
      set('box', 'kind', 'violin')
      set('violin', 'smoothing', stat.smoothing)
      set('violin', 'extent', stat.extent)
      set('center', 'stat', stat.center ?? 'none')
      break
  }
  // The layer's own mark is shown (in v1 terms): the drawing code shared with v1 reads it so.
  const shown = showSection(layer, stat, table)
  if (shown) set(shown, 'show', true)
  for (const [section, p] of patch) out[section] = { ...out[section], ...p } as never
  return cycled(out, graph, theme, index)
}

/** Roadmap 49a: the lines whose pattern may be the data set's (`SeriesStroke`), by section. */
const CYCLED_STROKES = [
  ['line', 'stroke'],
  ['spaghetti', 'stroke'],
  ['error', 'line'],
  ['center', 'line'],
] as const

/**
 * Roadmap 49a: a resolved style with the data set's shape and line patterns (`{ series: true }`)
 * replaced by the graph's cycles' entries at `index` (wrapping, as colours do). Anything else is
 * returned as it is (the same object), so graphs without them draw exactly as before.
 */
function cycled(
  out: ResolvedSeriesStyle,
  graph: GraphNode,
  theme: Theme,
  index: number | (() => number),
): ResolvedSeriesStyle {
  let at: number | undefined
  const place = () => {
    at ??= Math.max(0, typeof index === 'function' ? index() : index)
    return at
  }
  if (isBySeries(out.points.shape as unknown)) {
    const shapes = graphShapes(graph, theme)
    out.points = { ...out.points, shape: shapes[place() % shapes.length]! }
  }
  for (const [section, field] of CYCLED_STROKES) {
    const part = out[section] as Record<string, unknown>
    const stroke = part[field] as StrokeStyle | undefined
    if (!stroke || !isBySeries(stroke.dash as unknown)) continue
    const dashes = graphDashes(graph, theme)
    out[section] = {
      ...part,
      [field]: { ...stroke, dash: dashes[place() % dashes.length]! },
    } as never
  }
  return out
}

/** The v1 section whose `show` flag means a layer's mark. */
function showSection(layer: Layer, stat: Stat, table: boolean): StyleSection | undefined {
  switch (layer.geom) {
    case 'points':
    case 'censor':
      return 'points'
    case 'bar':
    case 'box':
    case 'label':
      return layer.geom
    case 'line':
      return table && stat.kind === 'identity' ? 'spaghetti' : 'line'
    case 'step':
      return 'line'
    case 'area':
      return 'area'
    case 'band':
      return table && stat.kind === 'summary' ? 'envelope' : 'band'
    default:
      return undefined
  }
}

/** A style field set for the data set or on the layer (not a theme default), if any. */
export function ownField(layer: Layer, key: string, name: string): unknown {
  const own = layer.series?.[key]?.style as Record<string, unknown> | undefined
  return own?.[name] ?? (layer.style as Record<string, unknown> | undefined)?.[name]
}

// Audit 2 (G9): the newer geoms' defaults are the theme's (`Theme.overlay`, `.density`).
export { DENSITY_THEME, OVERLAY_THEME } from '../theme.ts'

/**
 * Roadmap 34e: how a points layer draws its points — as an image on screen when there are many
 * (`render`: 'auto', 'vector', 'image') and in which order (`order`: 'table', 'value', 'random')
 * — the data set's own, else the layer's, else these defaults.
 */
export const POINTS_THEME: {
  render: 'auto' | 'vector' | 'image'
  order: 'table' | 'value' | 'random'
} = { render: 'auto', order: 'table' }

export function pointsOption<K extends keyof typeof POINTS_THEME>(
  layer: Layer,
  key: string,
  name: K,
): (typeof POINTS_THEME)[K] {
  return (ownField(layer, key, name) as (typeof POINTS_THEME)[K] | undefined) ?? POINTS_THEME[name]
}

/** A density layer's opacity of bands drawn per group (each level's at this, stacked). */
export const GROUP_BAND_OPACITY = 0.2
