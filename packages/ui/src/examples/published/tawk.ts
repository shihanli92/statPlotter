import { type FontRegistry, NEW_LIGHT_BAR_FILL } from '@ps/graph'
import { type DataTable, type GraphNode, type Layer, type Project, rowCategoryKey } from '@ps/model'
import { columnTable, flatTable, groupedTable } from '../synthetic/builder.ts'
import {
  type AnalysisSpec,
  buildPaper,
  type GraphSpec,
  type Panel,
  type PaperSpec,
} from './paper.ts'
import { TAWK_FILES } from './tawkData.ts'

/*
 * Figures 1–5 of Tawk, El Mouali, Huang et al., "Synergy between Enterobacteriaceae and diet
 * mediates competition between dominant Bacteroidales in the human gut", Nature Microbiology
 * (2026), https://doi.org/10.1038/s41564-026-02500-6, rebuilt from the paper's source data
 * (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/). The data are embedded
 * (`tawkData.ts`, the source-data sheets' cells as CSV), so the example is part of every build,
 * loaded when first opened. It is built as the local papers are (`buildPaper`): each panel's table
 * imported from its file as a user would, the analyses the legends name (or the ones the source
 * data's pasted results show were run), and a page per figure. Besides the stars in the figures,
 * the P values in the source data (results pasted beside the values) are checked against
 * the app's.
 */

const ORANGE = '#f28c28'
const BLUE = '#4f8fd8'
const TAN = '#f2b880'
const GREEN = '#1ec81e'
const NAVY = '#2f5597'
const KHAKI = '#c8a26e'

/** The genera's colours in the paper's taxonomic bar plots. */
const GENUS_COLORS: Record<string, string> = {
  Bacteroides: '#8ecbf0',
  Bifidobacterium: '#eef5b0',
  Collinsella: '#9b1fe8',
  Dorea: '#f2c18a',
  Enterocloster: '#c9ef4f',
  Escherichia: '#a0522d',
  Lachnoclostridium: '#e8202a',
  Mediterraneibacter: '#a6e3a1',
  Parabacteroides: '#f7941d',
  Phocaeicola: '#1070c8',
  Roseburia: '#13a538',
  Segatella: '#c3b5ec',
  Thomasclavelia: '#f4a3b8',
}

/** A species' genus as the figures name it ([Clostridium] symbiosum is a Lachnoclostridium). */
const genusOf = (species: string) =>
  /symbiosum/.test(species) ? 'Lachnoclostridium' : (species.trim().split(/\s+/)[0] ?? species)

/** The six Bacteroidaceae species of the community. */
const BACTEROIDACEAE = /^(Bacteroides|Phocaeicola) /

/** The 12 genera Figs 1c shows, and those of Figs 2a and 2d (Parabacteroides for Enterocloster). */
const GENERA_1C = [
  'Bacteroides',
  'Bifidobacterium',
  'Collinsella',
  'Dorea',
  'Enterocloster',
  'Escherichia',
  'Lachnoclostridium',
  'Mediterraneibacter',
  'Phocaeicola',
  'Roseburia',
  'Segatella',
  'Thomasclavelia',
]
const GENERA_2 = GENERA_1C.map((g) => (g === 'Enterocloster' ? 'Parabacteroides' : g)).sort()
const REDUCED = ['Bacteroides', 'Escherichia', 'Phocaeicola', 'Segatella']

/** A table's row titles ('' for a row without one). */
const titlesOf = (t: DataTable): string[] => (t.rowTitles ?? []).map((x) => x ?? '')

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** A cell's value: data set `d`, row `r` (first replicate). */
const valueAt = (t: DataTable, d: number, r: number): number | null =>
  num(t.dataSets[d]?.subcolumns[0]?.values[r])

type Groups = [label: string, columns: number[]][]

/**
 * Species summed by genus and turned so that each sample is a bar: a grouped table with a row per
 * sample (titled "Input 1", …) and a data set per genus (in stacking order, bottom first).
 */
function compositionTable(t: DataTable, genera: string[], groups: Groups): DataTable {
  const titles = titlesOf(t)
  const bars = groups.flatMap(([label, cols]) =>
    cols.map((c, i) => ({ label: `${label} ${i + 1}`, c })),
  )
  const sums = (genus: string) =>
    bars.map(({ c }) => {
      let s = 0
      titles.forEach((title, r) => {
        if (genusOf(title) === genus) s += valueAt(t, c, r) ?? 0
      })
      return [s]
    })
  return groupedTable(
    t.name,
    bars.map((b) => b.label),
    Object.fromEntries([...genera].reverse().map((g) => [g, sums(g)])),
  )
}

const composition = (genera: string[], groups: Groups, what = ''): NonNullable<Panel['edit']> => ({
  describe: `Species summed by genus (the ${genera.length} genera the figure shows${what}), then turned so that each sample is a row (a stacked bar) and each genus a data set: ${groups.map(([l, c]) => `${l} = columns ${c.map((i) => i + 1).join(', ')}`).join('; ')} of the imported table. The app has no "sum rows by a label" step for grouped tables (done here as a user would in the spreadsheet).`,
  apply: (t) => compositionTable(t, genera, groups),
})

/**
 * A taxonomic bar plot: stacked bars to 100%, the genera's colours, the groups (Input, mGAM,
 * +Arabinan) as labels spanning their bars in place of the bars' names.
 */
function barPlot(
  genera: string[],
  groups: Groups,
  title: string,
  more: { name?: string; width?: number; legend?: boolean; spanSize?: number } = {},
): GraphSpec {
  const bars = groups.reduce((n, [, c]) => n + c.length, 0)
  return {
    ...(more.name ? { name: more.name } : {}),
    preset: 'stacked',
    yTitle: 'Relative abundance (%)',
    yRange: [0, 100],
    size: [more.width ?? Math.max(70, bars * 16), 110],
    colors: [...genera].reverse().map((g) => GENUS_COLORS[g]!),
    legend: more.legend ?? false,
    format: looks(title, {
      does: `Bars without names, the groups (${groups.map(([l]) => l).join(', ')}) as labels spanning their bars; the legend from the top genus down; Y ticks every 25.`,
      apply: (g) => {
        let row = 0
        const list = groups.map(([label, cols]) => {
          const keys = cols.map(() => rowCategoryKey(row++))
          return { label, keys, level: 1 as const }
        })
        const y = g.axes.y
        return {
          ...g,
          legend: { ...g.legend, reverse: true },
          axes: {
            ...g.axes,
            x: {
              ...g.axes.x,
              showLabels: false,
              ...(g.axes.x.type === 'categorical'
                ? {
                    spans: {
                      auto: false,
                      list,
                      mark: 'line' as const,
                      ...(more.spanSize ? { text: { size: more.spanSize } } : {}),
                    },
                  }
                : {}),
            },
            y: y.type === 'continuous' ? { ...y, ticks: { interval: 25, minor: 0 } } : y,
          },
        }
      },
    }),
  }
}

const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i)

/** Rows in reverse order (the figures draw a horizontal graph's first row at the bottom). */
const reversedRows = (why: string): NonNullable<Panel['edit']> => ({
  describe: `Rows in reverse order, so that ${why}.`,
  apply: (t) => {
    const n = t.rowCount
    const order = range(0, n).reverse()
    return {
      ...t,
      rowTitles: t.rowTitles ? order.map((r) => t.rowTitles![r]!) : null,
      dataSets: t.dataSets.map((d) => ({
        ...d,
        subcolumns: d.subcolumns.map((s) => ({ ...s, values: order.map((r) => s.values[r]!) })),
      })),
    }
  },
})

type Format = NonNullable<GraphSpec['format']>

/**
 * Bars filled solid in their colours (the presets fill them pale), a title or none. Bars with
 * points drawn on them are a lighter version of their colour (40%, outlined in it), as new
 * graphs' are (decision 1275): solid, the points in the same colour vanish into them.
 */
const looks = (title: string | null, more?: Format): Format => ({
  does: `Bars filled in their colours: solid, or lighter (40%) under the points drawn on them; ${title ? `titled “${title}”` : 'no title'}, as the figure.${more ? ` ${more.does}` : ''}`,
  apply: (g0, table) => {
    const points = g0.layers.some((l) => l.geom === 'points' && l.visible !== false)
    const fill = points
      ? NEW_LIGHT_BAR_FILL
      : { type: 'solid', color: { series: true }, opacity: 1 }
    const g: GraphNode = {
      ...g0,
      title: title === null ? null : g0.title && { ...g0.title, content: [{ text: title }] },
      layers: g0.layers.map((l) =>
        l.geom === 'bar' ? ({ ...l, style: { ...l.style, fill } } as Layer) : l,
      ),
    }
    return more ? more.apply(g, table) : g
  },
})

/** Horizontal bars at the mean ± SD with every value, as the figure's competition charts. */
const hbars = (
  colors: string[],
  xTitle: string,
  title: string | null,
  more: Partial<GraphSpec> = {},
): GraphSpec => ({
  preset: 'barsPoints',
  error: 'SD',
  horizontal: true,
  yTitle: xTitle,
  colors,
  format: looks(title),
  ...more,
})

/** Multiple t tests per row: the P values, the adjusted ones, and the figure's stars. */
function perRow(o: {
  test: string
  params: Record<string, unknown>
  a: string
  b: string
  /** Row title → P value in the source data. */
  p: Record<string, string>
  /** Row title → adjusted P (q) value in the source data. */
  adjusted: Record<string, string>
  adjustedName: string
  /** The params of the correction. */
  correction: Record<string, unknown>
  /** Rows the figure marks: '*' (as '<0.05') or 'ns' (NS printed); others unmarked. */
  stars: Record<string, string>
  starsWhy?: string
  /** Why the app's value differs from the source data's, by row: P, adjusted, marks. */
  differs?: {
    p?: Record<string, string>
    adjusted?: Record<string, string>
    stars?: Record<string, string>
  }
  why?: string
}): AnalysisSpec[] {
  const printed = (values: Record<string, string>, differs?: Record<string, string>) =>
    Object.entries(values).map(([row, p]) => ({
      a: o.a,
      b: o.b,
      row,
      p,
      ...(differs?.[row] ? { differs: differs[row]! } : {}),
    }))
  return [
    {
      analysis: 'multipleT',
      test: `${o.test} (P values)`,
      params: { ...o.params, approach: 'none' },
      dataSets: [o.a, o.b],
      ...(o.why ? { why: o.why } : {}),
      brackets: 'none',
      printed: printed(o.p, o.differs?.p),
    },
    {
      analysis: 'multipleT',
      test: `${o.test}, ${o.adjustedName}`,
      params: { ...o.params, ...o.correction },
      dataSets: [o.a, o.b],
      brackets: 'none',
      printed: printed(o.adjusted, o.differs?.adjusted),
    },
    {
      analysis: 'multipleT',
      test: `${o.test}, ${o.adjustedName} (the figure’s marks)`,
      params: { ...o.params, ...o.correction },
      dataSets: [o.a, o.b],
      ...(o.starsWhy ? { why: o.starsWhy } : {}),
      brackets: 'stars',
      printed: printed(o.stars, o.differs?.stars),
    },
  ]
}

const LOG_WHY =
  'the legend names unpaired two-sided t tests; the P values in the source data are lognormal multiple t tests (t tests of log10 values, an SD per row): R’s t.test of log10 values reproduces them, with zeros left out of the test.'

/** Figures 1b and 1e: counts printed in the figure (not in the source data). */
const PRINTED_FILES: Record<string, string> = {
  'Fig1BE_printed.csv': `Dietary compounds per category (counts printed in Fig. 1b and 1e)
Category,Compounds tested,S. copri-promoting
Algal,10,9
Animal,8,3
Bacterial,6,5
Fungal,9,5
Plant,42,30
Synthetic,4,2
Vitamin,15,2
`,
}

const CATEGORY_COLORS = [
  '#fff6c8',
  '#16e3f2',
  '#8fe08f',
  '#8b5a1a',
  '#f08cbf',
  '#0b4f5c',
  '#f5c242',
]

/** A pie of one column of the counts (parts of whole), slices in the figure's colours. */
const pie = (column: string, title: string): Pick<Panel, 'edit' | 'graph'> => ({
  edit: {
    describe: `The “${column}” counts as a parts-of-whole table (the importer makes grouped tables; a parts-of-whole table is chosen after importing).`,
    apply: (t) =>
      flatTable(
        t.name,
        'partsOfWhole',
        {
          [column]: titlesOf(t).map((_, r) =>
            valueAt(
              t,
              t.dataSets.findIndex((d) => d.title === column),
              r,
            ),
          ),
        },
        titlesOf(t),
      ),
  },
  graph: {
    preset: 'pie',
    size: [110, 110],
    format: {
      does: `Titled “${title}”; the counts on the slices, the categories’ colours.`,
      apply: (g, table) => {
        const key = table.dataSets[0]?.id
        return {
          ...g,
          title: g.title ? { ...g.title, content: [{ text: title }] } : g.title,
          layers: g.layers.map((l) =>
            l.id === 'labels' ? ({ ...l, style: { ...l.style, content: 'value' } } as Layer) : l,
          ),
          ...(key
            ? {
                pointOverrides: {
                  [key]: Object.fromEntries(
                    CATEGORY_COLORS.map((rgb, r) => [`r${r}`, { color: { rgb } }]),
                  ),
                },
              }
            : {}),
        }
      },
    },
  },
})

/** Two-way ANOVA within each column, every row against the first (control) row. */
const vsFirstRow = (method: 'dunnett' | 'sidak') => ({
  comparisons: 'withinColumns',
  kind: 'vsControl',
  controlMethod: method,
})

/** The comparisons of each row with the control row, in a data set. */
const againstControl = (
  dataSet: string,
  control: string,
  rows: Record<string, string>,
  differs?: string,
) =>
  Object.entries(rows).map(([row, p]) => ({
    a: dataSet,
    b: dataSet,
    row: control,
    rowB: row,
    p,
    ...(differs ? { differs } : {}),
  }))

/** Fig. 2e: the competitive index from the mean abundances of Figs 2a and 2d. */
function competitiveIndex(full: DataTable, others: DataTable[]): DataTable {
  const index = (t: DataTable, cols: number[]) => {
    const titles = titlesOf(t)
    const mean = (pick: (title: string) => boolean) =>
      cols.reduce(
        (s, c) =>
          s + titles.reduce((x, title, r) => x + (pick(title) ? (valueAt(t, c, r) ?? 0) : 0), 0),
        0,
      ) / cols.length
    const copri = mean((x) => /^Segatella copri/.test(x.trim()))
    const bac = mean((x) => BACTEROIDACEAE.test(x.trim()))
    return [Math.log2((copri + 1e-6) / (bac + 1e-6))]
  }
  const [noBac, noSeg, none] = others as [DataTable, DataTable, DataTable]
  const rows: [string, DataTable, number[], number[]][] = [
    ['Full community', full, [3, 4, 5], [6, 7, 8]],
    ['No Bacteroidaceae', noBac, [3, 4, 5], [6, 7, 8]],
    ['No Segatella', noSeg, [1, 2, 3], [4, 5, 6]],
    ['No community', none, [1, 2, 3], [4, 5, 6]],
  ]
  return groupedTable(
    'Fig. 2e – Competitive index',
    rows.map(([r]) => r),
    {
      mGAM: rows.map(([, t, m]) => index(t, m)),
      '+Arabinan': rows.map(([, t, , a]) => index(t, a)),
    },
  )
}

export const TAWK: PaperSpec = {
  id: 'tawk',
  title: 'Tawk et al. 2026 (Nature Microbiology)',
  description:
    'Figures 1–5 rebuilt from a CC BY 4.0 paper’s source data (Tawk et al., Nature Microbiology 2026, https://doi.org/10.1038/s41564-026-02500-6): taxonomic bar plots, a 21 × 94 heat map, pies, horizontal bars with points, two-way ANOVA against a control row, lognormal multiple t tests with FDR q values.',
  citation:
    'Tawk, El Mouali, Huang et al., “Synergy between Enterobacteriaceae and diet mediates competition between dominant Bacteroidales in the human gut”, Nature Microbiology (2026), https://doi.org/10.1038/s41564-026-02500-6 (CC BY 4.0).',
  folder: 'tawk',
  panels: [
    // ---------------------------------------------------------------- Fig. 1
    {
      label: '1b',
      name: 'Fig. 1b – Compounds per category',
      file: 'Fig1BE_printed.csv',
      sheet: 'Fig1BE_printed',
      legend: 'pie chart of the number of dietary compounds tested in each category (total 94).',
      ...pie('Compounds tested', 'Number of dietary compounds per category'),
    },
    {
      label: '1c',
      name: 'Fig. 1c – Community at passage 3',
      file: 'Fig1C.csv',
      sheet: 'Fig1C',
      legend:
        'relative abundance of the top 12 community genera at passage 3 and the input in mGAM; 3 biological replicates shown.',
      edit: composition(GENERA_1C, [
        ['Input', [0, 1, 2]],
        ['P3 mGAM', [3, 4, 5]],
      ]),
      graph: barPlot(
        GENERA_1C,
        [
          ['Input', [0, 1, 2]],
          ['P3 mGAM', [3, 4, 5]],
        ],
        'Full community',
        { legend: true },
      ),
    },
    {
      label: '1e',
      name: 'Fig. 1e – S. copri-promoting compounds',
      file: 'Fig1BE_printed.csv',
      sheet: 'Fig1BE_printed',
      legend:
        'proportion of the compounds of each category that significantly increase S. copri (FDR < 0.05; Kruskal–Wallis with FDR correction); total 56/94. The replicates behind the test are not in the source data.',
      ...pie('S. copri-promoting', 'Proportion of S. copri-promoting compounds (56/94)'),
    },
    {
      label: '1f',
      name: 'Fig. 1f – Compounds changing each member',
      file: 'Fig1F.csv',
      sheet: 'Fig1F',
      legend:
        'number of compounds that decrease or increase each member’s relative abundance (n = 3; FDR < 0.05; Kruskal–Wallis with FDR correction). The counts are the source data’s summary table; the tests’ replicates are not deposited.',
      edit: {
        describe:
          'The summary table’s Increase and Decrease columns kept (titled so), its “total” left out; rows in the sheet’s order (by total, as the figure).',
        apply: (t) => {
          const col = (re: RegExp) => t.dataSets.findIndex((d) => re.test(d.title))
          const inc = col(/increase/i)
          const dec = col(/decrease/i)
          const rows = titlesOf(t)
          return groupedTable(t.name, [...rows], {
            'Increase abundance': rows.map((_, r) => [valueAt(t, inc, r)]),
            'Decrease abundance': rows.map((_, r) => [valueAt(t, dec, r)]),
          })
        },
      },
      graph: {
        preset: 'stacked',
        horizontal: true,
        colors: ['#e8158c', '#000000'],
        yTitle: 'Number of compounds (FDR < 0.05)',
        yRange: [0, 80],
        size: [140, 230],
        legend: true,
        format: looks(null),
      },
    },
    {
      label: '1d',
      name: 'Fig. 1d – log2 fold change by compound',
      file: 'Fig1D.csv',
      sheet: 'Fig1D',
      legend:
        'log2 fold change of each member’s relative abundance with each compound against mGAM; averages of 3 replicates.',
      graph: {
        preset: 'heatmap',
        size: [600, 210],
        format: {
          does: 'No title; a blue–white–red scale from −4 to 4 centred on 0 (titled “log2 fold-change relative to mGAM”), compound names turned 90°, no cell values; the figure’s top rows (compound category, the S. copri/6 Bac. ratio) and family side bar are not drawn (no source data for the ratio; category bars need roadmap 36-style annotation tracks on heat maps).',
          apply: (g) => ({
            ...g,
            title: null,
            scales: {
              ...g.scales,
              color: {
                colors: 'blueRed',
                min: -4,
                max: 4,
                midpoint: 0,
                bar: { show: true, position: 'right', title: 'log2 fold-change relative to mGAM' },
              },
            },
            axes: {
              ...g.axes,
              x: g.axes.x.type === 'categorical' ? { ...g.axes.x, rotation: 90 } : g.axes.x,
            },
          }),
        },
      },
    },
    // ---------------------------------------------------------------- Fig. 2
    {
      label: '2a',
      name: 'Fig. 2a – Full community ± arabinan',
      file: 'Fig2A.csv',
      sheet: 'Fig2A',
      legend:
        'relative abundance of the top 12 genera at passage 3 and the input in mGAM and mGAM with arabinan (5 mg/ml); 3 biological replicates shown (the figure draws one input bar).',
      edit: composition(GENERA_2, [
        ['Input', [0, 1, 2]],
        ['mGAM', [3, 4, 5]],
        ['+Arabinan', [6, 7, 8]],
      ]),
      graph: barPlot(
        GENERA_2,
        [
          ['Input', [0, 1, 2]],
          ['mGAM', [3, 4, 5]],
          ['+Arabinan', [6, 7, 8]],
        ],
        'Full community',
        { legend: true },
      ),
    },
    {
      label: '2c',
      name: 'Fig. 2c – S. copri WT and ΔsusC1',
      file: 'Fig2C.csv',
      sheet: 'Fig2C',
      legend:
        'fold change of S. copri WT and ΔsusC1Ara relative abundance (arabinan/mGAM); bars mean ± s.d.; *P < 0.05 (unpaired two-sided Student’s t test, n = 3). The figure prints no mark; the source data give Welch’s test, P = 0.0043.',
      edit: {
        describe:
          'The sheet’s rows as data sets (Transpose): the three experiments’ fold changes of each strain, and the sheet’s three “logFC” columns as two more data sets. The sheet’s third logFC of ΔsusC1Ara (−0.00034) is not the log10 of its fold change (0.7516 → −0.124); the other five are.',
        apply: (t) => {
          const rows = titlesOf(t)
          const strain = (re: RegExp) => rows.findIndex((x) => re.test(x))
          const of = (r: number, from: number) => [0, 1, 2].map((d) => valueAt(t, from + d, r))
          return columnTable(t.name, {
            'S. copri WT': of(strain(/WT/), 0),
            'S. copri ΔsusC1Ara': of(strain(/Δ/), 0),
            'WT logFC (sheet)': of(strain(/WT/), 3),
            'ΔsusC1Ara logFC (sheet)': of(strain(/Δ/), 3),
          })
        },
      },
      analyses: [
        {
          analysis: 'ttest',
          test: 'Welch’s t test of the sheet’s logFC',
          params: { unpaired: { assumeEqualSD: false } },
          dataSets: ['WT logFC (sheet)', 'ΔsusC1Ara logFC (sheet)'],
          why: 'the source data’s pasted result (Welch’s test, P = 0.0043) is of the sheet’s logFC columns; with the log10 of the deposited fold changes Welch’s test gives 0.0085.',
          brackets: 'none',
          printed: [{ a: 'WT logFC (sheet)', b: 'ΔsusC1Ara logFC (sheet)', p: '0.0043' }],
        },
        {
          analysis: 'ttest',
          test: 'Unpaired t test (the legend’s)',
          dataSets: ['S. copri WT', 'S. copri ΔsusC1Ara'],
          why: 'the legend’s Student’s t test of the fold changes drawn gives P < 0.05 (the figure draws no mark).',
          brackets: 'none',
          printed: [{ a: 'S. copri WT', b: 'S. copri ΔsusC1Ara', p: '<0.05' }],
        },
      ],
      graph: hbars(
        ['#4b0f5c', '#9a7bbf'],
        'Fold-change in relative abundance (Arabinan/mGAM)',
        null,
        {
          dataSets: ['S. copri WT', 'S. copri ΔsusC1Ara'],
          size: [170, 60],
          yRange: [0, 25],
          legend: true,
        },
      ),
    },
    ...(
      [
        ['No Bacteroidaceae', 0, [0, 1, 2], [3, 4, 5], [6, 7, 8]],
        ['No Segatella', 1, [0], [1, 2, 3], [4, 5, 6]],
        ['No community', 2, [0], [1, 2, 3], [4, 5, 6]],
      ] as const
    ).map(([title, block, input, mgam, ara]): Panel => {
      const groups: Groups = [
        ['Input', [...input]],
        ['mGAM', [...mgam]],
        ['+Arabinan', [...ara]],
      ]
      return {
        label: '2d',
        name: `Fig. 2d – ${title}`,
        file: 'Fig2D.csv',
        sheet: 'Fig2D',
        block,
        legend:
          'top 12 genera at passage 3 and the input, with arabinan or mGAM alone; ‘No Bacteroidaceae’ without the 6 Bacteroidaceae, ‘No Segatella’ without S. copri, ‘No community’ only the 6 Bacteroidaceae and S. copri; 3 biological replicates shown.',
        edit: composition(GENERA_2, groups),
        graph: barPlot(GENERA_2, groups, title),
      }
    }),
    {
      label: '2e',
      name: 'Fig. 2e – Competitive index',
      file: 'Fig2A.csv',
      sheet: 'Fig2A',
      with: [0, 1, 2].map((block) => ({ file: 'Fig2D.csv', sheet: 'Fig2D', block })),
      legend:
        'competitive index between Prevotellaceae and Bacteroidaceae in the community assemblies of a and d: log2((S. copri + 10⁻⁶)/(6 Bacteroidaceae + 10⁻⁶)) (Methods). The figure draws −4.8 / 3.0, 10.1 / 10.0, −10.4 / −8.6 and −6.5 / −6.8 (mGAM / +Arabinan, read off the chart); the deposited data give the first two rows, not the last two (−11.8 / −12.0 and −12.0 / −12.8).',
      edit: {
        describe:
          'The competitive index of each assembly and medium, log2 of (S. copri + 10⁻⁶) over (the six Bacteroidaceae summed + 10⁻⁶), from the mean relative abundances at passage 3 of Fig. 2a and the three Fig. 2d tables (no app step divides one row by the sum of others: done as a user would in the spreadsheet).',
        apply: competitiveIndex,
      },
      graph: {
        preset: 'bars',
        horizontal: true,
        colors: [TAN, GREEN],
        yTitle: 'Competitive index (Segatella/Bacteroidaceae)',
        yRange: [-14, 12],
        size: [180, 110],
        legend: true,
        format: looks(null),
      },
    },
    // ---------------------------------------------------------------- Fig. 3
    ...(
      [
        ['No community', 0, ['Bacteroides', 'Phocaeicola', 'Segatella']],
        [
          '+Lachnospiraceae',
          25,
          ['Bacteroides', 'Phocaeicola', 'Segatella', 'Mediterraneibacter', 'Dorea', 'Roseburia'],
        ],
        ['+Collinsella', 16, ['Bacteroides', 'Phocaeicola', 'Segatella', 'Collinsella']],
        [
          '+Bifidobacteria spp.',
          34,
          ['Bacteroides', 'Phocaeicola', 'Segatella', 'Bifidobacterium'],
        ],
        ['+Thomasclavelia', 43, ['Bacteroides', 'Phocaeicola', 'Segatella', 'Thomasclavelia']],
        ['+E. coli', 7, ['Bacteroides', 'Phocaeicola', 'Segatella', 'Escherichia']],
      ] as const
    ).map(([title, at, genera]): Panel => {
      // "No community": an input column then six; the others three input columns then six.
      const groups: Groups =
        at === 0
          ? [
              ['Input', [0]],
              ['mGAM', [1, 2, 3]],
              ['+Arabinan', [4, 5, 6]],
            ]
          : [
              ['Input', range(at, 3)],
              ['mGAM', range(at + 3, 3)],
              ['+Arabinan', range(at + 6, 3)],
            ]
      return {
        label: '3a',
        name: `Fig. 3a – ${title}`,
        file: 'Fig3A.csv',
        sheet: 'Fig3A',
        import: {
          range: 'A5:BA26',
          headerRow: true,
          firstColumn: 'rowTitles',
          tableKind: 'grouped',
        },
        legend:
          'genus-level relative abundance of the community members in the input and at passage 3 with arabinan or mGAM alone; 3 biological replicates shown.',
        edit: composition([...genera], groups, `; the assembly’s columns of the sheet`),
        graph: barPlot([...genera], groups, title),
      }
    }),
    {
      label: '3b',
      name: 'Fig. 3b – S. copri with add-ins',
      file: 'Fig3B.csv',
      sheet: 'Fig3B',
      legend:
        'S. copri relative abundance in the competition with Bacteroidaceae, with different species added, with or without arabinan; *P < 0.0001 from two-sided t tests with correction for multiple comparisons, n = 3. Only +E. coli MR102 is marked.',
      edit: reversedRows(
        'No community is on top, as the figure (the sheet lists +E. coli MR102 first)',
      ),
      analyses: perRow({
        test: 'Multiple t tests (Welch)',
        params: { variance: 'welch' },
        a: 'mGAM',
        b: 'Arabinan',
        p: {
          '+E. coli MR102': '0.00021',
          '+Thomasclavelia': '0.615665',
          '+Bifidobacteria sp.': '0.428412',
          '+Collinsella': '0.014977',
          '+Lachnospiraceae': '0.136817',
          'no Community': '0.575996',
        },
        adjusted: {
          '+E. coli MR102': '0.001061',
          '+Thomasclavelia': '0.518184',
          '+Bifidobacteria sp.': '0.518184',
          '+Collinsella': '0.037818',
          '+Lachnospiraceae': '0.230309',
          'no Community': '0.518184',
        },
        adjustedName: 'FDR (two-stage step-up)',
        correction: { approach: 'fdr', fdrMethod: 'bky' },
        stars: { '+E. coli MR102': '<0.0001' },
        differs: {
          p: {
            '+Collinsella':
              'Welch’s test of the deposited values gives 0.014967 (R’s t.test as well): the values the source data tested differ slightly from the deposited ones (the other rows agree to six digits).',
          },
          adjusted: {
            '+Collinsella':
              'Its P value differs (above), so its q value does too: 0.037792 from the deposited values (the other rows’ q values agree; decision 1084).',
          },
          stars: {
            '+E. coli MR102':
              'The legend’s threshold: the source data give P = 0.00021, q = 0.0011 for this row (Welch, as the app), not below 0.0001.',
          },
        },
      }),
      graph: hbars([TAN, GREEN], 'S. copri relative abundance (%)', null, {
        yRange: [0, 100],
        size: [110, 170],
        legend: true,
      }),
    },
    ...(
      [
        [0, 'E. coli grown in co-culture with:'],
        [1, '6 Bac. grown in co-culture with:'],
        [2, 'S. copri grown in co-culture with:'],
      ] as const
    ).map(
      ([block, title]): Panel => ({
        label: '3c',
        name: `Fig. 3c – ${title.split(' ')[0] === '6' ? '6 Bac.' : title.split(' grown')[0]} (AUC)`,
        file: 'Fig3C.csv',
        sheet: 'Fig3C',
        block,
        legend:
          'area under the curve of growth curves in transwell co-cultures, each species also co-cultured with itself (monoculture control); representative of 3 independent experiments.',
        graph: {
          preset: 'heatmap',
          size: [70, 70],
          format: {
            does: `Titled “${title}”; white to blue (the ‘blues’ map), colour bar “Calculated AUC”.`,
            apply: (g) => ({
              ...g,
              title: g.title ? { ...g.title, content: [{ text: title }] } : g.title,
              scales: {
                ...g.scales,
                color: {
                  colors: 'blues',
                  bar: { show: true, position: 'right', title: 'Calculated AUC' },
                },
              },
            }),
          },
        },
      }),
    ),
    ...(
      [
        ['With S. copri', 6],
        ['Without S. copri', 0],
        ['Without E. coli', 12],
      ] as const
    ).map(([title, at]): Panel => {
      const groups: Groups = [
        ['mGAM', range(at, 3)],
        ['+Arabinan', range(at + 3, 3)],
      ]
      return {
        label: '3d',
        name: `Fig. 3d – ${title}`,
        file: 'Fig3D.csv',
        sheet: 'Fig3D',
        legend:
          'relative abundance of the genera in the community assemblies ‘with S. copri’, ‘without S. copri’ and ‘without E. coli’ at 20 h; 3 biological replicates shown.',
        edit: composition(REDUCED, groups),
        graph: barPlot(REDUCED, groups, `${title} (20 h)`, { legend: at === 6 }),
      }
    }),
    {
      label: '3g',
      name: 'Fig. 3g – Simple sugars with E. coli Nissle',
      file: 'Fig3G.csv',
      sheet: 'Fig3G',
      legend:
        'S. copri relative abundance in competitions with the 6 Bacteroidaceae with or without E. coli Nissle, in mGAM with the different sugars (n = 3); *P < 0.0001 by two-way ANOVA with Dunnett’s correction. The source data’s pasted results are Šídák’s comparisons.',
      edit: reversedRows('mGAM is the first (control) row and on top, as the figure'),
      analyses: [
        {
          analysis: 'twoWayAnova',
          test: 'Two-way ANOVA, Šídák vs mGAM within each column',
          params: vsFirstRow('sidak'),
          why: 'the source data’s pasted results are Šídák’s comparisons (the legend says Dunnett’s).',
          brackets: 'none',
          printed: [
            ...againstControl(
              'without E. coli',
              'mGAM',
              Object.fromEntries(
                [
                  '+Arabinan',
                  '+Arabinose',
                  '+Rhamnose',
                  '+Galactose',
                  '+Galacturonic acid',
                  '+[Arabinose+Rhamnose +Galactose+Galacturonic acid]',
                ].map((r) => [r, '>0.9999']),
              ),
            ),
            ...againstControl(
              'with E. coli',
              'mGAM',
              Object.fromEntries(
                [
                  '+Arabinan',
                  '+Arabinose',
                  '+Rhamnose',
                  '+Galactose',
                  '+Galacturonic acid',
                  '+[Arabinose+Rhamnose +Galactose+Galacturonic acid]',
                ].map((r) => [r, '<0.0001']),
              ),
            ),
          ],
        },
        {
          analysis: 'twoWayAnova',
          test: 'Two-way ANOVA, Dunnett vs mGAM within each column',
          params: vsFirstRow('dunnett'),
          brackets: 'stars',
          printed: againstControl(
            'with E. coli',
            'mGAM',
            Object.fromEntries(
              [
                '+Arabinan',
                '+Arabinose',
                '+Rhamnose',
                '+Galactose',
                '+Galacturonic acid',
                '+[Arabinose+Rhamnose +Galactose+Galacturonic acid]',
              ].map((r) => [r, '<0.0001']),
            ),
          ),
        },
      ],
      graph: [
        hbars([ORANGE], 'S. copri relative abundance (%)', 'Without E. coli', {
          name: 'Fig. 3g – Without E. coli',
          dataSets: ['without E. coli'],
          yRange: [0, 100],
          size: [100, 170],
          legend: false,
        }),
        hbars([ORANGE], 'S. copri relative abundance (%)', 'With E. coli Nissle WT', {
          name: 'Fig. 3g – With E. coli Nissle WT',
          dataSets: ['with E. coli'],
          yRange: [0, 100],
          size: [100, 170],
          legend: false,
        }),
      ],
    },
    {
      label: '3h',
      name: 'Fig. 3h – E. coli Nissle quadruple mutant',
      file: 'Fig3H.csv',
      sheet: 'Fig3H',
      legend:
        'S. copri relative abundance with E. coli Nissle ΔaraBAD ΔrhaBAD ΔgalTK ΔuxaCT (n = 3); *P < 0.0001 by one-way ANOVA with Holm–Šídák correction.',
      edit: {
        describe:
          'Data sets in reverse order (mGAM first and on top, as the figure; the sheet lists the sugar mix first).',
        apply: (t) => ({ ...t, dataSets: [...t.dataSets].reverse() }),
      },
      analyses: [
        {
          analysis: 'oneWayAnova',
          test: 'One-way ANOVA, Holm-Šídák vs mGAM',
          params: { comparisons: 'vsControl', controlMethod: 'holm-sidak' },
          dataSets: ['mGAM', '+Arabinan', '+[Arabinose+Rhamnose +Galactose+Galacturonic acid]'],
          brackets: 'stars',
          printed: [
            { a: 'mGAM', b: '+Arabinan', p: '<0.0001' },
            { a: 'mGAM', b: '+[Arabinose+Rhamnose +Galactose+Galacturonic acid]', p: '<0.0001' },
          ],
        },
      ],
      graph: hbars(
        [ORANGE, ORANGE, ORANGE],
        'S. copri relative abundance (%)',
        'With E. coli Nissle ΔaraBAD ΔgalTK ΔrhaBAD ΔuxaCT',
        {
          yRange: [0, 100],
          size: [110, 70],
          legend: false,
        },
      ),
    },
    // ---------------------------------------------------------------- Fig. 4
    ...(
      [
        [0, 'Without E. coli'],
        [1, 'With E. coli MR102'],
      ] as const
    ).map(([block, title]): Panel => {
      const groups: Groups = [
        ['mGAM Input', [0, 1, 2]],
        ['mGAM', [3, 4, 5]],
        ['+Arabinan', [6, 7, 8]],
        ['+Arabinoxylan', [9, 10, 11]],
        ['+Tragacanth', [12, 13, 14]],
        ['+Tamarind', [24, 25, 26]],
        ['+Xyloglucan', [15, 16, 17]],
        ['+Xylan', [18, 19, 20]],
        ['+Pectic galactan', [21, 22, 23]],
        ['+Amylose', [30, 31, 32]],
        ['+Amylopectin', [27, 28, 29]],
        ['+Starch', [33, 34, 35]],
      ]
      return {
        label: '4a',
        name: `Fig. 4a – ${title}`,
        file: 'Fig4A.csv',
        sheet: 'Fig4A',
        block,
        legend:
          'genus-level relative abundance of the community members in mGAM or with a supplemented polysaccharide; 3 biological replicates shown.',
        edit: composition(REDUCED, groups, '; the conditions in the figure’s order'),
        graph: barPlot(REDUCED, groups, title, { width: 640, legend: block === 0, spanSize: 6 }),
      }
    }),
    {
      label: '4b',
      name: 'Fig. 4b – Vitamins ± E. coli',
      file: 'Fig4B.csv',
      sheet: 'Fig4B',
      legend:
        'competitions between S. copri and the 6 Bacteroidaceae with or without E. coli in mGAM with the vitamins (n = 3); *P < 0.05 by two-way ANOVA with Dunnett’s correction.',
      edit: reversedRows('no vitamin is the first (control) row and on top, as the figure'),
      analyses: [
        {
          analysis: 'twoWayAnova',
          test: 'Two-way ANOVA, Dunnett vs no vitamin within each column',
          params: vsFirstRow('dunnett'),
          brackets: 'none',
          printed: [
            ...againstControl(
              'without E. coli',
              'no vitamin',
              Object.fromEntries(
                [
                  'Arabinan',
                  'Vitamin B3',
                  'Vitamin B5',
                  'Vitamin B6',
                  'Vitamin B7',
                  'Vitamin B12',
                ].map((r) => [r, '>0.9999']),
              ),
            ),
            ...againstControl('with E. coli', 'no vitamin', {
              Arabinan: '<0.0001',
              'Vitamin B3': '<0.0001',
              'Vitamin B5': '<0.0001',
              'Vitamin B6': '>0.9999',
              'Vitamin B7': '0.5834',
              'Vitamin B12': '0.3342',
            }),
          ],
        },
        {
          analysis: 'twoWayAnova',
          test: 'Two-way ANOVA, Dunnett vs no vitamin (the figure’s marks)',
          params: vsFirstRow('dunnett'),
          brackets: 'stars',
          printed: againstControl('with E. coli', 'no vitamin', {
            Arabinan: '<0.05',
            'Vitamin B3': '<0.05',
            'Vitamin B5': '<0.05',
          }),
        },
      ],
      graph: hbars([BLUE, ORANGE], 'S. copri relative abundance (%)', null, {
        yRange: [0, 100],
        size: [110, 190],
        legend: true,
      }),
    },
    ...(
      [
        [
          0,
          'Without E. coli',
          {
            'Segatella sinica HDE06 (clade G)': '0.013935',
            'Segatella sanihominis RHB01 (clade F)': '0.696518',
            'Segatella hominis HDD12 (clade E)': '0.244858',
            'Segatella brasiliensis HDD05 (clade D)': '0.001502',
            'Segatella sinensis HDE04 (clade C)': '0.358143',
            'Segatella brunsvicensis NI025 (clade B)': '0.149927',
            'Segatella copri HDC01 (clade A)': '0.056377',
            'Segatella copri DSM18205 (clade A)': '0.028969',
            'Segatella copri HDD04 (clade A)': '0.300935',
          },
          {
            'Segatella sinica HDE06 (clade G)': '0.063335',
            'Segatella hominis HDD12 (clade E)': '0.37096',
            'Segatella brasiliensis HDD05 (clade D)': '0.013656',
            'Segatella sinensis HDE04 (clade C)': '0.40694',
            'Segatella brunsvicensis NI025 (clade B)': '0.272567',
            'Segatella copri HDC01 (clade A)': '0.128117',
            'Segatella copri DSM18205 (clade A)': '0.087777',
            'Segatella copri HDD04 (clade A)': '0.390785',
          },
          { 'Segatella brasiliensis HDD05 (clade D)': '<0.05' },
        ],
        [
          1,
          'With E. coli MR102',
          {
            'Segatella sinica HDE06 (clade G)': '0.022521',
            'Segatella sanihominis RHB01 (clade F)': '0.120095',
            'Segatella hominis HDD12 (clade E)': '0.002312',
            'Segatella brasiliensis HDD05 (clade D)': '0.003292',
            'Segatella sinensis HDE04 (clade C)': '0.000365',
            'Segatella brunsvicensis NI025 (clade B)': '0.087994',
            'Segatella copri HDC01 (clade A)': '0.015705',
            'Segatella copri DSM18205 (clade A)': '0.002347',
            'Segatella copri HDD04 (clade A)': '0.013764',
          },
          {
            'Segatella sinica HDE06 (clade G)': '0.016247',
            'Segatella hominis HDD12 (clade E)': '0.00395',
            'Segatella brasiliensis HDD05 (clade D)': '0.004156',
            'Segatella sinensis HDE04 (clade C)': '0.0018',
            'Segatella brunsvicensis NI025 (clade B)': '0.055546',
            'Segatella copri HDC01 (clade A)': '0.013218',
            'Segatella copri DSM18205 (clade A)': '0.00395',
            'Segatella copri HDD04 (clade A)': '0.013218',
          },
          {
            'Segatella sinica HDE06 (clade G)': '<0.05',
            'Segatella brasiliensis HDD05 (clade D)': '<0.05',
            'Segatella sinensis HDE04 (clade C)': '<0.05',
            'Segatella copri HDC01 (clade A)': '<0.05',
            'Segatella copri DSM18205 (clade A)': '<0.05',
            'Segatella copri HDD04 (clade A)': '<0.05',
          },
        ],
      ] as const
    ).map(
      ([block, title, p, q, stars]): Panel => ({
        label: '4c',
        name: `Fig. 4c – ${title}`,
        file: 'Fig4C.csv',
        sheet: 'Fig4C',
        block: block === 0 ? 0 : 'With E. coli MR102',
        legend:
          'relative abundance of Segatella spp. in the competitions with Bacteroidaceae with or without E. coli MR102, with or without arabinan; *P < 0.05 from unpaired two-sided t tests with correction for multiple comparisons, n = 3. Rows with a zero (sanihominis; sinensis with E. coli) are tested without it, as in the source data (P = 0.696518; 0.120095 and 0.000365). With E. coli the figure marks sinensis (source data q = 0.0018) but not hominis (q = 0.0040).',
        edit: reversedRows('S. copri HDD04 is on top, as the figure'),
        analyses: perRow({
          test: 'Multiple t tests (lognormal)',
          params: { distribution: 'lognormal', variance: 'individual' },
          a: 'mGAM',
          b: 'Arabinan',
          why: LOG_WHY,
          p: { ...p },
          adjusted: { ...q },
          adjustedName: 'FDR (two-stage step-up)',
          correction: { approach: 'fdr', fdrMethod: 'bky' },
          stars: { ...stars },
        }),
        graph: hbars([TAN, GREEN], 'Segatella relative abundance (%)', title, {
          yRange: [0, 100],
          size: [100, 230],
          legend: block === 0,
        }),
      }),
    ),
    ...(
      [
        [
          0,
          'Commensal Enterobacteriaceae',
          {
            '+Klebsiella oxytoca': '<0.000001',
            '+E. coli K12': '0.028328',
            '+E. coli Nissle': '7e-6',
            '+E. coli LK192': '5.3e-5',
            '+E. coli MR158': '0.000118',
            '+E. coli MR102': '9.7e-5',
            'no Community': '0.770453',
          },
          {
            '+Klebsiella oxytoca': '<0.000001',
            '+E. coli K12': '0.009537',
            '+E. coli Nissle': '7e-6',
            '+E. coli LK192': '3.6e-5',
            '+E. coli MR158': '4.8e-5',
            '+E. coli MR102': '4.8e-5',
            'no Community': '0.222331',
          },
        ],
        [
          'Pathogenic Enterobacteriaceae',
          'Pathogenic Enterobacteriaceae',
          {
            '+Salmonella enterica': '0.033022',
            '+Klebsiella pneumoniae': '5.3e-5',
            '+E. coli UTI89': '0.008783',
            '+E. coli DSM105182 (bacteremia)': '0.000709',
            '+E. coli DSM9025 (diarrhea)': '0.025675',
            '+E. coli EPEC': '0.00075',
            'no Community': '0.770453',
          },
          {
            '+Salmonella enterica': '0.022235',
            '+Klebsiella pneumoniae': '0.000213',
            '+E. coli UTI89': '0.008871',
            '+E. coli DSM105182 (bacteremia)': '0.00101',
            '+E. coli DSM9025 (diarrhea)': '0.020745',
            '+E. coli EPEC': '0.00101',
            'no Community': '0.444661',
          },
        ],
      ] as const
    ).map(
      ([block, title, p, q]): Panel => ({
        label: '4d',
        name: `Fig. 4d – ${title}`,
        file: 'Fig4D.csv',
        sheet: 'Fig4D',
        block,
        legend:
          'S. copri relative abundance in the competitions with Bacteroidaceae, with different Enterobacteriaceae added, with or without arabinan; *P < 0.05 from unpaired two-sided t tests with correction for multiple comparisons, n = 3. Every row but No community is marked.',
        edit: reversedRows('No community is on top, as the figure'),
        analyses: perRow({
          test: 'Multiple t tests (lognormal)',
          params: { distribution: 'lognormal', variance: 'individual' },
          a: 'mGAM',
          b: 'Arabinan',
          why: LOG_WHY,
          p: { ...p },
          adjusted: { ...q },
          adjustedName: 'FDR (two-stage step-up)',
          correction: { approach: 'fdr', fdrMethod: 'bky' },
          stars: Object.fromEntries(
            Object.keys(p)
              .filter((r) => r !== 'no Community')
              .map((r) => [r, '<0.05']),
          ),
        }),
        graph: hbars([TAN, GREEN], 'S. copri relative abundance (%)', title, {
          yRange: [0, 100],
          size: [100, 200],
          legend: block !== 0,
        }),
      }),
    ),
    // ---------------------------------------------------------------- Fig. 5
    ...(
      [
        [
          '5a',
          'Fig5A.csv',
          'Human faecal communities',
          { 'no added E.coli': '0.007934', '+E.coli': '0.000198' },
          { 'no added E.coli': '0.015868', '+E.coli': '0.000396' },
          { mGAM: '0.32809', Arabinan: '0.068575' },
          { mGAM: '0.32809', Arabinan: '0.132448' },
          'Faecal communities (n = 8 donors) coalesced with S. copri HDD04 with or without E. coli MR102, with arabinan or mGAM alone; bars mean ± s.d.; *P < 0.05, NS, from unpaired two-sided t tests with correction for multiple comparisons.',
        ],
        [
          '5b',
          'Fig5B.csv',
          'Mouse caecal communities',
          { 'no added E. coli': '0.406709', '+E. coli': '0.011794' },
          { 'no added E. coli': '0.406709', '+E. coli': '0.023449' },
          { mGAM: '0.001404', Arabinan: '0.011191' },
          { mGAM: '0.002805', Arabinan: '0.011191' },
          'Caecal communities of SPF mice (n = 3) coalesced with S. copri HDD04 with or without E. coli MR102; bars mean ± s.d.; *P < 0.05, NS, from unpaired two-sided t tests with correction for multiple comparisons.',
        ],
      ] as const
    ).flatMap(([label, file, what, pS, adjS, pE, adjE, legend]): Panel[] => {
      const sheet = file.replace('.csv', '')
      const holm = { approach: 'significance', sigMethod: 'holm-sidak' }
      const marks = (p: Record<string, string>) =>
        Object.fromEntries(
          Object.entries(p).map(([r, v]) => [r, Number(v) < 0.05 ? '<0.05' : 'ns']),
        )
      return [
        {
          label,
          name: `Fig. ${label} – ${what}: S. copri`,
          file,
          sheet,
          block: 0,
          legend,
          analyses: perRow({
            test: 'Multiple t tests (Welch)',
            params: { variance: 'welch' },
            a: 'mGAM',
            b: 'Arabinan',
            p: { ...pS },
            adjusted: { ...adjS },
            adjustedName: 'Holm-Šídák',
            correction: holm,
            stars: marks(adjS),
            starsWhy: 'the figure marks both comparisons *.',
            ...(label === '5a'
              ? {
                  differs: {
                    adjusted: {
                      'no added E.coli':
                        'The source data’s adjusted P values here are Bonferroni’s (2 × P; Holm-Šídák gives 0.007934), where every other adjusted P of Fig. 5 is Holm-Šídák’s.',
                    },
                  },
                }
              : {}),
          }),
          graph: {
            preset: 'barsPoints',
            error: 'SD',
            format: looks('Segatella copri'),
            colors: [TAN, GREEN],
            yTitle: 'Relative abundance (%)',
            yRange: [0, 80],
            size: [80, 120],
            rotate: 45,
            legend: true,
          },
        },
        {
          label,
          name: `Fig. ${label} – ${what}: Enterobacteriaceae`,
          file,
          sheet,
          block: 1,
          legend,
          analyses: perRow({
            test: 'Multiple t tests (Welch)',
            params: { variance: 'welch' },
            a: 'no added E. coli',
            b: label === '5a' ? '+E.coli' : '+E. coli',
            p: { ...pE },
            adjusted: { ...adjE },
            adjustedName: 'Holm-Šídák',
            correction: holm,
            stars: marks(adjE),
          }),
          graph: {
            preset: 'barsPoints',
            error: 'SD',
            format: looks('Enterobacteriaceae'),
            colors: [NAVY, KHAKI],
            yTitle: 'Relative abundance (%)',
            yRange: [0, 80],
            size: [80, 120],
            rotate: 45,
            legend: true,
          },
        },
      ]
    }),
  ],
  figures: [
    {
      figure: '1',
      rows: [['1b', '1c', '1e', '1f'], ['1d']],
      notes:
        'Left out: a (phylogenetic tree, not a chart). b and e from the counts the figure prints (not in the source data); e’s “9/10” slice labels show the counts only; d without its category and S. copri/6 Bac. ratio rows and the family side bar.',
    },
    {
      figure: '2',
      rows: [
        ['2a', '2c'],
        ['2d', '2e'],
      ],
      notes:
        'Left out: b (gene schematic and a heat map of PUL14 expression without source data). The genus group headers (Input, mGAM, +Arabinan) are drawn under the bars, not as boxes above them.',
    },
    {
      figure: '3',
      rows: [['3a:1-3', '3b'], ['3a:4-6'], ['3c', '3d'], ['3g', '3h']],
      notes:
        'Left out: c’s transwell schematic, e (volcano plots of metatranscriptomes, no source data), f (pectin schematic).',
    },
    {
      figure: '4',
      rows: [['4a:1'], ['4a:2'], ['4b', '4c'], ['4d']],
      notes:
        'c’s “Growth on arabinan” +/− column and the clade groupings (Segatella copri / other Segatella species) are not drawn.',
    },
    {
      figure: '5',
      rows: [['5a', '5b']],
      notes: 'Left out: the cohort schematics (BioRender).',
    },
  ],
}

/** The embedded files and the figure's printed counts, by name. */
const FILES: Record<string, string> = { ...TAWK_FILES, ...PRINTED_FILES }

/** Reads the embedded files (the paper's folder is `tawk/`). */
export const tawkSourceFile = async (path: string): Promise<Uint8Array | null> => {
  const text = FILES[path.replace(/^tawk\//, '')]
  return text === undefined ? null : new TextEncoder().encode(text)
}

/** The example's project, from the embedded data. */
export async function createTawkExample(fonts: FontRegistry): Promise<Project> {
  return (await buildPaper(TAWK, { fonts, sourceFile: tawkSourceFile })).project
}
