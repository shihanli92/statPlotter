import { z } from 'zod'
import { CornerArrows } from './axisExtras.ts'
import { StyleChoice } from './figureStyle.ts'
import {
  ArcsinhParams,
  BarLabel,
  BracketStyle,
  ColorMapName,
  ErrorSpec,
  ExtraSeries,
  FunctionCurve,
  GraphType,
  graphCommon,
  HeatmapStyle,
  LogicleParams,
  PointLabels,
  type SeriesStyle,
  SymbolShape,
} from './graph.ts'
import { DataSetKey, NodeId } from './ids.ts'
import { ResultStat } from './results.ts'
import {
  ArrowHead,
  BySeries,
  ColorRef,
  Dash,
  FillStyle,
  NumberDisplay,
  Pt,
  RGB,
  SeriesStroke,
  StrokeStyle,
  TextStyle,
} from './style.ts'

// Graphs as a frame plus layers (roadmap 33, docs/design/GRAPH_LAYERS.md): each layer is a geom ×
// stat × position with its own sparse style, per-data-set overrides and a data source. The graph
// node of schema v2 (roadmap 33b); v1 graphs (`GraphNodeV1`) migrate to it (`compileV1`).

/**
 * A series of a graph by its key: a data set key of the source table, or the id of an analysis
 * output or a function drawn by a layer.
 */
export const SeriesKey = z.string().min(1)
export type SeriesKey = z.infer<typeof SeriesKey>

/** Short id, unique within its graph; deterministic on migration ('bars', 'points', 'error'…). */
export const LayerId = z.string().regex(/^[a-z][A-Za-z0-9]{0,23}$/)
export type LayerId = z.infer<typeof LayerId>

/** The coordinate frame: what the slots and axes are. Chosen from the table kind. */
export const Frame = z.enum([
  /** One slot per data set (column, nested, multiple variables as columns, 100% bars). */
  'category',
  /** One cluster per row, data sets within it (grouped, contingency). */
  'grouped',
  /** Continuous X and Y (XY, survival, bubble, analysis outputs). */
  'xy',
  /** Wedges, one pie per data set (parts of whole). */
  'polar',
  /** Category × category tiles (heat maps). */
  'matrix',
])
export type Frame = z.infer<typeof Frame>

export const Geom = z.enum([
  'points',
  'bar',
  'errorbar',
  'center',
  'box',
  'violin',
  'line',
  'step',
  'censor',
  'area',
  'band',
  'connector',
  'refline',
  'difference',
  'tile',
  'wedge',
  'label',
  /** Roadmap 34c: a closed shape per group (ellipses, convex hulls), outlined, filled or both. */
  'polygon',
  /** Roadmap 34c: each group's points joined in table row order (trajectories), with arrows. */
  'path',
  /** Roadmap 34c: an arrow per row from (X, Y) to (X end, Y end) (vector plots). */
  'segment',
  /** Roadmap 34g: hexagons tiling the plot, each coloured by the points in it (hexbin plots). */
  'hex',
  /** Roadmap 34g: contour lines (and filled bands) of the points' 2D density. */
  'contour',
  /** Roadmap 34g: the points' 2D density as an image (a density heat image). */
  'raster',
  /**
   * Roadmap 49c: a hierarchical clustering's tree of a heat map's rows or columns, beside the map
   * (its leaves at the cells), or alone (a dendrogram of a table's rows or columns).
   */
  'dendrogram',
])
export type Geom = z.infer<typeof Geom>

/** Theme-defaults family: the v1 graph type's literals (`theme.series[look]`). */
export const GraphLook = GraphType
export type GraphLook = z.infer<typeof GraphLook>

export const Center = z.enum(['mean', 'median', 'geomean'])
export type Center = z.infer<typeof Center>
/** A centre line's statistic, or none (violins without a centre line). */
const LineCenter = z.enum(['mean', 'median', 'geomean', 'none'])
export const ErrorStat = ErrorSpec.shape.stat
export type ErrorStat = z.infer<typeof ErrorStat>
export const Whiskers = z.enum(['minmax', 'tukey', 'p1p99', 'p025p975', 'p5p95', 'p10p90'])
export type Whiskers = z.infer<typeof Whiskers>

const Identity = z.object({ kind: z.literal('identity') })
const Summary = z.object({
  kind: z.literal('summary'),
  center: Center,
  /** Error bars, bands; absent = none. */
  error: ErrorStat.optional(),
  /** 'subject': per subject of a nested group; 'all': one value over every data set. */
  by: z.enum(['series', 'subject', 'all']).optional(),
})
const Boxplot = z.object({ kind: z.literal('boxplot'), whiskers: Whiskers })
/** Floating bars: minimum to maximum, the line at the centre (absent: the mean). */
const Range = z.object({ kind: z.literal('range'), center: Center.optional() })
const Density = z.object({
  kind: z.literal('density'),
  smoothing: z.number().min(0.1).max(10),
  extent: z.enum(['truncated', 'extended']),
  /** The centre line across the violin; absent = none. */
  center: LineCenter.optional(),
})
const Km = z.object({ kind: z.literal('km') })
const Fraction = z.object({ kind: z.literal('fraction') })
const Difference = z.object({ kind: z.literal('difference'), ci: z.enum(['pooled', 'welch']) })
const Cell = z.object({
  kind: z.literal('cell'),
  standardize: z.enum(['none', 'row', 'column']).optional(),
})
/** The kinds of ellipse (roadmap 34c; `@ps/stats` `confidenceEllipse`). */
export const EllipseType = z.enum(['norm', 'mean', 't'])
export type EllipseType = z.infer<typeof EllipseType>
/**
 * Roadmap 34c: a group's confidence ellipse — the normal data ellipse (`norm`), the confidence
 * region of its mean (`mean`), or the robust t ellipse (`t`, ggplot2's default) — at a level.
 */
const Ellipse = z.object({
  kind: z.literal('ellipse'),
  type: EllipseType,
  level: z.number().min(0.01).max(0.999),
})
/** Roadmap 34c: a group's convex hull. */
const Hull = z.object({ kind: z.literal('hull') })
/**
 * Roadmap 34e: each group's level name at the group's centre — the median (default) or mean of
 * its points' X and Y — on a graph of variables (clusters labelled on an embedding).
 */
const Centroid = z.object({
  kind: z.literal('centroid'),
  center: z.enum(['median', 'mean']).optional(),
})
const Bin = z.object({
  kind: z.literal('bin'),
  width: z.number().positive().optional(),
  measure: z.enum(['count', 'percent', 'fraction']).optional(),
})
/**
 * Roadmap 34g: the points counted per hexagon (`hexbin::hexbin`): `bins` hexagons across the X
 * axis' range of the points (absent: 30, hexbin's), regular on screen.
 */
const Hexbin = z.object({
  kind: z.literal('hexbin'),
  bins: z.number().int().min(2).max(300).optional(),
})
/** Roadmap 34g: the contour levels of a 2D density: R's pretty levels, or shares of the points. */
export const DensityLevels = z.enum(['pretty', 'shares'])
/**
 * Roadmap 34g: the points' 2D kernel density on a grid (`MASS::kde2d` as ggplot2's
 * `stat_density_2d`: bandwidths `bandwidth.nrd` × `adjust`, an `n` × `n` grid over the points'
 * range, absent 100), and its contour levels — ggplot2's (`pretty` of the density's range, about
 * `bins` levels; absent 10) or the levels enclosing `shares` of the points (absent 50, 75, 90 and
 * 95%; Hyndman 1996).
 */
const Density2d = z.object({
  kind: z.literal('density2d'),
  adjust: z.number().min(0.05).max(20).optional(),
  n: z.number().int().min(10).max(400).optional(),
  levels: DensityLevels.optional(),
  bins: z.number().int().min(2).max(40).optional(),
  shares: z.array(z.number().gt(0).lt(1)).min(1).max(12).optional(),
})
/**
 * Roadmap 34g: a single-cell dot plot's statistics per variable and group (the level of the
 * layer's `aes.group`): the percent of the group's values above `threshold` (absent: 0) and their
 * average — the mean, or Seurat's mean(expm1(x)) shown as log1p of it (`average: 'expm1'`, for
 * log-normalised data) — z-scored across the groups per variable and clipped to ±2.5 unless
 * `scale` is false (Seurat's `DotPlot`).
 */
const DotPlot = z.object({
  kind: z.literal('dotplot'),
  threshold: z.number().optional(),
  average: z.enum(['mean', 'expm1']).optional(),
  scale: z.boolean().optional(),
})

/**
 * Roadmap 46b: each point classed by the graph's cut-offs (`GraphNode.cutoffs`), a volcano plot's
 * significance: up (fold change ≥ the cut-off and significance ≥ its cut-off), down (fold change ≤
 * −the cut-off, significant) or not significant; a point at a cut-off counts as significant.
 * Points missing either value aren't classed (nor drawn). Drawn in its class' colour
 * (`PointsStyle.classes`), counted in the legend.
 */
const Threshold = z.object({ kind: z.literal('threshold') })

/** Roadmap 49c: what a tree is of — the matrix's rows (a heat map's rows) or its columns. */
export const TreeOf = z.enum(['rows', 'columns'])
export type TreeOf = z.infer<typeof TreeOf>
/** Most clusters a tree is cut into (as many as the rows clustered at most). */
export const MAX_CLUSTERS = 2000
/**
 * Roadmap 49c: a tree cut into `k` clusters, or at a height `h` (every merge at or below it kept
 * together), each leaf's cluster as R's `cutree` numbers them (in the order of the rows or columns).
 */
export const ClusterCut = z.union([
  z.object({ k: z.number().int().min(1).max(MAX_CLUSTERS) }),
  z.object({ h: z.number().min(0) }),
])
export type ClusterCut = z.infer<typeof ClusterCut>
/**
 * Roadmap 49c: the tree of a hierarchical clustering (R's `hclust`) of the matrix's rows or
 * columns. Beside a heat map whose tile layer clusters them, the tree is the tile layer's (its
 * distance and linkage order the cells, so the leaves always meet their cells); else (a dendrogram
 * alone, or one added to a heat map not clustering them) the layer's own `distance` and `linkage`
 * (absent: Euclidean, complete), and the cells then follow it. `cut`: into clusters (R's
 * `cutree`), absent: not cut.
 */
const Cluster = z.object({
  kind: z.literal('cluster'),
  of: TreeOf,
  distance: z.enum(['euclidean', 'pearson']).optional(),
  linkage: z.enum(['complete', 'average', 'ward']).optional(),
  cut: ClusterCut.optional(),
})

/**
 * Roadmap 35: values of an analysis' results (`data: { from: 'analysis' }`): labels, reference
 * lines and bands (`ResultStat`, results.ts).
 */
const Result = ResultStat

export const Stat = z.discriminatedUnion('kind', [
  Identity,
  Summary,
  Boxplot,
  Range,
  Density,
  Km,
  Fraction,
  Difference,
  Cell,
  Bin,
  Ellipse,
  Hull,
  Centroid,
  Hexbin,
  Density2d,
  DotPlot,
  Result,
  Threshold,
  Cluster,
])
export type Stat = z.infer<typeof Stat>
export type StatKind = Stat['kind']

/**
 * A data set's own stat within a layer: some parameters, or another kind the geom allows (one
 * data set of a points layer showing every replicate, another its mean).
 */
export const StatParams = z
  .object({
    kind: z.enum(['identity', 'summary', 'boxplot', 'range']),
    center: LineCenter,
    error: ErrorStat,
    by: Summary.shape.by.unwrap(),
    whiskers: Whiskers,
    smoothing: Density.shape.smoothing,
    extent: Density.shape.extent,
    standardize: Cell.shape.standardize.unwrap(),
  })
  .partial()
export type StatParams = z.infer<typeof StatParams>

/** Where marks sit within a slot (category and grouped frames). */
export const Position = z.discriminatedUnion('kind', [
  /** The slot's centre; XY: at X. */
  z.object({ kind: z.literal('identity') }),
  /** Side by side: data sets within a row (grouped), subjects within a group (nested). */
  z.object({ kind: z.literal('dodge'), by: z.enum(['series', 'subject']).optional() }),
  /** Grouped: every data set at the row's centre. */
  z.object({ kind: z.literal('aligned') }),
  /**
   * Bars piled up per row (`percent` of the row's total, `gap` points between segments); XY
   * areas piled up at each X.
   */
  z.object({ kind: z.literal('stack'), percent: z.boolean().optional(), gap: Pt.optional() }),
])
export type Position = z.infer<typeof Position>

/** An analysis output drawn by a layer (was `ExtraSeries`; its style is the layer's). */
export const OutputSeries = ExtraSeries.omit({ style: true })
export type OutputSeries = z.infer<typeof OutputSeries>
/** A plotted function (was `graph.functions`; its style is the layer's). */
export const FunctionDef = FunctionCurve.omit({ style: true })
export type FunctionDef = z.infer<typeof FunctionDef>

/** Where a layer's series come from. */
export const LayerData = z.discriminatedUnion('from', [
  /** The graph's `seriesSource` (the default). */
  z.object({ from: z.literal('table') }),
  z.object({ from: z.literal('outputs'), series: z.array(OutputSeries) }),
  z.object({ from: z.literal('functions'), functions: z.array(FunctionDef) }),
  /** The same series as another layer. */
  z.object({ from: z.literal('layer'), layer: LayerId }),
  /**
   * Roadmap 35: an analysis' results (stat `result`): labels, reference lines and bands at its
   * values, live.
   */
  z.object({ from: z.literal('analysis'), analysis: NodeId }),
  /**
   * Roadmap 36: values typed in (stat `result` with fields of `{ from: 'number' }`): lines at a
   * value and bands between two drawn by hand, with an optional label.
   */
  z.object({ from: z.literal('values') }),
])
export type LayerData = z.infer<typeof LayerData>

/**
 * Whether a layer draws values of results (roadmap 35) or typed in (roadmap 36): labels, lines
 * and bands of the `result` stat.
 */
export const isValueSourced = (l: Pick<Layer, 'data'>): boolean =>
  l.data?.from === 'analysis' || l.data?.from === 'values'

/**
 * Multiple-variables tables only: variables mapped to aesthetics of an XY graph's points (and
 * lines by group): position, size (a number variable), colour (a number or text variable), shape
 * (a text variable; roadmap 34b) and labels (any variable, the points' automatic labels; 34b).
 */
export const Aes = z
  .object({
    x: DataSetKey,
    y: DataSetKey,
    size: DataSetKey,
    color: DataSetKey,
    shape: DataSetKey,
    group: DataSetKey,
    label: DataSetKey,
    /** Roadmap 34c: a vector (segment) layer's ends: number variables. */
    xend: DataSetKey,
    yend: DataSetKey,
  })
  .partial()
export type Aes = z.infer<typeof Aes>

/**
 * What a graph of a text × text mapping shows of each combination of levels: its count, its
 * percent of the X level's rows, or its percent of every row counted.
 */
export const LevelMeasure = z.enum(['count', 'percentOfX', 'percentOfTotal'])
export type LevelMeasure = z.infer<typeof LevelMeasure>

/**
 * Multiple-variables tables (roadmap 34a): the variables on a category or grouped graph's axes,
 * straight from the table. A text variable's levels are the categories (along X, or down the left
 * when it is the Y variable), the number variable the values; a text variable mapped to colour
 * splits each category into groups (the grouped frame). Two text variables: the rows counted for
 * each combination (bars, or a heat map). Number × number graphs map variables with `aes` on their
 * points instead (the XY frame).
 */
export const VariableMapping = z.object({
  x: DataSetKey,
  y: DataSetKey,
  /**
   * A text variable: groups within each category (the grouped frame); a number variable (roadmap
   * 34b): each row's marks (points) coloured on a continuous colour map.
   */
  color: DataSetKey.optional(),
  /** Text × text: what is counted (absent = counts). */
  measure: LevelMeasure.optional(),
  /** Roadmap 34b: a text variable whose levels give each row's point its symbol. */
  shape: DataSetKey.optional(),
  /** Roadmap 34b: a number variable sizing each row's point (`scales.size`). */
  size: DataSetKey.optional(),
  /** Roadmap 34b: any variable whose value labels each row's point (automatic point labels). */
  label: DataSetKey.optional(),
})
export type VariableMapping = z.infer<typeof VariableMapping>

// --- Per-geom styles (sparse): the v1 `SeriesStyle` sections, moved --------------------------

/**
 * Roadmap 49a: a symbol's shape, fixed or the data set's (`{ series: true }`: the graph's shapes
 * in turn, `GraphStyle.shapes`), as a colour is fixed or the data set's.
 */
export const ShapeRef = z.union([SymbolShape, BySeries])
export type ShapeRef = z.infer<typeof ShapeRef>

/** How a nested group's subjects are told apart. */
const SubjectMark = z.enum(['shape', 'shade', 'none'])

export const PointsStyle = z
  .object({
    shape: ShapeRef,
    size: Pt,
    fill: FillStyle,
    border: StrokeStyle,
    /** Swarm within this half-width ('auto': the slot's), or none (was `jitter`). */
    spread: z.union([z.literal('auto'), z.literal('none'), z.number().min(0)]),
    excludedStyle: z.enum(['hide', 'hollow']),
    subjects: SubjectMark,
    /**
     * Roadmap 34e: on screen, the points drawn into an image when there are many ('auto', the
     * default: more than 20,000 in the layer), always ('image') or never ('vector'). Exports draw
     * them as vectors unless asked for points as an image.
     */
    render: z.enum(['auto', 'vector', 'image']),
    /**
     * Roadmap 34e: the order points are drawn in: the table's (default; sized points largest
     * first), by the value of the colour (else size) variable, highest on top, or shuffled with a
     * fixed seed.
     */
    order: z.enum(['table', 'value', 'random']),
    /**
     * Roadmap 34g: a graph of variables' mapped points coloured by their local density (the
     * points' 2D density, `MASS::kde2d` on a 100 × 100 grid as ggplot2's, interpolated at each
     * point) on the colour scale, in place of a colour variable ('variable', absent).
     */
    colorBy: z.enum(['variable', 'density']),
    /** Roadmap 34g: the bandwidths' multiplier of the density colouring points (absent: 1). */
    adjust: z.number().min(0.05).max(20),
    /**
     * Roadmap 46b: a Significance layer's (stat `threshold`) colour per class (absent: the
     * theme's red, blue and grey).
     */
    classes: z.object({ up: ColorRef, down: ColorRef, ns: ColorRef }).partial(),
  })
  .partial()
export const BarStyle = z
  .object({
    fill: FillStyle,
    border: StrokeStyle,
    width: z.number().min(0).max(1),
    binWidth: z.number().positive(),
    baseline: z.number(),
  })
  .partial()
/** Roadmap 49a: the bars' line may be dashed by data set (`SeriesStroke`). */
export const ErrorBarStyle = ErrorSpec.omit({ stat: true }).extend({ line: SeriesStroke }).partial()
export const CenterStyle = z
  .object({ line: SeriesStroke, width: z.number().min(0).max(1), subjects: SubjectMark })
  .partial()
/** Boxes and floating bars: the box, its width, whisker caps, centre line and outliers. */
export const BoxStyle = z
  .object({
    fill: FillStyle,
    border: StrokeStyle,
    width: z.number().min(0).max(1),
    capWidth: Pt,
    centerLine: StrokeStyle,
    outlierShape: ShapeRef,
    outlierSize: Pt,
    outlierFill: FillStyle,
    outlierBorder: StrokeStyle,
  })
  .partial()
export const ViolinStyle = z
  .object({
    fill: FillStyle,
    border: StrokeStyle,
    width: z.number().min(0).max(1),
    quartiles: z.boolean(),
    quartileLine: StrokeStyle,
    centerLine: StrokeStyle,
  })
  .partial()
/**
 * Lines and staircases; `fade` (lines through each replicate) towards white. Roadmap 49a: the
 * stroke's pattern may be the data set's (`SeriesStroke`).
 */
export const LineStyle = z
  .object({ stroke: SeriesStroke, gaps: z.boolean(), fade: z.number().min(0).max(0.95) })
  .partial()
export const CensorStyle = z.object({ size: Pt, border: StrokeStyle }).partial()
export const AreaStyle = z
  .object({ opacity: z.number().min(0).max(1), baseline: z.number(), gaps: z.boolean() })
  .partial()
export const BandStyle = z
  .object({
    opacity: z.number().min(0).max(1),
    gaps: z.boolean(),
    /** Roadmap 35: a band of result values' fill colour (absent: its data set's, else grey). */
    color: ColorRef,
  })
  .partial()
export const ConnectorStyle = z.object({ line: StrokeStyle }).partial()
export const ReflineStyle = z.object({ line: StrokeStyle }).partial()
/** Estimation plots: the difference symbol, its CI bar and the guides to the difference axis. */
export const DifferenceStyle = z
  .object({
    guides: z.boolean(),
    line: StrokeStyle,
    capWidth: Pt,
    shape: ShapeRef,
    size: Pt,
    fill: FillStyle,
    border: StrokeStyle,
  })
  .partial()
/**
 * Heat-map tiles: the missing cells' colour, lines between the cells, and the clustering that
 * orders the rows and columns (roadmap 30). Roadmap 49c (schema v3): the trees are layers of
 * their own (`dendrogram`); the tile keeps what orders its cells — which axes are clustered, the
 * distance and the linkage (v2's `cluster.dendrogram` depth moved to the trees' `depth`).
 */
export const TileStyle = z
  .object({
    missing: RGB,
    border: StrokeStyle,
    cluster: HeatmapStyle.pick({
      distance: true,
      linkage: true,
    }).extend({ rows: z.boolean().optional(), columns: z.boolean().optional() }),
  })
  .partial()
export const WedgeStyle = z.object({ fill: FillStyle, border: StrokeStyle }).partial()
/**
 * Text at marks: bar labels (`value`: the number shown; `percent`: the bar's share of its row's
 * total, as stacked bars show it), slice labels (`content`, `digits`) and cell values.
 */
export const LabelStyle = z
  .object({
    value: z.enum([...BarLabel.shape.stat.unwrap().options, 'percent']),
    position: z.enum(['above', 'inside', 'outside']),
    format: NumberDisplay,
    text: TextStyle.partial(),
    content: z.enum(['percent', 'value', 'category', 'categoryPercent', 'valuePercent']),
    digits: z.number().int().min(0).max(6),
    /** Roadmap 34e: behind each label, nothing, a white halo round the letters, or a box. */
    background: z.enum(['none', 'halo', 'box']),
  })
  .partial()
/**
 * Roadmap 34c: ellipses and hulls — what is drawn (absent: both), the fill (its opacity the fill
 * alpha) and the outline.
 */
export const PolygonStyle = z
  .object({
    draw: z.enum(['outline', 'fill', 'both']),
    fill: FillStyle,
    border: StrokeStyle,
  })
  .partial()
/**
 * Roadmap 34c: paths (rows joined in table order) — the line, arrowheads (none, at the end of
 * each path, or at every step along it) and the head's shape and size.
 */
export const PathStyle = z
  .object({ stroke: StrokeStyle, arrow: z.enum(['none', 'end', 'along']), head: ArrowHead })
  .partial()
/** Roadmap 34c: vectors — the line, heads (at the end, both ends or none), the head. */
export const SegmentStyle = z
  .object({ stroke: StrokeStyle, arrow: z.enum(['none', 'end', 'both']), head: ArrowHead })
  .partial()

/**
 * Roadmap 34g: the colours of a density layer's values (hexagons' counts, density bands and
 * images): a colour map or two colours (absent: viridis), reversed, on a log scale (hexagons'
 * counts), and a colour bar in the legend (absent: shown).
 */
const DensityColors = {
  colors: z.union([ColorMapName, z.tuple([RGB, RGB])]),
  reverse: z.boolean(),
  log: z.boolean(),
  bar: z.boolean(),
}
/** Roadmap 34g: hexagons — their colours by count, outline and opacity. */
export const HexStyle = z
  .object({ ...DensityColors, border: StrokeStyle, opacity: z.number().min(0).max(1) })
  .partial()
/**
 * Roadmap 34g: density contours — lines, filled bands or both (absent: lines), the lines' stroke
 * (absent: the group's colour), the bands' colours by level (absent: viridis; by group: the
 * group's colour at `opacity` per level) and opacity.
 */
export const ContourStyle = z
  .object({
    ...DensityColors,
    draw: z.enum(['lines', 'bands', 'both']),
    stroke: StrokeStyle,
    opacity: z.number().min(0).max(1),
  })
  .partial()
/** Roadmap 34g: a density image — its colours and opacity. */
export const RasterStyle = z
  .object({ ...DensityColors, opacity: z.number().min(0).max(1) })
  .partial()

/**
 * Roadmap 49c: a tree's size, place and lines. Beside a heat map: its `depth` (a row tree's width,
 * a column tree's height, pt; absent 36), the `gap` to the map (absent 6) and its `side` (a row
 * tree right (absent) or left of the map, a column tree above (absent) or below it). Alone (no
 * tiles) the tree fills the plot: `side` 'top' (absent) stands it over its leaves along the bottom,
 * 'right' beside its leaves down the left. Branch heights are R's merge heights (absent) or equal
 * steps (each merge one step above its higher branch). A cut tree's branches below the cut take
 * their cluster's colour (`colorBranches`, absent true; `clusterColors` by cluster number, absent
 * the graph's palette in turn), and a `strip` (`stripWidth` pt, absent 8) shows each leaf's
 * cluster between the tree and the map.
 */
export const DendrogramStyle = z
  .object({
    depth: z.number().min(4).max(400),
    gap: z.number().min(0).max(100),
    side: z.enum(['left', 'right', 'top', 'bottom']),
    heights: z.enum(['merge', 'steps']),
    line: StrokeStyle,
    colorBranches: z.boolean(),
    strip: z.boolean(),
    stripWidth: z.number().min(1).max(50),
    /** Cluster number ('1', '2'…) → its colour. */
    clusterColors: z.record(z.string().regex(/^[1-9][0-9]{0,3}$/), ColorRef),
  })
  .partial()
export type DendrogramStyle = z.infer<typeof DendrogramStyle>

/** Per data set (or output, or function) within one layer. */
const LayerSeries = <S extends z.ZodTypeAny>(style: S) =>
  z
    .object({
      /** Sparse, over the layer's style. */
      style,
      stat: StatParams,
      /** Leave this data set out of this layer (false: drawn although the layer hides them). */
      hide: z.boolean(),
    })
    .partial()

const LayerBase = {
  id: LayerId,
  /** Shown in the Layers list; absent = generated ("Bars (mean)"). */
  name: z.string().max(80).optional(),
  /** false: kept (with its formats) but not drawn. */
  visible: z.boolean().optional(),
  /** Absent = the graph's table. */
  data: LayerData.optional(),
  /** Attached to a host layer (error bars, labels, centre lines): its position, centre, top. */
  on: LayerId.optional(),
  /** Multiple-variables tables only. */
  aes: Aes.optional(),
  /** Data sets are drawn only where `series[k].hide` is false. */
  seriesHidden: z.boolean().optional(),
  legend: z.enum(['auto', 'hide']).optional(),
  position: Position.optional(),
}

const layer = <G extends Geom, St extends z.ZodTypeAny, S extends z.ZodTypeAny>(
  geom: G,
  stat: St,
  style: S,
) =>
  z.object({
    ...LayerBase,
    geom: z.literal(geom),
    stat,
    style: style.optional(),
    series: z.record(SeriesKey, LayerSeries(style)).optional(),
  })

export const Layer = z.discriminatedUnion('geom', [
  layer('points', z.union([Identity, Summary, DotPlot, Threshold]), PointsStyle),
  layer('bar', z.union([Summary, Identity, Fraction, Bin]), BarStyle),
  layer('errorbar', Summary, ErrorBarStyle),
  layer('center', Summary, CenterStyle),
  layer('box', z.union([Boxplot, Range]), BoxStyle),
  layer('violin', Density, ViolinStyle),
  layer('line', z.union([Summary, Identity]), LineStyle),
  layer('step', z.union([Km, Summary]), LineStyle),
  layer('censor', Km, CensorStyle),
  layer('area', Summary, AreaStyle),
  layer('band', z.union([Summary, Identity, Km, Result]), BandStyle),
  layer('connector', Identity, ConnectorStyle),
  layer('refline', z.union([Summary, Result]), ReflineStyle),
  layer('difference', Difference, DifferenceStyle),
  layer('tile', z.union([Cell, Identity, DotPlot]), TileStyle),
  layer('wedge', Fraction, WedgeStyle),
  layer('label', z.union([Summary, Identity, Fraction, Cell, Centroid, Result]), LabelStyle),
  layer('polygon', z.union([Ellipse, Hull]), PolygonStyle),
  layer('path', Identity, PathStyle),
  layer('segment', Identity, SegmentStyle),
  layer('hex', Hexbin, HexStyle),
  layer('contour', Density2d, ContourStyle),
  layer('raster', Density2d, RasterStyle),
  layer('dendrogram', Cluster, DendrogramStyle),
])
export type Layer = z.infer<typeof Layer>
export type LayerOf<G extends Geom> = Extract<Layer, { geom: G }>
/** Any geom's sparse style. */
export type LayerStyle = Record<string, unknown>

/** The look of a graph naming none: its frame's usual one (the theme's defaults family). */
export const FRAME_LOOK: Readonly<Record<Frame, GraphLook>> = {
  category: 'column.scatter',
  grouped: 'grouped.scatter',
  xy: 'xy.scatter',
  polar: 'whole.pie',
  matrix: 'heatmap.cells',
}

/** A graph's look: its own, else its frame's. */
export const lookOf = (graph: Pick<GraphNode, 'frame' | 'look'>): GraphLook =>
  graph.look ?? FRAME_LOOK[graph.frame]

/** Most layers a graph can have. */
export const MAX_LAYERS = 32
/** Most levels a graph keeps the order of, per text variable. */
export const MAX_LEVELS = 10_000

/** A data set's identity, shared by all layers: colour, Y axis, point labels, drawing order. */
export const SeriesIdentity = z
  .object({
    color: ColorRef,
    yAxis: z.enum(['left', 'right']),
    pointLabels: PointLabels,
    /** Front to back: this data set's layers in the `series` plane; others follow the list. */
    order: z.array(LayerId).max(MAX_LAYERS),
  })
  .partial()
export type SeriesIdentity = z.infer<typeof SeriesIdentity>

/**
 * The heat map's colour scale, and a number variable's mapped to colour (bubble plots; any graph
 * of variables' points, roadmap 34b): a colour map or two colours, the value range (absent: the
 * data's), the colours of values outside it and of rows without a value, and the colour bar.
 */
export const ColorScale = z
  .object({
    colors: z.union([ColorMapName, z.tuple([RGB, RGB])]),
    reverse: z.boolean(),
    min: z.number(),
    max: z.number(),
    midpoint: z.number(),
    bar: z
      .object({
        /**
         * Heat maps: absent = shown. Colour by a number variable (roadmap 34b): true = a colour bar
         * in the legend, absent = a few colour swatches (the bubble plot's legend before 34b).
         */
        show: z.boolean(),
        position: z.enum(['right', 'bottom']),
        title: z.string(),
        /** About this many ticks along the bar (absent: as many as fit). */
        ticks: z.number().int().min(2).max(12),
        /** Number format of the bar's tick labels. */
        format: NumberDisplay,
      })
      .partial(),
    /** Roadmap 34b: the colour of values outside a fixed range (absent: the nearer end's). */
    outOfRange: RGB,
    /** Roadmap 34b: the colour of rows without a value of the colour variable. */
    missing: RGB,
    /**
     * Roadmap 34g: a number variable's colours along a transformed scale (log, arcsinh or
     * logicle, with the parameters below; absent: linear), its colour bar ticked as such an axis.
     */
    transform: z.enum(['linear', 'log10', 'arcsinh', 'logicle']),
    arcsinh: ArcsinhParams,
    logicle: LogicleParams,
  })
  .partial()
export type ColorScale = z.infer<typeof ColorScale>
/**
 * Bubble plots' and mapped points' sizes (diameters, pt): from `min` to `max` over the size
 * variable's range (absent: the data's; roadmap 34b `low` / `high`), by area (the default: area
 * proportional to the value) or by radius (diameter linear in the value), values outside a fixed
 * range clamped to the ends' sizes or extended past them.
 */
export const SizeScale = z
  .object({
    max: Pt,
    min: Pt,
    by: z.enum(['area', 'radius']),
    low: z.number(),
    high: z.number(),
    outside: z.enum(['clamp', 'extend']),
  })
  .partial()
export type SizeScale = z.infer<typeof SizeScale>
/**
 * Roadmap 34b: symbols of a text variable's levels mapped to shape: by level key (`levelKey`),
 * else the shape sequence (the points' own symbol first, then the others in turn).
 */
export const ShapeScale = z.object({ levels: z.record(SeriesKey, SymbolShape) }).partial()
export type ShapeScale = z.infer<typeof ShapeScale>

/**
 * Graph-wide style: what doesn't belong to a layer. v1's graph-wide chart options moved into
 * layers (arrangement, stacks, nested subjects, estimation, grand mean), aesthetics and scales
 * (bubbles, heat maps) and `polar` (pies).
 */
export const GraphStyle = z.object({
  /** Every data set's identity defaults (colour, Y axis, point labels). */
  seriesDefaults: SeriesIdentity.omit({ order: true }).optional(),
  /** Base text style for everything (font family, size, colour); elements refine it. */
  text: TextStyle.partial().optional(),
  palette: z.array(RGB).optional(),
  /**
   * Roadmap 49a: the symbols data sets take in turn where a layer's shape is the data set's
   * (`{ series: true }`), as their colours take the palette's (absent: the style's, else circle,
   * square, triangle, diamond, cross, plus).
   */
  shapes: z.array(SymbolShape).min(1).max(24).optional(),
  /**
   * Roadmap 49a: the line patterns data sets take in turn where a layer's dash is the data set's
   * (absent: the style's, else solid, dashed, dotted).
   */
  dashes: z.array(Dash).min(1).max(12).optional(),
  /**
   * 'axes' (default): the X and Y axes; 'box': a full frame round the plot; 'none': no axis
   * lines; 'arrows' (roadmap 36): short arrows from a corner with the axis titles beside them, no
   * ticks or frame (UMAP plots).
   */
  frame: z.enum(['axes', 'box', 'none', 'arrows']).optional(),
  /** Roadmap 36: the corner arrows' length, corner and line (`frame` 'arrows'). */
  arrows: CornerArrows.optional(),
  /** Background of the whole graph (exports too); absent = white. */
  background: FillStyle.optional(),
  /** Fill of the plot area only. */
  plotBackground: FillStyle.optional(),
  bracket: BracketStyle.optional(),
  /** Category and grouped frames: gap = categoryGap × a group's width (the usual convention). */
  categoryGap: z.number().min(0).max(0.9).optional(),
  /**
   * Category and grouped frames: categories along the bottom ('vertical', default) or down the
   * left with the values across ('horizontal'); `axes.x` stays the category axis.
   */
  orientation: z.enum(['vertical', 'horizontal']).optional(),
  /** Pies and donuts: hole (fraction of the radius), first slice's angle, direction. */
  polar: z
    .object({
      hole: z.number().min(0).max(0.95),
      startAngle: z.number().min(-360).max(360),
      clockwise: z.boolean(),
    })
    .partial()
    .optional(),
})
export type GraphStyle = z.infer<typeof GraphStyle>

/**
 * Draw order where marks overlap: 'layer' (every data set's marks of a layer together, layers in
 * list order; the default) or 'series' (each data set's layers together, data sets in order: v1).
 */
/** What a set of split graphs is one graph per (roadmap 34d). */
export const SplitBy = z.enum(['level', 'dataSet', 'row'])
export type SplitBy = z.infer<typeof SplitBy>

/**
 * Roadmap 35: the number at risk under a survival graph's X axis: per group at each X tick (or at
 * `times`), the group's name in its colour before its row, a heading above.
 */
export const RiskTable = z.object({
  show: z.boolean(),
  /** The times counted at (absent: the X axis' major ticks). */
  times: z.array(z.number().min(0)).max(50).optional(),
  /** The heading (absent: "Number at risk"; '' none). */
  title: z.string().max(200).optional(),
  /** The groups' names before their rows (absent: shown). */
  names: z.boolean().optional(),
  /** Font, size, colour… (absent: the graph's tick labels'). */
  text: TextStyle.partial().optional(),
})
export type RiskTable = z.infer<typeof RiskTable>

/**
 * Roadmap 46b: a graph's shared cut-offs (a volcano plot's thresholds): the fold change's (|fold
 * change| ≥ `fold`) and the significance's — entered as a P value (`{ p }`: on an axis of −log10 P
 * the line stands at −log10 p) or as the axis' value (`{ value }`) — on the axes `foldAxis` names
 * (absent: fold change along X, significance up Y). The significance axis holds −log10 P (absent)
 * or P values themselves (`values: 'p'`: significant when P ≤ the cut-off). The Significance layer
 * classes points by them and the lines at them read them (`ResultRef` `cutoff`), so editing them
 * moves both in one step.
 */
export const Cutoffs = z.object({
  fold: z.number().min(0),
  sig: z.union([z.object({ p: z.number().gt(0).max(1) }), z.object({ value: z.number() })]),
  foldAxis: z.enum(['x', 'y']).optional(),
  values: z.enum(['negLog10', 'p']).optional(),
})
export type Cutoffs = z.infer<typeof Cutoffs>

/** A split graph's set (roadmap 34d, `GraphNode.split`). */
export const SplitSpec = z.object({
  /** The set's id, shared by its graphs (and the page grid placing them, `LayoutNode.grids`). */
  set: z.string().min(1),
  by: SplitBy,
  /** By level: the text variable whose levels the set's graphs show. */
  variable: DataSetKey.optional(),
})
export type SplitSpec = z.infer<typeof SplitSpec>

/** How a graph orders the levels it keeps no order of (roadmap 34f, `GraphNode.levelOrder`). */
export const LevelOrder = z.enum(['appearance', 'natural'])
export type LevelOrder = z.infer<typeof LevelOrder>

export const DrawOrder = z.enum(['layer', 'series'])
export type DrawOrder = z.infer<typeof DrawOrder>

/**
 * A graph node (schema v2, roadmap 33b): a frame plus layers drawn back to front, the identity of
 * each data set, single-point formats, axes, annotations and graph-wide style.
 */
export const GraphNode = z.object({
  ...graphCommon,
  frame: Frame,
  /** Back to front. */
  layers: z.array(Layer).max(MAX_LAYERS),
  /** Theme defaults family (the v1 graph type's literals); absent = the frame's default look. */
  look: GraphLook.optional(),
  /** Provenance: the preset that built the layers. */
  preset: z.string().optional(),
  /** Absent = 'layer'. Graphs migrated from v1 draw by data set ('series'), as v1 did. */
  drawOrder: DrawOrder.optional(),
  /** Each data set's (output's, function's) identity, shared by every layer drawing it. */
  seriesOverrides: z.record(SeriesKey, SeriesIdentity),
  style: GraphStyle,
  scales: z.object({ color: ColorScale, size: SizeScale, shape: ShapeScale }).partial().optional(),
  /**
   * Multiple-variables tables: the variables on a category or grouped graph's axes (34a), and
   * those mapped to colour, shape, size and labels of its points (34b).
   */
  mapping: VariableMapping.optional(),
  /**
   * The order of a text variable's levels on this graph (categories, colour groups, legend), by
   * variable; levels not listed follow in the order they first appear in the table (roadmap 34a).
   */
  levels: z.record(DataSetKey, z.array(z.string()).max(MAX_LEVELS)).optional(),
  /**
   * Roadmap 34f: the order of the levels `levels` doesn't list — 'appearance' (absent: the order
   * they first appear in the table's rows shown, as every graph made before) or 'natural' (sorted
   * as people read them: "C2" before "C10", case ignored; `naturalCompare`). Graphs made from the
   * builder from 34f on are natural.
   */
  levelOrder: LevelOrder.optional(),
  /**
   * Roadmap 34d: a member of a set of graphs split from one graph, one per level of a text
   * variable (`seriesSource.filter`), per data set (`include`) or per row (`rows`). Graphs of a set
   * share its id; a new level, data set or row in the table gets its graph (decision 382).
   */
  split: SplitSpec.optional(),
  /**
   * Roadmap 35: survival graphs (layers of the `km` stat): a table of the number at risk under
   * the X axis, one row per group. Absent: none (graphs made before 35).
   */
  riskTable: RiskTable.optional(),
  /**
   * Roadmap 46b: the cut-offs a Significance layer and the volcano thresholds' lines share
   * (absent: |fold change| ≥ 1 and P ≤ 0.05).
   */
  cutoffs: Cutoffs.optional(),
  /**
   * Roadmap 37: the graph's own style, over the project's (absent: the project's). What the
   * graph sets itself still wins over both (decision 531).
   */
  theme: StyleChoice.optional(),
})
export type GraphNode = z.infer<typeof GraphNode>

/** Problems with a graph's layers: repeated ids, and references to layers it doesn't have. */
export function layerIssues(
  graph: Pick<GraphNode, 'layers'>,
): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = []
  const ids = new Set<string>()
  graph.layers.forEach((l, i) => {
    if (ids.has(l.id)) out.push({ path: ['layers', i, 'id'], message: `layer id ${l.id} repeated` })
    ids.add(l.id)
  })
  graph.layers.forEach((l, i) => {
    if (l.on !== undefined && (l.on === l.id || !ids.has(l.on)))
      out.push({ path: ['layers', i, 'on'], message: `no host layer ${l.on}` })
    if (l.data?.from === 'layer' && (l.data.layer === l.id || !ids.has(l.data.layer)))
      out.push({ path: ['layers', i, 'data', 'layer'], message: `no layer ${l.data.layer}` })
  })
  return out
}

// --- Theme sections ------------------------------------------------------------------------

/** A v1 `SeriesStyle` section: the theme keeps each look's defaults by section (until roadmap 37). */
export type StyleSection = Exclude<
  keyof SeriesStyle,
  'color' | 'pointLabels' | 'yAxis' | 'markOrder'
>

const fields = (section: StyleSection, names: readonly string[]) =>
  Object.fromEntries(names.map((n) => [n, [section, n] as const]))
const POINT_FIELDS = { ...fields('points', ['shape', 'size', 'fill', 'border']) }

/**
 * Where each style field of a layer has its theme default: the v1 section and field. The same
 * table moves v1 styles into layers (`compileV1`), so a migrated layer resolves to v1's values.
 * Fields absent here (e.g. `subjects`, `guides`, the tile's) have defaults of their own.
 */
export function styleSections(
  layer: Pick<Layer, 'geom' | 'stat' | 'data'>,
): Readonly<Record<string, readonly [StyleSection, string]>> {
  const table = !layer.data || layer.data.from === 'table'
  const key = `${layer.geom}:${layer.stat.kind}:${table}`
  let out = sectionsCache.get(key)
  if (!out) {
    out = sectionsOf(layer.geom, layer.stat.kind, table)
    sectionsCache.set(key, out)
  }
  return out
}

const sectionsCache = new Map<string, Readonly<Record<string, readonly [StyleSection, string]>>>()

function sectionsOf(
  geom: Geom,
  stat: StatKind,
  table: boolean,
): Readonly<Record<string, readonly [StyleSection, string]>> {
  const layer = { geom, stat: { kind: stat } }
  switch (geom) {
    case 'points':
      return {
        ...POINT_FIELDS,
        spread: ['points', 'jitter'],
        excludedStyle: ['points', 'excludedStyle'],
      }
    case 'bar':
      return fields('bar', ['fill', 'border', 'width', 'binWidth', 'baseline'])
    case 'errorbar':
      return fields('error', ['direction', 'capWidth', 'line', 'x'])
    case 'center':
      return fields('center', ['line', 'width'])
    case 'box':
      return {
        ...fields('box', ['fill', 'border']),
        width: ['bar', 'width'],
        capWidth: ['error', 'capWidth'],
        centerLine: ['center', 'line'],
        outlierShape: ['points', 'shape'],
        outlierSize: ['points', 'size'],
        outlierFill: ['points', 'fill'],
        outlierBorder: ['points', 'border'],
      }
    case 'violin':
      return {
        ...fields('box', ['fill', 'border']),
        width: ['bar', 'width'],
        ...fields('violin', ['quartiles', 'quartileLine']),
        centerLine: ['center', 'line'],
      }
    case 'line':
      // A line through each replicate of the table's data sets ("spaghetti").
      if (table && layer.stat.kind === 'identity')
        return { ...fields('spaghetti', ['stroke', 'fade']), gaps: ['line', 'gaps'] }
      return fields('line', ['stroke', 'gaps'])
    case 'step':
      return fields('line', ['stroke'])
    case 'censor':
      return fields('points', ['size', 'border'])
    case 'area':
      return { ...fields('area', ['opacity', 'baseline']), gaps: ['line', 'gaps'] }
    case 'band':
      // An error envelope along the table's line, else a confidence band.
      if (table && layer.stat.kind === 'summary')
        return { opacity: ['envelope', 'opacity'], gaps: ['line', 'gaps'] }
      return fields('band', ['opacity'])
    case 'connector':
      return { line: ['error', 'line'] }
    case 'difference':
      return { ...POINT_FIELDS, line: ['error', 'line'], capWidth: ['error', 'capWidth'] }
    case 'wedge':
      return fields('bar', ['fill', 'border'])
    case 'label':
      return layer.stat.kind === 'summary'
        ? { value: ['label', 'stat'], ...fields('label', ['position', 'format', 'text']) }
        : {}
    default:
      return {}
  }
}

/** A layer's data sets as drawn: hidden ones left out. */
export const seriesShown = (layer: Pick<Layer, 'seriesHidden' | 'series'>, key: string): boolean =>
  !(layer.series?.[key]?.hide ?? layer.seriesHidden ?? false)

/** A data set's stat in a layer: the layer's, with the data set's own parameters (or kind). */
export const statOf = (layer: Pick<Layer, 'stat' | 'series'>, key: string): Stat => {
  const own = layer.series?.[key]?.stat
  return (own ? { ...layer.stat, ...own } : layer.stat) as Stat
}
