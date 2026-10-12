import { Geom, type StatKind } from '@ps/model'
import {
  AES_GEOMS,
  AES_KINDS,
  type AesKind,
  FRAMES,
  GEOM_STATS,
  MATRIX_KINDS,
  MAX_ROW_LABELS,
  type MatrixKind,
  RAW_STATS,
  ROW_MARK_LAYERS,
  UNSTACKED,
} from './matrix.ts'

// The compatibility matrix as Markdown (roadmap 33d): DATA_MODEL.md §6.2a is this text, between
// its `matrix:start` / `matrix:end` markers; a test keeps them equal (UPDATE_DOCS=1 rewrites it).

const KIND_TITLES: Record<MatrixKind, string> = {
  column: 'Column',
  nested: 'Nested',
  grouped: 'Grouped',
  contingency: 'Contingency',
  xy: 'XY',
  survival: 'Survival',
  partsOfWhole: 'Parts of whole',
  multipleVariables: 'Multiple variables',
  mvTextNumber: 'Variables: text × number',
  mvNumberText: 'Variables: number × text',
  mvTextText: 'Variables: text × text',
}

/** The rules beyond the table, as the matrix applies them (`frameAllowed`, positions, stacks). */
const RULES: readonly string[] = [
  'A stat marked * needs raw values: it is refused for entered means (mean / SD / N formats), as are before-after lines.',
  'Analysis outputs and functions draw lines, points and bands (identity) on any xy graph.',
  'Bins (histograms) need an xy graph; a column table’s xy graph is its histogram and draws binned bars only.',
  'A histogram (roadmap 34f: a multiple-variables table’s too) draws binned bars only (analysis outputs and functions aside); a multiple-variables table’s bins the number variable mapped to X (`aes.x`), as one data set or one per level of a text variable mapped to colour (`aes.color`), overlaid or stacked.',
  'A multiple-variables table’s xy graph maps variables: points (a row each), lines by group, and (roadmap 34c) paths, ellipses and hulls by group and vectors (a row each); or it is a histogram of one.',
  'Ellipses and convex hulls (polygon), paths (rows joined in table order) and vectors (segment, from X, Y to the X end and Y end variables) are drawn on XY graphs only: an XY table’s data sets each, a graph of variables’ groups (the colour or shape variable’s levels), after its mapped points; vectors need X end and Y end variables.',
  'Connectors (before-after lines) on grouped tables join each subject (replicate) across the data sets within a row (pair lines).',
  'Densities of a graph of variables’ points (roadmap 34g) are drawn on its XY graph after its mapped points, in the axes’ transformed coordinates (arcsinh, logicle): hexagons coloured by the points in each (hex × hexbin), contour lines or filled bands of the 2D density per group of the colour variable (contour × density2d) and the density as an image (raster × density2d). They summarise the rows: cells tables offer them.',
  'Dot plots (roadmap 34g) are grids of a multiple-variables table’s number variables (along X) by the levels of a text variable (`aes.group`, down Y): dots sized by the percent of each level’s rows above a threshold and coloured by their average (points × dotplot), or the averages as tiles (tile × dotplot); a dot plot draws nothing else. They summarise the rows: cells tables offer them.',
  'Graphs of variables (roadmap 34a) are kinds of their own by the types of the variables on X and Y. Multiple variables: number × number (its xy graph), or every number variable as a column or a heat-map column. Text × number: the number variable by the text variable’s levels, a category each, or with a text variable mapped to colour a group each within them (grouped); number × text is the same turned (categories down the left). Text × text: the rows of each combination of levels counted (bars by the X levels, side by side or stacked, or a heat map), as counts or as percents of the X level or of the total.',
  'Bands join the rows of grouped graphs; a grand mean and differences are drawn on category graphs only.',
  'Lines on a category graph join the means across the categories.',
  'Positions: grouped graphs place points, bars, boxes, violins, lines, bands, error bars, labels and centre lines side by side (dodge) or at the row’s centre (aligned); on category graphs only the subjects of nested groups stand side by side; elsewhere marks sit at their slot or X.',
  'Only bars and XY areas stack (areas by value, not as percents); attached layers (error bars, labels) take their host’s position.',
  `Stacked bars draw no ${UNSTACKED.bar.join(' or ')} layers; stacked areas no ${UNSTACKED.area.join(', ')} layers of the table.`,
  'Heat maps (matrix) draw tiles, the values of their cells and (roadmap 49c) the dendrograms of their clustered rows and columns; pies (polar) slices and their labels; tiles, slices, cell values, dendrograms and shares of the whole (fraction) are drawn on nothing else (shares also as 100% bars).',
  'Dendrograms (roadmap 49c, dendrogram × cluster) draw the tree of a hierarchical clustering of the matrix’s rows or columns: beside a heat map whose tiles cluster that axis, the tiles’ tree (its leaves at the cells); else their own clustering (the cells follow it); without tiles, one tree alone fills the plot. A graph has at most one tree of the rows and one of the columns (one tree without tiles); they have no legend glyph (a cut tree’s clusters have entries of their own), no value-axis extent and nothing stands on them.',
  'A graph has at most one difference layer, one tile, slice or 100% bars layer (with at most one labels layer, attached to it: their values and labels sit nowhere else) and one layer of mapped points; lines by group need mapped points.',
]

const AES_TITLES: Record<AesKind, string> = {
  colorText: 'Colour (text variable)',
  colorNumber: 'Colour (number variable)',
  fill: 'Fill (any variable)',
  shape: 'Shape (text variable)',
  size: 'Size (number variable)',
  label: 'Label (any variable)',
}

/** The rules of mapped appearance (`aesAllowed`). */
const AES_RULES: readonly string[] = [
  'Shape, size, labels and colour by a number variable act on points of every row (identity), each its row’s; a text colour variable makes the groups of a category graph (the grouped frame) and colours an XY graph’s rows and its lines by group.',
  'Fill (roadmap 49d) is a second colour scale: a text or number variable fills points of every row, each its row’s, while colour keeps their outlines; mapping the groups’ variable fills them as data sets.',
  'On XY graphs (roadmap 34c) a text colour variable also colours each group’s ellipse, hull and path, and colour by either type each row’s vector; (roadmap 34g) it splits density contours into one set per group, each in its colour. Points can also be coloured by their local density (`colorBy`), on the colour scale in place of a variable.',
  'Text × text graphs count rows: their colour is the Y variable; nothing else is mapped.',
]

const FRAME_WORDS: Record<string, string> = {
  category: 'category',
  grouped: 'grouped',
  xy: 'XY',
  matrix: 'heat map',
  polar: 'pie',
}

/** The layers of a mark per row (roadmap 34f, `ROW_MARK_LAYERS`), a row each. */
function rowMarkRows(): string[] {
  return ROW_MARK_LAYERS.map((r) => {
    const kinds = r.kinds.map((k) => KIND_TITLES[k]).join(', ')
    const frames = r.frames.map((f) => FRAME_WORDS[f] ?? f).join(', ')
    const instead = r.summary
      ? `${r.instead} (Format offers ${r.summary === 'violin' ? 'a violin' : 'joined means'})`
      : r.instead
    return `| ${r.geom} (${r.stats.join(', ')}) | ${frames} | ${kinds} | ${r.too} | ${instead} |`
  })
}

/** DATA_MODEL.md §6.2a's generated text. */
export function matrixMarkdown(): string {
  const kinds = MATRIX_KINDS
  const head = (cols: readonly string[]) =>
    `| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|`
  const stat = (s: StatKind) => (RAW_STATS.has(s) ? `${s}*` : s)
  const frames = [
    head(['Table kind', 'Frames (the usual one first)']),
    ...kinds.map((k) => `| ${KIND_TITLES[k]} | ${FRAMES[k].join(', ')} |`),
  ].join('\n')
  const geoms = [
    head(['Geom', ...kinds.map((k) => KIND_TITLES[k])]),
    ...Geom.options.map(
      (g) =>
        `| ${g} | ${kinds.map((k) => (GEOM_STATS[g][k] ?? []).map(stat).join(', ') || '—').join(' | ')} |`,
    ),
  ].join('\n')
  const aesKinds = MATRIX_KINDS.filter((k) => AES_KINDS.some((a) => AES_GEOMS[a][k]))
  const aes = [
    head(['Mapped to', ...aesKinds.map((k) => KIND_TITLES[k])]),
    ...AES_KINDS.map((a) => {
      const cell = (k: MatrixKind) => {
        const g = AES_GEOMS[a][k]
        if (!g) return '—'
        return a === 'colorText' && k !== 'multipleVariables'
          ? 'every layer (the groups)'
          : g.join(', ')
      }
      return `| ${AES_TITLES[a]} | ${aesKinds.map(cell).join(' | ')} |`
    }),
  ].join('\n')
  return [
    'Frames per table kind:',
    '',
    frames,
    '',
    'Stats each geom allows per table kind (— = not offered):',
    '',
    geoms,
    '',
    ...RULES.map((r) => `- ${r}`),
    '',
    'Variables mapped to appearance (roadmap 34b), by the layers they act on (— = not offered; Multiple variables: its XY graph):',
    '',
    aes,
    '',
    ...AES_RULES.map((r) => `- ${r}`),
    '',
    'Cells tables (roadmap 34f): a multiple-variables table of more than 20,000 rows, or set to be one, offers no layer drawing a mark per row within categories or joining every row (their cost and clutter grow with the rows); scatters of the rows (one point cloud), summaries, histograms and counts scale:',
    '',
    head(['Layer (stats)', 'Frames', 'Kinds', 'Too many', 'Instead']),
    ...rowMarkRows(),
    '',
    `- Labels from a variable are offered on cells tables of at most ${MAX_ROW_LABELS.toLocaleString('en-US')} rows (group names instead).`,
    '- Such layers already on a graph keep drawing; Format › Layers says why they are slow and offers the summary in their place (or hides them).',
  ].join('\n')
}
