import {
  type DataTable,
  type Frame,
  type Geom,
  isCellsTable,
  type Layer,
  type LayerId,
  type LayerOf,
  type Position,
  type StatKind,
  type VariableMapping,
} from '@ps/model'
import { hasRawValues } from './data.ts'
import { newLayerIndex } from './layerList.ts'
import { lineEquation, slopedValues } from './layers/geoms/sloped.ts'
import {
  type Allowed,
  cellsAllowed,
  FRAMES,
  frameAllowed,
  geomAllowed,
  KIND_NAMES,
  type MatrixKind,
  matrixKindOf,
  stackedAreas,
  UNSTACKED,
} from './layers/matrix.ts'

// Plot styles (roadmap 33c): the graph builder's icons and the Layers list's Add menu. Each style
// makes one layer (a geom with a starting stat) on the frames it suits; the matrix says which a
// table allows and why not. Styles of another frame (a heat map of a grouped table, a bubble plot
// of a multiple-variables table, pies of parts of whole) are frame choices: they replace the list.

/** The families icons are grouped and tinted by. */
export type PlotFamily = 'raw' | 'summary' | 'trend' | 'connection' | 'special'

export const PLOT_FAMILIES: readonly { id: PlotFamily; label: string }[] = [
  { id: 'raw', label: 'Raw values' },
  { id: 'summary', label: 'Summaries' },
  { id: 'trend', label: 'Trends' },
  { id: 'connection', label: 'Connections' },
  { id: 'special', label: 'Special' },
]

export interface PlotStyle {
  id: string
  label: string
  family: PlotFamily
  geom: Geom
  /** The frames it draws on (a frame choice: the one it moves the graph to). */
  frames: readonly Frame[]
  /**
   * Choosing it moves the graph to another frame with this preset's layers (a heat map, a bubble
   * plot, pies, columns again).
   */
  frameChoice?: string
  /** Error bars and labels attach to a host layer (bars) when the graph has one. */
  attaches?: boolean
  /** Only for these table kinds (and graphs of variables by their axes' types). */
  kinds?: readonly MatrixKind[]
  /** A frame choice's main layer's stat (the matrix's per-row check on cells tables, 34f). */
  stat?: StatKind
  /**
   * Roadmap 34f: the preset a frame choice takes on a cells table instead of `frameChoice`, one
   * without a mark per row (columns as boxes, not every value).
   */
  cellsChoice?: string
}

const CAT_GROUPED: readonly Frame[] = ['category', 'grouped']

/** Every plot style, in the order the builder shows them within their families. */
export const PLOT_STYLES: readonly PlotStyle[] = [
  // Raw values.
  { id: 'points', label: 'Points', family: 'raw', geom: 'points', frames: [...CAT_GROUPED, 'xy'] },
  { id: 'each', label: 'Each replicate', family: 'raw', geom: 'points', frames: ['xy'] },
  { id: 'box', label: 'Box', family: 'raw', geom: 'box', frames: [...CAT_GROUPED, 'xy'] },
  { id: 'violin', label: 'Violin', family: 'raw', geom: 'violin', frames: CAT_GROUPED },
  { id: 'censor', label: 'Censor ticks', family: 'raw', geom: 'censor', frames: ['xy'] },
  // Summaries.
  { id: 'bars', label: 'Bars', family: 'summary', geom: 'bar', frames: [...CAT_GROUPED, 'xy'] },
  { id: 'center', label: 'Centre line', family: 'summary', geom: 'center', frames: CAT_GROUPED },
  { id: 'means', label: 'Mean symbol', family: 'summary', geom: 'points', frames: CAT_GROUPED },
  {
    id: 'error',
    label: 'Error bars',
    family: 'summary',
    geom: 'errorbar',
    frames: [...CAT_GROUPED, 'xy'],
    attaches: true,
  },
  {
    id: 'labels',
    label: 'Value labels',
    family: 'summary',
    geom: 'label',
    frames: ['category', 'grouped', 'xy', 'polar', 'matrix'],
    attaches: true,
  },
  {
    id: 'grandMean',
    label: 'Grand mean',
    family: 'summary',
    geom: 'refline',
    frames: ['category'],
  },
  {
    id: 'subjectMeans',
    label: 'Subject means',
    family: 'summary',
    geom: 'center',
    frames: ['category'],
    kinds: ['nested'],
  },
  // Trends.
  { id: 'line', label: 'Line', family: 'trend', geom: 'line', frames: ['xy'] },
  { id: 'subjects', label: 'Line per replicate', family: 'trend', geom: 'line', frames: ['xy'] },
  { id: 'band', label: 'Band', family: 'trend', geom: 'band', frames: ['xy', 'grouped'] },
  { id: 'area', label: 'Area', family: 'trend', geom: 'area', frames: ['xy'] },
  { id: 'step', label: 'Step', family: 'trend', geom: 'step', frames: ['xy'] },
  {
    id: 'groupLines',
    label: 'Lines by group',
    family: 'trend',
    geom: 'line',
    frames: ['xy'],
    kinds: ['multipleVariables'],
  },
  // Group overlays (roadmap 34c): an ellipse or hull per data set or group.
  { id: 'ellipses', label: 'Ellipses', family: 'summary', geom: 'polygon', frames: ['xy'] },
  { id: 'hull', label: 'Convex hulls', family: 'summary', geom: 'polygon', frames: ['xy'] },
  // Roadmap 34e: each group's name at its centre (clusters on an embedding).
  {
    id: 'groupNames',
    label: 'Group names',
    family: 'summary',
    geom: 'label',
    frames: ['xy'],
    kinds: ['multipleVariables'],
  },
  // Roadmap 34g: densities of a graph of variables' points.
  {
    id: 'hexbin',
    label: 'Hexagons',
    family: 'summary',
    geom: 'hex',
    frames: ['xy'],
    kinds: ['multipleVariables'],
  },
  {
    id: 'contours',
    label: 'Density contours',
    family: 'summary',
    geom: 'contour',
    frames: ['xy'],
    kinds: ['multipleVariables'],
  },
  {
    id: 'contourBands',
    label: 'Filled contours',
    family: 'summary',
    geom: 'contour',
    frames: ['xy'],
    kinds: ['multipleVariables'],
  },
  {
    id: 'densityImage',
    label: 'Density image',
    family: 'summary',
    geom: 'raster',
    frames: ['xy'],
    kinds: ['multipleVariables'],
  },
  // Roadmap 34g: a dot plot's averages as tiles behind (or instead of) its dots.
  {
    id: 'dotTiles',
    label: 'Average tiles',
    family: 'summary',
    geom: 'tile',
    frames: ['matrix'],
    kinds: ['multipleVariables'],
  },
  // Roadmap 49c: the trees of a heat map's clustered rows and columns (added, the tiles cluster
  // that axis).
  {
    id: 'rowTree',
    label: 'Row dendrogram',
    family: 'special',
    geom: 'dendrogram',
    frames: ['matrix'],
  },
  {
    id: 'columnTree',
    label: 'Column dendrogram',
    family: 'special',
    geom: 'dendrogram',
    frames: ['matrix'],
  },
  // Connections.
  {
    id: 'joinMeans',
    label: 'Join means',
    family: 'connection',
    geom: 'line',
    frames: CAT_GROUPED,
  },
  {
    id: 'pairs',
    label: 'Before–after',
    family: 'connection',
    geom: 'connector',
    // Grouped graphs (roadmap 34c): each subject joined within a row (pair lines).
    frames: ['category', 'grouped'],
  },
  // Roadmap 34c: rows joined in table order (trajectories), an arrow per row (vectors).
  { id: 'path', label: 'Path', family: 'connection', geom: 'path', frames: ['xy'] },
  {
    id: 'vectors',
    label: 'Vectors',
    family: 'connection',
    geom: 'segment',
    frames: ['xy'],
    kinds: ['multipleVariables'],
  },
  // Special: the estimation plot's differences, and the frame choices.
  {
    id: 'difference',
    label: 'Difference',
    family: 'special',
    geom: 'difference',
    frames: ['category'],
  },
  {
    id: 'columns',
    label: 'Columns',
    family: 'special',
    geom: 'points',
    frames: ['category'],
    frameChoice: 'points',
    stat: 'identity',
    cellsChoice: 'box',
    kinds: ['multipleVariables', 'column'],
  },
  {
    id: 'histogram',
    label: 'Histogram',
    family: 'special',
    geom: 'bar',
    frames: ['xy'],
    frameChoice: 'histogramBins',
    stat: 'bin',
    // Roadmap 34f: a multiple-variables table's histogram of a number variable (by group).
    kinds: ['column', 'multipleVariables'],
  },
  {
    id: 'groupedBars',
    label: 'Grouped bars',
    family: 'special',
    geom: 'bar',
    frames: ['grouped'],
    frameChoice: 'bars',
    stat: 'summary',
    // Text × text: back to count bars from a heat map.
    kinds: ['grouped', 'mvTextText'],
  },
  {
    id: 'heatmap',
    label: 'Heat map',
    family: 'special',
    geom: 'tile',
    frames: ['matrix'],
    frameChoice: 'heatmap',
    stat: 'cell',
  },
  {
    id: 'bubbles',
    label: 'Bubbles',
    family: 'special',
    geom: 'points',
    frames: ['xy'],
    frameChoice: 'bubble',
    stat: 'identity',
    kinds: ['multipleVariables'],
  },
  {
    // Roadmap 49c: a tree of the table's rows alone (no heat map).
    id: 'dendrogram',
    label: 'Dendrogram',
    family: 'special',
    geom: 'dendrogram',
    frames: ['matrix'],
    frameChoice: 'dendrogram',
    stat: 'cluster',
    kinds: ['grouped', 'contingency', 'multipleVariables'],
  },
  {
    // Roadmap 34g: variables by the levels of a text variable (single-cell dot plots).
    id: 'dotPlot',
    label: 'Dot plot',
    family: 'special',
    geom: 'points',
    frames: ['matrix'],
    frameChoice: 'dotPlot',
    stat: 'dotplot',
    kinds: ['multipleVariables'],
  },
  {
    id: 'wedges',
    label: 'Wedges',
    family: 'special',
    geom: 'wedge',
    frames: ['polar'],
    frameChoice: 'pie',
    stat: 'fraction',
  },
  {
    id: 'wholeBars',
    label: '100% bars',
    family: 'special',
    geom: 'bar',
    frames: ['category'],
    frameChoice: 'wholeBars',
    stat: 'fraction',
    kinds: ['partsOfWhole'],
  },
]

export const plotStyle = (id: string): PlotStyle | undefined => PLOT_STYLES.find((s) => s.id === id)

/** The layer a plot style makes first: its geom with a starting stat (and id). */
export function styleLayer(style: PlotStyle, frame: Frame, kind: MatrixKind): Layer {
  const mean = { kind: 'summary', center: 'mean' } as const
  const km = { kind: 'km' } as const
  switch (style.id) {
    case 'points':
      // XY: a symbol at the mean of the replicates; elsewhere every value.
      return { id: 'points', geom: 'points', stat: frame === 'xy' ? mean : { kind: 'identity' } }
    case 'each':
      return { id: 'points', geom: 'points', stat: { kind: 'identity' } }
    case 'box':
      return { id: 'box', geom: 'box', stat: { kind: 'boxplot', whiskers: 'minmax' } }
    case 'violin':
      return {
        id: 'violin',
        geom: 'violin',
        stat: { kind: 'density', smoothing: 1, extent: 'truncated', center: 'median' },
      }
    case 'censor':
      return { id: 'censor', geom: 'censor', stat: km }
    case 'bars':
      // A column table's xy graph is its histogram: bars of the values binned.
      if (frame === 'xy' && kind === 'column')
        return { id: 'bars', geom: 'bar', stat: { kind: 'bin', measure: 'count' } }
      return { id: 'bars', geom: 'bar', stat: mean }
    case 'center':
      return { id: 'center', geom: 'center', stat: mean }
    case 'means':
      // A symbol at the mean, set apart from every value's: larger, open, its border heavier.
      return {
        id: 'means',
        geom: 'points',
        stat: mean,
        style: {
          shape: 'diamond',
          size: 10,
          fill: { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 },
          border: { color: { series: true }, width: 1.5, dash: 'solid' },
        },
      }
    case 'error':
      return { id: 'error', geom: 'errorbar', stat: { ...mean, error: 'SD' } }
    case 'labels':
      if (frame === 'matrix') return { id: 'values', geom: 'label', stat: { kind: 'cell' } }
      return {
        id: 'labels',
        geom: 'label',
        stat:
          frame === 'polar' || (frame === 'category' && kind === 'partsOfWhole')
            ? { kind: 'fraction' }
            : mean,
      }
    case 'grandMean':
      return { id: 'grandMean', geom: 'refline', stat: { ...mean, by: 'all' } }
    case 'subjectMeans':
      return { id: 'subjectMeans', geom: 'center', stat: { ...mean, by: 'subject' } }
    case 'line':
    case 'joinMeans':
      return { id: 'line', geom: 'line', stat: mean }
    case 'subjects':
      return { id: 'subjects', geom: 'line', stat: { kind: 'identity' } }
    case 'groupLines':
      // The group: `aes.group`, else the colour variable when it is text (see the bubble frame).
      return { id: 'groupLines', geom: 'line', stat: { kind: 'identity' }, aes: {} }
    case 'band':
      return kind === 'survival'
        ? { id: 'ciBand', geom: 'band', stat: km }
        : { id: 'envelope', geom: 'band', stat: { ...mean, error: 'SD' } }
    case 'area':
      return { id: 'area', geom: 'area', stat: mean }
    case 'step':
      return kind === 'survival'
        ? { id: 'curve', geom: 'step', stat: km }
        : { id: 'step', geom: 'step', stat: mean }
    case 'pairs':
      return { id: 'pairs', geom: 'connector', stat: { kind: 'identity' } }
    // Roadmap 34c: a graph of variables' overlays, paths and vectors follow its mapped points
    // (`aes`: a path's own group, a vector's ends — `newStyleLayer` picks them).
    case 'ellipses':
      return {
        id: 'ellipses',
        geom: 'polygon',
        stat: { kind: 'ellipse', type: 'norm', level: 0.95 },
        ...(kind === 'multipleVariables' ? { aes: {} } : {}),
      }
    case 'hull':
      return {
        id: 'hull',
        geom: 'polygon',
        stat: { kind: 'hull' },
        ...(kind === 'multipleVariables' ? { aes: {} } : {}),
      }
    case 'path':
      return {
        id: 'path',
        geom: 'path',
        stat: { kind: 'identity' },
        ...(kind === 'multipleVariables' ? { aes: {} } : {}),
      }
    case 'vectors':
      return { id: 'vectors', geom: 'segment', stat: { kind: 'identity' }, aes: {} }
    case 'groupNames':
      return { id: 'names', geom: 'label', stat: { kind: 'centroid' }, aes: {} }
    // Roadmap 34g: densities of the mapped points; a dot plot's tiles (grouped as its dots).
    case 'hexbin':
      return { id: 'hexes', geom: 'hex', stat: { kind: 'hexbin' }, aes: {} }
    case 'contours':
      return { id: 'contours', geom: 'contour', stat: { kind: 'density2d' }, aes: {} }
    case 'contourBands':
      return {
        id: 'bands',
        geom: 'contour',
        stat: { kind: 'density2d' },
        aes: {},
        style: { draw: 'bands' },
      }
    case 'densityImage':
      return { id: 'density', geom: 'raster', stat: { kind: 'density2d' }, aes: {} }
    case 'dotTiles':
      return { id: 'tiles', geom: 'tile', stat: { kind: 'dotplot' }, aes: {} }
    case 'difference':
      return { id: 'diff', geom: 'difference', stat: { kind: 'difference', ci: 'pooled' } }
    // Roadmap 49c: a tree of the rows (a dendrogram alone: of the rows too) or of the columns.
    case 'rowTree':
    case 'dendrogram':
      return { id: 'rowTree', geom: 'dendrogram', stat: { kind: 'cluster', of: 'rows' } }
    case 'columnTree':
      return { id: 'columnTree', geom: 'dendrogram', stat: { kind: 'cluster', of: 'columns' } }
    default:
      throw new Error(`no layer for plot style ${style.id}`)
  }
}

/** The plot style a layer is, for its icon and the builder's selected icons. */
export function styleOfLayer(layer: Layer, frame: Frame): PlotStyle | undefined {
  const by = (id: string) => plotStyle(id)
  if (layer.data && layer.data.from !== 'table') return undefined
  switch (layer.geom) {
    case 'points':
      if (layer.stat.kind === 'dotplot') return by('dotPlot')
      if (layer.aes) return by('bubbles')
      if (frame === 'xy') return layer.stat.kind === 'identity' ? by('each') : by('points')
      return layer.stat.kind === 'summary' ? by('means') : by('points')
    case 'line':
      if (layer.aes) return by('groupLines')
      if (frame === 'grouped' || frame === 'category') return by('joinMeans')
      return layer.stat.kind === 'identity' ? by('subjects') : by('line')
    case 'center':
      return layer.stat.by === 'subject' ? by('subjectMeans') : by('center')
    case 'bar':
      // A histogram of a variable (roadmap 34f) comes with its frame choice.
      if (layer.stat.kind === 'bin' && layer.aes) return by('histogram')
      return layer.stat.kind === 'fraction' ? by('wholeBars') : by('bars')
    case 'errorbar':
      return by('error')
    case 'label':
      return layer.stat.kind === 'centroid' ? by('groupNames') : by('labels')
    case 'refline':
      return by('grandMean')
    case 'connector':
      return by('pairs')
    case 'polygon':
      return layer.stat.kind === 'hull' ? by('hull') : by('ellipses')
    case 'path':
      return by('path')
    case 'segment':
      return by('vectors')
    case 'tile':
      return layer.stat.kind === 'dotplot' ? by('dotTiles') : by('heatmap')
    case 'contour':
      return (layer.style?.draw ?? 'lines') === 'lines' ? by('contours') : by('contourBands')
    case 'wedge':
      return by('wedges')
    case 'dendrogram':
      return layer.stat.of === 'rows' ? by('rowTree') : by('columnTree')
    default:
      return PLOT_STYLES.find((s) => s.geom === layer.geom)
  }
}

/** What the builder and the Layers list need to know of a table. */
export interface StyleContext {
  /** The table's kind, or a graph of variables' kind by the types of its axes' variables. */
  kind: MatrixKind
  /** The table holds replicate values (not entered means). */
  raw: boolean
  /** Data sets the graph shows. */
  dataSets: number
  frame: Frame
  layers: readonly Layer[]
  /**
   * Roadmap 34c: the number variables a new vector layer ends at (X end, Y end) — the first two
   * the mapped points don't put on X and Y — when the table has them.
   */
  ends?: { xend: string; yend: string }
  /**
   * Roadmap 34f: a cells table's rows (`isCellsTable`): styles drawing a mark per row aren't
   * offered (`cellsAllowed`).
   */
  cells?: { rows: number }
}

export const styleContext = (
  table: Pick<DataTable, 'tableKind' | 'yFormat' | 'dataSets'> &
    Partial<Pick<DataTable, 'rowCount' | 'cellsTable'>>,
  frame: Frame,
  layers: readonly Layer[],
  mapping?: VariableMapping | null,
): StyleContext => {
  const kind = matrixKindOf(table, mapping ? { mapping } : {})
  const ends = kind === 'multipleVariables' ? vectorEnds(layers, table) : undefined
  const rows = table.rowCount ?? 0
  const cells = isCellsTable({ ...table, rowCount: rows }) ? { cells: { rows } } : {}
  return {
    kind,
    raw: hasRawValues(table),
    dataSets: table.dataSets.filter((d) => !d.text).length,
    frame,
    layers,
    ...(ends ? { ends } : {}),
    ...cells,
  }
}

/**
 * The preset a frame choice moves the graph to: on a cells table its `cellsChoice` when it has
 * one (roadmap 34f), else `frameChoice`.
 */
export const frameChoiceOf = (
  style: PlotStyle,
  c: Pick<StyleContext, 'cells'>,
): string | undefined => (c.cells && style.cellsChoice ? style.cellsChoice : style.frameChoice)

/**
 * Roadmap 34c: the number variables a vector layer ends at — the table's first two the mapped
 * points don't put on X and Y — or undefined when it has too few.
 */
export function vectorEnds(
  layers: readonly Layer[],
  table: Pick<DataTable, 'dataSets'>,
): { xend: string; yend: string } | undefined {
  const numbers = table.dataSets.filter((d) => !d.text).map((d) => d.id as string)
  const aes = layers.find((l) => l.geom === 'points' && l.aes)?.aes
  // The mapped points' X and Y: theirs, else the first two number variables (`pickVariables`).
  const used = [aes?.x ?? numbers[0], aes?.y ?? numbers[1]]
  const free = numbers.filter((k) => !used.includes(k))
  return free.length >= 2 ? { xend: free[0]!, yend: free[1]! } : undefined
}

const no = (reason: string): Allowed => ({ allowed: false, reason })
const OK: Allowed = { allowed: true }

/** Whether the graph stacks its bars (points and lines then aren't drawn). */
export const stacked = (layers: readonly Layer[]): boolean =>
  layers.some((l) => l.geom === 'bar' && l.position?.kind === 'stack' && l.stat.kind !== 'fraction')

/**
 * Whether a plot style can be added to (or, for a frame choice, chosen for) a graph, with the
 * reason when not: the matrix for the table kind, raw values, stacked bars, the number of data
 * sets, one difference or tile per graph.
 */
export function styleAllowed(style: PlotStyle, c: StyleContext): Allowed {
  if (style.kinds && !style.kinds.includes(c.kind)) return no(`not for ${KIND_NAMES[c.kind]}`)
  if (style.frameChoice) {
    const frame = style.frames[0]!
    if (!FRAMES[c.kind].includes(frame)) return no(`not for ${KIND_NAMES[c.kind]}`)
    // A cells table (roadmap 34f): not a frame of a mark per row, unless it has another choice.
    if (style.stat && !(c.cells && style.cellsChoice))
      return cellsAllowed(c.kind, frame, style.geom, style.stat, c.cells)
    return OK
  }
  if (!style.frames.includes(c.frame)) return no('not on this kind of graph')
  const layer = styleLayer(style, c.frame, c.kind)
  const stat: StatKind = layer.stat.kind
  // A histogram draws binned bars only (roadmap 34f: a graph of variables' too).
  if (c.frame === 'xy' && binned(c.layers) && stat !== 'bin')
    return no('a histogram draws binned bars only')
  const a = geomAllowed(c.kind, layer.geom, stat, { raw: c.raw })
  if (!a.allowed) return a
  const f = frameAllowed(c.frame, c.kind, layer.geom, stat)
  if (!f.allowed) return f
  if (style.id === 'subjects' && !c.raw) return no('needs raw values')
  if (stacked(c.layers) && ['points', 'line', 'box', 'violin', 'center'].includes(layer.geom))
    return no('not with stacked bars')
  if (stackedAreas(c.layers) && UNSTACKED.area.includes(layer.geom))
    return no('not with stacked areas')
  if ((style.id === 'pairs' || style.id === 'difference') && c.dataSets < 2)
    return no('needs two or more data sets')
  if (style.id === 'difference' && c.kind === 'nested') return no('not for nested tables')
  // Roadmap 34c: a graph of variables' overlays follow its mapped points; vectors need ends.
  // Lines by group join them too (drawn, not hidden as a hexbin plot's are).
  if (
    c.kind === 'multipleVariables' &&
    (['polygon', 'path', 'segment'].includes(layer.geom) ||
      layer.stat.kind === 'centroid' ||
      (layer.geom === 'line' && !!layer.aes)) &&
    !c.layers.some((l) => l.geom === 'points' && l.aes && l.visible !== false)
  )
    return no('needs mapped points')
  // Roadmap 34g: densities follow the mapped points (drawn or hidden); a dot plot draws its own
  // statistics only.
  if (
    ['hex', 'contour', 'raster'].includes(layer.geom) &&
    !c.layers.some((l) => l.geom === 'points' && l.aes && l.stat.kind !== 'dotplot')
  )
    return no('needs mapped points')
  const dots = c.layers.some((l) => l.stat.kind === 'dotplot')
  if (stat === 'dotplot' && !dots) return no('on dot plots')
  if (dots && stat !== 'dotplot')
    return no('a dot plot draws dots and tiles of its statistics only')
  if (layer.geom === 'segment' && !c.ends)
    return no('needs two more number variables (X end, Y end)')
  // Roadmap 49c: a dendrogram alone has no cells to label.
  const tiles = c.layers.some((l) => l.geom === 'tile' && l.visible !== false)
  if (c.frame === 'matrix' && layer.geom === 'label' && !tiles) return no('values label the cells')
  // Roadmap 49c: one tree of the rows and one of the columns; one tree without a heat map.
  if (layer.geom === 'dendrogram') {
    const trees = c.layers.filter(
      (l): l is LayerOf<'dendrogram'> => l.geom === 'dendrogram' && l.visible !== false,
    )
    const of = layer.stat.kind === 'cluster' ? layer.stat.of : 'rows'
    if (trees.some((l) => l.stat.of === of)) return no(`the graph has a tree of the ${of}`)
    if (trees.length && !c.layers.some((l) => l.geom === 'tile' && l.visible !== false))
      return no('one tree without a heat map')
  }
  // Roadmap 34f: a cells table offers no mark per row.
  return cellsAllowed(c.kind, c.frame, layer.geom, stat, c.cells)
}

/** Whether a list draws a histogram (bars of binned values). */
export const binned = (layers: readonly Layer[]): boolean =>
  layers.some((l) => l.geom === 'bar' && l.stat.kind === 'bin' && l.visible !== false)

/**
 * Whether a frame choice is the graph's: its frame, and where two choices share it (a
 * multiple-variables table's XY graph: bubbles or a histogram, roadmap 34f) the one whose bars
 * bin when the graph bins.
 */
export function frameChoiceSelected(
  style: PlotStyle,
  c: Pick<StyleContext, 'kind' | 'frame' | 'layers'>,
): boolean {
  const frame = style.frames[0]
  if (!style.frameChoice || frame !== c.frame) return false
  const rivals = stylesFor(c).filter((x) => x.frameChoice && x.frames[0] === frame)
  if (rivals.length < 2) return true
  // A histogram's bins and a dot plot's statistics (roadmap 34g) say which choice the graph is.
  // Roadmap 49c: a dendrogram alone (a tree and no tiles).
  const owns = (s: PlotStyle) =>
    s.stat === 'bin'
      ? binned(c.layers)
      : s.stat === 'dotplot'
        ? c.layers.some((l) => l.stat.kind === 'dotplot')
        : s.stat === 'cluster'
          ? !c.layers.some((l) => l.geom === 'tile') &&
            c.layers.some((l) => l.geom === 'dendrogram')
          : false
  if (owns(style)) return true
  return (
    !rivals.some(owns) &&
    style.stat !== 'bin' &&
    style.stat !== 'dotplot' &&
    style.stat !== 'cluster'
  )
}

/** The plot styles a graph of a table kind shows: its frames' own and its frame choices. */
export function stylesFor(c: Pick<StyleContext, 'kind' | 'frame'>): PlotStyle[] {
  const frames = FRAMES[c.kind]
  return PLOT_STYLES.filter((s) => {
    if (s.kinds && !s.kinds.includes(c.kind)) return false
    if (s.frameChoice) return frames.length > 1 && frames.includes(s.frames[0]!)
    if (!s.frames.includes(c.frame)) return false
    // Shown only where the matrix has the geom for the table and the frame draws it (allowed or
    // not, with a reason): a multiple-variables table's XY graph maps variables (bubbles, lines
    // by group), a column table's is its histogram.
    const layer = styleLayer(s, c.frame, c.kind)
    if (!frameAllowed(c.frame, c.kind, layer.geom, layer.stat.kind).allowed) return false
    if (c.kind === 'multipleVariables' && c.frame === 'xy' && !layer.aes) return false
    const a = geomAllowed(c.kind, layer.geom, layer.stat.kind, { raw: true })
    return a.allowed || a.reason === 'needs raw values'
  })
}

/** An id for a new layer: its role's, numbered when the graph has one already. */
export function freshLayerId(base: string, layers: readonly Pick<Layer, 'id'>[]): LayerId {
  if (!layers.some((l) => l.id === base)) return base
  for (let i = 2; ; i++) if (!layers.some((l) => l.id === `${base}${i}`)) return `${base}${i}`
}

/**
 * A new layer of a style for a graph: a fresh id, the frame's position for the graph's groups
 * (side by side, at one position or stacked), attached to the bars when it attaches.
 */
export function newStyleLayer(style: PlotStyle, c: StyleContext, position?: Position): Layer {
  const base = styleLayer(style, c.frame, c.kind)
  const id = freshLayerId(base.id, c.layers)
  const host = style.attaches
    ? c.layers.find((l) =>
        c.frame === 'polar'
          ? l.geom === 'wedge'
          : c.frame === 'matrix'
            ? l.geom === 'tile'
            : l.geom === 'bar' && l.visible !== false,
      )
    : undefined
  const at =
    c.frame === 'grouped' && position && base.geom !== 'connector'
      ? { position: hostless(position) }
      : undefined
  // Vectors end at the table's next two number variables (roadmap 34c; Format › Layers changes
  // them). A dot plot's tiles group as its dots (roadmap 34g).
  const dotGroup = c.layers.find((l) => l.stat.kind === 'dotplot')?.aes?.group
  const ends =
    base.geom === 'segment' && c.ends
      ? { aes: { ...c.ends } }
      : base.stat.kind === 'dotplot' && dotGroup
        ? { aes: { group: dotGroup } }
        : undefined
  return {
    ...base,
    ...ends,
    id,
    ...(host ? { on: host.id } : {}),
    ...at,
    ...withLayersStyle(base, c.layers, host),
  } as Layer
}

/** Stacked areas fill more strongly than overlapping ones (they no longer cover each other). */
export const STACKED_AREA_OPACITY = 0.6

/**
 * An XY area layer stacked (or not): stacking also fills it more strongly, unless its opacity
 * was set; unstacking drops that again.
 */
export function stackedArea(layer: Layer, on: boolean): Layer {
  if (layer.geom !== 'area') return layer
  const { position: _, ...rest } = layer
  const style = { ...(layer.style as Record<string, unknown> | undefined) }
  if (on && style.opacity === undefined) style.opacity = STACKED_AREA_OPACITY
  if (!on && style.opacity === STACKED_AREA_OPACITY) delete style.opacity
  const { style: _s, ...bare } = rest
  return {
    ...bare,
    ...(on ? { position: { kind: 'stack' } } : {}),
    ...(Object.keys(style).length ? { style } : {}),
  } as Layer
}

/** A box inside a violin: narrow and white, as the violin-with-box preset draws it. */
export const NARROW_BOX = {
  width: 0.12,
  fill: { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 },
} as const

/** Labels on 100% stacked bars show each segment's percent. */
function withLayersStyle(
  base: Layer,
  _layers: readonly Layer[],
  host: Layer | undefined,
): { style?: Layer['style'] } {
  if (base.geom === 'label' && host?.position?.kind === 'stack' && host.position.percent)
    return { style: { ...base.style, value: 'percent' } }
  return {}
}

/**
 * A layer list with a plot style's new layer added, as the builder's icons and the Layers list's
 * Add menu add one (`newLayerIndex`, or at `at`): a mark on top, a fill behind the marks, an
 * attached layer just in front of its host. A violin and a box drawn together read as the violin-with-box preset: the box
 * narrow and white inside the violin (a violin added in front of the box goes just behind it),
 * the violin without its own centre line and quartiles (formats set on them are kept).
 */
export function withStyleLayer(
  c: StyleContext,
  layer: Layer,
  at: number = newLayerIndex(c.layers, layer),
): Layer[] {
  const layers = [...c.layers]
  layers.splice(at, 0, layer)
  // Roadmap 49c: a tree added to a heat map draws the tiles' clustering of its axis: they cluster it.
  if (layer.geom === 'dendrogram') return withClustered(layers, layer.stat.of)
  const pair =
    (layer.geom === 'violin' || layer.geom === 'box') &&
    layers.some((l) => l.geom === 'violin') &&
    layers.some((l) => l.geom === 'box')
  if (!pair) return layers
  const box = layers.findIndex((l) => l.geom === 'box')
  if (layer.geom === 'violin' && layers.indexOf(layer) > box) {
    layers.splice(layers.indexOf(layer), 1)
    layers.splice(box, 0, layer)
  }
  return layers.map((l): Layer => {
    const style = (l.style ?? {}) as Record<string, unknown>
    if (l.geom === 'box' && style.width === undefined)
      return { ...l, style: { ...NARROW_BOX, ...style } }
    if (l.geom === 'violin' && l.stat.center === 'median' && style.quartiles === undefined)
      return { ...l, stat: { ...l.stat, center: 'none' }, style: { ...style, quartiles: false } }
    return l
  })
}

/**
 * Roadmap 49c: a layer list whose heat map (its first drawn tile layer) clusters the rows or the
 * columns (`style.cluster[of]`), as turning clustering on does; the list itself when it has no
 * tiles or they already do.
 */
export function withClustered(layers: readonly Layer[], of: 'rows' | 'columns'): Layer[] {
  const tile = layers.find((l): l is LayerOf<'tile'> => l.geom === 'tile' && l.visible !== false)
  if (!tile || tile.style?.cluster?.[of]) return [...layers]
  const style = { ...tile.style, cluster: { ...tile.style?.cluster, [of]: true } }
  return layers.map((l) => (l === tile ? { ...tile, style } : l))
}

/** Roadmap 49c: a new tree layer of the rows or the columns ("Row dendrogram"…). */
export const treeLayer = (of: 'rows' | 'columns', layers: readonly Layer[] = []): Layer => ({
  id: freshLayerId(of === 'rows' ? 'rowTree' : 'columnTree', layers),
  geom: 'dendrogram',
  stat: { kind: 'cluster', of },
})

/**
 * Roadmap 49c: a layer list with a tree for each axis its heat map (its first drawn tile layer)
 * clusters that no tree layer is of yet, added at the front, the rows' first — as turning
 * clustering on adds them (and as the v2 → v3 migration added them).
 */
export function withTrees(layers: readonly Layer[]): Layer[] {
  const tile = layers.find((l): l is LayerOf<'tile'> => l.geom === 'tile' && l.visible !== false)
  const out = [...layers]
  for (const of of ['rows', 'columns'] as const) {
    if (!tile?.style?.cluster?.[of]) continue
    if (out.some((l) => l.geom === 'dendrogram' && l.stat.of === of)) continue
    out.push(treeLayer(of, out))
  }
  return out
}

// --- Names ------------------------------------------------------------------------------------

export const CENTER_LABELS: Record<string, string> = {
  mean: 'mean',
  median: 'median',
  geomean: 'geometric mean',
  none: 'no centre line',
}

export const ERROR_LABELS: Record<string, string> = {
  SD: 'SD',
  SEM: 'SEM',
  CI: '95% CI',
  range: 'range',
  IQR: 'IQR',
  MAD: 'MAD',
  MADn: 'MADn',
  geoSD: 'geometric SD',
  geoCI: 'geometric CI',
  none: 'none',
}

export const WHISKER_LABELS: Record<string, string> = {
  minmax: 'min to max',
  tukey: 'Tukey',
  p1p99: '1–99%',
  p025p975: '2.5–97.5%',
  p5p95: '5–95%',
  p10p90: '10–90%',
}

/** What a layer's stat shows, in words ("mean", "SD", "every value"). */
export function statText(layer: Pick<Layer, 'geom' | 'stat' | 'aes'>, frame: Frame): string {
  const s = layer.stat
  switch (s.kind) {
    case 'identity':
      if (layer.geom === 'points') return frame === 'xy' ? 'each replicate' : 'every value'
      if (layer.geom === 'line') return layer.aes ? 'each row' : 'each replicate'
      if (layer.geom === 'path') return 'row order'
      if (layer.geom === 'segment') return 'each row'
      return 'values'
    case 'summary':
      if (s.by === 'all') return 'grand mean'
      if (layer.geom === 'errorbar' || layer.geom === 'band')
        return ERROR_LABELS[s.error ?? 'none']!
      return CENTER_LABELS[s.center]! + (s.by === 'subject' ? ' of each subject' : '')
    case 'boxplot':
      return `whiskers ${WHISKER_LABELS[s.whiskers]}`
    case 'range':
      return 'min to max'
    case 'density':
      return 'density'
    case 'km':
      return layer.geom === 'band' ? 'CI' : 'Kaplan-Meier'
    case 'fraction':
      return 'percent'
    case 'difference':
      return s.ci === 'welch' ? 'Welch CI' : 'pooled CI'
    case 'cell':
      return s.standardize && s.standardize !== 'none' ? 'z-scores' : 'cell means'
    case 'bin':
      return { count: 'counts', percent: 'percent', fraction: 'fraction' }[s.measure ?? 'count']
    case 'ellipse':
      return `${+(s.level * 100).toPrecision(4)}% ${ELLIPSE_LABELS[s.type]}`
    case 'hull':
      return 'each group'
    case 'centroid':
      return s.center === 'mean' ? 'group means' : 'group medians'
    case 'hexbin':
      return 'counts'
    case 'density2d':
      return layer.geom === 'raster'
        ? '2D density'
        : s.levels === 'shares'
          ? 'shares of the points'
          : 'density levels'
    case 'dotplot':
      return s.scale === false ? 'averages' : 'scaled averages'
    case 'result':
      return layer.geom === 'label'
        ? 'analysis results'
        : s.drop
          ? 'drop lines'
          : layer.geom === 'band'
            ? 'result range'
            : 'result value'
    case 'threshold':
      return 'significance'
    case 'cluster':
      return !s.cut
        ? 'hierarchical clustering'
        : 'k' in s.cut
          ? `${s.cut.k} cluster${s.cut.k === 1 ? '' : 's'}`
          : `cut at ${+s.cut.h.toPrecision(6)}`
  }
}

/** The kinds of ellipse, in words (roadmap 34c). */
export const ELLIPSE_LABELS: Record<'norm' | 'mean' | 't', string> = {
  norm: 'normal',
  mean: 'mean',
  t: 'robust t',
}

/** Names of layers drawing analysis outputs and functions, by their usual ids. */
const DATA_NAMES: Record<string, string> = {
  curves: 'Fitted curves',
  curveBands: 'Curve bands',
  curvePoints: 'Curve points',
  functions: 'Functions',
}

/** A layer's name: its own, else generated from its plot style and stat ("Bars (mean)"). */
export function layerTitle(layer: Layer, frame: Frame): string {
  if (layer.name) return layer.name
  // Roadmap 46b: points classed by the graph's cut-offs, of whichever data the layer reads.
  if (layer.stat.kind === 'threshold') return 'Significance'
  // Roadmap 46b: a sloped reference line by its equation ("Identity line (y = x)").
  if (layer.geom === 'refline' && layer.stat.kind === 'result' && layer.stat.slope !== undefined) {
    const ab = slopedValues(layer.stat)
    if (!ab) return 'Reference line'
    const eq = lineEquation(ab.a, ab.b)
    return ab.a === 1 && ab.b === 0 ? `Identity line (${eq})` : `Reference line (${eq})`
  }
  if (layer.data && layer.data.from !== 'table')
    return DATA_NAMES[layer.id] ?? `${layer.geom === 'band' ? 'Bands' : 'Curves'} (${layer.id})`
  // Roadmap 49c: a tree by what it is of ("Row dendrogram").
  if (layer.geom === 'dendrogram')
    return layer.stat.of === 'rows' ? 'Row dendrogram' : 'Column dendrogram'
  const style = styleOfLayer(layer, frame)
  const base = style?.frameChoice
    ? {
        heatmap: 'Heat map',
        bubbles: 'Bubbles',
        wedges: 'Slices',
        wholeBars: 'Bars',
        dotPlot: 'Dot plot',
      }[style.id]
    : style?.label
  return `${base ?? layer.geom} (${statText(layer, frame)})`
}

/** A stacked graph's other layers sit at the row's centre. */
const hostless = (p: Position): Position => (p.kind === 'stack' ? { kind: 'aligned' } : p)
