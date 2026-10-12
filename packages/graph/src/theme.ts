import {
  type ColorMapName,
  type ColorRef,
  type Dash,
  type ErrorSpec,
  effectiveStyle,
  type FigureStyle,
  type FillStyle,
  type Frame,
  type GraphLook,
  type GraphNode,
  type GraphType,
  isEmptyStyle,
  lookOf,
  type MarkLayer,
  type PointLabels,
  type ProjectSettings,
  type SeriesStyle,
  type StrokeStyle,
  type StyleText,
  type SymbolShape,
  type TextStyle,
} from '@ps/model'
import type { Fill, Stroke } from './scene.ts'

export interface Theme {
  id: string
  /** The palette's colours offered for picking (colour menus), data sets' first colours. */
  palette: string[]
  /**
   * Roadmap 34f: data sets and levels past the palette's take these next (then the palette
   * wraps): `palette` followed by more distinct colours. Absent: the palette wraps.
   */
  categorical?: readonly string[]
  /**
   * Roadmap 49a: the symbols and line patterns data sets take in turn where a layer's shape or
   * dash is the data set's (a style's; absent: `DEFAULT_SHAPES`, `DEFAULT_DASHES`).
   */
  shapes?: readonly SymbolShape[]
  dashes?: readonly Dash[]
  /**
   * Roadmap 49d: the fill colours data sets take in turn where a layer's fill is the data set's (a
   * style's; absent: their colours, fill and outline one group colour).
   */
  fillPalette?: readonly string[]
  text: TextStyle
  tickLabel: TextStyle
  axisTitle: TextStyle
  graphTitle: TextStyle
  legend: TextStyle
  /** Labels beside points (row titles, values; roadmap 22). */
  pointLabel: TextStyle
  axisLine: StrokeStyle
  /** Tick marks point out of the plot, into it, across the axis, or are not drawn. */
  tickDirection: 'out' | 'in' | 'cross' | 'none'
  tickLength: number
  minorTickLength: number
  /** Gap between tick marks and their labels, and between labels and the axis title. */
  labelGap: number
  titleGap: number
  /** Tick marks' width (roadmap 37: a style's); absent = the axis line's. */
  tickWidth?: number
  bracket: { line: StrokeStyle; label: TextStyle; step: number; gap: number; tick: number }
  /** The default colour map of continuous colour (roadmap 37: a style's); absent = viridis. */
  colorMap?: ColorMapName
  /** Per-geom defaults in each context (`CONTEXT_RULES`), a style's values over them. */
  series: Record<GraphType, ResolvedSeriesStyle>
  /** Defaults for curves drawn from analysis outputs (fits). */
  curve: ResolvedSeriesStyle
  /**
   * Audit 2 (G9, decision 664): defaults of the geoms without a v1 section — ellipses and hulls,
   * paths and vectors (34c), densities (34g), the grand mean line and group names at centroids —
   * in the theme, so a style's line widths and label text reach them as they reach every other
   * mark. The same in every context.
   */
  overlay: typeof OVERLAY_THEME
  density: typeof DENSITY_THEME
  refline: StrokeStyle
  centroid: typeof CENTROID_THEME
  /**
   * Roadmap 49c: a dendrogram layer's defaults — its lines, its depth and gap beside a heat map
   * and its cluster strip's width. The same in every context; a style's line widths don't reach
   * it (trees drew 0.75 pt black under every style before they were layers).
   */
  dendrogram: typeof DENDROGRAM_THEME
}

const SERIES_LINE = { color: { series: true as const }, width: 1, dash: 'solid' as const }

/**
 * Theme defaults of roadmap 34c's geoms (they have no v1 section): ellipses and hulls filled at
 * 20% with an outline in the group's colour; paths without heads (the "Trajectories" style adds
 * them); vectors with a filled triangle at the end.
 */
export const OVERLAY_THEME = {
  polygon: {
    draw: 'both',
    fill: { type: 'solid', color: { series: true }, opacity: 0.2 },
    border: SERIES_LINE as StrokeStyle,
  },
  path: { stroke: SERIES_LINE as StrokeStyle, arrow: 'none', head: { shape: 'triangle' } },
  segment: { stroke: SERIES_LINE as StrokeStyle, arrow: 'end', head: { shape: 'triangle' } },
} as const

/**
 * Theme defaults of roadmap 34g's density geoms: hexagons coloured by count on viridis (no
 * outline), contour lines 0.75 pt in the group's colour (bands: viridis by level, or each group's
 * colour at 20% per level), a density image on viridis; colour bars in the legend.
 */
export const DENSITY_THEME = {
  hex: {
    colors: 'viridis',
    reverse: false,
    log: false,
    bar: true,
    opacity: 1,
    border: { color: { rgb: '#ffffff' }, width: 0, dash: 'solid' } as StrokeStyle,
  },
  contour: {
    colors: 'viridis',
    reverse: false,
    log: false,
    bar: true,
    draw: 'lines',
    stroke: { color: { series: true }, width: 0.75, dash: 'solid' } as StrokeStyle,
  },
  raster: { colors: 'viridis', reverse: false, log: false, bar: true, opacity: 1 },
} as const

/** The grand mean line's default look: dashed, grey. */
export const GRAND_MEAN_LINE: StrokeStyle = { color: { rgb: '#808080' }, width: 1, dash: 'dash' }

/**
 * Roadmap 49c: a tree's defaults — 0.75 pt black lines, 36 pt deep and 6 pt from a heat map (as
 * roadmap 30 drew them), a cluster strip 8 pt wide.
 */
export const DENDROGRAM_THEME = {
  line: { color: { rgb: '#000000' }, width: 0.75, dash: 'solid' } as StrokeStyle,
  depth: 36,
  gap: 6,
  stripWidth: 8,
} as const

/** Group names at centroids: bold 10 pt text (over the point labels') with a white halo. */
export const CENTROID_THEME = {
  text: { size: 10, bold: true } as Partial<TextStyle>,
  background: 'halo' as 'none' | 'halo' | 'box',
  halo: { color: '#ffffff', width: 2.5 },
  box: { fill: '#ffffff', opacity: 0.85, border: '#7f7f7f', pad: 2 },
}

/** A section of `SeriesStyle` with every field present. */
type Full<T> = Required<NonNullable<T>>

/**
 * A fully specified series style: every SeriesStyle field present, except XY bars' `binWidth`
 * (absent: the smallest spacing of the X values), bars' `baseline` (absent: 0) and the automatic
 * `pointLabels` (the data set's
 * own, else the graph's for every data set, whole objects not merged field by field; absent =
 * none).
 */
export interface ResolvedSeriesStyle {
  color: ColorRef
  /** Roadmap 49d: the data set's own fill colour (its identity's), if any. */
  fill?: ColorRef
  points: Full<SeriesStyle['points']>
  bar: Omit<Full<SeriesStyle['bar']>, 'binWidth' | 'baseline'> & {
    binWidth?: number
    baseline?: number
  }
  box: Full<SeriesStyle['box']>
  violin: Full<SeriesStyle['violin']>
  label: Full<SeriesStyle['label']>
  center: Full<SeriesStyle['center']>
  error: ErrorSpec
  line: Full<SeriesStyle['line']>
  band: Full<SeriesStyle['band']>
  spaghetti: Full<SeriesStyle['spaghetti']>
  envelope: Full<SeriesStyle['envelope']>
  area: Omit<Full<SeriesStyle['area']>, 'baseline'> & { baseline?: number }
  /** The Y axis plotted against (the right one only counts when the graph has one). */
  yAxis: 'left' | 'right'
  /** Every kind of mark, front to back. */
  markOrder: MarkLayer[]
  pointLabels?: PointLabels
  /** Pies and donuts: the hole, a fraction of the radius (absent: none). */
  hole?: number
}

const SERIES: ColorRef = { series: true }
const BLACK: ColorRef = { rgb: '#000000' }
const WHITE: ColorRef = { rgb: '#ffffff' }

const line = (width: number, color: ColorRef = BLACK): StrokeStyle => ({
  color,
  width,
  dash: 'solid',
})

const base: ResolvedSeriesStyle = {
  color: SERIES,
  points: {
    show: true,
    shape: 'circle',
    size: 6,
    fill: { type: 'solid', color: SERIES, opacity: 1 },
    border: line(0.75, SERIES),
    jitter: 'auto',
    excludedStyle: 'hide',
    replicates: 'mean',
  },
  bar: {
    fill: { type: 'solid', color: SERIES, opacity: 0.35 },
    border: line(1, SERIES),
    width: 0.6,
    show: false,
  },
  box: {
    kind: 'box',
    whiskers: 'minmax',
    fill: { type: 'solid', color: SERIES, opacity: 0.25 },
    border: line(1, SERIES),
    show: false,
  },
  violin: {
    extent: 'truncated',
    smoothing: 1,
    quartiles: true,
    quartileLine: { color: BLACK, width: 1, dash: 'dash' },
  },
  label: { show: false, stat: 'value', position: 'above', format: { mode: 'auto' }, text: {} },
  // Centre line length as a fraction of the column: a short line over the points (the usual look),
  // not most of the column. Grouped slots are narrower, so a larger fraction of one.
  center: { stat: 'mean', line: line(1.25), width: 0.3 },
  error: { stat: 'SD', direction: 'both', capWidth: 8, line: line(1) },
  line: { show: false, stroke: line(1, SERIES), gaps: false },
  band: { show: false, opacity: 0.15 },
  spaghetti: { show: false, stroke: line(0.75, SERIES), fade: 0.5 },
  envelope: { show: false, opacity: 0.2 },
  area: { show: false, opacity: 0.2 },
  yAxis: 'left',
  // Today's drawing order on column and grouped graphs: the centre in front, then error bars,
  // points, bars / boxes, and joining lines at the back.
  markOrder: ['center', 'error', 'points', 'bar', 'line'],
}

/** Parts of whole: slices and segments in solid colour with a white border. */
const WHOLE: ContextRule = {
  points: { show: false },
  bar: { fill: { type: 'solid', color: SERIES, opacity: 1 }, border: line(1, WHITE) },
  center: { stat: 'none' },
  error: { stat: 'none' },
}

const text = (size: number, bold = false): TextStyle => ({
  font: 'sans',
  size,
  color: BLACK,
  bold,
  italic: false,
})

/** Colour-blind-safe categorical palette (Okabe–Ito, reordered, black last). */
const OKABE_ITO = [
  '#0072b2',
  '#d55e00',
  '#009e73',
  '#cc79a7',
  '#e69f00',
  '#56b4e9',
  '#f0e442',
  '#000000',
]

/**
 * Roadmap 34f (decision 432): the colours of the 9th to 24th data set or level, so up to 24 are
 * told apart (a single-cell table's clusters) instead of the palette repeating after 8. Picked
 * once, greedily, from Paul Tol's qualitative schemes (muted, light, vibrant, bright; P. Tol,
 * "Colour Schemes", SRON/EPS/TN/09-002, 2021) and K. L. Kelly's 22 colours of maximum contrast
 * (Color Engineering 3(6), 1965): each next colour the candidate whose least CIEDE2000 difference
 * from the colours chosen (Okabe–Ito's first), as seen with normal vision and with deuteranopia
 * and protanopia simulated (Machado, Oliveira & Fernandes 2009, severity 1), is largest; near
 * whites left out. No set of 24 is safe for every viewer: past 8, labels (group names) help.
 */
export const EXTRA_CATEGORICAL: readonly string[] = [
  '#882255',
  '#882d17',
  '#ffaabb',
  '#332288',
  '#99ddff',
  '#c2b280',
  '#ddcc77',
  '#aa3377',
  '#008856',
  '#009988',
  '#44bb99',
  '#be0032',
  '#cc3311',
  '#aa4499',
  '#b3446c',
  '#ee7733',
]

/** A part of a resolved series style: some sections, each with some of its fields. */
export type ContextRule = { [K in keyof ResolvedSeriesStyle]?: Partial<ResolvedSeriesStyle[K]> }

/**
 * Per-geom defaults adjusted by a graph's context (roadmap 37, decision 536; GRAPH_LAYERS Q3):
 * what differs from the per-geom defaults (`base`) on graphs of each context. A graph's context
 * is its `look`, chosen from its layers when they are built (`lookFor`: bars or boxes make
 * points smaller and error bars point up, grouped slots narrow caps, XY puts symbols in front,
 * survival curves are thicker, bubbles translucent, parts of whole solid) and kept in the
 * document; only the style resolver (`markDefaults`) reads it. A style's values apply over every
 * context. Together they reproduce v1's per-graph-type table exactly (a test keeps them equal).
 */
export const CONTEXT_RULES: Record<GraphType, ContextRule> = {
  'column.scatter': {},
  'column.bar': {
    points: { show: false, size: 5 },
    center: { stat: 'none' },
    error: { direction: 'above' },
  },
  'column.box': {
    points: { show: false, size: 5 },
    center: { stat: 'median', width: 1 },
    error: { stat: 'none' },
  },
  'column.beforeAfter': {
    points: { fill: { type: 'solid', color: WHITE, opacity: 1 } },
    center: { stat: 'none' },
    error: { stat: 'none' },
  },
  // Grouped points are every replicate unless 'mean' is chosen (one symbol at the centre).
  'grouped.bar': {
    points: { show: false, size: 4, replicates: 'each' },
    center: { stat: 'none' },
    error: { direction: 'above', capWidth: 5 },
    bar: { width: 0.8 },
  },
  'grouped.scatter': {
    points: { size: 4.5, replicates: 'each' },
    center: { width: 0.45 },
    error: { capWidth: 5 },
  },
  'grouped.box': {
    points: { show: false, size: 4, replicates: 'each' },
    center: { stat: 'median', width: 1 },
    error: { stat: 'none', capWidth: 5 },
    bar: { width: 0.8 },
  },
  // Estimation plots: the groups as a scatter with a line at the mean.
  'column.estimation': { error: { stat: 'none' } },
  'xy.scatter': {
    // XY: symbols in front of their error bars, lines behind.
    markOrder: ['points', 'error', 'center', 'bar', 'line'],
    // Bars (histograms) fill their bin: neighbouring bins touch.
    bar: { width: 1 },
    center: { stat: 'none' },
    error: { capWidth: 6, line: line(1, SERIES) },
  },
  // Staircase lines; the "points" are the tick marks at censored times.
  'survival.step': {
    points: { border: line(1, SERIES) },
    center: { stat: 'none' },
    error: { stat: 'none' },
    line: { show: true, stroke: line(1.5, SERIES) },
  },
  // Bubbles: translucent so overlaps show, their size set by the size variable.
  'bubble.scatter': {
    points: { size: 10, fill: { type: 'solid', color: SERIES, opacity: 0.55 } },
    center: { stat: 'none' },
    error: { stat: 'none' },
  },
  // Slices and stacked segments: solid, separated by a thin white border.
  'whole.pie': WHOLE,
  // A donut is a pie with a hole half the radius.
  'whole.donut': { ...WHOLE, hole: 0.5 },
  'whole.bar': WHOLE,
  // Heat maps colour cells from their own style (`style.heatmap`).
  'heatmap.cells': {},
}

/** Per-geom defaults under a context rule, section by section. */
export function underRule(d: ResolvedSeriesStyle, rule: ContextRule): ResolvedSeriesStyle {
  const out = { ...d } as Record<string, unknown>
  for (const [k, v] of Object.entries(rule)) {
    const cur = out[k]
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object'
        ? { ...cur, ...v }
        : v
  }
  return out as unknown as ResolvedSeriesStyle
}

const contexts = (d: ResolvedSeriesStyle) =>
  Object.fromEntries(
    Object.entries(CONTEXT_RULES).map(([look, rule]) => [look, underRule(d, rule)]),
  ) as Record<GraphType, ResolvedSeriesStyle>

export const DEFAULT_THEME: Theme = {
  id: 'default',
  palette: OKABE_ITO,
  categorical: [...OKABE_ITO, ...EXTRA_CATEGORICAL],
  text: text(12),
  tickLabel: text(11),
  axisTitle: text(12, true),
  graphTitle: text(14, true),
  legend: text(11),
  pointLabel: text(9),
  axisLine: line(1),
  tickDirection: 'out',
  tickLength: 4,
  minorTickLength: 2,
  labelGap: 3,
  titleGap: 6,
  bracket: { line: line(1), label: text(11), step: 16, gap: 6, tick: 4 },
  series: contexts(base),
  curve: underRule(base, {
    points: { show: false },
    center: { stat: 'none' },
    error: { stat: 'none' },
    line: { show: true, stroke: line(1.5, SERIES) },
    band: { show: true },
  }),
  overlay: OVERLAY_THEME,
  density: DENSITY_THEME,
  refline: GRAND_MEAN_LINE,
  centroid: CENTROID_THEME,
  dendrogram: DENDROGRAM_THEME,
}

export const THEMES: Record<string, Theme> = { default: DEFAULT_THEME }

export function themeFor(id: string | undefined): Theme {
  return (id && THEMES[id]) || DEFAULT_THEME
}

// --- Styles (roadmap 37) ----------------------------------------------------------------------

/** A role's text: the theme's, the style's font, then the role's own fields. */
function roleText(t: TextStyle, font: FigureStyle['font'], own: StyleText | undefined): TextStyle {
  return { ...t, ...(font ? { font } : {}), ...defined(own) }
}

const withWidth = (s: StrokeStyle, width: number | undefined): StrokeStyle =>
  width === undefined ? s : { ...s, width }

/** A context's per-geom defaults with a style's symbol size, line widths and bar fill. */
function styledMarks(d: ResolvedSeriesStyle, s: FigureStyle): ResolvedSeriesStyle {
  const l = s.lines ?? {}
  const opacity = s.barFillOpacity
  // Translucent bars and boxes take the style's opacity; parts of whole stay solid.
  const fill = (f: FillStyle): FillStyle =>
    opacity !== undefined && f.type === 'solid' && f.opacity < 1 ? { ...f, opacity } : f
  return {
    ...d,
    points: s.symbolSize === undefined ? d.points : { ...d.points, size: s.symbolSize },
    bar: { ...d.bar, fill: fill(d.bar.fill), border: withWidth(d.bar.border, l.barOutline) },
    box: { ...d.box, fill: fill(d.box.fill), border: withWidth(d.box.border, l.barOutline) },
    error: { ...d.error, line: withWidth(d.error.line, l.errorBar) },
    center: { ...d.center, line: withWidth(d.center.line, l.dataLine) },
    line: { ...d.line, stroke: withWidth(d.line.stroke, l.dataLine) },
    spaghetti: { ...d.spaghetti, stroke: withWidth(d.spaghetti.stroke, l.dataLine) },
  }
}

/**
 * Audit 2 (G9, decision 664): the newer geoms' defaults under a style — outlines of ellipses and
 * hulls, paths, vectors, contour lines and the grand mean line at its data line width; group
 * names at centroids at its result labels' size (bold). Hexagons keep no outline.
 */
function styledGeoms(
  d: Theme,
  s: FigureStyle,
): Pick<Theme, 'overlay' | 'density' | 'refline' | 'centroid'> {
  const w = s.lines?.dataLine
  const size = s.text?.resultLabel?.size
  const o = d.overlay
  return {
    overlay: {
      polygon: { ...o.polygon, border: withWidth(o.polygon.border, w) },
      path: { ...o.path, stroke: withWidth(o.path.stroke, w) },
      segment: { ...o.segment, stroke: withWidth(o.segment.stroke, w) },
    },
    density: {
      ...d.density,
      contour: { ...d.density.contour, stroke: withWidth(d.density.contour.stroke, w) },
    },
    refline: withWidth(d.refline, w),
    centroid:
      size === undefined ? d.centroid : { ...d.centroid, text: { ...d.centroid.text, size } },
  }
}

/** The colours after a style's palette: the extra categorical colours it doesn't have. */
const categoricalOf = (palette: readonly string[]) => {
  const own = new Set(palette.map((c) => c.toLowerCase()))
  return [...palette, ...EXTRA_CATEGORICAL.filter((c) => !own.has(c))]
}

const themes = new WeakMap<FigureStyle, Theme>()
const EMPTY: FigureStyle = {}

/**
 * A style as a theme (roadmap 37, decision 531): the app's defaults with the style's fonts and
 * sizes per role, line widths, symbol size, bar fill, palette, colour map and axis look. The
 * empty style (Default) is `DEFAULT_THEME` itself.
 */
export function themeOf(style: FigureStyle | undefined): Theme {
  if (!style || isEmptyStyle(style)) return DEFAULT_THEME
  const hit = themes.get(style)
  if (hit) return hit
  const d = DEFAULT_THEME
  const t = style.text ?? {}
  const l = style.lines ?? {}
  const a = style.axes ?? {}
  const f = style.font
  const series = Object.fromEntries(
    Object.entries(d.series).map(([k, v]) => [k, styledMarks(v, style)]),
  ) as Theme['series']
  const theme: Theme = {
    ...d,
    id: 'style',
    palette: style.palette ?? d.palette,
    categorical: style.palette ? categoricalOf(style.palette) : d.categorical,
    ...(style.shapes ? { shapes: style.shapes } : {}),
    ...(style.dashes ? { dashes: style.dashes } : {}),
    ...(style.fillPalette ? { fillPalette: style.fillPalette } : {}),
    text: roleText(d.text, f, t.annotation),
    tickLabel: roleText(d.tickLabel, f, t.tickLabel),
    axisTitle: roleText(d.axisTitle, f, t.axisTitle),
    graphTitle: roleText(d.graphTitle, f, t.title),
    legend: roleText(d.legend, f, t.legend),
    pointLabel: roleText(d.pointLabel, f, t.resultLabel),
    axisLine: withWidth(d.axisLine, l.axis),
    ...(l.tick !== undefined ? { tickWidth: l.tick } : {}),
    tickDirection: a.tickDirection ?? d.tickDirection,
    tickLength: a.tickLength ?? d.tickLength,
    minorTickLength: a.minorTickLength ?? d.minorTickLength,
    bracket: {
      ...d.bracket,
      line: withWidth(d.bracket.line, l.bracket),
      label: roleText(d.bracket.label, f, t.bracket),
    },
    ...(style.colorMap ? { colorMap: style.colorMap } : {}),
    series,
    curve: styledMarks(d.curve, style),
    ...styledGeoms(d, style),
  }
  themes.set(style, theme)
  return theme
}

/**
 * The theme a graph is drawn with (decision 531): the app's defaults, the project's style, then
 * the graph's own style; what the graph sets itself (its document's values) applies over it.
 */
export const graphTheme = (
  project: { settings: Pick<ProjectSettings, 'theme' | 'style'> },
  graph?: Pick<GraphNode, 'theme'>,
): Theme => themeOf(effectiveStyle(project.settings, graph) ?? EMPTY)

/**
 * The per-geom defaults of a graph's context (`CONTEXT_RULES`) under its theme: the only reader
 * of `look` (decision 536).
 */
export const markDefaults = (
  theme: Theme,
  graph: { frame: Frame; look?: GraphLook | undefined },
): ResolvedSeriesStyle => theme.series[lookOf(graph)]

/**
 * Whether a graph's context is parts of a whole drawn as 100% bars: its scaffold's axis is the
 * percent of the total (`scaffoldFor`). With `markDefaults` and `graphFamily`, the only readers
 * of `look` (decision 536; audit 2, G11).
 */
export const percentOfWhole = (graph: { frame: Frame; look?: GraphLook | undefined }): boolean =>
  lookOf(graph) === 'whole.bar'

/**
 * The family of a graph's context (column, grouped, xy, whole, survival, bubble, heatmap): graphs
 * of one family snap their plot sizes to each other's (the graph view's resize).
 */
export const graphFamily = (graph: { frame: Frame; look?: GraphLook | undefined }): string =>
  lookOf(graph).split('.')[0]!

// ---------------------------------------------------------------------------------------------

export function resolveColor(
  ref: ColorRef,
  palette: readonly string[],
  seriesColor?: string,
): string {
  if ('rgb' in ref) return ref.rgb.toLowerCase()
  if ('series' in ref) return seriesColor ?? '#000000'
  return palette[ref.palette % palette.length]!
}

export function resolveStroke(
  s: StrokeStyle,
  palette: readonly string[],
  seriesColor?: string,
): Stroke {
  return { color: resolveColor(s.color, palette, seriesColor), width: s.width, dash: s.dash }
}

export function resolveFill(
  f: FillStyle,
  palette: readonly string[],
  seriesColor?: string,
): Fill | null {
  return f.type === 'none'
    ? null
    : { color: resolveColor(f.color, palette, seriesColor), opacity: f.opacity }
}

/** Drops keys whose value is undefined, so spreading a partial never erases a default. */
export function defined<T extends object>(o: T | undefined): Partial<T> {
  if (!o) return {}
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(o))
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}

export function resolveText(t: TextStyle, override?: Partial<TextStyle>): TextStyle {
  return override ? { ...t, ...defined(override) } : t
}

/** A graph element's text style: the theme's, then the graph's base text, then the element's. */
export const graphText = (
  t: TextStyle,
  graph: Pick<GraphNode, 'style'>,
  own?: Partial<TextStyle>,
): TextStyle => resolveText(resolveText(t, graph.style.text), own)

/**
 * The colours a graph gives its data sets and levels by place (roadmap 34f): its own palette
 * (wrapping), else the theme's categorical colours — the palette's 8 first, so graphs of up to 8
 * draw as before, then more (`EXTRA_CATEGORICAL`) before they wrap.
 */
export const graphPalette = (graph: Pick<GraphNode, 'style'>, theme: Theme): readonly string[] =>
  graph.style.palette ?? theme.categorical ?? theme.palette

/**
 * Roadmap 49a: the symbols data sets take in turn where a layer's shape is the data set's
 * (`{ series: true }`): circle, square, triangle, diamond, cross, plus (the nested subjects'
 * sequence and ggplot's first shapes).
 */
export const DEFAULT_SHAPES: readonly SymbolShape[] = [
  'circle',
  'square',
  'triangle',
  'diamond',
  'cross',
  'plus',
]

/** Roadmap 49a: the line patterns data sets take in turn: solid, dashed, dotted. */
export const DEFAULT_DASHES: readonly Dash[] = ['solid', 'dash', 'dot']

/** Roadmap 49a: a graph's cycle of symbols — its own, else its style's, else the default. */
export const graphShapes = (
  graph: Pick<GraphNode, 'style'>,
  theme: Pick<Theme, 'shapes'>,
): readonly SymbolShape[] => graph.style.shapes ?? theme.shapes ?? DEFAULT_SHAPES

/** Roadmap 49a: a graph's cycle of line patterns — its own, else its style's, else the default. */
export const graphDashes = (
  graph: Pick<GraphNode, 'style'>,
  theme: Pick<Theme, 'dashes'>,
): readonly Dash[] => graph.style.dashes ?? theme.dashes ?? DEFAULT_DASHES

/**
 * Roadmap 49d: a graph's fill colours by data set — its own, else its style's; undefined when
 * neither has any (data sets' fills are then their colours, as before).
 */
export const graphFillPalette = (
  graph: Pick<GraphNode, 'style'>,
  theme: Pick<Theme, 'fillPalette'>,
): readonly string[] | undefined => graph.style.fillPalette ?? theme.fillPalette

/** A data set's colour: its own, else the palette's `index`th (wrapping around). */
export const seriesColor = (color: ColorRef, palette: readonly string[], index: number): string =>
  'series' in color ? palette[index % palette.length]! : resolveColor(color, palette)

export type ResolvedBracketStyle = Theme['bracket']

/** Significance-bracket style: theme → graph base text (label) → graph.style.bracket. */
export function resolveBracketStyle(theme: Theme, graph: GraphNode): ResolvedBracketStyle {
  const b = graph.style.bracket ?? {}
  const t = theme.bracket
  return {
    line: { ...t.line, ...defined(b.line) },
    label: graphText(t.label, graph, b.label),
    step: b.step ?? t.step,
    gap: b.gap ?? t.gap,
    tick: b.tick ?? t.tick,
  }
}
