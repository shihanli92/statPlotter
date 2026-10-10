import type {
  AxisSpec,
  ColumnId,
  ContinuousAxisSpec,
  DataTable,
  GraphNode,
  Layer,
  NodeId,
  TreatmentGrid,
} from '@ps/model'
import { syntheticTable } from '../../model/test/synthetic.ts'
import { axisCategories, presetGraph, seedFromNames } from '../src/index.ts'
import { graphOf } from './graphs.ts'
import { fixedTable, projectOf, sampleTable, sampleVariables } from './helpers.ts'

// Roadmap 36: graphs with axis extras — +/− treatment grids (typed and seeded from names), labels
// spanning groups (grouped tables and graphs of variables), broken axes with set piece lengths and
// each break mark, ticks at listed values and text at values, typed-in lines and bands, scale
// bars and corner arrows — the goldens' cases and the unit tests'.

export type AxisCase = [name: string, table: DataTable, graph: GraphNode]

/** A column table of necroptosis-like treatments: four combinations, three values each. */
export function treatmentTable(): DataTable {
  return fixedTable(
    'column',
    { type: 'replicates', count: 1 },
    [[[100, 96, 104]], [[92, 95, 90]], [[41, 45, 38]], [[88, 84, 91]]],
    { titles: ['Control', 'TNF', 'TNF+CHX', 'TNF + CHX + Z-VAD-FMK'] },
  )
}

/** A category axis with extras over a graph's own. */
export const withCategoryAxis = (
  g: GraphNode,
  extras: Partial<Extract<AxisSpec, { type: 'categorical' }>>,
): GraphNode => {
  if (g.axes.x.type !== 'categorical') throw new Error('categorical X expected')
  return { ...g, axes: { ...g.axes, x: { ...g.axes.x, ...extras } } }
}

/** A continuous axis with extras over a graph's own. */
export const withValueAxis = (
  g: GraphNode,
  which: 'x' | 'y',
  extras: Partial<ContinuousAxisSpec>,
): GraphNode => {
  const axis = g.axes[which]
  if (axis.type !== 'continuous') throw new Error('continuous axis expected')
  return { ...g, axes: { ...g.axes, [which]: { ...axis, ...extras } } }
}

/** The grid typed by hand for `treatmentTable` (keys: its data sets). */
export const TYPED_GRID: TreatmentGrid = {
  rows: [
    { title: 'TNF', cells: { a: '-', b: '+', c: '+', d: '+' } },
    { title: 'CHX', cells: { a: '-', b: '-', c: '+', d: '+' } },
    { title: 'Z-VAD-FMK', cells: { a: '−', b: '−', c: '−', d: '+' } },
  ],
}

/** A treatment grid seeded from a graph's category names. */
export function seededGrid(table: DataTable, graph: GraphNode): TreatmentGrid {
  const cats = axisCategories(projectOf(table, graph), graph)
  const rows = seedFromNames(cats.groups)
  if (!rows) throw new Error('names should read as combinations')
  return { rows, symbols: 'dots' }
}

/** A grouped table of genotypes (rows) × stimulations (data sets): two-level labels. */
export function genotypeTable(): DataTable {
  return fixedTable(
    'grouped',
    { type: 'replicates', count: 3 },
    [
      [
        [1.0, 1.1],
        [0.9, 1.2],
        [1.1, 1.0],
      ],
      [
        [4.2, 2.1],
        [3.8, 1.9],
        [4.5, 2.3],
      ],
      [
        [3.1, 1.2],
        [2.7, 1.4],
        [3.3, 1.1],
      ],
    ],
    { titles: ['NT', 'WT', 'pilC−'], rowTitles: ['BMDC WT', 'BMDC MyD88 KO'] },
  )
}

/** A multiple-variables table of oligomer bands (1–5) and their intensities, by replicate. */
export function oligomerTable(): DataTable {
  return fixedTable(
    'xy',
    { type: 'replicates', count: 2 },
    [
      [
        [12, 30, 22, 9, 4],
        [14, 27, 25, 8, 5],
      ],
    ],
    { titles: ['Intensity'], x: [1, 2, 3, 4, 5] },
  )
}

/** A column table with one large value among small ones (a broken Y axis). */
export function brokenTable(): DataTable {
  return fixedTable(
    'column',
    { type: 'replicates', count: 1 },
    [[[2, 3, 2.5]], [[4, 5, 4.5]], [[95, 102, 98]]],
    { titles: ['PBS', 'Low', 'P. aeruginosa'] },
  )
}

/** An XY table of a response over decades of dose (a log X axis with listed ticks). */
export function doseTable(): DataTable {
  return fixedTable('xy', { type: 'replicates', count: 1 }, [[[5, 8, 20, 55, 85, 95]]], {
    titles: ['Response'],
    x: [0.01, 0.1, 1, 10, 100, 1000],
  })
}

/** A UMAP of a synthetic cells table (clusters coloured), its axes titled UMAP 1 and UMAP 2. */
export function umapGraph(): [DataTable, GraphNode] {
  const t = syntheticTable({ rows: 300, genes: 2, pcs: 2, cellIds: false })
  const key = (title: string) => t.dataSets.find((d) => d.title === title)!.id
  const g = presetGraph(t, 'bubble')
  return [
    t,
    {
      ...g,
      id: 'g1' as NodeId,
      levelOrder: 'natural',
      layers: g.layers.map((l) =>
        l.aes
          ? ({
              ...l,
              aes: { x: key('UMAP_1'), y: key('UMAP_2'), color: key('cluster') },
              style: { ...l.style, size: 3 },
            } as Layer)
          : l,
      ),
      axes: {
        ...g.axes,
        x: { ...g.axes.x, title: { content: [{ text: 'UMAP 1' }] } },
        y: { ...g.axes.y, title: { content: [{ text: 'UMAP 2' }] } },
      } as GraphNode['axes'],
    },
  ]
}

/** A manual line (typed value) and a band between two, with labels. */
export function manualLayers(): Layer[] {
  return [
    {
      id: 'normal',
      geom: 'band',
      stat: {
        kind: 'result',
        fields: { lo: { ref: { from: 'number', v: 10 } }, hi: { ref: { from: 'number', v: 14 } } },
        lo: 'lo',
        hi: 'hi',
        template: 'Normal range',
        lineLabel: 'end',
      },
      data: { from: 'values' },
      style: { color: { rgb: '#4c9f70' } },
    },
    {
      id: 'cutoff',
      geom: 'refline',
      stat: {
        kind: 'result',
        fields: { at: { ref: { from: 'number', v: 17.5 } } },
        at: 'at',
        template: 'Cut-off',
        lineLabel: 'start',
      },
      data: { from: 'values' },
    },
  ] as Layer[]
}

/** The goldens of roadmap 36. */
export function axisExtrasCases(): AxisCase[] {
  const tt = treatmentTable()
  const bars = graphOf(tt, 'barsPoints')
  const grid = withCategoryAxis(bars, {
    treatments: { ...TYPED_GRID, lines: { color: { rgb: '#bfbfbf' }, width: 0.5, dash: 'solid' } },
  })
  const horizontal: GraphNode = {
    ...withCategoryAxis(bars, { treatments: TYPED_GRID }),
    style: { ...bars.style, orientation: 'horizontal' },
  }
  const seeded = withCategoryAxis(bars, { treatments: seededGrid(tt, bars) })

  const gt = genotypeTable()
  const grouped = withCategoryAxis(graphOf(gt, 'barsPoints'), {
    spans: { mark: 'bracket' },
    treatments: undefined,
  })
  const vars = sampleVariables()
  const mv = {
    ...presetGraph(vars, 'barsPoints', undefined, { mapping: { x: 'a', y: 'c', color: 'b' } }),
    id: 'g1' as NodeId,
  }
  const mvSpans = withCategoryAxis(mv, { spans: {} })

  const bt = brokenTable()
  const broken = (style: 'slash' | 'zigzag' | 'gap') =>
    withValueAxis(graphOf(bt, 'barsPoints'), 'y', {
      breaks: [{ from: 7, to: 85, gap: 8 }],
      pieces: [{ value: 0.6, unit: 'fraction' }, null],
      breakMark: style === 'slash' ? { size: 5 } : { style },
    })
  const twoBreaks = withValueAxis(
    graphOf(bt, 'barsPoints', (g) => ({ style: { ...g.style, orientation: 'horizontal' } })),
    'y',
    {
      breaks: [
        { from: 3.5, to: 3.9, gap: 6 },
        { from: 6, to: 90, gap: 6 },
      ],
      pieces: [null, { value: 60, unit: 'pt' }, { value: 0.25, unit: 'fraction' }],
      breakMark: { style: 'zigzag', size: 3 },
    },
  )

  const ot = oligomerTable()
  const text = withValueAxis(graphOf(ot, 'meanSd'), 'x', {
    tickText: ['Monomer', 'Dimer', 'Trimer', 'Tetramer', 'Pentamer'].map((t, i) => ({
      value: i + 1,
      text: t,
    })),
    rotation: 45,
    range: { min: 0.5, max: 5.5 },
  })

  const dt = doseTable()
  const logTicks = withValueAxis(
    withValueAxis(graphOf(dt, 'meanSd'), 'x', { scale: 'log10' }),
    'x',
    {
      tickValues: { major: [0.01, 1, 100], minor: [0.1, 10, 1000] },
      tickText: [{ value: 1, text: [{ text: '1 µM', bold: true }] }],
    },
  )

  const column = sampleTable('column')
  const manual: GraphNode = {
    ...graphOf(column, 'barsPoints'),
  }
  manual.layers = [...manualLayers().slice(0, 1), ...manual.layers, ...manualLayers().slice(1)]

  const [cells, umap] = umapGraph()
  const scaleBar: GraphNode = {
    ...umap,
    axes: {
      ...umap.axes,
      x: {
        ...(umap.axes.x as ContinuousAxisSpec),
        show: false,
        title: null,
        scaleBar: { length: 5, label: '5 units', place: 'bottomLeft' },
      },
      y: {
        ...(umap.axes.y as ContinuousAxisSpec),
        show: false,
        title: null,
        scaleBar: { length: 5, label: '5 units', place: 'bottomLeft' },
      },
    },
  }
  const arrows: GraphNode = { ...umap, style: { ...umap.style, frame: 'arrows' } }

  return [
    ['axis-treatment-grid', tt, grid],
    ['axis-treatment-grid-horizontal', tt, horizontal],
    ['axis-treatment-grid-seeded', tt, seeded],
    ['axis-spans-grouped', gt, grouped],
    ['axis-spans-variables', vars, mvSpans],
    ['axis-break-lengths-slash', bt, broken('slash')],
    ['axis-break-lengths-zigzag', bt, broken('zigzag')],
    ['axis-break-lengths-gap', bt, broken('gap')],
    ['axis-two-breaks-horizontal', bt, twoBreaks],
    ['axis-text-ticks', ot, text],
    ['axis-tick-list-log', dt, logTicks],
    ['axis-manual-line-band', column, manual],
    ['axis-scale-bar', cells, scaleBar],
    ['axis-corner-arrows-umap', cells, arrows],
  ]
}

/** (A column id, for tests naming data sets.) */
export const col = (id: string) => id as ColumnId
