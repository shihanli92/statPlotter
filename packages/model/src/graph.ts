import { z } from 'zod'
import {
  BreakMark,
  CategorySpans,
  PieceLength,
  ScaleBar,
  TickText,
  TickValues,
  TreatmentGrid,
} from './axisExtras.ts'
import { AnnotationId, DataSetKey, DataSetRef, NodeId, SeriesId } from './ids.ts'
import { ItemRange } from './other.ts'
import {
  ColorRef,
  FillStyle,
  LineEnds,
  NumberDisplay,
  Offset,
  Pt,
  RGB,
  RichLabel,
  RichText,
  StrokeStyle,
  TextSpec,
  TextStyle,
} from './style.ts'

export const GraphType = z.enum([
  'column.scatter',
  'column.bar',
  'column.box',
  'column.beforeAfter',
  'xy.scatter',
  'grouped.bar',
  'grouped.scatter',
  'grouped.box',
  'survival.step',
  /** Two or more groups beside the differences from the first, on a floating right axis. */
  'column.estimation',
  /** Multiple-variables tables: one bubble per row (X, Y, size and colour variables). */
  'bubble.scatter',
  /** Parts-of-whole tables: a pie, a donut, or 100% stacked bars per data set. */
  'whole.pie',
  'whole.donut',
  'whole.bar',
  /**
   * Heat maps (roadmap 30): grouped tables (rows × data sets, the mean of each cell) and
   * multiple-variables tables (rows × numeric variables), one coloured cell per value.
   */
  'heatmap.cells',
])
export type GraphType = z.infer<typeof GraphType>

/** Table rows (not positions in a row slice), kept in step with row inserts and deletes. */
export const RowIndices = z.array(z.number().int().min(0))

/** Tick-label angle. */
const Rotation = z.union([z.literal(0), z.literal(45), z.literal(90)])

/** Drawn behind the data (default: in front). */
const behind = { behind: z.boolean().optional() }

export const SymbolShape = z.enum(['circle', 'square', 'triangle', 'diamond', 'cross', 'plus'])
export type SymbolShape = z.infer<typeof SymbolShape>

export const ErrorSpec = z.object({
  /**
   * MAD: median absolute deviation; MADn: MAD × 1.4826 (≈ SD for normal data); geoSD: the
   * geometric mean ×/÷ the geometric SD factor; geoCI: the CI of the geometric mean (roadmap 30;
   * both drawn around the geometric mean, and only for positive values).
   */
  stat: z.enum(['SD', 'SEM', 'CI', 'range', 'IQR', 'MAD', 'MADn', 'geoSD', 'geoCI', 'none']),
  direction: z.enum(['both', 'above', 'below']),
  capWidth: Pt,
  line: StrokeStyle,
  /** XY graphs: error bars along X from the table's X errors (absent = shown when there are). */
  x: z.boolean().optional(),
})
export type ErrorSpec = z.infer<typeof ErrorSpec>

/**
 * The kinds of mark a data set draws, for its drawing order: the centre line (or mean symbol of
 * a grouped dot plot), error bars, points, bars or boxes, and the connecting line.
 */
export const MarkLayer = z.enum(['center', 'error', 'points', 'bar', 'line'])
export type MarkLayer = z.infer<typeof MarkLayer>

/** Labels on bars (and columns of points or boxes): sparse. */
export const BarLabel = z
  .object({
    show: z.boolean(),
    /** 'value': the bar height (the centre drawn). */
    stat: z.enum(['value', 'mean', 'median', 'n', 'sd', 'sem']),
    /** Above the bar and its error bar, or inside the top of the bar. */
    position: z.enum(['above', 'inside']),
    format: NumberDisplay,
    text: TextStyle.partial(),
  })
  .partial()
export type BarLabel = z.infer<typeof BarLabel>

/** A condition on a point's value for labelling it (e.g. a volcano plot's cut-offs). */
export const LabelThreshold = z.object({
  value: z.enum(['x', 'y']),
  /** 'abs': |value| ≥ limit (e.g. |log2 fold change| ≥ 1); 'above': ≥ limit; 'below': ≤ limit. */
  test: z.enum(['abs', 'above', 'below']),
  limit: z.number(),
})
export type LabelThreshold = z.infer<typeof LabelThreshold>

/**
 * Automatic labels beside a data set's points (roadmap 22): the row title (e.g. gene names), or
 * the X or Y value. A point's own `PointStyle.label` wins over the automatic text, and a hidden
 * point has no label.
 */
export const PointLabels = z.object({
  /**
   * What each label says; 'none' turns automatic labels off. 'variable' (roadmap 34b): the
   * point's row's value of the graph's label variable (`mapping.label`, or `aes.label` of its
   * mapped points).
   */
  source: z.enum(['none', 'rowTitle', 'x', 'y', 'variable']),
  /** Which points: every point, those meeting `thresholds`, or the table rows in `rows`. */
  which: z.enum(['all', 'threshold', 'rows']),
  thresholds: z.array(LabelThreshold).max(4).optional(),
  /** 'and' (default): every threshold holds (a volcano plot's corners); 'or': any. */
  combine: z.enum(['and', 'or']).optional(),
  rows: RowIndices.optional(),
  /** Number format of X / Y labels. */
  format: NumberDisplay.optional(),
  text: TextStyle.partial().optional(),
  /** Move labels apart so they overlap neither each other nor the points (default on). */
  repel: z.boolean().optional(),
  /**
   * Line from a label placed away from its point back to it; absent = a thin line in the label's
   * colour, `width` 0 = none.
   */
  leader: StrokeStyle.partial().optional(),
  /** At most this many labels (the most extreme points first); default 100. */
  max: z.number().int().min(1).max(1000).optional(),
  /**
   * Roadmap 34b: every label's centre this far from its point (pt; absent: placed beside it,
   * apart from the others when `repel`); a label dragged keeps its own offset.
   */
  offset: z
    .object({ dx: z.number().min(-500).max(500), dy: z.number().min(-500).max(500) })
    .optional(),
})
export type PointLabels = z.infer<typeof PointLabels>

/** Sparse overrides; anything unset inherits from graph style, then theme. */
export const SeriesStyle = z.object({
  color: ColorRef.optional(),
  points: z
    .object({
      show: z.boolean(),
      shape: SymbolShape,
      size: Pt,
      fill: FillStyle,
      border: StrokeStyle,
      jitter: z.union([z.literal('auto'), z.literal('none'), z.number().min(0)]),
      excludedStyle: z.enum(['hide', 'hollow']),
      /** XY graphs: plot the mean (with error bars) of replicates, or every replicate. */
      replicates: z.enum(['mean', 'each']),
    })
    .partial()
    .optional(),
  bar: z
    .object({
      fill: FillStyle,
      border: StrokeStyle,
      /** Fraction of the category (column / grouped graphs) or of the bin (XY bars). */
      width: z.number().min(0).max(1),
      /** XY graphs: a bar from the baseline to each point (a histogram of bin centres). */
      show: z.boolean(),
      /** XY bars: the bin width in X units; absent = the smallest spacing of the X values. */
      binWidth: z.number().positive(),
      /**
       * Where bars start (roadmap 30): e.g. 1 for fold changes, bars going up or down from it;
       * absent = 0 (or the axis' start when 0 is off the axis). Not used by stacked bars.
       */
      baseline: z.number(),
    })
    .partial()
    .optional(),
  box: z
    .object({
      /**
       * box: quartiles with whiskers, line at the median. floating: a bar from the minimum to
       * the maximum with a line at the centre (mean or median; "floating bars").
       * violin: the kernel density of the values, mirrored (see `violin`).
       */
      kind: z.enum(['box', 'floating', 'violin']),
      /** Whiskers to the extremes, Tukey's 1.5 IQR, or percentiles (1–99, 2.5–97.5, 5–95, 10–90). */
      whiskers: z.enum(['minmax', 'tukey', 'p1p99', 'p025p975', 'p5p95', 'p10p90']),
      fill: FillStyle,
      border: StrokeStyle,
      /** XY graphs (roadmap 30): a box and whiskers of the replicates at each X. */
      show: z.boolean(),
    })
    .partial()
    .optional(),
  /** Violins (`box.kind` 'violin'). */
  violin: z
    .object({
      /** 'truncated': from the smallest to the largest value; 'extended': tails to zero. */
      extent: z.enum(['truncated', 'extended']),
      /** Bandwidth multiplier (1 = Silverman's rule of thumb; larger is smoother). */
      smoothing: z.number().min(0.1).max(10),
      /** Lines at the quartiles (the centre line is `center`). */
      quartiles: z.boolean(),
      quartileLine: StrokeStyle,
    })
    .partial()
    .optional(),
  /**
   * A label above (or inside) each bar or column: its value (the bar height), mean, median, n,
   * SD or SEM, in a number format.
   */
  label: BarLabel.optional(),
  /** Labels beside the points (row titles, X or Y values). */
  pointLabels: PointLabels.optional(),
  center: z
    .object({
      /** 'geomean': the geometric mean (roadmap 30). */
      stat: z.enum(['mean', 'median', 'geomean', 'none']),
      line: StrokeStyle,
      width: z.number().min(0).max(1),
    })
    .partial()
    .optional(),
  error: ErrorSpec.partial().optional(),
  /**
   * Connecting line (XY data) or curve (fitted outputs). `gaps` (XY data, roadmap 30): break the
   * line at rows with an X but no value, instead of joining across them.
   */
  line: z
    .object({ show: z.boolean(), stroke: StrokeStyle, gaps: z.boolean() })
    .partial()
    .optional(),
  /**
   * XY data with replicates (roadmap 30): a line through each replicate (subject) across X, in the
   * data set's colour faded towards white by `fade` (0–0.95), with the mean line or without.
   */
  spaghetti: z
    .object({ show: z.boolean(), stroke: StrokeStyle, fade: z.number().min(0).max(0.95) })
    .partial()
    .optional(),
  /** XY data (roadmap 30): the error bars as a shaded band along the line instead of bars. */
  envelope: z
    .object({ show: z.boolean(), opacity: z.number().min(0).max(1) })
    .partial()
    .optional(),
  /** XY data (roadmap 30): the area between the line and `baseline` (absent: 0) filled. */
  area: z
    .object({ show: z.boolean(), opacity: z.number().min(0).max(1), baseline: z.number() })
    .partial()
    .optional(),
  /** Shading between an output's lo/hi band (confidence/prediction bands). */
  band: z
    .object({ show: z.boolean(), opacity: z.number().min(0).max(1) })
    .partial()
    .optional(),
  /**
   * XY and grouped graphs: plot against the left Y axis (default) or the right one
   * (`axes.y2`; without it the data set stays on the left).
   */
  yAxis: z.enum(['left', 'right']).optional(),
  /**
   * Drawing order of the data set's marks, front to back (e.g. error bars in front of or behind
   * the points). Kinds left out keep their default order after the listed ones.
   */
  markOrder: z.array(MarkLayer).max(5).optional(),
})
export type SeriesStyle = z.infer<typeof SeriesStyle>

/**
 * One plotted point, by where its value comes from: `r<row>` for a mark drawn per table row (a
 * mean symbol), `r<row>s<sub>` for a single value (table row and replicate subcolumn). Rows are
 * table rows (not positions in a row slice), kept in step with row inserts and deletes.
 */
export const PointKey = z.string().regex(/^r\d+(s\d+)?$/)
export type PointKey = z.infer<typeof PointKey>

export const pointKey = (row: number, sub?: number): PointKey =>
  sub === undefined ? `r${row}` : `r${row}s${sub}`

export function parsePointKey(key: string): { row: number; sub?: number } | null {
  const m = /^r(\d+)(?:s(\d+))?$/.exec(key)
  if (!m) return null
  return m[2] === undefined ? { row: Number(m[1]) } : { row: Number(m[1]), sub: Number(m[2]) }
}

/** Fill and border of a single bar or box (sparse). */
export const MarkFill = z.object({ fill: FillStyle, border: StrokeStyle }).partial()
export type MarkFill = z.infer<typeof MarkFill>

/**
 * Format of a single point (sparse; anything unset follows its data set). On grouped graphs a
 * per-row key (`r<row>`) is also that row's bar or box: `color` and `hide` apply to all of the
 * cell's marks, `bar` / `box` to its bar or box alone.
 */
export const PointStyle = z
  .object({
    color: ColorRef,
    shape: SymbolShape,
    size: Pt,
    fill: FillStyle,
    border: StrokeStyle,
    /** Leave this point out of the drawing (its value still counts in statistics). */
    hide: z.boolean(),
    /**
     * A short label drawn beside the point (wins over the data set's automatic label): plain
     * text, or runs when formatted.
     */
    label: z.union([z.string().max(200), RichText.max(200)]),
    /**
     * Where this point's label sits, from the point (set by dragging it): the label box's centre
     * minus the point's centre, in points. Such a label is not moved by label repelling.
     */
    labelOffset: Offset,
    bar: MarkFill,
    box: MarkFill,
    /** Pie and donut slices: pulled out from the centre by this fraction of the radius. */
    explode: z.number().min(0).max(1),
  })
  .partial()
export type PointStyle = z.infer<typeof PointStyle>

/** Significance-bracket appearance (graph-wide). */
export const BracketStyle = z
  .object({
    line: StrokeStyle.partial(),
    label: TextStyle.partial(),
    /** Vertical distance between stacked brackets. */
    step: Pt,
    /** Gap between the data and the lowest bracket. */
    gap: Pt,
    /** Length of the bracket's end ticks (0 = a plain line). */
    tick: Pt,
  })
  .partial()
export type BracketStyle = z.infer<typeof BracketStyle>

/**
 * Estimation plot options: the differences are each data set minus the first (the control).
 * - `ci`: 'pooled' (the unpaired t test's pooled SD) or 'welch' (unequal SDs);
 * - `guides`: dashed lines from the control's and each group's mean to the difference axis.
 */
export const EstimationStyle = z
  .object({ ci: z.enum(['pooled', 'welch']), guides: z.boolean() })
  .partial()
export type EstimationStyle = z.infer<typeof EstimationStyle>

/**
 * Bubble plot: the data sets (variables) plotted as X and Y, and optionally the variables that
 * size and colour each bubble (one bubble per row with X and Y).
 */
export const BubbleStyle = z
  .object({
    x: DataSetKey,
    y: DataSetKey,
    /** Bubble area proportional to this variable; absent = every bubble the symbol size. */
    size: DataSetKey,
    /** Colour on a gradient from `colors[0]` (smallest) to `colors[1]` (largest). */
    color: DataSetKey,
    /** Diameter of the largest bubble (pt). */
    maxSize: Pt,
    /** Smallest diameter drawn (pt). */
    minSize: Pt,
    colors: z.tuple([RGB, RGB]),
  })
  .partial()
export type BubbleStyle = z.infer<typeof BubbleStyle>

/** Pie and donut charts, and 100% stacked bars (slice = table row, one chart per data set). */
export const PieStyle = z
  .object({
    /** Donut hole as a fraction of the radius (0 = pie). */
    hole: z.number().min(0).max(0.95),
    /** Where the first slice starts, degrees clockwise from 12 o'clock. */
    startAngle: z.number().min(-360).max(360),
    /** Slices in row order clockwise (default) or counter-clockwise. */
    clockwise: z.boolean(),
    /** Slice labels. */
    labels: z.enum(['none', 'percent', 'value', 'category', 'categoryPercent', 'valuePercent']),
    labelPosition: z.enum(['inside', 'outside']),
    /** Decimals of percentages. */
    digits: z.number().int().min(0).max(6),
  })
  .partial()
export type PieStyle = z.infer<typeof PieStyle>

/** Colour maps of heat maps: sequential (low to high) and diverging (low, mid, high). */
export const ColorMapName = z.enum([
  'viridis',
  'magma',
  'inferno',
  'plasma',
  'cividis',
  'greys',
  'blues',
  'greens',
  'reds',
  'purples',
  'blueRed',
  'purpleGreen',
  'brownTeal',
])
export type ColorMapName = z.infer<typeof ColorMapName>

/**
 * Heat maps (roadmap 30): colour map, range, scaling, clustering, cell labels and the colour
 * scale. All optional (absent: viridis over the data's range, no scaling or clustering).
 */
export const HeatmapStyle = z
  .object({
    colors: ColorMapName,
    /** High values at the map's low end. */
    reverse: z.boolean(),
    /** Fixed ends of the colour scale (absent: the data's smallest / largest value). */
    min: z.number(),
    max: z.number(),
    /** Diverging maps: the value at the middle colour (absent: 0, or the range's middle). */
    midpoint: z.number(),
    /** Colour of cells without a value. */
    missing: RGB,
    /** Show each row's or column's values as z-scores ((value − mean) / SD). */
    standardize: z.enum(['none', 'row', 'column']),
    /** Order rows / columns by hierarchical clustering, with a dendrogram beside the map. */
    clusterRows: z.boolean(),
    clusterColumns: z.boolean(),
    /** Euclidean distance or 1 − Pearson r; complete, average or Ward (R's ward.D2) linkage. */
    distance: z.enum(['euclidean', 'pearson']),
    linkage: z.enum(['complete', 'average', 'ward']),
    /** Depth of the dendrograms (pt). */
    dendrogram: Pt,
    /** Values printed in the cells. */
    labels: z
      .object({ show: z.boolean(), format: NumberDisplay, text: TextStyle.partial() })
      .partial(),
    /** The colour scale: a gradient bar with ticks, right of the map or below it. */
    colorBar: z
      .object({ show: z.boolean(), position: z.enum(['right', 'bottom']), title: z.string() })
      .partial(),
    /** Lines between the cells; absent = none. */
    border: StrokeStyle,
  })
  .partial()
export type HeatmapStyle = z.infer<typeof HeatmapStyle>

/**
 * A v1 graph's style (schema v1, before roadmap 33b): kept for the v1 → v2 migration. v2 graphs
 * use `GraphStyle` (layers.ts).
 */
export const GraphStyleV1 = z.object({
  seriesDefaults: SeriesStyle.optional(),
  /** Base text style for everything (font family, size, colour); elements refine it. */
  text: TextStyle.partial().optional(),
  palette: z.array(RGB).optional(),
  /** 'axes' (default): the X and Y axes; 'box': a full frame round the plot; 'none': no axis lines. */
  frame: z.enum(['axes', 'box', 'none']).optional(),
  /** Background of the whole graph (exports too); absent = white. */
  background: FillStyle.optional(),
  /** Fill of the plot area only. */
  plotBackground: FillStyle.optional(),
  bracket: BracketStyle.optional(),
  /** Column / grouped graphs: gap = categoryGap × a group's width (the usual convention). */
  categoryGap: z.number().min(0).max(0.9).optional(),
  /**
   * Grouped graphs: data sets side by side within each row ('interleaved', default), or all at
   * the row's centre ('aligned': rows as time points, where offsets would misplace the data), or
   * (bar graphs) stacked into one bar per row ('stacked', roadmap 30; see `stack`).
   */
  arrangement: z.enum(['interleaved', 'aligned', 'stacked']).optional(),
  /**
   * Stacked grouped bars (roadmap 30): `percent` draws each segment as a percent of its row's
   * total (100% stacked); `gap` leaves this many points between segments.
   */
  stack: z.object({ percent: z.boolean(), gap: Pt }).partial().optional(),
  /**
   * Column and grouped graphs (roadmap 30): categories along the bottom ('vertical', default) or
   * down the left with the values across ('horizontal'). `axes.x` stays the category axis and
   * `axes.y` the value axis wherever they are drawn.
   */
  orientation: z.enum(['vertical', 'horizontal']).optional(),
  /**
   * Column graphs of data sets with several subcolumns (nested tables: a group's subjects). All
   * optional; absent = today's pooled drawing.
   * - `layout`: a group's values in one column ('pooled') or one narrow column per subject, side
   *   by side ('subjects', the usual nested scatter);
   * - `mark`: subjects told apart by symbol shape, by a shade of the group's colour, or not;
   * - `subjectMeans`: a short line at each subject's mean.
   */
  nested: z
    .object({
      layout: z.enum(['pooled', 'subjects']),
      mark: z.enum(['shape', 'shade', 'none']),
      subjectMeans: z.boolean(),
    })
    .partial()
    .optional(),
  /** Estimation plots (`column.estimation`). */
  estimation: EstimationStyle.optional(),
  /** Bubble plots (`bubble.scatter`): which variables and how they are drawn. */
  bubble: BubbleStyle.optional(),
  /** Pie, donut and 100% stacked bar graphs (parts of whole). */
  pie: PieStyle.optional(),
  /** Column graphs (roadmap 30): a line across the plot at the mean of every value shown. */
  grandMean: z.object({ show: z.boolean(), line: StrokeStyle }).partial().optional(),
  /** Heat maps (`heatmap.cells`). */
  heatmap: HeatmapStyle.optional(),
})
export type GraphStyleV1 = z.infer<typeof GraphStyleV1>

export const AxisBreak = z.object({ from: z.number(), to: z.number(), gap: Pt })
export type AxisBreak = z.infer<typeof AxisBreak>

/** Tick marks: sparse overrides of the theme. */
export const TickStyle = z
  .object({
    direction: z.enum(['out', 'in', 'cross', 'none']),
    length: Pt,
    width: Pt,
    minorLength: Pt,
  })
  .partial()
export type TickStyle = z.infer<typeof TickStyle>

export const GridLines = z
  .object({
    /** Lines at major ticks; absent = none. */
    major: StrokeStyle,
    /** Lines at minor ticks (continuous axes); absent = none. */
    minor: StrokeStyle,
  })
  .partial()
export type GridLines = z.infer<typeof GridLines>

const AxisCommon = {
  title: TextSpec.nullable(),
  line: StrokeStyle.partial().optional(),
  tickLabels: TextStyle.partial().optional(),
  /** false hides the axis line, ticks and labels (the title stays unless removed). */
  show: z.boolean().optional(),
  tickStyle: TickStyle.optional(),
  /** false hides the tick labels. */
  showLabels: z.boolean().optional(),
  grid: GridLines.optional(),
  /** Extra distance between the tick labels and the axis title. */
  titleGap: Pt.optional(),
  /** The axis title moved from its computed place (dragged on the canvas). */
  titleOffset: Offset.optional(),
  /**
   * The tick labels moved as a group away from the axis line (points; negative: towards it).
   * Only across the axis, so labels stay at their ticks.
   */
  tickLabelOffset: z.number().min(-200).max(200).optional(),
}

/**
 * A continuous axis' scale: linear, logarithmic, or (roadmap 34g) a cytometry display transform —
 * arcsinh with a cofactor or logicle (biexponential), both showing zero and negative values.
 */
export const AxisScale = z.enum(['linear', 'log10', 'log2', 'arcsinh', 'logicle'])
export type AxisScale = z.infer<typeof AxisScale>

/** Roadmap 34g: an arcsinh scale's cofactor (asinh(x / cofactor); absent: 5, CyTOF's). */
export const ArcsinhParams = z.object({ cofactor: z.number().positive().max(1e9) }).partial()
export type ArcsinhParams = z.infer<typeof ArcsinhParams>

/**
 * Roadmap 34g: a logicle scale's parameters as flowCore names them (absent: flowCore's defaults,
 * T 262144, W 0.5, M 4.5, A 0): the top of the scale's data, decades of linearisation, decades of
 * the display and extra negative decades.
 */
export const LogicleParams = z
  .object({
    T: z.number().positive().max(1e12),
    W: z.number().min(0).max(10),
    M: z.number().positive().max(20),
    A: z.number().min(-10).max(10),
  })
  .partial()
export type LogicleParams = z.infer<typeof LogicleParams>

export const ContinuousAxisSpec = z.object({
  type: z.literal('continuous'),
  ...AxisCommon,
  scale: AxisScale,
  /** Roadmap 34g: the arcsinh scale's cofactor. */
  arcsinh: ArcsinhParams.optional(),
  /** Roadmap 34g: the logicle scale's parameters. */
  logicle: LogicleParams.optional(),
  range: z.union([z.literal('auto'), z.object({ min: z.number(), max: z.number() })]),
  ticks: z.union([
    z.literal('auto'),
    z.object({
      interval: z.number().positive(),
      start: z.number().optional(),
      minor: z.number().int().min(0),
    }),
  ]),
  format: NumberDisplay,
  frame: z.enum(['plain', 'offset']),
  breaks: z.array(AxisBreak),
  /** Larger values towards the origin (e.g. Y increasing downwards). */
  reverse: z.boolean().optional(),
  /**
   * Draw this axis where the other axis has this value (default: the plot edge). On column and
   * grouped graphs the Y axis anchor is a category index (0 = first category's centre).
   */
  anchor: z.number().optional(),
  rotation: Rotation.optional(),
  /**
   * Tick labels show value ÷ 10ⁿ (4: 30000 is labelled 3), for axes titled "(×10⁴)". Data and
   * the axis range stay in data units.
   */
  labelPower: z.number().int().min(-15).max(15).optional(),
  /**
   * Roadmap 36: the lengths of a broken axis' pieces, from its low end up (a fraction of the
   * axis or points; null or missing: the pieces left share what remains in proportion to their
   * spans, as without lengths). Absent: every piece in proportion.
   */
  pieces: z.array(PieceLength.nullable()).max(10).optional(),
  /** Roadmap 36: the marks at its breaks (absent: '//' at both edges, 4 pt). */
  breakMark: BreakMark.optional(),
  /** Roadmap 36: ticks at these values (absent: automatic or by interval). */
  tickValues: TickValues.optional(),
  /**
   * Roadmap 36: text at values ("Monomer" at 1): the label of the tick there; without
   * `tickValues`, the ticks are at these values alone.
   */
  tickText: z.array(TickText).max(500).optional(),
  /** Roadmap 36: a bar of a set length in data units (e.g. in place of the axis). */
  scaleBar: ScaleBar.optional(),
})
export type ContinuousAxisSpec = z.infer<typeof ContinuousAxisSpec>

export const AxisSpec = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('categorical'),
    ...AxisCommon,
    labels: z.literal('dataSetTitles'),
    rotation: Rotation,
    /** Roadmap 36: a +/− treatment grid under the categories. */
    treatments: TreatmentGrid.optional(),
    /** Roadmap 36: labels spanning groups of categories (two-level category labels). */
    spans: CategorySpans.optional(),
  }),
  ContinuousAxisSpec,
])
export type AxisSpec = z.infer<typeof AxisSpec>

export const LegendSpec = z.object({
  show: z.boolean(),
  position: z.enum(['right', 'top', 'inside']),
  /** 'inside': top-left corner of the legend as fractions of the plot area (0–1). */
  inside: z.object({ x: z.number(), y: z.number() }).optional(),
  text: TextStyle.partial().optional(),
  /** Frame round the legend; absent = none. */
  border: StrokeStyle.optional(),
  background: FillStyle.optional(),
  /**
   * The grid's columns, at every position (roadmap 47b; it was 'top' only); absent: one row for
   * 'top', one column otherwise.
   */
  columns: z.number().int().min(1).optional(),
  /**
   * Roadmap 47b: how the grid is filled — across each row first ('rows', absent) or down each
   * column first ('columns').
   */
  fill: z.enum(['rows', 'columns']).optional(),
  /** Entry keys (data sets, extra-series ids, classes, categories…) left out of the legend. */
  hidden: z.array(z.string()).optional(),
  /** Roadmap 34b: each group of entries (data sets, levels, sizes) in reverse order. */
  reverse: z.boolean().optional(),
  /**
   * Roadmap 47b: entry keys in the legend's order, within each group of entries (the data sets'
   * group: data sets, curves, functions, Significance classes, result lines; each guide of a
   * mapped variable): a group's listed entries come in this order, then those it doesn't list in
   * their own order. `reverse` doesn't apply to a group this lists. Never the drawing order.
   */
  order: z.array(z.string()).optional(),
  /**
   * Roadmap 47b: legend-only labels by entry key, in place of the data set's (or entry's) own
   * title; the table and other graphs unchanged.
   */
  labels: z.record(z.string(), RichText.max(200)).optional(),
  /**
   * Roadmap 34b: the headings of the legends of variables mapped to appearance (absent: the
   * variable's name; '' none). `color` also heads a grouped graph of variables' levels.
   */
  titles: z
    .object({
      color: z.string().max(200),
      /** Roadmap 49d: a fill variable's legend. */
      fill: z.string().max(200),
      shape: z.string().max(200),
      size: z.string().max(200),
    })
    .partial()
    .optional(),
})
export type LegendSpec = z.infer<typeof LegendSpec>

/**
 * A pie's (parts of whole's) legend entry: its category, table row `row`. Audit 3 (G1): a table
 * row, so `mapGraphRefs` moves it with the rows (inserts, deletes, sorts) as it moves single
 * slices' formats.
 */
export const categoryEntryKey = (row: number): string => `category/${row}`
/** The table row of a pie's legend entry key, or null for other keys. */
export function rowOfCategoryEntryKey(key: string): number | null {
  const m = /^category\/(\d+)$/.exec(key)
  return m ? Number(m[1]) : null
}

export const Annotation = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bracket'),
    id: AnnotationId,
    a: DataSetKey,
    b: DataSetKey,
    /** Grouped graphs: rows of the two bars (absent: whole data sets on column graphs). */
    rowA: z.number().int().min(0).optional(),
    rowB: z.number().int().min(0).optional(),
    label: z.discriminatedUnion('source', [
      z.object({
        source: z.literal('analysis'),
        analysis: NodeId,
        comparison: z.string(),
        /** 'number': the P value alone ("0.017", "<0.0001"), as many journals print it. */
        show: z.enum(['stars', 'p', 'both', 'number']),
        /**
         * Roadmap 51c (§7.4): the P value names its test ("P = 0.0014 (Welch’s t)"), from the
         * analysis' `values.comparisonTest` or `values.test`. Absent: no name (graphs made
         * before keep their labels).
         */
        test: z.boolean().optional(),
      }),
      /** Typed text: plain, or runs when formatted. */
      z.object({ source: z.literal('manual'), text: RichLabel }),
    ]),
    // 'auto' = stacked by the layout engine.
    level: z.union([z.literal('auto'), z.number().int().min(0)]),
    /** Moved up (negative) or down from its computed height, in points (dragged). */
    offset: z.number().min(-2000).max(2000).optional(),
    /**
     * Roadmap 35: XY graphs: the X value the two data sets' values are compared at (a time
     * point); the bracket stands beside their points there, spanning their centres.
     */
    x: z.number().optional(),
    /**
     * Roadmap 35: data sets pooled with `a` against `b` (a group of bars to one bar): the bracket
     * spans the group, with one label.
     */
    group: z.array(DataSetKey).max(64).optional(),
    ...behind,
  }),
  z.object({
    type: z.literal('text'),
    id: AnnotationId,
    /** 'plot': fractions of the plot area (0–1, from top left); 'data': axis values. */
    anchor: z.object({ space: z.enum(['plot', 'data']), x: z.number(), y: z.number() }),
    content: TextSpec,
    /** Box behind the text. */
    border: StrokeStyle.optional(),
    background: FillStyle.optional(),
    ...behind,
  }),
  /**
   * Roadmap 35: a table of an analysis' results inside the plot (a corner), right of it or at an
   * anchor (as a text box's), live: a whole results sheet or some of its rows and columns.
   */
  z.object({
    type: z.literal('table'),
    id: AnnotationId,
    analysis: NodeId,
    /** The results sheet's key. */
    sheet: z.string().min(1).max(200),
    /** Body rows and columns shown (as a page table's); absent: all. */
    rows: ItemRange.optional(),
    columns: ItemRange.optional(),
    /** A corner of the plot, right of it, or at `anchor` (absent: the top-right corner). */
    place: z
      .enum(['topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'right', 'anchor'])
      .optional(),
    /** 'anchor': the table's top-left corner ('plot': fractions of the plot; 'data': axis values). */
    anchor: z.object({ space: z.enum(['plot', 'data']), x: z.number(), y: z.number() }).optional(),
    /** Font, size, colour… (default: the graph's text at 8 pt). */
    text: TextStyle.partial().optional(),
    /** Grid lines: between all cells, between rows only, or none (default rows). */
    grid: z.enum(['all', 'rows', 'none']).optional(),
    gridStroke: StrokeStyle.optional(),
    /** Title and column-title rows in bold (default true). */
    headerBold: z.boolean().optional(),
    /** Significant digits of numbers (absent: as the results show them). */
    digits: z.number().int().min(1).max(15).optional(),
    /** Behind the table (absent: white). */
    background: FillStyle.optional(),
    ...behind,
  }),
  z.object({
    type: z.literal('line'),
    id: AnnotationId,
    space: z.enum(['plot', 'data']),
    from: z.object({ x: z.number(), y: z.number() }),
    to: z.object({ x: z.number(), y: z.number() }),
    stroke: StrokeStyle,
    arrow: z.enum(['none', 'end', 'both']),
    /**
     * The heads at each end (roadmap 32), shared with layout lines; absent: filled triangles as
     * `arrow` says. Written with `arrow` set to match (for older apps).
     */
    heads: LineEnds.optional(),
    ...behind,
  }),
])
export type Annotation = z.infer<typeof Annotation>

type LineAnnotation = Extract<Annotation, { type: 'line' }>

/** A line annotation's heads: its own, else filled triangles where `arrow` puts them. */
export function lineEndsOf(a: Pick<LineAnnotation, 'arrow' | 'heads'>): LineEnds {
  if (a.heads) return a.heads
  const tri = { shape: 'triangle' as const }
  return a.arrow === 'both' ? { start: tri, end: tri } : a.arrow === 'end' ? { end: tri } : {}
}

/** The `arrow` value older apps read for these heads (heads anywhere at the start: both). */
export const arrowOfEnds = (e: LineEnds): LineAnnotation['arrow'] =>
  e.start ? 'both' : e.end ? 'end' : 'none'

/**
 * How a line annotation stores these heads: `arrow` alone when it says them exactly (plain
 * triangles at the end or both ends), else `arrow` for older apps and `heads`.
 */
export function annotationEnds(e: LineEnds): Pick<LineAnnotation, 'arrow' | 'heads'> {
  const plain = (h: LineEnds['end']) => !h || (h.shape === 'triangle' && h.size === undefined)
  const arrow = arrowOfEnds(e)
  const exact = plain(e.start) && plain(e.end) && (!e.start || !!e.end)
  return exact ? { arrow, heads: undefined } : { arrow, heads: e }
}

/**
 * A function plotted on an XY graph ("Plot a function"): a built-in equation (its id) or
 * a user-defined one (`equation` 'user', text in `userEquation`), with parameter values by name,
 * evaluated over the X range (absent ends: the X axis' range) at `points` X values.
 */
export const FunctionCurve = z.object({
  id: SeriesId,
  equation: z.string().min(1),
  userEquation: z.string().max(20000).optional(),
  params: z.record(z.string(), z.number()),
  from: z.number().optional(),
  to: z.number().optional(),
  points: z.number().int().min(2).max(5000).optional(),
  /** Legend text, plain or formatted (default: the equation's name). */
  title: RichLabel.optional(),
  style: SeriesStyle.optional(),
})
export type FunctionCurve = z.infer<typeof FunctionCurve>

/** A series from a node other than the graph's source table (e.g. a fitted curve, Phase 2). */
export const ExtraSeries = z.object({
  id: SeriesId,
  ref: DataSetRef,
  /** Take the default colour from this data set of the graph (a curve matches its data). */
  colorOf: DataSetKey.optional(),
  style: SeriesStyle.optional(),
})
export type ExtraSeries = z.infer<typeof ExtraSeries>

/**
 * Roadmap 34d: the rows of one level of a text variable (`seriesSource.filter`): the variable's
 * key and the level's (`levelKey`).
 */
export const SeriesFilter = z.object({
  variable: DataSetKey,
  level: z.string().regex(/^lv_[0-9a-f]*$/),
})
export type SeriesFilter = z.infer<typeof SeriesFilter>

/** Bounds of `GraphNode.size.scale` (10% to 1000%). */
export const GRAPH_SCALE = { min: 0.1, max: 10 } as const

/** What every graph node has, v1 and v2 alike: everything but its marks and their styles. */
export const graphCommon = {
  kind: z.literal('graph'),
  id: NodeId,
  name: z.string(),
  /** Series follow the source table: 'all' picks up columns added later, in table order. */
  seriesSource: z.object({
    table: NodeId,
    include: z.union([z.literal('all'), z.array(DataSetKey)]),
    /**
     * Table rows to show, in this order (a slice: e.g. some genotypes of a grouped table, some
     * X values, some subjects); absent = every row. Kept in step with row inserts/deletes.
     */
    rows: RowIndices.optional(),
    /**
     * Roadmap 34d: only the rows whose text variable `variable` has the level `level` (its
     * `levelKey`), live as the table changes (a split graph's slice, decision 380). With `rows`,
     * the slice's rows of that level. Rows without that level (empty or excluded text) are left
     * out; a variable gone from the table leaves no rows.
     */
    filter: SeriesFilter.optional(),
  }),
  /** Formats of single points: data set key → point key → style. */
  pointOverrides: z.record(DataSetKey, z.record(PointKey, PointStyle)).optional(),
  /**
   * Plot-area size; total size is derived by the layout engine. `scale` (roadmap 23) multiplies
   * everything drawn — text, symbols, line widths, gaps, the legend, moved-element offsets: the
   * graph is laid out at plot size ÷ scale with its own sizes and the whole scene scaled by it.
   * Absent = 1. Dragging a resize handle changes it with the plot's size; typing a size doesn't.
   */
  size: z.object({
    plotWidth: Pt,
    plotHeight: Pt,
    scale: z.number().min(GRAPH_SCALE.min).max(GRAPH_SCALE.max).optional(),
  }),
  /**
   * `y2`: a right Y axis (XY and grouped graphs), for data sets whose `yAxis` is 'right'. Its
   * presence draws it; absent = no right axis (every data set on the left).
   */
  axes: z.object({ x: AxisSpec, y: AxisSpec, y2: ContinuousAxisSpec.optional() }),
  annotations: z.array(Annotation),
  legend: LegendSpec,
  title: TextSpec.nullable(),
  /** The graph title moved from its computed place (dragged on the canvas). */
  titleOffset: Offset.optional(),
  /**
   * Shared axes: graphs with the same group id on an axis compute that axis' automatic range
   * from all of them together, so slices of one data set share a scale (live).
   */
  links: z.object({ x: z.string().min(1).optional(), y: z.string().min(1).optional() }).optional(),
  /** Free text about the graph (roadmap 31), edited above it; never drawn. Absent = none. */
  notes: z.string().optional(),
}

/**
 * A graph node of schema v1 (before roadmap 33b): a graph type plus a style bag per data set.
 * Documents never hold one any more (files of v1 migrate to v2, `migrations/v1to2.ts`); it stays
 * for the migration, and must keep accepting every v1 file exactly as v1 did. So it is the schema
 * as it was at 33b's release (v0.1.12), frozen in `migrations/v1schema.ts` (audit 2, M10,
 * decision 676), not `graphCommon` above, which has grown since; the frozen migration imports it
 * from here.
 */
export { GraphNodeV1 } from './migrations/v1schema.ts'
