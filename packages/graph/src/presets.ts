import {
  type DataTable,
  type DocNode,
  type ErrorStat,
  type Frame,
  type GraphLook,
  type GraphNode,
  isCellsTable,
  type Layer,
  type LayerOf,
  type Position,
  type TableKind,
  type VariableMapping,
} from '@ps/model'
import { hasRawValues } from './data.ts'
import { ESTIMATION_AXIS } from './layers/geoms/difference.ts'
import {
  type Allowed,
  cellsAllowed,
  frameAllowed,
  geomAllowed,
  type MatrixKind,
  matrixKindOf,
  positionAllowed,
} from './layers/matrix.ts'
import { type NewLooks, newLayerLooks } from './newDefaults.ts'
import { newGraphNode, scaffoldFor } from './scaffold.ts'

// Presets (roadmap 33c): a whole look as a function from a table to a frame and a layer list
// (back to front), with the look whose theme defaults it uses. `presetGraph` makes a new graph of
// one. Each draws what the 33b preset of the same id (a v1 style compiled) drew, without the
// placeholders compiling left (layers drawing nothing): a test compares their scenes. The graph
// builder shows a few of them as chips (`BUILDER_PRESETS`, decision 254); the others stay for
// creators, analysis outputs, provenance and tests, and everything they draw is reachable from
// the builder's plot styles.

/** How a nested table's subjects are drawn (`points` and centre layers' position and style). */
export interface NestedOptions {
  /** One column per subject ('subjects', the usual nested scatter) or all pooled. */
  layout: 'pooled' | 'subjects'
  /** How subjects are told apart. */
  mark: 'shape' | 'shade' | 'none'
  /** A short line at each subject's mean (a centre layer by subject). */
  subjectMeans: boolean
}

/** A new graph of a nested table: subjects side by side, shaded. */
export const NESTED_DEFAULTS: NestedOptions = {
  layout: 'subjects',
  mark: 'shade',
  subjectMeans: false,
}

export interface GraphPreset {
  id: string
  /** The chip's text. */
  label: string
  /** What it draws (tooltip). */
  description: string
  /**
   * Table kinds it is offered for, and graphs of variables by their axes' types (roadmap 34a),
   * each valid by the matrix (a test checks).
   */
  tableKinds: readonly MatrixKind[]
}

/** A preset's frame, look and layers for one table. */
export interface PresetLayers {
  frame: Frame
  look: GraphLook
  layers: Layer[]
  preset: string
  /** A graph of a multiple-variables table's variables: those on its axes (roadmap 34a). */
  mapping?: VariableMapping
}

export interface PresetOptions {
  /** Nested tables: how subjects are drawn (default `NESTED_DEFAULTS`). */
  nested?: NestedOptions
  /** Multiple-variables tables: the variables on the graph's axes (roadmap 34a). */
  mapping?: VariableMapping
  /**
   * Audit 3 (RFR-5, RTA-12): 'theme' makes the layers without the looks new layers start with
   * (`newLayerLooks`), drawn in the theme's defaults — the synthetic examples, which look as
   * their v1 documents did. Default 'new'.
   */
  looks?: NewLooks
}

const COLUMNS: readonly MatrixKind[] = ['column', 'nested', 'multipleVariables']
const CATEGORY_RAW: readonly MatrixKind[] = ['column', 'multipleVariables']
const GROUPED: readonly MatrixKind[] = ['grouped']
/** A number variable by the levels of a text variable (either way round). */
const LEVELS: readonly MatrixKind[] = ['mvTextNumber', 'mvNumberText']
/** Kinds drawn as raw values in categories or groups. */
const SLOTS: readonly MatrixKind[] = [...COLUMNS, ...LEVELS, ...GROUPED]
const BARS: readonly MatrixKind[] = [...SLOTS, 'contingency', 'mvTextText']
/** Counts: no spread, so no error bars. */
const COUNTS: readonly MatrixKind[] = ['contingency', 'mvTextText']

const ID = { kind: 'identity' } as const
const mean = (error?: ErrorStat): Extract<Layer['stat'], { kind: 'summary' }> =>
  error ? { kind: 'summary', center: 'mean', error } : { kind: 'summary', center: 'mean' }

/** What a preset builds a layer list from. */
interface PresetCtx {
  table: DataTable
  /** The table's kind, or a graph of variables' kind by its mapping. */
  kind: MatrixKind
  /** A graph of variables split into groups (a text variable mapped to colour, or counts). */
  groups: boolean
  /** The frame's slot positions: grouped tables dodge (side by side) unless the preset says. */
  frame: Frame
  nested: NestedOptions | undefined
  /** An XY table with X errors: error bars (X only) stay where v1 drew them. */
  xErrors: boolean
}

interface PresetDef extends GraphPreset {
  /** A chip of the builder only for tables with what it needs (roadmap 34c: groups). */
  chip?: (table: DataTable) => boolean
  /** Its own variables on the axes when the caller gives none (multiple-variables tables). */
  mapping?: (table: DataTable) => VariableMapping | undefined
  /** Roadmap 34g: whether it can draw the table at all (a dot plot needs a text variable). */
  available?: (table: DataTable) => boolean
  frame: (c: PresetCtx) => Frame
  look: (c: PresetCtx) => GraphLook
  layers: (c: PresetCtx) => Layer[]
}

const categoryOr = (category: GraphLook, grouped: GraphLook) => (c: PresetCtx) =>
  c.frame === 'grouped' ? grouped : category
const slots = (c: PresetCtx): Frame =>
  c.kind === 'grouped' || c.kind === 'contingency' || c.groups ? 'grouped' : 'category'

/** Layers in a category or grouped frame: positions per frame, nested subjects. */
function inSlots(c: PresetCtx, layers: Layer[], position: Position = { kind: 'dodge' }): Layer[] {
  if (c.frame === 'grouped')
    return layers.map((l) =>
      l.geom === 'bar' && l.position?.kind === 'stack' ? l : ({ ...l, position } as Layer),
    )
  return c.nested ? withNested(layers, c.nested) : layers
}

const pointsLayer = (): LayerOf<'points'> => ({ id: 'points', geom: 'points', stat: ID })
const errorLayer = (error: ErrorStat, more: Partial<Layer> = {}): Layer =>
  ({ id: 'error', geom: 'errorbar', stat: mean(error), ...more }) as Layer
const centerLayer = (center: 'mean' | 'median' = 'mean'): Layer => ({
  id: 'center',
  geom: 'center',
  stat: { kind: 'summary', center },
})
const barsLayer = (): LayerOf<'bar'> => ({ id: 'bars', geom: 'bar', stat: mean() })
const boxLayer = (): LayerOf<'box'> => ({
  id: 'box',
  geom: 'box',
  stat: { kind: 'boxplot', whiskers: 'minmax' },
})
const violinLayer = (center: 'median' | 'none' = 'median'): LayerOf<'violin'> => ({
  id: 'violin',
  geom: 'violin',
  stat: { kind: 'density', smoothing: 1, extent: 'truncated', center },
})
/** XY: an error layer drawing only the table's X errors, where v1 drew them. */
const xErrorsOnly = (c: PresetCtx): Layer[] => (c.xErrors ? [errorLayer('none')] : [])

const DEFS: PresetDef[] = [
  // --- Column, nested and multiple-variables tables; grouped tables side by side ------------
  {
    id: 'points',
    label: 'Scatter, mean ± SD',
    description: 'Every value, a line at the mean and SD error bars',
    tableKinds: SLOTS,
    frame: slots,
    look: categoryOr('column.scatter', 'grouped.scatter'),
    layers: (c) => inSlots(c, [pointsLayer(), errorLayer('SD'), centerLayer()]),
  },
  {
    id: 'pointsMedian',
    label: 'Scatter, median & IQR',
    description: 'Every value, a line at the median and the interquartile range',
    tableKinds: SLOTS,
    frame: slots,
    look: categoryOr('column.scatter', 'grouped.scatter'),
    layers: (c) =>
      inSlots(c, [
        pointsLayer(),
        {
          id: 'error',
          geom: 'errorbar',
          stat: { kind: 'summary', center: 'median', error: 'IQR' },
        },
        centerLayer('median'),
      ]),
  },
  {
    id: 'pointsOnly',
    label: 'Points only',
    description: 'Every value, without a mean or error bars',
    tableKinds: SLOTS,
    frame: slots,
    look: categoryOr('column.scatter', 'grouped.scatter'),
    layers: (c) => inSlots(c, [pointsLayer()]),
  },
  {
    id: 'pointsMean',
    label: 'Points with mean',
    description: 'Every value with a line at the mean',
    tableKinds: SLOTS,
    frame: slots,
    look: categoryOr('column.scatter', 'grouped.scatter'),
    layers: (c) => inSlots(c, [pointsLayer(), centerLayer()]),
  },
  {
    id: 'bars',
    label: 'Bars, mean ± SD',
    description: 'Bars at the mean with SD error bars above them',
    tableKinds: BARS,
    frame: slots,
    look: categoryOr('column.bar', 'grouped.bar'),
    // Counts have no spread: contingency bars have no error bars.
    layers: (c) =>
      inSlots(c, [
        barsLayer(),
        ...(COUNTS.includes(c.kind) ? [] : [errorLayer('SD', { on: 'bars' })]),
      ]),
  },
  {
    id: 'barsSem',
    label: 'Bars, mean ± SEM',
    description: 'Bars at the mean with SEM error bars above them',
    tableKinds: SLOTS,
    frame: slots,
    look: categoryOr('column.bar', 'grouped.bar'),
    layers: (c) => inSlots(c, [barsLayer(), errorLayer('SEM', { on: 'bars' })]),
  },
  {
    id: 'barsPoints',
    label: 'Bars with points',
    description: 'Bars at the mean with every value and SD error bars',
    tableKinds: SLOTS,
    frame: slots,
    look: categoryOr('column.bar', 'grouped.bar'),
    layers: (c) =>
      inSlots(c, [
        barsLayer(),
        pointsLayer(),
        errorLayer('SD', { on: 'bars', style: { direction: 'both' } }),
      ]),
  },
  {
    id: 'meanSd',
    label: 'Mean ± SD',
    description: 'A line (XY: a symbol) at the mean with SD error bars',
    tableKinds: [...SLOTS, 'xy'],
    frame: (c) => (c.kind === 'xy' ? 'xy' : slots(c)),
    look: (c) =>
      c.frame === 'xy' ? 'xy.scatter' : categoryOr('column.scatter', 'grouped.scatter')(c),
    layers: (c) =>
      c.frame === 'xy'
        ? [errorLayer('SD'), { id: 'points', geom: 'points', stat: mean() }]
        : inSlots(c, [errorLayer('SD'), centerLayer()]),
  },
  {
    id: 'meanSem',
    label: 'Mean ± SEM',
    description: 'A line (XY: a symbol) at the mean with SEM error bars',
    tableKinds: [...SLOTS, 'xy'],
    frame: (c) => (c.kind === 'xy' ? 'xy' : slots(c)),
    look: (c) =>
      c.frame === 'xy' ? 'xy.scatter' : categoryOr('column.scatter', 'grouped.scatter')(c),
    layers: (c) =>
      c.frame === 'xy'
        ? [errorLayer('SEM'), { id: 'points', geom: 'points', stat: mean() }]
        : inSlots(c, [errorLayer('SEM'), centerLayer()]),
  },
  {
    id: 'box',
    label: 'Box and whiskers',
    description: 'Quartiles with whiskers from the smallest to the largest value',
    tableKinds: SLOTS,
    frame: slots,
    look: categoryOr('column.box', 'grouped.box'),
    layers: (c) => inSlots(c, [boxLayer()]),
  },
  {
    id: 'boxPoints',
    label: 'Box with points',
    description: 'Box and whiskers with every value over them',
    tableKinds: SLOTS,
    frame: slots,
    look: categoryOr('column.box', 'grouped.box'),
    layers: (c) => inSlots(c, [boxLayer(), pointsLayer()]),
  },
  {
    id: 'violin',
    label: 'Violin plot',
    description: 'The density of the values, lines at the median and quartiles',
    tableKinds: SLOTS,
    frame: slots,
    look: categoryOr('column.box', 'grouped.box'),
    layers: (c) => inSlots(c, [violinLayer()]),
  },
  {
    id: 'violinPoints',
    label: 'Violin with points',
    description: 'A violin plot with every value over it',
    tableKinds: SLOTS,
    frame: slots,
    look: categoryOr('column.box', 'grouped.box'),
    layers: (c) => inSlots(c, [violinLayer(), pointsLayer()]),
  },
  {
    id: 'violinBox',
    label: 'Violin with box',
    description: 'A violin plot with a narrow box and whiskers inside it',
    tableKinds: SLOTS,
    frame: slots,
    look: categoryOr('column.box', 'grouped.box'),
    layers: (c) =>
      inSlots(c, [
        { ...violinLayer('none'), style: { quartiles: false } },
        {
          ...boxLayer(),
          style: { width: 0.12, fill: { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 } },
        },
      ]),
  },
  {
    id: 'floating',
    label: 'Floating bars',
    description: 'Bars from the smallest to the largest value, a line at the mean, every value',
    tableKinds: SLOTS,
    frame: slots,
    look: categoryOr('column.box', 'grouped.box'),
    layers: (c) =>
      inSlots(c, [
        { id: 'box', geom: 'box', stat: { kind: 'range', center: 'mean' } },
        pointsLayer(),
      ]),
  },
  {
    id: 'beforeAfter',
    label: 'Before–after',
    description: 'Each row’s values joined across the data sets (paired data)',
    tableKinds: CATEGORY_RAW,
    frame: () => 'category',
    look: () => 'column.beforeAfter',
    layers: () => [
      { id: 'pairs', geom: 'connector', stat: ID },
      { ...pointsLayer(), style: { spread: 'none' } },
    ],
  },
  {
    id: 'estimation',
    label: 'Estimation plot',
    description: 'The data beside each difference of means from the first and its CI',
    tableKinds: CATEGORY_RAW,
    frame: () => 'category',
    look: () => 'column.estimation',
    layers: () => [
      { id: 'diff', geom: 'difference', stat: { kind: 'difference', ci: 'pooled' } },
      pointsLayer(),
      centerLayer(),
    ],
  },
  // --- Grouped and contingency tables -----------------------------------------------------------
  {
    id: 'connected',
    label: 'Mean ± SD, joined',
    description: 'The means joined across the rows (a time course), with SD error bars',
    tableKinds: GROUPED,
    frame: () => 'grouped',
    look: () => 'grouped.scatter',
    layers: (c) =>
      inSlots(
        c,
        [
          { id: 'line', geom: 'line', stat: mean() },
          errorLayer('SD'),
          { id: 'points', geom: 'points', stat: mean() },
        ],
        { kind: 'aligned' },
      ),
  },
  {
    id: 'meanSdJoined',
    label: 'Mean ± SD, joined',
    description: 'The means joined across X, with SD error bars',
    tableKinds: ['xy'],
    frame: () => 'xy',
    look: () => 'xy.scatter',
    layers: () => [
      { id: 'line', geom: 'line', stat: mean() },
      errorLayer('SD'),
      { id: 'points', geom: 'points', stat: mean() },
    ],
  },
  {
    id: 'stacked',
    label: 'Stacked bars',
    description: 'The data sets’ means stacked in one bar per row, SD error bars on each segment',
    tableKinds: ['grouped', ...LEVELS, ...COUNTS],
    frame: () => 'grouped',
    look: () => 'grouped.bar',
    layers: (c) =>
      inSlots(
        c,
        [
          { ...barsLayer(), position: { kind: 'stack' } },
          ...(COUNTS.includes(c.kind) ? [] : [errorLayer('SD', { on: 'bars' })]),
        ],
        { kind: 'aligned' },
      ),
  },
  {
    id: 'stackedPercent',
    label: 'Stacked bars, 100%',
    description: 'Each row’s bar as percents of its total',
    tableKinds: ['grouped', ...COUNTS],
    frame: () => 'grouped',
    look: () => 'grouped.bar',
    layers: () => [{ ...barsLayer(), position: { kind: 'stack', percent: true } }],
  },
  {
    id: 'heatmap',
    label: 'Heat map',
    description: 'One coloured cell per row and data set (variable): its mean (count)',
    tableKinds: ['grouped', 'multipleVariables', ...COUNTS],
    frame: () => 'matrix',
    look: () => 'heatmap.cells',
    layers: () => [{ id: 'cells', geom: 'tile', stat: { kind: 'cell' } }],
  },
  // --- XY tables ----------------------------------------------------------------------------------
  {
    id: 'each',
    label: 'Every replicate',
    description: 'A symbol for every replicate value',
    tableKinds: ['xy'],
    frame: () => 'xy',
    look: () => 'xy.scatter',
    layers: () => [pointsLayer()],
  },
  {
    id: 'spaghetti',
    label: 'Each replicate (spaghetti)',
    description: 'Each replicate (subject) joined across X, with the mean',
    tableKinds: ['xy'],
    frame: () => 'xy',
    look: () => 'xy.scatter',
    layers: (c) => [
      { id: 'subjects', geom: 'line', stat: ID },
      { id: 'line', geom: 'line', stat: mean() },
      ...xErrorsOnly(c),
      { id: 'points', geom: 'points', stat: mean() },
    ],
  },
  {
    id: 'envelope',
    label: 'Mean with error band',
    description: 'The means joined, the SD as a shaded band',
    tableKinds: ['xy'],
    frame: () => 'xy',
    look: () => 'xy.scatter',
    layers: (c) => [
      { id: 'envelope', geom: 'band', stat: mean('SD') },
      { id: 'line', geom: 'line', stat: mean() },
      ...xErrorsOnly(c),
      { id: 'points', geom: 'points', stat: mean() },
    ],
  },
  {
    id: 'histogram',
    label: 'Histogram',
    description: 'Bars at the X values (e.g. bin centres)',
    tableKinds: ['xy'],
    frame: () => 'xy',
    look: () => 'xy.scatter',
    layers: (c) => [{ id: 'bars', geom: 'bar', stat: mean() }, ...xErrorsOnly(c)],
  },
  {
    id: 'histogramBins',
    label: 'Histogram of the values',
    description: 'Each data set’s values counted in bins (automatic width), as bars',
    // Roadmap 34f: a multiple-variables table's first number variable (`variableHistogram`).
    tableKinds: ['column', 'multipleVariables'],
    frame: () => 'xy',
    look: () => 'xy.scatter',
    // Several data sets overlap in the same bins: translucent bars keep each one visible.
    layers: (c) => [
      c.kind === 'multipleVariables'
        ? variableHistogram(c.table.dataSets.find((d) => !d.text)?.id)
        : {
            id: 'bars',
            geom: 'bar',
            stat: { kind: 'bin', measure: 'count' },
            ...(c.table.dataSets.length > 1 ? { style: { fill: OVERLAID_BINS } } : {}),
          },
    ],
  },
  // --- Survival, parts of whole, multiple variables -------------------------------------------
  {
    id: 'survival',
    label: 'Kaplan-Meier',
    description: 'Kaplan-Meier staircases with ticks at censored times',
    tableKinds: ['survival'],
    frame: () => 'xy',
    look: () => 'survival.step',
    layers: () => [
      { id: 'curve', geom: 'step', stat: { kind: 'km' } },
      { id: 'censor', geom: 'censor', stat: { kind: 'km' } },
    ],
  },
  {
    id: 'pie',
    label: 'Pie chart',
    description: 'A pie per data set, percentages inside the slices',
    tableKinds: ['partsOfWhole'],
    frame: () => 'polar',
    look: () => 'whole.pie',
    layers: () => wholeLayers('wedge'),
  },
  {
    id: 'donut',
    label: 'Donut chart',
    description: 'A pie with a hole, one per data set',
    tableKinds: ['partsOfWhole'],
    frame: () => 'polar',
    look: () => 'whole.donut',
    layers: () => wholeLayers('wedge'),
  },
  {
    id: 'wholeBars',
    label: '100% stacked bars',
    description: 'A bar per data set, its parts stacked as percents of the whole',
    tableKinds: ['partsOfWhole'],
    frame: () => 'category',
    look: () => 'whole.bar',
    layers: () => wholeLayers('bar'),
  },
  {
    id: 'bubble',
    label: 'Bubble plot',
    description: 'One bubble per row: X, Y, size and colour variables',
    tableKinds: ['multipleVariables'],
    frame: () => 'xy',
    look: () => 'bubble.scatter',
    layers: (c) => [
      // A large table (roadmap 34e: cells on an embedding): small points, sized by nothing.
      c.table.rowCount > LARGE_TABLE_ROWS
        ? {
            id: 'bubbles',
            geom: 'points',
            stat: ID,
            aes: largeAes(c.table),
            style: { size: LARGE_TABLE_POINT },
          }
        : { id: 'bubbles', geom: 'points', stat: ID, aes: defaultAes(c.table) },
    ],
  },
  {
    id: 'groupBoxPoints',
    label: 'Box with points by group',
    description: 'A number variable by the levels of a text variable: boxes with every value',
    tableKinds: LEVELS,
    mapping: (t) => defaultMapping(t, 'tn'),
    frame: slots,
    look: categoryOr('column.box', 'grouped.box'),
    layers: (c) => inSlots(c, [boxLayer(), pointsLayer()]),
  },
  {
    // Roadmap 34f: a cells table's box with points (no mark per row): a violin with a box inside.
    id: 'groupViolin',
    label: 'Violin by group',
    description: 'A number variable by the levels of a text variable: violins with a box inside',
    tableKinds: LEVELS,
    chip: (t) => isCellsTable(t),
    mapping: (t) => defaultMapping(t, 'tn'),
    frame: slots,
    look: categoryOr('column.box', 'grouped.box'),
    layers: (c) =>
      inSlots(c, [
        { ...violinLayer('none'), style: { quartiles: false } },
        {
          ...boxLayer(),
          style: { width: 0.12, fill: { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 } },
        },
      ]),
  },
  {
    id: 'scatterEllipses',
    label: 'Scatter with ellipses',
    description:
      'Two number variables, the points coloured by a text variable with a 95% ellipse per group',
    tableKinds: ['multipleVariables'],
    chip: groupable,
    frame: () => 'xy',
    look: () => 'bubble.scatter',
    layers: (c) => [
      {
        id: 'ellipses',
        geom: 'polygon',
        stat: { kind: 'ellipse', type: 'norm', level: 0.95 },
        aes: {},
      },
      { id: 'points', geom: 'points', stat: ID, aes: groupedAes(c.table) },
    ],
  },
  {
    id: 'trajectories',
    label: 'Trajectories',
    description:
      'Two number variables, each group’s rows joined in table order with an arrow at the end',
    tableKinds: ['multipleVariables'],
    chip: groupable,
    frame: () => 'xy',
    look: () => 'bubble.scatter',
    layers: (c) => [
      {
        id: 'path',
        geom: 'path',
        stat: ID,
        aes: {},
        style: { arrow: 'end', head: { shape: 'triangle' } },
      },
      { id: 'points', geom: 'points', stat: ID, aes: groupedAes(c.table), style: { size: 4 } },
    ],
  },
  {
    // Roadmap 34g: a cells table's 2D density — hexagons coloured by their points (hexbin), the
    // points themselves kept, hidden.
    id: 'density',
    label: 'Density',
    description: 'Two number variables: hexagons coloured by how many rows fall in each',
    tableKinds: ['multipleVariables'],
    chip: (t) => isCellsTable(t) && t.dataSets.filter((d) => !d.text).length >= 2,
    frame: () => 'xy',
    look: () => 'bubble.scatter',
    layers: (c) => [
      { id: 'hexes', geom: 'hex', stat: { kind: 'hexbin' }, aes: {} },
      { ...densityPoints(c), visible: false },
    ],
  },
  {
    // Roadmap 34g: each group's density contours over the points.
    id: 'densityContours',
    label: 'Density contours',
    description: 'Two number variables: the points and contour lines of their density per group',
    tableKinds: ['multipleVariables'],
    frame: () => 'xy',
    look: () => 'bubble.scatter',
    layers: (c) => [
      densityPoints(c),
      { id: 'contours', geom: 'contour', stat: { kind: 'density2d' }, aes: {} },
    ],
  },
  {
    // Roadmap 34g: points coloured by their local density, the densest drawn on top.
    id: 'pointDensity',
    label: 'Points by density',
    description: 'Two number variables: each point coloured by the density of points around it',
    tableKinds: ['multipleVariables'],
    frame: () => 'xy',
    look: () => 'bubble.scatter',
    layers: (c) => {
      const { color: _, ...aes } = densityPoints(c).aes ?? {}
      return [
        {
          ...densityPoints(c),
          aes,
          style: { ...densityPoints(c).style, colorBy: 'density', order: 'value' },
        },
      ]
    },
  },
  {
    // Roadmap 34g: a single-cell dot plot of the number variables by the first group variable.
    id: 'dotPlot',
    label: 'Dot plot',
    description:
      'Number variables by the levels of a text variable: dots sized by the percent of rows above 0, coloured by their scaled average',
    tableKinds: ['multipleVariables'],
    chip: (t) => isCellsTable(t),
    available: (t) => groupVariables(t).length > 0 && t.dataSets.some((d) => !d.text),
    frame: () => 'matrix',
    look: () => 'heatmap.cells',
    layers: (c) => {
      const group = dotPlotGroup(c.table)
      return [
        {
          id: 'dots',
          geom: 'points',
          stat: { kind: 'dotplot' },
          aes: group ? { group: group.id } : {},
        },
      ]
    },
  },
]

/**
 * Roadmap 34g: the variable a new dot plot groups by — the first group variable named like
 * clusters or cell types (Seurat's and Scanpy's exports: `seurat_clusters`, `cell_type`, `leiden`,
 * `ident`…), else the first group variable.
 */
export function dotPlotGroup(
  table: Pick<DataTable, 'dataSets'>,
): DataTable['dataSets'][number] | undefined {
  const groups = groupVariables(table)
  return (
    groups.find((d) => /clust|cell.?type|leiden|louvain|ident|annot/i.test(d.title || '')) ??
    groups[0]
  )
}

/**
 * Roadmap 34g: a density preset's mapped points — the first two number variables, coloured by a
 * group variable; small on a large table.
 */
function densityPoints(c: PresetCtx): LayerOf<'points'> {
  return {
    id: 'points',
    geom: 'points',
    stat: ID,
    aes: largeAes(c.table),
    style: { size: c.table.rowCount > LARGE_TABLE_ROWS ? LARGE_TABLE_POINT : 3 },
  }
}

/** Bars of several data sets overlapping in the same bins: translucent, each one visible. */
export const OVERLAID_BINS = {
  type: 'solid',
  color: { series: true },
  opacity: 0.5,
} as const satisfies NonNullable<LayerOf<'bar'>['style']>['fill']

/**
 * Roadmap 34f: a histogram bar layer's fill for its groups — translucent when it groups (by a
 * colour variable) and is overlaid (the bars cover each other), else the theme's (a stack's bars
 * don't overlap). A fill of the user's own stays.
 */
export function binsFill(l: Layer): Layer {
  if (l.geom !== 'bar' || l.stat.kind !== 'bin') return l
  const style = { ...(l.style ?? {}) }
  const translucent = JSON.stringify(style.fill) === JSON.stringify(OVERLAID_BINS)
  const wants = !!l.aes?.color && l.position?.kind !== 'stack'
  if (wants && !style.fill) style.fill = OVERLAID_BINS
  else if (!wants && translucent) delete style.fill
  else return l
  const { style: _, ...rest } = l
  return (Object.keys(style).length ? { ...rest, style } : rest) as Layer
}

/**
 * Roadmap 34f: a histogram of a multiple-variables table's number variable `x` (bars of its values
 * binned, automatic width, counts), one per level of the text variable `color` when given —
 * overlaid and translucent, or stacked (`stacked`).
 */
export function variableHistogram(
  x: string | undefined,
  color?: string,
  stacked = false,
): LayerOf<'bar'> {
  return {
    id: 'bars',
    geom: 'bar',
    stat: { kind: 'bin', measure: 'count' },
    aes: { ...(x ? { x } : {}), ...(color ? { color } : {}) },
    ...(stacked ? { position: { kind: 'stack' } } : {}),
    ...(color && !stacked ? { style: { fill: OVERLAID_BINS } } : {}),
  }
}

/** Whether a preset's chip is shown for a table (roadmap 34c: groups to draw). */
const chipFits = (id: string, table: DataTable) =>
  DEFS.find((d) => d.id === id)?.chip?.(table) ?? true

/** Roadmap 34c: a table with two number variables and a text variable to group by. */
function groupable(table: DataTable): boolean {
  return table.dataSets.filter((d) => !d.text).length >= 2 && groupVariables(table).length > 0
}

/** Most levels a text variable may have to be a new graph's groups (roadmap 34e). */
export const MAX_GROUP_LEVELS = 60

/**
 * The text variables new graphs group by (categories, colours): those with at most
 * `MAX_GROUP_LEVELS` levels — not a column of cell barcodes or other ids, a level per row
 * (roadmap 34e) — in table order.
 */
export function groupVariables(table: Pick<DataTable, 'dataSets'>): DataTable['dataSets'] {
  return table.dataSets.filter((d) => !!d.text && levelCount(d) <= MAX_GROUP_LEVELS)
}

/**
 * A text variable with more levels than this has many (roadmap 34e, decision 416): pickers show
 * its count, and it is never a default group, colour, shape or split.
 */
export const MANY_LEVELS = 200
/** Past this many levels a text variable can't be put on an axis, colour, shape or groups. */
export const MAX_MAPPED_LEVELS = 1000

const levelCounts = new WeakMap<readonly (string | null)[], number>()

/** A text variable's levels (distinct trimmed texts), counted once per text array; 0: numbers. */
export function levelCount(d: Pick<DataTable['dataSets'][number], 'text'>): number {
  if (!d.text) return 0
  let n = levelCounts.get(d.text)
  if (n === undefined) {
    const seen = new Set<string>()
    for (const t of d.text) {
      const v = t?.trim()
      if (v) seen.add(v)
    }
    n = seen.size
    levelCounts.set(d.text, n)
  }
  return n
}

/** Why a text variable can't be mapped (more than `MAX_MAPPED_LEVELS` levels), if so. */
export const tooManyLevels = (
  d: Pick<DataTable['dataSets'][number], 'text'>,
): string | undefined =>
  d.text && levelCount(d) > MAX_MAPPED_LEVELS
    ? `${levelCount(d).toLocaleString('en-US')} levels: more than ${MAX_MAPPED_LEVELS.toLocaleString('en-US')}`
    : undefined

/** A text variable's label suffix when it has many levels: " (16,171 levels)". */
export const levelsNote = (d: Pick<DataTable['dataSets'][number], 'text'>): string =>
  d.text && levelCount(d) > MANY_LEVELS ? ` (${levelCount(d).toLocaleString('en-US')} levels)` : ''

/** The first two number variables on X and Y, coloured by the first text variable. */
function groupedAes(table: DataTable): NonNullable<Layer['aes']> {
  const [x, y] = table.dataSets.filter((d) => !d.text)
  const color = groupVariables(table)[0]
  return {
    ...(x ? { x: x.id } : {}),
    ...(y ? { y: y.id } : {}),
    ...(color ? { color: color.id } : {}),
  }
}

/**
 * The variables a new graph of variables maps by axis types: the first text variable as the
 * categories and the first number variable as the values (text × number), turned (number ×
 * text), or the first two text variables (text × text); undefined when the table has too few.
 */
export function defaultMapping(
  table: Pick<DataTable, 'dataSets'>,
  axes: 'tn' | 'nt' | 'tt',
): VariableMapping | undefined {
  const text = groupVariables(table)
  const numbers = table.dataSets.filter((d) => !d.text)
  if (axes === 'tt') return text.length >= 2 ? { x: text[0]!.id, y: text[1]!.id } : undefined
  if (!text.length || !numbers.length) return undefined
  return axes === 'tn'
    ? { x: text[0]!.id, y: numbers[0]!.id }
    : { x: numbers[0]!.id, y: text[0]!.id }
}

function wholeLayers(host: 'wedge' | 'bar'): Layer[] {
  const id = host === 'wedge' ? 'slices' : 'segments'
  return [
    host === 'wedge'
      ? { id, geom: 'wedge', stat: { kind: 'fraction' } }
      : { id, geom: 'bar', stat: { kind: 'fraction' }, position: { kind: 'stack', percent: true } },
    { id: 'labels', geom: 'label', stat: { kind: 'fraction' }, on: id },
  ]
}

/**
 * A bubble plot's variables: the first two numeric ones as X and Y, the third as the size, the
 * first text variable (else the fourth numeric one) as the colour.
 */
export function defaultAes(table: DataTable): NonNullable<Layer['aes']> {
  const numeric = table.dataSets.filter((d) => !d.text)
  const [x, y, size, fourth] = numeric
  const color = groupVariables(table)[0] ?? fourth
  return {
    ...(x ? { x: x.id } : {}),
    ...(y ? { y: y.id } : {}),
    ...(size ? { size: size.id } : {}),
    ...(color ? { color: color.id } : {}),
  }
}

/** A large table's points' size (roadmap 34e). */
export const LARGE_TABLE_POINT = 2

/** A large table's XY graph: the first two number variables, coloured by a group variable. */
function largeAes(table: DataTable): NonNullable<Layer['aes']> {
  const { size: _, ...aes } = defaultAes(table)
  return aes
}

/** Every preset, in the order the builder offers them. */
export const GRAPH_PRESETS: readonly GraphPreset[] = DEFS.map(
  ({ id, label, description, tableKinds }) => ({ id, label, description, tableKinds }),
)

/** Every preset valid for a table kind or graph of variables (internal ones included). */
export const presetsFor = (kind: MatrixKind): GraphPreset[] =>
  GRAPH_PRESETS.filter((p) => p.tableKinds.includes(kind))

/**
 * The presets the graph builder shows as chips, per table kind, in their order (decision 254;
 * a multiple-variables table's box with points by group, roadmap 34a, decision 289).
 */
export const BUILDER_PRESETS: Readonly<Record<TableKind, readonly string[]>> = {
  column: ['barsPoints', 'points', 'boxPoints', 'violinBox'],
  grouped: ['barsPoints', 'points', 'boxPoints', 'violinBox', 'stacked'],
  xy: ['meanSdJoined', 'envelope', 'spaghetti'],
  survival: ['survival'],
  partsOfWhole: ['pie'],
  // Roadmap 34c: scatter with ellipses and trajectories, when the table has a text variable.
  // Roadmap 34f: violins by group on cells tables.
  // Roadmap 34g: a density (hexbin) and a dot plot on cells tables.
  multipleVariables: [
    'bubble',
    'points',
    'groupBoxPoints',
    'groupViolin',
    'scatterEllipses',
    'trajectories',
    'density',
    'dotPlot',
  ],
  contingency: ['bars', 'stacked'],
  nested: ['points', 'barsPoints'],
}

/**
 * The builder's chips for a table kind; with the table, only those it can draw (a box by group
 * needs a text and a number variable).
 */
export const builderPresetsFor = (kind: TableKind, table?: DataTable): GraphPreset[] =>
  BUILDER_PRESETS[kind]
    .filter((id) => !table || (!!presetLayers(id, table) && chipFits(id, table)))
    .map((id) => GRAPH_PRESETS.find((p) => p.id === id)!)

/**
 * The preset the builder starts from: the node's natural one (a frequency distribution's
 * histogram), else the table kind's default when it is a chip, else its first chip.
 */
export function builderDefaultFor(
  table: Pick<DataTable, 'tableKind'> & { rowCount?: number; cellsTable?: boolean },
  node?: DocNode,
): string {
  const id = defaultPresetFor(table, node)
  if (id !== DEFAULT_PRESET[table.tableKind]) return id
  const chips = BUILDER_PRESETS[table.tableKind]
  return chips.includes(id) ? id : chips[0]!
}

const DEFAULT_PRESET: Record<TableKind, string> = {
  column: 'points',
  nested: 'points',
  multipleVariables: 'points',
  grouped: 'bars',
  contingency: 'bars',
  xy: 'meanSd',
  survival: 'survival',
  partsOfWhole: 'pie',
}

/**
 * The preset a new graph of a table starts from: its kind's usual one, or the natural one of the
 * node it comes from (a frequency distribution's table is a histogram).
 */
export function defaultPresetFor(
  table: Pick<DataTable, 'tableKind'> & { rowCount?: number; cellsTable?: boolean },
  node?: DocNode,
): string {
  if (node?.kind === 'analysis' && node.analysisId === 'frequencyDistribution') return 'histogram'
  // A large multiple-variables table (roadmap 34e: cells of a single-cell export), or one set to
  // be a cells table (34f): an XY graph of its variables, not every variable's every value as
  // columns of points.
  const rows = table.rowCount ?? 0
  if (
    table.tableKind === 'multipleVariables' &&
    (rows > LARGE_TABLE_ROWS || isCellsTable({ ...table, rowCount: rows }))
  )
    return 'bubble'
  return DEFAULT_PRESET[table.tableKind]
}

/** Rows above which a multiple-variables table's new graphs start as XY graphs (roadmap 34e). */
export const LARGE_TABLE_ROWS = 10_000

/**
 * A preset's frame, look and layers for a table, or undefined for an unknown preset or one not
 * offered for the table's kind.
 */
export function presetLayers(
  id: string,
  table: DataTable,
  opts: PresetOptions = {},
): PresetLayers | undefined {
  const def = DEFS.find((d) => d.id === id)
  if (!def || (def.available && !def.available(table))) return undefined
  // A graph of variables: the caller's mapping, else the preset's own (multiple variables only).
  const mv = table.tableKind === 'multipleVariables'
  const mapping = mv ? (opts.mapping ?? def.mapping?.(table)) : undefined
  const kind = mapping ? matrixKindOf(table, { mapping }) : table.tableKind
  if (!def.tableKinds.includes(kind)) return undefined
  const colorText = !!mapping?.color && !!table.dataSets.find((d) => d.id === mapping.color)?.text
  const levels = kind === 'mvTextNumber' || kind === 'mvNumberText'
  const c: PresetCtx = {
    table,
    kind,
    groups: kind === 'mvTextText' || (levels && colorText),
    frame: 'category',
    nested: kind === 'nested' ? (opts.nested ?? NESTED_DEFAULTS) : undefined,
    xErrors: kind === 'xy' && table.x?.xFormat === 'numbersWithError',
  }
  c.frame = def.frame(c)
  const mapped = mapping && kind !== 'multipleVariables'
  return {
    frame: c.frame,
    look: def.look(c),
    layers: def.layers(c),
    preset: id,
    ...(mapped ? { mapping } : {}),
  }
}

/** A new graph of a table in a preset (the table's default preset when unknown). */
export function presetGraph(
  table: DataTable,
  id: string,
  name?: string,
  opts: PresetOptions = {},
): GraphNode {
  const spec =
    presetLayers(id, table, opts) ??
    (presetLayers(defaultPresetFor(table), table, opts) as PresetLayers)
  return newGraphNode(table, spec, name, opts.looks)
}

// --- Nested subjects ------------------------------------------------------------------------

/** Layers of a nested table's graph with its subjects drawn as `nested` says. */
export function withNested(layers: readonly Layer[], nested: NestedOptions): Layer[] {
  const bySubject: Position = { kind: 'dodge', by: 'subject' }
  const out = layers
    .filter((l) => l.id !== 'subjectMeans')
    .map((l): Layer => {
      if (l.geom !== 'points' && !(l.geom === 'center' && l.stat.by === undefined)) return l
      const { position: _, ...rest } = l
      const placed = (
        nested.layout === 'subjects' ? { ...rest, position: bySubject } : rest
      ) as Layer
      if (l.geom !== 'points') return placed
      const { subjects: _s, ...style } = (placed.style ?? {}) as Record<string, unknown>
      const marked = nested.mark !== 'none' ? { ...style, subjects: nested.mark } : style
      const { style: _old, ...bare } = placed
      return (Object.keys(marked).length ? { ...bare, style: marked } : bare) as Layer
    })
  if (nested.subjectMeans) {
    // Behind the group's centre line, in front of everything else.
    const at = out.findIndex((l) => l.geom === 'center')
    const means: Layer = {
      id: 'subjectMeans',
      geom: 'center',
      stat: { kind: 'summary', center: 'mean', by: 'subject' },
      ...(nested.layout === 'subjects' ? { position: bySubject } : {}),
      ...(nested.mark === 'shade' ? { style: { subjects: 'shade' } } : {}),
    }
    out.splice(at < 0 ? out.length : at, 0, means)
  }
  return out
}

/** How a layer list draws a nested table's subjects (the defaults when it has no points). */
export function nestedOf(layers: readonly Layer[]): NestedOptions {
  const points = layers.find((l) => l.geom === 'points')
  const mark = (points?.style as { subjects?: NestedOptions['mark'] } | undefined)?.subjects
  return {
    layout: points?.position?.kind === 'dodge' ? 'subjects' : points ? 'pooled' : 'subjects',
    mark: mark ?? 'none',
    subjectMeans: layers.some((l) => l.id === 'subjectMeans'),
  }
}

// --- Looks ----------------------------------------------------------------------------------

/**
 * The look (theme defaults family) a layer list calls for: what its main marks are (bars, boxes,
 * pairs, differences…), so a list built by hand gets the defaults a preset drawing the same gets.
 * Pies keep their own look (a donut is a pie with a hole).
 */
export function lookFor(frame: Frame, layers: readonly Layer[], current?: GraphLook): GraphLook {
  const has = (test: (l: Layer) => boolean) => layers.some(test)
  switch (frame) {
    case 'matrix':
      return 'heatmap.cells'
    case 'polar':
      return current === 'whole.donut' ? 'whole.donut' : 'whole.pie'
    case 'xy':
      if (has((l) => l.stat.kind === 'km')) return 'survival.step'
      // Histograms (of a variable too, roadmap 34f) keep the XY look.
      if (has((l) => l.stat.kind === 'bin')) return 'xy.scatter'
      if (has((l) => !!l.aes)) return 'bubble.scatter'
      return 'xy.scatter'
    case 'grouped':
      if (has((l) => l.geom === 'bar')) return 'grouped.bar'
      if (has((l) => l.geom === 'box' || l.geom === 'violin')) return 'grouped.box'
      return 'grouped.scatter'
    case 'category':
      if (has((l) => l.geom === 'bar' && l.stat.kind === 'fraction')) return 'whole.bar'
      if (has((l) => l.geom === 'difference')) return 'column.estimation'
      // Joining the points doesn't restyle them: only a graph already in the before-after look
      // (its preset, or a v1 before-after graph) keeps that look's hollow points.
      if (current === 'column.beforeAfter' && has((l) => l.geom === 'connector'))
        return 'column.beforeAfter'
      if (has((l) => l.geom === 'bar')) return 'column.bar'
      if (has((l) => l.geom === 'box' || l.geom === 'violin')) return 'column.box'
      return 'column.scatter'
  }
}

/**
 * Whether a preset's layers draw no mark per row on a cells table (roadmap 34f), with the first
 * such layer's reason; always allowed on other tables.
 */
export function presetCellsAllowed(
  id: string,
  table: DataTable,
  opts: PresetOptions = {},
): Allowed {
  if (!isCellsTable(table)) return { allowed: true }
  const spec = presetLayers(id, table, opts)
  if (!spec) return { allowed: true }
  const kind = matrixKindOf(table, spec)
  const cells = { rows: table.rowCount }
  for (const l of spec.layers) {
    const a = cellsAllowed(kind, spec.frame, l.geom, l.stat.kind, cells)
    if (!a.allowed) return a
  }
  return { allowed: true }
}

/** What the matrix refuses of a preset's layers for a table (none for every kind it lists). */
export function presetIssues(table: DataTable, id: string, opts: PresetOptions = {}): string[] {
  const spec = presetLayers(id, table, opts)
  if (!spec) return [`${id}: not offered for ${table.tableKind} tables`]
  const raw = hasRawValues(table)
  const kind = matrixKindOf(table, spec)
  return spec.layers.flatMap((l) => {
    const a = geomAllowed(kind, l.geom, l.stat.kind, { raw })
    const f = frameAllowed(spec.frame, kind, l.geom, l.stat.kind)
    const p = l.on ? { allowed: true } : positionAllowed(spec.frame, l.geom, l.position)
    return [a, f, p].filter((x) => !x.allowed).map((x) => `${id}/${l.id}: ${x.reason}`)
  })
}

// --- Changing a graph's layers ---------------------------------------------------------------

/** What a graph's layers change to (the builder's result, or a preset's). */
export interface LayerChange {
  frame: Frame
  look: GraphLook
  layers: readonly Layer[]
  /** Provenance; absent keeps the graph's. */
  preset?: string
  /**
   * A graph of variables' mapping (roadmap 34a): the new one, null for none (the table's
   * variables as columns, or mapped on the points of an XY graph); absent keeps the graph's.
   */
  mapping?: VariableMapping | null
}

/** Where a layer's series come from, for matching layers of two lists. */
const sourceOf = (l: Layer) => l.data?.from ?? 'table'

/**
 * `next` with the formats of the `old` layers that stay: a layer matches the old one with its id
 * and geom, else the first one left of its geom drawing the same kind of data. It keeps that
 * layer's name, legend choice, style (under the fields `next` sets) and per-data-set formats;
 * per-data-set stats only while the stat's kind is the same. Everything else (stat, position,
 * attachment, data) is `next`'s.
 */
export function keepFormats(old: readonly Layer[], next: readonly Layer[]): Layer[] {
  const used = new Set<Layer>()
  const take = (test: (l: Layer) => boolean) => {
    const m = old.find((l) => !used.has(l) && test(l))
    if (m) used.add(m)
    return m
  }
  const byId = next.map((n) => take((l) => l.id === n.id && l.geom === n.geom))
  return next.map((n, i) => {
    const m =
      byId[i] ??
      take(
        (l) =>
          l.geom === n.geom &&
          sourceOf(l) === sourceOf(n) &&
          !next.some((x) => x.id === l.id && x.geom === l.geom),
      )
    if (!m) return n
    const style = { ...(m.style as object | undefined), ...(n.style as object | undefined) }
    const series: Record<string, Record<string, unknown>> = {}
    for (const [k, e] of Object.entries(m.series ?? {})) {
      const { stat, ...rest } = e as Record<string, unknown>
      const entry = m.stat.kind === n.stat.kind && stat !== undefined ? { ...rest, stat } : rest
      if (Object.keys(entry).length) series[k] = entry
    }
    for (const [k, e] of Object.entries(n.series ?? {}))
      series[k] = { ...series[k], ...(e as Record<string, unknown>) }
    return {
      ...n,
      ...(m.name !== undefined && n.name === undefined ? { name: m.name } : {}),
      ...(m.legend !== undefined && n.legend === undefined ? { legend: m.legend } : {}),
      ...(Object.keys(style).length ? { style } : {}),
      ...(Object.keys(series).length ? { series } : {}),
    } as Layer
  })
}

/**
 * The graph with its layers changed (one `graph.setLayers` step): formats of layers that stay are
 * kept (`keepFormats`); a new frame brings its axes and legend (`scaffoldFor`; the size stays); a
 * difference layer brings the estimation plot's difference axis, which goes with it.
 */
export function withLayers(graph: GraphNode, change: LayerChange, table?: DataTable): GraphNode {
  const layers = newLayerLooks(keepFormats(graph.layers, change.layers), graph.layers)
  let { axes, legend, style } = graph
  const mapping = change.mapping === undefined ? graph.mapping : (change.mapping ?? undefined)
  // Other variables on the axes bring their titles, as a new frame brings its axes; variables
  // newly mapped to appearance (roadmap 34b) bring their legends.
  const onAxes = (m: VariableMapping | undefined) =>
    JSON.stringify(m ? [m.x, m.y, m.color, m.measure] : null)
  const remapped = onAxes(mapping) !== onAxes(graph.mapping)
  const looked = (m: VariableMapping | undefined) =>
    JSON.stringify(m ? [m.color, m.shape, m.size] : null)
  if (
    table &&
    !remapped &&
    change.frame === graph.frame &&
    looked(mapping) !== looked(graph.mapping)
  )
    legend = {
      ...legend,
      show: legend.show || scaffoldFor(table, { ...change, mapping }).legend.show,
    }
  if ((change.frame !== graph.frame || remapped) && table) {
    const s = scaffoldFor(table, { ...change, mapping })
    axes = s.axes
    legend = { ...legend, show: s.legend.show }
    if (change.frame !== 'category' && change.frame !== 'grouped') {
      const { orientation: _o, categoryGap: _g, ...rest } = style
      style = rest
    }
  } else if (table) {
    // Same frame: a value axis still titled by default follows the new layers' default (bars
    // stacked as percents, or no longer); a title of the user's own stays.
    const before = scaffoldFor(table, {
      frame: graph.frame,
      look: graph.look ?? change.look,
      layers: graph.layers,
      mapping,
    }).axes.y
    const after = scaffoldFor(table, { ...change, mapping }).axes.y
    if (
      JSON.stringify(axes.y.title ?? null) === JSON.stringify(before.title ?? null) &&
      JSON.stringify(before.title ?? null) !== JSON.stringify(after.title ?? null)
    )
      axes = { ...axes, y: { ...axes.y, title: after.title ?? null } as typeof axes.y }
  }
  const diff = layers.some((l) => l.geom === 'difference')
  if (diff && !axes.y2) axes = { ...axes, y2: ESTIMATION_AXIS }
  if (!diff && change.frame === 'category' && graph.layers.some((l) => l.geom === 'difference')) {
    const { y2: _, ...rest } = axes
    axes = rest
  }
  const preset = change.preset ?? graph.preset
  const { preset: _p, mapping: _m, ...rest } = graph
  return {
    ...rest,
    frame: change.frame,
    look: change.look,
    layers,
    ...(preset !== undefined ? { preset } : {}),
    axes,
    legend,
    style,
    ...(mapping ? { mapping } : {}),
  }
}

/** The graph in a preset (Duplicate as…): `withLayers`; unchanged when not offered for the table. */
export function applyPreset(graph: GraphNode, id: string, table: DataTable): GraphNode {
  const spec = presetLayers(id, table, graph.mapping ? { mapping: graph.mapping } : {})
  return spec ? withLayers(graph, spec, table) : graph
}
