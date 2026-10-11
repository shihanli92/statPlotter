import { withTrees } from '@ps/graph'
import { createTable, type DataTable, type Layer, type Project } from '@ps/model'
import {
  type AnalysisSpec,
  buildPaper,
  type GraphSpec,
  type Panel,
  type PaperSpec,
} from './examples/published/paper.ts'
import type { ExampleContext } from './examples/registry.ts'
import { JOHNSTON_DATA } from './johnstonData.ts'

/*
 * Figures of Johnston et al. 2026 (Nature Immunology, CC BY 4.0) rebuilt from the paper's source
 * data, which this example embeds (`johnstonData.ts`: the licence allows it, unlike the other
 * published-data examples, which read a local source_data folder). Everything else is the same
 * declarative `PaperSpec` the other papers use: which table each panel comes from, how it is
 * imported, the analyses giving the figure's statistics and the P values the figure prints, so
 * the example's notes put the paper's values next to the app's. The whole module (data and spec)
 * is loaded only when the example is opened.
 *
 * Citation: Johnston, T. S., Fabozzi, G., Gorman, J. et al., "Potent type-specific de novo
 * antibodies complement broadly reactive imprinted antibodies in immune responses to SARS-CoV-2
 * variants", Nature Immunology 27, 1874–1886 (2026), https://doi.org/10.1038/s41590-026-02613-4
 * (CC BY 4.0).
 */

// ---- The figures' colours ----------------------------------------------------------------------

/** Reactivity groups (Fig. 1): cross-reactive blue and purple, type-specific red, the rest pale. */
const W_ONLY = '#3a5ba0'
const CROSS = '#8f7fc0'
const TYPE_SPECIFIC = '#e8402a'
const NON = '#dbe8f5'
/** Donors (Fig. 2a). */
const DONOR_COLORS = ['#f2f2f2', '#9b4f96', '#3b8ed0', '#2fb28a', '#1a1a1a']
/** RBD binding classes 1, 1/3, 3, 4, 5 (Fig. 3). */
const CLASS_COLORS = ['#f2a03d', '#ece93c', '#4daf6a', '#e2578f', '#3b8ed0']
/** Isotypes IgG, IgA, IgM, other (Fig. 6d,e). */
const ISOTYPE_COLORS = ['#5b6fb5', '#7fb5e0', '#ef7d2b', '#f5d33c']
const GREY = '#9a9a9a'
const BLACK = '#222222'
const RED = '#e03127'

const SMALL: [number, number] = [90, 120]
const WIDE: [number, number] = [170, 120]

/**
 * Why several printed P values are larger than the app's: the paper's R `wilcox.test` falls back
 * to the normal approximation as soon as values are tied (or a pair's difference is zero), while
 * the app keeps computing the exact conditional P from the mid-rank permutation distribution
 * (`exactRankTests::wilcox.exact` gives the app's values to every digit).
 */
const APPROX_SIGNED_RANK =
  'the values are tied, so R’s wilcox.test — the paper’s tool — falls back to the normal approximation, which the printed value follows; the app computes the exact signed-rank P from the mid-rank permutation distribution (checked against exactRankTests::wilcox.exact), which is smaller. Multiple t tests offer no choice of the approximation (the single Wilcoxon test does).'
const APPROX_RANK_SUM =
  'the values are tied, so R’s wilcox.test — the paper’s tool — falls back to the normal approximation, which the printed value follows; the app computes the exact rank-sum P from the mid-rank permutation distribution (checked against exactRankTests::wilcox.exact). Multiple t tests offer no choice of the approximation (the single Mann-Whitney test does).'

type Format = NonNullable<GraphSpec['format']>

const formats = (...list: Format[]): Format => ({
  does: list.map((f) => f.does).join(' '),
  apply: (graph, table) => list.reduce((g, f) => f.apply(g, table), graph),
})

/** The chart's title as the figure prints it above the plot. */
const titled = (text: string): Format => ({
  does: `Title “${text}”, as the figure prints it.`,
  apply: (g) => ({ ...g, title: { ...g.title, content: [{ text }] } }),
})

/** Layers dropped by id (the preset draws more than the figure does). */
const without = (does: string, ...ids: string[]): Format => ({
  does,
  apply: (g) => ({ ...g, layers: g.layers.filter((l) => !ids.includes(l.id)) }),
})

/** Only a crossbar at the centre over the points, as the figures draw them. */
const crossbarOnly = (center: 'median' | 'geomean' | 'mean', color = BLACK): Format => {
  const bar = (l?: Layer): Layer =>
    ({
      id: 'center',
      geom: 'center',
      ...l,
      stat: { kind: 'summary' as const, center },
      style: {
        ...l?.style,
        line: { color: { rgb: color }, width: 1.6, dash: 'solid' },
        width: 0.7,
      },
    }) as unknown as Layer
  return {
    does: `A ${center === 'geomean' ? 'geometric mean' : center} crossbar over the points, no error bars (the figure draws no spread).`,
    apply: (g) => {
      const layers = g.layers.filter((l) => l.geom !== 'errorbar')
      const at = layers.findIndex((l) => l.geom === 'center')
      return {
        ...g,
        layers: at < 0 ? [...layers, bar()] : layers.map((l, i) => (i === at ? bar(l) : l)),
      }
    },
  }
}

/** Before–after lines joining each donor's values across the data sets of every row. */
const pairLines: Format = {
  does: 'Each donor’s values joined across the time points (Add ▾ › Before–after lines).',
  apply: (g) => ({
    ...g,
    layers: [
      {
        id: 'pairs',
        geom: 'connector',
        stat: { kind: 'identity' },
        style: { line: { color: { rgb: '#b4b4b4' }, width: 0.6, dash: 'solid' } },
      } as Layer,
      ...g.layers.map((l) =>
        l.geom === 'points' ? ({ ...l, style: { ...l.style, spread: 'none' } } as Layer) : l,
      ),
    ],
  }),
}

/** Stacked count bars: solid segments outlined in black, no error bars (one count per cell). */
const stackedCounts: Format = {
  does: 'Bar segments in solid colour outlined in black and no error bars (each cell holds one count).',
  apply: (g) => ({
    ...g,
    layers: g.layers
      .filter((l) => l.geom !== 'errorbar')
      .map((l) =>
        l.geom === 'bar'
          ? ({
              ...l,
              style: {
                ...l.style,
                fill: { type: 'solid', color: { series: true }, opacity: 1 },
                border: { color: { rgb: BLACK }, width: 0.5, dash: 'solid' },
              },
            } as Layer)
          : l,
      ),
  }),
}

/** Solid bars outlined in black (the figure's white and gray bars need an outline to show). */
const outlinedBars: Format = {
  does: 'Bars in solid colour outlined in black, as the figure.',
  apply: (g) => ({
    ...g,
    layers: g.layers.map((l) =>
      l.geom === 'bar'
        ? ({
            ...l,
            style: {
              ...l.style,
              fill: { type: 'solid', color: { series: true }, opacity: 1 },
              border: { color: { rgb: BLACK }, width: 0.5, dash: 'solid' },
            },
          } as Layer)
        : l,
    ),
  }),
}

/** Filled symbols (the figures draw solid dots; the presets draw them hollow). */
const filledPoints: Format = {
  does: 'Filled symbols, as the figure.',
  apply: (g) => ({
    ...g,
    layers: g.layers.map((l) =>
      l.geom === 'points'
        ? ({
            ...l,
            style: { ...l.style, fill: { type: 'solid', color: { series: true }, opacity: 1 } },
          } as Layer)
        : l,
    ),
  }),
}

/** The epitope binning map: Ward clustering both ways, the binary outcomes in two blues. */
const binningMap: Format = {
  does: 'Rows and columns ordered by hierarchical clustering (Ward’s method, as the legend says) with dendrograms, and a two-colour scale from 0 (non-competing) to 1 (competing).',
  apply: (g) => ({
    ...g,
    // Roadmap 49c: the trees of the clustered rows and columns, layers of their own.
    layers: withTrees(
      g.layers.map((l) =>
        l.geom === 'tile'
          ? ({
              ...l,
              style: {
                ...l.style,
                cluster: { rows: true, columns: true, distance: 'euclidean', linkage: 'ward' },
              },
            } as Layer)
          : l,
      ),
    ),
    scales: {
      ...g.scales,
      color: { colors: 'blues', min: 0, max: 1, bar: { title: 'Competing' } },
    },
  }),
}

// ---- Tables made from a panel's for the test the figure prints ----------------------------------

/** A data set's values by title (a column table), or its replicates at a row (grouped). */
function cells(table: DataTable, title: string, row = 0): (number | null)[] {
  const ds = table.dataSets.find((d) => d.title === title)
  if (!ds) throw new Error(`no data set “${title}” in ${table.name}`)
  return table.tableKind === 'grouped'
    ? ds.subcolumns.map((c) => c.values[row] ?? null)
    : (ds.subcolumns[0]?.values ?? [])
}

const rowIndex = (table: DataTable, title: string): number => {
  const r = (table.rowTitles ?? []).indexOf(title)
  if (r < 0) throw new Error(`no row “${title}” in ${table.name}`)
  return r
}

/** A grouped table of two data sets: one test per row (the app's Multiple t tests). */
function pairsTable(
  titles: [string, string],
  rows: { title: string; a: (number | null)[]; b: (number | null)[] }[],
): DataTable {
  const reps = Math.max(...rows.flatMap((r) => [r.a.length, r.b.length]))
  const t = createTable({
    tableKind: 'grouped',
    yFormat: { type: 'replicates', count: reps },
    columns: 2,
    rows: rows.length,
  })
  t.rowTitles = rows.map((r) => r.title)
  rows.forEach((row, r) => {
    ;[row.a, row.b].forEach((values, c) => {
      t.dataSets[c]!.subcolumns.forEach((sub, k) => {
        sub.values[r] = values[k] ?? null
      })
    })
  })
  t.dataSets.forEach((d, c) => {
    d.title = titles[c]!
  })
  return t
}

/** Each later time point against day 0, in each row of the panel's table (Fig. 5b,c). */
const vsBaseline = (table: DataTable) =>
  pairsTable(
    ['Day 0', 'After boost'],
    (table.rowTitles ?? []).flatMap((title) =>
      ['Day 15', 'Day 45'].map((day) => {
        const rowTitle = title ?? ''
        return {
          title: `${rowTitle}, ${day.toLowerCase()}`,
          a: cells(table, 'Day 0', rowIndex(table, rowTitle)),
          b: cells(table, day, rowIndex(table, rowTitle)),
        }
      }),
    ),
  )

/** Each absorption against mock absorption, for the same donors (Fig. 5d–g). */
const vsMock = (table: DataTable) =>
  pairsTable(
    ['Mock', 'Absorbed'],
    ['Ancestral', 'KP.3'].map((absorbed) => ({
      title: `${absorbed} absorption`,
      a: cells(table, 'Mock'),
      b: cells(table, absorbed),
    })),
  )

/** Each variant against the ancestral strain, for the same donors (Fig. 5j). */
const vsAncestral = (table: DataTable) =>
  pairsTable(
    ['Ancestral', 'Variant'],
    ['BA.5', 'XBB.1.5', 'KP.3'].map((virus) => ({
      title: virus,
      a: cells(table, 'Ancestral'),
      b: cells(table, virus),
    })),
  )

// ---- Panel shorthands ---------------------------------------------------------------------------

const file = (name: string) => ({ file: name, sheet: name.replace(/\.csv$/, '') })

/** Values down a column of the CSV, as the import dialog's long-format settings read them. */
const long = (value: string, group: string, more: Partial<Panel['long']> = {}) => ({
  long: { value, group, ...more } as NonNullable<Panel['long']>,
})

/** Donors' values before and after an exposure, joined (the figures' paired line charts). */
const paired = (yTitle: string, more: Partial<GraphSpec> = {}): GraphSpec => ({
  preset: 'beforeAfter',
  yTitle,
  size: SMALL,
  legend: false,
  colors: [BLACK, BLACK, BLACK, BLACK],
  ...more,
  format: formats(crossbarOnly('median', RED), filledPoints, ...(more.format ? [more.format] : [])),
})

/** Every value with a crossbar at the centre, as the paper's dot plots. */
const dots = (yTitle: string, more: Partial<GraphSpec> = {}): GraphSpec => ({
  preset: 'pointsMedian',
  yTitle,
  size: SMALL,
  legend: false,
  ...more,
  format: formats(crossbarOnly('median', RED), filledPoints, ...(more.format ? [more.format] : [])),
})

/** Counts stacked in one bar per sample. */
const stacked = (yTitle: string, colors: string[], more: Partial<GraphSpec> = {}): GraphSpec => ({
  preset: 'stacked',
  yTitle,
  colors,
  rotate: 45,
  size: WIDE,
  ...more,
  format: formats(stackedCounts, ...(more.format ? [more.format] : [])),
})

/** A Mann-Whitney test of two data sets with the P value the figure prints. */
const rankSum = (
  a: string,
  b: string,
  p: string,
  why?: string,
  differs?: string,
): AnalysisSpec => ({
  analysis: 'mannWhitney',
  test: 'Mann-Whitney test',
  dataSets: [a, b],
  ...(why ? { why } : {}),
  brackets: 'stars',
  printed: [{ a, b, p, ...(differs ? { differs } : {}) }],
})

// ---- The paper ----------------------------------------------------------------------------------

const PANELS: Panel[] = [
  // ---- Figure 1 ---------------------------------------------------------------------------------
  {
    label: '1b',
    name: 'Fig. 1b – WA1⁺XBB.1.5⁺ B cells',
    ...file('fig1b.csv'),
    ...long('Percentage of memory B cells', 'Timepoint', { subject: 'Donor' }),
    legend:
      'frequencies of WA1⁺XBB.1.5⁺ memory B cells before and after XBB exposure (n = 4 individuals pre-XBB and n = 5 post-XBB); light gray lines connect donors; crossbars represent medians. No P value is printed.',
    graph: paired('Percentage of memory B cells', {
      logY: true,
      yRange: [0.001, 1],
      format: titled('WA1+XBB.1.5+ B cells'),
    }),
  },
  {
    label: '1c',
    name: 'Fig. 1c – WA1⁻XBB.1.5⁺ B cells',
    ...file('fig1c.csv'),
    ...long('Percentage of memory B cells', 'Timepoint', { subject: 'Donor' }),
    legend:
      'frequencies of WA1⁻XBB.1.5⁺ memory B cells before and after XBB exposure (n = 4 pre-XBB, n = 5 post-XBB); crossbars represent medians. No P value is printed.',
    graph: paired('Percentage of memory B cells', {
      logY: true,
      yRange: [0.001, 1],
      format: titled('WA1–XBB.1.5+ B cells'),
    }),
  },
  {
    label: '1e',
    name: 'Fig. 1e – Variants bound by mAb supernatants',
    ...file('fig1e.csv'),
    ...long('mAbs', 'Group', { row: 'Sample' }),
    legend:
      'variants bound by the mAb supernatants of each donor before and after XBB exposure; the total numbers of mAbs isolated at each time point are reported below. No P value is printed.',
    graph: stacked('No. mAbs', [TYPE_SPECIFIC, CROSS, W_ONLY], {
      format: titled('mAb binding'),
    }),
  },
  {
    label: '1f',
    name: 'Fig. 1f – Variants neutralized by mAb supernatants',
    ...file('fig1f.csv'),
    ...long('mAbs', 'Group', { row: 'Sample' }),
    legend:
      'variants neutralized by the mAb supernatants of each donor before and after XBB exposure; Non, nonneutralizing. No P value is printed.',
    graph: stacked('No. mAbs', [NON, TYPE_SPECIFIC, CROSS, W_ONLY], {
      format: titled('mAb neutralization'),
    }),
  },
  {
    label: '1g',
    name: 'Fig. 1g – Neutralization by binding status',
    ...file('fig1g.csv'),
    ...long('mAbs', 'Neutralization', { row: 'Sample' }),
    legend:
      'variant neutralization by binding status before and after XBB exposure. No P value is printed.',
    graph: [
      stacked('No. mAbs', [TYPE_SPECIFIC, CROSS, W_ONLY], {
        name: 'Fig. 1g – Pre-XBB',
        rows: ['Pre W+O-', 'Pre W+O+', 'Pre W-O+'],
        size: SMALL,
        format: titled('Pre'),
      }),
      stacked('No. mAbs', [TYPE_SPECIFIC, CROSS, W_ONLY], {
        name: 'Fig. 1g – Post-XBB',
        rows: ['Post W+O-', 'Post W+O+', 'Post W-O+'],
        size: SMALL,
        format: titled('Post'),
      }),
    ],
  },
  // The four RBDs are four panels: a grouped table would need 344 replicates in a cell, more than
  // the 256 a table holds, so each RBD's two groups are a column table of their own (RJO-3).
  ...(
    [
      [
        'WA1',
        '8.24e-39',
        'the rank-sum test of the deposited values gives 2.06 × 10⁻³⁹ (R’s wilcox.test agrees), 8.23 × 10⁻³⁹ after the Benjamini-Hochberg correction over the four RBDs: the printed value differs in its third digit.',
      ],
      [
        'BA.5',
        '1.49e-3',
        'the printed value is the Benjamini-Hochberg-corrected one (1.4993 × 10⁻³ over the four RBDs); the test itself gives 1.1245 × 10⁻³.',
      ],
      ['XBB.1.5', '1.01e-2', ''],
      [
        'KP.3',
        '7.62e-6',
        'the printed value is the Benjamini-Hochberg-corrected one (7.6218 × 10⁻⁶ over the four RBDs); the test itself gives 3.8109 × 10⁻⁶.',
      ],
    ] as [string, string, string][]
  ).map(
    ([rbd, p, differs]): Panel => ({
      label: '1h',
      name: `Fig. 1h – ${rbd} RBD binding`,
      ...file('fig1h.csv'),
      ...long('log10 ECL/IgG', 'Neutralization', { filters: [{ column: 'RBD', value: rbd }] }),
      legend:
        'IgG normalized binding values to variant RBDs for W⁺O⁻/W⁺O⁺ (n = 344) and W⁻O⁺ (n = 160) nAbs (WA1 P = 8.24 × 10⁻³⁹; BA.5 P = 1.49 × 10⁻³; XBB.1.5 P = 1.01 × 10⁻²; KP.3 P = 7.62 × 10⁻⁶); crossbars represent the median; Wilcoxon rank-sum test with a Benjamini-Hochberg correction for multiple testing, two sided.',
      analyses: [
        rankSum(
          'W+O+/-',
          'W-O+',
          p,
          'the four RBDs are one Benjamini-Hochberg family in the paper; the app corrects a family of tests within one analysis (Multiple t tests over the rows of a grouped table), which this panel can’t be (344 values in a cell), so each RBD is tested on its own.',
          differs || undefined,
        ),
      ],
      graph: dots('log_{10} (ECL/IgG (\\micro g ml^{-1}))', {
        colors: [BLACK, BLACK],
        format: titled(rbd),
      }),
    }),
  ),

  // ---- Figure 2 ---------------------------------------------------------------------------------
  {
    label: '2a',
    name: 'Fig. 2a – IGHV gene usage, W⁺O⁺ lineages',
    ...file('fig2a.csv'),
    ...long('Lineages', 'Donor', {
      row: 'IGHV gene',
      filters: [{ column: 'Group', value: 'W+O+' }],
    }),
    legend:
      'number of mAb lineages expressing each IGHV gene in W⁺O⁺ nAbs, coloured by donor. No P value is printed.',
    graph: stacked('Distinct lineages', DONOR_COLORS, {
      size: [300, 90],
      rotate: 90,
      yRange: [0, 40],
      format: titled('IGHV gene usage of neutralizing mAbs (W+O+)'),
    }),
  },
  {
    label: '2a',
    name: 'Fig. 2a – IGHV gene usage, W⁻O⁺ lineages',
    ...file('fig2a.csv'),
    ...long('Lineages', 'Donor', {
      row: 'IGHV gene',
      filters: [{ column: 'Group', value: 'W-O+' }],
    }),
    legend: 'number of mAb lineages expressing each IGHV gene in W⁻O⁺ nAbs, coloured by donor.',
    graph: stacked('Distinct lineages', DONOR_COLORS, {
      size: [300, 90],
      rotate: 90,
      yRange: [0, 40],
      format: titled('IGHV gene usage of neutralizing mAbs (W–O+)'),
    }),
  },
  {
    label: '2b',
    name: 'Fig. 2b – IGHV somatic hypermutation',
    ...file('fig2b.csv'),
    ...long('Percent SHM', 'Group'),
    legend:
      'mean IGHV gene SHM percentage compared to germline sequence in W⁺O⁺ (n = 150) and W⁻O⁺ (n = 51) nAb lineages (P = 5.6 × 10⁻⁷); Wilcoxon rank-sum test, two sided.',
    analyses: [
      rankSum(
        'W+O+',
        'W-O+',
        '5.6e-7',
        'the two groups are large (201 lineages), so the test uses the normal approximation with the tie correction, as R’s wilcox.test does. The example’s copy of the sheet is rounded to nine significant digits, which ties a few lineages whose SHM differs beyond the ninth digit; on the sheet’s full-precision values the test gives 5.48 × 10⁻⁷ instead of the printed 5.6 × 10⁻⁷ (R agrees either way), so the printed value seems to come from rounded percentages.',
      ),
    ],
    graph: dots('Percent SHM', { yRange: [0, 20], colors: [BLACK, BLACK], format: titled('IGHV') }),
  },
  {
    label: '2c',
    name: 'Fig. 2c – CDRH3 length',
    ...file('fig2c.csv'),
    ...long('Amino acids', 'Group'),
    legend:
      'CDRH3 amino acid lengths of W⁺O⁺ (n = 150) and W⁻O⁺ (n = 51) nAb lineages. No P value is printed.',
    graph: dots('Amino acids', {
      yRange: [0, 40],
      colors: [BLACK, BLACK],
      format: titled('CDRH3 length'),
    }),
  },
  {
    label: '2f',
    name: 'Fig. 2f – Pseudovirus IC50 of W⁺O⁺ and W⁻O⁺ nAbs',
    ...file('fig2f.csv'),
    ...long('IC50 (µg/ml)', 'Group', { row: 'Pseudovirus' }),
    legend:
      'XBB.1.5 and KP.3 pseudovirus IC50 values of W⁺O⁺ (XBB.1.5 n = 31; KP.3 n = 42) and W⁻O⁺ (XBB.1.5 n = 42; KP.3 n = 28) nAbs (XBB.1.5 P = 0.0024; KP.3 P = 0.005); Wilcoxon rank-sum test, two sided. Antibodies that did not neutralize (ND) are left out.',
    analyses: [
      {
        analysis: 'multipleT',
        test: 'Mann-Whitney test per pseudovirus',
        params: { distribution: 'nonparametric', rankTest: 'mannWhitney', approach: 'none' },
        why: 'the figure prints the two tests uncorrected (the legend names no correction for this panel).',
        brackets: 'stars',
        printed: [
          { a: 'W+O+', b: 'W-O+', row: 'XBB.1.5', p: '0.0024' },
          { a: 'W+O+', b: 'W-O+', row: 'KP.3', p: '0.005' },
        ],
      },
    ],
    graph: dots('IC_{50} (\\micro g ml^{-1})', {
      logY: true,
      size: [120, 120],
      colors: [BLACK, BLACK],
      legend: true,
      format: titled('XBB.1.5 and KP.3 neutralization'),
    }),
  },

  // ---- Figure 3 ---------------------------------------------------------------------------------
  {
    label: '3b',
    name: 'Fig. 3b – Epitope binning map',
    ...file('fig3b.csv'),
    import: { tableKind: 'grouped', firstColumn: 'rowTitles' },
    legend:
      'map of epitope binning assay results: rows are surface reference mAbs and columns flowover competitor mAbs (n = 51); 1 = competing, 0 = non-competing; Ward’s hierarchical method was used for mAb clustering. No P value is printed.',
    graph: {
      preset: 'heatmap',
      size: [420, 95],
      format: formats(binningMap, titled('Epitope binning')),
    },
  },
  {
    label: '3c',
    name: 'Fig. 3c – Antibody classes',
    ...file('fig3c.csv'),
    ...long('mAbs', 'Class', { row: 'Group' }),
    legend: 'summary of antibody binding classes of W⁺O⁺ and W⁻O⁺ mAbs. No P value is printed.',
    graph: {
      preset: 'stackedPercent',
      yTitle: 'Proportion',
      colors: CLASS_COLORS,
      size: SMALL,
      format: titled('Antibody classes'),
    },
  },
  {
    label: '3d',
    name: 'Fig. 3d – Antibody classes by donor',
    ...file('fig3d.csv'),
    ...long('mAbs', 'Class', { row: 'Sample' }),
    legend:
      'antibody classes separated by donor and accounting for lineage sizes; within each column, each segment represents one lineage. No P value is printed.',
    graph: stacked('No. mAbs', CLASS_COLORS, {
      format: titled('Antibody classes by donor (lineage size)'),
    }),
  },
  {
    label: '3e',
    name: 'Fig. 3e – IGHV gene usage by class',
    ...file('fig3e.csv'),
    ...long('mAbs', 'Class', { row: 'Gene', filters: [{ column: 'Chain', value: 'IGHV' }] }),
    legend: 'IGHV gene usage of mAbs of different binding classes. No P value is printed.',
    graph: stacked('No. mAbs', CLASS_COLORS, {
      size: [250, 80],
      rotate: 90,
      format: titled('IGHV gene usage by class'),
    }),
  },
  {
    label: '3e',
    name: 'Fig. 3e – IGLV gene usage by class',
    ...file('fig3e.csv'),
    ...long('mAbs', 'Class', { row: 'Gene', filters: [{ column: 'Chain', value: 'IGLV' }] }),
    legend: 'IGLV gene usage of mAbs of different binding classes.',
    graph: stacked('No. mAbs', CLASS_COLORS, {
      size: [250, 80],
      rotate: 90,
      format: titled('IGLV gene usage by class'),
    }),
  },
  {
    label: '3f',
    name: 'Fig. 3f – XBB.1.5 IC50 by binding class',
    ...file('fig3f.csv'),
    ...long('IC50 (µg/ml)', 'Class', { filters: [{ column: 'Pseudovirus', value: 'XBB.1.5' }] }),
    legend:
      'XBB.1.5 pseudovirus IC50 values of different binding classes of nAbs (P = 0.0033); Wilcoxon rank-sum test with a Benjamini-Hochberg correction for multiple testing, two sided; the fraction of nAbs in each class that neutralize is printed below the plot.',
    analyses: [
      {
        analysis: 'oneWayAnova',
        test: 'Kruskal-Wallis test, Dunn’s comparisons',
        params: { gaussian: false },
        why: 'the app’s nonparametric comparisons of several groups are Dunn’s (corrected by Bonferroni); the figure’s values are Mann-Whitney tests of each pair of classes with a Benjamini-Hochberg correction over all ten pairs, which the app can’t do in one analysis.',
        brackets: 'stars',
        printed: [
          {
            a: 'Class 1/3',
            b: 'Class 4',
            p: '0.0033',
            differs:
              'Dunn’s test gives another value; R’s pairwise.wilcox.test with the Benjamini-Hochberg correction over the ten pairs reproduces the printed 0.0033 exactly (and 0.0024 for class 1/3 against class 5, the figure’s second bracket).',
          },
        ],
      },
    ],
    graph: dots('IC_{50} (\\micro g ml^{-1})', {
      logY: true,
      size: [120, 120],
      colors: CLASS_COLORS,
      format: titled('XBB.1.5'),
    }),
  },
  {
    label: '3f',
    name: 'Fig. 3f – KP.3 IC50 by binding class',
    ...file('fig3f.csv'),
    ...long('IC50 (µg/ml)', 'Class', { filters: [{ column: 'Pseudovirus', value: 'KP.3' }] }),
    legend:
      'KP.3 pseudovirus IC50 values of different binding classes of nAbs (P = 0.0024); Wilcoxon rank-sum test with a Benjamini-Hochberg correction, two sided.',
    analyses: [
      {
        analysis: 'oneWayAnova',
        test: 'Kruskal-Wallis test, Dunn’s comparisons',
        params: { gaussian: false },
        brackets: 'stars',
        printed: [
          {
            a: 'Class 1/3',
            b: 'Class 4',
            p: '0.0024',
            differs:
              'no test of the KP.3 values gives 0.0024: pairwise Mann-Whitney tests with a Benjamini-Hochberg correction over the ten pairs give 0.0105 (class 1/3 against 4) and 0.0017 (1/3 against 5). 0.0024 is the XBB.1.5 panel’s 1/3-against-5 value, so the legend appears to print XBB.1.5’s second P value as KP.3’s.',
          },
        ],
      },
    ],
    graph: dots('IC_{50} (\\micro g ml^{-1})', {
      logY: true,
      size: [120, 120],
      colors: CLASS_COLORS,
      format: titled('KP.3'),
    }),
  },

  // ---- Figure 5 ---------------------------------------------------------------------------------
  {
    label: '5b',
    name: 'Fig. 5b – RBD binding by variant',
    ...file('fig5b.csv'),
    ...long('IgG endpoint titer', 'Day', { row: 'Antigen', subject: 'Donor' }),
    legend:
      'reciprocal end point titers of antigen-specific IgG to ancestral (day 15 P = 0.004; day 45 P = 0.025) and KP.3 RBDs (day 15 P = 0.0012; day 45 P = 0.004) measured by ELISA (n = 14 samples); red bars indicate the geometric mean; Wilcoxon rank-sum test with a Benjamini-Hochberg correction, comparisons to the first time point, two sided.',
    analyses: [
      {
        analysis: 'multipleT',
        test: 'Mann-Whitney test per time point, Benjamini-Hochberg',
        params: { distribution: 'nonparametric', rankTest: 'mannWhitney', fdrMethod: 'bh', q: 5 },
        on: {
          name: 'Fig. 5b – Each time point against day 0',
          describe:
            'one row per antigen and later time point, with day 0 beside it (the four comparisons the figure marks form one Benjamini-Hochberg family).',
          apply: vsBaseline,
        },
        printed: [
          { a: 'Day 0', b: 'After boost', row: 'Ancestral, day 15', p: '0.004' },
          { a: 'Day 0', b: 'After boost', row: 'Ancestral, day 45', p: '0.025' },
          { a: 'Day 0', b: 'After boost', row: 'KP.3, day 15', p: '0.0012' },
          {
            a: 'Day 0',
            b: 'After boost',
            row: 'KP.3, day 45',
            p: '0.004',
            differs:
              'the corrected value of the deposited titers is 0.0033 (R agrees); the other three printed values of this panel are reproduced exactly.',
          },
        ],
      },
    ],
    graph: {
      preset: 'pointsMedian',
      yTitle: 'IgG endpoint titer',
      logY: true,
      size: [150, 120],
      colors: [BLACK, BLACK, BLACK],
      legend: true,
      format: formats(crossbarOnly('geomean', RED), pairLines, titled('RBD binding by variant')),
    },
  },
  {
    label: '5c',
    name: 'Fig. 5c – Neutralization by variant',
    ...file('fig5c.csv'),
    ...long('FRNT50', 'Day', { row: 'Virus', subject: 'Donor' }),
    legend:
      'focus reduction neutralizing titers of ancestral and KP.3 (day 15 P = 0.0018; day 45 P = 0.003) pseudoviruses (n = 14 samples); red bars indicate the geometric mean; Wilcoxon rank-sum test with a Benjamini-Hochberg correction, comparisons to the first time point, two sided.',
    analyses: [
      {
        analysis: 'multipleT',
        test: 'Mann-Whitney test per time point, Benjamini-Hochberg',
        params: { distribution: 'nonparametric', rankTest: 'mannWhitney', fdrMethod: 'bh', q: 5 },
        on: {
          name: 'Fig. 5c – Each time point against day 0',
          describe:
            'one row per pseudovirus and later time point, with day 0 beside it (the four comparisons form one Benjamini-Hochberg family).',
          apply: vsBaseline,
        },
        printed: [
          {
            a: 'Day 0',
            b: 'After boost',
            row: 'KP.3, day 15',
            p: '0.0018',
            differs: `${APPROX_RANK_SUM} With the approximation and the same correction the value is 0.0012; the printed 0.0018 is reproduced by no family tried.`,
          },
          {
            a: 'Day 0',
            b: 'After boost',
            row: 'KP.3, day 45',
            p: '0.003',
            differs: `${APPROX_RANK_SUM} With the approximation and the same correction the value is 0.0027, which rounds to the printed 0.003.`,
          },
        ],
      },
    ],
    graph: {
      preset: 'pointsMedian',
      yTitle: 'FRNT_{50}',
      logY: 'log2',
      size: [150, 120],
      colors: [BLACK, BLACK, BLACK],
      legend: true,
      format: formats(crossbarOnly('geomean', RED), pairLines, titled('Neutralization by variant')),
    },
  },
  ...(
    [
      [
        '5d',
        'Ancestral RBD binding',
        'fig5d.csv',
        'IgG endpoint titer',
        ['2.44e-4', '2.44e-4'],
        ['', ''],
      ],
      [
        '5e',
        'Ancestral neutralization',
        'fig5e.csv',
        'FRNT50',
        ['0.002', '0.002'],
        [APPROX_SIGNED_RANK, APPROX_SIGNED_RANK],
      ],
      [
        '5f',
        'KP.3 RBD binding',
        'fig5f.csv',
        'IgG endpoint titer',
        ['2.44e-4', '2.44e-4'],
        ['', ''],
      ],
      [
        '5g',
        'KP.3 neutralization',
        'fig5g.csv',
        'FRNT50',
        ['0.0045', '0.002'],
        [
          `${APPROX_SIGNED_RANK} Even so, the printed 0.0045 is reproduced by nothing tried: the approximation gives 0.00255, 0.0051 over the two comparisons.`,
          APPROX_SIGNED_RANK,
        ],
      ],
    ] as [string, string, string, string, [string, string], [string, string]][]
  ).map(
    ([label, title, csv, value, printed, differs]): Panel => ({
      label,
      name: `Fig. ${label} – ${title}`,
      ...file(csv),
      ...long(value, 'Absorbed', { subject: 'Donor' }),
      legend: `${title.toLowerCase()} of absorbed sera from day 15 to day 45 post-KP.2 boost (ancestral P = ${printed[0]}; KP.3 P = ${printed[1]}; n = 14 samples); black bars indicate the geometric mean; Wilcoxon signed-rank test with a Benjamini-Hochberg correction, comparisons to mock absorption, two sided.`,
      analyses: [
        {
          analysis: 'multipleT',
          test: 'Wilcoxon signed-rank test per absorption, Bonferroni',
          params: {
            design: 'paired',
            distribution: 'nonparametric',
            approach: 'significance',
            sigMethod: 'bonferroni',
          },
          on: {
            name: `Fig. ${label} – Each absorption against mock`,
            describe:
              'one row per absorption, with each donor’s mock-absorbed value beside it (the two comparisons the figure marks).',
            apply: vsMock,
          },
          why: 'the printed values are the signed-rank P values multiplied by the two comparisons; the Benjamini-Hochberg correction the legend names leaves them unchanged here (the two P values are equal or nearly so).',
          printed: [
            {
              a: 'Mock',
              b: 'Absorbed',
              row: 'Ancestral absorption',
              p: printed[0],
              ...(differs[0] ? { differs: differs[0] } : {}),
            },
            {
              a: 'Mock',
              b: 'Absorbed',
              row: 'KP.3 absorption',
              p: printed[1],
              ...(differs[1] ? { differs: differs[1] } : {}),
            },
          ],
        },
      ],
      graph: paired(value === 'FRNT50' ? 'FRNT_{50}' : 'IgG endpoint titer', {
        // FRNT50 on a log2 axis, titers on log10, as the figure.
        logY: value === 'FRNT50' ? 'log2' : true,
        xTitle: 'Absorbed',
        format: formats(crossbarOnly('geomean'), titled(title)),
      }),
    }),
  ),
  {
    label: '5i',
    name: 'Fig. 5i – Neutralization by mock-absorbed sera',
    ...file('fig5i.csv'),
    ...long('FRNT50', 'Pseudovirus', { subject: 'Donor' }),
    legend:
      'pseudovirus neutralization by mock-absorbed sera from individuals with type-specific serum responses (n = 5 samples); black bars indicate the geometric mean. No P value is printed.',
    graph: paired('FRNT_{50}', {
      logY: 'log2',
      xTitle: 'Variant pseudovirus',
      format: formats(crossbarOnly('geomean'), titled('Neutralization by variant')),
    }),
  },
  {
    label: '5j',
    name: 'Fig. 5j – Type-specific neutralization by virus',
    ...file('fig5j.csv'),
    ...long('FRNT50', 'Pseudovirus', { subject: 'Donor' }),
    legend:
      'pseudovirus neutralization by ancestral-absorbed sera from individuals with type-specific serum responses (BA.5 P = 0.035; XBB.1.5 P = 0.035; KP.3 P = 0.035); Wilcoxon signed-rank test with a Benjamini-Hochberg correction, comparisons to the ancestral strain, two sided.',
    analyses: [
      {
        analysis: 'multipleT',
        test: 'Wilcoxon signed-rank test per variant, Benjamini-Hochberg',
        params: {
          design: 'paired',
          distribution: 'nonparametric',
          fdrMethod: 'bh',
          q: 5,
        },
        on: {
          name: 'Fig. 5j – Each variant against the ancestral strain',
          describe:
            'one row per variant, with each donor’s ancestral titer beside it (the three comparisons the figure marks form one Benjamini-Hochberg family).',
          apply: vsAncestral,
        },
        printed: ['BA.5', 'XBB.1.5', 'KP.3'].map((row) => ({
          a: 'Ancestral',
          b: 'Variant',
          row,
          p: '0.035',
          differs: `${APPROX_SIGNED_RANK} With the approximation and the same correction all three are 0.0355, the printed value.`,
        })),
      },
    ],
    graph: paired('FRNT_{50}', {
      logY: 'log2',
      xTitle: 'Variant pseudovirus',
      format: formats(crossbarOnly('geomean'), titled('Type-specific neutralization by virus')),
    }),
  },
  {
    label: '5k',
    name: 'Fig. 5k – Type-specific neutralization proportion',
    ...file('fig5k.csv'),
    ...long('Ancestral-absorbed / mock titer ratio', 'Pseudovirus', { subject: 'Donor' }),
    legend:
      'type-specific proportion of the total pseudovirus neutralization titer (n = 5 samples); red bars indicate the median. No P value is printed. The figure’s axis stops at 1.00 and its highest point is about 0.5, but the sheet holds a ratio of 2 for donor 001 against KP.3, which the chart here draws.',
    graph: paired('Ancestral/mock absorbed titer ratio', {
      xTitle: 'Variant pseudovirus',
      format: titled('Type-specific neutralization proportion'),
    }),
  },

  // ---- Figure 6 ---------------------------------------------------------------------------------
  // Each subset is its own chart in the figure, and its own two-group table here: the app's
  // Mann-Whitney test compares two data sets of a column table.
  ...(
    [
      ['6b', 'fig6b.csv', 'RBD-binding B cells', 'WA1+KP.3−', '', false],
      ['6b', 'fig6b.csv', 'RBD-binding B cells', 'WA1+KP.3+', '0.002', false],
      ['6b', 'fig6b.csv', 'RBD-binding B cells', 'WA1−KP.3+', '0.004', false],
      ['6c', 'fig6c.csv', 'XBB.1.5 RBD-binding of WA1−KP.3+ B cells', 'XBB.1.5−', '0.026', true],
      ['6c', 'fig6c.csv', 'XBB.1.5 RBD-binding of WA1−KP.3+ B cells', 'XBB.1.5+', '0.005', true],
      ['6g', 'fig6g.csv', 'CD71+ B cells', 'WA1+KP.3−', '', true],
      ['6g', 'fig6g.csv', 'CD71+ B cells', 'WA1+KP.3+', '3.64e-5', true],
      ['6g', 'fig6g.csv', 'CD71+ B cells', 'WA1−KP.3+', '0.001', true],
    ] as [string, string, string, string, string, boolean][]
  ).map(
    ([label, csv, title, subset, p, approximate]): Panel => ({
      label,
      name: `Fig. ${label} – ${subset}${label === '6g' ? ' CD71⁺' : ''}`,
      ...file(csv),
      ...long('Percentage of total B cells', 'Day', {
        subject: 'Donor',
        filters: [{ column: 'Subset', value: subset }],
      }),
      legend: `${title}: ${subset} B cells as a percentage of total B cells before and after boost (n = 12 individuals)${p ? ` (P = ${p})` : ' (no P value printed for this subset)'}; crossbars represent the mean; the legend names a Wilcoxon signed-rank test with a Benjamini-Hochberg correction for multiple testing, two sided.`,
      ...(p
        ? {
            analyses: [
              {
                analysis: 'mannWhitney',
                test: `Mann-Whitney test${approximate ? ' (normal approximation)' : ''}`,
                ...(approximate ? { params: { pMethod: 'approximate' } } : {}),
                dataSets: ['Day 0', 'Day 15'],
                why: `the legend names a Wilcoxon signed-rank test with a Benjamini-Hochberg correction, but the printed values are those of the unpaired rank-sum test, uncorrected${approximate ? ', with the normal approximation R’s wilcox.test falls back to when values are tied (the app’s exact permutation P, its default, is smaller)' : ''}.`,
                brackets: 'stars',
                printed: [{ a: 'Day 0', b: 'Day 15', p }],
              },
            ],
          }
        : {}),
      graph: paired('Percentage of total B cells', {
        logY: true,
        format: formats(crossbarOnly('mean'), titled(subset)),
      }),
    }),
  ),
  {
    label: '6d',
    name: 'Fig. 6d – Isotypes of RBD-binding B cells',
    ...file('fig6d.csv'),
    ...long('Percentage of total B cells', 'Isotype', { row: 'Sample', subject: 'Donor' }),
    legend:
      'heavy chain isotypes of RBD probe⁺ B cells that bind WA1 RBD only, WA1 RBD and KP.3 RBD or KP.3 RBD only before and after boost (average % of total B cells, n = 12). No P value is printed.',
    graph: stacked('Average % of total B cells', ISOTYPE_COLORS, {
      format: titled('Isotypes of RBD-binding B cells'),
    }),
  },
  {
    label: '6e',
    name: 'Fig. 6e – Isotypes of WA1⁻KP.3⁺ B cells',
    ...file('fig6e.csv'),
    ...long('Percentage of total B cells', 'Isotype', { row: 'Sample', subject: 'Donor' }),
    legend:
      'heavy chain isotypes of KP.3⁺WA1⁻ B cells that are XBB.1.5⁻ or XBB.1.5⁺ before and after boost. No P value is printed.',
    graph: stacked('Average % of total B cells', ISOTYPE_COLORS, {
      size: SMALL,
      format: titled('Isotypes of WA1–KP.3+ B cells'),
    }),
  },
  {
    label: '6h',
    name: 'Fig. 6h – KP.3-binding share of WA1-binding B cells',
    ...file('fig6h.csv'),
    ...long('Percentage', 'Day', { subject: 'Donor' }),
    legend:
      'percentage of WA1 RBD-binding B cells that also bind KP.3 RBD before and after boost (P = 1.44 × 10⁻⁴; n = 12 individuals).',
    analyses: [
      rankSum(
        'Day 0',
        'Day 15',
        '1.44e-4',
        'the printed value is the unpaired rank-sum test’s; the signed-rank test the legend names gives 4.9 × 10⁻⁴.',
      ),
    ],
    graph: paired('Percentage of WA1-binding B cells', {
      yRange: [0, 100],
      format: formats(crossbarOnly('mean'), titled('Percent KP.3 of WA1')),
    }),
  },
  {
    label: '6i',
    name: 'Fig. 6i – WA1-non-binding share of KP.3-binding B cells',
    ...file('fig6i.csv'),
    ...long('Percentage', 'Day', { subject: 'Donor' }),
    legend:
      'percentage of KP.3 RBD-binding B cells that do not bind WA1 RBD before and after boost (n = 12 individuals). No P value is printed.',
    graph: paired('Percentage of KP.3-binding B cells', {
      yRange: [0, 40],
      format: formats(crossbarOnly('mean'), titled('Percent WA1 of KP.3')),
    }),
  },
  {
    label: '6j',
    name: 'Fig. 6j – B cell response against KP.3-binding antibodies',
    ...file('fig6j.csv'),
    import: { tableKind: 'xy', firstColumn: 'x' },
    legend:
      'Spearman rank correlation of the increase in frequency of KP.3 RBD-specific B cells versus the increase in antibodies that bind the KP.3 RBD measured by ELISA (ρ = −0.78, P = 0.017; n = 9 individuals).',
    analyses: [
      {
        analysis: 'correlation',
        test: 'Spearman correlation',
        params: { method: 'spearman' },
        brackets: 'none',
        printed: [
          {
            a: 'Increase in WA1−KP.3+ B cells',
            b: 'Increase in KP.3-binding antibodies',
            stat: 'ρ',
            value: 'r',
            p: '-0.78',
          },
          {
            a: 'Increase in WA1−KP.3+ B cells',
            b: 'Increase in KP.3-binding antibodies',
            value: 'p',
            p: '0.017',
          },
        ],
      },
    ],
    graph: {
      preset: 'each',
      xTitle: 'Increase in WA1–KP.3^+ B cells',
      yTitle: 'Increase in KP.3 binding Abs',
      size: SMALL,
      legend: false,
      colors: [BLACK],
      format: titled('WA1–KP.3+ B cell response vs KP.3 binding Abs'),
    },
  },
  {
    label: '6l',
    name: 'Fig. 6l – KP.3 RBD-binding B cells',
    ...file('fig6l.csv'),
    ...long('Percentage of memory B cells', 'Day', { subject: 'Donor' }),
    legend:
      'KP.3 RBD-binding B cells as a percentage of memory B cells before and after boost (P = 0.01; n = 14 individuals); crossbars represent the median; Wilcoxon signed-rank test.',
    analyses: [
      {
        analysis: 'wilcoxon',
        test: 'Wilcoxon matched-pairs signed rank test',
        dataSets: ['Day 0', 'Day 15'],
        brackets: 'stars',
        printed: [{ a: 'Day 0', b: 'Day 15', p: '0.01' }],
      },
    ],
    graph: paired('Percentage of memory B cells', {
      logY: true,
      format: titled('KP.3 RBD+ B cells'),
    }),
  },
  {
    label: '6m',
    name: 'Fig. 6m – Lineage somatic hypermutation',
    ...file('fig6m.csv'),
    ...long('Percent SHM', 'Day'),
    legend:
      'mean heavy chain variable percent SHM of all B cell lineages sequenced before (n = 423) and after (n = 708) boost (P = 0.0066); crossbars represent the median; Wilcoxon rank-sum test.',
    analyses: [rankSum('Day 0', 'Day 15', '0.0066')],
    graph: dots('Percent SHM', { yRange: [0, 25], colors: [BLACK, BLACK], format: titled('IGHV') }),
  },
  {
    label: '6o',
    name: 'Fig. 6o – Lineage appearance',
    ...file('fig6o.csv'),
    ...long('Lineages', 'Appearance', { row: 'Day' }),
    legend:
      'summary of lineage appearances before and after boost (lineages seen at both time points, or at one only). No P value is printed.',
    graph: stacked('No. lineages', [RED, GREY, '#ffffff'], {
      size: SMALL,
      rotate: undefined,
      format: titled('Lineage appearance'),
    }),
  },
  {
    label: '6p',
    name: 'Fig. 6p – IGHV gene usage before and after boost',
    ...file('fig6p.csv'),
    ...long('Proportion of VH usage', 'Day', { row: 'IGHV gene', subject: 'Donor' }),
    legend:
      'heavy chain variable gene usage frequencies before and after KP.2 boost (n = 14 individuals): white and gray bars are the mean frequencies before and after boost, dots each donor’s mean. No P value is printed.',
    graph: {
      preset: 'barsPoints',
      yTitle: 'Proportion of V_H usage',
      colors: ['#ffffff', GREY],
      size: [430, 110],
      rotate: 90,
      legend: true,
      format: formats(
        without('No error bars, as the figure (the donors’ values are drawn).', 'error'),
        outlinedBars,
        titled('IGHV gene usage day 0 versus day 15'),
      ),
    },
  },
]

export const JOHNSTON: PaperSpec = {
  id: 'johnston',
  title: 'Johnston et al. 2026 (Nature Immunology)',
  description:
    'De novo and imprinted antibodies after SARS-CoV-2 variant exposure: Figs 1, 2, 3, 5 and 6 rebuilt from the paper’s source data, which this example embeds (CC BY 4.0) — paired line charts on log axes, stacked counts of antibodies and lineages, dot plots with median crossbars, a clustered epitope-binning heat map, and Mann-Whitney, Wilcoxon signed-rank, Kruskal-Wallis and Spearman tests against the P values the figures print.',
  citation:
    'Johnston, T. S., Fabozzi, G., Gorman, J. et al., “Potent type-specific de novo antibodies complement broadly reactive imprinted antibodies in immune responses to SARS-CoV-2 variants”, Nature Immunology 27, 1874–1886 (2026), https://doi.org/10.1038/s41590-026-02613-4 (CC BY 4.0).',
  folder: 'johnston',
  layoutColumns: 3,
  figures: [
    {
      figure: '1',
      rows: [['1b', '1c'], ['1e'], ['1f'], ['1g'], ['1h']],
      notes:
        'Left out: a (flow cytometry plots) and d (a schematic of the RATP-Ig workflow). In e and f the figure draws one chart per donor; here the donors are side by side in one chart (one graph per level of a variable is roadmap 34d). The counts below the figure’s charts (n = 3, 144 …) are the totals of each bar.',
    },
    {
      figure: '2',
      rows: [['2a:1'], ['2a:2'], ['2b', '2c'], ['2f']],
      notes:
        'Left out: d (circos plots of heavy–light chain pairing) and e (ring plots of clonal expansion, one segment per lineage). Each of a’s two charts holds only the genes used by that group; the figure draws both over the same 29 genes.',
    },
    {
      figure: '3',
      rows: [['3b'], ['3c', '3d'], ['3e:1'], ['3e:2'], ['3f:1', '3f:2']],
      notes:
        'Left out: a (the RBD structure with reference antibody footprints). In b the figure annotates the rows and columns with binding class and neutralization (coloured squares beside the map). In f the fraction of nAbs in each class that neutralize is printed under the plot.',
    },
    {
      figure: '5',
      rows: [
        ['5b', '5c'],
        ['5d', '5e'],
        ['5f', '5g'],
        ['5i', '5j', '5k'],
      ],
      notes:
        'Left out: a (cohort overview) and h (the responders’ exposure histories). In b and c the figure draws the two antigens as separate charts; here they are the two groups of one grouped chart. The figure also prints the geometric means and their fold change above each chart.',
    },
    {
      figure: '6',
      rows: [['6b', '6c'], ['6d', '6e'], ['6g', '6h', '6i'], ['6j', '6l', '6m'], ['6o'], ['6p']],
      notes:
        'Left out: a, f and k (flow cytometry plots), n (ring plots of lineage expansion per donor) and q (lineage trees). In j the figure prints ρ and P inside the plot and draws the regression line; in m it joins the lineages found at both time points.',
    },
  ],
  panels: PANELS,
}

/** Serves the paper's embedded tables as files, so the example imports them like any other. */
const embedded = (ctx: ExampleContext): ExampleContext => ({
  ...ctx,
  sourceFile: async (path: string) => {
    const name = path.startsWith(`${JOHNSTON.folder}/`)
      ? path.slice(JOHNSTON.folder.length + 1)
      : path
    const csv = JOHNSTON_DATA[name]
    return csv === undefined ? ctx.sourceFile(path) : new TextEncoder().encode(csv)
  },
})

/** The example's project: the paper's figures rebuilt from the embedded source data. */
export async function createJohnstonExample(ctx: ExampleContext): Promise<Project> {
  return (await buildPaper(JOHNSTON, embedded(ctx))).project
}

/** The paper built with its P value checks (the tests compare them with the printed values). */
export const buildJohnston = (ctx: ExampleContext) => buildPaper(JOHNSTON, embedded(ctx))
