import type { FontRegistry } from '@ps/graph'
import {
  type DataSetColumn,
  type DataTable,
  type GraphNode,
  type Layer,
  newAnnotationId,
  newColumnId,
  type Project,
} from '@ps/model'
import { CHEN_FILES } from './chenData.ts'
import {
  type AnalysisSpec,
  type BuiltPaper,
  buildPaper,
  type GraphSpec,
  type PaperSpec,
} from './paper.ts'

/*
 * Figures of Chen, Guo, Heath et al., “Human vaccine responses regulated by parallel cytokine
 * pathways”, Nature Immunology 27, 1643–1652 (2026), https://doi.org/10.1038/s41590-026-02547-x,
 * rebuilt from the paper's source data (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/).
 * The data are embedded (`chenData.ts`: the columns and rows of the deposited CSV tables the
 * panels read), so the example is part of every build, loaded when first opened (audit 3; it read
 * a local source_data folder before). It is built as the other papers are (`buildPaper`): each
 * panel's table imported from its file as a user would, made into the figure's table where the
 * file is long or a summary, the analyses giving the printed P values, and a page per figure.
 */

// --- Format-graph changes -----------------------------------------------------------------

type Format = NonNullable<GraphSpec['format']>

/** Several Format-graph changes in turn. */
const formats = (...fs: Format[]): Format => ({
  does: fs.map((f) => f.does).join(' '),
  apply: (g, t) => fs.reduce((x, f) => f.apply(x, t), g),
})

/** A change to every layer of one geom. */
const restyle = (geom: Layer['geom'], style: Record<string, unknown>) => (g: GraphNode) => ({
  ...g,
  layers: g.layers.map((l) =>
    l.geom === geom ? ({ ...l, style: { ...l.style, ...style } } as Layer) : l,
  ),
})

/** Bars filled solid in their data set's colour, as the figures draw them. */
const solidBars: Format = {
  does: 'Bars filled solid.',
  apply: restyle('bar', { fill: { type: 'solid', color: { series: true }, opacity: 1 } }),
}

/** Error bars in black. */
const blackErrors: Format = {
  does: 'Error bars black.',
  apply: restyle('errorbar', { line: { color: { rgb: '#000000' }, width: 1, dash: 'solid' } }),
}

/** Ticks every `interval` on the value axis (narrow graphs crowd the automatic ones). */
const valueTicks = (interval: number): Format => ({
  does: `Value axis ticks every ${interval}.`,
  apply: (g) =>
    g.axes.y.type === 'continuous'
      ? { ...g, axes: { ...g.axes, y: { ...g.axes.y, ticks: { interval, minor: 0 } } } }
      : g,
})

const GREY = '#a6a6a6'
const RED = '#e8191e'
const NAVY = '#12127a'
const UP = '#ff2a1a'
const DOWN = '#3d8ff0'

// The embedded files (`chenData.ts`) are named as deposited: the CSV tables, the zips' members
// by their own names (MOESM4: fig1b, cytokineAcrossCohorts; MOESM7: fig4b_vsIIV, fig4b_vsCtrl,
// fig4e).
const MOESM5 = '41590_2026_2547_MOESM5_ESM.csv'
const MOESM6 = '41590_2026_2547_MOESM6_ESM.csv'
/** Fig. 6e: the workbook's sheet, embedded as CSV. */
const MOESM8 = '41590_2026_2547_MOESM8_ESM.csv'

// --- Reading imported tables ----------------------------------------------------------------

/** A grouped table's values in one row of one data set (every replicate). */
const cellValues = (table: DataTable, ds: number, row: number): number[] =>
  table.dataSets[ds]!.subcolumns.flatMap((c) =>
    c.type === 'number' && c.values[row] !== null && c.values[row] !== undefined
      ? [c.values[row]]
      : [],
  )

type Cell = string | number | null

/** A multiple-variables table's rows as records by variable title (text or number). */
function records(table: DataTable): Record<string, Cell>[] {
  return Array.from({ length: table.rowCount }, (_, r) =>
    Object.fromEntries(
      table.dataSets.map((d) => [
        d.title.trim(),
        d.text ? (d.text[r] ?? null) : (d.subcolumns[0]?.values[r] ?? null),
      ]),
    ),
  )
}

const text = (v: Cell) => (v === null ? '' : String(v).trim())
/** A number cell, or a number written as text ("NA" and blanks are empty). */
const num = (v: Cell): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number(text(v))
  return text(v) !== '' && Number.isFinite(n) ? n : null
}

/** The table with these parts replaced (formatting of the old rows and widths dropped). */
const remade = (
  t: DataTable,
  parts: Pick<DataTable, 'tableKind' | 'yFormat' | 'rowCount' | 'rowTitles' | 'dataSets'> &
    Partial<Pick<DataTable, 'x'>>,
): DataTable => ({
  kind: 'table',
  id: t.id,
  name: t.name,
  notes: t.notes,
  x: null,
  ...parts,
})

const numberColumn = (title: string, values: (number | null)[]): DataSetColumn => ({
  id: newColumnId(),
  title,
  subcolumns: [{ type: 'number', values }],
})

/** Mean, SEM and N of one cell of a summary table. */
type Summary = [number | null, number | null, number | null]

/**
 * A grouped table of means, SEMs and Ns (rows × data sets) from records of a long summary file:
 * `cell` finds each row's and data set's record.
 */
function meanSemGrouped(
  t: DataTable,
  rowTitles: string[],
  dataSetTitles: string[],
  cell: (row: number, ds: number) => Summary | null,
): DataTable {
  return remade(t, {
    tableKind: 'grouped',
    yFormat: { type: 'summary', preset: 'meanSemN' },
    rowCount: rowTitles.length,
    rowTitles,
    dataSets: dataSetTitles.map((title, j) => {
      const cells = rowTitles.map((_, i) => cell(i, j))
      return {
        id: newColumnId(),
        title,
        subcolumns: [0, 1, 2].map((k) => ({
          type: 'number' as const,
          values: cells.map((c) => c?.[k] ?? null),
        })),
      }
    }),
  })
}

/** A column table of means, SEMs and Ns: one data set per title. */
function meanSemColumns(t: DataTable, titles: string[], cell: (ds: number) => Summary | null) {
  return remade(t, {
    tableKind: 'column',
    yFormat: { type: 'summary', preset: 'meanSemN' },
    rowCount: 1,
    rowTitles: null,
    dataSets: titles.map((title, j) => {
      const c = cell(j)
      return {
        id: newColumnId(),
        title,
        subcolumns: [0, 1, 2].map((k) => ({ type: 'number' as const, values: [c?.[k] ?? null] })),
      }
    }),
  })
}

const summaryOf = (r: Record<string, Cell> | undefined, n?: number): Summary | null =>
  r ? [num(r.mean ?? null), num(r.se ?? null), n ?? num(r.n ?? null)] : null

/** A grouped table's rows in this order (by index), retitled. */
function pickRows(t: DataTable, order: number[], titles: string[]): DataTable {
  return remade(t, {
    tableKind: t.tableKind,
    yFormat: t.yFormat,
    rowCount: order.length,
    rowTitles: titles,
    dataSets: t.dataSets.map((d) => ({
      id: d.id,
      title: d.title,
      subcolumns: d.subcolumns.map((c) => ({
        type: 'number' as const,
        values: order.map((r) => c.values[r] ?? null),
      })),
    })),
  })
}

/** Cytokine names as the figures print them: IL21 → IL-21, IFNB1 → IFNβ1, IL1B → IL-1β. */
const GREEK: Record<string, string> = { W: 'ω', A: 'α', B: 'β', L: 'λ', G: 'γ' }
const SPECIAL: Record<string, string> = { IL1B: 'IL-1β', MMP12: 'MMP-12', LAG3: 'LAG-3' }
const pretty = (name: string): string =>
  SPECIAL[name] ??
  name.replace(/IFN([WABLG])/g, (_, g: string) => `IFN${GREEK[g]}`).replace(/^IL(\d)/, 'IL-$1')

/** Data sets' colours by the sign of each one's mean: up red, down blue (Fig. 4b–d). */
const bySign: Format = {
  does: 'Each bar coloured by the direction of the change: red up, blue down.',
  apply: (g: GraphNode, t: DataTable): GraphNode => ({
    ...g,
    seriesOverrides: {
      ...g.seriesOverrides,
      ...Object.fromEntries(
        t.dataSets.map((d) => [
          d.id,
          {
            ...g.seriesOverrides[d.id],
            color: { rgb: (d.subcolumns[0]?.values[0] ?? 0) < 0 ? DOWN : UP },
          },
        ]),
      ),
    },
  }),
}

// --- Fig. 1b ----------------------------------------------------------------------------------

/**
 * Fig. 1b as plotted: rows are the four quartiles of the pre-vaccination titre in order, and the
 * two younger age groups of the data (2–18 and 18–65 years) form one group, 2–65 years.
 */
function ageGroupsAsPlotted(table: DataTable): DataTable {
  const find = (title: string) => {
    const i = table.dataSets.findIndex((d) => d.title.replace(/\s+/g, '') === title)
    if (i < 0) throw new Error(`Fig. 1b: no age group “${title}” in the imported table.`)
    return i
  }
  const young = [find('[2,18)'), find('[18,65)')]
  const old = find('[65,99]')
  const quartiles = ['1', '2', '3', '4'].map((q) => {
    const r = (table.rowTitles ?? []).indexOf(q)
    if (r < 0) throw new Error(`Fig. 1b: no quartile ${q} in the imported table.`)
    return r
  })
  const cells = [
    quartiles.map((r) => young.flatMap((ds) => cellValues(table, ds, r))),
    quartiles.map((r) => cellValues(table, old, r)),
  ]
  const reps = Math.max(...cells.flat().map((c) => c.length))
  return {
    ...table,
    rowCount: quartiles.length,
    rowTitles: ['0–25%', '25–50%', '50–75%', '75–100%'],
    yFormat: { type: 'replicates', count: reps },
    dataSets: ['Age 2–65', 'Age 65–99'].map((title, i) => ({
      id: newColumnId(),
      title,
      subcolumns: Array.from({ length: reps }, (_, k) => ({
        type: 'number' as const,
        values: cells[i]!.map((c) => c[k] ?? null),
      })),
    })),
  }
}

// --- Fig. 2 -----------------------------------------------------------------------------------

/** Fig. 2's names: IL18 → IL-18 (IL12P40 and IL12P70 as printed). */
const fig2Name = (n: string) =>
  /^IL\d+$|^IL\d+[A-Z]+$/.test(n) && !/P\d/.test(n) ? n.replace(/^IL/, 'IL-') : n

/** Fig. 2: cytokines ordered by the low-titre group's value, largest first; Low before High. */
function fig2Order(t: DataTable): DataTable {
  const low = t.dataSets.findIndex((d) => d.title === 'Low')
  const high = t.dataSets.findIndex((d) => d.title === 'High')
  if (low < 0 || high < 0) throw new Error('Fig. 2: no “Low” and “High” groups in the import.')
  const titles = t.rowTitles ?? []
  const v = (r: number) => t.dataSets[low]!.subcolumns[0]!.values[r] ?? -Infinity
  const order = titles.map((_, r) => r).sort((a, b) => v(b) - v(a))
  const sorted = pickRows(
    t,
    order,
    order.map((r) => fig2Name(titles[r] ?? '')),
  )
  return { ...sorted, dataSets: [sorted.dataSets[low]!, sorted.dataSets[high]!] }
}

// --- Fig. 3b ----------------------------------------------------------------------------------

const FIG3B = [
  'IL21',
  'IL10',
  'IL12',
  'IFNB1',
  'IFNA2',
  'IFNW',
  'IL9',
  'IL2',
  'IL1B',
  'IL5',
  'IL17A',
  'TNF',
  'TRAIL',
  'IL1RA',
  'LTA',
  'IL18',
  'IL4',
  'IL13',
  'IFNG',
]

function fig3b(t: DataTable): DataTable {
  const rs = records(t)
  const levels = ['1', '10', '100']
  return meanSemGrouped(
    t,
    FIG3B.map(pretty),
    levels.map((c) => `${c} ng/ml`),
    (i, j) => {
      const r = rs.find(
        (x) => text(x.cmpd ?? null) === FIG3B[i] && text(x.cmpd_conc ?? null) === levels[j],
      )
      return r ? [num(r.mean_abd ?? null), num(r.se_abd ?? null), 5] : null
    },
  )
}

// --- Fig. 4b–d, Extended Data Fig. 2–4 -------------------------------------------------------

/** Fig. 4b–d's cytokines, top to bottom (LAIV versus IIV, P < 0.05 and fold change ≥ 2). */
const FIG4 = [
  'IFNW1',
  'IFNA2',
  'IFNL1',
  'IFNL2; IFNL3',
  'CCL7',
  'GZMB',
  'CXCL10',
  'IL10',
  'CCL4',
  'IL12p70',
  'TNFSF10',
  'LAG3',
  'TNFSF18',
  'IL1B',
  'TNFSF13',
  'MMP12',
  'TREM2',
  'FLT1',
  'CCL24',
]

/** One comparison of Fig. 4b–d: each cytokine's mean log2 change ± SE (n donors). */
const fig4Panel =
  (sti: string, day?: string) =>
  (t: DataTable): DataTable => {
    const rs = records(t).filter(
      (r) =>
        text(r.sti ?? null) === sti && (day === undefined || text(r.sample_day ?? null) === day),
    )
    return meanSemColumns(t, FIG4.map(pretty), (j) =>
      summaryOf(rs.find((r) => text(r.targetName ?? null) === FIG4[j])),
    )
  }

/** Extended Data Fig. 2's cytokines, top to bottom (as printed; red names: type I IFNs). */
const ED2 = [
  'IFNW1',
  'IFNA1; IFNA13',
  'IFNA2',
  'IFNL1',
  'IFNG',
  'CCL8',
  'CXCL10',
  'GZMB',
  'CCL4',
  'IFNL2; IFNL3',
  'CCL3',
  'CCL7',
  'IL12p70',
  'CXCL9',
  'IL10',
  'CXCL13',
  'TNFSF10',
  'TNFRSF8',
  'CD274',
  'IL4',
  'GZMA',
  'IL9',
  'TNF',
  'FASLG',
  'TNFRSF4',
  'LTA',
  'IL2',
  'IL2RA',
  'BST2',
  'CST7',
  'IL12RB1',
  'CEACAM5',
  'TNFRSF18',
  'S100A12',
  'IL20',
  'MMP12',
  'TNFSF13',
  'CXCL5',
  'FLT1',
  'CCL24',
  'TREM2',
]
const ED3 = ['IFNA1; IFNA13', 'IFNA2', 'IFNB1', 'IFNW1', 'IFNG', 'IFNL1', 'IFNL2; IFNL3']

/** IIV and LAIV each against unstimulated organoids at day 3, for these cytokines. */
const vaccinesVsCtrl =
  (names: string[], title: (n: string) => string) =>
  (t: DataTable): DataTable => {
    const rs = records(t).filter((r) => text(r.sample_day ?? null) === '3')
    const sti = ['LAIV', 'IIV']
    return meanSemGrouped(t, names.map(title), ['LAIV to Ctrl', 'IIV to Ctrl'], (i, j) =>
      summaryOf(
        rs.find((r) => text(r.targetName ?? null) === names[i] && text(r.sti ?? null) === sti[j]),
      ),
    )
  }

/** Extended Data Fig. 4: the stimulations as the figure's design (+/−) names them. */
const ED4_CONDITIONS: Record<string, string> = {
  IIV: 'IIV',
  IFNB: 'IFNβ',
  IIV_IFNB: 'IIV + IFNβ',
  LAIV_IFNB: 'LAIV + IFNβ',
  LAIV: 'LAIV',
}

function ed4(t: DataTable, [vsIIV]: DataTable[]): DataTable {
  // The cytokines differentially induced by LAIV versus IIV: FDR < 0.05 and fold change > 2.
  const keep = records(vsIIV!)
    .filter((r) => {
      const fdr = num(r.fdr ?? null)
      const m = num(r.mean ?? null)
      return (
        text(r.sti ?? null) === 'LAIV' &&
        fdr !== null &&
        fdr < 0.05 &&
        m !== null &&
        Math.abs(m) >= 1
      )
    })
    .map((r) => text(r.targetName ?? null))
  const titles = t.rowTitles ?? []
  const order = keep.map((n) => {
    const r = titles.indexOf(n)
    if (r < 0) throw new Error(`Extended Data Fig. 4: no cytokine “${n}” at day 3.`)
    return r
  })
  const rows = pickRows(
    t,
    order,
    order.map((r) => pretty(titles[r] ?? '')),
  )
  return {
    ...rows,
    dataSets: rows.dataSets.map((d) => ({ ...d, title: ED4_CONDITIONS[d.title] ?? d.title })),
  }
}

// --- Extended Data Fig. 5c ----------------------------------------------------------------------

const QUARTILE: Record<string, string> = { '1': '0–25%', '2': '25–50%' }

/**
 * Extended Data Fig. 5c: older adults (65–99 years) given the standard-dose vaccine, in the lower
 * half of pre-vaccination titres, split by sex, titre quartile, cohort and season; subpopulations
 * of at least five people, lettered A–I in the order of the figure's table. X is the IFNβ serum
 * abundance (log2, not normalized) joined by person and season; one Y data set per subpopulation.
 */
function ed5c(t: DataTable, [ifnb]: DataTable[]): DataTable {
  const abundance = new Map(
    (ifnb!.rowTitles ?? []).map((id, r) => [
      id ?? '',
      ifnb!.dataSets[0]!.subcolumns[0]!.values[r] ?? null,
    ]),
  )
  const people = records(t).filter(
    (r) =>
      text(r.ageGroup ?? null) === '[65,99]' &&
      text(r.vacGroup ?? null) === 'fluzoneSD' &&
      QUARTILE[text(r.d0Mean_group ?? null)] !== undefined,
  )
  const keyOf = (r: Record<string, Cell>) =>
    [r.gender, r.d0Mean_group, r.project, r.Year].map((v) => text(v ?? null)).join('|')
  const groups = new Map<string, Record<string, Cell>[]>()
  for (const r of people) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r])
  const kept = [...groups.entries()]
    .filter(([, rs]) => rs.length >= 5)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (kept.length !== 9)
    throw new Error(`Extended Data Fig. 5c: expected 9 subpopulations, found ${kept.length}.`)
  const rows = kept.flatMap(([, rs], g) => rs.map((r) => ({ r, g })))
  return remade(t, {
    tableKind: 'xy',
    yFormat: { type: 'replicates', count: 1 },
    rowCount: rows.length,
    rowTitles: null,
    x: {
      title: 'log2(IFN-β serum abundance on day 0)',
      xFormat: 'numbers',
      subcolumns: [
        {
          type: 'number',
          values: rows.map(({ r }) => abundance.get(text(r.personYear_id ?? null)) ?? null),
        },
      ],
    },
    dataSets: kept.map(([, rs], g) => {
      const [first] = rs
      const label = String.fromCharCode(65 + g)
      return {
        ...numberColumn(
          `Sub-population ${label}`,
          rows.map(({ r, g: h }) => (h === g ? num(r.abFc ?? null) : null)),
        ),
        // The subpopulation's definition, as the figure's table lists it.
        subcolumnTitles: [
          `${text(first!.gender ?? null)}, ${QUARTILE[text(first!.d0Mean_group ?? null)]}, ${text(first!.project ?? null)}, ${text(first!.Year ?? null)}`,
        ],
      }
    }),
  })
}

/** A dashed horizontal line at Y = 0 across the X range. */
const zeroLine = (from: number, to: number) => ({
  does: 'A dashed line at Y = 0.',
  apply: (g: GraphNode): GraphNode => ({
    ...g,
    annotations: [
      ...g.annotations,
      {
        type: 'line' as const,
        id: newAnnotationId(),
        space: 'data' as const,
        from: { x: from, y: 0 },
        to: { x: to, y: 0 },
        stroke: { color: { rgb: '#000000' }, width: 0.75, dash: 'dash' as const },
        arrow: 'none' as const,
      },
    ],
  }),
})

// --- Fig. 4e ----------------------------------------------------------------------------------

const FIG4E_DIFFERS =
  'The deposited scores don’t match the points plotted in Fig. 4e (the conditions with IFNβ or LAIV plot 0.7–1.2 log2 units higher than the data), so no test of the deposited data gives the printed values.'

const STIMULATION: Record<string, string> = {
  IFNB: 'IFNβ',
  IIV: 'IIV',
  IIV_IFNB: 'IIV+IFNβ',
  LAIV: 'LAIV',
  LAIV_IFNB: 'LAIV+IFNβ',
}

const pairedVsIIV = (condition: string, p: string, first = false): AnalysisSpec => ({
  analysis: 'ttest',
  test: 'Paired t test',
  params: { design: 'paired' },
  dataSets: [condition, 'IIV'],
  printed: [{ a: condition, b: 'IIV', p, differs: first ? FIG4E_DIFFERS : 'As above.' }],
})

const GFP = 'IIV 1ug + GFP mRNA LNP 3ug'

export const CHEN: PaperSpec = {
  id: 'chen',
  title: 'Chen et al. 2026 (Nature Immunology)',
  description:
    'Cytokine pathways in vaccine responses (CC BY 4.0, data embedded): Fig. 1b, 2, 3b, 4b–e and 6e and Extended Data Fig. 2–4 and 5c rebuilt from the source data — long-format CSVs imported one value per row, or as records and made into tables of means ± SEM (meta-analysis bars, organoid screens, cytokine profiles, a clustered heat map), and two files joined by person (IFNβ against the antibody response). Mann-Whitney tests per quartile, paired t tests and a one-way ANOVA check the printed P values; Fig. 4e’s deposited data don’t reproduce its P values.',
  citation:
    'Chen, Guo, Heath et al., “Human vaccine responses regulated by parallel cytokine pathways”, Nature Immunology 27, 1643–1652 (2026), https://doi.org/10.1038/s41590-026-02547-x (CC BY 4.0).',
  folder: 'chen',
  panels: [
    {
      label: '1b',
      name: 'Fig. 1b – HAI antibody fold change by age',
      file: 'fig1b.csv',
      sheet: 'fig1b',
      long: {
        value: 'abFc',
        group: 'ageGroup',
        row: 'd0Mean_group',
        filters: [{ column: 'vacGroup', value: 'fluzoneSD' }],
      },
      edit: {
        describe:
          'rows put in quartile order and named by quartile of the pre-vaccination titre; the two younger age groups (2–18 and 18–65 years) combined into one, 2–65 years, as the figure plots them.',
        apply: ageGroupsAsPlotted,
      },
      legend:
        'two-sided Wilcoxon rank-sum test within each quartile of the pre-vaccination titre (standard-dose vaccine only).',
      analyses: [
        {
          analysis: 'multipleT',
          test: 'Mann-Whitney test per quartile',
          params: { distribution: 'nonparametric', rankTest: 'mannWhitney', approach: 'none' },
          why: 'the Wilcoxon rank-sum test is the Mann-Whitney test; exact P values for the smaller quartiles, the normal approximation with continuity correction for the larger (as R).',
          brackets: 'number',
          printed: (
            [
              ['0–25%', '0.002'],
              ['25–50%', '5e-7'],
              ['50–75%', '0.08'],
              ['75–100%', '0.95'],
            ] as const
          ).map(([row, p]) => ({ a: 'Age 2–65', b: 'Age 65–99', row, p })),
        },
      ],
      graph: {
        preset: 'boxPoints',
        yTitle: 'Flu HAI Ab titer fold change (log_2 day 28 versus day 0)',
        xTitle: 'Flu HAI Ab titer quantile at day 0 (Pre–VAX)',
        colors: [GREY, RED],
        size: [300, 230],
      },
    },
    {
      label: '2',
      name: 'Fig. 2 – Pre-VAX cytokines and antibody response (meta-analysis)',
      file: MOESM5,
      sheet: '41590_2026_2547_MOESM5_ESM',
      long: { value: 'directP', group: 'd0Mean_twoGroup', row: 'analyte_generic_name' },
      edit: {
        describe:
          'cytokines ordered by the low pre-vaccination titre group’s value, largest first, as the figure sorts them, and named as the figure prints them (IL18 → IL-18); the Low group put first. The figure’s legend names the dark bars “High”, but they are the data’s “Low” group (IL-18, GRO-α and IFNβ significant, as the text says), so the groups keep the data’s names here.',
        apply: fig2Order,
      },
      legend:
        'random-effects meta-analysis per cytokine, z tests, Benjamini–Hochberg FDR; # and * mark FDR thresholds next to the cytokines (from the file’s fdr column, not drawn here).',
      graph: {
        preset: 'bars',
        horizontal: true,
        colors: [NAVY, '#a9d3ea'],
        yTitle:
          'Directional log_{10}(P) Correlation between pre–Vax (D0) serum level and post–Vax (D28) Ab Resp.',
        xTitle: 'Cytokines',
        size: [330, 640],
        format: solidBars,
      },
    },
    {
      label: '3b',
      name: 'Fig. 3b – Cytokine adjuvant screen in organoids',
      file: MOESM6,
      sheet: '41590_2026_2547_MOESM6_ESM',
      import: { tableKind: 'multipleVariables' },
      edit: {
        describe:
          'imported as records (one row per cytokine and concentration: mean, SE and FDR) and made into a grouped table of means ± SEM with N = 5 donors (the legend’s n): cytokines as rows in the figure’s order, the three concentrations (1, 10 and 100 ng/ml; IL-1β 10× lower and IL-18 10× higher, as the legend says) as data sets. The figure’s sixth cytokine, printed “IFNα”, is IFNW in the data (IFNω here).',
        apply: fig3b,
      },
      legend:
        'two-sided paired t test across donors (n = 5) with FDR; * Padj < 0.05, # Padj < 0.2 (from the file’s fdr column; the donors’ values aren’t deposited, so neither the points nor the tests are drawn here).',
      graph: {
        preset: 'barsSem',
        error: 'SEM',
        colors: ['#a8d5ea', '#1b8ccf', '#2e6fe0'],
        yTitle: 'log_2(Flu Ab) (+cytokine+IIV vs IIV-only, D7)',
        xTitle: 'Cytokines added (with IIV at D0)',
        size: [520, 220],
        format: formats(solidBars, blackErrors),
      },
    },
    {
      label: '4b',
      name: 'Fig. 4b – Cytokines, LAIV versus IIV (day 3)',
      file: 'fig4b_vsIIV.csv',
      sheet: 'fig4b_vsIIV',
      import: { tableKind: 'multipleVariables' },
      edit: {
        describe:
          'imported as records (one row per cytokine and stimulation: mean log2 change, SE, n) and made into a table of means ± SEM: the 19 cytokines the figure shows, in its order, for LAIV against IIV.',
        apply: fig4Panel('LAIV'),
      },
      legend:
        'two-sided paired limma analysis (moderated t test) across donors (n = 3); cytokines with P < 0.05 and fold change ≥ 2 shown. Error bars: SE. The donors’ values aren’t deposited, so the points aren’t drawn.',
      graph: {
        preset: 'barsSem',
        horizontal: true,
        yTitle: 'LAIV to IIV',
        error: 'SEM',
        size: [150, 270],
        legend: false,
        format: formats(bySign, solidBars, blackErrors, valueTicks(5)),
      },
    },
    {
      label: '4c',
      name: 'Fig. 4c – Cytokines, IFNβ versus control (day 3)',
      file: 'fig4b_vsCtrl.csv',
      sheet: 'fig4b_vsCtrl',
      import: { tableKind: 'multipleVariables' },
      edit: {
        describe:
          'imported as records and made into a table of means ± SEM: Fig. 4b’s 19 cytokines, IFNβ against unstimulated organoids at day 3.',
        apply: fig4Panel('IFNB', '3'),
      },
      legend: 'as Fig. 4b.',
      graph: {
        preset: 'barsSem',
        horizontal: true,
        yTitle: 'IFNβ to CTRL',
        error: 'SEM',
        size: [150, 270],
        legend: false,
        format: formats(bySign, solidBars, blackErrors, valueTicks(5)),
      },
    },
    {
      label: '4d',
      name: 'Fig. 4d – Cytokines, IIV + IFNβ versus IIV (day 3)',
      file: 'fig4b_vsIIV.csv',
      sheet: 'fig4b_vsIIV',
      import: { tableKind: 'multipleVariables' },
      edit: {
        describe:
          'imported as records and made into a table of means ± SEM: Fig. 4b’s 19 cytokines, IIV with IFNβ against IIV.',
        apply: fig4Panel('IIV_IFNB'),
      },
      legend: 'as Fig. 4b.',
      graph: {
        preset: 'barsSem',
        horizontal: true,
        yTitle: 'IIV+IFNβ to IIV',
        error: 'SEM',
        size: [150, 270],
        legend: false,
        format: formats(bySign, solidBars, blackErrors, valueTicks(5)),
      },
    },
    {
      label: '4e',
      name: 'Fig. 4e – Type I IFN activity score (day 3)',
      file: 'fig4e.csv',
      sheet: 'fig4e',
      long: { value: 'score', group: 'sti', subject: 'donor' },
      edit: {
        describe: 'stimulations named as the figure prints them (IIV_IFNB → IIV+IFNβ).',
        apply: (t) => ({
          ...t,
          dataSets: t.dataSets.map((d) => ({ ...d, title: STIMULATION[d.title] ?? d.title })),
        }),
      },
      legend: 'two-sided paired t test across donors (n = 3), each condition against IIV alone.',
      analyses: [
        pairedVsIIV('IFNβ', '0.008', true),
        pairedVsIIV('IIV+IFNβ', '0.02'),
        pairedVsIIV('LAIV', '0.07'),
        pairedVsIIV('LAIV+IFNβ', '0.07'),
      ],
      graph: {
        preset: 'barsPoints',
        error: 'SEM',
        horizontal: true,
        open: true,
        colors: Array(5).fill(NAVY),
        yTitle: 'Mean log_2(Abund.) (IFNβ induced cytokines)',
        size: [200, 220],
        legend: false,
        format: formats(solidBars, blackErrors, {
          does: 'Points as open grey circles.',
          apply: restyle('points', {
            fill: { type: 'none' },
            border: { color: { rgb: '#8c8c8c' }, width: 1, dash: 'solid' },
          }),
        }),
      },
    },
    {
      label: '6e',
      name: 'Fig. 6e – Flu-specific IgG ASCs (bone marrow)',
      file: MOESM8,
      sheet: '41590_2026_2547_MOESM8_ESM',
      legend: 'one-way ANOVA with multiple comparisons (the correction is not named).',
      analyses: [
        {
          analysis: 'oneWayAnova',
          test: 'One-way ANOVA, Tukey',
          params: { comparisons: 'allPairs', allPairsMethod: 'tukey' },
          why: 'Tukey’s test (Prism’s default) reproduces both printed values.',
          printed: [
            { a: GFP, b: 'IIV 1ug + IFNb mRNA LNP 3ug', p: '0.0002' },
            { a: GFP, b: 'IIV 1ug + IL21 mRNA LNP 3ug', p: '<0.0001' },
          ],
        },
      ],
      graph: {
        preset: 'barsPoints',
        error: 'SEM',
        yTitle: 'ASCs/10^6 cells',
        rotate: 45,
        colors: ['#333333', '#333333', '#333333', '#5b8bc9', '#f5a623', '#e0301e'],
        size: [180, 160],
        format: formats(solidBars, blackErrors, {
          does: 'Points black.',
          apply: restyle('points', {
            fill: { type: 'solid', color: { rgb: '#000000' }, opacity: 1 },
            border: { color: { rgb: '#000000' }, width: 1, dash: 'solid' },
          }),
        }),
      },
    },
    {
      label: 'ED2',
      name: 'Extended Data Fig. 2 – Cytokines induced by IIV or LAIV (day 3)',
      file: 'fig4b_vsCtrl.csv',
      sheet: 'fig4b_vsCtrl',
      import: { tableKind: 'multipleVariables' },
      edit: {
        describe:
          'imported as records and made into a grouped table of means ± SEM at day 3: the 41 cytokines the figure shows, in its order (its selection, “significantly altered by either vaccine”, isn’t reproduced by any FDR threshold of the file’s columns), LAIV and IIV each against unstimulated organoids.',
        apply: vaccinesVsCtrl(ED2, pretty),
      },
      legend:
        'cytokines significantly altered by either vaccine versus non-stimulated, spleen organoids (N = 3) at day 3; type I IFNs printed in red. The donors’ values aren’t deposited, so the points aren’t drawn.',
      graph: {
        preset: 'barsSem',
        horizontal: true,
        error: 'SEM',
        colors: [RED, NAVY],
        yTitle: 'Cytokine Abundance at Day 3 (Relative to non-stimulated)',
        format: formats(solidBars, blackErrors),
        size: [300, 640],
      },
    },
    {
      label: 'ED3',
      name: 'Extended Data Fig. 3 – IFNs induced by IIV or LAIV (day 3)',
      file: 'fig4b_vsCtrl.csv',
      sheet: 'fig4b_vsCtrl',
      import: { tableKind: 'multipleVariables' },
      edit: {
        describe:
          'imported as records and made into a grouped table of means ± SEM at day 3: the type I, II and III IFNs, in the figure’s order, LAIV and IIV each against unstimulated organoids.',
        apply: vaccinesVsCtrl(ED3, (n) => pretty(n).replace(/IFN/g, 'IFN-')),
      },
      legend:
        'type I (IFN-α, -β, -ω), type II (IFN-γ) and type III (IFN-λ) IFNs in organoid supernatants after IIV or LAIV (N = 3). The donors’ values aren’t deposited; the Type I/II/III labels beside the rows aren’t drawn.',
      graph: {
        preset: 'barsSem',
        horizontal: true,
        error: 'SEM',
        colors: [RED, NAVY],
        yTitle: 'Cytokine Abundance at Day 3 (Relative to non-stimulated)',
        format: formats(solidBars, blackErrors),
        size: [300, 230],
      },
    },
    {
      label: 'ED4',
      name: 'Extended Data Fig. 4 – Cytokine profiles by stimulation (heat map)',
      file: 'fig4b_vsCtrl.csv',
      sheet: 'fig4b_vsCtrl',
      long: {
        value: 'mean',
        group: 'sti',
        row: 'targetName',
        filters: [{ column: 'sample_day', value: '3' }],
      },
      with: [
        {
          file: 'fig4b_vsIIV.csv',
          sheet: 'fig4b_vsIIV',
          import: { tableKind: 'multipleVariables' },
        },
      ],
      edit: {
        describe:
          'only the 20 cytokines differentially induced by LAIV versus IIV (FDR < 0.05 and fold change > 2 in fig4b_vsIIV.csv, as the legend says); stimulations named by what they combine (the figure’s +/− rows under the map).',
        apply: ed4,
      },
      legend:
        'mean log2 abundance relative to non-stimulated organoids (N = 3) at day 3, cytokines differentially induced by LAIV versus IIV (FDR < 0.05, fold change > 2); rows and columns clustered.',
      graph: {
        preset: 'heatmap',
        size: [200, 380],
        format: {
          does: 'Rows and columns ordered by hierarchical clustering (Euclidean distance, complete linkage, R’s defaults) with dendrograms; a blue–white–red scale from −10 to 10 centred on 0.',
          apply: (g) => ({
            ...g,
            layers: g.layers.map((l) =>
              l.geom === 'tile'
                ? {
                    ...l,
                    style: {
                      ...l.style,
                      cluster: {
                        rows: true,
                        columns: true,
                        distance: 'euclidean',
                        linkage: 'complete',
                      },
                    },
                  }
                : l,
            ),
            scales: {
              ...g.scales,
              color: {
                colors: 'blueRed',
                min: -10,
                max: 10,
                midpoint: 0,
                bar: { title: 'Cytokine Abundance at Day 3 (Relative to non-stimulated)' },
              },
            },
          }),
        },
      },
    },
    {
      label: 'ED5c',
      name: 'Extended Data Fig. 5c – IFNβ and antibody response, older adults (low dose)',
      file: 'fig1b.csv',
      sheet: 'fig1b',
      import: { tableKind: 'multipleVariables' },
      with: [
        {
          file: 'cytokineAcrossCohorts.csv',
          sheet: 'cytokineAcrossCohorts',
          long: {
            value: 'log2mean',
            group: 'analyte_generic_name',
            subject: 'personYear_id',
            filters: [{ column: 'analyte_generic_name', value: 'IFNB' }],
          },
        },
      ],
      edit: {
        describe:
          'fig1b.csv imported as records (one row per person and season) and joined by person and season (personYear_id) to the day-0 IFNβ serum abundance (log2, not normalized) of cytokineAcrossCohorts.csv; kept: adults 65–99 given the standard-dose vaccine with a pre-vaccination titre in the lower half (quartiles 1 and 2), split by sex, quartile, cohort and season, subpopulations of at least 5 people (9, lettered A–I in the order of Extended Data Fig. 5a; each data set’s subcolumn title says which). An XY table: X the IFNβ abundance, one Y data set (the antibody response) per subpopulation.',
        apply: ed5c,
      },
      legend:
        'correlation between IFNβ serum abundance and antibody response in each subpopulation (lines: each subpopulation’s trend; the linear regressions are in the project, but their lines aren’t drawn on the panel’s graph).',
      analyses: [
        {
          analysis: 'linearRegression',
          test: 'Linear regression per subpopulation',
          why: 'the figure’s trend lines; it prints no statistics.',
          brackets: 'none',
          printed: [],
        },
      ],
      graph: {
        preset: 'pointsOnly',
        colors: [
          '#3a9e8f',
          '#6b8e23',
          '#e8732a',
          '#a0522d',
          '#7b68c8',
          '#d33fb0',
          '#e8508a',
          '#a0673a',
          '#6abf40',
        ],
        xTitle: 'log2(IFN–b Serum Abund. on Day 0)',
        yTitle: 'log2(Flu HAI Ab Titer Ratio) (Day 28 vs. Day 0)',
        xRange: [4.5, 10.5],
        size: [220, 190],
        format: zeroLine(4.5, 10.5),
      },
    },
  ],
  figures: [
    { figure: '1', rows: [['1b']], notes: 'a: schematic.' },
    {
      figure: '2',
      rows: [['2']],
      notes: 'The FDR marks (# and *) beside the cytokines aren’t drawn.',
    },
    { figure: '3', rows: [['3b']], notes: 'a: schematic. b: bars ± SEM only (no donor values).' },
    {
      figure: '4',
      rows: [['4b', '4c', '4d'], ['4e']],
      notes:
        'a: schematic. e (right, flu antibody fold change at day 7): no source data (fig4e_flu.csv holds a different summary: three conditions over days 0–10).',
    },
    {
      figure: '6',
      rows: [['6e']],
      notes:
        'a: schematic. b–d: no source data. e: the ELISpot well images aren’t reproduced. (Fig. 5 has no source data.)',
    },
    {
      figure: 'ED5',
      rows: [['ED5c']],
      notes:
        'a: forest plot with a table of the subpopulations (not available in the app). b: a table of group summaries. c: the subpopulations’ trend lines aren’t drawn.',
    },
  ],
}

/** Reads the embedded files (the paper's folder is `chen/`). */
export const chenSourceFile = async (path: string): Promise<Uint8Array | null> => {
  const text = CHEN_FILES[path.replace(/^chen\//, '')]
  return text === undefined ? null : new TextEncoder().encode(text)
}

/** The paper built from the embedded data, with its P value checks. */
export const buildChen = (fonts: FontRegistry): Promise<BuiltPaper> =>
  buildPaper(CHEN, { fonts, sourceFile: chenSourceFile })

/** The example's project, from the embedded data. */
export async function createChenExample(fonts: FontRegistry): Promise<Project> {
  return (await buildChen(fonts)).project
}
