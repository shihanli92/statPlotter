import { readFileSync } from 'node:fs'
import {
  type ColumnId,
  createTable,
  type DataTable,
  type Frame,
  type GraphNode,
  type GraphNodeV1,
  type Layer,
  levelKey,
  type NodeId,
  type Position,
  type Project,
  type TableKind,
} from '@ps/model'
import { pca } from '@ps/stats'
import { syntheticTable } from '../../model/test/synthetic.ts'
import {
  lookFor,
  newGraphNode,
  newStyleLayer,
  outputGraphsFor,
  plotStyle,
  presetGraph,
  presetLayers,
  splitGraphs,
  stackedArea,
  styleAllowed,
  styleContext,
  variableHistogram,
  withStyleLayer,
} from '../src/index.ts'
import { graphOf } from './graphs.ts'
import {
  appearanceTable,
  cytometryTable,
  fixedTable,
  sampleTable,
  sampleVariables,
} from './helpers.ts'

// The golden graphs: `golden.test.ts` renders them to the committed SVGs. The graphs of roadmaps
// up to 33a are v1 projects (`fixtures/v1/golden/`, written by the 33a code): rendered migrated,
// they must give the same SVGs. Graphs made of layers directly come after them (`layeredCases`,
// `comboCases`).

/** A golden v1 graph: its file name (`__snapshots__/golden/<name>.svg`), table and graph. */
export type GoldenCase = [name: string, table: DataTable, graph: GraphNodeV1]

const FIXTURES = new URL('./fixtures/v1/golden/', import.meta.url)

/** A golden graph's v1 project as its fixture holds it (raw: migrate it to open it). */
export const goldenProject = (name: string): Project =>
  JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8'))

/** The golden v1 graphs, by group (in the order they were written). */
function goldenGroups(): { title: string; cases: GoldenCase[] }[] {
  const index: [string, string][] = JSON.parse(
    readFileSync(new URL('index.json', FIXTURES), 'utf8'),
  )
  const groups: { title: string; cases: GoldenCase[] }[] = []
  for (const [title, name] of index) {
    const nodes = Object.values(goldenProject(name).nodes) as unknown[]
    const table = nodes.find((n) => (n as DataTable).kind === 'table') as DataTable
    const graph = nodes.find((n) => (n as GraphNodeV1).kind === 'graph') as GraphNodeV1
    let group = groups.find((g) => g.title === title)
    if (!group) {
      group = { title, cases: [] }
      groups.push(group)
    }
    group.cases.push([name, table, graph])
  }
  return groups
}

export const GOLDEN_GROUPS: { title: string; cases: GoldenCase[] }[] = goldenGroups()

/** A golden layered graph (roadmap 33), laid out by the layer engine directly. */
export type LayeredCase = [name: string, table: DataTable, graph: GraphNode]

/**
 * Where a geom usually sits in the drawing order, back (0) to front: fills and bars behind,
 * points over them, error bars, centre lines and labels in front (the usual order and v1's; XY
 * symbols in front of their error bars). Until roadmap 33e the builder added each layer there;
 * now it adds in front (`newLayerIndex`), and the golden graphs keep the lists they were drawn
 * with.
 */
function depth(layer: Pick<Layer, 'geom'>, frame: Frame): number {
  switch (layer.geom) {
    case 'tile':
    case 'wedge':
    case 'refline':
    case 'area':
    case 'band':
      return 0
    case 'bar':
      return 1
    case 'violin':
      return 2
    case 'box':
      return 3
    case 'polygon':
    case 'hex':
    case 'raster':
      return 0
    case 'contour':
      return 4
    case 'line':
    case 'connector':
    case 'step':
    case 'path':
    case 'segment':
      return 4
    case 'points':
      return frame === 'xy' ? 7 : 5
    case 'errorbar':
    case 'difference':
    case 'censor':
      return 6
    case 'center':
      return 8
    case 'label':
    case 'dendrogram':
      return 9
  }
}

/**
 * Where a geom usually sits in a list: before the first layer that usually sits in front of it,
 * and in front of its host when it is attached.
 */
export function usualIndex(layers: readonly Layer[], layer: Layer, frame: Frame): number {
  const d = depth(layer, frame)
  let at = layers.findIndex((l) => depth(l, frame) > d)
  if (at < 0) at = layers.length
  const host = layer.on === undefined ? -1 : layers.findIndex((l) => l.id === layer.on)
  return Math.max(at, host + 1)
}

/**
 * A new graph built from plot-style icons: each style's layer added in turn (`newStyleLayer`)
 * where its geom usually sits (`usualIndex`, as the builder did up to roadmap 33d), each allowed
 * by the matrix, the look its layers call for; `position` places the layers of a grouped graph.
 */
export function builtGraph(
  table: DataTable,
  frame: Frame,
  styles: readonly string[],
  position?: Position,
  start: Layer[] = [],
): GraphNode {
  let layers = [...start]
  for (const id of styles) {
    const style = plotStyle(id)!
    const c = styleContext(table, frame, layers)
    const allowed = styleAllowed(style, c)
    if (!allowed.allowed) throw new Error(`${id} on ${table.tableKind}: ${allowed.reason}`)
    const layer = newStyleLayer(style, c, position)
    layers = withStyleLayer(c, layer, usualIndex(layers, layer, frame))
  }
  const graph = newGraphNode(table, { frame, look: lookFor(frame, layers), layers })
  return { ...graph, id: 'g1' as NodeId }
}

/** The sample multiple-variables table with a text variable (a group per row). */
export function mvWithGroups(): DataTable {
  const t = sampleTable('multipleVariables')
  const group = structuredClone(t.dataSets[0]!)
  group.id = 'e' as ColumnId
  group.title = 'Site'
  group.subcolumns = group.subcolumns.map((s) => ({ ...s, values: s.values.map(() => null) }))
  group.text = ['North', 'South', 'North', 'South', 'North', 'South']
  return { ...t, dataSets: [...t.dataSets, group] }
}

/**
 * A column table of 40 and 30 values spread like samples of two normal distributions (fixed,
 * from a low-discrepancy sequence), for histograms.
 */
export function histogramTable(): DataTable {
  const draws = (n: number, mean: number, sd: number, seed: number) =>
    Array.from({ length: n }, (_, i) => {
      let s = 0
      for (const k of [1, 2, 3]) s += ((i + 1) * 0.6180339887 * k * seed) % 1
      return Math.round((mean + sd * 2 * (s - 1.5)) * 10) / 10
    })
  const t = sampleTable('column')
  const sets = [draws(40, 50, 10, 1), draws(30, 62, 8, 1.37)]
  const rows = 40
  return {
    ...t,
    name: 'Weights',
    rowCount: rows,
    dataSets: t.dataSets.slice(0, 2).map((d, i) => ({
      ...d,
      title: ['Wild type', 'Knockout'][i]!,
      subcolumns: d.subcolumns.map((s) => ({
        ...s,
        values: Array.from({ length: rows }, (_, r) => sets[i]![r] ?? null),
      })),
    })),
  }
}

/**
 * The combinations of roadmap 33d, each built from the builder's icons (or a preset and icons),
 * drawn layer by layer as new graphs are.
 */
export function comboCases(): LayeredCase[] {
  const column = sampleTable('column')
  const grouped = sampleTable('grouped')
  const contingency = sampleTable('contingency')
  const xy = sampleTable('xy')
  const mv = mvWithGroups()
  const preset = (table: DataTable, id: string, more: readonly string[] = []) => {
    const spec = presetLayers(id, table)!
    return builtGraph(table, spec.frame, more, undefined, spec.layers)
  }
  const dodge: Position = { kind: 'dodge' }
  const aligned: Position = { kind: 'aligned' }
  // A scatter without bubble sizes: points coloured by the text variable, lines by group.
  const scatter = (() => {
    const spec = presetLayers('bubble', mv)!
    const layers = spec.layers.map((l) =>
      l.aes ? ({ ...l, aes: { x: 'a', y: 'b', color: 'e' } } as Layer) : l,
    )
    return builtGraph(mv, 'xy', ['groupLines'], undefined, layers)
  })()
  // Before-after lines moved in front of the swarm (the layer list's order).
  // Paired values with ties, so the points spread in swarms (the lines end on them).
  const paired: DataTable = {
    ...column,
    dataSets: column.dataSets.slice(0, 2).map((d, i) => ({
      ...d,
      subcolumns: d.subcolumns.map((s) => ({
        ...s,
        values: [
          [12, 12, 13, 13, 13, 15],
          [18, 19, 19, 19, 21, 21],
        ][i]!,
      })),
    })),
  }
  const pairsOver = (() => {
    const g = builtGraph(paired, 'category', ['points', 'pairs'])
    const pairs = g.layers.find((l) => l.geom === 'connector')!
    return { ...g, layers: [...g.layers.filter((l) => l !== pairs), pairs] }
  })()
  const values = histogramTable()
  const binned = (stat: Partial<Extract<Layer['stat'], { kind: 'bin' }>>) => {
    const spec = presetLayers('histogramBins', values)!
    const layers = spec.layers.map((l) => ({ ...l, stat: { ...l.stat, ...stat } }) as Layer)
    return builtGraph(values, spec.frame, [], undefined, layers)
  }
  return [
    [
      'combo-column-violin-box-points',
      column,
      builtGraph(column, 'category', ['violin', 'box', 'points']),
    ],
    [
      'combo-column-join-means',
      column,
      builtGraph(column, 'category', ['points', 'center', 'joinMeans']),
    ],
    [
      'combo-column-points-mean-symbol',
      column,
      builtGraph(column, 'category', ['points', 'means']),
    ],
    ['combo-column-before-after-over-points', paired, pairsOver],
    ['combo-column-histogram', values, binned({})],
    ['combo-column-histogram-percent-width', values, binned({ measure: 'percent', width: 5 })],
    [
      'combo-grouped-box-join-means',
      grouped,
      builtGraph(grouped, 'grouped', ['box', 'joinMeans'], dodge),
    ],
    [
      'combo-grouped-band-time-course',
      grouped,
      builtGraph(grouped, 'grouped', ['band', 'joinMeans', 'means'], aligned),
    ],
    ['combo-grouped-percent-labels', grouped, preset(grouped, 'stackedPercent', ['labels'])],
    ['combo-contingency-percent-stacked', contingency, preset(contingency, 'stackedPercent')],
    ['combo-contingency-heatmap', contingency, preset(contingency, 'heatmap', ['labels'])],
    [
      'combo-xy-stacked-areas',
      xy,
      (() => {
        const g = builtGraph(xy, 'xy', ['area'])
        return {
          ...g,
          // The builder's Areas: Stacked.
          layers: g.layers.map((l) => stackedArea(l, true)),
        }
      })(),
    ],
    ['combo-xy-step', xy, builtGraph(xy, 'xy', ['step', 'points'])],
    ['combo-mv-scatter-colour-group-lines', mv, scatter],
  ]
}

/**
 * Layer order (roadmap 33e): pairs of layers drawn both ways round, as moving one up or down the
 * list does (`-over-` the second in front, `-under-` behind); frame-drawn marks (the grand mean,
 * XY and survival bands) included.
 */
export function orderCases(): LayeredCase[] {
  const column = sampleTable('column')
  const grouped = sampleTable('grouped')
  const xy = sampleTable('xy')
  const survival = sampleTable('survival')
  /** The graph with layer `id` at the front (the end of the list) or the back (its start). */
  const at = (g: GraphNode, id: string, front: boolean): GraphNode => {
    const l = g.layers.find((x) => x.id === id)!
    const rest = g.layers.filter((x) => x !== l)
    return { ...g, layers: front ? [...rest, l] : [l, ...rest] }
  }
  const both = (name: string, table: DataTable, g: GraphNode, id: string): LayeredCase[] => [
    [`order-${name.replace('%', 'over')}`, table, at(g, id, true)],
    [`order-${name.replace('%', 'under')}`, table, at(g, id, false)],
  ]
  const km = { ...presetGraph(survival, 'survival'), id: 'g1' as NodeId }
  const kmBand: GraphNode = {
    ...km,
    layers: [...km.layers, { id: 'ciBand', geom: 'band', stat: { kind: 'km' } }],
  }
  return [
    ...both(
      'category-grand-mean-%-points',
      column,
      builtGraph(column, 'category', ['points', 'grandMean']),
      'grandMean',
    ),
    ...both(
      'grouped-points-%-bars',
      grouped,
      builtGraph(grouped, 'grouped', ['bars', 'points'], { kind: 'dodge' }),
      'points',
    ),
    ...both('xy-band-%-line', xy, builtGraph(xy, 'xy', ['line', 'band']), 'envelope'),
    ...both('survival-band-%-curve', survival, kmBand, 'ciBand'),
  ]
}

/**
 * Layered graphs drawn layer by layer (`drawOrder: 'layer'`, the default for new graphs): every
 * data set's marks of a layer together, the layers in list order. Written by the 33a code (v1
 * graphs compiled, then edited; `fixtures/layered/index.json`): XY bars under every symbol, a
 * grouped time course (lines behind every error bar and mean), and a violin with a narrow box and
 * the points over both (the box's marks get `@<layer>` ids).
 */
export function layeredCases(): LayeredCase[] {
  const cases: { name: string; table: TableKind; graph: GraphNode }[] = JSON.parse(
    readFileSync(new URL('./fixtures/layered/index.json', import.meta.url), 'utf8'),
  )
  return cases.map(({ name, table, graph }) => [name, sampleTable(table), graph])
}

/**
 * Graphs of a multiple-variables table's variables straight from the table (roadmap 34a), made
 * from presets with the variables mapped as the builder maps them: Score by Group (text ×
 * number) as boxes with every value, coloured by Sex side by side and stacked, turned (number ×
 * text), and Group by Sex (text × text) as count bars, 100% stacked bars and a count heat map;
 * the box plot again with the levels in an order of the graph's own.
 */
export function variableCases(): LayeredCase[] {
  const t = sampleVariables()
  const graph = (id: string, mapping: GraphNode['mapping'], more: Partial<GraphNode> = {}) => {
    const g = presetGraph(t, id, undefined, mapping ? { mapping } : {})
    return { ...g, id: 'g1' as NodeId, ...more }
  }
  const tn = { x: 'a', y: 'c' }
  const coloured = { ...tn, color: 'b' }
  const tt = { x: 'a', y: 'b' }
  const heat = graph('heatmap', tt)
  return [
    ['vars-text-number-box-points', t, graph('groupBoxPoints', tn)],
    ['vars-colour-side-by-side', t, graph('barsPoints', coloured)],
    ['vars-colour-stacked', t, graph('stacked', coloured)],
    ['vars-number-text-horizontal', t, graph('boxPoints', { x: 'c', y: 'a' })],
    ['vars-text-text-count-bars', t, graph('bars', tt)],
    ['vars-text-text-percent-stacked', t, graph('stackedPercent', tt)],
    [
      'vars-text-text-count-heatmap',
      t,
      {
        ...heat,
        layers: [
          ...heat.layers,
          { id: 'values', geom: 'label', stat: { kind: 'cell' }, on: 'cells' } as Layer,
        ],
      },
    ],
    [
      'vars-level-order',
      t,
      graph('groupBoxPoints', tn, { levels: { a: ['High', 'Mid', 'Gone', 'Low'] } }),
    ],
  ]
}

/**
 * Variables mapped to appearance (roadmap 34b) on `appearanceTable`: XY graphs of Age by Score
 * coloured by Site (a level's colour and the order of levels the graph's own; a row without a
 * Site grey), by BMI on viridis with a colour bar, shaped by Sex, coloured and shaped by Sex (one
 * legend), sized by BMI by radius (the legend reversed) and labelled by Group; category graphs of
 * Score by Group coloured by BMI (a colour bar), shaped by Sex and sized by Age; a grouped graph
 * of Score by Group and Sex shaped by Sex (the groups' legend shows the symbols).
 */
export function appearanceCases(): LayeredCase[] {
  const t = appearanceTable()
  const xy = (aes: NonNullable<Layer['aes']>, more: Partial<GraphNode> = {}): GraphNode => {
    const g = presetGraph(t, 'bubble')
    const layers = g.layers.map((l) =>
      l.aes ? ({ ...l, aes: { x: 'c', y: 'd', ...aes } } as Layer) : l,
    )
    return { ...g, id: 'g1' as NodeId, layers, legend: { ...g.legend, show: true }, ...more }
  }
  const graph = (id: string, mapping: GraphNode['mapping'], more: Partial<GraphNode> = {}) => {
    const g = presetGraph(t, id, undefined, mapping ? { mapping } : {})
    return { ...g, id: 'g1' as NodeId, ...more }
  }
  const viridis = { color: { colors: 'viridis' as const, bar: { show: true } } }
  return [
    [
      'aes-xy-colour-by-text',
      t,
      xy(
        { color: 'f' },
        {
          levels: { f: ['South', 'North'] },
          seriesOverrides: { [levelKey('North')]: { color: { rgb: '#d62728' } } },
        },
      ),
    ],
    ['aes-xy-colour-by-number-bar', t, xy({ color: 'e' }, { scales: viridis })],
    ['aes-xy-shape-by-text', t, xy({ shape: 'b' })],
    ['aes-xy-colour-shape-combined', t, xy({ color: 'b', shape: 'b' })],
    [
      'aes-xy-size-radius-reversed',
      t,
      xy(
        { size: 'e' },
        {
          scales: { size: { by: 'radius', min: 3, max: 15 } },
          legend: { show: true, position: 'right', reverse: true },
        },
      ),
    ],
    ['aes-xy-labels-from-variable', t, xy({ label: 'a' })],
    [
      'aes-category-colour-by-number-bar',
      t,
      graph('groupBoxPoints', { x: 'a', y: 'c', color: 'e' }, { scales: viridis }),
    ],
    [
      'aes-category-shape-size',
      t,
      graph('groupBoxPoints', { x: 'a', y: 'c', shape: 'b', size: 'd' }),
    ],
    [
      'aes-grouped-shape-of-groups',
      t,
      graph('barsPoints', { x: 'a', y: 'c', color: 'b', shape: 'b', size: 'd' }),
    ],
  ]
}

/** A column table of means ± SEM (N = 3), one data set per mean. */
export function meanSemColumn(means: readonly number[], sems: readonly number[]): DataTable {
  return fixedTable(
    'column',
    { type: 'summary', preset: 'meanSemN' },
    means.map((m, i) => [[m], [sems[i % sems.length]!], [3]]),
    { titles: means.map((_, i) => `Group ${String.fromCharCode(65 + i)}`) },
  )
}

/** A grouped table of means ± SD (N = 3): two rows, three data sets, negative means among them. */
export function signedGrouped(): DataTable {
  return fixedTable(
    'grouped',
    { type: 'summary', preset: 'meanSdN' },
    [
      [
        [4, -3],
        [1, 0.8],
        [3, 3],
      ],
      [
        [-2, 5],
        [0.6, 1.2],
        [3, 3],
      ],
      [
        [-1.5, 2],
        [0.5, 0.4],
        [3, 3],
      ],
    ],
    { titles: ['Early', 'Mid', 'Late'], rowTitles: ['Mouse 1', 'Mouse 2'] },
  )
}

/** A grouped table of one value per cell: three rows, four data sets (a heat map's). */
export function heatTable(): DataTable {
  return fixedTable(
    'grouped',
    { type: 'replicates', count: 1 },
    [[[1, 4, 7]], [[2, 5, 8]], [[3, 6, 9]], [[0.5, 9.5, 5]]],
    { titles: ['A', 'B', 'C', 'D'], rowTitles: ['IL-6', 'TNF', 'IFNγ'] },
  )
}

/**
 * Fixes of bugs found rebuilding paper figures: error bars of negative bars pointing away from
 * the bar's base (a column graph; a stacked grouped graph with negative segments); a narrow
 * horizontal value axis whose automatic ticks are made coarser until their labels fit; a heat map
 * coloured between two colours of its colour scale (and its colour bar).
 */
export function fixCases(): LayeredCase[] {
  const column = meanSemColumn([-2, 3, -1], [0.5, 0.4, 0.3])
  const stacked = signedGrouped()
  const narrow = meanSemColumn([-4, -1.5, 2, 6.5, 10, 3], [0.6, 0.9, 0.5, 1.1, 1.5, 0.7])
  const heat = heatTable()
  const heatGraph = graphOf(heat, 'heatmap')
  return [
    ['fix-negative-bar-errors', column, graphOf(column, 'barsSem')],
    ['fix-negative-stacked-errors', stacked, graphOf(stacked, 'stacked')],
    [
      'fix-narrow-value-axis-ticks',
      narrow,
      graphOf(narrow, 'barsSem', (g) => ({
        style: { ...g.style, orientation: 'horizontal' },
        size: { ...g.size, plotWidth: 150, plotHeight: 270 },
      })),
    ],
    [
      'fix-heatmap-two-colours',
      heat,
      { ...heatGraph, scales: { ...heatGraph.scales, color: { colors: ['#fff8d0', '#e00000'] } } },
    ],
  ]
}
/**
 * A multiple-variables table of arrows (roadmap 34c): `a` X, `b` Y, `c` X end, `d` Y end, `e`
 * Speed (a number colouring them), on a 3 × 3 grid of starting points.
 */
export function vectorTable(): DataTable {
  const t = createTable({ tableKind: 'multipleVariables', columns: 5, rows: 9 })
  t.id = 't1' as NodeId
  t.name = 'Vectors'
  const titles = ['X', 'Y', 'X end', 'Y end', 'Speed']
  const xs = [0, 1, 2, 0, 1, 2, 0, 1, 2]
  const ys = [0, 0, 0, 1, 1, 1, 2, 2, 2]
  // A rotation about (1, 1), shrinking towards it.
  const ex = xs.map((x, i) => x - 0.45 * (ys[i]! - 1) - 0.1 * (x - 1))
  const ey = ys.map((y, i) => y + 0.45 * (xs[i]! - 1) - 0.1 * (y - 1))
  const cols = [xs, ys, ex, ey, xs.map((x, i) => Math.hypot(ex[i]! - x, ey[i]! - ys[i]!))]
  t.dataSets.forEach((d, i) => {
    d.id = String.fromCharCode(97 + i) as ColumnId
    d.title = titles[i]!
    d.subcolumns[0]!.values = cols[i]!.map((v) => Math.round(v * 1000) / 1000)
  })
  return t
}

/**
 * Roadmap 34c's goldens: XY graphs of variables (Score by Age, coloured by Group) with each kind
 * of ellipse, filled ellipses behind the points, convex hulls and paths in row order with
 * arrowheads; a vector plot; pair lines on a grouped graph; an XY table's data sets with their
 * ellipses.
 */
export function overlayCases(): LayeredCase[] {
  const t = appearanceTable()
  const xy = (extra: Layer[], front: Layer[] = [], aes: Layer['aes'] = {}): GraphNode => {
    const g = presetGraph(t, 'bubble')
    const layers = g.layers.map((l) =>
      l.aes ? ({ ...l, aes: { x: 'c', y: 'd', color: 'a', ...aes } } as Layer) : l,
    )
    return {
      ...g,
      id: 'g1' as NodeId,
      layers: [...extra, ...layers, ...front],
      legend: { ...g.legend, show: true },
    }
  }
  const ellipse = (type: 'norm' | 'mean' | 't', style?: object): Layer =>
    ({
      id: 'ellipse',
      geom: 'polygon',
      stat: { kind: 'ellipse', type, level: 0.95 },
      ...(style ? { style } : {}),
    }) as Layer
  const outline = { draw: 'outline' }
  const v = vectorTable()
  const vectors = presetGraph(v, 'bubble')
  const grouped = sampleTable('grouped')
  const xyTable = sampleTable('xy')
  return [
    ['overlay-ellipse-norm', t, xy([ellipse('norm', outline)])],
    ['overlay-ellipse-mean', t, xy([ellipse('mean', outline)])],
    ['overlay-ellipse-t', t, xy([ellipse('t', outline)])],
    [
      'overlay-ellipse-filled-behind',
      t,
      xy([
        ellipse('norm', {
          draw: 'fill',
          fill: { type: 'solid', color: { series: true }, opacity: 0.3 },
        }),
      ]),
    ],
    [
      'overlay-hull',
      t,
      xy([{ id: 'hull', geom: 'polygon', stat: { kind: 'hull' } } as Layer], [], { shape: 'b' }),
    ],
    [
      'overlay-path-arrows',
      t,
      xy(
        [],
        [
          {
            id: 'path',
            geom: 'path',
            stat: { kind: 'identity' },
            style: { arrow: 'end', head: { shape: 'triangle', size: 1.2 } },
          } as Layer,
        ],
      ),
    ],
    [
      'overlay-path-along',
      t,
      xy(
        [],
        [
          {
            id: 'path',
            geom: 'path',
            stat: { kind: 'identity' },
            aes: { group: 'b' },
            style: { arrow: 'along', head: { shape: 'open' } },
          } as Layer,
        ],
        { color: 'b' },
      ),
    ],
    [
      'overlay-vector-plot',
      v,
      {
        ...vectors,
        id: 'g1' as NodeId,
        layers: [
          ...vectors.layers.map((l) =>
            l.aes
              ? ({ ...l, aes: { x: 'a', y: 'b', color: 'e' }, style: { size: 3 } } as Layer)
              : l,
          ),
          {
            id: 'vectors',
            geom: 'segment',
            stat: { kind: 'identity' },
            aes: { xend: 'c', yend: 'd' },
            style: { stroke: { color: { series: true }, width: 1.5, dash: 'solid' } },
          } as Layer,
        ],
        scales: { color: { colors: 'viridis', bar: { show: true } } },
        legend: { show: true, position: 'right' },
      },
    ],
    [
      'overlay-pair-lines-grouped',
      grouped,
      {
        ...builtGraph(grouped, 'grouped', ['points'], { kind: 'dodge' }),
        layers: [
          ...builtGraph(grouped, 'grouped', ['points'], { kind: 'dodge' }).layers,
          { id: 'pairs', geom: 'connector', stat: { kind: 'identity' } } as Layer,
        ],
      },
    ],
    ['overlay-pca-scores-grouped', ...pcaScores()],
    [
      'overlay-xy-table-ellipses',
      xyTable,
      {
        ...builtGraph(xyTable, 'xy', ['each']),
        layers: [
          ellipse('norm'),
          { id: 'path', geom: 'path', stat: { kind: 'identity' } } as Layer,
          ...builtGraph(xyTable, 'xy', ['each']).layers,
        ],
      },
    ],
  ]
}

/**
 * A grouped PCA's score plot (roadmap 34c): the scores of four measurements of 24 rows in three
 * species (`@ps/stats` `pca`, standardized) in the table a grouped PCA makes (PC1, PC2, the
 * group), drawn by the graph `outputGraphsFor` makes for it, with an ellipse per species.
 */
function pcaScores(): [DataTable, GraphNode] {
  const species = ['setosa', 'versicolor', 'virginica']
  const wobble = (r: number, k: number) => (((r * 7 + k * 13) % 11) - 5) / 6
  const X = Array.from({ length: 24 }, (_, r) =>
    [0, 1, 2, 3].map((k) => 5 + k + Math.floor(r / 8) * (k % 2 ? 1.5 : 0.8) + wobble(r, k)),
  )
  const res = pca(X, { standardize: true, select: { method: 'fixed', value: 2 } })
  const t = createTable({ tableKind: 'multipleVariables', columns: 3, rows: 24 })
  t.id = 't1' as NodeId
  t.name = 'PC scores'
  const titles = ['PC1', 'PC2', 'Species']
  t.dataSets.forEach((d, i) => {
    d.id = (['pc1', 'pc2', 'group'] as const)[i] as ColumnId
    d.title = titles[i]!
    if (i < 2) d.subcolumns[0]!.values = res.scores.map((row) => row[i]!)
  })
  t.dataSets[2]!.text = Array.from({ length: 24 }, (_, r) => species[Math.floor(r / 8)]!)
  const vars = { x: 'pc1', y: 'pc2', color: 'group', ellipses: true }
  const decl = {
    key: 'scores',
    graph: { id: 'scores', name: 'PC scores', xTitle: 'PC1', yTitle: 'PC2', variables: vars },
  }
  const g = outputGraphsFor(t, 'pca1' as NodeId, [decl])[0]!
  return [t, { ...g, id: 'g1' as NodeId, seriesSource: { table: t.id, include: 'all' } }]
}

/**
 * Graphs of a set split by a text variable (roadmap 34d): a member showing the rows of one level
 * (`seriesSource.filter`), titled with it — Score by Group as boxes with every value, the rows
 * of Sex M (the set's last graph, showing its legend); and Age by Score coloured by Site with an
 * ellipse per site, the rows of Sex F (its legend hidden: the set's last graph shows it).
 */
export function splitCases(): LayeredCase[] {
  const t = sampleVariables()
  const at = appearanceTable()
  const member = (table: DataTable, base: GraphNode, index: number): GraphNode => {
    const set = splitGraphs(table, base, { by: 'level', variable: 'b' })
    const g = set[index]!
    const { links: _, ...rest } = g
    return { ...rest, id: 'g1' as NodeId, split: { ...g.split!, set: 's1' } }
  }
  const box = presetGraph(t, 'groupBoxPoints', undefined, { mapping: { x: 'a', y: 'c' } })
  const scatter = presetGraph(at, 'bubble')
  const ellipses: GraphNode = {
    ...scatter,
    layers: [
      {
        id: 'ellipse',
        geom: 'polygon',
        stat: { kind: 'ellipse', type: 'norm', level: 0.68 },
      } as Layer,
      ...scatter.layers.map((l) =>
        l.aes ? ({ ...l, aes: { x: 'c', y: 'd', color: 'f' } } as Layer) : l,
      ),
    ],
  }
  return [
    ['split-level-member', t, member(t, box, 1)],
    ['split-level-member-xy', at, member(at, ellipses, 0)],
  ]
}

/**
 * Roadmap 34e: a synthetic single-cell table (400 cells: samples, clusters, a clustered UMAP,
 * genes), its UMAP coloured by cluster drawn as an image (`raster`: the golden embeds the image
 * at that many pixels per point), by a gene with the highest values on top, in a shuffled order,
 * and with each cluster's name at its centre (a halo; a box at the mean).
 */
export function largeCases(): [name: string, table: DataTable, graph: GraphNode, raster: number][] {
  const t = syntheticTable({ rows: 400, genes: 2, pcs: 2, cellIds: false })
  const key = (title: string) => t.dataSets.find((d) => d.title === title)!.id
  const umap = (aes: Layer['aes'], points: object = {}, front: Layer[] = []): GraphNode => {
    const g = presetGraph(t, 'bubble')
    const layers = g.layers.map((l) =>
      l.aes
        ? ({
            ...l,
            aes: { x: key('UMAP_1'), y: key('UMAP_2'), ...aes },
            style: { ...l.style, size: 4, ...points },
          } as Layer)
        : l,
    )
    const title = (text: string) => ({ content: [{ text }] })
    return {
      ...g,
      id: 'g1' as NodeId,
      layers: [...layers, ...front],
      legend: { ...g.legend, show: true },
      axes: {
        ...g.axes,
        x: { ...g.axes.x, title: title('UMAP 1') },
        y: { ...g.axes.y, title: title('UMAP 2') },
      } as GraphNode['axes'],
    }
  }
  const byCluster = { color: key('cluster') }
  const centroid = (stat: object = {}, style: object = {}): Layer =>
    ({ id: 'names', geom: 'label', stat: { kind: 'centroid', ...stat }, style }) as Layer
  return [
    ['large-raster-points', t, umap(byCluster, { render: 'image' }), 2],
    [
      'large-order-value',
      t,
      {
        ...umap({ color: key('GENE1') }, { order: 'value' }),
        scales: { color: { colors: 'viridis', bar: { show: true } } },
      },
      0,
    ],
    ['large-order-random', t, umap(byCluster, { order: 'random' }), 0],
    ['large-centroid-labels', t, umap(byCluster, {}, [centroid()]), 0],
    [
      'large-centroid-mean-box',
      t,
      umap(byCluster, { render: 'image' }, [centroid({ center: 'mean' }, { background: 'box' })]),
      1,
    ],
  ]
}

/**
 * Roadmap 34f: graphs of a cells table (the synthetic 400 cells): its 14 clusters on the 24-colour
 * palette in natural order (C0, C1 … C13, not as they first appear) on the UMAP and as violins by
 * cluster; histograms of a variable — alone, overlaid by cell type (translucent) and stacked by
 * sample.
 */
export function cellsCases(): LayeredCase[] {
  const t = syntheticTable({ rows: 400, genes: 2, pcs: 2, cellIds: false })
  const key = (title: string) => t.dataSets.find((d) => d.title === title)!.id
  const umap = presetGraph(t, 'bubble')
  const natural: GraphNode = {
    ...umap,
    id: 'g1' as NodeId,
    levelOrder: 'natural',
    layers: umap.layers.map((l) =>
      l.aes
        ? ({
            ...l,
            aes: { x: key('UMAP_1'), y: key('UMAP_2'), color: key('cluster') },
            style: { ...l.style, size: 4 },
          } as Layer)
        : l,
    ),
    legend: { ...umap.legend, show: true },
    axes: {
      ...umap.axes,
      x: { ...umap.axes.x, title: { content: [{ text: 'UMAP 1' }] } },
      y: { ...umap.axes.y, title: { content: [{ text: 'UMAP 2' }] } },
    } as GraphNode['axes'],
  }
  const violins: GraphNode = {
    ...presetGraph(t, 'groupViolin', undefined, {
      mapping: { x: key('cluster'), y: key('nCount_RNA') },
    }),
    id: 'g1' as NodeId,
    levelOrder: 'natural',
  }
  const histogram = (color?: string, stacked = false): GraphNode => ({
    ...newGraphNode(t, {
      frame: 'xy',
      look: 'xy.scatter',
      layers: [variableHistogram(key('nCount_RNA'), color, stacked)],
    }),
    id: 'g1' as NodeId,
    levelOrder: 'natural',
  })
  return [
    ['cells-umap-natural-palette', t, natural],
    ['cells-violins-palette', t, violins],
    ['mv-histogram', t, histogram()],
    ['mv-histogram-overlaid', t, histogram(key('cell_type'))],
    ['mv-histogram-stacked', t, histogram(key('sample'), true)],
  ]
}

/**
 * Roadmap 34g: cytometry axes and density plots. A flow-cytometry-like table (`cytometryTable`:
 * raw fluorescence with negatives) on arcsinh (cofactor 150) and logicle axes, coloured by
 * population; hexagons over the synthetic cells' UMAP (a colour bar of counts) and over logicle
 * axes (log counts); density contours (lines; filled bands with a colour bar; each population's,
 * at the levels holding 50–95% of its points, on logicle axes); a density image; points coloured
 * by their local density, the densest on top; a histogram on a logicle axis by population; a dot
 * plot of genes by cluster, and one with its averages as tiles behind the dots.
 */
export function densityCases(): LayeredCase[] {
  const cy = cytometryTable()
  const cells = syntheticTable({ rows: 400, genes: 6, pcs: 2, cellIds: false })
  const key = (title: string) => cells.dataSets.find((d) => d.title === title)!.id
  const title = (text: string) => ({ content: [{ text }] })
  const graph = (
    t: DataTable,
    layers: Layer[],
    axes: { x?: object; y?: object; xTitle: string; yTitle: string },
    more: Partial<GraphNode> = {},
  ): GraphNode => {
    const g = newGraphNode(t, { frame: 'xy', look: 'bubble.scatter', layers })
    return {
      ...g,
      id: 'g1' as NodeId,
      legend: { ...g.legend, show: true },
      axes: {
        ...g.axes,
        x: { ...g.axes.x, title: title(axes.xTitle), ...axes.x },
        y: { ...g.axes.y, title: title(axes.yTitle), ...axes.y },
      } as GraphNode['axes'],
      ...more,
    }
  }
  const points = (aes: Layer['aes'], style: object = {}, visible = true): Layer =>
    ({
      id: 'points',
      geom: 'points',
      stat: { kind: 'identity' },
      aes,
      style: { size: 3, ...style },
      ...(visible ? {} : { visible: false }),
    }) as Layer
  const arcsinh = { scale: 'arcsinh', arcsinh: { cofactor: 150 } }
  const logicle = { scale: 'logicle' }
  const cyAxes = (scale: object) => ({ x: scale, y: scale, xTitle: 'CD3', yTitle: 'CD19' })
  const umap = { xTitle: 'UMAP 1', yTitle: 'UMAP 2' }
  const umapAes = { x: key('UMAP_1'), y: key('UMAP_2') }
  const hex = (stat: object = {}, style: object = {}): Layer =>
    ({ id: 'hexes', geom: 'hex', stat: { kind: 'hexbin', ...stat }, aes: {}, style }) as Layer
  const contour = (stat: object = {}, style: object = {}): Layer =>
    ({
      id: 'contours',
      geom: 'contour',
      stat: { kind: 'density2d', n: 50, ...stat },
      aes: {},
      style,
    }) as Layer
  const grey = {
    fill: { type: 'solid', color: { rgb: '#bbbbbb' }, opacity: 1 },
    border: { color: { rgb: '#bbbbbb' }, width: 0.5, dash: 'solid' },
    size: 2,
  }
  const dots = (genes: string[], tiles = false): GraphNode => {
    const layers: Layer[] = [
      ...(tiles
        ? [
            {
              id: 'tiles',
              geom: 'tile',
              stat: { kind: 'dotplot' },
              aes: { group: key('cluster') },
            } as Layer,
          ]
        : []),
      {
        id: 'dots',
        geom: 'points',
        stat: { kind: 'dotplot' },
        aes: { group: key('cluster') },
      } as Layer,
    ]
    const g = newGraphNode(cells, { frame: 'matrix', look: 'heatmap.cells', layers })
    return {
      ...g,
      id: 'g1' as NodeId,
      levelOrder: 'natural',
      seriesSource: { ...g.seriesSource, include: genes as never },
      legend: { ...g.legend, show: true },
    }
  }
  const genes = ['GENE1', 'GENE2', 'GENE3', 'GENE4', 'GENE5', 'GENE6'].map(key)
  const histogram = newGraphNode(cy, {
    frame: 'xy',
    look: 'xy.scatter',
    layers: [variableHistogram('c', 'p')],
  })
  return [
    ['cyto-arcsinh-axes', cy, graph(cy, [points({ x: 'c', y: 'd', color: 'p' })], cyAxes(arcsinh))],
    ['cyto-logicle-axes', cy, graph(cy, [points({ x: 'c', y: 'd', color: 'p' })], cyAxes(logicle))],
    ['density-hexbin', cells, graph(cells, [hex({ bins: 20 }), points(umapAes, {}, false)], umap)],
    [
      'density-hexbin-logicle-log',
      cy,
      graph(
        cy,
        [hex({ bins: 25 }, { log: true, colors: 'magma' }), points({ x: 'c', y: 'd' }, {}, false)],
        cyAxes(logicle),
      ),
    ],
    ['density-contour-lines', cells, graph(cells, [points(umapAes, grey), contour()], umap)],
    [
      'density-contour-filled',
      cells,
      graph(cells, [contour({}, { draw: 'bands' }), points(umapAes, { size: 1.5 })], umap),
    ],
    [
      'density-contour-groups',
      cy,
      graph(
        cy,
        [
          points({ x: 'c', y: 'd', color: 'p' }, { size: 2 }),
          contour({ levels: 'shares' }, { draw: 'both' }),
        ],
        cyAxes(logicle),
      ),
    ],
    [
      'density-image',
      cells,
      graph(
        cells,
        [
          { id: 'density', geom: 'raster', stat: { kind: 'density2d', n: 60 }, aes: {} } as Layer,
          points(umapAes, { size: 1.5 }),
        ],
        umap,
      ),
    ],
    [
      'density-colored-points',
      cells,
      graph(cells, [points(umapAes, { colorBy: 'density', order: 'value' })], umap),
    ],
    [
      'cyto-histogram-logicle',
      cy,
      {
        ...histogram,
        id: 'g1' as NodeId,
        levelOrder: 'natural',
        axes: {
          ...histogram.axes,
          x: { ...histogram.axes.x, scale: 'logicle', title: title('CD3') },
        } as GraphNode['axes'],
      },
    ],
    ['dotplot', cells, dots(genes)],
    ['dotplot-tiles', cells, dots(genes, true)],
  ]
}
