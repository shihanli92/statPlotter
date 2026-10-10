import { type FontRegistry, layoutGraph, type Scene } from '@ps/graph'
import {
  type AnalysisNode,
  type AnalysisResult,
  type Annotation,
  type ContinuousAxisSpec,
  type DataTable,
  type GraphNode,
  type Layer,
  type LayoutItem,
  newAnnotationId,
  newGroupId,
  newLayoutItemId,
  type Project,
  type SymbolShape,
} from '@ps/model'
import { newLayout, pageSpec } from '../../layout/figure.ts'
import { axis, ExampleBuilder, stroke, title, xyTable } from '../synthetic/builder.ts'
import {
  FIG2A,
  FIG2B,
  FIG3C,
  FIG3C10,
  FIG4A,
  FIG4A_DOSED,
  FIG4A_PH,
  FIG4B,
  FIG5D,
} from './hoffmannData.ts'

/*
 * Figures 2–5 of a CC BY chemistry paper rebuilt from its source data (embedded, `hoffmannData.ts`):
 * Hoffmann, Saha, Volk, Sun, Englert & von Delius, "Autonomous migration of a phosphate group along
 * glycerol and inositol scaffolds driven by a phosphodiester reaction cycle", Nature Chemistry
 * (2026), https://doi.org/10.1038/s41557-026-02240-4 (CC BY 4.0; changes: only the data the
 * figures draw, rounded to 4 decimals, redrawn by this app). Kinetics by NMR: isomer distributions
 * over weeks, fuel cycles and minutes, with the app's analyses for the numbers the text prints
 * (row percentages, an exponential approach to equilibrium fitted globally, descriptive statistics
 * and straight lines over windows of rows). The paper's solid lines are simulations of a reaction
 * network (coupled rate equations), which the app can't fit or draw (docs/design/PAPER_PANELS.md):
 * only Fig. 3b gets fitted curves, from a model the app can write (A ⇌ B, first order).
 */

const CITATION =
  'Hoffmann, P. A., Saha, S., Volk, S., Sun, J., Englert, A. & von Delius, M. Autonomous migration of a phosphate group along glycerol and inositol scaffolds driven by a phosphodiester reaction cycle. Nat. Chem. (2026). https://doi.org/10.1038/s41557-026-02240-4. CC BY 4.0: data from the paper’s source data files (MOESM2–5), redrawn.'

// The paper's colours: G3P dark blue, G2P red, GCP black, G1,3CP grey; inositols as in Fig. 5d.
const NAVY = '#1f3b73'
const RED = '#c00000'
const BLACK = '#000000'
const GREY = '#808080'
const BLUE = '#4f81bd'
const PH_BLUE = '#2e75b6'

interface Look {
  color: string
  shape: SymbolShape
  open?: boolean
  size?: number
}
const G3P: Look = { color: NAVY, shape: 'circle', open: true }
const G2P: Look = { color: RED, shape: 'triangle', open: true }
const GCP: Look = { color: BLACK, shape: 'circle', size: 3.5 }
const G13: Look = { color: GREY, shape: 'square', open: true }

type Cells = readonly (number | null)[]

/** An XY table of single values: X and one data set per title. */
const xy = (name: string, xTitle: string, x: Cells, sets: Record<string, Cells>, notes: string) =>
  xyTable(
    name,
    xTitle,
    [...x],
    Object.fromEntries(Object.entries(sets).map(([t, v]) => [t, v.map((y) => [y])])),
    `${notes}\n\n${CITATION}`,
  )

/** The graph's data sets drawn in the paper's colours and symbols (by data set title). */
function looks(table: DataTable, looksByTitle: Record<string, Look>) {
  return (g: GraphNode): GraphNode => {
    const overrides: GraphNode['seriesOverrides'] = { ...g.seriesOverrides }
    const series: Record<string, { style: object }> = {}
    for (const [t, look] of Object.entries(looksByTitle)) {
      const ds = table.dataSets.find((d) => d.title === t)
      if (!ds) throw new Error(`${table.name}: no data set “${t}”`)
      overrides[ds.id] = { ...overrides[ds.id], color: { rgb: look.color } }
      series[ds.id] = {
        style: {
          shape: look.shape,
          size: look.size ?? 5,
          ...(look.open
            ? { fill: { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 } }
            : { fill: { type: 'solid', color: { series: true }, opacity: 1 } }),
          border: { color: { series: true }, width: look.open ? 1.2 : 0.5, dash: 'solid' },
        },
      }
    }
    return {
      ...g,
      seriesOverrides: overrides,
      layers: g.layers.map((l) =>
        l.geom === 'points' && l.data === undefined
          ? ({ ...l, series: { ...l.series, ...series } } as Layer)
          : l,
      ),
    }
  }
}

const cont = (a: GraphNode['axes']['x']): ContinuousAxisSpec => {
  if (a.type !== 'continuous') throw new Error('expected a continuous axis')
  return a
}

/** Axis range and tick interval. */
const ranged = (a: GraphNode['axes']['x'], min: number, max: number, interval: number) =>
  axis(a, { range: { min, max }, ticks: { interval, minor: 0 } })

/** Grey bars at the EDC doses (typed X values): a band 2 min wide per dose, behind the points. */
function doseBands(g: GraphNode, times: readonly number[]): GraphNode {
  const bands = times.map(
    (t, i): Layer =>
      ({
        id: `dose${i + 1}`,
        name: `EDC dose ${i + 1}`,
        geom: 'band',
        stat: {
          kind: 'result',
          fields: {
            lo: { ref: { from: 'number', v: t - 1 } },
            hi: { ref: { from: 'number', v: t + 1 } },
          },
          lo: 'lo',
          hi: 'hi',
          axis: 'x',
        },
        data: { from: 'values' },
        legend: 'hide',
        style: { color: { rgb: '#bfbfbf' }, opacity: 0.6 },
      }) as Layer,
  )
  return { ...g, layers: [...bands, ...g.layers] }
}

/** A box drawn with four lines (data space). */
function box(x0: number, x1: number, y0: number, y1: number, label: string): Annotation[] {
  const line = (a: [number, number], b: [number, number]): Annotation => ({
    type: 'line',
    id: newAnnotationId(),
    space: 'data',
    from: { x: a[0], y: a[1] },
    to: { x: b[0], y: b[1] },
    stroke: stroke('#000000', 1.5),
    arrow: 'none',
  })
  return [
    line([x0, y0], [x1, y0]),
    line([x1, y0], [x1, y1]),
    line([x1, y1], [x0, y1]),
    line([x0, y1], [x0, y0]),
    {
      type: 'text',
      id: newAnnotationId(),
      anchor: { space: 'data', x: (x0 + x1) / 2 - 22, y: y1 + 9 },
      content: title(label),
    },
  ]
}

/** A number of a result sheet's table by row label and column title. */
export function sheetNumber(
  r: AnalysisResult,
  sheet: string,
  rowLabel: string,
  column: string,
): number {
  const s = r.sheets.find((x) => x.key === sheet)
  for (const b of s?.blocks ?? []) {
    if (b.type !== 'table') continue
    const j = b.columns.indexOf(column)
    if (j < 0) continue
    const row = b.rows.find((cells) => {
      const c = cells[0]
      return c?.kind === 'text' && c.v === rowLabel
    })
    const v = row?.[j]
    if (v && (v.kind === 'number' || v.kind === 'integer')) return v.v
  }
  throw new Error(`no ${rowLabel} › ${column} in sheet ${sheet}`)
}

/** A graph on a figure page and its panel's letter. */
interface PlacedGraph {
  graph: GraphNode
  letter: string
}

/** Room for a panel's letter, gaps between graphs and rows, page margin (points). */
const LETTER_ROOM = 14
const GAP = 14
const MARGIN = 36

/**
 * A figure page as the published-data examples lay theirs out (`paper.ts`, which deployed builds
 * don't ship): rows of graphs at one scale (never above 1) on the Letter page, portrait or
 * landscape, that shows them largest, plot areas lined up along each row, each panel's bold
 * letter at the top left of its first graph, grouped with the panel's graphs.
 */
function placeFigure(
  rows: readonly PlacedGraph[][],
  scene: (graph: GraphNode) => Scene,
): { page: { width: number; height: number }; items: LayoutItem[] } {
  const scenes = rows.map((row) => row.map(({ graph }) => scene(graph)))
  const tops = scenes.map((row) => Math.max(...row.map((s) => s.plot.y)))
  const heights = scenes.map((row, r) =>
    Math.max(...row.map((s) => tops[r]! - s.plot.y + s.height)),
  )
  const width = Math.max(
    ...scenes.map(
      (row) => row.reduce((w, s) => w + LETTER_ROOM + s.width, 0) + GAP * (row.length - 1),
    ),
  )
  const height = heights.reduce((h, r) => h + r, 0) + GAP * (rows.length - 1)
  const fit = (p: { width: number; height: number }) =>
    Math.min(1, (p.width - 2 * MARGIN) / width, (p.height - 2 * MARGIN) / height)
  const portrait = pageSpec('letter', 'portrait')
  const landscape = pageSpec('letter', 'landscape')
  const page = fit(portrait) >= fit(landscape) ? portrait : landscape
  const s = fit(page)
  const items: LayoutItem[] = []
  const groups = new Map<string, ReturnType<typeof newGroupId>>()
  let y = MARGIN
  rows.forEach((row, r) => {
    let x = MARGIN
    row.forEach(({ graph, letter }, i) => {
      const sc = scenes[r]![i]!
      let group = groups.get(letter)
      if (!group) {
        group = newGroupId()
        groups.set(letter, group)
        items.push({
          type: 'text',
          id: newLayoutItemId(),
          group,
          x,
          y,
          content: {
            content: [{ text: letter, bold: true, size: Math.max(8, Math.round(14 * s)) }],
          },
        })
      }
      items.push({
        type: 'graph',
        id: newLayoutItemId(),
        group,
        graph: graph.id,
        x: x + LETTER_ROOM * s,
        y: y + (tops[r]! - sc.plot.y) * s,
        scale: s,
      })
      x += (LETTER_ROOM + sc.width + GAP) * s
    })
    y += (heights[r]! + GAP) * s
  })
  return { page, items }
}

export interface HoffmannBuild {
  project: Project
  results: Map<string, AnalysisResult>
  /** The analyses that give the numbers the paper prints, by a short name. */
  analyses: Record<string, AnalysisNode>
  /** The tables made, by name. */
  tables: Record<string, DataTable>
}

/** Builds the project (see the module comment). */
export function buildHoffmann(fonts: FontRegistry): HoffmannBuild {
  const b = new ExampleBuilder('Hoffmann et al. 2026 (Nature Chemistry)', fonts)
  const analyses: Record<string, AnalysisNode> = {}
  const tables: Record<string, DataTable> = {}
  const placed: Record<string, PlacedGraph[]> = {}
  const table = (t: DataTable) => {
    tables[t.name] = b.table(t)
    return tables[t.name]!
  }
  const place = (fig: string, label: string, graph: GraphNode) => {
    placed[fig] = [...(placed[fig] ?? []), { graph, letter: label }]
  }
  const current = (g: GraphNode) => b.project.nodes[g.id] as GraphNode

  /**
   * Fraction of total (each value as a percentage of its row's total) of a table's data sets, and
   * a new XY table of its percentages: the analysis gives a results sheet only, so a user copies
   * it into a table to graph it (as here, from the computed sheet).
   */
  const rowPercent = (src: DataTable, name: string, keyName: string, notes: string): DataTable => {
    const a = b.analyze(
      src,
      'fractionOfTotal',
      { divideBy: 'row', display: 'percent' },
      {
        name: `Fraction of total (row %) of ${src.name}`,
        link: false,
      },
    )
    analyses[keyName] = a
    const r = b.result(a.id)
    const block = r.sheets[0]!.blocks[0]!
    if (block.type !== 'table') throw new Error('expected a table')
    const x = src.x!.subcolumns[0]!.values
    if (block.rows.length !== x.length) throw new Error(`${name}: rows without values`)
    const sets = Object.fromEntries(
      src.dataSets.map((d, c) => [
        d.title,
        block.rows.map((row) => {
          const v = row[c + 1]
          return v?.kind === 'number' ? v.v : null
        }),
      ]),
    )
    return table(
      xy(
        name,
        src.x!.title,
        x,
        sets,
        `${notes} Made from the results of “${a.name}” (each value as a percentage of the total of its row), copied into a new table: Fraction of total gives a results sheet, not a table that graphs can use.`,
      ),
    )
  }

  // --- Fig. 2a: equilibrium, from G3P (left) and from G2P (right, time running backwards) ----------
  const eqFrom = (start: 'G3P' | 'G2P') => {
    const raw = table(
      xy(
        `Fig. 2a – Equilibrium from ${start} (as in the file)`,
        'Time (weeks)',
        FIG2A.weeks,
        start === 'G3P'
          ? { G3P: FIG2A.g3pFromG3P, G2P: FIG2A.g2pFromG3P }
          : { G3P: FIG2A.g3pFromG2P, G2P: FIG2A.g2pFromG2P },
        `Glycerophosphate (10 mM) in 100 mM HCl (pH 1), H2O:D2O 9:1, room temperature, from pristine ${start}: G3P and G2P by ³¹P NMR every week (mol%, as in the source data file; the two add up to 100–107%). The figure draws each as a percentage of the two (next table).`,
      ),
    )
    return rowPercent(
      raw,
      `Fig. 2a – Equilibrium from ${start} (% of G3P + G2P)`,
      `fig2a${start}`,
      `G3P and G2P from ${start} as percentages of their sum at each week, as Fig. 2a draws them.`,
    )
  }
  const eqG3P = eqFrom('G3P')
  const eqG2P = eqFrom('G2P')
  const halfGraph = (
    t: DataTable,
    right: boolean,
    xTitle: string,
    xMax: number,
    interval: number,
    legendAt: { x: number; y: number },
  ) =>
    b.graph(t, {
      preset: 'each',
      title: null,
      xTitle,
      yTitle: right ? null : 'Compound (mol%)',
      size: { plotWidth: 150, plotHeight: 150 },
      edit: (g0) => {
        const g = looks(t, { G3P, G2P })(g0)
        const x = { ...ranged(g.axes.x, 0, xMax, interval), ...(right ? { reverse: true } : {}) }
        const y = ranged(g.axes.y, 0, 100, 10)
        return {
          ...g,
          legend: { ...g.legend, position: 'inside', inside: legendAt },
          axes: right
            ? {
                x,
                // The right half's Y axis on the right, as the paper draws it.
                y: { ...cont(y), show: false, title: null },
                y2: { ...cont(y), title: null },
              }
            : { ...g.axes, x, y },
          seriesOverrides: right
            ? Object.fromEntries(
                t.dataSets.map((d) => [d.id, { ...g.seriesOverrides[d.id], yAxis: 'right' }]),
              )
            : g.seriesOverrides,
        }
      },
    })
  place('2', 'a', halfGraph(eqG3P, false, 'Time (weeks)', 12, 2, { x: 0.45, y: 0.3 }))
  place('2', 'a', halfGraph(eqG2P, true, 'Time (weeks)', 12, 2, { x: 0.08, y: 0.35 }))

  // --- Fig. 2b: ten EDC cycles from G3P and from G2P -----------------------------------------------
  const cyclesFrom = (start: 'G3P' | 'G2P') => {
    const t = table(
      xy(
        `Fig. 2b – EDC cycles from ${start}`,
        'Cycles',
        FIG2B.cycles,
        start === 'G3P'
          ? { G3P: FIG2B.g3pFromG3P, G2P: FIG2B.g2pFromG3P, 'G1,3CP': FIG2B.g13FromG3P }
          : { G3P: FIG2B.g3pFromG2P, G2P: FIG2B.g2pFromG2P, 'G1,3CP': FIG2B.g13FromG2P },
        `As Fig. 2a, but each cycle starts with 3.3 equiv. EDC, 80 min apart: G3P, G2P and the side product G1,3CP after each of ten cycles (mol%, ³¹P NMR).${start === 'G3P' ? ' The file heads the G3P column “G1P”. These values are not the ones the figure’s left half draws (e.g. G2P after the first cycle: 28.75% here, about 34% in the figure); the text’s 29% is this table’s.' : ' The file heads this block “Supplementary Figure 4”; the figure draws it as Fig. 2b’s right half.'}`,
      ),
    )
    // The G2P share of G3P + G2P (the text's 64%).
    const share = b.analyze(
      t,
      'fractionOfTotal',
      { divideBy: 'row', display: 'percent' },
      {
        keys: t.dataSets.filter((d) => d.title !== 'G1,3CP').map((d) => d.id),
        name: `Fraction of total (row %) of G3P and G2P, ${t.name}`,
        link: false,
      },
    )
    analyses[`fig2b${start}`] = share
    return t
  }
  const cyG3P = cyclesFrom('G3P')
  const cyG2P = cyclesFrom('G2P')
  const cycleGraph = (t: DataTable, right: boolean) => {
    const g = halfGraph(
      t,
      right,
      'Cycles',
      10,
      2,
      right ? { x: 0.05, y: 0.02 } : { x: 0.45, y: 0.02 },
    )
    return b.edit(g, (x) => looks(t, { G3P, G2P, 'G1,3CP': G13 })(x))
  }
  place('2', 'b', cycleGraph(cyG3P, false))
  place('2', 'b', cycleGraph(cyG2P, true))

  // --- Fig. 3b: approach to equilibrium, with a global fit of A ⇌ B --------------------------------
  const eqBoth = table(
    xy(
      'Fig. 3b – Approach to equilibrium (both starts)',
      'Time (weeks)',
      FIG2A.weeks,
      {
        'G3P (from G3P)': FIG2A.g3pFromG3P,
        'G2P (from G3P)': FIG2A.g2pFromG3P,
        'G3P (from G2P)': FIG2A.g3pFromG2P,
        'G2P (from G2P)': FIG2A.g2pFromG2P,
      },
      'The data of Fig. 2a as in the file (mol%), both starting points in one table, as Fig. 3b draws them. The paper’s lines simulate its reaction network without EDC, which reduces to G3P ⇌ G2P (rate constants kg and kg−1, Fig. 3a); the user-defined equation fits that model to all four data sets at once, kg and kg−1 shared (Y in mol% of 100).',
    ),
  )
  const keyOf = (t: DataTable, title: string) => t.dataSets.find((d) => d.title === title)!.id
  const eqGraph = (start: 'G2P' | 'G3P') =>
    b.graph(eqBoth, {
      preset: 'each',
      name: `Fig. 3b – Equilibrium from ${start}`,
      title: null,
      xTitle: 'Time (weeks)',
      yTitle: 'Compound (mol%)',
      size: { plotWidth: 170, plotHeight: 110 },
      edit: (g0) => {
        const g = looks(eqBoth, {
          [`G3P (from ${start})`]: { ...G3P, size: 4 },
          [`G2P (from ${start})`]: { ...G2P, size: 4.5 },
        })(g0)
        return {
          ...g,
          seriesSource: {
            ...g.seriesSource,
            include: [keyOf(eqBoth, `G3P (from ${start})`), keyOf(eqBoth, `G2P (from ${start})`)],
          },
          legend: { ...g.legend, position: 'inside', inside: { x: 0.62, y: 0.35 } },
          axes: {
            ...g.axes,
            x: ranged(g.axes.x, 0, 12, 2),
            y: ranged(g.axes.y, 0, 100, 20),
          },
        }
      },
    })
  const eqTop = eqGraph('G2P')
  const eqBottom = eqGraph('G3P')
  analyses.fig3bFit = b.analyze(
    eqBoth,
    'nonlinearFit',
    {
      equation: 'user',
      userEquation: [
        '; G3P ⇌ G2P, first order both ways (kg: G3P → G2P, kgr: G2P → G3P), Y in mol%',
        'k = kg + kgr',
        'feq = kg/k',
        '<A,B> s = 0',
        '<C,D> s = S0',
        '<A,C> Y = 100*((1 - feq) - (s - feq)*exp(-k*X))',
        '<B,D> Y = 100*(feq + (s - feq)*exp(-k*X))',
      ].join('\n'),
      constraints: {
        kg: { kind: 'shared' },
        kgr: { kind: 'shared' },
        S0: { kind: 'shared' },
      },
      initialValues: { kg: 0.05, kgr: 0.4, S0: 0.97 },
    },
    { name: 'Fig. 3b – Global fit: G3P ⇌ G2P (kg, kg−1 shared)' },
  )
  // Each graph keeps the curves of its own data sets.
  for (const g of [eqTop, eqBottom])
    b.edit(g, (x) => {
      const include = x.seriesSource.include as string[]
      return {
        ...x,
        layers: x.layers.map((l) =>
          l.data?.from === 'outputs'
            ? ({
                ...l,
                data: {
                  ...l.data,
                  series: l.data.series.filter((s) => !s.colorOf || include.includes(s.colorOf)),
                },
              } as Layer)
            : l,
        ),
      }
    })
  place('3', 'b', current(eqTop))
  place('3', 'b', current(eqBottom))

  // --- Fig. 3c: one fuel cycle ----------------------------------------------------------------------
  const kinetic = (t: DataTable, label: string) =>
    b.graph(t, {
      preset: 'each',
      name: label,
      title: label.replace(/^Fig\. 3c – /, ''),
      xTitle: 'Time (min)',
      yTitle: 'Compound (mol%)',
      size: { plotWidth: 150, plotHeight: 110 },
      edit: (g0) => {
        const g = looks(t, { G3P, G2P, GCP, 'G1,3CP': G13 })(g0)
        return {
          ...g,
          legend: { ...g.legend, position: 'top' },
          axes: { ...g.axes, x: ranged(g.axes.x, 0, 80, 20), y: ranged(g.axes.y, 0, 100, 20) },
        }
      },
    })
  const cycleNotes =
    'Glycerophosphate (10 mM) in 100 mM HCl, H2O:D2O 9:1, after one dose of EDC: G3P, G2P, the cyclic phosphodiester GCP and the side product G1,3CP (mol%, ³¹P NMR). The paper’s lines are simulations of its reaction network (not drawn).'
  const c33G3P = table(
    xy(
      'Fig. 3c – 3.3 equiv. EDC from G3P',
      'Time (min)',
      FIG3C.min,
      {
        G3P: FIG3C.g3pFromG3P,
        G2P: FIG3C.g2pFromG3P,
        GCP: FIG3C.gcpFromG3P,
        'G1,3CP': FIG3C.g13FromG3P,
      },
      `${cycleNotes} 3.3 equiv. EDC, from G3P.`,
    ),
  )
  const c33G2P = table(
    xy(
      'Fig. 3c – 3.3 equiv. EDC from G2P',
      'Time (min)',
      FIG3C.min,
      {
        G3P: FIG3C.g3pFromG2P,
        G2P: FIG3C.g2pFromG2P,
        GCP: FIG3C.gcpFromG2P,
        'G1,3CP': FIG3C.g13FromG2P,
      },
      `${cycleNotes} 3.3 equiv. EDC, from G2P.`,
    ),
  )
  const c10 = table(
    xy(
      'Fig. 3c – 10 equiv. EDC from G3P (seconds)',
      'Time (s)',
      FIG3C10.seconds,
      { G3P: FIG3C10.g3p, G2P: FIG3C10.g2p, GCP: FIG3C10.gcp, 'G1,3CP': FIG3C10.g13 },
      `${cycleNotes} 10 equiv. EDC, from G3P; the file gives the time in seconds, the figure in minutes (a Transform of X makes the next table).`,
    ),
  )
  const c10min = b.analyze(
    c10,
    'transform',
    { y: 'none', x: 'divideK', kx: 60 },
    { name: 'Fig. 3c – 10 equiv. EDC from G3P (minutes)', link: false },
  )
  place('3', 'c', kinetic(c33G3P, 'Fig. 3c – 3.3 equiv. EDC from G3P'))
  place('3', 'c', kinetic(c33G2P, 'Fig. 3c – 3.3 equiv. EDC from G2P'))
  const c10graph = b.graph(c10min, {
    preset: 'each',
    name: 'Fig. 3c – 10 equiv. EDC from G3P',
    title: '10 equiv. EDC from G3P',
    xTitle: 'Time (min)',
    yTitle: 'Compound (mol%)',
    size: { plotWidth: 150, plotHeight: 110 },
    edit: (g0) => {
      const t = b.source(c10min.id)
      const g = looks(t, { G3P, G2P, GCP, 'G1,3CP': G13 })(g0)
      return {
        ...g,
        legend: { ...g.legend, position: 'top' },
        axes: { ...g.axes, x: ranged(g.axes.x, 0, 80, 20), y: ranged(g.axes.y, 0, 100, 20) },
      }
    },
  })
  place('3', 'c', c10graph)

  // --- Fig. 4a: one dose of 50 equiv. EDC; multidose EDC, EDU and pH --------------------------------
  const big = table(
    xy(
      'Fig. 4a – 50 equiv. EDC',
      'Time (min)',
      FIG4A.min,
      { GCP: FIG4A.gcp, EDC: FIG4A.edc, pH: FIG4A.pH },
      'One dose of 50 equiv. EDC to 10 mM G3P in 100 mM HCl: GCP (mol% of 10 mM, ³¹P NMR), EDC (mol% of 500 mM, ¹H NMR) and pH (pH meter), every 3 min. pH on the right axis.',
    ),
  )
  const bigGraph = b.graph(big, {
    preset: 'each',
    title: '50 equiv. EDC addition',
    xTitle: 'Time (min)',
    yTitle: 'Relative amount (mol%)',
    size: { plotWidth: 150, plotHeight: 130 },
    edit: (g0) => {
      const g = looks(big, {
        GCP: { ...GCP, size: 3 },
        EDC: { color: NAVY, shape: 'circle', size: 3 },
        pH: { color: PH_BLUE, shape: 'circle', size: 3 },
      })(g0)
      const ph = keyOf(big, 'pH')
      return {
        ...g,
        legend: { ...g.legend, position: 'inside', inside: { x: 0.62, y: 0.02 } },
        axes: {
          x: ranged(g.axes.x, 0, 200, 50),
          y: ranged(g.axes.y, 0, 100, 20),
          y2: {
            ...cont(ranged(g.axes.y, 1, 3.5, 0.5)),
            title: { ...title('pH'), style: { color: { rgb: PH_BLUE } } },
            tickLabels: { color: { rgb: PH_BLUE } },
          },
        },
        seriesOverrides: {
          ...g.seriesOverrides,
          [ph]: { ...g.seriesOverrides[ph], yAxis: 'right' },
        },
      }
    },
  })
  place('4', 'a', bigGraph)
  analyses.fig4aPH = b.analyze(
    big,
    'descriptive',
    {},
    {
      keys: [keyOf(big, 'pH')],
      name: 'Fig. 4a – pH after 50 equiv. EDC (descriptive statistics)',
      link: false,
    },
  )
  const plateau = b.analyze(
    big,
    'filterRows',
    { condition: 'GCP >= 85' },
    {
      name: 'Fig. 4a – GCP plateau (rows with GCP ≥ 85%)',
      link: false,
    },
  )
  analyses.fig4aPlateau = plateau
  analyses.fig4aPlateauStats = b.analyze(
    plateau,
    'descriptive',
    {},
    {
      name: 'Fig. 4a – GCP plateau (descriptive statistics)',
      link: false,
    },
  )
  // GCP hydrolysis once the pH is back (from 64 min): one-phase decay.
  const hydrolysis = b.analyze(
    big,
    'filterRows',
    { condition: 'X >= 63' },
    {
      keys: [keyOf(big, 'GCP')],
      name: 'Fig. 4a – GCP after the pH returned (from 63 min)',
      link: false,
    },
  )
  analyses.fig4aDecay = b.analyze(
    hydrolysis,
    'nonlinearFit',
    { equation: 'one-phase-decay' },
    {
      name: 'Fig. 4a – GCP hydrolysis (one-phase decay)',
      link: false,
    },
  )

  const dosed = table(
    xy(
      'Fig. 4a – Multidose EDC (mM)',
      'Time (min)',
      FIG4A_DOSED.min,
      { EDU: FIG4A_DOSED.edu, EDC: FIG4A_DOSED.edc },
      'Multidose fuelling: 2.5 equiv. EDC (25 mM) every 15 min over 180 min; EDC and its waste EDU by ¹H NMR (mM), three spectra after each dose.',
    ),
  )
  place(
    '4',
    'a',
    b.graph(dosed, {
      preset: 'each',
      title: 'Dosed EDC fuelling',
      xTitle: 'Time (min)',
      yTitle: 'Concentration (mM)',
      size: { plotWidth: 130, plotHeight: 130 },
      edit: (g0) => {
        const g = looks(dosed, {
          EDU: { color: GREY, shape: 'circle', size: 3 },
          EDC: { color: NAVY, shape: 'circle', size: 3 },
        })(g0)
        return {
          ...g,
          legend: { ...g.legend, position: 'inside', inside: { x: 0.7, y: 0.3 } },
          axes: { ...g.axes, x: ranged(g.axes.x, 0, 250, 50), y: ranged(g.axes.y, 0, 300, 50) },
        }
      },
    }),
  )
  const fuelling = b.analyze(
    dosed,
    'filterRows',
    { condition: 'X >= 3 and X <= 175' },
    {
      keys: [keyOf(dosed, 'EDC')],
      name: 'Fig. 4a – EDC while fuelling (3–175 min)',
      link: false,
    },
  )
  analyses.fig4aEDC = b.analyze(
    fuelling,
    'descriptive',
    {},
    {
      name: 'Fig. 4a – EDC while fuelling (descriptive statistics)',
      link: false,
    },
  )

  const ph = table(
    xy(
      'Fig. 4a – Multidose pH',
      'Time (min)',
      FIG4A_PH.min,
      { pH: FIG4A_PH.pH },
      'pH under the multidose protocol (2.5 equiv. EDC every 15 min), every minute, from a separate run.',
    ),
  )
  const phGraph = b.graph(ph, {
    preset: 'each',
    title: 'pH quasi-constant',
    xTitle: 'Time (min)',
    yTitle: 'pH',
    size: { plotWidth: 330, plotHeight: 50 },
    edit: (g) => ({
      ...g,
      legend: { ...g.legend, show: false },
      seriesOverrides: { [keyOf(ph, 'pH')]: { color: { rgb: BLACK } } },
      layers: [
        {
          id: 'line',
          geom: 'line',
          stat: { kind: 'identity' },
          style: { stroke: stroke(BLACK, 1) },
        } as Layer,
      ],
      axes: { ...g.axes, x: ranged(g.axes.x, 0, 200, 50), y: ranged(g.axes.y, 1, 2, 0.5) },
    }),
  })
  place('4', 'a', phGraph)
  const fuelled = b.analyze(
    ph,
    'filterRows',
    { condition: 'X >= 0.5' },
    {
      name: 'Fig. 4a – pH once fuelling started',
      link: false,
    },
  )
  analyses.fig4aPHDosed = b.analyze(
    fuelled,
    'descriptive',
    {},
    {
      name: 'Fig. 4a – pH under multidose fuelling (descriptive statistics)',
      link: false,
    },
  )

  // --- Fig. 4b: the triplicates, each at its own times ----------------------------------------------
  const R = [
    { t: FIG4B.r1Min, gcp: FIG4B.r1Gcp, g3p: FIG4B.r1G3p, g2p: FIG4B.r1G2p, g13: FIG4B.r1G13 },
    { t: FIG4B.r2Min, gcp: FIG4B.r2Gcp, g3p: FIG4B.r2G3p, g2p: FIG4B.r2G2p, g13: FIG4B.r2G13 },
    { t: FIG4B.r3Min, gcp: FIG4B.r3Gcp, g3p: FIG4B.r3G3p, g2p: FIG4B.r3G2p, g13: null },
  ]
  // Stacked: each replicate's rows in turn, its values in its own subcolumn.
  const stackX = R.flatMap((r) => r.t)
  const stacked = (f: (r: (typeof R)[number]) => Cells | null) =>
    R.flatMap((r, i) =>
      r.t.map((_, k) => [0, 1, 2].map((j) => (j === i ? (f(r)?.[k] ?? null) : null))),
    )
  const triplicates = table(
    xyTable(
      'Fig. 4b – Multidose steady state (triplicates)',
      'Time (min)',
      stackX,
      {
        G2P: stacked((r) => r.g2p),
        G3P: stacked((r) => r.g3p),
        GCP: stacked((r) => r.gcp),
        'G1,3CP': stacked((r) => r.g13),
      },
      `10 mM G3P in 100 mM HCl, 2.5 equiv. EDC every 15 min (12 doses), ³¹P NMR (mol%), in triplicate. The three runs were sampled at different times (up to 9 min apart), so their rows are stacked, each run in its own subcolumn (replicate 3 has no G1,3CP). The paper draws the averages of the three runs, which needs their values at common times: the app has no way to put them on one time grid, so every value is drawn.\n\n${CITATION}`,
    ),
  )
  for (const ds of triplicates.dataSets) ds.subcolumnTitles = ['Run 1', 'Run 2', 'Run 3']
  const ssGraph = b.graph(triplicates, {
    preset: 'each',
    title: null,
    xTitle: 'Time (min)',
    yTitle: 'Compound (mol%)',
    size: { plotWidth: 260, plotHeight: 150 },
    edit: (g0) => {
      const g = looks(triplicates, {
        G2P: { ...G2P, open: false, size: 3.5 },
        G3P: { ...G3P, size: 3 },
        GCP: { ...GCP, size: 3 },
        'G1,3CP': { ...G13, size: 3 },
      })(g0)
      return doseBands(
        {
          ...g,
          legend: { ...g.legend, position: 'right' },
          axes: { ...g.axes, x: ranged(g.axes.x, 0, 300, 50), y: ranged(g.axes.y, 0, 100, 20) },
          annotations: box(110, 195, 0, 62, 'Steady state'),
        },
        Array.from({ length: 12 }, (_, i) => 15 * i),
      )
    },
  })
  place('4', 'b', ssGraph)
  const window = b.analyze(
    triplicates,
    'filterRows',
    { condition: 'X >= 110 and X <= 195' },
    {
      name: 'Fig. 4b – Steady-state window (110–195 min)',
      link: false,
    },
  )
  analyses.fig4bWindow = window
  analyses.fig4bSlopes = b.analyze(
    window,
    'linearRegression',
    {},
    {
      name: 'Fig. 4b – Straight lines over the steady-state window',
      link: false,
    },
  )
  analyses.fig4bMeans = b.analyze(
    window,
    'descriptive',
    {},
    {
      name: 'Fig. 4b – Steady-state window (descriptive statistics)',
      link: false,
    },
  )

  // --- Fig. 5d: inositol phosphates under multidose fuelling ----------------------------------------
  const inoRaw = table(
    xy(
      'Fig. 5d – Inositol phosphates (as in the file)',
      'Time (min)',
      FIG5D.min,
      {
        I1P: FIG5D.i1p,
        I2P: FIG5D.i2p,
        'I1,2CP': FIG5D.i12cp,
        'I2,3CP': FIG5D.i23cp,
        I3P: FIG5D.i3p,
      },
      'Enantioenriched I1P:I3P (9:1, 5 mM) in 100 mM HCl, 5 equiv. EDC every 15 min (24 doses, to 345 min), then hydrolysis; ³¹P NMR, as in the source data file (the five add up to about 52 at every time). The figure draws each as a percentage of the five (next table).',
    ),
  )
  const ino = rowPercent(
    inoRaw,
    'Fig. 5d – Inositol phosphates (% of the five)',
    'fig5dPercent',
    'The inositol phosphates as percentages of the five at each time, as Fig. 5d draws them.',
  )
  place(
    '5',
    'd',
    b.graph(ino, {
      preset: 'each',
      title: null,
      xTitle: 'Time (min)',
      yTitle: 'Compound (mol%)',
      size: { plotWidth: 260, plotHeight: 170 },
      edit: (g0) => {
        const g = looks(ino, {
          I1P: { color: NAVY, shape: 'square', size: 3.5 },
          I2P: { color: BLUE, shape: 'triangle', size: 4 },
          'I1,2CP': { color: BLACK, shape: 'circle', size: 3 },
          'I2,3CP': { color: '#7f7f7f', shape: 'circle', size: 3 },
          I3P: { color: RED, shape: 'diamond', size: 4 },
        })(g0)
        return doseBands(
          {
            ...g,
            legend: { ...g.legend, position: 'inside', inside: { x: 0.85, y: 0.02 } },
            axes: {
              ...g.axes,
              x: ranged(g.axes.x, 0, 500, 100),
              y: ranged(g.axes.y, 0, 100, 10),
            },
          },
          Array.from({ length: 24 }, (_, i) => 15 * i),
        )
      },
    }),
  )
  const steady = b.analyze(
    ino,
    'filterRows',
    { condition: 'X >= 285 and X <= 346' },
    {
      name: 'Fig. 5d – Last hour of fuelling (285–346 min)',
      link: false,
    },
  )
  analyses.fig5dSteady = b.analyze(
    steady,
    'descriptive',
    {},
    {
      name: 'Fig. 5d – Last hour of fuelling (descriptive statistics)',
      link: false,
    },
  )
  const relaxed = b.analyze(
    ino,
    'filterRows',
    { condition: 'X >= 455' },
    {
      name: 'Fig. 5d – Relaxed (from 455 min)',
      link: false,
    },
  )
  analyses.fig5dRelaxed = b.analyze(
    relaxed,
    'descriptive',
    {},
    {
      name: 'Fig. 5d – Relaxed (descriptive statistics)',
      link: false,
    },
  )

  // --- Figure pages ----------------------------------------------------------------------------------
  const lookup = (id: string) => b.results.get(id as never)
  const scene = (graph: GraphNode) =>
    layoutGraph({ project: b.project, graph: current(graph), fonts, result: lookup })
  const NOTES: Record<string, string> = {
    '2': 'Fig. 2a draws each isomer as a percentage of G3P + G2P (the source data file gives mol% adding up to 100–107%); its right half runs time backwards, the Y axis on the right. Fig. 2b’s left half doesn’t draw the values of the source data file (the text’s 29% and 64% are the file’s); here the file’s values are drawn. The schemes are not charts.',
    '3': 'Fig. 3a (reaction network) and 3d (conclusions) are schemes. The paper’s solid lines in 3b and 3c are simulations of its reaction network; the app fits the network without EDC (G3P ⇌ G2P, first order both ways) to 3b, but can’t fit or draw a network of several coupled species (3c).',
    '4': 'Fig. 4b draws the averages of three runs with a simulation; the runs were sampled at different times, which the app can’t average (every value drawn, run by run). The steady-state box and the grey dose bars are drawn by hand; the schemes are not charts.',
    '5': 'Fig. 5a (synthesis) and 5e (reaction network) are schemes; 5b (³¹P NMR spectra) and 5c (chiral HPLC chromatograms) have no source data. The simulation lines of 5d are not drawn (a reaction network).',
  }
  for (const fig of ['2', '3', '4', '5']) {
    const graphs = (placed[fig] ?? []).map((p) => ({ ...p, graph: current(p.graph) }))
    // Panels of one letter side by side; Fig. 4's pH strip on a row of its own.
    const rows: PlacedGraph[][] =
      fig === '4'
        ? [graphs.slice(0, 2), graphs.slice(2, 3), graphs.slice(3)]
        : fig === '3'
          ? [graphs.slice(0, 2), graphs.slice(2)]
          : [graphs]
    const page = placeFigure(rows, scene)
    b.add({
      ...newLayout(`Fig. ${fig} (reproduced)`, page.page, page.items, { show: false, style: 'a' }),
      notes: `${NOTES[fig]}\n\n${CITATION}`,
    })
  }
  return { project: b.project, results: b.results, analyses, tables }
}

/** The example's project. */
export const createHoffmannExample = (fonts: FontRegistry): Project => buildHoffmann(fonts).project
