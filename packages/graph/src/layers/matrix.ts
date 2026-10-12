import {
  type DataTable,
  type Frame,
  type Geom,
  type GraphNode,
  type Layer,
  type LayerOf,
  type Position,
  type StatKind,
  TableKind,
} from '@ps/model'

// The compatibility matrix (roadmap 33, design §3): which geoms, stats and positions a table kind
// allows, with the reason when not. One table for the builder, the Layers list, presets and
// validation; a layer a table can't support stays in the document and is drawn as far as
// possible. DATA_MODEL.md §6.2a is generated from it (`matrixMarkdown`; a test keeps them equal).
//
// Graphs of a multiple-variables table's variables (roadmap 34a) are kinds of their own here, by
// the types of the variables on their axes (`MV_KINDS`): text × number (categories along X),
// number × text (the same turned: categories down the left) and text × text (counts). A number ×
// number graph, and a graph of the variables as columns or as a heat map, is the table's own kind.

export interface Allowed {
  allowed: boolean
  /** Why not, for the UI ("needs raw values", "not with stacked bars"…). */
  reason?: string
}

const OK: Allowed = { allowed: true }
const no = (reason: string): Allowed => ({ allowed: false, reason })

/** Graphs of variables by the types of their axes' variables (X × Y). */
export const MV_KINDS = ['mvTextNumber', 'mvNumberText', 'mvTextText'] as const
export type MvKind = (typeof MV_KINDS)[number]
/** What the matrix is kept for: a table kind, or a graph of variables by its axes' types. */
export type MatrixKind = TableKind | MvKind
/** Every matrix kind, table kinds first. */
export const MATRIX_KINDS: readonly MatrixKind[] = [...TableKind.options, ...MV_KINDS]

/** The matrix kind of a graph of a table: by its mapped variables' types (34a), else its kind. */
export function matrixKindOf(
  table: Pick<DataTable, 'tableKind' | 'dataSets'>,
  graph: Pick<GraphNode, 'mapping'>,
): MatrixKind {
  const m = graph.mapping
  if (table.tableKind !== 'multipleVariables' || !m) return table.tableKind
  const text = (k: string) => !!table.dataSets.find((d) => d.id === k)?.text
  const [x, y] = [text(m.x), text(m.y)]
  return x && y ? 'mvTextText' : x ? 'mvTextNumber' : y ? 'mvNumberText' : 'multipleVariables'
}

/** A matrix kind in words, for reasons ("not for nested tables"). */
export const KIND_NAMES: Readonly<Record<MatrixKind, string>> = {
  ...(Object.fromEntries(TableKind.options.map((k) => [k, `${k} tables`])) as Record<
    TableKind,
    string
  >),
  mvTextNumber: 'a number variable by a text variable',
  mvNumberText: 'a number variable by a text variable',
  mvTextText: 'two text variables',
}

/** Frames per table kind, the usual one first. */
export const FRAMES: Record<MatrixKind, readonly Frame[]> = {
  column: ['category', 'xy'],
  nested: ['category'],
  grouped: ['grouped', 'matrix'],
  contingency: ['grouped', 'matrix'],
  xy: ['xy'],
  survival: ['xy'],
  partsOfWhole: ['polar', 'category'],
  multipleVariables: ['category', 'xy', 'matrix'],
  // Categories alone (category), or split by a text variable mapped to colour (grouped).
  mvTextNumber: ['category', 'grouped'],
  mvNumberText: ['category', 'grouped'],
  // Counts of each combination: bars by the X levels (grouped), or a heat map.
  mvTextText: ['grouped', 'matrix'],
}

type Rows = Partial<Record<MatrixKind, readonly StatKind[]>>
const COLUMNS = ['column', 'nested', 'multipleVariables'] as const
/** Graphs of a number variable by the levels of a text variable (either way round). */
const LEVELS = ['mvTextNumber', 'mvNumberText'] as const
const each = (kinds: readonly MatrixKind[], stats: readonly StatKind[]): Rows =>
  Object.fromEntries(kinds.map((k) => [k, stats]))

/**
 * Roadmap 35: where layers of an analysis' results (stat `result`: labels, reference lines and
 * bands at its values) are drawn — every graph with a value axis (not pies, 100% bars or heat
 * maps).
 */
const RESULT_KINDS: readonly MatrixKind[] = [
  ...COLUMNS,
  ...LEVELS,
  'mvTextText',
  'grouped',
  'contingency',
  'xy',
  'survival',
]
/** The geoms an analysis' results draw: labels of its values, lines at one, bands between two. */
export const RESULT_GEOMS: readonly Geom[] = ['label', 'refline', 'band']
/** Each geom's stats, with `result` added for the kinds results are drawn on (roadmap 35). */
const withResults = (geom: Geom, rows: Rows): Rows => {
  if (!RESULT_GEOMS.includes(geom)) return rows
  const out: Partial<Record<MatrixKind, readonly StatKind[]>> = { ...rows }
  for (const k of RESULT_KINDS) out[k] = [...(rows[k] ?? []), 'result']
  return out
}

/** Stats each geom allows per table kind (design §3.2). */
const GEOM_STATS_OWN: Readonly<Record<Geom, Rows>> = {
  points: {
    ...each([...COLUMNS, ...LEVELS, 'grouped'], ['identity', 'summary']),
    // Roadmap 46b: points classed by the graph's cut-offs (a volcano plot's significance).
    xy: ['identity', 'summary', 'threshold'],
    // Roadmap 34g: a dot plot's dots, per variable and group (the matrix frame).
    // Roadmap 46b: a graph of variables' mapped points classed by the graph's cut-offs.
    multipleVariables: ['identity', 'summary', 'dotplot', 'threshold'],
    contingency: ['identity'],
  },
  bar: {
    // Text × text: each combination's count (or percent), as a contingency table's cells.
    ...each([...COLUMNS, ...LEVELS, 'grouped', 'mvTextText'], ['summary']),
    // A column table's histogram (its xy graph): the values binned; a multiple-variables table's
    // (roadmap 34f): a number variable's values binned (`aes.x`), per level of a text variable.
    column: ['summary', 'bin'],
    multipleVariables: ['summary', 'bin'],
    contingency: ['summary'],
    xy: ['identity', 'summary'],
    partsOfWhole: ['fraction'],
  },
  errorbar: each([...COLUMNS, ...LEVELS, 'grouped', 'xy'], ['summary']),
  center: each([...COLUMNS, ...LEVELS, 'grouped'], ['summary']),
  box: { ...each([...COLUMNS, ...LEVELS, 'grouped'], ['boxplot', 'range']), xy: ['boxplot'] },
  violin: each([...COLUMNS, ...LEVELS, 'grouped'], ['density']),
  line: {
    // Means joined across the categories or rows; multiple variables also by group (xy).
    ...each([...COLUMNS, ...LEVELS], ['summary']),
    multipleVariables: ['summary', 'identity'],
    grouped: ['summary'],
    xy: ['summary', 'identity'],
  },
  step: { survival: ['km'], xy: ['summary'] },
  censor: { survival: ['km'] },
  area: { xy: ['summary'] },
  // Analysis outputs' bands (identity) are allowed on any xy graph (`geomAllowed`'s `outputs`).
  band: { ...each([...LEVELS, 'grouped'], ['summary']), xy: ['summary'], survival: ['km'] },
  // Before-after lines join a row's values across variables: a level's rows are its own.
  // Grouped tables (roadmap 34c): a subject's values (one replicate index) joined across the
  // data sets within each row (pair lines).
  connector: each(['column', 'multipleVariables', 'grouped'], ['identity']),
  refline: each([...COLUMNS, ...LEVELS], ['summary']),
  difference: each(['column', 'multipleVariables', ...LEVELS], ['difference']),
  tile: {
    grouped: ['cell'],
    contingency: ['cell'],
    // Roadmap 34g: a dot plot's averages as tiles (a matrix plot).
    multipleVariables: ['identity', 'cell', 'dotplot'],
    mvTextText: ['cell'],
  },
  wedge: { partsOfWhole: ['fraction'] },
  label: {
    // A summary's value above its marks (XY: also each point's); heat-map values label the cells.
    ...each([...COLUMNS, ...LEVELS], ['summary']),
    mvTextText: ['summary', 'cell'],
    xy: ['summary', 'identity'],
    grouped: ['summary', 'cell'],
    // Roadmap 34e: each group's name at its centre, on a graph of variables' XY graph.
    multipleVariables: ['summary', 'cell', 'centroid'],
    contingency: ['summary', 'cell'],
    partsOfWhole: ['fraction'],
  },
  // Roadmap 34c: group overlays on XY graphs — an XY table's data sets, a graph of variables'
  // groups (its colour or shape variable's levels).
  polygon: each(['xy', 'multipleVariables'], ['ellipse', 'hull']),
  path: each(['xy', 'multipleVariables'], ['identity']),
  segment: { multipleVariables: ['identity'] },
  // Roadmap 34g: densities of a graph of variables' points — hexagons counting them, contours and
  // images of their 2D density.
  hex: { multipleVariables: ['hexbin'] },
  contour: { multipleVariables: ['density2d'] },
  raster: { multipleVariables: ['density2d'] },
  // Roadmap 49c: the trees of a heat map's clustered rows and columns, or a tree alone, of the
  // tables heat maps draw.
  dendrogram: each(['grouped', 'contingency', 'multipleVariables', 'mvTextText'], ['cluster']),
}

/** Stats each geom allows per table kind (design §3.2), results' included (roadmap 35). */
export const GEOM_STATS: Readonly<Record<Geom, Rows>> = Object.fromEntries(
  (Object.entries(GEOM_STATS_OWN) as [Geom, Rows][]).map(([g, rows]) => [g, withResults(g, rows)]),
) as Record<Geom, Rows>

/** Stats computed from every replicate: not from entered means (mean/SD/N formats). */
export const RAW_STATS: ReadonlySet<StatKind> = new Set([
  'boxplot',
  'range',
  'density',
  'bin',
  'hexbin',
  'density2d',
  'dotplot',
])

/**
 * Whether a table kind allows a geom with a stat (outputs and functions: any xy graph). `raw`:
 * the table holds replicate values (not entered means).
 */
export function geomAllowed(
  kind: MatrixKind,
  geom: Geom,
  stat: StatKind,
  opts: { raw?: boolean; outputs?: boolean } = {},
): Allowed {
  if (opts.outputs)
    return (['line', 'points', 'band'].includes(geom) && stat === 'identity') ||
      (geom === 'points' && stat === 'threshold')
      ? OK
      : no('analysis outputs draw lines, points and bands')
  const stats = GEOM_STATS[geom][kind]
  if (!stats) return no(`not for ${KIND_NAMES[kind]}`)
  if (!stats.includes(stat)) return no(`not with this summary for ${KIND_NAMES[kind]}`)
  if (opts.raw === false && (RAW_STATS.has(stat) || (geom === 'connector' && stat === 'identity')))
    return no('needs raw values')
  return OK
}

/**
 * What a frame draws of a table kind, beyond the kind's row: bins need an xy graph, and a column
 * table's xy graph is its histogram (binned bars only); a multiple-variables table's xy graph
 * maps variables (a point per row, lines by group); lines on a category graph join means.
 */
export function frameAllowed(frame: Frame, kind: MatrixKind, geom: Geom, stat: StatKind): Allowed {
  // Roadmap 35: an analysis' results go on every graph with value axes.
  if (stat === 'result')
    return frame === 'matrix' || frame === 'polar'
      ? no('results are drawn on graphs with value axes')
      : OK
  // Heat maps draw tiles and their values; pies slices and their labels; nothing else does.
  if (geom === 'tile' && frame !== 'matrix') return no('tiles make heat maps')
  if (geom === 'wedge' && frame !== 'polar') return no('slices make pies')
  // Roadmap 46b: the significance of points along continuous X and Y.
  if (stat === 'threshold')
    return frame === 'xy' ? OK : no('significance colours XY graphs’ points')
  // Roadmap 34g: a dot plot (variables by groups) is a grid of dots and tiles.
  if (stat === 'dotplot')
    return frame === 'matrix' ? OK : no('dot plots are grids of variables by groups')
  // Roadmap 49c: trees stand beside heat maps, or alone on their frame.
  if (geom === 'dendrogram' && frame !== 'matrix')
    return no('dendrograms are of heat maps’ rows and columns')
  if (
    frame === 'matrix' &&
    !(geom === 'tile' || geom === 'dendrogram' || (geom === 'label' && stat === 'cell'))
  )
    return no('a heat map draws tiles, their values and dendrograms')
  if (stat === 'cell' && frame !== 'matrix') return no('cell values label heat maps')
  if (stat === 'centroid' && frame !== 'xy')
    return no('group names at their centres are on XY graphs')
  if (frame === 'polar' && geom !== 'wedge' && geom !== 'label')
    return no('a pie draws slices and their labels')
  if (stat === 'fraction' && frame !== 'polar' && frame !== 'category')
    return no('shares of the whole are pies and 100% bars')
  if (stat === 'bin') return frame === 'xy' ? OK : no('histograms are XY graphs')
  if (frame === 'xy' && kind === 'column') return no('a histogram draws binned bars')
  // Group overlays, paths and vectors (roadmap 34c) are drawn on XY graphs.
  if (XY_ONLY.includes(geom) && frame !== 'xy') return no('drawn on XY graphs')
  if (frame === 'xy' && kind === 'multipleVariables')
    return ((geom === 'points' || geom === 'line') && stat === 'identity') ||
      XY_ONLY.includes(geom) ||
      (geom === 'label' && stat === 'centroid')
      ? OK
      : no(
          'a graph of variables draws points, lines, paths, vectors, overlays, densities and names by group',
        )
  if (frame === 'category' && geom === 'line' && stat !== 'summary')
    return no('lines by group are for XY graphs')
  // Bands join a grouped graph's rows; a grand mean and differences stand on category graphs.
  if (geom === 'band' && frame === 'category') return no('bands join the rows of grouped graphs')
  if ((geom === 'refline' || geom === 'difference') && frame !== 'category')
    return no('drawn on graphs of one category per group')
  return OK
}

/** Roadmap 34g: densities of a graph of variables' mapped points. */
const DENSITY_GEOMS: readonly Geom[] = ['hex', 'contour', 'raster']

/** Geoms drawn on XY graphs only (roadmap 34c; 34g's densities of the mapped points). */
const XY_ONLY: readonly Geom[] = ['polygon', 'path', 'segment', 'hex', 'contour', 'raster']

/** Positions per geom and frame (design §3.3); attached layers take their host's. */
export function positionAllowed(frame: Frame, geom: Geom, position: Position | undefined): Allowed {
  const kind = position?.kind ?? 'identity'
  if (position?.kind === 'stack') {
    if (geom === 'bar') return OK
    if (geom === 'area' && frame === 'xy') return position.percent ? no('areas stack by value') : OK
    return no('only bars and XY areas stack')
  }
  if (frame === 'grouped')
    return GROUPED_POSITIONED.includes(geom) || kind === 'identity' ? OK : no('not side by side')
  if (frame === 'category' && kind === 'dodge')
    return position?.kind === 'dodge' &&
      position.by === 'subject' &&
      ['points', 'center'].includes(geom)
      ? OK
      : no('only subjects of nested groups stand side by side')
  return kind === 'identity' ? OK : no('not on this frame')
}

/** Geoms that sit side by side or at the row's centre on a grouped graph. */
const GROUPED_POSITIONED: readonly Geom[] = [
  'points',
  'bar',
  'box',
  'violin',
  'line',
  'band',
  'errorbar',
  'label',
  'center',
]

/** Geoms a stack of bars or of XY areas leaves out: they would sit at unstacked values. */
export const UNSTACKED: Readonly<Record<'bar' | 'area', readonly Geom[]>> = {
  bar: ['points', 'line'],
  area: ['points', 'line', 'step', 'errorbar', 'band', 'path', 'polygon'],
}

/** Whether a graph stacks its XY areas. */
export const stackedAreas = (layers: readonly Layer[]): boolean =>
  layers.some((l) => l.geom === 'area' && l.position?.kind === 'stack' && l.visible !== false)

/** The layer a heat map, a pie or 100% bars draw from (their values and labels sit on it). */
const isWhole = (l: Layer) =>
  l.geom === 'tile' || l.geom === 'wedge' || (l.geom === 'bar' && l.stat.kind === 'fraction')

/**
 * Each drawn layer of a graph against the matrix, with the graph's own rules: at most one
 * difference layer, one tile, slice or 100% bars layer (with at most one labels layer, on it) and
 * one layer of mapped points; no points or lines with stacked bars (or areas); lines by group
 * only with mapped points.
 */
export function checkLayers(
  graph: Pick<GraphNode, 'frame' | 'layers'>,
  kind: MatrixKind,
  opts: { raw?: boolean } = {},
): Map<string, Allowed> {
  const out = new Map<string, Allowed>()
  const drawn = graph.layers.filter((l) => l.visible !== false)
  const stacked = drawn.some((l) => l.geom === 'bar' && l.position?.kind === 'stack')
  const areas = stackedAreas(drawn)
  const count = (g: Geom) => drawn.filter((l) => l.geom === g).length
  const whole = drawn.find(isWhole)
  const wholeFrame = graph.frame === 'matrix' || graph.frame === 'polar' || !!whole
  // The mapped points: not a dot plot's dots, nor a Significance layer's (roadmap 46b).
  const mappedPoints = (l: Layer) =>
    l.geom === 'points' && !!l.aes && l.stat.kind !== 'dotplot' && l.stat.kind !== 'threshold'
  const mapped = drawn.find(mappedPoints)
  const mappedAny = graph.layers.some(mappedPoints)
  const dotPlot = drawn.some((l) => l.stat.kind === 'dotplot')
  const binned = drawn.some((l) => l.geom === 'bar' && l.stat.kind === 'bin')
  const data = (l: Layer): Layer['data'] => {
    let d = l.data
    for (let i = 0; d?.from === 'layer' && i < graph.layers.length; i++) {
      const id: string = d.layer
      d = graph.layers.find((x) => x.id === id)?.data
    }
    return d
  }
  // An analysis' own XY graph (its outputs: a volcano plot of a grouped table's tests).
  const outputsGraph =
    graph.frame === 'xy' &&
    drawn.some((l) => {
      const d = data(l)
      return d?.from === 'outputs' || d?.from === 'functions'
    })
  for (const l of drawn) {
    const d = data(l)
    const outputs = d?.from === 'outputs' || d?.from === 'functions'
    // Roadmap 46b: lines and bands at values or results stand on such a graph too.
    const valued = d?.from === 'values' || d?.from === 'analysis'
    let a = geomAllowed(kind, l.geom, l.stat.kind, { ...opts, outputs })
    if (
      a.allowed &&
      !FRAMES[kind].includes(graph.frame) &&
      !((outputs || (valued && outputsGraph)) && graph.frame === 'xy')
    )
      a = no(`not a ${graph.frame} graph of ${KIND_NAMES[kind]}`)
    if (a.allowed && !outputs) a = frameAllowed(graph.frame, kind, l.geom, l.stat.kind)
    if (a.allowed && !l.on) a = positionAllowed(graph.frame, l.geom, l.position)
    if (a.allowed && stacked && UNSTACKED.bar.includes(l.geom)) a = no('not with stacked bars')
    if (a.allowed && areas && !outputs && UNSTACKED.area.includes(l.geom))
      a = no('not with stacked areas')
    if (a.allowed && (l.geom === 'difference' || l.geom === 'tile') && count(l.geom) > 1)
      a = no(`one ${l.geom} layer per graph`)
    if (a.allowed && isWhole(l) && whole !== l) a = no('one layer of slices or 100% bars per graph')
    // A heat map's values, a pie's or 100% bars' labels: one layer, on the tiles, slices or bars.
    if (a.allowed && l.geom === 'label' && (wholeFrame || l.stat.kind === 'fraction'))
      a =
        !whole || l.on !== whole.id
          ? no('labels here sit on the tiles, slices or bars')
          : drawn.find((x) => x.geom === 'label' && x.on === whole.id) !== l
            ? no('one labels layer on them')
            : OK
    if (a.allowed && mappedPoints(l) && mapped !== l) a = no('one layer of mapped points per graph')
    // Roadmap 46b: a graph of variables' Significance classes its mapped points.
    if (a.allowed && kind === 'multipleVariables' && l.stat.kind === 'threshold' && !mapped)
      a = no('needs mapped points')
    // A dot plot (roadmap 34g) draws its dots and tiles only, grouped by a text variable.
    if (a.allowed && dotPlot && l.stat.kind !== 'dotplot')
      a = no('a dot plot draws dots and tiles of its statistics only')
    if (a.allowed && l.stat.kind === 'dotplot' && !l.aes?.group)
      a = no('needs a text variable to group by')
    // Roadmap 49c: one tree of the rows and one of the columns beside a heat map; one tree alone.
    if (a.allowed && l.geom === 'dendrogram') {
      const trees = drawn.filter((x): x is LayerOf<'dendrogram'> => x.geom === 'dendrogram')
      if (trees.find((x) => x.stat.of === l.stat.of) !== l)
        a = no(`one tree of the ${l.stat.of} per graph`)
      else if (!whole && trees[0] !== l) a = no('one tree without a heat map')
    }
    if (a.allowed && l.aes && l.geom === 'line' && !mapped)
      a = no('lines by group join mapped points')
    // A graph of variables' overlays, paths and vectors follow its mapped points (roadmap 34c).
    // Densities (roadmap 34g) follow the mapped points even hidden (a hexbin plot hides them).
    const density = DENSITY_GEOMS.includes(l.geom)
    if (
      a.allowed &&
      kind === 'multipleVariables' &&
      (XY_ONLY.includes(l.geom) || l.stat.kind === 'centroid') &&
      !(density ? mappedAny : mapped)
    )
      a = no('needs mapped points')
    if (a.allowed && l.geom === 'segment' && !(l.aes?.xend && l.aes.yend))
      a = no('needs X end and Y end variables')
    // A histogram (roadmap 34f) draws binned bars only (analysis outputs and functions aside);
    // a graph of variables' bins a number variable on X.
    if (
      a.allowed &&
      graph.frame === 'xy' &&
      binned &&
      !outputs &&
      l.stat.kind !== 'bin' &&
      l.stat.kind !== 'result'
    )
      a = no('a histogram draws binned bars only')
    if (a.allowed && l.stat.kind === 'bin' && kind === 'multipleVariables' && !l.aes?.x)
      a = no('needs a number variable on X')
    out.set(l.id, a)
  }
  return out
}

// --- Variables mapped to appearance (roadmap 34b) -------------------------------------------

/** An aesthetic with the type of variable mapped to it. */
export type AesKind = 'colorText' | 'colorNumber' | 'fill' | 'shape' | 'size' | 'label'
export const AES_KINDS: readonly AesKind[] = [
  'colorText',
  'colorNumber',
  'fill',
  'shape',
  'size',
  'label',
]

/** Every geom a graph of a number variable by a text variable's levels draws. */
const LEVEL_GEOMS = (Object.keys(GEOM_STATS) as Geom[]).filter((g) => GEOM_STATS[g].mvTextNumber)
/** Marks of one table row each: the points of every value. */
const ROW_MARKS: readonly Geom[] = ['points']

/**
 * The geoms each aesthetic colours, shapes, sizes or labels, per graph of variables: a text
 * colour variable makes the groups (every geom of the grouped graph; on an XY graph each row's
 * point and the lines by group), the others act on each row's point (its colour on a colour
 * map, its symbol by level, its size, its label). Text × text graphs count rows: colour is their
 * Y variable, nothing else maps.
 */
export const AES_GEOMS: Readonly<Record<AesKind, Partial<Record<MatrixKind, readonly Geom[]>>>> = {
  colorText: {
    mvTextNumber: LEVEL_GEOMS,
    mvNumberText: LEVEL_GEOMS,
    // Roadmap 34c: each group's ellipse, hull and path, each row's vector; 34g: each group's
    // density contours.
    multipleVariables: ['points', 'line', 'polygon', 'path', 'segment', 'contour'],
  },
  colorNumber: {
    mvTextNumber: ROW_MARKS,
    mvNumberText: ROW_MARKS,
    multipleVariables: [...ROW_MARKS, 'segment'],
  },
  // Roadmap 49d: a second colour scale, filling each row's point (text or number variable).
  fill: { mvTextNumber: ROW_MARKS, mvNumberText: ROW_MARKS, multipleVariables: ROW_MARKS },
  shape: { mvTextNumber: ROW_MARKS, mvNumberText: ROW_MARKS, multipleVariables: ROW_MARKS },
  size: { mvTextNumber: ROW_MARKS, mvNumberText: ROW_MARKS, multipleVariables: ROW_MARKS },
  label: { mvTextNumber: ROW_MARKS, mvNumberText: ROW_MARKS, multipleVariables: ROW_MARKS },
}

/** The aesthetic kind of a variable of a type mapped to colour, shape, size or labels. */
export function aesKind(
  aes: 'color' | 'fill' | 'shape' | 'size' | 'label',
  type: 'number' | 'text',
): AesKind | null {
  if (aes === 'color') return type === 'text' ? 'colorText' : 'colorNumber'
  if (aes === 'fill') return 'fill'
  if (aes === 'shape') return type === 'text' ? 'shape' : null
  if (aes === 'size') return type === 'number' ? 'size' : null
  return 'label'
}

const AES_WORDS: Record<AesKind, string> = {
  colorText: 'colour by a text variable',
  colorNumber: 'colour by a number variable',
  fill: 'fill by a variable',
  shape: 'shape',
  size: 'size',
  label: 'labels',
}

/**
 * Whether a variable of a type can be mapped to an aesthetic on a graph of a matrix kind with
 * these layers: the kind allows it (a multiple-variables table's own kind on its XY graph only)
 * and a drawn layer takes it (points of every row for shape, size, labels and colour by a number).
 * A cells table (roadmap 34f, `cells`: its rows) labels at most `MAX_ROW_LABELS` rows.
 */
export function aesAllowed(
  kind: MatrixKind,
  frame: Frame,
  aes: 'color' | 'fill' | 'shape' | 'size' | 'label',
  type: 'number' | 'text',
  layers: readonly Layer[],
  cells?: { rows: number } | null,
): Allowed {
  const k = aesKind(aes, type)
  if (!k) return no(aes === 'shape' ? 'shapes are a text variable’s levels' : 'sizes need numbers')
  if (k === 'label' && !cellsLabelsAllowed(cells).allowed) return cellsLabelsAllowed(cells)
  const geoms = AES_GEOMS[k][kind]
  if (!geoms || (kind === 'multipleVariables' && frame !== 'xy'))
    return no(`no ${AES_WORDS[k]} for ${KIND_NAMES[kind]}`)
  const takes = layers.some(
    (l) =>
      l.visible !== false &&
      geoms.includes(l.geom) &&
      (k === 'colorText' || l.stat.kind === 'identity'),
  )
  return takes ? OK : no(k === 'colorText' ? 'no layer to colour' : 'needs points of every row')
}

// --- Cells tables (roadmap 34f) -------------------------------------------------------------

/**
 * A layer that draws a mark for every table row within categories, or joins every row: its cost
 * and clutter grow with the rows, so a cells table (`isCellsTable`: single-cell or cytometry
 * data, tens of thousands of rows) doesn't offer it. Scatters of the rows (XY graphs of variables,
 * one point cloud) and summaries (boxes, violins, bars, means, counts, histograms) scale.
 */
export interface RowMarkLayer {
  geom: Geom
  stats: readonly StatKind[]
  frames: readonly Frame[]
  kinds: readonly MatrixKind[]
  /** What there are too many of, for the reason ("too many points for a swarm"). */
  too: string
  /** What to use instead, a sentence ("Use a violin or box."). */
  instead: string
  /** The plot style Format offers in its place (absent: hide it). */
  summary?: 'violin' | 'joinMeans'
}

const VARIABLES: readonly MatrixKind[] = ['multipleVariables', ...LEVELS]

/** Layers drawing a mark per row (roadmap 34f, decision 431); DATA_MODEL §6.2a lists them. */
export const ROW_MARK_LAYERS: readonly RowMarkLayer[] = [
  {
    geom: 'points',
    stats: ['identity'],
    frames: ['category', 'grouped'],
    kinds: VARIABLES,
    too: 'too many points for a swarm',
    instead: 'Use a violin or box.',
    summary: 'violin',
  },
  {
    geom: 'connector',
    stats: ['identity'],
    frames: ['category', 'grouped'],
    kinds: VARIABLES,
    too: 'too many lines for before–after lines',
    instead: 'Join the means instead.',
    summary: 'joinMeans',
  },
  {
    geom: 'path',
    stats: ['identity'],
    frames: ['xy'],
    kinds: ['multipleVariables'],
    too: 'too many rows to join in a path',
    instead: 'Use ellipses, hulls or group names.',
  },
  {
    geom: 'segment',
    stats: ['identity'],
    frames: ['xy'],
    kinds: ['multipleVariables'],
    too: 'too many arrows for vectors',
    instead: 'Use a scatter coloured by a variable.',
  },
  {
    geom: 'line',
    stats: ['identity'],
    frames: ['xy'],
    kinds: ['multipleVariables'],
    too: 'too many rows to join in lines by group',
    instead: 'Use ellipses, hulls or group names.',
  },
  {
    geom: 'tile',
    stats: ['identity', 'cell'],
    frames: ['matrix'],
    kinds: ['multipleVariables'],
    too: 'too many rows for a heat map of every value',
    instead: 'Count two text variables, or use violins.',
  },
  {
    geom: 'label',
    stats: ['cell'],
    frames: ['matrix'],
    kinds: ['multipleVariables'],
    too: 'too many values to label',
    instead: 'Count two text variables, or use violins.',
  },
  // Roadmap 49c: a tree of every row (at most 2,000 rows are clustered).
  {
    geom: 'dendrogram',
    stats: ['cluster'],
    frames: ['matrix'],
    kinds: ['multipleVariables'],
    too: 'too many rows to cluster',
    instead: 'Count two text variables, or use violins.',
  },
]

/** The per-row entry a layer is (roadmap 34f), if any. */
export function rowMarkLayer(
  kind: MatrixKind,
  frame: Frame,
  geom: Geom,
  stat: StatKind,
): RowMarkLayer | undefined {
  return ROW_MARK_LAYERS.find(
    (r) =>
      r.geom === geom &&
      r.stats.includes(stat) &&
      r.frames.includes(frame) &&
      r.kinds.includes(kind),
  )
}

/** Rows written for a reason: "16,171 rows". */
const rowsText = (rows: number) => `${rows.toLocaleString('en-US')} row${rows === 1 ? '' : 's'}`

/**
 * Whether a cells table (`cells`: its rows; null: not a cells table) offers a layer (roadmap
 * 34f): not one drawing a mark per row, with the reason ("16,171 rows: too many points for a
 * swarm. Use a violin or box."). Layers already on a graph keep drawing (`checkLayers` doesn't
 * ask); Format offers their summary (`RowMarkLayer.summary`).
 */
export function cellsAllowed(
  kind: MatrixKind,
  frame: Frame,
  geom: Geom,
  stat: StatKind,
  cells: { rows: number } | null | undefined,
): Allowed {
  if (!cells) return OK
  const r = rowMarkLayer(kind, frame, geom, stat)
  return r ? no(`${rowsText(cells.rows)}: ${r.too}. ${r.instead}`) : OK
}

/** Most rows labelled one by one (labels from a variable) on a cells table (roadmap 34f). */
export const MAX_ROW_LABELS = 1000

/** Whether a cells table offers labels from a variable: on at most `MAX_ROW_LABELS` rows. */
export function cellsLabelsAllowed(cells: { rows: number } | null | undefined): Allowed {
  return cells && cells.rows > MAX_ROW_LABELS
    ? no(`${rowsText(cells.rows)}: too many labels. Use group names.`)
    : OK
}
